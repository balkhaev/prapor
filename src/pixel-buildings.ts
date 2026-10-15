import type { LiveCityBuilding, LiveObstacle, LivePoint } from './game/live';
import { BUILDING_EXTERIOR_HEIGHT_SCALE, buildingExteriorStyle, buildingFacadeCadence, buildingRoofDormer, buildingWallHeight } from './live-map-art';
import { PIXEL_TILE, PIXEL_PALETTE as P, PixelRaster, pixelIso, pixelRandom, pixelSeed } from './pixel-art';
import { BUILDING_ARCHITECTURE_HEADROOM, buildingArchitecture, buildingArchitectureHeightAt, type BuildingFacade } from './building-architecture';
import { buildingStreetSign, streetSignLettering } from './live-street-life';

type BuildingSprite = { image: HTMLCanvasElement; anchor: LivePoint };
type NativeTile = 32 | 64 | 128;
type FacadeSide = 'x' | 'y';
export const PIXEL_BUILDING_CACHE_BYTES = 32 * 1024 * 1024;
const EXTERIOR_HEIGHT_SCALE = BUILDING_EXTERIOR_HEIGHT_SCALE;

/** Human-scale elevations for the pixel renderer; collision footprints stay unchanged. */
export function pixelBuildingWallHeight(building: LiveCityBuilding): number {
  return buildingWallHeight(building) * EXTERIOR_HEIGHT_SCALE;
}

type BuildingRoofSurface = { roof: ReturnType<typeof buildingArchitecture>['roof']; axis: 'x' | 'y'; height: (x: number, y: number) => number };
const roofSurfaces = new WeakMap<LiveCityBuilding, { signature: string; surface: BuildingRoofSurface }>();

function roofSurface(building: LiveCityBuilding): BuildingRoofSurface {
  const signature = `${building.id}:${building.width}:${building.height}:${building.kind}:${building.floors}:${building.facade}:${building.roof}:${building.roofAxis}`;
  const cached = roofSurfaces.get(building);
  if (cached?.signature === signature) return cached.surface;
  const plan = buildingArchitecture(building);
  const surface = { roof: plan.roof, axis: plan.axis, height: (x: number, y: number) => buildingArchitectureHeightAt(plan, x, y) * PIXEL_TILE };
  roofSurfaces.set(building, { signature, surface });
  return surface;
}

/** Public, model-local outlet. x/y are world units; z includes exterior height
 * scaling in native pixels, so transient steam needs no animated building atlas. */
export function pixelBuildingVentAnchor(building: LiveCityBuilding): (LivePoint & { z: number }) | null {
  const seed = pixelSeed(building.id);
  if (building.kind !== 'workshop' && !(building.kind === 'apartment' && seed % 4 === 0) && !(building.kind === 'service' && seed % 2 === 0)) return null;
  const x = building.width * .7, y = building.height * .36;
  return { x: x + .15, y: y + .15, z: (roofSurface(building).height(x, y) + 37) * EXTERIOR_HEIGHT_SCALE };
}

function buildingSpriteLayout(building: LiveCityBuilding, cutaway: boolean, nativeTile: NativeTile): { width: number; height: number; anchor: LivePoint } {
  const scale = nativeTile / PIXEL_TILE;
  // This is queried for the full visible frame's bitmap budget. Reserving the
  // shared upper bound keeps it constant-time and allocates no roof polygons.
  const headroom = cutaway ? 24 : Math.ceil((buildingWallHeight(building) + BUILDING_ARCHITECTURE_HEADROOM) * PIXEL_TILE * EXTERIOR_HEIGHT_SCALE);
  return { width: Math.ceil(((building.width + building.height) * 64 + 56) * scale),
    height: Math.ceil(((building.width + building.height) * 32 + headroom + 64) * scale),
    anchor: { x: Math.ceil((building.height * 64 + 28) * scale), y: Math.ceil((headroom + 28) * scale) } };
}

/** The compositor can budget a whole viewport before allocating any canvases. */
export function pixelBuildingSpriteBytes(building: LiveCityBuilding, cutaway: boolean, nativeTile: NativeTile): number {
  const layout = buildingSpriteLayout(building, cutaway, nativeTile);
  return layout.width * layout.height * 4;
}
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
    const { width, height, anchor } = buildingSpriteLayout(building, cutaway, nativeTile);
    image.width = width; image.height = height;
    const context = image.getContext('2d');
    if (context) {
      context.imageSmoothingEnabled = false;
      paintBuilding(new PixelRaster(context, image.width, image.height), building, anchor, scale, cutaway, walls);
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

function paintBuilding(r: PixelRaster, building: LiveCityBuilding, anchor: LivePoint, scale: number, cutaway: boolean, walls?: readonly LiveObstacle[]): void {
  const w = building.width, h = building.height;
  const material = building.facade ?? (building.kind === 'workshop' || building.kind === 'garage' ? 'metal' : building.kind === 'apartment' ? 'plaster' : 'brick');
  const palette = buildingExteriorStyle(building), seed = pixelSeed(building.id), random = pixelRandom(seed);
  const elevationScale = cutaway ? 1 : EXTERIOR_HEIGHT_SCALE, fine = scale >= .5, close = scale >= 1;
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

  const plan = buildingArchitecture(building);
  let activeFacade: BuildingFacade = plan.facades[0]!;
  const facePoint = (side: FacadeSide, u: number, z: number): LivePoint => {
    z = Math.max(activeFacade.bottom * PIXEL_TILE, Math.min(activeFacade.top * PIXEL_TILE, z));
    return side === 'y' ? p(activeFacade.u + u, activeFacade.plane, z) : p(activeFacade.plane, activeFacade.u + u, z);
  };
  const faceRect = (side: FacadeSide, u: number, width: number, low: number, high: number, color: string): void => {
    low = Math.max(low, activeFacade.bottom * PIXEL_TILE); high = Math.min(high, activeFacade.top * PIXEL_TILE);
    if (high <= low || width <= 0) return;
    r.polygon([facePoint(side, u, low), facePoint(side, u + width, low), facePoint(side, u + width, high), facePoint(side, u, high)], color);
  };
  const doorPositions = (side: FacadeSide): number[] => (side === 'y' ? activeFacade.plane === h : activeFacade.plane === w) ? building.entrances.filter(door => side === 'y' ? door.y === building.y + h - 1 : door.x === building.x + w - 1)
    .map(door => (side === 'y' ? door.x - building.x : door.y - building.y) + 1 - activeFacade.u).filter(u => u > 0 && u < activeFacade.length) : [];

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
    if (building.kind === 'apartment' && (material === 'plaster' || material === 'brick') && variation % 3 === 1) {
      for (const u of [left - .28, right + .08]) {
        faceRect(side, u, .2, low - 1, high + 2, palette.accentShade);
        line(facePoint(side, u + .02, high + 1), facePoint(side, u + .18, high + 1), palette.accent, 2);
        if (fine) for (let z = low + 3; z < high; z += 6) line(facePoint(side, u + .025, z), facePoint(side, u + .17, z), palette.accent);
      }
    }
    faceRect(side, left - .1, width + .2, low - 6, low - 3, palette.dark);
    faceRect(side, left - .1, width + .2, low - 4, low - 2, P.cream);
    line(facePoint(side, left - .06, low - 7), facePoint(side, left - .04, low - 12), palette.joint);
  };

  for (const facade of plan.facades) {
    activeFacade = facade;
    const { side, length, floors } = facade, wallHeight = facade.top * PIXEL_TILE, shade = side === 'x' ? palette.light : palette.dark;
    faceRect(side, 0, length, 0, wallHeight, shade);
    if (material === 'brick' && close) {
      for (let z = 8, row = 0; z < wallHeight; z += 8, row++) {
        line(facePoint(side, 0, z), facePoint(side, length, z), palette.joint);
        for (let u = row % 2 * .15; u < length; u += .3) {
          line(facePoint(side, u, z), facePoint(side, u, Math.min(wallHeight, z + 8)), palette.joint);
          if ((Math.round(u * 10) + row + seed) % 9 === 0) faceRect(side, u + .025, Math.min(.22, length - u - .025), z + 1, Math.min(wallHeight, z + 6), palette.patch);
        }
      }
    } else if (material === 'metal') {
      for (let u = .18; u < length; u += close ? .32 : .96) {
        line(facePoint(side, u, 10), facePoint(side, u, wallHeight - 5), palette.joint, 2);
        line(facePoint(side, u + .035, 12), facePoint(side, u + .035, wallHeight - 5), palette.trim);
      }
      for (let mark = 0; mark < (close ? 8 : 2); mark++) {
        const u = .3 + random() * (length - .8), top = 10 + random() * wallHeight * .3;
        faceRect(side, u, .035 + random() * .05, 7, top, palette.patch);
      }
    } else if (material === 'panel') {
      for (let u = 1.4; u < length; u += fine ? 1.4 : 2.8) {
        line(facePoint(side, u, 10), facePoint(side, u, wallHeight - 6), palette.joint, 2);
        line(facePoint(side, u + .04, 10), facePoint(side, u + .04, wallHeight - 6), palette.trim);
      }
      for (let floor = 1; floor < floors; floor++) line(facePoint(side, 0, floor * 73), facePoint(side, length, floor * 73), palette.joint, 3);
    } else {
      for (let mark = 0; mark < (close ? 14 : 3); mark++) {
        const u = .2 + random() * (length - .7), z = 15 + random() * (wallHeight - 27);
        faceRect(side, u, .13 + random() * .22, z, Math.min(wallHeight - 4, z + 5 + random() * 12), palette.patch);
      }
      const crackU = length * (.18 + seed % 53 / 100), crackZ = wallHeight * .45;
      line(facePoint(side, crackU, crackZ), facePoint(side, crackU + .08, crackZ - 10), palette.joint);
      line(facePoint(side, crackU + .08, crackZ - 10), facePoint(side, crackU, crackZ - 17), palette.joint);
    }
    faceRect(side, 0, length, 0, 11, '#647467');
    line(facePoint(side, 0, 12), facePoint(side, length, 12), palette.trim, 3);
    faceRect(side, 0, length, wallHeight - 12, wallHeight - 6, palette.joint);
    faceRect(side, 0, length, wallHeight - 6, wallHeight, palette.trim);
    // Broad architectural bands stay readable when mortar and wear disappear.
    // These are painted on the real wall, never new cover along an alley.
    for (const u of [0, length - .15]) faceRect(side, u, .15, 12, wallHeight - 6, palette.trim);
    for (let floor = 1; floor < floors; floor++) {
      faceRect(side, .15, length - .3, floor * 73 - 4, floor * 73 + 1, palette.dark);
      line(facePoint(side, .15, floor * 73 + 2), facePoint(side, length - .15, floor * 73 + 2), palette.trim, 2);
    }
    if (building.kind === 'shop') faceRect(side, .15, length - .3, 68, Math.min(83, wallHeight - 8), palette.accentShade);
    else if (building.kind === 'workshop' || building.kind === 'garage') {
      faceRect(side, .15, length - .3, 15, 23, palette.accentShade);
      line(facePoint(side, .15, 24), facePoint(side, length - .15, 24), P.sand, 2);
    }
    const cadence = buildingFacadeCadence(building, length), doors = doorPositions(side);
    const columns = Math.max(cadence.columns, Math.floor((length - .7) / (cadence.industrial ? 3.9 : building.kind === 'shop' ? 2.6 : 2.3)));
    for (let floor = 0; floor < floors; floor++) for (let column = 0; column < columns; column++) {
      const u = length * (column + 1) / (columns + 1), industrial = cadence.industrial;
      if (!floor && doors.some(door => Math.abs(door - u) < (industrial ? 1.65 : 1.05))) continue;
      const width = industrial ? 1.1 : building.kind === 'shop' && !floor ? 1.25 : .72;
      const low = industrial ? wallHeight - 30 : 18 + floor * 73, high = Math.min(wallHeight - 12, low + (industrial ? 15 : building.kind === 'shop' && !floor ? 32 : 25));
      if (low < facade.bottom * PIXEL_TILE + 2 || high <= low) continue;
      window(side, u, width, low, high, column + floor + seed);
      if (building.kind === 'apartment' && floor > 0 && (material === 'panel' || (column + seed) % 3 === 0)) {
        const balconyWidth = material === 'panel' ? 1.16 : 1.35;
        const z = low - 7, a = side === 'y' ? { x: facade.u + u - balconyWidth / 2, y: facade.plane } : { x: facade.plane, y: facade.u + u - balconyWidth / 2 };
        const bw = side === 'y' ? balconyWidth : .34, bh = side === 'y' ? .34 : balconyWidth;
        box(a.x, a.y, bw, bh, z - 4, z, ['#8c9887', '#647363', '#bbc0a6']);
        line(p(a.x, a.y + bh, z + 16), p(a.x + bw, a.y + bh, z + 16), INK, 2);
        line(p(a.x + bw, a.y, z + 16), p(a.x + bw, a.y + bh, z + 16), INK, 2);
        for (let bar = 0; bar <= 4; bar++) {
          const x = a.x + bw * bar / 4, y = a.y + bh;
          line(p(x, y, z), p(x, y, z + 16), INK);
        }
        if (fine && (column + floor + seed) % 3 === 1) {
          // Laundry is attached to an existing balcony; it introduces no actor.
          const at = (t: number, zz: number) => side === 'y' ? p(a.x + bw * t, a.y + bh, zz) : p(a.x + bw, a.y + bh * t, zz);
          line(at(.08, z + 17), at(.92, z + 17), P.cream);
          for (const [start, end, color] of [[.16, .43, P.cream], [.53, .8, palette.accent]] as const) {
            r.polygon([at(start, z + 17), at(end, z + 17), at(end, z + 4), at(start, z + 6)], color);
          }
        } else if (fine && (column + floor + seed) % 4 === 0) {
          // One planted balcony is a quiet sign of occupation, attached to
          // the existing railing rather than a new navigable object.
          const bx = side === 'y' ? a.x + .12 : a.x + bw, by = side === 'y' ? a.y + bh : a.y + .12;
          const pw = side === 'y' ? .62 : .1, ph = side === 'y' ? .1 : .62;
          box(bx, by, pw, ph, z + 6, z + 11, [P.terra, P.terraShade, P.terra]);
          quad(bx, by, pw, ph, z + 13, '#6f8358');
          if (close) for (const t of [.15, .6]) {
            const at = p(bx + pw * t, by + ph * t, z + 15);
            r.rect(at.x, at.y, Math.max(1, 3 * scale), Math.max(1, 2 * scale), '#c7ae83');
          }
        }
      } else if (fine && floor > 0 && (column + floor + seed) % 3 === 0) {
        const x = side === 'y' ? facade.u + u - .25 : facade.plane, y = side === 'y' ? facade.plane : facade.u + u - .25;
        const acWidth = side === 'y' ? .5 : .16, acHeight = side === 'y' ? .16 : .5;
        box(x, y, acWidth, acHeight, low - 18, low - 5, [P.steel, P.steelShade, P.steelLight]);
        const vent = p(x + acWidth, y + acHeight / 2, low - 11);
        r.ellipse(vent.x, vent.y, Math.max(2, Math.round(4 * scale)), Math.max(2, Math.round(5 * scale)), P.ink);
        line({ x: vent.x - 1, y: vent.y - 3 * scale }, { x: vent.x + 1, y: vent.y + 3 * scale }, P.steelLight);
        line(facePoint(side, u + .27, low - 16), facePoint(side, u + .27, low + 1), P.cream);
      }
      if (fine && building.kind === 'apartment' && floor === 0 && (column + seed) % 4 === 1) {
        const x = side === 'y' ? facade.u + u - .3 : facade.plane, y = side === 'y' ? facade.plane : facade.u + u - .3;
        const ww = side === 'y' ? .6 : .13, hh = side === 'y' ? .13 : .6;
        box(x, y, ww, hh, low - 12, low - 5, [P.terra, P.terraShade, P.soil]);
        for (let flower = 0; flower < 3; flower++) {
          const at = side === 'y' ? p(x + .1 + flower * .19, y + hh, low - 3) : p(x + ww, y + .1 + flower * .19, low - 3);
          r.rect(at.x - 2 * scale, at.y - 3 * scale, 5 * scale, 5 * scale, P.leafShade);
          r.rect(at.x, at.y - 4 * scale, 2 * scale, 2 * scale, flower % 2 ? P.cream : P.red);
        }
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
        faceRect(side, u - width / 2 - .08, width + .16, high + 5, high + 10, INK);
        for (let mark = 0; mark < 5; mark++) faceRect(side, u - width / 2 + mark * width / 5, width / 10, high + 5, high + 10, P.yellow);
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
        const x = side === 'y' ? facade.u + u - width / 2 - .09 : facade.plane + step * .15;
        const y = side === 'y' ? facade.plane + step * .15 : facade.u + u - width / 2 - .09;
        box(x, y, side === 'y' ? width + .18 : .15, side === 'y' ? .15 : width + .18, 0, (2 - step) * 3, ['#8b927e', '#737d6b', '#b4b59b']);
      }
      if (building.kind === 'shop' || building.kind === 'service') {
        const awningWidth = building.kind === 'shop' ? Math.min(3.1, length - .6, u * 2 - .4, (length - u) * 2 - .4) : 1.34;
        const x = side === 'y' ? facade.u + u - awningWidth / 2 : facade.plane, y = side === 'y' ? facade.plane : facade.u + u - awningWidth / 2;
        const aw = side === 'y' ? awningWidth : .38, ah = side === 'y' ? .38 : awningWidth;
        box(x, y, aw, ah, high + 3, high + 7, [palette.accent, palette.accentShade, palette.accent]);
        if (building.kind === 'shop') for (let stripe = 0; stripe < 7; stripe += 2) {
          const stripeWidth = awningWidth / 7;
          quad(x + (side === 'y' ? stripe * stripeWidth : 0), y + (side === 'x' ? stripe * stripeWidth : 0), side === 'y' ? stripeWidth : aw, side === 'x' ? stripeWidth : ah, high + 8, P.cream);
        }
        line(p(x, y + ah, high + 7), p(x + aw, y + ah, high + 7), '#c6bb92', 2);
      } else if (building.kind === 'apartment') {
        const canopyWidth = Math.min(1.65, length - .4, u * 2 - .3, (length - u) * 2 - .3);
        const x = side === 'y' ? facade.u + u - canopyWidth / 2 : facade.plane, y = side === 'y' ? facade.plane : facade.u + u - canopyWidth / 2;
        const cw = side === 'y' ? canopyWidth : .46, ch = side === 'y' ? .46 : canopyWidth;
        box(x, y, cw, ch, high + 4, high + 9, [palette.accent, palette.accentShade, palette.accent]);
        line(p(x, y + ch, high + 9), p(x + cw, y + ch, high + 9), palette.trim, 2);
        for (const t of [.12, .88]) {
          const ax = side === 'y' ? x + cw * t : x + cw, ay = side === 'x' ? y + ch * t : y + ch;
          line(p(ax, ay, high + 3), side === 'y' ? p(ax, facade.plane, high - 9) : p(facade.plane, ay, high - 9), INK, 2);
        }
      }
      const business = buildingStreetSign(building);
      if (business) {
        // One framed, legible shop board belongs to the actual entrance. Its
        // elevation stays below the real eaves, including one-storey shops.
        const boardWidth = Math.min(business.label.length * .29 + .6, 3.5, length - .6, u * 2 - .3, (length - u) * 2 - .3);
        const boardTop = Math.min(wallHeight - 9, high + 28), boardBottom = boardTop - 18;
        if (boardWidth > .65 && boardBottom > facade.bottom * PIXEL_TILE + 2) {
          const left = u - boardWidth / 2;
          faceRect(side, left, boardWidth, boardBottom, boardTop, business.edge);
          faceRect(side, left + .04, boardWidth - .08, boardBottom + 2, boardTop - 2, business.board);
          line(facePoint(side, left + .05, boardTop - 1), facePoint(side, left + boardWidth - .05, boardTop - 1), P.woodLight, 2);
          if (fine) streetSignLettering(business.label, (x, y, width, height) => {
            faceRect(side, left + .15 + x * (boardWidth - .3), width * (boardWidth - .3), boardBottom + 4 + (1 - y - height) * 10, boardBottom + 4 + (1 - y) * 10, business.lettering);
          });
          else for (const t of [.16, .34, .52, .7]) faceRect(side, left + boardWidth * t, boardWidth * .08, boardBottom + 6, boardTop - 6, business.lettering);
          if (close && building.kind !== 'workshop') {
            const notice = Math.min(length - .48, u + width / 2 + .22);
            faceRect(side, notice, .32, 20, 49, business.edge);
            faceRect(side, notice + .025, .27, 22, 47, P.cream);
            faceRect(side, notice + .05, .22, 37, 44, business.board);
            for (const z of [26, 30, 34]) line(facePoint(side, notice + .06, z), facePoint(side, notice + .24, z), P.steelShade);
          }
        }
      }
      // An address tile and notices make a doorway distinct at walking zoom.
      if (fine) {
        const at = Math.min(length - .42, u + width / 2 + .18);
        faceRect(side, at, .22, high - 1, high + 11, palette.accentShade);
        faceRect(side, at + .035, .15, high + 1, high + 9, P.cream);
        line(facePoint(side, at + .08, high + 3), facePoint(side, at + .08, high + 7), INK, 2);
        if (building.kind !== 'garage' && building.kind !== 'workshop') {
          faceRect(side, at, .27, 21, 35, palette.dark);
          faceRect(side, at + .025, .11, 23, 33, P.sand);
          faceRect(side, at + .15, .095, 25, 34, '#c9c8af');
        }
        if (building.kind === 'apartment') {
          // Mail slots and a worn residents' notice board share the entrance
          // wall. They add no apparent object in the doorway or on its steps.
          const boxes = Math.max(.22, u - width / 2 - .86);
          if (boxes + .57 < u - width / 2 - .08) {
            faceRect(side, boxes, .57, 27, 45, '#4b635b');
            for (const column of [0, 1, 2]) {
              faceRect(side, boxes + .035 + column * .18, .14, 29, 43, '#81958a');
              line(facePoint(side, boxes + .05 + column * .18, 39), facePoint(side, boxes + .145 + column * .18, 39), P.ink);
              faceRect(side, boxes + .08 + column * .18, .05, 31, 34, P.cream);
            }
          }
        }
      }
    }
    // Attached utilities stay on the facade and below the eaves.
    const drain = length - .12;
    faceRect(side, drain - .045, .09, 7, wallHeight - 3, P.steelShade);
    line(facePoint(side, drain + .025, 8), facePoint(side, drain + .025, wallHeight - 3), P.steelLight, 2);
    for (let z = 19; z < wallHeight - 6; z += 38) line(facePoint(side, drain - .07, z), facePoint(side, drain + .07, z), INK, 2);
    line(facePoint(side, drain, 7), facePoint(side, drain - .11, 4), P.steelShade, 3);
    if (close && facade.bottom === 0) {
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

  const surface = roofSurface(building), { roof } = surface;
  const slate = palette.roof;
  const surfaceColors = { roofLight: slate[0], roofDark: slate[1], wallLight: palette.light, wallDark: palette.dark, trim: palette.trim, glass: GLASS_DARK };
  for (const face of plan.surfaces) {
    const points = face.points.map(at => p(at.x, at.y, at.z * PIXEL_TILE));
    r.polygon(points, surfaceColors[face.material]);
    // Broad folds, hips and the mansard knee survive the 32px atlas. Fine
    // roof fasteners never compete with those address-defining silhouettes.
    if (face.material.startsWith('roof')) for (let i = 0; i < points.length; i++) {
      line(points[i]!, points[(i + 1) % points.length]!, face.material === 'roofLight' ? '#b9bda6' : '#4f665e', 2);
    }
  }
  if (close) for (const volume of plan.volumes) {
    const length = volume.axis === 'x' ? volume.width : volume.height, span = volume.axis === 'x' ? volume.height : volume.width;
    // A few long standing seams follow the actual surface instead of flattening
    // every roof into the same horizontal panel.
    for (let u = .8; u < length - .4; u += 1.4) {
      const at = (s: number) => ({ x: volume.x + (volume.axis === 'x' ? u : s), y: volume.y + (volume.axis === 'x' ? s : u) });
      for (const [a, b] of [[.2, span * .19], [span * .19, span * .5], [span * .5, span * .81], [span * .81, span - .2]] as const) {
        const aa = at(a), bb = at(b);
        line(p(aa.x, aa.y, surface.height(aa.x, aa.y) + 1), p(bb.x, bb.y, surface.height(bb.x, bb.y) + 1), '#71867b');
      }
    }
  }

  const dormer = buildingRoofDormer(building);
  if (dormer) {
    const { x, y, width: dw, height: dh, side } = dormer;
    const base = surface.height(x + dw, y + dh), top = base + 18;
    r.polygon([p(x + dw, y, surface.height(x + dw, y)), p(x + dw, y + dh, base), p(x + dw, y + dh, top), p(x + dw, y, top)], palette.light);
    r.polygon([p(x, y + dh, surface.height(x, y + dh)), p(x + dw, y + dh, base), p(x + dw, y + dh, top), p(x, y + dh, top)], palette.dark);
    quad(x, y, dw, dh, top, slate[1]);
    const at = (u: number, z: number) => side === 'y' ? p(x + dw * u, y + dh, z) : p(x + dw, y + dh * u, z);
    r.polygon([at(.12, base + 2), at(.88, base + 2), at(.88, top - 2), at(.12, top - 2)], palette.trim);
    r.polygon([at(.18, base + 4), at(.82, base + 4), at(.82, top - 4), at(.18, top - 4)], GLASS_DARK);
    line(at(.5, base + 4), at(.5, top - 4), palette.trim, 2);
    line(at(0, top + 1), at(1, top + 1), palette.trim, 2);
  }

  // Each volume has its own eave; a low wing never inherits a floating gutter.
  for (const facade of plan.facades) {
    const at = (u: number, dz: number) => facade.side === 'x' ? p(facade.plane, facade.u + u, facade.top * PIXEL_TILE + dz) : p(facade.u + u, facade.plane, facade.top * PIXEL_TILE + dz);
    line(at(0, 1), at(facade.length, 1), P.steelShade, 4);
    line(at(0, 3), at(facade.length, 3), P.steelLight);
  }

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
    if (building.kind === 'apartment' || building.kind === 'service') {
      const ax = w * .19, ay = h * .34, az = surface.height(ax, ay);
      // Aerials belong to a few public roofs, away from the real steam outlet.
      if (seed % 3 === 0) {
        line(p(ax, ay, az), p(ax, ay, az + 36), INK, 3);
        line(p(ax - .27, ay, az + 28), p(ax + .27, ay, az + 28), P.steelLight, 2);
        for (const u of [-.2, 0, .2]) line(p(ax + u, ay - .14, az + 28), p(ax + u, ay + .14, az + 28), P.steelShade, 2);
        line(p(ax - .2, ay + .16, az), p(ax, ay, az + 12), P.steelShade);
      } else if (seed % 3 === 1) {
        line(p(ax, ay, az), p(ax, ay, az + 14), P.steelShade, 3);
        const dish = p(ax, ay, az + 19);
        r.ellipse(dish.x, dish.y, Math.max(1, Math.round(10 * scale)), Math.max(1, Math.round(7 * scale)), P.steelShade);
        r.ellipse(dish.x - scale, dish.y - scale, Math.max(1, Math.round(8 * scale)), Math.max(1, Math.round(5 * scale)), P.cream);
        line({ x: dish.x, y: dish.y + 3 * scale }, { x: dish.x + 7 * scale, y: dish.y - 6 * scale }, INK, 2);
      }
    }
  }
}
