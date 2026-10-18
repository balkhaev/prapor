import { describe, expect, test } from 'bun:test';
import { PIXEL_FACINGS, PixelCombatAnimation, samplePixelMotion, updatePixelMotion } from '../src/pixel-animation';
import { pixelActorRig } from '../src/pixel-actor-rig';
import type { LiveEvent } from '../src/game/live';

const actor = { id: 'self', health: 100, action: 'idle' as const };
const aiming = { ...actor, action: 'combat' as const };
const still = updatePixelMotion(undefined, { x: 0, y: 0 }, 0, 'se');
const shot = (at: number): LiveEvent => ({ id: `shot-${at}`, at, kind: 'combat', text: 'Выстрел', actorId: actor.id,
  targetId: 'other', from: { x: 0, y: 0 }, to: { x: 3, y: 1 }, damage: 0 });

describe('continuous combat presentation', () => {
  test('interrupted raise and lowering reverse from their current pose; duplicates do not restart', () => {
    const combat = new PixelCombatAnimation();
    combat.observe(actor, still, 0, 0);
    combat.observe(aiming, still, 100, 100);
    expect(combat.frame(aiming, still, 100, 100).pose!.aim).toBe(0);
    const midway = combat.frame(aiming, still, 200, 200).pose!.aim;
    expect(midway).toBe(.5);
    combat.observe(aiming, still, 200, 200);
    expect(combat.frame(aiming, still, 250, 250).pose!.aim).toBeGreaterThan(midway);
    const beforeStop = combat.frame(aiming, still, 250, 250).pose!.aim;
    combat.observe(actor, still, 250, 250);
    expect(combat.frame(actor, still, 250, 250).pose!.aim).toBe(beforeStop);
    const lowering = combat.frame(actor, still, 330, 330).pose!.aim;
    expect(lowering).toBeGreaterThan(0); expect(lowering).toBeLessThan(beforeStop);
    combat.observe(aiming, still, 330, 330);
    expect(combat.frame(aiming, still, 330, 330).pose!.aim).toBe(lowering);
    expect(combat.frame(aiming, still, 530, 530).pose!.aim).toBe(1);
    expect(combat.active(530)).toHaveLength(0);
  });

  test('aim expiry and shot hold settle without requiring another packet or render frame', () => {
    const combat = new PixelCombatAnimation(), timedAim = { ...actor, aimUntil: 300 };
    combat.observe(timedAim, still, 0, 0);
    expect(combat.frame(timedAim, still, 300, 300).pose!.aim).toBe(1);
    expect(combat.frame(timedAim, still, 430, 430).pose!.aim).toBe(.5);
    expect(combat.frame(timedAim, still, 560, 560).pose!.aim).toBe(0);
    combat.update([shot(600)], 600, 600); combat.observe(actor, still, 600, 600);
    expect(combat.frame(actor, still, 820, 820)).toMatchObject({ mode: 'idle', pose: { aim: 1 } });
    combat.update([shot(600)], 900, 900); combat.observe(actor, still, 900, 900);
    expect(combat.shotAge(actor.id, 900)).toBe(300);
    expect(combat.frame(actor, still, 1050, 1050).pose!.aim).toBe(.5);
    expect(combat.frame(actor, still, 1180, 1180).pose!.aim).toBe(0);
  });

  test('confirmed fire preserves moving legs, analytic phase, and the last step while braking', () => {
    const combat = new PixelCombatAnimation(), motion = updatePixelMotion(still, { x: 1, y: 0 }, 100, 'se', 500);
    combat.observe(actor, motion, 100, 100);
    combat.update([shot(300)], 300, 300); combat.observe(aiming, motion, 300, 300);
    for (const at of [300, 322, 366, 410, 498]) {
      const firing = combat.frame(aiming, motion, at, at), gait = pixelActorRig({ mode: 'walk', frame: firing.pose!.walkFrame, facing: firing.facing, pose: { ...firing.pose!, aim: 0 } });
      const rig = pixelActorRig(firing);
      expect(firing.mode).toBe('fire'); expect(firing.pose!.move).toBeGreaterThan(0);
      expect([rig.leftHeel, rig.rightToe, rig.leftAnkle, rig.rightAnkle]).toEqual([gait.leftHeel, gait.rightToe, gait.leftAnkle, gait.rightAnkle]);
      expect(samplePixelMotion(motion, at).point.x).toBeLessThanOrEqual(1);
    }
    const end = motion.at + motion.duration;
    expect(combat.frame(aiming, motion, end - 100, end - 100).pose!.move).toBeGreaterThan(0);
    expect(combat.frame(aiming, motion, end, end).pose!.move).toBe(0);
    expect(samplePixelMotion(motion, end + 1000).point).toEqual({ x: 1, y: 0 });
  });

  test('sampling at different frame rates or offscreen leaves identical transitions', () => {
    const make = () => { const combat = new PixelCombatAnimation(); combat.observe(actor, still, 0, 0); combat.observe(aiming, still, 100, 100); return combat; };
    const baseline = make().frame(aiming, still, 240, 240);
    for (const fps of [30, 60, 144]) {
      const combat = make();
      for (let at = 100; at < 240; at += 1000 / fps) combat.frame(aiming, still, at, at);
      expect(combat.frame(aiming, still, 240, 240)).toEqual(baseline);
    }
  });

  test('raising toward an opposite target turns through adjacent views; a shot never toggles the feet bearing', () => {
    const combat = new PixelCombatAnimation();
    let motion = updatePixelMotion(still, { x: 1, y: 0 }, 100, 'se', 1000);
    combat.observe(actor, motion, 100, 100);
    motion = updatePixelMotion(motion, { x: 1, y: 0 }, 350, 'nw', 1000);
    combat.observe(aiming, motion, 350, 350);
    let previous = combat.frame(aiming, motion, 350, 350).facing;
    expect(previous).toBe('se');
    for (let at = 370; at <= 550; at += 20) {
      const current = combat.frame(aiming, motion, at, at).facing;
      const delta = (PIXEL_FACINGS.indexOf(current) - PIXEL_FACINGS.indexOf(previous) + 12) % 8 - 4;
      expect(Math.abs(delta)).toBeLessThanOrEqual(1); previous = current;
    }
    expect(previous).toBe('nw');
    combat.update([shot(600)], 600, 600); combat.observe(aiming, motion, 600, 600);
    for (const at of [600, 818, 820, 900]) expect(combat.frame(aiming, motion, at, at).facing).toBe('nw');
  });

  test('death, disappearing entities and world reset discard old aim envelopes', () => {
    const combat = new PixelCombatAnimation(); combat.observe(aiming, still, 0, 0);
    const dead = { ...aiming, health: 0 };
    combat.observe(dead, still, 250, 250);
    expect(combat.frame(dead, still, 250, 250)).toMatchObject({ mode: 'downed' });
    combat.observe(actor, still, 300, 300); expect(combat.frame(actor, still, 300, 300).pose!.aim).toBe(0);
    combat.observe(aiming, still, 400, 400); combat.retain(new Set());
    combat.observe(actor, still, 500, 500); expect(combat.frame(actor, still, 500, 500).pose!.aim).toBe(0);
    combat.observe(aiming, still, 600, 600); combat.clear();
    combat.observe(actor, still, 800, 800); expect(combat.frame(actor, still, 800, 800).pose!.aim).toBe(0);
  });

  test('a newer confirmed impact interrupts recoil, dips the sights, and settles without foot movement', () => {
    const combat = new PixelCombatAnimation(); combat.observe(aiming, still, 0, 0);
    combat.update([shot(250)], 250, 250); combat.observe(aiming, still, 250, 250);
    expect(combat.frame(aiming, still, 270, 270).mode).toBe('fire');
    const impact: LiveEvent = { ...shot(280), id: 'incoming-impact', actorId: 'other', targetId: actor.id, damage: 18 };
    combat.update([impact], 280, 280);
    const first = combat.frame(aiming, still, 280, 280), peak = combat.frame(aiming, still, 370, 370);
    expect(first.mode).toBe('hit'); expect(peak.mode).toBe('hit');
    expect(peak.pose!.aim).toBeLessThan(first.pose!.aim);
    const planted = pixelActorRig(first);
    for (const at of [300, 370, 450, 550, 600]) {
      const rig = pixelActorRig(combat.frame(aiming, still, at, at));
      expect([rig.leftHeel, rig.leftToe, rig.rightHeel, rig.rightToe]).toEqual([planted.leftHeel, planted.leftToe, planted.rightHeel, planted.rightToe]);
    }
    expect(combat.frame(aiming, still, 650, 650)).toMatchObject({ mode: 'aim', pose: { aim: 1 } });
    expect(combat.active(650)).toHaveLength(2);
  });
});
