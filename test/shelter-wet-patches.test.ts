import { expect, test } from 'bun:test';
import { getShelterWetPatches, shelterWetPatchBounds, SHELTER_WET_PATCH_LIMIT } from '../src/shelter-wet-patches';
import { getShelterLandscape, type ShelterLandscape } from '../src/shelter-landscape';
import { getShelterBuildingRect, type ShelterLayoutBuilding } from '../src/shelter-layout';
import { projectShelterPoint } from '../src/shelter-isometric';
import { sampleWetSurfaces } from '../src/scene-wet-surfaces';
import { createGame } from '../src/game/engine';
import { getRoomFacing, getRoomFootprint, getRoomPosition, getShelterSites } from '../src/game/shelter';
import { getShelterPorchLamp } from '../src/shelter-isometric-art';

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

test('the actual environment-preview starting base reflects both yard posts and every physical porch lamp', () => {
  // Match createGame-based environment-preview.ts and the source assembly in
  // scene.ts, including its real room footprints and generated outdoor lamps.
  const state = createGame(1792000000000), rooms = state.shelter.rooms;
  const buildings = rooms.map(room => ({ column: room.column, row: room.row, position: getRoomPosition(room), facing: getRoomFacing(room), ...getRoomFootprint(room) }));
  const landscape = getShelterLandscape(getShelterSites(state.shelter), buildings, state.shelter.expansions);
  const sources: { x: number; y: number; height: number; kind: string; label: string }[] = rooms.filter(room => room.status === 'ready').map(room => {
    const lamp = getShelterPorchLamp(room);
    return { ...projectShelterPoint(lamp.point), height: lamp.height, kind: 'lamp', label: room.type };
  });
  for (const prop of landscape.decorations) {
    const point = projectShelterPoint(prop.point);
    if (prop.kind === 'lamp') sources.push({ x: point.x + 7, y: point.y, height: 30, kind: 'lamp', label: 'yard' });
    else if (prop.kind === 'camp') sources.push({ ...point, height: 4, kind: 'fire', label: 'camp' });
  }
  const lamps = sources.slice(0, 32).map(source => ({ x: source.x, y: source.y, headY: source.y - source.height, radius: (source.kind === 'fire' ? 66 : 38 + source.height * 1.2) / 2 }));
  const patches = getShelterWetPatches(landscape, buildings, lamps);
  const input = { patches, lamps, timeMs: state.lastUpdated, wetness: 1, rain: .92, lights: 1.5 };
  const marks = sampleWetSurfaces(input).marks.filter(mark => mark.kind === 'reflection');
  expect(sources.filter(source => source.label === 'yard')).toHaveLength(2);
  expect(marks.length).toBeGreaterThanOrEqual(24); expect(marks.reduce((sum, mark) => sum + mark.width * mark.height, 0)).toBeGreaterThan(100);
  for (const [index, source] of sources.entries()) if (source.kind === 'lamp') {
    const reflected = sampleWetSurfaces({ ...input, lamps: [lamps[index]!] }).marks.filter(mark => mark.kind === 'reflection');
    expect(reflected.length, source.label).toBeGreaterThanOrEqual(2);
    expect(Math.max(...reflected.map(mark => mark.alpha)), source.label).toBeGreaterThan(source.label === 'yard' ? .12 : .04);
  }
  // The porch column falls on earth beside its narrow gravel apron. It must
  // retain the soil response instead of gaining an invented paved material.
  for (const source of sources.filter(source => source.height === 12)) {
    expect(patches.some(patch => patch.x === source.x && patch.y > source.y && patch.y <= source.y + 10 && patch.material === 'soil')).toBe(true);
  }
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
