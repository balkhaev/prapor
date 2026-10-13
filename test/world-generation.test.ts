import { describe, expect, test } from 'bun:test';
import { generateLiveWorld } from '../src/game/world-generation';
import type { LiveMapDefinition } from '../src/game/live-maps';
import { hasLiveLineOfSight, isLiveWalkable } from '../src/game/live-maps';
import { createLiveNavigation } from '../server/live-navigation';

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
  const points = [...world.extracts, ...world.districts.flatMap(district => district.spawns), ...world.containers, ...world.lootSpawns, ...world.npcSpawns.flatMap(spawn => [spawn.point, ...spawn.route])];
  for (const point of points) {
    expect(Number.isInteger(point.x) && Number.isInteger(point.y) && point.x >= 0 && point.y >= 0 && point.x < world.width && point.y < world.height).toBe(true);
    expect(visited[point.y * world.width + point.x]).toBe(1);
  }
  expect(new Set(world.pois.map(poi => poi.id)).size).toBe(world.pois.length);
  expect(new Set(world.containers.map(container => container.id)).size).toBe(world.containers.length);
  expect(new Set(world.containers.map(container => `${container.x},${container.y}`)).size).toBe(world.containers.length);
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
  test('one hundred seeds keep every interior, route, loot anchor and extraction connected and bounded', () => {
    for (let seed = 0; seed < 100; seed++) inspect(generateLiveWorld(`seed-${seed}`));
  }, 30_000);
  test('cached collision and visibility agree with map geometry, and navigation avoids occupied route cells', () => {
    const world = generateLiveWorld('navigation-regression'), navigation = createLiveNavigation(world);
    for (let index = 0; index < 400; index++) {
      const a = { x: index * 53 % 128, y: index * 71 % 128 }, b = { x: (index * 31 + 17) % 128, y: (index * 23 + 49) % 128 };
      expect(navigation.walkable(a)).toBe(isLiveWalkable(world, a)); expect(navigation.hasLineOfSight(a, b)).toBe(hasLiveLineOfSight(world, a, b));
    }
    const occupied = new Set([navigation.key({ x: 3, y: 0 })]);
    const route = navigation.findPath({ x: 0, y: 0 }, { x: 6, y: 0 }, occupied)!;
    expect(route).not.toBeNull(); expect(route.at(-1)).toEqual({ x: 6, y: 0 }); expect(route).toHaveLength(8);
    let previous = { x: 0, y: 0 };
    for (const point of route) {
      expect(navigation.walkable(point) && !occupied.has(navigation.key(point))).toBe(true);
      expect(Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y)).toBe(1); previous = point;
    }
    expect(navigation.findPath({ x: 0, y: 0 }, { x: 3, y: 0 }, occupied)).toBeNull();
  });
});
