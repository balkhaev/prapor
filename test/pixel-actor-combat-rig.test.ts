import { describe, expect, test } from 'bun:test';
import { PIXEL_FACINGS, type PixelActorFrame } from '../src/pixel-animation';
import { PIXEL_ACTOR_CYCLE_MS, PIXEL_ACTOR_FRAMES, pixelActorPresentation, pixelActorPresentationKey } from '../src/pixel-actor-config';
import { pixelActorRig } from '../src/pixel-actor-rig';

const lowerJoints = ['pelvis', 'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle', 'leftHeel', 'rightHeel', 'leftToe', 'rightToe'] as const;

describe('layered combat rig', () => {
  test('presentation channels normalize once for rendering and cache identity', () => {
    expect(pixelActorPresentation({ mode: 'walk', frame: -1 })).toEqual({ walkFrame: 23, move: 1, aim: 0 });
    expect(pixelActorPresentation({ mode: 'aim', frame: 8 })).toEqual({ walkFrame: 0, move: 0, aim: 1 });
    expect(pixelActorPresentation({ mode: 'fire', frame: 0, pose: { walkFrame: Infinity, move: NaN, aim: NaN } })).toEqual({ walkFrame: 0, move: 0, aim: 1 });
    expect(pixelActorPresentation({ mode: 'idle', frame: 0, pose: { walkFrame: -25, move: 200, aim: -1 } })).toEqual({ walkFrame: 23, move: 1, aim: 0 });
    const frame = { mode: 'aim' as const, frame: 12, pose: { walkFrame: 27, move: .51, aim: .61 } };
    const normalized = { mode: 'aim' as const, frame: 0, pose: { walkFrame: 3, move: .5, aim: .625 } };
    expect(pixelActorPresentationKey(frame)).toBe(pixelActorPresentationKey(normalized));
    expect(pixelActorPresentationKey(frame)).not.toBe(pixelActorPresentationKey({ ...normalized, pose: { ...normalized.pose, walkFrame: 4 } }));
    // The last travelled phase cannot multiply identical standing textures.
    for (let walkFrame = 0; walkFrame < PIXEL_ACTOR_FRAMES.walk; walkFrame++) {
      expect(pixelActorPresentationKey({ ...normalized, pose: { walkFrame, move: 0, aim: 1 } })).toBe(
        pixelActorPresentationKey({ ...normalized, pose: { walkFrame: 0, move: 0, aim: 1 } }));
    }
    expect(PIXEL_ACTOR_CYCLE_MS.aim).toBe(1200); expect(PIXEL_ACTOR_CYCLE_MS.fire).toBe(220);
  });

  test('a held sight is steady while breathing changes the shoulders and every boot stays planted', () => {
    for (const facing of PIXEL_FACINGS) {
      const poses = Array.from({ length: PIXEL_ACTOR_FRAMES.aim }, (_, frame) => pixelActorRig({ mode: 'aim', frame, facing }));
      expect(new Set(poses.map(rig => JSON.stringify(rig.grip))).size).toBe(1);
      expect(new Set(poses.map(rig => JSON.stringify([rig.leftShoulder, rig.rightShoulder]))).size).toBeGreaterThanOrEqual(6);
      for (const key of lowerJoints) expect(new Set(poses.map(rig => JSON.stringify(rig[key]))).size).toBe(1);
      poses.forEach((rig, frame) => {
        const next = poses[(frame + 1) % poses.length]!;
        for (const key of ['leftShoulder', 'rightShoulder'] as const) expect(Math.hypot(next[key].x - rig[key].x, next[key].y - rig[key].y)).toBeLessThanOrEqual(2);
        expect(rig.leftContact && rig.rightContact).toBe(true);
      });
    }
  });

  test('the shot has a fast weapon impulse, delayed shoulder absorption and a longer return to the sight', () => {
    for (const facing of PIXEL_FACINGS) {
      const poses = Array.from({ length: PIXEL_ACTOR_FRAMES.fire }, (_, frame) => pixelActorRig({ mode: 'fire', frame, facing }));
      const peak = poses.findIndex(rig => rig.weaponKick === Math.max(...poses.map(pose => pose.weaponKick)));
      const shoulderPeak = poses.findIndex(rig => rig.lean === Math.min(...poses.map(pose => pose.lean)));
      expect(peak).toBeGreaterThan(0); expect(peak).toBeLessThan(poses.length / 3); expect(shoulderPeak).toBeGreaterThan(peak);
      expect(poses[0]!.weaponKick).toBe(0); expect(poses.at(-1)!.weaponKick).toBe(0);
      expect(poses.at(-1)!.grip).toEqual(pixelActorRig({ mode: 'aim', frame: 0, facing }).grip);
      for (let frame = peak; frame < poses.length - 1; frame++) expect(poses[frame + 1]!.weaponKick).toBeLessThan(poses[frame]!.weaponKick);
      for (const key of lowerJoints) expect(new Set(poses.map(rig => JSON.stringify(rig[key]))).size).toBe(1);
    }
  });

  test('raising a weapon and settling out of any stride reaches both native poses through small joint steps', () => {
    for (const facing of PIXEL_FACINGS) for (const limping of [false, true]) for (let walkFrame = 0; walkFrame < PIXEL_ACTOR_FRAMES.walk; walkFrame++) {
      const poses = Array.from({ length: 9 }, (_, step) => pixelActorRig({ mode: 'aim', frame: 0, facing, pose: { walkFrame, move: 1 - step / 8, aim: step / 8 } }, limping));
      expect(poses[0]).toEqual(pixelActorRig({ mode: 'walk', frame: walkFrame, facing }, limping));
      expect(poses.at(-1)).toEqual(pixelActorRig({ mode: 'aim', frame: 0, facing }, limping));
      poses.slice(1).forEach((rig, step) => {
        const previous = poses[step]!;
        for (const key of [...lowerJoints, 'grip', 'leftShoulder', 'rightShoulder'] as const) {
          expect(Math.hypot(rig[key].x - previous[key].x, rig[key].y - previous[key].y), `${facing} ${walkFrame} ${key}`).toBeLessThan(8);
        }
        expect(rig.leftContact || rig.rightContact).toBe(true);
        expect(rig.leftLift).toBeGreaterThanOrEqual(0); expect(rig.rightLift).toBeGreaterThanOrEqual(0);
      });
    }
  });

  test('firing on the move never replaces the current footstep with standing legs', () => {
    for (const facing of PIXEL_FACINGS) for (const limping of [false, true]) for (let walkFrame = 0; walkFrame < PIXEL_ACTOR_FRAMES.walk; walkFrame++) {
      const walking = pixelActorRig({ mode: 'walk', frame: walkFrame, facing }, limping);
      for (let frame = 0; frame < PIXEL_ACTOR_FRAMES.fire; frame++) {
        const animation: PixelActorFrame = { mode: 'fire', frame, facing, pose: { walkFrame, move: 1, aim: 1 } }, firing = pixelActorRig(animation, limping);
        for (const key of lowerJoints) expect(firing[key]).toEqual(walking[key]);
        expect(firing.leftContact).toBe(walking.leftContact); expect(firing.rightContact).toBe(walking.rightContact);
      }
    }
  });
});
