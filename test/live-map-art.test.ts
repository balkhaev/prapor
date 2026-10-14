import { afterEach, describe, expect, test } from 'bun:test';
import { buildingNeedsCutaway, buildingPalette, paintPropModel, PropArtCache, SceneryIndex } from '../src/live-map-art';
import type { LiveCityBuilding, LiveWorldProp } from '../src/game/live';

const building: LiveCityBuilding = { id: 'home', name: 'Дом', x: 10, y: 12, width: 8, height: 6, kind: 'apartment', entrances: [{ x: 13, y: 12 }, { x: 13, y: 17 }], floors: 3, facade: 'brick', roof: 'gable' };

describe('raid architecture visibility', () => {
  test('a confirmed actor, loot or interpolation endpoint opens the room through both doorway aprons', () => {
    for (const point of [{ x: 14, y: 15 }, { x: 13, y: 11 }, { x: 13, y: 18 }, { x: 9, y: 15 }, { x: 18, y: 15 }]) {
      expect(buildingNeedsCutaway(building, [point])).toBe(true);
    }
    expect(buildingNeedsCutaway(building, [])).toBe(false);
    expect(buildingNeedsCutaway(building, [{ x: 23, y: 24 }])).toBe(false);
    expect(building).toMatchObject({ x: 10, y: 12, width: 8, height: 6 });
  });

  test('materials distinguish masonry, housing panels and corrugated workshops, including old fixtures', () => {
    const materials = ['brick', 'plaster', 'panel', 'metal'] as const;
    const colors = materials.map(facade => buildingPalette({ ...building, facade }));
    expect(new Set(colors.map(palette => palette.join(':'))).size).toBe(4);
    const { facade: _facade, floors: _floors, roof: _roof, ...legacy } = building;
    expect(buildingPalette(legacy)).toHaveLength(3);
    expect(buildingPalette({ ...legacy, kind: 'workshop' })).toEqual(buildingPalette({ ...building, facade: 'metal' }));
  });
});

describe('static map culling', () => {
  test('a spanning footprint is found at either end and is returned once across several chunks', () => {
    const wide = { x: 5, y: 6, width: 35, height: 3, id: 'railcar' }, nearby = { x: 2, y: 4, width: 1, height: 1, id: 'lamp' }, far = { x: 240, y: 240, width: 4, height: 4, id: 'truck' };
    const index = new SceneryIndex([wide, nearby, far]);
    expect(index.visible({ x: 38, y: 6, width: 3, height: 3 })).toEqual([wide]);
    expect(index.visible({ x: 0, y: 0, width: 44, height: 30 })).toHaveLength(2);
    expect(index.visible({ x: 100, y: 100, width: 30, height: 20 })).toEqual([]);
    expect(index.visible({ x: -10, y: -10, width: 12, height: 14 })).toEqual([nearby]);
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
