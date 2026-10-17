import type { LivePoint } from './game/live';
import { pixelBearing, type PixelActorFrame } from './pixel-animation';
import { PIXEL_ACTOR_ANCHOR, PIXEL_ACTOR_FRAMES, PIXEL_ACTOR_STANCE_FRACTION, PIXEL_ACTOR_WALK_STRIDE, pixelActorFrameIndex, pixelActorPresentation } from './pixel-actor-config';

export interface PixelActorRig {
  anchor: LivePoint; grip: LivePoint; leftShoulder: LivePoint; rightShoulder: LivePoint;
  pelvis: LivePoint; leftHip: LivePoint; rightHip: LivePoint;
  leftAnkle: LivePoint; rightAnkle: LivePoint;
  leftKnee: LivePoint; rightKnee: LivePoint; leftHeel: LivePoint; rightHeel: LivePoint; leftToe: LivePoint; rightToe: LivePoint;
  bob: number; lean: number; sway: number; hipSway: number; headBob: number; headForward: number; weaponKick: number; aim: number;
  leftStride: number; rightStride: number; leftLift: number; rightLift: number;
  leftHeelLift: number; rightHeelLift: number; leftToeLift: number; rightToeLift: number;
  leftContact: boolean; rightContact: boolean;
}
type Foot = { stride: number; lift: number; heelLift: number; toeLift: number; contact: boolean };
const point = (x: number, y: number): LivePoint => ({ x: Math.round(x), y: Math.round(y) });
const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount || 0;

/** Heel strike -> planted support -> toe push -> raised swing. The support
 * stroke is linear so analytic world movement can cancel it without skating. */
function foot(phase: number, stride: number, lift: number, stance: number): Foot {
  if (phase <= stance) {
    const t = phase / stance;
    return { stride: stride * (1 - 2 * t), lift: 0, heelLift: smooth((t - .72) / .28) * 7, toeLift: (1 - smooth(t / .25)) * 5, contact: true };
  }
  const t = (phase - stance) / (1 - stance), travel = smooth(t);
  // Lift early to clear the ground, then lower gently for heel strike. Boot
  // pitch continues from toe-off into swing and back into the next contact;
  // neither end of the boot jumps when the support leg changes.
  const arc = Math.sin(Math.PI * t), height = arc * arc * (1.25 - .5 * t) * lift;
  return { stride: stride * (-1 + 2 * travel), lift: height, heelLift: height + (1 - travel) * 7, toeLift: height + travel * 5, contact: false };
}

/** Model-only joint positions. No phase advances a simulation position, and the
 * feet remain independent of breathing, shoulder recoil and upper-body sway. */
export function pixelActorRig(animation: PixelActorFrame, limping = false): PixelActorRig {
  const frame = pixelActorFrameIndex(animation), mode = animation.mode, bearing = pixelBearing(animation.facing), lateral = { x: -bearing.y * 2, y: bearing.x * .5 };
  const { move, aim, walkFrame } = pixelActorPresentation(animation);
  const angle = frame / PIXEL_ACTOR_FRAMES[mode] * Math.PI * 2, walkPhase = walkFrame / PIXEL_ACTOR_FRAMES.walk, walkAngle = walkPhase * Math.PI * 2;
  let left: Foot = { stride: -2, lift: 0, heelLift: 0, toeLift: 0, contact: true }, right: Foot = { stride: 3, lift: 0, heelLift: 0, toeLift: 0, contact: true };
  if (move) {
    const settle = (rest: Foot, stride: Foot): Foot => ({ stride: mix(rest.stride, stride.stride, move), lift: stride.lift * move,
      heelLift: stride.heelLift * move, toeLift: stride.toeLift * move, contact: stride.contact });
    left = settle(left, foot(walkPhase, limping ? 12 : PIXEL_ACTOR_WALK_STRIDE, limping ? 7 : 12, limping ? .5 : PIXEL_ACTOR_STANCE_FRACTION));
    right = settle(right, foot((walkPhase + .5) % 1, limping ? 20 : PIXEL_ACTOR_WALK_STRIDE, 12, limping ? .75 : PIXEL_ACTOR_STANCE_FRACTION));
  }
  // The weapon reacts first; the shoulder absorbs its impulse one sample later.
  // Recovery takes most of the cycle, ending exactly at the held aim pose.
  const recoil = mode === 'fire' ? [0, 3.2, 4, 3.3, 2.5, 1.7, 1, .5, .2, 0][frame]! : 0;
  const absorbed = mode === 'fire' ? [0, .6, 2, 3.3, 3, 2.3, 1.5, .8, .3, 0][frame]! : 0;
  const hit = mode === 'hit' ? [1, 3, 1.5, 0][frame]! : 0;
  const idleBreath = mode === 'idle' ? Math.sin(angle) * 1.8 : 0, aimBreath = mode === 'aim' ? Math.sin(angle) * .85 : 0;
  // The body settles after heel strike, rises over the planted foot and
  // transfers its weight before the other leg swings. The injured-side dip
  // is continuous across the cycle, too, rather than a half-cycle snap.
  const loadAngle = walkAngle - Math.PI * .1, weight = Math.sin(loadAngle);
  const gaitBob = (1 - Math.cos(loadAngle * 2)) * (limping ? .8 : 1.5) - (limping ? (1 + weight) * .4 : 0);
  const gaitHipSway = -weight * (limping ? 1.5 : 2.7) + (limping ? .8 : 0), gaitLean = 2.6 + Math.sin(loadAngle * 2) * .45;
  const bob = gaitBob * move * (1 - aim * .55) + mix(idleBreath, aimBreath, aim) * (1 - move) - hit;
  const hipSway = mix(-hit * .4, gaitHipSway, move);
  const sway = mix(mode === 'idle' ? Math.cos(angle) * .65 : -hit, -gaitHipSway * .45, move) * (1 - aim * .55);
  const lowLean = mix(-hit * 1.6, gaitLean, move), lean = mix(lowLean, 3, aim) - absorbed * .6;
  const lowHeadBob = mix(mode === 'idle' ? Math.sin(angle - .65) * .8 : -hit * .5, -gaitBob * .65, move);
  const headBob = mix(lowHeadBob, -7 - Math.max(0, aimBreath) * .2 - absorbed * .15 - gaitBob * move * .3, aim);
  const headForward = mix(mix(-hit, 1, move), 5, aim);
  const p = (side: number, forward: number, z: number) => point(PIXEL_ACTOR_ANCHOR.x + lateral.x * side + bearing.x * forward, PIXEL_ACTOR_ANCHOR.y + lateral.y * side + bearing.y * forward - z);
  const shoulderForward = lean - absorbed * .4, shoulderZ = 110 + bob - absorbed * .2;
  // Aiming hands remain fixed through the breath cycle; shoulders and elbows
  // absorb the subtle chest movement instead of dragging the sights around.
  const gripSide = 15 + sway * .6 * (1 - aim) - recoil * .15;
  const gripForward = mix(17 + lowLean + Math.cos(walkAngle) * .8 * move, 20, aim) - recoil * .55;
  const gripZ = mix(mode === 'hit' ? 81 - hit : 82 + bob * .7, 118, aim) + recoil * .25;
  const lowerBob = gaitBob * move - hit;
  const hipForward = (gaitLean * .35 + Math.sin(loadAngle * 2) * .35) * move, hipZ = 57 + lowerBob * .45;
  const hipTwist = Math.cos(walkAngle) * (limping ? 1 : 1.8) * move, hipDrop = weight * (limping ? .5 : 1) * move;
  const shoulderRoll = -weight * .7 * move * (1 - aim * .7) + (mode === 'aim' ? Math.cos(angle) * 1.25 * aim * (1 - move) : 0);
  const shoulderTwist = Math.cos(walkAngle) * 2.3 * move * (1 - aim * .75);
  const hip = (side: number) => ({ forward: hipForward - Math.sign(side) * hipTwist, z: hipZ - Math.sign(side) * hipDrop });
  // The ankle sits over the back of the boot and follows its roll. Using only
  // swing height leaves the shin detached from a raised heel during push-off.
  const ankleHeight = (value: Foot) => 9 + value.heelLift * .7 + value.toeLift * .3;
  const ankle = (side: number, value: Foot) => p(side, value.stride, ankleHeight(value));
  const knee = (side: number, value: Foot) => {
    // The standing trouser silhouette has a shorter exposed chain than a
    // striding leg. Keep its knee almost over the ankle instead of folding
    // the longer walking links into a permanent crouch.
    const standingForward = hipForward + value.stride * .5 + 4 + aim * .5, standingZ = 33 + lowerBob * .4;
    if (!move) return p(side + hipSway * .5, standingForward, standingZ);
    // Two fixed-length links in the forward/height plane. The forward solution
    // bends a swinging knee instead of stretching or shrinking the leg.
    const at = hip(side), thigh = 29, shin = 28, forward = value.stride - at.forward, vertical = ankleHeight(value) - at.z;
    const distance = Math.max(.001, Math.min(thigh + shin - .01, Math.hypot(forward, vertical)));
    const directionLength = Math.max(.001, Math.hypot(forward, vertical)), dx = forward / directionLength, dz = vertical / directionLength;
    const along = (thigh * thigh - shin * shin + distance * distance) / (2 * distance), bend = Math.sqrt(Math.max(0, thigh * thigh - along * along));
    return p(side + hipSway * .5, mix(standingForward, at.forward + dx * along - dz * bend, move), mix(standingZ, at.z + dz * along + dx * bend, move));
  };
  return {
    anchor: { ...PIXEL_ACTOR_ANCHOR }, grip: p(gripSide, gripForward, gripZ),
    leftShoulder: p(-20 + sway, shoulderForward - shoulderTwist, shoulderZ + aim + shoulderRoll),
    rightShoulder: p(20 + sway, shoulderForward + shoulderTwist, shoulderZ + aim * 4 - shoulderRoll),
    pelvis: p(hipSway, hipForward, hipZ), leftHip: p(-8 + hipSway, hip(-8).forward, hip(-8).z), rightHip: p(8 + hipSway, hip(8).forward, hip(8).z),
    leftAnkle: ankle(-8, left), rightAnkle: ankle(8, right),
    leftKnee: knee(-8, left), rightKnee: knee(8, right),
    leftHeel: p(-8, left.stride - 4, left.heelLift + 2), rightHeel: p(8, right.stride - 4, right.heelLift + 2),
    leftToe: p(-8, left.stride + 8, left.toeLift + 1), rightToe: p(8, right.stride + 8, right.toeLift + 1),
    bob, lean, sway, hipSway, headBob, headForward, weaponKick: recoil, aim,
    leftStride: left.stride, rightStride: right.stride, leftLift: left.lift, rightLift: right.lift,
    leftHeelLift: left.heelLift, rightHeelLift: right.heelLift, leftToeLift: left.toeLift, rightToeLift: right.toeLift,
    leftContact: left.contact, rightContact: right.contact,
  };
}
