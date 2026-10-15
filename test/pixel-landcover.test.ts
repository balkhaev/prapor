import { expect, test } from 'bun:test';
import { pixelLandcoverBands, segmentTouchesRect } from '../src/pixel-landcover';

test('stepped contours remain within their real footprint and have a fixed deterministic budget', () => {
  const bounds = { x: 126.5, y: 700.25, width: 42, height: 19 }, before = structuredClone(bounds);
  const bands = pixelLandcoverBands(bounds, 'linden');
  expect(bands).toEqual(pixelLandcoverBands(bounds, 'linden')); expect(bounds).toEqual(before);
  expect(bands).not.toEqual(pixelLandcoverBands(bounds, 'birch')); expect(bands).toHaveLength(9);
  expect(pixelLandcoverBands(bounds, 'linden', 100000)).toHaveLength(12);
  expect(pixelLandcoverBands({ ...bounds, width: 0 }, 'linden')).toEqual([]);
  for (const band of bands) {
    expect(band.x).toBeGreaterThanOrEqual(bounds.x); expect(band.y).toBeGreaterThanOrEqual(bounds.y);
    expect(band.x + band.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-6);
    expect(band.y + band.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1e-6);
  }
  expect(bands[0]!.width).toBeLessThan(bands[4]!.width);
});

test('road exclusion follows real segments through bends, diagonals and point endpoints', () => {
  const box = { x: 40, y: 40, width: 10, height: 10 };
  for (const [a, b] of [[{ x: 0, y: 0 }, { x: 100, y: 100 }], [{ x: 100, y: 0 }, { x: 0, y: 100 }], [{ x: 0, y: 45 }, { x: 100, y: 45 }], [{ x: 45, y: 0 }, { x: 45, y: 100 }]]) {
    expect(segmentTouchesRect(a!, b!, box)).toBe(true); expect(segmentTouchesRect(b!, a!, box)).toBe(true);
  }
  expect(segmentTouchesRect({ x: 0, y: 70 }, { x: 100, y: 170 }, box)).toBe(false);
  expect(segmentTouchesRect({ x: 0, y: 20 }, { x: 20, y: 40 }, box)).toBe(false);
  expect(segmentTouchesRect({ x: 45, y: 45 }, { x: 45, y: 45 }, box)).toBe(true);
  expect(segmentTouchesRect({ x: 45, y: 37 }, { x: 45, y: 37 }, box, 3)).toBe(true);
  expect(segmentTouchesRect({ x: NaN, y: 0 }, { x: 100, y: 100 }, box)).toBe(false);
});
