import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveService, type LiveService } from '../server/live';
import { createLiveNavigation } from '../server/live-navigation';
import { createHealth } from '../src/game/health';
import { getLiveMap } from '../src/game/live-maps';
import type { LiveCityBuilding, LiveCitySite, LivePoint, LiveSnapshot } from '../src/game/live';

const ORIGIN = 'https://game.delopusk.ru', map = getLiveMap('perimeter');
const navigation = createLiveNavigation(map);
const blocked = new Uint8Array(map.width * map.height);
for (const wall of map.obstacles) for (let y = wall.y; y < wall.y + wall.height; y++) for (let x = wall.x; x < wall.x + wall.width; x++) blocked[y * map.width + x] = 1;
const inside = (point: LivePoint, rectangle: LivePoint & { width: number; height: number }): boolean => point.x >= rectangle.x && point.y >= rectangle.y && point.x < rectangle.x + rectangle.width && point.y < rectangle.y + rectangle.height;
const clear = (point: LivePoint): boolean => point.x >= 0 && point.y >= 0 && point.x < map.width && point.y < map.height && !blocked[point.y * map.width + point.x];
/** An independent breadth-first oracle catches A* reuse and dynamic door occupancy errors. */
function walkingDistance(start: LivePoint, end: LivePoint, occupied = new Set<number>()): number | null {
  const startKey = start.y * map.width + start.x, endKey = end.y * map.width + end.x;
  if (!clear(start) || !clear(end) || occupied.has(endKey)) return null;
  const distances = new Int32Array(blocked.length); distances.fill(-1); distances[startKey] = 0;
  const queue = [startKey];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const key = queue[cursor]!, x = key % map.width, y = Math.floor(key / map.width);
    if (key === endKey) return distances[key]!;
    for (const point of [{ x: x - 1, y }, { x: x + 1, y }, { x, y: y - 1 }, { x, y: y + 1 }]) {
      const next = point.y * map.width + point.x;
      if (!clear(point) || occupied.has(next) || distances[next] !== -1) continue;
      distances[next] = distances[key]! + 1; queue.push(next);
    }
  }
  return null;
}
function indoorPoint(building: LiveCityBuilding): LivePoint {
  const candidates: LivePoint[] = [];
  for (let y = building.y + 1; y < building.y + building.height - 1; y++) for (let x = building.x + 1; x < building.x + building.width - 1; x++) if (clear({ x, y })) candidates.push({ x, y });
  expect(candidates.length).toBeGreaterThanOrEqual(6);
  return candidates.sort((a, b) => Math.hypot(a.x - building.x - building.width / 2, a.y - building.y - building.height / 2) - Math.hypot(b.x - building.x - building.width / 2, b.y - building.y - building.height / 2))[0]!;
}
function wallPair(): { site: LiveCitySite; building: LiveCityBuilding; first: LivePoint; second: LivePoint; wall: LivePoint } {
  for (const site of map.citySites ?? []) for (const building of site.buildings) for (const wall of map.obstacles.filter(value => value.kind === 'wall' && inside(value, building))) {
    for (let y = wall.y; y < wall.y + wall.height; y++) for (let x = wall.x; x < wall.x + wall.width; x++) {
      for (const [first, second] of [[{ x: wall.x - 1, y }, { x: wall.x + wall.width, y }], [{ x, y: wall.y - 1 }, { x, y: wall.y + wall.height }]]) {
        if (first && second && clear(first) && clear(second) && Math.hypot(first.x - second.x, first.y - second.y) <= 7 && !navigation.hasLineOfSight(first, second) && inside(first, building) !== inside(second, building)) return { site, building, first, second, wall: { x, y } };
      }
    }
  }
  throw new Error('New city has no actual wall between its accessible building floor and the exterior');
}
interface Session { cookie: string; id: string }
let directory: string, dbPath: string, service: LiveService, time: number;
const options = () => ({ dbPath, now: () => time, random: () => 0, automaticTicks: false, allowedOrigins: [ORIGIN] });
async function call(path: string, body?: unknown, session?: Session): Promise<Response> {
  const response = await service.fetch(new Request(`${ORIGIN}/api/live/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: {
      ...(session ? { cookie: session.cookie, 'x-prapor-live': session.id } : {}),
      ...(body === undefined ? {} : { origin: ORIGIN, 'content-type': 'application/json' }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), '192.0.2.93');
  if (!response) throw new Error('Missing live response'); return response;
}
async function enter(session?: Session): Promise<{ session: Session; snapshot: LiveSnapshot }> {
  const response = await call('join', {}, session); expect(response.status).toBe(200);
  const snapshot = await response.json() as LiveSnapshot;
  return { session: session ?? { cookie: response.headers.get('set-cookie')!.split(';')[0]!, id: snapshot.selfId }, snapshot };
}
function edit(edit: (db: Database) => void): void {
  service.close(); const db = new Database(dbPath); try { edit(db); } finally { db.close(); }
  service = createLiveService(options());
}
function storedWorld(): { scavs: Array<Record<string, unknown>> } {
  const db = new Database(dbPath, { readonly: true });
  try { return JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state); } finally { db.close(); }
}
function isolate(db: Database): void {
  const saved = JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state), dead = createHealth(); dead.parts.head.hp = 0;
  for (const scav of saved.scavs) Object.assign(scav, { health: 0, body: dead, respawnAt: time + 1_000_000 });
  db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(saved));
  for (const boss of db.query<{ boss_id: string; state: string }, []>('SELECT boss_id,state FROM live_bosses').all()) {
    const state = JSON.parse(boss.state); Object.assign(state, { nextMove: time + 1_000_000, nextAttack: time + 1_000_000 });
    db.query('UPDATE live_bosses SET state=? WHERE boss_id=?').run(JSON.stringify(state), boss.boss_id);
  }
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'prapor-city-navigation-')); dbPath = join(directory, 'live.sqlite'); time = 1_800_000_000_000;
  service = createLiveService(options());
});
afterEach(async () => { service.close(); await rm(directory, { recursive: true, force: true }); });

describe('city passages use the actual server collision grid', () => {
  test('every enterable building has a usable interior and remains reachable when an actor occupies one entrance', () => {
    expect(map.citySites).toHaveLength(24);
    let checked = 0;
    for (const site of map.citySites!) {
      const court = { x: site.courtyard.x + Math.floor(site.courtyard.width / 2), y: site.courtyard.y + Math.floor(site.courtyard.height / 2) };
      expect(clear(court)).toBe(true);
      for (const building of site.buildings) {
        expect(building.entrances.length).toBeGreaterThanOrEqual(2);
        const floor = indoorPoint(building);
        for (const door of building.entrances) {
          expect(clear(door)).toBe(true);
          const route = navigation.findPath(court, floor);
          const distance = walkingDistance(court, floor); expect(distance).not.toBeNull();
          expect(route?.length).toBe(distance!);
          const occupied = new Set([door.y * map.width + door.x]);
          const alternate = walkingDistance(court, floor, occupied);
          expect(alternate).not.toBeNull();
          const path = navigation.findPath(court, floor, occupied);
          expect(path?.length).toBe(alternate!);
          expect(path!.every(point => clear(point) && !occupied.has(point.y * map.width + point.x))).toBe(true);
          const reversed = navigation.findPath(floor, court, occupied); expect(reversed?.length).toBe(alternate!);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(48);
  });

  test('a new wall blocks shots and hidden locks, while a real doorway admits paced movement without teleporting', async () => {
    const first = await enter(), second = await enter(), pair = wallPair();
    edit(db => {
      isolate(db);
      for (const row of db.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').all()) {
        const player = JSON.parse(row.state), position = player.id === first.session.id ? pair.first : pair.second;
        Object.assign(player, position, { safeUntil: 0, ammo: 17, body: createHealth(), health: 100, healthAt: time });
        db.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(player), row.identity);
      }
    });
    const before = (await enter(first.session)).snapshot; await enter(second.session);
    expect(before.entities.some(entity => entity.id === second.session.id)).toBe(false);
    const denied = await call('action', { type: 'attack', targetId: second.session.id }, first.session);
    expect(denied.status).toBe(409); expect(await denied.json()).toEqual({ code: 'target_out_of_range' });
    expect((await call('action', { type: 'engage', targetId: second.session.id }, first.session)).status).toBe(409);
    const badMove = await call('action', { type: 'move', ...pair.wall }, first.session); expect(badMove.status).toBe(400);
    let destination = indoorPoint(pair.building);
    if (!navigation.hasLineOfSight(destination, pair.second) || destination.x === pair.second.x && destination.y === pair.second.y) {
      const candidates: LivePoint[] = [];
      for (let y = pair.building.y + 1; y < pair.building.y + pair.building.height - 1; y++) for (let x = pair.building.x + 1; x < pair.building.x + pair.building.width - 1; x++) {
        const point = { x, y };
        if (clear(point) && (x !== pair.second.x || y !== pair.second.y) && Math.hypot(x - pair.second.x, y - pair.second.y) <= 7 && navigation.hasLineOfSight(point, pair.second)) candidates.push(point);
      }
      expect(candidates.length).toBeGreaterThan(0); destination = candidates[0]!;
    }
    const order = await call('action', { type: 'move', ...destination }, first.session); expect(order.status).toBe(200);
    const commanded = await order.json() as LiveSnapshot;
    expect(commanded.entities.find(entity => entity.id === first.session.id)).toMatchObject(pair.first); expect(commanded.self.ammo).toBe(17);
    const expected = walkingDistance(pair.first, destination, new Set([pair.second.y * map.width + pair.second.x])); expect(expected).not.toBeNull();
    let last = pair.first, travelled = 0, arrived = false;
    for (let tick = 0; tick < (expected! + 5) * 3; tick++) {
      time += 250; service.tick(); const response = await call('state', undefined, first.session); expect(response.status).toBe(200);
      const current = await response.json() as LiveSnapshot, self = current.entities.find(entity => entity.id === first.session.id)!;
      expect(clear(self)).toBe(true); const step = Math.abs(self.x - last.x) + Math.abs(self.y - last.y);
      expect(step).toBeLessThanOrEqual(1); travelled += step; last = self; expect(current.self.ammo).toBe(17);
      if (self.x === destination.x && self.y === destination.y) { arrived = true; break; }
    }
    expect(arrived).toBe(true); expect(travelled).toBe(expected!);
    const allowedShot = await call('action', { type: 'attack', targetId: second.session.id }, first.session);
    expect(allowedShot.status).toBe(200); expect((await allowedShot.json() as LiveSnapshot).self.ammo).toBe(16);
    const wounded = await call('state', undefined, second.session); expect(wounded.status).toBe(200);
    expect((await wounded.json() as LiveSnapshot).entities.find(entity => entity.id === second.session.id)!.health).toBeLessThan(100);
    expect((await enter(first.session)).snapshot.selfId).toBe(first.session.id);
  });

  test('an authored city patrol makes progress through its courtyard without entering collision cells or jumping', async () => {
    const observer = await enter();
    const sites = map.citySites ?? [];
    const index = map.npcSpawns.findIndex(spawn => spawn.role === 'patrol' && new Set(spawn.route.map(point => `${point.x},${point.y}`)).size > 1 && sites.some(site => inside(spawn.point, site)));
    expect(index).toBeGreaterThanOrEqual(0);
    let id = '';
    edit(db => {
      isolate(db); const saved = JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state);
      const scav = saved.scavs.find((value: { spawnIndex: number }) => value.spawnIndex === index); expect(scav).toBeDefined(); id = scav.id;
      Object.assign(scav, { body: createHealth(), health: 100, nextMove: time, nextAttack: time + 1_000_000 }); saved.scavs = [scav];
      db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(saved));
    });
    const site = sites.find(site => inside(map.npcSpawns[index]!.point, site))!;
    let last = map.npcSpawns[index]!.point, steps = 0, visitedInterior = false;
    await enter(observer.session);
    for (let tick = 0; tick < 80; tick++) {
      time += 250; service.tick();
      // A command persists this exact frame; the periodic save alone samples only once a second.
      expect((await call('action', { type: 'cancelTreatment' }, observer.session)).status).toBe(200);
      const actor = storedWorld().scavs.find(scav => scav.id === id)!; const point = { x: actor.x as number, y: actor.y as number };
      expect(clear(point)).toBe(true);
      visitedInterior ||= site.buildings.some(building => point.x > building.x && point.y > building.y && point.x < building.x + building.width - 1 && point.y < building.y + building.height - 1);
      const step = Math.abs(point.x - last.x) + Math.abs(point.y - last.y); expect(step).toBeLessThanOrEqual(1); steps += step; last = point;
    }
    expect(steps).toBeGreaterThanOrEqual(8); expect(visitedInterior).toBe(true); expect(service.healthy()).toBe(true);
  });
});
