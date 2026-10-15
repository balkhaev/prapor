import type { LiveTerrain } from './game/live';
import { pixelIso, pixelSeed } from './pixel-art';
import { propLampSources, type SceneLamp } from './pixel-lighting';
import type { RaidFieldPlan } from './raid-field';
import { raidGroundSurface } from './raid-ground-art';
import { raidPixelProp } from './pixel-raid-presentation';
import { sampleWetSurfaces, type WetSurfaceInput, type WetSurfacePatch, type WetSurfaceFrame } from './scene-wet-surfaces';

type Bounds = { x: number; y: number; width: number; height: number };
export type WetGroundCandidate = Bounds & { patch: WetSurfacePatch };
export const WET_GROUND_CANDIDATE_LIMIT = 32768;
type WetGroundInput = {
  width: number; height: number; seed: string; terrain: readonly LiveTerrain[]; walkable: Uint8Array;
  indoor?: Uint8Array; blocked?: readonly Bounds[]; lamps?: readonly SceneLamp[];
};
const hard = new Set<LiveTerrain>(['road', 'concrete']);
const soil = new Set<LiveTerrain>(['yard', 'path', 'sand', 'grass', 'forest']);

/** Sparse, stable world geometry. Each footprint fits entirely inside one safe
 * cell, and the global cap samples every region rather than keeping the first rows. */
export function wetGroundCandidates(input: WetGroundInput): WetGroundCandidate[] {
  const { width, height } = input;
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 4096)) return [];
  const allowed = new Uint8Array(width * height);
  for (let i = 0; i < allowed.length; i++) allowed[i] = Number(Boolean(input.walkable[i]) && !input.indoor?.[i] && (hard.has(input.terrain[i]!) || soil.has(input.terrain[i]!)));
  for (const box of input.blocked ?? []) {
    const left = Math.max(0, Math.min(width, Math.floor(box.x))), right = Math.max(0, Math.min(width, Math.ceil(box.x + box.width)));
    if (right <= left || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) continue;
    for (let y = Math.max(0, Math.floor(box.y)); y < Math.min(height, Math.ceil(box.y + box.height)); y++) {
      allowed.fill(0, y * width + left, y * width + right);
    }
  }
  let stride = Math.max(1, Math.ceil(Math.sqrt(width * height / WET_GROUND_CANDIDATE_LIMIT)));
  while (Math.ceil(width / stride) * Math.ceil(height / stride) > WET_GROUND_CANDIDATE_LIMIT) stride++;
  const result = new Map<number, WetGroundCandidate>();
  for (let top = 0; top < height; top += stride) for (let left = 0; left < width; left += stride) {
    const seed = pixelSeed(`${input.seed}:${left}:${top}`), bw = Math.min(stride, width - left), bh = Math.min(stride, height - top);
    for (let attempt = 0; attempt < bw * bh; attempt++) {
      const offset = (seed + attempt) % (bw * bh), x = left + offset % bw, y = top + Math.floor(offset / bw), cell = y * width + x;
      if (!allowed[cell]) continue;
      const material = hard.has(input.terrain[cell]!) ? 'hard' : 'soil';
      if (seed % 100 < (material === 'hard' ? 72 : 38)) {
        const center = pixelIso(x + .5, y + .5);
        result.set(top * width + left, { x, y, width: 1, height: 1, patch: { x: center.x + (seed >>> 8) % 9 - 4, y: center.y + (seed >>> 12) % 5 - 2,
          width: 36 + (seed >>> 16) % 25, height: 10 + (seed >>> 21) % 11, seed, material } });
      }
      break;
    }
  }
  // Drainage beside actual lamps is allowed to catch their narrow reflected
  // column. Move one safe candidate within its block; never add hidden ground.
  for (const lamp of input.lamps ?? []) {
    if (![lamp.x, lamp.y, lamp.radius].every(Number.isFinite)) continue;
    const cx = Math.floor((lamp.x / 64 + lamp.y / 32) / 2), cy = Math.floor((lamp.y / 32 - lamp.x / 64) / 2);
    let selected: { x: number; y: number; center: { x: number; y: number }; score: number } | undefined;
    for (let y = Math.max(0, cy - 2); y <= Math.min(height - 1, cy + 2); y++) for (let x = Math.max(0, cx - 2); x <= Math.min(width - 1, cx + 2); x++) {
      if (!allowed[y * width + x] || !hard.has(input.terrain[y * width + x]!)) continue;
      const center = pixelIso(x + .5, y + .5), dx = Math.abs(center.x - lamp.x), dy = center.y - lamp.y;
      if (dx > 44 || dy < 8 || dy > Math.min(65, lamp.radius * .48)) continue;
      const score = dx * .25 + dy;
      if (!selected || score < selected.score) selected = { x, y, center, score };
    }
    if (selected) {
      const { x, y, center } = selected, key = Math.floor(y / stride) * stride * width + Math.floor(x / stride) * stride;
      const seed = pixelSeed(`${input.seed}:lamp:${lamp.x}:${lamp.y}:${x}:${y}`);
      result.set(key, { x, y, width: 1, height: 1, patch: { x: center.x + Math.max(-27, Math.min(27, lamp.x - center.x)), y: center.y, width: 40, height: 12, seed, material: 'hard' } });
    }
  }
  return [...result.values()];
}

/** Reuse the paid plan's real outdoor ground and the very same native lamp
 * origins used by its prop painter. Underground corridors remain covered. */
export function raidWetGround(plan: RaidFieldPlan): { patches: WetSurfacePatch[]; lamps: SceneLamp[] } {
  if (plan.mapId === 'bunker') return { patches: [], lamps: [] };
  const { terrain } = raidGroundSurface(plan);
  const props = plan.props.map(prop => { const native = raidPixelProp(prop); return { ...native, x: prop.x - native.width / 2, y: prop.y - native.height / 2 }; });
  const lamps = props.filter(prop => prop.kind === 'lamp').flatMap(prop => {
    const origin = pixelIso(prop.x, prop.y);
    return propLampSources(prop).map(lamp => ({ x: origin.x + lamp.x, y: origin.y + lamp.y, headY: origin.y + lamp.headY, radius: lamp.radius }));
  });
  const patches = wetGroundCandidates({ width: plan.width, height: plan.height, seed: plan.id, terrain,
    walkable: Uint8Array.from(plan.walkable, Number), blocked: [...plan.buildings, ...props], lamps }).map(candidate => candidate.patch);
  return { patches, lamps };
}

/** One reusable native frame. Camera transforms move the same world marks;
 * only visibility or the shared 20Hz clock changes the sampled program. */
export class WetGroundFrameCache {
  private signature = '';
  private frame: WetSurfaceFrame | null = null;
  get(input: WetSurfaceInput): WetSurfaceFrame {
    const timeMs = Math.floor(Math.max(0, Number.isFinite(input.timeMs) ? input.timeMs : 0) / 50) * 50;
    const signature = `${timeMs}:${Boolean(input.reducedMotion)}:${input.patches.map(p => `${p.seed}:${p.x}:${p.y}:${p.width}:${p.height}:${p.material}`).join(';')}:${input.lamps.map(p => `${p.x}:${p.y}:${p.headY}:${p.radius}`).join(';')}`;
    if (!this.frame || signature !== this.signature) { this.frame = sampleWetSurfaces({ ...input, timeMs }); this.signature = signature; }
    return this.frame;
  }
  clear(): void { this.frame = null; this.signature = ''; }
}
