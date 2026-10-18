import { afterEach, expect, test } from 'bun:test';
import { BuildingActorOcclusion, buildingActorWindow, overlappingBuildingActors } from '../src/live-building-occlusion';
import { buildingNeedsCutaway } from '../src/live-map-art';
import type { PixelSprite } from '../src/pixel-renderer';

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

test('confirmed fighters along either long front facade get a local reveal without opening the roof', () => {
  const building = { x: 10, y: 12, width: 18, height: 14, entrances: [] };
  const project = (point: { x: number; y: number }) => ({ x: (point.x - point.y) * 32 + 400, y: (point.x + point.y) * 16 });
  const depth = building.x + building.y + building.width + building.height - 1.1;
  const rect = { x: -96, y: 0, width: 1072, height: 900 };
  const points = [{ x: 28, y: 15 }, { x: 13, y: 26 }];
  const windows = points.map(point => buildingActorWindow(point, project(point), 1));
  expect(buildingNeedsCutaway(building, points)).toBe(false);
  expect(overlappingBuildingActors(rect, depth, windows)).toEqual(windows);
  expect(windows.every(window => window.depth < depth)).toBe(true);
});

test('offscreen, nonoverlapping and already foreground actors do not make a facade transparent', () => {
  const rect = { x: 100, y: 100, width: 300, height: 200 };
  const windows = [buildingActorWindow({ x: 40, y: 40 }, { x: 200, y: 200 }, 1),
    buildingActorWindow({ x: 1, y: 1 }, { x: 600, y: 200 }, 1)];
  expect(overlappingBuildingActors(rect, 30, windows)).toEqual([]);
  expect(overlappingBuildingActors(rect, 30, [])).toEqual([]);
  const small = buildingActorWindow({ x: 1, y: 1 }, { x: 200, y: 200 }, .5);
  expect(small.width).toBe(64); expect(small.height).toBe(48);
  expect(overlappingBuildingActors(rect, 30, [small])).toEqual([small]);
});

test('soft reveal erases only a separate facade layer, reuses one bounded buffer and releases it', () => {
  type Draw = { operation: string; image: unknown };
  const buffers: Array<{ width: number; height: number; getContext: () => unknown }> = [], draws: Draw[] = [], stops: Array<[number, string]> = [];
  const layer = {
    globalAlpha: 1, globalCompositeOperation: 'source-over', imageSmoothingEnabled: true, fillStyle: '' as unknown,
    setTransform() {}, clearRect() {}, save() {}, restore() {}, translate() {}, scale() {},
    createRadialGradient: () => ({ addColorStop: (at: number, color: string) => stops.push([at, color]) }),
    drawImage(image: unknown) { draws.push({ operation: this.globalCompositeOperation, image }); },
    fillRect() { draws.push({ operation: this.globalCompositeOperation, image: this.fillStyle }); },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => {
    const canvas = { width: 0, height: 0, getContext: () => layer }; buffers.push(canvas); return canvas;
  } } });
  restore = () => { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); };
  const art = new BuildingActorOcclusion(), sprite = { image: { width: 8000, height: 8000 }, anchor: { x: 0, y: 0 } } as PixelSprite;
  const targetDraws: unknown[][] = [], context = { drawImage: (...args: unknown[]) => targetDraws.push(args) } as unknown as CanvasRenderingContext2D;
  const rect = { x: -2000, y: -2000, width: 8000, height: 8000 };
  const visible = buildingActorWindow({ x: 1, y: 1 }, { x: 300, y: 250 }, 1);
  const offscreen = buildingActorWindow({ x: 1, y: 1 }, { x: -300, y: -250 }, 1);
  expect(art.paint(context, sprite, rect, 10, [], 800, 520, 2)).toBe(false);
  expect(art.paint(context, sprite, rect, 10, [offscreen], 800, 520, 2)).toBe(false);
  expect(buffers).toHaveLength(0);
  for (let frame = 0; frame < 5; frame++) expect(art.paint(context, sprite, rect, 10, [visible], 800, 520, 2)).toBe(true);
  expect(buffers).toHaveLength(1); expect(buffers[0]).toMatchObject({ width: 1600, height: 1040 });
  expect(targetDraws).toHaveLength(5); expect(targetDraws.every(draw => draw[0] === buffers[0])).toBe(true);
  expect(draws.filter(draw => draw.image === sprite.image).every(draw => draw.operation === 'source-over')).toBe(true);
  expect(draws.filter(draw => draw.image !== sprite.image).every(draw => draw.operation === 'destination-out')).toBe(true);
  expect(stops.slice(0, 3)).toEqual([[0, '#000000ff'], [.72, '#000000f5'], [1, '#00000000']]);
  expect(layer.globalCompositeOperation).toBe('source-over');
  expect(sprite.image.width).toBe(8000);
  art.clear(); expect(buffers[0]).toMatchObject({ width: 0, height: 0 });
});
