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
  const face = (points: ShelterPoint[], color: number, alpha = 1) => g.fillStyle(color, alpha).fillPoints(points.map(projectShelterPoint), true);
  const strip = (top: number, bottom: number, color: number, alpha = 1) => face([{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }], color, alpha);
  const line = (points: ShelterPoint[], color: number, width: number, alpha: number) => g.lineStyle(width, color, alpha).strokePoints(points.map(projectShelterPoint), false);
  strip(17, 147, 0x5e6c49);
  strip(27, 138, 0x7c7e59);
  strip(36, 132, 0x9a957a);
  strip(SHELTER_ACCESS_ROAD.top, SHELTER_ACCESS_ROAD.bottom, 0x414e45);
  strip(43, 48, 0x2d4137, .55);
  strip(104, 110, 0x2d4137, .55);
  strip(57, 67, 0x617061, .13);
  strip(87, 97, 0x617061, .13);
  line([{ x: left, y: 110 }, { x: right, y: 110 }], 0x283e32, 1.2, .7);
  line([{ x: left, y: 42 }, { x: right, y: 42 }], 0xb0a788, .9, .48);
  // Absolute phase prevents broken centre lines or migrating patches as the camera pans.
  const dashStride = 47 * Math.max(1, Math.ceil((right - left) / (47 * 256)));
  for (let x = Math.floor(left / dashStride) * dashStride; x < right; x += dashStride) {
    const from = Math.max(left, x + 14), to = Math.min(x + 35, right);
    if (to > from) line([{ x: from, y: 76 }, { x: to, y: 76 }], 0xd5ceaa, 1.5, .55);
  }
  const detailStride = 113 * Math.max(1, Math.ceil((right - left) / (113 * 128)));
  for (let cell = Math.floor(left / detailStride); cell * detailStride < right; cell++) {
    const x = cell * detailStride + 27;
    if (x < left || x + 30 > right) continue;
    face([{ x, y: 54 }, { x: x + 27, y: 56 }, { x: x + 22, y: 70 }, { x: x - 3, y: 67 }], 0x273b35, .32);
    line([{ x: x + 3, y: 57 }, { x: x + 12, y: 61 }, { x: x + 9, y: 65 }], 0x859a9b, 1, .35);
    const gravelY = cell % 2 ? 119 : 33;
    for (let pebble = 0; pebble < 6; pebble++) {
      const at = projectShelterPoint({ x: x + pebble * 5, y: gravelY + (pebble % 3 - 1) * 2 });
      g.fillStyle(pebble % 2 ? 0xc1b18a : 0x706b51, .65).fillRect(Math.round(at.x), Math.round(at.y), 2, 1);
    }
    // Ragged grass follows the outside of the shoulder, leaving the carriageway clear.
    for (const y of [21, 142]) {
      const at = projectShelterPoint({ x: x + 41, y });
      g.lineStyle(1, cell % 2 ? 0x8a945e : 0x4e6241, .8)
        .lineBetween(Math.round(at.x), Math.round(at.y), Math.round(at.x - 2), Math.round(at.y - 3))
        .lineBetween(Math.round(at.x), Math.round(at.y), Math.round(at.x + 2), Math.round(at.y - 2));
    }
  }
}
