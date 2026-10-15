import type Phaser from 'phaser';
import type { ShelterRect } from './shelter-camera';
import { projectShelterPoint, unprojectShelterPoint } from './shelter-isometric';
import type { ShelterPoint } from './shelter-motion';

/** The public road passes the existing gate; it is scenery, never extra buildable land. */
export const SHELTER_ACCESS_ROAD = { top: 43, bottom: 110, centre: 76, shoulderBottom: 132 } as const;

export function getShelterAccessRoadSpan(coverage: ShelterRect): { left: number; right: number } {
  const corners = [
    { x: coverage.x, y: coverage.y }, { x: coverage.x + coverage.width, y: coverage.y },
    { x: coverage.x + coverage.width, y: coverage.y + coverage.height }, { x: coverage.x, y: coverage.y + coverage.height },
  ].map(unprojectShelterPoint);
  return { left: Math.floor((Math.min(...corners.map(point => point.x)) - 192) / 192) * 192,
    right: Math.ceil((Math.max(...corners.map(point => point.x)) + 192) / 192) * 192 };
}

export function isShelterAccessRoadClear(point: ShelterPoint, radius: number): boolean {
  return point.y + radius < SHELTER_ACCESS_ROAD.top - 13 || point.y - radius > SHELTER_ACCESS_ROAD.shoulderBottom + 12;
}

/** The same world-anchored surface paints the gate frontage and its distant continuation. */
export function paintShelterAccessRoad(g: Phaser.GameObjects.Graphics, left: number, right: number): void {
  if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) return;
  const clip = (points: ShelterPoint[], edge: number, after: boolean): ShelterPoint[] => {
    const result: ShelterPoint[] = [];
    for (let i = 0; i < points.length; i++) {
      const from = points[(i + points.length - 1) % points.length]!, to = points[i]!;
      const fromInside = after ? from.x >= edge : from.x <= edge, toInside = after ? to.x >= edge : to.x <= edge;
      if (fromInside !== toInside) result.push({ x: edge, y: from.y + (to.y - from.y) * (edge - from.x) / (to.x - from.x) });
      if (toInside) result.push(to);
    }
    return result;
  };
  const face = (points: ShelterPoint[], color: number, alpha = 1) => {
    const clipped = clip(clip(points, left, true), right, false);
    if (clipped.length > 2) g.fillStyle(color, alpha).fillPoints(clipped.map(projectShelterPoint), true);
  };
  const strip = (top: number, bottom: number, color: number, alpha = 1) => face([{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }], color, alpha);
  const line = (points: ShelterPoint[], color: number, width: number, alpha: number) => {
    g.lineStyle(width, color, alpha);
    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1]!, to = points[i]!;
      if (to.x < left || from.x > right) continue;
      const start = Math.max(left, from.x), end = Math.min(right, to.x);
      if (end <= start) continue;
      const at = (x: number) => projectShelterPoint({ x, y: from.y + (to.y - from.y) * (x - from.x) / (to.x - from.x) });
      const a = at(start), b = at(end); g.lineBetween(a.x, a.y, b.x, b.y);
    }
  };
  const hash = (cell: number, salt = 0) => (Math.imul(cell + 173, 73856093) ^ Math.imul(salt + 73, 19349663)) >>> 0;
  // Long, low-contrast verges grow into the clearing. Their irregular outlines
  // use absolute coordinates, so the frontage and its continuation join exactly.
  const vergeEdge = (x: number, salt: number) => {
    const cell = Math.floor(x / 192), t = x / 192 - cell;
    return ((hash(cell, salt) % 101) * (1 - t) + (hash(cell + 1, salt) % 101) * t) / 50 - 1;
  };
  const vergeStride = 96 * Math.max(1, 2 ** Math.ceil(Math.log2((right - left) / (96 * 512))));
  const samples = [left];
  for (let x = (Math.floor(left / vergeStride) + 1) * vergeStride; x < right; x += vergeStride) samples.push(x);
  samples.push(right);
  const verge = (top: (x: number) => number, bottom: (x: number) => number, color: number) => face([
    ...samples.map(x => ({ x, y: top(x) })), ...[...samples].reverse().map(x => ({ x, y: bottom(x) })),
  ], color);
  verge(x => 13 + vergeEdge(x, 1) * 13, x => 148 + vergeEdge(x, 2) * 9, 0x5e6b4e);
  verge(x => 30 + vergeEdge(x, 3) * 9, x => 131 + vergeEdge(x, 4) * 7, 0x6b7256);
  verge(x => 38 + vergeEdge(x, 5) * 3, x => 120 + vergeEdge(x, 6) * 5, 0x82816b);
  strip(SHELTER_ACCESS_ROAD.top, SHELTER_ACCESS_ROAD.bottom, 0x414e45);
  strip(43, 46, 0x2d4137, .32);
  strip(107, 110, 0x2d4137, .35);
  strip(58, 67, 0x617061, .09);
  strip(88, 97, 0x617061, .09);
  // Absolute phase prevents broken centre lines or migrating patches as the camera pans.
  const dashStride = 47 * Math.max(1, Math.ceil((right - left) / (47 * 256)));
  for (let x = Math.floor(left / dashStride) * dashStride; x < right; x += dashStride) {
    const seed = hash(Math.floor(x / 47), 7);
    const from = Math.max(left, x + 14), to = Math.min(x + 35, right);
    if (to > from) line([{ x: from, y: 76 }, { x: to, y: 76 }], 0xc6c1a2, 1.25, seed % 5 === 0 ? .16 : .39);
  }
  const detailStride = 384 * Math.max(1, Math.ceil((right - left) / (384 * 96)));
  for (let cell = Math.floor(left / detailStride) - 1; cell * detailStride < right; cell++) {
    const seed = hash(cell, 8), x = cell * detailStride + 49 + seed % 137;
    if (x + 136 < left || x > right) continue;
    // Isolated repairs and worn lay-bys avoid an evenly dotted roadside.
    const y = 54 + (seed >>> 9) % 24, width = 43 + (seed >>> 17) % 57;
    face([{ x, y: y + 3 }, { x: x + width * .3, y }, { x: x + width, y: y + 5 },
      { x: x + width - 6, y: y + 12 }, { x: x + width * .2, y: y + 14 }], 0x2f4038, .2);
    if (seed % 3 === 0) line([{ x: x + 12, y: y + 5 }, { x: x + 31, y: y + 7 }, { x: x + 39, y: y + 12 }], 0x879080, .7, .24);
    const gravelY = seed % 2 ? 119 : 35;
    for (let pebble = 0; pebble < 3; pebble++) {
      const at = projectShelterPoint({ x: x + 23 + pebble * 7, y: gravelY + (pebble % 3 - 1) * 2 });
      if (x + 23 + pebble * 7 < left || x + 23 + pebble * 7 > right) continue;
      g.fillStyle(pebble % 2 ? 0xa19b7d : 0x6b7159, .5).fillRect(Math.round(at.x), Math.round(at.y), 2, 1);
    }
    if (seed % 4 === 0) {
      const side = seed % 2 ? 1 : -1, edge = side > 0 ? 110 : 43;
      face([{ x: x + 38, y: edge }, { x: x + 72, y: edge }, { x: x + 104, y: edge + side * 18 },
        { x: x + 83, y: edge + side * 27 }, { x: x + 55, y: edge + side * 16 }], 0x77785d, .75);
      for (const offset of [0, 12]) line([{ x: x + 48 + offset, y: edge + side * 3 },
        { x: x + 74 + offset, y: edge + side * 18 }], 0x525f47, 1.5, .33);
    }
  }
}
