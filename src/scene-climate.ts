import { advanceSurfaceWetness, sampleRainHistoryWetness, settledSurfaceWetness } from './scene-wetness';

export type SceneLightMode = 'auto' | 'day' | 'dusk' | 'night';
export type SceneWeatherMode = 'auto' | 'clear' | 'rain' | 'fog';
export interface SceneLightProfile { ambient: string; ambientAlpha: number; lights: number; shadowAlpha: number }
export interface SceneClimate {
  timeMs: number; cycleTimeMs: number; dayPhase: number; phaseLabel: string; clockLabel: string; weatherLabel: string;
  rain: number; fog: number; wind: number; wetness: number; profile: SceneLightProfile;
}
export const SCENE_DAY_MS = 24 * 60 * 1000;
export const SCENE_WEATHER_MS = 18 * 60 * 1000;
const profiles = {
  day: { ambient: '#eddbb0', ambientAlpha: .025, lights: .18, shadowAlpha: .17 },
  dusk: { ambient: '#142b3b', ambientAlpha: .22, lights: 1, shadowAlpha: .22 },
  night: { ambient: '#09172e', ambientAlpha: .48, lights: 1.5, shadowAlpha: .12 },
  dawn: { ambient: '#9d746a', ambientAlpha: .14, lights: .78, shadowAlpha: .15 },
} satisfies Record<string, SceneLightProfile>;
const smooth = (t: number) => t * t * (3 - 2 * t);
const phase = (time: number, period: number) => ((time % period) + period) % period / period;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function colorMix(a: string, b: string, t: number): string {
  return '#' + [1, 3, 5].map(i => Math.round(mix(parseInt(a.slice(i, i + 2), 16), parseInt(b.slice(i, i + 2), 16), t)).toString(16).padStart(2, '0')).join('');
}
const lightKeys = [[0, profiles.night], [.16, profiles.night], [.25, profiles.dawn], [.34, profiles.day], [.62, profiles.day], [.73, profiles.dusk], [.84, profiles.night], [1, profiles.night]] as const;
export function sceneLightProfile(mode: SceneLightMode, timeMs = Date.now()): SceneLightProfile {
  if (mode !== 'auto') return { ...profiles[mode] };
  const p = phase(Number.isFinite(timeMs) ? timeMs : 0, SCENE_DAY_MS);
  const index = lightKeys.findIndex(([at]) => at > p), [start, a] = lightKeys[Math.max(0, index - 1)]!, [end, b] = lightKeys[index < 0 ? lightKeys.length - 1 : index]!;
  const t = smooth((p - start) / Math.max(.001, end - start));
  return { ambient: colorMix(a.ambient, b.ambient, t), ambientAlpha: mix(a.ambientAlpha, b.ambientAlpha, t), lights: mix(a.lights, b.lights, t), shadowAlpha: mix(a.shadowAlpha, b.shadowAlpha, t) };
}
const weatherKeys = [[0, 0, 0], [.12, 0, 0], [.25, .92, .1], [.40, .92, .1], [.52, 0, 0], [.64, 0, .85], [.79, 0, .85], [.91, 0, 0], [1, 0, 0]] as const;
function automaticWeather(time: number): { rain: number; fog: number } {
  const p = phase(time, SCENE_WEATHER_MS), index = weatherKeys.findIndex(([at]) => at > p);
  const a = weatherKeys[Math.max(0, index - 1)]!, b = weatherKeys[index < 0 ? weatherKeys.length - 1 : index]!;
  const t = smooth((p - a[0]) / Math.max(.001, b[0] - a[0]));
  return { rain: mix(a[1], b[1], t), fog: mix(a[2], b[2], t) };
}
const automaticWetness = (time: number): number => sampleRainHistoryWetness(time, t => automaticWeather(t).rain);
const modeWetness = (time: number, mode: SceneWeatherMode): number => mode === 'auto' ? automaticWetness(time) : settledSurfaceWetness(mode === 'rain' ? .92 : 0);
/** Pure shared-world presentation. No elapsed simulation, rolls, jobs, or writes. */
function sampleClimate(timeMs: number, lightMode: SceneLightMode, weatherMode: SceneWeatherMode): Omit<SceneClimate, 'wetness'> {
  const time = Number.isFinite(timeMs) ? Math.max(-1e15, Math.min(1e15, timeMs)) : 0, dayPhase = phase(time, SCENE_DAY_MS), weather = automaticWeather(time);
  const rain = weatherMode === 'auto' ? weather.rain : weatherMode === 'rain' ? .92 : 0;
  const fog = weatherMode === 'auto' ? weather.fog : weatherMode === 'fog' ? .85 : weatherMode === 'rain' ? .1 : 0;
  const base = sceneLightProfile(lightMode, time), minutes = Math.floor(dayPhase * 1440);
  const phaseLabel = lightMode === 'auto' ? dayPhase < .16 || dayPhase >= .84 ? 'Ночь' : dayPhase < .34 ? 'Рассвет' : dayPhase < .62 ? 'День' : 'Закат'
    : lightMode === 'day' ? 'День' : lightMode === 'night' ? 'Ночь' : 'Сумерки';
  return { timeMs: time, cycleTimeMs: time, dayPhase, phaseLabel, clockLabel: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
    rain, fog, wind: .24 + Math.sin(time / 47000) * .2, weatherLabel: rain > .12 ? 'Дождь' : fog > .12 ? 'Туман' : 'Ясно',
    profile: { ambient: colorMix(base.ambient, '#536977', rain * .16 + fog * .11), ambientAlpha: Math.min(.56, base.ambientAlpha + rain * .055 + fog * .065),
      lights: base.lights + rain * .1 + fog * .08, shadowAlpha: base.shadowAlpha * (1 - rain * .55 - fog * .42) } };
}
export function sampleSceneClimate(timeMs: number, lightMode: SceneLightMode = 'auto', weatherMode: SceneWeatherMode = 'auto'): SceneClimate {
  const climate = sampleClimate(timeMs, lightMode, weatherMode);
  return { ...climate, wetness: modeWetness(climate.cycleTimeMs, weatherMode) };
}

export function parseSceneLightMode(value: unknown): SceneLightMode { return value === 'day' || value === 'dusk' || value === 'night' ? value : 'auto'; }
export function parseSceneWeatherMode(value: unknown): SceneWeatherMode { return value === 'clear' || value === 'rain' || value === 'fog' ? value : 'auto'; }
// The new default enables automatic days once, while retaining manual overrides.
const lightKey = 'prapor-scene-light-v2', weatherKey = 'prapor-scene-weather', wetnessKey = 'prapor-scene-wetness-v1';
let selectedLight: SceneLightMode | null = null, selectedWeather: SceneWeatherMode | null = null;
type WetAnchor = { mode: SceneWeatherMode; wetness: number; clock: number };
let wetAnchor: WetAnchor | null = null, wetAnchorLoaded = false;
function anchorWetness(climate: Pick<SceneClimate, 'cycleTimeMs' | 'rain'>, mode: SceneWeatherMode): number {
  if (!wetAnchor || wetAnchor.mode !== mode) return modeWetness(climate.cycleTimeMs, mode);
  const elapsed = Math.max(0, climate.cycleTimeMs - wetAnchor.clock);
  return mode === 'auto'
    ? sampleRainHistoryWetness(climate.cycleTimeMs, t => automaticWeather(t).rain, { timeMs: wetAnchor.clock, wetness: wetAnchor.wetness })
    : advanceSurfaceWetness(wetAnchor.wetness, climate.rain, elapsed);
}
function persistWetAnchor(wall: number): void {
  if (!wetAnchor) return;
  try { globalThis.localStorage?.setItem(wetnessKey, JSON.stringify({ mode: wetAnchor.mode, wetness: wetAnchor.wetness, wall })); } catch { /* Wet ground also dries without storage. */ }
}
function loadWetAnchor(now: number, clock: number, mode: SceneWeatherMode): void {
  if (wetAnchorLoaded) return;
  wetAnchorLoaded = true;
  try {
    const value: unknown = JSON.parse(globalThis.localStorage?.getItem(wetnessKey) ?? 'null');
    if (!value || typeof value !== 'object') return;
    const stored = value as Record<string, unknown>;
    if (stored.mode !== mode || typeof stored.wetness !== 'number' || !Number.isFinite(stored.wetness) || stored.wetness < 0 || stored.wetness > 1 || typeof stored.wall !== 'number' || !Number.isFinite(stored.wall) || stored.wall > now || stored.wall < now - 7 * 86400_000) return;
    const at = clock - (now - stored.wall);
    wetAnchor = { mode, wetness: stored.wetness, clock: at };
  } catch { /* A malformed or unavailable visual preference cannot affect the game. */ }
}
export function readSceneLightMode(): SceneLightMode {
  if (!selectedLight) { try { selectedLight = parseSceneLightMode(globalThis.localStorage?.getItem(lightKey)); } catch { selectedLight = 'auto'; } }
  return selectedLight;
}
export function readSceneWeatherMode(): SceneWeatherMode {
  if (!selectedWeather) { try { selectedWeather = parseSceneWeatherMode(globalThis.localStorage?.getItem(weatherKey)); } catch { selectedWeather = 'auto'; } }
  return selectedWeather;
}
function announce(): void { if (typeof window !== 'undefined') { window.dispatchEvent(new CustomEvent('prapor:climate')); window.dispatchEvent(new CustomEvent('prapor:lighting')); } }
export function setSceneLightMode(mode: SceneLightMode): void {
  selectedLight = parseSceneLightMode(mode); try { globalThis.localStorage?.setItem(lightKey, selectedLight); } catch { /* Visual preferences also work without storage. */ } announce();
}
export function setSceneWeatherMode(mode: SceneWeatherMode): void {
  const next = parseSceneWeatherMode(mode);
  if (next !== readSceneWeatherMode()) {
    const current = readSceneClimate();
    wetAnchor = { mode: next, wetness: current.wetness, clock: current.cycleTimeMs }; wetAnchorLoaded = true;
    persistWetAnchor(current.timeMs);
  }
  selectedWeather = next; try { globalThis.localStorage?.setItem(weatherKey, selectedWeather); } catch { /* Visual preferences also work without storage. */ } announce();
}
let previewSpeed = 1, previewWall = 0, previewClock = 0, previewActive = false;
/** Gallery-only acceleration, never persisted and never used by gameplay. */
export function setSceneClimatePreviewSpeed(speed: 1 | 20): void {
  const now = Date.now(), current = previewActive ? previewClock + (now - previewWall) * previewSpeed : now;
  previewClock = current; previewWall = now; previewSpeed = speed; previewActive = true; announce();
}
export function resetSceneClimatePreview(): void {
  const current = previewActive ? readSceneClimate() : null;
  previewSpeed = 1; previewWall = 0; previewClock = 0; previewActive = false;
  if (current) {
    wetAnchor = { mode: readSceneWeatherMode(), wetness: current.wetness, clock: current.timeMs }; wetAnchorLoaded = true;
    persistWetAnchor(current.timeMs);
  }
}
export function readSceneClimate(timeMs?: number): SceneClimate {
  const now = timeMs ?? Date.now(), clock = timeMs === undefined && previewActive ? previewClock + (now - previewWall) * previewSpeed : now;
  const mode = readSceneWeatherMode(), climate = sampleClimate(clock, readSceneLightMode(), mode);
  if (timeMs === undefined) loadWetAnchor(now, clock, mode);
  const wetness = timeMs === undefined ? anchorWetness(climate, mode) : modeWetness(climate.cycleTimeMs, mode);
  // The gallery can accelerate the sky without speeding up falling rain or smoke.
  return timeMs === undefined && previewActive ? { ...climate, wetness, timeMs: now, wind: .24 + Math.sin(now / 47000) * .2 } : { ...climate, wetness };
}
