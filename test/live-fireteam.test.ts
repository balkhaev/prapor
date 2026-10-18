import { describe, expect, test } from 'bun:test';
import { createLiveFireteamState, stepLiveFireteam, type LiveFireteamActor, type LiveFireteamGeometry } from '../src/game/live-fireteam';
import type { LivePoint } from '../src/game/live';

const distance = (a: LivePoint, b: LivePoint): number => Math.hypot(a.x - b.x, a.y - b.y);
function geometry(walls: readonly LivePoint[] = []): LiveFireteamGeometry {
  const solid = new Set(walls.map(p => `${p.x},${p.y}`));
  return {
    clear: p => p.x >= 0 && p.y >= 0 && p.x < 24 && p.y < 24 && !solid.has(`${p.x},${p.y}`),
    hasLineOfSight: (a, b) => {
      const steps = Math.ceil(distance(a, b) * 10);
      for (let step = 1; step < steps; step++) {
        if (solid.has(`${Math.round(a.x + (b.x - a.x) * step / steps)},${Math.round(a.y + (b.y - a.y) * step / steps)}`)) return false;
      }
      return true;
    },
  };
}
function team(now = 1000): LiveFireteamActor[] {
  return [
    { id: 'a', point: { x: 4, y: 6 }, health: 100, suppression: 0, range: 16, ready: true,
      contact: { targetId: 'enemy', point: { x: 14, y: 7 }, seenAt: now, visible: true } },
    { id: 'b', point: { x: 4, y: 9 }, health: 100, suppression: 0, range: 16, ready: true,
      contact: { targetId: 'enemy', point: { x: 14, y: 7 }, seenAt: now, visible: true } },
  ];
}

describe('shared fireteam coordination', () => {
  test('an aim or ready weapon cannot authorise a flank; an actual covering round can', () => {
    const actors = team(), state = createLiveFireteamState(), geo = geometry();
    const waiting = stepLiveFireteam(state, actors, 1000, geo);
    expect(waiting.get('a')?.role).toBe('covering');
    expect(waiting.get('b')).toMatchObject({ role: 'regrouping', destination: undefined });
    actors[0]!.lastShot = { at: 1050, targetId: 'enemy' };
    const active = stepLiveFireteam(state, actors, 1050, geo), step = active.get('b')!.destination!;
    expect(active.get('b')).toMatchObject({ role: 'flanking', supporterId: 'a' });
    expect(distance(step, actors[1]!.point)).toBe(1);
    expect(step.y).toBeGreaterThan(actors[1]!.point.y);
    expect(active.get('a')!.destination).toBeUndefined();
  });

  test('old, unrelated or future shot receipts and a disabled supporter never masquerade as covering fire', () => {
    for (const change of [
      (actor: LiveFireteamActor) => { actor.lastShot = { at: -2000, targetId: 'enemy' }; },
      (actor: LiveFireteamActor) => { actor.lastShot = { at: 1000, targetId: 'someone-else' }; },
      (actor: LiveFireteamActor) => { actor.lastShot = { at: 1200, targetId: 'enemy' }; },
      (actor: LiveFireteamActor) => { actor.ready = false; },
      (actor: LiveFireteamActor) => { actor.moving = true; },
      (actor: LiveFireteamActor) => { actor.suppression = .6; },
    ]) {
      const actors = team(), state = createLiveFireteamState();
      actors[0]!.lastShot = { at: 1000, targetId: 'enemy' };
      stepLiveFireteam(state, actors, 1000, geometry());
      change(actors[0]!);
      const orders = stepLiveFireteam(state, actors, 1100, geometry());
      expect([...orders.values()].some(order => order.role === 'flanking')).toBe(false);
    }
  });

  test('the moving fighter uses separate real bursts, then takes over support for the next bound', () => {
    const actors = team(), state = createLiveFireteamState(), geo = geometry();
    let nextMove = 1000, moved = 0, waited = false, firstSupporter = '', swapped = false;
    for (let now = 1000; now <= 16_000; now += 50) {
      for (const actor of actors) actor.contact!.seenAt = now;
      // A real individual cadence: two close rounds, followed by a long pause.
      if ([1000, 1250, 7000, 7250].includes(now)) actors[0]!.lastShot = { at: now, targetId: 'enemy' };
      if ([10_000, 10_250, 15_000, 15_250].includes(now)) actors[1]!.lastShot = { at: now, targetId: 'enemy' };
      const orders = stepLiveFireteam(state, actors, now, geo);
      for (const actor of actors) {
        const order = orders.get(actor.id);
        if (order?.role === 'regrouping') waited = true;
        if (order?.role !== 'flanking' || !order.destination || now < nextMove) continue;
        const supporter = actors.find(other => other.id === order.supporterId)!;
        expect(now - supporter.lastShot!.at).toBeLessThanOrEqual(2200);
        expect(distance(actor.point, order.destination)).toBe(1);
        if (!firstSupporter) firstSupporter = supporter.id;
        swapped ||= supporter.id !== firstSupporter;
        actor.point = order.destination; moved++; nextMove = now + 750;
      }
    }
    expect(moved).toBeGreaterThanOrEqual(4);
    expect(waited).toBe(true);
    expect(swapped).toBe(true);
  });

  test('a stale or changed personal contact cancels a flank instead of following an unseen target', () => {
    const actors = team(), state = createLiveFireteamState(), geo = geometry();
    actors[0]!.lastShot = { at: 1000, targetId: 'enemy' };
    expect(stepLiveFireteam(state, actors, 1000, geo).get('b')?.role).toBe('flanking');
    actors[1]!.contact!.visible = false;
    actors[0]!.contact!.seenAt = 6000; actors[0]!.lastShot.at = 6000;
    expect([...stepLiveFireteam(state, actors, 6000, geo).values()].some(order => order.role === 'flanking')).toBe(false);
    expect(state.bound).toBeUndefined();
    actors[1]!.contact = { targetId: 'another', point: { x: 14, y: 2 }, seenAt: 8000, visible: true };
    actors[0]!.contact!.seenAt = 8000; actors[0]!.lastShot.at = 8000;
    expect(stepLiveFireteam(state, actors, 8000, geo).size).toBe(0);
  });

  test('an occluded firing lane pauses a bound immediately and a dead ally cannot keep supporting', () => {
    const actors = team(), state = createLiveFireteamState();
    actors[0]!.lastShot = { at: 1000, targetId: 'enemy' };
    expect(stepLiveFireteam(state, actors, 1000, geometry()).get('b')?.role).toBe('flanking');
    const blocked = geometry([{ x: 9, y: 7 }, { x: 9, y: 6 }]);
    expect(stepLiveFireteam(state, actors, 1050, blocked).get('b')?.role).toBe('regrouping');
    actors[0]!.health = 0;
    expect(stepLiveFireteam(state, actors, 1100, geometry()).size).toBe(0);
    expect(state.bound).toBeUndefined();
  });

  test('heavy incoming fire causes a bounded withdrawal, held through pressure jitter, then a quiet regroup', () => {
    const actors = team(), state = createLiveFireteamState(), geo = geometry();
    actors[1]!.suppression = .86; actors[1]!.ready = false;
    const origin = { ...actors[1]!.point }, threat = actors[1]!.contact!.point;
    let retreatSteps = 0;
    for (let now = 1000; now <= 6000; now += 750) {
      actors[1]!.contact!.seenAt = now; actors[0]!.contact!.seenAt = now;
      actors[1]!.suppression = now < 2500 ? .76 : .4;
      const orders = stepLiveFireteam(state, actors, now, geo), order = orders.get('b')!;
      expect(['withdrawing', 'regrouping']).toContain(order.role);
      expect(orders.get('a')!.role).toBe('covering');
      if (order.destination) {
        expect(distance(order.destination, actors[1]!.point)).toBe(1);
        expect(distance(order.destination, threat)).toBeGreaterThanOrEqual(distance(actors[1]!.point, threat) - .35);
        actors[1]!.point = order.destination; retreatSteps++;
      }
    }
    expect(retreatSteps).toBeGreaterThan(0);
    expect(distance(actors[1]!.point, origin)).toBeLessThanOrEqual(6);
    actors[1]!.suppression = .1;
    const quiet = stepLiveFireteam(state, actors, 7000, geo);
    expect(quiet.get('b')).toBeUndefined(); expect(state.withdrawals.size).toBe(0);
  });

  test('retreat finds a walkable sheltered route instead of cutting through an obstacle', () => {
    const actors = team(), state = createLiveFireteamState();
    actors[1]!.point = { x: 7, y: 7 }; actors[1]!.contact!.point = { x: 15, y: 7 }; actors[1]!.suppression = .9;
    const geo = geometry([6, 7, 8, 9].map(y => ({ x: 5, y })));
    let sheltered = false;
    for (let now = 1000; now < 8500; now += 750) {
      actors[1]!.contact!.seenAt = now;
      const order = stepLiveFireteam(state, actors, now, geo).get('b')!;
      if (order.destination) {
        expect(geo.clear(order.destination, 'b')).toBe(true);
        expect(distance(actors[1]!.point, order.destination)).toBe(1);
        actors[1]!.point = order.destination;
      }
      sheltered ||= !geo.hasLineOfSight(actors[1]!.point, actors[1]!.contact!.point);
    }
    expect(sheltered).toBe(true);
  });

  test('an enclosed or forbidden route produces no fabricated movement and search stays local', () => {
    const actors = team(), state = createLiveFireteamState();
    actors[0]!.lastShot = { at: 1000, targetId: 'enemy' };
    let calls = 0;
    const geo: LiveFireteamGeometry = { clear: () => { calls++; return true; }, hasLineOfSight: () => true,
      permitted: point => point.x === 4 && (point.y === 6 || point.y === 9) };
    expect(stepLiveFireteam(state, actors, 1000, geo).size).toBe(0);
    expect(calls).toBeLessThan(100);
    const firstCalls = calls;
    stepLiveFireteam(state, actors, 1050, geo);
    expect(calls).toBe(firstCalls);
  });

  test('teammates never step into the supporting muzzle lane or onto each other', () => {
    const actors = team(), state = createLiveFireteamState(), geo = geometry();
    actors[0]!.point = { x: 4, y: 7 }; actors[1]!.point = { x: 7, y: 6 };
    actors[0]!.lastShot = { at: 1000, targetId: 'enemy' };
    for (let now = 1000; now < 2500; now += 250) {
      actors[0]!.lastShot.at = now;
      const order = stepLiveFireteam(state, actors, now, geo).get('b');
      if (!order?.destination) continue;
      expect(order.destination.y).not.toBe(7);
      expect(distance(order.destination, actors[0]!.point)).toBeGreaterThan(0);
      actors[1]!.point = order.destination;
    }
  });

  test('one covering burst supports a complete three-step bound at actual NPC walking speed', () => {
    const actors = team(), state = createLiveFireteamState(), geo = geometry();
    actors[0]!.lastShot = { at: 1000, targetId: 'enemy' };
    const origin = { ...actors[1]!.point };
    for (const now of [1050, 1800, 2550]) {
      actors.forEach(actor => { actor.contact!.seenAt = now; });
      const order = stepLiveFireteam(state, actors, now, geo).get('b')!;
      expect(order.role).toBe('flanking'); expect(order.destination).toBeDefined();
      expect(distance(actors[1]!.point, order.destination!)).toBe(1);
      actors[1]!.point = order.destination!;
    }
    expect(distance(origin, actors[1]!.point)).toBeGreaterThanOrEqual(3);
    const settled = stepLiveFireteam(state, actors, 2600, geo).get('b');
    expect(settled).toMatchObject({ role: 'covering', holdPosition: true }); expect(settled?.destination).toBeUndefined();
    expect(state.previousMover).toBe('b'); expect(state.bound).toBeUndefined();
  });

  test('a completed flank holds its new angle through acquisition, then releases after the real burst', () => {
    const actors = team(), state = createLiveFireteamState(), geo = geometry();
    actors[0]!.lastShot = { at: 1000, targetId: 'enemy' };
    for (const now of [1000, 1750, 2500]) {
      const order = stepLiveFireteam(state, actors, now, geo).get('b')!;
      actors[1]!.point = order.destination!;
    }
    stepLiveFireteam(state, actors, 2550, geo);
    for (const now of [3000, 4000, 5000]) {
      actors.forEach(actor => { actor.contact!.seenAt = now; });
      expect(stepLiveFireteam(state, actors, now, geo).get('b')?.holdPosition).toBe(true);
    }
    actors[1]!.lastShot = { at: 5000, targetId: 'enemy' };
    expect(stepLiveFireteam(state, actors, 5050, geo).get('b')?.holdPosition).toBe(true);
    actors.forEach(actor => { actor.contact!.seenAt = 7250; });
    expect(stepLiveFireteam(state, actors, 7250, geo).get('b')?.holdPosition).not.toBe(true);
    expect(state.stations.size).toBe(0);
  });

  test('a completed flanker stops holding when its own contact expires or a reload begins', () => {
    for (const lostView of [true, false]) {
      const actors = team(), state = createLiveFireteamState(), geo = geometry();
      actors[0]!.lastShot = { at: 1000, targetId: 'enemy' };
      for (const now of [1000, 1750, 2500]) actors[1]!.point = stepLiveFireteam(state, actors, now, geo).get('b')!.destination!;
      expect(stepLiveFireteam(state, actors, 2550, geo).get('b')?.holdPosition).toBe(true);
      if (lostView) { actors[1]!.contact!.visible = false; actors[1]!.contact!.seenAt = 0; } else actors[1]!.ready = false;
      expect(stepLiveFireteam(state, actors, 2600, geo).get('b')?.holdPosition).not.toBe(true);
      expect(state.stations.size).toBe(0);
    }
  });

  test('two pressed teammates reserve separate retreat steps and recover without an endless flight', () => {
    const actors = team(), state = createLiveFireteamState(), geo = geometry();
    actors[0]!.point = { x: 7, y: 6 }; actors[1]!.point = { x: 7, y: 8 };
    actors.forEach(actor => { actor.suppression = .9; actor.ready = false; });
    let movements = 0;
    for (let now = 1000; now <= 15_000; now += 750) {
      const orders = stepLiveFireteam(state, actors, now, geo);
      const steps = [...orders.values()].flatMap(order => order.destination ? [order.destination] : []);
      expect(new Set(steps.map(p => `${p.x},${p.y}`)).size).toBe(steps.length);
      for (const actor of actors) {
        const step = orders.get(actor.id)?.destination;
        if (step) { actor.point = step; movements++; }
      }
    }
    expect(movements).toBeGreaterThan(0); expect(movements).toBeLessThanOrEqual(12);
  });

  test('a real burst briefly covers the witnessed lane after an opponent ducks, then expires', () => {
    const actors = team(), state = createLiveFireteamState(), geo = geometry();
    actors[0]!.lastShot = { at: 1000, targetId: 'enemy' };
    stepLiveFireteam(state, actors, 1000, geo);
    actors.forEach(actor => { actor.contact!.visible = false; });
    expect(stepLiveFireteam(state, actors, 1250, geo).get('b')?.role).toBe('flanking');
    expect(stepLiveFireteam(state, actors, 2750, geo).get('b')?.role).toBe('flanking');
    expect(stepLiveFireteam(state, actors, 3250, geo).get('b')?.role).toBe('regrouping');
    // Once the finite memory expires there is no pursuit of the hidden actor.
    expect(stepLiveFireteam(state, actors, 6000, geo).size).toBe(0);
  });

  test('a pressed fighter can fall back along cover, without leaving its protection or repeating the retreat', () => {
    const actors = team(), state = createLiveFireteamState();
    actors[1]!.point = { x: 5, y: 7 }; actors[1]!.suppression = .9;
    const origin = { ...actors[1]!.point }, threat = actors[1]!.contact!.point;
    const geo = geometry([4, 5, 6, 7, 8, 9, 10].map(y => ({ x: 6, y })));
    expect(geo.hasLineOfSight(origin, threat)).toBe(false);
    let moved = 0;
    for (let now = 1000; now <= 10_000; now += 750) {
      const order = stepLiveFireteam(state, actors, now, geo).get('b')!;
      if (!order.destination) continue;
      expect(geo.hasLineOfSight(order.destination, threat)).toBe(false);
      expect(distance(order.destination, threat)).toBeGreaterThanOrEqual(distance(actors[1]!.point, threat));
      expect(distance(actors[1]!.point, order.destination)).toBe(1);
      actors[1]!.point = order.destination; moved++;
    }
    expect(moved).toBeGreaterThanOrEqual(2); expect(moved).toBeLessThanOrEqual(3);
    expect(distance(origin, actors[1]!.point)).toBeGreaterThanOrEqual(2);
  });

  test('a pressured covered fighter stays put if deeper cover requires crossing an exposed tile', () => {
    const actors = team(), state = createLiveFireteamState();
    actors[1]!.point = { x: 5, y: 7 }; actors[1]!.suppression = .9;
    const geo: LiveFireteamGeometry = { clear: geometry().clear,
      hasLineOfSight: from => !(from.x === 5 && from.y === 7) };
    for (const now of [1000, 1750, 2500, 4000]) {
      const order = stepLiveFireteam(state, actors, now, geo).get('b');
      expect(order?.role).toBe('regrouping'); expect(order?.destination).toBeUndefined();
    }
  });

  test('a completed flanker watches the briefly suppressed lane and can acquire a personally visible second opponent from its new angle', () => {
    const actors = team(), state = createLiveFireteamState(), geo = geometry();
    actors[0]!.lastShot = { at: 1000, targetId: 'enemy' };
    for (const now of [1000, 1750, 2500]) actors[1]!.point = stepLiveFireteam(state, actors, now, geo).get('b')!.destination!;
    actors[1]!.contact!.visible = false;
    expect(stepLiveFireteam(state, actors, 2550, geo).get('b')?.holdPosition).toBe(true);
    expect(stepLiveFireteam(state, actors, 2750, geo).get('b')?.holdPosition).toBe(true);
    actors[1]!.contact = { targetId: 'second', point: { x: 15, y: 10 }, seenAt: 3000, visible: true };
    expect(stepLiveFireteam(state, actors, 3000, geo).get('b')).toMatchObject({ holdPosition: true, targetId: 'second' });
  });
});
