import { expect, test } from 'bun:test';
import type { LiveLandscapePath, LivePoint, LiveTerrain, LiveWorld } from '../src/game/live';
import { buildSurfaceMasks, type GroundWorld } from '../src/live-ground-art';
import { buildRoadSurfaceArt, paintRoadSurfaceArt, roadAsphaltHalfWidth } from '../src/live-road-surface';
import { LIVE_MAPS } from '../src/game/live-maps';
import { LIVE_TERRAIN_CODES } from '../src/game/live';
import { PIXEL_PALETTE as P } from '../src/pixel-art';

const path = (id: string, points: LivePoint[], width = 5): LiveLandscapePath => ({ id, name: id, kind: 'road', width, points });
function fixture(paths: LiveLandscapePath[], width = 40, height = 32) {
  const world = { width, height, seed: 'quiet-asphalt', paths, citySites: [], city: { name: 'Город', x: 0, y: 0, width, height, quarters: [] } } as GroundWorld;
  const terrain = Array<LiveTerrain>(width * height).fill('grass'), walkable = new Uint8Array(width * height).fill(1);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    for (const road of paths) for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!, b = road.points[i]!, dx = b.x - a.x, dy = b.y - a.y, span2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / span2));
      if (Math.hypot(x - a.x - dx * t, y - a.y - dy * t) <= road.width / 2) terrain[y * width + x] = 'road';
    }
  }
  return { world, terrain, walkable };
}

test('bends keep one continuous lane and carry the same marking through a segment boundary', () => {
  const f = fixture([path('arterial-bend', [{ x: 3, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 25 }], 6)]);
  const masks = buildSurfaceMasks(f.world, f.terrain, f.walkable), before = structuredClone({ ...f, masks });
  const art = buildRoadSurfaceArt(f.world, masks), repeat = buildRoadSurfaceArt(f.world, masks);
  expect(art).toEqual(repeat); expect({ ...f, masks }).toEqual(before);
  expect(art.paths).toHaveLength(1); expect(art.paths[0]!.points).toEqual([{ x: 3.5, y: 10.5 }, { x: 10.5, y: 10.5 }, { x: 10.5, y: 25.5 }]);
  const into = art.strokes.find(stroke => stroke.kind === 'center-mark' && stroke.b.x === 10.5 && stroke.b.y === 10.5)!;
  const out = art.strokes.find(stroke => stroke.kind === 'center-mark' && stroke.a.x === 10.5 && stroke.a.y === 10.5)!;
  expect(into).toBeDefined(); expect(out).toBeDefined();
  expect(into.a.x).toBeCloseTo(8.9); expect(out.b.y).toBeCloseTo(10.7);
});

test('a whole dash stays outside broad intersections and even unmarked narrow T approaches', () => {
  const f = fixture([path('metro-main', [{ x: 1, y: 15 }, { x: 38, y: 15 }], 6),
    path('metro-cross', [{ x: 13, y: 1 }, { x: 13, y: 30 }], 4),
    path('metro-small-access', [{ x: 29, y: 15 }, { x: 29, y: 30 }], 2)]);
  const art = buildRoadSurfaceArt(f.world, buildSurfaceMasks(f.world, f.terrain, f.walkable));
  const marks = art.strokes.filter(stroke => stroke.kind === 'center-mark');
  expect(marks.length).toBeGreaterThan(0);
  for (const mark of marks) for (const crossing of [{ x: 13.5, y: 15.5, gap: 5.6 }, { x: 29.5, y: 15.5, gap: 5.6 }]) {
    for (let step = 0; step <= 8; step++) {
      const x = mark.a.x + (mark.b.x - mark.a.x) * step / 8, y = mark.a.y + (mark.b.y - mark.a.y) * step / 8;
      expect(Math.hypot(x - crossing.x, y - crossing.y)).toBeGreaterThanOrEqual(crossing.gap - .001);
    }
  }
  expect(art.strokes.filter(stroke => stroke.kind === 'crosswalk').length).toBeGreaterThan(10);
  expect(art.strokes.filter(stroke => stroke.kind === 'crosswalk').every(stroke => Math.abs(stroke.a.x - 29.5) > 2 || Math.abs(stroke.a.y - 15.5) > 5)).toBe(true);
});

test('diagonal asphalt keeps its complete smooth edge inside the raster while outer steps use the adjacent paving tone', () => {
  for (const angle of [Math.PI / 12, Math.PI / 6, Math.PI / 4, Math.PI / 3, Math.PI * 5 / 12]) {
    const dx = Math.cos(angle), dy = Math.sin(angle), a = { x: 7, y: 5 }, b = { x: 7 + dx * 23, y: 5 + dy * 23 };
    const f = fixture([path('metro-diagonal', [a, b])]), masks = buildSurfaceMasks(f.world, f.terrain, f.walkable), art = buildRoadSurfaceArt(f.world, masks);
    expect(art.paths[0]!.shoulderColor).toBe(P.concrete);
    for (let along = 2; along < 21; along += .2) for (const side of [-1, 1]) {
      const x = a.x + .5 + dx * along - dy * roadAsphaltHalfWidth(5) * side, y = a.y + .5 + dy * along + dx * roadAsphaltHalfWidth(5) * side;
      expect(masks.road[Math.floor(y) * f.world.width + Math.floor(x)]).toBe(1);
    }
    const paints: Array<{ color: string; width: number }> = []; let fill = '';
    const c = { lineWidth: 0, strokeStyle: '', fillStyle: '', save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {},
      fillRect(this: { fillStyle: string }) { fill = this.fillStyle; }, stroke(this: { strokeStyle: string; lineWidth: number }) { paints.push({ color: this.strokeStyle, width: this.lineWidth }); },
    } as unknown as CanvasRenderingContext2D;
    paintRoadSurfaceArt(c, art);
    expect(fill).toBe(P.concrete);
    expect(paints[0]).toEqual({ color: P.concrete, width: 8.4 });
    expect(paints[2]).toEqual({ color: '#535e62', width: roadAsphaltHalfWidth(5) * 2 });
    expect(paints[2]!.width).toBeLessThan(3.6);
  }
});

test('native aggregate stays microscopic and crosswalks fit inside the narrower visible asphalt', () => {
  const f = fixture([path('metro-main', [{ x: 1, y: 15 }, { x: 38, y: 15 }], 6), path('metro-cross', [{ x: 13, y: 1 }, { x: 13, y: 30 }], 4)]);
  const art = buildRoadSurfaceArt(f.world, buildSurfaceMasks(f.world, f.terrain, f.walkable));
  const grain = art.strokes.filter(stroke => stroke.kind === 'grain');
  expect(grain.length).toBeGreaterThan(0); expect(grain.length).toBeLessThanOrEqual(8192);
  for (const mark of grain) {
    expect(mark.weight).toBeGreaterThanOrEqual(.025); expect(mark.weight).toBeLessThanOrEqual(.04);
    expect(Math.hypot(mark.b.x - mark.a.x, mark.b.y - mark.a.y)).toBeLessThan(.04);
  }
  for (const mark of art.strokes.filter(stroke => stroke.kind === 'crosswalk')) {
    if (Math.abs(mark.b.x - mark.a.x) > Math.abs(mark.b.y - mark.a.y)) expect(Math.max(Math.abs(mark.a.y - 15.5), Math.abs(mark.b.y - 15.5)) + mark.weight / 2).toBeLessThan(roadAsphaltHalfWidth(6));
    else expect(Math.max(Math.abs(mark.a.x - 13.5), Math.abs(mark.b.x - 13.5)) + mark.weight / 2).toBeLessThan(roadAsphaltHalfWidth(4));
  }
  let grainsDrawn = 0;
  const c = { lineWidth: 0, strokeStyle: '', save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, fillRect() {},
    stroke(this: { lineWidth: number }) { if (this.lineWidth <= .04) grainsDrawn++; },
  } as unknown as CanvasRenderingContext2D;
  paintRoadSurfaceArt(c, art); expect(grainsDrawn).toBe(0);
  paintRoadSurfaceArt(c, art, { display: true }); expect(grainsDrawn).toBe(grain.length);
});

test('asphalt accepts an actual rail crossing while water, interiors, cover and remote rails remain outside every paint clip', () => {
  const f = fixture([path('arterial-rail-crossing', [{ x: 2, y: 10 }, { x: 37, y: 10 }])]);
  for (let y = 0; y < f.world.height; y++) f.terrain[y * f.world.width + 16] = 'rail';
  f.terrain[9 * f.world.width + 16] = 'water'; f.walkable[11 * f.world.width + 16] = 0;
  f.world.citySites = [{ buildings: [{ x: 7, y: 8, width: 4, height: 4 }] }] as unknown as LiveWorld['citySites'];
  const masks = buildSurfaceMasks(f.world, f.terrain, f.walkable), art = buildRoadSurfaceArt(f.world, masks);
  const accepted = new Set(art.runs.flatMap(run => Array.from({ length: run.width }, (_, x) => `${run.x + x}:${run.y}`)));
  expect(masks.road[3 * f.world.width + 16]).toBe(1); expect(accepted.has('16:3')).toBe(false);
  expect(accepted.has('16:10')).toBe(true); expect(accepted.has('16:9')).toBe(false); expect(accepted.has('16:11')).toBe(false);
  for (let y = 8; y < 12; y++) for (let x = 7; x < 11; x++) expect(accepted.has(`${x}:${y}`)).toBe(false);
  let saves = 0, clipped = false, fills = 0, strokes = 0;
  const colors = new Set<string>(), clip: number[][] = [];
  const c = { lineWidth: 0, strokeStyle: '', fillStyle: '',
    save() { saves++; clipped = false; }, restore() { saves--; }, beginPath() {},
    rect(x: number, y: number, w: number, h: number) { expect(clipped).toBe(false); clip.push([x, y, w, h]); }, clip() { clipped = true; },
    moveTo(x: number, y: number) { expect(Number.isFinite(x + y)).toBe(true); }, lineTo(x: number, y: number) { expect(Number.isFinite(x + y)).toBe(true); },
    fillRect(this: { fillStyle: string }) { expect(clipped).toBe(true); colors.add(this.fillStyle); fills++; },
    stroke(this: { strokeStyle: string }) { expect(clipped).toBe(true); colors.add(this.strokeStyle); strokes++; },
  } as unknown as CanvasRenderingContext2D;
  paintRoadSurfaceArt(c, art, { area: { x: 3, y: 8, width: 12, height: 5 }, display: true });
  expect(saves).toBe(0); expect(fills).toBe(1); expect(strokes).toBeGreaterThan(1);
  for (const [x, y, width, height] of clip) {
    expect(x!).toBeGreaterThanOrEqual(3); expect(y!).toBeGreaterThanOrEqual(8);
    expect(x! + width!).toBeLessThanOrEqual(15); expect(y! + height!).toBeLessThanOrEqual(13);
    for (let cell = x!; cell < x! + width!; cell++) expect(accepted.has(`${cell}:${y}`)).toBe(true);
  }
  expect([...colors].every(color => /^#[0-9a-f]{6}$/.test(color))).toBe(true);
  expect(colors.has('#bdc3aa')).toBe(false); expect(colors.has('#a4ad98')).toBe(false);
});

test('a dense repeated path source has a finite plan and needs no new bitmap or paint pattern', () => {
  const f = fixture([path('metro-budget', [{ x: 2, y: 16 }, { x: 37, y: 16 }])]);
  f.world.paths = Array.from({ length: 5000 }, (_, index) => ({ ...f.world.paths![0]!, id: `metro-${index}` }));
  const art = buildRoadSurfaceArt(f.world, buildSurfaceMasks(f.world, f.terrain, f.walkable));
  expect(art.paths.length).toBe(2048); expect(art.strokes.length).toBeLessThanOrEqual(16384);
  expect(art.runs.length).toBeLessThanOrEqual(f.world.width * f.world.height);
  expect(art.rowOffsets.byteLength).toBe((f.world.height + 1) * 4);
  expect(art.rowOffsets[art.height]).toBe(art.runs.length);
}, 10_000);

test('the complete metropolis builds bounded road art from its unchanged public geometry', () => {
  const world = LIVE_MAPS[0]!, before = world.version, props = world.props;
  const terrain = world.terrainRows!.flatMap(row => [...row].map(code => LIVE_TERRAIN_CODES[code as keyof typeof LIVE_TERRAIN_CODES]));
  const walkable = new Uint8Array(world.width * world.height).fill(1);
  for (const obstacle of world.obstacles) for (let y = obstacle.y; y < obstacle.y + obstacle.height; y++) walkable.fill(0, y * world.width + obstacle.x, y * world.width + obstacle.x + obstacle.width);
  const masks = buildSurfaceMasks(world, terrain, walkable), art = buildRoadSurfaceArt(world, masks);
  expect(world.version).toBe(before); expect(world.props).toBe(props);
  expect(art.paths.length).toBeLessThan(300); expect(art.strokes.length).toBeLessThan(16384); expect(art.runs.length).toBeLessThan(32768);
  expect(art.paths.length).toBeGreaterThan(100); expect(art.strokes.length).toBeGreaterThan(100);
  for (const run of art.runs) for (let x = run.x; x < run.x + run.width; x++) {
    expect(masks.road[run.y * world.width + x]).toBe(1); expect(masks.indoor[run.y * world.width + x]).toBe(0); expect(walkable[run.y * world.width + x]).toBe(1);
  }
}, 10_000);
