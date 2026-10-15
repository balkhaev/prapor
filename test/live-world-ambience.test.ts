import { expect, test } from 'bun:test';
import type { LiveTerrain } from '../src/game/live';
import { liveAmbientBirds, liveAmbientGround, liveAmbientGroundMarks, liveCloudShadows } from '../src/live-world-ambience';

test('living ground stays on existing outdoor surfaces without changing the world raster', () => {
  const world = { width: 64, height: 64, seed: 'courtyard-life' };
  const terrain: LiveTerrain[] = Array.from({ length: 4096 }, (_, index) => index % 3 === 0 ? 'water' : index % 3 === 1 ? 'grass' : 'road');
  const walkable = Uint8Array.from(terrain, surface => Number(surface !== 'water'));
  const indoor = Uint8Array.from(terrain, (_, index) => Number(index % 5 === 0));
  for (let index = 1; index < walkable.length; index += 7) walkable[index] = 0;
  const before = [terrain.join(','), walkable.slice(), indoor.slice()];
  const accents = liveAmbientGround(world, terrain, walkable, indoor);
  expect(accents.length).toBeGreaterThan(20);
  expect(accents).toEqual(liveAmbientGround(world, terrain, walkable, indoor));
  for (const accent of accents) {
    const index = Math.floor(accent.y) * world.width + Math.floor(accent.x);
    expect(indoor[index]).toBe(0);
    expect(accent.kind === 'water' ? terrain[index] === 'water' : !!walkable[index]).toBe(true);
    expect(accent.x % 1 + accent.width).toBeLessThan(1);
    expect(accent.y % 1 + accent.height).toBeLessThan(1);
  }
  expect([terrain.join(','), walkable, indoor]).toEqual(before);
});

test('a million-cell meadow creates a finite once-per-world decoration index', () => {
  const world = { width: 1024, height: 1024, seed: 'large-meadow' }, cells = world.width * world.height;
  const accents = liveAmbientGround(world, new Array<LiveTerrain>(cells).fill('grass'), new Uint8Array(cells).fill(1), new Uint8Array(cells));
  expect(accents.length).toBeGreaterThan(10000);
  expect(accents.length).toBeLessThanOrEqual(65536);
  expect(new Set(accents.map(accent => `${Math.floor(accent.x)},${Math.floor(accent.y)}`)).size).toBe(accents.length);
});

test('quiet motion preference freezes vegetation and water, while weather removes fluttering scraps', () => {
  const base = { x: 10.3, y: 10.35, width: .4, height: .4, seed: 7131 };
  for (const kind of ['grass', 'water'] as const) {
    const accent = { ...base, kind };
    expect(liveAmbientGroundMarks(accent, 100, .3, 1, 0, true)).toEqual(liveAmbientGroundMarks(accent, 999000, .3, 1, 0, true));
    expect(liveAmbientGroundMarks(accent, 100, .1, 1, 0, true)).toEqual(liveAmbientGroundMarks(accent, 999000, .9, 1, 0, true));
    expect(liveAmbientGroundMarks(accent, 100, .3, 1, 0)).not.toEqual(liveAmbientGroundMarks(accent, 1800, .3, 1, 0));
  }
  const paper = { ...base, kind: 'paper' as const };
  expect(liveAmbientGroundMarks(paper, 0, .3, 1, 0, true)).toEqual([]);
  expect(liveAmbientGroundMarks(paper, 0, .3, 1, .9)).toEqual([]);
  const water = { ...base, kind: 'water' as const };
  const sum = (day: number, rain: number) => liveAmbientGroundMarks(water, 100, .3, day, rain, true).reduce((alpha, mark) => alpha + mark.alpha, 0);
  expect(sum(1, 0)).toBeGreaterThan(sum(0, 0) * 3);
  expect(sum(1, 0)).toBeGreaterThan(sum(1, .9) * 3);
});

test('clouds are bounded, continuously drifting world shadows and disappear in poor light', () => {
  const area = { x: 50, y: 80, width: 50, height: 50 };
  const first = liveCloudShadows('clouds', area, 47999 / .032 * 1000, .3, 1, 0, 0);
  const second = liveCloudShadows('clouds', area, 47999 / .032 * 1000 + 1000, .3, 1, 0, 0);
  expect(first.length).toBeGreaterThan(0); expect(first.length).toBeLessThanOrEqual(12);
  expect(second[0]!.x - first[0]!.x).toBeCloseTo(.032, 5);
  expect(liveCloudShadows('clouds', area, 0, .3, 1, 0, 0, true)).toEqual(liveCloudShadows('clouds', area, 900000, .3, 1, 0, 0, true));
  for (const [day, rain, fog] of [[0, 0, 0], [1, 1, 0], [1, 0, 1]]) expect(liveCloudShadows('clouds', area, 0, .3, day!, rain!, fog!)).toEqual([]);
  expect(liveCloudShadows('clouds', { ...area, width: 1024 }, 100, .3, 1, 0, 0)).toEqual([]);
});

test('nearby flocks use fixed world patches rather than following the camera', () => {
  const area = { x: 1, y: 1, width: 8, height: 8 }, shifted = { ...area, x: 3, y: 2 };
  let timeMs = 0;
  while (!liveAmbientBirds('birds', area, { timeMs, daylight: 1 }).length && timeMs < 58000) timeMs += 1000;
  const birds = liveAmbientBirds('birds', area, { timeMs, daylight: 1 });
  expect(birds.length).toBeGreaterThan(0); expect(birds.length).toBeLessThanOrEqual(12);
  expect(birds).toEqual(liveAmbientBirds('birds', shifted, { timeMs, daylight: 1 }));
  expect(birds.every(bird => bird.x >= -1 && bird.x <= 33 && bird.y >= 0 && bird.y <= 32)).toBe(true);
  expect(liveAmbientBirds('birds', area, { timeMs, daylight: 1, reducedMotion: true })).toEqual([]);
  expect(liveAmbientBirds('birds', area, { timeMs, daylight: 0 })).toEqual([]);
  expect(liveAmbientBirds('birds', area, { timeMs, daylight: 1, rain: .9 })).toEqual([]);
  expect(liveAmbientBirds('birds', { ...area, width: 1024 }, { timeMs, daylight: 1 })).toEqual([]);
});
