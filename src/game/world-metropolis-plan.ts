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

export function metropolisStreetPlan(): LiveLandscapePath[] {
  const paths: LiveLandscapePath[] = [];
  const road = (id: string, name: string, points: LivePoint[], width: number) => paths.push({ id: `metro-${id}`, name, kind: 'road', width, points });
  const loop = (id: string, name: string, lo: number, hi: number, width: number) => road(id, name, [{ x: lo, y: lo }, { x: hi, y: lo }, { x: hi, y: hi }, { x: lo, y: hi }, { x: lo, y: lo }], width);
  loop('outer-ring', 'Внешняя окружная', 64, 960, 8);
  loop('city-ring', 'Городская окружная', 128, 896, 8);
  loop('inner-ring', 'Обводный проспект', 248, 776, 8);
  for (const y of [188, 836]) road(`collector-y-${y}`, y === 188 ? 'Северный бульвар' : 'Южный бульвар', [{ x: 128, y }, { x: 896, y }], 4);
  for (const x of [188, 836]) road(`collector-x-${x}`, x === 188 ? 'Станционный проспект' : 'Речной проспект', [{ x, y: 128 }, { x, y: 896 }], 4);
  for (let x = 176; x < 896; x += 48) {
    if (x === 704) continue; // The old eastern river continues in this waterfront corridor.
    for (const [top, bottom] of [[128, 248], [776, 896]]) road(`local-x-${x}-${top}`, 'Квартальная улица', [{ x, y: top! }, { x, y: bottom! }], 3);
  }
  for (let y = 368; y <= 656; y += 36) for (const [left, right] of [[128, 248], [776, 896]]) road(`local-y-${y}-${left}`, 'Дворовая улица', [{ x: left!, y }, { x: right!, y }], 3);
  for (const at of [188, 512, 836]) {
    road(`north-entry-${at}`, 'Северный подъезд', [{ x: at, y: 18 }, { x: at, y: 128 }], 6);
    road(`south-entry-${at}`, 'Южный подъезд', [{ x: at, y: 896 }, { x: at, y: 1005 }], 6);
    road(`west-entry-${at}`, 'Западный подъезд', [{ x: 18, y: at }, { x: 128, y: at }], 6);
    road(`east-entry-${at}`, 'Восточный подъезд', [{ x: 896, y: at }, { x: 1005, y: at }], 6);
  }
  // Short open-ground approaches stop at the immutable core boundary. Its real
  // edge tiles and the older regional road network remain completely intact.
  for (const at of [280, 512, 744]) {
    road(`core-north-${at}`, 'Подход к старым кварталам', [{ x: at, y: 248 }, { x: at, y: 255 }], 3);
    road(`core-south-${at}`, 'Подход к старым кварталам', [{ x: at, y: 768 }, { x: at, y: 776 }], 3);
    road(`core-west-${at}`, 'Подход к старым кварталам', [{ x: 248, y: at }, { x: 255, y: at }], 3);
    road(`core-east-${at}`, 'Подход к старым кварталам', [{ x: 768, y: at }, { x: 776, y: at }], 3);
  }
  return paths;
}
