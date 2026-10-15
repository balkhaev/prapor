import { describe, expect, test } from 'bun:test';
import { MAPS } from '../src/game/data';
import { PIXEL_PALETTE } from '../src/pixel-art';
import { operationsDistrictBuildings, operationsMapBridges, operationsMapCoordinate, operationsMapRiver, operationsMapRoads, paintOperationsMap, paintOperationsDistrictSymbol, type OperationsPoint } from '../src/operations-map-art';

const headquarters = { x: 110, y: 357 };
const sites = MAPS.map(place => ({ id: place.id, point: { x: 70 + place.position.x * 700, y: 62 + place.position.y * 330 } }));

describe('operations sheet geometry', () => {
  test('decorative houses vary their plots and setbacks around unchanged route anchors', () => {
    const before = structuredClone(sites);
    for (const site of sites.filter(site => site.id !== 'forest')) {
      const buildings = operationsDistrictBuildings(site);
      expect(buildings).toEqual(operationsDistrictBuildings(site)); expect(buildings.length).toBeLessThanOrEqual(12);
      expect(new Set(buildings.map(building => building.width)).size).toBeGreaterThan(1);
      expect(new Set(buildings.map(building => building.x % 30)).size).toBeGreaterThan(1);
    }
    expect(sites).toEqual(before);
  });
  test('roads preserve every existing destination and never mutate game map coordinates', () => {
    const before = structuredClone(sites), roads = operationsMapRoads(sites, headquarters);
    expect(roads).toHaveLength(MAPS.length);
    for (let index = 0; index < roads.length; index++) {
      const road = roads[index]!, previous = index ? sites[index - 1]!.point : headquarters;
      expect(road[0]).toEqual({ x: Math.round(previous.x), y: Math.round(previous.y) });
      expect(road.at(-1)).toEqual({ x: Math.round(sites[index]!.point.x), y: Math.round(sites[index]!.point.y) });
    }
    expect(sites).toEqual(before);
    expect(operationsMapRoads([], headquarters)).toEqual([]);
    expect(sites.map(site => operationsMapCoordinate(site.point))).toEqual(['D2', 'D4', 'B2', 'B5', 'A6', 'C7']);
    expect(operationsMapCoordinate({ x: -30, y: 900 })).toBe('E1');
  });

  test('bridges only appear at real intersections, including shared river vertices', () => {
    const road = [[{ x: 10, y: 50 }, { x: 90, y: 50 }]];
    const river = [{ x: 50, y: 0 }, { x: 50, y: 50 }, { x: 50, y: 100 }];
    expect(operationsMapBridges(road, river)).toEqual([{ point: { x: 50, y: 50 }, direction: { x: 1, y: 0 } }]);
    expect(operationsMapBridges([[{ x: 0, y: 50 }, { x: 30, y: 50 }]], river)).toEqual([]);
    expect(operationsMapBridges([[{ x: 10, y: 0 }, { x: 10, y: 100 }]], river)).toEqual([]);
    const crossings = operationsMapBridges(operationsMapRoads(sites, headquarters), operationsMapRiver());
    expect(crossings.length).toBeGreaterThan(0);
    for (const crossing of crossings) expect(Math.hypot(crossing.direction.x, crossing.direction.y)).toBeCloseTo(1);
  });
});

function recordingGraphics(): { graphics: Parameters<typeof paintOperationsMap>[0]; commands: unknown[][]; points: OperationsPoint[]; colors: number[] } {
  const commands: unknown[][] = [], points: OperationsPoint[] = [], colors: number[] = [];
  const graphics = {
    fillStyle(paint: number, alpha = 1) { commands.push(['fill', paint, alpha]); colors.push(paint); return this; },
    lineStyle(width: number, paint: number, alpha = 1) { commands.push(['line', width, paint, alpha]); colors.push(paint); return this; },
    fillRect(x: number, y: number, width: number, height: number) { commands.push(['rect', x, y, width, height]); points.push({ x, y }, { x: x + width, y: y + height }); return this; },
    strokeRect(x: number, y: number, width: number, height: number) { commands.push(['outline', x, y, width, height]); points.push({ x, y }, { x: x + width, y: y + height }); return this; },
    fillPoints(vertices: OperationsPoint[]) { commands.push(['polygon', vertices]); points.push(...vertices); return this; },
    strokePoints(vertices: OperationsPoint[]) { commands.push(['stroke', vertices]); points.push(...vertices); return this; },
  };
  return { graphics: graphics as unknown as Parameters<typeof paintOperationsMap>[0], commands, points, colors };
}

test('static sheet uses bounded integer palette art and distinct symbols for the six real districts', () => {
  const first = recordingGraphics(), second = recordingGraphics();
  paintOperationsMap(first.graphics, sites, headquarters); paintOperationsMap(second.graphics, sites, headquarters);
  expect(first.commands).toEqual(second.commands);
  expect(first.commands.length).toBeLessThan(5000);
  const palette = new Set(Object.values(PIXEL_PALETTE).map(paint => Number.parseInt(paint.slice(1), 16)));
  expect(first.colors.every(paint => palette.has(paint))).toBe(true);
  expect(first.points.every(point => Number.isInteger(point.x) && Number.isInteger(point.y) && point.x >= 0 && point.x <= 840 && point.y >= 0 && point.y <= 520)).toBe(true);
  const symbols = sites.map(site => {
    const record = recordingGraphics();
    paintOperationsDistrictSymbol(record.graphics, site.id, { x: 100, y: 100 }, PIXEL_PALETTE.cream);
    return JSON.stringify(record.commands);
  });
  expect(new Set(symbols).size).toBe(MAPS.length);
});
