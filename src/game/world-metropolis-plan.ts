import type { LiveCityRegion, LiveLandscapePath, LivePoint } from './live';

export const METROPOLIS_SIZE = 1024;
export const METROPOLIS_CORE_SHIFT = 256;
export const METROPOLIS_CORE = { x: 256, y: 256, width: 512, height: 512 } as const;
export type MetropolisUse = 'works' | 'civic' | 'campus' | 'port' | 'park' | 'station' | 'waterfront' | 'market' | 'housing' | 'garden';
export interface MetropolisQuarter { id: string; name: string; x: number; y: number; width: number; height: number; use: MetropolisUse; buildings: number; band: 'north' | 'south' | 'west' | 'east' }
export const METROPOLIS_QUARTERS: readonly MetropolisQuarter[] = [
  { id: 'metro-northworks', name: 'Северный промрайон', x: 128, y: 128, width: 192, height: 240, use: 'works', buildings: 4, band: 'north' },
  { id: 'metro-civic', name: 'Административный район', x: 320, y: 128, width: 192, height: 240, use: 'civic', buildings: 6, band: 'north' },
  { id: 'metro-campus', name: 'Университетская слобода', x: 512, y: 128, width: 192, height: 240, use: 'campus', buildings: 6, band: 'north' },
  { id: 'metro-port', name: 'Речной грузовой район', x: 704, y: 128, width: 192, height: 240, use: 'port', buildings: 5, band: 'north' },
  { id: 'metro-westpark', name: 'Западный парковый район', x: 128, y: 368, width: 240, height: 144, use: 'park', buildings: 6, band: 'west' },
  { id: 'metro-weststation', name: 'Западная сортировочная', x: 128, y: 512, width: 240, height: 144, use: 'station', buildings: 5, band: 'west' },
  { id: 'metro-eastbank', name: 'Восточная набережная', x: 656, y: 368, width: 240, height: 144, use: 'waterfront', buildings: 7, band: 'east' },
  { id: 'metro-eastmarket', name: 'Речной посад', x: 656, y: 512, width: 240, height: 144, use: 'market', buildings: 6, band: 'east' },
  { id: 'metro-southwest', name: 'Юго-западные микрорайоны', x: 128, y: 656, width: 192, height: 240, use: 'housing', buildings: 8, band: 'south' },
  { id: 'metro-southcenter', name: 'Новые кварталы', x: 320, y: 656, width: 192, height: 240, use: 'housing', buildings: 8, band: 'south' },
  { id: 'metro-gardens', name: 'Садовый район', x: 512, y: 656, width: 192, height: 240, use: 'garden', buildings: 6, band: 'south' },
  { id: 'metro-southeast', name: 'Южные мастерские', x: 704, y: 656, width: 192, height: 240, use: 'works', buildings: 5, band: 'south' },
];
export const METROPOLIS_CITY: LiveCityRegion = { name: 'Ольховск', x: 128, y: 128, width: 768, height: 768, quarters: [
  { id: 'old-center', name: 'Старый центр', x: 368, y: 368, width: 144, height: 144 },
  { id: 'industrial', name: 'Заводской квартал', x: 512, y: 368, width: 144, height: 144 },
  { id: 'station', name: 'Вокзальный квартал', x: 368, y: 512, width: 144, height: 144 },
  { id: 'residential', name: 'Южные дворы', x: 512, y: 512, width: 144, height: 144 },
  ...METROPOLIS_QUARTERS.map(({ id, name, x, y, width, height }) => ({ id, name, x, y, width, height })),
] };
export const inMetropolisCore = (x: number, y: number): boolean => x >= 256 && x < 768 && y >= 256 && y < 768;
export const metropolisHash = (text: string): number => { let value = 2166136261; for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return value >>> 0; };

type Rect = LivePoint & { width: number; height: number };
export type MetropolisParcelLayout = 'lane' | 'court' | 'yard' | 'garden';
export interface MetropolisParcelPlan {
  id: string; quarterId: string; slot: number; rect: Rect; use: MetropolisUse;
  layout: MetropolisParcelLayout; axis: 'x' | 'y'; access: [LivePoint, LivePoint];
}

// Regional streets bend around the older town, river and goods yard. Their
// clear frontage determines the lots instead of crossing an unrelated grid.
const points = (values: number[][]): LivePoint[] => values.map(([x, y]) => ({ x: x!, y: y! }));
const north = points([[128, 180], [190, 188], [286, 178], [388, 195], [494, 181], [594, 202], [700, 182], [832, 192], [896, 182]]);
const south = points([[128, 842], [186, 836], [288, 850], [402, 824], [510, 840], [620, 820], [724, 846], [838, 832], [896, 844]]);
const west = points([[190, 188], [174, 278], [196, 365], [180, 438], [202, 514], [176, 590], [194, 670], [166, 746], [186, 836]]);
const east = points([[832, 192], [852, 278], [826, 368], [846, 440], [822, 512], [850, 588], [830, 666], [862, 746], [838, 832]]);
const alongStreet = (line: readonly LivePoint[], at: number, axis: 'x' | 'y'): LivePoint => {
  const other = axis === 'x' ? 'y' : 'x';
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!, b = line[i]!;
    if (at >= a[axis] && at <= b[axis]) return { [axis]: at, [other]: Math.round(a[other] + (b[other] - a[other]) * (at - a[axis]) / (b[axis] - a[axis])) } as LivePoint;
  }
  return { ...line[at < line[0]![axis] ? 0 : line.length - 1]! };
};
function streetRange(line: readonly LivePoint[], lo: number, hi: number, axis: 'x' | 'y'): [number, number] {
  const other = axis === 'x' ? 'y' : 'x';
  const samples = [alongStreet(line, lo, axis)[other], alongStreet(line, hi, axis)[other], ...line.filter(p => p[axis] > lo && p[axis] < hi).map(p => p[other])];
  return [Math.min(...samples), Math.max(...samples)];
}
function parcelLayout(use: MetropolisUse, slot: number): MetropolisParcelLayout {
  if (use === 'works' || use === 'port' || use === 'station') return slot % 3 ? 'yard' : 'lane';
  if (use === 'park' || use === 'garden') return slot % 3 ? 'garden' : 'court';
  if (use === 'market' || use === 'waterfront') return slot % 2 ? 'lane' : 'court';
  return (['court', 'garden', 'lane', 'court'] as const)[slot % 4]!;
}

/** Shared light geometry for architecture, land use and the entry map.
 * Quarter rectangles are administrative metadata, never material borders. */
export function metropolisParcelPlan(): MetropolisParcelPlan[] {
  const result: MetropolisParcelPlan[] = [];
  for (const quarter of METROPOLIS_QUARTERS) for (let slot = 0; slot < 8; slot++) {
    const horizontalBand = quarter.band === 'north' || quarter.band === 'south', axis = horizontalBand ? 'y' : 'x';
    let rect: Rect;
    if (horizontalBand) {
      const row = Math.floor(slot / 4), column = slot % 4, outerWest = quarter.x === 128, outerEast = quarter.x === 704;
      const ranges = outerWest
        ? row ? [[6, 31], [78, 32], [116, 29], [152, 34]] : [[6, 38], [78, 29], [113, 31], [150, 36]]
        : outerEast ? row ? [[14, 26], [50, 30], [88, 26], [154, 34]] : [[12, 28], [48, 32], [88, 28], [152, 36]]
          : row ? [[7, 32], [48, 45], [101, 42], [151, 34]] : [[5, 39], [51, 43], [102, 32], [142, 44]];
      const [offset, width] = ranges[column]!, x = quarter.x + offset!, span = width!;
      const line = quarter.band === 'north' ? north : south, [low, high] = streetRange(line, x - 2, x + span + 2, 'x');
      const depth = 37 + metropolisHash(quarter.id + ':' + slot) % 17;
      const lo = quarter.band === 'north' ? 132 : 772, hi = quarter.band === 'north' ? 254 : 892;
      const bottom = row ? Math.min(hi, high + 9 + depth) : low - 9;
      const top = row ? high + 9 : Math.max(lo, bottom - depth);
      rect = { x, y: top, width: span, height: bottom - top };
    } else {
      const row = Math.floor(slot / 2), column = slot % 2;
      const starts = column ? [7, 43, 78, 112] : [4, 39, 74, 110], heights = column ? [29, 27, 29, 27] : [27, 29, 28, 29];
      const y = quarter.y + starts[row]!, height = heights[row]!, line = quarter.band === 'west' ? west : east;
      const [low, high] = streetRange(line, y - 2, y + height + 2, 'y');
      const lo = quarter.band === 'west' ? 132 : 772, hi = quarter.band === 'west' ? 252 : 892;
      const left = column ? high + 9 : lo + slot % 3, right = column ? hi - slot % 3 : low - 9;
      rect = { x: left, y, width: right - left, height };
    }
    const use: MetropolisUse = slot === 7 && quarter.use === 'works' ? 'civic' : quarter.use === 'waterfront' && slot >= 6 ? 'market' : quarter.use;
    const layout = parcelLayout(use, slot), cross = axis === 'y' ? rect.x + Math.floor(rect.width / 2) : rect.y + Math.floor(rect.height / 2);
    const shift = layout === 'lane' ? 0 : layout === 'yard' ? 1 : slot % 2 ? 2 : -2;
    const nearHigh = horizontalBand ? slot < 4 : slot % 2 === 0;
    const near = axis === 'y' ? { x: cross + shift, y: nearHigh ? rect.y + rect.height - 1 : rect.y } : { x: nearHigh ? rect.x + rect.width - 1 : rect.x, y: cross + shift };
    const far = axis === 'y' ? { x: cross - shift, y: nearHigh ? rect.y : rect.y + rect.height - 1 } : { x: nearHigh ? rect.x : rect.x + rect.width - 1, y: cross - shift };
    result.push({ id: quarter.id + '-block-' + slot, quarterId: quarter.id, slot, rect, use, layout, axis, access: [near, far] });
  }
  return result;
}

export function metropolisStreetPlan(): LiveLandscapePath[] {
  const paths: LiveLandscapePath[] = [];
  const road = (id: string, name: string, line: LivePoint[], width: number) => paths.push({ id: 'metro-' + id, name, kind: 'road', width, points: line.map(p => ({ ...p })) });
  road('north-boulevard', 'Северный городской тракт', north, 5);
  road('south-boulevard', 'Южный жилой проспект', south, 5);
  road('station-avenue', 'Станционный проспект', west, 4);
  road('river-avenue', 'Речная улица', east, 4);
  for (const at of [188, 512, 836]) {
    const nx = at === 188 ? 190 : at === 836 ? 832 : at, sx = at === 188 ? 186 : at === 836 ? 838 : at;
    const wy = at === 188 ? 188 : at === 836 ? 836 : at, ey = at === 188 ? 192 : at === 836 ? 832 : at;
    road('north-entry-' + at, 'Северный подъезд', [{ x: at, y: 18 }, { x: nx - 16, y: 78 }, { x: nx, y: 128 }, alongStreet(north, nx, 'x')], 6);
    road('south-entry-' + at, 'Южный подъезд', [alongStreet(south, sx, 'x'), { x: sx, y: 896 }, { x: sx + 13, y: 947 }, { x: at, y: 1005 }], 6);
    road('west-entry-' + at, 'Западный подъезд', [{ x: 18, y: at }, { x: 84, y: wy - 14 }, { x: 128, y: wy }, alongStreet(west, wy, 'y')], 6);
    road('east-entry-' + at, 'Восточный подъезд', [alongStreet(east, ey, 'y'), { x: 896, y: ey }, { x: 949, y: ey + 14 }, { x: 1005, y: at }], 6);
  }
  for (const at of [320, 512, 748]) {
    road('core-north-' + at, 'Старая дорога к городу', [alongStreet(north, at, 'x'), { x: at, y: 255 }], 3);
    road('core-south-' + at, 'Старая дорога к городу', [{ x: at, y: 768 }, alongStreet(south, at, 'x')], 3);
  }
  for (const at of [368, 512, 656]) {
    road('core-west-' + at, 'Проезд к старым кварталам', [alongStreet(west, at, 'y'), { x: 255, y: at }], 3);
    road('core-east-' + at, 'Проезд к старым кварталам', [{ x: 768, y: at }, alongStreet(east, at, 'y')], 3);
  }
  for (const parcel of metropolisParcelPlan()) {
    const quarter = METROPOLIS_QUARTERS.find(q => q.id === parcel.quarterId)!;
    const near = parcel.access[0], frontage = parcel.axis === 'y' ? alongStreet(quarter.band === 'north' ? north : south, near.x, 'x') : alongStreet(quarter.band === 'west' ? west : east, near.y, 'y');
    road('access-' + parcel.id, parcel.layout === 'yard' ? 'Подъезд товарного двора' : 'Квартальный проезд', [frontage, near], parcel.layout === 'yard' ? 3 : 2);
  }
  return paths;
}
