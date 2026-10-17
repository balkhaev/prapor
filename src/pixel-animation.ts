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
  /** Speeds are tiles/ms. The envelope only traverses already observed cells. */
  pace?: { speed: number; initialSpeed: number; accelerateMs: number; brakeMs: number };
  entryFacing?: PixelFacing;
};
const length = (a: LivePoint, b: LivePoint) => Math.hypot(b.x - a.x, b.y - a.y);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function travel(motion: PixelMotion, at: number): { travelled: number; speed: number } {
  const elapsed = clamp(at - motion.at, 0, motion.duration), pace = motion.pace;
  if (!pace) return { travelled: motion.length * elapsed / motion.duration, speed: elapsed < motion.duration ? motion.length / motion.duration : 0 };
  const { speed, initialSpeed, accelerateMs, brakeMs } = pace;
  // Integral of smoothstep: continuous velocity and acceleration at each join.
  const integral = (t: number) => t * t * t - .5 * t * t * t * t;
  if (elapsed < accelerateMs) {
    const t = elapsed / accelerateMs;
    return { travelled: initialSpeed * elapsed + (speed - initialSpeed) * accelerateMs * integral(t), speed: initialSpeed + (speed - initialSpeed) * t * t * (3 - 2 * t) };
  }
  const accelerated = (initialSpeed + speed) * accelerateMs / 2;
  const brakeAt = motion.duration - brakeMs;
  if (elapsed < brakeAt) return { travelled: accelerated + speed * (elapsed - accelerateMs), speed };
  const t = brakeMs ? (elapsed - brakeAt) / brakeMs : 1;
  return { travelled: Math.min(motion.length, accelerated + speed * (brakeAt - accelerateMs) + speed * brakeMs * (t - integral(t))), speed: speed * (1 - t * t * (3 - 2 * t)) };
}

/** Sampling is analytic: extra render frames never add distance or advance a footstep. */
export function samplePixelMotion(motion: PixelMotion, at: number): { point: LivePoint; distance: number; walking: boolean; remaining: LivePoint[]; speed: number } {
  const progress = clamp((at - motion.at) / motion.duration, 0, 1), { travelled, speed } = travel(motion, at);
  let remaining = travelled;
  for (let i = 1; i < motion.path.length; i++) {
    const a = motion.path[i - 1]!, b = motion.path[i]!, segment = length(a, b);
    if (remaining < segment) {
      const fraction = segment ? remaining / segment : 1, point = { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
      return { point, distance: motion.distance + travelled, walking: motion.length > .015 && progress < 1, remaining: [point, ...motion.path.slice(i)], speed };
    }
    remaining -= segment;
  }
  return { point: { ...motion.to }, distance: motion.distance + motion.length, walking: false, remaining: [{ ...motion.to }], speed: 0 };
}

/** Turn through the adjacent views over a short planted step, without rounding
 * the actual path around a wall. Sampling the same time is render-rate independent. */
function walkingFacing(motion: PixelMotion, at: number): PixelFacing {
  let travelled = travel(motion, at).travelled, previous = motion.entryFacing ?? motion.facing;
  for (let i = 1; i < motion.path.length; i++) {
    const a = motion.path[i - 1]!, b = motion.path[i]!, segment = length(a, b);
    const facing = pixelFacing(b.x - a.x - b.y + a.y, (b.x - a.x + b.y - a.y) / 2, previous);
    if (travelled < segment) {
      if (!motion.pace) return facing;
      const progress = i === 1 ? clamp((at - motion.at) / 120, 0, 1) : clamp(travelled / .2, 0, 1);
      const from = PIXEL_FACINGS.indexOf(previous), to = PIXEL_FACINGS.indexOf(facing), turn = (to - from + 12) % 8 - 4;
      return PIXEL_FACINGS[(from + Math.round(turn * progress) + 8) % 8]!;
    }
    travelled -= segment; previous = facing;
  }
  return previous;
}

/** Retain confirmed corners while smoothing new packets. No coordinate is extrapolated. */
export function updatePixelMotion(old: PixelMotion | undefined, target: LivePoint, at: number, facing: PixelFacing = old?.facing ?? 'se', moveIntervalMs?: number): PixelMotion {
  if (old && length(old.to, target) < .001) return { ...old, facing, observedAt: at };
  if (!old || length(old.to, target) > 4 || at - old.observedAt > 1800) {
    return { from: { ...target }, to: { ...target }, path: [{ ...target }], at, duration: 500, distance: old ? old.distance + old.length : 0, length: 0, interval: 500, observedAt: at, facing };
  }
  const sampled = samplePixelMotion(old, at), path = [...sampled.remaining, { ...target }];
  let total = 0;
  for (let i = 1; i < path.length; i++) total += length(path[i - 1]!, path[i]!);
  const packetGap = at - old.observedAt, movementGap = at - old.at;
  if (Number.isFinite(moveIntervalMs) && moveIntervalMs! >= 100 && moveIntervalMs! <= 4000) {
    const interval = moveIntervalMs!;
    // A small terminal ease buffers one fast snapshot without walking beyond its
    // endpoint. Continued packets replace that brake before the actor stops.
    // Catch up gradually after jitter instead of compressing the whole path into
    // one packet interval (which used to make long NPC steps visibly lurch).
    const speed = (1 + clamp(total - 1.3, 0, .2)) / interval;
    const initialSpeed = Math.min(sampled.speed, speed * 1.2);
    const accelerateMs = Math.min(100, total / speed * .2), brakeMs = Math.min(200, total / speed * .4);
    const cruiseMs = Math.max(0, (total - (initialSpeed + speed) * accelerateMs / 2 - speed * brakeMs / 2) / speed);
    return { from: sampled.point, to: { ...target }, path, at, duration: accelerateMs + cruiseMs + brakeMs,
      distance: sampled.distance, length: total, interval, observedAt: at, facing, entryFacing: walkingFacing(old, at), pace: { speed, initialSpeed, accelerateMs, brakeMs } };
  }
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
      const cycle = clamp(Number.isFinite(walkCycleDistance) && walkCycleDistance > 0 ? walkCycleDistance : PIXEL_ACTOR_WALK_CYCLE_DISTANCE, .2, 2) * (entity.limping ? PIXEL_ACTOR_LIMP_CYCLE_SCALE : 1);
      return { mode: 'walk', frame: Math.floor(sampled.distance / cycle * PIXEL_ACTOR_FRAMES.walk) % PIXEL_ACTOR_FRAMES.walk, facing: walkingFacing(motion, at) };
    }
    let phase = 0;
    for (let i = 0; i < entity.id.length; i++) phase = (Math.imul(phase, 31) + entity.id.charCodeAt(i)) >>> 0;
    if (entity.action === 'combat' || entity.aimUntil && entity.aimUntil > serverNow) return { mode: 'aim', frame: pixelActorTimedFrame('aim', at + phase % PIXEL_ACTOR_CYCLE_MS.aim), facing: motion.facing };
    return { mode: 'idle', frame: pixelActorTimedFrame('idle', at + phase % PIXEL_ACTOR_CYCLE_MS.idle), facing: motion.facing };
  }
}
