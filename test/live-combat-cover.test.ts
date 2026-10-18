import { describe, expect, test } from 'bun:test';
import { findLiveCombatCover, LIVE_COVER_SEARCH_STEPS } from '../server/live-combat-cover';
import { createLiveNavigation } from '../server/live-navigation';
import type { LivePoint, LiveWorld } from '../src/game/live';

const wall = { x: 6, y: 3, width: 2, height: 3, kind: 'building' };
function geometry(obstacles = [wall]) {
  return createLiveNavigation({ width: 18, height: 14, obstacles } as LiveWorld);
}
describe('physical combat cover', () => {
  test('walks a bounded legal route behind a solid wall and leaves one legal firing step', () => {
    const nav = geometry(), start = { x: 5, y: 2 }, threat = { x: 10, y: 2 };
    expect(nav.hasLineOfSight(start, threat)).toBe(true);
    const cover = findLiveCombatCover(start, threat, 7, { clear: nav.walkable, hasLineOfSight: nav.hasLineOfSight })!;
    expect(cover).not.toBeNull();
    expect(cover.route.length).toBeGreaterThan(0);
    expect(cover.route.length).toBeLessThanOrEqual(LIVE_COVER_SEARCH_STEPS);
    let previous = start;
    for (const step of cover.route) {
      expect(nav.walkable(step)).toBe(true);
      expect(Math.abs(step.x - previous.x) + Math.abs(step.y - previous.y)).toBe(1);
      previous = step;
    }
    expect(previous).toEqual(cover.covered);
    expect(nav.hasLineOfSight(cover.covered, threat)).toBe(false);
    expect(nav.hasLineOfSight(cover.peek, threat)).toBe(true);
    expect(Math.abs(cover.peek.x - cover.covered.x) + Math.abs(cover.peek.y - cover.covered.y)).toBe(1);
    expect(findLiveCombatCover(start, threat, 7, { clear: nav.walkable, hasLineOfSight: nav.hasLineOfSight })).toEqual(cover);
  });

  test('open ground, transparent water and point-blank contacts cannot produce imaginary cover', () => {
    for (const obstacles of [[], [{ ...wall, kind: 'water' }]]) {
      const nav = geometry(obstacles);
      expect(findLiveCombatCover({ x: 5, y: 2 }, { x: 10, y: 2 }, 7, { clear: nav.walkable, hasLineOfSight: nav.hasLineOfSight })).toBeNull();
    }
    const nav = geometry();
    expect(findLiveCombatCover({ x: 5, y: 2 }, { x: 6, y: 2 }, 7, { clear: nav.walkable, hasLineOfSight: nav.hasLineOfSight })).toBeNull();
  });

  test('occupied and forbidden tiles never enter the cover route or firing position', () => {
    const nav = geometry(), permitted = (point: LivePoint) => point.y <= 2;
    expect(findLiveCombatCover({ x: 5, y: 2 }, { x: 10, y: 2 }, 7, { clear: nav.walkable, hasLineOfSight: nav.hasLineOfSight, permitted })).toBeNull();
    const occupied = new Set(['5,3', '5,4', '4,3', '4,4']);
    const clear = (point: LivePoint) => nav.walkable(point) && !occupied.has(`${point.x},${point.y}`);
    const cover = findLiveCombatCover({ x: 5, y: 2 }, { x: 10, y: 2 }, 7, { clear, hasLineOfSight: nav.hasLineOfSight });
    for (const point of cover ? [...cover.route, cover.covered, cover.peek] : []) expect(clear(point)).toBe(true);
  });
  test('prefers contact with a real barrier over its distant shadow and changes a compromised corner', () => {
    const nav = geometry([{ x: 9, y: 9, width: 1, height: 2, kind: 'container' }, { x: 9, y: 5, width: 1, height: 2, kind: 'container' }]);
    const threat = { x: 14, y: 8 }, options = { clear: nav.walkable, hasLineOfSight: nav.hasLineOfSight, solid: nav.blocksSight };
    const first = findLiveCombatCover({ x: 6, y: 9 }, threat, 12, options)!;
    expect(first).not.toBeNull();
    expect([{ x: first.covered.x - 1, y: first.covered.y }, { x: first.covered.x + 1, y: first.covered.y }, { x: first.covered.x, y: first.covered.y - 1 }, { x: first.covered.x, y: first.covered.y + 1 }].some(nav.blocksSight)).toBe(true);
    const second = findLiveCombatCover(first.covered, threat, 12, { ...options, avoid: [first.covered] });
    expect(second).not.toBeNull(); expect(second!.covered).not.toEqual(first.covered);
    expect(nav.hasLineOfSight(second!.covered, threat)).toBe(false); expect(nav.hasLineOfSight(second!.peek, threat)).toBe(true);
  });
});
