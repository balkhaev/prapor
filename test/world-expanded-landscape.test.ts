import { describe, expect, test } from 'bun:test';
import { generateLiveWorld, validateGeneratedWorld } from '../src/game/world-generation';
import { cityStreetPlan, regionalStreetPlan, regionalRailPlan } from '../src/game/world-landscape';
import type { LiveLandscapePath, LivePoint } from '../src/game/live';

const distanceToSegment = (point: LivePoint, a: LivePoint, b: LivePoint): number => {
  const dx = b.x - a.x, dy = b.y - a.y, denominator = dx * dx + dy * dy;
  const t = denominator ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator)) : 0;
  return Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t);
};
const onPath = (point: LivePoint, path: LiveLandscapePath): boolean => path.points.slice(1).some((b, index) => distanceToSegment(point, path.points[index]!, b) < .01);

describe('authored district road hierarchy', () => {
  for (const seed of ['perimeter-alpha-01', 'outer-road-check', 'river-bank-check']) test(`parcels, banks and transport share a coherent plan for ${seed}`, () => {
    const world = generateLiveWorld(seed), city = world.city!;
    expect(world.width).toBe(512); expect(world.height).toBe(512);
    expect(validateGeneratedWorld(world).chunks).toBe(256);
    expect(world.paths!.length).toBeLessThanOrEqual(384);
    expect(world.paths!.every(path => path.points.length <= 256)).toBe(true);
    expect(world.paths!.some(path => /^road-\d|^highway-/.test(path.id))).toBe(false);
    const streets = [...cityStreetPlan(city), ...regionalStreetPlan(world.width, world.height, city)];
    expect(streets.filter(street => street.width >= 5)).toHaveLength(19);
    const neighbourhoods = streets.filter(street => street.id.startsWith('neighbourhood-'));
    expect(neighbourhoods).toHaveLength(6);
    for (const district of ['customs', 'sawmill', 'depot', 'village']) {
      const loop = neighbourhoods.find(street => street.id === `neighbourhood-${district}`)!;
      expect(loop.width).toBe(3.5); expect(loop.points).toHaveLength(5);
      expect(loop.points[0]).toEqual(loop.points.at(-1)!);
    }
    const plannedRails = regionalRailPlan(world.width, world.height, city);
    for (const plan of [...streets, ...plannedRails]) expect(world.paths!.find(path => path.id === plan.id)).toEqual(plan);
    const blocked = new Uint8Array(world.width * world.height);
    for (const obstacle of world.obstacles) for (let y = obstacle.y; y < obstacle.y + obstacle.height; y++) for (let x = obstacle.x; x < obstacle.x + obstacle.width; x++) blocked[y * world.width + x] = 1;
    const material = (point: LivePoint) => world.terrainRows![point.y]![point.x]!;
    const area = (x: number, y: number) => world.terrainRows!.slice(y, y + 112).map(row => row.slice(x, x + world.width / 2)).join('');
    const count = (ground: string, code: string) => ground.split(code).length - 1;
    expect(count(area(0, 0), 'y')).toBeGreaterThan(4500);
    expect(count(area(256, 0), 'f')).toBeGreaterThan(10000);
    expect(count(area(0, 400), 'y')).toBeGreaterThan(5000);
    expect(count(area(0, 400), 't')).toBeGreaterThan(700);
    expect(count(area(256, 400), 'g')).toBeGreaterThan(9000);
    for (const district of world.districts) expect(world.pois.filter(poi => poi.id.startsWith(`fringe-${district.id}-`))).toHaveLength(7);
    for (const exit of [{ x: 10, y: 10 }, { x: 501, y: 10 }, { x: 10, y: 501 }, { x: 501, y: 501 }]) {
      expect(world.extracts).toContainEqual(exit); expect(blocked[exit.y * world.width + exit.x]).toBe(0);
    }
    expect(world.paths!.filter(path => path.id.startsWith('bridge-') && path.kind === 'road')).toHaveLength(4);
    const wideRoads = world.paths!.filter(path => path.kind === 'road' && path.width >= 5);
    expect(wideRoads).toHaveLength(23);
    for (const road of world.paths!.filter(path => path.kind === 'road')) {
      if (road.width >= 5) expect(road.points.length).toBeLessThanOrEqual(5);
      for (let index = 1; index < road.points.length; index++) {
        const a = road.points[index - 1]!, b = road.points[index]!;
        expect(a.x === b.x || a.y === b.y).toBe(true);
        const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
        for (let step = 0; step <= length; step++) {
          const center = { x: a.x + (b.x - a.x) * step / length, y: a.y + (b.y - a.y) * step / length };
          for (let lane = -Math.floor(road.width / 2); lane <= Math.floor(road.width / 2); lane++) {
            const point = { x: Math.round(center.x + (a.x === b.x ? lane : 0)), y: Math.round(center.y + (a.y === b.y ? lane : 0)) };
            expect(blocked[point.y * world.width + point.x]).toBe(0);
            expect(['r', 't']).toContain(material(point));
          }
        }
      }
    }
    for (const drive of world.paths!.filter(path => path.id.startsWith('driveway-'))) {
      expect(drive.width).toBe(2.5);
      expect(streets.some(street => onPath(drive.points[0]!, street))).toBe(true);
      for (let index = 1; index < drive.points.length; index++) expect(drive.points[index - 1]!.x === drive.points[index]!.x || drive.points[index - 1]!.y === drive.points[index]!.y).toBe(true);
    }
    for (const poi of world.pois.filter(poi => poi.districtId === 'sawmill' && ['camp', 'cabin', 'hunting', 'creekcamp'].includes(poi.templateId))) {
      expect(world.paths!.some(path => path.id === `driveway-${poi.id}`)).toBe(false);
      expect(world.paths!.some(path => path.id === `trail-${poi.id}` && path.kind === 'trail')).toBe(true);
    }
    // Rail shares only crossings with the street network; no freight segment
    // follows an asphalt collector for a block or enters the city street grid.
    for (const railway of plannedRails) for (let index = 1; index < railway.points.length; index++) {
      const a = railway.points[index - 1]!, b = railway.points[index]!;
      for (const street of streets) for (let roadIndex = 1; roadIndex < street.points.length; roadIndex++) {
        const c = street.points[roadIndex - 1]!, d = street.points[roadIndex]!;
        if (a.x === b.x && c.x === d.x && Math.abs(a.x - c.x) < 6) {
          expect(Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))).toBeLessThanOrEqual(0);
        } else if (a.y === b.y && c.y === d.y && Math.abs(a.y - c.y) < 6) {
          expect(Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))).toBeLessThanOrEqual(0);
        }
      }
    }
  });
});
