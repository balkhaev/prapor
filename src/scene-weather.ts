import { PIXEL_PALETTE as P } from './pixel-art';

export interface SceneWeatherInput {
  width: number;
  height: number;
  timeMs: number;
  /** Normalized visual intensity, independent of game state. */
  rain: number;
  fog: number;
  /** Horizontal breeze: -1 left, 0 still, 1 right. */
  wind: number;
  reducedMotion?: boolean;
}
export interface SceneRainStreak { x: number; y: number; dx: number; dy: number; alpha: number }
export interface SceneRainSplash { x: number; y: number; width: number; alpha: number }
export interface SceneFogBand { x: number; y: number; width: number; height: number; alpha: number }
export interface SceneWeatherFrame { rain: SceneRainStreak[]; splashes: SceneRainSplash[]; fog: SceneFogBand[] }
/** A structural subset of Phaser Graphics; adapters own clearing, depth and clipping. */
export interface SceneWeatherGraphics {
  fillStyle(color: number, alpha?: number): unknown;
  fillRect(x: number, y: number, width: number, height: number): unknown;
  lineStyle(width: number, color: number, alpha?: number): unknown;
  lineBetween(x1: number, y1: number, x2: number, y2: number): unknown;
}
export const SCENE_WEATHER_LIMITS = Object.freeze({ rain: 100, splashes: 20, fog: 6 });
const TAU = Math.PI * 2;
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const phase = (value: number): number => value - Math.floor(value);
const smooth = (value: number): number => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const envelope = (value: number, edge: number): number => smooth(value / edge) * smooth((1 - value) / edge);
/** Stateless integer hashing distributes slots without a random generator or particle history. */
function unit(index: number, salt: number): number {
  let value = Math.imul(index + 1, 0x9e3779b1) ^ salt;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
}
const oscillate = (timeMs: number, period: number, offset = 0): number => Math.sin(phase(timeMs / period + offset) * TAU);

/** Screen-space weather is an analytic view of time, with no clocks, storage or mutable particles.
 * Slot opacity reaches zero before a fall wraps; fog drifts on continuous periodic curves. */
export function sampleSceneWeather(input: SceneWeatherInput): SceneWeatherFrame {
  const frame: SceneWeatherFrame = { rain: [], splashes: [], fog: [] };
  const width = clamp(finite(input.width), 0, 16384), height = clamp(finite(input.height), 0, 16384);
  if (width < 1 || height < 1) return frame;
  const reduced = input.reducedMotion === true, t = reduced ? 0 : Math.max(0, finite(input.timeMs));
  const rain = clamp(finite(input.rain), 0, 1), fog = clamp(finite(input.fog), 0, 1);
  const wind = reduced ? 0 : clamp(finite(input.wind), -1, 1);
  if (rain > 0 && !reduced) {
    const slots = Math.min(SCENE_WEATHER_LIMITS.rain, Math.max(12, Math.round(Math.sqrt(width * height) / 7)));
    const density = slots * rain;
    for (let index = 0; index < Math.ceil(density); index++) {
      const speed = .28 + unit(index, 11) * .12, period = (height + 32) / speed;
      const p = phase(t / period + unit(index, 17));
      const rawX = width * unit(index, 31) + wind * (height + 32) * .26 * (p - .5);
      const edge = Math.min(12, width * .1);
      const visibility = smooth(rawX / edge) * smooth((width - rawX) / edge);
      const length = 7 + unit(index, 47) * 7;
      frame.rain.push({
        x: clamp(rawX, 0, width), y: p * (height + 32) - 16,
        dx: wind * length * .32, dy: length,
        alpha: (.16 + unit(index, 59) * .13) * (.6 + rain * .4) * smooth(density - index) * envelope(p, .12) * visibility,
      });
    }
    const splashDensity = SCENE_WEATHER_LIMITS.splashes * rain;
    for (let index = 0; index < Math.ceil(splashDensity); index++) {
      const period = 1800 + unit(index, 67) * 2100;
      const age = t / period + unit(index, 73), p = phase(age) / .12;
      if (p >= 1) continue;
      // A new ground position is chosen only while the previous splash is transparent.
      const cycle = Math.floor(age), seed = index ^ (cycle | 0);
      frame.splashes.push({
        x: width * (.03 + unit(seed, 83) * .94), y: height * (.36 + unit(seed, 97) * .59),
        width: 2 + p * 6,
        alpha: .22 * rain * smooth(splashDensity - index) * envelope(p, .24) * (1 - p * .45),
      });
    }
  }
  if (fog > 0) for (let index = 0; index < SCENE_WEATHER_LIMITS.fog; index++) {
    const offset = unit(index, 101), drift = oscillate(t, 62000 + index * 7300);
    frame.fog.push({
      x: width * (.15 + offset * .7) + drift * Math.min(95, width * .12) * (wind * .65 + .2),
      y: height * (.15 + index * .135) + oscillate(t, 87000 + index * 6100, offset) * Math.min(7, height * .02),
      width: Math.min(1536, Math.max(1, width * (.58 + unit(index, 109) * .34))),
      height: Math.min(86, Math.max(1, height * (.045 + unit(index, 127) * .045))),
      alpha: fog * (.046 + unit(index, 131) * .03) * (.94 + oscillate(t, 91000 + index * 4900, offset) * .06),
    });
  }
  return frame;
}

const fogColor = Number.parseInt(P.steelLight.slice(1), 16);
const rainColor = Number.parseInt(P.glassLight.slice(1), 16);
const splashColor = Number.parseInt(P.steelLight.slice(1), 16);
const coordinate = (value: number): number => Math.round(clamp(value, -32768, 32768));
function usable(values: readonly number[]): boolean { return values.every(Number.isFinite); }

/** Pixel bands and one-pixel rain strokes; the caller keeps HUD/chrome above this layer. */
export function paintSceneWeather(g: SceneWeatherGraphics, frame: SceneWeatherFrame): void {
  for (let index = 0; index < Math.min(frame.fog.length, SCENE_WEATHER_LIMITS.fog); index++) {
    const patch = frame.fog[index]!;
    if (!usable([patch.x, patch.y, patch.width, patch.height, patch.alpha]) || patch.alpha <= 0 || patch.width <= 0 || patch.height <= 0) continue;
    const width = Math.max(1, Math.round(Math.min(1536, patch.width))), height = Math.max(1, Math.round(Math.min(86, patch.height)));
    const left = coordinate(patch.x - width / 2), top = coordinate(patch.y - height / 2), bands = Math.min(7, height);
    for (let band = 0; band < bands; band++) {
      const step = Math.floor(band / bands * 7), inset = Math.round(width * ([.28, .12, .035, 0, .045, .15, .31][step] ?? 0));
      const from = Math.round(band * height / bands), to = Math.round((band + 1) * height / bands);
      g.fillStyle(fogColor, clamp(patch.alpha, 0, .1) * (step === 0 || step === 6 ? .45 : 1));
      g.fillRect(left + inset, top + from, Math.max(1, width - inset * 2), Math.max(1, to - from));
    }
  }
  for (let index = 0; index < Math.min(frame.rain.length, SCENE_WEATHER_LIMITS.rain); index++) {
    const drop = frame.rain[index]!;
    if (!usable([drop.x, drop.y, drop.dx, drop.dy, drop.alpha]) || drop.alpha <= 0) continue;
    g.lineStyle(1, rainColor, clamp(drop.alpha, 0, .3));
    g.lineBetween(coordinate(drop.x), coordinate(drop.y), coordinate(drop.x + clamp(drop.dx, -32, 32)), coordinate(drop.y + clamp(drop.dy, -32, 32)));
  }
  for (let index = 0; index < Math.min(frame.splashes.length, SCENE_WEATHER_LIMITS.splashes); index++) {
    const splash = frame.splashes[index]!;
    if (!usable([splash.x, splash.y, splash.width, splash.alpha]) || splash.alpha <= 0 || splash.width <= 0) continue;
    const width = Math.max(1, Math.round(Math.min(10, splash.width))), left = coordinate(splash.x - width / 2), y = coordinate(splash.y);
    g.fillStyle(splashColor, clamp(splash.alpha, 0, .25));
    g.fillRect(left, y, width, 1);
    if (width >= 4) { g.fillRect(left, y - 1, 1, 1); g.fillRect(left + width - 1, y - 1, 1, 1); }
  }
}

/** Canvas uses the same draw program, with integer stepped streaks instead of antialiased paths. */
export function paintCanvasSceneWeather(c: CanvasRenderingContext2D, frame: SceneWeatherFrame): void {
  c.save();
  try {
    c.globalCompositeOperation = 'source-over';
    const style = (color: number, alpha = 1): void => {
      c.fillStyle = `#${color.toString(16).padStart(6, '0')}`; c.globalAlpha = alpha;
    };
    paintSceneWeather({
      fillStyle: style, lineStyle: (_width, color, alpha) => style(color, alpha),
      fillRect: (x, y, width, height) => c.fillRect(x, y, width, height),
      lineBetween: (x0, y0, x1, y1) => {
        const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), stepX = x0 < x1 ? 1 : -1, stepY = y0 < y1 ? 1 : -1;
        let error = dx + dy;
        for (;;) {
          c.fillRect(x0, y0, 1, 1);
          if (x0 === x1 && y0 === y1) break;
          const twice = error * 2;
          if (twice >= dy) { error += dy; x0 += stepX; }
          if (twice <= dx) { error += dx; y0 += stepY; }
        }
      },
    }, frame);
  } finally { c.restore(); }
}
