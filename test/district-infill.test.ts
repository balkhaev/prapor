// Historical frontage fixtures protect the G9 core embedded by the metropolis generator.
import { expect, test } from 'bun:test';
import { generatePerimeterCore } from '../src/game/world-generation';
import { cityStreetPlan, regionalStreetPlan } from '../src/game/world-landscape';
import { readLiveWorld } from '../src/live-client';
import { sceneBuildings } from '../src/live-map-art';

test('regional settlements have usable frontage density while closed houses preserve the public geometry contract', () => {
  const world = generatePerimeterCore(), decoded = readLiveWorld(world), buildings = sceneBuildings(decoded);
  const infill = world.obstacles.filter(obstacle => /^(Жилой дом|Дом лесных рабочих|Угловая лавка|Служебная мастерская|Ремонтный бокс) · /.test(obstacle.label ?? ''));
  expect(infill.length).toBeGreaterThanOrEqual(32); expect(infill.length).toBeLessThanOrEqual(64);
  for (const district of world.districts) expect(infill.filter(house => house.x >= district.x && house.y >= district.y && house.x + house.width <= district.x + district.width && house.y + house.height <= district.y + district.height).length).toBeGreaterThanOrEqual(6);
  const streets = [...cityStreetPlan(world.city!), ...regionalStreetPlan(world.width, world.height, world.city!)];
  const overlaps = (a: typeof infill[number], b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  for (const house of infill) {
    expect(world.pois.some(poi => overlaps(house, poi))).toBe(false);
    expect(overlaps(house, world.city!)).toBe(false);
    for (let y = house.y; y < house.y + house.height; y++) for (let x = house.x; x < house.x + house.width; x++) expect(['r', 'w', 't'].includes(world.terrainRows![y]![x]!)).toBe(false);
    const center = { x: house.x + house.width / 2, y: house.y + house.height / 2 };
    const distance = Math.min(...streets.flatMap(street => street.points.slice(1).map((b, index) => {
      const a = street.points[index]!, dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((center.x - a.x) * dx + (center.y - a.y) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(center.x - a.x - dx * t, center.y - a.y - dy * t);
    })));
    expect(distance).toBeLessThanOrEqual(29);
    const visual = buildings.find(building => building.x === house.x && building.y === house.y && building.width === house.width && building.height === house.height)!;
    expect(visual).toBeDefined(); expect(visual.entrances).toHaveLength(0); expect(visual.floors).toBe(1);
    expect(visual.kind).toBe(/^(Служебная мастерская|Ремонтный бокс)/.test(house.label!) ? 'workshop' : /^Угловая лавка/.test(house.label!) ? 'shop' : 'apartment');
  }
});
