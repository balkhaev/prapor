import { describe, expect, test } from 'bun:test';
import { PIXEL_PALETTE } from '../src/pixel-art';
import { SCENE_WEATHER_LIMITS, sampleSceneWeather, paintSceneWeather, paintCanvasSceneWeather, type SceneWeatherInput, type SceneWeatherFrame, type SceneWeatherGraphics } from '../src/scene-weather';

const input: SceneWeatherInput = { width: 840, height: 520, timeMs: 12000, rain: .8, fog: .7, wind: .35 };
function allNumbers(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(allNumbers);
}

describe('analytic scene weather', () => {
  test('samples are deterministic, independent of call order, and never mutate input', () => {
    const source = Object.freeze({ ...input }), first = sampleSceneWeather(source);
    sampleSceneWeather({ ...input, timeMs: 900000 });
    expect(sampleSceneWeather(source)).toEqual(first);
    expect(source).toEqual(input);
    expect(first.rain.some(drop => drop.alpha > .03)).toBe(true);
    expect(first.fog.every(patch => patch.alpha > 0 && patch.alpha <= .1)).toBe(true);
  });

  test('dry weather and absent viewports produce no effects; invalid strengths stay safe', () => {
    expect(sampleSceneWeather({ ...input, rain: 0, fog: 0 })).toEqual({ rain: [], splashes: [], fog: [] });
    expect(sampleSceneWeather({ ...input, rain: -4, fog: -3 })).toEqual({ rain: [], splashes: [], fog: [] });
    expect(sampleSceneWeather({ ...input, rain: NaN, fog: Infinity })).toEqual({ rain: [], splashes: [], fog: [] });
    for (const width of [0, -100, NaN, Infinity]) expect(sampleSceneWeather({ ...input, width })).toEqual({ rain: [], splashes: [], fog: [] });
  });

  test('particle budgets and numeric bounds survive extreme inputs and long sessions', () => {
    for (const timeMs of [-1e12, NaN, Infinity, 0, 1792062000000, 1e15, Number.MAX_VALUE]) {
      for (const dimensions of [{ width: 1, height: 1 }, { width: 390, height: 700 }, { width: Number.MAX_VALUE, height: Number.MAX_VALUE }]) {
        const frame = sampleSceneWeather({ ...input, ...dimensions, timeMs, rain: 50, fog: 90, wind: -Number.MAX_VALUE });
        expect(frame.rain.length).toBeLessThanOrEqual(SCENE_WEATHER_LIMITS.rain);
        expect(frame.splashes.length).toBeLessThanOrEqual(SCENE_WEATHER_LIMITS.splashes);
        expect(frame.fog.length).toBeLessThanOrEqual(SCENE_WEATHER_LIMITS.fog);
        expect(allNumbers(frame).every(Number.isFinite)).toBe(true);
        expect(allNumbers(frame).every(value => Math.abs(value) < 20000)).toBe(true);
        expect([...frame.rain, ...frame.splashes, ...frame.fog].every(part => part.alpha >= 0 && part.alpha <= .3)).toBe(true);
        expect(frame.fog.every(part => part.alpha <= .1)).toBe(true);
      }
    }
  });

  test('wind leans the rain in its real direction while reduced motion keeps only static fog', () => {
    const left = sampleSceneWeather({ ...input, wind: -1 }), right = sampleSceneWeather({ ...input, wind: 1 }), still = sampleSceneWeather({ ...input, wind: 0 });
    expect(left.rain.every(drop => drop.dx < 0)).toBe(true);
    expect(right.rain.every(drop => drop.dx > 0)).toBe(true);
    expect(still.rain.every(drop => drop.dx === 0)).toBe(true);
    const reduced = sampleSceneWeather({ ...input, timeMs: 0, reducedMotion: true });
    expect(reduced.rain).toEqual([]); expect(reduced.splashes).toEqual([]);
    expect(reduced.fog.some(patch => patch.alpha > .01)).toBe(true);
    expect(sampleSceneWeather({ ...input, timeMs: 1792062000000, wind: -1, reducedMotion: true })).toEqual(reduced);
    expect(sampleSceneWeather({ ...input, timeMs: 1792062000000 })).not.toEqual(sampleSceneWeather({ ...input, timeMs: 1792062001000 }));
  });

  test('visible rain moves continuously and becomes transparent before wrapping', () => {
    for (const timeMs of [0, 12000, 1e9, 1792062000000]) {
      const from = sampleSceneWeather({ ...input, timeMs }), to = sampleSceneWeather({ ...input, timeMs: timeMs + 16 });
      for (let index = 0; index < from.rain.length; index++) {
        const a = from.rain[index]!, b = to.rain[index]!;
        if (a.alpha > .02 && b.alpha > .02) {
          expect(Math.abs(a.x - b.x)).toBeLessThan(3);
          expect(Math.abs(a.y - b.y)).toBeLessThan(7);
        }
      }
      for (let index = 0; index < from.fog.length; index++) {
        const a = from.fog[index]!, b = to.fog[index]!;
        expect(Math.abs(a.x - b.x)).toBeLessThan(.2);
        expect(Math.abs(a.y - b.y)).toBeLessThan(.05);
        expect(Math.abs(a.alpha - b.alpha)).toBeLessThan(.0001);
      }
    }
    // Find a fall boundary from its geometry, independently of the sampler's periods.
    let low = 0, high = 0, previousY = sampleSceneWeather({ ...input, timeMs: 0 }).rain[0]!.y;
    for (let timeMs = 16; timeMs < 10000; timeMs += 16) {
      const y = sampleSceneWeather({ ...input, timeMs }).rain[0]!.y;
      if (y < previousY - 100) { low = timeMs - 16; high = timeMs; break; }
      previousY = y;
    }
    expect(high).toBeGreaterThan(0);
    for (let index = 0; index < 30; index++) {
      const middle = (low + high) / 2;
      if (sampleSceneWeather({ ...input, timeMs: middle }).rain[0]!.y > 100) low = middle; else high = middle;
    }
    for (const timeMs of [low - .001, high + .001]) expect(sampleSceneWeather({ ...input, timeMs }).rain[0]!.alpha).toBeLessThan(1e-8);
  });

  test('rain intensity admits new slots at zero opacity and splashes stay sparse', () => {
    const slots = sampleSceneWeather({ ...input, rain: 1 }).rain.length, boundary = 20 / slots;
    const before = sampleSceneWeather({ ...input, rain: boundary - 1e-8 }), after = sampleSceneWeather({ ...input, rain: boundary + 1e-8 });
    expect(before.rain).toHaveLength(20); expect(after.rain).toHaveLength(21);
    expect(after.rain.at(-1)!.alpha).toBeLessThan(1e-8);
    let active = 0;
    for (let timeMs = 0; timeMs <= 10000; timeMs += 100) {
      const splashes = sampleSceneWeather({ ...input, rain: 1, timeMs }).splashes;
      active += splashes.filter(splash => splash.alpha > .01).length;
      expect(splashes.length).toBeLessThan(10);
    }
    expect(active).toBeGreaterThan(10);
  });
});

type Draw = { kind: 'rect' | 'line'; values: number[]; color: number; alpha: number };
function recordingGraphics(): { graphics: SceneWeatherGraphics; draws: Draw[] } {
  const draws: Draw[] = []; let color = 0, alpha = 1;
  return { draws, graphics: {
    fillStyle(paint, opacity = 1) { color = paint; alpha = opacity; },
    lineStyle(_width, paint, opacity = 1) { color = paint; alpha = opacity; },
    fillRect(...values) { draws.push({ kind: 'rect', values, color, alpha }); },
    lineBetween(...values) { draws.push({ kind: 'line', values, color, alpha }); },
  } };
}

test('both painters preserve quiet integer pixel art, bounded work and canvas drawing state', () => {
  const frame = sampleSceneWeather({ ...input, rain: 1, fog: 1 }), record = recordingGraphics();
  paintSceneWeather(record.graphics, frame);
  expect(record.draws.length).toBeGreaterThan(50);
  expect(record.draws.length).toBeLessThanOrEqual(6 * 7 + 100 + 20 * 3);
  expect(record.draws.every(draw => draw.values.every(Number.isInteger))).toBe(true);
  const palette = new Set(Object.values(PIXEL_PALETTE).map(color => Number.parseInt(color.slice(1), 16)));
  expect(record.draws.every(draw => palette.has(draw.color) && draw.alpha > 0 && draw.alpha <= .3)).toBe(true);
  expect(record.draws.filter(draw => draw.kind === 'rect' && draw.values[3]! > 1).every(draw => draw.alpha <= .1)).toBe(true);
  const canvasDraws: number[][] = [];
  const canvas = { fillStyle: '#123456', globalAlpha: .81, globalCompositeOperation: 'multiply',
    save() { saved = [this.fillStyle, this.globalAlpha, this.globalCompositeOperation]; },
    restore() { [this.fillStyle, this.globalAlpha, this.globalCompositeOperation] = saved as [string, number, string]; },
    fillRect(...values: number[]) { canvasDraws.push(values); },
  };
  let saved: unknown[] = [];
  paintCanvasSceneWeather(canvas as unknown as CanvasRenderingContext2D, frame);
  expect([canvas.fillStyle, canvas.globalAlpha, canvas.globalCompositeOperation]).toEqual(['#123456', .81, 'multiply']);
  expect(canvasDraws.length).toBeLessThan(1800);
  expect(canvasDraws.every(draw => draw.every(Number.isInteger) && draw[2]! > 0 && draw[3]! > 0)).toBe(true);
  const noRain = { ...frame, rain: [] }, shapeRecord = recordingGraphics();
  paintSceneWeather(shapeRecord.graphics, noRain); canvasDraws.length = 0;
  paintCanvasSceneWeather(canvas as unknown as CanvasRenderingContext2D, noRain);
  expect(canvasDraws).toEqual(shapeRecord.draws.map(draw => draw.values));
});

test('painters cap malformed external frames and restore canvas state after a failed drawing operation', () => {
  const frame: SceneWeatherFrame = {
    rain: Array.from({ length: 500 }, () => ({ x: 10, y: 10, dx: 1e20, dy: 1e20, alpha: 99 })),
    splashes: Array.from({ length: 500 }, () => ({ x: 10, y: 10, width: 1e20, alpha: 99 })),
    fog: Array.from({ length: 500 }, () => ({ x: 10, y: 10, width: 1e20, height: 1e20, alpha: 99 })),
  };
  const record = recordingGraphics(); paintSceneWeather(record.graphics, frame);
  expect(record.draws).toHaveLength(6 * 7 + 100 + 20 * 3);
  expect(record.draws.every(draw => draw.alpha <= .3)).toBe(true);
  const invalid = recordingGraphics();
  paintSceneWeather(invalid.graphics, { rain: [{ x: NaN, y: 0, dx: 1, dy: 1, alpha: 1 }], splashes: [], fog: [] });
  expect(invalid.draws).toHaveLength(0);
  let restored = false;
  const canvas = { save() {}, restore() { restored = true; }, fillRect() { throw new Error('drawing failed'); } };
  expect(() => paintCanvasSceneWeather(canvas as unknown as CanvasRenderingContext2D, frame)).toThrow('drawing failed');
  expect(restored).toBe(true);
});
