import type { LiveLandscapePath, LivePoint } from './game/live';
import { buildRoadSurfacePlan, cityPedestrianCrossings, roadHasMarkings, type GroundWorld, type RoadSurfacePlan, type SurfaceMasks, type SurfaceRun } from './live-ground-art';

type Rect = LivePoint & { width: number; height: number };
type RoadPathArt = Rect & { width: number; laneWidth: number; urban: boolean; points: readonly LivePoint[] };
export type RoadArtStroke = Rect & { a: LivePoint; b: LivePoint; weight: number; color: string; kind: 'center-mark' | 'crosswalk' | 'stop-line' | 'wheel-wear' | 'repair' };
export type RoadSurfaceArt = {
  width: number; height: number; paths: RoadPathArt[]; strokes: RoadArtStroke[];
  /** Exact road/rail-crossing cells, narrowed from the caller's safety mask. */
  runs: SurfaceRun[]; rowOffsets: Uint32Array;
};
const SEGMENT_LIMIT = 2048, STROKE_LIMIT = 16384, BIN = 16;
const hash = (x: number, y: number): number => { let value = Math.imul(x + 721, 374761393) ^ Math.imul(y + 191, 668265263); value = Math.imul(value ^ value >>> 13, 1274126177); return (value ^ value >>> 16) >>> 0; };
const urban = (path: LiveLandscapePath): boolean => path.id.startsWith('city-') || path.id.startsWith('metro-');
const bounds = (a: LivePoint, b: LivePoint, padding: number): Rect => ({ x: Math.min(a.x, b.x) - padding, y: Math.min(a.y, b.y) - padding, width: Math.abs(b.x - a.x) + padding * 2, height: Math.abs(b.y - a.y) + padding * 2 });
const touches = (a: Rect, b: Rect): boolean => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
const distanceToSegment = (point: LivePoint, a: LivePoint, b: LivePoint): number => {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
  return Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t);
};

/** Bound even malformed/repeated input before the utility's pairwise junction
 * analysis. The shipped metropolis uses only 270 of these 2048 segments. */
function boundedPaths(paths: GroundWorld['paths']): LiveLandscapePath[] {
  const result: LiveLandscapePath[] = []; let remaining = SEGMENT_LIMIT;
  for (const path of paths ?? []) {
    if (path.kind !== 'road' || !Number.isFinite(path.width) || path.width < .5 || path.width > 16) continue;
    const points = path.points.filter(point => Number.isFinite(point.x + point.y)).slice(0, remaining + 1);
    if (points.length < 2) continue;
    result.push({ ...path, points }); remaining -= points.length - 1;
    if (!remaining) break;
  }
  return result;
}

/** Include narrow access joins and T junctions too. A center stripe must not run
 * through a junction merely because the other road lacks its own markings. */
function markingJunctions(plan: RoadSurfacePlan): Array<LivePoint & { radius: number }> {
  const result: Array<LivePoint & { radius: number }> = [], keys = new Map<string, LivePoint & { radius: number }>();
  for (let i = 0; i < plan.segments.length; i++) for (let j = i + 1; j < plan.segments.length; j++) {
    const a = plan.segments[i]!, b = plan.segments[j]!;
    if (a.path === b.path || !touches(bounds(a.a, a.b, .01), bounds(b.a, b.b, .01))) continue;
    const cross = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(cross) / (a.length * b.length) < .25) continue;
    const dx = b.a.x - a.a.x, dy = b.a.y - a.a.y, t = (dx * b.dy - dy * b.dx) / cross, u = (dx * a.dy - dy * a.dx) / cross;
    if (t < -.001 || t > 1.001 || u < -.001 || u > 1.001) continue;
    const x = a.a.x + a.dx * t, y = a.a.y + a.dy * t, key = `${Math.round(x * 2)}:${Math.round(y * 2)}`;
    const radius = Math.max(a.path.width, b.path.width) / 2 + 2.6, previous = keys.get(key);
    if (previous) { previous.radius = Math.max(previous.radius, radius); continue; }
    if (result.length >= 8192) continue;
    const junction = { x, y, radius }; keys.set(key, junction); result.push(junction);
  }
  return result;
}

/** Static art only. The original world, terrain and mask arrays remain untouched.
 * Runs include asphalt beneath an actual road/rail crossing, never remote rails. */
export function buildRoadSurfaceArt(world: GroundWorld, masks: SurfaceMasks): RoadSurfaceArt {
  const paths = boundedPaths(world.paths), plan = buildRoadSurfacePlan(paths, masks.road, world.width, world.height);
  const art: RoadSurfaceArt = { width: world.width, height: world.height, paths: [], strokes: [], runs: [], rowOffsets: new Uint32Array(world.height + 1) };
  const bins = new Map<string, typeof plan.segments>();
  for (const segment of plan.segments) {
    const box = bounds(segment.a, segment.b, segment.path.width / 2 + 1);
    for (let y = Math.max(0, Math.floor(box.y / BIN)); y <= Math.min(Math.ceil(world.height / BIN), Math.floor((box.y + box.height) / BIN)); y++) for (let x = Math.max(0, Math.floor(box.x / BIN)); x <= Math.min(Math.ceil(world.width / BIN), Math.floor((box.x + box.width) / BIN)); x++) {
      const key = `${x}:${y}`, items = bins.get(key) ?? []; items.push(segment); bins.set(key, items);
    }
  }
  for (const run of masks.roadRuns) {
    if (run.y < 0 || run.y >= world.height) continue;
    let start = -1;
    for (let x = Math.max(0, run.x); x <= Math.min(world.width, run.x + run.width); x++) {
      const accepted = x < run.x + run.width && x < world.width && !!masks.road[run.y * world.width + x] && !masks.indoor[run.y * world.width + x]
        && bins.get(`${Math.floor(x / BIN)}:${Math.floor(run.y / BIN)}`)?.some(segment => distanceToSegment({ x: x + .5, y: run.y + .5 }, segment.a, segment.b) <= segment.path.width / 2 + .9);
      if (accepted && start < 0) start = x;
      else if (!accepted && start >= 0) { art.runs.push({ x: start, y: run.y, width: x - start }); start = -1; }
    }
  }
  let at = 0;
  for (let y = 0; y <= world.height; y++) { while (at < art.runs.length && art.runs[at]!.y < y) at++; art.rowOffsets[y] = at; }
  for (const path of paths) {
    const points = path.points.map(point => ({ x: point.x + .5, y: point.y + .5 }));
    const xs = points.map(point => point.x), ys = points.map(point => point.y), padding = path.width / 2 + 1;
    art.paths.push({ x: Math.min(...xs) - padding, y: Math.min(...ys) - padding, width: Math.max(...xs) - Math.min(...xs) + padding * 2, height: Math.max(...ys) - Math.min(...ys) + padding * 2, laneWidth: path.width, urban: urban(path), points });
  }
  const junctions = markingJunctions(plan);
  const add = (kind: RoadArtStroke['kind'], a: LivePoint, b: LivePoint, weight: number, color: string): void => {
    if (art.strokes.length < STROKE_LIMIT && Math.hypot(b.x - a.x, b.y - a.y) > .015) art.strokes.push({ ...bounds(a, b, weight), kind, a, b, weight, color });
  };
  const clearJunction = (a: LivePoint, b: LivePoint): boolean => !junctions.some(junction => distanceToSegment(junction, a, b) < junction.radius);
  // Sparse long wear patches replace the old high-contrast little asphalt tiles.
  for (const segment of plan.segments) {
    const ux = segment.dx / segment.length, uy = segment.dy / segment.length;
    const point = (along: number, across = 0): LivePoint => ({ x: segment.a.x + ux * along - uy * across, y: segment.a.y + uy * along + ux * across });
    for (let along = 5; along < segment.length - 2 && art.strokes.length < STROKE_LIMIT; along += 17) {
      const sample = hash(Math.floor(segment.a.x + ux * along), Math.floor(segment.a.y + uy * along));
      if (sample % 3) continue;
      const a = point(along, segment.path.width * .24 * (sample % 2 ? 1 : -1)), b = point(Math.min(segment.length - .5, along + 3.2), segment.path.width * .24 * (sample % 2 ? 1 : -1));
      if (clearJunction(a, b)) add('wheel-wear', a, b, .27, '#4f585a');
      if (sample % 5 === 0) add('repair', point(along + .45, -.3), point(along + 1.5, -.18), .42, '#4a5558');
    }
    if (!roadHasMarkings(segment.path)) continue;
    // Intersect each global dash with this segment. At a bend the same dash
    // continues on the next segment instead of starting a new stripe phase.
    const period = 5.4, dash = 1.8;
    for (let global = Math.floor(segment.offset / period) * period; global < segment.offset + segment.length && art.strokes.length < STROKE_LIMIT; global += period) {
      const start = Math.max(0, global - segment.offset), end = Math.min(segment.length, global + dash - segment.offset);
      if (end <= start) continue;
      const a = point(start), b = point(end);
      if (clearJunction(a, b)) add('center-mark', a, b, .095, '#c2bfa6');
    }
  }
  for (const crossing of cityPedestrianCrossings(plan)) {
    const city = world.city;
    if (!city || crossing.x < city.x || crossing.y < city.y || crossing.x >= city.x + city.width || crossing.y >= city.y + city.height) continue;
    for (const [along, cross] of [[crossing.a, crossing.b], [crossing.b, crossing.a]] as const) {
      const ux = along.dx / along.length, uy = along.dy / along.length, nx = -uy, ny = ux, half = Math.max(.7, along.path.width / 2 - .55);
      for (const side of [-1, 1]) {
        const position = cross.path.width / 2 + 1.2, center = { x: crossing.x + ux * position * side, y: crossing.y + uy * position * side };
        // A T junction only has markings on approaches which actually exist.
        const alongAt = (center.x - along.a.x) * ux + (center.y - along.a.y) * uy;
        if (alongAt < .6 || alongAt > along.length - .6) continue;
        for (let across = -half; across < half; across += .68) add('crosswalk', { x: center.x + nx * across - ux * .34, y: center.y + ny * across - uy * .34 }, { x: center.x + nx * across + ux * .34, y: center.y + ny * across + uy * .34 }, .23, '#c9c5ac');
        const stop = { x: center.x + ux * side * 1.15, y: center.y + uy * side * 1.15 };
        const stopAt = (stop.x - along.a.x) * ux + (stop.y - along.a.y) * uy;
        if (stopAt > .5 && stopAt < along.length - .5) add('stop-line', { x: stop.x - nx * side * .12, y: stop.y - ny * side * .12 }, { x: stop.x - nx * side * half, y: stop.y - ny * side * half }, .095, '#c9c5ac');
      }
    }
  }
  return art;
}

/** Paint into the single world cache, or repaint only the visible road at
 * display scale. No texture canvas, pattern allocation or world scan per frame. */
export function paintRoadSurfaceArt(c: CanvasRenderingContext2D, art: RoadSurfaceArt, options: { area?: Rect; display?: boolean } = {}): void {
  if (!art.runs.length) return;
  const area = options.area ?? { x: 0, y: 0, width: art.width, height: art.height };
  const firstRow = Math.max(0, Math.min(art.height, Math.floor(area.y))), lastRow = Math.max(firstRow, Math.min(art.height, Math.ceil(area.y + area.height)));
  c.save(); c.beginPath(); let included = false;
  for (let at = art.rowOffsets[firstRow]!; at < art.rowOffsets[lastRow]!; at++) {
    const run = art.runs[at]!;
    const left = Math.max(run.x, area.x), right = Math.min(run.x + run.width, area.x + area.width);
    const top = Math.max(run.y, area.y), bottom = Math.min(run.y + 1, area.y + area.height);
    if (right <= left || bottom <= top) continue;
    c.rect(left, top, right - left, bottom - top); included = true;
  }
  if (!included) { c.restore(); return; }
  c.clip();
  // An opaque union removes repeating atlas squares and lets every joining
  // street share one asphalt field, including the centre of intersections.
  c.fillStyle = '#596164'; c.fillRect(area.x, firstRow, area.width, lastRow - firstRow);
  c.lineCap = 'round'; c.lineJoin = 'round';
  const pathStroke = (path: RoadPathArt, width: number, color: string): void => {
    c.beginPath(); path.points.forEach((point, index) => index ? c.lineTo(point.x, point.y) : c.moveTo(point.x, point.y));
    c.lineWidth = width; c.strokeStyle = color; c.stroke();
  };
  // All outer edges precede all lanes: one road can never draw its shoulder
  // across another road at a bend, T junction or crossroads.
  for (const path of art.paths) if (touches(path, area)) pathStroke(path, path.laneWidth + .45, path.urban ? '#69716c' : '#77766a');
  for (const path of art.paths) if (touches(path, area)) pathStroke(path, Math.max(.45, path.laneWidth - .16), '#535e62');
  c.lineCap = 'butt';
  for (const stroke of art.strokes) {
    if (!touches(stroke, area)) continue;
    // Native wear is deliberately quiet. Thin markings share their cached
    // geometry but are resolved at the current pixel scale.
    if (!options.display && stroke.kind === 'wheel-wear') continue;
    c.beginPath(); c.moveTo(stroke.a.x, stroke.a.y); c.lineTo(stroke.b.x, stroke.b.y);
    c.strokeStyle = stroke.color; c.lineWidth = stroke.weight; c.stroke();
  }
  c.restore();
}
