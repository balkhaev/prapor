import { describe, expect, test } from 'bun:test';
import { getLiveMap, hasLiveLineOfSight, isLiveMapId, isLiveWalkable, LIVE_MAPS } from '../src/game/live-maps';
import type { LiveWorld } from '../src/game/live';
import { createLiveNavigation } from '../server/live-navigation';

describe('shared generated perimeter', () => {
  test('one persistent world contains four connected districts and thirty-six streaming chunks', () => {
    expect(LIVE_MAPS).toHaveLength(1);
    const world = getLiveMap('perimeter');
    expect(world).toBe(LIVE_MAPS[0]!); expect(isLiveMapId('perimeter')).toBe(true); expect(isLiveMapId('customs')).toBe(false);
    expect(world).toMatchObject({ width: 192, height: 192, chunkSize: 32, theme: 'mixed' });
    expect(world.width / world.chunkSize * world.height / world.chunkSize).toBe(36);
    expect(world.districts.map(district => district.id).sort()).toEqual(['customs', 'depot', 'sawmill', 'village']);
    expect(world.pois).toHaveLength(32);
    expect(world.containers).toHaveLength(128);
    expect(world.npcSpawns).toHaveLength(96);
    expect(new Set(world.containers.map(container => container.kind))).toEqual(new Set(['duffel', 'jacket', 'toolbox', 'medbag', 'cabinet', 'crate']));
    expect(world.containers.every(container => container.searchMs >= 2000 && container.searchMs <= 5000)).toBe(true);
    for (const district of world.districts) {
      expect(district.spawns.length).toBeGreaterThan(0);
      expect(district.spawns.every(point => isLiveWalkable(world, point))).toBe(true);
      expect(world.pois.some(poi => poi.districtId === district.id)).toBe(true);
    }
  });
  test('the server line of sight blocks straight walls and diagonal corner gaps', () => {
    const source = getLiveMap('perimeter');
    const world: LiveWorld = { ...source, width: 10, height: 10, obstacles: [{ x: 4, y: 4, width: 2, height: 2 }] };
    for (const [first, second, expected] of [[{ x: 3, y: 4 }, { x: 4, y: 3 }, false], [{ x: 3, y: 4 }, { x: 6, y: 4 }, false], [{ x: 1, y: 1 }, { x: 3, y: 3 }, true]] as const) {
      expect(hasLiveLineOfSight(world, first, second)).toBe(expected); expect(hasLiveLineOfSight(world, second, first)).toBe(expected);
    }
    expect(hasLiveLineOfSight(world, { x: -1, y: 0 }, { x: 1, y: 0 })).toBe(false);
    expect(hasLiveLineOfSight(world, { x: .5, y: 0 }, { x: 1, y: 0 })).toBe(false);
  });
  test('water blocks movement while remaining transparent to sight and shots', () => {
    const world: LiveWorld = { ...getLiveMap('perimeter'), width: 10, height: 10, obstacles: [{ x: 4, y: 0, width: 2, height: 10, kind: 'water' }] };
    const navigation = createLiveNavigation(world), near = { x: 3, y: 4 }, far = { x: 6, y: 4 };
    expect(isLiveWalkable(world, { x: 4, y: 4 })).toBe(false);
    expect(navigation.walkable({ x: 4, y: 4 })).toBe(false);
    expect(navigation.findPath(near, far)).toBeNull();
    expect(hasLiveLineOfSight(world, near, far)).toBe(true);
    expect(navigation.hasLineOfSight(near, far)).toBe(true);
    expect(navigation.hasLineOfSight(far, near)).toBe(true);
    world.obstacles.push({ x: 7, y: 4, width: 1, height: 1, kind: 'wall' });
    expect(hasLiveLineOfSight(world, near, { x: 8, y: 4 })).toBe(false);
    expect(createLiveNavigation(world).hasLineOfSight(near, { x: 8, y: 4 })).toBe(false);
  });
});
