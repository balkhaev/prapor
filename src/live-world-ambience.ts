import type { LivePoint, LiveTerrain, LiveWorld } from './game/live';
import { pixelSeed } from './pixel-art';
import { sampleWorldBirds, type WorldAmbienceInput, type WorldBird } from './world-ambience';

export type LiveAmbientGround = LivePoint & { width: number; height: number; kind: 'grass' | 'water' | 'paper'; seed: number };
export type LiveAmbientMark = { x: number; y: number; width: number; height: number; color: string; alpha: number };
type Rect = LivePoint & { width: number; height: number };
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const hashAt = (seed: number, x: number, y: number) => (Math.imul(x + 71, 73856093) ^ Math.imul(y + 19, 19349663) ^ seed) >>> 0;

/** Decoration follows existing free surfaces. The immutable world is sampled
 * once; even a million-cell map needs at most 65,536 probes, never a frame scan. */
export function liveAmbientGround(world: Pick<LiveWorld, 'width' | 'height' | 'seed'>, terrain: readonly LiveTerrain[], walkable: Uint8Array, indoor: Uint8Array): LiveAmbientGround[] {
  const accents: LiveAmbientGround[] = [], seed = pixelSeed(world.seed);
  const step = Math.max(4, Math.ceil(Math.sqrt(world.width * world.height / 65536)));
  for (let y = 0; y < world.height; y += step) for (let x = 0; x < world.width; x += step) {
    const hash = hashAt(seed, x, y), px = x + hash % step, py = y + (hash >>> 8) % step;
    if (px >= world.width || py >= world.height) continue;
    const index = py * world.width + px, surface = terrain[index];
    if (indoor[index] || surface !== 'water' && !walkable[index]) continue;
    const kind = surface === 'water' ? 'water'
      : (surface === 'grass' || surface === 'forest') && hash % 3 !== 0 ? 'grass'
        : (surface === 'road' || surface === 'yard' || surface === 'concrete') && hash % 23 === 0 ? 'paper' : null;
    if (kind) accents.push({ x: px + .3, y: py + .35, width: .4, height: .4, kind, seed: hash });
  }
  return accents;
}

/** Subtle marks are in native model pixels, projected from their real ground
 * cell by the adapter. They create neither props nor collision/loot geometry. */
export function liveAmbientGroundMarks(accent: LiveAmbientGround, timeMs: number, wind: number, daylight: number, rain: number, reducedMotion = false): LiveAmbientMark[] {
  const time = reducedMotion ? 0 : Math.max(0, Number.isFinite(timeMs) ? timeMs : 0), marks: LiveAmbientMark[] = [];
  const gust = reducedMotion ? 0 : Math.sin(time / 1700 + accent.seed % 31) * (.35 + Math.abs(clamp(wind, -1, 1)) * 1.6);
  if (accent.kind === 'grass') {
    // Three isolated tufts, not a noisy waving texture over the entire map.
    for (let blade = 0; blade < 3; blade++) {
      const x = blade * 4 - 5, height = 4 + (accent.seed >>> blade * 3) % 5;
      for (let segment = 0; segment < 3; segment++) marks.push({ x: x + gust * segment / 2, y: -height + segment * height / 3,
        width: 1, height: Math.ceil(height / 3), color: blade === 1 ? '#9da466' : '#627b4e', alpha: .48 });
    }
  } else if (accent.kind === 'water') {
    const shimmer = reducedMotion ? .32 : .24 + Math.sin(time / 950 + accent.seed % 37) * .2;
    const alpha = (.08 + clamp(daylight) * .28) * (1 - clamp(rain) * .8) * shimmer;
    for (let line = 0; line < 3; line++) marks.push({ x: -7 + line * 3 + gust, y: line * 2 - 2, width: 9 - line * 2, height: 1,
      color: line === 1 ? '#eee1af' : '#aec8b6', alpha });
  } else if (!reducedMotion && rain < .2) {
    // A weathered scrap only stirs briefly, and stays inside its free ground cell.
    const cycle = (time + accent.seed % 19000) % 19000 / 19000;
    if (cycle < .27) {
      const progress = cycle / .27, lift = Math.sin(progress * Math.PI) * 5;
      marks.push({ x: -9 + progress * 18, y: -lift, width: 4, height: 2, color: '#b9ae91', alpha: Math.sin(progress * Math.PI) * .56 });
      marks.push({ x: -10 + progress * 18, y: 2, width: 5, height: 1, color: '#31483d', alpha: Math.sin(progress * Math.PI) * .14 });
    }
  }
  return marks;
}

export type LiveCloudShadow = LivePoint & { width: number; height: number; alpha: number };
/** Sparse cloud fields are anchored to world cells so camera motion never drags
 * the sky across the street. Work is bounded independently of map dimensions. */
export function liveCloudShadows(seed: string, area: Rect, timeMs: number, wind: number, daylight: number, rain: number, fog: number, reducedMotion = false): LiveCloudShadow[] {
  const alpha = clamp(daylight) * (1 - clamp(rain)) * (1 - clamp(fog)) * .065;
  if (alpha < .004 || area.width > 180 || area.height > 180) return [];
  const cell = 48, time = reducedMotion ? 0 : Math.max(0, Number.isFinite(timeMs) ? timeMs : 0);
  const drift = time / 1000 * .032, offsetX = drift, offsetY = drift * .32 + Math.sin(time / 47000) * clamp(wind) * .35;
  const clouds: LiveCloudShadow[] = [], base = pixelSeed(seed);
  for (let y = Math.floor((area.y - offsetY - cell) / cell); y <= Math.ceil((area.y + area.height - offsetY) / cell); y++) {
    for (let x = Math.floor((area.x - offsetX - cell) / cell); x <= Math.ceil((area.x + area.width - offsetX) / cell); x++) {
      const hash = hashAt(base, x, y), width = 24 + hash % 20, height = 12 + (hash >>> 8) % 12;
      const px = x * cell + offsetX + (hash >>> 16) % 11, py = y * cell + offsetY + (hash >>> 24) % 13;
      if (px + width < area.x || py + height < area.y || px > area.x + area.width || py > area.y + area.height) continue;
      clouds.push({ x: px, y: py, width, height, alpha });
    }
  }
  const cx = area.x + area.width / 2, cy = area.y + area.height / 2;
  return clouds.sort((a, b) => Math.hypot(a.x + a.width / 2 - cx, a.y + a.height / 2 - cy) - Math.hypot(b.x + b.width / 2 - cx, b.y + b.height / 2 - cy)).slice(0, 12);
}

/** Nearby sky patches reuse the shelter's loose flock. Coordinates remain in
 * world cells while wing size stays in native art pixels; camera zoom only
 * changes their projection. Never more than two flocks are sampled per frame. */
export function liveAmbientBirds(seed: string, area: Rect, climate: Omit<WorldAmbienceInput, 'bounds'>): WorldBird[] {
  if (climate.reducedMotion || (climate.daylight ?? 1) < .08 || (climate.rain ?? 0) > .65 || area.width > 100 || area.height > 100) return [];
  const cell = 32, candidates: { x: number; y: number; distance: number }[] = [];
  const cx = area.x + area.width / 2, cy = area.y + area.height / 2;
  for (let y = Math.floor(area.y / cell); y <= Math.floor((area.y + area.height) / cell); y++) for (let x = Math.floor(area.x / cell); x <= Math.floor((area.x + area.width) / cell); x++) {
    candidates.push({ x, y, distance: Math.hypot((x + .5) * cell - cx, (y + .5) * cell - cy) });
  }
  const birds: WorldBird[] = [], base = pixelSeed(seed);
  for (const patch of candidates.sort((a, b) => a.distance - b.distance).slice(0, 2)) {
    const offset = hashAt(base, patch.x, patch.y) % 58000;
    for (const bird of sampleWorldBirds({ ...climate, timeMs: climate.timeMs + offset,
      bounds: { x: patch.x * cell * 128, y: patch.y * cell * 128, width: cell * 128, height: cell * 128 } })) {
      if (bird.alpha < .01) continue;
      birds.push({ ...bird, x: bird.x / 128, y: bird.y / 128, shadowX: bird.shadowX / 128, shadowY: bird.shadowY / 128 });
    }
  }
  return birds;
}
