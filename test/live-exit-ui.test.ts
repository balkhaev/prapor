import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createLiveMode } from '../src/live-ui';
import { createHealth, createMedicalInventory } from '../src/game/health';
import type { LivePoint, LiveSnapshot } from '../src/game/live';
import { getLiveMap } from '../src/game/live-maps';
import { BOSSES } from '../src/game/bosses';
import { getLiveBossArena } from '../src/game/live-boss-arenas';
import { quoteLiveKits, type LiveEntry } from '../src/game/live-entry';

class ElementStub {
  hidden = false; innerHTML = ''; className = ''; tabIndex = 0; disabled = false;
  dataset: Record<string, string> = {};
  children: ElementStub[] = []; parent: ElementStub | null = null;
  handlers = new Map<string, (event: unknown) => void>();
  classList = { add: () => {}, remove: () => {} };
  constructor(readonly tag = 'div') {}
  append(...children: ElementStub[]) { for (const child of children) { child.parent = this; this.children.push(child); } }
  contains(value: unknown): boolean { return value === this || this.children.some(child => child.contains(value)); }
  querySelector(selector: string) { return selector === 'canvas' ? this.children.find(child => child.tag === 'canvas') ?? null : null; }
  querySelectorAll() { return []; }
  setAttribute() {} removeAttribute() {} getAttribute() { return null; }
  addEventListener(type: string, handler: (event: unknown) => void) { this.handlers.set(type, handler); }
  removeEventListener(type: string) { this.handlers.delete(type); }
  getBoundingClientRect() { return { width: 800, height: 600, left: 0, top: 0 }; }
  getContext() { return { setTransform() {}, clearRect() {}, fillRect() {}, createRadialGradient: () => ({ addColorStop() {} }) }; }
  closest() { return this; }
  focus() {} remove() {}
}
let time: number, world: ElementStub, dock: ElementStub, exited: number, marketOpened: number, joins: number, leaves: number, failedReads: number;
let server: LiveSnapshot, mode: ReturnType<typeof createLiveMode> | undefined;
let nextTimer: number, timers: Map<number, { delay: number; run: () => void }>, replacements: Map<string, PropertyDescriptor | undefined>;
let clockSpy: ReturnType<typeof spyOn<typeof Date, 'now'>>;
let sceneRoute:string[],commands:unknown[],sceneFocus:LivePoint[];
function replace(key: string, value: unknown) {
  replacements.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const settle = async () => { for (let count = 0; count < 25; count++) await Promise.resolve(); };
async function click(button: string) {
  const host = button === 'join' || button.startsWith('boss-route:') ? world.children[0]! : dock;
  const target = new ElementStub('button'); target.dataset.liveButton = button; host.append(target);
  host.handlers.get('click')!({ target }); await settle();
}
async function poll() {
  const pending = [...timers.entries()].find(([, item]) => item.delay === 500);
  expect(pending).toBeDefined(); timers.delete(pending![0]); pending![1].run(); await settle();
}
beforeEach(() => {
  time = 1_800_000_000_000; exited = 0; marketOpened = 0; joins = 0; leaves = 0; failedReads = 0;
  sceneRoute=[];commands=[];sceneFocus=[];
  nextTimer = 0; timers = new Map(); replacements = new Map(); world = new ElementStub(); dock = new ElementStub();
  clockSpy = spyOn(Date, 'now').mockImplementation(() => time);
  replace('window', { devicePixelRatio: 1, setTimeout: (run: () => void, delay: number) => { timers.set(++nextTimer, { delay, run }); return nextTimer; }, clearTimeout: (id: number) => timers.delete(id) });
  replace('document', { activeElement: null, createElement: (tag: string) => new ElementStub(tag), querySelector: () => null, addEventListener() {}, removeEventListener() {} });
  replace('ResizeObserver', class { observe() {} disconnect() {} });
  replace('Image', class { src = ''; onload: unknown; onerror: unknown });
  replace('requestAnimationFrame', () => 1); replace('cancelAnimationFrame', () => {});
  const { npcSpawns: _npcs, lootSpawns: _loot, ...geometry } = structuredClone(getLiveMap('perimeter'));
  server = { server: { id: 'perimeter-1', name: 'Периметр 01', online: 1, capacity: 32, startedAt: time,
      maps: [{ id: geometry.id, name: geometry.name, description: geometry.description, theme: geometry.theme, width: geometry.width, height: geometry.height, online: 1, npcs: 0 }],
      districts: geometry.districts.map((district, index) => ({ ...district, online: index === 0 ? 1 : 0, npcs: 0 })),
    }, now: time, world: geometry, worldVersion: geometry.version, visibleChunks: [{ x: 0, y: 0 }], selfId: 'player-1',
    self: { id: 'player-1', ammo: 60, medkits: 3, cargo: 0, stash: 0, kills: 0, respawnAt: 0, patrol: false, targetId: null, travelReadyAt: 0, body: createHealth(), medicine: createMedicalInventory(), treatment: null, leaveAt: 0, districtId: 'customs', purpose: 'loot', searching: null, gameId: 'cba21a6d-2936-4590-9433-dfa2b58c8dc8', lootItems: [], pendingDelivery: [], economyMessage: '' },
    entities: [{ id: 'player-1', name: 'Боец', kind: 'player', appearance: 0, x: 0, y: 0, health: 100, safeUntil: 0, action: 'idle' }], drops: [], events: [] };
  replace('fetch', async (url: string, options?: RequestInit) => {
    if (url.startsWith('/art/')) return Response.json({ frames: {} });
    const path = url.split('/').at(-1);
    if (path === 'status') return Response.json(server.server);
    if (path === 'entry') {
      const stock = { money: 640, ammo: 100, medicine: 3 };
      const entry: LiveEntry = { server: server.server, now: time, mode: 'new', fighter: null, stock, kits: quoteLiveKits(stock) };
      return Response.json(entry);
    }
    if (path === 'join') { joins++; return Response.json({ ...server, now: time }); }
    if (path === 'leave') { leaves++; server.self.leaveAt = time + 5000; return Response.json({ ok: true, leaveAt: server.self.leaveAt }); }
    if (path === 'action') {
      const command = JSON.parse(options!.body as string);
      commands.push(command);
      if (command.type === 'move' || command.type === 'treat') server.self.leaveAt = 0;
      return Response.json({ ...server, now: time });
    }
    if (path === 'state') {
      if (failedReads-- > 0) return Response.json({ code: 'service_unavailable' }, { status: 503 });
      if (server.self.leaveAt > 0 && server.self.leaveAt <= time) return Response.json({ code: 'join_required' }, { status: 401 });
      return Response.json({ ...server, now: time });
    }
    throw new Error(`Unexpected request ${url}`);
  });
  mode = createLiveMode({ world: world as unknown as HTMLElement, dock: dock as unknown as HTMLElement, onExit: () => { exited++; }, onAccount() {}, onMarket: () => { marketOpened++; }, getAccountId: () => null, getGameId: () => server.self.gameId ?? null,
    sceneFactory: () => ({ show() {}, hide() {}, clear() {}, setSelected() {}, update() {}, destroy() {},setRoute(ids){sceneRoute=[...ids];},focusPoint(point){sceneFocus.push({...point});} }),
  });
});
afterEach(() => {
  mode?.destroy(); mode = undefined; clockSpy.mockRestore();
  for (const [key, descriptor] of replacements) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
});

describe('visible server-confirmed live exit', () => {
  test('inspecting a published courtyard keeps departure and position; walking uses a real entrance', async () => {
    const site = server.world.citySites![0]!, poi = server.world.pois.find(poi => poi.id === site.poiId)!;
    mode!.show(); await settle(); await click('join'); await click('exit');
    const position = { x: server.entities[0]!.x, y: server.entities[0]!.y }, deadline = server.self.leaveAt;
    await click(`site-view:${site.id}`);
    expect(sceneFocus).toEqual([{ x: site.courtyard.x + site.courtyard.width / 2, y: site.courtyard.y + site.courtyard.height / 2 }]);
    expect(commands).toHaveLength(0); expect(joins).toBe(1); expect(leaves).toBe(1);
    expect(server.self.leaveAt).toBe(deadline);
    expect({ x: server.entities[0]!.x, y: server.entities[0]!.y }).toEqual(position);
    await click('site-view:foreign-site'); expect(sceneFocus).toHaveLength(1);
    await click(`poi:${site.poiId}`);
    expect(commands).toHaveLength(1);
    expect(poi.entrances.some(port => (commands[0] as { type: string; x: number; y: number }).type === 'move' && port.x === (commands[0] as LivePoint).x && port.y === (commands[0] as LivePoint).y)).toBe(true);
    expect(server.self.leaveAt).toBe(0);
  });
  test('boss guidance marks its authored arena and changing boss does not move or teleport the player',async()=>{
    server.self.purpose='boss';server.server.bosses=BOSSES.map(boss=>{const arena=getLiveBossArena(server.world,boss.id);return {bossId:boss.id,name:boss.name,districtId:boss.districtId,poiId:arena.poiId,area:arena.area,state:'alive',respawnAt:0};});
    mode!.show();await settle();await click('boss-route:bugor');await click('join');
    const village=getLiveBossArena(server.world,'bugor'),depot=getLiveBossArena(server.world,'komendant');
    expect(sceneRoute).toEqual([village.poiId]);expect(dock.innerHTML).toContain(`data-live-button="poi-view:${village.poiId}"`);expect(dock.innerHTML).not.toContain('class="live-boss-weapon"');
    const point={x:server.entities[0]!.x,y:server.entities[0]!.y};await click('boss-area:komendant');
    expect(sceneRoute).toEqual([depot.poiId]);expect(dock.innerHTML).toContain(`data-live-button="poi-view:${depot.poiId}"`);expect(commands).toHaveLength(0);expect(joins).toBe(1);expect(server.self.districtId).toBe('customs');expect({x:server.entities[0]!.x,y:server.entities[0]!.y}).toEqual(point);
    await click(`poi:${depot.poiId}`);expect(commands).toHaveLength(1);expect((commands[0] as {type:string}).type).toBe('move');
  });
  test('choosing a boss hunt changes only lobby district and purpose until explicit entry',async()=>{
    mode!.show();await settle();await click('boss-route:bugor');
    expect(joins).toBe(0);expect(server.self.districtId).toBe('customs');expect(world.children[0]!.innerHTML).toContain('Посёлок · Охота на главаря');expect(world.children[0]!.innerHTML).toContain('data-live-button="purpose:boss" aria-pressed="true"');
    await click('boss-route:constructor');expect(joins).toBe(0);expect(world.children[0]!.innerHTML).toContain('Посёлок · Охота на главаря');
    await click('join');expect(joins).toBe(1);expect(server.self.districtId).toBe('customs');
    await click('boss-route:komendant');expect(server.self.districtId).toBe('customs');expect(joins).toBe(1);
  });
  test('opening the headquarters market waits for confirmed departure while the body remains visible', async () => {
    mode!.show(); await settle(); await click('join'); await click('market');
    expect(marketOpened).toBe(0); expect(exited).toBe(0); expect(mode!.isActive()).toBe(true);
    expect(world.hidden).toBe(false); expect(dock.innerHTML).toContain('Выход через 5 сек.');
    time += 5000; await poll();
    expect(marketOpened).toBe(1); expect(exited).toBe(0); expect(mode!.isActive()).toBe(false); expect(world.hidden).toBe(true);
    expect(leaves).toBe(1);
  });
  test('keeps the dangerous countdown visible through a failed read and exits once presence is gone', async () => {
    mode!.show(); await settle(); await click('join');
    await click('exit');
    expect(exited).toBe(0); expect(mode!.isActive()).toBe(true); expect(world.hidden).toBe(false); expect(dock.innerHTML).toContain('Выход через 5 сек.');
    failedReads = 1; time += 1000; await poll();
    expect(exited).toBe(0); expect(dock.innerHTML).toContain('Выход через 4 сек.');
    time += 1000; await poll(); expect(dock.innerHTML).toContain('Выход через 3 сек.');
    time += 3000; await poll();
    expect(exited).toBe(1); expect(mode!.isActive()).toBe(false); expect(world.hidden).toBe(true); expect(joins).toBe(1); expect(leaves).toBe(1);
  });
  test('a confirmed movement command cancels the pending exit without hiding or rejoining the body', async () => {
    mode!.show(); await settle(); await click('join'); await click('exit'); await click('move:1:0');
    expect(exited).toBe(0); expect(dock.innerHTML).not.toContain('Выход через'); expect(dock.innerHTML).toContain('Выход прерван приказом.');
    time += 6000; await poll();
    expect(mode!.isActive()).toBe(true); expect(exited).toBe(0); expect(joins).toBe(1); expect(leaves).toBe(1);
  });
});
