import { expect, test } from 'bun:test';
import type { LiveCityBuilding, LiveTerrain, LiveWorldProp } from '../src/game/live';
import { buildingArchitecture } from '../src/building-architecture';
import { buildWorldGroundShadowCasters, DEFAULT_GROUND_SHADOW_LIGHT as day, GROUND_SHADOW_LIMITS,
  groundShadowVector, paintWorldGroundShadows, projectGroundShadowPart, type GroundShadowCaster } from '../src/live-ground-shadows';
import { sampleWorldSunlight } from '../src/world-ambience';

const home: LiveCityBuilding = { id: 'panel-block-1', name: 'Home', x: 12, y: 16, width: 23, height: 8,
  kind: 'apartment', floors: 3, facade: 'panel', roof: 'flat', entrances: [] };
const prop = (kind: LiveWorldProp['kind'], id = kind): LiveWorldProp => ({ id, kind, x: 40, y: 28, width: 3, height: 2, orientation: 'x', variant: 0, blocking: true });
function fixture() {
  const world = { width: 64, height: 64, props: [prop('car'), { ...prop('tree'), width: 1.8, height: 1.8 }], obstacles: [
    { x: 12, y: 16, width: 23, height: 1, kind: 'wall' as const },
    { x: 40, y: 28, width: 3, height: 2, kind: 'container' as const, propId: 'car' },
    { x: 53, y: 8, width: 1, height: 5, kind: 'wall' as const },
  ] };
  const terrain = Array<LiveTerrain>(4096).fill('concrete'), indoor = new Uint8Array(4096);
  for (let y = 0; y < 64; y++) { terrain[y * 64 + 48] = 'water'; indoor[y * 64 + 18] = 1; }
  return { world, terrain, indoor };
}
function canvas() {
  const fills: Array<{ alpha: number; paths: number }> = [], strokes: Array<{ alpha: number; width: number }> = [];
  let paths = 0, clips = 0, moves = 0;
  const context = { globalAlpha: .61, globalCompositeOperation: 'multiply', fillStyle: '#ff0000', strokeStyle: '#00ff00', lineWidth: 9,
    lineJoin: 'miter', lineCap: 'square', saved: [] as Array<Record<string, unknown>>,
    save() { this.saved.push(Object.fromEntries(['globalAlpha','globalCompositeOperation','fillStyle','strokeStyle','lineWidth','lineJoin','lineCap'].map(key => [key, this[key as keyof typeof this]]))); },
    restore() { Object.assign(this, this.saved.pop()); }, beginPath() { paths = 0; }, closePath() { paths++; },
    moveTo(x: number, y: number) { moves++; expect(Number.isFinite(x + y)).toBe(true); },
    lineTo(x: number, y: number) { expect(Number.isFinite(x + y)).toBe(true); },
    rect() {}, clip() { clips++; }, fill() { fills.push({ alpha: this.globalAlpha, paths }); },
    stroke() { strokes.push({ alpha: this.globalAlpha, width: this.lineWidth }); },
  };
  return { context: context as unknown as CanvasRenderingContext2D, fills, strokes, get clips() { return clips; }, get moves() { return moves; } };
}

test('world shadow displacement projects parallel to shared screen-space rays and scales with height', () => {
  for (const phase of [0, .28, .43, .7, 1]) {
    const sun = sampleWorldSunlight({ timeMs: 0, bounds: { x: 0, y: 0, width: 840, height: 520 }, dayPhase: phase });
    const offset = groundShadowVector(sun, 2), doubled = groundShadowVector(sun, 4);
    const screen = { x: (offset.x - offset.y) / 2, y: (offset.x + offset.y) / 4 };
    expect(screen.x * sun.direction.y).toBeCloseTo(screen.y * sun.direction.x, 8);
    expect(screen.y).toBeGreaterThan(0);
    expect(doubled.x).toBeCloseTo(offset.x * 2, 8); expect(doubled.y).toBeCloseTo(offset.y * 2, 8);
  }
  expect(groundShadowVector(day, 0)).toEqual({ x: 0, y: 0 });
});

test('stepped buildings retain independent main and wing heights and projected bounds contain every direction', () => {
  const f = fixture(), before = structuredClone(f), casters = buildWorldGroundShadowCasters(f.world, [home], f.terrain, f.indoor), caster = casters[0]!;
  const volumes = buildingArchitecture(home).volumes;
  expect(volumes).toHaveLength(2); expect(caster.parts).toHaveLength(2);
  const heights = caster.parts.map(part => Math.max(...Array.from(part).filter((_, index) => index % 3 === 2)));
  expect(heights[0]).toBeGreaterThan(heights[1]!);
  for (const direction of [{ x: 1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }]) for (const part of caster.parts) {
    for (const point of projectGroundShadowPart(part, { direction, intensity: 1 })) {
      expect(point.x).toBeGreaterThanOrEqual(caster.x - .00001); expect(point.y).toBeGreaterThanOrEqual(caster.y - .00001);
      expect(point.x).toBeLessThanOrEqual(caster.x + caster.width + .00001); expect(point.y).toBeLessThanOrEqual(caster.y + caster.height + .00001);
    }
  }
  expect(casters.filter(c => c.kind === 'obstacle')).toHaveLength(1); // neither a house wall nor the car's duplicate collider
  expect(f).toEqual(before);
});

test('receiver chunks are shared and exclude all interior and water cells at every caster', () => {
  const f = fixture(), casters = buildWorldGroundShadowCasters(f.world, [home], f.terrain, f.indoor), chunks = new Set(casters.flatMap(c => c.receivers));
  expect(chunks.size).toBeLessThan(casters.reduce((sum, c) => sum + c.receivers.length, 0));
  for (const chunk of chunks) for (const run of chunk.runs) for (let x = run.x; x < run.x + run.width; x++) {
    expect(f.indoor[run.y * 64 + x]).toBe(0); expect(f.terrain[run.y * 64 + x]).not.toBe('water');
  }
  const indoorTree = { ...prop('tree'), x: 17.1, width: 1.8 };
  const hidden = buildWorldGroundShadowCasters({ ...f.world, obstacles: [], props: [indoorTree] }, [], f.terrain, f.indoor);
  expect(hidden).toEqual([]);
});

test('edge clips never create receivers outside the map or over unknown terrain cells', () => {
  const terrain = Array<LiveTerrain>(16 * 16).fill('grass'), indoor = new Uint8Array(terrain.length);
  // A sparse/unknown terrain cell must fail closed, even when its array length
  // still agrees with the static world's declared dimensions.
  Reflect.deleteProperty(terrain, 0); Reflect.deleteProperty(terrain, 15 * 16 + 15);
  const casters = buildWorldGroundShadowCasters({ width: 16, height: 16, props: [{ ...prop('car'), x: 0, y: 0 }] }, [], terrain, indoor);
  for (const chunk of new Set(casters.flatMap(caster => caster.receivers))) for (const run of chunk.runs) {
    expect(run.x).toBeGreaterThanOrEqual(0); expect(run.y).toBeGreaterThanOrEqual(0);
    expect(run.x + run.width).toBeLessThanOrEqual(16); expect(run.y + run.height).toBeLessThanOrEqual(16);
    for (let x = run.x; x < run.x + run.width; x++) expect(terrain[run.y * 16 + x]).toBeDefined();
  }
  expect(buildWorldGroundShadowCasters({ width: 16, height: 16 }, [], [], indoor)).toEqual([]);
});

test('opaque scenery is prioritised over a full forest and supplementary garden trees receive the same light', () => {
  const f = fixture(), trees = Array.from({ length: GROUND_SHADOW_LIMITS.casters + 2 }, (_, i) => ({ ...prop('tree'), id: `forest-${i}` }));
  const scenery = [...trees, prop('bus-stop'), { ...prop('tree'), id: 'garden-tree:home:0' }];
  const casters = buildWorldGroundShadowCasters({ ...f.world, obstacles: [], props: [] }, [home], f.terrain, f.indoor, scenery);
  expect(casters).toHaveLength(GROUND_SHADOW_LIMITS.casters);
  expect(casters[0]!.kind).toBe('building'); expect(casters[1]!.id).toBe('bus-stop');
  const small = buildWorldGroundShadowCasters({ ...f.world, obstacles: [], props: [] }, [], f.terrain, f.indoor, scenery.slice(-1));
  expect(small[0]!.id).toBe('garden-tree:home:0'); expect(small[0]!.parts).toHaveLength(2);
  expect(new Set(casters.flatMap(c => c.receivers)).size).toBeLessThanOrEqual(4);
});

test('overlap is batched into one cast fill and contact fill, with a softer faint weather shadow and restored canvas state', () => {
  const f = fixture(), casters = buildWorldGroundShadowCasters(f.world, [home], f.terrain, f.indoor), before = structuredClone(casters);
  const frame = canvas(), c = frame.context;
  paintWorldGroundShadows(c, [...casters, ...casters], day);
  expect(frame.fills).toHaveLength(2); expect(frame.strokes).toHaveLength(2); expect(frame.clips).toBe(1);
  expect(frame.fills[0]!.paths).toBe(casters.reduce((sum, caster) => sum + caster.parts.length, 0) * 2);
  expect(c.globalAlpha).toBe(.61); expect(c.globalCompositeOperation).toBe('multiply'); expect(c.fillStyle).toBe('#ff0000'); expect(c.lineWidth).toBe(9);
  const fog = canvas(); paintWorldGroundShadows(fog.context, casters, { ...day, intensity: .15 });
  expect(fog.fills[0]!.alpha).toBeLessThan(frame.fills[0]!.alpha);
  expect(fog.strokes[0]!.width).toBeGreaterThan(frame.strokes[0]!.width);
  const night = canvas(); paintWorldGroundShadows(night.context, casters, { ...day, intensity: 0 });
  expect(night.strokes).toEqual([]); expect(night.fills).toHaveLength(1); expect(night.fills[0]!.alpha).toBeLessThan(.03);
  const empty = canvas(); paintWorldGroundShadows(empty.context, [], day); expect(empty.fills).toEqual([]);
  expect(casters).toEqual(before);
});

test('painter work stays bounded even if the caller supplies an uncapped scene selection', () => {
  const f = fixture(), caster = buildWorldGroundShadowCasters(f.world, [], f.terrain, f.indoor)[0] as GroundShadowCaster;
  const frame = canvas(); paintWorldGroundShadows(frame.context, Array(1000).fill(caster), day);
  expect(frame.fills[0]!.paths).toBe(caster.parts.length * GROUND_SHADOW_LIMITS.frameCasters);
  expect(frame.fills[1]!.paths).toBe(GROUND_SHADOW_LIMITS.frameCasters);
});
