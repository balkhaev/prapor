import type { LiveLandscapePath, LivePoint, LiveTerrain, LiveWorld } from './game/live';
import { PIXEL_PALETTE as P } from './pixel-art';
import { pixelLandcoverBands, segmentTouchesRect, type LandcoverRect } from './pixel-landcover';

export type GroundWorld = Pick<LiveWorld, 'width' | 'height' | 'seed' | 'paths' | 'city' | 'citySites'>;

type RGB = readonly [number, number, number];
const pigment = (hex: string): RGB => [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16)) as unknown as RGB;
const blend = (a: RGB, b: RGB, ratio: number): RGB => a.map((channel, i) => Math.round(channel * (1 - ratio) + b[i]! * ratio)) as unknown as RGB;
export const TERRAIN_PIGMENTS: Record<LiveTerrain, RGB> = {
  road: blend(pigment(P.concrete), pigment(P.ink), .4), concrete: pigment(P.concrete), forest: pigment(P.leafShade), water: pigment(P.glass),
  yard: blend(pigment(P.soil), pigment(P.concrete), .3), grass: pigment(P.leaf), path: pigment(P.wood),
  rail: blend(pigment(P.concreteShade), pigment(P.steel), .3), sand: pigment(P.sand),
};
/** Quiet, opaque colour steps keep local grain subordinate to the scenery. */
export const PIXEL_TERRAIN_PALETTES = Object.fromEntries(Object.entries(TERRAIN_PIGMENTS).map(([material, base]) =>
  [material, (material === 'concrete' ? [-7, -3, 0, 3, 6, 10] : material === 'road' ? [-10, -5, 0, 4, 9, 14] : [-15, -6, 0, 5, 12, 19])
    .map(offset => base.map(channel => Math.max(0, Math.min(255, channel + offset))) as unknown as RGB)])) as unknown as Record<LiveTerrain, readonly RGB[]>;
const organic = new Set<LiveTerrain>(['grass', 'forest', 'yard', 'path', 'sand']);
const hash = (x: number, y: number): number => {
  let value = Math.imul(x + 721, 374761393) ^ Math.imul(y + 191, 668265263);
  value = Math.imul(value ^ value >>> 13, 1274126177); return (value ^ value >>> 16) >>> 0;
};

/** Only transition eligibility is stored per cell. Colour weights are sampled
 * continuously inside the cell, so no whole-cell rings or coloured bands are
 * propagated out from a natural boundary. Higher bits mark the grass side of
 * a real paved edge; hard surfaces and authored interiors receive no blend. */
function groundTransitions(classes: Uint8Array, width: number, height: number, indoor: Uint8Array, kinds: readonly LiveTerrain[]): Uint16Array {
  const edges = new Uint16Array(width * height), soft = kinds.map(kind => organic.has(kind));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = y * width + x, material = classes[cell]!;
    if (!soft[material] || indoor[cell]) continue;
    edges[cell] = 16; // the centre of the 3-by-3 neighbourhood
    const green = kinds[material] === 'grass' || kinds[material] === 'forest';
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
      const next = (y + dy) * width + x + dx, neighbor = classes[next]!;
      // A diagonal cannot mix through the corner of two hard surfaces or a
      // closed room. Record reachability once, outside the pixel hot loop.
      if (soft[neighbor] && !indoor[next] && (!dx || !dy || soft[classes[y * width + x + dx]!] && !indoor[y * width + x + dx]
        || soft[classes[(y + dy) * width + x]!] && !indoor[(y + dy) * width + x])) {
        edges[cell]! |= 1 << ((dy + 1) * 3 + dx + 1);
        if (neighbor !== material) edges[cell]! |= 8192;
      }
      if (!green || dx && dy) continue;
      const ground = kinds[neighbor] ?? 'concrete';
      if (ground === 'road' || ground === 'concrete' || ground === 'rail') edges[cell]! |= dx < 0 ? 512 : dx > 0 ? 1024 : dy < 0 ? 2048 : 4096;
    }
  }
  return edges;
}

const smoothGround = (fraction: number): number => fraction * fraction * (3 - 2 * fraction);
/** Seamless low-frequency variation, shared by the repeated motif and edge
 * displacement. Rounded value islands replace independent rectangular chips. */
function groundNoise(px: number, py: number, seed: number, spacing = 32): number {
  const x = px / spacing, y = py / spacing, ix = Math.floor(x), iy = Math.floor(y), period = 128 / spacing;
  const u = smoothGround(x - ix), v = smoothGround(y - iy);
  const value = (dx: number, dy: number): number => hash(((ix + dx) % period + period) % period, (((iy + dy) % period + period) % period) ^ seed) / 4294967295;
  const top = value(0, 0) * (1 - u) + value(1, 0) * u, bottom = value(0, 1) * (1 - u) + value(1, 1) * u;
  return top * (1 - v) + bottom * v;
}

/** Scuffed courtyard ground follows real passages; no rectangular district colour wash. */
export function courtyardGroundMarks(site: Pick<NonNullable<LiveWorld['citySites']>[number], 'id' | 'kind' | 'courtyard' | 'passages'>): Array<LandcoverRect & { color: string }> {
  const marks: Array<LandcoverRect & { color: string }> = [], court = site.courtyard;
  const seed = [...site.id].reduce((value, char) => Math.imul(value, 31) + char.charCodeAt(0), 17) >>> 0;
  for (let patch = 0; patch < 5; patch++) {
    const value = hash(seed + patch * 71, patch * 13), width = court.width * (.22 + (value % 17) / 100), height = court.height * (.27 + (value >>> 4) % 19 / 100);
    const x = court.x + (court.width - width) * ((value >>> 8) % 101) / 100, y = court.y + (court.height - height) * ((value >>> 16) % 101) / 100;
    for (const band of pixelLandcoverBands({ x, y, width, height }, `${site.id}:${patch}`, 7)) {
      if (site.passages.some(path => path.slice(1).some((point, i) => segmentTouchesRect(path[i]!, point, band, .8)))) continue;
      marks.push({ ...band, color: site.kind === 'workyard' ? patch % 2 ? '#747b702b' : '#93857232' : patch % 2 ? '#7b865727' : '#b1a37d2b' });
    }
  }
  return marks;
}

/** Detailed ground stays within a 4096px texture side, including G10's million cells. */
export function terrainTextureResolution(width: number, height: number): number {
  const longest = Math.max(width, height);
  return Math.max(1, Math.min(longest <= 256 ? 16 : 12, Math.floor(4096 / longest)));
}

/** Bits point only to real land neighbours. A map edge never invents a bank. */
export function waterBankEdges(width: number, height: number, terrain: readonly LiveTerrain[]): Uint8Array {
  const edges = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (terrain[y * width + x] !== 'water') continue;
    if (x > 0 && terrain[y * width + x - 1] !== 'water') edges[y * width + x]! |= 1;
    if (x + 1 < width && terrain[y * width + x + 1] !== 'water') edges[y * width + x]! |= 2;
    if (y > 0 && terrain[(y - 1) * width + x] !== 'water') edges[y * width + x]! |= 4;
    if (y + 1 < height && terrain[(y + 1) * width + x] !== 'water') edges[y * width + x]! |= 8;
  }
  return edges;
}

function pixelMotifTone(material: LiveTerrain, px: number, py: number, resolution: number, seed: number, style: number, mass: number): number {
  let tone = mass < .2 ? 1 : mass > .78 ? 3 : 2;
  if (material === 'grass' || material === 'forest') {
    const tuft = hash(px >> 3, (py >> 3) ^ seed), tx = px % 8, ty = py % 8;
    const stemX = 2 + tuft % 4, stemY = 2 + (tuft >>> 3) % 3;
    if (tuft % 3 === 0 && tx === stemX && ty === stemY + 1) tone = 0;
    else if (tuft % 3 === 0 && (tx === stemX || tx === stemX + 1) && ty === stemY) tone = 4;
    else if (tuft % 13 === 0 && tx === stemX - 1 && ty === stemY + 2) tone = 5;
  } else if (material === 'concrete') {
    const tileW = style === 1 ? Math.max(4, Math.round(resolution * .75)) : style === 2 ? Math.max(6, resolution) : Math.max(4, Math.round(resolution));
    const tileH = style === 1 ? Math.max(3, Math.round(resolution * .5)) : style === 2 ? Math.max(4, Math.round(resolution * .75)) : tileW;
    const row = Math.floor(py / tileH), shiftedX = px + (style ? row % 2 * Math.floor(tileW / 2) : 0), tx = shiftedX % tileW, ty = py % tileH;
    const stone = hash(Math.floor(shiftedX / tileW), row ^ seed);
    // This bounded atlas can have just four pixels per world cell. A one-texel
    // mortar line would become a broad dark trench at walking zoom. Keep only
    // slab colour/wear here; fine outdoor joints are drawn at display scale.
    tone = mass > .78 ? 3 : 2;
    if (stone % 9 === 0 && tx > tileW * .32 && tx < tileW * .63 && ty > tileH * .28 && ty < tileH * .65) tone = 3;
    if (stone % 17 === 0 && tx === tileW - 2 && ty === tileH - 2) tone = 1;
  } else if (material === 'water') {
    const row = Math.floor(py / 5), ripple = hash(row, seed), waveX = (px + ripple % 17) % 23;
    tone = mass < .2 ? 1 : 2;
    if (py % 5 === ripple % 3 && waveX >= 3 && waveX <= 7) tone = 4;
    else if (py % 5 === ripple % 3 + 1 && waveX >= 6 && waveX <= 9) tone = 3;
    else if (ripple % 7 === 0 && py % 5 === ripple % 3 && waveX === 5) tone = 5;
  } else {
    const stone = hash(px >> 2, (py >> 2) ^ seed), tx = px % 4, ty = py % 4;
    if (material === 'yard' || material === 'rail') {
      if (stone % 4 === 0 && tx === 1 && ty === 2) tone = 0;
      else if (stone % 4 === 0 && (tx === 1 || tx === 2) && ty === 1) tone = 4;
      else if (stone % 17 === 0 && tx === 2 && ty === 2) tone = 5;
    } else if (material === 'path') {
      if (stone % 7 === 0 && ty === 2 && tx >= 1 && tx <= 2) tone = 1;
      else if (stone % 13 === 0 && tx === 1 && ty === 1) tone = 5;
      else if (stone % 13 === 0 && tx === 2 && ty === 1) tone = 4;
    } else if (material === 'sand') {
      if (stone % 11 === 0 && ty === 1 && tx <= 2) tone = 3;
      else if (stone % 17 === 0 && tx === 1 && ty === 3) tone = 4;
    } else if (material === 'road' && stone % 19 === 0 && tx === 2 && ty === 1) tone = 3;
  }
  return tone;
}

/** Small motif atlases and one upload strip avoid a second full-world bitmap.
 * Continuous organic mixing is limited to the marked boundary cells; all
 * grain/noise hashes still run only in the small, seamless lookup atlases. */
export function paintTerrainTexture(c: CanvasRenderingContext2D, world: GroundWorld, terrain: readonly LiveTerrain[], resolution: number): void {
  const width = world.width, height = world.height, textureWidth = width * resolution, textureHeight = height * resolution;
  const seed = [...world.seed].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) | 0, 0);
  const kinds = Object.keys(PIXEL_TERRAIN_PALETTES) as LiveTerrain[], concrete = kinds.indexOf('concrete');
  const materialIds = new Map(kinds.map((kind, index) => [kind, index]));
  const classes = Uint8Array.from(terrain, material => materialIds.get(material)!), indoor = new Uint8Array(width * height);
  for (const site of world.citySites ?? []) for (const building of site.buildings) {
    for (let y = Math.max(0, building.y); y < Math.min(height, building.y + building.height); y++) indoor.fill(1, y * width + Math.max(0, building.x), y * width + Math.min(width, building.x + building.width));
    const style = building.kind === 'workshop' || building.kind === 'garage' ? 2 : building.kind === 'service' || building.kind === 'shop' || building.facade === 'brick' ? 1 : 0;
    if (!style) continue;
    // Masonry belongs to actual door/frontage pads, never an administrative quarter boundary.
    for (let y = Math.max(0, building.y - 1); y < Math.min(height, building.y + building.height + 1); y++) for (let x = Math.max(0, building.x - 1); x < Math.min(width, building.x + building.width + 1); x++) if (classes[y * width + x] === concrete) classes[y * width + x] = kinds.length + style - 1;
  }
  const littleEndian = new Uint8Array(new Uint32Array([255]).buffer)[0] === 255;
  const packChannels = (red: number, green: number, blue: number): number => littleEndian ? red | green << 8 | blue << 16 | 255 << 24 : red << 24 | green << 16 | blue << 8 | 255;
  const packed = (color: RGB): number => packChannels(color[0], color[1], color[2]);
  const palettes = kinds.map(kind => PIXEL_TERRAIN_PALETTES[kind].map(color => color[0] | color[1] << 8 | color[2] << 16));
  const grain = new Float32Array(128 * 128), warp = new Float32Array(128 * 128 * 2);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const at = y * 128 + x;
    grain[at] = groundNoise(x, y, seed);
    warp[at * 2] = (groundNoise(x, y, seed ^ 193) - .5) * .48;
    warp[at * 2 + 1] = (groundNoise(x + 37, y + 19, seed ^ 977) - .5) * .48;
  }
  const atlases = [...kinds, 'concrete', 'concrete'].map((material, id) => {
    const style = id >= kinds.length ? id - kinds.length + 1 : 0;
    const tileW = style === 1 ? Math.max(4, Math.round(resolution * .75)) : style === 2 ? Math.max(6, resolution) : Math.max(4, Math.round(resolution));
    const tileH = style === 1 ? Math.max(3, Math.round(resolution * .5)) : style === 2 ? Math.max(4, Math.round(resolution * .75)) : tileW;
    // Paving repeats on whole masonry blocks, never half of a slab at an atlas edge.
    const w = material === 'concrete' ? tileW * (style ? 16 : 8) : 128, h = material === 'concrete' ? tileH * (style ? 16 : 8) : 128;
    const pixels = new Uint32Array(w * h), tones = new Uint8Array(w * h), palette = PIXEL_TERRAIN_PALETTES[material as LiveTerrain].map(packed);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const tone = pixelMotifTone(material as LiveTerrain, x, y, resolution, seed, style, grain[y % 128 * 128 + x % 128]!); pixels[y * w + x] = palette[tone]!; tones[y * w + x] = tone; }
    return { pixels, tones, width: w, height: h };
  });
  const edges = groundTransitions(classes, width, height, indoor, kinds);
  const fringe = kinds.map(kind =>
    PIXEL_TERRAIN_PALETTES[kind].map((color, tone) => packed(blend(color, PIXEL_TERRAIN_PALETTES.yard[tone]!, .28))));
  const bandHeight = Math.min(textureHeight, resolution * 8), pixels = c.createImageData(textureWidth, bandHeight);
  const banks = waterBankEdges(width, height, terrain), bankShade = packed(blend(pigment(P.glass), pigment(P.leafShade), .35)), bankLight = packed(blend(pigment(P.glassLight), pigment(P.sand), .28));
  const data = new Uint32Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength / 4), atlasRows = new Uint32Array(atlases.length);
  for (let bandY = 0; bandY < textureHeight; bandY += bandHeight) {
    const rows = Math.min(bandHeight, textureHeight - bandY);
    for (let py = 0; py < rows; py++) {
      const textureY = bandY + py, cy = Math.floor(textureY / resolution), localY = textureY % resolution;
      for (let atlas = 0; atlas < atlases.length; atlas++) atlasRows[atlas] = textureY % atlases[atlas]!.height * atlases[atlas]!.width;
      for (let px = 0; px < textureWidth; px++) {
        const cx = Math.floor(px / resolution), localX = px % resolution, cell = cy * width + cx;
        const material = classes[cell]!;
        const atlas = atlases[material]!;
        const sample = atlasRows[material]! + px % atlas.width;
        let color = atlas.pixels[sample]!;
        const edge = edges[cell]!;
        if (edge & 8192) {
          const at = ((textureY % 128) * 128 + px % 128) * 2;
          const worldX = (px + .5) / resolution - .5 + warp[at]!, worldY = (textureY + .5) / resolution - .5 + warp[at + 1]!;
          const left = Math.floor(worldX), top = Math.floor(worldY), u = smoothGround(worldX - left), v = smoothGround(worldY - top);
          const tone = atlas.tones[sample]!;
          const x0 = Math.max(0, Math.min(width - 1, left)), x1 = Math.max(0, Math.min(width - 1, left + 1));
          const y0 = Math.max(0, Math.min(height - 1, top)), y1 = Math.max(0, Math.min(height - 1, top + 1));
          const dx0 = x0 - cx + 1, dx1 = x1 - cx + 1, dy0 = (y0 - cy + 1) * 3, dy1 = (y1 - cy + 1) * 3;
          const own = palettes[material]![tone]!;
          const a = edge & 1 << (dy0 + dx0) ? palettes[classes[y0 * width + x0]!]![tone]! : own;
          const b = edge & 1 << (dy0 + dx1) ? palettes[classes[y0 * width + x1]!]![tone]! : own;
          const d = edge & 1 << (dy1 + dx0) ? palettes[classes[y1 * width + x0]!]![tone]! : own;
          const e = edge & 1 << (dy1 + dx1) ? palettes[classes[y1 * width + x1]!]![tone]! : own;
          const wa = (1 - u) * (1 - v), wb = u * (1 - v), wd = (1 - u) * v, we = u * v;
          color = packChannels(Math.round((a & 255) * wa + (b & 255) * wb + (d & 255) * wd + (e & 255) * we),
            Math.round((a >> 8 & 255) * wa + (b >> 8 & 255) * wb + (d >> 8 & 255) * wd + (e >> 8 & 255) * we),
            Math.round((a >> 16 & 255) * wa + (b >> 16 & 255) * wb + (d >> 16 & 255) * wd + (e >> 16 & 255) * we));
        }
        if (edge & 7680) {
          const x = (localX + .5) / resolution, y = (localY + .5) / resolution;
          const distance = Math.min(edge & 512 ? x : 1, edge & 1024 ? 1 - x : 1, edge & 2048 ? y : 1, edge & 4096 ? 1 - y : 1);
          const variation = warp[((textureY % 128) * 128 + px % 128) * 2]!;
          if (distance < .15 + variation * .4) color = fringe[material]![atlas.tones[sample]!]!;
        }
        data[py * textureWidth + px] = color;
        if (banks[cell]) {
          const bank = banks[cell]!, distance = Math.min(bank & 1 ? localX : resolution, bank & 2 ? resolution - 1 - localX : resolution, bank & 4 ? localY : resolution, bank & 8 ? resolution - 1 - localY : resolution);
          if (distance === 0) data[py * textureWidth + px] = bankShade;
          else if (distance === 1 && hash(px >> 1, textureY >> 1) % 3 === 0) data[py * textureWidth + px] = bankLight;
        }
      }
    }
    c.putImageData(pixels, 0, bandY, 0, 0, textureWidth, rows);
  }
}
export type SurfaceRun = { x: number; y: number; width: number };
export type SurfaceMasks = { road: Uint8Array; indoor: Uint8Array; roadRuns: SurfaceRun[] };

export function buildSurfaceMasks(world: GroundWorld, terrain: readonly LiveTerrain[], walkable: Uint8Array, buildings: readonly Pick<NonNullable<LiveWorld['citySites']>[number]['buildings'][number], 'x' | 'y' | 'width' | 'height'>[] = world.citySites?.flatMap(site => site.buildings) ?? []): SurfaceMasks {
  const indoor = new Uint8Array(world.width * world.height), road = new Uint8Array(world.width * world.height);
  for (const building of buildings) {
    for (let y = Math.max(0, building.y); y < Math.min(world.height, building.y + building.height); y++) for (let x = Math.max(0, building.x); x < Math.min(world.width, building.x + building.width); x++) indoor[y * world.width + x] = 1;
  }
  const roadRuns: SurfaceRun[] = [];
  for (let y = 0; y < world.height; y++) {
    let start = -1;
    for (let x = 0; x <= world.width; x++) {
      const cell = y * world.width + x, accepted = x < world.width && (terrain[cell] === 'road' || terrain[cell] === 'rail') && !!walkable[cell] && !indoor[cell];
      if (accepted) { road[cell] = 1; if (start < 0) start = x; }
      else if (start >= 0) { roadRuns.push({ x: start, y, width: x - start }); start = -1; }
    }
  }
  return { road, indoor, roadRuns };
}

type RoadSegment = { path: LiveLandscapePath; a: LivePoint; b: LivePoint; dx: number; dy: number; length: number; offset: number };
export type RoadIntersection = LivePoint & { a: RoadSegment; b: RoadSegment };
export type RoadSurfacePlan = { segments: RoadSegment[]; intersections: RoadIntersection[] };

const isUrbanStreet = (path: LiveLandscapePath): boolean => path.id.startsWith('city-street-') || path.id.startsWith('metro-');
export function roadHasMarkings(path: LiveLandscapePath): boolean {
  return path.width >= 5 && (isUrbanStreet(path) || path.id === 'city-ring' || path.id.startsWith('highway-') || path.id.startsWith('arterial-'));
}
export function cityPedestrianCrossings(plan: RoadSurfacePlan): RoadIntersection[] {
  return plan.intersections.filter(crossing => isUrbanStreet(crossing.a.path) && isUrbanStreet(crossing.b.path) && crossing.a.path.width >= 4 && crossing.b.path.width >= 4
    && Math.abs(crossing.a.dx * crossing.b.dy - crossing.a.dy * crossing.b.dx) / (crossing.a.length * crossing.b.length) > .95);
}

export const PIXEL_ASPHALT_PALETTE: readonly RGB[] = [[48, 59, 66], [55, 66, 72], [62, 73, 78], [67, 78, 82], [76, 85, 85]];
function asphaltPattern(c: CanvasRenderingContext2D, resolution: number): CanvasPattern | null {
  if (typeof document === 'undefined') return null;
  const image = document.createElement('canvas'); image.width = 128; image.height = 128;
  const texture = image.getContext('2d'); if (!texture) return null;
  const pixels = texture.createImageData(image.width, image.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const patch = hash(x >> 3, y >> 3), pebble = hash(x >> 1, y >> 1), at = (y * image.width + x) * 4;
    const tone = pebble % 19 === 0 && x % 2 === 0 && y % 2 === 0 ? 4 : pebble % 13 === 0 ? 1 : patch % 11 === 0 ? 3 : 2;
    const color = PIXEL_ASPHALT_PALETTE[tone]!;
    pixels.data[at] = color[0]; pixels.data[at + 1] = color[1]; pixels.data[at + 2] = color[2]; pixels.data[at + 3] = 255;
  }
  texture.putImageData(pixels, 0, 0);
  const pattern = c.createPattern(image, 'repeat'); pattern?.setTransform({ a: 1 / resolution, d: 1 / resolution }); return pattern;
}

/** Intersections follow the actual path geometry, including translated or larger cities. */
export function buildRoadSurfacePlan(paths: readonly LiveLandscapePath[], road: Uint8Array, width: number, height: number): RoadSurfacePlan {
  const segments: RoadSegment[] = [], intersections: RoadIntersection[] = [];
  for (const path of paths) {
    if (path.kind !== 'road') continue;
    let offset = 0;
    for (let index = 1; index < path.points.length; index++) {
      const a = { x: path.points[index - 1]!.x + .5, y: path.points[index - 1]!.y + .5 }, b = { x: path.points[index]!.x + .5, y: path.points[index]!.y + .5 }, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (length > .05) segments.push({ path, a, b, dx, dy, length, offset }); offset += length;
    }
  }
  const found = new Set<string>();
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const a = segments[i]!, b = segments[j]!;
    if (a.path === b.path || a.path.width < 3 || b.path.width < 3) continue;
    if (Math.max(a.a.x, a.b.x) < Math.min(b.a.x, b.b.x) || Math.max(b.a.x, b.b.x) < Math.min(a.a.x, a.b.x) || Math.max(a.a.y, a.b.y) < Math.min(b.a.y, b.b.y) || Math.max(b.a.y, b.b.y) < Math.min(a.a.y, a.b.y)) continue;
    const cross = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(cross) / (a.length * b.length) < .55) continue;
    const x = b.a.x - a.a.x, y = b.a.y - a.a.y, t = (x * b.dy - y * b.dx) / cross, u = (x * a.dy - y * a.dx) / cross;
    if (t < -.001 || t > 1.001 || u < -.001 || u > 1.001) continue;
    const point = { x: a.a.x + a.dx * t, y: a.a.y + a.dy * t }, cellX = Math.floor(point.x), cellY = Math.floor(point.y);
    if (cellX < 0 || cellY < 0 || cellX >= width || cellY >= height || !road[cellY * width + cellX]) continue;
    const key = `${Math.round(point.x * 2)}:${Math.round(point.y * 2)}`;
    if (!found.has(key)) { intersections.push({ ...point, a, b }); found.add(key); }
  }
  return { segments, intersections };
}

/** Cached markings are clipped once against authoritative road, free cover and interior masks. */
export function paintRoadSurface(c: CanvasRenderingContext2D, world: GroundWorld, masks: SurfaceMasks): void {
  const { road, roadRuns } = masks, plan = buildRoadSurfacePlan(world.paths ?? [], road, world.width, world.height);
  const stroke = (a: LivePoint, b: LivePoint, color: string, width: number) => { c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.strokeStyle = color; c.lineWidth = width; c.stroke(); };
  const clip = () => { c.beginPath(); for (const run of roadRuns) c.rect(run.x, run.y, run.width, 1); c.clip(); };
  c.save(); clip(); c.lineCap = 'round'; c.lineJoin = 'round';
  const paths = world.paths?.filter(path => path.kind === 'road') ?? [], grain = asphaltPattern(c, terrainTextureResolution(world.width, world.height));
  const pathStroke = (path: LiveLandscapePath, color: string | CanvasPattern, width: number) => { c.beginPath(); path.points.forEach((point, index) => index ? c.lineTo(point.x + .5, point.y + .5) : c.moveTo(point.x + .5, point.y + .5)); c.strokeStyle = color; c.lineWidth = width; c.stroke(); };
  // Join all shoulders before asphalt. The smooth centerline, rather than raster squares,
  // determines the visible road edge; the physical mask remains an absolute safety clip.
  for (const path of paths) pathStroke(path, path.id.startsWith('city-') || isUrbanStreet(path) ? '#a4ad98' : '#a99c7f', path.width + .35);
  for (const path of paths) if (path.id.startsWith('city-') || isUrbanStreet(path)) pathStroke(path, '#bdc3aa', path.width + .07);
  for (const path of paths) pathStroke(path, grain ?? '#3e4a51', Math.max(1, path.width - .28));
  c.lineCap = 'butt';
  // Flush maintenance details add history without suggesting loot or cover.
  // Each one is clipped by the same physical surface as the road itself.
  for (const detail of roadSurfaceDetails(world, masks)) {
    const { x, y, kind, variant } = detail;
    if (kind === 'repair') {
      stroke({ x: x - .44, y: y - .12 }, { x: x + .4, y: y + .1 }, '#344249', .55);
      stroke({ x: x - .4, y: y - .4 }, { x: x + .4, y: y - .18 }, '#65716e', .055);
      if (variant) stroke({ x: x - .38, y: y + .12 }, { x: x + .36, y: y + .3 }, '#48565a', .06);
    } else if (kind === 'drain') {
      stroke({ x: x - .23, y: y }, { x: x + .23, y }, '#283b3d', .48);
      for (let slot = -.16; slot <= .18; slot += .08) stroke({ x: x + slot, y: y - .17 }, { x: x + slot, y: y + .17 }, '#819088', .035);
      stroke({ x: x - .24, y: y - .24 }, { x: x + .24, y: y - .24 }, '#93a094', .045);
    } else {
      stroke({ x: x - .32, y: y - .42 }, { x: x - .1, y: y - .1 }, '#2e3d42', .055);
      stroke({ x: x - .1, y: y - .1 }, { x: x + .04, y: y + .17 }, '#2e3d42', .055);
      stroke({ x: x + .04, y: y + .17 }, { x: x + .3, y: y + .36 }, '#2e3d42', .055);
      stroke({ x: x - .1, y: y - .1 }, { x: x + .18, y: y - .21 }, '#65736c', .04);
    }
  }
  for (const segment of plan.segments) {
    const ux = segment.dx / segment.length, uy = segment.dy / segment.length;
    // Short wheel-wear patches use one opaque shade instead of continuous alpha noise.
    for (const side of [-1, 1]) {
      const offset = segment.path.width * .24 * side;
      for (let along = 2.5; along < segment.length - 1; along += 7) {
        if (hash(Math.round(segment.a.x + ux * along), Math.round(segment.a.y + uy * along)) % 3) continue;
        const end = Math.min(along + 1.5, segment.length);
        stroke({ x: segment.a.x + ux * along - uy * offset, y: segment.a.y + uy * along + ux * offset },
          { x: segment.a.x + ux * end - uy * offset, y: segment.a.y + uy * end + ux * offset }, '#37434b', .125);
      }
    }
    if (!roadHasMarkings(segment.path)) continue;
    for (let distance = (4.4 - segment.offset % 4.4) % 4.4; distance < segment.length; distance += 4.4) {
      const end = Math.min(distance + 1.65, segment.length), mid = { x: segment.a.x + ux * (distance + end) / 2, y: segment.a.y + uy * (distance + end) / 2 };
      if (plan.intersections.some(point => Math.hypot(mid.x - point.x, mid.y - point.y) < Math.max(point.a.path.width, point.b.path.width) * .65 + 2.4)) continue;
      stroke({ x: segment.a.x + ux * distance, y: segment.a.y + uy * distance }, { x: segment.a.x + ux * end, y: segment.a.y + uy * end }, '#c9c6a3', .125);
    }
  }
  const city = world.city;
  for (const crossing of cityPedestrianCrossings(plan)) {
    if (!city || crossing.x < city.x || crossing.y < city.y || crossing.x > city.x + city.width || crossing.y > city.y + city.height) continue;
    for (const [along, cross] of [[crossing.a, crossing.b], [crossing.b, crossing.a]] as const) {
      const ux = along.dx / along.length, uy = along.dy / along.length, nx = -uy, ny = ux, half = Math.max(.7, along.path.width / 2 - .55);
      for (const side of [-1, 1]) {
        const distance = (cross.path.width / 2 + 1.05) * side, center = { x: crossing.x + ux * distance, y: crossing.y + uy * distance };
        for (let across = -half; across < half; across += .72) {
          const a = { x: center.x + nx * across - ux * .33, y: center.y + ny * across - uy * .33 }, b = { x: center.x + nx * across + ux * .33, y: center.y + ny * across + uy * .33 };
          stroke(a, b, '#ddd8b8', .24);
        }
        const stop = { x: center.x + ux * side * 1.15, y: center.y + uy * side * 1.15 };
        stroke({ x: stop.x - nx * side * .12, y: stop.y - ny * side * .12 }, { x: stop.x - nx * side * half, y: stop.y - ny * side * half }, '#ddd8b8', .125);
      }
    }
  }
  c.restore();
}

export type RoadSurfaceDetail = LivePoint & { kind: 'repair' | 'drain' | 'crack'; variant: number };
/** Stable spatial sampling covers the whole world; nothing accumulates on ticks. */
export function roadSurfaceDetails(world: Pick<GroundWorld, 'width' | 'height' | 'seed'>, masks: SurfaceMasks): RoadSurfaceDetail[] {
  const details: RoadSurfaceDetail[] = [], seed = [...world.seed].reduce((value, char) => Math.imul(value, 31) + char.charCodeAt(0), 0) | 0;
  for (const run of masks.roadRuns) for (let x = run.x; x < run.x + run.width; x++) {
    const sample = hash(x ^ seed, run.y);
    if (sample % 43 !== 0 || !masks.road[run.y * world.width + x]) continue;
    const broad = x > 0 && run.y > 0 && x < world.width - 1 && run.y < world.height - 1
      && masks.road[run.y * world.width + x - 1] && masks.road[run.y * world.width + x + 1]
      && masks.road[(run.y - 1) * world.width + x] && masks.road[(run.y + 1) * world.width + x];
    details.push({ x: x + .5, y: run.y + .5, kind: broad ? sample % 3 === 0 ? 'drain' : 'repair' : 'crack', variant: (sample >>> 8) % 2 });
  }
  return details;
}
