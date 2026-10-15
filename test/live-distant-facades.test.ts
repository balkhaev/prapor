import { expect, test } from 'bun:test';
import type { LiveCityBuilding } from '../src/game/live';
import { buildingArchitecture, type BuildingFacade } from '../src/building-architecture';
import { buildingFacadeLayout } from '../src/building-facade-layout';
import { BUILDING_EXTERIOR_HEIGHT_SCALE, buildingExteriorStyle, distantBuildingSurfaces, sceneBuildings, type DistantBuildingSurface } from '../src/live-map-art';
import { LIVE_MAPS } from '../src/game/live-maps';

const Z = BUILDING_EXTERIOR_HEIGHT_SCALE / 128, epsilon = 1e-7;
const home: LiveCityBuilding = { id: 'facade-home', name: 'Жилой дом', x: 12, y: 24, width: 23, height: 11, kind: 'apartment', floors: 4,
  facade: 'panel', roof: 'flat', entrances: [{ x: 17, y: 34 }, { x: 28, y: 34 }, { x: 34, y: 28 }, { x: 17, y: 24 }] };
const openings = new Set(['#557b81', '#334f55', '#8a7957']);
const near = (a: number, b: number) => Math.abs(a - b) < epsilon;
function facadeFaces(building: LiveCityBuilding, facade: BuildingFacade, surfaces: DistantBuildingSurface[]) {
  const plane = (facade.side === 'y' ? building.y : building.x) - .5 + facade.plane;
  return surfaces.filter(surface => surface.points.every(point => {
    const u = (facade.side === 'y' ? point.x - building.x : point.y - building.y) + .5 - facade.u;
    return near(facade.side === 'y' ? point.y : point.x, plane) && u >= -epsilon && u <= facade.length + epsilon
      && point.z >= facade.bottom * BUILDING_EXTERIOR_HEIGHT_SCALE - epsilon && point.z <= facade.top * BUILDING_EXTERIOR_HEIGHT_SCALE + epsilon;
  }));
}
function localRect(building: LiveCityBuilding, facade: BuildingFacade, surface: DistantBuildingSurface) {
  const coordinates = surface.points.map(point => (facade.side === 'y' ? point.x - building.x : point.y - building.y) + .5 - facade.u);
  return { left: Math.min(...coordinates), right: Math.max(...coordinates), low: Math.min(...surface.points.map(point => point.z)), high: Math.max(...surface.points.map(point => point.z)) };
}
function sameRect(actual: ReturnType<typeof localRect>, expected: ReturnType<typeof localRect>) {
  return near(actual.left, expected.left) && near(actual.right, expected.right) && near(actual.low, expected.low) && near(actual.high, expected.high);
}
function expectedRect(facade: BuildingFacade, u: number, width: number, low: number, high: number) {
  return { left: Math.max(0, u), right: Math.min(facade.length, u + width), low: Math.max(facade.bottom * BUILDING_EXTERIOR_HEIGHT_SCALE, low), high: Math.min(facade.top * BUILDING_EXTERIOR_HEIGHT_SCALE, high) };
}

test('distant accents, window bays, warm panes and real portals correspond to the shared native facade plan', () => {
  let panes = 0, warm = 0, glazed = 0, bands = 0;
  for (let index = 0; index < 36; index++) for (const facade of ['panel', 'brick', 'plaster', 'metal'] as const) {
    const building = { ...home, id: `lod-shared-${index}`, facade, kind: facade === 'metal' ? 'workshop' as const : index % 4 === 0 ? 'service' as const : 'apartment' as const };
    const surfaces = distantBuildingSurfaces(building), style = buildingExteriorStyle(building);
    for (const plane of buildingArchitecture(building).facades) {
      const layout = buildingFacadeLayout(building, plane), actual = facadeFaces(building, plane, surfaces);
      for (const band of layout.bands) {
        const rect = expectedRect(plane, band.u, band.width, band.low * Z, band.high * Z);
        expect(actual.some(surface => surface.color === style[band.role] && sameRect(localRect(building, plane, surface), rect))).toBe(true); bands++;
      }
      const glass = actual.filter(surface => openings.has(surface.color));
      const selected = new Set<number>();
      for (const surface of glass) {
        const rect = localRect(building, plane, surface);
        const source = layout.windows.find(window => {
          const width = window.width + (window.balcony === 'glazed' ? .18 : 0);
          return sameRect(rect, expectedRect(plane, window.u - width / 2, width, window.low * Z, window.high * Z));
        });
        expect(source).toBeDefined();
        if (!source) continue;
        expect(surface.color).toBe(source.variation % 11 === 0 ? '#8a7957' : plane.side === 'x' ? '#557b81' : '#334f55');
        selected.add(source.u); panes++; warm += Number(source.variation % 11 === 0); glazed += Number(source.balcony === 'glazed');
      }
      // Selection keeps whole actual stacks; no missing floor or repositioned
      // bay is invented to fill the gap left by a cheaper level of detail.
      for (const u of selected) expect(glass.filter(surface => near((localRect(building, plane, surface).left + localRect(building, plane, surface).right) / 2, u)).length)
        .toBe(layout.windows.filter(window => near(window.u, u)).length);
      const doors = actual.filter(surface => surface.color === '#30463f');
      expect(doors.length).toBe(layout.doors.slice(0, 2).length);
      const industrial = building.kind === 'workshop', width = industrial ? 1.44 : .78;
      for (const door of layout.doors.slice(0, 2)) expect(doors.some(surface => sameRect(localRect(building, plane, surface), expectedRect(plane, door - width / 2, width, 0, (industrial ? 76 : 61) * Z)))).toBe(true);
    }
  }
  expect(panes).toBeGreaterThan(1500); expect(warm).toBeGreaterThan(50); expect(glazed).toBeGreaterThan(20); expect(bands).toBeGreaterThan(1500);
});

test('translation and entrance order preserve distant facade identity without any world mutation or LOD-only reflow', () => {
  for (let index = 0; index < 32; index++) {
    const building = { ...home, id: `facade-transfer-${index}` }, before = structuredClone(building), surfaces = distantBuildingSurfaces(building);
    const dx = 700, dy = 550, moved = { ...building, x: building.x + dx, y: building.y + dy, entrances: [...building.entrances].reverse().map(door => ({ x: door.x + dx, y: door.y + dy })) };
    const translated = distantBuildingSurfaces(moved);
    expect(translated.length).toBe(surfaces.length);
    for (let at = 0; at < surfaces.length; at++) {
      expect(translated[at]!.color).toBe(surfaces[at]!.color);
      for (let corner = 0; corner < surfaces[at]!.points.length; corner++) {
        const point = surfaces[at]!.points[corner]!, other = translated[at]!.points[corner]!;
        expect(other.x - dx).toBeCloseTo(point.x, 7); expect(other.y - dy).toBeCloseTo(point.y, 7); expect(other.z).toBe(point.z);
      }
    }
    expect(building).toEqual(before);
  }
});

test('distant facade geometry distinguishes housing, civic, shopping and industrial families rather than merely recolouring one grid', () => {
  const profiles = [
    { kind: 'apartment', facade: 'panel' }, { kind: 'apartment', facade: 'brick' }, { kind: 'apartment', facade: 'plaster' },
    { kind: 'service', facade: 'brick' }, { kind: 'shop', facade: 'plaster' }, { kind: 'workshop', facade: 'metal' },
  ] as const;
  const families = new Set<string>(), elevations = new Set<string>();
  for (const profile of profiles) for (let index = 0; index < 24; index++) {
    const building = { ...home, ...profile, id: `facade-family-${index}` }, surfaces = distantBuildingSurfaces(building);
    const facade = buildingArchitecture(building).facades.find(facade => facade.side === 'y' && facade.bottom === 0)!;
    families.add(buildingFacadeLayout(building, facade).family);
    const rectangles = facadeFaces(building, facade, surfaces).map(surface => localRect(building, facade, surface));
    elevations.add(JSON.stringify(rectangles.map(rect => Object.values(rect).map(value => Math.round(value * 1000)))));
  }
  expect(families.size).toBeGreaterThanOrEqual(10); expect(elevations.size).toBeGreaterThan(24);
});

test('a bounded LOD budget preserves every real roof and keeps flattened facade details inside each visible wall plane', () => {
  for (const width of [5, 13, 23, 40]) for (const height of [5, 11, 32]) for (const roofAxis of ['x', 'y'] as const) for (let index = 0; index < 24; index++) {
    const building = { ...home, id: `bounded-facade-${index}`, width, height, roofAxis, facade: index % 2 ? 'plaster' as const : 'panel' as const,
      roof: index % 2 ? 'gable' as const : 'flat' as const, entrances: [{ x: home.x + Math.floor(width / 2), y: home.y + height - 1 }] };
    const plan = buildingArchitecture(building), surfaces = distantBuildingSurfaces(building);
    expect(surfaces.length).toBeLessThanOrEqual(160);
    for (const roof of plan.surfaces) {
      const points = roof.points.map(point => ({ x: building.x - .5 + point.x, y: building.y - .5 + point.y, z: point.z * BUILDING_EXTERIOR_HEIGHT_SCALE }));
      expect(surfaces.some(surface => JSON.stringify(surface.points) === JSON.stringify(points))).toBe(true);
    }
    for (const surface of surfaces) {
      expect(surface.points.length).toBeGreaterThanOrEqual(3); expect(surface.points.length).toBeLessThanOrEqual(6);
      expect(surface.points.every(point => Number.isFinite(point.x + point.y + point.z) && point.z >= 0 && point.x >= building.x - .5 - epsilon && point.x <= building.x + width - .5 + epsilon
        && point.y >= building.y - .5 - epsilon && point.y <= building.y + height - .5 + epsilon)).toBe(true);
    }
  }
});

test('the full published metropolis keeps average distant complexity modest and public geometry unchanged', () => {
  const world = LIVE_MAPS[0]!, buildings = sceneBuildings(world), before = JSON.stringify(buildings), counts = buildings.map(building => distantBuildingSurfaces(building).length);
  expect(buildings.length).toBeGreaterThan(900); expect(Math.max(...counts)).toBeLessThanOrEqual(160);
  expect(counts.reduce((sum, count) => sum + count, 0) / counts.length).toBeLessThan(70);
  expect(JSON.stringify(buildings)).toBe(before);
});
