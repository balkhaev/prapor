/** Shared art cycles. The scene samples analytic world distance; the model
 * viewer samples these same phases from a cosmetic playback clock. */
export const PIXEL_ACTOR_FRAMES = { idle: 8, walk: 24, aim: 12, fire: 10, hit: 4, downed: 1 } as const;
export type PixelActorMode = keyof typeof PIXEL_ACTOR_FRAMES;
export type PixelActorPose = { walkFrame: number; move: number; aim: number };
export const PIXEL_ACTOR_FRAME_MS: Readonly<Record<PixelActorMode, number>> = {
  idle: 280, walk: 40, aim: 100, fire: 22, hit: 55, downed: 1000,
};
export const PIXEL_ACTOR_CYCLE_MS = Object.fromEntries(Object.entries(PIXEL_ACTOR_FRAMES).map(([mode, count]) => [mode, count * PIXEL_ACTOR_FRAME_MS[mode as PixelActorMode]])) as Readonly<Record<PixelActorMode, number>>;
export const PIXEL_ACTOR_ANCHOR = { x: 128, y: 192 } as const;
export const PIXEL_ACTOR_NATIVE_SIZE = { width: 256, height: 240 } as const;
export const PIXEL_ACTOR_CACHE_BYTES = 24 * 1024 * 1024;
export const PIXEL_ACTOR_WALK_CYCLE_DISTANCE = .66;
export const PIXEL_WALK_CYCLE_DISTANCE = PIXEL_ACTOR_WALK_CYCLE_DISTANCE;
export const PIXEL_ACTOR_LIMP_CYCLE_SCALE = .6;
export const PIXEL_ACTOR_STANCE_FRACTION = .6;
export const PIXEL_ACTOR_WALK_STRIDE = 28;

export function pixelActorFrameIndex(animation: { mode: PixelActorMode; frame: number }): number {
  const count = PIXEL_ACTOR_FRAMES[animation.mode], value = Number.isFinite(animation.frame) ? Math.trunc(animation.frame) : 0;
  return (value % count + count) % count;
}
export const frameIndex = pixelActorFrameIndex;

type PresentedActor = { mode: PixelActorMode; frame: number; pose?: PixelActorPose };
/** Bounded shared channels keep every rendered pose and both sprite caches in
 * agreement. A mode without presentation data retains its native art pose. */
export function pixelActorPresentation(animation: PresentedActor): PixelActorPose {
  const fallback = { move: animation.mode === 'walk' ? 1 : 0, aim: animation.mode === 'aim' || animation.mode === 'fire' ? 1 : 0 };
  const weight = (value: number | undefined, defaultValue: number) => Number.isFinite(value) ? Math.round(Math.max(0, Math.min(1, value!)) * 8) / 8 : defaultValue;
  return {
    walkFrame: pixelActorFrameIndex({ mode: 'walk', frame: animation.pose?.walkFrame ?? (animation.mode === 'walk' ? animation.frame : 0) }),
    move: weight(animation.pose?.move, fallback.move), aim: weight(animation.pose?.aim, fallback.aim),
  };
}

export function pixelActorPresentationKey(animation: PresentedActor): string {
  const pose = pixelActorPresentation(animation);
  return `${animation.mode}:${pixelActorFrameIndex(animation)}:${pose.move}:${pose.aim}:${pose.move ? pose.walkFrame : 0}`;
}

export function pixelActorTimedFrame(mode: PixelActorMode, elapsed: number, loop = true): number {
  const count = PIXEL_ACTOR_FRAMES[mode], frame = Math.floor(Math.max(0, Number.isFinite(elapsed) ? elapsed : 0) / PIXEL_ACTOR_FRAME_MS[mode]);
  return loop ? frame % count : Math.min(count - 1, frame);
}

/** Keep a support foot planted at the mobile and desktop actor display scales. */
export function pixelActorWalkCycleDistance(baseTile = 64): number {
  const tile = Number.isFinite(baseTile) && baseTile > 0 ? Math.max(24, Math.min(128, baseTile)) : 64;
  return PIXEL_ACTOR_WALK_CYCLE_DISTANCE * 64 / tile;
}
