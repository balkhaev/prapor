import type { ShelterRoomType } from './game/shelter';
import { PIXEL_PALETTE as P, type PixelRaster } from './pixel-art';
import { pixelSvg } from './pixel-svg';

const cache = new Map<ShelterRoomType, string>();
const labels: Record<ShelterRoomType, string> = {
  workshop: 'Оружейная мастерская: верстак, инструменты и станок',
  ammo: 'Патронный цех: снаряжательные прессы и коробки патронов',
  recycler: 'Разборочная: дробилка, конвейер и сортировка деталей',
  medbay: 'Медблок: лечебная койка и медицинское оборудование',
  radio: 'Радиорубка: радиостанция, монитор и карта',
  storage: 'Склад: металлические стеллажи и ящики с припасами',
  dormitory: 'Жилой блок: двухъярусные кровати и шкафчики',
  hangar: 'Ангар: складские ряды и погрузчик',
};

/** Cutaway thumbnails use the world's 2:1 projection and native materials. */
export function pixelRoomArt(type: ShelterRoomType): string {
  const old = cache.get(type); if (old) return old;
  const svg = pixelSvg(240, 128, r => paintRoom(r, type)).replace('shape-rendering=', `role="img" aria-label="${labels[type]}" shape-rendering=`);
  cache.set(type, svg);
  return svg;
}

function paintRoom(r: PixelRaster, type: ShelterRoomType): void {
  const p = (x: number, y: number, z = 0) => ({ x: Math.round(108 + (x - y) * 23), y: Math.round(40 + (x + y) * 11 - z) });
  const face = (points: ReturnType<typeof p>[], color: string) => { r.polygon(points, color); points.forEach((a, i) => { const b = points[(i + 1) % points.length]!; r.line(a.x, a.y, b.x, b.y, P.ink); }); };
  const line = (x: number, y: number, z: number, xx: number, yy: number, zz: number, color: string, w = 1) => { const a = p(x, y, z), b = p(xx, yy, zz); r.line(a.x, a.y, b.x, b.y, color, w); };
  const box = (x: number, y: number, w: number, d: number, h: number, top: string = P.steelLight, front: string = P.steel, side: string = P.steelShade, z = 0) => {
    face([p(x, y + d, z), p(x + w, y + d, z), p(x + w, y + d, z + h), p(x, y + d, z + h)], front);
    face([p(x + w, y, z), p(x + w, y + d, z), p(x + w, y + d, z + h), p(x + w, y, z + h)], side);
    face([p(x, y, z + h), p(x + w, y, z + h), p(x + w, y + d, z + h), p(x, y + d, z + h)], top);
  };
  const crate = (x: number, y: number, w = .65, d = .55, z = 0) => {
    box(x, y, w, d, 12, P.woodLight, P.wood, P.woodShade, z);
    line(x + .14, y + d, z + 2, x + .14, y + d, z + 11, P.cream);
    line(x + w - .12, y + d, z + 2, x + w - .12, y + d, z + 11, P.woodShade);
  };
  const rack = (x: number, y: number, w: number, levels = 2) => {
    for (let level = levels - 1; level >= 0; level--) {
      box(x, y, w, .48, 3, P.steelLight, P.steel, P.steelShade, level * 17 + 5);
      crate(x + .12, y + .03, .52, .4, level * 17 + 8);
      if (w > 1.2) crate(x + .85, y + .03, .48, .4, level * 17 + 8);
    }
    for (const xx of [x, x + w]) line(xx, y + .5, 0, xx, y + .5, levels * 17 + 5, P.steelLight, 2);
  };
  const bed = (x: number, y: number, bunk = false) => {
    for (const z of bunk ? [5, 28] : [7]) {
      box(x, y, 1.55, .75, 4, P.plaster, P.plasterShade, P.steelShade, z);
      box(x + .4, y, 1.12, .75, 3, P.blue, P.steelShade, P.roofShade, z + 4);
      box(x + .06, y + .07, .27, .6, 3, P.cream, P.plaster, P.plasterShade, z + 4);
    }
    for (const xx of [x, x + 1.55]) for (const yy of [y, y + .75]) line(xx, yy, 0, xx, yy, bunk ? 38 : 17, P.steelLight, 2);
  };
  const bench = (x: number, y: number, w: number) => {
    for (const xx of [x + .1, x + w - .1]) line(xx, y + .4, 0, xx, y + .4, 18, P.steelShade, 3);
    box(x, y, w, .65, 4, P.woodLight, P.wood, P.woodShade, 18);
  };
  r.rect(0, 0, 240, 128, '#232a21');
  r.ellipse(124, 105, 89, 15, '#171c18');
  box(0, 0, 4, 3, 5, P.concreteShade, P.roofShade, P.ink, -5);
  face([p(0, 3), p(0, 0), p(0, 0, 31), p(0, 3, 31)], P.plasterShade);
  face([p(0, 0), p(4, 0), p(4, 0, 31), p(0, 0, 31)], P.plaster);
  for (let z = 8; z < 31; z += 8) { line(0, 0, z, 4, 0, z, '#b2a58b'); line(0, 0, z, 0, 3, z, '#897d67'); }
  for (let x = .5; x < 4; x += .5) line(x, 0, 0, x, 3, 0, '#87917f');
  for (let y = .5; y < 3; y += .5) line(0, y, 0, 4, y, 0, '#87917f');
  line(0, 0, 31, 4, 0, 31, P.cream, 2); line(0, 0, 31, 0, 3, 31, P.steelLight, 2);
  line(.5, .01, 28, 1.25, .01, 28, P.yellow, 2);
  switch (type) {
    case 'workshop': {
      box(.3, .02, 2, .06, 16, P.steel, P.black, P.steelShade, 10);
      for (const x of [.5, .85, 1.2, 1.55, 1.9]) line(x, .12, 13, x, .12, 22, P.steelLight, 2);
      bench(.3, .2, 2.3); box(2.85, .3, .65, .6, 27);
      box(.65, .35, .85, .12, 3, P.black, P.rubber, P.ink, 23);
      line(1.4, .4, 24, 2.25, .4, 24, P.steelLight, 2); crate(2.9, 1.65); break;
    }
    case 'ammo':
      bench(.35, .3, 2.3);
      for (const x of [.6, 1.6]) { box(x, .45, .42, .32, 14, P.steelLight, P.steel, P.steelShade, 23); line(x + .2, .6, 36, x + .55, .6, 43, P.yellow, 2); }
      rack(2.9, .2, .65); crate(2.75, 1.7); break;
    case 'recycler':
      box(.5, .5, 1.25, .9, 30); box(.65, .6, .95, .6, 3, P.ink, P.black, P.steelShade, 30);
      box(1.75, .8, 1.5, .5, 5, P.steel, P.rubber, P.steelShade, 12);
      for (let x = 1.9; x < 3.1; x += .2) line(x, .8, 17, x, 1.3, 17, P.steelLight);
      crate(2.75, 1.9); box(.5, .5, 1.2, .06, 5, P.yellow, P.yellow, P.rust, 12); break;
    case 'medbay': {
      box(.35, .35, .65, .5, 27, P.cream, P.panel, P.panelShade);
      bed(1.3, .65); const cross = p(2.8, .03, 20); r.rect(cross.x - 5, cross.y - 1, 11, 3, P.red); r.rect(cross.x - 1, cross.y - 5, 3, 11, P.red);
      line(3.45, 1.25, 0, 3.45, 1.25, 34, P.steelLight, 2); box(3.25, 1.25, .2, .15, 8, P.glassLight, P.glass, P.steelShade, 22); break;
    }
    case 'radio':
      bench(.35, .4, 2.75); box(.65, .5, .8, .16, 15, P.steelLight, P.black, P.steelShade, 22);
      box(.75, .67, .55, .02, 10, P.glass, P.glassLight, P.glass, 25);
      line(.8, .71, 30, 1.25, .71, 30, P.cream); box(1.8, .45, .6, .5, 11, P.steel, P.black, P.steelShade, 22);
      line(2.1, .55, 33, 2.1, .55, 45, P.steelLight); box(2.9, 1.8, .5, .5, 12, P.wood, P.woodShade, P.ink); break;
    case 'storage': rack(.25, .25, 1.65); rack(2.15, .25, 1.55); crate(2.5, 1.75, .9); crate(.5, 1.8, .8); break;
    case 'dormitory': bed(.2, .4, true); box(2, .3, .55, .5, 31, P.panel, P.roof, P.roofShade); bed(2.15, 1.65, true); break;
    case 'hangar':
      rack(.25, .25, 1.65, 3); rack(2.3, .25, 1.3, 3);
      box(1.8, 1.9, .7, .6, 9, P.yellow, P.woodShade, P.rust);
      line(2.5, 1.9, 0, 2.5, 1.9, 23, P.steelLight, 2); line(2.5, 1.9, 1, 3, 1.9, 1, P.steelLight, 2); break;
  }
  line(0, 3, 0, 4, 3, 0, P.steelLight); line(4, 0, 0, 4, 3, 0, P.steelLight);
}
