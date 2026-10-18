import { expect, test } from 'bun:test';
import { sampleGunfire, type GunfireInput } from '../src/pixel-combat-effects';

const input: GunfireInput = { id: 'confirmed-shot', age: 0, from: { x: 40, y: 60 }, to: { x: 300, y: 80 }, eject: { x: 32, y: 61 }, scale: 1, surface: 'armor' };

test('flight ends at the confirmed hit before any armor flecks appear', () => {
  const { flightMs } = sampleGunfire(input);
  expect(sampleGunfire({ ...input, age: flightMs - .1 }).particles.some(p => p.kind === 'spark' || p.kind === 'dust')).toBe(false);
  const impact = sampleGunfire({ ...input, age: flightMs });
  expect(impact.tracer!.to).toEqual(input.to);
  const sparks = impact.particles.filter(p => p.kind === 'spark');
  expect(sparks.length).toBeGreaterThan(0);
  expect(sparks.every(p => p.x === input.to.x && p.y === input.to.y)).toBe(true);
  expect(sampleGunfire({ ...input, age: 849 }).particles).toEqual([]);
  expect(sampleGunfire({ ...input, age: 850 }).flash).toBeNull();
});

test('cloth and missed ground impacts make dust instead of metallic sparks', () => {
  for (const surface of ['body', 'ground'] as const) {
    const particles = sampleGunfire({ ...input, age: 140, surface }).particles;
    expect(particles.some(p => p.kind === 'dust')).toBe(true);
    expect(particles.some(p => p.kind === 'spark')).toBe(false);
  }
});

test('flash follows the barrel direction and a suppressor reduces its light and duration', () => {
  const shot = sampleGunfire(input), suppressed = sampleGunfire({ ...input, suppressed: true });
  expect(Math.max(...shot.flash!.points.map(p => p.x))).toBeGreaterThan(input.from.x + 10);
  const left = sampleGunfire({ ...input, to: { x: 0, y: 60 } });
  expect(Math.min(...left.flash!.points.map(p => p.x))).toBeLessThan(input.from.x - 10);
  expect(suppressed.flash!.radius).toBeLessThan(shot.flash!.radius / 2);
  expect(sampleGunfire({ ...input, age: 100, suppressed: true }).flash).toBeNull();
  expect(sampleGunfire({ ...input, age: 100 }).flash).not.toBeNull();
});

test('sampling and reduced detail remain bounded independently of render frequency', () => {
  const expected = sampleGunfire({ ...input, age: 170 });
  for (let age = 0; age < 170; age += 1000 / 144) sampleGunfire({ ...input, age });
  expect(sampleGunfire({ ...input, age: 170 })).toEqual(expected);
  expect(expected.particles.length).toBeLessThanOrEqual(14);
  const small = sampleGunfire({ ...input, age: 170, small: true });
  expect(small.particles.length).toBeLessThanOrEqual(2);
  const reduced = sampleGunfire({ ...input, age: 170, reducedMotion: true });
  expect(reduced.particles.some(p => p.kind === 'smoke')).toBe(false);
  for (const age of [-1, NaN, Infinity, 900]) {
    expect(sampleGunfire({ ...input, age }).particles).toEqual([]);
    expect(sampleGunfire({ ...input, age }).flash).toBeNull();
  }
});
