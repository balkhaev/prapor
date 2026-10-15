import { expect, test } from 'bun:test';
import type { LiveTerrain, LiveWorld } from '../src/game/live';
import { paintTerrainTexture, terrainTextureResolution } from '../src/live-ground-art';

const world = (width: number, height: number): LiveWorld => ({ width, height, seed: 'seam-continuity', citySites: [] } as unknown as LiveWorld);
function render(map: LiveWorld, terrain: LiveTerrain[], resolution = 16): Uint8ClampedArray {
  const width = map.width * resolution, output = new Uint8ClampedArray(width * map.height * resolution * 4);
  const c = {
    createImageData(w: number, h: number) { return { data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData(image: { data: Uint8ClampedArray }, _x: number, y: number, _sx: number, _sy: number, _sw: number, rows: number) {
      output.set(image.data.subarray(0, rows * width * 4), y * width * 4);
    },
  } as unknown as CanvasRenderingContext2D;
  paintTerrainTexture(c, map, terrain, resolution);
  return output;
}

test('natural interfaces blend inside cells with continuous colour weights at cell, atlas and upload seams', () => {
  const map = world(16, 16), resolution = 16, textureWidth = map.width * resolution;
  const grass = render(map, Array<LiveTerrain>(256).fill('grass')), forest = render(map, Array<LiveTerrain>(256).fill('forest'));
  for (const horizontal of [false, true]) {
    const terrain = Array.from({ length: 256 }, (_, cell): LiveTerrain => (horizontal ? Math.floor(cell / 16) : cell % 16) < 8 ? 'grass' : 'forest');
    const pixels = render(map, terrain), weights: number[] = [];
    for (let coordinate = 6 * resolution; coordinate < 10 * resolution; coordinate++) {
      const x = horizontal ? 73 : coordinate, y = horizontal ? coordinate : 73, at = (y * textureWidth + x) * 4;
      // Both homogeneous atlases share grain phase. Removing it exposes the
      // actual material weight, so a motif cannot mask a coloured tile seam.
      weights.push((pixels[at]! - grass[at]!) / (forest[at]! - grass[at]!));
      expect(pixels[at + 3]).toBe(255);
    }
    expect(new Set(weights.map(weight => Math.round(weight * 100))).size).toBeGreaterThan(12);
    expect(weights[0]).toBeCloseTo(0); expect(weights.at(-1)).toBeCloseTo(1);
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]! - weights[i - 1]!).toBeGreaterThanOrEqual(-.0251);
      expect(Math.abs(weights[i]! - weights[i - 1]!)).toBeLessThan(.151);
    }
  }
});

test('streamed bands and larger map extents preserve every shared texture sample', () => {
  const small = world(20, 21), large = world(20, 29);
  const terrain = (map: LiveWorld) => Array.from({ length: map.width * map.height }, (_, cell): LiveTerrain => {
    const x = cell % map.width, y = Math.floor(cell / map.width);
    return x < 5 + Math.floor(Math.sin(y * .4) * 2) ? 'forest' : x < 12 ? 'grass' : y < 10 ? 'yard' : 'sand';
  });
  const firstTerrain = terrain(small), before = [...firstTerrain], first = render(small, firstTerrain, 8), second = render(large, terrain(large), 8);
  // Exclude only the final cell, whose missing neighbour belongs to the map
  // edge. Rows at y=8 and y=16 straddle separate ImageData uploads.
  expect(first.subarray(0, 20 * 20 * 8 * 8 * 4)).toEqual(second.subarray(0, 20 * 20 * 8 * 8 * 4));
  expect(render(small, firstTerrain, 8)).toEqual(first);
  expect(firstTerrain).toEqual(before);
});

test('a grass verge stays on its natural side and never recolours paving, road, rail, water or an authored room', () => {
  const map = world(24, 12), resolution = 8, width = map.width * resolution;
  const terrain = Array.from({ length: 288 }, (_, cell): LiveTerrain => {
    const x = cell % 24;
    return x < 8 ? 'grass' : x < 11 ? 'concrete' : x < 14 ? 'road' : x < 17 ? 'rail' : x < 20 ? 'water' : 'forest';
  });
  map.citySites = [{ buildings: [{ x: 4, y: 3, width: 3, height: 5, kind: 'apartment' }] }] as unknown as LiveWorld['citySites'];
  const base = render(map, terrain, resolution);
  const changed = render(map, terrain.map(material => material === 'grass' ? 'sand' : material === 'forest' ? 'yard' : material), resolution);
  const grass = render(world(24, 12), Array<LiveTerrain>(288).fill('grass'), resolution);
  let vergePixels = 0;
  for (let py = 0; py < map.height * resolution; py++) for (let px = 0; px < width; px++) {
    const at = (py * width + px) * 4, x = Math.floor(px / resolution), y = Math.floor(py / resolution);
    if (x >= 8 && x < 20) expect(base.subarray(at, at + 4)).toEqual(changed.subarray(at, at + 4));
    if (x >= 4 && x < 7 && y >= 3 && y < 8) expect(base.subarray(at, at + 4)).toEqual(grass.subarray(at, at + 4));
    if (px === 8 * resolution - 1 && base[at] !== grass[at]) vergePixels++;
    if (x === 2) expect(base.subarray(at, at + 4)).toEqual(grass.subarray(at, at + 4));
  }
  expect(vergePixels).toBeGreaterThan(20);
});

test('isolated diagonal vegetation cannot mix through the closed corner of hard ground', () => {
  const map = world(5, 5), resolution = 16, terrain = Array<LiveTerrain>(25).fill('concrete');
  terrain[2 * 5 + 2] = 'grass'; terrain[1 * 5 + 1] = 'forest';
  const base = render(map, terrain, resolution), changed = render(map, terrain.map(material => material === 'forest' ? 'sand' : material), resolution);
  for (let y = 2 * resolution; y < 3 * resolution; y++) for (let x = 2 * resolution; x < 3 * resolution; x++) {
    const at = (y * 5 * resolution + x) * 4;
    expect(base.subarray(at, at + 4)).toEqual(changed.subarray(at, at + 4));
  }
});

test('quiet ground grain uses small value ranges rather than contrasting paving or grass squares', () => {
  const map = world(20, 20);
  for (const [material, maximumRange] of [['concrete', 10], ['grass', 34]] as const) {
    const pixels = render(map, Array<LiveTerrain>(400).fill(material), 8);
    let minimum = 255, maximum = 0;
    for (let at = 0; at < pixels.length; at += 4) { minimum = Math.min(minimum, pixels[at]!); maximum = Math.max(maximum, pixels[at]!); }
    expect(maximum - minimum).toBeLessThanOrEqual(maximumRange);
    expect(maximum - minimum).toBeGreaterThan(2);
  }
});

test('the largest world still uploads one reusable strip to the existing 4096px terrain atlas', () => {
  const map = world(1024, 1024), resolution = terrainTextureResolution(map.width, map.height), allocations: number[] = [], uploads: number[] = [];
  const c = {
    createImageData(w: number, h: number) { allocations.push(w * h * 4); return { data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData(_image: unknown, _x: number, y: number) { uploads.push(y); },
  } as unknown as CanvasRenderingContext2D;
  paintTerrainTexture(c, map, Array<LiveTerrain>(map.width * map.height).fill('grass'), resolution);
  expect(resolution * map.width).toBe(4096);
  expect(allocations).toEqual([4096 * 32 * 4]);
  expect(uploads).toHaveLength(128);
  expect(uploads[0]).toBe(0); expect(uploads.at(-1)).toBe(4096 - 32);
});
