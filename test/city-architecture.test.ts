import { expect, test } from 'bun:test';
import { generateLiveWorld, validateGeneratedWorld } from '../src/game/world-generation';

type Rect = { x: number; y: number; width: number; height: number };
const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('dense city addresses preserve loot identities and distinguish the four neighbourhoods', () => {
  const world = generateLiveWorld(), sites = world.citySites!, buildings = sites.flatMap(site => site.buildings);
  expect(sites).toHaveLength(24);
  expect(buildings.length).toBeGreaterThanOrEqual(90);
  for (const site of sites) expect(world.containers.filter(anchor => anchor.poiId === site.id).map(anchor => anchor.id)).toEqual([`${site.id}-slot-0`, `${site.id}-slot-1`, `${site.id}-slot-2`]);
  const quarterBuildings = (id: string) => sites.filter(site => site.quarterId === id).flatMap(site => site.buildings);
  const center = quarterBuildings('old-center'), factory = quarterBuildings('industrial'), station = quarterBuildings('station'), south = quarterBuildings('residential');
  expect(center.every(building => building.roof === 'gable' && building.floors! >= 2 && ['brick', 'plaster'].includes(building.facade!))).toBe(true);
  expect(factory.every(building => ['workshop', 'garage', 'service'].includes(building.kind))).toBe(true);
  expect(factory.some(building => building.roof === 'sawtooth')).toBe(true);
  expect(station.some(building => building.kind === 'garage' && building.facade === 'metal')).toBe(true);
  expect(station.some(building => building.kind === 'service')).toBe(true);
  expect(south.some(building => building.kind === 'apartment' && building.floors === 4 && building.facade === 'panel')).toBe(true);
  expect(south.some(building => building.kind === 'apartment' && building.floors === 2 && building.roof === 'gable')).toBe(true);
  expect(new Set(buildings.map(building => `${building.width}:${building.height}`)).size).toBeGreaterThanOrEqual(10);
  expect(buildings.some(building => building.entrances[0]!.x === building.entrances[1]!.x)).toBe(true);
  expect(buildings.some(building => building.entrances[0]!.y === building.entrances[1]!.y)).toBe(true);
});

test('one hundred seeds keep denser architecture separate from landmarks and every room reachable', () => {
  for (let seed = 0; seed < 100; seed++) {
    const world = generateLiveWorld(`architecture-${seed}`), buildings = world.citySites!.flatMap(site => site.buildings);
    const landmarks = world.pois.filter(poi => poi.tags.includes('city') && !poi.tags.includes('city-site'));
    const solid = world.obstacles.filter(obstacle => obstacle.kind === 'building');
    expect(buildings.length).toBeGreaterThanOrEqual(90);
    for (let first = 0; first < buildings.length; first++) {
      const building = buildings[first]!;
      expect(buildings.slice(first + 1).some(other => intersects(building, other))).toBe(false);
      expect(landmarks.some(landmark => intersects(building, landmark))).toBe(false);
      expect(solid.some(obstacle => intersects(building, obstacle))).toBe(false);
    }
    // The production validator floods every free cell, including both doors of
    // every new room, and rejects sealed interiors or unreachable loot anchors.
    expect(validateGeneratedWorld(world).containers).toBe(264);
  }
}, 60_000);
