import { expect, test } from 'bun:test';
import { paintBuildingAtmosphere, paintPropAtmosphere, type EnvironmentPixel } from '../src/pixel-environment';
import { pixelBuildingVentAnchor } from '../src/pixel-buildings';
import { roadSurfaceDetails, buildSurfaceMasks } from '../src/live-ground-art';
import { raidGroundSurface } from '../src/raid-ground-art';
import { createGame, dispatchRaid } from '../src/game/engine';
import { getRaidFieldPlan } from '../src/raid-field';
import type { LiveCityBuilding, LiveWorldProp } from '../src/game/live';

type Mark = Parameters<EnvironmentPixel>;
const marks = (paint: (plot: EnvironmentPixel) => void) => { const result: Mark[] = []; paint((...args) => result.push(args)); return result; };
const tree: LiveWorldProp = { id: 'tree-alder-7', x: 2, y: 3, width: 1, height: 1, kind: 'tree', variant: 2, orientation: 'x', blocking: true };
const workshop: LiveCityBuilding = { id: 'workshop-7', name: 'Цех', x: 4, y: 7, width: 5, height: 4, kind: 'workshop', entrances: [], facade: 'brick', roof: 'sawtooth', floors: 1 };

test('ambient pixels are bounded, deterministic and carry no state between paints', () => {
  const before = structuredClone(tree);
  for (const time of [0, 1700, 6600, 14000, NaN, Infinity]) {
    const first = marks(plot => paintPropAtmosphere(tree, time, plot));
    expect(first).toEqual(marks(plot => paintPropAtmosphere(tree, time, plot)));
    expect(first.length).toBeLessThanOrEqual(3);
    for (const mark of first) { expect(mark.slice(0, 4).every(Number.isFinite)).toBe(true); expect(mark[5]).toBeGreaterThanOrEqual(0); expect(mark[5]).toBeLessThanOrEqual(1); }
  }
  expect(tree).toEqual(before);
  expect(marks(plot => paintPropAtmosphere(tree, 0, plot))).not.toEqual(marks(plot => paintPropAtmosphere(tree, 3200, plot)));
});

test('reduced motion suppresses leaves and steam while a lamp retains a steady light', () => {
  expect(marks(plot => paintPropAtmosphere(tree, 3200, plot, true))).toEqual([]);
  expect(marks(plot => paintBuildingAtmosphere(workshop, 3200, plot, true))).toEqual([]);
  const lamp = { ...tree, kind: 'lamp' as const, variant: 1 };
  const first = marks(plot => paintPropAtmosphere(lamp, 0, plot, true));
  expect(first).toHaveLength(4); expect(first).toEqual(marks(plot => paintPropAtmosphere(lamp, 8000, plot, true)));
});

test('steam belongs to the authored outlet and never appears on an unrelated roof', () => {
  expect(pixelBuildingVentAnchor(workshop)).not.toBeNull();
  const emitted = marks(plot => paintBuildingAtmosphere(workshop, 3200, plot));
  expect(emitted).toHaveLength(8);
  expect(emitted.every(mark => mark[5] <= .17 && mark.slice(0, 4).every(Number.isFinite))).toBe(true);
  expect(marks(plot => paintBuildingAtmosphere({ ...workshop, kind: 'garage' }, 3200, plot))).toEqual([]);
});

test('road wear samples every part of a large surface while respecting physical exclusion masks', () => {
  const world = { width: 128, height: 128, seed: 'maintenance-check' }, terrain = Array<'road' | 'water'>(128 * 128).fill('road'), walkable = new Uint8Array(128 * 128).fill(1);
  for (let y = 0; y < 128; y++) for (let x = 50; x < 70; x++) { terrain[y * 128 + x] = 'water'; walkable[y * 128 + x] = 0; }
  const mask = buildSurfaceMasks(world, terrain, walkable, [{ x: 85, y: 85, width: 20, height: 20 }]), before = mask.road.slice();
  const details = roadSurfaceDetails(world, mask);
  expect(details).toEqual(roadSurfaceDetails(world, mask)); expect(mask.road).toEqual(before);
  expect(details.some(item => item.y < 20)).toBe(true); expect(details.some(item => item.y > 108)).toBe(true);
  expect(details.some(item => item.kind === 'drain')).toBe(true); expect(details.some(item => item.kind === 'repair')).toBe(true);
  expect(details.length).toBeLessThan(128 * 128 / 20);
  for (const item of details) expect(mask.road[Math.floor(item.y) * 128 + Math.floor(item.x)]).toBe(1);
});

test('legacy raid paving retains every authored cell and does not rewrite a paid route', () => {
  const state = createGame(1792000000000); dispatchRaid(state, state.scavs[0]!.id, 'courtyard', 1792000000000);
  const plan = getRaidFieldPlan(state.raids[0]!), before = structuredClone(plan), surface = raidGroundSurface(plan);
  for (const tile of plan.tiles) expect(surface.terrain[tile.y * plan.width + tile.x]).toBe(tile.kind === 'street' ? 'road' : tile.kind === 'sidewalk' ? 'concrete' : 'grass');
  expect(surface.world.paths!.length).toBeGreaterThan(0); expect(plan).toEqual(before);
  const forest = raidGroundSurface({ ...plan, mapId: 'forest' });
  expect(forest.terrain).not.toContain('road'); expect(forest.terrain).not.toContain('concrete');
  expect(forest.world.paths!.every(path => path.kind === 'trail')).toBe(true);
});
