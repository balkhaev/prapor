import type { LivePoint } from './game/live';
import { pixelBearing, type PixelActorFrame } from './pixel-animation';
import { PIXEL_ACTOR_ANCHOR, PIXEL_ACTOR_FRAMES, PIXEL_ACTOR_STANCE_FRACTION, PIXEL_ACTOR_WALK_STRIDE, pixelActorFrameIndex } from './pixel-actor-config';

export interface PixelActorRig {
  anchor: LivePoint; grip: LivePoint; leftShoulder: LivePoint; rightShoulder: LivePoint;
  pelvis: LivePoint; leftHip: LivePoint; rightHip: LivePoint;
  leftAnkle: LivePoint; rightAnkle: LivePoint;
  leftKnee: LivePoint; rightKnee: LivePoint; leftHeel: LivePoint; rightHeel: LivePoint; leftToe: LivePoint; rightToe: LivePoint;
  bob: number; lean: number; sway: number; hipSway: number; headBob: number; headForward: number; weaponKick: number;
  leftStride: number; rightStride: number; leftLift: number; rightLift: number;
  leftHeelLift: number; rightHeelLift: number; leftToeLift: number; rightToeLift: number;
  leftContact: boolean; rightContact: boolean;
}
type Foot = { stride: number; lift: number; heelLift: number; toeLift: number; contact: boolean };
const point = (x: number, y: number): LivePoint => ({ x: Math.round(x), y: Math.round(y) });
const smooth = (value: number) => value * value * (3 - 2 * value);

/** Heel strike -> planted support -> toe push -> raised swing. The support
 * stroke is linear so analytic world movement can cancel it without skating. */
function foot(phase: number, stride: number, lift: number, stance: number): Foot {
  if (phase < stance) {
    const t = phase / stance;
    return { stride: stride * (1 - 2 * t), lift: 0, heelLift: Math.max(0, (t - .72) / .28) * 7, toeLift: Math.max(0, 1 - t / .25) * 5, contact: true };
  }
  const t = (phase - stance) / (1 - stance), height = Math.sin(t * Math.PI) * lift;
  return { stride: stride * (-1 + 2 * smooth(t)), lift: height, heelLift: height + (1 - t) * 3, toeLift: height + t * 3, contact: false };
}

/** Model-only joint positions. No phase advances a simulation position, and the
 * feet remain independent of breathing, shoulder recoil and upper-body sway. */
export function pixelActorRig(animation: PixelActorFrame, limping = false): PixelActorRig {
  const frame = pixelActorFrameIndex(animation), mode = animation.mode, bearing = pixelBearing(animation.facing), lateral = { x: -bearing.y * 2, y: bearing.x * .5 };
  const phase = frame / PIXEL_ACTOR_FRAMES[mode], angle = phase * Math.PI * 2, walk = mode === 'walk', aimed = mode === 'aim' || mode === 'fire';
  let left: Foot = { stride: -2, lift: 0, heelLift: 0, toeLift: 0, contact: true }, right: Foot = { stride: 3, lift: 0, heelLift: 0, toeLift: 0, contact: true };
  if (walk) {
    left = foot(phase, limping ? 12 : PIXEL_ACTOR_WALK_STRIDE, limping ? 7 : 12, limping ? .5 : PIXEL_ACTOR_STANCE_FRACTION);
    right = foot((phase + .5) % 1, limping ? 20 : PIXEL_ACTOR_WALK_STRIDE, 12, limping ? .75 : PIXEL_ACTOR_STANCE_FRACTION);
  }
  const recoil = mode === 'fire' ? [0, 4, 2.5, 1, 0][frame]! : 0;
  const hit = mode === 'hit' ? [1, 3, 1.5, 0][frame]! : 0;
  const breathing = mode === 'idle' ? Math.sin(angle) * 1.8 : mode === 'aim' ? Math.sin(angle) * .65 : 0;
  const bob = walk ? (1 - Math.cos(angle * 2)) * (limping ? .8 : 1.5) - (limping && phase < .5 ? .8 : 0) : breathing - hit;
  const hipSway = walk ? -Math.sin(angle) * (limping ? 1.5 : 3) + (limping ? .8 : 0) : mode === 'hit' ? -hit * .4 : 0;
  const sway = walk ? -hipSway * .45 : mode === 'idle' ? Math.cos(angle) * .65 : mode === 'hit' ? -hit : 0;
  const lean = walk ? 2 + Math.sin(angle * 2) * .35 : mode === 'hit' ? -hit * 1.6 : aimed ? 3 - recoil * .6 : 0;
  const headBob = aimed ? -7 - recoil * .15 : walk ? -bob * .35 : mode === 'idle' ? Math.sin(angle - .65) * .8 : -hit * .5;
  const headForward = aimed ? 5 : walk ? 1 : mode === 'hit' ? -hit : 0;
  const p = (side: number, forward: number, z: number) => point(PIXEL_ACTOR_ANCHOR.x + lateral.x * side + bearing.x * forward, PIXEL_ACTOR_ANCHOR.y + lateral.y * side + bearing.y * forward - z);
  const shoulderForward = lean - recoil * .4, shoulderZ = 110 + bob - recoil * .2;
  // Aiming hands remain fixed through the breath cycle; shoulders and elbows
  // absorb the subtle chest movement instead of dragging the sights around.
  const gripSide = 15 + (aimed ? -recoil * .15 : sway * .6), gripForward = aimed ? 20 - recoil * .55 : 17 + lean;
  const gripZ = aimed ? 118 + recoil * .25 : mode === 'hit' ? 81 - hit : 82 + bob * .7;
  const lowerBob = walk || mode === 'hit' ? bob : 0;
  const hipForward = walk ? Math.sin(angle * 2) * .5 : 0, hipZ = 57 + lowerBob * .45;
  const shoulderRoll = mode === 'aim' ? Math.cos(angle) * 1.2 : 0;
  const ankle = (side: number, value: Foot) => p(side, value.stride, 9 + value.lift);
  const knee = (side: number, value: Foot) => {
    // The standing trouser silhouette has a shorter exposed chain than a
    // striding leg. Keep its knee almost over the ankle instead of folding
    // the longer walking links into a permanent crouch.
    if (!walk) return p(side + hipSway * .5, hipForward + value.stride * .5 + (aimed ? 4.5 : 4), 33 + lowerBob * .4);
    // Two fixed-length links in the forward/height plane. The forward solution
    // bends a swinging knee instead of stretching or shrinking the leg.
    const thigh = 29, shin = 28, forward = value.stride - hipForward, vertical = 9 + value.lift - hipZ;
    const distance = Math.max(.001, Math.min(thigh + shin - .01, Math.hypot(forward, vertical)));
    const directionLength = Math.max(.001, Math.hypot(forward, vertical)), dx = forward / directionLength, dz = vertical / directionLength;
    const along = (thigh * thigh - shin * shin + distance * distance) / (2 * distance), bend = Math.sqrt(Math.max(0, thigh * thigh - along * along));
    return p(side + hipSway * .5, hipForward + dx * along - dz * bend, hipZ + dz * along + dx * bend);
  };
  return {
    anchor: { ...PIXEL_ACTOR_ANCHOR }, grip: p(gripSide, gripForward, gripZ),
    leftShoulder: p(-20 + sway, shoulderForward - (walk ? Math.sin(angle) * 1.5 : 0), shoulderZ + (aimed ? 1 : 0) + shoulderRoll),
    rightShoulder: p(20 + sway, shoulderForward + (walk ? Math.sin(angle) * 1.5 : 0), shoulderZ + (aimed ? 4 : 0) - shoulderRoll),
    pelvis: p(hipSway, hipForward, hipZ), leftHip: p(-8 + hipSway, hipForward, hipZ), rightHip: p(8 + hipSway, hipForward, hipZ),
    leftAnkle: ankle(-8, left), rightAnkle: ankle(8, right),
    leftKnee: knee(-8, left), rightKnee: knee(8, right),
    leftHeel: p(-8, left.stride - 4, left.heelLift + 2), rightHeel: p(8, right.stride - 4, right.heelLift + 2),
    leftToe: p(-8, left.stride + 8, left.toeLift + 1), rightToe: p(8, right.stride + 8, right.toeLift + 1),
    bob, lean, sway, hipSway, headBob, headForward, weaponKick: recoil,
    leftStride: left.stride, rightStride: right.stride, leftLift: left.lift, rightLift: right.lift,
    leftHeelLift: left.heelLift, rightHeelLift: right.heelLift, leftToeLift: left.toeLift, rightToeLift: right.toeLift,
    leftContact: left.contact, rightContact: right.contact,
  };
}
