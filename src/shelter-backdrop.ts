import type Phaser from 'phaser';
import type { ShelterCamera, ShelterRect, ShelterViewport } from './shelter-camera';
import { projectShelterPoint, unprojectShelterPoint } from './shelter-isometric';
import type { ShelterLandscapeDecoration } from './shelter-landscape';
import { PIXEL_PALETTE as P } from './pixel-art';
import { getShelterAccessRoadSpan, paintShelterAccessRoad } from './shelter-road';
import { getShelterForestDecorations, getShelterForestNearBounds, isShelterForestPointInBounds, sampleShelterForest } from './shelter-forest';

export const SHELTER_BACKDROP_TILE = 512;
const CHUNK = 256;
const pigment = (value: string) => Number.parseInt(value.slice(1), 16);
const hash = (x: number, y: number) => (Math.imul(x + 1357, 73856093) ^ Math.imul(y + 2461, 19349663)) >>> 0;

/** Paint coverage is independent of ownership, navigation bounds and the saved camera. */
export function getShelterBackdropCoverage(camera: ShelterCamera, viewport: ShelterViewport, worldBounds: ShelterRect): ShelterRect {
  const left = Math.floor((Math.min(camera.x, worldBounds.x) - 96) / CHUNK) * CHUNK;
  const top = Math.floor((Math.min(camera.y, worldBounds.y) - 96) / CHUNK) * CHUNK;
  const right = Math.ceil((Math.max(camera.x + viewport.width / camera.zoom, worldBounds.x + worldBounds.width) + 96) / CHUNK) * CHUNK;
  const bottom = Math.ceil((Math.max(camera.y + viewport.height / camera.zoom, worldBounds.y + worldBounds.height) + 96) / CHUNK) * CHUNK;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The distant grove is presentation only and never joins the resident activity/prop lists. */
export function getShelterBackdropDecorations(coverage: ShelterRect, worldBounds: ShelterRect, lots: readonly ShelterRect[] = [], reserved: readonly ShelterRect[] = []): ShelterLandscapeDecoration[] {
  const corners = [{ x: coverage.x - 100, y: coverage.y - 40 }, { x: coverage.x + coverage.width + 100, y: coverage.y - 40 },
    { x: coverage.x - 100, y: coverage.y + coverage.height + 145 }, { x: coverage.x + coverage.width + 100, y: coverage.y + coverage.height + 145 }].map(unprojectShelterPoint);
  const x = Math.min(...corners.map(point => point.x)), y = Math.min(...corners.map(point => point.y));
  const logical = { x, y, width: Math.max(...corners.map(point => point.x)) - x, height: Math.max(...corners.map(point => point.y)) - y };
  const near = getShelterForestNearBounds(lots);
  const visible = getShelterForestDecorations(logical, lots, reserved, 4096).filter(decoration => {
    const point = projectShelterPoint(decoration.point);
    if (point.x < coverage.x - 75 || point.x > coverage.x + coverage.width + 75 || point.y < coverage.y - 20 || point.y > coverage.y + coverage.height + 140) return false;
    if (lots.length) return !isShelterForestPointInBounds(decoration.point, near);
    // Old standalone callers have no territory model. Keep their authored
    // rectangle intact; the actual scene uses the shared exact partition.
    return !(point.x + 56 > worldBounds.x && point.x - 56 < worldBounds.x + worldBounds.width && point.y + 80 > worldBounds.y && point.y - 80 < worldBounds.y + worldBounds.height);
  });
  // Selection remains deterministic; painting order follows the feet so one
  // dense grove has genuine overlapping depth instead of seed-sorted crowns.
  return visible.slice(0, 1024).sort((a, b) => projectShelterPoint(a.point).y - projectShelterPoint(b.point).y);
}

export interface ShelterBackdropGroundPatch { x: number; y: number; width: number; height: number; seed: number }

/** Broad patches use a different, much larger phase than the small repeating grass texture. */
export function getShelterBackdropGroundPatches(coverage: ShelterRect): ShelterBackdropGroundPatch[] {
  const spacing = 224, patches: ShelterBackdropGroundPatch[] = [];
  for (let row = Math.floor(coverage.y / spacing) - 1; row <= Math.ceil((coverage.y + coverage.height) / spacing); row++) {
    for (let column = Math.floor(coverage.x / spacing) - 1; column <= Math.ceil((coverage.x + coverage.width) / spacing); column++) {
      const seed = hash(column + 503, row - 251);
      patches.push({ x: column * spacing + (seed % 83) - 25, y: row * spacing + (seed >>> 9) % 91 - 20,
        width: 115 + (seed >>> 15) % 132, height: 35 + (seed >>> 22) % 65, seed });
    }
  }
  return patches.sort((a, b) => a.seed - b.seed).slice(0, 160);
}

/** Continuous earth, meadow and forest litter make the outer grove part of the same terrain. */
export function paintShelterBackdropTerrain(g: Phaser.GameObjects.Graphics, coverage: ShelterRect, _decorations: readonly ShelterLandscapeDecoration[] = [], lots: readonly ShelterRect[] = [], reserved: readonly ShelterRect[] = []): void {
  // The soil follows the very same grove/clearing field as the trees. Low
  // contrast contours form connected woodland floors rather than a separate
  // dark pedestal under each trunk. Shared vertex colours keep sampling cells
  // invisible: only the crisp vegetation should have a stepped silhouette.
  let step = 32;
  while ((Math.ceil(coverage.width / step) + 2) * (Math.ceil(coverage.height / step) + 2) > 16000) step *= 2;
  const left = Math.floor(coverage.x / step) * step, right = coverage.x + coverage.width;
  const colorAt = (x: number, y: number): number => {
    const field = sampleShelterForest(unprojectShelterPoint({ x, y }), lots, reserved);
    const density = field.density, damp = field.moisture;
    const green = [102 - damp * 6, 113 - damp * 3, 77 + damp * 3];
    const wood = [48 - damp * 2, 71 + damp * 2, 59 + damp * 4];
    const channels = green.map((value, i) => Math.round(value * (1 - density * .87) + wood[i]! * density * .87));
    return channels[0]! << 16 | channels[1]! << 8 | channels[2]!;
  };
  const gradient = g.scene?.game?.renderer?.type === 2;
  const mix = (a: number, b: number, t: number): number => {
    const channel = (shift: number) => Math.round((a >>> shift & 255) * (1 - t) + (b >>> shift & 255) * t);
    return channel(16) << 16 | channel(8) << 8 | channel(0);
  };
  for (let y = Math.floor(coverage.y / step) * step; y < coverage.y + coverage.height; y += step) {
    let topLeft = colorAt(left, y), bottomLeft = colorAt(left, y + step);
    for (let x = left; x < right; x += step) {
      const topRight = colorAt(x + step, y), bottomRight = colorAt(x + step, y + step);
      if (gradient) g.fillGradientStyle(topLeft, topRight, bottomLeft, bottomRight, .88).fillRect(x, y, step, step);
      else {
        // Canvas has no Graphics gradient command. Four small colour steps
        // preserve the same quiet field without a new bitmap or full-screen blur.
        for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
          const top = mix(topLeft, topRight, (column + .5) / 4), bottom = mix(bottomLeft, bottomRight, (column + .5) / 4);
          g.fillStyle(mix(top, bottom, (row + .5) / 4), .88).fillRect(x + column * step / 4, y + row * step / 4, step / 4, step / 4);
        }
      }
      topLeft = topRight; bottomLeft = bottomRight;
    }
  }
  for (const patch of getShelterBackdropGroundPatches(coverage)) {
    const field = sampleShelterForest(unprojectShelterPoint({ x: patch.x + patch.width / 2, y: patch.y + patch.height / 2 }), lots, reserved);
    g.fillStyle(field.density > .35 ? 0x49644f : patch.seed % 4 ? 0x879363 : 0x897b57, .06);
    for (let band = 0; band < 7; band++) {
      const inset = Math.round(patch.width * [.31, .15, .05, 0, .06, .19, .34][band]!);
      g.fillRect(patch.x + inset, patch.y + Math.round(band * patch.height / 7), patch.width - inset * 2, Math.ceil(patch.height / 7));
    }
  }
  const road = getShelterAccessRoadSpan(coverage);
  paintShelterAccessRoad(g, road.left, road.right);
}

/** One small repeated texture supplies coherent ground detail at every world coordinate. */
export function paintShelterBackdropTile(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(0x606e4d).fillRect(0, 0, SHELTER_BACKDROP_TILE, SHELTER_BACKDROP_TILE);
  // Uneven meadow patches break up the repeated forest floor. Their quieter
  // perimeter leaves the inhabited clearing and its paths visually dominant.
  for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
    const seed = hash(column + 81, row + 23), x = column * 128 + 24 + seed % 22, y = row * 128 + 32 + (seed >>> 8) % 20;
    const width = 43 + seed % 39, height = 14 + (seed >>> 12) % 16;
    g.fillStyle(pigment(seed % 3 ? P.grass : P.soil), .18);
    for (let band = 0; band < 5; band++) {
      const inset = Math.round(width * [.24, .09, 0, .12, .29][band]!);
      g.fillRect(x + inset + band % 2 * 3, y + Math.round(band * height / 5), width - inset * 2, Math.ceil(height / 5));
    }
    g.fillStyle(pigment(P.leaf), .08).fillRect(x + 14, y + 5, width - 29, 2);
    for (let blade = 0; blade < 7; blade++) {
      const px = x + 5 + (seed >>> blade % 12) % Math.max(6, width - 10), py = y + 3 + blade * 3 % height;
      g.fillStyle(pigment(P.leaf), .45).fillRect(px, py, 1, 3).fillRect(px - 2, py + 1, 2, 1);
      if ((seed + blade) % 9 === 0) g.fillStyle(pigment(P.sand), .42).fillRect(px, py - 1, 2, 1);
    }
  }
  for (let row = 0; row < 16; row++) for (let column = 0; column < 16; column++) {
    const seed = hash(column, row), x = column * 32 + seed % 13, y = row * 32 + (seed >>> 7) % 15;
    const width = 11 + seed % 17;
    g.fillStyle(pigment(seed % 3 ? P.leafShade : P.soil), .19).fillRect(x, y, width, 3 + seed % 5);
    g.fillStyle(pigment(P.shadow), .18).fillRect(x + 3, y + 7, width - 5, 2);
    g.fillStyle(pigment(seed % 2 ? P.wood : P.leaf), .23).fillRect(x + 7, y + 13, 3, 1);
  }
}
