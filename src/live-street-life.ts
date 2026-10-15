import type { LiveCityBuilding } from './game/live';
import { pixelSeed } from './pixel-art';

export type BuildingStreetSign = { label: string; board: string; lettering: string; edge: string };

/** Names describe the published building use. Private room/loot data never
 * determines a business sign, and homes cannot acquire an invented shop. */
export function buildingStreetSign(building: Pick<LiveCityBuilding, 'id' | 'kind'>): BuildingStreetSign | null {
  const seed = pixelSeed(building.id);
  if (building.kind === 'shop') return {
    label: ['ПРОДУКТЫ', 'МАГАЗИН', 'МАРКЕТ'][seed % 3]!,
    board: ['#426c59', '#976a4f', '#547581'][seed % 3]!, lettering: '#eadbb7', edge: '#273e37',
  };
  if (building.kind === 'service') return {
    label: ['СЕРВИС', 'РЕМОНТ', 'МАСТЕР'][seed % 3]!,
    board: ['#4e7280', '#586f68', '#826b4f'][seed % 3]!, lettering: '#e5d5ab', edge: '#273e37',
  };
  if (building.kind === 'workshop') return { label: 'МАСТЕРСКАЯ', board: '#7c7359', lettering: '#e0cf9f', edge: '#354b43' };
  return null;
}

const GLYPHS: Record<string, readonly string[]> = {
  А: ['010','101','111','101','101'], В: ['110','101','110','101','110'], Г: ['111','100','100','100','100'],
  Д: ['010','110','110','111','101'], Е: ['111','100','110','100','111'], З: ['110','001','010','001','110'],
  И: ['101','101','111','101','101'], К: ['101','101','110','101','101'], М: ['101','111','111','101','101'],
  Н: ['101','101','111','101','101'], О: ['010','101','101','101','010'], П: ['111','101','101','101','101'],
  Р: ['110','101','110','100','100'], С: ['011','100','100','100','011'], Т: ['111','010','010','010','010'],
  У: ['101','101','011','001','110'], Ы: ['101','101','111','101','111'], Я: ['011','101','011','101','101'],
};

/** Tiny painted Cyrillic, portable to a facade polygon at any raster level.
 * The callback receives normalized rectangles, never browser font metrics. */
export function streetSignLettering(label: string, paint: (x: number, y: number, width: number, height: number) => void): void {
  const width = label.length * 4 - 1;
  if (width < 1 || label.length > 16) return;
  for (let index = 0; index < label.length; index++) {
    const glyph = GLYPHS[label[index]!];
    if (!glyph) continue;
    for (let row = 0; row < 5; row++) for (let column = 0; column < 3; column++) {
      if (glyph[row]![column] === '1') paint((index * 4 + column) / width, row / 5, 1 / width, .2);
    }
  }
}
