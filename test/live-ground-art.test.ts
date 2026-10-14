import { describe, expect, test } from 'bun:test';
import { buildRoadSurfacePlan, buildSurfaceMasks, paintTerrainTexture, TERRAIN_PIGMENTS, terrainTextureResolution } from '../src/live-ground-art';
import type { LiveLandscapePath, LiveTerrain, LiveWorld } from '../src/game/live';

function world(width: number, height: number): LiveWorld {
  return { width, height, seed: 'surface-fixture', citySites: [] } as unknown as LiveWorld;
}
function renderPixels(map: LiveWorld, terrain: LiveTerrain[], resolution = 12): { pixels: Uint8ClampedArray; allocations: number[]; uploads: number[] } {
  const width = map.width * resolution, pixels = new Uint8ClampedArray(width * map.height * resolution * 4), allocations: number[] = [], uploads: number[] = [];
  const context = {
    createImageData(w: number, h: number) { allocations.push(w * h * 4); return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    putImageData(image: { data: Uint8ClampedArray }, _x: number, y: number, _sx: number, _sy: number, _sw: number, rows: number) { uploads.push(rows); pixels.set(image.data.subarray(0, rows * width * 4), y * width * 4); },
  } as unknown as CanvasRenderingContext2D;
  paintTerrainTexture(context, map, terrain, resolution);
  return { pixels, allocations, uploads };
}

describe('surface texture budget and continuity', () => {
  test('larger maps improve on the old 8px detail while bounding bitmap memory', () => {
    expect(terrainTextureResolution(256, 256)).toBe(16);
    expect(terrainTextureResolution(320, 320)).toBe(12);
    for (const [w, h] of [[320, 240], [512, 512], [1024, 512], [2048, 2048]]) {
      const resolution = terrainTextureResolution(w!, h!);
      expect(Math.max(w!, h!) * resolution).toBeLessThanOrEqual(4096);
    }
  });
  test('seeded grain remains deterministic across strip boundaries without a second whole-world allocation', () => {
    const map = world(16, 19), terrain = Array<LiveTerrain>(map.width * map.height).fill('grass'), first = renderPixels(map, terrain), second = renderPixels(map, terrain);
    expect(first.pixels).toEqual(second.pixels);
    expect(first.uploads).toEqual([96, 96, 36]);
    expect(first.allocations).toEqual([16 * 12 * 96 * 4]);
    expect(first.allocations[0]!).toBeLessThan(first.pixels.length / 2);
    expect(renderPixels({ ...map, seed: 'other-seed' }, terrain).pixels).not.toEqual(first.pixels);
    expect(first.pixels.every(Number.isFinite)).toBe(true);
  });
  test('hard material boundaries do not blur water, paving or road colour into each other', () => {
    const map = world(9, 5), kinds = Object.keys(TERRAIN_PIGMENTS) as LiveTerrain[], terrain = Array.from({ length: 45 }, (_, index) => kinds[index % 9]!), { pixels } = renderPixels(map, terrain);
    const pixel = (cell: number) => { const at = ((2 * 12 + 6) * 9 * 12 + cell * 12 + 6) * 4; return [...pixels.slice(at, at + 3)]; };
    const road = pixel(kinds.indexOf('road')), concrete = pixel(kinds.indexOf('concrete')), water = pixel(kinds.indexOf('water')), grass = pixel(kinds.indexOf('grass'));
    expect(concrete[0]! - road[0]!).toBeGreaterThan(45);
    expect(water[2]! - water[0]!).toBeGreaterThan(30);
    expect(grass[1]! - grass[0]!).toBeGreaterThan(20);
    expect(Math.max(...road) - Math.min(...road)).toBeLessThan(10);
  });
});

describe('authoritative road markings', () => {
  test('road clips exclude water, concrete, buildings and physical cover even through an open room', () => {
    const map = world(20, 20), terrain = Array<LiveTerrain>(400).fill('grass'), walkable = new Uint8Array(400).fill(1);
    for (let x = 0; x < 20; x++) for (let y = 8; y <= 12; y++) terrain[y * 20 + x] = 'road';
    map.citySites = [{ buildings: [{ x: 2, y: 9, width: 4, height: 3 }] }] as unknown as LiveWorld['citySites'];
    terrain[10 * 20 + 7] = 'water'; terrain[10 * 20 + 8] = 'concrete'; walkable[10 * 20 + 9] = 0;
    const masks = buildSurfaceMasks(map, terrain, walkable);
    for (const run of masks.roadRuns) for (let x = run.x; x < run.x + run.width; x++) {
      const cell = run.y * map.width + x;
      expect(terrain[cell]).toBe('road'); expect(walkable[cell]).toBe(1); expect(masks.indoor[cell]).toBe(0);
    }
    for (const x of [2, 3, 4, 5, 7, 8, 9]) expect(masks.road[10 * 20 + x]).toBe(0);
    expect(masks.road[10 * 20 + 10]).toBe(1);
  });
  test('crossing locations follow arbitrary translated streets and ignore non-road intersections', () => {
    const map = world(320, 320), roads = new Uint8Array(320 * 320).fill(1);
    const path = (id: string, points: { x: number; y: number }[]): LiveLandscapePath => ({ id, name: id, kind: 'road', width: 5, points });
    const paths = [path('west-east', [{ x: 83, y: 158 }, { x: 223, y: 158 }]), path('north-south', [{ x: 194, y: 90 }, { x: 194, y: 230 }])];
    const plan = buildRoadSurfacePlan(paths, roads, map.width, map.height);
    expect(plan.intersections).toHaveLength(1);
    expect(plan.intersections[0]).toMatchObject({ x: 194.5, y: 158.5 });
    roads[158 * 320 + 194] = 0;
    expect(buildRoadSurfacePlan(paths, roads, map.width, map.height).intersections).toHaveLength(0);
  });
  test('bent roads preserve distances and diagonal crossings are handled without axis assumptions', () => {
    const paths: LiveLandscapePath[] = [{ id: 'a', name: 'a', kind: 'road', width: 4, points: [{ x: 2, y: 2 }, { x: 5, y: 5 }, { x: 18, y: 18 }] }, { id: 'b', name: 'b', kind: 'road', width: 4, points: [{ x: 2, y: 18 }, { x: 18, y: 2 }] }];
    const plan = buildRoadSurfacePlan(paths, new Uint8Array(400).fill(1), 20, 20);
    expect(plan.segments[1]!.offset).toBeCloseTo(Math.hypot(3, 3));
    expect(plan.intersections).toHaveLength(1); expect(plan.intersections[0]).toMatchObject({ x: 10.5, y: 10.5 });
  });
});
