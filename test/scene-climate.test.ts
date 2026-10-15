import { afterEach, expect, spyOn, test } from 'bun:test';
import { SCENE_DAY_MS as DAY, SCENE_WEATHER_MS as WEATHER, parseSceneLightMode, parseSceneWeatherMode, readSceneClimate, resetSceneClimatePreview, sampleSceneClimate, sceneLightProfile, setSceneClimatePreviewSpeed } from '../src/scene-climate';

const channels = (color: string) => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
afterEach(() => { resetSceneClimatePreview(); });

test('automatic daylight repeats across full days and remains continuous at sunrise, sunset and midnight', () => {
  for (const boundary of [0, .16, .25, .34, .62, .73, .84, 1]) {
    const a = sampleSceneClimate(boundary * DAY - 5, 'auto', 'clear'), b = sampleSceneClimate(boundary * DAY + 5, 'auto', 'clear');
    expect(Math.abs(a.profile.ambientAlpha - b.profile.ambientAlpha)).toBeLessThan(.0001);
    expect(Math.abs(a.profile.lights - b.profile.lights)).toBeLessThan(.0001);
    channels(a.profile.ambient).forEach((channel, i) => expect(Math.abs(channel - channels(b.profile.ambient)[i]!)).toBeLessThanOrEqual(1));
  }
  for (const p of [.05, .21, .38, .68, .95]) expect(sampleSceneClimate(p * DAY, 'auto', 'clear').profile).toEqual(sampleSceneClimate((p + 1) * DAY, 'auto', 'clear').profile);
  expect(sampleSceneClimate(.42 * DAY, 'auto', 'clear').profile.ambientAlpha).toBeLessThan(sampleSceneClimate(.95 * DAY, 'auto', 'clear').profile.ambientAlpha);
  expect(sampleSceneClimate(.21 * DAY, 'auto', 'clear').phaseLabel).toBe('Рассвет');
  expect(sampleSceneClimate(.69 * DAY, 'auto', 'clear').phaseLabel).toBe('Закат');
});

test('weather fades through clear, rain and fog without stepping or resetting on each redraw', () => {
  for (const p of [0, .12, .25, .40, .52, .64, .79, .91, 1]) {
    const a = sampleSceneClimate(p * WEATHER - 1), b = sampleSceneClimate(p * WEATHER + 1);
    expect(Math.abs(a.rain - b.rain)).toBeLessThan(.0001); expect(Math.abs(a.fog - b.fog)).toBeLessThan(.0001);
  }
  expect(sampleSceneClimate(.05 * WEATHER).weatherLabel).toBe('Ясно');
  expect(sampleSceneClimate(.32 * WEATHER).rain).toBeGreaterThan(.9);
  expect(sampleSceneClimate(.7 * WEATHER).fog).toBeGreaterThan(.8);
  expect(sampleSceneClimate(.7 * WEATHER).rain).toBe(0);
  const before = sampleSceneClimate(.2 * WEATHER), after = sampleSceneClimate(.2 * WEATHER + 1000);
  expect(after.rain).toBeGreaterThan(before.rain); expect(after.rain - before.rain).toBeLessThan(.02);
});

test('manual visual overrides do not stop the common world clock or alter future automatic samples', () => {
  const original = sampleSceneClimate(1750000), manual = sampleSceneClimate(1750000, 'day', 'fog');
  expect(manual.timeMs).toBe(original.timeMs); expect(manual.dayPhase).toBe(original.dayPhase);
  expect(manual.rain).toBe(0); expect(manual.fog).toBe(.85);
  expect(sampleSceneClimate(1750000, 'night', 'rain').rain).toBe(.92);
  expect(sampleSceneClimate(1750000)).toEqual(original);
  const profile = sceneLightProfile('day'); profile.ambientAlpha = 1;
  expect(sceneLightProfile('day').ambientAlpha).toBe(.025);
  for (const value of [undefined, null, 'unknown', {}, 3]) { expect(parseSceneLightMode(value)).toBe('auto'); expect(parseSceneWeatherMode(value)).toBe('auto'); }
});

test('calendar timestamps, invalid inputs and long sessions stay deterministic, bounded and moving', () => {
  for (const t of [NaN, Infinity, -Infinity, -1e300, 1e300, 1792060000000]) {
    const climate = sampleSceneClimate(t); expect(climate).toEqual(sampleSceneClimate(t));
    expect([climate.timeMs, climate.dayPhase, climate.rain, climate.fog, climate.wind, ...Object.values(climate.profile).filter(v => typeof v === 'number')].every(Number.isFinite)).toBe(true);
    expect(climate.profile.ambientAlpha).toBeLessThanOrEqual(.56); expect(climate.rain).toBeGreaterThanOrEqual(0); expect(climate.fog).toBeLessThanOrEqual(1);
    expect(climate.clockLabel).toMatch(/^\d{2}:\d{2}$/);
  }
  expect(sampleSceneClimate(1792060000000).dayPhase).not.toBe(sampleSceneClimate(1792060001000).dayPhase);
});

test('gallery acceleration preserves the phase when speed changes and never affects explicit samples', () => {
  let now = 1792060000000; const clock = spyOn(Date, 'now').mockImplementation(() => now);
  try {
    const before = readSceneClimate().cycleTimeMs; setSceneClimatePreviewSpeed(20); expect(readSceneClimate().cycleTimeMs).toBe(before);
    now += 5000; expect(readSceneClimate().cycleTimeMs).toBe(before + 100000); expect(readSceneClimate().timeMs).toBe(now);
    const accelerated = readSceneClimate().cycleTimeMs; setSceneClimatePreviewSpeed(1); expect(readSceneClimate().cycleTimeMs).toBe(accelerated);
    now += 1000; expect(readSceneClimate().cycleTimeMs).toBe(accelerated + 1000); expect(readSceneClimate().timeMs).toBe(now);
    expect(readSceneClimate(12345).timeMs).toBe(12345);
    resetSceneClimatePreview(); expect(readSceneClimate().timeMs).toBe(now);
  } finally { clock.mockRestore(); }
});
