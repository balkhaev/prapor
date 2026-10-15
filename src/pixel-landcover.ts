import type { LivePoint } from './game/live';
import { pixelSeed } from './pixel-art';

export type LandcoverRect = LivePoint & { width: number; height: number };

/** A small stepped contour in the supplied footprint. Static art only; never cover or navigation. */
export function pixelLandcoverBands(bounds: LandcoverRect, identity: string, rows = 9): LandcoverRect[] {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return [];
  const count = Math.max(4, Math.min(12, Math.round(rows))), seed = pixelSeed(identity), bands: LandcoverRect[] = [];
  for (let row = 0; row < count; row++) {
    const t = (row + .5) / count * 2 - 1;
    const jitter = ((seed >>> (row % 7 * 4)) & 15) / 15;
    const span = Math.sqrt(Math.max(0, 1 - t * t)) * (.78 + jitter * .16);
    const shift = (((seed >>> (row % 6 * 4 + 1)) & 7) / 7 - .5) * .1;
    const left = Math.max(0, .5 + shift - span / 2), right = Math.min(1, .5 + shift + span / 2);
    bands.push({ x: bounds.x + bounds.width * left, y: bounds.y + bounds.height * row / count,
      width: bounds.width * (right - left), height: bounds.height / count });
  }
  return bands;
}

/** Clipped line/rectangle intersection also covers bends, diagonal roads and zero-length segments. */
export function segmentTouchesRect(a: LivePoint, b: LivePoint, box: LandcoverRect, padding = 0): boolean {
  if (Math.max(a.x, b.x) < box.x - padding || Math.min(a.x, b.x) > box.x + box.width + padding
    || Math.max(a.y, b.y) < box.y - padding || Math.min(a.y, b.y) > box.y + box.height + padding) return false;
  if (![a.x, a.y, b.x, b.y, box.x, box.y, box.width, box.height, padding].every(Number.isFinite) || box.width < 0 || box.height < 0 || padding < 0) return false;
  const dx = b.x - a.x, dy = b.y - a.y;
  let low = 0, high = 1;
  for (const [p, q] of [[-dx, a.x - box.x + padding], [dx, box.x + box.width + padding - a.x],
    [-dy, a.y - box.y + padding], [dy, box.y + box.height + padding - a.y]]) {
    if (p === 0) { if (q! < 0) return false; continue; }
    const t = q! / p!;
    if (p! < 0) low = Math.max(low, t); else high = Math.min(high, t);
    if (low > high) return false;
  }
  return true;
}
