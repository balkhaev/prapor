import type { LiveEntity, LiveEvent } from './game/live';
import { PixelCombatAnimation, updatePixelMotion, type PixelActorFrame } from './pixel-animation';

export const PIXEL_COMBAT_PREVIEW_FRAME_MS = 20;
export const PIXEL_COMBAT_PREVIEW_DURATION_MS = 6000;
export const PIXEL_COMBAT_PREVIEW_FRAMES = PIXEL_COMBAT_PREVIEW_DURATION_MS / PIXEL_COMBAT_PREVIEW_FRAME_MS;

/** A repeatable set of confirmed snapshots, sampled through the raid's animation
 * controller. Seeking backwards never leaves a shot or blend from a later frame. */
export function createPixelCombatPreview(limping = false): readonly PixelActorFrame[] {
  const combat = new PixelCombatAnimation(), frames: PixelActorFrame[] = [];
  let motion = updatePixelMotion(undefined, { x: 0, y: 0 }, 0, 'se', 500);
  for (let at = 0; at < PIXEL_COMBAT_PREVIEW_DURATION_MS; at += PIXEL_COMBAT_PREVIEW_FRAME_MS) {
    const serverNow = 10_000 + at;
    const aiming = at >= 1500 && at < 3300;
    const entity: Pick<LiveEntity, 'id' | 'health' | 'action' | 'aimUntil' | 'limping'> = {
      id: 'preview-combat', health: 100, action: aiming ? 'combat' : 'idle', limping,
      ...(aiming ? { aimUntil: 13_300 } : {}),
    };
    // Repeated coordinates deliberately exercise the same final-step settling as
    // live snapshots. Every path point has already been observed before we use it.
    if (at % 100 === 0) {
      const firstWalk = at < 200 ? 0 : Math.min(3, Math.floor((at - 200) / 500) + 1);
      const secondWalk = at < 4000 ? 0 : Math.min(3, Math.floor((at - 4000) / 500) + 1);
      motion = updatePixelMotion(motion, { x: firstWalk + secondWalk, y: 0 }, at, 'se', 500);
    }
    const events: LiveEvent[] = at === 2200 || at === 2800 ? [{
      id: `preview-shot-${at}`, at: serverNow, kind: 'combat', text: 'Выстрел',
      actorId: entity.id, targetId: 'preview-target', from: { x: 3, y: 0 }, to: { x: 6, y: 0 }, damage: 0,
    }] : [];
    combat.update(events, serverNow, at);
    if (at % 100 === 0) combat.observe(entity, motion, at, serverNow);
    frames.push(combat.frame(entity, motion, at, serverNow));
  }
  return frames;
}

export function pixelCombatPreviewLabel(frame: number): string {
  const at = frame * PIXEL_COMBAT_PREVIEW_FRAME_MS;
  if (at < 200 || at >= 5700) return 'Стоит';
  if (at < 1500 || at >= 4000 && at < 5300) return 'Идёт';
  if (at < 1900) return 'Останавливается и целится';
  if (at < 2200) return 'Целится';
  if (at < 3300) return 'Стреляет и удерживает прицел';
  if (at < 3700) return 'Опускает оружие';
  if (at < 4000) return 'Стоит';
  return 'Завершает шаг';
}
