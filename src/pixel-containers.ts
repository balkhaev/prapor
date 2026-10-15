import type { LiveDrop } from './game/live';
import { PixelRaster, PIXEL_PALETTE as P } from './pixel-art';
import type { PixelSprite } from './pixel-renderer';

/** Search art reveals the public container type, never its unsearched contents. */
export class PixelContainerArt {
  private sprites = new Map<string, PixelSprite>();
  clear(): void { this.sprites.clear(); }
  get(drop: Pick<LiveDrop, 'containerKind'>): PixelSprite {
    const kind = drop.containerKind ?? 'crate', old = this.sprites.get(kind); if (old) return old;
    const image = document.createElement('canvas'); image.width = 96; image.height = 112;
    const c = image.getContext('2d');
    if (c) {
      const r = new PixelRaster(c, 96, 112);
      const poly = (points: number[][], fill: string) => r.polygon(points.map(([x, y]) => ({ x: x!, y: y! })), fill);
      r.ellipse(48, 96, 25, 10, P.ink);
      if (kind === 'jacket') {
        poly([[40, 44], [55, 44], [70, 56], [65, 69], [56, 62], [57, 91], [36, 91], [37, 62], [29, 69], [24, 58]], P.woodShade);
        poly([[40, 44], [55, 44], [62, 55], [58, 61], [53, 58], [53, 86], [39, 86], [40, 59], [34, 64], [29, 58]], P.wood);
        r.line(47, 51, 47, 87, P.cream); r.rect(39, 66, 6, 7, P.woodLight); r.rect(49, 66, 6, 7, P.woodLight);
        r.line(41, 45, 47, 53, P.plaster, 2); r.line(54, 45, 48, 53, P.plaster, 2);
        poly([[41, 47], [46, 52], [43, 55], [39, 51]], P.woodShade);
        poly([[53, 47], [49, 52], [51, 55], [56, 51]], P.woodShade);
        r.line(31, 59, 36, 61, P.woodLight); r.line(60, 57, 65, 61, P.woodLight);
        r.line(29, 65, 33, 67, P.plaster); r.line(63, 65, 67, 63, P.plaster);
        for (const y of [58, 65, 73, 81]) r.rect(46, y, 2, 2, P.ink);
        r.line(39, 69, 44, 69, P.woodShade); r.line(50, 69, 54, 69, P.woodShade);
        r.line(39, 85, 43, 86, P.terraShade); r.line(51, 80, 53, 83, P.terraShade);
      } else if (kind === 'cabinet') {
        poly([[31, 39], [53, 35], [68, 43], [68, 95], [45, 100], [31, 92]], P.steelShade);
        poly([[31, 39], [53, 35], [68, 43], [45, 48]], P.steelLight);
        poly([[31, 40], [45, 48], [45, 100], [31, 92]], P.steel);
        r.line(33, 45, 33, 90, P.steelLight); r.line(45, 49, 45, 99, P.ink);
        for (let y = 52; y < 92; y += 13) {
          poly([[47, y], [65, y - 4], [65, y + 5], [47, y + 9]], P.green);
          r.line(50, y + 2, 61, y, P.cream, 2); r.line(47, y + 9, 65, y + 5, P.ink);
          r.rect(56, y + 4, 2, 2, P.ink); r.rect(50, y - 1, 5, 2, P.sand);
        }
        for (let y = 52; y < 66; y += 4) r.line(35, y, 40, y + 2, P.steelShade);
        r.line(33, 78, 36, 80, P.rust); r.line(64, 90, 65, 94, P.rustShade);
        r.rect(34, 94, 4, 4, P.ink); r.rect(61, 97, 4, 3, P.ink);
      } else if (kind === 'duffel' || kind === 'medbag') {
        r.ellipse(48, 87, 23, 12, P.ink); r.rect(27, 76, 42, 13, kind === 'medbag' ? P.plaster : P.leafShade);
        r.ellipse(48, 77, 21, 9, kind === 'medbag' ? P.cream : P.leaf);
        r.line(36, 71, 36, 93, P.woodShade, 3); r.line(61, 71, 61, 93, P.woodShade, 3);
        r.line(41, 69, 41, 62, P.ink, 3); r.line(41, 62, 54, 62, P.ink, 3); r.line(54, 62, 55, 69, P.ink, 3);
        r.line(30, 77, 65, 77, P.woodLight); r.rect(49, 77, 3, 2, P.steelLight);
        poly([[28, 80], [36, 83], [36, 91], [28, 88]], kind === 'medbag' ? P.sand : P.leafShade);
        r.line(29, 81, 35, 84, P.cream); r.line(41, 75, 57, 75, P.ink);
        for (let x = 43; x < 57; x += 3) r.rect(x, 74, 1, 2, P.steelLight);
        for (const x of [35, 60]) { r.rect(x, 84, 4, 5, P.ink); r.rect(x + 1, 85, 2, 2, P.steel); }
        r.line(41, 63, 53, 63, P.woodLight);
        if (kind === 'medbag') { r.rect(45, 80, 5, 13, P.red); r.rect(41, 84, 13, 5, P.red); }
      } else {
        const tool = kind === 'toolbox';
        poly([[23, 76], [52, 69], [73, 79], [73, 93], [45, 101], [23, 91]], tool ? P.rustShade : P.woodShade);
        poly([[23, 76], [52, 69], [73, 79], [45, 87]], tool ? P.red : P.woodLight);
        poly([[23, 77], [45, 87], [45, 101], [23, 91]], tool ? P.terra : P.wood);
        for (let x = 27; x < 44; x += 6) r.line(x, 81 + (x - 27) / 2, x, 92 + (x - 27) / 2, P.woodShade);
        r.line(46, 89, 70, 82, P.cream); r.rect(57, 85, 4, 4, P.steelLight);
        if (tool) {
          r.line(44, 71, 44, 64, P.ink, 3); r.line(44, 64, 57, 65, P.ink, 3); r.line(57, 65, 57, 72, P.ink, 3);
          r.line(46, 64, 54, 65, P.steel); r.line(25, 81, 44, 91, P.rustShade); r.line(47, 91, 70, 85, P.ink);
          r.rect(58, 85, 3, 5, P.ink); r.rect(59, 86, 1, 2, P.cream);
          for (const [x, y] of [[27, 85], [39, 92], [68, 88], [68, 80]]) r.rect(x!, y!, 2, 2, P.steelLight);
          r.line(31, 84, 34, 85, P.steel); r.line(62, 91, 65, 90, P.rust);
        } else {
          r.line(25, 78, 44, 99, P.woodLight, 2); r.line(44, 88, 24, 90, P.woodLight, 2);
          for (const [x, y] of [[27, 80], [40, 96], [48, 91], [68, 85]]) r.rect(x!, y!, 2, 2, P.ink);
          for (let x = 34; x < 67; x += 9) r.line(x, 76 + (x - 34) * .2, x + 4, 74 + (x - 34) * .2, P.woodShade);
          r.line(53, 94, 56, 93, P.woodShade); r.line(55, 94, 57, 94, P.woodLight);
          r.rect(28, 93, 5, 3, P.ink); r.rect(61, 96, 5, 3, P.ink);
        }
      }
    }
    const sprite = { image, anchor: { x: 48, y: 96 } }; this.sprites.set(kind, sprite); return sprite;
  }
}
