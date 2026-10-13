import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createLiveMode } from '../src/live-ui';
import { createHealth, createMedicalInventory } from '../src/game/health';
import type { LiveSnapshot } from '../src/game/live';

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
let time: number, world: ElementStub, dock: ElementStub, exited: number, joins: number, leaves: number, failedReads: number;
let server: LiveSnapshot, mode: ReturnType<typeof createLiveMode> | undefined;
let nextTimer: number, timers: Map<number, { delay: number; run: () => void }>, replacements: Map<string, PropertyDescriptor | undefined>;
let clockSpy: ReturnType<typeof spyOn<typeof Date, 'now'>>;
function replace(key: string, value: unknown) {
  replacements.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const settle = async () => { for (let count = 0; count < 25; count++) await Promise.resolve(); };
async function click(button: string) {
  const target = new ElementStub('button'); target.dataset.liveButton = button; dock.append(target);
  dock.handlers.get('click')!({ target }); await settle();
}
async function poll() {
  const pending = [...timers.entries()].find(([, item]) => item.delay === 1000);
  expect(pending).toBeDefined(); timers.delete(pending![0]); pending![1].run(); await settle();
}
beforeEach(() => {
  time = 1_800_000_000_000; exited = 0; joins = 0; leaves = 0; failedReads = 0;
  nextTimer = 0; timers = new Map(); replacements = new Map(); world = new ElementStub(); dock = new ElementStub();
  clockSpy = spyOn(Date, 'now').mockImplementation(() => time);
  replace('window', { devicePixelRatio: 1, setTimeout: (run: () => void, delay: number) => { timers.set(++nextTimer, { delay, run }); return nextTimer; }, clearTimeout: (id: number) => timers.delete(id) });
  replace('document', { activeElement: null, createElement: (tag: string) => new ElementStub(tag), querySelector: () => null, addEventListener() {}, removeEventListener() {} });
  replace('ResizeObserver', class { observe() {} disconnect() {} });
  replace('Image', class { src = ''; onload: unknown; onerror: unknown });
  replace('requestAnimationFrame', () => 1); replace('cancelAnimationFrame', () => {});
  server = { server: { id: 'perimeter-1', name: 'Периметр 01', online: 1, capacity: 32, startedAt: time }, now: time,
    world: { width: 32, height: 24, obstacles: [], extracts: [{ x: 2, y: 2 }] }, selfId: 'player-1',
    self: { id: 'player-1', ammo: 60, medkits: 3, cargo: 0, stash: 0, kills: 0, respawnAt: 0, patrol: false, body: createHealth(), medicine: createMedicalInventory(), treatment: null, leaveAt: 0 },
    entities: [{ id: 'player-1', name: 'Боец', kind: 'player', appearance: 0, x: 0, y: 0, health: 100, safeUntil: 0, action: 'idle' }], drops: [], events: [] };
  replace('fetch', async (url: string, options?: RequestInit) => {
    if (url.startsWith('/art/')) return Response.json({ frames: {} });
    const path = url.split('/').at(-1);
    if (path === 'status') return Response.json(server.server);
    if (path === 'join') { joins++; return Response.json({ ...server, now: time }); }
    if (path === 'leave') { leaves++; server.self.leaveAt = time + 5000; return Response.json({ ok: true, leaveAt: server.self.leaveAt }); }
    if (path === 'action') {
      const command = JSON.parse(options!.body as string);
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
  mode = createLiveMode({ world: world as unknown as HTMLElement, dock: dock as unknown as HTMLElement, onExit: () => { exited++; }, onAccount() {}, getAccountId: () => null });
});
afterEach(() => {
  mode?.destroy(); mode = undefined; clockSpy.mockRestore();
  for (const [key, descriptor] of replacements) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
});

describe('visible server-confirmed live exit', () => {
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
