import { PIXEL_PALETTE as P } from './pixel-art';
import type { SceneLamp } from './pixel-lighting';

/** Stable ground-projected centre and full bounds, in the adapter's local pixel units. */
export interface WetSurfacePatch { x: number; y: number; width: number; height: number; seed: number; material?: 'hard' | 'soil' }
export interface WetSurfaceInput {
  patches: readonly WetSurfacePatch[];
  /** Ground x/y, elevated headY and radius must share the patches' projection and scale. */
  lamps: readonly SceneLamp[];
  timeMs: number;
  wetness: number;
  rain: number;
  lights: number;
  reducedMotion?: boolean;
}
export type WetSurfaceMarkKind = 'wet' | 'water' | 'sheen' | 'ripple' | 'reflection';
export interface WetSurfaceMark { x: number; y: number; width: number; height: number; color: number; alpha: number; kind: WetSurfaceMarkKind }
export interface WetSurfaceFrame { marks: WetSurfaceMark[] }
export interface WetSurfaceGraphics {
  fillStyle(color: number, alpha?: number): unknown;
  fillRect(x: number, y: number, width: number, height: number): unknown;
}
export const WET_SURFACE_LIMITS = Object.freeze({ patches: 64, lamps: 32, marksPerPatch: 36, marks: 2304 });
type Rect = { x: number; y: number; width: number; height: number };
type Lamp = SceneLamp & { height: number };
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const smooth = (value: number): number => { const p = clamp(value, 0, 1); return p * p * (3 - 2 * p); };
const fraction = (value: number): number => value - Math.floor(value);
const envelope = (value: number): number => smooth(value / .22) * smooth((1 - value) / .22);
const pigment = (value: string): number => Number.parseInt(value.slice(1), 16);
const colors = { wet: pigment(P.ink), water: pigment(P.glass), soil: pigment(P.steelShade), sheen: pigment(P.glassLight), ripple: pigment(P.steelLight), warm: pigment(P.yellow), warmLight: pigment(P.cream) };
function unit(seed: number, salt: number): number {
  let value = (seed | 0) ^ Math.imul(salt + 1, 0x9e3779b1);
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
}
function valid(values: readonly number[]): boolean { return values.every(Number.isFinite); }
function box(x: number, y: number, width: number, height: number): Rect {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  return { x: Math.round(x - w / 2), y: Math.round(y - h / 2), width: w, height: h };
}

/** Seven disjoint rows form an irregular 2:1 shoreline, with no blurred ellipse. */
function shoreline(bounds: Rect, seed: number): Rect[] {
  const result: Rect[] = [], rows = Math.min(7, bounds.height), profile = [.28, .62, .88, 1, .83, .57, .23];
  for (let row = 0; row < rows; row++) {
    const width = Math.max(1, Math.round(bounds.width * profile[Math.floor(row / rows * 7)]!));
    const from = Math.round(row * bounds.height / rows), to = Math.round((row + 1) * bounds.height / rows);
    const jitter = (unit(seed, row + 7) - .5) * bounds.width * .065;
    const x = Math.round(clamp(bounds.x + (bounds.width - width) / 2 + jitter, bounds.x, bounds.x + bounds.width - width));
    result.push({ x, y: bounds.y + from, width, height: to - from });
  }
  return result;
}
/** Every highlight/ripple/reflection is intersected with the actual water rows. */
function clipped(rect: Rect, mask: readonly Rect[]): Rect[] {
  const result: Rect[] = [];
  for (const band of mask) {
    const left = Math.max(rect.x, band.x), right = Math.min(rect.x + rect.width, band.x + band.width);
    const top = Math.max(rect.y, band.y), bottom = Math.min(rect.y + rect.height, band.y + band.height);
    if (right > left && bottom > top) result.push({ x: left, y: top, width: right - left, height: bottom - top });
  }
  return result;
}
function nearestLamp(patch: WetSurfacePatch, lamps: readonly Lamp[]): { lamp: Lamp; proximity: number } | null {
  let found: { lamp: Lamp; proximity: number } | null = null;
  for (const lamp of lamps) {
    // A ground light pool is twice as wide as it is deep in the common projection.
    const distance = Math.hypot((patch.x - lamp.x) / lamp.radius, (patch.y - lamp.y) / (lamp.radius * .5));
    if (distance >= 1) continue;
    const proximity = smooth(1 - distance);
    if (!found || proximity > found.proximity) found = { lamp, proximity };
  }
  return found;
}

/** Analytic wetness presentation: stable world anchors, no clocks, history or game mutations.
 * Darkness stays after the smaller water core recedes; only rain-driven ripples move. */
export function sampleWetSurfaces(input: WetSurfaceInput): WetSurfaceFrame {
  const frame: WetSurfaceFrame = { marks: [] }, wetness = clamp(finite(input.wetness), 0, 1);
  if (wetness <= 0) return frame;
  const rain = clamp(finite(input.rain), 0, 1), lights = clamp(finite(input.lights), 0, 2);
  const reduced = input.reducedMotion === true, time = reduced ? 0 : Math.max(0, finite(input.timeMs));
  const lamps: Lamp[] = [];
  for (let index = 0; index < Math.min(input.lamps.length, WET_SURFACE_LIMITS.lamps); index++) {
    const source = input.lamps[index]!;
    if (!valid([source.x, source.y, source.headY, source.radius]) || source.radius <= 0 || source.headY >= source.y) continue;
    const x = clamp(source.x, -1e6, 1e6), y = clamp(source.y, -1e6, 1e6), headY = clamp(source.headY, -1e6, 1e6);
    lamps.push({ x, y, headY, radius: clamp(source.radius, 1, 2048), height: clamp(y - headY, 1, 1024) });
  }
  for (let index = 0; index < Math.min(input.patches.length, WET_SURFACE_LIMITS.patches); index++) {
    const source = input.patches[index]!;
    if (!valid([source.x, source.y, source.width, source.height]) || source.width < 1 || source.height < 1) continue;
    const seed = finite(source.seed) | 0, soil = source.material === 'soil';
    const patch = { ...source, x: clamp(source.x, -1e6, 1e6), y: clamp(source.y, -1e6, 1e6), width: clamp(source.width, 1, 256), height: clamp(source.height, 1, 128) };
    patch.height = Math.min(patch.height, Math.max(1, patch.width * .5));
    const left = Math.ceil(patch.x - patch.width / 2), top = Math.ceil(patch.y - patch.height / 2);
    const footprint = { x: left, y: top, width: Math.floor(patch.x + patch.width / 2) - left, height: Math.floor(patch.y + patch.height / 2) - top };
    if (footprint.width < 1 || footprint.height < 1) continue;
    const marks: WetSurfaceMark[] = [];
    const add = (rect: Rect, kind: WetSurfaceMarkKind, color: number, alpha: number): void => {
      if (alpha > .00001 && marks.length < WET_SURFACE_LIMITS.marksPerPatch) marks.push({ ...rect, kind, color, alpha: clamp(alpha, 0, .5) });
    };
    const grow = .58 + wetness * .42;
    const film = shoreline(box(patch.x, patch.y, patch.width * grow, patch.height * grow), seed).flatMap(rect => clipped(rect, [footprint]));
    for (const rect of film) add(rect, 'wet', colors.wet, wetness * (soil ? .2 : .16));
    const threshold = (soil ? .43 : .17) + unit(seed, 19) * (soil ? .2 : .24);
    const water = smooth((wetness - threshold) / (1 - threshold));
    if (water > .00001) {
      const core = box(patch.x + (unit(seed, 23) - .5) * patch.width * .06, patch.y + (unit(seed, 29) - .5) * patch.height * .06,
        patch.width * (.16 + water * .7), patch.height * (.16 + water * .7));
      const mask = shoreline(core, seed).flatMap(rect => clipped(rect, film));
      for (const rect of mask) add(rect, 'water', soil ? colors.soil : colors.water, water * (soil ? .18 : .25));
      const highlight = (rect: Rect, kind: WetSurfaceMarkKind, color: number, alpha: number): void => {
        for (const segment of clipped(rect, mask)) add(segment, kind, color, alpha);
      };
      for (let glint = 0; glint < 3; glint++) {
        const width = Math.max(1, Math.round(core.width * (.09 + unit(seed, 31 + glint) * .15)));
        highlight({ x: Math.round(core.x + core.width * (.12 + unit(seed, 37 + glint) * .55)),
          y: Math.round(core.y + core.height * (.18 + glint * .26)), width, height: 1 }, 'sheen', colors.sheen, water * (soil ? .075 : .16));
      }
      if (rain > 0 && !reduced) {
        const p = fraction(time / (1450 + unit(seed, 41) * 1700) + unit(seed, 43)) / .56;
        if (p < 1) {
          const x = Math.round(patch.x + (unit(seed, 47) - .5) * core.width * .3), y = Math.round(patch.y + (unit(seed, 53) - .5) * core.height * .3);
          const rw = Math.min(10, 2 + p * core.width * .22), rh = Math.max(1, Math.round(rw / 2));
          const alpha = water * rain * .19 * envelope(p), span = Math.max(1, Math.round(rw / 2));
          for (const mark of [
            { x: Math.round(x - span / 2), y: y - Math.round(rh / 2), width: span, height: 1 },
            { x: Math.round(x - span / 2), y: y + Math.round(rh / 2), width: span, height: 1 },
            { x: x - Math.round(rw / 2), y, width: 1, height: 1 },
            { x: x + Math.round(rw / 2), y, width: 1, height: 1 },
          ]) highlight(mark, 'ripple', colors.ripple, alpha);
        }
      }
      const nearby = lights > 0 ? nearestLamp(patch, lamps) : null;
      if (nearby) {
        // Specular water glints fall off more slowly than diffuse ground light,
        // while still reaching zero at the same real lamp-pool boundary.
        const { lamp, proximity } = nearby, strength = water * Math.sqrt(proximity) * clamp(lights / 1.5, 0, 1.15) * (soil ? .48 : 1);
        const stripeHeight = Math.max(1, Math.round(Math.min(2, lamp.height / 100)));
        // A reflected lamp is a narrow vertical column below its real ground anchor.
        // Sideways puddles do not invent a second copy of the lamp at their centre.
        for (let stripe = 0; stripe < 7; stripe++) {
          if (unit(seed, stripe + 61) > .88) continue;
          const y = Math.round(core.y + core.height * (.1 + stripe * .13));
          if (y < lamp.y - 2 || y > lamp.y + Math.min(lamp.radius * .52, lamp.height * .8 + 8)) continue;
          const wave = reduced ? 0 : rain * Math.sin(fraction(time / (2100 + stripe * 193) + unit(seed, 73)) * Math.PI * 2);
          const x = lamp.x + wave * 1.2;
          const width = Math.max(1, Math.round((2 + stripe * .7 + unit(seed, stripe + 79) * 2) * (.65 + water * .35)));
          const alpha = strength * (.27 + unit(seed, stripe + 89) * .12) * (1 - wave * .07);
          highlight({ x: Math.round(x - width / 2), y, width, height: stripeHeight }, 'reflection', stripe % 3 ? colors.warm : colors.warmLight, alpha);
        }
      }
    }
    frame.marks.push(...marks);
  }
  return frame;
}

/** Draw underneath people, props and the shared light tint. Clearing belongs to the adapter. */
export function paintWetSurfaces(g: WetSurfaceGraphics, frame: WetSurfaceFrame): void {
  for (let index = 0; index < Math.min(frame.marks.length, WET_SURFACE_LIMITS.marks); index++) {
    const mark = frame.marks[index]!;
    if (!valid([mark.x, mark.y, mark.width, mark.height, mark.color, mark.alpha]) || mark.width <= 0 || mark.height <= 0 || mark.alpha <= 0) continue;
    g.fillStyle(clamp(Math.round(mark.color), 0, 0xffffff), clamp(mark.alpha, 0, .5));
    g.fillRect(Math.round(clamp(mark.x, -1e6, 1e6)), Math.round(clamp(mark.y, -1e6, 1e6)),
      Math.max(1, Math.round(Math.min(256, mark.width))), Math.max(1, Math.round(Math.min(128, mark.height))));
  }
}
export function paintCanvasWetSurfaces(c: CanvasRenderingContext2D, frame: WetSurfaceFrame): void {
  c.save();
  try {
    c.globalCompositeOperation = 'source-over';
    paintWetSurfaces({
      fillStyle: (color, alpha = 1) => { c.fillStyle = `#${color.toString(16).padStart(6, '0')}`; c.globalAlpha = alpha; },
      fillRect: (x, y, width, height) => c.fillRect(x, y, width, height),
    }, frame);
  } finally { c.restore(); }
}
