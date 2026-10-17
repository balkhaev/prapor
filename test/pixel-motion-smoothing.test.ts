import { describe, expect, test } from 'bun:test';
import { PixelCombatAnimation, samplePixelMotion, stopPixelMotion, updatePixelMotion, type PixelMotion } from '../src/pixel-animation';

const step = (old: PixelMotion | undefined, x: number, y: number, at: number, interval = 500) => updatePixelMotion(old, { x, y }, at, 'se', interval);

describe('paced confirmed movement', () => {
  test('starts and stops with continuous velocity without changing the confirmed endpoint', () => {
    const motion = step(step(undefined, 5, 5, 0), 6, 5, 125);
    expect(samplePixelMotion(motion, 125).speed).toBe(0);
    expect(samplePixelMotion(motion, 150).speed).toBeLessThan(samplePixelMotion(motion, 200).speed);
    expect(samplePixelMotion(motion, 400).speed).toBeCloseTo(1 / 500, 6);
    const finish = motion.at + motion.duration;
    expect(samplePixelMotion(motion, finish - 10).speed).toBeLessThan(.0001);
    expect(samplePixelMotion(motion, finish + 100)).toMatchObject({ point: { x: 6, y: 5 }, distance: 1, walking: false, speed: 0 });
    for (let at = 0; at < finish + 300; at += 7) {
      const sample = samplePixelMotion(motion, at);
      expect(sample.point.x).toBeGreaterThanOrEqual(5); expect(sample.point.x).toBeLessThanOrEqual(6);
    }
  });

  test('125ms observations do not restart a slow NPC step or confuse network cadence with pace', () => {
    let motion = step(step(undefined, 5, 5, 0), 6, 5, 125, 750);
    const original = motion;
    for (let at = 250; at < 875; at += 125) motion = step(motion, 6, 5, at, 750);
    expect(motion.at).toBe(original.at); expect(motion.duration).toBe(original.duration);
    expect(samplePixelMotion(motion, 700).walking).toBe(true);
    expect(samplePixelMotion(motion, 500).speed).toBeCloseTo(1 / 750, 6);
  });

  test('continuous snapshots preserve position and speed through a confirmed right angle', () => {
    const first = step(step(undefined, 5, 5, 0), 6, 5, 125);
    const before = samplePixelMotion(first, 625), turn = step(first, 6, 6, 625);
    expect(samplePixelMotion(turn, 625).point).toEqual(before.point);
    expect(samplePixelMotion(turn, 625).speed).toBeCloseTo(before.speed, 8);
    for (let at = 625; at < 1500; at += 5) {
      const p = samplePixelMotion(turn, at).point;
      expect(p.x === 6 || p.y === 5).toBe(true);
      expect(p.x).toBeLessThanOrEqual(6); expect(p.y).toBeLessThanOrEqual(6);
    }
  });

  test('jitter stays bounded over a long walk and never creates an extrapolated step', () => {
    let motion = step(undefined, 0, 0, 0);
    for (let cell = 1; cell <= 100; cell++) {
      const at = cell * 500 + (cell % 3 === 0 ? 100 : 0);
      motion = step(motion, cell, 0, at);
      expect(cell - samplePixelMotion(motion, at).point.x).toBeLessThan(1.5);
      expect(samplePixelMotion(motion, at + 125).point.x).toBeLessThanOrEqual(cell);
    }
    const end = samplePixelMotion(motion, 100_000);
    expect(end).toMatchObject({ point: { x: 100, y: 0 }, walking: false, distance: 100 });
  });

  test('a right-angle turn uses an intermediate view while the feet stay on the confirmed corner', () => {
    const first = step(step(undefined, 5, 5, 0), 6, 5, 125), effects = new PixelCombatAnimation();
    const turn = step(first, 6, 6, 125 + first.duration);
    const actor = { id: 'walker', health: 100, action: 'moving' as const };
    const views = [0, 60, 120].map(offset => effects.frame(actor, turn, turn.at + offset, 0).facing);
    expect(views).toEqual(['se', 's', 'sw']);
    for (const offset of [0, 60, 120]) expect(samplePixelMotion(turn, turn.at + offset).point.x).toBe(6);
  });

  test('render frequency, reconnection and death do not add footsteps', () => {
    const motion = step(step(undefined, 5, 5, 0), 6, 5, 125), at = 428;
    const expected = samplePixelMotion(motion, at);
    for (const hz of [30, 60, 144]) {
      for (let clock = 125; clock < at; clock += 1000 / hz) samplePixelMotion(motion, clock);
      expect(samplePixelMotion(motion, at)).toEqual(expected);
    }
    expect(samplePixelMotion(step(motion, 10, 10, 4000), 4000)).toMatchObject({ point: { x: 10, y: 10 }, walking: false });
    const corpse = stopPixelMotion(motion, { x: 6, y: 5 }, at);
    expect(samplePixelMotion(corpse, 5000)).toMatchObject({ point: { x: 6, y: 5 }, distance: expected.distance, walking: false });
  });
});
