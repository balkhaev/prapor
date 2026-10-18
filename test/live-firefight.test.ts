import { describe, expect, test } from 'bun:test';
import { applyLiveIncomingFire, createLiveFirefightState, liveFirefightHitChance, stepLiveFirefight, type LiveFirefightInput } from '../src/game/live-firefight';
import { traceLiveBulletImpact } from '../src/game/live-ballistics';

const open = (now: number): LiveFirefightInput => ({ now, visible: true, canFire: true, hasCover: false, inCover: false, atPeek: false, weaponCategory: 'rifle', attackMs: 900 });
describe('reactive firefight decisions', () => {
  test('a covering shooter holds the firing corner after a real burst without gaining rounds, then ducks when hit', () => {
    const fight = createLiveFirefightState(71, 0);
    const input = (now: number): LiveFirefightInput => ({ ...open(now), hasCover: true, inCover: false, atPeek: true, covering: true, attackMs: 2500 });
    // Start with an acquired firing position and let the ordinary burst run.
    fight.phase = 'acquiring'; fight.settledSince = 1; fight.until = 0;
    let lastShot = 0;
    for (let now = 1000; now < 1600; now += 50) if (stepLiveFirefight(fight, input(now)).action === 'fire') lastShot = now;
    const rounds = fight.roundsSinceReload, recovery = fight.recoverUntil;
    expect(rounds).toBeGreaterThanOrEqual(2);
    for (let now = lastShot + 300; now <= lastShot + 1800; now += 50) {
      expect(stepLiveFirefight(fight, input(now))).toMatchObject({ action: 'hold', behavior: 'acquiring' });
      expect(fight.roundsSinceReload).toBe(rounds); expect(fight.recoverUntil).toBe(recovery);
    }
    expect(stepLiveFirefight(fight, { ...input(lastShot + 1850), visible: false }).action).toBe('hold');
    expect(fight.roundsSinceReload).toBe(rounds);
    expect(stepLiveFirefight(structuredClone(fight), { ...input(lastShot + 2200), visible: false }).action).toBe('cover');
    applyLiveIncomingFire(fight, lastShot + 1900, .46);
    expect(stepLiveFirefight(fight, input(lastShot + 2200))).toMatchObject({ action: 'cover', behavior: 'suppressed' });
    expect(fight.roundsSinceReload).toBe(rounds);
  });
  test('automatic bursts need settling and real recovery, with no automatic shot while moving or out of sight', () => {
    const fight = createLiveFirefightState(71, 0), shots: number[] = []; let nextAttack = 0;
    for (let time = 0; time <= 30_000; time += 50) {
      const moving = time < 800, decision = stepLiveFirefight(fight, { ...open(time), moving, canFire: time >= nextAttack });
      if (decision.action === 'fire') { shots.push(time); nextAttack = time + 150; }
      if (moving) expect(decision.action).not.toBe('fire');
    }
    expect(shots[0]).toBeGreaterThanOrEqual(1350);
    expect(shots.length).toBeGreaterThan(6);
    expect(shots.length).toBeLessThan(30_000 / 900);
    const gaps = shots.slice(1).map((at, index) => at - shots[index]!);
    expect(gaps.some(gap => gap >= 150 && gap <= 300)).toBe(true);
    expect(gaps.some(gap => gap >= 2000)).toBe(true);
    for (let time = 30_050; time < 35_000; time += 50) expect(stepLiveFirefight(fight, { ...open(time), visible: false }).action).not.toBe('fire');
  });
  test('incoming rounds interrupt aiming, hold a physical reaction interval and pressure decays during quiet', () => {
    const fight = createLiveFirefightState(12, 0);
    fight.phase = 'acquiring'; fight.settledSince = 500; fight.until = 1500;
    applyLiveIncomingFire(fight, 1400, .4);
    expect(String(fight.phase)).toBe('suppressed'); expect(fight.settledSince).toBe(0);
    const input = { ...open(1400), hasCover: true, atPeek: true };
    expect(stepLiveFirefight(fight, input)).toMatchObject({ action: 'hold', behavior: 'suppressed' });
    expect(stepLiveFirefight(fight, { ...input, now: 1700 })).toMatchObject({ action: 'cover', behavior: 'suppressed' });
    expect(stepLiveFirefight(fight, { ...input, now: 5000, inCover: true, atPeek: false }).suppression).toBe(0);
  });
  test('repeated compromised exposures request a new corner and hidden contacts never invent fire', () => {
    const fight = createLiveFirefightState(39, 0);
    for (const time of [1000, 5000]) { fight.phase = 'acquiring'; applyLiveIncomingFire(fight, time, .35); }
    expect(fight.relocate).toBe(true);
    const decisions = [];
    for (let time = 5100; time < 12_000; time += 100) decisions.push(stepLiveFirefight(fight,
      { ...open(time), visible: false, hasCover: true, inCover: true, atPeek: false }));
    expect(decisions.some(decision => decision.action === 'relocate')).toBe(true);
    expect(decisions.some(decision => decision.action === 'fire')).toBe(false);
  });
  test('a long contact reloads a finite magazine and different actors do not share a metronome', () => {
    const timelines = [23, 99].map(seed => {
      const fight = createLiveFirefightState(seed, 0), shots: number[] = []; let reloading = false;
      for (let time = 0; time < 65_000; time += 50) {
        const decision = stepLiveFirefight(fight, { ...open(time), weaponCategory: 'pistol' });
        reloading ||= decision.behavior === 'reloading'; if (decision.action === 'fire') shots.push(time);
      }
      expect(reloading).toBe(true); return shots;
    });
    expect(timelines[0]).not.toEqual(timelines[1]);
  });
  test('suppression, movement and range lower real hit probability', () => {
    const settled = { distance: 2, range: 9, suppression: 0, settledMs: 1500 };
    const baseline = liveFirefightHitChance(settled);
    expect(baseline).toBeLessThan(1);
    expect(liveFirefightHitChance({ ...settled, distance: 9 })).toBeLessThan(baseline);
    expect(liveFirefightHitChance({ ...settled, suppression: .8, targetMoving: true, settledMs: 200 })).toBeLessThan(baseline);
  });
  test('the last round caps a burst and incoming fire cannot bypass an interrupted reload', () => {
    const fight = createLiveFirefightState(12, 0);
    Object.assign(fight, { phase: 'acquiring', settledSince: 1, until: 500, roundsSinceReload: 23 });
    expect(stepLiveFirefight(fight, open(1000)).action).toBe('fire');
    expect(fight.roundsLeft).toBe(0); expect(fight.roundsSinceReload).toBe(24);
    applyLiveIncomingFire(fight, 1050, .4);
    let reloaded = false, shots = 0;
    for (let time = 1100; time < 12_000; time += 50) {
      const decision = stepLiveFirefight(fight, open(time));
      reloaded ||= fight.roundsSinceReload === 0;
      if (decision.action === 'fire') { expect(reloaded).toBe(true); shots++; }
    }
    expect(reloaded).toBe(true); expect(shots).toBeGreaterThan(0);
  });
});

describe('authoritative missed-round endpoints', () => {
  test('the nearest solid face clips the round; water does not, and a vehicle has a metal impact', () => {
    const world = { width: 20, height: 20, obstacles: [
      { x: 3, y: 4, width: 1, height: 1, kind: 'water' as const },
      { x: 6, y: 4, width: 2, height: 1, kind: 'barricade' as const, propId: 'car' },
      { x: 10, y: 4, width: 2, height: 1, kind: 'building' as const },
    ], props: [{ id: 'car', x: 6, y: 4, width: 2, height: 1, kind: 'car' as const, orientation: 'x' as const, variant: 0, blocking: true }] };
    expect(traceLiveBulletImpact(world, { x: 1, y: 4 }, { x: 15, y: 4 })).toEqual({ impact: 'metal', impactPoint: { x: 5.5, y: 4 } });
    expect(traceLiveBulletImpact({ ...world, obstacles: world.obstacles.slice(2) }, { x: 1, y: 4 }, { x: 15, y: 4 })).toEqual({ impact: 'masonry', impactPoint: { x: 9.5, y: 4 } });
    expect(traceLiveBulletImpact(world, { x: 1, y: 3 }, { x: 15, y: 3 })).toEqual({ impact: 'ground', impactPoint: { x: 15, y: 3 } });
  });
});
