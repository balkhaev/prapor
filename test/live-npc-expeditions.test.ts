import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveService } from '../server/live';
import { createLiveNavigation } from '../server/live-navigation';
import { buildNpcSquadPlans, createNpcSquadState, type NpcSquadState } from '../server/live-squads';
import type { EconomyLoot } from '../server/live-economy';
import type { NpcInventory } from '../server/live-npc-loot';
import { getLiveMap } from '../src/game/live-maps';
import { getLiveBossArenas } from '../src/game/live-boss-arenas';
import { createHealth, type HealthState } from '../src/game/health';
import type { LiveCommand, LiveDrop, LiveEntity, LiveEvent, LivePoint, LiveSnapshot } from '../src/game/live';

const NOW = 1_800_000_000_000, ORIGIN = 'https://npc-expedition.test';
const map = getLiveMap('perimeter'), nav = createLiveNavigation(map), arenas = getLiveBossArenas(map);
const geometry = buildNpcSquadPlans(map, nav, point => arenas.some(arena => point.x >= arena.area.x && point.y >= arena.area.y && point.x < arena.area.x + arena.area.width && point.y < arena.area.y + arena.area.height));
const choice = geometry.squads.flatMap(plan => plan.targets.flatMap(target => {
  const anchor = map.containers.find(anchor => anchor.poiId === target.territoryId && Math.hypot(anchor.x - target.point.x, anchor.y - target.point.y) <= 5 && nav.hasLineOfSight(anchor, target.point));
  return anchor ? [{ plan, target, anchor }] : [];
}))[0]!;
const { plan, target, anchor } = choice;
interface Actor extends LiveEntity { body: HealthState; npcInventory: NpcInventory; npcGeneration: number; nextMove: number; nextAttack: number; respawnAt: number; alife?: { targetId: string | null } }
interface Drop extends LiveDrop { source: string; expiresAt: number; mapId: string }
interface SavedWorld {
  geometryVersion: string;
  scavs: Actor[]; drops: Drop[]; events: LiveEvent[]; npcSquads: NpcSquadState[];
  territoryOwners: Array<[string, 'scavs' | 'raiders' | null]>; lootCooldowns: Array<[string, number]>; npcForageCooldowns: Array<[string, number]>;
  squadWork: Array<[string, { containerId?: string; dropId?: string; readyAt?: number; attempted: string[] }]>;
}
interface Session { id: string; cookie: string }
const fixtures: Array<{ close(): void }> = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.close(); });
const trophy = (): EconomyLoot => ({ id: randomUUID(), modelId: 'coffee', foundAt: NOW });
const point = ({ x, y }: LivePoint): LivePoint => ({ x, y });

function fixture(kind: 'forage' | 'capture' = 'forage') {
  const directory = mkdtempSync(join(tmpdir(), 'prapor-npc-expedition-')), dbPath = join(directory, 'live.sqlite');
  let time = NOW, session: Session | undefined;
  const gameId = randomUUID(), options = { dbPath, now: () => time, random: () => .5, automaticTicks: false, allowedOrigins: [ORIGIN], economy: {
    resolve: () => ({ key: `test:${gameId}`, gameId, name: 'Наблюдатель' }),
    deliver: () => ({ ok: true, message: 'Доставлено' }), supply: () => ({ ammo: 0, medkits: 0, message: 'Пусто' }),
  } };
  let service = createLiveService(options), db = new Database(dbPath, { readonly: true });
  const saved = (): SavedWorld => JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state);
  function restart(edit?: (value: SavedWorld, db: Database) => void, offlineMs = 0) {
    db.close(); service.close(); const writer = new Database(dbPath);
    try {
      const value = JSON.parse(writer.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state) as SavedWorld;
      edit?.(value, writer); writer.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(value));
      for (const row of writer.query<{ boss_id: string; state: string }, []>('SELECT boss_id,state FROM live_bosses').all()) {
        const boss = JSON.parse(row.state); Object.assign(boss, { nextMove: time + 1_000_000, nextAttack: time + 1_000_000 });
        writer.query('UPDATE live_bosses SET state=? WHERE boss_id=?').run(JSON.stringify(boss), row.boss_id);
      }
    } finally { writer.close(); }
    time += offlineMs;
    service = createLiveService(options); db = new Database(dbPath, { readonly: true });
  }
  const item = trophy();
  restart(value => {
    const dead = createHealth(); dead.parts.head.hp = 0;
    for (const actor of value.scavs) {
      actor.body = structuredClone(dead); actor.health = 0; actor.respawnAt = time + 1_000_000;
      actor.npcInventory = { items: [], money: 0 };
    }
    const used = new Set<string>();
    for (const [index, id] of plan.memberIds.entries()) {
      const actor = value.scavs.find(actor => actor.id === id)!;
      const candidates = index === 0 ? [point(anchor)] : [target.point, ...Array.from({ length: 49 }, (_, i) => ({ x: target.point.x + i % 7 - 3, y: target.point.y + Math.floor(i / 7) - 3 }))];
      const placement = candidates.find(candidate => nav.walkable(candidate) && nav.hasLineOfSight(candidate, target.point) && !used.has(`${candidate.x},${candidate.y}`))!;
      used.add(`${placement.x},${placement.y}`);
      Object.assign(actor, placement, { body: createHealth(), health: 100, npcGeneration: 0, nextMove: time + 1_000_000, nextAttack: time + 1_000_000, alife: undefined });
    }
    const state = createNpcSquadState(plan, time);
    Object.assign(state, { phase: 'objective', missionKind: kind, targetId: target.territoryId, leaderId: plan.memberIds[0],
      members: plan.memberIds.map(id => ({ id, lifeCycle: 0 })), startedAt: time, missionUntil: time + 240_000, phaseUntil: time + 240_000 });
    value.npcSquads = geometry.squads.map(other => other.id === plan.id ? state : createNpcSquadState(other, time));
    value.territoryOwners = value.territoryOwners.map(([id, owner]) => [id, id === target.territoryId ? kind === 'forage' ? plan.faction : null : owner]);
    value.drops = value.drops.filter(drop => drop.containerId === anchor.id);
    Object.assign(value.drops[0]!, { items: [item], amount: 17 });
    value.lootCooldowns = map.containers.filter(candidate => candidate.id !== anchor.id).map(candidate => [`container:${candidate.id}`, time + 1_000_000]);
    value.events = [];
  });
  async function request(path: string, command?: object) {
    const response = await service.fetch(new Request(`${ORIGIN}/api/live/${path}`, { method: command ? 'POST' : 'GET', headers: {
      'x-prapor-world-version': map.version,
      ...(command ? { origin: ORIGIN, 'content-type': 'application/json' } : {}),
      ...(session ? { cookie: session.cookie, 'x-prapor-live': session.id } : {}),
    }, ...(command ? { body: JSON.stringify(command) } : {}) })); expect(response).not.toBeNull(); return response!;
  }
  async function state(): Promise<LiveSnapshot> { const response = await request('state'); expect(response.status).toBe(200); return response.json() as Promise<LiveSnapshot>; }
  async function enter() {
    const response = await request('join', {}); expect(response.status).toBe(200); const snapshot = await response.json() as LiveSnapshot;
    session ??= { id: snapshot.selfId, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '' }; return snapshot;
  }
  async function player(position: LivePoint) {
    if (!session) await enter();
    restart((_, writer) => {
      const row = writer.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').all().find(row => JSON.parse(row.state).id === session!.id)!;
      const value = JSON.parse(row.state); Object.assign(value, position, { body: createHealth(), health: 100, safeUntil: time + 1_000_000,
        healthAt: time, ammo: 60, nextMove: time + 1_000_000, automation: undefined, destination: null, targetId: null });
      writer.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(value), row.identity);
    });
    return enter();
  }
  async function advance(ms: number) {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      time += Math.min(1000, ms - elapsed); service.tick(); if (session && elapsed % 5000 === 0) await state();
    }
    expect(service.healthy()).toBe(true);
  }
  const close = () => { db.close(); service.close(); rmSync(directory, { recursive: true, force: true }); };
  fixtures.push({ close });
  return { saved, restart, advance, player, state, enter, item, now: () => time, act: (command: LiveCommand) => request('action', command) };
}

describe('NPC expeditions transfer real world resources', () => {
  test('nearby timed search transfers exact cargo once, survives restart, and deposits only after physically reaching base', async () => {
    const f = fixture(), original = f.saved().drops[0]!;
    await f.advance(1000); await f.advance(anchor.searchMs - 1000);
    expect(f.saved().drops.some(drop => drop.id === original.id)).toBe(true);
    expect(f.saved().scavs.every(actor => !actor.npcInventory.items.length)).toBe(true);
    await f.advance(1000);
    const carrier = f.saved().scavs.find(actor => actor.npcInventory.items.length)!;
    expect(carrier.npcInventory).toEqual({ items: [f.item], money: 17 });
    expect(f.saved().drops.some(drop => drop.id === original.id)).toBe(false);
    expect(f.saved().npcForageCooldowns.find(([id]) => id === target.territoryId)?.[1]).toBe(f.now() + 180_000);
    f.restart(); expect(f.saved().scavs.find(actor => actor.id === carrier.id)!.npcInventory).toEqual(carrier.npcInventory);
    await f.advance(5000); expect(f.saved().drops.some(drop => drop.source === 'base')).toBe(false);
    f.restart(value => {
      for (const actor of value.scavs.filter(actor => plan.memberIds.includes(actor.id))) actor.nextMove = f.now();
    });
    let previous = new Map(f.saved().scavs.map(actor => [actor.id, point(actor)]));
    for (let second = 0; second < 180 && !f.saved().drops.some(drop => drop.source === 'base'); second++) {
      await f.advance(1000);
      for (const actor of f.saved().scavs.filter(actor => plan.memberIds.includes(actor.id))) {
        const last = previous.get(actor.id)!; expect(Math.abs(actor.x - last.x) + Math.abs(actor.y - last.y)).toBeLessThanOrEqual(1);
        expect(nav.walkable(actor)).toBe(true); previous.set(actor.id, point(actor));
      }
    }
    const cache = f.saved().drops.find(drop => drop.source === 'base')!; expect(cache).toBeDefined();
    expect(cache.items).toEqual([f.item]); expect(cache.amount).toBe(17); expect(cache.expiresAt).toBe(Number.MAX_SAFE_INTEGER);
    expect(cache.npcBase).toEqual({ id: plan.baseId, faction: plan.faction });
    expect(f.saved().scavs.find(actor => actor.id === carrier.id)!.npcInventory).toEqual({ items: [], money: 0 });
    f.restart(); expect(f.saved().drops.find(drop => drop.id === cache.id)).toEqual(cache);
    await f.player(plan.base);
    const visible = await f.state(); expect(visible.drops.find(drop => drop.id === cache.id)?.items).toEqual([f.item]);
    expect(JSON.stringify(visible)).not.toContain('npcInventory'); expect(JSON.stringify(visible)).not.toContain('npcSquads');
    const picked = await f.act({ type: 'loot', id: cache.id }); expect(picked.status).toBe(200);
    expect((await picked.json() as LiveSnapshot).self.lootItems).toEqual([f.item]);
    expect((await f.act({ type: 'loot', id: cache.id })).status).toBe(409);
    await f.advance(31_000); expect(f.saved().drops.some(drop => drop.source === 'base')).toBe(false);
  });

  test('two visible members capture only after actual uncontested time; a live player and offline elapsed time never grant capture', async () => {
    const f = fixture('capture'); await f.player(target.point); await f.advance(25_000);
    const owner = () => f.saved().territoryOwners.find(([id]) => id === target.territoryId)![1];
    expect(owner()).toBeNull();
    await f.player({ x: 0, y: 0 }); await f.advance(10_000); expect(owner()).toBeNull();
    // Reloading does not finish the remaining capture time on its own.
    f.restart(undefined, 60_000); expect(owner()).toBeNull(); await f.enter(); await f.advance(9000); expect(owner()).toBeNull();
    await f.advance(2000); expect(owner()).toBe(plan.faction);
    expect(f.saved().events.filter(event => event.text.includes('взял под контроль'))).toHaveLength(1);
  });

  test('a full base retains carried goods, and NPC death drops that same parcel exactly once', async () => {
    const f = fixture(), held = { items: [f.item], money: 17 }, cacheItems: EconomyLoot[] = Array.from({ length: 4 }, () => ({ id: randomUUID(), modelId: 'tool-case', foundAt: NOW }));
    const carrierId = plan.memberIds[0]!;
    f.restart(value => {
      const carrier = value.scavs.find(actor => actor.id === carrierId)!;
      Object.assign(carrier, plan.base, { npcInventory: held, nextMove: NOW + 1_000_000 });
      value.drops = [{ id: randomUUID(), mapId: 'perimeter', ...plan.base, source: 'base', npcBase: { id: plan.baseId, faction: plan.faction },
        amount: 500, items: cacheItems, expiresAt: Number.MAX_SAFE_INTEGER }];
      value.lootCooldowns = map.containers.map(anchor => [`container:${anchor.id}`, NOW + 1_000_000]);
    });
    await f.advance(5000);
    expect(f.saved().scavs.find(actor => actor.id === carrierId)!.npcInventory).toEqual(held);
    expect(f.saved().drops.find(drop => drop.source === 'base')).toMatchObject({ amount: 500, items: cacheItems });
    f.restart(value => {
      const actor = value.scavs.find(actor => actor.id === carrierId)!;
      actor.body.parts.head.hp = .1; actor.body.parts.chest.bleeding = 'heavy';
    });
    await f.advance(1000);
    const parcels = f.saved().drops.filter(drop => drop.items?.some(item => item.id === f.item.id));
    expect(parcels).toHaveLength(1); expect(parcels[0]).toMatchObject({ source: 'body', items: held.items, amount: held.money });
    expect(f.saved().scavs.find(actor => actor.id === carrierId)!.npcInventory).toEqual({ items: [], money: 0 });
    f.restart(); await f.advance(2000);
    expect(f.saved().drops.filter(drop => drop.items?.some(item => item.id === f.item.id))).toHaveLength(1);
  });

  test('a nearby player blocks foraging and an oversized complete bundle stays in its source unchanged', async () => {
    const f = fixture(), heavy: EconomyLoot[] = Array.from({ length: 2 }, () => ({ id: randomUUID(), modelId: 'tool-case', foundAt: NOW }));
    f.restart(value => { value.drops[0]!.items = heavy; });
    const source = f.saved().drops[0]!;
    await f.player(target.point); await f.advance(10_000);
    expect(f.saved().drops.find(drop => drop.id === source.id)).toEqual(source);
    expect(f.saved().scavs.every(actor => !actor.npcInventory.items.length)).toBe(true);
    await f.player({ x: 0, y: 0 });
    f.restart(value => { value.scavs.find(actor => actor.id === plan.memberIds[0])!.nextMove = f.now(); }); await f.enter();
    // The carrier must physically inspect the other known anchors before it can
    // conclude they are empty; it cannot know that from hidden drop contents.
    for (let second = 0; second < 90 && f.saved().npcSquads.find(state => state.id === plan.id)?.phase !== 'return'; second++) await f.advance(1000);
    expect(f.saved().drops.find(drop => drop.id === source.id)).toEqual(source);
    expect(f.saved().scavs.every(actor => !actor.npcInventory.items.length)).toBe(true);
    expect(f.saved().npcSquads.find(state => state.id === plan.id)?.phase).toBe('return');
    expect(f.saved().npcForageCooldowns).toEqual([]);
  });

  test('a carrier reaches a container beyond the capture circle through occlusion and restart without bouncing back to the point', async () => {
    const f = fixture(), carrierId = plan.memberIds[0]!;
    const distant = map.containers.find(candidate => candidate.poiId === target.territoryId
      && Math.hypot(candidate.x - target.point.x, candidate.y - target.point.y) > 8
      && Math.hypot(candidate.x - target.point.x, candidate.y - target.point.y) <= 10
      && !nav.hasLineOfSight(anchor, candidate) && nav.findPath(anchor, candidate))!;
    expect(distant).toBeDefined();
    f.restart(value => {
      Object.assign(value.drops[0]!, point(distant), { containerId: distant.id, containerKind: distant.kind });
      value.lootCooldowns = map.containers.filter(candidate => candidate.id !== distant.id).map(candidate => [`container:${candidate.id}`, f.now() + 1_000_000]);
      value.scavs.find(actor => actor.id === carrierId)!.nextMove = f.now();
    });
    const original = f.saved().drops[0]!;
    let previous = point(f.saved().scavs.find(actor => actor.id === carrierId)!), crossedCircle = false, restartedEnRoute = false;
    for (let second = 0; second < 60; second++) {
      await f.advance(1000);
      const saved = f.saved(), carrier = saved.scavs.find(actor => actor.id === carrierId)!;
      expect(Math.abs(carrier.x - previous.x) + Math.abs(carrier.y - previous.y)).toBeLessThanOrEqual(1);
      expect(nav.walkable(carrier)).toBe(true); previous = point(carrier);
      crossedCircle ||= Math.hypot(carrier.x - target.point.x, carrier.y - target.point.y) > 6;
      if (carrier.npcInventory.items.length) break;
      expect(saved.drops.find(drop => drop.id === original.id)).toEqual(original);
      const work = saved.squadWork.find(([id]) => id === plan.id)?.[1];
      if (!restartedEnRoute && work?.containerId === distant.id && Math.hypot(carrier.x - distant.x, carrier.y - distant.y) > 1.5) {
        expect(work.dropId).toBeUndefined(); expect(work.readyAt).toBeUndefined();
        f.restart();
        expect(f.saved().squadWork.find(([id]) => id === plan.id)?.[1].containerId).toBe(distant.id);
        restartedEnRoute = true;
      }
    }
    expect(restartedEnRoute).toBe(true); expect(crossedCircle).toBe(true);
    expect(f.saved().scavs.find(actor => actor.id === carrierId)!.npcInventory).toEqual({ items: [f.item], money: 17 });
    expect(f.saved().drops.some(drop => drop.id === original.id)).toBe(false);
    expect(f.saved().events.filter(event => event.text.includes('забрал припасы'))).toHaveLength(1);
  });

  test('a geometry migration replaces the old roster while preserving carried physical items and cash exactly once', () => {
    const f = fixture(), held = { items: [f.item], money: 17 };
    f.restart(value => {
      value.geometryVersion = `${map.version}-previous-layout`;
      value.scavs.find(actor => actor.id === plan.memberIds[0])!.npcInventory = held;
      value.drops = [];
    });
    const migrated = f.saved().drops.filter(drop => drop.items?.some(item => item.id === f.item.id));
    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toMatchObject({ source: 'body', items: held.items, amount: held.money });
    expect(nav.walkable(migrated[0]!)).toBe(true);
    expect(f.saved().scavs.every(actor => !actor.npcInventory?.items.some(item => item.id === f.item.id))).toBe(true);
    f.restart();
    expect(f.saved().drops.filter(drop => drop.items?.some(item => item.id === f.item.id))).toEqual(migrated);
    expect(f.saved().scavs.every(actor => !actor.npcInventory?.items.some(item => item.id === f.item.id))).toBe(true);
  });

  test('a retired faction base preserves its cache as indefinitely available loose cargo across restart', async () => {
    const f = fixture(), cacheId = randomUUID();
    expect(geometry.squads.some(candidate => candidate.baseId === target.territoryId)).toBe(false);
    f.restart(value => {
      value.drops = [{ id: cacheId, mapId: 'perimeter', ...point(anchor), source: 'base',
        npcBase: { id: target.territoryId, faction: plan.faction }, amount: 17, items: [f.item], expiresAt: Number.MAX_SAFE_INTEGER }];
    });
    const migrated = f.saved().drops.find(drop => drop.id === cacheId)!;
    expect(migrated).toMatchObject({ source: 'body', items: [f.item], amount: 17, expiresAt: Number.MAX_SAFE_INTEGER });
    expect(migrated.npcBase).toBeUndefined(); expect(migrated.containerId).toBeUndefined();
    await f.advance(125_000); f.restart();
    expect(f.saved().drops.filter(drop => drop.items?.some(item => item.id === f.item.id))).toEqual([migrated]);
    await f.player(point(migrated));
    const picked = await f.act({ type: 'loot', id: cacheId }); expect(picked.status).toBe(200);
    const snapshot = await picked.json() as LiveSnapshot;
    expect(snapshot.self.lootItems).toEqual([f.item]); expect(snapshot.self.cargo).toBe(17);
    expect(f.saved().drops.some(drop => drop.id === cacheId)).toBe(false);
  });
});
