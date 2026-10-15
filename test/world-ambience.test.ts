import { describe, expect, test } from 'bun:test';
import { sampleWorldBirds, sampleWorldSunlight, WORLD_AMBIENCE_LIMITS } from '../src/world-ambience';

const bounds = { x: -20, y: 35, width: 720, height: 380 };
const input = { timeMs: 8000, bounds };
function numbers(value: unknown): number[] {
	return typeof value === 'number' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(numbers) : [];
}

describe('world ambience', () => {
	test('manual light and bad weather extinguish the sun and reduce wildlife together', () => {
		const day = sampleWorldSunlight({ ...input, daylight: 1 });
		expect(day.intensity).toBe(1); expect(day.shafts).toHaveLength(WORLD_AMBIENCE_LIMITS.sunshafts);
		expect(day.pools).toHaveLength(WORLD_AMBIENCE_LIMITS.sunPools);
		for (const override of [{ daylight: 0 }, { rain: 1 }]) {
			const dark = sampleWorldSunlight({ ...input, ...override });
			expect(dark.intensity).toBe(0); expect(dark.shafts).toEqual([]); expect(dark.pools).toEqual([]);
			expect(sampleWorldBirds({ ...input, ...override }).every(bird => bird.alpha === 0)).toBe(true);
		}
		expect(sampleWorldSunlight({ ...input, fog: 1 }).intensity).toBeLessThan(.2);
	});

	test('birds have coherent ground shadows, individual glides and change direction only while invisible', () => {
		const flock = sampleWorldBirds(input);
		expect(flock).toHaveLength(WORLD_AMBIENCE_LIMITS.birds);
		expect(new Set(flock.map(bird => bird.wing)).size).toBe(6);
		for (const bird of flock) {
			expect(bird.alpha).toBeGreaterThan(0); expect(bird.alpha).toBeLessThanOrEqual(.72);
			expect(bird.shadowX - bird.x).toBeCloseTo(24);
			expect(bird.shadowY - bird.y).toBeGreaterThan(93.9999);
			expect(bird.shadowAlpha).toBeGreaterThan(0); expect(bird.shadowAlpha).toBeLessThan(bird.alpha);
		}
		const firstVisit = sampleWorldBirds({ ...input, timeMs: 8000 });
		const secondVisit = sampleWorldBirds({ ...input, timeMs: 66000 });
		expect(firstVisit[0]!.heading).toBe(1); expect(secondVisit[0]!.heading).toBe(-1);
		for (const timeMs of [42549, 42550, 42551]) expect(sampleWorldBirds({ ...input, timeMs }).every(bird => bird.alpha < .00001)).toBe(true);
		expect(sampleWorldBirds({ ...input, groundBounds: { x: 9999, y: 9999, width: 10, height: 10 } }).every(bird => bird.shadowAlpha === 0)).toBe(true);
	});

	test('sun direction follows the day and world geometry moves gently rather than swimming with the camera', () => {
		const a = sampleWorldSunlight({ ...input, dayPhase: .3 }), b = sampleWorldSunlight({ ...input, dayPhase: .7 });
		expect(a.direction).not.toEqual(b.direction);
		const later = sampleWorldSunlight({ ...input, timeMs: input.timeMs + 16 });
		for (let i = 0; i < a.pools.length; i++) {
			expect(Math.abs(a.pools[i]!.x - later.pools[i]!.x)).toBeLessThan(.1);
			expect(Math.abs(a.pools[i]!.y - later.pools[i]!.y)).toBeLessThan(.1);
		}
	});

	test('reduced motion is stable and numeric input cannot create unbounded particle geometry', () => {
		expect(sampleWorldBirds({ ...input, reducedMotion: true })).toEqual([]);
		expect(sampleWorldSunlight({ ...input, reducedMotion: true })).toEqual(sampleWorldSunlight({ ...input, timeMs: 1e12, reducedMotion: true }));
		for (const timeMs of [NaN, Infinity, -Infinity, -1, 1e12, Number.MAX_VALUE]) {
			const bad = { timeMs, bounds: { x: Infinity, y: -Infinity, width: NaN, height: Number.MAX_VALUE }, dayPhase: NaN, rain: Infinity, fog: NaN, daylight: NaN };
			for (const sample of [sampleWorldSunlight(bad), sampleWorldBirds(bad)]) expect(numbers(sample).every(Number.isFinite)).toBe(true);
		}
	});
});
