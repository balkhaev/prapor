import { afterEach, describe, expect, test } from 'bun:test';
import { PixelContainerArt } from '../src/pixel-containers';
import { PixelObstacleArt, PIXEL_OBSTACLE_CACHE_BYTES } from '../src/pixel-obstacles';
import { PIXEL_PALETTE as P } from '../src/pixel-art';
import type { LiveDrop } from '../src/game/live';

type Span = [number, number, number, number, string];
type Canvas = HTMLCanvasElement & { spans: Span[]; paints: number; valid: boolean; colors: Set<string> };
let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });
function canvases(record = true): Canvas[] {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document'), images: Canvas[] = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() {
    const image = { width: 0, height: 0, spans: [], paints: 0, valid: true, colors: new Set() } as unknown as Canvas;
    image.getContext = (() => ({ fillStyle: '', setTransform() {}, fillRect(x: number, y: number, w: number, h: number) {
      image.valid &&= [x, y, w, h].every(Number.isInteger) && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= image.width && y + h <= image.height;
      image.paints++; image.colors.add(this.fillStyle); if (record) image.spans.push([x, y, w, h, this.fillStyle]);
    } })) as unknown as HTMLCanvasElement['getContext'];
    images.push(image); return image;
  } } });
  restore = () => { if (old) Object.defineProperty(globalThis, 'document', old); else Reflect.deleteProperty(globalThis, 'document'); };
  return images;
}
const pixel = (image: Canvas, x: number, y: number) => [...image.spans].reverse().find(s => x >= s[0] && y >= s[1] && x < s[0] + s[2] && y < s[1] + s[3])?.[4];

describe('public pixel cover and search containers', () => {
  test('all cover variants and levels retain integer 2:1 anchors, distinct materials and bounded cache', () => {
    const images = canvases(false), art = new PixelObstacleArt(), signatures = new Set<string>();
    for (const kind of ['container', 'wall', 'barricade'] as const) for (const detail of [32, 64, 128] as const) for (let variant = 0; variant < 4; variant++) {
      const obstacle = { kind, x: 20, y: 10, width: 3, height: 1 }, before = structuredClone(obstacle), sprite = art.get(obstacle, variant, detail), image = images.at(-1)!;
      expect(sprite.nativeTile).toBe(detail); expect(sprite.anchor.x).toBe(Math.ceil(detail / 2) + 4);
      expect(image.valid).toBe(true); expect(image.paints).toBeGreaterThan(100);
      expect(image.width).toBeLessThanOrEqual(4096); expect(image.height).toBeLessThanOrEqual(4096);
      expect(art.retainedBytes).toBeLessThanOrEqual(PIXEL_OBSTACLE_CACHE_BYTES);
      expect(art.get({ ...obstacle, x: 50, y: 60 }, variant, detail)).toBe(sprite);
      expect(obstacle).toEqual(before);
      expect([...image.colors].every(color => Object.values(P).includes(color as typeof P[keyof typeof P]))).toBe(true);
      if (detail === 128 && variant === 0) signatures.add([...image.colors].sort().join(','));
    }
    expect(signatures.size).toBe(3);
    art.clear(); expect(art.retainedBytes).toBe(0);
  });

  test('one oversized obstacle is returned without retaining a texture above the budget', () => {
    const images = canvases(false), art = new PixelObstacleArt(), obstacle = { kind: 'wall' as const, x: 0, y: 0, width: 40, height: 40 };
    const sprite = art.get(obstacle, 0, 128);
    expect(sprite.image.width * sprite.image.height * 4).toBeGreaterThan(PIXEL_OBSTACLE_CACHE_BYTES);
    expect(art.retainedBytes).toBe(0);
    expect(images[0]!.valid).toBe(true);
    expect(art.get(obstacle, 0, 128)).not.toBe(sprite);
    expect(art.retainedBytes).toBe(0);
  });

  test('all six search silhouettes retain their own closed hardware and never inspect hidden contents', () => {
    const images = canvases(), art = new PixelContainerArt(), shapes = new Set<string>();
    for (const containerKind of ['crate', 'toolbox', 'jacket', 'medbag', 'duffel', 'cabinet'] as const) {
      const publicDrop: LiveDrop = { id: 'public-container', x: 10, y: 20, amount: 0, containerKind, searched: false };
      const sprite = art.get(publicDrop), image = images.at(-1)!;
      expect(sprite.anchor).toEqual({ x: 48, y: 96 }); expect(image.valid).toBe(true);
      expect(image.width * image.height * 4).toBe(96 * 112 * 4);
      const hidden = { ...publicDrop, amount: 999999, items: [{ id: 'private', name: 'hidden contents', quantity: 10 }], searched: true };
      expect(art.get(hidden)).toBe(sprite);
      expect(image.paints).toBeGreaterThan(100); shapes.add(JSON.stringify(image.spans));
      if (containerKind === 'medbag') expect(pixel(image, 47, 85)).toBe(P.red);
      if (containerKind === 'toolbox') expect(pixel(image, 59, 86)).toBe(P.cream);
      const independent = new PixelContainerArt().get(publicDrop);
      expect((independent.image as Canvas).spans).toEqual(image.spans);
    }
    expect(shapes.size).toBe(6);
    art.clear(); expect(art.get({ containerKind: 'crate' }).image).not.toBe(images[0]);
  });
});
