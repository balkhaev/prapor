import { expect, test } from 'bun:test';
import type { LiveCitySite, LiveTerrain, LiveWorld, LiveWorldProp } from '../src/game/live';
import { LIVE_TERRAIN_CODES } from '../src/game/live';
import { LIVE_MAPS } from '../src/game/live-maps';
import { buildSurfaceMasks } from '../src/live-ground-art';
import { sceneBuildings } from '../src/live-map-art';
import { buildCityGardenGround, type CityGardenGroundDetail } from '../src/live-city-gardens';
import { buildCourtyardGround, COURTYARD_ART_LIMITS, paintCourtyardGroundDetail } from '../src/live-courtyard-art';

function fixture() {
  const world = { width: 64, height: 64, city: { name: 'Город', x: 1, y: 1, width: 62, height: 62, quarters: [] }, paths: [],
    obstacles: [], extracts: [{ x: 3, y: 57 }], containers: [{ x: 37, y: 25 }], districts: [{ spawns: [{ x: 58, y: 3 }] }], pois: [],
    citySites: [{ id: 'lived-yard', kind: 'courtyard', x: 2, y: 2, width: 60, height: 60, courtyard: { x: 27, y: 20, width: 4, height: 15 },
      buildings: [{ id: 'home-a', x: 8, y: 8, width: 8, height: 8, entrances: [{ x: 11, y: 8 }, { x: 11, y: 15 }] },
        { id: 'home-b', x: 8, y: 35, width: 8, height: 8, entrances: [{ x: 11, y: 35 }, { x: 11, y: 42 }] }],
      passages: [[{ x: 5, y: 25 }, { x: 58, y: 25 }], [{ x: 28, y: 25 }, { x: 28, y: 52 }]] }], props: [
      { id: 'bench', kind: 'bench', x: 22, y: 17, width: 1.5, height: .6, orientation: 'x' },
      { id: 'play', kind: 'playground', x: 34, y: 32, width: 2, height: 2, orientation: 'x' },
      { id: 'garden', kind: 'garden', x: 43, y: 15, width: 3, height: 2, orientation: 'x' },
      { id: 'bins', kind: 'dumpster', x: 50, y: 40, width: 2, height: 1, orientation: 'x' },
      { id: 'shop', kind: 'kiosk', x: 22, y: 42, width: 2, height: 2, orientation: 'x' },
      { id: 'tools', kind: 'workbench', x: 45, y: 45, width: 1.5, height: .6, orientation: 'x' },
    ] } as unknown as LiveWorld;
  const terrain = Array<LiveTerrain>(4096).fill('concrete'), walkable = new Uint8Array(4096).fill(1), indoor = new Uint8Array(4096);
  for (let x = 0; x < 64; x++) { terrain[29 * 64 + x] = 'water'; terrain[55 * 64 + x] = 'road'; }
  for (let y = 0; y < 64; y++) terrain[y * 64 + 40] = 'rail';
  for (let y = 5; y < 15; y++) for (let x = 45; x < 60; x++) terrain[y * 64 + x] = 'grass';
  for (let y = 38; y < 49; y++) for (let x = 50; x < 60; x++) terrain[y * 64 + x] = 'yard';
  for (const building of world.citySites![0]!.buildings) for (let y = building.y; y < building.y + building.height; y++) indoor.fill(1, y * 64 + building.x, y * 64 + building.x + building.width);
  const gardens: CityGardenGroundDetail[] = [{ x: 30, y: 17, width: 8, height: 3, axis: 'x', kind: 'flower-bed', seed: 3, sourceId: 'lived-yard',
    clip: [{ x: 30, y: 17, width: 8, height: 1 }, { x: 30, y: 18, width: 8, height: 1 }, { x: 30, y: 19, width: 8, height: 1 }] }];
  return { world, terrain, walkable, indoor, gardens };
}
const intersectsCell = (x: number, y: number, rect: { x: number; y: number; width: number; height: number }) => x < rect.x + rect.width && x + 1 > rect.x && y < rect.y + rect.height && y + 1 > rect.y;
const approach = (point: { x: number; y: number }, radius: number) => ({ x: point.x + .5 - radius, y: point.y + .5 - radius, width: radius * 2, height: radius * 2 });

test('courtyard plans follow real entries, passages and fixtures deterministically without repainting protected outdoor cells', () => {
  const f = fixture(), before = structuredClone(f), details = buildCourtyardGround(f.world, f.terrain, f.walkable, f.indoor, f.gardens);
  expect(details).toEqual(buildCourtyardGround(f.world, f.terrain, f.walkable, f.indoor, f.gardens)); expect(f).toEqual(before);
  expect(details.some(detail => detail.kind === 'entry-pad')).toBe(true); expect(details.some(detail => detail.kind === 'desire-line')).toBe(true);
  expect(details.some(detail => detail.kind === 'fixture-wear')).toBe(true); expect(details.some(detail => detail.kind === 'service-corner')).toBe(true);
  const forbidden = [...f.world.props!, ...f.world.citySites!.flatMap(site => site.buildings), ...f.gardens.flatMap(garden => garden.clip),
    ...f.world.containers.map(point => approach(point, 1.5)), ...f.world.extracts.map(point => approach(point, 3.5)), ...f.world.districts.flatMap(district => district.spawns.map(point => approach(point, 3)))];
  const seen = new Set<number>();
  for (const detail of details) {
    expect(detail.width).toBeLessThanOrEqual(14); expect(detail.height).toBeLessThanOrEqual(14); expect(detail.contour.length).toBeLessThanOrEqual(8);
    for (const run of detail.clip) for (let x = run.x; x < run.x + run.width; x++) {
      const cell = run.y * 64 + x;
      expect(['concrete', 'grass', 'yard', 'path', 'sand']).toContain(f.terrain[cell]!); expect(f.walkable[cell]).toBe(1); expect(f.indoor[cell]).toBe(0);
      expect(forbidden.some(rect => intersectsCell(x, run.y, rect))).toBe(false);
      if (detail.kind !== 'entry-pad') for (const door of f.world.citySites!.flatMap(site => site.buildings.flatMap(building => building.entrances))) expect(intersectsCell(x, run.y, approach(door, 1.4))).toBe(false);
      expect(seen.has(cell)).toBe(false); seen.add(cell);
    }
  }
  expect(buildCourtyardGround({ ...f.world, city: undefined }, f.terrain, f.walkable, f.indoor)).toEqual([]);
  expect(buildCourtyardGround(f.world, Array<LiveTerrain>(4096).fill('road'), f.walkable, f.indoor)).toEqual([]);
});

test('fixture traces disappear with their actual anchor and indoor furniture cannot invent an outdoor usage apron', () => {
  const f = fixture();
  for (const prop of f.world.props!) {
    const world = { ...f.world, props: [prop] }, details = buildCourtyardGround(world, f.terrain, f.walkable, f.indoor, f.gardens);
    expect(details.some(detail => detail.sourceId === prop.id)).toBe(true);
    expect(buildCourtyardGround({ ...world, props: [] }, f.terrain, f.walkable, f.indoor, f.gardens).some(detail => detail.sourceId === prop.id)).toBe(false);
  }
  const counter: LiveWorldProp = { id: 'interior-counter', kind: 'bench', x: 14, y: 14.8, width: 1, height: .6, orientation: 'x', variant: 0, blocking: false };
  expect(buildCourtyardGround({ ...f.world, props: [counter] }, f.terrain, f.walkable, f.indoor).some(detail => detail.sourceId === counter.id)).toBe(false);
});

test('entry pads use the exterior of existing doors and remnants never migrate onto natural lawns', () => {
  const f = fixture(), details = buildCourtyardGround(f.world, f.terrain, f.walkable, f.indoor, f.gardens);
  const pads = details.filter(detail => detail.kind === 'entry-pad');
  for (const pad of pads) {
    const building = f.world.citySites!.flatMap(site => site.buildings).find(building => building.id === pad.sourceId)!;
    expect(building).toBeDefined();
    expect(building.entrances.some(door => near(pad.center.x, door.x + .5) && near(Math.abs(pad.center.y - door.y - .5), 1.5)
      || near(pad.center.y, door.y + .5) && near(Math.abs(pad.center.x - door.x - .5), 1.5))).toBe(true);
    expect(pad.center.x < building.x || pad.center.x >= building.x + building.width || pad.center.y < building.y || pad.center.y >= building.y + building.height).toBe(true);
  }
  for (const detail of details.filter(detail => detail.kind === 'paving-remnant')) for (const run of detail.clip) for (let x = run.x; x < run.x + run.width; x++) expect(['concrete', 'yard']).toContain(f.terrain[run.y * 64 + x]!);
  const lawn = buildCourtyardGround(f.world, Array<LiveTerrain>(4096).fill('grass'), f.walkable, f.indoor);
  expect(lawn.some(detail => detail.kind === 'paving-remnant')).toBe(false);
  expect(lawn.filter(detail => detail.kind === 'entry-pad').every(detail => detail.finish === 'soil')).toBe(true);
});
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

test('a legacy six-wall roof envelope stays protected even when both floor raster and supplied indoor mask claim outdoor concrete', () => {
  const f = fixture(); f.world.citySites = []; f.world.props = []; f.indoor.fill(0); f.terrain.fill('concrete');
  f.world.pois = [{ id: 'hall', templateId: 'workshop', x: 16, y: 16, width: 28, height: 28, name: 'Мастерская', entrances: [] }] as unknown as LiveWorld['pois'];
  f.world.obstacles = [{ x: 20, y: 20, width: 7, height: 1, kind: 'wall' }, { x: 30, y: 20, width: 8, height: 1, kind: 'wall' },
    { x: 20, y: 31, width: 7, height: 1, kind: 'wall' }, { x: 30, y: 31, width: 8, height: 1, kind: 'wall' },
    { x: 20, y: 21, width: 1, height: 10, kind: 'wall' }, { x: 37, y: 21, width: 1, height: 10, kind: 'wall' }];
  const details = buildCourtyardGround(f.world, f.terrain, f.walkable, f.indoor);
  expect(details.some(detail => detail.kind === 'entry-pad' && detail.sourceId.startsWith('hall-'))).toBe(true);
  for (const detail of details) for (const run of detail.clip) for (let x = run.x; x < run.x + run.width; x++) expect(intersectsCell(x, run.y, { x: 20, y: 20, width: 18, height: 12 })).toBe(false);
});

test('cache and display passes share their physical clip, distinguish yard uses and never double the broad foundation', () => {
  const f = fixture(), details = buildCourtyardGround(f.world, f.terrain, f.walkable, f.indoor, f.gardens);
  let saves = 0, clipped = false, fills = 0, strokes = 0; const colors: string[] = [];
  const c = { fillStyle: '', strokeStyle: '', save() { saves++; clipped = false; }, restore() { saves--; }, beginPath() {}, rect() {}, clip() { clipped = true; }, closePath() {},
    moveTo(x: number, y: number) { expect(Number.isFinite(x + y)).toBe(true); }, lineTo(x: number, y: number) { expect(Number.isFinite(x + y)).toBe(true); },
    fill(this: { fillStyle: string }) { expect(clipped).toBe(true); colors.push(this.fillStyle); fills++; }, stroke() { expect(clipped).toBe(true); strokes++; },
  } as unknown as CanvasRenderingContext2D;
  for (const detail of details) paintCourtyardGroundDetail(c, detail, false);
  const cachedFills = fills;
  for (const detail of details) paintCourtyardGroundDetail(c, detail, true, false);
  expect(fills).toBe(cachedFills); expect(strokes).toBeGreaterThan(details.length); expect(saves).toBe(0);
  const pad = details.find(detail => detail.kind === 'entry-pad')!, uses = new Set<string>();
  for (const context of ['courtyard', 'workyard', 'service-yard', 'arcade'] as const) {
    paintCourtyardGroundDetail(c, { ...pad, context, finish: context === 'arcade' ? 'brick' : context === 'workyard' ? 'gravel' : 'slab' }, false);
    uses.add(colors.at(-1)!);
  }
  expect(uses.size).toBe(4);
});

test('dense valid-sized site input cannot exceed the world detail/run budget', () => {
  const f = fixture(), width = 512, height = 512;
  const sites: LiveCitySite[] = Array.from({ length: 256 }, (_, index) => {
    const x = index % 16 * 32, y = Math.floor(index / 16) * 32;
    return { ...f.world.citySites![0]!, id: `budget-yard-${index}`, x, y, width: 32, height: 32, courtyard: { x: x + 14, y: y + 3, width: 4, height: 26 }, buildings: [[4, 4], [20, 4], [4, 22], [20, 22]].map(([bx, by], i) => ({
      ...f.world.citySites![0]!.buildings[0]!, id: `budget-home-${index}-${i}`, x: x + bx!, y: y + by!, width: 5, height: 5, entrances: [{ x: x + bx! + 2, y: y + by! + (i < 2 ? 4 : 0) }],
    })), passages: [[{ x: x + 1, y: y + 16 }, { x: x + 30, y: y + 16 }], [{ x: x + 16, y: y + 1 }, { x: x + 16, y: y + 30 }]] };
  });
  const world = { ...f.world, width, height, city: { ...f.world.city!, x: 0, y: 0, width, height }, citySites: sites, props: [], pois: [], extracts: [], containers: [], districts: [] };
  const details = buildCourtyardGround(world, Array<LiveTerrain>(width * height).fill('concrete'), new Uint8Array(width * height).fill(1), new Uint8Array(width * height));
  expect(details.length).toBe(COURTYARD_ART_LIMITS.details); expect(details.reduce((sum, detail) => sum + detail.clip.length, 0)).toBeLessThanOrEqual(COURTYARD_ART_LIMITS.runs);
  expect(details.every(detail => detail.width <= COURTYARD_ART_LIMITS.maxSide && detail.height <= COURTYARD_ART_LIMITS.maxSide)).toBe(true);
}, 10_000);

test('complete metropolis receives coherent groups in every quarter without mutating public geometry or garden/tree reservations', () => {
  const world = LIVE_MAPS[0]!, before = JSON.stringify(world), terrain = world.terrainRows!.flatMap(row => [...row].map(code => LIVE_TERRAIN_CODES[code as keyof typeof LIVE_TERRAIN_CODES]));
  const walkable = new Uint8Array(world.width * world.height).fill(1);
  for (const obstacle of world.obstacles) for (let y = obstacle.y; y < obstacle.y + obstacle.height; y++) walkable.fill(0, y * world.width + obstacle.x, y * world.width + obstacle.x + obstacle.width);
  const masks = buildSurfaceMasks(world, terrain, walkable, sceneBuildings(world)), gardens = buildCityGardenGround(world, terrain, walkable, masks.indoor), gardenBefore = JSON.stringify(gardens);
  const details = buildCourtyardGround(world, terrain, walkable, masks.indoor, gardens), protectedBeds = new Set<number>();
  for (const garden of gardens) for (const run of garden.clip) for (let x = run.x; x < run.x + run.width; x++) protectedBeds.add(run.y * world.width + x);
  expect(details.length).toBeGreaterThan(1000); expect(details.length).toBeLessThanOrEqual(COURTYARD_ART_LIMITS.details);
  expect(new Set(details.map(detail => detail.kind)).size).toBe(5); expect(new Set(details.map(detail => detail.context)).size).toBe(4);
  expect(details.reduce((sum, detail) => sum + detail.clip.length, 0)).toBeLessThanOrEqual(COURTYARD_ART_LIMITS.runs);
  for (const quarter of world.city!.quarters) expect(details.some(detail => detail.center.x >= quarter.x && detail.center.y >= quarter.y && detail.center.x < quarter.x + quarter.width && detail.center.y < quarter.y + quarter.height)).toBe(true);
  for (const detail of details) for (const run of detail.clip) for (let x = run.x; x < run.x + run.width; x++) {
    const cell = run.y * world.width + x;
    expect(protectedBeds.has(cell)).toBe(false); expect(masks.indoor[cell]).toBe(0); expect(walkable[cell]).toBe(1); expect(['concrete', 'yard', 'grass', 'path', 'sand']).toContain(terrain[cell]!);
  }
  expect(JSON.stringify(world)).toBe(before); expect(JSON.stringify(gardens)).toBe(gardenBefore);
}, 10_000);
