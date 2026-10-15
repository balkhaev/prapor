import { expect, test } from 'bun:test';
import type { LiveStatus } from '../src/game/live';
import { METROPOLIS_CITY, metropolisStreetPlan } from '../src/game/world-metropolis-plan';
import { cityStreetPlan } from '../src/game/world-landscape';
import { raidEntryMap, raidEntryStreets } from '../src/raid-entry-ui';

test('metropolis preparation diagram preserves actual outer and central street metadata', () => {
  const streets = raidEntryStreets(METROPOLIS_CITY), outer = metropolisStreetPlan();
  expect(streets.slice(0, outer.length)).toEqual(outer);
  const center = { ...METROPOLIS_CITY, x: 368, y: 368, width: 288, height: 288, quarters: METROPOLIS_CITY.quarters.slice(0, 4) };
  expect(streets.slice(outer.length)).toEqual(cityStreetPlan(center));
  expect(streets.find(street => street.id === 'city-street-x-512')?.points).toEqual([{ x: 512, y: 368 }, { x: 512, y: 655 }]);
  const legacy = { ...center, x: 112, y: 112 };
  expect(raidEntryStreets(legacy)).toEqual(cityStreetPlan(legacy));
});

test('large public diagram has a fixed roof budget and readable named quarters instead of thousands of SVG roofs', () => {
  const server: LiveStatus = { id: 'entry', name: 'Периметр', online: 0, capacity: 32, startedAt: 0, districts: [],
    maps: [{ id: 'perimeter', name: 'Периметр', description: '', width: 1024, height: 1024, city: METROPOLIS_CITY, theme: 'mixed', online: 0, npcs: 0 }] };
  const before = structuredClone(server), html = raidEntryMap(server, 'customs', false);
  const roofs = [...html.matchAll(/data-entry-roof/g)];
  expect(roofs.length).toBeGreaterThan(100); expect(roofs.length).toBeLessThanOrEqual(600);
  expect([...html.matchAll(/<(?:rect|path|text|tspan|g)\b/g)].length).toBeLessThan(3000);
  expect(html.length).toBeLessThan(800000);
  for (const quarter of METROPOLIS_CITY.quarters) expect(html).toContain(`<title>${quarter.name}</title>`);
  expect(html).toContain('font-size:16.8px'); expect(html).toContain('viewBox="0 0 1024 1024"');
  expect(html).not.toContain('NaN'); expect(html).not.toContain('Infinity'); expect(server).toEqual(before);
});
