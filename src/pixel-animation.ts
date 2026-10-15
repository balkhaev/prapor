import type { LiveEntity, LiveEvent, LivePoint } from './game/live';
import { PIXEL_ACTOR_CYCLE_MS, PIXEL_ACTOR_FRAMES, PIXEL_ACTOR_LIMP_CYCLE_SCALE, PIXEL_ACTOR_WALK_CYCLE_DISTANCE, pixelActorTimedFrame, type PixelActorMode } from './pixel-actor-config';
export type { PixelActorMode } from './pixel-actor-config';

export const PIXEL_FACINGS = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'] as const;
export type PixelFacing = typeof PIXEL_FACINGS[number];
export type PixelActorFrame = { mode: PixelActorMode; frame: number; facing: PixelFacing };

/** The art bearing is screen space. World position stays in the server coordinate system. */
export function pixelFacing(dx: number, dy: number, fallback: PixelFacing = 'se'): PixelFacing {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < .015) return fallback;
  const sector = Math.round(Math.atan2(dy * 2, dx) / (Math.PI / 4));
  return PIXEL_FACINGS[(sector + 8) % 8]!;
}

export function pixelBearing(facing: PixelFacing): LivePoint {
  const index = PIXEL_FACINGS.indexOf(facing), angle = index * Math.PI / 4;
  return { x: Math.cos(angle), y: Math.sin(angle) * .5 };
}

export type PixelMotion = {
  from: LivePoint; to: LivePoint; path: readonly LivePoint[]; at: number; duration: number;
  distance: number; length: number; interval: number; observedAt: number; facing: PixelFacing;
};
const length = (a: LivePoint, b: LivePoint) => Math.hypot(b.x - a.x, b.y - a.y);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Sampling is analytic: extra render frames never add distance or advance a footstep. */
export function samplePixelMotion(motion: PixelMotion, at: number): { point: LivePoint; distance: number; walking: boolean; remaining: LivePoint[] } {
  const progress = clamp((at - motion.at) / motion.duration, 0, 1), travelled = motion.length * progress;
  let remaining = travelled;
  for (let i = 1; i < motion.path.length; i++) {
    const a = motion.path[i - 1]!, b = motion.path[i]!, segment = length(a, b);
    if (remaining < segment) {
      const fraction = segment ? remaining / segment : 1, point = { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
      return { point, distance: motion.distance + travelled, walking: motion.length > .015 && progress < 1, remaining: [point, ...motion.path.slice(i)] };
    }
    remaining -= segment;
  }
  return { point: { ...motion.to }, distance: motion.distance + motion.length, walking: false, remaining: [{ ...motion.to }] };
}

/** Retain confirmed corners while smoothing new packets. No coordinate is extrapolated. */
export function updatePixelMotion(old: PixelMotion | undefined, target: LivePoint, at: number, facing: PixelFacing = old?.facing ?? 'se'): PixelMotion {
  if (old && length(old.to, target) < .001) return { ...old, facing, observedAt: at };
  if (!old || length(old.to, target) > 4 || at - old.observedAt > 1800) {
    return { from: { ...target }, to: { ...target }, path: [{ ...target }], at, duration: 500, distance: old ? old.distance + old.length : 0, length: 0, interval: 500, observedAt: at, facing };
  }
  const sampled = samplePixelMotion(old, at), path = [...sampled.remaining, { ...target }];
  let total = 0;
  for (let i = 1; i < path.length; i++) total += length(path[i - 1]!, path[i]!);
  const packetGap = at - old.observedAt, movementGap = at - old.at;
  const interval = clamp(old.interval * .65 + (movementGap > 1800 ? packetGap : movementGap) * .35, 300, 800);
  return { from: sampled.point, to: { ...target }, path, at, duration: interval, distance: sampled.distance, length: total, interval, observedAt: at, facing };
}

export function stopPixelMotion(old: PixelMotion | undefined, target: LivePoint, at: number): PixelMotion {
  const distance = old ? samplePixelMotion(old, at).distance : 0;
  return { from: { ...target }, to: { ...target }, path: [{ ...target }], at, duration: 500, distance, length: 0, interval: 500, observedAt: at, facing: old?.facing ?? 'se' };
}

export function isConfirmedPixelShot(event: LiveEvent): boolean {
  return event.kind === 'combat' && typeof event.id === 'string' && !!event.id && !!event.actorId && !!event.targetId && Number.isFinite(event.at) && event.at >= 0 && !!event.from && !!event.to
    && [event.from.x, event.from.y, event.to.x, event.to.y, event.damage].every(value => typeof value === 'number' && Number.isFinite(value)) && event.damage! >= 0;
}

export type PixelShotEffect = { event: LiveEvent; at: number };
/** Public shot IDs and server timestamps own the flash clock, never a polling or pose timer. */
export class PixelCombatAnimation {
  private seen = new Map<string, number>();
  private fired = new Map<string, number>();
  private hit = new Map<string, number>();
  private shots: PixelShotEffect[] = [];
  clear(): void { this.seen.clear(); this.fired.clear(); this.hit.clear(); this.shots = []; }
  update(events: readonly LiveEvent[], serverNow: number, at: number): void {
    for (const event of events) {
      if (this.seen.has(event.id)) continue;
      this.seen.set(event.id, at);
      if (!isConfirmedPixelShot(event)) continue;
      const age = serverNow - event.at;
      if (!Number.isFinite(age) || age < 0 || age > 850) continue;
      const started = at - age;
      this.shots.push({ event, at: started });
      this.fired.set(event.actorId!, Math.max(this.fired.get(event.actorId!) ?? -Infinity, started));
      if (event.damage! > 0) this.hit.set(event.targetId!, Math.max(this.hit.get(event.targetId!) ?? -Infinity, started));
    }
    for (const [id, received] of this.seen) if (at - received > 2500) this.seen.delete(id);
    while (this.seen.size > 512) this.seen.delete(this.seen.keys().next().value!);
    for (const map of [this.fired, this.hit]) for (const [id, started] of map) if (at - started > 850) map.delete(id);
    this.shots = this.shots.filter(shot => at - shot.at < 850).slice(-120);
  }
  active(at: number): readonly PixelShotEffect[] { return this.shots.filter(shot => at - shot.at >= 0 && at - shot.at < 850); }
  shotAge(id: string, at: number): number { return at - (this.fired.get(id) ?? -Infinity); }
  hitAge(id: string, at: number): number { return at - (this.hit.get(id) ?? -Infinity); }
  frame(entity: Pick<LiveEntity, 'id' | 'health' | 'action' | 'aimUntil' | 'limping'>, motion: PixelMotion, at: number, serverNow: number, walkCycleDistance = PIXEL_ACTOR_WALK_CYCLE_DISTANCE): PixelActorFrame {
    const sampled = samplePixelMotion(motion, at), shotAge = this.shotAge(entity.id, at), hitAge = this.hitAge(entity.id, at);
    if (entity.health <= 0 || entity.action === 'downed') return { mode: 'downed', frame: 0, facing: motion.facing };
    if (shotAge >= 0 && shotAge < PIXEL_ACTOR_CYCLE_MS.fire) return { mode: 'fire', frame: pixelActorTimedFrame('fire', shotAge, false), facing: motion.facing };
    if (hitAge >= 0 && hitAge < PIXEL_ACTOR_CYCLE_MS.hit) return { mode: 'hit', frame: pixelActorTimedFrame('hit', hitAge, false), facing: motion.facing };
    if (sampled.walking) {
      const next = sampled.remaining[1]!, dx = next.x - sampled.point.x, dy = next.y - sampled.point.y;
      const cycle = clamp(Number.isFinite(walkCycleDistance) && walkCycleDistance > 0 ? walkCycleDistance : PIXEL_ACTOR_WALK_CYCLE_DISTANCE, .2, 2) * (entity.limping ? PIXEL_ACTOR_LIMP_CYCLE_SCALE : 1);
      return { mode: 'walk', frame: Math.floor(sampled.distance / cycle * PIXEL_ACTOR_FRAMES.walk) % PIXEL_ACTOR_FRAMES.walk, facing: pixelFacing(dx - dy, (dx + dy) / 2, motion.facing) };
    }
    let phase = 0;
    for (let i = 0; i < entity.id.length; i++) phase = (Math.imul(phase, 31) + entity.id.charCodeAt(i)) >>> 0;
    if (entity.action === 'combat' || entity.aimUntil && entity.aimUntil > serverNow) return { mode: 'aim', frame: pixelActorTimedFrame('aim', at + phase % PIXEL_ACTOR_CYCLE_MS.aim), facing: motion.facing };
    return { mode: 'idle', frame: pixelActorTimedFrame('idle', at + phase % PIXEL_ACTOR_CYCLE_MS.idle), facing: motion.facing };
  }
}
