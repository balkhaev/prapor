import { expect, test } from 'bun:test';
import { getShelterWetPatches, shelterWetPatchBounds, SHELTER_WET_PATCH_LIMIT } from '../src/shelter-wet-patches';
import { getShelterLandscape, type ShelterLandscape } from '../src/shelter-landscape';
import { getShelterBuildingRect, type ShelterLayoutBuilding } from '../src/shelter-layout';
import { projectShelterPoint } from '../src/shelter-isometric';
import { sampleWetSurfaces } from '../src/scene-wet-surfaces';

const sites = Array.from({ length: 3 }, (_, row) => Array.from({ length: 4 }, (_, column) => ({ row, column }))).flat();
const buildings: ShelterLayoutBuilding[] = Array.from({ length: 4 }, (_, column) => ({ column, row: 0, width: 1, height: 1 }));
const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test('wet patches are stable ground anchors with bounded count and leave real buildings and props dry', () => {
  for (const facing of [0, 1, 2, 3] as const) {
    const actual = [...buildings, { column: 1, row: 1, width: 2, height: 1, facing, position: { x: 240.5, y: 285.25 } }];
    const landscape = getShelterLandscape(sites, actual), before = structuredClone({ landscape, actual });
    const patches = getShelterWetPatches(landscape, actual);
    expect(patches.length).toBeGreaterThan(24); expect(patches.length).toBeLessThanOrEqual(SHELTER_WET_PATCH_LIMIT);
    expect(patches).toEqual(getShelterWetPatches({ ...landscape, lots: [...landscape.lots].reverse() }, [...actual].reverse()));
    for (const patch of patches) {
      const area = shelterWetPatchBounds(patch);
      for (const building of actual) {
        const rect = getShelterBuildingRect(building);
        expect(overlap(area, { x: rect.x - 5, y: rect.y - 5, width: rect.width + 10, height: rect.height + 10 })).toBe(false);
      }
      for (const prop of landscape.decorations) {
        const x = Math.max(area.x, Math.min(prop.point.x, area.x + area.width)), y = Math.max(area.y, Math.min(prop.point.y, area.y + area.height));
        expect(Math.hypot(prop.point.x - x, prop.point.y - y)).toBeGreaterThan(prop.radius + 3);
      }
    }
    expect({ landscape, actual }).toEqual(before);
  }
});

test('moving a building onto a former hollow removes it without shifting unaffected patch anchors', () => {
  const landscape = getShelterLandscape(sites, []), before = getShelterWetPatches(landscape, []);
  const target = before.find(patch => patch.material === 'soil')!, bounds = shelterWetPatchBounds(target);
  const moved = { column: 0, row: 0, width: 1, height: 1, facing: 1 as const, position: { x: bounds.x - 4, y: bounds.y - 4 } };
  const after = getShelterWetPatches(landscape, [moved]);
  expect(after.some(patch => patch.seed === target.seed)).toBe(false);
  const stable = after.filter(patch => before.some(old => old.seed === patch.seed)); expect(stable.length).toBeGreaterThan(10);
  for (const patch of stable) expect(patch).toEqual(before.find(old => old.seed === patch.seed)!);
});

test('a safe hollow beneath a real lamp catches only its actual reflected column', () => {
  const landscape: ShelterLandscape = { sites: [{ column: 0, row: 0 }], lots: [{ x: 30, y: 132, width: 192, height: 132 }], perimeter: [], paths: [], aprons: [], decorations: [] };
  const point = projectShelterPoint({ x: 130, y: 86 }), lamp = { ...point, headY: point.y - 30, radius: 55 };
  const patches = getShelterWetPatches(landscape, [], [lamp]);
  expect(patches.some(patch => patch.x === lamp.x && patch.y > lamp.y)).toBe(true);
  const input = { patches, lamps: [lamp], timeMs: Date.UTC(2026, 9, 15), wetness: 1, rain: 0, lights: 1.5, reducedMotion: true };
  expect(sampleWetSurfaces(input).marks.some(mark => mark.kind === 'reflection')).toBe(true);
  expect(sampleWetSurfaces({ ...input, lamps: [] }).marks.some(mark => mark.kind === 'reflection')).toBe(false);
  expect(sampleWetSurfaces({ ...input, wetness: 0 }).marks).toEqual([]);
});

test('an irregular yard never places wet ground in its unowned recess and large input retains the patch budget', () => {
  const landscape = getShelterLandscape([{ row: 0, column: 0 }, { row: 1, column: 0 }, { row: 1, column: 1 }], []);
  for (const patch of getShelterWetPatches(landscape, []).filter(patch => patch.material === 'soil')) {
    const area = shelterWetPatchBounds(patch);
    for (const x of [area.x, area.x + area.width]) for (const y of [area.y, area.y + area.height]) {
      expect(landscape.lots.some(lot => x >= lot.x && x <= lot.x + lot.width && y >= lot.y && y <= lot.y + lot.height)).toBe(true);
    }
  }
  expect(getShelterWetPatches({ ...landscape, lots: [{ x: 0, y: 132, width: 1e9, height: 1e9 }] }, []).length).toBeLessThanOrEqual(SHELTER_WET_PATCH_LIMIT);
  expect(getShelterWetPatches({ ...landscape, lots: [] }, [])).toEqual([]);
});
