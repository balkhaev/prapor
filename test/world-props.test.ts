// These fixtures protect the preserved G9 city core; full G10 coverage is in world-metropolis tests.
import { describe, expect, test } from 'bun:test';
import { generatePerimeterCore, validateGeneratedWorld } from '../src/game/world-generation';
import { readLiveWorld } from '../src/live-client';
import { isLiveWalkable } from '../src/game/live-maps';

describe('inhabited public scenery and authoritative cover', () => {
  test('thousands of purposeful objects reproduce from geometry without closing doors, searches or route passages', () => {
    for (const seed of ['perimeter-alpha-01', 'neighbourhood-night', 'seed-9']) {
      const world = generatePerimeterCore(seed), repeat = generatePerimeterCore(seed), props = world.props!;
      expect(repeat.props).toEqual(props); expect(props.length).toBeGreaterThan(1800); expect(props.length).toBeLessThan(6000);
      expect(new Set(props.map(prop => prop.id)).size).toBe(props.length);
      expect(new Set(props.map(prop => prop.kind)).size).toBeGreaterThanOrEqual(20);
      const wagons = props.filter(prop => prop.kind === 'railcar');
      expect(wagons.length).toBeGreaterThan(0);
      for (const wagon of wagons) for (let y = wagon.y; y < wagon.y + wagon.height; y++) for (let x = wagon.x; x < wagon.x + wagon.width; x++)
        expect(world.terrainRows![y]![x]).toBe('t');
      for (const district of world.districts) expect(props.filter(prop => prop.x >= district.x && prop.y >= district.y && prop.x < district.x + district.width && prop.y < district.y + district.height).length).toBeGreaterThan(250);
      for (const prop of props.filter(prop => prop.blocking)) {
        expect(world.obstacles.filter(obstacle => obstacle.propId === prop.id)).toHaveLength(1);
        const obstacle = world.obstacles.find(obstacle => obstacle.propId === prop.id)!;
        expect(obstacle).toMatchObject({ x: prop.x, y: prop.y, width: prop.width, height: prop.height });
        expect(isLiveWalkable(world, prop)).toBe(false);
      }
      expect(validateGeneratedWorld(world).containers).toBe(376);
      expect(world.containers.every(anchor => isLiveWalkable(world, anchor))).toBe(true);
      expect(world.citySites!.flatMap(site => site.buildings.flatMap(building => building.entrances)).every(door => isLiveWalkable(world, door))).toBe(true);
    }
  }, 20_000);

  test('props are detached static wire data with bounded identities and exact physical footprints', () => {
    const world = generatePerimeterCore(), decoded = readLiveWorld(world);
    expect(decoded.props).toEqual(world.props);
    decoded.props![0]!.variant = (decoded.props![0]!.variant + 1) % 4;
    expect(decoded.props![0]).not.toEqual(world.props![0]);
    decoded.citySites![0]!.buildings[0]!.floors = 4;
    expect(decoded.citySites![0]!.buildings).not.toBe(world.citySites![0]!.buildings);
    const original = world.props![0]!, solid = world.props!.find(prop => prop.blocking)!;
    const forged = (prop: object) => ({ ...world, props: [prop, ...world.props!.slice(1)] });
    expect(() => readLiveWorld(forged({ ...original, reward: 1000 }))).toThrow();
    expect(() => readLiveWorld(forged({ ...original, kind: 'invisible-wall' }))).toThrow();
    expect(() => readLiveWorld(forged({ ...original, width: 256 }))).toThrow();
    expect(() => readLiveWorld(forged({ ...original, variant: 9 }))).toThrow();
    expect(() => readLiveWorld({ ...world, props: [...world.props!, original] })).toThrow();
    expect(() => readLiveWorld({ ...world, obstacles: world.obstacles.filter(obstacle => obstacle.propId !== solid.id) })).toThrow();
    expect(() => readLiveWorld({ ...world, obstacles: world.obstacles.map(obstacle => obstacle.propId === solid.id ? { ...obstacle, width: obstacle.width + 1 } : obstacle) })).toThrow();
    const legacy = { ...world, obstacles: world.obstacles.filter(obstacle => !obstacle.propId), props: undefined };
    expect(readLiveWorld(legacy).props).toBeUndefined();
  });
});
