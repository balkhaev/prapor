import type { LiveCityBuilding } from './game/live';
import type { BuildingFacade } from './building-architecture';
import { PIXEL_TILE, pixelSeed } from './pixel-art';

export type FacadeWindow = {
  /** Centre along the visible span, in world cells relative to facade.u. */
  u: number; width: number;
  /** Native pixel elevations, before the exterior elevation scale. */
  low: number; high: number; floor: number; variation: number;
  style: 'regular' | 'tall' | 'paired' | 'ribbon';
  balcony: 'none' | 'open' | 'solid' | 'glazed';
};
export type FacadeBand = {
  /** LEFT edge along the visible span, in the same units as window.u. */
  u: number; width: number; low: number; high: number;
  role: 'accent' | 'accentShade' | 'trim' | 'joint' | 'patch';
};
export type BuildingFacadeLayout = { family: string; windows: FacadeWindow[]; bands: FacadeBand[]; doors: number[] };
export const BUILDING_FACADE_LIMITS = { windows: 24, bands: 8 } as const;

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
function facadeFamily(building: LiveCityBuilding, seed: number): string {
  if (building.kind === 'workshop' || building.kind === 'garage') return seed % 2 ? 'industrial-ribbon' : 'industrial-bays';
  if (building.kind === 'shop') return 'shopfront';
  if (building.kind === 'service') return seed % 2 ? 'civic-banded' : 'civic-arcade';
  if (building.facade === 'panel') return (['panel-loggia', 'panel-stairwell', 'panel-ribbon'] as const)[seed % 3]!;
  if (building.facade === 'brick') return seed % 3 ? 'courtyard-brick' : 'townhouse';
  return seed % 3 ? 'shuttered-plaster' : 'townhouse';
}

/** Shared facade grammar, not another set of buildings. Global bay positions
 * survive stepped wings and every viewing distance. Entrance order, camera,
 * absolute map position and hidden contents do not choose the architecture. */
export function buildingFacadeLayout(building: LiveCityBuilding, facade: BuildingFacade): BuildingFacadeLayout {
  const seed = pixelSeed(building.id), family = facadeFamily(building, seed);
  const result: BuildingFacadeLayout = { family, windows: [], bands: [], doors: [] };
  const { length, side } = facade, bottom = facade.bottom * PIXEL_TILE, top = facade.top * PIXEL_TILE;
  const fullLength = side === 'y' ? building.width : building.height;
  if (![length, facade.u, facade.plane, bottom, top, fullLength, facade.floors].every(Number.isFinite)
    || length <= .3 || fullLength <= .3 || top <= bottom || facade.floors < 1) return result;
  const floors = clamp(Math.floor(facade.floors), 1, 4), industrial = family.startsWith('industrial'), panel = family.startsWith('panel');
  const outer = side === 'y' ? facade.plane === building.height : facade.plane === building.width;
  if (outer && facade.bottom === 0) result.doors = [...new Set(building.entrances.filter(door => side === 'y'
    ? door.y === building.y + building.height - 1 : door.x === building.x + building.width - 1)
    .map(door => (side === 'y' ? door.x - building.x : door.y - building.y) + 1 - facade.u)
    .filter(u => Number.isFinite(u) && u > 0 && u < length))].sort((a, b) => a - b);

  const pitch = industrial ? family === 'industrial-ribbon' ? 4.1 : 3.6 : family === 'shopfront' ? 3.8
    : panel ? family === 'panel-ribbon' ? 3.8 : 3.15 : family.startsWith('civic') ? 3.3 : family === 'townhouse' ? 2.9 : 2.6;
  const columns = clamp(Math.round((fullLength - .6) / pitch), 1, 6), spacing = fullLength / (columns + 1);
  const centres = Array.from({ length: columns }, (_, column) => {
    const pairOffset = family === 'courtyard-brick' && columns >= 4 ? (column % 2 ? -.13 : .13) * Math.min(1, spacing / 2) : 0;
    return spacing * (column + 1) + pairOffset;
  });
  const stairColumns = new Set<number>();
  for (const door of result.doors) {
    let nearest = 0;
    for (let column = 1; column < columns; column++) if (Math.abs(centres[column]! - facade.u - door) < Math.abs(centres[nearest]! - facade.u - door)) nearest = column;
    stairColumns.add(nearest);
  }
  if (panel) stairColumns.add((seed >>> 5) % columns);
  const balcony = (column: number): FacadeWindow['balcony'] => {
    if (building.kind !== 'apartment' || stairColumns.has(column)) return 'none';
    if (family === 'panel-loggia') return column % 2 === seed % 2 ? 'glazed' : 'solid';
    if (family === 'panel-stairwell') return (column + seed) % 2 ? 'solid' : 'open';
    if (family === 'panel-ribbon') return (column + seed) % 3 === 0 ? 'glazed' : 'none';
    if (family === 'courtyard-brick') return (column + seed) % 3 === 0 ? 'open' : 'none';
    if (family === 'townhouse') return (column + seed) % 4 === 0 ? 'solid' : 'none';
    return (column + seed) % 4 === 0 ? 'open' : 'none';
  };
  const widthFor = (floor: number, column: number): number => Math.min(spacing * .68, industrial ? family === 'industrial-ribbon' ? 2.25 : 1.3
    : family === 'shopfront' && !floor ? 2.05 : family === 'civic-arcade' && !floor ? 1.25 : family.startsWith('civic') ? 1.05
      : panel ? family === 'panel-ribbon' ? 1.48 : stairColumns.has(column) ? .67 : family === 'panel-loggia' ? 1.12 : .9
        : family === 'courtyard-brick' && column % 2 === 0 ? 1.02 : family === 'townhouse' && floor > 0 ? 1.04 : .75);
  const addWindow = (u: number, column: number, floor: number, narrow = false): void => {
    if (result.windows.length >= BUILDING_FACADE_LIMITS.windows) return;
    let width = Math.min(widthFor(floor, column), length - .46);
    // Real doorway/canopy bays remain open on the ground floor. Their upper
    // windows can form a stairwell but never receive a balcony stack.
    if (!floor && result.doors.length) {
      const clear = Math.min(...result.doors.map(door => Math.abs(door - u))) - (industrial ? 1.2 : .62);
      width = Math.min(width, clear * 2 - .015);
    }
    if (width < (industrial || family === 'shopfront' ? .65 : .4) || u - width / 2 < .16 || u + width / 2 > length - .16) return;
    const style: FacadeWindow['style'] = industrial ? family === 'industrial-ribbon' ? 'ribbon' : 'paired'
      : family === 'shopfront' && !floor ? 'ribbon' : family.startsWith('civic') || family === 'shuttered-plaster' || panel && stairColumns.has(column) ? 'tall'
        : family === 'panel-ribbon' || family === 'courtyard-brick' && column % 2 === 0 || family === 'townhouse' && floor > 0 ? 'paired' : 'regular';
    const low = industrial ? floors === 1 ? top - 35 : 42 + floor * 73 : (panel ? 28 : family === 'shopfront' && !floor ? 17 : 22) + floor * 73;
    const high = Math.min(top - 12, low + (industrial ? 20 : family === 'shopfront' && !floor ? 39 : style === 'tall' ? 34 : style === 'paired' ? 29 : 27));
    // Hidden return walls start above the adjoining roof. Never clamp a window
    // into a new shape at that roof edge, or invent a ground-level portal.
    if (low < bottom + 5 || high - low < 15) return;
    result.windows.push({ u, width, low, high, floor, style,
      variation: pixelSeed(`${building.id}:${side}:${column}:${floor}`),
      balcony: floor > 0 && !narrow && low - 20 >= bottom + 2 ? balcony(column) : 'none' });
  };
  for (let floor = 0; floor < floors; floor++) {
    const start = result.windows.length;
    for (let column = 0; column < columns; column++) addWindow(centres[column]! - facade.u, column, floor);
    // A narrow stepped wing may sit between two global bays. Give it a single
    // properly bounded opening, rather than squeezing half an opening in.
    if (result.windows.length === start && length >= 1.2 && length < spacing * 1.35) addWindow(length / 2, columns + Math.round(facade.u * 8), floor, true);
  }

  const band = (u: number, width: number, low: number, high: number, role: FacadeBand['role']): void => {
    if (result.bands.length >= BUILDING_FACADE_LIMITS.bands) return;
    const left = Math.max(.08, u), right = Math.min(length - .08, u + width);
    low = Math.max(bottom, low); high = Math.min(top, high);
    if (right - left >= .08 && high - low >= 1) result.bands.push({ u: left, width: right - left, low, high, role });
  };
  const globalBand = (u: number, width: number, low: number, high: number, role: FacadeBand['role']): void => band(u - facade.u, width, low, high, role);
  // Plinth and cornice are calm continuous masses; accents below describe a
  // stair core, balcony recess or real structural bay, never random wall noise.
  if (facade.bottom === 0) band(.08, length - .16, 0, family === 'shopfront' ? 13 : 15, 'accentShade');
  band(.08, length - .16, top - (family.startsWith('civic') ? 14 : 10), top - 4, 'trim');
  if (panel) {
    if (family === 'panel-ribbon') for (let floor = 1; floor < floors; floor++) band(.08, length - .16, floor * 73 - 8, floor * 73 + 3, 'accent');
    for (let column = 0; column < columns; column++) {
      if (stairColumns.has(column)) globalBand(centres[column]! - .64, 1.28, 15, top - 10, 'accent');
      else if (family === 'panel-loggia' && balcony(column) !== 'none') globalBand(centres[column]! - .72, 1.44, 20, top - 12, 'accentShade');
    }
    if (family === 'panel-stairwell') for (let floor = 1; floor < floors; floor++) band(.1, length - .2, floor * 73 - 2, floor * 73 + 2, 'joint');
  } else if (family === 'shopfront') {
    band(.08, length - .16, 66, Math.min(83, top - 11), 'accent');
    for (const u of [0, fullLength - .2]) globalBand(u, .2, 15, top - 10, 'accentShade');
  } else if (family.startsWith('industrial')) {
    band(.08, length - .16, 21, 27, 'accent');
    if (family === 'industrial-bays') for (let column = 1; column <= Math.min(4, columns); column++) globalBand(spacing * column - spacing * .5, .13, 15, top - 10, 'joint');
    else band(.1, length - .2, Math.max(bottom, top - 43), top - 39, 'accentShade');
  } else if (family.startsWith('civic')) {
    for (const u of [0, fullLength - .36]) globalBand(u, .36, 15, top - 14, 'accentShade');
    if (family === 'civic-arcade') {
      for (let column = 1; column < Math.min(columns, 4); column++) globalBand(spacing * (column + .5) - .09, .18, 15, 65, 'trim');
      band(.1, length - .2, 66, 72, 'accent');
    } else for (let floor = 1; floor < floors; floor++) band(.1, length - .2, floor * 73 - 5, floor * 73 + 3, 'accent');
  } else {
    for (const u of [0, fullLength - .24]) globalBand(u, .24, 15, top - 10, family === 'courtyard-brick' ? 'accentShade' : 'trim');
    for (let floor = 1; floor < floors; floor++) band(.1, length - .2, floor * 73 - 5, floor * 73 + 1, family === 'townhouse' ? 'accent' : 'trim');
    if (family === 'townhouse') globalBand(fullLength * .5 - .16, .32, 15, top - 10, 'trim');
  }
  return result;
}
