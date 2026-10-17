import { describe, expect, test } from 'bun:test';
import type { LiveEvent } from '../src/game/live';
import { PIXEL_FACINGS, PixelCombatAnimation, isConfirmedPixelShot, pixelBearing, pixelFacing, samplePixelMotion, stopPixelMotion, updatePixelMotion } from '../src/pixel-animation';
import { PIXEL_ACTOR_ANCHOR, PIXEL_ACTOR_CYCLE_MS, PIXEL_ACTOR_FRAME_MS, PIXEL_ACTOR_FRAMES, pixelActorFrameIndex, pixelActorTimedFrame, pixelActorWalkCycleDistance } from '../src/pixel-actor-config';
import { pixelActorRig } from '../src/pixel-actor-rig';

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
    expect(effects.frame(actor, motion, 435, 10_160)).toMatchObject({ mode: 'fire', frame: 3 });
    expect(effects.frame(actor, motion, 490, 10_215)).toMatchObject({ mode: 'fire', frame: PIXEL_ACTOR_FRAMES.fire - 1 });
    expect(effects.frame(actor, motion, 500, 10_225).mode).toBe('idle');
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

  test('five shot frames and four impact frames use shared durations and settle without repeated events', () => {
    const effects = new PixelCombatAnimation(), motion = updatePixelMotion(undefined, { x: 8, y: 8 }, 0);
    effects.update([shot()], 10_000, 300);
    for (let frame = 0; frame < PIXEL_ACTOR_FRAMES.fire; frame++) {
      const elapsed = frame * PIXEL_ACTOR_FRAME_MS.fire;
      expect(effects.frame(actor, motion, 300 + elapsed, 10_000 + elapsed)).toMatchObject({ mode: 'fire', frame });
    }
    for (let frame = 0; frame < PIXEL_ACTOR_FRAMES.hit; frame++) {
      const elapsed = frame * PIXEL_ACTOR_FRAME_MS.hit;
      expect(effects.frame({ ...actor, id: 'guard' }, motion, 300 + elapsed, 10_000 + elapsed)).toMatchObject({ mode: 'hit', frame });
    }
    expect(effects.frame(actor, motion, 300 + PIXEL_ACTOR_CYCLE_MS.fire, 10_220).mode).toBe('idle');
    expect(effects.frame({ ...actor, id: 'guard' }, motion, 300 + PIXEL_ACTOR_CYCLE_MS.hit, 10_220).mode).toBe('idle');
    // Smoke/damage text can keep fading after the body has recovered.
    expect(effects.active(600)).toHaveLength(1);
  });

  test('invalid and future timestamps never create a discharge or a hit reaction', () => {
    const effects = new PixelCombatAnimation(), motion = updatePixelMotion(undefined, { x: 8, y: 8 }, 0);
    for (const [index, at] of [NaN, Infinity, -1, 10_001].entries()) effects.update([{ ...shot(`bad-${index}`), at }], 10_000, 300);
    expect(effects.active(300)).toHaveLength(0); expect(effects.frame(actor, motion, 300, 10_000).mode).toBe('idle');
    expect(effects.frame({ ...actor, id: 'guard' }, motion, 300, 10_000).mode).toBe('idle');
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

  test('walk cadence accepts the display scale without changing analytic movement or accepting invalid cycle lengths', () => {
    const effects = new PixelCombatAnimation(), initial = updatePixelMotion(undefined, { x: 5, y: 5 }, 0), motion = updatePixelMotion(initial, { x: 6, y: 5 }, 500);
    const before = structuredClone(motion), sampled = samplePixelMotion(motion, 750);
    const desktop = effects.frame(actor, motion, 750, 10_000, pixelActorWalkCycleDistance(64)), mobile = effects.frame(actor, motion, 750, 10_000, pixelActorWalkCycleDistance(48));
    expect(desktop.mode).toBe('walk'); expect(mobile.mode).toBe('walk'); expect(desktop.frame).not.toBe(mobile.frame);
    for (const invalid of [NaN, Infinity, -3, 0]) expect(effects.frame(actor, motion, 750, 10_000, invalid)).toEqual(desktop);
    expect(samplePixelMotion(motion, 750)).toEqual(sampled); expect(motion).toEqual(before);
  });
});

describe('articulated fighter rig and shared phases', () => {
  test('all phases stay bounded for negative or invalid cache frames, and every cycle uses the same clock', () => {
    for (const mode of Object.keys(PIXEL_ACTOR_FRAMES) as Array<keyof typeof PIXEL_ACTOR_FRAMES>) {
      const count = PIXEL_ACTOR_FRAMES[mode];
      for (const frame of [-125, -1, 0, 999, NaN, Infinity]) {
        const normalized = pixelActorFrameIndex({ mode, frame }); expect(normalized).toBeGreaterThanOrEqual(0); expect(normalized).toBeLessThan(count);
        const rig = pixelActorRig({ mode, frame, facing: 'se' }); expect(rig.anchor).toEqual(PIXEL_ACTOR_ANCHOR);
        expect(Object.values(rig).every(value => typeof value !== 'number' || Number.isFinite(value))).toBe(true);
      }
      for (let frame = 0; frame < count; frame++) expect(pixelActorTimedFrame(mode, frame * PIXEL_ACTOR_FRAME_MS[mode])).toBe(frame);
      expect(pixelActorTimedFrame(mode, PIXEL_ACTOR_CYCLE_MS[mode])).toBe(0);
      expect(pixelActorTimedFrame(mode, PIXEL_ACTOR_CYCLE_MS[mode], false)).toBe(count - 1);
    }
  });

  test('support and swing transfer weight with a planted heel then toe on desktop and mobile', () => {
    let doubleSupport = 0;
    for (let frame = 0; frame < PIXEL_ACTOR_FRAMES.walk; frame++) {
      const rig = pixelActorRig({ mode: 'walk', frame, facing: 'se' });
      expect(rig.leftContact || rig.rightContact).toBe(true);
      if (rig.leftContact && rig.rightContact) doubleSupport++;
      if (rig.leftContact) expect(rig.leftLift).toBe(0); else expect(rig.leftLift).toBeGreaterThan(0);
      if (rig.rightContact) expect(rig.rightLift).toBe(0); else expect(rig.rightLift).toBeGreaterThan(0);
      expect(rig.sway * rig.hipSway).toBeLessThanOrEqual(0);
    }
    expect(doubleSupport).toBeGreaterThan(0); expect(doubleSupport).toBeLessThan(PIXEL_ACTOR_FRAMES.walk / 2);
    for (const baseTile of [48, 64]) for (const [joint, start, end] of [['leftHeel', 0, .42], ['leftToe', .17, .58]] as const) {
      const phases = Array.from({ length: PIXEL_ACTOR_FRAMES.walk }, (_, frame) => frame).filter(frame => frame / PIXEL_ACTOR_FRAMES.walk >= start && frame / PIXEL_ACTOR_FRAMES.walk <= end);
      const points = phases.map(frame => {
        const rig = pixelActorRig({ mode: 'walk', frame, facing: 'se' }), distance = pixelActorWalkCycleDistance(baseTile) * frame / PIXEL_ACTOR_FRAMES.walk;
        return { x: distance * baseTile / 2 + (rig[joint].x - rig.anchor.x) * .32, y: distance * baseTile / 4 + (rig[joint].y - rig.anchor.y) * .32 };
      });
      expect(Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x))).toBeLessThan(.4);
      expect(Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y))).toBeLessThan(.4);
    }
  });

  test('fixed-length leg links bend at the knee throughout walking and a visibly asymmetric limp', () => {
    const normal = new Set<string>(), injured = new Set<string>(); let injuredSupport = 0, healthySupport = 0;
    for (let frame = 0; frame < PIXEL_ACTOR_FRAMES.walk; frame++) for (const limping of [false, true]) {
      const rig = pixelActorRig({ mode: 'walk', frame, facing: 'e' }, limping);
      for (const [hip, knee, ankle] of [[rig.leftHip, rig.leftKnee, rig.leftAnkle], [rig.rightHip, rig.rightKnee, rig.rightAnkle]]) {
        expect(Math.abs(Math.hypot(knee!.x - hip!.x, knee!.y - hip!.y) - 29)).toBeLessThan(2);
        expect(Math.abs(Math.hypot(ankle!.x - knee!.x, ankle!.y - knee!.y) - 28)).toBeLessThan(2);
      }
      (limping ? injured : normal).add(JSON.stringify([rig.leftHip, rig.rightHip, rig.leftKnee, rig.rightKnee, rig.leftHeel, rig.rightHeel]));
      if (limping) { injuredSupport += Number(rig.leftContact); healthySupport += Number(rig.rightContact); }
    }
    expect(normal.size).toBe(PIXEL_ACTOR_FRAMES.walk); expect(injured.size).toBe(PIXEL_ACTOR_FRAMES.walk); expect(healthySupport).toBeGreaterThan(injuredSupport);
  });

  test('resting and aiming stand almost straight instead of folding the walking chain into a crouch', () => {
    for (const mode of ['idle', 'aim', 'fire'] as const) for (let frame = 0; frame < PIXEL_ACTOR_FRAMES[mode]; frame++) {
      const rig = pixelActorRig({ mode, frame, facing: 'e' });
      for (const [hip, knee, ankle] of [[rig.leftHip, rig.leftKnee, rig.leftAnkle], [rig.rightHip, rig.rightKnee, rig.rightAnkle]]) {
        expect(knee!.x - hip!.x).toBeGreaterThanOrEqual(3); expect(knee!.x - hip!.x).toBeLessThanOrEqual(6);
        expect(Math.abs(knee!.x - ankle!.x)).toBeLessThanOrEqual(6);
        expect(knee!.y).toBeGreaterThan(hip!.y); expect(knee!.y).toBeLessThan(ankle!.y);
      }
      expect(rig.leftContact && rig.rightContact).toBe(true);
      if (mode !== 'idle') {
        // Calibrated raised grip and cheek tuck bring native sights to the face;
        // all installed weapon sockets still derive from this same grip.
        expect(rig.anchor.y + 15 * .5 - rig.grip.y).toBeGreaterThanOrEqual(117.5);
        expect(rig.headBob).toBeLessThanOrEqual(-7);
      }
    }
  });

  test('breathing moves the upper body while feet and hips stay still; aiming sights remain steady', () => {
    for (const facing of PIXEL_FACINGS) {
      const idle = Array.from({ length: PIXEL_ACTOR_FRAMES.idle }, (_, frame) => pixelActorRig({ mode: 'idle', frame, facing }));
      expect(new Set(idle.map(rig => JSON.stringify([rig.leftShoulder, rig.rightShoulder, rig.headBob]))).size).toBe(PIXEL_ACTOR_FRAMES.idle);
      expect(new Set(idle.map(rig => JSON.stringify([rig.leftHip, rig.rightHip, rig.leftKnee, rig.rightKnee, rig.leftHeel, rig.rightToe]))).size).toBe(1);
      const aim = Array.from({ length: PIXEL_ACTOR_FRAMES.aim }, (_, frame) => pixelActorRig({ mode: 'aim', frame, facing }));
      expect(new Set(aim.map(rig => JSON.stringify(rig.grip))).size).toBe(1);
      expect(new Set(aim.map(rig => JSON.stringify([rig.leftShoulder, rig.rightShoulder]))).size).toBe(PIXEL_ACTOR_FRAMES.aim);
      const fire = Array.from({ length: PIXEL_ACTOR_FRAMES.fire }, (_, frame) => pixelActorRig({ mode: 'fire', frame, facing }));
      expect(fire.map(rig => rig.weaponKick)).toEqual([0, 4, 2.5, 1, 0]); expect(fire.at(-1)!.grip).toEqual(aim[0]!.grip);
      expect(fire[1]!.grip).not.toEqual(fire[0]!.grip);
    }
  });
});
