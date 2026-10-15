import type { LiveObstacle, LivePoint } from './game/live';
import { PIXEL_PALETTE as P, PixelRaster, pixelSeed } from './pixel-art';
import type { PixelDetail, PixelSprite } from './pixel-renderer';

export const PIXEL_OBSTACLE_CACHE_BYTES = 12 * 1024 * 1024;
/** Remaining collision cover uses the same pixel grid and the exact published footprint. */
export class PixelObstacleArt {
  private sprites = new Map<string, PixelSprite & { nativeTile: number }>();
  private bytes = 0;
  get retainedBytes(): number { return this.bytes; }
  clear(): void { this.sprites.clear(); this.bytes = 0; }
  get(obstacle: LiveObstacle, variant: number, detail: PixelDetail): PixelSprite & { nativeTile: number } {
    variant = ((Math.trunc(variant) % 4) + 4) % 4;
    const native = Math.min(detail, Math.floor(4000 / (obstacle.width + obstacle.height) * 2));
    const height = native * (obstacle.kind === 'wall' ? .65 : obstacle.kind === 'barricade' ? .3 : .7);
    const key = `${obstacle.kind}:${obstacle.width}:${obstacle.height}:${variant % 4}:${native}`;
    const old = this.sprites.get(key); if (old) { this.sprites.delete(key); this.sprites.set(key, old); return old; }
    const anchor = { x: Math.ceil(obstacle.height * native / 2) + 4, y: Math.ceil(height) + 8 };
    const image = document.createElement('canvas'); image.width = Math.ceil((obstacle.width + obstacle.height) * native / 2) + 10; image.height = Math.ceil((obstacle.width + obstacle.height) * native / 4 + height) + 16;
    const c = image.getContext('2d');
    if (c) {
      const r = new PixelRaster(c, image.width, image.height);
      const p = (x: number, y: number, z = 0): LivePoint => ({ x: Math.round(anchor.x + (x - y) * native / 2), y: Math.round(anchor.y + (x + y) * native / 4 - z) });
      const line = (a: LivePoint, b: LivePoint, color: string, thickness = 1) => r.line(a.x, a.y, b.x, b.y, color, thickness);
      const face = (points: LivePoint[], color: string) => { r.polygon(points, color); points.forEach((a, i) => line(a, points[(i + 1) % points.length]!, P.ink)); };
      const w = obstacle.width, h = obstacle.height, container = obstacle.kind === 'container', wood = obstacle.kind === 'barricade', fine = native >= 64;
      const light = container ? [P.steel, P.terra, P.green][variant % 3]! : wood ? P.wood : P.concrete;
      const dark = container ? [P.steelShade, P.terraShade, P.shadow][variant % 3]! : wood ? P.woodShade : P.concreteShade;
      face([p(w, 0), p(w, h), p(w, h, height), p(w, 0, height)], light);
      face([p(0, h), p(w, h), p(w, h, height), p(0, h, height)], dark);
      face([p(0, 0, height), p(w, 0, height), p(w, h, height), p(0, h, height)], container ? P.steelLight : wood ? P.woodLight : P.panel);
      for (const axis of ['x', 'y'] as const) {
        const length = axis === 'x' ? w : h;
        const at = (t: number, z: number) => axis === 'x' ? p(t, h, z) : p(w, t, z);
        const panel = (left: number, right: number, low: number, high: number, color: string) => r.polygon([at(left, low), at(right, low), at(right, high), at(left, high)], color);
        if (container) {
          const doors = w >= h ? axis === 'y' : axis === 'x';
          if (doors) {
            panel(.05, length - .05, native * .04, height - native * .04, dark);
            for (const side of [-1, 1]) {
              const middle = length / 2 + side * length * .23;
              line(at(middle, native * .08), at(middle, height - native * .08), P.steelLight, Math.max(1, native / 48));
              for (const z of [height * .18, height * .5, height * .82]) {
                line(at(middle - length * .08, z), at(middle + length * .08, z), P.ink, Math.max(1, native / 48));
                line(at(side < 0 ? .08 : length - .08, z - native * .03), at(side < 0 ? .08 : length - .08, z + native * .03), P.steel, Math.max(1, native / 32));
              }
              line(at(middle, height * .4), at(middle + length * .1, height * .4), P.cream, Math.max(1, native / 48));
            }
            line(at(length / 2, native * .04), at(length / 2, height - native * .04), P.ink);
          } else {
            for (let t = .12; t < length; t += .27) { line(at(t, native * .08), at(t, height - native * .05), P.steelShade); line(at(t + .035, native * .08), at(t + .035, height - native * .05), P.steelLight); }
          }
          for (const t of [.04, length - .04]) {
            line(at(t, 0), at(t, height), P.steelShade, Math.max(1, native / 32));
            line(at(t + .02, native * .04), at(t + .02, height - native * .04), P.steelLight);
          }
          line(at(.05, native * .04), at(length - .05, native * .04), P.ink, Math.max(1, native / 40));
          if (fine && length > .8) {
            panel(length * .17, length * .17 + .3, height * .56, height * .56 + native * .09, P.cream);
            line(at(length * .2, height * .56 + native * .02), at(length * .2 + .21, height * .56 + native * .02), P.ink);
            for (let n = 0; n < 3; n++) line(at(length - .27, native * (.11 + n * .05)), at(length - .15, native * (.14 + n * .05)), n % 2 ? P.ink : P.yellow, Math.max(1, native / 40));
          }
        } else if (wood) {
          for (let z = native * .06; z < height; z += native * .06) line(at(0, z), at(length, z), P.woodLight);
          for (let t = .2; t < length; t += 1) {
            line(at(t, 0), at(Math.min(length, t + .5), height), P.woodShade, Math.max(1, native * .055));
            line(at(t + .025, native * .02), at(Math.min(length, t + .52), height - native * .02), P.woodLight);
            for (const z of [native * .05, height - native * .04]) {
              const tAt = Math.min(length - .02, t + .5 * z / height), nail = at(tAt, z);
              r.rect(nail.x, nail.y, Math.max(1, native / 64), Math.max(1, native / 64), P.ink);
            }
          }
          if (fine) for (let t = .12; t < length; t += .74) {
            const knot = at(t, height * .48);
            r.ellipse(knot.x, knot.y, 2, 1, P.woodShade);
            line(at(t + .02, height * .18), at(Math.min(length, t + .23), height * .25), P.woodShade);
          }
        } else {
          for (let row = 0, z = native * .1; z < height; row++, z += native * .11) {
            line(at(0, z), at(length, z), P.panelShade);
            for (let t = row % 2 * .45; t < length; t += .9) line(at(t, z), at(t, Math.max(0, z - native * .11)), P.panelShade);
          }
          panel(0, length, height - native * .06, height, P.panel);
          line(at(0, height - native * .06), at(length, height - native * .06), P.shadow);
          if (fine) {
            const u = length * .63;
            line(at(u, height * .6), at(u + .08, height * .41), P.ink);
            line(at(u + .08, height * .41), at(u + .02, height * .28), P.ink);
            panel(length * .2, Math.min(length * .2 + .14, length), native * .03, native * .075, P.leafShade);
          }
        }
        line(at(0, height - 2), at(length, height - 2), P.cream);
        const seed = pixelSeed(key);
        for (let mark = 0; mark < Math.min(12, Math.ceil(length * 2)); mark++) {
          const t = length * (((seed >>> (mark % 16)) + mark * 23) % 89 + 5) / 100, z = native * (.08 + (mark * 7 % 19) / 100);
          const a = at(t, Math.min(height - 1, z)); r.rect(a.x, a.y, Math.max(1, native / 32), Math.max(1, native / 48), container ? P.rust : wood ? P.woodShade : P.shadow);
        }
      }
      if (container) {
        const longitudinal = w >= h ? w : h;
        for (let t = .2; t < longitudinal; t += .42) line(w >= h ? p(t, .04, height + 1) : p(.04, t, height + 1), w >= h ? p(t, h - .04, height + 1) : p(w - .04, t, height + 1), P.steelShade);
      } else if (wood) {
        for (let t = .16; t < h; t += .2) line(p(.03, t, height + 1), p(w - .03, t, height + 1), P.woodShade);
        if (fine) for (let t = .2; t < w; t += .8) {
          line(p(t, .04, height + 1), p(t + .08, h - .04, height + 1), P.woodLight);
          const nail = p(t, .1, height + 2); r.rect(nail.x, nail.y, 2, 2, P.ink);
        }
      } else if (fine) {
        line(p(.12, .12, height + 1), p(w - .12, .12, height + 1), P.cream);
        line(p(.12, .12, height + 1), p(.12, h - .12, height + 1), P.cream);
      }
    }
    const sprite = { image, anchor, nativeTile: native }, bytes = image.width * image.height * 4;
    if (bytes <= PIXEL_OBSTACLE_CACHE_BYTES) {
      this.sprites.set(key, sprite); this.bytes += bytes;
      while (this.bytes > PIXEL_OBSTACLE_CACHE_BYTES) { const first = this.sprites.keys().next().value!, evicted = this.sprites.get(first)!; this.bytes -= evicted.image.width * evicted.image.height * 4; this.sprites.delete(first); }
    }
    return sprite;
  }
}
