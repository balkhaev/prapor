import { describe, expect, test } from 'bun:test';
import { buildRoadSurfacePlan, buildSurfaceMasks, cityPedestrianCrossings, courtyardGroundMarks, paintRoadSurface, paintTerrainTexture, PIXEL_TERRAIN_PALETTES, roadHasMarkings, TERRAIN_PIGMENTS, terrainTextureResolution } from '../src/live-ground-art';
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
    expect(terrainTextureResolution(448, 448)).toBe(9);
    expect(terrainTextureResolution(512, 512)).toBe(8);
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
    expect(concrete[0]! - road[0]!).toBeGreaterThan(10);
    expect(water[2]! - water[0]!).toBeGreaterThan(30);
    expect(grass[1]! - grass[0]!).toBeGreaterThan(5);
    expect(Math.max(...road) - Math.min(...road)).toBeLessThan(15);
  });
  test('pixel terrain uses opaque stepped palettes with distinct material motifs', () => {
    const map = world(18, 19);
    for (const material of Object.keys(PIXEL_TERRAIN_PALETTES) as LiveTerrain[]) {
      const { pixels } = renderPixels(map, Array<LiveTerrain>(map.width * map.height).fill(material), 8);
      const allowed = new Set(PIXEL_TERRAIN_PALETTES[material].map(color => color.join(','))), used = new Set<string>();
      let opaque = true;
      for (let at = 0; at < pixels.length; at += 4) {
        used.add(`${pixels[at]},${pixels[at + 1]},${pixels[at + 2]}`); opaque &&= pixels[at + 3] === 255;
      }
      expect(opaque).toBe(true); expect([...used].every(color => allowed.has(color))).toBe(true);
      expect(used.size).toBeGreaterThanOrEqual(3); expect(used.size).toBeLessThanOrEqual(6);
    }
  });
});

describe('organic ground presentation', () => {
  test('quarter metadata never paints a rectangular paving boundary without actual architecture', () => {
    const map = world(24, 12), terrain = Array<LiveTerrain>(24 * 12).fill('concrete');
    const before = renderPixels(map, terrain, 8).pixels;
    map.city = { name: 'Районы', x: 0, y: 0, width: 24, height: 12, quarters: [{ id: 'old-center', name: 'Центр', x: 3, y: 2, width: 12, height: 8 }, { id: 'station', name: 'Вокзал', x: 15, y: 2, width: 8, height: 8 }] };
    expect(renderPixels(map, terrain, 8).pixels).toEqual(before);
  });
  test('coherent organic margins change near the edge while preserving distant material and every hard cell', () => {
    const map = world(32, 12), terrain = Array.from({ length: 32 * 12 }, (_, cell): LiveTerrain => cell % 32 < 10 ? 'grass' : cell % 32 < 20 ? 'forest' : cell % 32 < 23 ? 'road' : cell % 32 < 26 ? 'water' : cell % 32 < 29 ? 'concrete' : 'rail');
    const base = renderPixels(map, terrain, 8).pixels;
    const changed = terrain.map(material => material === 'grass' ? 'forest' : material === 'forest' ? 'grass' : material), flipped = renderPixels(map, changed, 8).pixels;
    const cellPixels = (pixels: Uint8ClampedArray, x: number, y: number) => {
      const rows: number[] = []; for (let py = y * 8; py < (y + 1) * 8; py++) rows.push(...pixels.slice((py * 32 * 8 + x * 8) * 4, (py * 32 * 8 + (x + 1) * 8) * 4)); return rows;
    };
    const grass = renderPixels(map, Array<LiveTerrain>(32 * 12).fill('grass'), 8).pixels;
    const forest = renderPixels(map, Array<LiveTerrain>(32 * 12).fill('forest'), 8).pixels;
    expect(cellPixels(base, 9, 6)).not.toEqual(cellPixels(grass, 9, 6));
    expect(cellPixels(base, 10, 6)).not.toEqual(cellPixels(forest, 10, 6));
    expect(cellPixels(base, 4, 6)).toEqual(cellPixels(grass, 4, 6));
    expect(cellPixels(base, 15, 6)).toEqual(cellPixels(forest, 15, 6));
    for (let x = 20; x < 32; x++) expect(cellPixels(base, x, 6)).toEqual(cellPixels(flipped, x, 6));
    const allowed = new Set([...PIXEL_TERRAIN_PALETTES.grass, ...PIXEL_TERRAIN_PALETTES.forest].map(color => color.join(',')));
    expect(cellPixels(base, 9, 6).some((_, at, values) => at % 4 === 0 && !allowed.has(values.slice(at, at + 3).join(',')))).toBe(true);
  });
  test('organic transitions never enter an authored interior even when a legacy terrain fixture uses grass beneath it', () => {
    const map = world(16, 10), terrain = Array.from({ length: 160 }, (_, cell): LiveTerrain => cell % 16 < 8 ? 'grass' : 'forest');
    map.citySites = [{ buildings: [{ x: 5, y: 2, width: 3, height: 6, kind: 'apartment' }] }] as unknown as LiveWorld['citySites'];
    const pixels = renderPixels(map, terrain, 8).pixels, plain = renderPixels(world(16, 10), Array<LiveTerrain>(160).fill('grass'), 8).pixels;
    for (let y = 2 * 8; y < 8 * 8; y++) for (let x = 5 * 8; x < 8 * 8; x++) {
      const at = (y * 16 * 8 + x) * 4;
      expect(pixels.slice(at, at + 4)).toEqual(plain.slice(at, at + 4));
    }
  });
  test('courtyard marks are irregular, deterministic and leave real walking passages clear', () => {
    const site = { id: 'linden-court', kind: 'courtyard' as const, courtyard: { x: 5, y: 8, width: 24, height: 18 }, passages: [[{ x: 17, y: 8 }, { x: 17, y: 26 }]] };
    const before = structuredClone(site), marks = courtyardGroundMarks(site);
    expect(marks.length).toBeGreaterThan(5); expect(marks.length).toBeLessThanOrEqual(35);
    expect(courtyardGroundMarks(site)).toEqual(marks); expect(site).toEqual(before);
    expect(new Set(marks.map(mark => mark.width)).size).toBeGreaterThan(3);
    for (const mark of marks) {
      expect(mark.x).toBeGreaterThanOrEqual(5); expect(mark.y).toBeGreaterThanOrEqual(8);
      expect(mark.x + mark.width).toBeLessThanOrEqual(29.000001); expect(mark.y + mark.height).toBeLessThanOrEqual(26.000001);
      expect(mark.x + mark.width < 16.2 || mark.x > 17.8).toBe(true);
    }
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
  test('a real rail crossing accepts asphalt beneath the road stroke without accepting water or cover', () => {
    const map = world(20, 20), terrain = Array<LiveTerrain>(400).fill('grass'), walkable = new Uint8Array(400).fill(1);
    for (let x = 0; x < 20; x++) for (let y = 8; y < 13; y++) terrain[y * 20 + x] = 'road';
    for (let y = 0; y < 20; y++) terrain[y * 20 + 10] = 'rail';
    terrain[9 * 20 + 10] = 'water'; walkable[11 * 20 + 10] = 0;
    const masks = buildSurfaceMasks(map, terrain, walkable);
    expect(masks.road[10 * 20 + 10]).toBe(1); expect(masks.road[9 * 20 + 10]).toBe(0); expect(masks.road[11 * 20 + 10]).toBe(0);
    const paths: LiveLandscapePath[] = [{ id: 'arterial-west', name: 'Дорога', kind: 'road', width: 5, points: [{ x: 2, y: 10 }, { x: 18, y: 10 }] }, { id: 'rail-west', name: 'Пути', kind: 'rail', width: 2, points: [{ x: 10, y: 0 }, { x: 10, y: 19 }] }];
    const plan = buildRoadSurfacePlan(paths, masks.road, map.width, map.height);
    expect(plan.segments).toHaveLength(1); expect(plan.segments[0]!.path.id).toBe('arterial-west');
  });
  test('bent roads preserve distances and diagonal crossings are handled without axis assumptions', () => {
    const paths: LiveLandscapePath[] = [{ id: 'a', name: 'a', kind: 'road', width: 4, points: [{ x: 2, y: 2 }, { x: 5, y: 5 }, { x: 18, y: 18 }] }, { id: 'b', name: 'b', kind: 'road', width: 4, points: [{ x: 2, y: 18 }, { x: 18, y: 2 }] }];
    const plan = buildRoadSurfacePlan(paths, new Uint8Array(400).fill(1), 20, 20);
    expect(plan.segments[1]!.offset).toBeCloseTo(Math.hypot(3, 3));
    expect(plan.intersections).toHaveLength(1); expect(plan.intersections[0]).toMatchObject({ x: 10.5, y: 10.5 });
  });
  test('service-yard crossings have no zebras or center stripes; only main urban crossroads qualify', () => {
    const paths: LiveLandscapePath[] = [{ id: 'city-street-x-170', name: 'a', kind: 'road', width: 6, points: [{ x: 10, y: 2 }, { x: 10, y: 18 }] }, { id: 'city-street-y-170', name: 'b', kind: 'road', width: 6, points: [{ x: 2, y: 10 }, { x: 18, y: 10 }] }, { id: 'service-yard-1', name: 'c', kind: 'road', width: 3, points: [{ x: 2, y: 6 }, { x: 18, y: 6 }] }];
    const plan = buildRoadSurfacePlan(paths, new Uint8Array(400).fill(1), 20, 20);
    expect(plan.intersections.length).toBeGreaterThan(1); expect(cityPedestrianCrossings(plan)).toHaveLength(1);
    expect(roadHasMarkings(paths[0]!)).toBe(true); expect(roadHasMarkings(paths[2]!)).toBe(false);
  });
  test('pixel asphalt keeps the entire continuous lane inside the physical clip', () => {
    const map = world(30, 30), points = [{ x: 3, y: 3 }, { x: 13, y: 13 }, { x: 24, y: 13 }];
    map.paths = [{ id: 'arterial-fixture', name: 'Тракт', kind: 'road', width: 6, points }];
    const masks = { road: new Uint8Array(900).fill(1), indoor: new Uint8Array(900), roadRuns: [{ x: 0, y: 0, width: 30 }] };
    const strokes: Array<{ width: number; color: string; points: number[][] }> = []; let current: number[][] = [], clipped = false, saves = 0;
    const c = {
      lineWidth: 0, strokeStyle: '', save() { saves++; }, restore() { saves--; }, beginPath() { current = []; },
      rect() {}, clip() { clipped = true; }, moveTo(x: number, y: number) { current.push([x, y]); }, lineTo(x: number, y: number) { current.push([x, y]); },
      stroke(this: { lineWidth: number; strokeStyle: string }) { expect(clipped).toBe(true); strokes.push({ width: this.lineWidth, color: this.strokeStyle, points: [...current] }); },
    } as unknown as CanvasRenderingContext2D;
    paintRoadSurface(c, map, masks);
    expect(saves).toBe(0);
    expect(strokes[0]!.width).toBeCloseTo(6.35); expect(strokes[1]!.width).toBeCloseTo(5.72);
    expect(strokes[1]!.points).toEqual(points.map(point => [point.x + .5, point.y + .5]));
    expect(strokes.every(stroke => /^#[0-9a-f]{6}$/i.test(stroke.color))).toBe(true);
  });
});
