import { expect, test } from 'bun:test';
import type { LiveWorldProp } from '../src/game/live';
import { distantStreetPropSurfaces } from '../src/live-distant-street-props';

test('street-map vehicles and stops keep elevated silhouettes inside the authoritative footprint at either rotation', () => {
  for (const kind of ['car', 'van', 'truck', 'bus', 'bus-stop'] as const) for (const orientation of ['x', 'y'] as const) for (let variant = 0; variant < 4; variant++) {
    const prop: LiveWorldProp = { id: kind, kind, x: 840, y: 132, width: orientation === 'x' ? 4 : 2, height: orientation === 'x' ? 2 : 4, orientation, variant, blocking: true };
    const before = structuredClone(prop), surfaces = distantStreetPropSurfaces(prop);
    expect(surfaces.length).toBeGreaterThan(10); expect(surfaces.length).toBeLessThanOrEqual(32);
    expect(surfaces.some(surface => surface.points.some(point => point.z >= (kind === 'bus-stop' ? 1 : .5)))).toBe(true);
    for (const surface of surfaces) for (const p of surface.points) {
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
      expect(p.x >= prop.x - .5 && p.x <= prop.x + prop.width - .5 && p.y >= prop.y - .5 && p.y <= prop.y + prop.height - .5).toBe(true);
      expect(p.z >= 0 && p.z <= 160 / 128).toBe(true);
    }
    expect(prop).toEqual(before);
    const moved = distantStreetPropSurfaces({ ...prop, x: 10, y: 20 });
    expect(moved.map(surface => surface.color)).toEqual(surfaces.map(surface => surface.color));
    moved.forEach((surface, i) => surface.points.forEach((point, j) => {
      const original = surfaces[i]!.points[j]!;
      expect(point.x + 830).toBeCloseTo(original.x, 8); expect(point.y + 112).toBeCloseTo(original.y, 8); expect(point.z).toBe(original.z);
    }));
  }
  expect(distantStreetPropSurfaces({ id: 'tree', kind: 'tree', x: 1, y: 1, width: 1, height: 1, orientation: 'x', variant: 0, blocking: false })).toEqual([]);
});
