import { describe, expect, test } from 'bun:test';
import { generateLiveWorld, LIVE_WORLD_SEED, validateGeneratedWorld, worldChunks } from '../src/game/world-generation';
import type { LiveMapDefinition } from '../src/game/live-maps';
import { hasLiveLineOfSight, isLiveWalkable } from '../src/game/live-maps';
import { createLiveNavigation } from '../server/live-navigation';
import { LIVE_TERRAIN_CODES, type LivePoint } from '../src/game/live';
import { getLiveBossArena } from '../src/game/live-boss-arenas';

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
    expect(pois).toHaveLength(18);
    expect(pois.some(poi => poi.danger === 3)).toBe(true);
    expect(world.containers.filter(container => pois.some(poi => poi.id === container.poiId))).toHaveLength(66);
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

  // The city is a continuous place with connected streets and usable architecture,
  // while every previously shipped landmark has moved out to the surrounding ring.
  const city = world.city!;
  expect(city).toMatchObject({ name: 'Ольховск', x: 56, y: 56, width: 144, height: 144 });
  expect(city.quarters).toHaveLength(4);
  expect(new Set(city.quarters.map(quarter => quarter.id)).size).toBe(4);
  const cityPois = world.pois.filter(poi => /^poi-(?:8|9|10|11)-[0-3]$/.test(poi.id));
  const legacyPois = world.pois.filter(poi => /^poi-[0-7]-[0-3]$/.test(poi.id));
  expect(cityPois).toHaveLength(16); expect(legacyPois).toHaveLength(32);
  expect(legacyPois.every(poi => !intersects(poi, city))).toBe(true);
  const inside = (point: LivePoint, rectangle: { x: number; y: number; width: number; height: number } = city): boolean => point.x >= rectangle.x && point.y >= rectangle.y && point.x < rectangle.x + rectangle.width && point.y < rectangle.y + rectangle.height;
  expect(cityPois.every(poi => inside(poi) && inside({ x: poi.x + poi.width - 1, y: poi.y + poi.height - 1 }) && poi.tags.includes('city'))).toBe(true);
  const sites = world.citySites!;
  expect(sites).toHaveLength(24);
  const usableBuildings = sites.flatMap(site => site.buildings);
  expect(usableBuildings.length).toBeGreaterThanOrEqual(40);
  for (const site of sites) {
    const poi = world.pois.find(poi => poi.id === site.poiId)!;
    expect(poi).toMatchObject({ x: site.x, y: site.y, width: site.width, height: site.height });
    expect(poi.entrances).toHaveLength(2);
    expect(Math.abs(poi.entrances[0]!.x - poi.entrances[1]!.x) + Math.abs(poi.entrances[0]!.y - poi.entrances[1]!.y)).toBeGreaterThanOrEqual(7);
    const anchors = world.containers.filter(anchor => anchor.poiId === site.poiId);
    expect(anchors).toHaveLength(3);
    expect(anchors.map(anchor => anchor.id)).toEqual([`${site.id}-slot-0`, `${site.id}-slot-1`, `${site.id}-slot-2`]);
    expect(anchors.filter(anchor => site.buildings.some(building => inside(anchor, building))).length).toBeGreaterThanOrEqual(2);
    for (const building of site.buildings) {
      expect(building.width).toBeGreaterThanOrEqual(5); expect(building.height).toBeGreaterThanOrEqual(5);
      expect(building.entrances).toHaveLength(2);
      const sideDoors = building.entrances[0]!.y === building.entrances[1]!.y;
      for (const door of building.entrances) for (const at of [door, { x: door.x + (sideDoors ? 0 : 1), y: door.y + (sideDoors ? 1 : 0) }]) expect(blocked[at.y * world.width + at.x]).toBe(0);
      // An advertised interior must contain reachable floor, not a solid roof rectangle.
      const entrance = building.entrances[0]!, floor = new Set<number>([entrance.y * world.width + entrance.x]), queue = [entrance];
      for (let at = 0; at < queue.length; at++) {
        const p = queue[at]!;
        for (const next of [{ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 }]) {
          const key = next.y * world.width + next.x;
          if (inside(next, building) && !blocked[key] && !floor.has(key)) { floor.add(key); queue.push(next); }
        }
      }
      let freeCells = 0;
      for (let y = building.y; y < building.y + building.height; y++) for (let x = building.x; x < building.x + building.width; x++) if (!blocked[y * world.width + x]) freeCells++;
      // Authored dressers, counters and shelving occupy real cells. Every remaining
      // floor cell, including both halves of the two doors, must be reachable.
      expect(floor.size).toBe(freeCells);
      expect(floor.has(building.entrances[1]!.y * world.width + building.entrances[1]!.x)).toBe(true);
      for (const anchor of anchors.filter(anchor => inside(anchor, building))) expect(floor.has(anchor.y * world.width + anchor.x)).toBe(true);
    }
    for (const passage of site.passages) for (let index = 1; index < passage.length; index++) {
      const a = passage[index - 1]!, b = passage[index]!, dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
      expect(dx === 0 || dy === 0).toBe(true);
      for (let step = 0; step <= Math.abs(b.x - a.x) + Math.abs(b.y - a.y); step++) expect(blocked[(a.y + dy * step) * world.width + a.x + dx * step]).toBe(0);
    }
    const patrol = world.npcSpawns.find(spawn => inside(spawn.point, site));
    expect(patrol?.role).toBe('patrol'); expect(patrol!.route.length).toBeGreaterThanOrEqual(4);
    expect(patrol!.route.some(p => site.buildings.some(building => inside(p, building)))).toBe(true);
    expect(patrol!.route).toContainEqual(poi.entrances[0]!); expect(patrol!.route).toContainEqual(poi.entrances[1]!);
  }
  const closedBuildings = world.obstacles.filter(obstacle => obstacle.kind === 'building' && inside(obstacle) && inside({ x: obstacle.x + obstacle.width - 1, y: obstacle.y + obstacle.height - 1 }));
  const architecture = [...usableBuildings, ...closedBuildings];
  expect(architecture.length).toBeGreaterThanOrEqual(80);
  for (const quarter of city.quarters) {
    expect(quarter.width).toBe(72); expect(quarter.height).toBe(72);
    expect(inside(quarter) && inside({ x: quarter.x + quarter.width - 1, y: quarter.y + quarter.height - 1 })).toBe(true);
    expect(cityPois.filter(poi => inside(poi, quarter) && inside({ x: poi.x + poi.width - 1, y: poi.y + poi.height - 1 }, quarter))).toHaveLength(4);
    expect(sites.filter(site => site.quarterId === quarter.id)).toHaveLength(6);
    const buildings = architecture.filter(obstacle => intersects(obstacle, quarter));
    expect(buildings.length).toBeGreaterThanOrEqual(16);
    const footprintArea = buildings.reduce((sum, obstacle) => sum + Math.max(0, Math.min(obstacle.x + obstacle.width, quarter.x + quarter.width) - Math.max(obstacle.x, quarter.x)) * Math.max(0, Math.min(obstacle.y + obstacle.height, quarter.y + quarter.height) - Math.max(obstacle.y, quarter.y)), 0);
    expect(footprintArea).toBeGreaterThanOrEqual(quarter.width * quarter.height * .12);
    let solidArea = 0;
    for (let y = quarter.y; y < quarter.y + quarter.height; y++) for (let x = quarter.x; x < quarter.x + quarter.width; x++) solidArea += blocked[y * world.width + x]!;
    expect(solidArea).toBeGreaterThanOrEqual(quarter.width * quarter.height * .05);
    let streets = 0;
    for (let y = quarter.y; y < quarter.y + quarter.height; y++) for (let x = quarter.x; x < quarter.x + quarter.width; x++) if (world.terrainRows![y]![x] === 'r' && !blocked[y * world.width + x]) streets++;
    expect(streets).toBeGreaterThanOrEqual(quarter.width * quarter.height * .06);
  }
  for (let first = 0; first < city.quarters.length; first++) for (let second = first + 1; second < city.quarters.length; second++) expect(intersects(city.quarters[first]!, city.quarters[second]!)).toBe(false);
  const perimeterRoads: LivePoint[][] = [[], [], [], []];
  for (let offset = 0; offset < city.width; offset++) {
    for (const [side, point] of [[0, { x: city.x, y: city.y + offset }], [1, { x: city.x + city.width - 1, y: city.y + offset }], [2, { x: city.x + offset, y: city.y }], [3, { x: city.x + offset, y: city.y + city.height - 1 }]] as const) if (world.terrainRows![point.y]![point.x] === 'r' && !blocked[point.y * world.width + point.x]) perimeterRoads[side]!.push(point);
  }
  expect(perimeterRoads.every(side => side.length > 0)).toBe(true);
  const citySeen = new Uint8Array(blocked.length), cityQueue = [perimeterRoads[0]![0]!.y * world.width + perimeterRoads[0]![0]!.x]; citySeen[cityQueue[0]!] = 1;
  for (let index = 0; index < cityQueue.length; index++) {
    const key = cityQueue[index]!, x = key % world.width, y = Math.floor(key / world.width);
    for (const point of [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]) {
      const next = point.y * world.width + point.x;
      if (inside(point) && !blocked[next] && !citySeen[next]) { citySeen[next] = 1; cityQueue.push(next); }
    }
  }
  for (const side of perimeterRoads) expect(side.some(point => citySeen[point.y * world.width + point.x])).toBe(true);
  for (const point of [...world.pois.filter(poi => poi.tags.includes('city')).flatMap(poi => poi.entrances), ...world.containers.filter(anchor => inside(anchor)), ...world.npcSpawns.flatMap(spawn => [spawn.point, ...spawn.route]).filter(point => inside(point)), ...sites.flatMap(site => [...site.buildings.flatMap(building => building.entrances), ...site.passages.flat()])]) expect(citySeen[point.y * world.width + point.x]).toBe(1);

  expect(world.terrainRows).toHaveLength(world.height);
  const ground = world.terrainRows!.join('');
  expect(world.terrainRows!.every(row => row.length === world.width && [...row].every(code => Object.hasOwn(LIVE_TERRAIN_CODES, code)))).toBe(true);
  for (const terrain of ['r', 'p', 't', 'f', 'w']) expect(ground.includes(terrain)).toBe(true);
  const water = new Uint8Array(blocked.length);
  for (const obstacle of world.obstacles.filter(obstacle => obstacle.kind === 'water')) for (let y = obstacle.y; y < obstacle.y + obstacle.height; y++) for (let x = obstacle.x; x < obstacle.x + obstacle.width; x++) water[y * world.width + x] = 1;
  expect([...ground].every((code, index) => (code === 'w') === (water[index] === 1))).toBe(true);
  expect(world.paths?.length).toBeGreaterThan(0);
  expect(world.paths!.length).toBeLessThanOrEqual(384);
  expect(new Set(world.paths!.map(path => path.id)).size).toBe(world.paths!.length);
  expect(new Set(world.paths!.map(path => path.kind))).toEqual(new Set(['road', 'trail', 'rail', 'river']));
  for (const path of world.paths!) {
    expect(path.points.length).toBeGreaterThanOrEqual(2); expect(path.points.length).toBeLessThanOrEqual(256); expect(path.width).toBeGreaterThan(0);
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
  const chunks = worldChunks(world); expect(chunks).toHaveLength(64);
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
    expect(places.every(poi => poi)).toBe(true);
    expect(places.some(poi => poi.tags.includes('city'))).toBe(true);
    if (route.purpose === 'pvp') expect(places.filter(poi => poi.tags.includes('city') && poi.danger === 3).length).toBeGreaterThanOrEqual(2);
    if (route.purpose === 'loot') {
      const safeEntry = places.some(poi => poi.danger === 1);
      if (!safeEntry) throw new Error(`Loot route ${route.id} lacks a safe entry: ${places.map(poi => `${poi.id}(${poi.templateId}, danger=${poi.danger})`).join(', ')}`);
      expect(safeEntry).toBe(true); expect(places.some(poi => !poi.tags.includes('city'))).toBe(true);
    }
  }
  const pvpRoutes = world.routes!.filter(route => route.purpose === 'pvp');
  expect(pvpRoutes[0]!.poiIds.some(id => pvpRoutes.every(route => route.poiIds.includes(id)))).toBe(true);
}

describe('deterministic world generation', () => {
  test('seed and version reproduce the same geometry and stable anchor identifiers', () => {
    const first = generateLiveWorld('reproducible-seed'), second = generateLiveWorld('reproducible-seed');
    expect(second).toEqual(first); expect(second).not.toBe(first);
    const other = generateLiveWorld('another-seed');
    expect(other.version).not.toBe(first.version); expect(other.obstacles).not.toEqual(first.obstacles);
    expect(first).toMatchObject({ id: 'perimeter', width: 256, height: 256, chunkSize: 32 });
    expect(first.generatorVersion).toBeGreaterThan(0);
  });
  test('POI footprints and placement are independent of streaming chunk origins', () => {
    for (const seed of ['organic-layout', 'another-layout', 'district-roads']) {
      const world = generateLiveWorld(seed);
      expect(world.generatorVersion).toBe(6);
      expect(world.pois).toHaveLength(72); expect(world.containers).toHaveLength(264); expect(world.npcSpawns).toHaveLength(152);
      expect(new Set(world.pois.map(poi => `${poi.width}x${poi.height}`)).size).toBeGreaterThanOrEqual(4);
      expect(new Set(world.pois.map(poi => poi.x % world.chunkSize)).size).toBeGreaterThanOrEqual(5);
      expect(new Set(world.pois.map(poi => poi.y % world.chunkSize)).size).toBeGreaterThanOrEqual(5);
      expect(world.pois.some(poi => Math.floor(poi.x / world.chunkSize) !== Math.floor((poi.x + poi.width - 1) / world.chunkSize) || Math.floor(poi.y / world.chunkSize) !== Math.floor((poi.y + poi.height - 1) / world.chunkSize))).toBe(true);
    }
  });
  test('one hundred seeds keep every interior, route, loot anchor and extraction connected and bounded', () => {
    for (let seed = 0; seed < 100; seed++) {
      try { inspect(generateLiveWorld(`seed-${seed}`)); }
      catch (cause) { throw new Error(`Generated world seed-${seed} failed validation: ${cause instanceof Error ? cause.message : String(cause)}`, { cause }); }
    }
  }, 60_000);
  test('default and seed-nine city guidance retains connected stops and an accessible first supply', () => {
    for (const seed of [LIVE_WORLD_SEED, 'seed-9']) inspect(generateLiveWorld(seed));
    const world = generateLiveWorld('seed-9'), firstForestSupply = world.pois.find(poi => poi.id === 'poi-2-0')!;
    expect(firstForestSupply.danger).toBe(1);
    expect(getLiveBossArena(world, 'lesnik').poiId).not.toBe(firstForestSupply.id);
  });
  test('architecture validation rejects a blocked doorway and a passage that jumps through its wall', () => {
    const world = generateLiveWorld();
    expect(validateGeneratedWorld(world).containers).toBe(264);
    const firstBuilding = world.citySites![0]!.buildings[0]!, door = firstBuilding.entrances[0]!;
    const sideDoors = firstBuilding.entrances[0]!.y === firstBuilding.entrances[1]!.y;
    const sealed = structuredClone(world);
    sealed.obstacles.push({ ...door, width: sideDoors ? 1 : 2, height: sideDoors ? 2 : 1, kind: 'wall' });
    expect(() => validateGeneratedWorld(sealed)).toThrow('Invalid usable city architecture');
    const shortcut = structuredClone(world), building = shortcut.citySites![0]!.buildings[0]!;
    // The two endpoints are clear, while the segment crosses the closed side wall.
    const wallCrossings: Array<{ wall: LivePoint; path: LivePoint[] }> = [];
    for (let y = building.y + 1; y < building.y + building.height - 1; y++) for (const x of [building.x, building.x + building.width - 1]) wallCrossings.push({ wall: { x, y }, path: [{ x: x - 1, y }, { x: x + 1, y }] });
    for (let x = building.x + 1; x < building.x + building.width - 1; x++) for (const y of [building.y, building.y + building.height - 1]) wallCrossings.push({ wall: { x, y }, path: [{ x, y: y - 1 }, { x, y: y + 1 }] });
    const crossing = wallCrossings.find(candidate => !isLiveWalkable(world, candidate.wall) && candidate.path.every(point => isLiveWalkable(world, point)))!;
    expect(crossing).toBeDefined();
    shortcut.citySites![0]!.passages[0] = crossing.path;
    expect(() => validateGeneratedWorld(shortcut)).toThrow('City passage crosses a wall');
  });
  test('all 192 shipped default containers keep their logical identities, kinds and loot categories', () => {
    // Public identities recorded from the shipped G3/G4 layouts, independent of G5 placement.
    const legacy = [
      ['poi-0-0', ['duffel', 'toolbox', 'crate', 'medbag']], ['poi-1-0', ['jacket', 'duffel', 'toolbox', 'cabinet']],
      ['poi-2-0', ['jacket', 'duffel', 'toolbox', 'cabinet']], ['poi-3-0', ['jacket', 'duffel', 'toolbox', 'cabinet']],
      ['poi-0-1', ['jacket', 'duffel', 'toolbox', 'crate']], ['poi-1-1', ['jacket', 'duffel', 'toolbox', 'crate']],
      ['poi-2-1', ['duffel', 'toolbox', 'crate', 'medbag']], ['poi-3-1', ['jacket', 'duffel', 'toolbox', 'cabinet']],
      ['poi-0-2', ['jacket', 'duffel', 'toolbox', 'crate']], ['poi-1-2', ['jacket', 'duffel', 'toolbox', 'crate']],
      ['poi-2-2', ['jacket', 'duffel', 'toolbox', 'cabinet']], ['poi-3-2', ['jacket', 'duffel', 'toolbox', 'crate']],
      ['poi-0-3', ['jacket', 'duffel', 'toolbox', 'crate']], ['poi-1-3', ['jacket', 'duffel', 'toolbox', 'crate']],
      ['poi-2-3', ['duffel', 'toolbox', 'crate', 'medbag']], ['poi-3-3', ['jacket', 'duffel', 'medbag', 'crate']],
      ['poi-4-0', ['duffel', 'toolbox', 'crate', 'medbag']], ['poi-5-0', ['jacket', 'duffel', 'toolbox', 'cabinet']],
      ['poi-6-0', ['duffel', 'toolbox', 'crate', 'medbag']], ['poi-7-0', ['duffel', 'toolbox', 'crate', 'medbag']],
      ['poi-4-1', ['jacket', 'duffel', 'toolbox', 'crate']], ['poi-5-1', ['jacket', 'duffel', 'toolbox', 'crate']],
      ['poi-6-1', ['jacket', 'duffel', 'toolbox', 'crate']], ['poi-7-1', ['duffel', 'toolbox', 'crate', 'medbag']],
      ['poi-4-2', ['jacket', 'duffel', 'toolbox', 'crate']], ['poi-5-2', ['duffel', 'toolbox', 'crate', 'medbag']],
      ['poi-6-2', ['jacket', 'duffel', 'toolbox', 'cabinet']], ['poi-7-2', ['duffel', 'toolbox', 'crate', 'medbag']],
      ['poi-4-3', ['duffel', 'toolbox', 'crate', 'medbag']], ['poi-5-3', ['jacket', 'duffel', 'toolbox', 'crate']],
      ['poi-6-3', ['duffel', 'toolbox', 'crate', 'medbag']], ['poi-7-3', ['jacket', 'duffel', 'medbag', 'crate']],
      ['poi-8-0', ['jacket', 'duffel', 'medbag', 'crate']], ['poi-9-0', ['duffel', 'toolbox', 'crate', 'medbag']],
      ['poi-10-0', ['jacket', 'duffel', 'toolbox', 'crate']], ['poi-11-0', ['jacket', 'duffel', 'toolbox', 'crate']],
      ['poi-8-1', ['jacket', 'duffel', 'toolbox', 'cabinet']], ['poi-9-1', ['jacket', 'duffel', 'toolbox', 'cabinet']],
      ['poi-10-1', ['duffel', 'toolbox', 'crate', 'medbag']], ['poi-11-1', ['jacket', 'duffel', 'toolbox', 'cabinet']],
      ['poi-8-2', ['jacket', 'duffel', 'toolbox', 'crate']], ['poi-9-2', ['jacket', 'duffel', 'toolbox', 'crate']],
      ['poi-10-2', ['duffel', 'toolbox', 'crate', 'medbag']], ['poi-11-2', ['jacket', 'duffel', 'medbag', 'crate']],
      ['poi-8-3', ['jacket', 'duffel', 'toolbox', 'crate']], ['poi-9-3', ['jacket', 'duffel', 'toolbox', 'cabinet']],
      ['poi-10-3', ['duffel', 'toolbox', 'crate', 'medbag']], ['poi-11-3', ['jacket', 'duffel', 'toolbox', 'cabinet']],
    ] as const;
    const world = generateLiveWorld(LIVE_WORLD_SEED);
    const categories = { duffel: 'mixed', toolbox: 'tools', crate: 'provisions', medbag: 'medical', jacket: 'valuables', cabinet: 'intel' } as const;
    for (const [poiId, kinds] of legacy) kinds.forEach((kind, slot) => expect(world.containers.find(anchor => anchor.id === `${poiId}-${kind}-${slot}`)).toMatchObject({ poiId, kind, lootTable: categories[kind] }));
    expect(world.containers.filter(anchor => /^poi-(?:[0-9]|10|11)-[0-3]-/.test(anchor.id))).toHaveLength(192);
  });
  test('cached collision and visibility agree with map geometry, and navigation avoids occupied route cells', () => {
    const world = generateLiveWorld('navigation-regression'), navigation = createLiveNavigation(world);
    for (let index = 0; index < 400; index++) {
      const a = { x: index * 53 % world.width, y: index * 71 % world.height }, b = { x: (index * 31 + 17) % world.width, y: (index * 23 + 49) % world.height };
      expect(navigation.walkable(a)).toBe(isLiveWalkable(world, a)); expect(navigation.hasLineOfSight(a, b)).toBe(hasLiveLineOfSight(world, a, b));
    }
    const open = createLiveNavigation({ ...world, width: 10, height: 10, terrainRows: undefined, obstacles: [] });
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
  test('reused navigation searches retain shortest paths when direction, targets and occupied doorways change', () => {
    const world = { ...generateLiveWorld('reused-navigation'), width: 16, height: 12, terrainRows: undefined, obstacles: [{ x: 6, y: 0, width: 1, height: 8 }, { x: 6, y: 9, width: 1, height: 3 }, { x: 10, y: 3, width: 1, height: 9 }] };
    const navigation = createLiveNavigation(world), corners = [{ x: 0, y: 0 }, { x: 15, y: 11 }, { x: 0, y: 11 }, { x: 15, y: 0 }];
    const shortest = (start: LivePoint, target: LivePoint, occupied: Set<number>): number | null => {
      if (occupied.has(target.y * world.width + target.x)) return null;
      const distances = new Int32Array(world.width * world.height).fill(-1), queue = [start]; distances[start.y * world.width + start.x] = 0;
      for (let index = 0; index < queue.length; index++) {
        const point = queue[index]!, key = point.y * world.width + point.x;
        if (point.x === target.x && point.y === target.y) return distances[key]!;
        for (const next of [{ x: point.x - 1, y: point.y }, { x: point.x + 1, y: point.y }, { x: point.x, y: point.y - 1 }, { x: point.x, y: point.y + 1 }]) {
          const nextKey = next.y * world.width + next.x;
          if (isLiveWalkable(world, next) && !occupied.has(nextKey) && distances[nextKey] === -1) { distances[nextKey] = distances[key]! + 1; queue.push(next); }
        }
      }
      return null;
    };
    for (let index = 0; index < 100; index++) {
      const start = corners[index % 4]!, target = corners[(index + 1 + Math.floor(index / 4) % 2) % 4]!;
      const blocked = index % 5 === 0 ? new Set([navigation.key({ x: 6, y: 8 })]) : index % 5 === 1 ? new Set([navigation.key(target)]) : index % 5 === 2 ? new Set([navigation.key({ x: 10, y: 2 })]) : new Set<number>();
      const expected = shortest(start, target, blocked), route = navigation.findPath(start, target, blocked);
      if (expected === null) { expect(route).toBeNull(); continue; }
      expect(route).toHaveLength(expected); expect(route!.at(-1)).toEqual(target);
      let previous = start;
      for (const point of route!) { expect(isLiveWalkable(world, point) && !blocked.has(navigation.key(point))).toBe(true); expect(Math.abs(previous.x - point.x) + Math.abs(previous.y - point.y)).toBe(1); previous = point; }
    }
    expect(navigation.findPath(corners[0]!, corners[0]!)).toEqual([]);
    expect(navigation.findPath(corners[0]!, { x: 6, y: 5 })).toBeNull();
    expect(navigation.findPath(corners[0]!, { x: -1, y: 0 })).toBeNull();
    expect(navigation.findPath(corners[0]!, corners[1]!)?.length).toBe(shortest(corners[0]!, corners[1]!, new Set())!);
  });
});
