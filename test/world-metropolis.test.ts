import { describe, expect, test } from 'bun:test';
import { generateLiveWorld, generatePerimeterCore, validateGeneratedWorld, worldChunks } from '../src/game/world-generation';
import { generateMetropolis } from '../src/game/world-metropolis';
import { METROPOLIS_CORE, METROPOLIS_CORE_SHIFT, METROPOLIS_QUARTERS } from '../src/game/world-metropolis-plan';
import { LIVE_WORLD_LIMITS } from '../src/game/live-world-limits';
import type { LiveLandscapePath, LivePoint } from '../src/game/live';
import type { LiveMapDefinition } from '../src/game/live-maps';

type Rect = LivePoint & { width: number; height: number };
const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

// This independent value transform deliberately does not share the generator's
// graph traversal: a reused door/passages point must still shift exactly once.
function shifted<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => shifted(item)) as T;
  if (!value || typeof value !== 'object') return value;
  const record = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shifted(item)]));
  if (typeof record.x === 'number' && typeof record.y === 'number') { record.x += METROPOLIS_CORE_SHIFT; record.y += METROPOLIS_CORE_SHIFT; }
  return record as T;
}

let cached: { core: LiveMapDefinition; world: LiveMapDefinition; original: string } | undefined;
function fixtures(): NonNullable<typeof cached> {
  if (!cached) {
    const core = generatePerimeterCore(), original = JSON.stringify(core);
    cached = { core, original, world: generateMetropolis(core) };
  }
  return cached;
}

describe('full metropolis', () => {
  test('preserves every durable G9 object, native terrain cell and source value at +256', () => {
    const { core, world, original } = fixtures();
    expect(core.version).toBe('perimeter-g9-66e1010a');
    expect(JSON.stringify(core)).toBe(original);
    for (const key of ['obstacles', 'zones', 'pois', 'containers', 'extracts', 'npcSpawns', 'lootSpawns', 'citySites', 'props', 'paths'] as const) {
      const previous = core[key] ?? [], current = world[key] ?? [];
      expect(current.slice(0, previous.length)).toEqual(shifted(previous));
    }
    for (let y = 0; y < core.height; y++) expect(world.terrainRows![y + 256]!.slice(256, 768)).toBe(core.terrainRows![y]!);
    for (const obstacle of world.obstacles.slice(core.obstacles.length)) expect(intersects(obstacle, METROPOLIS_CORE)).toBe(false);
    for (const prop of world.props!.slice(core.props!.length)) expect(intersects(prop, METROPOLIS_CORE)).toBe(false);
    for (const district of core.districts) {
      const expanded = world.districts.find(next => next.id === district.id)!;
      expect(expanded.spawns.slice(0, district.spawns.length)).toEqual(shifted(district.spawns));
      expect(expanded.labelPoint).toEqual(shifted(district.labelPoint));
      expect(expanded.spawns).toHaveLength(4);
    }
  }, 30_000);

  test('adds physical city fabric across sixteen quarters within bounded public budgets', () => {
    const { core, world } = fixtures(), sites = world.citySites!, buildings = sites.flatMap(site => site.buildings);
    expect([world.width, world.height, world.generatorVersion]).toEqual([1024, 1024, 11]);
    expect(world.city).toMatchObject({ x: 128, y: 128, width: 768, height: 768 });
    expect(world.city!.quarters).toHaveLength(16);
    expect(world.city!.width * world.city!.height / (core.city!.width * core.city!.height)).toBeGreaterThan(7);
    expect(sites).toHaveLength(120);
    expect(buildings).toHaveLength(742);
    for (const quarter of METROPOLIS_QUARTERS) {
      const addresses = sites.filter(site => site.quarterId === quarter.id);
      expect(addresses).toHaveLength(8);
      expect(addresses.every(site => !intersects(site, METROPOLIS_CORE))).toBe(true);
      expect(addresses.flatMap(site => site.buildings)).toHaveLength(quarter.buildings * 8);
    }
    expect(new Set(buildings.map(building => `${building.width}x${building.height}`)).size).toBeGreaterThan(12);
    expect(new Set(buildings.map(building => building.kind)).size).toBe(5);
    expect(new Set(buildings.map(building => building.floors))).toEqual(new Set([1, 2, 3, 4]));
    expect(new Set(buildings.map(building => building.roof))).toEqual(new Set(['flat', 'gable', 'sawtooth']));
    expect(new Set(buildings.map(building => building.facade))).toEqual(new Set(['brick', 'plaster', 'metal', 'panel']));
    expect(world.pois.filter(poi => poi.tags.includes('metropolis-park'))).toHaveLength(3);
    expect(world.containers.length).toBeLessThanOrEqual(LIVE_WORLD_LIMITS.containers);
    expect(world.obstacles.length).toBeLessThanOrEqual(LIVE_WORLD_LIMITS.obstacles);
    expect(world.props!.length).toBeLessThanOrEqual(LIVE_WORLD_LIMITS.props);
    expect(world.paths!.length).toBeLessThanOrEqual(LIVE_WORLD_LIMITS.paths);
    expect(world.npcSpawns.length).toBeLessThanOrEqual(LIVE_WORLD_LIMITS.npcs);
    expect(new TextEncoder().encode(JSON.stringify(world)).byteLength).toBeLessThan(8 * 1024 * 1024);
  });

  test('keeps suggested route identities while sending every purpose into the new city', () => {
    const { core, world } = fixtures(), byId = new Map(world.pois.map(poi => [poi.id, poi])), sites = new Map(world.citySites!.map(site => [site.poiId, site]));
    expect(world.routes!.map(route => route.id)).toEqual(core.routes!.map(route => route.id));
    for (const route of world.routes!) {
      const previous = core.routes!.find(candidate => candidate.id === route.id)!;
      const stops = route.poiIds.map(id => byId.get(id)!);
      const added = stops.filter(poi => poi.tags.includes('metropolis'));
      expect(route.poiIds.length).toBeLessThanOrEqual(5);
      expect(new Set(route.poiIds).size).toBe(route.poiIds.length);
      expect(route.poiIds[0]).toBe(previous.poiIds[0]);
      expect(route.poiIds.at(-1)).toBe(previous.poiIds.at(-1));
      expect(added).toHaveLength(2);
      expect(added.every(poi => poi.districtId === route.districtId)).toBe(true);
      if (route.purpose === 'pvp') expect(added.every(poi => poi.tags.includes('contested') && poi.danger === 3)).toBe(true);
      if (route.purpose === 'pve') expect(added.every(poi => poi.tags.some(tag => ['metro-use:works', 'metro-use:port', 'metro-use:station'].includes(tag)))).toBe(true);
      if (route.purpose === 'loot') for (const poi of added) {
        expect(poi.tags.some(tag => ['metro-use:market', 'metro-use:civic', 'metro-use:housing', 'metro-use:campus', 'metro-use:waterfront'].includes(tag))).toBe(true);
        expect(sites.get(poi.id)!.buildings.some(building => building.kind === 'shop' || building.kind === 'service')).toBe(true);
        expect(world.containers.some(anchor => anchor.poiId === poi.id && (anchor.lootTable === 'provisions' || anchor.lootTable === 'intel'))).toBe(true);
      }
      if (route.purpose === 'quests') expect(new Set(added.map(poi => sites.get(poi.id)!.quarterId)).size).toBe(2);
    }
  });

  test('connects every new address and outer entry to the preserved world without spawning on loot', () => {
    const { core, world } = fixtures(), total = world.width * world.height;
    const blocked = new Uint8Array(total), seen = new Uint8Array(total), queue = new Int32Array(total);
    for (const wall of world.obstacles) for (let y = wall.y; y < wall.y + wall.height; y++) for (let x = wall.x; x < wall.x + wall.width; x++) blocked[y * world.width + x] = 1;
    const start = world.extracts[0]!; let tail = 1;
    queue[0] = start.y * world.width + start.x; seen[queue[0]!] = 1;
    for (let head = 0; head < tail; head++) {
      const key = queue[head]!, x = key % world.width, y = Math.floor(key / world.width);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx! < 0 || nx! >= world.width || ny! < 0 || ny! >= world.height) continue;
        const next = ny! * world.width + nx!;
        if (!blocked[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; }
      }
    }
    expect(tail).toBe(total - blocked.reduce((sum, value) => sum + value, 0));
    const doors = world.citySites!.slice(core.citySites!.length).flatMap(site => site.buildings.flatMap(building => building.entrances));
    for (const point of [...world.extracts, ...world.districts.flatMap(district => district.spawns), ...world.containers, ...doors]) expect(seen[point.y * world.width + point.x]).toBe(1);
    const occupiedLoot = new Set(world.containers.map(anchor => `${anchor.x}:${anchor.y}`));
    for (const spawn of world.npcSpawns) expect(occupiedLoot.has(`${spawn.point.x}:${spawn.point.y}`)).toBe(false);
  });

  test('extends the river and rail through the core boundary without longitudinal road/rail overlap', () => {
    const { core, world } = fixtures(), oldIds = new Set(core.paths!.map(path => path.id));
    const paths = world.paths!, roads = paths.filter(path => path.kind === 'road');
    const rails = paths.filter(path => path.kind === 'rail' && !oldIds.has(path.id));
    const segments = (path: LiveLandscapePath) => path.points.slice(1).map((end, index) => ({ a: path.points[index]!, b: end, width: path.width }));
    expect(rails).toHaveLength(5);
    for (const rail of rails) for (const a of segments(rail)) for (const road of roads) for (const b of segments(road)) {
      const vertical = a.a.x === a.b.x && b.a.x === b.b.x, horizontal = a.a.y === a.b.y && b.a.y === b.b.y;
      if (!vertical && !horizontal) continue;
      const separation = vertical ? Math.abs(a.a.x - b.a.x) : Math.abs(a.a.y - b.a.y);
      if (separation >= (a.width + b.width) / 2) continue;
      const key = vertical ? 'y' : 'x';
      const overlap = Math.min(Math.max(a.a[key], a.b[key]), Math.max(b.a[key], b.b[key])) - Math.max(Math.min(a.a[key], a.b[key]), Math.min(b.a[key], b.b[key]));
      expect(overlap).toBeLessThanOrEqual(4);
    }
    const oldRiver = core.paths!.find(path => path.kind === 'river')!;
    const north = paths.find(path => path.id === `metro-${oldRiver.id}-north`)!, south = paths.find(path => path.id === `metro-${oldRiver.id}-south`)!;
    expect(north.points.at(-1)).toEqual({ x: oldRiver.points[0]!.x + 256, y: 255 });
    expect(south.points[0]).toEqual({ x: oldRiver.points.at(-1)!.x + 256, y: 768 });
    const oldRail = core.paths!.find(path => path.id === 'rail-freight')!;
    expect(paths.find(path => path.id === 'metro-rail-west')!.points.at(-1)).toEqual({ x: 255, y: oldRail.points[0]!.y + 256 });
  });

  test('keeps chunk membership exact at core, far edge and multiple-chunk boundaries', () => {
    const { world } = fixtures(), chunks = worldChunks(world);
    expect(chunks).toHaveLength(1024);
    for (const index of [0, 127, 264, 511, 767, 792, 1023]) {
      const chunk = chunks[index]!, bounds = { x: chunk.x * world.chunkSize, y: chunk.y * world.chunkSize, width: chunk.width, height: chunk.height };
      expect(chunk.obstacleIndices).toEqual(world.obstacles.flatMap((obstacle, i) => intersects(obstacle, bounds) ? [i] : []));
      expect(chunk.poiIds).toEqual(world.pois.filter(poi => intersects(poi, bounds)).map(poi => poi.id));
      expect(chunk.containerIds).toEqual(world.containers.filter(anchor => anchor.x >= bounds.x && anchor.x < bounds.x + bounds.width && anchor.y >= bounds.y && anchor.y < bounds.y + bounds.height).map(anchor => anchor.id));
    }
  });

  test('includes extraction geometry in the metropolis revision', () => {
    const { core, world } = fixtures(), changed = structuredClone(core);
    changed.extracts[0]!.x++;
    expect(generateMetropolis(changed).version).not.toBe(world.version);
    expect(JSON.stringify(core)).toBe(fixtures().original);
  }, 30_000);

  test('validates complete worlds for distant layout seeds', () => {
    const { world } = fixtures();
    expect(validateGeneratedWorld(world)).toMatchObject({ chunks: 1024, containers: 1048, pois: 199 });
    for (const seed of ['seed-9', 'seed-99']) {
      const generated = generateLiveWorld(seed);
      expect(validateGeneratedWorld(generated).walkableTiles).toBeGreaterThan(950_000);
      expect(generated.version).not.toBe(world.version);
      expect(generated.citySites).toHaveLength(120);
    }
  }, 30_000);
});
