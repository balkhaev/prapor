import { describe, expect, test } from 'bun:test';
import { generateLiveWorld, validateGeneratedWorld } from '../src/game/world-generation';
import type { LivePoint } from '../src/game/live';

describe('expanded working outskirts and road geometry', () => {
  for (const seed of ['perimeter-alpha-01', 'outer-road-check', 'river-bank-check']) test(`the outer settlements have real land use and clear roads for ${seed}`, () => {
    const world = generateLiveWorld(seed);
    expect(world.width).toBe(320); expect(world.height).toBe(320);
    expect(validateGeneratedWorld(world).chunks).toBe(100);
    expect(world.paths!.length).toBeLessThanOrEqual(384);
    const blocked = new Uint8Array(world.width * world.height);
    for (const obstacle of world.obstacles) for (let y = obstacle.y; y < obstacle.y + obstacle.height; y++) for (let x = obstacle.x; x < obstacle.x + obstacle.width; x++) blocked[y * world.width + x] = 1;
    const material = (point: LivePoint) => world.terrainRows![point.y]![point.x]!;
    const northWest = world.terrainRows!.slice(0, 32).map(row => row.slice(0, 160)).join('');
    const northEast = world.terrainRows!.slice(0, 32).map(row => row.slice(160)).join('');
    const southWest = world.terrainRows!.slice(288).map(row => row.slice(0, 160)).join('');
    const southEast = world.terrainRows!.slice(288).map(row => row.slice(160)).join('');
    const count = (ground: string, code: string) => ground.split(code).length - 1;
    expect(count(northWest, 'y')).toBeGreaterThan(1200);
    expect(count(northEast, 'f')).toBeGreaterThan(1600);
    expect(count(southWest, 'y')).toBeGreaterThan(1600);
    expect(count(southWest, 't')).toBeGreaterThan(80);
    expect(count(southEast, 'g')).toBeGreaterThan(2200);
    for (const district of world.districts) expect(world.pois.filter(poi => poi.id.startsWith(`fringe-${district.id}-`))).toHaveLength(5);
    for (const ground of [northWest, northEast, southWest, southEast]) expect(count(ground, 'r')).toBeGreaterThan(100);
    const primary = [{ x: 10, y: 10 }, { x: 309, y: 10 }, { x: 10, y: 309 }, { x: 309, y: 309 }];
    for (const exit of primary) { expect(world.extracts).toContainEqual(exit); expect(blocked[exit.y * world.width + exit.x]).toBe(0); }
    expect(world.paths!.filter(path => /^bridge-(?:north|farmland)$/.test(path.id))).toHaveLength(2);
    expect(world.paths!.some(path => path.id === 'rail-distribution' && path.kind === 'rail')).toBe(true);
    const highways = world.paths!.filter(path => path.id.startsWith('highway-'));
    expect(highways).toHaveLength(8);
    for (const highway of highways) {
      expect(highway.points.length).toBeLessThan(60);
      for (let index = 1; index < highway.points.length; index++) {
        const a = highway.points[index - 1]!, b = highway.points[index]!, steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 3));
        for (let step = 0; step <= steps; step++) {
          const point = { x: Math.round(a.x + (b.x - a.x) * step / steps), y: Math.round(a.y + (b.y - a.y) * step / steps) };
          expect(blocked[point.y * world.width + point.x]).toBe(0);
          expect(['r', 't']).toContain(material(point));
        }
      }
    }
  });
});
