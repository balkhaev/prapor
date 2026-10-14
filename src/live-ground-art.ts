import type { LiveLandscapePath, LivePoint, LiveTerrain, LiveWorld } from './game/live';

export const TERRAIN_PIGMENTS: Record<LiveTerrain, readonly [number, number, number]> = {
  road: [64, 69, 69], concrete: [139, 142, 131], forest: [43, 66, 45], water: [36, 74, 82],
  yard: [112, 112, 92], grass: [77, 104, 60], path: [140, 119, 82], rail: [102, 105, 93], sand: [161, 149, 109],
};
const organic = new Set<LiveTerrain>(['grass', 'forest', 'yard', 'path', 'sand']);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const hash = (x: number, y: number): number => {
  let value = Math.imul(x + 721, 374761393) ^ Math.imul(y + 191, 668265263);
  value = Math.imul(value ^ value >>> 13, 1274126177); return (value ^ value >>> 16) >>> 0;
};

/** 320×320 uses 12px/cell; bigger maps stay within a 4096px texture side. */
export function terrainTextureResolution(width: number, height: number): number {
  const longest = Math.max(width, height);
  return Math.max(1, Math.min(longest <= 256 ? 16 : 12, Math.floor(4096 / longest)));
}

/** Banded upload avoids holding a second full 60–67MB ground bitmap during a world change. */
export function paintTerrainTexture(c: CanvasRenderingContext2D, world: LiveWorld, terrain: readonly LiveTerrain[], resolution: number): void {
  const width = world.width, height = world.height, textureWidth = width * resolution, textureHeight = height * resolution;
  const phase = [...world.seed].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) | 0, 0) / 65536;
  const fieldWidth = width + 1, field = new Float32Array(fieldWidth * (height + 1)), paving = new Uint8Array(width * height), soft = Uint8Array.from(terrain, material => Number(organic.has(material)));
  const sinWaterX = new Float32Array(textureWidth), cosWaterX = new Float32Array(textureWidth), sinSwellX = new Float32Array(textureWidth), cosSwellX = new Float32Array(textureWidth), sinSandX = new Float32Array(textureWidth), cosSandX = new Float32Array(textureWidth);
  for (let x = 0; x < textureWidth; x++) {
    const wx = (x + .5) / resolution;
    sinWaterX[x] = Math.sin(wx * 5.5); cosWaterX[x] = Math.cos(wx * 5.5); sinSwellX[x] = Math.sin(wx * .7); cosSwellX[x] = Math.cos(wx * .7); sinSandX[x] = Math.sin(wx * 7.2); cosSandX[x] = Math.cos(wx * 7.2);
  }
  for (let y = 0; y <= height; y++) for (let x = 0; x <= width; x++) {
    field[y * fieldWidth + x] = Math.sin(x * .11 + y * .047 + phase) * 4.2 + Math.sin(y * .15 - x * .061 + phase * 2) * 2.8 + Math.sin(x * .41 + y * .29 + phase) * 1.5;
  }
  for (const quarter of world.city?.quarters ?? []) {
    const style = quarter.id === 'old-center' ? 1 : quarter.id === 'station' ? 2 : 0;
    for (let y = Math.max(0, quarter.y); y < Math.min(height, quarter.y + quarter.height); y++) for (let x = Math.max(0, quarter.x); x < Math.min(width, quarter.x + quarter.width); x++) paving[y * width + x] = style;
  }
  const bandHeight = Math.min(textureHeight, resolution * 8), pixels = c.createImageData(textureWidth, bandHeight), data = pixels.data;
  for (let bandY = 0; bandY < textureHeight; bandY += bandHeight) {
    const rows = Math.min(bandHeight, textureHeight - bandY);
    for (let py = 0; py < rows; py++) {
      const textureY = bandY + py, wy = (textureY + .5) / resolution, cy = Math.floor(wy), fy = wy - cy;
      const sinWaterY = Math.sin(-wy * 8.1 + phase), cosWaterY = Math.cos(-wy * 8.1 + phase), sinSwellY = Math.sin(wy * .32 + phase), cosSwellY = Math.cos(wy * .32 + phase), sinSandY = Math.sin(wy * 1.25 + phase), cosSandY = Math.cos(wy * 1.25 + phase);
      for (let px = 0; px < textureWidth; px++) {
        const wx = (px + .5) / resolution, cx = Math.floor(wx), fx = wx - cx, cell = cy * width + cx;
        const material = terrain[cell]!, color = TERRAIN_PIGMENTS[material], random = hash(px, textureY), grain = (random % 29 - 14) / 2;
        const a = field[cy * fieldWidth + cx]!, b = field[cy * fieldWidth + cx + 1]!, d = field[(cy + 1) * fieldWidth + cx]!, e = field[(cy + 1) * fieldWidth + cx + 1]!;
        const cloud = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
        let shade = cloud, red = color[0], green = color[1], blue = color[2];
        if (material === 'road') {
          shade = cloud * .65 + grain * .62;
          if (random % 67 === 0) shade += 9;
          if (random % 97 === 0) shade -= 8;
        } else if (material === 'concrete') {
          const style = paving[cell];
          if (style === 1) {
            const row = Math.floor(wy / .38), column = Math.floor((wx + row % 2 * .28) / .56), u = (wx + row % 2 * .28) % .56, v = wy % .38;
            const stone = hash(column, row) % 19 - 9;
            shade = cloud * .5 + stone + grain * .33 + (u < .06 || v < .055 ? -28 : u > .48 || v > .31 ? -5 : 3);
            red -= 7; green -= 6; blue -= 7;
          } else if (style === 2) {
            const row = Math.floor(wy / .65), u = (wx + row % 2 * .45) % .9, v = wy % .65;
            shade = cloud * .5 + (hash(Math.floor((wx + row % 2 * .45) / .9), row) % 13 - 6) + grain * .28 + (u < .055 || v < .055 ? -22 : 1);
          } else {
            const seamX = wx % 2.4, seamY = wy % 2.4;
            shade = cloud * .7 + grain * .3 + (seamX < .065 || seamY < .065 ? -25 : seamX < .15 || seamY < .15 ? 5 : 0);
          }
        } else if (material === 'yard' || material === 'rail') {
          const pebble = random % 23 === 0 ? 18 : random % 17 === 0 ? -15 : grain * 1.18;
          shade = cloud + pebble;
          if ((random >>> 9) % 7 === 0) { red += 4; blue -= 5; }
        } else if (material === 'path') {
          shade = cloud * 1.1 + grain * .7;
          if (random % 41 === 0) shade += 14;
          blue -= Math.max(0, cloud) * .5;
        } else if (material === 'grass' || material === 'forest') {
          shade = cloud * 1.5 + grain * .82;
          const blade = random % 13 === 0 ? 10 : random % 17 === 0 ? -13 : 0;
          green += blade; red += blade * .55; blue += blade * .25;
        } else if (material === 'sand') {
          shade = cloud * .5 + grain * .44 + (sinSandX[px]! * cosSandY + cosSandX[px]! * sinSandY) * 2.4;
        } else if (material === 'water') {
          const ripple = (sinWaterX[px]! * cosWaterY + cosWaterX[px]! * sinWaterY) * (sinSwellX[px]! * cosSwellY + cosSwellX[px]! * sinSwellY);
          shade = cloud * .3 + grain * .13 + ripple * 4;
          green += ripple * 2; blue += ripple * 3;
        }
        // Soil and vegetation feather into each other; asphalt, paving and water keep exact edges.
        if (soft[cell]) {
          const nx = cx + (fx < .5 ? -1 : 1), ny = cy + (fy < .5 ? -1 : 1);
          for (let direction = 0; direction < 2; direction++) {
            const neighborCell = direction ? ny >= 0 && ny < height ? ny * width + cx : -1 : nx >= 0 && nx < width ? cy * width + nx : -1;
            if (neighborCell < 0 || !soft[neighborCell]) continue;
            const neighbor = terrain[neighborCell]!; if (neighbor === material) continue;
            const fraction = direction ? fy : fx, blend = Math.max(0, (.24 - Math.min(fraction, 1 - fraction)) / .24) * .4, rgb = TERRAIN_PIGMENTS[neighbor];
            red = red * (1 - blend) + rgb[0] * blend; green = green * (1 - blend) + rgb[1] * blend; blue = blue * (1 - blend) + rgb[2] * blend;
          }
        }
        const at = (py * textureWidth + px) * 4;
        data[at] = red + shade; data[at + 1] = green + shade; data[at + 2] = blue + shade;
        const edge = clamp(Math.min(wx, wy, width - wx, height - wy) / .28, 0, 1); data[at + 3] = 255 * edge * edge * (3 - 2 * edge);
      }
    }
    c.putImageData(pixels, 0, bandY, 0, 0, textureWidth, rows);
  }
}

export type SurfaceRun = { x: number; y: number; width: number };
export type SurfaceMasks = { road: Uint8Array; indoor: Uint8Array; roadRuns: SurfaceRun[] };

export function buildSurfaceMasks(world: LiveWorld, terrain: readonly LiveTerrain[], walkable: Uint8Array): SurfaceMasks {
  const indoor = new Uint8Array(world.width * world.height), road = new Uint8Array(world.width * world.height);
  for (const site of world.citySites ?? []) for (const building of site.buildings) {
    for (let y = Math.max(0, building.y); y < Math.min(world.height, building.y + building.height); y++) for (let x = Math.max(0, building.x); x < Math.min(world.width, building.x + building.width); x++) indoor[y * world.width + x] = 1;
  }
  const roadRuns: SurfaceRun[] = [];
  for (let y = 0; y < world.height; y++) {
    let start = -1;
    for (let x = 0; x <= world.width; x++) {
      const cell = y * world.width + x, accepted = x < world.width && terrain[cell] === 'road' && !!walkable[cell] && !indoor[cell];
      if (accepted) { road[cell] = 1; if (start < 0) start = x; }
      else if (start >= 0) { roadRuns.push({ x: start, y, width: x - start }); start = -1; }
    }
  }
  return { road, indoor, roadRuns };
}

type RoadSegment = { path: LiveLandscapePath; a: LivePoint; b: LivePoint; dx: number; dy: number; length: number; offset: number };
export type RoadIntersection = LivePoint & { a: RoadSegment; b: RoadSegment };
export type RoadSurfacePlan = { segments: RoadSegment[]; intersections: RoadIntersection[] };

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
export function paintRoadSurface(c: CanvasRenderingContext2D, world: LiveWorld, terrain: readonly LiveTerrain[], masks: SurfaceMasks): void {
  const { road, roadRuns } = masks, plan = buildRoadSurfacePlan(world.paths ?? [], road, world.width, world.height);
  const stroke = (a: LivePoint, b: LivePoint, color: string, width: number) => { c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.strokeStyle = color; c.lineWidth = width; c.stroke(); };
  const clip = () => { c.beginPath(); for (const run of roadRuns) c.rect(run.x, run.y, run.width, 1); c.clip(); };
  c.save(); clip(); c.lineCap = 'butt';
  for (const segment of plan.segments) {
    const ux = segment.dx / segment.length, uy = segment.dy / segment.length;
    // Subtle wheel wear leaves the asphalt grain visible rather than repainting a flat road stroke.
    for (const side of [-1, 1]) {
      const offset = segment.path.width * .24 * side, a = { x: segment.a.x - uy * offset, y: segment.a.y + ux * offset }, b = { x: segment.b.x - uy * offset, y: segment.b.y + ux * offset };
      stroke(a, b, '#26363819', Math.min(.38, segment.path.width * .11));
    }
    if (segment.path.width < 3.5) continue;
    for (let distance = (4.4 - segment.offset % 4.4) % 4.4; distance < segment.length; distance += 4.4) {
      const end = Math.min(distance + 1.65, segment.length), mid = { x: segment.a.x + ux * (distance + end) / 2, y: segment.a.y + uy * (distance + end) / 2 };
      if (plan.intersections.some(point => Math.hypot(mid.x - point.x, mid.y - point.y) < Math.max(point.a.path.width, point.b.path.width) * .65 + 2.4)) continue;
      stroke({ x: segment.a.x + ux * distance, y: segment.a.y + uy * distance }, { x: segment.a.x + ux * end, y: segment.a.y + uy * end }, '#d8d4baab', .105);
    }
  }
  // Kerbs follow real r→c boundaries, including the connected pavement around junctions.
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
    const cell = y * world.width + x; if (!road[cell]) continue;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || terrain[ny * world.width + nx] !== 'concrete') continue;
      const a = dy ? { x, y: y + (dy > 0 ? 1 : 0) } : { x: x + (dx > 0 ? 1 : 0), y }, b = dy ? { x: x + 1, y: a.y } : { x: a.x, y: y + 1 };
      stroke({ x: a.x - dx * .1, y: a.y - dy * .1 }, { x: b.x - dx * .1, y: b.y - dy * .1 }, '#303b3abd', .15);
      stroke({ x: a.x - dx * .025, y: a.y - dy * .025 }, { x: b.x - dx * .025, y: b.y - dy * .025 }, '#c0c1acbb', .1);
      if ((x + y) % 2 === 0) stroke({ x: a.x - dx * .025, y: a.y - dy * .025 }, { x: a.x - dx * .16, y: a.y - dy * .16 }, '#626e6066', .055);
    }
  }
  const city = world.city;
  for (const crossing of plan.intersections) {
    if (!city || crossing.x < city.x || crossing.y < city.y || crossing.x > city.x + city.width || crossing.y > city.y + city.height) continue;
    for (const [along, cross] of [[crossing.a, crossing.b], [crossing.b, crossing.a]] as const) {
      const ux = along.dx / along.length, uy = along.dy / along.length, nx = -uy, ny = ux, half = Math.max(.7, along.path.width / 2 - .55);
      for (const side of [-1, 1]) {
        const distance = (cross.path.width / 2 + 1.05) * side, center = { x: crossing.x + ux * distance, y: crossing.y + uy * distance };
        for (let across = -half; across < half; across += .59) {
          const a = { x: center.x + nx * across - ux * .44, y: center.y + ny * across - uy * .44 }, b = { x: center.x + nx * across + ux * .44, y: center.y + ny * across + uy * .44 };
          stroke(a, b, '#e4dec8bd', .29);
        }
        const stop = { x: center.x + ux * side * 1.15, y: center.y + uy * side * 1.15 };
        stroke({ x: stop.x - nx * side * .12, y: stop.y - ny * side * .12 }, { x: stop.x - nx * side * half, y: stop.y - ny * side * half }, '#d8d2b9a8', .13);
      }
    }
  }
  c.restore();
}
