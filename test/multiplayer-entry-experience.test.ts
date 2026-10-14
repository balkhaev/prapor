import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameService, type GameService } from '../server/game';
import { createLiveService, type LiveService } from '../server/live';
import type { EconomyLoot } from '../server/live-economy';
import type { GameSnapshot } from '../src/game/commands';
import { createHealth, createMedicalInventory } from '../src/game/health';
import type { LiveCommand, LiveDistrictId, LiveEntity, LiveKitId, LivePoint, LivePurpose, LiveSnapshot } from '../src/game/live';
import { getLiveMap, hasLiveLineOfSight, isLiveWalkable } from '../src/game/live-maps';

const NOW = 1_800_000_000_000, ORIGIN = 'https://multiplayer-entry.test';
const map = getLiveMap('perimeter');
interface Guest { cookie: string; headquarters: GameSnapshot; id?: string }
interface StoredWorld { scavs: Array<Record<string, unknown>>; drops: Array<Record<string, unknown>>; events: unknown[] }
interface Harness {
  folder: string;
  gamePath: string;
  livePath: string;
  game: GameService;
  live: LiveService;
  time: number;
  restart(edit?: (db: Database) => void): void;
  advance(milliseconds: number, guests: Guest[]): Promise<void>;
}
const running: Harness[] = [];
afterEach(async () => {
  for (const h of running.splice(0)) {
    h.live.close(); h.game.close();
    await rm(h.folder, { recursive: true, force: true });
  }
});

async function setup(): Promise<Harness> {
  const folder = await mkdtemp(join(tmpdir(), 'prapor-multiplayer-entry-'));
  const gamePath = join(folder, 'game.sqlite'), livePath = join(folder, 'live.sqlite');
  const h = { folder, gamePath, livePath, time: NOW } as Harness;
  h.game = createGameService({ dbPath: gamePath, secureCookies: false, allowedOrigins: [ORIGIN], now: () => h.time });
  const liveOptions = () => ({ dbPath: livePath, secureCookies: false, allowedOrigins: [ORIGIN], economy: h.game.liveEconomy, now: () => h.time, random: () => .5, automaticTicks: false });
  h.live = createLiveService(liveOptions());
  h.restart = edit => {
    h.live.close();
    if (edit) {
      const db = new Database(livePath);
      try { edit(db); } finally { db.close(); }
    }
    h.live = createLiveService(liveOptions());
  };
  h.advance = async (milliseconds, guests) => {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 250) {
      h.time += 250; h.live.tick();
      if (elapsed % 1000 === 0) for (const guest of guests) await state(h, guest);
    }
  };
  running.push(h);
  // Keep authored geometry and containers intact. Unrelated NPCs sleep during the
  // two-player scenarios; only this closed temporary SQLite fixture is edited.
  h.restart(db => {
    const row = db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!;
    const world = JSON.parse(row.state) as StoredWorld;
    const dead = createHealth(); dead.parts.head.hp = 0;
    for (const npc of world.scavs) Object.assign(npc, { body: dead, health: 0, respawnAt: NOW + 1_000_000, nextMove: NOW + 1_000_000, nextAttack: NOW + 1_000_000 });
    db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(world));
    for (const boss of db.query<{ boss_id: string; state: string }, []>('SELECT boss_id,state FROM live_bosses').all()) {
      const saved = JSON.parse(boss.state) as Record<string, unknown>;
      Object.assign(saved, { body: dead, health: 0, bossDeathSettled: true, respawnAt: NOW + 1_000_000 });
      db.query('UPDATE live_bosses SET state=? WHERE boss_id=?').run(JSON.stringify(saved), boss.boss_id);
    }
  });
  return h;
}

async function request(h: Harness, scope: 'game' | 'live', endpoint: string, guest?: Guest, body?: unknown, extra: Record<string, string> = {}): Promise<Response> {
  const response = await h[scope].fetch(new Request(`${ORIGIN}/api/${scope}/${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { origin: ORIGIN, 'content-type': 'application/json' }),
      ...(guest ? { cookie: guest.cookie, 'x-prapor-game': guest.headquarters.identity.id, ...(guest.id ? { 'x-prapor-live': guest.id } : {}) } : {}),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), guest?.headquarters.identity.id ?? '192.0.2.81');
  if (!response) throw new Error(`Missing ${scope}/${endpoint} response`);
  return response;
}
async function guest(h: Harness): Promise<Guest> {
  const response = await request(h, 'game', 'join', undefined, {});
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Headquarters did not issue a guest cookie');
  return { cookie, headquarters: await response.json() as GameSnapshot };
}
async function headquarters(h: Harness, player: Guest): Promise<GameSnapshot> {
  const response = await request(h, 'game', 'state', player);
  expect(response.status).toBe(200);
  return player.headquarters = await response.json() as GameSnapshot;
}
async function enter(h: Harness, player: Guest, districtId: LiveDistrictId = 'customs', purpose: LivePurpose = 'pvp', kitId?: LiveKitId): Promise<LiveSnapshot> {
  const response = await request(h, 'live', 'join', player, { districtId, purpose, ...(kitId ? { kitId } : {}) });
  expect(response.status).toBe(200);
  const snapshot = await response.json() as LiveSnapshot;
  if (player.id) expect(snapshot.selfId).toBe(player.id);
  player.id = snapshot.selfId;
  return snapshot;
}
async function state(h: Harness, player: Guest): Promise<LiveSnapshot> {
  const response = await request(h, 'live', 'state', player);
  expect(response.status).toBe(200);
  return await response.json() as LiveSnapshot;
}
async function act(h: Harness, player: Guest, command: LiveCommand): Promise<LiveSnapshot> {
  const response = await request(h, 'live', 'action', player, command);
  expect(response.status).toBe(200);
  return await response.json() as LiveSnapshot;
}
function self(snapshot: LiveSnapshot): LiveEntity {
  const entity = snapshot.entities.find(entity => entity.id === snapshot.selfId);
  if (!entity) throw new Error('Own server body is missing');
  return entity;
}
function place(h: Harness, players: Array<{ guest: Guest; point: LivePoint; fields?: Record<string, unknown> }>): void {
  h.restart(db => {
    for (const player of players) {
      expect(isLiveWalkable(map, player.point)).toBe(true);
      const row = db.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').all()
        .find(row => (JSON.parse(row.state) as { id: string }).id === player.guest.id);
      if (!row) throw new Error('Fixture player is not persisted');
      const saved = JSON.parse(row.state) as Record<string, unknown>;
      Object.assign(saved, { x: player.point.x, y: player.point.y }, { safeUntil: 0, lastCombatAt: 0, dangerUntil: 0, healthAt: h.time }, player.fields);
      db.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(saved), row.identity);
    }
    // Previous events describe the real initial spawn, before fixture placement.
    // Test privacy using new events at the actual cover positions below.
    const row = db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!;
    const world = JSON.parse(row.state) as StoredWorld; world.events = [];
    db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(world));
  });
}
function receipts(h: Harness): { supplies: number; deliveries: number; items: number } {
  const db = new Database(h.gamePath, { readonly: true });
  try {
    const count = (table: 'authoritative_live_supplies' | 'authoritative_live_deliveries' | 'authoritative_live_items') =>
      db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count;
    return { supplies: count('authoritative_live_supplies'), deliveries: count('authoritative_live_deliveries'), items: count('authoritative_live_items') };
  } finally { db.close(); }
}
function behindCover(): [LivePoint, LivePoint] {
  for (const wall of map.obstacles.filter(wall => wall.kind !== 'water')) {
    const a = { x: wall.x, y: wall.y - 1 }, b = { x: wall.x, y: wall.y + wall.height };
    if (isLiveWalkable(map, a) && isLiveWalkable(map, b) && Math.hypot(a.x - b.x, a.y - b.y) <= 7 && !hasLiveLineOfSight(map, a, b)) return [a, b];
  }
  throw new Error('No nearby cover fixture in the generated world');
}

describe('one multiplayer entry and persistent shared raid experience', () => {
  test('independent headquarters guests share one server, observe paced movement and take the same real PvP hit', async () => {
    const h = await setup(), first = await guest(h), second = await guest(h);
    expect(first.cookie).not.toBe(second.cookie);
    expect(first.headquarters.identity.id).not.toBe(second.headquarters.identity.id);
    const initialStock = structuredClone(first.headquarters.state.supplies);
    const initialMoney = first.headquarters.state.money;
    const firstJoin = await enter(h, first), secondJoin = await enter(h, second);
    expect(first.id).not.toBe(second.id);
    expect(firstJoin.world).toEqual(secondJoin.world);
    expect(firstJoin.worldVersion).toBe(secondJoin.worldVersion);
    const connected = await state(h, first);
    expect(connected.server.online).toBe(2);
    expect(connected.entities.filter(entity => entity.kind === 'player').map(entity => entity.id).sort()).toEqual([first.id!, second.id!].sort());
    const stocked = await headquarters(h, first);
    expect(stocked.state.money).toBe(initialMoney);
    expect(stocked.state.supplies.ammo + firstJoin.self.ammo).toBe(initialStock.ammo);
    expect(stocked.state.supplies.medicine + firstJoin.self.medicine.medkit / 40).toBe(initialStock.medicine);
    expect(stocked.state.raids).toHaveLength(0);
    expect((await request(h, 'live', 'state', first, undefined, { 'x-prapor-live': second.id! })).status).toBe(401);

    const a = { x: 4, y: 4 }, b = { x: 7, y: 4 }, goal = { x: 5, y: 4 };
    expect(hasLiveLineOfSight(map, a, b)).toBe(true);
    place(h, [{ guest: first, point: a }, { guest: second, point: b }]);
    await enter(h, first); await enter(h, second);
    const commanded = await act(h, first, { type: 'move', ...goal });
    expect(self(commanded)).toMatchObject(a);
    await h.advance(250, [first, second]);
    const ownMovement = self(await state(h, first));
    const observedMovement = (await state(h, second)).entities.find(entity => entity.id === first.id)!;
    expect(ownMovement).toMatchObject(goal);
    expect(observedMovement).toEqual(ownMovement);
    expect(Math.abs(ownMovement.x - a.x) + Math.abs(ownMovement.y - a.y)).toBe(1);

    const defenderBefore = await state(h, second), ammoBefore = (await state(h, first)).self.ammo;
    const fired = await act(h, first, { type: 'attack', targetId: second.id! });
    const defenderAfter = await state(h, second);
    expect(fired.self.ammo).toBe(ammoBefore - 1);
    expect(self(defenderAfter).health).toBeLessThan(self(defenderBefore).health);
    expect(fired.entities.find(entity => entity.id === second.id)).toEqual(self(defenderAfter));
    expect(defenderAfter.events.some(event => event.actorId === first.id && event.targetId === second.id && (event.damage ?? 0) > 0)).toBe(true);
  });

  test('nearby bodies behind actual walls and distant players stay private, and forged attacks cannot cross the cover', async () => {
    const h = await setup(), first = await guest(h), second = await guest(h), distant = await guest(h);
    await enter(h, first); await enter(h, second); await enter(h, distant, 'village');
    const [a, b] = behindCover(), far = map.districts.find(district => district.id === 'village')!.spawns[0]!;
    expect(Math.hypot(a.x - far.x, a.y - far.y)).toBeGreaterThan(24);
    place(h, [{ guest: first, point: a }, { guest: second, point: b }, { guest: distant, point: far }]);
    await enter(h, first); await enter(h, second); await enter(h, distant, 'village');
    const before = await state(h, first), otherBefore = await state(h, second);
    expect(before.server.online).toBe(3);
    expect(before.entities.some(entity => entity.id === second.id || entity.id === distant.id)).toBe(false);
    expect(otherBefore.entities.some(entity => entity.id === first.id)).toBe(false);
    expect(before.events.some(event => event.actorId === second.id || event.actorId === distant.id)).toBe(false);
    const attack = await request(h, 'live', 'action', first, { type: 'attack', targetId: second.id! });
    expect(attack.status).toBe(409);
    expect(await attack.json()).toMatchObject({ code: 'target_out_of_range' });
    expect((await state(h, first)).self.ammo).toBe(before.self.ammo);
    expect((await state(h, second)).self.body).toEqual(otherBefore.self.body);
  });

  test('a real shared container requires each guest to search privately and its physical items can be taken only once', async () => {
    const h = await setup(), first = await guest(h), second = await guest(h);
    await enter(h, first, 'customs', 'loot'); await enter(h, second, 'customs', 'loot');
    const anchor = map.containers.find(anchor => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
      isLiveWalkable(map, { x: anchor.x + dx!, y: anchor.y + dy! }) && hasLiveLineOfSight(map, anchor, { x: anchor.x + dx!, y: anchor.y + dy! })))!;
    expect(anchor).toBeDefined();
    const neighbour = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: anchor.x + dx!, y: anchor.y + dy! }))
      .find(point => isLiveWalkable(map, point) && hasLiveLineOfSight(map, anchor, point))!;
    place(h, [{ guest: first, point: anchor }, { guest: second, point: neighbour }]);
    const firstState = await enter(h, first, 'customs', 'loot'); await enter(h, second, 'customs', 'loot');
    const unopened = firstState.drops.find(drop => drop.containerId === anchor.id)!;
    expect(unopened).toMatchObject({ searched: false, amount: 0 });
    expect(unopened.items).toBeUndefined();
    expect((await request(h, 'live', 'action', first, { type: 'loot', id: unopened.id })).status).toBe(409);
    await act(h, first, { type: 'search', id: unopened.id });
    await h.advance(anchor.searchMs, [first, second]);
    const discovered = (await state(h, first)).drops.find(drop => drop.id === unopened.id)!;
    expect(discovered.searched).toBe(true);
    expect(discovered.items?.length).toBeGreaterThan(0);
    const privateToFirst = (await state(h, second)).drops.find(drop => drop.id === unopened.id)!;
    expect(privateToFirst.searched).toBe(false);
    expect(privateToFirst.items).toBeUndefined();
    await act(h, second, { type: 'search', id: unopened.id });
    await h.advance(anchor.searchMs, [first, second]);
    expect((await state(h, second)).drops.find(drop => drop.id === unopened.id)?.items).toEqual(discovered.items);
    const bankBefore = [await headquarters(h, first), await headquarters(h, second)], receiptsBefore = receipts(h);
    const competitors = await Promise.all([
      request(h, 'live', 'action', first, { type: 'loot', id: unopened.id }),
      request(h, 'live', 'action', second, { type: 'loot', id: unopened.id }),
    ]);
    expect(competitors.map(response => response.status).sort()).toEqual([200, 409]);
    const carrying = [await state(h, first), await state(h, second)];
    const items = carrying.flatMap(snapshot => snapshot.self.lootItems ?? []);
    expect(items).toEqual(discovered.items!);
    expect(new Set(items.map(item => item.id)).size).toBe(items.length);
    expect(carrying.reduce((amount, snapshot) => amount + snapshot.self.cargo, 0)).toBe(discovered.amount);
    for (const snapshot of carrying) expect(snapshot.drops.some(drop => drop.id === unopened.id)).toBe(false);
    expect((await request(h, 'live', 'action', first, { type: 'loot', id: unopened.id })).status).toBe(409);
    expect(receipts(h)).toEqual(receiptsBefore);
    expect(await headquarters(h, first)).toEqual(bankBefore[0]!);
    expect(await headquarters(h, second)).toEqual(bankBefore[1]!);
  });

  test.each(['scav', 'assault'] as const)('%s autopatrol respects the issued weapon range and never stops the shared server when an NPC is just beyond it', async kitId => {
    const h = await setup(), player = await guest(h), issued = await enter(h, player, 'customs', 'pve', kitId);
    const range = issued.self.loadout!.range, point = { x: 0, y: 0 }, target = { x: range + 1, y: 0 };
    expect(range).toBeLessThan(7);
    expect(hasLiveLineOfSight(map, point, target)).toBe(true);
    place(h, [{ guest: player, point }]);
    h.restart(db => {
      const row = db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!;
      const world = JSON.parse(row.state) as StoredWorld;
      Object.assign(world.scavs[0]!, target, { home: target, route: [target], role: 'guard', body: createHealth(), health: 100,
        respawnAt: 0, nextAttack: h.time + 1_000_000, nextMove: h.time + 1_000_000 });
      db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(world));
    });
    const ready = await enter(h, player, 'customs', 'pve');
    const ammunition = ready.self.ammo;
    expect(await act(h, player, { type: 'patrol', enabled: true })).toMatchObject({ self: { patrol: true } });
    h.time += 250; h.live.tick();
    expect(h.live.healthy()).toBe(true);
    const patrolling = await state(h, player);
    expect(patrolling.self.patrol).toBe(true);
    expect(patrolling.self.ammo).toBe(ammunition);
    expect(isLiveWalkable(map, self(patrolling))).toBe(true);
    expect(patrolling.entities.filter(entity => entity.kind === 'scav' && entity.health > 0)).toHaveLength(1);
  });

  test('leaving, choosing another district and restarting both services resumes the same wounded body without a fresh kit or bank credit', async () => {
    const h = await setup(), player = await guest(h);
    await enter(h, player, 'customs', 'loot');
    const body = createHealth(71); body.parts.leftLeg.fracture = true;
    const medicine = createMedicalInventory({ medkit: 27, bandage: 0, tourniquet: 0, splint: 1, painkiller: 0, surgery: 0 });
    const items: EconomyLoot[] = [{ id: randomUUID(), modelId: 'old-watch', foundAt: NOW - 1000 }];
    const point = { x: 13, y: 5 };
    place(h, [{ guest: player, point, fields: { body, medicine, ammo: 7, cargo: 43, lootItems: items, stash: 19, health: 71 } }]);
    const before = await enter(h, player, 'customs', 'loot');
    expect(self(before)).toMatchObject(point);
    const bank = await headquarters(h, player), paid = receipts(h);
    const preserved = { body: before.self.body, medicine: before.self.medicine, ammo: before.self.ammo, cargo: before.self.cargo, stash: before.self.stash, lootItems: before.self.lootItems, loadout: before.self.loadout };
    for (let attempt = 0; attempt < 3; attempt++) {
      const leave = await request(h, 'live', 'leave', player, {});
      expect(leave.status).toBe(200);
      expect(await leave.json()).toEqual({ ok: true });
      expect((await request(h, 'live', 'state', player)).status).toBe(401);
      if (attempt) {
        h.live.close(); h.game.close();
        h.game = createGameService({ dbPath: h.gamePath, secureCookies: false, allowedOrigins: [ORIGIN], now: () => h.time });
        h.live = createLiveService({ dbPath: h.livePath, secureCookies: false, allowedOrigins: [ORIGIN], economy: h.game.liveEconomy, now: () => h.time, random: () => .5, automaticTicks: false });
      }
      const resumed = await enter(h, player, 'village', 'loot');
      expect(resumed.selfId).toBe(before.selfId);
      expect(resumed.worldVersion).toBe(before.worldVersion);
      expect(self(resumed)).toMatchObject({ ...point, health: self(before).health });
      expect(resumed.self).toMatchObject(preserved);
      expect(resumed.self.districtId).toBe(before.self.districtId);
      expect(await headquarters(h, player)).toEqual(bank);
      expect(receipts(h)).toEqual(paid);
    }
  });
});
