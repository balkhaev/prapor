import type { LiveCityBuilding, LivePoint, LiveTerrain, LiveWorld, LiveWorldProp } from './game/live';
import { buildingArchitecture, type BuildingVolume } from './building-architecture';
import { BUILDING_EXTERIOR_HEIGHT_SCALE, SceneryIndex } from './live-map-art';
import { pixelPropHeight } from './pixel-props';
import { treeCrownProfile } from './pixel-plant-form';
import type { WorldSunlight } from './world-ambience';

type Rect = LivePoint & { width: number; height: number };
type ShadowWorld = Pick<LiveWorld, 'width' | 'height'> & Partial<Pick<LiveWorld, 'obstacles' | 'props' | 'chunkSize'>>;
export type GroundShadowLight = Pick<WorldSunlight, 'direction' | 'intensity'>;
export type GroundShadowReceiverChunk = Rect & { runs: Rect[] };
/** Packed xyz triplets; one convex part belongs to one real solid volume. */
export type GroundShadowPart = Float32Array;
export type GroundShadowCaster = Rect & {
  id: string; kind: 'building' | 'prop' | 'obstacle'; elevation: number;
  parts: GroundShadowPart[]; contact: Float32Array;
  /** Shared immutable chunk references, never a second copy of ground cells. */
  receivers: GroundShadowReceiverChunk[];
};
export const GROUND_SHADOW_LIMITS = Object.freeze({ casters: 16384, frameCasters: 384, receiverRuns: 65536,
  receiverChunk: 32, elevation: 8, reachPerElevation: 2.25, softMargin: .4 });
export const DEFAULT_GROUND_SHADOW_LIGHT: GroundShadowLight = { direction: { x: .747, y: .72 }, intensity: 1 };
const clamp = (n: number, low = 0, high = 1) => Number.isFinite(n) ? Math.max(low, Math.min(high, n)) : low;
const packed = (vertices: readonly (readonly [number, number, number])[]) => Float32Array.from(vertices.flat());
const rectPoints = (r: Rect, padding = 0): Float32Array => Float32Array.from([
  r.x - padding, r.y - padding, r.x + r.width + padding, r.y - padding,
  r.x + r.width + padding, r.y + r.height + padding, r.x - padding, r.y + r.height + padding,
]);
function boxPart(r: Rect, bottom: number, top: number): GroundShadowPart {
  const a = r.x, b = r.x + r.width, c = r.y, d = r.y + r.height;
  return packed([[a,c,bottom],[b,c,bottom],[b,d,bottom],[a,d,bottom],[a,c,top],[b,c,top],[b,d,top],[a,d,top]]);
}
function ellipsePart(x: number, y: number, rx: number, ry: number, z: number): GroundShadowPart {
  return packed(Array.from({ length: 10 }, (_, i) => {
    const a = i * Math.PI / 5; return [x + Math.cos(a) * rx, y + Math.sin(a) * ry, z] as const;
  }));
}

/** WorldSunlight.direction is the screen-space direction in which rays travel.
 * Inverse of iso (x-y)/2,(x+y)/4 keeps ground shadows parallel to those shafts. */
export function groundShadowWorldVector(light: Pick<WorldSunlight, 'direction'>): LivePoint {
  const x = clamp(light.direction.x, -1, 1), y = clamp(light.direction.y, -1, 1);
  return { x: (x + 2 * y) * .75, y: (2 * y - x) * .75 };
}

export function groundShadowVector(light: Pick<WorldSunlight, 'direction'>, height: number): LivePoint {
  const vector = groundShadowWorldVector(light), elevation = clamp(height, 0, GROUND_SHADOW_LIMITS.elevation);
  return { x: vector.x * elevation, y: vector.y * elevation };
}

function volumePart(building: LiveCityBuilding, volume: BuildingVolume): GroundShadowPart {
  const { x, y, width: w, height: h, top, lift, axis, roof } = volume, zScale = BUILDING_EXTERIOR_HEIGHT_SCALE;
  const vertices: Array<[number, number, number]> = [];
  const add = (xx: number, yy: number, zz: number) => vertices.push([building.x + x + xx, building.y + y + yy, zz * zScale]);
  for (const [xx, yy] of [[0,0],[w,0],[w,h],[0,h]]) { add(xx!, yy!, 0); add(xx!, yy!, top + (roof === 'flat' ? .07 : 0)); }
  const span = axis === 'x' ? h : w, length = axis === 'x' ? w : h;
  const ridge = (u: number, v: number, raise = lift) => add(axis === 'x' ? u : v, axis === 'x' ? v : u, top + raise);
  if (roof === 'hip' || roof === 'half-hip') {
    const inset = Math.min(length * .24, span * .37);
    ridge(inset, span / 2); ridge(length - inset, span / 2);
    if (roof === 'half-hip') for (const u of [0, length]) for (const v of [span * .28, span * .72]) ridge(u, v, lift * .56);
  } else if (roof === 'sawtooth') {
    const count = Math.min(6, Math.max(2, Math.round(span / 3)));
    for (let i = 0; i < count; i++) { ridge(0, i * span / count); ridge(length, i * span / count); }
  } else if (roof === 'mansard') {
    const iu = Math.min(length * .16, span * .19), iv = span * .19;
    for (const u of [iu, length - iu]) for (const v of [iv, span - iv]) ridge(u, v, lift * .7);
    ridge(Math.min(length * .3, span * .45), span / 2); ridge(length - Math.min(length * .3, span * .45), span / 2);
  } else if (roof !== 'flat') {
    ridge(0, span / 2); ridge(length, span / 2);
    if (roof === 'cross-gable') { ridge(length / 2, span * .46, lift + .045); ridge(length / 2, span, lift + .045); }
  }
  return packed(vertices);
}

/** Low attached wings keep their own elevation instead of borrowing the height
 * of the main block. Roof ridges agree with the shared architecture grammar. */
export function buildingGroundShadowParts(building: LiveCityBuilding): GroundShadowPart[] {
  return buildingArchitecture(building).volumes.map(volume => volumePart(building, volume));
}

function convexHull(points: LivePoint[]): LivePoint[] {
  if (points.length < 3) return points;
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: LivePoint, b: LivePoint, c: LivePoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const lower: LivePoint[] = [], upper: LivePoint[] = [];
  for (const p of points) { while (lower.length > 1 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop(); lower.push(p); }
  for (let i = points.length - 1; i >= 0; i--) { const p = points[i]!; while (upper.length > 1 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop(); return lower.concat(upper);
}

export function projectGroundShadowPart(part: GroundShadowPart, light: GroundShadowLight): LivePoint[] {
  const vector = groundShadowWorldVector(light), points: LivePoint[] = [];
  for (let i = 0; i < part.length; i += 3) points.push({ x: part[i]! + vector.x * part[i + 2]!, y: part[i + 1]! + vector.y * part[i + 2]! });
  return convexHull(points);
}

function propGeometry(prop: LiveWorldProp): { parts: GroundShadowPart[]; contact: Float32Array } {
  const cx = prop.x + prop.width / 2, cy = prop.y + prop.height / 2;
  const artHeight = pixelPropHeight(prop.kind) / 128;
  if (prop.kind === 'tree') {
    const profile = treeCrownProfile(prop.variant), radius = Math.max(.3, (prop.width + prop.height) * .331 * profile.spread);
    const stem = { x: cx - .045, y: cy - .045, width: .09, height: .09 }, crown = ellipsePart(cx, cy, radius, radius, prop.variant === 3 ? 1.05 : profile.center / 128);
    // A conifer's narrow elevated tip lengthens its crown shade without turning
    // the entire space between trunk and canopy into a solid triangular slab.
    const parts = [boxPart(stem, 0, profile.trunk / 128), prop.variant === 3
      ? Float32Array.from([...crown, cx, cy, 418 / 128]) : crown];
    const contact = ellipsePart(cx, cy, .19, .19, 0), flat = Float32Array.from(Array.from({ length: 10 }, (_, i) => [contact[i * 3]!, contact[i * 3 + 1]!]).flat());
    return { parts, contact: flat };
  }
  if (prop.kind === 'shrub' || prop.kind === 'garden') {
    const parts = prop.kind === 'garden' ? [] : [ellipsePart(cx, cy, prop.width * .47, prop.height * .47, .25)];
    return { parts, contact: rectPoints(prop, .025) };
  }
  if (prop.kind === 'lamp' || prop.kind === 'power-pole' || prop.kind === 'sign' || prop.kind === 'bollard' || prop.kind === 'hydrant') {
    const stem = { x: cx - .045, y: cy - .045, width: .09, height: .09 };
    const parts = [boxPart(stem, 0, artHeight * .93)];
    if (prop.kind === 'lamp' || prop.kind === 'power-pole' || prop.kind === 'sign') parts.push(boxPart({ x: cx - .22, y: cy - .055, width: .44, height: .11 }, artHeight * .8, artHeight * .94));
    return { parts, contact: rectPoints({ x: cx - .11, y: cy - .11, width: .22, height: .22 }, .025) };
  }
  const height = prop.kind === 'car' ? 69 / 128 : prop.kind === 'van' ? 88 / 128 : prop.kind === 'truck' ? 89 / 128
    : prop.kind === 'bus' ? 106 / 128 : prop.kind === 'bench' || prop.kind === 'workbench' ? .42 : artHeight * .88;
  return { parts: [boxPart(prop, 0, height)], contact: rectPoints(prop, .07) };
}

/** Built once per immutable world. Receiver runs are shared across 32m chunks;
 * no frame scans terrain, indoor masks or the rest of the world's casters. */
export function buildWorldGroundShadowCasters(world: ShadowWorld, buildings: readonly LiveCityBuilding[], terrain: readonly LiveTerrain[],
  indoor: Uint8Array, props: readonly LiveWorldProp[] = world.props ?? []): GroundShadowCaster[] {
  const result: GroundShadowCaster[] = [], size = GROUND_SHADOW_LIMITS.receiverChunk;
  if (!Number.isInteger(world.width) || !Number.isInteger(world.height) || world.width < 1 || world.height < 1 || world.width > 1024 || world.height > 1024
    || terrain.length !== world.width * world.height || indoor.length !== terrain.length) return result;
  const chunks = new Map<string, GroundShadowReceiverChunk>(), empty = new Set<string>();
  let runCount = 0;
  const receiver = (cx: number, cy: number): GroundShadowReceiverChunk | null => {
    const key = `${cx}:${cy}`, old = chunks.get(key); if (old) return old; if (empty.has(key)) return null;
    const x = Math.max(0, cx * size), y = Math.max(0, cy * size), right = Math.min(world.width, (cx + 1) * size), bottom = Math.min(world.height, (cy + 1) * size);
    const runs: Rect[] = [];
    for (let yy = y; yy < bottom; yy++) {
      let start = -1;
      for (let xx = x; xx <= right; xx++) {
        const cell = yy * world.width + xx, allowed = xx < right && !indoor[cell] && terrain[cell] !== 'water';
        if (allowed && start < 0) start = xx;
        else if (!allowed && start >= 0) { runs.push({ x: start, y: yy, width: xx - start, height: 1 }); start = -1; }
      }
    }
    if (!runs.length || runCount + runs.length > GROUND_SHADOW_LIMITS.receiverRuns) { empty.add(key); return null; }
    const chunk = { x, y, width: right - x, height: bottom - y, runs }; chunks.set(key, chunk); runCount += runs.length; return chunk;
  };
  const add = (id: string, kind: GroundShadowCaster['kind'], parts: GroundShadowPart[], contact: Float32Array): void => {
    if (result.length >= GROUND_SHADOW_LIMITS.casters || !contact.length || !parts.every(part => part.length <= 96 && [...part].every(Number.isFinite))) return;
    const xy: LivePoint[] = [], elevations: number[] = [0];
    for (const part of parts) for (let i = 0; i < part.length; i += 3) { xy.push({ x: part[i]!, y: part[i + 1]! }); elevations.push(part[i + 2]!); }
    for (let i = 0; i < contact.length; i += 2) xy.push({ x: contact[i]!, y: contact[i + 1]! });
    const elevation = Math.max(...elevations); if (elevation > GROUND_SHADOW_LIMITS.elevation || !xy.length) return;
    const pad = elevation * GROUND_SHADOW_LIMITS.reachPerElevation + GROUND_SHADOW_LIMITS.softMargin;
    const x = Math.max(0, Math.min(...xy.map(p => p.x)) - pad), y = Math.max(0, Math.min(...xy.map(p => p.y)) - pad);
    const right = Math.min(world.width, Math.max(...xy.map(p => p.x)) + pad), bottom = Math.min(world.height, Math.max(...xy.map(p => p.y)) + pad);
    if (right <= x || bottom <= y) return;
    const receivers: GroundShadowReceiverChunk[] = [];
    for (let cy = Math.floor(y / size); cy <= Math.floor((bottom - .0001) / size); cy++) for (let cx = Math.floor(x / size); cx <= Math.floor((right - .0001) / size); cx++) {
      const chunk = receiver(cx, cy); if (chunk) receivers.push(chunk);
    }
    if (receivers.length) result.push({ id, kind, x, y, width: right - x, height: bottom - y, elevation, parts, contact, receivers });
  };
  const valid = (r: Rect) => [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0 && r.width <= 128 && r.height <= 128;
  for (const building of buildings) if (valid(building)) add(building.id, 'building', buildingGroundShadowParts(building), rectPoints(building, .11));
  const seen = new Set<string>(), outdoor = (prop: LiveWorldProp) => valid(prop) && !indoor[Math.floor(prop.y + prop.height / 2) * world.width + Math.floor(prop.x + prop.width / 2)];
  const addProp = (prop: LiveWorldProp): void => {
    if (seen.has(prop.id) || !outdoor(prop)) return; seen.add(prop.id);
    const geometry = propGeometry(prop); add(prop.id, 'prop', geometry.parts, geometry.contact);
  };
  // Appended street vehicles/shelters survive even a pathological dense forest.
  for (const prop of props) if (!['tree', 'shrub', 'garden', 'planter'].includes(prop.kind)) addProp(prop);
  const buildingIndex = new SceneryIndex(buildings, world.chunkSize ?? 16);
  for (const [index, obstacle] of (world.obstacles ?? []).entries()) {
    if (obstacle.propId || obstacle.kind === 'water' || !valid(obstacle)) continue;
    if (buildingIndex.visible(obstacle).some(building => obstacle.x >= building.x && obstacle.y >= building.y
      && obstacle.x + obstacle.width <= building.x + building.width && obstacle.y + obstacle.height <= building.y + building.height)) continue;
    if (obstacle.kind === 'tree') {
      const geometry = propGeometry({ ...obstacle, id: `obstacle-tree:${index}`, kind: 'tree', orientation: 'x', variant: index % 4, blocking: true });
      add(`obstacle:${index}`, 'obstacle', geometry.parts, geometry.contact);
    } else add(`obstacle:${index}`, 'obstacle', [boxPart(obstacle, 0, obstacle.kind === 'wall' ? .65 : obstacle.kind === 'barricade' ? .3 : .7)], rectPoints(obstacle, .07));
  }
  for (const prop of props) if (['tree', 'shrub', 'garden', 'planter'].includes(prop.kind)) addProp(prop);
  return result;
}

/** The caller has already transformed world units with origin project(-.5,-.5).
 * One union operation per pass prevents neighbouring casters from piling up
 * opacity. A narrow stepped penumbra needs neither blur nor a frame bitmap. */
export function paintWorldGroundShadows(c: CanvasRenderingContext2D, casters: readonly GroundShadowCaster[], light: GroundShadowLight): void {
  if (!casters.length) return;
  const visible = casters.slice(0, GROUND_SHADOW_LIMITS.frameCasters), intensity = clamp(light.intensity), chunks = new Set<GroundShadowReceiverChunk>();
  for (const caster of visible) for (const chunk of caster.receivers) chunks.add(chunk);
  if (!chunks.size) return;
  c.save(); c.globalCompositeOperation = 'source-over'; c.beginPath();
  for (const chunk of chunks) for (const run of chunk.runs) c.rect(run.x, run.y, run.width, run.height);
  c.clip(); c.fillStyle = '#33414a'; c.strokeStyle = '#33414a'; c.lineJoin = 'round'; c.lineCap = 'round';
  if (intensity > .002) {
    c.beginPath();
    for (const caster of visible) for (const part of caster.parts) {
      const points = projectGroundShadowPart(part, light); if (points.length < 3) continue;
      points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath();
    }
    const softness = .12 + (1 - intensity) * .12;
    c.lineWidth = softness * 2; c.globalAlpha = intensity * .025; c.stroke();
    c.lineWidth = softness; c.globalAlpha = intensity * .035; c.stroke();
    c.globalAlpha = intensity * .14; c.fill();
  }
  c.beginPath();
  for (const caster of visible) {
    for (let i = 0; i < caster.contact.length; i += 2) i ? c.lineTo(caster.contact[i]!, caster.contact[i + 1]!) : c.moveTo(caster.contact[i]!, caster.contact[i + 1]!);
    c.closePath();
  }
  c.globalAlpha = .025 + intensity * .055; c.fill(); c.restore();
}
