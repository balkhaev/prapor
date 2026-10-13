import { describe, expect, test } from 'bun:test';
import { getLiveMap, hasLiveLineOfSight, isLiveMapId, isLiveWalkable, LIVE_MAPS } from '../src/game/live-maps';
import type { LivePoint, LiveWorld } from '../src/game/live';

function connectedCells(world: LiveWorld, start: LivePoint): Set<string> {
  const key = ({ x, y }: LivePoint) => `${x},${y}`;
  const queue = [start], visited = new Set([key(start)]);
  for (let index = 0; index < queue.length; index++) {
    const { x, y } = queue[index]!;
    for (const next of [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]) {
      if (!isLiveWalkable(world, next) || visited.has(key(next))) continue;
      visited.add(key(next)); queue.push(next);
    }
  }
  return visited;
}

describe('authored live PvPvE maps', () => {
  test('three distinct shared maps have complete metadata and bounded terrain and cover', () => {
    expect(LIVE_MAPS.map(map => map.id).sort()).toEqual(['customs', 'depot', 'sawmill']);
    expect(new Set(LIVE_MAPS.map(map => map.theme)).size).toBe(3);
    expect(isLiveMapId('client-map')).toBe(false);
    for (const map of LIVE_MAPS) {
      expect(getLiveMap(map.id)).toBe(map); expect(isLiveMapId(map.id)).toBe(true);
      expect(map.name.length).toBeGreaterThan(0); expect(map.description.length).toBeGreaterThan(30);
      expect(map.width).toBeGreaterThanOrEqual(40); expect(map.height).toBeGreaterThanOrEqual(32);
      expect(map.obstacles.length).toBeGreaterThanOrEqual(20); expect(map.zones.length).toBeGreaterThanOrEqual(5);
      for (const area of [...map.obstacles, ...map.zones]) {
        expect(Number.isInteger(area.x) && Number.isInteger(area.y)).toBe(true);
        expect(area.x).toBeGreaterThanOrEqual(0); expect(area.y).toBeGreaterThanOrEqual(0);
        expect(area.width).toBeGreaterThan(0); expect(area.height).toBeGreaterThan(0);
        expect(area.x + area.width).toBeLessThanOrEqual(map.width); expect(area.y + area.height).toBeLessThanOrEqual(map.height);
      }
      expect(map.zones.some(zone => zone.danger === 3)).toBe(true);
      expect(map.obstacles.some(obstacle => obstacle.kind === 'wall')).toBe(true);
    }
  });

  test('every walkable tile, open interior, exit, NPC route and loot point connects to an extraction route', () => {
    for (const map of LIVE_MAPS) {
      expect(map.extracts.length).toBeGreaterThanOrEqual(2);
      const connected = connectedCells(map, map.extracts[0]!);
      for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
        const point = { x, y };
        if (isLiveWalkable(map, point)) expect(connected.has(`${x},${y}`)).toBe(true);
      }
      const points = [...map.extracts, ...map.lootSpawns, ...map.npcSpawns.flatMap(spawn => [spawn.point, ...spawn.route])];
      for (const point of points) {
        expect(isLiveWalkable(map, point)).toBe(true);
        expect(connected.has(`${point.x},${point.y}`)).toBe(true);
      }
      expect(map.lootSpawns.length).toBeGreaterThanOrEqual(10);
      expect(map.npcSpawns.length).toBeGreaterThanOrEqual(12);
      expect(new Set(map.npcSpawns.map(spawn => spawn.faction))).toEqual(new Set(['scavs', 'raiders']));
      expect(new Set(map.npcSpawns.map(spawn => spawn.role))).toEqual(new Set(['guard', 'patrol', 'marksman']));
      expect(new Set(map.npcSpawns.map(spawn => `${spawn.point.x},${spawn.point.y}`)).size).toBe(map.npcSpawns.length);
      for (const spawn of map.npcSpawns) {
        expect(spawn.route.length).toBeGreaterThanOrEqual(3);
        expect(map.extracts.every(exit => Math.hypot(spawn.point.x - exit.x, spawn.point.y - exit.y) > 7)).toBe(true);
      }
    }
  });

  test('cover blocks both straight shots and diagonal corner cutting while open streets permit reciprocal fire', () => {
    const map = getLiveMap('customs');
    for (const [first, second, expected] of [
      [{ x: 6, y: 5 }, { x: 11, y: 5 }, false],
      [{ x: 6, y: 4 }, { x: 7, y: 3 }, false],
      [{ x: 0, y: 0 }, { x: 6, y: 0 }, true],
      [{ x: 0, y: 0 }, { x: 5, y: 5 }, true],
    ] as const) {
      expect(hasLiveLineOfSight(map, first, second)).toBe(expected);
      expect(hasLiveLineOfSight(map, second, first)).toBe(expected);
    }
    expect(hasLiveLineOfSight(map, { x: -1, y: 0 }, { x: 1, y: 0 })).toBe(false);
    expect(hasLiveLineOfSight(map, { x: 0.5, y: 0 }, { x: 1, y: 0 })).toBe(false);
    expect(hasLiveLineOfSight(map, { x: 7, y: 4 }, { x: 1, y: 0 })).toBe(false);
  });
});
