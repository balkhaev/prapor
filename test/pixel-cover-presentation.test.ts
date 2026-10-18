import { expect, test } from 'bun:test';
import type { LiveEntity } from '../src/game/live';
import { PixelCombatAnimation, PIXEL_FACINGS, updatePixelMotion, type PixelActorFrame } from '../src/pixel-animation';
import { pixelActorPresentation, pixelActorPresentationKey, PIXEL_ACTOR_FRAMES } from '../src/pixel-actor-config';
import { pixelActorRig } from '../src/pixel-actor-rig';

const actor = { id: 'cover-fighter', health: 100, action: 'combat' as const };
const feet = (rig: ReturnType<typeof pixelActorRig>) => [rig.leftHeel, rig.rightHeel, rig.leftToe, rig.rightToe, rig.leftAnkle, rig.rightAnkle, rig.leftContact, rig.rightContact];

test('cover folds the chest and bends the knees while boots keep their confirmed gait', () => {
  for (const facing of PIXEL_FACINGS) for (const mode of ['idle', 'walk', 'aim', 'fire', 'hit'] as const) {
    for (let frame = 0; frame < PIXEL_ACTOR_FRAMES[mode]; frame++) for (const limping of [false, true]) {
      const animation: PixelActorFrame = { mode, frame, facing };
      const standing = pixelActorRig(animation, limping), covered = pixelActorRig({ ...animation, pose: { ...pixelActorPresentation(animation), crouch: 1 } }, limping);
      expect(feet(covered)).toEqual(feet(standing));
      expect(covered.pelvis).toEqual({ x: standing.pelvis.x, y: standing.pelvis.y + 30 });
      expect(covered.grip.y - standing.grip.y).toBeGreaterThanOrEqual(30);
      expect(covered.leftShoulder.y - standing.leftShoulder.y).toBeGreaterThan(30);
      expect(covered.rightShoulder.y - standing.rightShoulder.y).toBeGreaterThan(30);
      expect(covered.bob + covered.headBob - covered.chestFold).toBeLessThan(standing.bob + standing.headBob - 35);
      expect(covered.chestFold).toBeGreaterThan(0);
      expect(covered.crouchLean).toBeGreaterThan(0);
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

test('incoming pressure interrupts a held sight with a fast full duck and recovery keeps boots planted', () => {
  const animation = new PixelCombatAnimation(), motion = updatePixelMotion(undefined, { x: 4, y: 5 }, 0, 'e');
  const acquiring = { ...actor, combatBehavior: 'acquiring' as const, combatStance: 'peeking' as const };
  animation.observe(acquiring, motion, 0, 10_000);
  const aimed = animation.frame(acquiring, motion, 250, 10_250);
  expect(aimed.pose!.aim).toBe(1);
  const suppressed = { ...actor, combatBehavior: 'suppressed' as const, combatStance: 'covered' as const, suppression: .9 };
  animation.observe(suppressed, motion, 300, 10_300);
  const halfway = animation.frame(suppressed, motion, 340, 10_340);
  animation.observe(suppressed, motion, 340, 10_340);
  const ducked = animation.frame(suppressed, motion, 440, 10_440);
  expect(halfway.pose!.crouch).toBeGreaterThan(aimed.pose!.crouch!);
  expect(ducked).toMatchObject({ mode: 'idle', pose: { crouch: 1, aim: .125 } });
  const aimedRig = pixelActorRig(aimed), duckedRig = pixelActorRig(ducked);
  expect(feet(duckedRig)).toEqual(feet(aimedRig));
  expect(duckedRig.grip.y).toBeGreaterThan(aimedRig.grip.y + 35);
  expect(duckedRig.weaponPitch).toBeGreaterThan(.4);
  expect(duckedRig.chestFold).toBeGreaterThan(aimedRig.chestFold);
  animation.observe(acquiring, motion, 500, 10_500);
  expect(animation.frame(acquiring, motion, 500, 10_500).pose).toEqual(ducked.pose);
  const returned = animation.frame(acquiring, motion, 750, 10_750);
  expect(returned.pose).toMatchObject({ crouch: .375, aim: 1 });
  expect(feet(pixelActorRig(returned))).toEqual(feet(aimedRig));
  expect(animation.active(750)).toHaveLength(0);
});

test('acquisition finishes the observed step before shouldering and a firing intent invents no discharge', () => {
  const animation = new PixelCombatAnimation(), start = updatePixelMotion(undefined, { x: 0, y: 0 }, 0, 'se');
  const motion = updatePixelMotion(start, { x: 1, y: 0 }, 100, 'se', 700);
  const acquiring = { ...actor, combatBehavior: 'acquiring' as const };
  animation.observe(acquiring, motion, 100, 10_100);
  const moving = animation.frame(acquiring, motion, 400, 10_400);
  expect(moving.mode).toBe('walk'); expect(moving.pose!.aim).toBeLessThan(.5);
  expect(moving.pose!.move).toBe(1);
  const planted = animation.frame(acquiring, motion, motion.at + motion.duration, 11_000);
  expect(planted.pose!.move).toBe(0); expect(planted.pose!.aim).toBe(1);
  const firing = { ...acquiring, combatBehavior: 'firing' as const };
  animation.observe(firing, motion, 1200, 11_200);
  expect(animation.frame(firing, motion, 1400, 11_400).mode).toBe('aim');
  expect(animation.active(1400)).toHaveLength(0);
});

test('reloading lowers the sight and moves the offhand without resetting its envelope at every poll', () => {
  const animation = new PixelCombatAnimation(), motion = updatePixelMotion(undefined, { x: 0, y: 0 }, 0, 'e');
  const acquiring = { ...actor, combatBehavior: 'acquiring' as const };
  animation.observe(acquiring, motion, 0, 10_000);
  const reloading = { ...actor, combatBehavior: 'reloading' as const, combatStance: 'covered' as const };
  animation.observe(reloading, motion, 300, 10_300);
  expect(animation.frame(reloading, motion, 400, 10_400).pose!.reload).toBe(.5);
  animation.observe(reloading, motion, 400, 10_400);
  const loaded = animation.frame(reloading, motion, 550, 10_550);
  expect(loaded.pose).toMatchObject({ reload: 1, aim: .125, crouch: 1 });
  expect(pixelActorRig(loaded).weaponPitch).toBeGreaterThan(.5);
  const otherPose = { ...loaded, pose: { ...loaded.pose!, reload: 0 } };
  expect(pixelActorPresentationKey(loaded)).not.toBe(pixelActorPresentationKey(otherPose));
  animation.observe(acquiring, motion, 600, 10_600);
  expect(animation.frame(acquiring, motion, 800, 10_800).pose!.reload).toBeUndefined();
  animation.retain(new Set()); animation.observe(actor, motion, 900, 10_900);
  expect(animation.frame(actor, motion, 900, 10_900).pose!.reload).toBeUndefined();
});
