import { describe, expect, test } from 'bun:test';
import { generateLiveWorld, worldChunks } from '../src/game/world-generation';
import type { LiveMapDefinition } from '../src/game/live-maps';
import { hasLiveLineOfSight, isLiveWalkable } from '../src/game/live-maps';
import { createLiveNavigation } from '../server/live-navigation';
import { LIVE_TERRAIN_CODES, type LivePoint } from '../src/game/live';

const intersects = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

function inspect(world: LiveMapDefinition): void {
  const blocked = new Uint8Array(world.width * world.height);
  for (const rectangle of [...world.obstacles, ...world.zones, ...world.districts, ...world.pois]) {
    expect([rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(Number.isInteger)).toBe(true);
    expect(rectangle.x >= 0 && rectangle.y >= 0 && rectangle.width > 0 && rectangle.height > 0 && rectangle.x + rectangle.width <= world.width && rectangle.y + rectangle.height <= world.height).toBe(true);
  }
  for (const wall of world.obstacles) for (let y = wall.y; y < wall.y + wall.height; y++) for (let x = wall.x; x < wall.x + wall.width; x++) blocked[y * world.width + x] = 1;
  const start = world.extracts[0]!, visited = new Uint8Array(blocked.length), queue = new Int32Array(blocked.length);
  let count = 1; queue[0] = start.y * world.width + start.x; visited[queue[0]!] = 1;
  for (let index = 0; index < count; index++) {
    const key = queue[index]!, x = key % world.width, y = Math.floor(key / world.width);
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx! < 0 || ny! < 0 || nx! >= world.width || ny! >= world.height) continue;
      const next = ny! * world.width + nx!;
      if (!blocked[next] && !visited[next]) { visited[next] = 1; queue[count++] = next; }
    }
  }
  expect(count).toBe(blocked.reduce((total, cell) => total + (cell === 0 ? 1 : 0), 0));
  const points = [...world.extracts, ...world.districts.flatMap(district => district.spawns), ...world.pois.flatMap(poi => poi.entrances), ...world.containers, ...world.lootSpawns, ...world.npcSpawns.flatMap(spawn => [spawn.point, ...spawn.route])];
  for (const point of points) {
    expect(Number.isInteger(point.x) && Number.isInteger(point.y) && point.x >= 0 && point.y >= 0 && point.x < world.width && point.y < world.height).toBe(true);
    expect(visited[point.y * world.width + point.x]).toBe(1);
  }
  expect(new Set(world.pois.map(poi => poi.id)).size).toBe(world.pois.length);
  expect(new Set(world.containers.map(container => container.id)).size).toBe(world.containers.length);
  expect(new Set(world.containers.map(container => `${container.x},${container.y}`)).size).toBe(world.containers.length);
  expect(new Set(world.npcSpawns.map(spawn => `${spawn.point.x},${spawn.point.y}`)).size).toBe(world.npcSpawns.length);
  for (const spawn of world.npcSpawns) {
    expect(world.extracts.every(exit => Math.hypot(exit.x - spawn.point.x, exit.y - spawn.point.y) >= 8)).toBe(true);
    expect(world.containers.every(anchor => anchor.x !== spawn.point.x || anchor.y !== spawn.point.y)).toBe(true);
  }
  for (const container of world.containers) {
    const poi = world.pois.find(poi => poi.id === container.poiId)!;
    expect(poi).toBeDefined(); expect(container.x >= poi.x && container.x < poi.x + poi.width && container.y >= poi.y && container.y < poi.y + poi.height).toBe(true);
  }
  for (const district of world.districts) {
    const pois = world.pois.filter(poi => poi.districtId === district.id);
    expect(pois.length).toBeGreaterThanOrEqual(4);
    expect(pois.some(poi => poi.danger === 3)).toBe(true);
    expect(world.containers.filter(container => pois.some(poi => poi.id === container.poiId)).length).toBeGreaterThanOrEqual(8);
  }
  // A globally connected map can still hide a room's loot behind a sealed doorway.
  // Flood each POI separately from its authored entrances to check the actual interior.
  for (const poi of world.pois) {
    const inside = (point: LivePoint): boolean => point.x >= poi.x && point.y >= poi.y && point.x < poi.x + poi.width && point.y < poi.y + poi.height;
    const reached = new Set<number>(), frontier = poi.entrances.filter(inside).map(point => point.y * world.width + point.x);
    expect(frontier.length).toBeGreaterThan(0);
    frontier.forEach(key => reached.add(key));
    for (let index = 0; index < frontier.length; index++) {
      const key = frontier[index]!, x = key % world.width, y = Math.floor(key / world.width);
      for (const point of [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]) {
        const next = point.y * world.width + point.x;
        if (inside(point) && !blocked[next] && !reached.has(next)) { reached.add(next); frontier.push(next); }
      }
    }
    for (const anchor of world.containers.filter(anchor => anchor.poiId === poi.id)) expect(reached.has(anchor.y * world.width + anchor.x)).toBe(true);
    for (const spawn of world.npcSpawns.filter(spawn => inside(spawn.point))) expect(reached.has(spawn.point.y * world.width + spawn.point.x)).toBe(true);
  }
  for (let first = 0; first < world.pois.length; first++) for (let second = first + 1; second < world.pois.length; second++) expect(intersects(world.pois[first]!, world.pois[second]!)).toBe(false);

  expect(world.terrainRows).toHaveLength(world.height);
  const ground = world.terrainRows!.join('');
  expect(world.terrainRows!.every(row => row.length === world.width && [...row].every(code => Object.hasOwn(LIVE_TERRAIN_CODES, code)))).toBe(true);
  for (const terrain of ['r', 'p', 't', 'f', 'w']) expect(ground.includes(terrain)).toBe(true);
  const water = new Uint8Array(blocked.length);
  for (const obstacle of world.obstacles.filter(obstacle => obstacle.kind === 'water')) for (let y = obstacle.y; y < obstacle.y + obstacle.height; y++) for (let x = obstacle.x; x < obstacle.x + obstacle.width; x++) water[y * world.width + x] = 1;
  expect([...ground].every((code, index) => (code === 'w') === (water[index] === 1))).toBe(true);
  expect(world.paths?.length).toBeGreaterThan(0);
  expect(new Set(world.paths!.map(path => path.id)).size).toBe(world.paths!.length);
  expect(new Set(world.paths!.map(path => path.kind))).toEqual(new Set(['road', 'trail', 'rail', 'river']));
  for (const path of world.paths!) {
    expect(path.points.length).toBeGreaterThanOrEqual(2); expect(path.width).toBeGreaterThan(0);
    expect(path.points.every(point => point.x >= 0 && point.y >= 0 && point.x < world.width && point.y < world.height)).toBe(true);
    if (path.kind === 'road' || path.kind === 'trail') expect(path.points.every(point => visited[Math.round(point.y) * world.width + Math.round(point.x)] === 1)).toBe(true);
  }
  // Streaming partitions index intersecting content; they do not dictate its placement.
  const chunks = worldChunks(world); expect(chunks).toHaveLength(16);
  for (const chunk of chunks) {
    const bounds = { x: chunk.x * world.chunkSize, y: chunk.y * world.chunkSize, width: chunk.width, height: chunk.height };
    expect(chunk.poiIds.slice().sort()).toEqual(world.pois.filter(poi => intersects(poi, bounds)).map(poi => poi.id).sort());
    expect(chunk.containerIds.slice().sort()).toEqual(world.containers.filter(anchor => anchor.x >= bounds.x && anchor.x < bounds.x + bounds.width && anchor.y >= bounds.y && anchor.y < bounds.y + bounds.height).map(anchor => anchor.id).sort());
  }
}

describe('deterministic world generation', () => {
  test('seed and version reproduce the same geometry and stable anchor identifiers', () => {
    const first = generateLiveWorld('reproducible-seed'), second = generateLiveWorld('reproducible-seed');
    expect(second).toEqual(first); expect(second).not.toBe(first);
    const other = generateLiveWorld('another-seed');
    expect(other.version).not.toBe(first.version); expect(other.obstacles).not.toEqual(first.obstacles);
    expect(first).toMatchObject({ id: 'perimeter', width: 128, height: 128, chunkSize: 32 });
    expect(first.generatorVersion).toBeGreaterThan(0);
  });
  test('POI footprints and placement are independent of streaming chunk origins', () => {
    for (const seed of ['organic-layout', 'another-layout', 'district-roads']) {
      const world = generateLiveWorld(seed);
      expect(world.generatorVersion).toBe(2);
      expect(world.pois).toHaveLength(16); expect(world.containers).toHaveLength(64); expect(world.npcSpawns).toHaveLength(48);
      expect(new Set(world.pois.map(poi => `${poi.width}x${poi.height}`)).size).toBeGreaterThanOrEqual(4);
      expect(new Set(world.pois.map(poi => poi.x % world.chunkSize)).size).toBeGreaterThanOrEqual(5);
      expect(new Set(world.pois.map(poi => poi.y % world.chunkSize)).size).toBeGreaterThanOrEqual(5);
      expect(world.pois.some(poi => Math.floor(poi.x / world.chunkSize) !== Math.floor((poi.x + poi.width - 1) / world.chunkSize) || Math.floor(poi.y / world.chunkSize) !== Math.floor((poi.y + poi.height - 1) / world.chunkSize))).toBe(true);
    }
  });
  test('one hundred seeds keep every interior, route, loot anchor and extraction connected and bounded', () => {
    for (let seed = 0; seed < 100; seed++) inspect(generateLiveWorld(`seed-${seed}`));
  }, 30_000);
  test('cached collision and visibility agree with map geometry, and navigation avoids occupied route cells', () => {
    const world = generateLiveWorld('navigation-regression'), navigation = createLiveNavigation(world);
    for (let index = 0; index < 400; index++) {
      const a = { x: index * 53 % 128, y: index * 71 % 128 }, b = { x: (index * 31 + 17) % 128, y: (index * 23 + 49) % 128 };
      expect(navigation.walkable(a)).toBe(isLiveWalkable(world, a)); expect(navigation.hasLineOfSight(a, b)).toBe(hasLiveLineOfSight(world, a, b));
    }
    const open = createLiveNavigation({ ...world, width: 10, height: 10, obstacles: [] });
    const occupied = new Set([open.key({ x: 3, y: 0 })]);
    const route = open.findPath({ x: 0, y: 0 }, { x: 6, y: 0 }, occupied)!;
    expect(route).not.toBeNull(); expect(route.at(-1)).toEqual({ x: 6, y: 0 }); expect(route).toHaveLength(8);
    let previous = { x: 0, y: 0 };
    for (const point of route) {
      expect(open.walkable(point) && !occupied.has(open.key(point))).toBe(true);
      expect(Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y)).toBe(1); previous = point;
    }
    expect(open.findPath({ x: 0, y: 0 }, { x: 3, y: 0 }, occupied)).toBeNull();
  });
});
