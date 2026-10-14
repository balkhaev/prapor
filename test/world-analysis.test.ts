import { expect, test } from 'bun:test';
import { analyseWorldPlan } from '../src/game/world-analysis';
import type { LiveWorld } from '../src/game/live';

function planningFixture(): LiveWorld {
  return { id: 'perimeter', name: 'Planning fixture', description: 'Static planning', theme: 'mixed', version: 'fixture', seed: 'fixture', generatorVersion: 3, chunkSize: 32, width: 7, height: 5,
    obstacles: [{ x: 3, y: 0, width: 1, height: 4, kind: 'water' }], terrainRows: ['gggwggg', 'gggwggg', 'gggwggg', 'gggwggg', 'ggggggg'], paths: [], zones: [],
    districts: [{ id: 'customs', name: 'Вход', description: 'Вход с западного берега', x: 0, y: 0, width: 7, height: 5, theme: 'industrial', spawns: [{ x: 0, y: 0 }] }],
    extracts: [{ x: 0, y: 0 }],
    pois: [
      { id: 'near', name: 'Дом', templateId: 'cabin', districtId: 'customs', x: 4, y: 0, width: 1, height: 1, danger: 1, tags: [], entrances: [{ x: 4, y: 0 }] },
      { id: 'core', name: 'Узел', templateId: 'depot', districtId: 'customs', x: 6, y: 0, width: 1, height: 1, danger: 3, tags: [], entrances: [{ x: 6, y: 0 }] },
    ],
    containers: [{ id: 'bag', poiId: 'near', x: 4, y: 0, kind: 'duffel', lootTable: 'mixed', searchMs: 3000 }],
    routes: [{ id: 'route', name: 'Вдоль берега', description: 'Дом, затем узел', districtId: 'customs', purpose: 'loot', poiIds: ['near', 'core'] }],
  };
}

test('authoring measurements include the real detour and the way back to an extraction', () => {
  const world = planningFixture(), previous = structuredClone(world);
  const plan = analyseWorldPlan(world);
  expect(plan.districts).toEqual([{ id: 'customs', places: 2, containers: 1, nearestLootSteps: 12, nearestContestedSteps: 14 }]);
  expect(plan.routes).toEqual([{ id: 'route', name: 'Вдоль берега', districtId: 'customs', purpose: 'loot', stops: ['Дом', 'Узел'], firstStopSteps: 12, walkSteps: 14, returnSteps: 14 }]);
  expect(world).toEqual(previous);
});

test('an unreachable route is rejected instead of reporting a distance through water', () => {
  const world = planningFixture(); world.obstacles[0]!.height = 5; world.terrainRows![4] = 'gggwggg';
  expect(() => analyseWorldPlan(world)).toThrow('Unreachable route stop');
});

test('planning accepts legacy worlds without recommendations and multiple entry points', () => {
  const world = planningFixture(); delete world.routes;
  world.districts[0]!.spawns.push({ x: 5, y: 0 });
  const plan = analyseWorldPlan(world);
  expect(plan.routes).toEqual([]); expect(plan.districts[0]!.nearestLootSteps).toBe(1); expect(plan.districts[0]!.nearestContestedSteps).toBe(1);
});

test('city planning reports real building coverage without counting overlapping footprint tiles twice', () => {
  const world = planningFixture();
  world.city = { name: 'Город', x: 1, y: 0, width: 6, height: 4, quarters: [
    { id: 'nw', name: 'Северо-запад', x: 1, y: 0, width: 3, height: 2 }, { id: 'ne', name: 'Северо-восток', x: 4, y: 0, width: 3, height: 2 },
    { id: 'sw', name: 'Юго-запад', x: 1, y: 2, width: 3, height: 2 }, { id: 'se', name: 'Юго-восток', x: 4, y: 2, width: 3, height: 2 },
  ] };
  world.obstacles.push({ x: 5, y: 1, width: 1, height: 3, kind: 'building' }, { x: 5, y: 2, width: 1, height: 1, kind: 'building' });
  const city = analyseWorldPlan(world).city!;
  expect(city).toMatchObject({ name: 'Город', places: 2, containers: 1, buildings: 2, buildingTiles: 3, areaTiles: 24,
    approaches: [{ districtId: 'customs', firstCityStopSteps: 12 }] });
  expect(city.quarters.map(quarter => quarter.buildingTiles)).toEqual([0, 1, 0, 2]);
  expect(city.quarters.reduce((sum, quarter) => sum + quarter.buildingTiles, 0)).toBe(city.buildingTiles);
});

test('courtyard planning counts shared open ground once and excludes actual cover', () => {
  const world = planningFixture();
  world.city = { name: 'Город', x: 0, y: 0, width: 7, height: 5, quarters: [{ id: 'quarter', name: 'Квартал', x: 0, y: 0, width: 7, height: 5 }] };
  world.obstacles.push({ x: 5, y: 1, width: 1, height: 1, kind: 'barricade' });
  world.citySites = [0, 1].map(index => ({ id: `court-${index}`, poiId: index ? 'core' : 'near', quarterId: 'quarter', name: 'Двор', kind: 'courtyard',
    x: 4, y: 0, width: 3, height: 4, courtyard: { x: 4, y: 0, width: 3, height: 3 },
    buildings: [{ id: `building-${index}`, name: 'Павильон', kind: 'shop', x: 4, y: 3, width: 3, height: 1, entrances: [{ x: 4, y: 3 }, { x: 6, y: 3 }] }],
    passages: [[{ x: 4, y: 0 }, { x: 4, y: 2 }], [{ x: 6, y: 0 }, { x: 6, y: 2 }]],
  }));
  const report = analyseWorldPlan(world).city!;
  expect(report.urban).toMatchObject({ sites: 2, openBuildings: 2, buildingFootprintTiles: 3, indoorWalkableTiles: 3, passages: 4, containers: 1, courtyardWalkableTiles: 8 });
  expect(report.quarters[0]).toMatchObject({ sites: 2, openBuildings: 2 });
  expect(report.urban!.kinds.find(kind => kind.kind === 'courtyard')!.sites).toBe(2);
  expect(world.obstacles).toHaveLength(2);
});
