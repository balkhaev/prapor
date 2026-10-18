import type { LiveEntity, LiveEvent, LivePoint } from './game/live';
import { PIXEL_ACTOR_CYCLE_MS, PIXEL_ACTOR_FRAMES, PIXEL_ACTOR_LIMP_CYCLE_SCALE, PIXEL_ACTOR_WALK_CYCLE_DISTANCE, pixelActorPresentation, pixelActorTimedFrame, type PixelActorMode, type PixelActorPose } from './pixel-actor-config';
export type { PixelActorMode } from './pixel-actor-config';

export const PIXEL_FACINGS = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'] as const;
export type PixelFacing = typeof PIXEL_FACINGS[number];
export type PixelActorFrame = { mode: PixelActorMode; frame: number; facing: PixelFacing; pose?: PixelActorPose };

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
type CombatActor = Pick<LiveEntity, 'id' | 'health' | 'action' | 'aimUntil' | 'limping' | 'combatStance' | 'combatBehavior' | 'suppression'>;
type AimEnvelope = { from: number; target: number; at: number; duration: number; expiresAt: number };
type CoverEnvelope = { from: number; target: number; at: number; duration: number };
const ease = (value: number) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const coverAt = (cover: CoverEnvelope, at: number): number => cover.from + (cover.target - cover.from) * ease((at - cover.at) / cover.duration);
const coverTarget = (entity: CombatActor): number => {
  if (entity.combatStance === 'covered' || entity.combatBehavior === 'suppressed') return 1;
  if (entity.combatStance === 'peeking') return .375;
  if (entity.combatBehavior === 'reloading') return .625;
  if (entity.combatBehavior === 'relocating') return .5;
  if (entity.combatBehavior === 'recovering') return .5;
  const pressure = Number.isFinite(entity.suppression) ? clamp(entity.suppression!, 0, 1) : 0;
  return Math.max(entity.combatStance === 'seeking-cover' ? .25 : 0, pressure * .75);
};
const readyAim = (entity: CombatActor): number => entity.combatBehavior === 'suppressed' || entity.combatBehavior === 'reloading' ? .125
  : entity.combatStance === 'covered' ? .25 : entity.combatBehavior === 'relocating' || entity.combatBehavior === 'recovering' ? .375 : 1;
const aimAt = (aim: AimEnvelope, at: number): number => {
  const raised = (time: number) => aim.from + (aim.target - aim.from) * ease((time - aim.at) / aim.duration);
  if (at <= aim.expiresAt) return raised(at);
  const from = raised(aim.expiresAt);
  return from * (1 - ease((at - aim.expiresAt) / Math.max(1, 260 * from)));
};
/** Public shot IDs and server timestamps own the flash clock, never a polling or pose timer. */
export class PixelCombatAnimation {
  private seen = new Map<string, number>();
  private fired = new Map<string, number>();
  private hit = new Map<string, number>();
  private shots: PixelShotEffect[] = [];
  private aims = new Map<string, AimEnvelope>();
  private covers = new Map<string, CoverEnvelope>();
  private reloads = new Map<string, CoverEnvelope>();
  clear(): void { this.seen.clear(); this.fired.clear(); this.hit.clear(); this.shots = []; this.aims.clear(); this.covers.clear(); this.reloads.clear(); }
  /** Observe all public actors at snapshot time, including those outside the
   * camera. Rendering then samples envelopes without advancing their clocks. */
  observe(entity: CombatActor, _motion: PixelMotion, at: number, serverNow: number): void {
    if (entity.health <= 0 || entity.action === 'downed') { this.aims.delete(entity.id); this.covers.delete(entity.id); this.reloads.delete(entity.id); return; }
    const cover = this.covers.get(entity.id), crouch = coverTarget(entity);
    if (!cover || cover.target !== crouch) {
      // A newly observed fighter already occupies its reported cover. Later
      // changes ease from the sampled posture without restarting at every poll.
      const from = cover ? coverAt(cover, at) : crouch;
      const speed = entity.combatBehavior === 'suppressed' ? 140 : entity.combatBehavior === 'acquiring' ? 240 : crouch > from ? 220 : 280;
      this.covers.set(entity.id, { from, target: crouch, at, duration: Math.max(1, Math.abs(crouch - from) * speed) });
    }
    const reloading = entity.combatBehavior === 'reloading' ? 1 : 0, reload = this.reloads.get(entity.id);
    if (!reload || reload.target !== reloading) {
      const from = reload ? coverAt(reload, at) : reloading;
      this.reloads.set(entity.id, { from, target: reloading, at, duration: Math.max(1, Math.abs(reloading - from) * 200) });
    }
    const shotAt = this.fired.get(entity.id) ?? -Infinity;
    const expiresAt = entity.combatBehavior || entity.action === 'combat' ? Infinity : Math.max(
      entity.aimUntil && entity.aimUntil > serverNow ? at + entity.aimUntil - serverNow : -Infinity,
      shotAt + 320,
    );
    const target = expiresAt > at ? readyAim(entity) : 0, previous = this.aims.get(entity.id);
    const previousTarget = previous && at < previous.expiresAt ? previous.target : 0;
    if (previous && previousTarget === target) {
      if (target) previous.expiresAt = expiresAt;
      return;
    }
    // An actor first seen mid-shot is already shouldered. A known actor raises
    // from the current pose, even if aim is interrupted before it finishes.
    const from = previous ? aimAt(previous, at) : at - shotAt < 320 ? 1 : 0;
    const lowering = target < from, duration = Math.max(1, Math.abs(target - from) * (lowering ? entity.combatBehavior === 'suppressed' ? 130 : 220 : at - shotAt < 220 ? 90 : 200));
    this.aims.set(entity.id, { from, target, at, duration, expiresAt: target ? expiresAt : Infinity });
  }
  retain(ids: ReadonlySet<string>): void {
    for (const map of [this.aims, this.covers, this.reloads]) for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
  }
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
  frame(entity: CombatActor, motion: PixelMotion, at: number, serverNow: number, walkCycleDistance = PIXEL_ACTOR_WALK_CYCLE_DISTANCE): PixelActorFrame {
    const sampled = samplePixelMotion(motion, at), shotAge = this.shotAge(entity.id, at), hitAge = this.hitAge(entity.id, at);
    if (entity.health <= 0 || entity.action === 'downed') return { mode: 'downed', frame: 0, facing: motion.facing };
    const cycle = clamp(Number.isFinite(walkCycleDistance) && walkCycleDistance > 0 ? walkCycleDistance : PIXEL_ACTOR_WALK_CYCLE_DISTANCE, .2, 2) * (entity.limping ? PIXEL_ACTOR_LIMP_CYCLE_SCALE : 1);
    const walkFrame = Math.floor(sampled.distance / cycle * PIXEL_ACTOR_FRAMES.walk) % PIXEL_ACTOR_FRAMES.walk;
    const move = motion.length <= .015 ? 0 : motion.pace ? sampled.speed / motion.pace.speed
      : sampled.walking ? ease((at - motion.at) / 100) : 1 - ease((at - motion.at - motion.duration) / 160);
    let phase = 0;
    for (let i = 0; i < entity.id.length; i++) phase = (Math.imul(phase, 31) + entity.id.charCodeAt(i)) >>> 0;
    const activeShot = shotAge >= 0 && shotAge < PIXEL_ACTOR_CYCLE_MS.fire, activeHit = hitAge >= 0 && hitAge < PIXEL_ACTOR_CYCLE_MS.hit;
    const mode: PixelActorMode = activeHit && (!activeShot || hitAge < shotAge) ? 'hit' : activeShot ? 'fire' : sampled.walking ? 'walk'
      : readyAim(entity) === 1 && (entity.combatBehavior === 'acquiring' || entity.combatBehavior === 'firing' || entity.action === 'combat' || entity.aimUntil && entity.aimUntil > serverNow) ? 'aim' : 'idle';
    const frame = mode === 'fire' ? pixelActorTimedFrame('fire', shotAge, false) : mode === 'hit' ? pixelActorTimedFrame('hit', hitAge, false)
      : mode === 'walk' ? walkFrame : pixelActorTimedFrame(mode, at + phase % PIXEL_ACTOR_CYCLE_MS[mode]);
    const envelope = this.aims.get(entity.id);
    const intendedAim = envelope ? aimAt(envelope, at) : mode === 'aim' || mode === 'fire' ? 1 : entity.combatBehavior ? readyAim(entity) : 0;
    // The last observed stride finishes before the sights plant. This affects
    // only the new explicit behavior contract, preserving older packet pacing.
    const impact = mode === 'hit' ? [.15, .55, 1, .8, .55, .3, .1, 0][frame]! : 0;
    const aim = intendedAim * (entity.combatBehavior === 'acquiring' ? 1 - clamp(move, 0, 1) * .65 : 1) * (1 - impact * .35);
    const cover = this.covers.get(entity.id), crouch = cover ? coverAt(cover, at) : coverTarget(entity);
    const reload = this.reloads.get(entity.id), reloadPose = reload ? coverAt(reload, at) : entity.combatBehavior === 'reloading' ? 1 : 0;
    // Raising the weapon and planting the final step also turn the body toward
    // its target. A shot's mode switch must not swivel planted feet back and
    // forth between movement and combat bearings.
    const walking = PIXEL_FACINGS.indexOf(walkingFacing(motion, at)), target = PIXEL_FACINGS.indexOf(motion.facing);
    const turn = (target - walking + 12) % 8 - 4;
    const planting = entity.combatBehavior === 'relocating' || entity.combatBehavior === 'acquiring';
    const turnWeight = 1 - clamp(move, 0, 1) * (planting ? 1 : 1 - aim);
    const facing = PIXEL_FACINGS[(walking + Math.round(turn * turnWeight) + 8) % 8]!;
    return { mode, frame, facing,
      pose: pixelActorPresentation({ mode, frame, pose: { walkFrame, move, aim, crouch, reload: reloadPose } }) };
  }
}
