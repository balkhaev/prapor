import { expect, test } from 'bun:test';
import { createLiveCombatPreviewSnapshot, createLiveCombatPreviewWorld, liveCombatPreviewComplete, LIVE_COMBAT_PREVIEW_DURATION_MS, LIVE_COMBAT_PREVIEW_STEP_MS } from '../src/live-combat-preview';
import { isConfirmedPixelShot, PixelCombatAnimation } from '../src/pixel-animation';
import { createLiveNavigation } from '../server/live-navigation';
import { traceLiveBulletImpact } from '../src/game/live-ballistics';
import { LIVE_FIRETEAM_SUPPORT_MS } from '../src/game/live-fireteam';
import type { LiveEvent, LivePoint } from '../src/game/live';

test('the finite encounter can be sought without mutating its world, sharing player data or retaining arbitrary timestamps', () => {
  const world = createLiveCombatPreviewWorld(), original = structuredClone(world);
  const first = createLiveCombatPreviewSnapshot(world, 2375), sought = createLiveCombatPreviewSnapshot(world, 2375);
  expect(sought).toEqual(first);
  expect(first.self.id).toBe('contact-blue'); expect(first.self.gameId).toBeUndefined();
  expect(first.entities).toHaveLength(4); expect(first.entities.map(entity => entity.visualLoadout?.weaponId)).toEqual(['akm', 'akm', 'm4a1', 'm4a1']);
  expect(first.entities.filter(entity => entity.kind === 'player').every(entity => !entity.npcSquad)).toBe(true);
  expect(new Set(first.entities.map(entity => entity.name)).size).toBe(4);
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
    expect(new Set(snapshot.entities.filter(entity => entity.health > 0).map(entity => `${entity.x},${entity.y}`)).size)
      .toBe(snapshot.entities.filter(entity => entity.health > 0).length);
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
        const dx = event.to!.x - event.from!.x, dy = event.to!.y - event.from!.y, length = dx * dx + dy * dy;
        for (const ally of previous.entities.filter(entity => entity.id !== shooter.id && entity.kind === shooter.kind && entity.health > 0)) {
          const t = ((ally.x - event.from!.x) * dx + (ally.y - event.from!.y) * dy) / length;
          if (t > 0 && t < 1) expect(Math.hypot(ally.x - event.from!.x - t * dx, ally.y - event.from!.y - t * dy)).toBeGreaterThanOrEqual(.55);
        }
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

test('both two-person groups acquire, react and relocate independently, with genuine damage and pauses between bursts', () => {
  const world = createLiveCombatPreviewWorld(), behaviors = new Set<string>(), positions = Array.from({ length: 4 }, () => new Set<string>());
  const shots = new Map<string, { at: number; actor: string }>();
  let independent = 0, reactive = 0, damaged = false;
  for (let at = 0; at <= LIVE_COMBAT_PREVIEW_DURATION_MS; at += LIVE_COMBAT_PREVIEW_STEP_MS) {
    const snapshot = createLiveCombatPreviewSnapshot(world, at), blue = snapshot.entities[0], red = snapshot.entities[2];
    if (blue!.combatStance !== red!.combatStance || blue!.combatBehavior !== red!.combatBehavior) independent++;
    if (snapshot.entities.some(entity => entity.combatBehavior === 'suppressed') && snapshot.events.length) reactive++;
    snapshot.entities.forEach((entity, index) => { positions[index]!.add(`${entity.x},${entity.y}`); if (entity.combatBehavior) behaviors.add(entity.combatBehavior); damaged ||= entity.health < 100; });
    for (const event of snapshot.events) shots.set(event.id, { at: event.at, actor: event.actorId! });
  }
  expect(independent).toBeGreaterThan(20); expect(reactive).toBeGreaterThan(0); expect(damaged).toBe(true);
  expect(behaviors).toEqual(new Set(['recovering', 'acquiring', 'firing', 'suppressed', 'relocating', 'reloading']));
  expect(Math.max(...positions.map(points => points.size))).toBeGreaterThan(4);
  for (const id of ['contact-blue', 'contact-blue-two', 'contact-red', 'contact-red-two']) {
    const times = [...shots.values()].filter(shot => shot.actor === id).map(shot => shot.at).sort((a, b) => a - b);
    expect(times.length).toBeGreaterThan(1);
    const gaps = times.slice(1).map((at, index) => at - times[index]!);
    if (times.length > 3) expect(gaps.some(gap => gap >= 1500)).toBe(true);
  }
  const end = createLiveCombatPreviewSnapshot(world, LIVE_COMBAT_PREVIEW_DURATION_MS);
  expect(liveCombatPreviewComplete(end, LIVE_COMBAT_PREVIEW_DURATION_MS)).toBe(true);
});

test('flanking follows actual covering shots and heavy incoming fire causes a real retreat', () => {
  const world = createLiveCombatPreviewWorld(), navigation = createLiveNavigation(world), shots = new Map<string, LiveEvent>();
  const roles = new Set<string>(), flankOrigins = new Map<string, LivePoint>();
  const flankPosts = new Map<string, { point: LivePoint; at: number; displacement: number }>();
  let previous = createLiveCombatPreviewSnapshot(world), flankSteps = 0, retreatSteps = 0, widestFlank = 0, shotsFromFlank = 0;
  for (let at = LIVE_COMBAT_PREVIEW_STEP_MS; at <= LIVE_COMBAT_PREVIEW_DURATION_MS; at += LIVE_COMBAT_PREVIEW_STEP_MS) {
    const snapshot = createLiveCombatPreviewSnapshot(world, at);
    for (const event of snapshot.events) {
      shots.set(event.id, event);
      const post = flankPosts.get(event.actorId!);
      if (event.at === snapshot.now && post && post.displacement >= 2.5 && snapshot.now - post.at >= 375
        && snapshot.now - post.at <= 6500 && event.from?.x === post.point.x && event.from?.y === post.point.y) shotsFromFlank++;
    }
    for (const entity of snapshot.entities) {
      const before = previous.entities.find(actor => actor.id === entity.id)!;
      if (entity.combatRole) roles.add(entity.combatRole);
      const moved = entity.x !== before.x || entity.y !== before.y;
      if (entity.combatRole === 'flanking' && moved) {
        const support = [...shots.values()].find(event => event.actorId !== entity.id && event.at < snapshot.now && snapshot.now - event.at <= LIVE_FIRETEAM_SUPPORT_MS
          && snapshot.entities.some(ally => ally.id === event.actorId && ally.kind === entity.kind && ally.health > 0 && ally.action !== 'moving'
            && navigation.hasLineOfSight(ally, event.to!)));
        expect(support).toBeDefined(); expect(entity.action).toBe('moving'); expect(entity.aimTargetId).toBeUndefined();
        if (!flankOrigins.has(entity.id) || before.combatRole !== 'flanking') flankOrigins.set(entity.id, { x: before.x, y: before.y });
        const origin = flankOrigins.get(entity.id)!;
        const displacement = Math.hypot(entity.x - origin.x, entity.y - origin.y);
        widestFlank = Math.max(widestFlank, displacement);
        flankPosts.set(entity.id, { point: { x: entity.x, y: entity.y }, at: snapshot.now, displacement });
        flankSteps++;
      }
      if (entity.combatRole === 'withdrawing' && moved) {
        const incoming = [...shots.values()].filter(event => event.targetId === entity.id && event.at <= snapshot.now
          && (entity.health <= 32 || snapshot.now - event.at <= 6500));
        expect(incoming.length).toBeGreaterThan(0);
        expect(entity.health < 60 || (entity.suppression ?? 0) >= .3).toBe(true);
        expect(entity.aimTargetId).toBeUndefined(); retreatSteps++;
      }
    }
    previous = snapshot;
  }
  expect(roles).toEqual(new Set(['covering', 'flanking', 'withdrawing', 'regrouping']));
  expect(flankSteps).toBeGreaterThanOrEqual(3); expect(widestFlank).toBeGreaterThanOrEqual(2.5);
  expect(shotsFromFlank).toBeGreaterThan(0);
  expect(retreatSteps).toBeGreaterThan(0);
});
