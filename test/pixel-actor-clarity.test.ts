import { afterEach, expect, test } from 'bun:test';
import { clarifyPixelActor, pixelActorDetail } from '../src/pixel-actor-clarity';
import { PixelActorArt, PIXEL_ACTOR_CACHE_BYTES } from '../src/pixel-actors';
import { PIXEL_FACINGS } from '../src/pixel-animation';

function rectangle(pixels: Uint8ClampedArray, width: number, x: number, y: number, w: number, h: number, color = [103, 116, 92, 255]) {
  for (let row = y; row < y + h; row++) for (let column = x; column < x + w; column++) pixels.set(color, (row * width + column) * 4);
}
const alphaAt = (pixels: Uint8ClampedArray, width: number, x: number, y: number) => pixels[(y * width + x) * 4 + 3]!;
const lumaAt = (pixels: Uint8ClampedArray, width: number, x: number, y: number) => {
  const index = (y * width + x) * 4;
  return pixels[index]! * .2126 + pixels[index + 1]! * .7152 + pixels[index + 2]! * .0722;
};

test('raster detail follows effective display size and density, with a bounded set of tiers', () => {
  expect(pixelActorDetail(18)).toBe(32); expect(pixelActorDetail(48)).toBe(64); expect(pixelActorDetail(64)).toBe(160);
  expect(pixelActorDetail(24, 2)).toBe(32); expect(pixelActorDetail(48, 2)).toBe(64);
  expect(pixelActorDetail(28, 2)).toBe(64); expect(pixelActorDetail(32, 2)).toBe(64);
  expect(pixelActorDetail(18, 20)).toBe(pixelActorDetail(18, 2));
  expect(pixelActorDetail(48, .1)).toBe(pixelActorDetail(48, 1));
  expect(pixelActorDetail(NaN)).toBe(160); expect(pixelActorDetail(0)).toBe(160);
});

test('coverage retains the empty channels that separate legs, aiming arms and equipment', () => {
  const width = 50, height = 60, source = new Uint8ClampedArray(width * height * 4);
  rectangle(source, width, 12, 8, 27, 23);
  rectangle(source, width, 12, 30, 12, 25); rectangle(source, width, 27, 30, 12, 25);
  // The three-pixel trouser gap lies within one distant coverage block.
  // It used to become a solid five-pixel block joining both legs together.
  rectangle(source, width, 39, 12, 5, 3); rectangle(source, width, 43, 12, 3, 17);
  rectangle(source, width, 36, 26, 8, 3);
  for (const detail of [32, 64] as const) {
    const distant = clarifyPixelActor(source, width, height, detail);
    for (let y = 33; y < 53; y++) for (let x = 24; x < 27; x++) expect(alphaAt(distant, width, x, y)).toBe(0);
    for (let y = 17; y < 25; y++) for (let x = 39; x < 43; x++) expect(alphaAt(distant, width, x, y)).toBe(0);
    expect(alphaAt(distant, width, 20, 40)).toBeGreaterThan(128);
    expect(alphaAt(distant, width, 30, 40)).toBeGreaterThan(128);
  }
});

test('authored equipment swatches retain their hue and internal contrast through minification', () => {
  const width = 50, height = 50, source = new Uint8ClampedArray(width * height * 4);
  rectangle(source, width, 5, 5, 40, 40);
  rectangle(source, width, 17, 10, 16, 25, [74, 88, 79, 255]);
  rectangle(source, width, 20, 17, 1, 1, [218, 208, 172, 255]);
  const distant = clarifyPixelActor(source, width, height, 32);
  const before = lumaAt(source, width, 10, 20) - lumaAt(source, width, 25, 20);
  const after = lumaAt(distant, width, 10, 20) - lumaAt(distant, width, 25, 20);
  expect(after).toBeGreaterThan(before + 10);
  // An isolated buckle highlight cannot bleach the entire dark vest block.
  expect(lumaAt(distant, width, 20, 17)).toBeLessThan(95);
  expect(distant[(20 * width + 25) * 4 + 1]).toBeGreaterThan(distant[(20 * width + 25) * 4]!);
  expect(source[(17 * width + 20) * 4]).toBe(218);
});

test('distant coverage keeps a thin barrel visible at every nearest-sampling phase', () => {
  const width = 50, height = 45, source = new Uint8ClampedArray(width * height * 4);
  rectangle(source, width, 15, 11, 11, 28); rectangle(source, width, 17, 4, 8, 8, [198, 164, 132, 255]);
  rectangle(source, width, 26, 17, 18, 1, [42, 58, 53, 255]);
  const distant = clarifyPixelActor(source, width, height, 32);
  let originalInvisiblePhases = 0;
  for (let phase = 0; phase < 5; phase++) {
    let before = 0, after = 0;
    for (let y = phase; y < height; y += 5) for (let x = 30; x < 44; x += 5) {
      if (alphaAt(source, width, x, y)) before++;
      if (alphaAt(distant, width, x, y) >= 128) after++;
    }
    if (!before) originalInvisiblePhases++;
    expect(after, `sampling phase ${phase}`).toBeGreaterThan(0);
  }
  expect(originalInvisiblePhases).toBeGreaterThan(0);
  // Coverage alone is insufficient: a bright, translucent barrel would merge
  // into midtone terrain even when it survives every sampling phase.
  const barrelAlpha = alphaAt(distant, width, 35, 17) / 255;
  const barrelOnGround = lumaAt(distant, width, 35, 17) * barrelAlpha + 100 * (1 - barrelAlpha);
  expect(100 - barrelOnGround).toBeGreaterThan(25);
  expect(distant).toHaveLength(source.length);
  expect(alphaAt(distant, width, 0, 0)).toBe(0);
});

test('broad planes gain contrast and the silhouette has a restrained upper rim with no distant glow', () => {
  const width = 60, height = 60, source = new Uint8ClampedArray(width * height * 4);
  rectangle(source, width, 15, 10, 30, 40);
  const distant = clarifyPixelActor(source, width, height, 32);
  expect(lumaAt(distant, width, 25, 25)).toBeGreaterThan(lumaAt(source, width, 25, 25) + 10);
  expect(lumaAt(distant, width, 25, 10)).toBeGreaterThan(lumaAt(distant, width, 15, 25) + 25);
  expect(lumaAt(distant, width, 15, 25)).toBeLessThan(lumaAt(source, width, 15, 25) - 20);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x < 15 || x >= 45 || y < 10 || y >= 50) expect(alphaAt(distant, width, x, y)).toBe(0);
  }
  expect(clarifyPixelActor(source, width, height, 160)).toBe(source);
});

test('sampling is stable when the same world art has a different tight-crop origin', () => {
  const full = new Uint8ClampedArray(50 * 50 * 4); rectangle(full, 50, 17, 12, 19, 29);
  const crop = new Uint8ClampedArray(37 * 44 * 4);
  for (let y = 0; y < 44; y++) for (let x = 0; x < 37; x++) crop.set(full.subarray(((y + 3) * 50 + x + 7) * 4, ((y + 3) * 50 + x + 7) * 4 + 4), (y * 37 + x) * 4);
  const a = clarifyPixelActor(full, 50, 50, 32), b = clarifyPixelActor(crop, 37, 44, 32, { x: 7, y: 3 });
  for (let y = 7; y < 39; y++) for (let x = 5; x < 33; x++) {
    expect([...b.subarray((y * 37 + x) * 4, (y * 37 + x) * 4 + 4)]).toEqual([...a.subarray(((y + 3) * 50 + x + 7) * 4, ((y + 3) * 50 + x + 7) * 4 + 4)]);
  }
});

let restoreDocument: (() => void) | undefined;
afterEach(() => { restoreDocument?.(); restoreDocument = undefined; });
type RasterCanvas = HTMLCanvasElement & { pixels: Uint8ClampedArray };
function mockCanvases() {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() {
    const canvas = { width: 0, height: 0, pixels: new Uint8ClampedArray() } as RasterCanvas;
    canvas.getContext = (() => {
      canvas.pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
      const context = {
        fillStyle: '', imageSmoothingEnabled: false, setTransform() {},
        fillRect(x: number, y: number, width: number, height: number) {
          const color = context.fillStyle.match(/[\da-f]{2}/gi)!.map(value => parseInt(value, 16));
          rectangle(canvas.pixels, canvas.width, x, y, width, height, [...color, 255]);
        },
        drawImage(source: RasterCanvas, sx: number, sy: number, sw: number, sh: number) {
          for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) canvas.pixels.set(source.pixels.subarray(((y + sy) * source.width + x + sx) * 4, ((y + sy) * source.width + x + sx) * 4 + 4), (y * canvas.width + x) * 4);
        },
        getImageData() { return { data: canvas.pixels.slice() }; },
        putImageData(data: { data: Uint8ClampedArray }) { canvas.pixels.set(data.data); },
      };
      return context;
    }) as unknown as HTMLCanvasElement['getContext'];
    return canvas;
  } } });
  restoreDocument = () => { if (old) Object.defineProperty(globalThis, 'document', old); else Reflect.deleteProperty(globalThis, 'document'); };
}

test('actor tiers retain identical geometry and sockets, independent cache entries and bounded storage', () => {
  mockCanvases(); const art = new PixelActorArt(), identity = { appearance: 0, faction: 'scavs' as const };
  const oldest = art.get(identity, { facing: 'se', mode: 'idle', frame: 0 }, 'sks', undefined, 32);
  const originalSockets = { anchor: { ...oldest.anchor }, muzzle: { ...oldest.muzzle! }, ejection: { ...oldest.ejection! } };
  for (const facing of PIXEL_FACINGS) {
    const frame = { facing, mode: 'fire' as const, frame: 2 }, native = art.get(identity, frame, 'awm');
    for (const detail of [32, 64] as const) {
      const distant = art.get(identity, frame, 'awm', undefined, detail);
      expect(distant.image.width).toBe(native.image.width); expect(distant.image.height).toBe(native.image.height);
      expect(distant.anchor).toEqual(native.anchor); expect(distant.muzzle).toEqual(native.muzzle); expect(distant.ejection).toEqual(native.ejection);
      expect(distant).not.toBe(native); expect(art.get(identity, frame, 'awm', undefined, detail)).toBe(distant);
      expect((distant.image as RasterCanvas).pixels).not.toEqual((native.image as RasterCanvas).pixels);
    }
  }
  for (let appearance = 0; appearance < 32; appearance++) for (const facing of PIXEL_FACINGS) for (const detail of [32, 64, 160] as const) {
    art.get({ ...identity, appearance }, { facing, mode: 'walk', frame: appearance % 12 }, 'sks', undefined, detail);
    expect(art.retainedBytes).toBeLessThanOrEqual(PIXEL_ACTOR_CACHE_BYTES);
  }
  expect(art.retainedBytes).toBeGreaterThan(PIXEL_ACTOR_CACHE_BYTES * .9);
  expect(oldest.image.width).toBe(1);
  expect({ anchor: oldest.anchor, muzzle: oldest.muzzle, ejection: oldest.ejection }).toEqual(originalSockets);
  art.clear(); expect(art.retainedBytes).toBe(0);
});
