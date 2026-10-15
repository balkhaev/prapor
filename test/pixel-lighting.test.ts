import { afterEach, expect, test } from 'bun:test';
import { parseSceneLightMode, propLampSources, sceneLightProfile, SceneLightBuffer, visibleSceneLamps } from '../src/pixel-lighting';
import { waterBankEdges } from '../src/live-ground-art';
import type { LiveTerrain, LiveWorldProp } from '../src/game/live';
import { sampleSceneClimate, SCENE_DAY_MS } from '../src/scene-climate';

test('lighting modes retain scene detail and put stronger practical lights into darker scenes', () => {
  const day = sceneLightProfile('day'), dusk = sceneLightProfile('dusk'), night = sceneLightProfile('night');
  expect(day.ambientAlpha).toBeLessThan(dusk.ambientAlpha); expect(dusk.ambientAlpha).toBeLessThan(night.ambientAlpha);
  expect(night.ambientAlpha).toBeLessThan(.55); expect(day.lights).toBeLessThan(dusk.lights); expect(dusk.lights).toBeLessThan(night.lights);
  for (const value of [undefined, null, 'broken', {}, 7]) expect(parseSceneLightMode(value)).toBe('auto');
  expect(parseSceneLightMode('day')).toBe('day'); expect(parseSceneLightMode('night')).toBe('night');
});

test('only authored lamp arms emit, with a ground and bulb at their actual native height', () => {
  const lamp: LiveWorldProp = { id: 'lamp', x: 2, y: 3, width: .25, height: .25, orientation: 'x', variant: 0, kind: 'lamp', blocking: false };
  const before = structuredClone(lamp), single = propLampSources(lamp), twin = propLampSources({ ...lamp, variant: 1 });
  expect(single).toHaveLength(1); expect(twin).toHaveLength(2); expect(single[0]!.y - single[0]!.headY).toBe(199);
  expect(twin[0]!.x + twin[1]!.x).toBe(0); expect(propLampSources({ ...lamp, kind: 'tree' })).toEqual([]); expect(lamp).toEqual(before);
});

test('offscreen and invalid emitters are culled before the bounded nearest light budget', () => {
  const lamps = Array.from({ length: 90 }, (_, i) => ({ x: i * 6, y: 100, headY: 30, radius: 40 }));
  lamps.push({ x: NaN, y: 3, headY: 4, radius: 20 }, { x: 2, y: 3, headY: 4, radius: Infinity });
  const before = structuredClone(lamps), visible = visibleSceneLamps(lamps, 300, 200);
  expect(visible).toHaveLength(32); expect(visible[0]!.x).toBe(150); expect(visible.every(light => light.x <= 340)).toBe(true); expect(lamps).toEqual(before);
});

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });
test('one bounded light mask is reused until the mode or projected sources change, then released', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document'); let creates = 0, paints = 0;
  const context = { clearRect() { paints++; }, fillRect() {}, scale() {}, save() {}, restore() {}, translate() {}, createRadialGradient() { return { addColorStop() {} }; } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() { creates++; return { width: 0, height: 0, getContext: () => context }; } } });
  restore = () => { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); };
  const buffer = new SceneLightBuffer(), lights = [{ x: 200, y: 300, headY: 100, radius: 70 }];
  expect(buffer.paint(4000, 3000, lights, 'dusk')).toBe(true); expect(buffer.canvas.width).toBeLessThanOrEqual(640); expect(buffer.canvas.height).toBeLessThanOrEqual(480);
  expect(buffer.paint(4000, 3000, lights, 'dusk')).toBe(false); expect(creates).toBe(1); expect(paints).toBe(1);
  expect(buffer.paint(4000, 3000, lights, 'night')).toBe(true); expect(creates).toBe(1);
  const morning = sampleSceneClimate(SCENE_DAY_MS * .21, 'auto', 'clear'), noon = sampleSceneClimate(SCENE_DAY_MS * .5, 'auto', 'clear');
  expect(buffer.paint(4000, 3000, lights, 'auto', morning)).toBe(true);
  expect(buffer.paint(4000, 3000, lights, 'auto', morning)).toBe(false);
  expect(buffer.paint(4000, 3000, lights, 'auto', noon)).toBe(true);
  const old = buffer.canvas; buffer.clear(); expect(old.width).toBe(1); expect(old.height).toBe(1);
});

test('bank highlights follow the water geometry, including islands and the outer world edge', () => {
  const terrain: LiveTerrain[] = ['water', 'water', 'water', 'water', 'grass', 'water', 'water', 'water', 'water'];
  const before = [...terrain], edges = waterBankEdges(3, 3, terrain);
  expect([...edges]).toEqual([0, 8, 0, 2, 0, 1, 0, 4, 0]); expect(terrain).toEqual(before);
  expect([...waterBankEdges(2, 2, ['water', 'water', 'water', 'water'])]).toEqual([0, 0, 0, 0]);
});
