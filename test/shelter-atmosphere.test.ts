import { describe, expect, test } from "bun:test";
import {
	SHELTER_ATMOSPHERE_LIMITS, sampleShelterAtmosphere, sampleShelterWind,
	paintShelterAtmosphereGround, paintShelterAtmosphereGroundLights, paintShelterAtmosphereAir, paintShelterAtmosphereGlows,
	type ShelterAtmosphereInput,
} from "../src/shelter-atmosphere";
import type Phaser from "phaser";
import { PIXEL_PALETTE } from "../src/pixel-art";

const input: ShelterAtmosphereInput = {
	timeMs: 12000,
	groundBounds: { x: -20, y: 35, width: 720, height: 380 },
	smokeEmitters: [{ x: 350, y: 215, kind: "chimney" }, { x: 160, y: 325, kind: "fire" }],
	lights: [{ x: 150, y: 310, kind: "lamp" }, { x: 160, y: 325, kind: "fire" }],
	birdBounds: { x: 120, y: 0, width: 520, height: 60 },
	mistZones: [{ x: 30, y: 30, width: 140, height: 24 }],
};
function allNumbers(value: unknown): number[] {
	if (typeof value === "number") return [value];
	if (!value || typeof value !== "object") return [];
	return Object.values(value).flatMap(allNumbers);
}

describe("shelter atmosphere", () => {
	test("epoch visual time keeps wind and outdoor atmosphere moving beyond the old local clock range", () => {
		const timeMs = Date.UTC(2026, 9, 15, 12), later = timeMs + 1000;
		expect(sampleShelterWind(timeMs)).not.toEqual(sampleShelterWind(later));
		expect(sampleShelterAtmosphere({ ...input, timeMs })).not.toEqual(sampleShelterAtmosphere({ ...input, timeMs: later }));
		expect(sampleShelterAtmosphere({ ...input, timeMs, reducedMotion: true })).toEqual(sampleShelterAtmosphere({ ...input, timeMs: later, reducedMotion: true }));
	});

	test("shared weather drives smoke direction and suppresses duplicate local fog without moving reduced-motion scenery", () => {
		const dry = sampleShelterAtmosphere({ ...input, weatherFog: 0, weatherRain: 0, weatherWind: -1 });
		const wet = sampleShelterAtmosphere({ ...input, weatherFog: 1, weatherRain: 1, weatherWind: 1 });
		expect(dry.wind.x).toBeLessThan(-.7); expect(wet.wind.x).toBeGreaterThan(.7);
		expect(wet.mist[0]!.alpha).toBeLessThan(dry.mist[0]!.alpha * .2);
		expect(wet.birds.every(bird => bird.alpha === 0)).toBe(true);
		expect(wet.clouds[0]!.alpha).toBeGreaterThan(dry.clouds[0]!.alpha);
		for (const wind of [-1, 1, NaN, Infinity]) {
			const still = sampleShelterAtmosphere({ ...input, weatherWind: wind, reducedMotion: true });
			expect(still.wind).toEqual({ x: 0, y: 0, sway: 0 }); expect(allNumbers(still).every(Number.isFinite)).toBe(true);
		}
	});

	test("real elevated lamps illuminate the ground below while their bulb stays at fixture height", () => {
		const lights = [{ x: 100.5, y: 170.25, kind: 'lamp' as const, height: 30 }, { x: -10, y: 55, kind: 'lamp' as const, height: 12 }, { x: 80, y: 100, kind: 'fire' as const, height: 4 }];
		const frame = sampleShelterAtmosphere({ ...input, lights, reducedMotion: true });
		expect(frame.groundLights).toHaveLength(lights.length);
		for (let i = 0; i < lights.length; i++) {
			const pool = frame.groundLights[i]!, glow = frame.glows[i]!, source = lights[i]!;
			expect({ x: pool.x, y: pool.y }).toEqual({ x: source.x, y: source.y });
			expect({ x: glow.x, y: glow.y }).toEqual({ x: source.x, y: source.y - source.height });
			expect(pool.width).toBeGreaterThan(45); expect(pool.height).toBe(pool.width * .5); expect(pool.alpha).toBeGreaterThan(.15);
		}
		expect(frame.groundLights[0]!.width).toBeGreaterThan(frame.groundLights[1]!.width);
		expect(sampleShelterAtmosphere({ ...input, lights: [] }).groundLights).toEqual([]);
	});

	test("lighting strength changes a frozen atmosphere immediately without moving or inventing sources", () => {
		const dim = sampleShelterAtmosphere({ ...input, reducedMotion: true, lightStrength: .2 });
		const bright = sampleShelterAtmosphere({ ...input, reducedMotion: true, lightStrength: 1.4, timeMs: 900000 });
		expect(bright.groundLights.length).toBe(dim.groundLights.length);
		for (let i = 0; i < dim.groundLights.length; i++) {
			const a = dim.groundLights[i]!, b = bright.groundLights[i]!;
			expect({ x: a.x, y: a.y, width: a.width, height: a.height }).toEqual({ x: b.x, y: b.y, width: b.width, height: b.height });
			expect(b.alpha).toBeGreaterThan(a.alpha * 6);
		}
		for (const strength of [-10, 0, NaN, Infinity, 100]) {
			const frame = sampleShelterAtmosphere({ ...input, lightStrength: strength, shadowStrength: strength });
			expect(allNumbers(frame).every(Number.isFinite)).toBe(true);
			expect(frame.glows.every(glow => glow.alpha >= 0 && glow.coreAlpha >= 0 && glow.coreAlpha <= 1)).toBe(true);
			expect(frame.groundLights.every(pool => pool.alpha >= 0 && pool.alpha < 1)).toBe(true);
		}
	});

	test("only existing fires emit bounded fading embers, and reduced motion removes them", () => {
		const fire = { x: 160, y: 325, kind: "fire" as const }, chimney = { x: 50, y: 50, kind: "chimney" as const };
		for (const timeMs of [0, 1000, 10000000]) {
			const frame = sampleShelterAtmosphere({ ...input, timeMs, smokeEmitters: [chimney, fire] });
			expect(frame.embers).toHaveLength(SHELTER_ATMOSPHERE_LIMITS.embersPerFire);
			expect(frame.embers.every(ember => ember.y < fire.y && ember.y >= fire.y - 21 && Math.abs(ember.x - fire.x) < 20 && ember.alpha >= 0 && ember.alpha <= .65)).toBe(true);
			expect(sampleShelterAtmosphere({ ...input, timeMs, smokeEmitters: [chimney] }).embers).toEqual([]);
			expect(sampleShelterAtmosphere({ ...input, timeMs, smokeEmitters: [fire], reducedMotion: true }).embers).toEqual([]);
		}
		const crowded = sampleShelterAtmosphere({ ...input, smokeEmitters: Array.from({ length: 1000 }, () => fire) });
		expect(crowded.embers).toHaveLength(SHELTER_ATMOSPHERE_LIMITS.smokeEmitters * SHELTER_ATMOSPHERE_LIMITS.embersPerFire);
		const cycle = 2300, before = sampleShelterAtmosphere({ ...input, timeMs: cycle - .1, smokeEmitters: [fire] }).embers[0]!;
		const after = sampleShelterAtmosphere({ ...input, timeMs: cycle + .1, smokeEmitters: [fire] }).embers[0]!;
		expect(before.alpha).toBeLessThan(.000001); expect(after.alpha).toBeLessThan(.000001);
	});
	test("atmospheric silhouettes use bounded integer pixel bands and shared pigments", () => {
		const rectangles: number[][] = [], lines: number[][] = [], colors: number[] = [];
		const g = { clear() { return g; }, fillStyle(color: number) { colors.push(color); return g; }, lineStyle(_width: number, color: number) { colors.push(color); return g; },
			fillRect(...values: number[]) { rectangles.push(values); return g; }, lineBetween(...values: number[]) { lines.push(values); return g; } };
		const frame = sampleShelterAtmosphere(input);
		for (const paint of [paintShelterAtmosphereGround, paintShelterAtmosphereGroundLights, paintShelterAtmosphereAir, paintShelterAtmosphereGlows]) paint(g as unknown as Phaser.GameObjects.Graphics, frame);
		expect(rectangles.length).toBeGreaterThan(60); expect(rectangles.length).toBeLessThan(400);
		expect([...rectangles, ...lines].every(values => values.every(Number.isInteger))).toBe(true);
		expect(rectangles.every(([, , width, height]) => width! > 0 && height! > 0)).toBe(true);
		const palette = new Set(Object.values(PIXEL_PALETTE).map(hex => Number.parseInt(hex.slice(1), 16)));
		expect(colors.every(color => palette.has(color))).toBe(true);
	});
	test("samples are deterministic and never mutate the anchors", () => {
		const before = structuredClone(input), first = sampleShelterAtmosphere(input);
		expect(sampleShelterAtmosphere(input)).toEqual(first);
		expect(input).toEqual(before);
		expect(sampleShelterAtmosphere({ ...input, timeMs: 23000 })).not.toEqual(first);
	});

	test("smoke rises from roof height and the lower fire source, drifting gently with the breeze", () => {
		const sample = sampleShelterAtmosphere(input);
		for (const puff of sample.smoke) {
			const emitter = input.smokeEmitters![Math.floor(puff.id / 3)]!, fire = emitter.kind === "fire";
			expect(puff.y).toBeLessThanOrEqual(emitter.y - (fire ? 7 : 42));
			expect(puff.y).toBeGreaterThan(emitter.y - (fire ? 7 + 31 : 42 + 41));
			expect(Math.abs(puff.x - emitter.x)).toBeLessThan(35);
			expect(puff.alpha).toBeGreaterThanOrEqual(0);
			expect(puff.alpha).toBeLessThanOrEqual(.15);
		}
		expect(sample.glows.map(glow => glow.color)).toEqual([PIXEL_PALETTE.yellow, PIXEL_PALETTE.woodLight].map(hex => Number.parseInt(hex.slice(1), 16)));
		expect(sample.flames).toHaveLength(1);
		expect(sample.flames[0]!.height).toBeGreaterThan(6);
		expect(sample.clouds.every(cloud => cloud.alpha <= .028)).toBe(true);
	});

	test("long sessions and malformed numeric input stay finite and bounded", () => {
		for (const timeMs of [Number.NaN, Infinity, -Infinity, -400, 0, 1e12, Number.MAX_VALUE]) {
			const frame = sampleShelterAtmosphere({
				...input, timeMs,
				groundBounds: { x: Infinity, y: -Infinity, width: NaN, height: -1 },
				smokeEmitters: [{ x: 150, y: 130, kind: "fire", height: Infinity, strength: NaN }, { x: NaN, y: 150, kind: "chimney" }],
				lights: [{ x: Infinity, y: 40, kind: "lamp" }, { x: -Number.MAX_VALUE, y: Number.MAX_VALUE, kind: "fire", height: -Infinity }],
			});
			expect(allNumbers(frame).every(Number.isFinite)).toBe(true);
			const geometry = [...frame.clouds, ...frame.smoke, ...frame.flames, ...frame.birds, ...frame.glows, ...frame.groundLights, ...frame.mist].map(({ x, y }) => ({ x, y }));
			expect(allNumbers(geometry).every(value => Math.abs(value) <= 1e6 + 10000)).toBe(true);
			expect(frame.smoke).toHaveLength(3);
			expect(frame.glows).toHaveLength(1);
		}
	});

	test("fixed budgets do not grow with a large base or an elapsed frame count", () => {
		const emitters = Array.from({ length: 500 }, (_, i) => ({ x: i, y: 160, kind: "chimney" as const }));
		const lights = Array.from({ length: 500 }, (_, i) => ({ x: i, y: 160, kind: "lamp" as const }));
		const mistZones = Array.from({ length: 500 }, (_, i) => ({ x: i, y: 0, width: 50, height: 10 }));
		for (const timeMs of [0, 17000, 30000000]) {
			const frame = sampleShelterAtmosphere({ ...input, timeMs, smokeEmitters: emitters, lights, mistZones });
			expect(frame.smoke).toHaveLength(SHELTER_ATMOSPHERE_LIMITS.smokeEmitters * SHELTER_ATMOSPHERE_LIMITS.puffsPerEmitter);
			expect(frame.glows).toHaveLength(SHELTER_ATMOSPHERE_LIMITS.lights);
			expect(frame.groundLights).toHaveLength(SHELTER_ATMOSPHERE_LIMITS.lights);
			expect(frame.clouds).toHaveLength(SHELTER_ATMOSPHERE_LIMITS.clouds);
			expect(frame.birds).toHaveLength(SHELTER_ATMOSPHERE_LIMITS.birds);
			expect(frame.mist).toHaveLength(SHELTER_ATMOSPHERE_LIMITS.mist);
		}
	});

	test("reduced motion freezes ambient samples but keeps steady warm lamps", () => {
		const still = sampleShelterAtmosphere({ ...input, timeMs: 0, reducedMotion: true });
		expect(sampleShelterAtmosphere({ ...input, timeMs: 999999, reducedMotion: true })).toEqual(still);
		expect(still.wind).toEqual({ x: 0, y: 0, sway: 0 });
		expect(still.birds).toEqual([]);
		expect(still.glows).toHaveLength(2);
		expect(still.glows.every(glow => glow.alpha > 0 && glow.coreAlpha > 0)).toBe(true);
		expect(still.smoke.some(puff => puff.alpha > 0)).toBe(true);
		expect(still.flames).toHaveLength(1);
	});

	test("wind and glow move continuously across neighboring visual frames", () => {
		for (const timeMs of [0, 5700, 7300, 58000, 76000, 1e9]) {
			const from = sampleShelterAtmosphere({ ...input, timeMs }), to = sampleShelterAtmosphere({ ...input, timeMs: timeMs + 16 });
			expect(Math.abs(from.wind.sway - to.wind.sway)).toBeLessThan(.02);
			for (let i = 0; i < from.glows.length; i++) {
				expect(Math.abs(from.glows[i]!.width - to.glows[i]!.width)).toBeLessThan(.05);
				expect(Math.abs(from.glows[i]!.alpha - to.glows[i]!.alpha)).toBeLessThan(.001);
			}
			expect(Math.abs(from.flames[0]!.height - to.flames[0]!.height)).toBeLessThan(.05);
		}
	});

	test("wrapped smoke and clouds disappear smoothly before respawning", () => {
		for (const [timeMs, kind] of [[7300 * .79, "smoke"], [76000 * .82, "clouds"]] as const) {
			const before = sampleShelterAtmosphere({ ...input, timeMs: timeMs - 1 })[kind][0]!;
			const after = sampleShelterAtmosphere({ ...input, timeMs: timeMs + 1 })[kind][0]!;
			expect(before.alpha).toBeLessThan(.000001);
			expect(after.alpha).toBeLessThan(.000001);
			// Geometry wraps only while it is visually transparent.
			expect(Math.abs(before.x * before.alpha - after.x * after.alpha)).toBeLessThan(.001);
		}
	});

	test("birds make occasional quiet passes instead of filling the sky constantly", () => {
		const active = sampleShelterAtmosphere({ ...input, timeMs: 8000 });
		const quiet = sampleShelterAtmosphere({ ...input, timeMs: 38000 });
		expect(active.birds.every(bird => bird.alpha > 0 && bird.alpha <= .72)).toBe(true);
		expect(quiet.birds.every(bird => bird.alpha === 0)).toBe(true);
		expect(sampleShelterAtmosphere({ ...input, birdBounds: undefined }).birds).toEqual([]);
		expect(allNumbers(sampleShelterWind(NaN)).every(Number.isFinite)).toBe(true);
	});

	test("sun openings belong to the grove while lamp illumination keeps its real sources", () => {
		const foliageAnchors = [{ x: 90, y: 175, radius: 19 }, { x: 300, y: 230, radius: 24 }];
		const frame = sampleShelterAtmosphere({ ...input, foliageAnchors, daylight: 1 });
		expect(frame.sunlight.pools).toHaveLength(7 + foliageAnchors.length * 2);
		for (let i = 0; i < foliageAnchors.length; i++) {
			const anchor = foliageAnchors[i]!;
			for (const pool of frame.sunlight.pools.slice(7 + i * 2, 9 + i * 2)) {
				expect(pool.x).toBeGreaterThan(anchor.x); expect(pool.x).toBeLessThan(anchor.x + 35);
				expect(pool.y).toBeGreaterThan(anchor.y); expect(pool.y).toBeLessThan(anchor.y + 17);
			}
		}
		expect(frame.groundLights).toHaveLength(input.lights!.length);
		const night = sampleShelterAtmosphere({ ...input, foliageAnchors, daylight: 0 });
		expect(night.sunlight.shafts).toEqual([]);
		expect(night.sunlight.pools.every(pool => pool.alpha === 0)).toBe(true);
		expect(night.motes.some(mote => mote.alpha > .05)).toBe(true);
		expect(night.birds.every(bird => bird.alpha === 0)).toBe(true);
		expect(night.groundLights).toEqual(frame.groundLights);
	});

	test("large foliage inputs keep a fixed decoration budget and reduced motion has no drifting motes", () => {
		const foliageAnchors = Array.from({ length: 2000 }, (_, i) => ({ x: i, y: i }));
		const crowded = sampleShelterAtmosphere({ ...input, foliageAnchors });
		expect(crowded.sunlight.pools).toHaveLength(7 + SHELTER_ATMOSPHERE_LIMITS.foliage * 2);
		expect(crowded.motes).toHaveLength(SHELTER_ATMOSPHERE_LIMITS.motes);
		const still = sampleShelterAtmosphere({ ...input, foliageAnchors, reducedMotion: true });
		expect(still.motes).toEqual([]);
		expect(sampleShelterAtmosphere({ ...input, foliageAnchors, reducedMotion: true, timeMs: 999999 })).toEqual(still);
	});
});
