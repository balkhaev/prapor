import { afterEach, describe, expect, test } from 'bun:test';
import { BUILDING_EXTERIOR_HEIGHT_SCALE, buildingExteriorStyle, buildingFacadeCadence, buildingNeedsCutaway, buildingPalette, buildingWallHeight, distantBuildingSurfaces, liveMapRasterPlan, mapVegetationBands, paintMapFootprints, paintPropModel, PropArtCache, sceneBuildings, SceneryIndex } from '../src/live-map-art';
import type { LiveCityBuilding, LiveObstacle, LiveWorld, LiveWorldProp } from '../src/game/live';
import { prefabObstacles } from '../src/game/world-prefabs';

const building: LiveCityBuilding = { id: 'home', name: 'Дом', x: 10, y: 12, width: 8, height: 6, kind: 'apartment', entrances: [{ x: 13, y: 12 }, { x: 13, y: 17 }], floors: 3, facade: 'brick', roof: 'gable' };

describe('raid architecture visibility', () => {
  test('only an interior or actual doorway approach opens the roof; nearby street actors and loot do not', () => {
    for (const point of [{ x: 14, y: 15 }, { x: 13, y: 11 }, { x: 13, y: 18 }]) {
      expect(buildingNeedsCutaway(building, [point])).toBe(true);
    }
    expect(buildingNeedsCutaway(building, [])).toBe(false);
    expect(buildingNeedsCutaway(building, [{ x: 23, y: 24 }])).toBe(false);
    for (const point of [{ x: 9, y: 15 }, { x: 18, y: 15 }, { x: 10, y: 11 }, { x: 16, y: 18 }]) expect(buildingNeedsCutaway(building, [point])).toBe(false);
    expect(building).toMatchObject({ x: 10, y: 12, width: 8, height: 6 });
  });

  test('sparse human-sized openings distinguish residences from industrial clerestories', () => {
    const home = buildingFacadeCadence({ ...building, kind: 'apartment' }, 24), workshop = buildingFacadeCadence({ ...building, kind: 'workshop' }, 24);
    expect(home.columns).toBeLessThan(9); expect(home.width).toBeLessThan(1); expect(home.height).toBeLessThan(.25);
    expect(workshop.columns).toBeLessThan(home.columns); expect(workshop.industrial).toBe(true);
    expect(buildingWallHeight({ ...building, floors: 1 })).toBeLessThan(1);
    expect(buildingWallHeight({ ...building, floors: 3 })).toBeLessThan(2.1);
  });

  test('materials distinguish masonry, housing panels and corrugated workshops, including old fixtures', () => {
    const materials = ['brick', 'plaster', 'panel', 'metal'] as const;
    const colors = materials.map(facade => buildingPalette({ ...building, facade }));
    expect(new Set(colors.map(palette => palette.join(':'))).size).toBe(4);
    const { facade: _facade, floors: _floors, roof: _roof, ...legacy } = building;
    expect(buildingPalette(legacy)).toHaveLength(3);
    expect(buildingPalette({ ...legacy, kind: 'workshop' })).toEqual(buildingPalette({ ...building, facade: 'metal' }));
  });
  test('public address colours stay consistent between detailed houses and the distant map', () => {
    const styles = Array.from({ length: 96 }, (_, index) => buildingExteriorStyle({ ...building, id: `street-home-${index}` }));
    expect(new Set(styles.map(style => style.light)).size).toBe(3);
    expect(new Set(styles.map(style => style.roof[0])).size).toBe(4);
    expect(buildingExteriorStyle({ ...building, x: 870, y: 94 })).toEqual(buildingExteriorStyle(building));
    const style = buildingExteriorStyle(building);
    expect(buildingPalette(building)).toEqual([style.light, style.dark, style.roof[0]]);
  });
  test('distant roofs preserve gables and sawtooths, entrances and bounded public footprints', () => {
    for (const roof of ['flat', 'gable', 'sawtooth'] as const) for (const roofAxis of ['x', 'y'] as const) {
      const house = { ...building, roof, roofAxis, floors: 4 as const, width: 40, height: 32, entrances: [{ x: 13, y: 12 }, { x: 13, y: 43 }] }, before = structuredClone(house);
      const surfaces = distantBuildingSurfaces(house), wall = buildingWallHeight(house) * BUILDING_EXTERIOR_HEIGHT_SCALE;
      const points = surfaces.flatMap(surface => surface.points), peak = Math.max(...points.map(point => point.z));
      expect(surfaces.length).toBeLessThanOrEqual(44);
      expect(points.every(point => Number.isFinite(point.x + point.y + point.z))).toBe(true);
      expect(points.every(point => point.x >= house.x - .5 && point.x <= house.x + house.width - .5 && point.y >= house.y - .5 && point.y <= house.y + house.height - .5)).toBe(true);
      if (roof === 'flat') expect(peak).toBe(wall);
      else { expect(peak).toBeGreaterThan(wall); expect(peak).toBeLessThan(wall + .6); }
      if (roof === 'gable') expect(surfaces.some(surface => surface.points.length === 3)).toBe(true);
      if (roof === 'sawtooth') expect(surfaces.filter(surface => surface.points.every(point => point.z >= wall)).length).toBe(12);
      expect(surfaces.some(surface => surface.color === '#334f55')).toBe(true);
      expect(house).toEqual(before);
    }
  });
  test('authored open houses own their collider segments without acquiring duplicate solid roofs', () => {
    const map = { chunkSize: 32, pois: [], citySites: [{ buildings: [building] }], obstacles: [
      { x: 10, y: 12, width: 3, height: 1, kind: 'building' },
      { x: 14, y: 12, width: 4, height: 1, kind: 'building' },
      { x: 10, y: 13, width: 1, height: 5, kind: 'wall' },
      { x: 80, y: 81, width: 7, height: 6, kind: 'building' },
    ] } as unknown as LiveWorld;
    const actual = sceneBuildings(map);
    expect(actual).toHaveLength(2); expect(actual[0]).toEqual(building);
    expect(actual[1]).toMatchObject({ x: 80, y: 81, width: 7, height: 6, id: 'solid-3' });
  });
});

test('legacy hall roofs require all six exact perimeter pieces through rotation and shrinking', () => {
  for (const extent of [{ width: 22, height: 22 }, { width: 18, height: 16 }]) for (let rotation = 0; rotation < 4; rotation++) {
    const rotate = (x: number, y: number): { x: number; y: number } => rotation === 0 ? { x, y } : rotation === 1 ? { x: 21 - y, y: x } : rotation === 2 ? { x: 21 - x, y: 21 - y } : { x: y, y: 21 - x };
    const obstacles: LiveObstacle[] = prefabObstacles('workshop').map(obstacle => {
      const corners = [[obstacle.x, obstacle.y], [obstacle.x + obstacle.width - 1, obstacle.y + obstacle.height - 1], [obstacle.x + obstacle.width - 1, obstacle.y], [obstacle.x, obstacle.y + obstacle.height - 1]].map(([x, y]) => rotate(x!, y!)).map(p => ({ x: Math.round(p.x / 21 * (extent.width - 1)), y: Math.round(p.y / 21 * (extent.height - 1)) }));
      const x = Math.min(...corners.map(p => p.x)), y = Math.min(...corners.map(p => p.y));
      return { ...obstacle, x: x + 20, y: y + 20, width: Math.max(...corners.map(p => p.x)) - x + 1, height: Math.max(...corners.map(p => p.y)) - y + 1 };
    });
    const map = { width: 64, height: 64, obstacles, pois: [{ id: 'test', templateId: 'workshop', name: 'Ремонт', x: 20, y: 20, ...extent }], citySites: [] } as unknown as LiveWorld;
    const before = structuredClone(map), halls = sceneBuildings(map).filter(room => room.id.startsWith('hall-'));
    expect(halls).toHaveLength(2); expect(halls.every(hall => hall.entrances.length === 2 && hall.width * hall.height >= 35)).toBe(true);
    expect(map).toEqual(before);
    const removed = { ...map, obstacles: map.obstacles.filter((_, index) => index !== 4) };
    expect(sceneBuildings(removed).filter(room => room.id.startsWith('hall-'))).toHaveLength(1);
  }
});

test('a POI bounds box and incomplete courtyard walls never acquire an invented roof', () => {
  const map = { width: 64, height: 64, obstacles: [{ x: 22, y: 23, width: 1, height: 12, kind: 'wall' }, { x: 30, y: 23, width: 1, height: 12, kind: 'wall' }], pois: [{ id: 'yard', templateId: 'workshop', name: 'Двор', x: 20, y: 20, width: 22, height: 22 }], citySites: [] } as unknown as LiveWorld;
  expect(sceneBuildings(map)).toEqual([]);
});

describe('static map culling', () => {
  test('metropolis views retain only nearby scenery across translated quarters and edges', () => {
    const items = Array.from({ length: 15000 }, (_, id) => ({ id, x: id % 125 * 8, y: Math.floor(id / 125) * 8, width: id % 19 === 0 ? 14 : 2, height: 3 }));
    const index = new SceneryIndex(items, 32);
    for (const area of [{ x: 4, y: 7, width: 24, height: 30 }, { x: 720, y: 512, width: 43, height: 39 }, { x: 998, y: 944, width: 40, height: 50 }]) {
      const expected = items.filter(item => item.x <= area.x + area.width && item.y <= area.y + area.height && item.x + item.width >= area.x && item.y + item.height >= area.y);
      const visible = index.visible(area);
      expect(visible.map(item => item.id).sort((a, b) => a - b)).toEqual(expected.map(item => item.id));
      expect(visible.length).toBeLessThan(80);
    }
  });
  test('a spanning footprint is found at either end and is returned once across several chunks', () => {
    const wide = { x: 5, y: 6, width: 35, height: 3, id: 'railcar' }, nearby = { x: 2, y: 4, width: 1, height: 1, id: 'lamp' }, far = { x: 240, y: 240, width: 4, height: 4, id: 'truck' };
    const index = new SceneryIndex([wide, nearby, far]);
    expect(index.visible({ x: 38, y: 6, width: 3, height: 3 })).toEqual([wide]);
    expect(index.visible({ x: 0, y: 0, width: 44, height: 30 })).toHaveLength(2);
    expect(index.visible({ x: 100, y: 100, width: 30, height: 20 })).toEqual([]);
    expect(index.visible({ x: -10, y: -10, width: 12, height: 14 })).toEqual([nearby]);
  });
});

describe('bounded city navigation art', () => {
  test('distant green canopies retain the physical footprint with varied stepped edges', () => {
    const prop = { id: 'linden-14', kind: 'tree' as const, x: 781, y: 244, width: 3, height: 2 };
    const bands = mapVegetationBands(prop);
    expect(bands).toEqual(mapVegetationBands(prop)); expect(bands.length).toBeLessThanOrEqual(9);
    expect(new Set(bands.map(band => band.width)).size).toBeGreaterThan(3);
    for (const band of bands) {
      expect(band.x).toBeGreaterThanOrEqual(prop.x); expect(band.y).toBeGreaterThanOrEqual(prop.y);
      expect(band.x + band.width).toBeLessThanOrEqual(prop.x + prop.width + 1e-6); expect(band.y + band.height).toBeLessThanOrEqual(prop.y + prop.height + 1e-6);
    }
  });
  test('1024-cell world keeps navigation bitmaps under 12 MiB with a correct isometric origin', () => {
    for (const [width, height] of [[256, 256], [512, 512], [1024, 1024], [1024, 512], [512, 1024]] as const) {
      const { minimap, overview } = liveMapRasterPlan(width, height);
      expect(Math.max(minimap.width, minimap.height)).toBeLessThanOrEqual(1024);
      expect(Math.max(overview.width, overview.height)).toBeLessThanOrEqual(2048);
      expect(4 * (minimap.width * minimap.height + overview.width * overview.height)).toBeLessThanOrEqual(12 * 1024 * 1024);
      const project = (x: number, y: number) => ({ x: (x - y + height) * overview.scale, y: (x + y) * overview.scale / 2 });
      expect(project(0, height).x).toBe(0); expect(project(width, 0).x).toBe(overview.width);
      expect(project(width, height).y).toBe(overview.height);
      expect(minimap.width / width).toBe(minimap.height / height);
    }
    expect(liveMapRasterPlan(1024, 1024)).toEqual({ minimap: { width: 1024, height: 1024, scale: 1 }, overview: { width: 2048, height: 1024, scale: 1 } });
  });
  test('distant LOD contains real buildings and blocking props without inventing footprint or water cover', () => {
    const fills: number[][] = [], roofs: number[][] = [];
    const map = { width: 1024, height: 1024, obstacles: [{ x: 260, y: 264, width: 2, height: 4, kind: 'wall' }, { x: 500, y: 502, width: 10, height: 8, kind: 'water' }],
      props: [{ x: 702, y: 108, width: 2, height: 1, kind: 'car', blocking: true }, { x: 703, y: 113, width: 1, height: 1, kind: 'lamp', blocking: false }] } as LiveWorld;
    const buildings = [{ ...building, x: 840, y: 740 }, { ...building, id: 'west', x: 120, y: 360, width: 30, height: 15 }];
    const before = structuredClone({ map, buildings });
    const c = { fillRect: (...values: number[]) => fills.push(values), strokeRect: (...values: number[]) => roofs.push(values) } as unknown as CanvasRenderingContext2D;
    paintMapFootprints(c, map, buildings);
    expect(roofs).toEqual([[840, 740, 8, 6], [120, 360, 30, 15]]);
    expect(fills).toEqual([[260, 264, 2, 4], [702, 108, 2, 1], ...roofs]);
    expect({ map, buildings }).toEqual(before);
  });
});

function recordingContext(): { context: CanvasRenderingContext2D; coordinates: number[]; paints: number } {
  const state = { coordinates: [] as number[], paints: 0 };
  const context = new Proxy({}, {
    get(_target, key) { return (...args: unknown[]) => { for (const value of args) if (typeof value === 'number') state.coordinates.push(value); if (key === 'fill' || key === 'fillRect' || key === 'stroke') state.paints++; }; },
    set() { return true; },
  }) as CanvasRenderingContext2D;
  return { context, get coordinates() { return state.coordinates; }, get paints() { return state.paints; } };
}

const kinds: LiveWorldProp['kind'][] = ['car', 'van', 'truck', 'bus', 'lamp', 'dumpster', 'pallet', 'crate', 'barrel', 'bench', 'planter', 'shed', 'sign', 'fence', 'shrub', 'tree', 'logs', 'railcar', 'transformer', 'playground', 'garden', 'kiosk', 'market-stall', 'workbench', 'hydrant', 'power-pole', 'bollard'];

test('every public scenery kind renders finite visible geometry for both directions and all variants', () => {
  for (const kind of kinds) for (const orientation of ['x', 'y'] as const) for (let variant = 0; variant < 4; variant++) {
    const prop: LiveWorldProp = { id: kind, kind, x: 12, y: 14, width: orientation === 'x' ? 3 : 1, height: orientation === 'y' ? 3 : 1, orientation, variant, blocking: false };
    const recorded = recordingContext(), original = structuredClone(prop);
    paintPropModel(recorded.context, prop, { x: 120, y: 116 });
    expect(recorded.paints).toBeGreaterThan(1);
    expect(recorded.coordinates.length).toBeGreaterThan(10);
    expect(recorded.coordinates.every(Number.isFinite)).toBe(true);
    expect(prop).toEqual(original);
  }
});

let restoreDocument: (() => void) | undefined;
afterEach(() => { restoreDocument?.(); restoreDocument = undefined; });

test('prop geometry is reused across positions and remains cached until the world changes', () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document'); let created = 0;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() { created++; return { width: 0, height: 0, getContext: () => recordingContext().context }; } } });
  restoreDocument = () => { if (old) Object.defineProperty(globalThis, 'document', old); else Reflect.deleteProperty(globalThis, 'document'); };
  const cache = new PropArtCache(), prop: LiveWorldProp = { id: 'one', kind: 'car', x: 2, y: 3, width: 4, height: 2, orientation: 'x', variant: 0, blocking: true };
  const first = cache.get(prop), reused = cache.get({ ...prop, id: 'two', x: 100, y: 80 });
  expect(reused).toBe(first); expect(created).toBe(1);
  expect(first.image.width).toBeGreaterThan(160); expect(first.image.height).toBeGreaterThan(180);
  expect(cache.get({ ...prop, variant: 1 })).not.toBe(first); expect(created).toBe(2);
  cache.clear(); expect(cache.get(prop)).not.toBe(first); expect(created).toBe(3);
});
