import { expect, test } from 'bun:test';
import type { LiveTerrain, LiveWorld } from '../src/game/live';
import { buildCityStreetGround, paintCityStreetGroundDetail } from '../src/live-city-streets';
import { buildRoadSurfacePlan, cityPedestrianCrossings, roadHasMarkings } from '../src/live-ground-art';

function fixture() {
  const world = { width: 32, height: 32, city: { x: 1, y: 1, width: 30, height: 30 }, paths: [
    { id: 'metro-river-avenue', kind: 'road', width: 5, points: [{ x: 8, y: 2 }, { x: 8, y: 29 }] },
  ], citySites: [{ id: 'quiet-court', passages: [[{ x: 20, y: 6 }, { x: 20, y: 24 }]] }], props: [
    { id: 'old-playground', kind: 'playground', x: 23, y: 9, width: 2, height: 2, orientation: 'x' },
    { id: 'corner-kiosk', kind: 'kiosk', x: 24, y: 18, width: 2, height: 2, orientation: 'x' },
    { id: 'flower-market', kind: 'market-stall', x: 27, y: 23, width: 1.5, height: 2, orientation: 'y' },
    { id: 'park-bench', kind: 'bench', x: 18, y: 18, width: 1.5, height: .6, orientation: 'x' },
  ] } as unknown as LiveWorld;
  const terrain = Array<LiveTerrain>(1024).fill('concrete'), walkable = new Uint8Array(1024).fill(1), indoor = new Uint8Array(1024);
  for (let y = 0; y < 32; y++) for (let x = 6; x <= 10; x++) terrain[y * 32 + x] = 'road';
  for (let x = 0; x < 32; x++) { terrain[8 * 32 + x] = 'water'; indoor[12 * 32 + x] = 1; walkable[16 * 32 + x] = 0; }
  return { world, terrain, walkable, indoor };
}

test('city pavement, real courtyard ways and play traces accept only existing free outdoor concrete', () => {
  const f = fixture(), before = structuredClone(f), details = buildCityStreetGround(f.world, f.terrain, f.walkable, f.indoor);
  expect(details.some(detail => detail.kind === 'pavement')).toBe(true);
  expect(details.some(detail => detail.kind === 'passage')).toBe(true);
  expect(details.some(detail => detail.kind === 'play-chalk')).toBe(true);
  expect(details.filter(detail => detail.kind === 'shop-apron')).toHaveLength(2);
  expect(details.filter(detail => detail.kind === 'bench-pad')).toHaveLength(1);
  expect(buildCityStreetGround(f.world, f.terrain, f.walkable, f.indoor)).toEqual(details);
  expect(f).toEqual(before);
  for (const detail of details) {
    expect(detail.width).toBeLessThanOrEqual(9); expect(detail.height).toBeLessThanOrEqual(9);
    for (const run of detail.clip) for (let x = run.x; x < run.x + run.width; x++) {
      const cell = run.y * 32 + x;
      expect(f.terrain[cell]).toBe('concrete'); expect(f.walkable[cell]).toBe(1); expect(f.indoor[cell]).toBe(0);
      expect(x).toBeGreaterThanOrEqual(1); expect(x).toBeLessThan(31); expect(run.y).toBeGreaterThanOrEqual(1); expect(run.y).toBeLessThan(31);
    }
  }
  expect(buildCityStreetGround({ ...f.world, city: undefined }, f.terrain, f.walkable, f.indoor)).toEqual([]);
  expect(buildCityStreetGround(f.world, Array<LiveTerrain>(1024).fill('grass'), f.walkable, f.indoor)).toEqual([]);
});

test('serving and seating aprons stay at the real furnishings and disappear with their public anchors', () => {
  const f = fixture(), details = buildCityStreetGround(f.world, f.terrain, f.walkable, f.indoor);
  const aprons = details.filter(detail => detail.kind === 'shop-apron' || detail.kind === 'bench-pad');
  expect(aprons).toHaveLength(3);
  expect(aprons.find(detail => detail.kind === 'shop-apron' && detail.normal.y === 1)?.a).toEqual({ x: 24.05, y: 20.36 });
  expect(aprons.find(detail => detail.kind === 'shop-apron' && detail.normal.x === -1)?.a).toEqual({ x: 28.86, y: 23.05 });
  expect(buildCityStreetGround({ ...f.world, props: [] }, f.terrain, f.walkable, f.indoor)
    .some(detail => detail.kind === 'shop-apron' || detail.kind === 'bench-pad')).toBe(false);
  // An interior market counter must not paint an outdoor serving place even
  // when a piece of public concrete happens to sit outside its containing wall.
  f.indoor[19 * 32 + 25] = 1;
  expect(buildCityStreetGround(f.world, f.terrain, f.walkable, f.indoor)
    .filter(detail => detail.kind === 'shop-apron')).toHaveLength(1);
  f.indoor.fill(1);
  expect(buildCityStreetGround(f.world, f.terrain, f.walkable, f.indoor)).toEqual([]);
});

test('native and cached street passes share an exact physical clip and do not leak canvas state', () => {
  const f = fixture(), details = buildCityStreetGround(f.world, f.terrain, f.walkable, f.indoor);
  let saves = 0, clipped = false, strokes = 0;
  const c = { save() { saves++; clipped = false; }, restore() { saves--; }, beginPath() {}, rect() {}, clip() { clipped = true; },
    moveTo(x: number, y: number) { expect(Number.isFinite(x + y)).toBe(true); }, lineTo(x: number, y: number) { expect(Number.isFinite(x + y)).toBe(true); },
    stroke() { expect(clipped).toBe(true); strokes++; },
  } as unknown as CanvasRenderingContext2D;
  for (const detail of details) for (const fine of [false, true]) paintCityStreetGroundDetail(c, detail, fine);
  expect(saves).toBe(0); expect(strokes).toBeGreaterThan(details.length * 2);
});

test('parking and stop markings use only the real paved pocket outside physical cover', () => {
  const f = fixture();
  const car = { id: 'street-park:avenue:1', kind: 'car' as const, x: 22, y: 20, width: 3, height: 1, orientation: 'x' as const, variant: 0, blocking: true };
  const stop = { ...car, id: 'street-stop:avenue:1', kind: 'bus-stop' as const, x: 17, y: 3, width: 4, height: 2 };
  f.world.props = [car, stop];
  for (const prop of f.world.props) for (let y = prop.y; y < prop.y + prop.height; y++) for (let x = prop.x; x < prop.x + prop.width; x++) f.walkable[y * 32 + x] = 0;
  const markings = buildCityStreetGround(f.world, f.terrain, f.walkable, f.indoor).filter(detail => detail.kind === 'parking-bay' || detail.kind === 'stop-pad');
  expect(markings.map(detail => detail.kind)).toEqual(['parking-bay', 'stop-pad']);
  for (const detail of markings) for (const run of detail.clip) for (let x = run.x; x < run.x + run.width; x++) {
    expect(f.walkable[run.y * 32 + x]).toBe(1); expect(f.terrain[run.y * 32 + x]).toBe('concrete');
  }
  f.terrain.fill('grass');
  expect(buildCityStreetGround(f.world, f.terrain, f.walkable, f.indoor).some(detail => detail.kind === 'parking-bay' || detail.kind === 'stop-pad')).toBe(false);
});

test('long streets retain bounded chunks and a finite world-level plan', () => {
  const f = fixture();
  f.world.paths = Array.from({ length: 5000 }, (_, id) => ({ id: `metro-repeated-${id}`, name: '', kind: 'road', width: 5, points: [{ x: 8, y: 2 }, { x: 8, y: 29 }] }));
  const details = buildCityStreetGround(f.world, f.terrain, f.walkable, f.indoor);
  expect(details.length).toBe(4096);
  expect(details.every(detail => detail.width <= 9 && detail.height <= 9 && detail.clip.length <= 9 * 9)).toBe(true);
});

test('major metropolitan avenues receive markings and crosswalks while narrow service routes stay quiet', () => {
  const path = (id: string, width: number, points: { x: number; y: number }[]) => ({ id, name: '', kind: 'road' as const, width, points });
  const paths = [path('metro-north-boulevard', 5, [{ x: 1, y: 10 }, { x: 28, y: 10 }]),
    path('metro-river-avenue', 4, [{ x: 14, y: 1 }, { x: 14, y: 28 }]),
    path('metro-loading-lane', 3, [{ x: 20, y: 1 }, { x: 20, y: 28 }])];
  const plan = buildRoadSurfacePlan(paths, new Uint8Array(32 * 32).fill(1), 32, 32);
  expect(roadHasMarkings(paths[0]!)).toBe(true); expect(roadHasMarkings(paths[1]!)).toBe(false); expect(roadHasMarkings(paths[2]!)).toBe(false);
  expect(cityPedestrianCrossings(plan)).toHaveLength(1);
  expect(cityPedestrianCrossings(plan)[0]).toMatchObject({ x: 14.5, y: 10.5 });
});
