import { expect, test } from 'bun:test';
import { createLiveCombatPreviewSnapshot, createLiveCombatPreviewWorld, LIVE_COMBAT_PREVIEW_DURATION_MS, LIVE_COMBAT_PREVIEW_STEP_MS } from '../src/live-combat-preview';
import { isConfirmedPixelShot, PixelCombatAnimation } from '../src/pixel-animation';
import { createLiveNavigation } from '../server/live-navigation';

test('the local encounter can be replayed and sought without changing its world or sharing player data', () => {
  const world = createLiveCombatPreviewWorld(), original = structuredClone(world);
  const first = createLiveCombatPreviewSnapshot(world, 2375), sought = createLiveCombatPreviewSnapshot(world, 2375);
  expect(sought).toEqual(first);
  expect(first.self.id).toBe('contact-blue'); expect(first.self.gameId).toBeUndefined();
  expect(first.entities).toHaveLength(2); expect(first.entities.map(entity => entity.visualLoadout?.weaponId)).toEqual(['akm', 'm4a1']);
  expect(first.events.some(event => event.impact === 'armor')).toBe(true); expect(first.events.some(event => event.impact === 'body')).toBe(true);
  expect(first.world.citySites?.[0]?.buildings[0]?.floors).toBe(4);
  expect(first.world.containers).toEqual([]); expect(first.drops).toEqual([]);
  expect(createLiveCombatPreviewSnapshot(world, NaN)).toEqual(createLiveCombatPreviewSnapshot(world));
  expect(world).toEqual(original);
});

test('looped confirmed shots remain distinct, bounded and coordinated with exposed firing postures', () => {
  const world = createLiveCombatPreviewWorld(), effects = new PixelCombatAnimation(), shots = new Set<string>(), stances = new Set<string>();
  const navigation = createLiveNavigation(world);
  let version = '';
  for (let at = 0; at <= LIVE_COMBAT_PREVIEW_DURATION_MS * 2; at += LIVE_COMBAT_PREVIEW_STEP_MS) {
    const snapshot = createLiveCombatPreviewSnapshot(world, at);
    version ||= snapshot.worldVersion; expect(snapshot.worldVersion).toBe(version);
    effects.update(snapshot.events, snapshot.now, at);
    for (const entity of snapshot.entities) {
      stances.add(entity.combatStance!);
      expect(world.obstacles.some(obstacle => entity.x >= obstacle.x && entity.x < obstacle.x + obstacle.width && entity.y >= obstacle.y && entity.y < obstacle.y + obstacle.height)).toBe(false);
    }
    for (const event of snapshot.events) {
      expect(isConfirmedPixelShot(event)).toBe(true); expect(snapshot.now - event.at).toBeLessThan(850);
      expect(navigation.hasLineOfSight(event.from!, event.to!)).toBe(true);
      shots.add(event.id);
      if (event.at === snapshot.now) expect(snapshot.entities.find(entity => entity.id === event.actorId)?.combatStance).toBe('peeking');
    }
    expect(effects.active(at).length).toBeLessThanOrEqual(6);
  }
  expect(shots.size).toBe(30); expect(stances).toEqual(new Set(['seeking-cover', 'covered', 'peeking']));
});
