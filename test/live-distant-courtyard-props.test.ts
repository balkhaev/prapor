import { expect, test } from 'bun:test';
import type { LiveWorldProp } from '../src/game/live';
import { distantStreetPropSurfaces } from '../src/live-distant-street-props';
import { pixelPropHeight } from '../src/pixel-props';
import { buildWorldGroundShadowCasters, DEFAULT_GROUND_SHADOW_LIGHT, projectGroundShadowPart } from '../src/live-ground-shadows';

const sizes = { bench: [1.5, .6], fence: [2, .2], playground: [2, 2] } as const;
function furniture(kind: keyof typeof sizes, variant: number, orientation: 'x' | 'y'): LiveWorldProp {
  const [long, cross] = sizes[kind];
  return { id: `court-${kind}`, kind, variant, orientation, x: 310, y: 690,
    width: orientation === 'x' ? long : cross, height: orientation === 'x' ? cross : long, blocking: false };
}

test('distant courtyard furniture keeps open elevated silhouettes, finite visible rails and the real footprint', () => {
  for (const kind of ['bench', 'fence', 'playground'] as const) for (const orientation of ['x', 'y'] as const) for (let variant = 0; variant < 4; variant++) {
    const prop = furniture(kind, variant, orientation), before = structuredClone(prop), surfaces = distantStreetPropSurfaces(prop);
    expect(surfaces.length).toBeGreaterThan(7); expect(surfaces.length).toBeLessThanOrEqual(32);
    expect(surfaces.some(s => s.points.some(p => p.z > .2))).toBe(true);
    for (const surface of surfaces) {
      expect(surface.points.length).toBeGreaterThanOrEqual(3);
      for (const p of surface.points) {
        expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
        expect(p.x >= prop.x - .5 && p.x <= prop.x + prop.width - .5 && p.y >= prop.y - .5 && p.y <= prop.y + prop.height - .5).toBe(true);
        expect(p.z >= 0 && p.z <= pixelPropHeight(kind) / 128).toBe(true);
      }
      // Project the model's planes as LiveScene does. Vertical posts must have
      // actual width; a collinear four-point "rail" disappears at map scale.
      const points = surface.points.map(p => ({ x: (p.x - p.y) / 2, y: (p.x + p.y) / 4 - p.z }));
      const area = Math.abs(points.reduce((sum, p, i) => {
        const next = points[(i + 1) % points.length]!;
        return sum + p.x * next.y - next.x * p.y;
      }, 0)) / 2;
      expect(area).toBeGreaterThan(1e-8);
      expect(surface.points.every(p => p.z === 0)).toBe(false);
    }
    expect(prop).toEqual(before);
    const moved = distantStreetPropSurfaces({ ...prop, x: prop.x + 20, y: prop.y - 30 });
    moved.forEach((surface, i) => surface.points.forEach((p, j) => {
      const original = surfaces[i]!.points[j]!;
      expect(p.x - original.x).toBeCloseTo(20, 8); expect(p.y - original.y).toBeCloseTo(-30, 8); expect(p.z).toBe(original.z);
    }));
  }
});

test('courtyard variants retain distinct forms through the native-to-distant transition', () => {
  for (const kind of ['bench', 'fence', 'playground'] as const) {
    const variants = Array.from({ length: 4 }, (_, i) => distantStreetPropSurfaces(furniture(kind, i, 'x')));
    expect(new Set(variants.map(s => JSON.stringify(s))).size).toBe(4);
  }
  const height = (variant: number) => Math.max(...distantStreetPropSurfaces(furniture('playground', variant, 'x')).flatMap(s => s.points.map(p => p.z * 128)));
  expect(height(0)).toBe(125); expect(height(1)).toBe(108); expect(height(2)).toBe(131); expect(height(3)).toBe(56);
  const bench = (variant: number) => Math.max(...distantStreetPropSurfaces(furniture('bench', variant, 'x')).flatMap(s => s.points.map(p => p.z * 128)));
  expect(bench(3)).toBeLessThan(bench(0));
});

test('invalid distant furniture never introduces nonfinite or oversized art', () => {
  const prop = furniture('bench', 0, 'x');
  for (const patch of [{ x: NaN }, { width: Infinity }, { height: -1 }, { width: 11 }, { variant: .5 }, { variant: 4 }])
    expect(distantStreetPropSurfaces({ ...prop, ...patch })).toEqual([]);
});

test('courtyard shadows follow the open furniture and each playground height instead of an opaque tall box', () => {
  const terrain = Array(64 * 64).fill('concrete'), indoor = new Uint8Array(terrain.length);
  for (const kind of ['bench', 'fence', 'playground'] as const) for (const orientation of ['x', 'y'] as const) {
    const props = Array.from({ length: 4 }, (_, variant) => ({ ...furniture(kind, variant, orientation), id: `${kind}-${variant}`, x: 20, y: 20 }));
    const casters = buildWorldGroundShadowCasters({ width: 64, height: 64, props }, [], terrain, indoor);
    expect(casters).toHaveLength(4);
    for (const caster of casters) {
      expect(caster.parts.length).toBeGreaterThan(7); expect(caster.parts.length).toBeLessThanOrEqual(32);
      expect(caster.elevation).toBeLessThanOrEqual(pixelPropHeight(kind) / 128);
      for (const part of caster.parts) for (const p of projectGroundShadowPart(part, DEFAULT_GROUND_SHADOW_LIGHT)) {
        expect(p.x >= caster.x - .00001 && p.x <= caster.x + caster.width + .00001).toBe(true);
        expect(p.y >= caster.y - .00001 && p.y <= caster.y + caster.height + .00001).toBe(true);
      }
    }
    if (kind === 'playground') {
      expect(casters[3]!.elevation).toBeCloseTo(56 / 128, 6);
      expect(casters[3]!.elevation).toBeLessThan(casters[2]!.elevation / 2);
      expect(casters[0]!.contact[2]! - casters[0]!.contact[0]!).toBeLessThan(.1);
    }
  }
});
