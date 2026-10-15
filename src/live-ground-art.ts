import type { LiveLandscapePath, LivePoint, LiveTerrain, LiveWorld } from './game/live';
import { PIXEL_PALETTE as P } from './pixel-art';

export type GroundWorld = Pick<LiveWorld, 'width' | 'height' | 'seed' | 'paths' | 'city' | 'citySites'>;

type RGB = readonly [number, number, number];
const pigment = (hex: string): RGB => [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16)) as unknown as RGB;
const blend = (a: RGB, b: RGB, ratio: number): RGB => a.map((channel, i) => Math.round(channel * (1 - ratio) + b[i]! * ratio)) as unknown as RGB;
export const TERRAIN_PIGMENTS: Record<LiveTerrain, RGB> = {
  road: blend(pigment(P.concrete), pigment(P.ink), .4), concrete: pigment(P.concrete), forest: pigment(P.leafShade), water: pigment(P.glass),
  yard: blend(pigment(P.soil), pigment(P.concrete), .3), grass: pigment(P.leaf), path: pigment(P.wood),
  rail: blend(pigment(P.concreteShade), pigment(P.steel), .3), sand: pigment(P.sand),
};
/** Opaque colour steps shared by large ground patches and their tiny pixel motifs. */
export const PIXEL_TERRAIN_PALETTES = Object.fromEntries(Object.entries(TERRAIN_PIGMENTS).map(([material, base]) =>
  [material, [-32, -16, 0, 12, 25, 38].map(offset => base.map(channel => Math.max(0, Math.min(255, channel + offset))) as unknown as RGB)])) as unknown as Record<LiveTerrain, readonly RGB[]>;
const organic = new Set<LiveTerrain>(['grass', 'forest', 'yard', 'path', 'sand']);
const hash = (x: number, y: number): number => {
  let value = Math.imul(x + 721, 374761393) ^ Math.imul(y + 191, 668265263);
  value = Math.imul(value ^ value >>> 13, 1274126177); return (value ^ value >>> 16) >>> 0;
};

/** Detailed pixel ground stays within a 4096px texture side, including G9's 512 cells. */
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

function pixelMotifTone(material: LiveTerrain, px: number, py: number, resolution: number, seed: number, style = 0): number {
  const cluster = hash(Math.floor((px + hash(py >> 3, seed) % 5) / 12), Math.floor(py / 10) ^ seed);
  let tone = cluster % 9 === 0 ? 1 : cluster % 11 === 0 ? 3 : 2;
  if (material === 'grass' || material === 'forest') {
    const tuft = hash(Math.floor(px / 7), Math.floor(py / 6) ^ seed), tx = px % 7, ty = py % 6;
    const stemX = 1 + tuft % 4, stemY = 1 + (tuft >>> 3) % 3;
    if (tuft % 3 !== 0 && tx === stemX && ty === stemY + 1) tone = 0;
    else if (tuft % 3 !== 0 && (tx === stemX || tx === stemX + 1) && ty === stemY) tone = 4;
    else if (tuft % 13 === 0 && tx === stemX - 1 && ty === stemY + 2) tone = 5;
  } else if (material === 'concrete') {
    const tileW = style === 1 ? Math.max(4, Math.round(resolution * .75)) : style === 2 ? Math.max(6, resolution) : Math.max(8, Math.round(resolution * 2.4));
    const tileH = style === 1 ? Math.max(3, Math.round(resolution * .5)) : style === 2 ? Math.max(4, Math.round(resolution * .75)) : tileW;
    const row = Math.floor(py / tileH), shiftedX = px + (style ? row % 2 * Math.floor(tileW / 2) : 0), tx = shiftedX % tileW, ty = py % tileH;
    const stone = hash(Math.floor(shiftedX / tileW), row ^ seed);
    tone = tx === 0 || ty === 0 ? 0 : ty === 1 ? 4 : 2 + stone % 2;
    if (!style && stone % 5 === 0 && tx === 3 + ty % 3 && ty > tileH / 2) tone = 1;
    else if (stone % 7 === 0 && tx === tileW - 2 && ty === tileH - 2) tone = 1;
  } else if (material === 'water') {
    const row = Math.floor(py / 5), ripple = hash(row, seed), waveX = (px + ripple % 17) % 23;
    tone = cluster % 7 === 0 ? 1 : 2;
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
 * Whole-colour pixels are copied once; costly motif hashes run only in the atlases. */
export function paintTerrainTexture(c: CanvasRenderingContext2D, world: GroundWorld, terrain: readonly LiveTerrain[], resolution: number): void {
  const width = world.width, height = world.height, textureWidth = width * resolution, textureHeight = height * resolution;
  const seed = [...world.seed].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) | 0, 0);
  const kinds = Object.keys(PIXEL_TERRAIN_PALETTES) as LiveTerrain[], concrete = kinds.indexOf('concrete');
  const materialIds = new Map(kinds.map((kind, index) => [kind, index]));
  const classes = Uint8Array.from(terrain, material => materialIds.get(material)!);
  for (const quarter of world.city?.quarters ?? []) {
    const style = quarter.id === 'old-center' ? 1 : quarter.id === 'station' ? 2 : 0;
    if (!style) continue;
    for (let y = Math.max(0, quarter.y); y < Math.min(height, quarter.y + quarter.height); y++) for (let x = Math.max(0, quarter.x); x < Math.min(width, quarter.x + quarter.width); x++) if (classes[y * width + x] === concrete) classes[y * width + x] = kinds.length + style - 1;
  }
  const littleEndian = new Uint8Array(new Uint32Array([255]).buffer)[0] === 255;
  const packed = (color: RGB): number => littleEndian ? color[0] | color[1] << 8 | color[2] << 16 | 255 << 24 : color[0] << 24 | color[1] << 16 | color[2] << 8 | 255;
  const atlases = [...kinds, 'concrete', 'concrete'].map((material, id) => {
    const style = id >= kinds.length ? id - kinds.length + 1 : 0;
    const tileW = style === 1 ? Math.max(4, Math.round(resolution * .75)) : style === 2 ? Math.max(6, resolution) : Math.max(8, Math.round(resolution * 2.4));
    const tileH = style === 1 ? Math.max(3, Math.round(resolution * .5)) : style === 2 ? Math.max(4, Math.round(resolution * .75)) : tileW;
    // Paving repeats on whole masonry blocks, never half of a slab at an atlas edge.
    const w = material === 'concrete' ? tileW * (style ? 16 : 8) : 128, h = material === 'concrete' ? tileH * (style ? 16 : 8) : 128;
    const pixels = new Uint32Array(w * h), palette = PIXEL_TERRAIN_PALETTES[material as LiveTerrain].map(packed);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixels[y * w + x] = palette[pixelMotifTone(material as LiveTerrain, x, y, resolution, seed, style)]!;
    return { pixels, width: w, height: h };
  });
  const organicIds = new Set(kinds.map((kind, id) => organic.has(kind) ? id : -1));
  const edges = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = y * width + x, material = classes[cell]!;
    if (!organicIds.has(material)) continue;
    for (const [side, nx, ny] of [[0, x - 1, y], [1, x + 1, y], [2, x, y - 1], [3, x, y + 1]]) {
      if (nx! < 0 || ny! < 0 || nx! >= width || ny! >= height) continue;
      const neighbor = classes[ny! * width + nx!]!;
      if (neighbor !== material && organicIds.has(neighbor)) edges[cell] = edges[cell]! | (neighbor + 1) << (side! * 4);
    }
  }
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
        let material = classes[cell]!;
        if (edges[cell]) {
          const side = localX === 0 ? 0 : localX === resolution - 1 ? 1 : localY === 0 ? 2 : localY === resolution - 1 ? 3 : -1;
          const neighbor = side >= 0 ? edges[cell]! >> (side * 4) & 15 : 0;
          if (neighbor && hash(px, textureY ^ seed) % 4 === 0) material = neighbor - 1;
        }
        const atlas = atlases[material]!;
        data[py * textureWidth + px] = atlas.pixels[atlasRows[material]! + px % atlas.width]!;
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

export function roadHasMarkings(path: LiveLandscapePath): boolean {
  return path.width >= 5 && (path.id.startsWith('city-street-') || path.id === 'city-ring' || path.id.startsWith('highway-') || path.id.startsWith('arterial-'));
}
export function cityPedestrianCrossings(plan: RoadSurfacePlan): RoadIntersection[] {
  return plan.intersections.filter(crossing => crossing.a.path.id.startsWith('city-street-') && crossing.b.path.id.startsWith('city-street-')
    && Math.abs(crossing.a.dx * crossing.b.dy - crossing.a.dy * crossing.b.dx) / (crossing.a.length * crossing.b.length) > .95);
}

export const PIXEL_ASPHALT_PALETTE: readonly RGB[] = [[47, 58, 66], [55, 66, 73], [62, 74, 81], [71, 82, 87], [84, 94, 96]];
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
  for (const path of paths) pathStroke(path, path.id.startsWith('city-') ? '#a4ad98' : '#a99c7f', path.width + .35);
  for (const path of paths) if (path.id.startsWith('city-')) pathStroke(path, '#bdc3aa', path.width + .07);
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
