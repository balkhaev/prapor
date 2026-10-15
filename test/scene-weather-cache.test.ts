import { describe, expect, test } from 'bun:test';
import { SceneWeatherCache } from '../src/scene-weather-cache';

const input = { width: 360, height: 540, timeMs: 1000, rain: .8, fog: .3, wind: .4 };

describe('screen weather frame reuse', () => {
  test('higher render frequency reuses one bounded sample per 50ms without advancing weather itself', () => {
    const cache = new SceneWeatherCache(), original = structuredClone(input), first = cache.get(input);
    for (const timeMs of [1001, 1016, 1033, 1049]) expect(cache.get({ ...input, timeMs })).toBe(first);
    const next = cache.get({ ...input, timeMs: 1050 }); expect(next).not.toBe(first);
    const samples = new Set();
    for (let elapsed = 0; elapsed < 1000; elapsed += 1000 / 120) samples.add(cache.get({ ...input, timeMs: 1000 + elapsed }));
    expect(samples.size).toBeLessThanOrEqual(20);
    expect(input).toEqual(original);
  });

  test('resizing and reduced-motion changes invalidate immediately, while clear drops the old frame', () => {
    const cache = new SceneWeatherCache(), first = cache.get(input);
    const resized = cache.get({ ...input, width: 800, height: 520 }); expect(resized).not.toBe(first);
    const quiet = cache.get({ ...input, width: 800, height: 520, reducedMotion: true });
    expect(quiet).not.toBe(resized); expect(quiet.rain).toEqual([]); expect(quiet.splashes).toEqual([]);
    cache.clear(); const restored = cache.get({ ...input, width: 800, height: 520, reducedMotion: true });
    expect(restored).not.toBe(quiet); expect(restored).toEqual(quiet);
  });

  test('a paused visual clock stays still and a new weather setting takes effect by the next bounded sample', () => {
    const cache = new SceneWeatherCache(), dry = { ...input, rain: 0, fog: 0 };
    const paused = cache.get(dry);
    for (let frame = 0; frame < 120; frame++) expect(cache.get(dry)).toBe(paused);
    expect(paused.rain).toEqual([]);
    expect(cache.get({ ...input, timeMs: 1050 }).rain.length).toBeGreaterThan(0);
  });
});
