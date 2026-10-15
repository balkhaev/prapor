import type { LivePoint, LiveWorldProp } from './game/live';
import { PIXEL_PALETTE as C, pixelSeed } from './pixel-art';
import { TREE_ART_MARGIN, treeCrownProfile } from './pixel-plant-form';

type ElevatedPoint = LivePoint & { z: number };
export type DistantPlantSurface = { points: ElevatedPoint[]; color: string };

/** Cheap, elevated foliage for the same public plant at walking-map zoom.
 * Coordinates are absolute (including the scene's half-cell art anchor).
 * The minimap still owns its separate, flat physical landcover footprints. */
export function distantPlantSurfaces(prop: LiveWorldProp): DistantPlantSurface[] {
  if (!['tree', 'shrub', 'planter', 'garden'].includes(prop.kind)) return [];
  const { width: w, height: h, variant } = prop;
  if (![prop.x, prop.y, w, h].every(Number.isFinite) || w <= 0 || h <= 0 || w > 10 || h > 10 || !Number.isInteger(variant) || variant < 0 || variant > 3) return [];
  const cx = prop.x + w / 2 - .5, cy = prop.y + h / 2 - .5, seed = pixelSeed(prop.id), result: DistantPlantSurface[] = [];
  const point = (sx: number, sy: number, z: number): ElevatedPoint => ({ x: cx + sx, y: cy + sy, z });
  const add = (points: ElevatedPoint[], color: string): void => { result.push({ points, color }); };
  // Billboards retain the same broad silhouette as the pixel model without
  // a screen-sized texture or a row of flat, obstacle-like ground rectangles.
  const crown = (sx: number, z: number, rx: number, ry: number, color: string, vertices = 10, rough = .04): void => {
    const points: ElevatedPoint[] = [];
    for (let i = 0; i < vertices; i++) {
      const angle = i * Math.PI * 2 / vertices, irregular = 1 + Math.sin(i * 2.1 + seed % 17) * rough;
      const dx = sx + Math.cos(angle) * rx * irregular;
      points.push(point(dx, -dx, z - Math.sin(angle) * ry * irregular));
    }
    add(points, color);
  };
  const plane = (u0: number, v0: number, u1: number, v1: number, z: number, color: string): void => {
    add([point((u0 - .5) * w, (v0 - .5) * h, z), point((u1 - .5) * w, (v0 - .5) * h, z),
      point((u1 - .5) * w, (v1 - .5) * h, z), point((u0 - .5) * w, (v1 - .5) * h, z)], color);
  };
  if (prop.kind === 'garden') {
    plane(.05, .05, .95, .95, .018, C.soil);
    for (let i = 0; i < 4; i++) plane(.1 + i * .21, .13, .22 + i * .21, .87, .055 + i % 2 * .012, i % 2 ? C.leaf : C.grass);
    plane(.08, .86, .93, .92, .025, C.woodLight);
    return result;
  }
  const tree = prop.kind === 'tree', birch = tree && variant === 2;
  const profile = treeCrownProfile(variant);
  if (prop.kind === 'planter') {
    plane(.08, .08, .92, .92, .11, C.concreteShade);
    plane(.08, .76, .92, .92, .15, C.plasterShade);
    plane(.08, .08, .92, .76, .15, C.soil);
  }
  if (tree) {
    const bark = birch ? C.cream : C.woodShade;
    const top = profile.trunk / 128;
    add([point(-.025, .025, .025), point(.025, -.025, .025), point(.025, -.025, top), point(-.025, .025, top)], bark);
    add([point(-.022, .022, .05), point(-.006, .006, .05), point(-.006, .006, top - .04), point(-.022, .022, top - .04)], birch ? C.plasterShade : C.wood);
  }
  const span = Math.max(12, (w + h) * 30) / 128;
  const lean = tree ? ((seed % 4) / 3 - .5) * span * .17 : 0;
  if (tree && variant === 3) {
    for (let level = 0; level < 4; level++) {
      const z = (profile.center + level * 74) / 128, radius = span * (profile.spread - level * .23);
      add([point(lean - radius, -lean + radius, z - .19), point(lean, -lean, z + 104 / 128), point(lean + radius, -lean - radius, z - .19)], C.leafShade);
      if (level < 3) add([point(lean - radius * .78, -lean + radius * .78, z - .04), point(lean, -lean, z + 100 / 128), point(lean + radius * .12, -lean - radius * .12, z + .025)], C.leaf);
    }
    return result;
  }
  const rx = tree ? Math.min(span * profile.spread, ((w + h) * 64 + TREE_ART_MARGIN * 2 + 1) / 256 - Math.abs(lean) - 16 / 128) : span * 1.06;
  const ry = tree ? profile.radiusY / 128 : prop.kind === 'planter' ? .17 : 24 / 128;
  const z = tree ? profile.center / 128 : prop.kind === 'planter' ? .29 : 25 / 128;
  crown(lean, z, rx * .95, ry * .95, C.leafShade);
  crown(lean - rx * .33, z + ry * .07, rx * .62, ry * .75, C.leaf);
  crown(lean + rx * .28, z + ry * .1, rx * .58, ry * .65, birch ? C.leafLight : C.leaf);
  crown(lean - rx * .18, z + ry * .38, rx * .53, ry * .47, C.leafLight, 8);
  crown(lean + rx * .38, z - ry * .34, rx * .34, ry * .33, C.leafShade, 8);
  if (birch) for (const side of [-1, 1]) {
    const dx = lean + side * rx * .61;
    add([point(dx - .07, -dx + .07, z - ry * .32), point(dx + .07, -dx - .07, z - ry * .32),
      point(dx + .025, -dx - .025, z - ry * .88)], C.leaf);
  }
  return result;
}
