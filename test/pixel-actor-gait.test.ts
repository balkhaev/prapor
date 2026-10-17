import { describe, expect, test } from 'bun:test';
import { PIXEL_FACINGS, pixelBearing } from '../src/pixel-animation';
import { PIXEL_ACTOR_CYCLE_MS, PIXEL_ACTOR_FRAMES, pixelActorTimedFrame, pixelActorWalkCycleDistance } from '../src/pixel-actor-config';
import { pixelActorRig } from '../src/pixel-actor-rig';

const cycle = (limping = false, facing: typeof PIXEL_FACINGS[number] = 'e') => Array.from({ length: PIXEL_ACTOR_FRAMES.walk }, (_, frame) => pixelActorRig({ mode: 'walk', frame, facing }, limping));

describe('walking load transfer and boot rollover', () => {
  test('the same preview cycle has enough distinct poses to keep joint steps small, including its seam', () => {
    const frames = new Set<number>();
    for (let at = 0; at < 960; at += 20) frames.add(pixelActorTimedFrame('walk', at));
    expect(frames.size).toBeGreaterThanOrEqual(24);
    expect(PIXEL_ACTOR_CYCLE_MS.walk).toBe(960);
    for (const facing of PIXEL_FACINGS) for (const limping of [false, true]) {
      const poses = cycle(limping, facing);
      expect(new Set(poses.map(rig => JSON.stringify([rig.leftKnee, rig.rightKnee, rig.leftHeel, rig.rightHeel, rig.leftToe, rig.rightToe]))).size).toBe(poses.length);
      poses.forEach((rig, index) => {
        const next = poses[(index + 1) % poses.length]!;
        for (const key of ['leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'] as const) {
          expect(Math.hypot(next[key].x - rig[key].x, next[key].y - rig[key].y)).toBeLessThan(12);
        }
        expect(Math.abs(next.bob - rig.bob)).toBeLessThan(.8);
      });
    }
  });

  test('the heel and toe keep their ground contact through support in every bearing at both display scales', () => {
    for (const facing of PIXEL_FACINGS) for (const baseTile of [48, 64]) {
      const bearing = pixelBearing(facing);
      for (const [joint, start, end] of [['leftHeel', 0, .42], ['leftToe', .17, .58]] as const) {
        const points = cycle(false, facing).flatMap((rig, frame) => {
          const phase = frame / PIXEL_ACTOR_FRAMES.walk;
          if (phase < start || phase > end) return [];
          const forward = phase * pixelActorWalkCycleDistance(baseTile) * baseTile / Math.SQRT2;
          return [{ x: forward * bearing.x + (rig[joint].x - rig.anchor.x) * .32, y: forward * bearing.y + (rig[joint].y - rig.anchor.y) * .32 }];
        });
        expect(points.length).toBeGreaterThan(5);
        expect(Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x))).toBeLessThan(.4);
        expect(Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y))).toBeLessThan(.4);
      }
    }
  });

  test('push-off lifts the ankle with the heel, and the boot never snaps on a support change', () => {
    for (const limping of [false, true]) {
      const poses = cycle(limping);
      let pushOff = 0, airborne = 0;
      for (const side of ['left', 'right'] as const) poses.forEach((rig, index) => {
        const next = poses[(index + 1) % poses.length]!, heel = rig[`${side}HeelLift`], toe = rig[`${side}ToeLift`];
        expect(heel).toBeGreaterThanOrEqual(0); expect(toe).toBeGreaterThanOrEqual(0);
        expect(rig.leftContact || rig.rightContact).toBe(true);
        if (rig[`${side}Contact`]) {
          expect(Math.min(heel, toe)).toBe(0);
          if (heel > 5) {
            const sideOffset = side === 'left' ? -4 : 4;
            const ankleHeight = rig.anchor.y + sideOffset - rig[`${side}Ankle`].y;
            expect(ankleHeight).toBeGreaterThanOrEqual(12);
            expect(toe).toBe(0); pushOff++;
          }
        } else {
          expect(heel).toBeGreaterThan(0); expect(toe).toBeGreaterThan(0); airborne++;
        }
        if (rig[`${side}Contact`] !== next[`${side}Contact`]) {
          expect(Math.abs(next[`${side}HeelLift`] - heel)).toBeLessThan(4);
          expect(Math.abs(next[`${side}ToeLift`] - toe)).toBeLessThan(4);
        }
      });
      expect(pushOff).toBeGreaterThan(0); expect(airborne).toBeGreaterThan(0);
    }
  });

  test('the pelvis turns with the forward leg while shoulders counterturn and the head absorbs the rise', () => {
    const poses = cycle();
    for (const frame of [0, PIXEL_ACTOR_FRAMES.walk / 2]) {
      const rig = poses[frame]!, legLead = rig.leftStride - rig.rightStride;
      expect((rig.leftHip.x - rig.rightHip.x) * legLead).toBeGreaterThan(0);
      expect((rig.leftShoulder.x - rig.rightShoulder.x) * legLead).toBeLessThan(0);
    }
    const torsoRise = Math.max(...poses.map(rig => rig.bob)) - Math.min(...poses.map(rig => rig.bob));
    const headRise = Math.max(...poses.map(rig => rig.bob + rig.headBob)) - Math.min(...poses.map(rig => rig.bob + rig.headBob));
    expect(torsoRise).toBeGreaterThan(2); expect(headRise).toBeLessThan(torsoRise / 2);
  });
});
