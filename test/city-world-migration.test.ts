import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveService, type LiveService } from '../server/live';
import { LiveEconomyError, type EconomyLoot, type LiveDelivery, type LiveEconomy } from '../server/live-economy';
import { getLiveMap, isLiveWalkable } from '../src/game/live-maps';
import { createHealth, createMedicalInventory, type HealthState } from '../src/game/health';
import type { LivePoint, LiveSnapshot } from '../src/game/live';
import { LIVE_WORLD_OFFSET, LIVE_GENERATOR_VERSION } from '../src/game/world-generation';

const ORIGIN = 'https://game.delopusk.ru';
const G4_ANCHOR = /^poi-(?:[0-9]|10|11)-[0-3]-[a-z]+-\d+$/;
const G4_CITY_ANCHOR = /^poi-(?:8|9|10|11)-[0-3]-/;
interface Session { owner: string; gameId: string; id?: string }
interface StoredDrop extends LivePoint {
  id: string; mapId: string; source: 'supply' | 'body'; amount: number; items?: EconomyLoot[];
  expiresAt: number; containerId?: string; containerKind?: string; bossId?: string;
}
interface StoredWorld { version: number; geometryVersion: string; drops: StoredDrop[]; lootCooldowns: Array<[string, number]>; scavs: Record<string, unknown>[]; events: unknown[] }
let directory: string, dbPath: string, service: LiveService, time: number, blocked: boolean, interrupted: boolean;
let profiles: Map<string, Session>, deliveries: Map<string, LiveDelivery>;
const map = getLiveMap('perimeter');
const previousPoint = (point: LivePoint): LivePoint => ({ x: point.x - LIVE_WORLD_OFFSET, y: point.y - LIVE_WORLD_OFFSET });
const economy: LiveEconomy = {
  resolve(request) {
    const session = profiles.get(request.headers.get('x-prapor-game') ?? '');
    if (!session || request.headers.get('cookie') !== `hq=${session.owner}`) throw new LiveEconomyError(401, 'game_identity_changed');
    return { key: session.owner, gameId: session.gameId, name: 'Проверенный боец' };
  },
  deliver(parcel) {
    if (blocked) return { ok: false, message: 'Нет места в убежище' };
    const previous = deliveries.get(parcel.id);
    if (previous) expect(parcel).toEqual(previous);
    else deliveries.set(parcel.id, structuredClone(parcel));
    if (interrupted) { interrupted = false; throw new Error('Interrupted after durable headquarters receipt'); }
    return { ok: true, message: 'Доставлено' };
  },
  supply: () => ({ ammo: 0, medkits: 0, message: 'Нет запасов' }),
};
const options = () => ({ dbPath, now: () => time, random: () => 0, automaticTicks: false, secureCookies: true, allowedOrigins: [ORIGIN], economy });
function profile(): Session {
  const session = { owner: `guest:${randomUUID()}`, gameId: randomUUID() };
  profiles.set(session.gameId, session); return session;
}
function item(modelId = 'coffee'): EconomyLoot { return { id: randomUUID(), modelId, foundAt: time - 4321 }; }
async function call(session: Session, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const response = await service.fetch(new Request(`${ORIGIN}/api/live/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: {
      cookie: `hq=${session.owner}`, 'x-prapor-game': session.gameId,
      ...(session.id ? { 'x-prapor-live': session.id } : {}),
      ...(body === undefined ? {} : { origin: ORIGIN, 'content-type': 'application/json' }), ...headers,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), '192.0.2.67');
  if (!response) throw new Error('Missing live API response'); return response;
}
async function enter(session = profile()): Promise<{ session: Session; snapshot: LiveSnapshot }> {
  const response = await call(session, 'join', {}); expect(response.status).toBe(200);
  const snapshot = await response.json() as LiveSnapshot; session.id = snapshot.selfId;
  return { session, snapshot };
}
function read<T>(reader: (db: Database) => T): T {
  const db = new Database(dbPath, { readonly: true }); try { return reader(db); } finally { db.close(); }
}
const world = (): StoredWorld => read(db => JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state));
const player = (session: Session): Record<string, unknown> => read(db => JSON.parse(db.query<{ state: string }, [string]>('SELECT state FROM live_players WHERE identity=?').get(session.owner)!.state));
function restart(edit?: (db: Database) => void): void {
  service.close();
  if (edit) { const db = new Database(dbPath); try { edit(db); } finally { db.close(); } }
  service = createLiveService(options());
}
function updatePlayer(db: Database, session: Session, fields: Record<string, unknown>): void {
  const value = JSON.parse(db.query<{ state: string }, [string]>('SELECT state FROM live_players WHERE identity=?').get(session.owner)!.state);
  Object.assign(value, fields); db.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(value), session.owner);
}
function quietActors(saved: StoredWorld): void {
  const dead = createHealth(); dead.parts.head.hp = 0;
  for (const scav of saved.scavs) Object.assign(scav, { health: 0, body: dead, respawnAt: time + 1_000_000 });
}
function stableBody(): HealthState {
  const body = createHealth(73); body.parts.leftLeg.fracture = true;
  body.parts.rightArm.maxHp = 48; body.parts.rightArm.hp = 35; return body;
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'prapor-city-migration-')); dbPath = join(directory, 'live.sqlite');
  time = 1_800_000_000_000; blocked = false; interrupted = false; profiles = new Map(); deliveries = new Map();
  service = createLiveService(options());
});
afterEach(async () => { service.close(); await rm(directory, { recursive: true, force: true }); });

describe('verified G5 courtyard progress in expanded city architecture', () => {
  test('all 72 courtyard slots retain cycles, depleted timers and private discoveries while a wounded fighter moves out of a new wall', async () => {
    // Public search positions recorded from the shipped perimeter-g5-5dfb7f6f.
    // IDs are the durable contract; these old coordinates really move in G6.
    const oldPositions = [
      [81, 67], [98, 67], [90, 67], [81, 111], [98, 110], [90, 112], [67, 81], [68, 81], [68, 90], [67, 98], [68, 98], [68, 92], [112, 81], [112, 98], [113, 90], [81, 81], [98, 81], [90, 89],
      [152, 67], [171, 67], [162, 67], [152, 111], [171, 110], [162, 112], [138, 81], [139, 81], [139, 90], [138, 98], [139, 98], [139, 92], [186, 81], [186, 98], [187, 90], [152, 81], [171, 81], [162, 89],
      [81, 138], [96, 138], [90, 138], [81, 188], [96, 188], [90, 188], [67, 152], [68, 152], [68, 162], [67, 173], [68, 173], [68, 164], [108, 152], [108, 173], [111, 162], [81, 152], [96, 152], [90, 163],
      [171, 138], [172, 138], [162, 138], [171, 188], [172, 188], [162, 188], [138, 152], [139, 152], [142, 162], [138, 173], [139, 173], [142, 164], [186, 152], [186, 173], [187, 162], [171, 152], [171, 173], [162, 163],
    ] as const;
    const ids = ['old-center', 'industrial', 'station', 'residential'].flatMap(quarter => Array.from({ length: 6 }, (_, site) => Array.from({ length: 3 }, (_, slot) => `city-${quarter}-${site}-slot-${slot}`)).flat());
    const anchors = ids.map(id => map.containers.find(anchor => anchor.id === id)!);
    expect(map.generatorVersion).toBe(LIVE_GENERATOR_VERSION); expect(anchors).toHaveLength(72); expect(anchors.every(Boolean)).toBe(true);
    expect(map.containers.filter(anchor => anchor.id.startsWith('city-')).map(anchor => anchor.id).sort()).toEqual(ids.slice().sort());
    expect(anchors.filter((anchor, index) => anchor.x !== oldPositions[index]![0] || anchor.y !== oldPositions[index]![1]).length).toBeGreaterThanOrEqual(40);
    const oldPoint = { x: 81, y: 65 }; // Walkable inside the first G5 workshop, now a G6 exterior wall.
    const translatedPoint = { x: oldPoint.x + LIVE_WORLD_OFFSET, y: oldPoint.y + LIVE_WORLD_OFFSET };
    expect(map.obstacles.some(obstacle => obstacle.kind === 'wall' && translatedPoint.x >= obstacle.x && translatedPoint.y >= obstacle.y && translatedPoint.x < obstacle.x + obstacle.width && translatedPoint.y < obstacle.y + obstacle.height)).toBe(true);
    expect(isLiveWalkable(map, translatedPoint)).toBe(false);
    const first = await enter(), observer = await enter(), body = stableBody(), inBag = item('old-watch');
    const medicine = createMedicalInventory({ medkit: 19, bandage: 1, tourniquet: 0, splint: 1, painkiller: 0, surgery: 0 });
    const depleted = [anchors[1]!, anchors[22]!, anchors[71]!], deadlines = depleted.map((anchor, index) => [`container:${anchor.id}`, time + 30_000 + index * 6000] as [string, number]);
    let cycles: StoredDrop[] = [], landmarkCycles: StoredDrop[] = [], searched: string[] = [];
    restart(db => {
      const saved = world(); saved.geometryVersion = 'perimeter-g5-5dfb7f6f'; saved.scavs = []; saved.events = [];
      for (const [index, anchor] of anchors.entries()) {
        const drop = saved.drops.find(drop => drop.containerId === anchor.id)!;
        Object.assign(drop, { x: oldPositions[index]![0], y: oldPositions[index]![1], amount: 4 + index % 19, items: [item(index % 2 ? 'gold-ring' : 'coffee')], expiresAt: time + 100_000 + index * 123 });
      }
      saved.drops = saved.drops.filter(drop => !drop.containerId?.startsWith('fringe-') && !depleted.some(anchor => drop.containerId === anchor.id));
      cycles = structuredClone(saved.drops.filter(drop => ids.includes(drop.containerId ?? '')));
      landmarkCycles = structuredClone(saved.drops.filter(drop => G4_ANCHOR.test(drop.containerId ?? '')));
      searched = cycles.filter(drop => drop.containerId!.endsWith('-slot-0')).map(drop => drop.id);
      saved.lootCooldowns = deadlines;
      db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(saved));
      updatePlayer(db, first.session, { ...oldPoint, body, medicine, healthAt: time, ammo: 11, cargo: 17, stash: 3, kills: 2, lootItems: [inBag], safeUntil: time + 120_000, searchedDropIds: searched,
        treatment: { type: 'splint', part: 'leftLeg', startedAt: time - 1000, endsAt: time + 3000 } });
      updatePlayer(db, observer.session, { ...previousPoint(anchors[0]!), safeUntil: time + 120_000, searchedDropIds: [] });
    });
    expect(cycles).toHaveLength(69); expect(landmarkCycles).toHaveLength(192); expect(searched).toHaveLength(24);
    const known = cycles.find(drop => drop.containerId === anchors[0]!.id)!;
    const unknown = cycles.find(drop => drop.containerId === anchors[2]!.id)!;
    let migratedPosition: LivePoint | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const saved = world(); expect(saved.geometryVersion).toBe(map.version);
      for (const cycle of cycles) {
        const anchor = map.containers.find(anchor => anchor.id === cycle.containerId)!;
        expect(saved.drops.filter(drop => drop.containerId === anchor.id)).toEqual([{ ...cycle, x: anchor.x, y: anchor.y, containerKind: anchor.kind }]);
      }
      for (const cycle of landmarkCycles) expect(saved.drops.find(drop => drop.id === cycle.id)).toEqual(cycle);
      for (const [index, anchor] of depleted.entries()) {
        expect(saved.drops.some(drop => drop.containerId === anchor.id)).toBe(false); expect(saved.lootCooldowns).toContainEqual(deadlines[index]!);
      }
      expect(new Set(saved.drops.map(drop => drop.id)).size).toBe(saved.drops.length);
      const restored = (await enter(first.session)).snapshot, foreign = (await enter(observer.session)).snapshot;
      expect(restored.self).toMatchObject({ id: first.session.id, gameId: first.session.gameId, body, medicine, ammo: 11, cargo: 17, stash: 3, kills: 2, lootItems: [inBag], treatment: null });
      expect(player(first.session).searchedDropIds).toEqual(searched);
      const position = restored.entities.find(entity => entity.id === first.session.id)!;
      expect(isLiveWalkable(map, position)).toBe(true);
      expect(Math.max(Math.abs(position.x - translatedPoint.x), Math.abs(position.y - translatedPoint.y))).toBeLessThanOrEqual(16);
      if (migratedPosition) expect({ x: position.x, y: position.y }).toEqual(migratedPosition); else migratedPosition = { x: position.x, y: position.y };
      expect(restored.drops.find(drop => drop.id === known.id)).toMatchObject({ searched: true, amount: known.amount, items: known.items });
      expect(foreign.drops.find(drop => drop.id === known.id)).toMatchObject({ searched: false, amount: 0 });
      expect(JSON.stringify(foreign).includes(known.items![0]!.id)).toBe(false);
      expect(JSON.stringify(restored).includes(unknown.items![0]!.id)).toBe(false);
      expect(deliveries.size).toBe(0);
      if (attempt < 2) restart();
    }
    // The persisted G5 timer still refills only its own slot once, with a fresh
    // private discovery state; the later timers stay depleted.
    restart(db => { const saved = world(); quietActors(saved); db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(saved)); });
    time = deadlines[0]![1] - 1; await enter(first.session); service.tick();
    expect(world().drops.some(drop => drop.containerId === depleted[0]!.id)).toBe(false);
    time = deadlines[0]![1] + 249; await enter(first.session); service.tick();
    const refill = world().drops.filter(drop => drop.containerId === depleted[0]!.id); expect(refill).toHaveLength(1); expect(refill[0]!.items?.length).toBeGreaterThan(0);
    for (const anchor of depleted.slice(1)) expect(world().drops.some(drop => drop.containerId === anchor.id)).toBe(false);
    expect(player(first.session).searchedDropIds).not.toContain(refill[0]!.id);
    restart(db => updatePlayer(db, first.session, { x: depleted[0]!.x, y: depleted[0]!.y, healthAt: time }));
    const hidden = (await enter(first.session)).snapshot.drops.find(drop => drop.id === refill[0]!.id)!;
    expect(hidden).toMatchObject({ searched: false, amount: 0 }); expect(hidden.items).toBeUndefined();
    expect((await call(first.session, 'action', { type: 'loot', id: hidden.id })).status).toBe(409);
    restart(); expect(world().drops.filter(drop => drop.containerId === depleted[0]!.id)).toEqual(refill);
  });
});

describe('verified V4 progress in a denser city revision', () => {
  test('all 192 previous anchor cycles and private discoveries survive relocation and two restarts without rerolling or replaying delivery', async () => {
    const first = await enter(), observer = await enter();
    const oldAnchors = map.containers.filter(anchor => G4_ANCHOR.test(anchor.id));
    expect(oldAnchors).toHaveLength(192);
    const cityAnchors = oldAnchors.filter(anchor => G4_CITY_ANCHOR.test(anchor.id)); expect(cityAnchors).toHaveLength(64);
    const searched = cityAnchors[0]!, untouched = cityAnchors[1]!, spent = cityAnchors.slice(2, 4), deadline = time + 30_000;
    const inBag = item(), pendingItem = item('local-map'), knownItem = item('gold-ring'), secretItem = item('old-watch');
    const body = stableBody(), medicine = createMedicalInventory({ medkit: 27, bandage: 1, tourniquet: 0, splint: 1, painkiller: 0, surgery: 0 });
    const parcel: LiveDelivery = { id: randomUUID(), owner: first.session.owner, gameId: first.session.gameId, createdAt: time - 5000, items: [pendingItem], money: 11 };
    let cycles: StoredDrop[] = [], knownId = '';
    blocked = true;
    restart(db => {
      const saved: StoredWorld = JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state);
      saved.geometryVersion = 'perimeter-g4-a5e081b6'; saved.events = []; saved.scavs = [];
      saved.drops = saved.drops.filter(drop => drop.containerId && G4_ANCHOR.test(drop.containerId) && !spent.some(anchor => anchor.id === drop.containerId));
      for (const drop of saved.drops) {
        if (G4_CITY_ANCHOR.test(drop.containerId!)) Object.assign(drop, { x: 117, y: 115 });
        if (drop.containerId === searched.id) { drop.items = [knownItem]; drop.amount = 13; knownId = drop.id; drop.expiresAt = time + 123_456; }
        if (drop.containerId === untouched.id) { drop.items = [secretItem]; drop.amount = 0; }
      }
      cycles = structuredClone(saved.drops);
      saved.lootCooldowns = spent.flatMap(anchor => [[`container:${anchor.id}`, time + 1000], [`container:${anchor.id.replace(/-[a-z]+-(\d+)$/, '-retired-$1')}`, deadline]] as Array<[string, number]>);
      db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(saved));
      updatePlayer(db, first.session, { ...previousPoint(searched), ammo: 17, cargo: 19, stash: 7, kills: 4,
        body, medicine, healthAt: time, safeUntil: time + 120_000, lootItems: [inBag], searchedDropIds: [knownId] });
      updatePlayer(db, observer.session, { ...previousPoint(searched), safeUntil: time + 120_000, searchedDropIds: [] });
      db.query("INSERT INTO live_economy_outbox(id,identity,kind,payload,message) VALUES(?,?,'delivery',?,'Ожидает места')").run(parcel.id, first.session.owner, JSON.stringify(parcel));
    });
    expect(cycles).toHaveLength(190);
    const verifyCycles = (): void => {
      const saved = world(); expect(saved.geometryVersion).toBe(map.version);
      for (const cycle of cycles) {
        const anchor = map.containers.find(anchor => anchor.id === cycle.containerId)!;
        expect(saved.drops.filter(drop => drop.containerId === anchor.id)).toHaveLength(1);
        expect(saved.drops.find(drop => drop.id === cycle.id)).toEqual({ ...cycle, x: anchor.x, y: anchor.y });
      }
      for (const anchor of spent) {
        expect(saved.drops.some(drop => drop.containerId === anchor.id)).toBe(false);
        expect(saved.lootCooldowns).toContainEqual([`container:${anchor.id}`, deadline]);
      }
      for (const anchor of map.containers.filter(anchor => !G4_ANCHOR.test(anchor.id))) expect(saved.drops.filter(drop => drop.containerId === anchor.id)).toHaveLength(1);
      const dropIds = saved.drops.map(drop => drop.id), itemIds = saved.drops.flatMap(drop => drop.items?.map(item => item.id) ?? []);
      expect(new Set(dropIds).size).toBe(dropIds.length); expect(new Set(itemIds).size).toBe(itemIds.length);
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      verifyCycles(); const restored = (await enter(first.session)).snapshot; await enter(observer.session);
      expect(restored.self).toMatchObject({ id: first.session.id, gameId: first.session.gameId, ammo: 17, cargo: 19, stash: 7, kills: 4, body, medicine, lootItems: [inBag] });
      expect(restored.drops.find(drop => drop.id === knownId)).toMatchObject({ searched: true, amount: 13, items: [knownItem] });
      const foreignResponse = await call(observer.session, 'state'); expect(foreignResponse.status).toBe(200);
      const foreign = await foreignResponse.json() as LiveSnapshot;
      expect(foreign.drops.find(drop => drop.id === knownId)).toMatchObject({ searched: false, amount: 0 });
      expect(JSON.stringify(foreign).includes(knownItem.id)).toBe(false); expect(JSON.stringify(restored).includes(secretItem.id)).toBe(false);
      expect((await call(first.session, 'state', undefined, { 'x-prapor-game': observer.session.gameId })).status).toBe(401);
      expect(deliveries.size).toBe(0); restart();
    }
    blocked = false; interrupted = true; restart();
    expect(deliveries.get(parcel.id)).toEqual(parcel);
    restart(); await enter(first.session);
    expect(deliveries.size).toBe(1);
    expect(read(db => db.query<{ acknowledged: number }, [string]>('SELECT acknowledged FROM live_economy_outbox WHERE id=?').get(parcel.id)!.acknowledged)).toBe(1);
    const before = world().drops; restart(); expect(world().drops).toEqual(before);
    expect(player(first.session).lootItems).toEqual([inBag]);
  });

  test('spent relocated city containers keep the later deadline and create exactly one undiscovered refill', async () => {
    const first = await enter(), anchor = map.containers.find(value => G4_CITY_ANCHOR.test(value.id))!, deadline = time + 30_000;
    restart(db => {
      const saved: StoredWorld = JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state);
      saved.geometryVersion = 'perimeter-g4-a5e081b6'; saved.events = []; saved.scavs = [];
      saved.drops = saved.drops.filter(drop => drop.containerId && G4_ANCHOR.test(drop.containerId) && drop.containerId !== anchor.id);
      saved.lootCooldowns = [[`container:${anchor.id}`, time + 1000], [`container:${anchor.id.replace(/-[a-z]+-(\d+)$/, '-retired-$1')}`, deadline]];
      db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(saved));
      updatePlayer(db, first.session, { ...previousPoint(anchor), safeUntil: time + 120_000, searchedDropIds: [] });
    });
    // After regeneration, isolate this timer from unrelated NPC fights while preserving its real contents.
    restart(db => { const saved = world(); quietActors(saved); db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(saved)); });
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(world().lootCooldowns).toContainEqual([`container:${anchor.id}`, deadline]);
      expect(world().drops.some(drop => drop.containerId === anchor.id)).toBe(false); restart();
    }
    time = deadline - 1; await enter(first.session); service.tick();
    expect(world().drops.some(drop => drop.containerId === anchor.id)).toBe(false);
    time = deadline + 249; await enter(first.session); service.tick();
    const refill = world().drops.filter(drop => drop.containerId === anchor.id); expect(refill).toHaveLength(1);
    expect(refill[0]!.items?.length).toBeGreaterThan(0);
    const snapshot = (await enter(first.session)).snapshot, hidden = snapshot.drops.find(drop => drop.id === refill[0]!.id)!;
    expect(hidden).toMatchObject({ amount: 0, searched: false }); expect(hidden.items).toBeUndefined();
    expect((await call(first.session, 'action', { type: 'loot', id: hidden.id })).status).toBe(409);
    restart(); expect(world().drops.filter(drop => drop.containerId === anchor.id)).toEqual(refill);
  });

  test('new collision repositions a wounded body and loose cargo nearby while preserving medicine, identity and boss cycles', async () => {
    const first = await enter(), second = await enter();
    const wall = map.obstacles.find(value => value.kind === 'wall' && value.x > 56 && value.y > 56 && value.x < 200 && value.y < 200)!;
    expect(wall).toBeDefined(); const blockedPoint = { x: wall.x, y: wall.y }, body = stableBody();
    const medicine = createMedicalInventory({ medkit: 13, bandage: 0, tourniquet: 0, splint: 1, painkiller: 0, surgery: 0 });
    const inBag = item('gold-ring'), corpseItem = item('old-watch'), retiredItem = item('coffee');
    const dead = createHealth(); dead.parts.head.hp = 0; const bossDeadline = time + 90_000;
    restart(db => {
      const saved: StoredWorld = JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state);
      saved.geometryVersion = 'perimeter-g4-a5e081b6'; saved.scavs = []; saved.events = [];
      saved.drops.push(
        { id: 'g4-city-corpse', source: 'body', mapId: 'perimeter', ...previousPoint(blockedPoint), amount: 23, items: [corpseItem], expiresAt: time + 123_456 },
        { id: 'g4-retired-supply', source: 'supply', mapId: 'perimeter', ...previousPoint(blockedPoint), amount: 17, items: [retiredItem], containerId: 'retired-city-crate-0', containerKind: 'crate', expiresAt: time + 98_765 },
      );
      db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(saved));
      updatePlayer(db, first.session, { ...previousPoint(blockedPoint), body, medicine, healthAt: time, ammo: 17, cargo: 25, stash: 7, kills: 4, lootItems: [inBag], safeUntil: time + 120_000,
        treatment: { type: 'splint', part: 'leftLeg', startedAt: time - 1000, endsAt: time + 3000 } });
      updatePlayer(db, second.session, { ...previousPoint(blockedPoint), safeUntil: time + 120_000 });
      for (const row of db.query<{ boss_id: string; state: string }, []>('SELECT boss_id,state FROM live_bosses').all()) {
        const boss = JSON.parse(row.state);
        if (row.boss_id === 'lesnik') Object.assign(boss, { body: stableBody(), healthAt: time, bossCycle: 7, bossDeathSettled: false, respawnAt: 0 });
        if (row.boss_id === 'komendant') Object.assign(boss, { body: dead, health: 0, healthAt: time, bossCycle: 9, bossDeathSettled: true, respawnAt: bossDeadline });
        db.query('UPDATE live_bosses SET state=? WHERE boss_id=?').run(JSON.stringify(boss), row.boss_id);
      }
    });
    let firstPosition: LivePoint | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const restored = (await enter(first.session)).snapshot, other = (await enter(second.session)).snapshot;
      expect(restored.self).toMatchObject({ id: first.session.id, gameId: first.session.gameId, body, medicine, ammo: 17, cargo: 25, stash: 7, kills: 4, lootItems: [inBag], treatment: null });
      const a = restored.entities.find(entity => entity.id === first.session.id)!, b = other.entities.find(entity => entity.id === second.session.id)!;
      expect(isLiveWalkable(map, a)).toBe(true); expect(isLiveWalkable(map, b)).toBe(true);
      expect(Math.max(Math.abs(a.x - blockedPoint.x), Math.abs(a.y - blockedPoint.y))).toBeLessThanOrEqual(16);
      expect(`${a.x},${a.y}`).not.toBe(`${b.x},${b.y}`);
      if (firstPosition) expect({ x: a.x, y: a.y }).toEqual(firstPosition); else firstPosition = { x: a.x, y: a.y };
      const saved = world();
      for (const [id, items, amount, expiresAt] of [['g4-city-corpse', [corpseItem], 23, time + 123_456], ['g4-retired-supply', [retiredItem], 17, time + 98_765]] as const) {
        const drop = saved.drops.find(value => value.id === id)!;
        expect(drop).toMatchObject({ source: 'body', items, amount, expiresAt }); expect(drop.containerId).toBeUndefined();
        expect(isLiveWalkable(map, drop)).toBe(true);
        expect(Math.max(Math.abs(drop.x - blockedPoint.x), Math.abs(drop.y - blockedPoint.y))).toBeLessThanOrEqual(16);
      }
      const bosses = read(db => db.query<{ boss_id: string; state: string }, []>('SELECT boss_id,state FROM live_bosses').all().map(row => ({ id: row.boss_id, state: JSON.parse(row.state) })));
      expect(bosses.find(value => value.id === 'lesnik')!.state).toMatchObject({ body: stableBody(), bossCycle: 7, bossDeathSettled: false, respawnAt: 0 });
      expect(bosses.find(value => value.id === 'komendant')!.state).toMatchObject({ body: dead, health: 0, bossCycle: 9, bossDeathSettled: true, respawnAt: bossDeadline });
      restart();
    }
  });

  test('kind-independent courtyard slots retain already searched contents and depleted deadlines after a container type change', async () => {
    const first = await enter(), site = map.citySites![0]!, anchors = map.containers.filter(anchor => anchor.poiId === site.poiId);
    expect(anchors.length).toBeGreaterThanOrEqual(2);
    const known = anchors[0]!, depleted = anchors[1]!, secret = item('gold-ring'), deadline = time + 30_000;
    expect(known.id).toBe(`${site.id}-slot-0`); expect(depleted.id).toBe(`${site.id}-slot-1`);
    let original: StoredDrop | undefined;
    restart(db => {
      const saved: StoredWorld = JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state);
      saved.geometryVersion = 'perimeter-g5-previous-container-kinds'; saved.events = []; saved.scavs = [];
      const drop = saved.drops.find(drop => drop.containerId === known.id)!;
      Object.assign(drop, { containerKind: known.kind === 'crate' ? 'jacket' : 'crate', items: [secret], amount: 13, expiresAt: time + 123_456, x: 117, y: 115 });
      original = structuredClone(drop);
      saved.drops = saved.drops.filter(drop => drop.containerId !== depleted.id); saved.lootCooldowns = [[`container:${depleted.id}`, deadline]];
      db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(saved));
      updatePlayer(db, first.session, { ...previousPoint(known), healthAt: time, safeUntil: time + 120_000, searchedDropIds: [drop.id] });
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(world().drops.filter(drop => drop.containerId === known.id)).toEqual([{ ...original!, x: known.x, y: known.y, containerKind: known.kind }]);
      expect(world().drops.some(drop => drop.containerId === depleted.id)).toBe(false);
      expect(world().lootCooldowns).toContainEqual([`container:${depleted.id}`, deadline]);
      const restored = (await enter(first.session)).snapshot;
      expect(restored.drops.find(drop => drop.id === original!.id)).toMatchObject({ searched: true, amount: 13, containerKind: known.kind, items: [secret] });
      restart();
    }
  });
});
