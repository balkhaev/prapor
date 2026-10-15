import type { LiveCityBuilding, LiveObstacle, LivePoint } from './game/live';
import { buildingFacadeCadence, buildingWallHeight } from './live-map-art';
import { PIXEL_TILE, PIXEL_PALETTE as P, PixelRaster, pixelIso, pixelRandom, pixelSeed } from './pixel-art';

type BuildingSprite = { image: HTMLCanvasElement; anchor: LivePoint };
type NativeTile = 32 | 64 | 128;
type FacadeSide = 'x' | 'y';
export const PIXEL_BUILDING_CACHE_BYTES = 32 * 1024 * 1024;
const EXTERIOR_HEIGHT_SCALE = 1.7;

/** Human-scale elevations for the pixel renderer; collision footprints stay unchanged. */
export function pixelBuildingWallHeight(building: LiveCityBuilding): number {
  return buildingWallHeight(building) * EXTERIOR_HEIGHT_SCALE;
}

function roofSurface(building: LiveCityBuilding): { roof: NonNullable<LiveCityBuilding['roof']>; axis: 'x' | 'y'; height: (x: number, y: number) => number } {
  const roof = building.roof ?? (building.kind === 'workshop' ? 'sawtooth' : building.kind === 'apartment' ? 'gable' : 'flat');
  const axis = building.roofAxis ?? (building.width >= building.height ? 'x' : 'y');
  const wall = Math.round(buildingWallHeight(building) * PIXEL_TILE), span = axis === 'x' ? building.height : building.width;
  return { roof, axis, height(x, y) {
    const cross = axis === 'x' ? y : x;
    if (roof === 'gable') return wall + (building.kind === 'workshop' ? 26 : 40) * (1 - Math.abs(cross / span - .5) * 2);
    if (roof === 'sawtooth') {
      const band = span / Math.max(2, Math.round(span / 3));
      return wall + 26 * (1 - (cross / band % 1));
    }
    return wall + 2;
  } };
}

/** Public, model-local outlet. x/y are world units; z includes exterior height
 * scaling in native pixels, so transient steam needs no animated building atlas. */
export function pixelBuildingVentAnchor(building: LiveCityBuilding): (LivePoint & { z: number }) | null {
  const seed = pixelSeed(building.id);
  if (building.kind !== 'workshop' && !(building.kind === 'apartment' && seed % 4 === 0) && !(building.kind === 'service' && seed % 2 === 0)) return null;
  const x = building.width * .7, y = building.height * .36;
  return { x: x + .15, y: y + .15, z: (roofSurface(building).height(x, y) + 37) * EXTERIOR_HEIGHT_SCALE };
}

function buildingSpriteLayout(building: LiveCityBuilding, cutaway: boolean, nativeTile: NativeTile): { width: number; height: number; wallHeight: number; anchor: LivePoint } {
  const scale = nativeTile / PIXEL_TILE, wallHeight = Math.round(buildingWallHeight(building) * PIXEL_TILE);
  const headroom = cutaway ? 24 : Math.ceil((wallHeight + 96) * EXTERIOR_HEIGHT_SCALE);
  return { width: Math.ceil(((building.width + building.height) * 64 + 56) * scale),
    height: Math.ceil(((building.width + building.height) * 32 + headroom + 64) * scale), wallHeight,
    anchor: { x: Math.ceil((building.height * 64 + 28) * scale), y: Math.ceil((headroom + 28) * scale) } };
}

/** The compositor can budget a whole viewport before allocating any canvases. */
export function pixelBuildingSpriteBytes(building: LiveCityBuilding, cutaway: boolean, nativeTile: NativeTile): number {
  const layout = buildingSpriteLayout(building, cutaway, nativeTile);
  return layout.width * layout.height * 4;
}
const MATERIALS = {
  brick: { light: P.brick, dark: P.brickShade, trim: '#c4ad89', joint: '#896752', patch: '#b18469' },
  plaster: { light: P.plaster, dark: P.plasterShade, trim: '#ddd0ad', joint: '#ae9f84', patch: '#b8a88c' },
  panel: { light: P.panel, dark: P.panelShade, trim: '#c4cab5', joint: '#65786d', patch: '#909f92' },
  metal: { light: P.steel, dark: P.steelShade, trim: '#adbab0', joint: '#445d61', patch: '#966e50' },
} as const;
const INK = '#273b35', GLASS = '#557b81', GLASS_DARK = '#334f55', FRAME = '#d3c8aa';

/** Raster sprites keep the published footprint and doorway cells. Detail is
 * generated lazily at the visible pixel level; retained canvases use at most 32MiB. */
export class PixelBuildingArt {
  private entries = new Map<string, BuildingSprite>();
  private bytes = 0;
  get retainedBytes(): number { return this.bytes; }
  clear(): void { this.entries.clear(); this.bytes = 0; }

  get(building: LiveCityBuilding, cutaway: boolean, nativeTile: NativeTile = 128, walls?: readonly LiveObstacle[]): BuildingSprite {
    const localDoors = building.entrances.map(door => `${door.x - building.x}:${door.y - building.y}`).join(',');
    const localWalls = cutaway && walls ? walls.map(wall => `${wall.x - building.x}:${wall.y - building.y}:${wall.width}:${wall.height}`).join(',') : '';
    const key = `${building.id}:${building.width}:${building.height}:${building.kind}:${building.floors}:${building.facade}:${building.roof}:${building.roofAxis}:${localDoors}:${localWalls}:${cutaway}:${nativeTile}`;
    const cached = this.entries.get(key);
    if (cached) { this.entries.delete(key); this.entries.set(key, cached); return cached; }
    const image = document.createElement('canvas'), scale = nativeTile / PIXEL_TILE;
    const { width, height, wallHeight, anchor } = buildingSpriteLayout(building, cutaway, nativeTile);
    image.width = width; image.height = height;
    const context = image.getContext('2d');
    if (context) {
      context.imageSmoothingEnabled = false;
      paintBuilding(new PixelRaster(context, image.width, image.height), building, anchor, scale, wallHeight, cutaway, walls);
    }
    const sprite = { image, anchor }, bytes = image.width * image.height * 4;
    if (bytes <= PIXEL_BUILDING_CACHE_BYTES) {
      while (this.bytes + bytes > PIXEL_BUILDING_CACHE_BYTES && this.entries.size) {
        const oldest = this.entries.keys().next().value!;
        const removed = this.entries.get(oldest)!;
        this.bytes -= removed.image.width * removed.image.height * 4; this.entries.delete(oldest);
      }
      this.entries.set(key, sprite); this.bytes += bytes;
    }
    return sprite;
  }
}

function paintBuilding(r: PixelRaster, building: LiveCityBuilding, anchor: LivePoint, scale: number, wallHeight: number, cutaway: boolean, walls?: readonly LiveObstacle[]): void {
  const w = building.width, h = building.height, floors = building.floors ?? (building.kind === 'apartment' ? 2 : 1);
  const material = building.facade ?? (building.kind === 'workshop' || building.kind === 'garage' ? 'metal' : building.kind === 'apartment' ? 'plaster' : 'brick');
  const palette = MATERIALS[material], seed = pixelSeed(building.id), random = pixelRandom(seed);
  const elevationScale = cutaway ? 1 : EXTERIOR_HEIGHT_SCALE, fine = scale >= .5;
  const p = (x: number, y: number, z = 0): LivePoint => pixelIso(x * scale, y * scale, z * scale * elevationScale, anchor);
  const line = (a: LivePoint, b: LivePoint, color: string, width = 1) => r.line(a.x, a.y, b.x, b.y, color, Math.max(1, Math.round(width * scale)));
  const quad = (x: number, y: number, width: number, height: number, z: number, color: string): void => {
    r.polygon([p(x, y, z), p(x + width, y, z), p(x + width, y + height, z), p(x, y + height, z)], color);
  };
  const box = (x: number, y: number, width: number, height: number, bottom: number, top: number, colors: readonly string[]): void => {
    r.polygon([p(x + width, y, bottom), p(x + width, y + height, bottom), p(x + width, y + height, top), p(x + width, y, top)], colors[0]!);
    r.polygon([p(x, y + height, bottom), p(x + width, y + height, bottom), p(x + width, y + height, top), p(x, y + height, top)], colors[1]!);
    quad(x, y, width, height, top, colors[2]!);
  };

  if (cutaway) {
    // The open floor excludes the real one-cell perimeter walls. Furnishings
    // are drawn by the live scene; this layer cannot add cover or search spots.
    quad(1, 1, w - 2, h - 2, 0, building.kind === 'apartment' ? '#a89b7d' : '#899083');
    if (building.kind === 'apartment') {
      for (let x = 1.15; x < w - 1; x += .34) line(p(x, 1, 1), p(x, h - 1, 1), '#8e8268');
      for (let row = 0, y = 1.2; y < h - 1; y += .7, row++) for (let x = 1.25 + row % 2 * .68; x < w - 1; x += 1.35) line(p(x, y, 1), p(x, Math.min(h - 1, y + .69), 1), '#bdae8b');
    } else {
      for (let x = 1.4; x < w - 1; x += 1.4) line(p(x, 1, 1), p(x, h - 1, 1), '#747f73');
      for (let y = 1.4; y < h - 1; y += 1.4) line(p(1, y, 1), p(w - 1, y, 1), '#a2a99a');
      if (building.kind === 'service' || building.kind === 'shop') {
        for (let row = 0, y = 1; y < h - 1; y += .7, row++) for (let x = 1; x < w - 1; x += .7) {
          if ((Math.round((x - 1) / .7) + row) % 2) quad(x, y, Math.min(.68, w - 1 - x), Math.min(.68, h - 1 - y), 1, P.concreteShade);
        }
      } else if (fine) {
        // Paint and repairs belong to the floor; no unconfirmed furniture or cover.
        const patchX = Math.max(1.08, w * .35), patchY = Math.max(1.08, h * .3);
        quad(patchX, patchY, Math.max(.01, Math.min(1.1, w - 1.08 - patchX)), Math.max(.01, Math.min(.9, h - 1.08 - patchY)), 1, P.panelShade);
        for (let mark = 0; mark < 7; mark++) {
          const x = 1.2 + random() * (w - 2.6), y = 1.2 + random() * (h - 2.6);
          line(p(x, y, 1), p(Math.min(w - 1, x + .18), Math.min(h - 1, y + .08), 1), P.terraShade, 2);
        }
        for (const edge of [1.18, w - 1.18]) line(p(edge, 1.3, 1), p(edge, h - 1.3, 1), P.yellow, 2);
      }
    }
    const pieces: Array<{ x: number; y: number; width: number; height: number }> = walls ? walls.filter(wall => wall.kind === 'wall'
      && wall.x >= building.x && wall.y >= building.y && wall.x + wall.width <= building.x + w && wall.y + wall.height <= building.y + h)
      .map(wall => ({ x: wall.x - building.x, y: wall.y - building.y, width: wall.width, height: wall.height })) : [];
    // Legacy entrance points retain the gap's centre, but not its width. Only
    // supplied real walls can describe those halls; their bounds never invent walls.
    for (const side of walls || building.id.startsWith('hall-') ? [] : ['north', 'south', 'west', 'east'] as const) {
      const horizontal = side === 'north' || side === 'south', end = horizontal ? w : h;
      const doors = building.entrances.filter(door => side === 'north' ? door.y === building.y : side === 'south' ? door.y === building.y + h - 1
        : side === 'west' ? door.x === building.x : door.x === building.x + w - 1).map(door => horizontal ? door.x - building.x : door.y - building.y).sort((a, b) => a - b);
      let start = horizontal ? 0 : 1;
      for (const door of [...doors, horizontal ? end : end - 1]) {
        if (door > start) pieces.push(horizontal ? { x: start, y: side === 'north' ? 0 : h - 1, width: door - start, height: 1 }
          : { x: side === 'west' ? 0 : w - 1, y: start, width: 1, height: door - start });
        start = door + 2;
      }
    }
    pieces.sort((a, b) => a.x + a.y - b.x - b.y).forEach(piece => {
      box(piece.x, piece.y, piece.width, piece.height, 0, 18, [palette.light, palette.dark, palette.trim]);
      if (fine) {
        line(p(piece.x, piece.y + piece.height, 8), p(piece.x + piece.width, piece.y + piece.height, 8), palette.joint);
        line(p(piece.x + piece.width, piece.y, 8), p(piece.x + piece.width, piece.y + piece.height, 8), palette.joint);
        quad(piece.x + .06, piece.y + .06, Math.max(.01, piece.width - .12), Math.max(.01, piece.height - .12), 18, P.cream);
      }
    });
    return;
  }

  const facePoint = (side: FacadeSide, u: number, z: number): LivePoint => side === 'y' ? p(u, h, z) : p(w, u, z);
  const faceRect = (side: FacadeSide, u: number, width: number, low: number, high: number, color: string): void => {
    r.polygon([facePoint(side, u, low), facePoint(side, u + width, low), facePoint(side, u + width, high), facePoint(side, u, high)], color);
  };
  const doorPositions = (side: FacadeSide): number[] => building.entrances.filter(door => side === 'y' ? door.y === building.y + h - 1 : door.x === building.x + w - 1)
    .map(door => (side === 'y' ? door.x - building.x : door.y - building.y) + 1);

  const window = (side: FacadeSide, center: number, width: number, low: number, high: number, variation: number): void => {
    const left = center - width / 2, right = center + width / 2, warm = variation % 7 === 0;
    // Dark opening, lit outer lintel and a projecting sill make the glass sit in the wall.
    faceRect(side, left - .08, width + .16, low - 3, high + 3, INK);
    faceRect(side, left - .065, width + .13, low - 2, high + 3, FRAME);
    faceRect(side, left, width, low, high, warm ? P.wood : side === 'x' ? GLASS : GLASS_DARK);
    faceRect(side, left, .055, low, high, P.steelShade);
    faceRect(side, right - .035, .035, low, high, P.cream);
    line(facePoint(side, left, high), facePoint(side, right, high), INK, 2);
    if (fine) {
      r.polygon([facePoint(side, left + .07, high - 3), facePoint(side, center - .02, high - 3), facePoint(side, right - .09, low + 5), facePoint(side, center - .12, low + 5)], warm ? P.sand : P.glassLight);
      if (variation % 5 === 1) faceRect(side, left + .05, width * .22, low + 2, high - 3, P.panelShade);
      if (variation % 9 === 2) {
        line(facePoint(side, center + .08, low + 4), facePoint(side, center + .16, low + 11), P.ink);
        line(facePoint(side, center + .16, low + 11), facePoint(side, center + .07, low + 16), P.ink);
      }
    }
    line(facePoint(side, center, low), facePoint(side, center, high), FRAME, 2);
    line(facePoint(side, left, low + (high - low) * .45), facePoint(side, right, low + (high - low) * .45), FRAME, 2);
    faceRect(side, left - .1, width + .2, low - 6, low - 3, palette.dark);
    faceRect(side, left - .1, width + .2, low - 4, low - 2, P.cream);
    line(facePoint(side, left - .06, low - 7), facePoint(side, left - .04, low - 12), palette.joint);
  };

  for (const side of ['x', 'y'] as const) {
    const length = side === 'y' ? w : h, shade = side === 'x' ? palette.light : palette.dark;
    faceRect(side, 0, length, 0, wallHeight, shade);
    if (material === 'brick') {
      for (let z = 8, row = 0; z < wallHeight; z += 8, row++) {
        line(facePoint(side, 0, z), facePoint(side, length, z), palette.joint);
        for (let u = row % 2 * .15; u < length; u += .3) {
          line(facePoint(side, u, z), facePoint(side, u, Math.min(wallHeight, z + 8)), palette.joint);
          if ((Math.round(u * 10) + row + seed) % 9 === 0) faceRect(side, u + .025, Math.min(.22, length - u - .025), z + 1, Math.min(wallHeight, z + 6), palette.patch);
        }
      }
    } else if (material === 'metal') {
      for (let u = .18; u < length; u += .24) {
        line(facePoint(side, u, 10), facePoint(side, u, wallHeight - 5), palette.joint, 2);
        line(facePoint(side, u + .035, 12), facePoint(side, u + .035, wallHeight - 5), palette.trim);
      }
      for (let mark = 0; mark < 8; mark++) {
        const u = .3 + random() * (length - .8), top = 10 + random() * wallHeight * .3;
        faceRect(side, u, .035 + random() * .05, 7, top, palette.patch);
      }
    } else if (material === 'panel') {
      for (let u = 1.4; u < length; u += 1.4) {
        line(facePoint(side, u, 10), facePoint(side, u, wallHeight - 6), palette.joint, 2);
        line(facePoint(side, u + .04, 10), facePoint(side, u + .04, wallHeight - 6), palette.trim);
      }
      for (let floor = 1; floor < floors; floor++) line(facePoint(side, 0, floor * 73), facePoint(side, length, floor * 73), palette.joint, 3);
    } else {
      for (let mark = 0; mark < 14; mark++) {
        const u = .2 + random() * (length - .7), z = 15 + random() * (wallHeight - 27);
        faceRect(side, u, .13 + random() * .22, z, Math.min(wallHeight - 4, z + 5 + random() * 12), palette.patch);
      }
      const crackU = length * (.18 + seed % 53 / 100), crackZ = wallHeight * .45;
      line(facePoint(side, crackU, crackZ), facePoint(side, crackU + .08, crackZ - 10), palette.joint);
      line(facePoint(side, crackU + .08, crackZ - 10), facePoint(side, crackU, crackZ - 17), palette.joint);
    }
    faceRect(side, 0, length, 0, 11, '#647467');
    line(facePoint(side, 0, 12), facePoint(side, length, 12), palette.trim, 3);
    faceRect(side, 0, length, wallHeight - 6, wallHeight, palette.trim);
    const cadence = buildingFacadeCadence(building, length), doors = doorPositions(side);
    const columns = Math.max(cadence.columns, Math.floor((length - .7) / (cadence.industrial ? 3.9 : building.kind === 'shop' ? 2.6 : 2.3)));
    for (let floor = 0; floor < floors; floor++) for (let column = 0; column < columns; column++) {
      const u = length * (column + 1) / (columns + 1), industrial = cadence.industrial;
      if (!floor && doors.some(door => Math.abs(door - u) < (industrial ? 1.65 : 1.05))) continue;
      const width = industrial ? 1.1 : building.kind === 'shop' && !floor ? 1.12 : .62;
      const low = industrial ? wallHeight - 30 : 18 + floor * 73, high = Math.min(wallHeight - 12, low + (industrial ? 15 : building.kind === 'shop' && !floor ? 32 : 25));
      window(side, u, width, low, high, column + floor + seed);
      if (building.kind === 'apartment' && floor > 0 && (material === 'panel' || (column + seed) % 3 === 0)) {
        const z = low - 7, a = side === 'y' ? { x: u - .45, y: h } : { x: w, y: u - .45 };
        const bw = side === 'y' ? .9 : .22, bh = side === 'y' ? .22 : .9;
        box(a.x, a.y, bw, bh, z - 4, z, ['#8c9887', '#647363', '#bbc0a6']);
        line(p(a.x, a.y + bh, z + 16), p(a.x + bw, a.y + bh, z + 16), INK, 2);
        line(p(a.x + bw, a.y, z + 16), p(a.x + bw, a.y + bh, z + 16), INK, 2);
        for (let bar = 0; bar <= 4; bar++) {
          const x = a.x + bw * bar / 4, y = a.y + bh;
          line(p(x, y, z), p(x, y, z + 16), INK);
        }
      } else if (fine && floor > 0 && (column + floor + seed) % 3 === 0) {
        const x = side === 'y' ? u - .25 : w, y = side === 'y' ? h : u - .25;
        const acWidth = side === 'y' ? .5 : .16, acHeight = side === 'y' ? .16 : .5;
        box(x, y, acWidth, acHeight, low - 18, low - 5, [P.steel, P.steelShade, P.steelLight]);
        const vent = p(x + acWidth, y + acHeight / 2, low - 11);
        r.ellipse(vent.x, vent.y, Math.max(2, Math.round(4 * scale)), Math.max(2, Math.round(5 * scale)), P.ink);
        line({ x: vent.x - 1, y: vent.y - 3 * scale }, { x: vent.x + 1, y: vent.y + 3 * scale }, P.steelLight);
        line(facePoint(side, u + .27, low - 16), facePoint(side, u + .27, low + 1), P.cream);
      }
    }
    for (const u of doors) {
      const loading = building.kind === 'workshop' || building.kind === 'garage', width = loading ? 1.8 : .76, high = loading ? 76 : 61;
      faceRect(side, u - width / 2 - .07, width + .14, 1, high + 5, palette.trim);
      faceRect(side, u - width / 2, width, 0, high, loading ? '#506965' : '#485a48');
      if (loading) {
        for (let z = 8; z < high; z += 8) line(facePoint(side, u - width / 2, z), facePoint(side, u + width / 2, z), '#79897b', 2);
        faceRect(side, u - width / 2 + .03, width - .06, 2, 8, P.ink);
        if (fine) for (let n = 0; n < 3; n++) {
          const at = u - width * .35 + n * width * .34;
          line(facePoint(side, at, 9), facePoint(side, at + .04, 17 + n * 3), P.rustShade, 2);
        }
      } else {
        faceRect(side, u - width * .31, width * .62, 31, 51, GLASS_DARK);
        line(facePoint(side, u + width * .29, 23), facePoint(side, u + width * .4, 23), '#d0bc7d', 3);
        if (fine) {
          faceRect(side, u + width / 2 + .11, .12, 25, 38, P.ink);
          faceRect(side, u + width / 2 + .13, .07, 32, 36, P.steelLight);
          line(facePoint(side, u + width / 2 + .14, 28), facePoint(side, u + width / 2 + .18, 28), P.yellow, 2);
        }
      }
      line(facePoint(side, u, 2), facePoint(side, u, high - 2), INK);
      for (let step = 1; step >= 0; step--) {
        const x = side === 'y' ? u - width / 2 - .09 : w + step * .15;
        const y = side === 'y' ? h + step * .15 : u - width / 2 - .09;
        box(x, y, side === 'y' ? width + .18 : .15, side === 'y' ? .15 : width + .18, 0, (2 - step) * 3, ['#8b927e', '#737d6b', '#b4b59b']);
      }
      if (building.kind === 'shop' || building.kind === 'service') {
        const x = side === 'y' ? u - .67 : w, y = side === 'y' ? h : u - .67;
        const aw = side === 'y' ? 1.34 : .38, ah = side === 'y' ? .38 : 1.34;
        box(x, y, aw, ah, high + 3, high + 7, ['#6c826b', '#4c6857', '#93a087']);
        line(p(x, y + ah, high + 7), p(x + aw, y + ah, high + 7), '#c6bb92', 2);
        // Public building type controls the sign, never hidden room contents.
        faceRect(side, u - .72, 1.44, high + 11, high + 25, P.ink);
        faceRect(side, u - .68, 1.36, high + 13, high + 23, building.kind === 'shop' ? P.red : P.blue);
        const z = high + 18;
        if (building.kind === 'service') {
          line(facePoint(side, u - .16, z), facePoint(side, u + .16, z), P.cream, 3);
          line(facePoint(side, u, z - 4), facePoint(side, u, z + 4), P.cream, 3);
        } else {
          faceRect(side, u - .2, .4, z - 3, z + 2, P.cream);
          line(facePoint(side, u - .12, z + 3), facePoint(side, u + .12, z + 3), P.cream);
        }
      }
    }
    // Attached utilities stay on the facade and below the eaves.
    const drain = length - .12;
    faceRect(side, drain - .045, .09, 7, wallHeight - 3, P.steelShade);
    line(facePoint(side, drain + .025, 8), facePoint(side, drain + .025, wallHeight - 3), P.steelLight, 2);
    for (let z = 19; z < wallHeight - 6; z += 38) line(facePoint(side, drain - .07, z), facePoint(side, drain + .07, z), INK, 2);
    line(facePoint(side, drain, 7), facePoint(side, drain - .11, 4), P.steelShade, 3);
    if (fine) {
      const cableZ = wallHeight - 10;
      for (let span = 0; span < 4; span++) {
        const a = span / 4, b = (span + 1) / 4;
        line(facePoint(side, .12 + (length - .35) * a, cableZ - Math.sin(a * Math.PI) * 3), facePoint(side, .12 + (length - .35) * b, cableZ - Math.sin(b * Math.PI) * 3), P.ink);
      }
      if (!doors.some(u => u < .75)) {
        faceRect(side, .25, .25, 28, 43, P.ink); faceRect(side, .28, .2, 30, 42, P.steel);
        line(facePoint(side, .31, 36), facePoint(side, .42, 36), P.yellow, 2);
        line(facePoint(side, .37, 43), facePoint(side, .37, cableZ - 2), P.ink);
      }
    }
    line(facePoint(side, 0, wallHeight), facePoint(side, length, wallHeight), '#e0d3b0', 2);
  }

  const surface = roofSurface(building), { roof, axis } = surface;
  const slate = material === 'metal' ? ['#91aaa4', '#607f79'] : seed % 3 ? ['#849589', '#5a6e62'] : ['#9d765f', '#6f594b'];
  if (roof === 'gable') {
    const lift = building.kind === 'workshop' ? 26 : 40;
    const ra = axis === 'x' ? p(0, h / 2, wallHeight + lift) : p(w / 2, 0, wallHeight + lift);
    const rb = axis === 'x' ? p(w, h / 2, wallHeight + lift) : p(w / 2, h, wallHeight + lift);
    r.polygon(axis === 'x' ? [p(0, 0, wallHeight), p(w, 0, wallHeight), rb, ra] : [p(0, 0, wallHeight), ra, rb, p(0, h, wallHeight)], slate[0]!);
    r.polygon(axis === 'x' ? [ra, rb, p(w, h, wallHeight), p(0, h, wallHeight)] : [ra, p(w, 0, wallHeight), p(w, h, wallHeight), rb], slate[1]!);
    for (let u = .3; u < (axis === 'x' ? w : h); u += .36) {
      const ridge = axis === 'x' ? p(u, h / 2, wallHeight + lift) : p(w / 2, u, wallHeight + lift);
      line(axis === 'x' ? p(u, 0, wallHeight) : p(0, u, wallHeight), ridge, '#b0b49c');
      line(ridge, axis === 'x' ? p(u, h, wallHeight) : p(w, u, wallHeight), '#465e52');
    }
    for (let v = .3; v < (axis === 'x' ? h : w); v += .35) {
      const span = axis === 'x' ? h : w, z = wallHeight + lift * (1 - Math.abs(v - span / 2) / (span / 2));
      line(axis === 'x' ? p(0, v, z) : p(v, 0, z), axis === 'x' ? p(w, v, z) : p(v, h, z), v < span / 2 ? '#7b8d7f' : '#506659');
    }
    r.polygon(axis === 'x' ? [p(w, 0, wallHeight), p(w, h, wallHeight), rb] : [p(0, h, wallHeight), p(w, h, wallHeight), rb], palette.light);
    line(ra, rb, '#c2c3a9', 3);
    line(axis === 'x' ? p(w, 0, wallHeight) : p(0, h, wallHeight), rb, palette.trim, 3);
    line(rb, p(w, h, wallHeight), palette.trim, 3);
    if (fine) {
      // Flashing and one fitted skylight follow the actual inclined roof plane.
      const sx = w * .23, sy = h * .67, sw = Math.min(1.1, w * .16), sh = Math.min(.6, h * .12);
      const roofPoint = (x: number, y: number, offset = 0) => p(x, y, surface.height(x, y) + offset);
      r.polygon([roofPoint(sx - .06, sy - .05, 2), roofPoint(sx + sw + .06, sy - .05, 2), roofPoint(sx + sw + .06, sy + sh + .05, 2), roofPoint(sx - .06, sy + sh + .05, 2)], P.steelLight);
      r.polygon([roofPoint(sx, sy, 3), roofPoint(sx + sw, sy, 3), roofPoint(sx + sw, sy + sh, 3), roofPoint(sx, sy + sh, 3)], P.glass);
      line(roofPoint(sx + sw * .25, sy + .02, 4), roofPoint(sx + sw * .7, sy + sh - .02, 4), P.glassLight, 3);
      line(roofPoint(sx + sw / 2, sy, 4), roofPoint(sx + sw / 2, sy + sh, 4), P.steelLight, 2);
    }
  } else if (roof === 'sawtooth') {
    const span = axis === 'x' ? h : w, count = Math.max(2, Math.round(span / 3)), band = span / count, lift = 26;
    for (let row = 0; row < count; row++) {
      const a = row * band, b = (row + 1) * band;
      const ra = axis === 'x' ? p(0, a, wallHeight + lift) : p(a, 0, wallHeight + lift);
      const rb = axis === 'x' ? p(w, a, wallHeight + lift) : p(a, h, wallHeight + lift);
      const da = axis === 'x' ? p(0, b, wallHeight) : p(b, 0, wallHeight), db = axis === 'x' ? p(w, b, wallHeight) : p(b, h, wallHeight);
      r.polygon([ra, rb, db, da], row % 2 ? '#839b90' : '#9aafa0');
      for (let u = .3; u < (axis === 'x' ? w : h); u += .5) line(axis === 'x' ? p(u, a, wallHeight + lift) : p(a, u, wallHeight + lift), axis === 'x' ? p(u, b, wallHeight) : p(b, u, wallHeight), '#5e796c');
      r.polygon(axis === 'x' ? [p(0, a, wallHeight), p(w, a, wallHeight), rb, ra] : [p(a, 0, wallHeight), p(a, h, wallHeight), rb, ra], GLASS_DARK);
      for (let u = .5; u < (axis === 'x' ? w : h); u += 1) line(axis === 'x' ? p(u, a, wallHeight + 2) : p(a, u, wallHeight + 2), axis === 'x' ? p(u, a, wallHeight + lift - 2) : p(a, u, wallHeight + lift - 2), '#bec6ad', 2);
      if (fine) {
        const glassA = axis === 'x' ? p(.3, a, wallHeight + 8) : p(a, .3, wallHeight + 8);
        const glassB = axis === 'x' ? p((w - .3), a, wallHeight + 18) : p(a, (h - .3), wallHeight + 18);
        line(glassA, glassB, P.glassLight);
      }
      line(ra, rb, '#c5cbb4', 2);
    }
  } else {
    quad(0, 0, w, h, wallHeight, '#829284');
    quad(.18, .18, w - .36, h - .36, wallHeight + 1, '#667d6c');
    for (let x = .5; x < w; x += 1.15) line(p(x, .18, wallHeight + 2), p(x, h - .18, wallHeight + 2), '#536b5a');
    for (let y = .5; y < h; y += 1.15) line(p(.18, y, wallHeight + 2), p(w - .18, y, wallHeight + 2), '#93a18a');
    for (const [x, y, ww, hh] of [[0, 0, w, .16], [0, h - .16, w, .16], [0, .16, .16, h - .32], [w - .16, .16, .16, h - .32]]) box(x!, y!, ww!, hh!, wallHeight, wallHeight + 9, ['#8e9c87', '#647961', '#b4bda2']);
    box(w * .25, h * .36, .7, .65, wallHeight + 2, wallHeight + 17, ['#a3aea1', '#6d8374', '#d0cfb3']);
    const vent = p(w * .25 + .35, h * .36 + .32, wallHeight + 18);
    r.ellipse(vent.x, vent.y, Math.max(1, Math.round(12 * scale)), Math.max(1, Math.round(6 * scale)), '#607c6e');
    line({ x: vent.x - Math.round(9 * scale), y: vent.y }, { x: vent.x + Math.round(9 * scale), y: vent.y }, '#c7caae', 2);
    if (fine) {
      quad(w * .53, h * .62, Math.min(w * .25, 1.8), Math.min(h * .2, 1.2), wallHeight + 2, P.roofShade);
      line(p(w * .53, h * .62, wallHeight + 3), p(w * .53 + Math.min(w * .25, 1.8), h * .62, wallHeight + 3), P.ink, 2);
      const hx = w * .67, hy = h * .7, hw = Math.min(.8, w * .12), hh = Math.min(.65, h * .12);
      box(hx, hy, hw, hh, wallHeight + 2, wallHeight + 8, [P.steel, P.steelShade, P.steelLight]);
      quad(hx + .07, hy + .07, hw - .14, hh - .14, wallHeight + 9, P.roofShade);
      for (let y = .4; y < h - .3; y += .22) line(p(w - .25, y, wallHeight + 3), p(w - .13, y, wallHeight + 3), P.ink);
    }
  }

  // Eave gutters remain narrow enough to retain the published silhouette.
  line(p(w, 0, wallHeight + 1), p(w, h, wallHeight + 1), P.steelShade, 4);
  line(p(0, h, wallHeight + 1), p(w, h, wallHeight + 1), P.steelShade, 4);
  line(p(w, 0, wallHeight + 3), p(w, h, wallHeight + 3), P.steelLight);
  line(p(0, h, wallHeight + 3), p(w, h, wallHeight + 3), P.steelLight);

  // Small roof equipment follows the roof plane, not a randomly raised cube.
  const chimneyX = w * .7, chimneyY = h * .36;
  const roofZ = surface.height(chimneyX, chimneyY);
  box(chimneyX, chimneyY, .32, .32, roofZ, roofZ + 35, [P.brick, P.brickShade, P.sand]);
  quad(chimneyX - .055, chimneyY - .055, .43, .43, roofZ + 36, P.cream);
  quad(chimneyX + .07, chimneyY + .07, .16, .16, roofZ + 37, INK);
  if (fine) {
    for (let z = 7; z < 34; z += 8) {
      line(p(chimneyX, chimneyY + .32, roofZ + z), p(chimneyX + .32, chimneyY + .32, roofZ + z), P.brickShade);
      line(p(chimneyX + .32, chimneyY, roofZ + z), p(chimneyX + .32, chimneyY + .32, roofZ + z), P.brickShade);
    }
    const fanX = w * .4, fanY = h * .22, baseZ = surface.height(fanX, fanY);
    if (building.kind === 'workshop' || roof === 'flat') {
      box(fanX, fanY, .4, .38, baseZ, baseZ + 13, [P.steel, P.steelShade, P.steelLight]);
      quad(fanX - .05, fanY - .05, .5, .48, baseZ + 14, P.steelLight);
      const outlet = p(fanX + .2, fanY + .19, baseZ + 15);
      r.ellipse(outlet.x, outlet.y, Math.max(1, Math.round(9 * scale)), Math.max(1, Math.round(4 * scale)), P.ink);
      line({ x: outlet.x - 5 * scale, y: outlet.y }, { x: outlet.x + 5 * scale, y: outlet.y }, P.steel, 2);
    }
  }
}
