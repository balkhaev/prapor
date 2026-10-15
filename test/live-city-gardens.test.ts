import { expect, test } from 'bun:test';
import type { LiveTerrain, LiveWorld } from '../src/game/live';
import { LIVE_TERRAIN_CODES } from '../src/game/live';
import { LIVE_MAPS } from '../src/game/live-maps';
import { buildSurfaceMasks } from '../src/live-ground-art';
import { sceneBuildings } from '../src/live-map-art';
import { buildCityGardenGround, cityGardenTrees, paintCityGardenGroundDetail, type CityGardenGroundDetail } from '../src/live-city-gardens';

function fixture() {
  const world = { width: 40, height: 40, city: { x: 1, y: 1, width: 38, height: 38 }, extracts: [{ x: 4, y: 4 }],
    containers: [{ x: 23, y: 23 }], obstacles: [{ x: 30, y: 2, width: 3, height: 35 }], districts: [], pois: [],
    paths: [{ kind: 'road', width: 3, points: [{ x: 12, y: 1 }, { x: 12, y: 38 }] }],
    citySites: [{ id: 'green-court', x: 3, y: 3, width: 33, height: 33, kind: 'courtyard', courtyard: { x: 3, y: 3, width: 33, height: 33 },
      buildings: [{ id: 'home', x: 3, y: 18, width: 6, height: 8, entrances: [{ x: 8, y: 22 }] }],
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
    moveTo(...numbers: number[]) { expect(numbers.every(Number.isFinite)).toBe(true); },
    lineTo(...numbers: number[]) { expect(numbers.every(Number.isFinite)).toBe(true); }, closePath() {},
    ellipse(...numbers: number[]) { expect(numbers.every(Number.isFinite)).toBe(true); },
    fillRect(...numbers: number[]) { expect(clipped).toBe(true); expect(numbers.every(Number.isFinite)).toBe(true); fills++; },
    fill() { expect(clipped).toBe(true); fills++; },
  } as unknown as CanvasRenderingContext2D;
  for (const detail of details) for (const fine of [false, true]) paintCityGardenGroundDetail(c, detail, fine);
  expect(saves).toBe(0); expect(fills).toBeGreaterThan(details.length * 6);
});

test('garden trees stay in safe planted cells, respect existing trees and leave gameplay data untouched', () => {
  const f = fixture(), before = structuredClone(f.world);
  const gardens = buildCityGardenGround(f.world, f.terrain, f.walkable, f.indoor);
  const trees = cityGardenTrees(f.world, gardens);
  expect(trees.length).toBeGreaterThanOrEqual(2);
  expect(trees.length).toBeLessThanOrEqual(4);
  expect(cityGardenTrees(f.world, gardens)).toEqual(trees);
  expect(f.world).toEqual(before);
  expect(cityGardenTrees(f.world, [])).toEqual([]);
  for (const tree of trees) {
    expect(tree.blocking).toBe(false);
    expect(tree.kind).toBe('tree');
    expect(f.world.props!.some(prop => prop.id === tree.id)).toBe(false);
    expect(gardens.some(garden => garden.sourceId === 'green-court' && garden.clip.some(run =>
      tree.x >= run.x && tree.x + tree.width <= run.x + run.width && tree.y >= run.y && tree.y + tree.height <= run.y + 1))).toBe(true);
    const center = { x: tree.x + tree.width / 2, y: tree.y + tree.height / 2 };
    for (const other of [...f.world.props!.filter(prop => prop.kind === 'tree'), ...trees.filter(prop => prop !== tree)]) {
      expect(Math.hypot(center.x - other.x - other.width / 2, center.y - other.y - other.height / 2)).toBeGreaterThan(2.5);
    }
  }
});

test('new metropolitan homes receive grouped garden borders with bounded shared geometry', () => {
  const world = LIVE_MAPS[0]!, terrain = world.terrainRows!.flatMap(row => [...row].map(code => LIVE_TERRAIN_CODES[code as keyof typeof LIVE_TERRAIN_CODES]));
  const walkable = Uint8Array.from(terrain, ground => +(ground !== 'water'));
  for (const obstacle of world.obstacles) for (let y = Math.floor(obstacle.y); y < obstacle.y + obstacle.height; y++) for (let x = Math.floor(obstacle.x); x < obstacle.x + obstacle.width; x++) walkable[y * world.width + x] = 0;
  const buildings = sceneBuildings(world), masks = buildSurfaceMasks(world, terrain, walkable, buildings), details = buildCityGardenGround(world, terrain, walkable, masks.indoor);
  const homes = world.citySites!.filter(site => site.quarterId === 'metro-southcenter');
  const homeGardens = details.filter(detail => homes.some(site => site.id === detail.sourceId));
  expect(homeGardens.length).toBeGreaterThan(20);
  expect(new Set(homeGardens.map(detail => detail.sourceId)).size).toBeGreaterThan(4);
  const outsideCourt = homeGardens.filter(detail => {
    const court = homes.find(site => site.id === detail.sourceId)!.courtyard;
    return detail.clip.some(run => run.x < court.x || run.x + run.width > court.x + court.width || run.y < court.y || run.y >= court.y + court.height);
  });
  expect(outsideCourt.length).toBeGreaterThan(10);
  const gardenTrees = cityGardenTrees(world, details);
  expect(gardenTrees.length).toBeGreaterThan(20);
  expect(gardenTrees.length).toBeLessThanOrEqual(256);
  expect(gardenTrees.some(tree => homes.some(site => tree.id.startsWith(`garden-tree:${site.id}:`)))).toBe(true);
  expect(details.length).toBeLessThanOrEqual(4096);
  expect(new Set(details.map(detail => detail.design)).size).toBe(6);
  expect(world.city!.quarters.every(quarter => details.some(detail => detail.x >= quarter.x && detail.x < quarter.x + quarter.width
    && detail.y >= quarter.y && detail.y < quarter.y + quarter.height))).toBe(true);
  expect(details.every(detail => detail.width <= 10 && detail.height <= 10 && detail.clip.length <= 11 * 11)).toBe(true);
  const planted = new Set<number>();
  for (const detail of details) for (const run of detail.clip) for (let x = run.x; x < run.x + run.width; x++) {
    const cell = run.y * world.width + x;
    expect(planted.has(cell)).toBe(false); planted.add(cell);
    expect(walkable[cell]).toBe(1); expect(masks.indoor[cell]).toBe(0);
    expect(['grass', 'forest', 'concrete', 'yard']).toContain(terrain[cell]!);
  }
});

test('planting follows the use of the yard and real furnishings instead of filling every free corner alike', () => {
  const profiles = new Map<string, Set<CityGardenGroundDetail['design']>>();
  for (const kind of ['courtyard', 'arcade', 'service-yard', 'workyard'] as const) {
    const f = fixture(); f.world.citySites![0]!.kind = kind;
    f.world.citySites![0]!.buildings[0] = { ...f.world.citySites![0]!.buildings[0]!, x: 19, y: 17, entrances: [{ x: 21, y: 24 }] };
    const details = buildCityGardenGround(f.world, f.terrain, f.walkable, f.indoor), site = f.world.citySites![0]!;
    const own = details.filter(detail => detail.sourceId === site.id);
    profiles.set(kind, new Set(own.map(detail => detail.design)));
    if (kind !== 'workyard') expect(own.length).toBeGreaterThan(1);
    const bench = f.world.props!.find(prop => prop.id === 'bench')!, border = details.find(detail => detail.sourceId === bench.id)!;
    expect(border.design).toBe('parterre'); expect(border.axis).toBe(bench.orientation);
    expect(border.y + border.height).toBeLessThanOrEqual(bench.y - .49);
    expect(details.find(detail => detail.sourceId === 'plot')?.design).toBe('allotment');
    for (const detail of own.filter(detail => detail.design === 'foundation')) {
      const house = site.buildings[0]!;
      const dx = Math.max(house.x - detail.x - detail.width, detail.x - house.x - house.width, 0);
      const dy = Math.max(house.y - detail.y - detail.height, detail.y - house.y - house.height, 0);
      expect(Math.hypot(dx, dy)).toBeLessThan(1); // the bed actually touches its house apron
    }
    const bare = buildCityGardenGround({ ...f.world, props: [] }, f.terrain, f.walkable, f.indoor);
    expect(bare.some(detail => detail.sourceId === 'bench' || detail.sourceId === 'plot')).toBe(false);
  }
  expect(profiles.get('courtyard')!.has('meadow')).toBe(true);
  expect(profiles.get('courtyard')!.has('parterre')).toBe(true);
  expect(profiles.get('arcade')).toEqual(new Set(['formal']));
  expect(profiles.get('workyard')!.has('parterre')).toBe(false);
  expect(profiles.get('workyard')!.has('formal')).toBe(false);
  expect(profiles.get('service-yard')!.has('hedge')).toBe(true);
});

test('a collider-defined legacy hall remains unplanted even when its open floor is absent from the supplied indoor mask', () => {
  const f = fixture(); f.terrain.fill('grass'); f.walkable.fill(1); f.indoor.fill(0);
  f.world.paths = []; f.world.extracts = []; f.world.containers = [];
  f.world.obstacles = [
    { x: 18, y: 6, width: 4, height: 1, kind: 'wall' }, { x: 24, y: 6, width: 5, height: 1, kind: 'wall' },
    { x: 18, y: 15, width: 4, height: 1, kind: 'wall' }, { x: 24, y: 15, width: 5, height: 1, kind: 'wall' },
    { x: 18, y: 6, width: 1, height: 10, kind: 'wall' }, { x: 28, y: 6, width: 1, height: 10, kind: 'wall' },
  ];
  f.world.pois = [{ id: 'legacy-greenhouse', templateId: 'greenhouse', x: 16, y: 4, width: 15, height: 14, entrances: [{ x: 22, y: 6 }] }] as LiveWorld['pois'];
  f.world.props = [{ id: 'bench-under-roof', kind: 'bench', x: 22, y: 10, width: 2, height: .6, orientation: 'x', variant: 0, blocking: false }];
  const before = structuredClone(f), details = buildCityGardenGround(f.world, f.terrain, f.walkable, f.indoor);
  expect(f.indoor[10 * 40 + 23]).toBe(0); expect(f.walkable[10 * 40 + 23]).toBe(1);
  const containsHallFloor = (detail: CityGardenGroundDetail) => detail.clip.some(run => run.y >= 6 && run.y < 16 && run.x < 29 && run.x + run.width > 18);
  expect(details.some(containsHallFloor)).toBe(false);
  expect(details.some(detail => detail.sourceId === 'bench-under-roof')).toBe(false);
  const open = buildCityGardenGround({ ...f.world, obstacles: [], pois: [] }, f.terrain, f.walkable, f.indoor);
  expect(open.some(containsHallFloor)).toBe(true); // the missing canopy guard would be observable
  for (const tree of cityGardenTrees(f.world, details)) expect(tree.x < 18 || tree.x >= 29 || tree.y < 6 || tree.y >= 16).toBe(true);
  expect(f).toEqual(before);
});

test('large planting contours stay coherent in the cache, with tiny blooms reserved for native detail and identical safe clips', () => {
  const sample: CityGardenGroundDetail = { x: 0, y: 0, width: 8, height: 4, kind: 'flower-bed', axis: 'x', seed: 127, sourceId: 'paint-review',
    clip: [{ x: 0, y: 0, width: 8, height: 1 }, { x: 0, y: 1, width: 8, height: 1 }, { x: 0, y: 2, width: 8, height: 1 }, { x: 0, y: 3, width: 8, height: 1 }] };
  const signatures = new Set<string>();
  for (const design of ['meadow', 'parterre', 'hedge', 'allotment', 'foundation', 'formal'] as const) {
    const detail = { ...sample, design }, paths: number[][][] = [], ellipses: number[][] = [], clips: number[][] = [];
    let active: number[][] = [], depth = 0, clipped = false;
    const c = { save() { depth++; clipped = false; }, restore() { depth--; }, beginPath() { active = []; },
      rect(...values: number[]) { clips.push(values); }, clip() { clipped = true; },
      moveTo(...values: number[]) { active.push(values); }, lineTo(...values: number[]) { active.push(values); }, closePath() {},
      ellipse(...values: number[]) { ellipses.push(values); }, fill() { expect(clipped).toBe(true); if (active.length) paths.push(active); },
    } as unknown as CanvasRenderingContext2D;
    paintCityGardenGroundDetail(c, detail, false);
    expect(ellipses).toHaveLength(0); expect(paths.length).toBeGreaterThanOrEqual(3);
    const broad = paths.map(path => JSON.stringify(path)), coarseClip = structuredClone(clips);
    signatures.add(JSON.stringify(paths)); paths.length = 0; clips.length = 0;
    paintCityGardenGroundDetail(c, detail, true);
    expect(clips).toEqual(coarseClip);
    expect(broad.every(path => paths.some(fine => JSON.stringify(fine) === path))).toBe(true);
    expect(paths.length).toBeGreaterThan(broad.length);
    if (design === 'parterre' || design === 'formal') expect(ellipses.length).toBeGreaterThan(10);
    for (const ellipse of ellipses) { expect(ellipse[2]).toBeLessThan(.06); expect(ellipse[3]).toBeLessThan(.06); }
    for (const path of paths) for (const p of path) {
      expect(p.every(Number.isFinite)).toBe(true);
      expect(p[0]).toBeGreaterThanOrEqual(0); expect(p[0]).toBeLessThanOrEqual(8);
      expect(p[1]).toBeGreaterThanOrEqual(0); expect(p[1]).toBeLessThanOrEqual(4);
    }
    expect(depth).toBe(0);
  }
  expect(signatures.size).toBe(6);
});
