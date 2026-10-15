import { expect, test } from 'bun:test';
import type { LiveCityBuilding } from '../src/game/live';
import { LIVE_MAPS } from '../src/game/live-maps';
import { buildingArchitecture, type BuildingFacade } from '../src/building-architecture';
import { buildingFacadeLayout, BUILDING_FACADE_LIMITS } from '../src/building-facade-layout';

const home: LiveCityBuilding = { id: 'inhabited-home', name: 'Жилой дом', x: 12, y: 24, width: 23, height: 9, kind: 'apartment', floors: 4,
  facade: 'panel', roof: 'flat', entrances: [{ x: 17, y: 32 }, { x: 29, y: 32 }, { x: 34, y: 27 }, { x: 19, y: 24 }, { x: 12, y: 29 }] };
const fullFacade = (building: LiveCityBuilding): BuildingFacade => ({ side: 'y', u: 0, plane: building.height, length: building.width, bottom: 0,
  top: (building.kind === 'workshop' ? .28 : .18) + (building.floors ?? 1) * .57, floors: building.floors ?? 1 });

test('shared facade layouts are stable across map translation and real entrance reordering without mutating architecture', () => {
  const before = structuredClone(home), moved = { ...home, x: home.x + 800, y: home.y - 20,
    entrances: [...home.entrances].reverse().map(door => ({ x: door.x + 800, y: door.y - 20 })) };
  const facades = buildingArchitecture(home).facades;
  expect(facades.length).toBeGreaterThan(1);
  for (const facade of facades) {
    const layout = buildingFacadeLayout(home, facade);
    expect(buildingFacadeLayout(moved, facade)).toEqual(layout);
    expect(buildingFacadeLayout({ ...home, entrances: [...home.entrances, home.entrances[0]!] }, facade)).toEqual(layout);
    expect(layout.windows.length).toBeGreaterThan(0);
  }
  expect(home).toEqual(before);
});

test('only actual visible exterior door gaps become portals and ground openings leave their real doorway bays clear', () => {
  for (const kind of ['apartment', 'shop', 'service', 'workshop', 'garage'] as const) {
    const building = { ...home, kind };
    for (const facade of buildingArchitecture(building).facades) {
      const layout = buildingFacadeLayout(building, facade), outer = facade.side === 'y' ? facade.plane === building.height : facade.plane === building.width;
      const expected = !outer || facade.bottom > 0 ? [] : [...new Set(building.entrances.filter(door => facade.side === 'y'
        ? door.y === building.y + building.height - 1 : door.x === building.x + building.width - 1)
        .map(door => (facade.side === 'y' ? door.x - building.x : door.y - building.y) + 1 - facade.u)
        .filter(u => u > 0 && u < facade.length))].sort((a, b) => a - b);
      expect(layout.doors).toEqual(expected);
      for (const opening of layout.windows.filter(window => !window.floor)) for (const door of layout.doors)
        expect(Math.abs(door - opening.u)).toBeGreaterThanOrEqual((kind === 'workshop' || kind === 'garage' ? 1.2 : .62) + opening.width / 2);
    }
  }
  const facade = fullFacade(home);
  expect(buildingFacadeLayout(home, facade).doors).toEqual([6, 18]);
  expect(buildingFacadeLayout(home, { ...facade, plane: home.height - 3 }).doors).toEqual([]);
  expect(buildingFacadeLayout(home, { ...facade, bottom: 1.32 }).doors).toEqual([]);
  expect(buildingFacadeLayout({ ...home, entrances: [] }, facade).doors).toEqual([]);
  const shop = { ...home, id: 'small-corner-shop', kind: 'shop' as const, width: 8, height: 8, floors: 1 as const,
    entrances: [{ x: home.x + 3, y: home.y + 7 }] };
  const shopfront = buildingFacadeLayout(shop, fullFacade(shop));
  expect(shopfront.doors).toEqual([4]); expect(shopfront.windows).toHaveLength(2);
  expect(shopfront.windows.every(window => window.style === 'ribbon' && window.width >= .65 && Math.abs(window.u - 4) > .62 + window.width / 2)).toBe(true);
});

test('family grammar distinguishes residential eras, civic rhythm, shopfronts and industrial bays', () => {
  const families = new Set<string>(), panelPatterns = new Map<string, string>();
  for (let index = 0; index < 64; index++) for (const kind of ['apartment', 'shop', 'service', 'workshop'] as const) for (const material of ['panel', 'brick', 'plaster'] as const) {
    const building = { ...home, id: `facade-grammar-${index}`, kind, facade: material }, facade = fullFacade(building), layout = buildingFacadeLayout(building, facade);
    families.add(layout.family);
    if (kind === 'apartment' && material === 'panel' && !panelPatterns.has(layout.family)) panelPatterns.set(layout.family, JSON.stringify({
      widths: layout.windows.filter(window => window.floor === 1).map(window => window.width), styles: layout.windows.filter(window => window.floor === 1).map(window => window.style),
      bands: layout.bands.map(band => [band.width, band.low, band.high, band.role]),
    }));
  }
  expect(families).toEqual(new Set(['panel-loggia', 'panel-stairwell', 'panel-ribbon', 'courtyard-brick', 'shuttered-plaster', 'townhouse',
    'shopfront', 'civic-banded', 'civic-arcade', 'industrial-ribbon', 'industrial-bays']));
  expect(panelPatterns.size).toBe(3); expect(new Set(panelPatterns.values()).size).toBe(3);
});

test('balcony stacks and opening centres align vertically while staircase and ground-floor bays stay free', () => {
  let balconyStacks = 0;
  for (let index = 0; index < 48; index++) {
    const building = { ...home, id: `inhabited-stacks-${index}` }, layout = buildingFacadeLayout(building, fullFacade(building));
    const byColumn = new Map<number, typeof layout.windows>();
    for (const opening of layout.windows) {
      const stack = byColumn.get(opening.u) ?? []; stack.push(opening); byColumn.set(opening.u, stack);
      if (!opening.floor) expect(opening.balcony).toBe('none');
      if (opening.style === 'tall') expect(opening.balcony).toBe('none'); // the reserved stair core
    }
    for (const stack of byColumn.values()) {
      const upper = stack.filter(window => window.floor > 0);
      if (upper.some(window => window.balcony !== 'none')) {
        expect(new Set(upper.map(window => window.balcony)).size).toBe(1);
        expect(upper).toHaveLength(3); balconyStacks++;
      }
    }
  }
  expect(balconyStacks).toBeGreaterThan(50);
});

test('every real metropolitan facade keeps openings, balcony bases and large accents inside its visible wall with bounded counts', () => {
  const buildings = LIVE_MAPS[0]!.citySites!.flatMap(site => site.buildings), families = new Set<string>();
  let windows = 0, wings = 0, doors = 0;
  expect(buildings.length).toBeGreaterThan(500);
  for (const building of buildings) for (const facade of buildingArchitecture(building).facades) {
    const layout = buildingFacadeLayout(building, facade), bottom = facade.bottom * 128, top = facade.top * 128;
    families.add(layout.family); windows += layout.windows.length; doors += layout.doors.length;
    if (facade.bottom > 0) { wings++; expect(layout.doors).toEqual([]); }
    expect(layout.windows.length).toBeLessThanOrEqual(BUILDING_FACADE_LIMITS.windows);
    expect(layout.bands.length).toBeLessThanOrEqual(BUILDING_FACADE_LIMITS.bands);
    for (const opening of layout.windows) {
      expect([opening.u, opening.width, opening.low, opening.high, opening.variation].every(Number.isFinite)).toBe(true);
      expect(opening.u - opening.width / 2).toBeGreaterThanOrEqual(.16);
      expect(opening.u + opening.width / 2).toBeLessThanOrEqual(facade.length - .16);
      expect(opening.low).toBeGreaterThanOrEqual(bottom + 5);
      expect(opening.high).toBeLessThanOrEqual(top - 12);
      expect(opening.high - opening.low).toBeGreaterThanOrEqual(15);
      expect(opening.floor).toBeLessThan(facade.floors);
      if (opening.balcony !== 'none') { expect(opening.floor).toBeGreaterThan(0); expect(opening.low - 20).toBeGreaterThanOrEqual(bottom + 2); }
    }
    for (const band of layout.bands) {
      expect([band.u, band.width, band.low, band.high].every(Number.isFinite)).toBe(true);
      expect(band.u).toBeGreaterThanOrEqual(.08); expect(band.u + band.width).toBeLessThanOrEqual(facade.length - .079999);
      expect(band.low).toBeGreaterThanOrEqual(bottom); expect(band.high).toBeLessThanOrEqual(top);
      expect(band.width).toBeGreaterThan(0); expect(band.high).toBeGreaterThan(band.low);
    }
  }
  expect(families.size).toBe(11); expect(windows).toBeGreaterThan(2500); expect(wings).toBeGreaterThan(20); expect(doors).toBeGreaterThan(400);
});

test('a narrow wing gets complete openings and large or invalid spans cannot escape facade geometry budgets', () => {
  const wing = { ...fullFacade(home), u: 8.5, length: 1.6 }, layout = buildingFacadeLayout(home, wing);
  expect(layout.windows.length).toBeGreaterThan(0);
  expect(layout.windows.every(window => window.u - window.width / 2 >= .16 && window.u + window.width / 2 <= wing.length - .16)).toBe(true);
  const wide = { ...home, width: 240, height: 20, entrances: [] }, wideLayout = buildingFacadeLayout(wide, fullFacade(wide));
  expect(wideLayout.windows).toHaveLength(24); expect(wideLayout.bands.length).toBeLessThanOrEqual(8);
  for (const facade of [{ ...wing, length: NaN }, { ...wing, bottom: 4 }, { ...wing, top: Infinity }, { ...wing, length: .2 }]) {
    expect(buildingFacadeLayout(home, facade)).toMatchObject({ windows: [], bands: [], doors: [] });
  }
});
