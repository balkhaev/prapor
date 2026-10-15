import { expect, test } from 'bun:test';
import { buildCityBuildingGroundShadows, cityBuildingGroundShadow, paintCityBuildingGroundShadows } from '../src/live-city-shadows';
import type { LiveCityBuilding, LiveTerrain } from '../src/game/live';

const house: LiveCityBuilding = { id: 'home', name: 'Home', x: 5, y: 5, width: 8, height: 6,
  floors: 3, kind: 'apartment', facade: 'panel', roof: 'flat', entrances: [] };
test('continuous house shade grows with public height and leaves the real footprint intact', () => {
  const original = structuredClone(house), low = cityBuildingGroundShadow({ ...house, floors: 1 }), high = cityBuildingGroundShadow(house);
  expect(high).toHaveLength(6); expect(high.every(p => Number.isFinite(p.x + p.y))).toBe(true);
  expect(high.slice(0, 3)).toEqual(low.slice(0, 3));
  expect(high[4]!.x).toBeLessThan(low[4]!.x); expect(high[4]!.y).toBeGreaterThan(low[4]!.y);
  expect(house).toEqual(original);
});
test('cached contact shade clips every painted run away from water and interiors and blends once', () => {
  const terrain = Array<LiveTerrain>(24 * 24).fill('grass'), indoor = new Uint8Array(terrain.length);
  for (let y = 0; y < 24; y++) { terrain[y * 24 + 3] = 'water'; indoor[y * 24 + 7] = 1; }
  let saves = 0, fills = 0, clipped = false, runs = 0;
  const c = { save() { saves++; }, restore() { saves--; }, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    rect(x: number, y: number, w: number, h: number) {
      runs++; expect(h).toBe(1);
      for (let at = x; at < x + w; at++) { expect(terrain[y * 24 + at]).not.toBe('water'); expect(indoor[y * 24 + at]).toBe(0); }
    }, clip() { clipped = true; }, fill() { expect(clipped).toBe(true); fills++; } };
  const shadows = buildCityBuildingGroundShadows({ width: 24, height: 24 }, [house, { ...house, x: 10 }], terrain, indoor);
  const before = structuredClone(shadows);
  paintCityBuildingGroundShadows(c as unknown as CanvasRenderingContext2D, shadows);
  expect(shadows).toEqual(before);
  expect(saves).toBe(0); expect(fills).toBe(1); expect(runs).toBeGreaterThan(0);
});
