import { expect, test } from 'bun:test';
import type { LiveWorldProp } from '../src/game/live';
import { PIXEL_PALETTE } from '../src/pixel-art';
import { TREE_ART_HEIGHT, treeCrownProfile } from '../src/pixel-plant-form';
import { distantPlantSurfaces } from '../src/live-distant-plants';

const plant: LiveWorldProp = { id: 'old-linden', kind: 'tree', x: 160.25, y: 770.5, width: 1.8, height: 1.8, variant: 0, orientation: 'x', blocking: false };

test('distant foliage stays finite, elevated, bounded and immutable across species and all plant types', () => {
  const colors = new Set<string>(Object.values(PIXEL_PALETTE));
  for (const kind of ['tree', 'shrub', 'planter', 'garden'] as const) for (let variant = 0; variant < 4; variant++) {
    const prop = { ...plant, kind, variant }, original = structuredClone(prop), surfaces = distantPlantSurfaces(prop);
    expect(surfaces.length).toBeGreaterThan(2); expect(surfaces.length).toBeLessThanOrEqual(12);
    expect(surfaces).toEqual(distantPlantSurfaces(prop)); expect(prop).toEqual(original);
    expect(surfaces.every(surface => colors.has(surface.color))).toBe(true);
    for (const surface of surfaces) {
      expect(surface.points.length).toBeGreaterThanOrEqual(3); expect(surface.points.length).toBeLessThanOrEqual(10);
      for (const p of surface.points) {
        expect([p.x, p.y, p.z].every(Number.isFinite)).toBe(true);
        expect(Math.abs(p.x - prop.x)).toBeLessThan(3); expect(Math.abs(p.y - prop.y)).toBeLessThan(3);
        expect(p.z).toBeGreaterThanOrEqual(0); expect(p.z).toBeLessThanOrEqual(TREE_ART_HEIGHT / 128);
      }
    }
  }
});

test('mature trees retain species silhouettes, raised crowns and trunks at the original half-cell art anchor', () => {
  const species = Array.from({ length: 4 }, (_, variant) => distantPlantSurfaces({ ...plant, variant }));
  expect(new Set(species.map(surfaces => JSON.stringify(surfaces))).size).toBe(4);
  for (const surfaces of species) {
    const trunk = surfaces[0]!, xs = trunk.points.map(p => p.x), ys = trunk.points.map(p => p.y);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(plant.x + plant.width / 2 - .5);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(plant.y + plant.height / 2 - .5);
    expect(Math.max(...surfaces.flatMap(surface => surface.points.map(p => p.z)))).toBeGreaterThan(2.7);
    expect(Math.max(...trunk.points.map(p => p.z))).toBe(treeCrownProfile(species.indexOf(surfaces)).trunk / 128);
  }
  const moved = distantPlantSurfaces({ ...plant, x: plant.x + 40, y: plant.y - 13 });
  expect(moved.map(surface => surface.points.map(p => p.z))).toEqual(species[0]!.map(surface => surface.points.map(p => p.z)));
  expect(moved[0]!.points[0]!.x - species[0]![0]!.points[0]!.x).toBeCloseTo(40);
  expect(moved[0]!.points[0]!.y - species[0]![0]!.points[0]!.y).toBeCloseTo(-13);
  expect(distantPlantSurfaces({ ...plant, kind: 'car' })).toEqual([]);
  expect(distantPlantSurfaces({ ...plant, x: Infinity })).toEqual([]);
});
