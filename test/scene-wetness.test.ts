import { expect, spyOn, test } from 'bun:test';
import { advanceSurfaceWetness, sampleRainHistoryWetness, settledSurfaceWetness, SURFACE_DRY_MS } from '../src/scene-wetness';
import { readSceneClimate, resetSceneClimatePreview, sampleSceneClimate, SCENE_WEATHER_MS, setSceneClimatePreviewSpeed, setSceneWeatherMode } from '../src/scene-climate';

test('rain fills hollows faster than exposed ground dries and elapsed render frames cannot change wetness', () => {
  const wet = advanceSurfaceWetness(0, .92, 45_000);
  expect(wet).toBeGreaterThan(.7); expect(wet).toBeLessThan(settledSurfaceWetness(.92));
  expect(advanceSurfaceWetness(1, 0, SURFACE_DRY_MS)).toBeCloseTo(Math.exp(-1), 12);
  let split = .17;
  for (let i = 0; i < 2250; i++) split = advanceSurfaceWetness(split, .92, 20);
  expect(split).toBeCloseTo(advanceSurfaceWetness(.17, .92, 45_000), 12);
  expect(advanceSurfaceWetness(.8, 0, 60_000)).toBeGreaterThan(.5);
  expect(advanceSurfaceWetness(.8, 0, 5 * 60_000)).toBeLessThan(.12);
});

test('causal rain history is bounded, deterministic and periodic at calendar timestamps', () => {
  const period = SCENE_WEATHER_MS, rainAt = (t: number) => .46 + Math.sin(t / period * Math.PI * 2) * .46;
  const now = 1792060000000;
  let samples = 0;
  const result = sampleRainHistoryWetness(now, t => { samples++; expect(t).toBeLessThan(now); return rainAt(t); });
  expect(samples).toBe(144); expect(result).toBeGreaterThan(0); expect(result).toBeLessThan(1);
  expect(sampleRainHistoryWetness(now + period, rainAt)).toBeCloseTo(result, 9);
  expect(sampleRainHistoryWetness(now, rainAt)).toBe(result);
  expect(sampleRainHistoryWetness(now, () => 0)).toBe(0);
  expect(sampleRainHistoryWetness(now, () => .92)).toBeCloseTo(settledSurfaceWetness(.92), 10);
});

test('a manual-to-automatic anchor retains its wet ground and advances with actual rain, without frame history', () => {
  const at = 1792060000000, anchor = { timeMs: at, wetness: .2 };
  expect(sampleRainHistoryWetness(at, () => .92, anchor)).toBe(.2);
  expect(sampleRainHistoryWetness(at + 30_000, () => .92, anchor)).toBeCloseTo(advanceSurfaceWetness(.2, .92, 30_000), 12);
  expect(sampleRainHistoryWetness(at + 150_000, () => 0, anchor)).toBeCloseTo(.2 * Math.exp(-1), 12);
  expect(sampleRainHistoryWetness(at - 1000, () => .92, anchor)).toBe(.2);
  expect(sampleRainHistoryWetness(at + 4_000_000, () => .92, anchor)).toBeCloseTo(settledSurfaceWetness(.92), 10);
});

test('invalid levels, clocks and long unattended sessions cannot overflow wetness', () => {
  for (const initial of [NaN, Infinity, -1, .5, 3]) for (const rain of [NaN, Infinity, -1, .5, 3]) for (const elapsed of [NaN, Infinity, -1, 0, 1e300]) {
    const wet = advanceSurfaceWetness(initial, rain, elapsed);
    expect(Number.isFinite(wet)).toBe(true); expect(wet).toBeGreaterThanOrEqual(0); expect(wet).toBeLessThanOrEqual(1);
  }
  for (const time of [NaN, Infinity, -1e300, 1e300]) expect(Number.isFinite(sampleRainHistoryWetness(time, () => Infinity))).toBe(true);
});

test('automatic weather leaves puddles after rain and gradually dries them through the following fog and clear period', () => {
  const end = sampleSceneClimate(.52 * SCENE_WEATHER_MS), later = sampleSceneClimate(.7 * SCENE_WEATHER_MS), dry = sampleSceneClimate(.99 * SCENE_WEATHER_MS);
  expect(end.rain).toBe(0); expect(end.wetness).toBeGreaterThan(.5);
  expect(later.rain).toBe(0); expect(later.wetness).toBeLessThan(end.wetness); expect(later.wetness).toBeGreaterThan(.1);
  expect(dry.wetness).toBeLessThan(.05);
  for (const p of [0, .12, .25, .4, .52, .64, .79, .91, 1]) {
    const before = sampleSceneClimate(p * SCENE_WEATHER_MS - 1), after = sampleSceneClimate(p * SCENE_WEATHER_MS + 1);
    expect(Math.abs(before.wetness - after.wetness)).toBeLessThan(.0001);
    expect(sampleSceneClimate(p * SCENE_WEATHER_MS, 'day').wetness).toBeCloseTo(sampleSceneClimate((p + 1) * SCENE_WEATHER_MS, 'night').wetness, 10);
  }
});

test('manual rain, clear and automatic switches retain ground moisture; accelerated preview changes drying without speeding particles', () => {
  let now = 1792060000000; const clock = spyOn(Date, 'now').mockImplementation(() => now);
  try {
    setSceneWeatherMode('clear'); now += 1_000_000;
    const dry = readSceneClimate().wetness;
    setSceneWeatherMode('rain'); expect(readSceneClimate().wetness).toBe(dry);
    now += 45_000; const wet = readSceneClimate().wetness; expect(wet).toBeGreaterThan(.7);
    setSceneWeatherMode('clear'); expect(readSceneClimate().wetness).toBe(wet);
    now += 30_000; const drying = readSceneClimate().wetness; expect(drying).toBeLessThan(wet); expect(drying).toBeGreaterThan(.5);
    setSceneWeatherMode('clear'); expect(readSceneClimate().wetness).toBe(drying);
    setSceneClimatePreviewSpeed(20); const phase = readSceneClimate().cycleTimeMs;
    now += 7500; expect(readSceneClimate().cycleTimeMs).toBe(phase + 150_000); expect(readSceneClimate().timeMs).toBe(now);
    expect(readSceneClimate().wetness).toBeCloseTo(drying * Math.exp(-1), 12);
    const accelerated = readSceneClimate().wetness; resetSceneClimatePreview(); expect(readSceneClimate().wetness).toBeCloseTo(accelerated, 12);
    setSceneWeatherMode('auto'); expect(readSceneClimate().wetness).toBeCloseTo(accelerated, 12);
    expect(readSceneClimate(12345).wetness).toBe(sampleSceneClimate(12345).wetness);
  } finally { resetSceneClimatePreview(); setSceneWeatherMode('auto'); clock.mockRestore(); }
});

test('reopening clear weather resumes drying from its saved visual anchor instead of erasing puddles', async () => {
  const moduleUrl = new URL('../src/scene-climate.ts', import.meta.url).href;
  const script = `
    import { readSceneClimate, sampleSceneClimate } from ${JSON.stringify(moduleUrl)};
    const now = 1792060000000;
    Date.now = () => now;
    Object.defineProperty(globalThis, 'localStorage', { value: { getItem(key) {
      if (key === 'prapor-scene-weather') return 'clear';
      if (key === 'prapor-scene-wetness-v1') return JSON.stringify({ mode: 'clear', wetness: .9, wall: now - 60_000 });
      return null;
    } } });
    console.log(JSON.stringify({ restored: readSceneClimate().wetness, ordinaryClear: sampleSceneClimate(now, 'auto', 'clear').wetness }));
  `;
  const child = Bun.spawn([process.execPath, '--eval', script], { stdout: 'pipe', stderr: 'pipe' });
  const [output, errors, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(errors).toBe(''); expect(exitCode).toBe(0);
  const result = JSON.parse(output);
  expect(result.ordinaryClear).toBe(0); expect(result.restored).toBeCloseTo(.9 * Math.exp(-60_000 / SURFACE_DRY_MS), 12);
});

test('leaving accelerated automatic or manual weather retains the displayed moisture and persists its new real-time anchor', async () => {
  const moduleUrl = new URL('../src/scene-climate.ts', import.meta.url).href;
  const run = async (script: string) => {
    const child = Bun.spawn([process.execPath, '--eval', `import * as climate from ${JSON.stringify(moduleUrl)}; ${script}`], { stdout: 'pipe', stderr: 'pipe' });
    const [output, errors, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(errors).toBe(''); expect(exitCode).toBe(0); return JSON.parse(output);
  };
  const first = await run(`
    let now = 1792060000000;
    Date.now = () => now;
    const values = {};
    Object.defineProperty(globalThis, 'localStorage', { value: { getItem: key => values[key] ?? null, setItem: (key, value) => { values[key] = value; } } });
    climate.setSceneClimatePreviewSpeed(20); now += 20_000;
    const autoBefore = climate.readSceneClimate().wetness;
    climate.resetSceneClimatePreview();
    const autoAfter = climate.readSceneClimate().wetness;
    climate.setSceneWeatherMode('clear'); climate.setSceneClimatePreviewSpeed(20); now += 7500;
    const manualBefore = climate.readSceneClimate().wetness;
    climate.resetSceneClimatePreview();
    const manualAfter = climate.readSceneClimate().wetness;
    console.log(JSON.stringify({ now, values, autoBefore, autoAfter, manualBefore, manualAfter }));
  `);
  expect(first.autoAfter).toBeCloseTo(first.autoBefore, 12); expect(first.manualAfter).toBeCloseTo(first.manualBefore, 12);
  const anchor = JSON.parse(first.values['prapor-scene-wetness-v1']);
  expect(anchor.wall).toBe(first.now); expect(anchor.wetness).toBeCloseTo(first.manualAfter, 12);
  const reopened = await run(`
    Date.now = () => ${first.now + 1000};
    const values = ${JSON.stringify(first.values)};
    Object.defineProperty(globalThis, 'localStorage', { value: { getItem: key => values[key] ?? null } });
    console.log(JSON.stringify({ wetness: climate.readSceneClimate().wetness }));
  `);
  expect(reopened.wetness).toBeCloseTo(first.manualAfter * Math.exp(-1000 / SURFACE_DRY_MS), 12);
});
