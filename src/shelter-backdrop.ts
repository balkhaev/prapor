import type Phaser from 'phaser';
import type { ShelterCamera, ShelterRect, ShelterViewport } from './shelter-camera';
import { unprojectShelterPoint } from './shelter-isometric';
import type { ShelterLandscapeDecoration } from './shelter-landscape';
import { PIXEL_PALETTE as P } from './pixel-art';

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
export function getShelterBackdropDecorations(coverage: ShelterRect, worldBounds: ShelterRect): ShelterLandscapeDecoration[] {
  const spacing = 144, decorations: ShelterLandscapeDecoration[] = [];
  for (let y = Math.floor(coverage.y / spacing); y <= Math.ceil((coverage.y + coverage.height) / spacing); y++) {
    for (let x = Math.floor(coverage.x / spacing); x <= Math.ceil((coverage.x + coverage.width) / spacing); x++) {
      const seed = hash(x, y), at = { x: x * spacing + 24 + seed % 88, y: y * spacing + 24 + (seed >>> 9) % 88 };
      // Leave the authored grove and its existing road/yard silhouettes intact.
      if (at.x + 56 > worldBounds.x && at.x - 56 < worldBounds.x + worldBounds.width && at.y + 80 > worldBounds.y && at.y - 80 < worldBounds.y + worldBounds.height) continue;
      const kind = seed % 7 < 4 ? 'tree' : seed % 7 < 6 ? 'bush' : 'rock';
      decorations.push({ kind, point: unprojectShelterPoint(at), radius: kind === 'tree' ? 19 : 13, seed, owned: false });
    }
  }
  // Large shelters still use one floor quad and a fixed cosmetic geometry budget.
  return decorations.sort((a, b) => a.seed - b.seed).slice(0, 256);
}

/** One small repeated texture supplies coherent ground detail at every world coordinate. */
export function paintShelterBackdropTile(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(pigment(P.ink)).fillRect(0, 0, SHELTER_BACKDROP_TILE, SHELTER_BACKDROP_TILE);
  // Uneven meadow patches break up the repeated forest floor. Their quieter
  // perimeter leaves the inhabited clearing and its paths visually dominant.
  for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
    const seed = hash(column + 81, row + 23), x = column * 128 + 24 + seed % 22, y = row * 128 + 32 + (seed >>> 8) % 20;
    const width = 43 + seed % 39, height = 14 + (seed >>> 12) % 16;
    g.fillStyle(pigment(seed % 3 ? P.leafShade : P.soil), .1);
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
