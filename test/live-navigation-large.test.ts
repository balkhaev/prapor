import { describe, expect, test } from 'bun:test';
import { createLiveNavigation } from '../server/live-navigation';
import type { LivePoint, LiveWorld } from '../src/game/live';

function world(width = 1024, height = 1024): LiveWorld {
  return { id: 'perimeter', name: 'Город', description: 'Навигация', theme: 'mixed', width, height,
    obstacles: [], extracts: [], zones: [], version: 'test', seed: 'test', generatorVersion: 1, chunkSize: 16,
    districts: [], pois: [], containers: [] };
}
function checkRoute(nav: ReturnType<typeof createLiveNavigation>, start: LivePoint, target: LivePoint, path: LivePoint[], occupied = new Set<number>()): void {
  let previous = start;
  for (const point of path) {
    expect(Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y)).toBe(1);
    expect(nav.walkable(point)).toBe(true); expect(occupied.has(nav.key(point))).toBe(false);
    previous = point;
  }
  expect(previous).toEqual(target);
}
function oracle(width: number, height: number, start: LivePoint, target: LivePoint, blocked: ReadonlySet<number>): number | null {
  const initial = start.y * width + start.x, end = target.y * width + target.x;
  if (blocked.has(end)) return null;
  const distances = new Int32Array(width * height); distances.fill(-1); distances[initial] = 0;
  const queue = [initial];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor]!, x = cell % width, y = Math.floor(cell / width);
    if (cell === end) return distances[cell]!;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx! < 0 || ny! < 0 || nx! >= width || ny! >= height) continue;
      const next = ny! * width + nx!;
      if (blocked.has(next) || distances[next] !== -1) continue;
      distances[next] = distances[cell]! + 1; queue.push(next);
    }
  }
  return null;
}

describe('metropolis navigation', () => {
  test('far corners and reused searches preserve all four-neighbour steps within a fixed memory budget', () => {
    const nav = createLiveNavigation(world()), a = { x: 0, y: 0 }, b = { x: 1023, y: 1023 };
    expect(nav.storageBytes).toBeLessThan(40 * 1024 * 1024);
    const path = nav.findPath(a, b)!; expect(path.length).toBe(2046); checkRoute(nav, a, b, path);
    const reverse = nav.findPath(b, a)!; expect(reverse.length).toBe(2046); checkRoute(nav, b, a, reverse);
    expect(nav.findPath({ x: 501, y: 987 }, { x: 507, y: 987 })).toHaveLength(6);
    expect(nav.findPath(a, a)).toEqual([]);
    expect(() => createLiveNavigation(world(1025, 1024))).toThrow('live_navigation_bounds');
  });

  test('a blocked near doorway takes the exact long alternate road, without a distant-route cap', () => {
    const map = world(); map.obstacles = [{ x: 512, y: 1, width: 1, height: 1022, kind: 'wall' }];
    const nav = createLiveNavigation(map), a = { x: 500, y: 10 }, b = { x: 524, y: 10 };
    expect(nav.findPath(a, b)).toHaveLength(44);
    const occupied = new Set([nav.key({ x: 512, y: 0 })]);
    const path = nav.findPath(a, b, occupied)!; expect(path.length).toBe(2050); checkRoute(nav, a, b, path, occupied);
    expect(nav.findPath(a, b, new Set([nav.key(b)]))).toBeNull();
    expect(nav.findPath(a, b)).toHaveLength(44);
    occupied.add(nav.key({ x: 512, y: 1023 })); expect(nav.findPath(a, b, occupied)).toBeNull();
    expect(nav.findPath(a, b)).toHaveLength(44);
  });

  test('disconnected static regions reject repeated impossible cross-city orders, while keeping local routes usable', () => {
    const map = world(); map.obstacles = [{ x: 512, y: 0, width: 1, height: 1024, kind: 'wall' }];
    const nav = createLiveNavigation(map);
    for (let i = 0; i < 40; i++) expect(nav.findPath({ x: i + 1, y: 1 }, { x: 1022, y: 1000 - i })).toBeNull();
    expect(nav.findPath({ x: 5, y: 5 }, { x: 500, y: 500 })).toHaveLength(990);
    expect(nav.hasLineOfSight({ x: 511, y: 500 }, { x: 513, y: 500 })).toBe(false);
  });

  test('reused indexed searches agree with an independent BFS through irregular walls and changing actor occupancy', () => {
    const map = world(48, 40), walls = new Set<number>();
    let seed = 97331;
    const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (random() < .23) {
      walls.add(y * map.width + x); map.obstacles.push({ x, y, width: 1, height: 1, kind: 'wall' });
    }
    const nav = createLiveNavigation(map), open = Array.from({ length: map.width * map.height }, (_, cell) => cell).filter(cell => !walls.has(cell));
    for (let i = 0; i < 100; i++) {
      const startCell = open[Math.floor(random() * open.length)]!, endCell = open[Math.floor(random() * open.length)]!;
      const start = { x: startCell % map.width, y: Math.floor(startCell / map.width) }, target = { x: endCell % map.width, y: Math.floor(endCell / map.width) };
      const occupied = new Set(Array.from({ length: 30 }, () => open[Math.floor(random() * open.length)]!)); occupied.delete(startCell);
      const distance = oracle(map.width, map.height, start, target, new Set([...walls, ...occupied])), route = nav.findPath(start, target, occupied);
      expect(route?.length ?? null).toBe(distance);
      if (route) checkRoute(nav, start, target, route, occupied);
    }
  });

  test('water blocks walking while preserving shots across the opposite bank, and solid corners still block shots', () => {
    const map = world(20, 20); map.terrainRows = Array.from({ length: 20 }, () => 'r'.repeat(9) + 'w' + 'r'.repeat(10));
    const nav = createLiveNavigation(map);
    expect(nav.findPath({ x: 8, y: 10 }, { x: 10, y: 10 })).toBeNull();
    expect(nav.hasLineOfSight({ x: 8, y: 10 }, { x: 10, y: 10 })).toBe(true);
    map.obstacles.push({ x: 8, y: 9, width: 1, height: 1, kind: 'wall' });
    expect(createLiveNavigation(map).hasLineOfSight({ x: 7, y: 9 }, { x: 8, y: 10 })).toBe(false);
  });
});
