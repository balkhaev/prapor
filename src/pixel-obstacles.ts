import type { LiveObstacle, LivePoint } from './game/live';
import { PIXEL_PALETTE as P, PixelRaster, pixelSeed } from './pixel-art';
import type { PixelDetail, PixelSprite } from './pixel-renderer';

/** Remaining collision cover uses the same pixel grid and the exact published footprint. */
export class PixelObstacleArt {
  private sprites = new Map<string, PixelSprite & { nativeTile: number }>();
  private bytes = 0;
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
      const w = obstacle.width, h = obstacle.height, container = obstacle.kind === 'container', wood = obstacle.kind === 'barricade';
      const light = container ? [P.steel, P.terra, P.green][variant % 3]! : wood ? P.wood : P.concrete;
      const dark = container ? [P.steelShade, P.terraShade, P.shadow][variant % 3]! : wood ? P.woodShade : P.concreteShade;
      face([p(w, 0), p(w, h), p(w, h, height), p(w, 0, height)], light);
      face([p(0, h), p(w, h), p(w, h, height), p(0, h, height)], dark);
      face([p(0, 0, height), p(w, 0, height), p(w, h, height), p(0, h, height)], container ? P.steelLight : wood ? P.woodLight : P.panel);
      for (const axis of ['x', 'y'] as const) {
        const length = axis === 'x' ? w : h;
        const at = (t: number, z: number) => axis === 'x' ? p(t, h, z) : p(w, t, z);
        if (container) {
          for (let t = .12; t < length; t += .27) { line(at(t, native * .08), at(t, height - native * .05), P.steelShade); line(at(t + .035, native * .08), at(t + .035, height - native * .05), P.steelLight); }
        } else if (wood) {
          for (let z = native * .06; z < height; z += native * .06) line(at(0, z), at(length, z), P.woodLight);
          for (let t = .2; t < length; t += 1) line(at(t, 0), at(Math.min(length, t + .5), height), P.woodShade, Math.max(1, native * .035));
        } else {
          for (let row = 0, z = native * .1; z < height; row++, z += native * .11) {
            line(at(0, z), at(length, z), P.panelShade);
            for (let t = row % 2 * .45; t < length; t += .9) line(at(t, z), at(t, Math.max(0, z - native * .11)), P.panelShade);
          }
        }
        line(at(0, height - 2), at(length, height - 2), P.cream);
        const seed = pixelSeed(key);
        for (let mark = 0; mark < Math.min(12, Math.ceil(length * 2)); mark++) {
          const t = length * (((seed >>> (mark % 16)) + mark * 23) % 89 + 5) / 100, z = native * (.08 + (mark * 7 % 19) / 100);
          const a = at(t, Math.min(height - 1, z)); r.rect(a.x, a.y, Math.max(1, native / 32), Math.max(1, native / 48), container ? P.rust : wood ? P.woodShade : P.shadow);
        }
      }
    }
    const sprite = { image, anchor, nativeTile: native }; this.sprites.set(key, sprite); this.bytes += image.width * image.height * 4;
    while (this.bytes > 12 * 1024 * 1024 && this.sprites.size > 1) { const first = this.sprites.keys().next().value!, evicted = this.sprites.get(first)!; this.bytes -= evicted.image.width * evicted.image.height * 4; this.sprites.delete(first); }
    return sprite;
  }
}
