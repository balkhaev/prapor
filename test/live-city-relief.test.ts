import { expect, test } from 'bun:test';
import { cityReliefPoint, paintCityRelief } from '../src/live-city-relief';
import { distantBuildingSurfaces } from '../src/live-map-art';
import type { LiveCityBuilding } from '../src/game/live';

test('cached relief aligns with the ground diamond and preserves architectural height', () => {
  for (const scale of [.5, 1, 2]) {
    expect(cityReliefPoint({ x: -.5, y: -.5, z: 0 }, 1024, scale)).toEqual({ x: 1024 * scale, y: 0 });
    const ground = cityReliefPoint({ x: 144, y: 260, z: 0 }, 1024, scale);
    const roof = cityReliefPoint({ x: 144, y: 260, z: 2 }, 1024, scale);
    expect(roof.x).toBe(ground.x); expect(ground.y - roof.y).toBe(4 * scale);
  }
});

test('far relief paints public geometry in depth order without allocating sprites or mutating buildings', () => {
  const building = (id: string, x: number, y: number): LiveCityBuilding => ({ id, name: id, x, y, width: 8, height: 6,
    kind: 'apartment', facade: 'brick', roof: 'gable', floors: 2, entrances: [] });
  const buildings = [building('front', 18, 22), building('back', 6, 5)], before = structuredClone(buildings);
  const fills: string[] = [], points: number[][] = [];
  const c = { fillStyle: '', save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo(x: number, y: number) { points.push([x, y]); }, lineTo(x: number, y: number) { points.push([x, y]); },
    fill() { fills.push(this.fillStyle); } };
  paintCityRelief(c as unknown as CanvasRenderingContext2D, buildings, 1024, 1);
  expect(fills).toEqual([buildings[1]!, buildings[0]!].flatMap(item => distantBuildingSurfaces(item).map(surface => surface.color)));
  expect(points.every(point => point.every(Number.isFinite))).toBe(true);
  expect(buildings).toEqual(before);
});
