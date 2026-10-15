import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { LivePoint, LiveWorldProp } from '../src/game/live';
import { generateStreetFurniture } from '../src/game/world-street-furniture';
import { LIVE_WORLD_LIMITS } from '../src/game/live-world-limits';
import { generateLiveWorld, validateGeneratedWorld } from '../src/game/world-generation';
import { readLiveWorld } from '../src/live-client';
import { METROPOLIS_CORE } from '../src/game/world-metropolis-plan';

type Rect = LivePoint & { width: number; height: number };
const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const center = (rect: Rect): LivePoint => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function fixture(): Parameters<typeof generateStreetFurniture>[0] {
  const width = 128, height = 96;
  const terrainRows = Array.from({ length: height }, (_, y) => (y >= 46 && y <= 50 ? 'r' : y >= 44 && y <= 52 ? 'c' : 'g').repeat(width));
  return { width, height, terrainRows, city: { name: 'Город', x: 2, y: 2, width: 124, height: 92, quarters: [{ id: 'homes', name: 'Дворы', x: 2, y: 2, width: 124, height: 92 }] },
    paths: [{ id: 'metro-test-avenue', name: 'Жилая улица', kind: 'road', width: 4, points: [{ x: 5, y: 48 }, { x: 123, y: 48 }] },
      { id: 'metro-test-access', name: 'Въезд', kind: 'road', width: 2, points: [{ x: 80, y: 48 }, { x: 80, y: 70 }] }],
    obstacles: [], props: [{ id: 'old-tree', kind: 'tree', x: 57, y: 39, width: 2, height: 2, orientation: 'x', variant: 1, blocking: false }], extracts: [{ x: 8, y: 8 }], districts: [], containers: [{ id: 'search', x: 28, y: 41 }], npcSpawns: [{ point: { x: 96, y: 41 }, route: [{ x: 96, y: 41 }, { x: 100, y: 41 }] }], pois: [],
    citySites: [{ id: 'homes', kind: 'courtyard', x: 12, y: 20, width: 105, height: 58, buildings: [
      { id: 'shop', kind: 'shop', x: 16, y: 24, width: 30, height: 10, entrances: [{ x: 32, y: 33 }] },
      { id: 'house', kind: 'apartment', x: 54, y: 62, width: 52, height: 12, entrances: [{ x: 75, y: 62 }] },
      { id: 'office', kind: 'service', x: 88, y: 24, width: 25, height: 10, entrances: [{ x: 100, y: 33 }] },
    ], passages: [[{ x: 30, y: 36 }, { x: 112, y: 36 }]] }],
  } as unknown as Parameters<typeof generateStreetFurniture>[0];
}

test('serviced streets get deterministic physical parking and shelters beyond the continuous pavement', () => {
  const world = fixture(), original = JSON.stringify(world), excluded = { x: 1, y: 1, width: 1, height: 1 };
  const first = generateStreetFurniture(world, 'street-life', excluded), repeat = generateStreetFurniture(world, 'street-life', excluded);
  expect(first).toEqual(repeat); expect(JSON.stringify(world)).toBe(original);
  expect(first.props.some(prop => prop.kind === 'car')).toBe(true);
  expect(first.props.some(prop => prop.kind === 'bus-stop')).toBe(true);
  expect(first.props.length).toBeLessThanOrEqual(176);
  for (const prop of first.props) {
    expect(prop.blocking).toBe(true); expect(intersects(prop, excluded)).toBe(false);
    expect(first.obstacles.filter(obstacle => obstacle.propId === prop.id)).toEqual([{ x: prop.x, y: prop.y, width: prop.width, height: prop.height, kind: 'container', label: prop.kind === 'bus-stop' ? 'Остановочный павильон' : prop.kind === 'van' ? 'Припаркованный фургон' : 'Припаркованная машина', propId: prop.id }]);
    for (const old of [...world.props!, ...world.citySites!.flatMap(site => site.buildings)]) expect(intersects(prop, old)).toBe(false);
    // The reserved main road and both metre-wide walking strips remain open.
    for (let y = prop.y; y < prop.y + prop.height; y++) for (let x = prop.x; x < prop.x + prop.width; x++) {
      expect(Math.abs(y + .5 - 48)).toBeGreaterThan(4.2);
      expect(first.terrainRows[y]![x]).toBe('c');
    }
    const ring = { x: prop.x - 1, y: prop.y - 1, width: prop.width + 2, height: prop.height + 2 };
    for (const other of first.props) if (other !== prop) expect(intersects(ring, other)).toBe(false);
    for (const reserved of [...world.containers, ...world.npcSpawns.flatMap(spawn => [spawn.point, ...spawn.route])]) expect(intersects(prop, { x: reserved.x - 2, y: reserved.y - 2, width: 5, height: 5 })).toBe(false);
  }
  for (let x = 0; x < world.width; x++) for (let y = 44; y <= 52; y++) expect(first.terrainRows[y]![x]).toBe(world.terrainRows![y]![x]);
});

test('rural roads, unserviced ground, blocked verges and exhausted public budgets receive no new cover', () => {
  const world = fixture(), exclude = { x: 1, y: 1, width: 1, height: 1 };
  expect(generateStreetFurniture({ ...world, city: undefined }, 'street-life', exclude).props).toHaveLength(0);
  expect(generateStreetFurniture({ ...world, citySites: [] }, 'street-life', exclude).props).toHaveLength(0);
  expect(generateStreetFurniture(world, 'street-life', { x: 0, y: 0, width: world.width, height: world.height }).props).toHaveLength(0);
  expect(generateStreetFurniture({ ...world, obstacles: [{ x: 0, y: 34, width: 128, height: 28, kind: 'building' }] }, 'street-life', exclude).props).toHaveLength(0);
  expect(generateStreetFurniture({ ...world, props: Array.from({ length: LIVE_WORLD_LIMITS.props }, () => world.props![0]!) }, 'street-life', exclude).props).toHaveLength(0);
  expect(generateStreetFurniture({ ...world, obstacles: Array.from({ length: LIVE_WORLD_LIMITS.obstacles }, () => ({ x: 0, y: 0, width: 1, height: 1, kind: 'container' as const })) }, 'street-life', exclude).props).toHaveLength(0);
});

test('actual metropolis appends bounded authoritative cover without moving one previous object or breaking access', () => {
  const world = generateLiveWorld(), furniture = world.props!.filter(prop => prop.id.startsWith('street-'));
  const previousProps = world.props!.filter(prop => !prop.id.startsWith('street-')), previousObstacles = world.obstacles.filter(obstacle => !obstacle.propId?.startsWith('street-'));
  // The public G11 objects before this append-only pass are persistent identities.
  expect(previousProps).toHaveLength(11347); expect(digest(previousProps)).toBe('c6311b815a9257dc42727570bd406f208d01f5cb71be9f2963f0e929a71ed929');
  expect(previousObstacles).toHaveLength(7530); expect(digest(previousObstacles)).toBe('285ffdd6af54ba210aa292869de99edbfec449327e5faa521a806509283d5329');
  expect(world.props!.slice(0, previousProps.length)).toEqual(previousProps);
  expect(world.obstacles.slice(0, previousObstacles.length)).toEqual(previousObstacles);
  expect(furniture.length).toBeGreaterThan(100); expect(furniture.length).toBeLessThanOrEqual(176);
  const stops = furniture.filter(prop => prop.kind === 'bus-stop');
  expect(stops.length).toBeGreaterThan(8); expect(stops.length).toBeLessThanOrEqual(16);
  expect(furniture.filter(prop => prop.kind === 'van').length).toBeGreaterThan(10);
  for (let i = 0; i < stops.length; i++) for (let j = i + 1; j < stops.length; j++) expect(Math.hypot(center(stops[i]!).x - center(stops[j]!).x, center(stops[i]!).y - center(stops[j]!).y)).toBeGreaterThanOrEqual(50);
  for (const prop of furniture) expect(intersects(prop, METROPOLIS_CORE)).toBe(false);
  for (const quarter of world.city!.quarters.filter(quarter => quarter.id.startsWith('metro-'))) expect(furniture.some(prop => intersects(prop, quarter))).toBe(true);
  expect(validateGeneratedWorld(world)).toMatchObject({ containers: 1048, pois: 199, chunks: 1024 });
  const decoded = readLiveWorld(world);
  for (const prop of furniture) expect(decoded.props!.find(candidate => candidate.id === prop.id)).toEqual(prop);
}, 20_000);

test('a nearly full prop budget still adds only exactly matched physical objects', () => {
  const world = fixture(), props = Array.from({ length: LIVE_WORLD_LIMITS.props - 2 }, (_, index) => ({ ...world.props![0]!, id: `existing-${index}` })) as LiveWorldProp[];
  const result = generateStreetFurniture({ ...world, props }, 'street-life', { x: 1, y: 1, width: 1, height: 1 });
  expect(result.props).toHaveLength(2); expect(result.obstacles).toHaveLength(2);
  expect(result.obstacles.map(obstacle => obstacle.propId)).toEqual(result.props.map(prop => prop.id));
});
