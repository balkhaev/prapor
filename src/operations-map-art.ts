import type Phaser from 'phaser';
import { PIXEL_PALETTE as P, pixelRandom, pixelSeed } from './pixel-art';
import { pixelLandcoverBands, type LandcoverRect } from './pixel-landcover';

export type OperationsPoint = { x: number; y: number };
export type OperationsSite = { id: string; point: OperationsPoint };
type MapGraphics = Pick<Phaser.GameObjects.Graphics, 'fillStyle' | 'fillRect' | 'fillPoints' | 'lineStyle' | 'strokePoints' | 'strokeRect'>;
const color = (value: string): number => Number.parseInt(value.slice(1), 16);
const rounded = (point: OperationsPoint): OperationsPoint => ({ x: Math.round(point.x), y: Math.round(point.y) });
const stroke = (g: MapGraphics, points: readonly OperationsPoint[], paint: string, width = 1, alpha = 1): void => {
  g.lineStyle(width, color(paint), alpha).strokePoints(points.map(rounded), false);
};
const polygon = (g: MapGraphics, points: readonly OperationsPoint[], paint: string, alpha = 1): void => {
  g.fillStyle(color(paint), alpha).fillPoints(points.map(rounded), true);
};
const rect = (g: MapGraphics, x: number, y: number, width: number, height: number, paint: string, alpha = 1): void => {
  g.fillStyle(color(paint), alpha).fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
};

export const OPERATIONS_GRID = { x: 44, y: 90, width: 752, height: 320, columns: 8, rows: 5 } as const;

/** Local sheet references, not world distances or new playable sectors. */
export function operationsMapCoordinate(point: OperationsPoint): string {
  const grid = OPERATIONS_GRID;
  const column = Math.max(0, Math.min(grid.columns - 1, Math.floor((point.x - grid.x) / (grid.width / grid.columns))));
  const row = Math.max(0, Math.min(grid.rows - 1, Math.floor((point.y - grid.y) / (grid.height / grid.rows))));
  return `${String.fromCharCode(65 + row)}${column + 1}`;
}

/** Preserve the established schematic road connections and district anchors. */
export function operationsMapRoads(sites: readonly OperationsSite[], headquarters: OperationsPoint): OperationsPoint[][] {
  let previous = headquarters;
  return sites.map(({ point }) => {
    const road = [rounded(previous), rounded({ x: point.x * .56 + previous.x * .44, y: previous.y - 20 }), rounded(point)];
    previous = point;
    return road;
  });
}

export function operationsMapRiver(): OperationsPoint[] {
  const points: OperationsPoint[] = [];
  for (let y = 90; y <= 410; y += 8) points.push({ x: Math.round(454 + Math.sin(y / 61) * 47 + Math.sin(y / 24) * 11), y });
  return points;
}

/** Only actual intersections of the existing road and river strokes acquire bridges. */
export function operationsMapBridges(roads: readonly (readonly OperationsPoint[])[], river: readonly OperationsPoint[]): { point: OperationsPoint; direction: OperationsPoint }[] {
  const bridges: { point: OperationsPoint; direction: OperationsPoint }[] = [];
  for (const road of roads) for (let n = 1; n < road.length; n++) {
    const a = road[n - 1]!, b = road[n]!, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < 1) continue;
    for (let index = 1; index < river.length; index++) {
      const c = river[index - 1]!, d = river[index]!, sx = d.x - c.x, sy = d.y - c.y;
      const cross = dx * sy - dy * sx;
      if (Math.abs(cross) < .0001) continue;
      const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / cross;
      const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / cross;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const point = rounded({ x: a.x + t * dx, y: a.y + t * dy });
      if (bridges.some(bridge => Math.hypot(bridge.point.x - point.x, bridge.point.y - point.y) < 18)) continue;
      bridges.push({ point, direction: { x: dx / length, y: dy / length } });
    }
  }
  return bridges;
}

function tree(g: MapGraphics, x: number, y: number, pine: boolean, size: number): void {
  rect(g, x, y + 2, 2, 4, P.woodShade);
  if (pine) {
    polygon(g, [{ x, y: y - size }, { x: x - size / 2, y: y + 2 }, { x: x + size / 2, y: y + 2 }], P.leafShade);
    stroke(g, [{ x, y: y - size + 3 }, { x: x - size / 3, y }], P.leaf, 2);
  } else {
    polygon(g, [{ x: x - size / 2, y: y - size / 2 }, { x, y: y - size }, { x: x + size / 2, y: y - size / 2 }, { x: x + size / 2 - 1, y: y + 1 }, { x: x - size / 2 + 1, y: y + 2 }], P.leafShade);
    rect(g, x - size / 3, y - size / 2, Math.max(2, size / 2), 2, P.leaf);
  }
}

function building(g: MapGraphics, x: number, y: number, width: number, height: number, industrial: boolean): void {
  rect(g, x + 2, y + 3, width, height, P.black, .6);
  rect(g, x, y, width, height, industrial ? P.roofShade : P.panelShade);
  rect(g, x, y, width, 2, industrial ? P.steel : P.concreteShade, .8);
  rect(g, x, y + 2, 1, height - 2, P.steelLight, .45);
  if (industrial) {
    for (let column = 4; column < width - 2; column += 7) rect(g, x + column, y + 3, 1, height - 5, P.steelShade);
    rect(g, x + width - 5, y + height - 2, 3, 2, P.black);
  } else for (let column = 3; column < width - 2; column += 5) rect(g, x + column, y + height - 3, 2, 1, P.black);
}

/** These are map symbols around the fixed route anchors, not additional playable buildings. */
export function operationsDistrictBuildings(site: OperationsSite): LandcoverRect[] {
  const random = pixelRandom(pixelSeed(site.id)), industrial = site.id !== 'courtyard', result: LandcoverRect[] = [];
  const columns = site.id === 'depot' ? 4 : 3, rows = site.id === 'bunker' ? 2 : 3;
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const x = Math.round(site.point.x - 54 + column * 30 + (random() - .5) * 13), y = Math.round(site.point.y - 47 + row * 19 + (random() - .5) * 9);
    const width = Math.round((industrial ? 17 : 12) + random() * 9), height = Math.round(6 + random() * 7);
    if (Math.hypot(x + width / 2 - site.point.x, y + height / 2 - site.point.y) < 29) continue;
    result.push({ x, y, width, height });
  }
  return result;
}

/** Static ink layers. Nothing here changes navigation, unlocks or dispatch state. */
export function paintOperationsMap(g: MapGraphics, sites: readonly OperationsSite[], headquarters: OperationsPoint): void {
  rect(g, 0, 0, 840, 520, P.black);
  rect(g, 20, 20, 800, 460, P.ink);
  g.lineStyle(1, color(P.shadow)).strokeRect(20, 20, 800, 460);
  rect(g, 21, 21, 798, 60, P.black, .62);
  rect(g, 21, 433, 798, 46, P.black, .72);
  const rng = pixelRandom(4731), river = operationsMapRiver(), roads = operationsMapRoads(sites, headquarters);
  const forest = sites.find(site => site.id === 'forest')?.point;
  // Low contrast, stepped woodland masses follow the existing forest district.
  if (forest) for (let layer = 0; layer < 4; layer++) {
    const bounds = { x: forest.x - 125 + layer * 13, y: Math.max(91, forest.y - 65 + layer * 16), width: 250 - layer * 29, height: 108 - layer * 12 };
    for (const band of pixelLandcoverBands(bounds, `forest:${layer}`, 12)) rect(g, band.x, band.y, band.width, band.height, P.leafShade, .24);
  }
  for (let index = 0; index < 530; index++) {
    const x = 46 + Math.floor(rng() * 747), y = 94 + Math.floor(rng() * 312);
    rect(g, x, y, index % 5 ? 2 : 4, 1, index % 2 ? P.sand : P.leaf, .08);
  }
  if (forest) for (let index = 0; index < 95; index++) {
    const x = Math.round(forest.x - 120 + rng() * 310), y = Math.round(forest.y - 68 + rng() * 152);
    if (y < 96 || Math.hypot((x - forest.x) / 1.6, y - forest.y) > 100 || Math.hypot(x - forest.x, y - forest.y) < 34) continue;
    tree(g, x, y, index % 3 !== 0, 8 + Math.floor(rng() * 5));
  }
  for (const { id, point } of sites) {
    if (id === 'forest') continue;
    const industrial = id !== 'courtyard';
    const columns = id === 'depot' ? 4 : 3, rows = id === 'bunker' ? 2 : 3;
    const x = Math.round(point.x - 54), y = Math.round(point.y - 47);
    const ground = { x: Math.max(44, point.x - 80), y: Math.max(91, point.y - 60), width: 148, height: Math.min(112, 410 - Math.max(91, point.y - 60)) };
    for (const band of pixelLandcoverBands(ground, `district:${id}`, 12)) rect(g, band.x, band.y, band.width, band.height, industrial ? P.soil : P.leafShade, .14);
    for (const band of pixelLandcoverBands({ x: ground.x + 12, y: ground.y + 9, width: ground.width - 30, height: ground.height - 20 }, `district:${id}:edge`, 9)) rect(g, band.x, band.y, band.width, band.height, P.sand, .045);
    if (id === 'reserve' || id === 'bunker') {
      g.lineStyle(1, color(P.panelShade), .4).strokeRect(x - 5, y - 6, columns * 30 + 7, rows * 19 + 8);
      for (let post = 0; post < columns * 30; post += 10) rect(g, x + post, y - 7, 1, 3, P.panelShade, .6);
    }
    for (const symbol of operationsDistrictBuildings({ id, point })) building(g, symbol.x, symbol.y, symbol.width, symbol.height, industrial);
    if (id === 'depot') {
      for (let track = 0; track < 3; track++) {
        const ty = y + 7 + track * 12;
        stroke(g, [{ x: x - 20, y: ty }, { x: x + 110, y: ty + 16 }], P.woodShade, 4, .65);
        for (let sleeper = 0; sleeper < 120; sleeper += 7) stroke(g, [{ x: x - 17 + sleeper, y: ty - 2 + sleeper / 8 }, { x: x - 17 + sleeper, y: ty + 3 + sleeper / 8 }], P.steelShade);
        stroke(g, [{ x: x - 20, y: ty - 1 }, { x: x + 110, y: ty + 15 }], P.panelShade, 1, .65);
      }
    }
  }
  stroke(g, river, P.black, 20);
  stroke(g, river, P.soil, 17, .7);
  stroke(g, river, P.glass, 11);
  for (let index = 2; index < river.length - 1; index += 4) {
    const point = river[index]!;
    rect(g, point.x - 2, point.y, 5, 1, P.glassLight, .55);
  }
  for (const road of roads) {
    stroke(g, road, P.black, 10, .75);
    stroke(g, road, P.concreteShade, 6, .8);
    stroke(g, road, P.sand, 1, .45);
  }
  for (const { point, direction } of operationsMapBridges(roads, river)) {
    const a = { x: point.x - direction.x * 14, y: point.y - direction.y * 14 };
    const b = { x: point.x + direction.x * 14, y: point.y + direction.y * 14 };
    stroke(g, [a, b], P.black, 12);
    stroke(g, [a, b], P.steelLight, 9);
    stroke(g, [a, b], P.concreteShade, 5);
    for (const sign of [-1, 1]) stroke(g, [{ x: a.x - direction.y * 5 * sign, y: a.y + direction.x * 5 * sign }, { x: b.x - direction.y * 5 * sign, y: b.y + direction.x * 5 * sign }], P.steel, 1);
  }
  const grid = OPERATIONS_GRID;
  for (let column = 0; column <= grid.columns; column++) {
    const x = grid.x + column * grid.width / grid.columns;
    stroke(g, [{ x, y: grid.y }, { x, y: grid.y + grid.height }], P.panelShade, 1, .075);
    rect(g, x, grid.y - 3, 1, 4, P.panelShade, .65);
  }
  for (let row = 0; row <= grid.rows; row++) {
    const y = grid.y + row * grid.height / grid.rows;
    stroke(g, [{ x: grid.x, y }, { x: grid.x + grid.width, y }], P.panelShade, 1, .075);
    rect(g, grid.x - 3, y, 4, 1, P.panelShade, .65);
  }
  // A compact headquarters symbol belongs to the existing base, never a new POI.
  rect(g, headquarters.x - 9, headquarters.y - 8, 18, 16, P.yellow);
  rect(g, headquarters.x - 5, headquarters.y - 4, 10, 8, P.ink);
  rect(g, headquarters.x - 2, headquarters.y - 11, 4, 5, P.yellow);
  stroke(g, [{ x: 778, y: 46 }, { x: 778, y: 73 }], P.steelLight);
  stroke(g, [{ x: 767, y: 61 }, { x: 789, y: 61 }], P.steelLight);
  polygon(g, [{ x: 778, y: 44 }, { x: 774, y: 53 }, { x: 782, y: 53 }], P.yellow);
}

/** Distinct district silhouettes stay legible without adding labels or map objects. */
export function paintOperationsDistrictSymbol(g: MapGraphics, id: string, point: OperationsPoint, paint: string): void {
  const x = Math.round(point.x), y = Math.round(point.y);
  if (id === 'forest') {
    for (const offset of [-5, 4]) polygon(g, [{ x: x + offset, y: y - 8 }, { x: x + offset - 4, y: y + 2 }, { x: x + offset + 4, y: y + 2 }], paint);
    rect(g, x - 1, y + 3, 2, 3, paint);
  } else if (id === 'depot') {
    for (const offset of [-4, 4]) rect(g, x + offset, y - 7, 1, 14, paint);
    for (const offset of [-5, 0, 5]) rect(g, x - 6, y + offset, 13, 1, paint);
  } else if (id === 'bunker') {
    rect(g, x - 8, y - 4, 16, 10, paint); rect(g, x - 5, y - 7, 10, 3, paint);
    rect(g, x - 2, y, 4, 6, P.black);
  } else if (id === 'reserve') {
    g.lineStyle(2, color(paint)).strokeRect(x - 7, y - 6, 14, 12);
    stroke(g, [{ x: x - 5, y: y - 4 }, { x: x + 5, y: y + 4 }], paint);
    stroke(g, [{ x: x - 5, y: y + 4 }, { x: x + 5, y: y - 4 }], paint);
  } else {
    rect(g, x - 8, y - 4, 6, 10, paint); rect(g, x + 1, y - 7, 7, 13, paint);
    if (id === 'factory') rect(g, x + 4, y - 11, 2, 6, paint);
    else { rect(g, x - 6, y - 1, 2, 2, P.black); rect(g, x + 3, y - 4, 2, 2, P.black); }
  }
}
