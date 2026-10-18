import { expect, test } from 'bun:test';
import { createLiveCombatPreviewSnapshot, createLiveCombatPreviewWorld, LIVE_COMBAT_PREVIEW_DURATION_MS, LIVE_COMBAT_PREVIEW_STEP_MS } from '../src/live-combat-preview';
import { isConfirmedPixelShot, PixelCombatAnimation } from '../src/pixel-animation';
import { createLiveNavigation } from '../server/live-navigation';
import { traceLiveBulletImpact } from '../src/game/live-ballistics';

test('the finite encounter can be sought without mutating its world, sharing player data or retaining arbitrary timestamps', () => {
  const world = createLiveCombatPreviewWorld(), original = structuredClone(world);
  const first = createLiveCombatPreviewSnapshot(world, 2375), sought = createLiveCombatPreviewSnapshot(world, 2375);
  expect(sought).toEqual(first);
  expect(first.self.id).toBe('contact-blue'); expect(first.self.gameId).toBeUndefined();
  expect(first.entities).toHaveLength(2); expect(first.entities.map(entity => entity.visualLoadout?.weaponId)).toEqual(['akm', 'm4a1']);
  expect(first.world.containers).toEqual([]); expect(first.drops).toEqual([]);
  expect(createLiveCombatPreviewSnapshot(world, NaN)).toEqual(createLiveCombatPreviewSnapshot(world));
  expect(createLiveCombatPreviewSnapshot(world, Number.MAX_SAFE_INTEGER)).toEqual(createLiveCombatPreviewSnapshot(world, LIVE_COMBAT_PREVIEW_DURATION_MS));
  // Returned snapshots are independently owned: UI inspection must not edit
  // another frame or the cached replay by retaining a mutable actor reference.
  first.entities[0]!.health = 1; first.events.length = 0;
  expect(createLiveCombatPreviewSnapshot(world, 2375)).toEqual(sought);
  expect(world).toEqual(original);
});

test('every projectile has a stationary living shooter, a clear target ray and a collision-clipped physical impact', () => {
  const world = createLiveCombatPreviewWorld(), effects = new PixelCombatAnimation(), shots = new Map<string, number>();
  const navigation = createLiveNavigation(world), impacts = new Set<string>();
  let previous = createLiveCombatPreviewSnapshot(world), previousAt = 0;
  for (let at = 0; at <= LIVE_COMBAT_PREVIEW_DURATION_MS; at += LIVE_COMBAT_PREVIEW_STEP_MS) {
    const snapshot = createLiveCombatPreviewSnapshot(world, at);
    expect(snapshot.worldVersion).toBe(previous.worldVersion);
    effects.update(snapshot.events, snapshot.now, at);
    for (const entity of snapshot.entities) {
      expect(navigation.walkable(entity)).toBe(true);
      const before = previous.entities.find(actor => actor.id === entity.id)!;
      expect(Math.abs(entity.x - before.x) + Math.abs(entity.y - before.y)).toBeLessThanOrEqual(1);
      expect(entity.health).toBeLessThanOrEqual(before.health);
      if (before.health <= 0) expect(entity).toMatchObject({ x: before.x, y: before.y, health: 0, action: 'downed' });
    }
    for (const event of snapshot.events) {
      expect(isConfirmedPixelShot(event)).toBe(true); expect(snapshot.now - event.at).toBeLessThan(850);
      expect(navigation.hasLineOfSight(event.from!, event.to!)).toBe(true);
      const impact = event.impactPoint!;
      expect(Number.isFinite(impact.x) && Number.isFinite(impact.y)).toBe(true);
      // Tracing to the terminal point cannot find an earlier obstacle.
      const clipped = traceLiveBulletImpact(world, event.from!, impact).impactPoint;
      expect(clipped.x).toBeCloseTo(impact.x, 5); expect(clipped.y).toBeCloseTo(impact.y, 5);
      if (event.impact === 'ground' || event.impact === 'wood' || event.impact === 'metal' || event.impact === 'masonry') {
        expect(event.damage).toBe(0); expect(impact).not.toEqual(event.to);
      }
      if (event.at === snapshot.now) {
        const shooter = snapshot.entities.find(entity => entity.id === event.actorId)!;
        expect(shooter.health).toBeGreaterThan(0); expect(shooter.action).toBe('combat'); expect(shooter.combatBehavior).toBe('firing');
        const planted = createLiveCombatPreviewSnapshot(world, at - 375).entities.find(entity => entity.id === event.actorId)!;
        expect({ x: shooter.x, y: shooter.y }).toEqual({ x: planted.x, y: planted.y });
      }
      shots.set(event.id, event.at); impacts.add(event.impact!);
    }
    expect(effects.active(at).length).toBeLessThanOrEqual(8);
    previous = snapshot; previousAt = at;
  }
  expect(previousAt).toBe(LIVE_COMBAT_PREVIEW_DURATION_MS);
  expect(shots.size).toBeGreaterThan(5); expect(shots.size).toBeLessThan(80);
  expect(impacts.has('body')).toBe(true); expect(impacts.has('ground')).toBe(true);
});

test('the two fighters acquire, react and relocate independently, with genuine damage and pauses between bursts', () => {
  const world = createLiveCombatPreviewWorld(), behaviors = new Set<string>(), positions = [new Set<string>(), new Set<string>()];
  const shots = new Map<string, { at: number; actor: string }>();
  let independent = 0, reactive = 0, damaged = false;
  for (let at = 0; at <= LIVE_COMBAT_PREVIEW_DURATION_MS; at += LIVE_COMBAT_PREVIEW_STEP_MS) {
    const snapshot = createLiveCombatPreviewSnapshot(world, at), [blue, red] = snapshot.entities;
    if (blue!.combatStance !== red!.combatStance || blue!.combatBehavior !== red!.combatBehavior) independent++;
    if (snapshot.entities.some(entity => entity.combatBehavior === 'suppressed') && snapshot.events.length) reactive++;
    snapshot.entities.forEach((entity, index) => { positions[index]!.add(`${entity.x},${entity.y}`); if (entity.combatBehavior) behaviors.add(entity.combatBehavior); damaged ||= entity.health < 100; });
    for (const event of snapshot.events) shots.set(event.id, { at: event.at, actor: event.actorId! });
  }
  expect(independent).toBeGreaterThan(20); expect(reactive).toBeGreaterThan(0); expect(damaged).toBe(true);
  expect(behaviors).toEqual(new Set(['recovering', 'acquiring', 'firing', 'suppressed', 'relocating', 'reloading']));
  expect(Math.max(...positions.map(points => points.size))).toBeGreaterThan(4);
  for (const id of ['contact-blue', 'contact-red']) {
    const times = [...shots.values()].filter(shot => shot.actor === id).map(shot => shot.at).sort((a, b) => a - b);
    expect(times.length).toBeGreaterThan(1);
    const gaps = times.slice(1).map((at, index) => at - times[index]!);
    expect(gaps.some(gap => gap >= 1500)).toBe(true);
  }
  const end = createLiveCombatPreviewSnapshot(world, LIVE_COMBAT_PREVIEW_DURATION_MS);
  expect(end.entities.some(entity => entity.health <= 0) || end.entities.some(entity => entity.x >= 18 && entity.y >= 13)).toBe(true);
});
