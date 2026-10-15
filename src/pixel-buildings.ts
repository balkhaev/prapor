import type { LiveCityBuilding, LiveObstacle, LivePoint } from './game/live';
import { BUILDING_EXTERIOR_HEIGHT_SCALE, buildingExteriorStyle, buildingRoofDormer, buildingWallHeight } from './live-map-art';
import { PIXEL_TILE, PIXEL_PALETTE as P, PixelRaster, pixelIso, pixelRandom, pixelSeed } from './pixel-art';
import { BUILDING_ARCHITECTURE_HEADROOM, buildingArchitecture, buildingArchitectureHeightAt, type BuildingFacade } from './building-architecture';
import { buildingStreetSign, streetSignLettering } from './live-street-life';
import { buildingFacadeLayout } from './building-facade-layout';

type BuildingSprite = { image: HTMLCanvasElement; anchor: LivePoint };
type NativeTile = 32 | 64 | 128;
type FacadeSide = 'x' | 'y';
type FacadeWindow = ReturnType<typeof buildingFacadeLayout>['windows'][number];
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
const INK = '#273b35', GLASS = '#557b81', GLASS_DARK = '#334f55';

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
  const window = (side: FacadeSide, item: FacadeWindow): void => {
    const { u: center, width, low, high, variation, style } = item;
    const warm = variation % 11 === 0, changedFrame = variation % 9 === 3;
    const frame = changedFrame ? '#77968e' : material === 'brick' && variation % 3 === 0 ? '#b4aa8b' : '#a9b7a9';
    const opening = (left: number, span: number, paired: boolean): void => {
      const right = left + span, height = high - low;
      // Masonry shadow surrounds a dark reveal. Thin frame strips leave the
      // glass as the subject; a heavy pale cross never fills the whole opening.
      faceRect(side, left - .065, span + .13, low - 3, high + 3, palette.joint);
      faceRect(side, left - .035, span + .07, low - 1, high + 1, INK);
      faceRect(side, left, span, low, high, warm ? '#8a7957' : side === 'x' ? GLASS : GLASS_DARK);
      faceRect(side, left, .025, low, high, frame);
      faceRect(side, right - .025, .025, low, high, frame);
      line(facePoint(side, left, high), facePoint(side, right, high), frame);
      line(facePoint(side, left, low), facePoint(side, right, low), frame);
      if (style === 'ribbon') {
        const panes = Math.max(2, Math.min(4, Math.round(span / .48)));
        for (let pane = 1; pane < panes; pane++) faceRect(side, left + span * pane / panes - .012, .024, low, high, '#8b9e94');
      } else if (!paired && (span > .62 || style === 'tall')) {
        faceRect(side, left + span * .53, .023, low, high, frame);
      }
      if (style === 'tall' || variation % 4 === 0) {
        const transom = low + height * (style === 'tall' ? .76 : .66);
        faceRect(side, left, span, transom, transom + .9, frame);
      }
      if (fine) {
        // Small reflections remain close in value to the glass, with a quiet
        // inner curtain or occasional replaced sash instead of white X marks.
        faceRect(side, left + span * .1, span * .31, high - height * .28, high - height * .16, warm ? '#b4a279' : '#728e8c');
        if (variation % 6 === 1) {
          faceRect(side, left + .035, span * .21, low + 2, high - 2, '#b8b7a0');
          faceRect(side, right - span * .17 - .025, span * .17, low + 3, high - 3, '#9caa9b');
        } else if (variation % 8 === 2) {
          faceRect(side, left + .03, span - .06, low + height * .71, high - 1, '#b7b19b');
          line(facePoint(side, left + .04, low + height * .7), facePoint(side, right - .04, low + height * .7), '#71877d');
        }
        if (close && variation % 13 === 4) {
          line(facePoint(side, left + span * .38, low + 3), facePoint(side, left + span * .49, low + height * .37), '#314742');
          line(facePoint(side, left + span * .49, low + height * .37), facePoint(side, left + span * .42, low + height * .55), '#314742');
        }
        if (close) faceRect(side,left+.035,.025,high-3,high-1,P.glassLight);
      }
      faceRect(side, left - .075, span + .15, low - 5, low - 2, palette.dark);
      faceRect(side, left - .075, span + .15, low - 3, low - 1.5, '#bdc1a8');
    };
    const left = center - width / 2;
    if (style === 'paired') {
      const gap = .11, pane = (width - gap) / 2;
      opening(left, pane, true); opening(left + pane + gap, pane, true);
    } else opening(left, width, false);
    if (fine && building.kind === 'apartment' && material !== 'panel' && style !== 'ribbon' && variation % 12 === 5) {
      for (const edge of [left - .23, left + width + .07]) {
        faceRect(side, edge, .16, low, high, palette.accentShade);
        line(facePoint(side, edge, high), facePoint(side, edge + .16, high), palette.accent);
        if (close) for (let z = low + 4; z < high - 2; z += 6) line(facePoint(side, edge + .02, z), facePoint(side, edge + .14, z), palette.accent);
      }
    }
  };

  const balcony = (facade: BuildingFacade, item: FacadeWindow): void => {
    if (item.balcony === 'none' || item.floor < 1) return;
    const { side, length } = facade, width = Math.min(Math.max(1.08, item.width + .3), item.u * 2 - .25, (length - item.u) * 2 - .25);
    const low = item.low - 9, top = Math.min(item.high + 6, facade.top * PIXEL_TILE - 8);
    if (width < .8 || low - 4 < facade.bottom * PIXEL_TILE + 1) return;
    const depth = item.balcony === 'glazed' ? .42 : .34, left = item.u - width / 2;
    const at = (t: number, d: number, z: number): LivePoint => side === 'y' ? p(facade.u + left + width * t, facade.plane + d, z) : p(facade.plane + d, facade.u + left + width * t, z);
    const pane = (a: number, b: number, d: number, bottom: number, high: number, color: string): void => r.polygon([at(a,d,bottom),at(b,d,bottom),at(b,d,high),at(a,d,high)],color);
    const x = side === 'y' ? facade.u + left : facade.plane, y = side === 'y' ? facade.plane : facade.u + left;
    const bw = side === 'y' ? width : depth, bh = side === 'y' ? depth : width;
    box(x,y,bw,bh,low-4,low,['#89978a','#5f7268','#bbc1aa']);
    line(at(0,depth,low+1),at(1,depth,low+1),INK);
    if (item.balcony === 'glazed') {
      pane(0,1,depth,low+1,low+15,item.variation % 2 ? palette.accentShade : '#82978b');
      pane(0,1,depth,low+15,top,'#476b70');
      r.polygon([at(1,0,low+15),at(1,depth,low+15),at(1,depth,top),at(1,0,top)],'#648184');
      if (fine) {
        pane(.06,.27,depth+.002,low+18,top-3,item.variation % 5 === 0 ? '#b4b59c' : '#77918b');
        pane(.62,.91,depth+.002,top-11,top-5,'#81978e');
      }
      for (const t of [0,.33,.66,1]) line(at(t,depth+.005,low+13),at(t,depth+.005,top),'#a4b2a3');
      line(at(0,depth,low+15),at(1,depth,low+15),'#9aaa9e');
      line(at(0,depth,top),at(1,depth,top),'#c0c5ae',2);
      quad(x,y,bw,bh,top+2,'#889b8f');
    } else {
      if (item.balcony === 'solid') {
        pane(0,1,depth,low+1,low+19,item.variation % 3 === 0 ? palette.accentShade : '#8c9b88');
        pane(.06,.94,depth+.002,low+3,low+16,item.variation % 3 === 0 ? palette.accent : '#a0ab96');
        r.polygon([at(1,0,low+1),at(1,depth,low+1),at(1,depth,low+19),at(1,0,low+19)],'#667d6d');
      } else {
        for (let bar = 0; bar <= 5; bar++) line(at(bar/5,depth,low+1),at(bar/5,depth,low+20),'#40574b');
        line(at(0,depth,low+7),at(1,depth,low+7),'#536b58');
      }
      line(at(0,depth,low+21),at(1,depth,low+21),'#b6bda5',2);
      line(at(1,0,low+21),at(1,depth,low+21),'#738879');
      if (fine && item.balcony === 'open' && item.variation % 4 === 1) {
        line(at(.08,depth,low+24),at(.92,depth,low+24),'#c5bea0');
        for (const [a,b,color] of [[.16,.41,'#c8bea2'],[.55,.77,'#718d87']] as const) r.polygon([at(a,depth+.005,low+24),at(b,depth+.005,low+24),at(b,depth+.005,low+8),at(a,depth+.005,low+10)],color);
      } else if (fine && item.variation % 4 === 2) {
        const px = side === 'y' ? x + width * .2 : x + depth, py = side === 'y' ? y + depth : y + width * .2;
        const pw = side === 'y' ? width * .5 : .09, ph = side === 'y' ? .09 : width * .5;
        box(px,py,pw,ph,low+16,low+21,[P.terra,P.terraShade,P.soil]);
        quad(px,py,pw,ph,low+24,'#667e58');
        if (close) for (const t of [.2,.6]) { const flower=p(px+pw*t,py+ph*t,low+26);r.rect(flower.x,flower.y,2,2,'#c8af8b'); }
      }
    }
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
    // Large bays, stairwell strips and material bands come from the same
    // public blueprint in the native and distant renderers.
    const layout = buildingFacadeLayout(building, facade), doors = layout.doors;
    for (const band of layout.bands) faceRect(side,band.u,band.width,band.low,band.high,palette[band.role]);
    for (const item of layout.windows) {
      const { u, low, high, variation, floor } = item;
      if (low < facade.bottom * PIXEL_TILE + 2 || high > wallHeight - 2 || high <= low) continue;
      window(side,item); balcony(facade,item);
      if (fine && item.balcony === 'none' && floor > 0 && variation % 7 === 0 && low - 18 > facade.bottom * PIXEL_TILE + 2) {
        const x = side === 'y' ? facade.u + u - .22 : facade.plane, y = side === 'y' ? facade.plane : facade.u + u - .22;
        const acWidth = side === 'y' ? .44 : .14, acHeight = side === 'y' ? .14 : .44;
        box(x,y,acWidth,acHeight,low-17,low-6,[P.steel,P.steelShade,P.steelLight]);
        const vent = p(x+acWidth,y+acHeight/2,low-11);
        r.ellipse(vent.x,vent.y,Math.max(1,Math.round(3*scale)),Math.max(1,Math.round(4*scale)),P.ink);
        line({x:vent.x-1,y:vent.y-2*scale},{x:vent.x+1,y:vent.y+2*scale},P.steelLight);
      }
      if (fine && building.kind === 'apartment' && floor === 0 && variation % 9 === 1) {
        const x = side === 'y' ? facade.u+u-.27 : facade.plane, y = side === 'y' ? facade.plane : facade.u+u-.27;
        const ww = side === 'y' ? .54 : .12, hh = side === 'y' ? .12 : .54;
        box(x,y,ww,hh,low-10,low-5,[P.terra,P.terraShade,P.soil]);
        quad(x,y,ww,hh,low-2,'#6d825a');
      }
    }
    for (const u of doors) {
      const loading = building.kind === 'workshop' || building.kind === 'garage', width = loading ? 1.8 : .76, high = loading ? 76 : 61;
      const portal = (seed + Math.round(u * 17)) % 3;
      if (!loading) {
        faceRect(side,u-width/2-.22,width+.44,0,high+11,palette.accentShade);
        faceRect(side,u-width/2-.14,width+.28,0,high+7,portal===1?palette.trim:palette.accent);
        faceRect(side,u-width/2-.085,width+.17,0,high+4,palette.dark);
        if (portal===2) {
          faceRect(side,u-width/2-.2,.055,4,high+8,palette.trim);
          faceRect(side,u+width/2+.145,.055,4,high+8,palette.trim);
        }
      }
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
        const at = (t: number,d: number,z: number) => side==='y'?p(x+cw*t,facade.plane+d,z):p(facade.plane+d,y+ch*t,z);
        if (portal===0) {
          box(x,y,cw,ch,high+4,high+9,[palette.accent,palette.accentShade,palette.accent]);
          line(at(0,.46,high+9),at(1,.46,high+9),palette.trim,2);
        } else if (portal===1) {
          r.polygon([at(0,0,high+14),at(1,0,high+14),at(1,.46,high+5),at(0,.46,high+5)],palette.accent);
          r.polygon([at(0,.46,high+2),at(1,.46,high+2),at(1,.46,high+5),at(0,.46,high+5)],palette.accentShade);
          line(at(0,.46,high+5),at(1,.46,high+5),palette.trim,2);
        } else {
          r.polygon([at(0,0,high+7),at(.5,0,high+20),at(.5,.46,high+20),at(0,.46,high+7)],palette.accentShade);
          r.polygon([at(.5,0,high+20),at(1,0,high+7),at(1,.46,high+7),at(.5,.46,high+20)],palette.accent);
          line(at(0,.46,high+7),at(.5,.46,high+20),palette.trim);
          line(at(.5,.46,high+20),at(1,.46,high+7),palette.trim);
        }
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
        if (!loading && (seed+Math.floor(u))%2===0) {
          const lamp = Math.max(.2,u-width/2-.32);
          faceRect(side,lamp,.13,high-3,high+9,'#425a50');
          faceRect(side,lamp+.025,.08,high,high+6,'#c1b994');
          line(facePoint(side,lamp-.025,high+10),facePoint(side,lamp+.155,high+10),P.steelShade,2);
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
