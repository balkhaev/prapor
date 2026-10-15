// These fixtures protect the preserved G9 city core; full G10 coverage is in world-metropolis tests.
import { expect, test } from 'bun:test';
import { generatePerimeterCore, validateGeneratedWorld } from '../src/game/world-generation';

type Rect = { x: number; y: number; width: number; height: number };
const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('dense city addresses preserve loot identities and distinguish the four neighbourhoods', () => {
  const world = generatePerimeterCore(), sites = world.citySites!, buildings = sites.flatMap(site => site.buildings);
  expect(sites).toHaveLength(24);
  expect(buildings.length).toBeGreaterThanOrEqual(150);
  for (const site of sites) {
    expect(site.buildings.length).toBeGreaterThanOrEqual(6);
    expect(site.buildings.length).toBeLessThanOrEqual(12);
    expect(site.passages.length).toBeLessThanOrEqual(4);
    expect(world.containers.filter(anchor => anchor.poiId === site.id).map(anchor => anchor.id)).toEqual([`${site.id}-slot-0`, `${site.id}-slot-1`, `${site.id}-slot-2`]);
    // Density is real navigable houses, with room for gardens and usable alleys.
    for (const building of site.buildings) {
      expect(building.x - site.x).toBeGreaterThanOrEqual(3);
      expect(building.y - site.y).toBeGreaterThanOrEqual(3);
      expect(site.x + site.width - building.x - building.width).toBeGreaterThanOrEqual(3);
      expect(site.y + site.height - building.y - building.height).toBeGreaterThanOrEqual(3);
    }
    for (const [index, building] of site.buildings.entries()) for (const other of site.buildings.slice(index + 1)) {
      const alley = Math.max(other.x - building.x - building.width, building.x - other.x - other.width,
        other.y - building.y - building.height, building.y - other.y - other.height);
      expect(alley).toBeGreaterThanOrEqual(4);
    }
  }
  const quarterBuildings = (id: string) => sites.filter(site => site.quarterId === id).flatMap(site => site.buildings);
  const center = quarterBuildings('old-center'), factory = quarterBuildings('industrial'), station = quarterBuildings('station'), south = quarterBuildings('residential');
  for (const quarter of [center, factory, station, south]) expect(quarter.length).toBeGreaterThanOrEqual(40);
  expect(center.every(building => building.roof === 'gable' && building.floors! <= 2 && ['brick', 'plaster'].includes(building.facade!))).toBe(true);
  expect(factory.every(building => ['workshop', 'garage', 'service'].includes(building.kind))).toBe(true);
  expect(factory.some(building => building.roof === 'sawtooth')).toBe(true);
  expect(station.some(building => building.kind === 'garage' && building.facade === 'metal')).toBe(true);
  expect(station.some(building => building.kind === 'service')).toBe(true);
  expect(south.some(building => building.kind === 'apartment' && building.floors === 3 && building.facade === 'panel')).toBe(true);
  expect(south.some(building => building.kind === 'apartment' && building.floors === 1 && building.roof === 'gable')).toBe(true);
  expect(buildings.length).toBeLessThanOrEqual(220);
  for (const building of buildings) { expect(building.width).toBeGreaterThanOrEqual(8); expect(building.height).toBeGreaterThanOrEqual(8); expect(building.floors).toBeLessThanOrEqual(3); expect(building.roofAxis).toBe(building.width >= building.height ? 'x' : 'y'); if (building.floors! >= 2) expect(building.width * building.height).toBeGreaterThanOrEqual(120); }
  expect(new Set(buildings.map(building => `${building.width}:${building.height}`)).size).toBeGreaterThanOrEqual(10);
  expect(buildings.some(building => building.entrances[0]!.x === building.entrances[1]!.x)).toBe(true);
  expect(buildings.some(building => building.entrances[0]!.y === building.entrances[1]!.y)).toBe(true);
});

test('representative seeds keep authored architecture separate from landmarks and every room reachable', () => {
  for (const seed of [0, 9, 99]) {
    const world = generatePerimeterCore(`architecture-${seed}`), buildings = world.citySites!.flatMap(site => site.buildings);
    const landmarks = world.pois.filter(poi => poi.tags.includes('city') && !poi.tags.includes('city-site'));
    const solid = world.obstacles.filter(obstacle => obstacle.kind === 'building');
    expect(buildings.length).toBeGreaterThanOrEqual(150);
    for (let first = 0; first < buildings.length; first++) {
      const building = buildings[first]!;
      expect(buildings.slice(first + 1).some(other => intersects(building, other))).toBe(false);
      expect(landmarks.some(landmark => intersects(building, landmark))).toBe(false);
      expect(solid.some(obstacle => intersects(building, obstacle))).toBe(false);
    }
    // The production validator floods every free cell, including both doors of
    // every new room, and rejects sealed interiors or unreachable loot anchors.
    expect(validateGeneratedWorld(world).containers).toBe(376);
  }
}, 60_000);
