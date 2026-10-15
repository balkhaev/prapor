import { expect, test } from 'bun:test';
import { getShelterBackdropCoverage, getShelterBackdropDecorations } from '../src/shelter-backdrop';
import { projectShelterPoint } from '../src/shelter-isometric';
import { shelterOverviewCamera, shelterViewportForSize } from '../src/shelter-camera';

const bounds = { x: -266, y: -105, width: 1420, height: 788 };

test('portrait backdrop covers the whole view and authored world without changing either camera or world bounds', () => {
  const viewport = shelterViewportForSize(390, 844), camera = shelterOverviewCamera(viewport, bounds);
  const before = structuredClone({ camera, viewport, bounds });
  const coverage = getShelterBackdropCoverage(camera, viewport, bounds);
  expect(coverage.x).toBeLessThanOrEqual(Math.min(camera.x, bounds.x));
  expect(coverage.y).toBeLessThanOrEqual(Math.min(camera.y, bounds.y));
  expect(coverage.x + coverage.width).toBeGreaterThanOrEqual(Math.max(camera.x + viewport.width / camera.zoom, bounds.x + bounds.width));
  expect(coverage.y + coverage.height).toBeGreaterThanOrEqual(Math.max(camera.y + viewport.height / camera.zoom, bounds.y + bounds.height));
  expect(coverage.height).toBeGreaterThan(bounds.height * 3);
  expect({ camera, viewport, bounds }).toEqual(before);
  expect(getShelterBackdropCoverage({ ...camera, x: camera.x + 2, y: camera.y + 2 }, viewport, bounds)).toEqual(coverage);
});

test('distant forest continues above and below the portrait yard and leaves all authored scenery untouched', () => {
  const viewport = shelterViewportForSize(390, 844), camera = shelterOverviewCamera(viewport, bounds);
  const coverage = getShelterBackdropCoverage(camera, viewport, bounds), decorations = getShelterBackdropDecorations(coverage, bounds);
  expect(decorations).toEqual(getShelterBackdropDecorations(coverage, bounds));
  expect(decorations.some(decoration => projectShelterPoint(decoration.point).y < bounds.y - 80)).toBe(true);
  expect(decorations.some(decoration => projectShelterPoint(decoration.point).y > bounds.y + bounds.height + 80)).toBe(true);
  expect(decorations.length).toBeLessThanOrEqual(256);
  for (const decoration of decorations) {
    const point = projectShelterPoint(decoration.point);
    expect(['tree', 'bush', 'rock']).toContain(decoration.kind);
    expect(decoration.owned).toBe(false);
    expect(point.x + 56 > bounds.x && point.x - 56 < bounds.x + bounds.width && point.y + 80 > bounds.y && point.y - 80 < bounds.y + bounds.height).toBe(false);
  }
});

test('camera coverage changes never relocate shared trees and oversized views keep a fixed geometry budget', () => {
  const first = { x: -512, y: -1536, width: 2048, height: 3584 }, second = { ...first, x: first.x + 256 };
  const trees = getShelterBackdropDecorations(first, bounds), moved = new Map(getShelterBackdropDecorations(second, bounds).map(decoration => [decoration.seed, decoration]));
  const shared = trees.filter(decoration => moved.has(decoration.seed));
  expect(shared.length).toBeGreaterThan(10);
  for (const decoration of shared) expect(moved.get(decoration.seed)).toEqual(decoration);
  expect(getShelterBackdropDecorations({ x: -8000, y: -8000, width: 16000, height: 16000 }, bounds).length).toBeLessThanOrEqual(256);
});
