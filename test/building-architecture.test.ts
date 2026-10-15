import { expect, test } from 'bun:test';
import type { LiveCityBuilding } from '../src/game/live';
import { buildingArchitecture, buildingArchitectureHeightAt } from '../src/building-architecture';
import { BUILDING_EXTERIOR_HEIGHT_SCALE, distantBuildingSurfaces, sceneBuildings } from '../src/live-map-art';
import { generateLiveWorld } from '../src/game/world-generation';

const home: LiveCityBuilding = { id: 'old-home', name: 'Дом', x: 12, y: 24, width: 14, height: 8, kind: 'apartment', floors: 2, facade: 'plaster', roof: 'gable', entrances: [{ x: 15, y: 31 }] };

test('old streets have five distinct pitched roof silhouettes, independent of camera, entrance order and translation', () => {
  const families = new Set<string>();
  for (let index = 0; index < 96; index++) {
    const house = { ...home, id: `old-quarter-${index}` }, before = structuredClone(house), plan = buildingArchitecture(house);
    families.add(plan.roof);
    expect(buildingArchitecture({ ...house, x: 850, y: 720, entrances: [...house.entrances].reverse() })).toEqual(plan);
    expect(house).toEqual(before);
    for (const face of plan.surfaces) for (const p of face.points) {
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
      expect(p.x >= 0 && p.x <= house.width && p.y >= 0 && p.y <= house.height).toBe(true);
      if (face.material.startsWith('roof')) expect(buildingArchitectureHeightAt(plan, p.x, p.y)).toBeGreaterThanOrEqual(p.z - .000001);
    }
  }
  expect(families).toEqual(new Set(['gable', 'hip', 'half-hip', 'mansard', 'cross-gable']));
});

test('slab blocks and some civic halls have a lower adjoining wing while every real ground cell remains enclosed', () => {
  const blocks = Array.from({ length: 32 }, (_, index) => ({ ...home, id: `panel-block-${index}`, width: 23, floors: 3 as const, facade: 'panel' as const, roof: 'flat' as const }));
  const plans = blocks.map(buildingArchitecture);
  expect(plans.filter(plan => plan.volumes.length === 2).length).toBeGreaterThan(16);
  expect(plans.some(plan => plan.volumes.length === 1)).toBe(true);
  for (const plan of plans) {
    expect(plan.roof).toBe('flat');
    expect(plan.volumes.reduce((area, volume) => area + volume.width * volume.height, 0)).toBeCloseTo(23 * 8);
    for (let y = .5; y < 8; y++) for (let x = .5; x < 23; x++) expect(plan.volumes.filter(v => x >= v.x && x < v.x + v.width && y >= v.y && y < v.y + v.height)).toHaveLength(1);
    if (plan.volumes.length > 1) {
      expect(plan.volumes[1]!.top).toBeLessThan(plan.volumes[0]!.top);
      const highReturn = plan.facades.find(face => face.bottom > 0)!;
      expect(highReturn.bottom).toBe(plan.volumes[1]!.top);
      expect(highReturn.top).toBe(plan.volumes[0]!.top);
    }
  }
  expect(buildingArchitecture({ ...home, kind: 'workshop', floors: 1, facade: 'metal', roof: 'sawtooth' }).roof).toBe('sawtooth');
  expect(buildingArchitecture({ ...home, kind: 'garage', floors: 1, facade: 'metal', roof: 'gable' }).roof).toBe('gable');
});

test('the distant renderer uses exactly the native architectural planes, within a bounded footprint and geometry budget', () => {
  for (let index = 0; index < 96; index++) for (const roofAxis of ['x', 'y'] as const) {
    const house = { ...home, id: `architecture-lod-${index}`, roofAxis, width: 23, height: 11, floors: 4 as const,
      facade: index % 2 ? 'panel' as const : 'plaster' as const, roof: index % 2 ? 'flat' as const : 'gable' as const };
    const plan = buildingArchitecture(house), distant = distantBuildingSurfaces(house);
    expect(distant.length).toBeLessThanOrEqual(96);
    for (const surface of plan.surfaces) {
      const expected = surface.points.map(p => ({ x: house.x - .5 + p.x, y: house.y - .5 + p.y, z: p.z * BUILDING_EXTERIOR_HEIGHT_SCALE }));
      expect(distant.some(face => JSON.stringify(face.points) === JSON.stringify(expected))).toBe(true);
    }
    expect(distant.flatMap(face => face.points).every(p => p.x >= house.x - .5 && p.y >= house.y - .5 && p.x <= house.x + house.width - .5 && p.y <= house.y + house.height - .5 && Number.isFinite(p.z))).toBe(true);
  }
});

test('the actual metropolis contains varied older roofs and stepped modern blocks without changing world architecture data', () => {
  const world = generateLiveWorld('natural-city-architecture'), buildings = sceneBuildings(world);
  const before = JSON.stringify(buildings), plans = buildings.map(buildingArchitecture);
  expect(new Set(plans.map(plan => plan.roof)).size).toBeGreaterThanOrEqual(7);
  expect(plans.filter(plan => plan.volumes.length > 1).length).toBeGreaterThan(8);
  expect(plans.every(plan => plan.surfaces.length <= 18 && plan.facades.length <= 4)).toBe(true);
  expect(JSON.stringify(buildings)).toBe(before);
});
