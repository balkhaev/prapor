import { afterEach, expect, test } from 'bun:test';
import { LiveScene } from '../src/live-scene';
import type { LiveCommand, LiveSnapshot } from '../src/game/live';
import { METROPOLIS_CITY } from '../src/game/world-metropolis-plan';

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

test('camera leaves the million-cell overview without a scale jump and never issues a game command', () => {
  const element = () => ({ hidden: false, classList: { add() {}, remove() {} }, getContext: () => ({}), getBoundingClientRect: () => ({ width: 0, height: 0 }),
    setAttribute() {}, append() {}, focus() {}, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, remove() {} });
  const keys = ['document', 'ResizeObserver', 'MutationObserver', 'cancelAnimationFrame'] as const;
  const old = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const Observer = class { observe() {} disconnect() {} };
  const values = [{ createElement: element }, Observer, Observer, () => {}];
  keys.forEach((key, index) => Object.defineProperty(globalThis, key, { configurable: true, value: values[index] }));
  restore = () => keys.forEach((key, index) => { if (old[index]) Object.defineProperty(globalThis, key, old[index]!); else Reflect.deleteProperty(globalThis, key); });
  const commands: LiveCommand[] = [], scene = new LiveScene(element() as unknown as HTMLElement, command => commands.push(command), () => {}, { observer: true, controls: false });
  const view = scene as unknown as { snapshot: LiveSnapshot; paint: () => void; viewTile: (world: LiveSnapshot['world']) => number; following: boolean; camera: { x: number; y: number }; width: number; height: number; tile: number };
  const world = { width: 1024, height: 1024, city: METROPOLIS_CITY } as LiveSnapshot['world'];
  view.snapshot = { world } as LiveSnapshot; view.paint = () => {};
  for (const [width, height] of [[1280, 720], [390, 600]]) {
    view.width = width!; view.height = height!;
    scene.showOverview(); const before = view.viewTile(world);
    scene.zoomBy(1.2);
    expect(view.viewTile(world)).toBeCloseTo(before * 1.2, 8);
    expect(view.camera).toEqual({ x: 512, y: 512 }); expect(view.following).toBe(false);
    scene.showOverview(true); const cityBefore = view.viewTile(world);
    scene.zoomBy(.8); expect(view.viewTile(world)).toBeCloseTo(cityBefore * .8, 8);
    scene.focusPoint({ x: 842, y: 716 }); expect(view.camera).toEqual({ x: 842, y: 716 });
    expect(view.viewTile(world)).toBeGreaterThan(30);
    scene.focusPoint({ x: 2000, y: -1 }); expect(view.camera).toEqual({ x: 842, y: 716 });
  }
  expect(commands).toEqual([]);
  scene.destroy();
});
