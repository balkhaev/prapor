import { describe, expect, test } from 'bun:test';
import { generateLiveWorld, validateGeneratedWorld } from '../src/game/world-generation';
import { cityStreetPlan, generateLandscape } from '../src/game/world-landscape';
import type { LivePoint } from '../src/game/live';

const seeds = ['perimeter-alpha-01', 'navigation-regression', 'reused-navigation'];
const inside = (point: LivePoint, rectangle: LivePoint & { width: number; height: number }): boolean => point.x >= rectangle.x && point.y >= rectangle.y && point.x < rectangle.x + rectangle.width && point.y < rectangle.y + rectangle.height;

describe('inhabited district ground and access', () => {
  for (const seed of seeds) test(`land use, door footways and freight facilities stay coherent for ${seed}`, () => {
    const source = generateLiveWorld(seed), dryObstacles = source.obstacles.filter(obstacle => obstacle.kind !== 'water');
    const landscape = generateLandscape({ ...source, obstacles: dryObstacles }, seed);
    const world = { ...source, terrainRows: landscape.terrainRows, paths: landscape.paths, obstacles: [...dryObstacles, ...landscape.water] };
    expect(validateGeneratedWorld(world).containers).toBe(source.containers.length);
    expect(landscape.paths.length).toBeLessThanOrEqual(384);
    const blocked = new Uint8Array(world.width * world.height);
    for (const obstacle of world.obstacles) for (let y = obstacle.y; y < obstacle.y + obstacle.height; y++) for (let x = obstacle.x; x < obstacle.x + obstacle.width; x++) blocked[y * world.width + x] = 1;
    const material = (point: LivePoint): string => landscape.terrainRows[point.y]![point.x]!;
    const count = (id: string, code: string): number => {
      const quarter = world.city!.quarters.find(quarter => quarter.id === id)!;
      return landscape.terrainRows.slice(quarter.y, quarter.y + quarter.height).map(row => row.slice(quarter.x, quarter.x + quarter.width)).join('').split(code).length - 1;
    };
    expect(count('old-center', 'g')).toBeGreaterThanOrEqual(200);
    expect(count('residential', 'g')).toBeGreaterThanOrEqual(300);
    expect(count('industrial', 'y')).toBeGreaterThanOrEqual(1000);
    expect(count('industrial', 'y')).toBeGreaterThan(count('old-center', 'y'));
    const station = world.city!.quarters.find(quarter => quarter.id === 'station')!;
    const stationRailGround = landscape.terrainRows.slice(station.y, station.y + station.height).map(row => row.slice(station.x - 18, station.x - 13)).join('');
    expect(stationRailGround.split('t').length - 1).toBeGreaterThanOrEqual(100);
    expect(count('station', 't')).toBe(0);
    for (const plan of cityStreetPlan(world.city!)) expect(landscape.paths.find(path => path.id === plan.id)).toEqual(plan);
    for (const site of world.citySites!) {
      const walks = landscape.paths.filter(path => path.id.startsWith(`footway-${site.id}-`));
      expect(walks).toHaveLength(2);
      for (const building of site.buildings) {
        for (const door of building.entrances) expect(walks.some(walk => walk.points.some(point => point.x === door.x && point.y === door.y))).toBe(true);
        for (let y = building.y; y < building.y + building.height; y++) for (let x = building.x; x < building.x + building.width; x++) if (!blocked[y * world.width + x]) expect(material({ x, y })).toBe('c');
      }
      // Overlay segments must follow the same free ground as their raster. In
      // particular, simplifying a returning branch must retain its U-turn.
      for (const walk of walks) for (let index = 1; index < walk.points.length; index++) {
        const a = walk.points[index - 1]!, b = walk.points[index]!, steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        for (let step = 0; step <= steps; step++) {
          const point = { x: Math.round(a.x + (b.x - a.x) * step / Math.max(1, steps)), y: Math.round(a.y + (b.y - a.y) * step / Math.max(1, steps)) };
          expect(blocked[point.y * world.width + point.x]).toBe(0);
          expect(material(point)).not.toBe('w');
          expect(world.citySites!.every(other => other.buildings.every(building => !inside(point, building) || building.entrances.some(door => door.x === point.x && door.y === point.y)))).toBe(true);
        }
      }
    }
    const railFacilities = world.pois.filter(poi => !poi.tags.includes('city') && poi.districtId === 'depot' && ['wagons', 'depot', 'coal'].includes(poi.templateId));
    expect(railFacilities.length).toBeGreaterThan(0);
    for (const poi of railFacilities) {
      const dedicated = landscape.paths.some(path => path.id === `siding-${poi.id}` && path.kind === 'rail');
      const adjacentFreight = landscape.paths.filter(path => path.id === 'rail-freight').some(path => path.points.slice(1).some((end, index) => {
        const start = path.points[index]!, length = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
        return Array.from({ length: length + 1 }, (_, step) => ({ x: start.x + (end.x - start.x) * step / length, y: start.y + (end.y - start.y) * step / length }))
          .some(point => Math.hypot(Math.max(poi.x - point.x, 0, point.x - poi.x - poi.width + 1), Math.max(poi.y - point.y, 0, point.y - poi.y - poi.height + 1)) <= 3);
      }));
      expect(dedicated || adjacentFreight).toBe(true);
    }
  });
});
