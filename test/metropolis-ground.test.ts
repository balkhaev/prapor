import { expect, test } from 'bun:test';
import { LIVE_MAPS } from '../src/game/live-maps';
import { inMetropolisCore, metropolisStreetPlan } from '../src/game/world-metropolis-plan';

test('organic ground preserves continuous asphalt and never places a house on the river or a carriageway', () => {
  const world = LIVE_MAPS[0]!;
  for (const street of metropolisStreetPlan()) for (let i = 1; i < street.points.length; i++) {
    const a = street.points[i - 1]!, b = street.points[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let n = 0; n <= steps; n++) {
      const x = Math.round(a.x + (b.x - a.x) * n / steps), y = Math.round(a.y + (b.y - a.y) * n / steps);
      if (!inMetropolisCore(x, y)) expect(world.terrainRows![y]![x]).toBe('r');
    }
  }
  for (const site of world.citySites!) {
    if (inMetropolisCore(site.x, site.y)) continue;
    for (const building of site.buildings) for (let y = building.y; y < building.y + building.height; y++) {
      const floor = world.terrainRows![y]!.slice(building.x, building.x + building.width);
      expect(floor).not.toMatch(/[rw]/);
    }
  }
});

test('outer greenery occupies varied positions and shares the same bounded navigation envelope', () => {
  const world = LIVE_MAPS[0]!, green = world.props!.filter(prop => ['tree', 'shrub'].includes(prop.kind) && !inMetropolisCore(prop.x, prop.y));
  expect(green.length).toBeGreaterThan(1500);
  expect(new Set(green.map(prop => prop.x % 1)).size).toBeGreaterThan(2);
  expect(new Set(green.map(prop => prop.y % 1)).size).toBeGreaterThan(2);
  for (const prop of green) {
    expect(prop.blocking).toBe(false);
    expect(prop.x).toBeGreaterThanOrEqual(0);
    expect(prop.y).toBeGreaterThanOrEqual(0);
    expect(prop.x + prop.width).toBeLessThanOrEqual(world.width);
    expect(prop.y + prop.height).toBeLessThanOrEqual(world.height);
    expect(world.terrainRows![Math.floor(prop.y)]![Math.floor(prop.x)]!).not.toMatch(/[rw]/);
  }
});
