import { afterEach, expect, test } from 'bun:test';
import { LiveScene } from '../src/live-scene';
import { generateLiveWorld } from '../src/game/world-generation';
import { createCityPreviewSnapshot } from '../src/metropolis-preview';
import type { LiveSnapshot, LiveWorld } from '../src/game/live';

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

test('actual metropolis caches bounded maps once, reuses distant frames and releases world bitmaps', () => {
  const canvases: Element[] = [];
  class Element {
    width = 0; height = 0; hidden = false;
    classList = { add() {}, remove() {} };
    context = new Proxy({ canvas: this,
      createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
      createPattern: () => ({ setTransform() {} }), createRadialGradient: () => ({ addColorStop() {} }),
      measureText: (text: string) => ({ width: text.length * 6 }),
    } as Record<PropertyKey, unknown>, { get: (target, key) => key in target ? target[key] : () => {}, set: (target, key, value) => { target[key] = value; return true; } });
    getContext() { return this.context; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
    setAttribute() {} append() {} focus() {} remove() {} addEventListener() {} removeEventListener() {}
    querySelectorAll() { return []; } querySelector() { return null; }
  }
  const keys = ['document', 'ResizeObserver', 'MutationObserver', 'cancelAnimationFrame'] as const;
  const old = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), Observer = class { observe() {} disconnect() {} };
  const values = [{ createElement: (tag: string) => { const element = new Element(); if (tag === 'canvas') canvases.push(element); return element; } }, Observer, Observer, () => {}];
  keys.forEach((key, index) => Object.defineProperty(globalThis, key, { configurable: true, value: values[index] }));
  restore = () => keys.forEach((key, index) => { if (old[index]) Object.defineProperty(globalThis, key, old[index]!); else Reflect.deleteProperty(globalThis, key); });
  const world = generateLiveWorld(), scene = new LiveScene(new Element() as unknown as HTMLElement, () => { throw new Error('Gallery issued command'); }, () => {}, { observer: true, controls: false });
  const view = scene as unknown as { cacheTerrain: (world: LiveWorld) => void; paint: () => void; snapshot: LiveSnapshot; propArt: { get: () => never }; buildingArt: { get: () => never } };
  expect(world.width).toBe(1024); expect(world.citySites!.flatMap(site => site.buildings).length).toBeGreaterThan(700);
  view.cacheTerrain(world); view.snapshot = createCityPreviewSnapshot(world, 0);
  const bitmapSizes = canvases.filter(canvas => canvas.width >= 1000).map(canvas => [canvas.width, canvas.height]);
  expect(bitmapSizes).toEqual([[4096, 4096], [1024, 1024], [2048, 1024]]);
  view.propArt.get = view.buildingArt.get = () => { throw new Error('Distant view rebuilt a detail sprite'); };
  scene.showOverview(true); const count = canvases.length;
  for (let frame = 0; frame < 30; frame++) view.paint();
  expect(canvases.length).toBe(count);
  expect(canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0)).toBeLessThan(78 * 1024 * 1024);
  scene.clear();
  expect(canvases.every(canvas => canvas.width < 1000)).toBe(true);
  expect(canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0)).toBeLessThan(1024 * 1024);
  scene.destroy();
}, 20000);
