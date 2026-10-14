import { describe, expect, test } from 'bun:test';
import type { LiveEvent } from '../src/game/live';
import { PIXEL_FACINGS, PixelCombatAnimation, isConfirmedPixelShot, pixelBearing, pixelFacing, samplePixelMotion, stopPixelMotion, updatePixelMotion } from '../src/pixel-animation';

const actor = { id: 'self', health: 100, action: 'idle' as const };
const shot = (id = 'shot', damage = 25): LiveEvent => ({ id, at: 10_000, kind: 'combat', text: 'Выстрел', actorId: 'self', targetId: 'guard', from: { x: 8, y: 8 }, to: { x: 12, y: 9 }, damage });

describe('server confirmed pixel combat animation', () => {
  test('aiming, interrupted aim and repeated combat polling never discharge a gun', () => {
    const effects = new PixelCombatAnimation(), motion = updatePixelMotion(undefined, { x: 8, y: 8 }, 0);
    for (let poll = 0; poll < 5; poll++) {
      effects.update([{ id: `aim-${poll}`, at: 10_000 + poll * 500, kind: 'combat', text: 'Прицеливается', actorId: 'self', targetId: 'guard' }], 10_000 + poll * 500, poll * 500);
      expect(effects.frame({ ...actor, action: 'combat', aimUntil: 15_000 }, motion, poll * 500, 10_000 + poll * 500).mode).toBe('aim');
      expect(effects.active(poll * 500)).toHaveLength(0);
    }
    expect(isConfirmedPixelShot({ ...shot(), damage: undefined })).toBe(false);
    expect(isConfirmedPixelShot({ ...shot(), from: { x: NaN, y: 8 } })).toBe(false);
  });

  test('UUID dedup keeps the original clock while distinct shots on one server tick both render', () => {
    const effects = new PixelCombatAnimation(), motion = updatePixelMotion(undefined, { x: 8, y: 8 }, 0);
    effects.update([shot(), shot('other-shot', 0)], 10_025, 300);
    expect(effects.active(300)).toHaveLength(2);
    expect(effects.frame(actor, motion, 300, 10_025)).toMatchObject({ mode: 'fire', frame: 0 });
    effects.update([shot(), shot('other-shot', 0)], 10_100, 375);
    effects.update([shot(), shot('other-shot', 0)], 10_160, 435);
    expect(effects.active(435)).toHaveLength(2);
    expect(effects.shotAge('self', 435)).toBe(160);
    expect(effects.frame(actor, motion, 435, 10_160)).toMatchObject({ mode: 'fire', frame: 2 });
    expect(effects.frame(actor, motion, 490, 10_215).mode).toBe('idle');
  });

  test('blocked damage still fires but only positive damage flinches the visible target', () => {
    const effects = new PixelCombatAnimation(), motion = updatePixelMotion(undefined, { x: 12, y: 9 }, 0);
    effects.update([shot('armor-stop', 0)], 10_000, 300);
    expect(effects.frame(actor, motion, 300, 10_000).mode).toBe('fire');
    expect(effects.frame({ ...actor, id: 'guard' }, motion, 300, 10_000).mode).toBe('idle');
    effects.update([shot('wound', 20)], 10_025, 325);
    expect(effects.frame({ ...actor, id: 'guard' }, motion, 325, 10_025).mode).toBe('hit');
    expect(effects.frame({ ...actor, id: 'guard', health: 0 }, motion, 325, 10_025).mode).toBe('downed');
    effects.clear(); expect(effects.active(325)).toHaveLength(0);
  });

  test('late packets cannot restart old flashes, and event endpoints survive without hidden body data', () => {
    const effects = new PixelCombatAnimation(), motion = updatePixelMotion(undefined, { x: 8, y: 8 }, 0);
    effects.update([shot()], 10_600, 1000);
    expect(effects.active(1000)).toHaveLength(1);
    expect(effects.frame(actor, motion, 1000, 10_600).mode).toBe('idle');
    expect(effects.active(1260)).toHaveLength(0);
    effects.update([shot()], 11_000, 1400);
    expect(effects.active(1400)).toHaveLength(0);
  });
});

describe('distance driven gait and retained confirmed path', () => {
  test('unchanged coordinates preserve the segment clock; idle final steps finish and then freeze', () => {
    let motion = updatePixelMotion(undefined, { x: 5, y: 5 }, 0);
    motion = updatePixelMotion(motion, { x: 6, y: 5 }, 500);
    const unchanged = updatePixelMotion(motion, { x: 6, y: 5 }, 700);
    expect(unchanged.at).toBe(motion.at); expect(unchanged.path).toBe(motion.path);
    expect(samplePixelMotion(motion, 750)).toMatchObject({ point: { x: 5.5, y: 5 }, distance: .5, walking: true });
    const effects = new PixelCombatAnimation();
    expect(effects.frame(actor, motion, 750, 10_000).mode).toBe('walk');
    expect(effects.frame(actor, motion, 1010, 10_000).mode).toBe('idle');
    expect(samplePixelMotion(motion, 1010).distance).toBe(samplePixelMotion(motion, 5000).distance);
  });

  test('sampling at 30 or 144 Hz yields identical feet and phase at the same instant', () => {
    const start = updatePixelMotion(undefined, { x: 5, y: 5 }, 0), motion = updatePixelMotion(start, { x: 6, y: 5 }, 500);
    for (const step of [1000 / 30, 1000 / 144]) for (let at = 500; at < 875; at += step) samplePixelMotion(motion, at);
    expect(samplePixelMotion(motion, 875)).toMatchObject({ point: { x: 5.75, y: 5 }, distance: .75 });
  });

  test('a turn follows the confirmed corner instead of cutting diagonally through cover', () => {
    const initial = updatePixelMotion(undefined, { x: 5, y: 5 }, 0), first = updatePixelMotion(initial, { x: 6, y: 5 }, 500);
    const turn = updatePixelMotion(first, { x: 6, y: 6 }, 750);
    expect(turn.path).toEqual([{ x: 5.5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }]);
    for (let at = 750; at < 1300; at += 20) {
      const p = samplePixelMotion(turn, at).point;
      expect(p.x === 6 || p.y === 5).toBe(true);
      expect(p.x).toBeLessThanOrEqual(6); expect(p.y).toBeLessThanOrEqual(6);
    }
    const teleported = updatePixelMotion(turn, { x: 90, y: 90 }, 800);
    expect(samplePixelMotion(teleported, 801)).toMatchObject({ point: { x: 90, y: 90 }, walking: false });
    expect(teleported.distance).toBeLessThan(3);
    const corpse = stopPixelMotion(turn, { x: 6, y: 6 }, 800);
    expect(samplePixelMotion(corpse, 850)).toMatchObject({ point: { x: 6, y: 6 }, walking: false });
  });

  test('eight projected bearings roundtrip, and tiny or invalid bearings retain identity direction', () => {
    for (const facing of PIXEL_FACINGS) { const b = pixelBearing(facing); expect(pixelFacing(b.x, b.y)).toBe(facing); }
    expect(pixelFacing(0, 0, 'nw')).toBe('nw'); expect(pixelFacing(NaN, 0, 'w')).toBe('w');
  });

  test('an observed stationary pause does not turn the next real step into a teleport', () => {
    let motion = updatePixelMotion(undefined, { x: 5, y: 5 }, 0);
    for (let at = 500; at <= 3500; at += 500) motion = updatePixelMotion(motion, { x: 5, y: 5 }, at);
    motion = updatePixelMotion(motion, { x: 6, y: 5 }, 4000);
    expect(samplePixelMotion(motion, 4100).walking).toBe(true);
    expect(samplePixelMotion(motion, 4100).point.x).toBeLessThan(6);
    const reconnect = updatePixelMotion(motion, { x: 7, y: 5 }, 7000);
    expect(samplePixelMotion(reconnect, 7000)).toMatchObject({ point: { x: 7, y: 5 }, walking: false });
  });
});
