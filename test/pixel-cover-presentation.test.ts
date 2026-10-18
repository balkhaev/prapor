import { expect, test } from 'bun:test';
import type { LiveEntity } from '../src/game/live';
import { PixelCombatAnimation, PIXEL_FACINGS, updatePixelMotion, type PixelActorFrame } from '../src/pixel-animation';
import { pixelActorPresentation, pixelActorPresentationKey, PIXEL_ACTOR_FRAMES } from '../src/pixel-actor-config';
import { pixelActorRig } from '../src/pixel-actor-rig';

const actor = { id: 'cover-fighter', health: 100, action: 'combat' as const };
const feet = (rig: ReturnType<typeof pixelActorRig>) => [rig.leftHeel, rig.rightHeel, rig.leftToe, rig.rightToe, rig.leftAnkle, rig.rightAnkle, rig.leftContact, rig.rightContact];

test('cover posture lowers shoulders, head and weapon together while boots keep their confirmed gait', () => {
  for (const facing of PIXEL_FACINGS) for (const mode of ['idle', 'walk', 'aim', 'fire', 'hit'] as const) {
    for (let frame = 0; frame < PIXEL_ACTOR_FRAMES[mode]; frame++) for (const limping of [false, true]) {
      const animation: PixelActorFrame = { mode, frame, facing };
      const standing = pixelActorRig(animation, limping), covered = pixelActorRig({ ...animation, pose: { ...pixelActorPresentation(animation), crouch: 1 } }, limping);
      expect(feet(covered)).toEqual(feet(standing));
      expect(covered.pelvis).toEqual({ x: standing.pelvis.x, y: standing.pelvis.y + 28 });
      expect(covered.grip).toEqual({ x: standing.grip.x, y: standing.grip.y + 28 });
      expect(covered.leftShoulder).toEqual({ x: standing.leftShoulder.x, y: standing.leftShoulder.y + 28 });
      expect(covered.rightShoulder).toEqual({ x: standing.rightShoulder.x, y: standing.rightShoulder.y + 28 });
      expect(covered.bob + covered.headBob).toBeCloseTo(standing.bob + standing.headBob - 28);
      expect(covered.weaponKick).toBe(standing.weaponKick);
      if (facing === 'e') for (const [hip, knee, ankle] of [[covered.leftHip, covered.leftKnee, covered.leftAnkle], [covered.rightHip, covered.rightKnee, covered.rightAnkle]]) {
        expect(Math.abs(Math.hypot(knee!.x - hip!.x, knee!.y - hip!.y) - 29)).toBeLessThan(2);
        expect(Math.abs(Math.hypot(ankle!.x - knee!.x, ankle!.y - knee!.y) - 28)).toBeLessThan(2);
      }
    }
  }
});

test('cover is bounded, cache-visible and optional for existing animation poses', () => {
  const animation: PixelActorFrame = { mode: 'aim', frame: 0, facing: 'e', pose: { walkFrame: 0, move: 0, aim: 1 } };
  for (const invalid of [NaN, Infinity, -1]) {
    const invalidFrame = { ...animation, pose: { ...animation.pose!, crouch: invalid } };
    expect(pixelActorPresentation(invalidFrame)).toEqual(animation.pose!);
    expect(pixelActorRig(invalidFrame)).toEqual(pixelActorRig(animation));
    expect(pixelActorPresentationKey(invalidFrame)).toBe(pixelActorPresentationKey(animation));
  }
  const keys = new Set<string>();
  for (let step = 0; step <= 8; step++) keys.add(pixelActorPresentationKey({ ...animation, pose: { ...animation.pose!, crouch: step / 8 } }));
  expect(keys.size).toBe(9);
  expect(pixelActorPresentation({ ...animation, pose: { ...animation.pose!, crouch: 4 } }).crouch).toBe(1);
  expect(pixelActorPresentation({ ...animation, mode: 'downed', pose: { ...animation.pose!, crouch: 1 } }).crouch).toBeUndefined();
});

test('taking cover and peeking ease between snapshots without restarting on repeated observations', () => {
  const animation = new PixelCombatAnimation(), motion = updatePixelMotion(undefined, { x: 4, y: 5 }, 0);
  const at = (time: number, combatStance?: LiveEntity['combatStance']) => animation.frame({ ...actor, combatStance }, motion, time, 10_000 + time);
  animation.observe(actor, motion, 0, 10_000);
  const covered = { ...actor, combatStance: 'covered' as const };
  animation.observe(covered, motion, 100, 10_100);
  expect(at(100, 'covered').pose?.crouch ?? 0).toBe(0);
  expect(at(210, 'covered').pose?.crouch).toBe(.5);
  animation.observe(covered, motion, 210, 10_210);
  expect(at(320, 'covered').pose?.crouch).toBe(1);
  const peeking = { ...actor, combatStance: 'peeking' as const };
  animation.observe(peeking, motion, 320, 10_320);
  expect(at(320, 'peeking').pose?.crouch).toBe(1);
  expect(at(408, 'peeking').pose?.crouch).toBeGreaterThan(.375);
  expect(at(500, 'peeking').pose?.crouch).toBe(.375);
  animation.observe(actor, motion, 500, 10_500);
  expect(at(610).pose?.crouch ?? 0).toBe(0);
  expect(animation.active(610)).toHaveLength(0);
});

test('reversing cover movement preserves current posture and fresh observers start at the reported stance', () => {
  const animation = new PixelCombatAnimation(), motion = updatePixelMotion(undefined, { x: 4, y: 5 }, 0);
  animation.observe(actor, motion, 0, 10_000);
  animation.observe({ ...actor, combatStance: 'covered' }, motion, 100, 10_100);
  const before = animation.frame(actor, motion, 210, 10_210).pose;
  animation.observe(actor, motion, 210, 10_210);
  expect(animation.frame(actor, motion, 210, 10_210).pose).toEqual(before);
  expect(animation.frame(actor, motion, 350, 10_350).pose?.crouch ?? 0).toBe(0);
  animation.retain(new Set());
  animation.observe({ ...actor, combatStance: 'covered' }, motion, 360, 10_360);
  expect(animation.frame(actor, motion, 360, 10_360).pose?.crouch).toBe(1);
  animation.observe({ ...actor, health: 0 }, motion, 370, 10_370);
  expect(animation.frame({ ...actor, health: 0 }, motion, 370, 10_370).mode).toBe('downed');
  animation.observe({ ...actor, combatStance: 'seeking-cover' }, motion, 380, 10_380);
  expect(animation.frame(actor, motion, 380, 10_380).pose?.crouch).toBe(.25);
  animation.clear();
  expect(animation.frame(actor, motion, 400, 10_400).pose?.crouch ?? 0).toBe(0);
});
