import { describe, expect, test } from 'bun:test';
import { generateLiveWorld, LIVE_WORLD_SEED, worldChunks } from '../src/game/world-generation';
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
    expect(pois).toHaveLength(8);
    expect(pois.some(poi => poi.danger === 3)).toBe(true);
    expect(world.containers.filter(container => pois.some(poi => poi.id === container.poiId))).toHaveLength(32);
    // Count actual walking steps to the first find, including doors and detours.
    for (const spawn of district.spawns) {
      const distances = new Int32Array(blocked.length).fill(-1), frontier = [spawn.y * world.width + spawn.x]; distances[frontier[0]!] = 0;
      const targets = new Set(world.containers.filter(anchor => pois.some(poi => poi.id === anchor.poiId)).map(anchor => anchor.y * world.width + anchor.x));
      let nearest = Infinity;
      for (let index = 0; index < frontier.length; index++) {
        const key = frontier[index]!, distance = distances[key]!; if (targets.has(key)) { nearest = distance; break; }
        if (distance >= 45) continue;
        const x = key % world.width, y = Math.floor(key / world.width);
        for (const point of [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]) {
          if (point.x < 0 || point.y < 0 || point.x >= world.width || point.y >= world.height) continue;
          const next = point.y * world.width + point.x;
          if (!blocked[next] && distances[next] === -1) { distances[next] = distance + 1; frontier.push(next); }
        }
      }
      expect(nearest).toBeLessThanOrEqual(45);
    }
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
  // Confirm named crossings really approach collision water, rather than being cosmetic labels.
  const bridges = world.paths!.filter(path => /bridge|мост/i.test(`${path.id} ${path.name}`) && !/approach|подход/i.test(`${path.id} ${path.name}`));
  expect(bridges.length).toBeGreaterThanOrEqual(3);
  const crossings: LivePoint[] = [];
  for (const bridge of bridges) {
    const cells: LivePoint[] = [];
    for (let index = 1; index < bridge.points.length; index++) {
      const first = bridge.points[index - 1]!, second = bridge.points[index]!, steps = Math.ceil(Math.hypot(second.x - first.x, second.y - first.y) * 2);
      for (let step = 0; step <= steps; step++) {
        const x = Math.round(first.x + (second.x - first.x) * step / Math.max(1, steps)), y = Math.round(first.y + (second.y - first.y) * step / Math.max(1, steps));
        expect(visited[y * world.width + x]).toBe(1);
        let bank = false;
        for (let dy = -8; !bank && dy <= 8; dy++) for (let dx = -8; !bank && dx <= 8; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < world.width && y + dy < world.height && water[(y + dy) * world.width + x + dx]) bank = true;
        if (bank) cells.push({ x, y });
      }
    }
    expect(cells.length).toBeGreaterThan(0); crossings.push(cells[Math.floor(cells.length / 2)]!);
  }
  expect(crossings.filter((crossing, index) => !crossings.slice(0, index).some(other => Math.hypot(crossing.x - other.x, crossing.y - other.y) < 8)).length).toBeGreaterThanOrEqual(3);
  // A transport graph with only a tree has no alternate route between important places.
  const parent = new Map<string, string>(), root = (id: string): string => { const value = parent.get(id); if (!value) { parent.set(id, id); return id; } if (value === id) return id; const result = root(value); parent.set(id, result); return result; };
  let loops = 0;
  for (const path of world.paths!.filter(path => path.kind === 'road' || path.kind === 'trail')) {
    const first = path.points[0]!, last = path.points.at(-1)!, a = root(`${first.x},${first.y}`), b = root(`${last.x},${last.y}`);
    if (a === b) loops++; else parent.set(a, b);
  }
  expect(loops).toBeGreaterThan(0);
  // Streaming partitions index intersecting content; they do not dictate its placement.
  const chunks = worldChunks(world); expect(chunks).toHaveLength(36);
  for (const chunk of chunks) {
    const bounds = { x: chunk.x * world.chunkSize, y: chunk.y * world.chunkSize, width: chunk.width, height: chunk.height };
    expect(chunk.poiIds.slice().sort()).toEqual(world.pois.filter(poi => intersects(poi, bounds)).map(poi => poi.id).sort());
    expect(chunk.containerIds.slice().sort()).toEqual(world.containers.filter(anchor => anchor.x >= bounds.x && anchor.x < bounds.x + bounds.width && anchor.y >= bounds.y && anchor.y < bounds.y + bounds.height).map(anchor => anchor.id).sort());
  }
  expect(world.routes).toHaveLength(16);
  expect(new Set(world.routes!.map(route => route.id)).size).toBe(16);
  expect(new Set(world.routes!.map(route => `${route.districtId}:${route.purpose}`)).size).toBe(16);
  for (const district of world.districts) expect(new Set(world.routes!.filter(route => route.districtId === district.id).map(route => route.purpose))).toEqual(new Set(['pvp', 'pve', 'loot', 'quests']));
  for (const route of world.routes!) {
    expect(route.name.length > 0 && route.description.length > 0).toBe(true);
    expect(route.poiIds.length >= 2 && route.poiIds.length <= 5).toBe(true);
    expect(new Set(route.poiIds).size).toBe(route.poiIds.length);
    const places = route.poiIds.map(id => world.pois.find(poi => poi.id === id)!);
    expect(places.every(poi => poi && poi.districtId === route.districtId)).toBe(true);
    if (route.purpose === 'pvp') expect(places.some(poi => poi.danger === 3)).toBe(true);
    if (route.purpose === 'loot') expect(places.some(poi => poi.danger === 1)).toBe(true);
  }
}

describe('deterministic world generation', () => {
  test('seed and version reproduce the same geometry and stable anchor identifiers', () => {
    const first = generateLiveWorld('reproducible-seed'), second = generateLiveWorld('reproducible-seed');
    expect(second).toEqual(first); expect(second).not.toBe(first);
    const other = generateLiveWorld('another-seed');
    expect(other.version).not.toBe(first.version); expect(other.obstacles).not.toEqual(first.obstacles);
    expect(first).toMatchObject({ id: 'perimeter', width: 192, height: 192, chunkSize: 32 });
    expect(first.generatorVersion).toBeGreaterThan(0);
  });
  test('POI footprints and placement are independent of streaming chunk origins', () => {
    for (const seed of ['organic-layout', 'another-layout', 'district-roads']) {
      const world = generateLiveWorld(seed);
      expect(world.generatorVersion).toBe(3);
      expect(world.pois).toHaveLength(32); expect(world.containers).toHaveLength(128); expect(world.npcSpawns).toHaveLength(96);
      expect(new Set(world.pois.map(poi => `${poi.width}x${poi.height}`)).size).toBeGreaterThanOrEqual(4);
      expect(new Set(world.pois.map(poi => poi.x % world.chunkSize)).size).toBeGreaterThanOrEqual(5);
      expect(new Set(world.pois.map(poi => poi.y % world.chunkSize)).size).toBeGreaterThanOrEqual(5);
      expect(world.pois.some(poi => Math.floor(poi.x / world.chunkSize) !== Math.floor((poi.x + poi.width - 1) / world.chunkSize) || Math.floor(poi.y / world.chunkSize) !== Math.floor((poi.y + poi.height - 1) / world.chunkSize))).toBe(true);
    }
  });
  test('one hundred seeds keep every interior, route, loot anchor and extraction connected and bounded', () => {
    for (let seed = 0; seed < 100; seed++) {
      try { inspect(generateLiveWorld(`seed-${seed}`)); }
      catch (cause) { throw new Error(`Generated world seed-${seed} failed validation`, { cause }); }
    }
  }, 60_000);
  test('the verified V2 default containers keep their original logical identities when the surrounding world expands', () => {
    // Public identities recorded from the shipped 128×128 layout, independent of V3 placement.
    const legacy = [
      ['poi-0-0', ['duffel', 'toolbox', 'crate', 'medbag']], ['poi-1-0', ['jacket', 'duffel', 'toolbox', 'cabinet']],
      ['poi-2-0', ['jacket', 'duffel', 'toolbox', 'cabinet']], ['poi-3-0', ['jacket', 'duffel', 'toolbox', 'cabinet']],
      ['poi-0-1', ['jacket', 'duffel', 'toolbox', 'crate']], ['poi-1-1', ['jacket', 'duffel', 'toolbox', 'crate']],
      ['poi-2-1', ['duffel', 'toolbox', 'crate', 'medbag']], ['poi-3-1', ['jacket', 'duffel', 'toolbox', 'cabinet']],
      ['poi-0-2', ['jacket', 'duffel', 'toolbox', 'crate']], ['poi-1-2', ['jacket', 'duffel', 'toolbox', 'crate']],
      ['poi-2-2', ['jacket', 'duffel', 'toolbox', 'cabinet']], ['poi-3-2', ['jacket', 'duffel', 'toolbox', 'crate']],
      ['poi-0-3', ['jacket', 'duffel', 'toolbox', 'crate']], ['poi-1-3', ['jacket', 'duffel', 'toolbox', 'crate']],
      ['poi-2-3', ['duffel', 'toolbox', 'crate', 'medbag']], ['poi-3-3', ['jacket', 'duffel', 'medbag', 'crate']],
    ] as const;
    const world = generateLiveWorld(LIVE_WORLD_SEED);
    for (const [poiId, kinds] of legacy) kinds.forEach((kind, slot) => expect(world.containers.find(anchor => anchor.id === `${poiId}-${kind}-${slot}`)).toMatchObject({ poiId, kind }));
  });
  test('cached collision and visibility agree with map geometry, and navigation avoids occupied route cells', () => {
    const world = generateLiveWorld('navigation-regression'), navigation = createLiveNavigation(world);
    for (let index = 0; index < 400; index++) {
      const a = { x: index * 53 % world.width, y: index * 71 % world.height }, b = { x: (index * 31 + 17) % world.width, y: (index * 23 + 49) % world.height };
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
