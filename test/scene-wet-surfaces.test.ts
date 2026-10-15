import { describe, expect, test } from 'bun:test';
import { PIXEL_PALETTE } from '../src/pixel-art';
import { WET_SURFACE_LIMITS, sampleWetSurfaces, paintWetSurfaces, paintCanvasWetSurfaces, type WetSurfaceInput, type WetSurfaceFrame, type WetSurfaceMark, type WetSurfaceGraphics, type WetSurfacePatch } from '../src/scene-wet-surfaces';

const patch: WetSurfacePatch = { x: 100, y: 200, width: 60, height: 26, seed: 3, material: 'hard' };
const input: WetSurfaceInput = { patches: [patch], lamps: [{ x: 100, y: 198, headY: 70, radius: 145 }], timeMs: 12000, wetness: .9, rain: .8, lights: 1.5 };
const select = (frame: WetSurfaceFrame, kind: WetSurfaceMark['kind']): WetSurfaceMark[] => frame.marks.filter(mark => mark.kind === kind);
const area = (marks: readonly WetSurfaceMark[]): number => marks.reduce((sum, mark) => sum + mark.width * mark.height, 0);
const contained = (mark: WetSurfaceMark, mask: readonly WetSurfaceMark[]): boolean => mask.some(band => mark.x >= band.x && mark.y >= band.y && mark.x + mark.width <= band.x + band.width && mark.y + mark.height <= band.y + band.height);
function allNumbers(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(allNumbers);
}

describe('ground wetness and real lamp reflections', () => {
  test('samples preserve stable world anchors and never mutate inputs or accumulate particle state', () => {
    const before = structuredClone(input), first = sampleWetSurfaces(input);
    sampleWetSurfaces({ ...input, timeMs: 1e12, wetness: .2 });
    expect(sampleWetSurfaces(input)).toEqual(first); expect(input).toEqual(before);
    for (const timeMs of [0, 1792062000000, 1792062001000]) {
      const current = sampleWetSurfaces({ ...input, timeMs });
      for (const kind of ['wet', 'water', 'sheen'] as const) expect(select(current, kind)).toEqual(select(first, kind));
    }
  });

  test('water grows with wetness, absorbs faster into soil, and leaves dampness as puddles recede', () => {
    expect(sampleWetSurfaces({ ...input, wetness: 0 }).marks).toEqual([]);
    for (let seed = 0; seed < 12; seed++) {
      let previousWater = 0, previousDamp = 0;
      for (const wetness of [.1, .25, .4, .6, .8, 1]) {
        const frame = sampleWetSurfaces({ ...input, wetness, patches: [{ ...patch, seed }] });
        const waterArea = area(select(frame, 'water')), dampArea = area(select(frame, 'wet'));
        expect(waterArea).toBeGreaterThanOrEqual(previousWater); expect(dampArea).toBeGreaterThanOrEqual(previousDamp);
        previousWater = waterArea; previousDamp = dampArea;
      }
      const hard = sampleWetSurfaces({ ...input, wetness: .5, patches: [{ ...patch, seed, material: 'hard' }] });
      const soil = sampleWetSurfaces({ ...input, wetness: .5, patches: [{ ...patch, seed, material: 'soil' }] });
      expect(area(select(soil, 'water'))).toBeLessThan(area(select(hard, 'water')));
    }
    const drying = sampleWetSurfaces({ ...input, wetness: .1 });
    expect(select(drying, 'wet').length).toBeGreaterThan(0);
    expect(select(drying, 'water')).toHaveLength(0); expect(select(drying, 'reflection')).toHaveLength(0);
  });

  test('all marks remain inside the supplied ground footprint; every light detail is inside actual water', () => {
    for (let seed = 0; seed < 14; seed++) for (const wetness of [.35, .7, 1]) {
      const source = { ...patch, x: 100.35, y: 32768.7, width: 58.3, height: 19.8, seed };
      const frame = sampleWetSurfaces({ ...input, wetness, patches: [source], lamps: [{ x: 100.35, y: 32766, headY: 32600, radius: 145 }] });
      const film = select(frame, 'wet'), water = select(frame, 'water');
      expect(frame.marks.every(mark => mark.x >= source.x - source.width / 2 && mark.y >= source.y - source.height / 2
        && mark.x + mark.width <= source.x + source.width / 2 && mark.y + mark.height <= source.y + source.height / 2)).toBe(true);
      expect(water.every(mark => contained(mark, film))).toBe(true);
      expect(frame.marks.filter(mark => ['sheen', 'ripple', 'reflection'].includes(mark.kind)).every(mark => contained(mark, water))).toBe(true);
      expect(frame.marks.every(mark => mark.y > 32700)).toBe(true);
    }
  });

  test('warm reflections need a nearby elevated real lamp, stay in its column, and follow light strength smoothly', () => {
    const full = sampleWetSurfaces({ ...input, wetness: 1, rain: 0 });
    const reflections = select(full, 'reflection'); expect(reflections.length).toBeGreaterThan(0);
    expect(reflections.every(mark => mark.x <= 100 && mark.x + mark.width >= 100 && mark.y >= 196)).toBe(true);
    for (const lamps of [[], [{ x: 1000, y: 198, headY: 70, radius: 145 }], [{ x: 100, y: 198, headY: 198, radius: 145 }], [{ x: 180, y: 198, headY: 70, radius: 600 }]]) {
      expect(select(sampleWetSurfaces({ ...input, wetness: 1, rain: 0, lamps }), 'reflection')).toHaveLength(0);
    }
    expect(select(sampleWetSurfaces({ ...input, lights: 0 }), 'reflection')).toHaveLength(0);
    const day = select(sampleWetSurfaces({ ...input, wetness: 1, rain: 0, lights: .18 }), 'reflection');
    expect(day).toHaveLength(reflections.length);
    expect(day.every((mark, index) => mark.alpha > 0 && mark.alpha < reflections[index]!.alpha)).toBe(true);
    const before = select(sampleWetSurfaces({ ...input, lights: .75 }), 'reflection');
    const after = select(sampleWetSurfaces({ ...input, lights: .75001 }), 'reflection');
    expect(after).toHaveLength(before.length);
    expect(after.every((mark, index) => Math.abs(mark.alpha - before[index]!.alpha) < .00001)).toBe(true);
  });

  test('rain animates quiet clipped ripples, while still water and reduced motion remain static', () => {
    const still = sampleWetSurfaces({ ...input, rain: 0, timeMs: 0 });
    expect(sampleWetSurfaces({ ...input, rain: 0, timeMs: 1792062000000 })).toEqual(still);
    expect(select(still, 'ripple')).toHaveLength(0);
    let moving: WetSurfaceFrame | null = null;
    for (let timeMs = 0; timeMs < 5000; timeMs += 100) {
      const frame = sampleWetSurfaces({ ...input, timeMs });
      if (select(frame, 'ripple').some(mark => mark.alpha > .02)) { moving = frame; break; }
    }
    expect(moving).not.toBeNull();
    const reduced = sampleWetSurfaces({ ...input, timeMs: 0, reducedMotion: true });
    expect(sampleWetSurfaces({ ...input, timeMs: 1792062000000, reducedMotion: true })).toEqual(reduced);
    expect(select(reduced, 'ripple')).toHaveLength(0); expect(select(reduced, 'reflection').length).toBeGreaterThan(0);
  });

  test('hostile numbers and large maps stay finite, bounded, palette-based and independent of list size', () => {
    const palette = new Set(Object.values(PIXEL_PALETTE).map(value => Number.parseInt(value.slice(1), 16)));
    for (const timeMs of [NaN, Infinity, -Infinity, -100, 0, 1792062000000, 1e15, Number.MAX_VALUE]) {
      const frame = sampleWetSurfaces({ ...input, timeMs, wetness: 99, rain: 99, lights: 99,
        patches: Array.from({ length: 5000 }, (_, seed) => ({ ...patch, x: 32000, y: 32768, width: Number.MAX_VALUE, height: Number.MAX_VALUE, seed })),
        lamps: Array.from({ length: 5000 }, () => ({ x: 32000, y: 32768, headY: 32000, radius: Number.MAX_VALUE })),
      });
      expect(frame.marks.length).toBeLessThanOrEqual(WET_SURFACE_LIMITS.marks);
      expect(allNumbers(frame).every(Number.isFinite)).toBe(true);
      expect(frame.marks.every(mark => [mark.x, mark.y, mark.width, mark.height].every(Number.isInteger) && mark.width > 0 && mark.height > 0 && mark.alpha > 0 && mark.alpha <= .5 && palette.has(mark.color))).toBe(true);
    }
    for (const invalidPatch of [{ ...patch, x: NaN }, { ...patch, height: -1 }, { ...patch, width: Infinity }]) {
      expect(sampleWetSurfaces({ ...input, patches: [invalidPatch] }).marks).toHaveLength(0);
    }
    expect(sampleWetSurfaces({ ...input, wetness: NaN }).marks).toHaveLength(0);
    const malformed = sampleWetSurfaces({ ...input, patches: [{ ...patch, seed: Infinity }], lamps: [{ x: Infinity, y: 0, headY: -10, radius: 99 }] });
    expect(allNumbers(malformed).every(Number.isFinite)).toBe(true);
    expect(select(malformed, 'reflection')).toHaveLength(0);
  });
});

function recordingGraphics(): { graphics: WetSurfaceGraphics; draws: (number | string)[][] } {
  const draws: (number | string)[][] = []; let color = 0, alpha = 1;
  return { draws, graphics: { fillStyle(paint, opacity = 1) { color = paint; alpha = opacity; }, fillRect(x, y, width, height) { draws.push([x, y, width, height, `#${color.toString(16).padStart(6, '0')}`, alpha]); } } };
}

test('Graphics and Canvas draw exactly the same bounded pixel marks and preserve canvas state', () => {
  const frame = sampleWetSurfaces(input), record = recordingGraphics(); paintWetSurfaces(record.graphics, frame);
  const canvasDraws: (number | string)[][] = [];
  let saved: unknown[] = [];
  const canvas = { fillStyle: '#abcdef', globalAlpha: .42, globalCompositeOperation: 'screen',
    save() { saved = [this.fillStyle, this.globalAlpha, this.globalCompositeOperation]; },
    restore() { [this.fillStyle, this.globalAlpha, this.globalCompositeOperation] = saved as [string, number, string]; },
    fillRect(x: number, y: number, width: number, height: number) { canvasDraws.push([x, y, width, height, this.fillStyle, this.globalAlpha]); },
  };
  paintCanvasWetSurfaces(canvas as unknown as CanvasRenderingContext2D, frame);
  expect(canvasDraws).toEqual(record.draws);
  expect([canvas.fillStyle, canvas.globalAlpha, canvas.globalCompositeOperation]).toEqual(['#abcdef', .42, 'screen']);
  expect(record.draws.every(draw => draw.slice(0, 4).every(Number.isInteger))).toBe(true);
  const bad = recordingGraphics();
  paintWetSurfaces(bad.graphics, { marks: [{ x: NaN, y: 0, width: 1, height: 1, alpha: 1, color: 0, kind: 'wet' }] });
  expect(bad.draws).toHaveLength(0);
  const huge = recordingGraphics();
  paintWetSurfaces(huge.graphics, { marks: Array.from({ length: 10000 }, () => ({ x: 0, y: 0, width: 99, height: 20, alpha: 1, color: 0, kind: 'wet' as const })) });
  expect(huge.draws).toHaveLength(WET_SURFACE_LIMITS.marks);
  let restored = false;
  expect(() => paintCanvasWetSurfaces({ save() {}, restore() { restored = true; }, fillRect() { throw new Error('drawing failed'); } } as unknown as CanvasRenderingContext2D, frame)).toThrow('drawing failed');
  expect(restored).toBe(true);
});
