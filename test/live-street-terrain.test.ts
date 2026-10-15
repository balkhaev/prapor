import { expect, test } from 'bun:test';
import type { LiveTerrain, LiveWorld } from '../src/game/live';
import { LIVE_TERRAIN_CODES } from '../src/game/live';
import { LIVE_MAPS } from '../src/game/live-maps';
import { buildSurfaceMasks } from '../src/live-ground-art';
import { buildStreetTerrainDetails, paintStreetTerrainDetail, STREET_TERRAIN_LIMITS } from '../src/live-street-terrain';

function fixture() {
  const world = { width: 80, height: 80, city: { x: 2, y: 2, width: 76, height: 76 },
    paths: [{ id: 'old-avenue', kind: 'road', width: 5, points: [{ x: 15, y: 3 }, { x: 15, y: 76 }] }],
    citySites: [{ id: 'service-court', x: 30, y: 15, width: 40, height: 52, kind: 'workyard', courtyard: { x: 32, y: 25, width: 35, height: 32 },
      passages: [[{ x: 32, y: 33 }, { x: 67, y: 33 }], [{ x: 32, y: 45 }, { x: 67, y: 45 }]],
      buildings: [{ id: 'workshop', x: 51, y: 29, width: 6, height: 9, entrances: [{ x: 51, y: 33 }] }],
    }], props: [{ id: 'parked-car', kind: 'car', x: 13, y: 46, width: 2, height: 5 }],
    obstacles: [{ x: 63, y: 30, width: 2, height: 7 }], containers: [{ x: 45, y: 33 }], extracts: [{ x: 15, y: 69 }],
    pois: [{ entrances: [{ x: 15, y: 10 }] }], districts: [{ spawns: [{ x: 15, y: 27 }] }],
  } as unknown as LiveWorld;
  const terrain = Array<LiveTerrain>(6400).fill('grass'), walkable = new Uint8Array(6400).fill(1), indoor = new Uint8Array(6400);
  for (let y = 0; y < 80; y++) for (let x = 13; x <= 17; x++) terrain[y * 80 + x] = 'road';
  for (let x = 30; x < 70; x++) for (let y = 31; y < 36; y++) terrain[y * 80 + x] = 'yard';
  for (let x = 30; x < 70; x++) for (let y = 43; y < 48; y++) terrain[y * 80 + x] = 'concrete';
  for (let y = 0; y < 80; y++) { terrain[y * 80 + 38] = 'water'; terrain[y * 80 + 39] = 'rail'; walkable[y * 80 + 40] = 0; }
  for (let x = 0; x < 80; x++) indoor[20 * 80 + x] = 1;
  return { world, terrain, walkable, indoor };
}

test('wear and relief follow roads and courtyard ways, with deterministic bounded geometry and unchanged gameplay data', () => {
  const f = fixture(), before = structuredClone(f);
  const details = buildStreetTerrainDetails(f.world, f.terrain, f.walkable, f.indoor);
  expect(new Set(details.map(detail => detail.kind))).toEqual(new Set(['puddle', 'pothole', 'repair', 'ruts', 'mound']));
  expect(details.some(detail => detail.kind === 'puddle' && detail.material === 'earth')).toBe(true);
  expect(details.some(detail => detail.kind === 'puddle' && detail.material === 'paved')).toBe(true);
  expect(details.some(detail => detail.sourceId === 'old-avenue')).toBe(true);
  expect(details.some(detail => detail.sourceId === 'service-court')).toBe(true);
  expect(buildStreetTerrainDetails(f.world, f.terrain, f.walkable, f.indoor)).toEqual(details);
  expect(f).toEqual(before);
  for (const detail of details) {
    expect(detail.width).toBeLessThanOrEqual(STREET_TERRAIN_LIMITS.maxSide);
    expect(detail.height).toBeLessThanOrEqual(STREET_TERRAIN_LIMITS.maxSide);
    expect(detail.contour).toHaveLength(10);
    expect(detail.clip.length).toBeLessThanOrEqual(STREET_TERRAIN_LIMITS.maxSide ** 2);
    expect(Math.hypot(detail.along.x, detail.along.y)).toBeCloseTo(1);
    expect(detail.along.x * detail.across.x + detail.along.y * detail.across.y).toBeCloseTo(0);
    for (const point of detail.contour) {
      expect(Number.isFinite(point.x + point.y)).toBe(true);
      expect(point.x).toBeGreaterThanOrEqual(detail.x); expect(point.x).toBeLessThanOrEqual(detail.x + detail.width);
      expect(point.y).toBeGreaterThanOrEqual(detail.y); expect(point.y).toBeLessThanOrEqual(detail.y + detail.height);
    }
  }
});

test('shared clips exclude interiors, water, rails, blocked ground, fixtures and all entrance or interaction approaches', () => {
  const f = fixture(), details = buildStreetTerrainDetails(f.world, f.terrain, f.walkable, f.indoor);
  expect(details.length).toBeGreaterThan(5);
  for (const detail of details) for (const run of detail.clip) for (let x = run.x; x < run.x + run.width; x++) {
    const y = run.y, cell = y * f.world.width + x;
    expect(f.walkable[cell]).toBe(1); expect(f.indoor[cell]).toBe(0);
    expect(detail.material === 'paved' ? ['road', 'concrete'] : ['yard', 'path', 'sand', 'grass']).toContain(f.terrain[cell]!);
    expect(x).toBeGreaterThanOrEqual(2); expect(x).toBeLessThan(78);
    expect(y).toBeGreaterThanOrEqual(2); expect(y).toBeLessThan(78);
    expect(x < 12 || x > 15 || y < 45 || y > 51).toBe(true); // real parked car and apron
    expect(x < 50 || x > 57 || y < 28 || y > 38).toBe(true); // workshop and its door
    expect(x < 62 || x > 65 || y < 29 || y > 37).toBe(true); // other authoritative obstacle
    expect(x < 44 || x > 46 || y < 32 || y > 34).toBe(true); // loot approach
    expect(x < 12 || x > 18 || y < 66 || y > 72).toBe(true); // extraction approach
    expect(x < 13 || x > 17 || y < 8 || y > 12).toBe(true); // public POI entrance
    expect(x < 13 || x > 17 || y < 25 || y > 29).toBe(true); // authored spawn
  }
  expect(buildStreetTerrainDetails({ ...f.world, city: undefined }, f.terrain, f.walkable, f.indoor)).toEqual([]);
  expect(buildStreetTerrainDetails(f.world, Array<LiveTerrain>(6400).fill('water'), f.walkable, f.indoor)).toEqual([]);
  expect(buildStreetTerrainDetails(f.world, f.terrain, f.walkable, new Uint8Array(6400).fill(1))).toEqual([]);
  expect(buildStreetTerrainDetails(f.world, [], f.walkable, f.indoor)).toEqual([]);
});

test('cached and detailed relief use identical clips, finite drawing coordinates and restore canvas state', () => {
  const f = fixture(), details = buildStreetTerrainDetails(f.world, f.terrain, f.walkable, f.indoor);
  let saves = 0, clipped = false, operations = 0;
  const rectangles: number[][] = [], colors: string[] = [], styles: Array<{ fillStyle: string; strokeStyle: string; lineWidth: number; lineCap: string; lineJoin: string }> = [];
  const c = { fillStyle: 'original-fill', strokeStyle: 'original-stroke', lineWidth: 7, lineCap: 'butt', lineJoin: 'miter',
    save() { saves++; clipped = false; styles.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, lineCap: this.lineCap, lineJoin: this.lineJoin }); },
    restore() { saves--; Object.assign(this, styles.pop()!); }, beginPath() {}, closePath() {},
    rect(...values: number[]) { rectangles.push(values); }, clip() { clipped = true; },
    moveTo(...values: number[]) { expect(values.every(Number.isFinite)).toBe(true); },
    lineTo(...values: number[]) { expect(values.every(Number.isFinite)).toBe(true); },
    fill() { expect(clipped).toBe(true); colors.push(this.fillStyle); operations++; },
    stroke() { expect(clipped).toBe(true); operations++; },
  };
  for (const detail of details) {
    rectangles.length = 0; const start = operations;
    paintStreetTerrainDetail(c as unknown as CanvasRenderingContext2D, detail, false);
    const coarseClip = structuredClone(rectangles), coarseOperations = operations - start;
    rectangles.length = 0; const fineStart = operations;
    paintStreetTerrainDetail(c as unknown as CanvasRenderingContext2D, detail, true);
    expect(rectangles).toEqual(coarseClip);
    expect(operations - fineStart).toBeGreaterThan(coarseOperations);
    expect(c).toMatchObject({ fillStyle: 'original-fill', strokeStyle: 'original-stroke', lineWidth: 7, lineCap: 'butt', lineJoin: 'miter' });
  }
  expect(saves).toBe(0); expect(operations).toBeGreaterThan(details.length * 3);
  expect(new Set(colors).size).toBeGreaterThan(8);
});

test('the metropolitan plan remains sparse and covers roads plus inhabited courtyards without retained full-world masks', () => {
  const world = LIVE_MAPS[0]!, terrain = world.terrainRows!.flatMap(row => [...row].map(code => LIVE_TERRAIN_CODES[code as keyof typeof LIVE_TERRAIN_CODES]));
  const walkable = Uint8Array.from(terrain, material => +(material !== 'water'));
  for (const obstacle of world.obstacles) for (let y = Math.floor(obstacle.y); y < obstacle.y + obstacle.height; y++) for (let x = Math.floor(obstacle.x); x < obstacle.x + obstacle.width; x++) walkable[y * world.width + x] = 0;
  const { indoor } = buildSurfaceMasks(world, terrain, walkable), details = buildStreetTerrainDetails(world, terrain, walkable, indoor);
  expect(details.length).toBeGreaterThan(100);
  expect(details.length).toBeLessThanOrEqual(STREET_TERRAIN_LIMITS.details);
  expect(new Set(details.map(detail => detail.kind)).size).toBe(5);
  expect(new Set(details.map(detail => detail.sourceId)).size).toBeGreaterThan(30);
  const siteDetails = details.filter(detail => world.citySites!.some(site => site.id === detail.sourceId));
  expect(new Set(siteDetails.map(detail => detail.sourceId)).size).toBeGreaterThan(100);
  expect(world.citySites!.every(site => siteDetails.filter(detail => detail.sourceId === site.id).length <= 4)).toBe(true);
  expect(world.city!.quarters.every(quarter => details.some(detail => detail.center.x >= quarter.x && detail.center.x < quarter.x + quarter.width
    && detail.center.y >= quarter.y && detail.center.y < quarter.y + quarter.height))).toBe(true);
  expect(details.every(detail => detail.width <= 10 && detail.height <= 10 && detail.clip.length <= 100)).toBe(true);
  for (const detail of details) for (const run of detail.clip) for (let x = run.x; x < run.x + run.width; x++) {
    const cell = run.y * world.width + x;
    expect(indoor[cell]).toBe(0); expect(walkable[cell]).toBe(1);
    expect(terrain[cell]).not.toBe('water'); expect(terrain[cell]).not.toBe('rail');
  }
});

test('overlapping authored road networks cannot grow the retained plan beyond its explicit limit', () => {
  const f = fixture(), width = 160, height = 160, cells = width * height;
  const world = { ...f.world, width, height, city: { ...f.world.city!, x: 1, y: 1, width: 158, height: 158 }, citySites: [], props: [], obstacles: [], containers: [], extracts: [], pois: [], districts: [],
    paths: Array.from({ length: 200 }, (_, i) => ({ id: `busy-lane-${i}`, name: '', kind: 'road' as const, width: 5,
      points: [{ x: 3 + i % 154, y: 1 }, { x: 3 + i % 154, y: 158 }] })),
  };
  const details = buildStreetTerrainDetails(world, Array<LiveTerrain>(cells).fill('road'), new Uint8Array(cells).fill(1), new Uint8Array(cells));
  expect(details).toHaveLength(STREET_TERRAIN_LIMITS.details);
  expect(details.every(detail => detail.width <= 10 && detail.height <= 10 && detail.contour.length === 10 && detail.clip.length <= 100)).toBe(true);
});
