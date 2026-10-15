import { expect, test } from 'bun:test';
import { buildCityBuildingGroundShadows, cityBuildingGroundShadow, paintCityBuildingGroundShadows } from '../src/live-city-shadows';
import type { LiveCityBuilding, LiveTerrain } from '../src/game/live';
import { DEFAULT_GROUND_SHADOW_LIGHT, groundShadowWorldVector } from '../src/live-ground-shadows';

const house: LiveCityBuilding = { id: 'home', name: 'Home', x: 5, y: 5, width: 8, height: 6,
  floors: 3, kind: 'apartment', facade: 'panel', roof: 'flat', entrances: [] };

test('house shade follows common sunlight and grows with public height without changing the footprint', () => {
  const original = structuredClone(house), low = cityBuildingGroundShadow({ ...house, floors: 1 }), high = cityBuildingGroundShadow(house);
  expect(high.every(p => Number.isFinite(p.x + p.y))).toBe(true);
  expect(Math.min(...high.map(p => p.x))).toBe(house.x);
  expect(Math.min(...high.map(p => p.y))).toBe(house.y);
  expect(Math.max(...high.map(p => p.x))).toBeGreaterThan(Math.max(...low.map(p => p.x)));
  expect(Math.max(...high.map(p => p.y))).toBeGreaterThan(Math.max(...low.map(p => p.y)));
  const vector = groundShadowWorldVector(DEFAULT_GROUND_SHADOW_LIGHT);
  expect(vector.x).toBeGreaterThan(0); expect(vector.y).toBeGreaterThan(0);
  expect(house).toEqual(original);
});

test('building compatibility pass shares outdoor runs and unions cast and contact instead of each wall', () => {
  const terrain = Array<LiveTerrain>(24 * 24).fill('grass'), indoor = new Uint8Array(terrain.length);
  for (let y = 0; y < 24; y++) { terrain[y * 24 + 3] = 'water'; indoor[y * 24 + 7] = 1; }
  let saves = 0, fills = 0, clipped = false, runs = 0;
  const c = { save() { saves++; }, restore() { saves--; }, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, stroke() {},
    rect(x: number, y: number, w: number, h: number) {
      runs++; expect(h).toBe(1);
      for (let at = x; at < x + w; at++) { expect(terrain[y * 24 + at]).not.toBe('water'); expect(indoor[y * 24 + at]).toBe(0); }
    }, clip() { clipped = true; }, fill() { expect(clipped).toBe(true); fills++; } };
  const shadows = buildCityBuildingGroundShadows({ width: 24, height: 24 }, [house, { ...house, id: 'next-home', x: 10 }], terrain, indoor);
  const before = structuredClone(shadows);
  expect(shadows[0]!.receivers[0]).toBe(shadows[1]!.receivers[0]);
  paintCityBuildingGroundShadows(c as unknown as CanvasRenderingContext2D, shadows);
  expect(shadows).toEqual(before);
  expect(saves).toBe(0); expect(fills).toBe(2); expect(runs).toBeGreaterThan(0);
});
