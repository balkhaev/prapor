import { expect, test } from 'bun:test';
import type { LiveTerrain, LiveWorld } from '../src/game/live';
import { LIVE_TERRAIN_CODES } from '../src/game/live';
import { LIVE_MAPS } from '../src/game/live-maps';
import { buildSurfaceMasks } from '../src/live-ground-art';
import { buildCityGardenGround, paintCityGardenGroundDetail } from '../src/live-city-gardens';

function fixture() {
  const world = { width: 40, height: 40, city: { x: 1, y: 1, width: 38, height: 38 }, extracts: [{ x: 4, y: 4 }],
    containers: [{ x: 23, y: 23 }], obstacles: [{ x: 30, y: 2, width: 3, height: 35 }], districts: [], pois: [],
    paths: [{ kind: 'road', width: 3, points: [{ x: 12, y: 1 }, { x: 12, y: 38 }] }],
    citySites: [{ id: 'green-court', kind: 'courtyard', courtyard: { x: 3, y: 3, width: 33, height: 33 },
      buildings: [{ x: 3, y: 18, width: 6, height: 8, entrances: [{ x: 8, y: 22 }] }],
      passages: [[{ x: 1, y: 20 }, { x: 38, y: 20 }]] }],
    props: [
      { id: 'bench', kind: 'bench', x: 18, y: 9, width: 1.5, height: .6, orientation: 'x' },
      { id: 'old-tree', kind: 'tree', x: 23, y: 29, width: 1.8, height: 1.8, orientation: 'x' },
      { id: 'plot', kind: 'garden', x: 7, y: 29, width: 2.5, height: 1.5, orientation: 'x' },
    ],
  } as unknown as LiveWorld;
  const terrain = Array<LiveTerrain>(1600).fill('concrete'), walkable = new Uint8Array(1600).fill(1), indoor = new Uint8Array(1600);
  for (let y = 0; y < 40; y++) {
    terrain[y * 40 + 16] = 'water'; terrain[y * 40 + 17] = 'rail'; indoor[y * 40 + 26] = 1; walkable[y * 40 + 27] = 0;
  }
  return { world, terrain, walkable, indoor };
}

test('courtyard planting protects all circulation, real geometry and interactive approaches without mutating the world', () => {
  const f = fixture(), before = structuredClone(f), details = buildCityGardenGround(f.world, f.terrain, f.walkable, f.indoor);
  expect(details.length).toBeGreaterThan(4);
  expect(new Set(details.map(detail => detail.kind)).size).toBe(3);
  expect(details.some(detail => detail.sourceId === 'green-court')).toBe(true);
  expect(details.some(detail => detail.sourceId === 'bench')).toBe(true);
  expect(buildCityGardenGround(f.world, f.terrain, f.walkable, f.indoor)).toEqual(details);
  expect(f).toEqual(before);
  for (const detail of details) for (const run of detail.clip) for (let x = run.x; x < run.x + run.width; x++) {
    const y = run.y, cell = y * 40 + x;
    expect(f.terrain[cell]).toBe('concrete'); expect(f.walkable[cell]).toBe(1); expect(f.indoor[cell]).toBe(0);
    expect(x < 10 || x > 14).toBe(true); // road plus its actual shoulder
    expect(y < 19 || y > 21).toBe(true); // authored through passage
    expect(x < 29 || x > 33).toBe(true); // authoritative obstacle and apron
    expect(x < 17 || x > 19 || y < 8 || y > 9).toBe(true); // bench remains unobscured
    expect(x < 22 || x > 24 || y < 22 || y > 24).toBe(true); // nearby loot remains readable
    expect(x < 1 || x > 8 || y < 1 || y > 8).toBe(true); // extraction approach
    expect(x < 2 || x > 9 || y < 17 || y > 26).toBe(true); // actual interior envelope
  }
  expect(buildCityGardenGround({ ...f.world, city: undefined }, f.terrain, f.walkable, f.indoor)).toEqual([]);
  expect(buildCityGardenGround(f.world, Array<LiveTerrain>(1600).fill('road'), f.walkable, f.indoor)).toEqual([]);
});

test('cached lawn masses and fine low planting share the exact clip and preserve canvas state', () => {
  const f = fixture(), details = buildCityGardenGround(f.world, f.terrain, f.walkable, f.indoor);
  let saves = 0, clipped = false, fills = 0;
  const c = { save() { saves++; clipped = false; }, restore() { saves--; }, beginPath() {}, rect() {}, clip() { clipped = true; },
    ellipse(...numbers: number[]) { expect(numbers.every(Number.isFinite)).toBe(true); },
    fillRect(...numbers: number[]) { expect(clipped).toBe(true); expect(numbers.every(Number.isFinite)).toBe(true); fills++; },
    fill() { expect(clipped).toBe(true); fills++; },
  } as unknown as CanvasRenderingContext2D;
  for (const detail of details) for (const fine of [false, true]) paintCityGardenGroundDetail(c, detail, fine);
  expect(saves).toBe(0); expect(fills).toBeGreaterThan(details.length * 6);
});

test('new metropolitan homes receive grouped garden borders with bounded shared geometry', () => {
  const world = LIVE_MAPS[0]!, terrain = world.terrainRows!.flatMap(row => [...row].map(code => LIVE_TERRAIN_CODES[code as keyof typeof LIVE_TERRAIN_CODES]));
  const walkable = Uint8Array.from(terrain, ground => +(ground !== 'water'));
  for (const obstacle of world.obstacles) for (let y = Math.floor(obstacle.y); y < obstacle.y + obstacle.height; y++) for (let x = Math.floor(obstacle.x); x < obstacle.x + obstacle.width; x++) walkable[y * world.width + x] = 0;
  const masks = buildSurfaceMasks(world, terrain, walkable), details = buildCityGardenGround(world, terrain, walkable, masks.indoor);
  const homes = world.citySites!.filter(site => site.quarterId === 'metro-southcenter');
  const homeGardens = details.filter(detail => homes.some(site => site.id === detail.sourceId));
  expect(homeGardens.length).toBeGreaterThan(6);
  expect(new Set(homeGardens.map(detail => detail.sourceId)).size).toBeGreaterThan(4);
  expect(details.length).toBeLessThanOrEqual(4096);
  expect(details.every(detail => detail.width <= 10 && detail.height <= 10 && detail.clip.length <= 11 * 11)).toBe(true);
  const planted = new Set<number>();
  for (const detail of details) for (const run of detail.clip) for (let x = run.x; x < run.x + run.width; x++) {
    const cell = run.y * world.width + x;
    expect(planted.has(cell)).toBe(false); planted.add(cell);
    expect(walkable[cell]).toBe(1); expect(masks.indoor[cell]).toBe(0);
    expect(['grass', 'forest', 'concrete', 'yard']).toContain(terrain[cell]!);
  }
});
