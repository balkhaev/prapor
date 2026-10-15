import type Phaser from "phaser";
import type { ShelterRect } from "./shelter-camera";
import type { ShelterPoint } from "./shelter-motion";
import { PIXEL_PALETTE as P } from "./pixel-art";
import { sampleWorldBirds, sampleWorldSunlight, type WorldBird, type WorldSunlight } from "./world-ambience";
const pigment = (hex: string): number => Number.parseInt(hex.slice(1), 16);

/** These points are already projected into the shelter's world, before camera zoom. */
export interface ShelterSmokeEmitter extends ShelterPoint {
	kind: "chimney" | "fire";
	height?: number;
	strength?: number;
}
export interface ShelterAtmosphereLight extends ShelterPoint {
	kind: "lamp" | "fire";
	height?: number;
}
export interface ShelterWind { x: number; y: number; sway: number }
export interface AtmosphereEllipse extends ShelterPoint { width: number; height: number; alpha: number }
export interface ShelterSmokePuff extends AtmosphereEllipse { id: number; color: number }
export interface ShelterFlame extends ShelterPoint { width: number; height: number; lean: number; alpha: number }
export interface ShelterEmber extends ShelterPoint { alpha: number; color: number }
export interface ShelterBird extends WorldBird {}
export interface ShelterFoliageAnchor extends ShelterPoint { radius?: number }
export interface ShelterAirMote extends ShelterPoint { alpha: number; color: number; size: number }
export interface ShelterLightGlow extends AtmosphereEllipse { color: number; coreAlpha: number }
export interface ShelterGroundLight extends AtmosphereEllipse { color: number }
export interface ShelterAtmosphereFrame {
	wind: ShelterWind;
	clouds: AtmosphereEllipse[];
	smoke: ShelterSmokePuff[];
	flames: ShelterFlame[];
	embers: ShelterEmber[];
	birds: ShelterBird[];
	glows: ShelterLightGlow[];
	groundLights: ShelterGroundLight[];
	mist: AtmosphereEllipse[];
	sunlight: WorldSunlight;
	motes: ShelterAirMote[];
}
export interface ShelterAtmosphereInput {
	timeMs: number;
	groundBounds: ShelterRect;
	smokeEmitters?: readonly ShelterSmokeEmitter[];
	lights?: readonly ShelterAtmosphereLight[];
	/** A projected strip above the distant forest. Omit it to leave the sky clear. */
	birdBounds?: ShelterRect;
	/** Keep these outside the occupied yard; only their soft edge is visible. */
	mistZones?: readonly ShelterRect[];
	reducedMotion?: boolean;
	/** Shared scene profile: multiplier, independent of the atmosphere clock. */
	lightStrength?: number;
	shadowStrength?: number;
	/** Shared visual climate. The local mist remains a small forest accent. */
	weatherRain?: number;
	weatherFog?: number;
	weatherWind?: number;
	/** Already projected tree feet, so sun openings belong to the actual grove. */
	foliageAnchors?: readonly ShelterFoliageAnchor[];
	dayPhase?: number;
	/** 0 at night, 1 by day; use the selected light profile rather than wall time. */
	daylight?: number;
}

export const SHELTER_ATMOSPHERE_LIMITS = Object.freeze({ smokeEmitters: 24, puffsPerEmitter: 3, embersPerFire: 3, flames: 24, lights: 32, birds: 6, clouds: 3, mist: 6, foliage: 8, motes: 12 });
const TAU = Math.PI * 2;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
const time = (value: number, reducedMotion = false) => reducedMotion ? 0 : clamp(finite(value), 0, 1e15);
const phase = (value: number) => value - Math.floor(value);
const smooth = (value: number) => { const p = clamp(value, 0, 1); return p * p * (3 - 2 * p); };
/** A moving sample fades all the way out before it wraps back to its source. */
const envelope = (p: number, edge = .16) => smooth(p / edge) * smooth((1 - p) / edge);
const validPoint = (point: ShelterPoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
function bounds(rect: ShelterRect): ShelterRect {
	return {
		x: clamp(finite(rect.x), -1e6, 1e6), y: clamp(finite(rect.y), -1e6, 1e6),
		width: clamp(finite(rect.width, 840), 1, 10000), height: clamp(finite(rect.height, 520), 1, 10000),
	};
}

/** A low, continuous breeze also drives tree crowns and cloth in the scene. */
export function sampleShelterWind(timeMs: number, reducedMotion = false, weatherWind?: number): ShelterWind {
	if (reducedMotion) return { x: 0, y: 0, sway: 0 };
	const t = time(timeMs), shared = weatherWind === undefined ? null : clamp(finite(weatherWind), -1, 1);
	const local = .48 + Math.sin(t / 24000 * TAU) * .22 + Math.sin(t / 61000 * TAU + .7) * .08;
	const sway = Math.sin(t / 7500 * TAU) * .68 + Math.sin(t / 19000 * TAU + .8) * .22;
	return {
		x: shared === null ? local : shared * .85 + (local - .48) * .2,
		y: Math.sin(t / 31000 * TAU + .5) * .08,
		sway: shared === null ? sway : shared * .25 + sway * (.5 + Math.abs(shared) * .5),
	};
}

/** Visual time only: no persistent particles, random calls, or game-state mutations. */
export function sampleShelterAtmosphere(input: ShelterAtmosphereInput): ShelterAtmosphereFrame {
	const t = time(input.timeMs, input.reducedMotion), area = bounds(input.groundBounds), wind = sampleShelterWind(t, input.reducedMotion, input.weatherWind);
	const rain = clamp(finite(input.weatherRain ?? 0), 0, 1), fog = clamp(finite(input.weatherFog ?? 0), 0, 1);
	const lightStrength = clamp(finite(input.lightStrength ?? 1, 1), 0, 2), shadowStrength = clamp(finite(input.shadowStrength ?? 1, 1), 0, 2);
	const daylight = clamp(finite(input.daylight ?? 1, 1), 0, 1);
	const sunlight = sampleWorldSunlight({ timeMs: t, bounds: area, dayPhase: input.dayPhase, daylight, rain, fog, reducedMotion: input.reducedMotion });
	const frame: ShelterAtmosphereFrame = { wind, clouds: [], smoke: [], flames: [], embers: [], birds: [], glows: [], groundLights: [], mist: [], sunlight, motes: [] };
	const foliage = input.foliageAnchors ?? [];
	for (let i = 0; i < Math.min(foliage.length, SHELTER_ATMOSPHERE_LIMITS.foliage); i++) {
		const anchor = foliage[i]!;
		if (!validPoint(anchor)) continue;
		const x = clamp(anchor.x, -1e6, 1e6), y = clamp(anchor.y, -1e6, 1e6), radius = clamp(finite(anchor.radius ?? 19, 19), 8, 45);
		// Narrow openings below individual crowns give the soft light an authored
		// source, with the same breeze as the moving tree art.
		for (let j = 0; j < 2; j++) {
			const sway = Math.sin(t / 13000 + i * 1.7 + j * 2) * 2 + wind.sway * 1.5;
			frame.sunlight.pools.push({ x: x + radius * (.3 + j * .7) + sway, y: y + 7 + j * 7,
				width: 7 + (i + j) % 3 * 4, height: 2 + j, alpha: sunlight.intensity * (.13 + j * .015), color: sunlight.color });
		}
	}
	if (!input.reducedMotion) for (let i = 0; i < SHELTER_ATMOSPHERE_LIMITS.motes; i++) {
		const anchor = foliage.length ? foliage[i % Math.min(foliage.length, SHELTER_ATMOSPHERE_LIMITS.foliage)] : null;
		const x = anchor && validPoint(anchor) ? clamp(anchor.x, -1e6, 1e6) : area.x + area.width * (.12 + phase(i * .371) * .75);
		const y = anchor && validPoint(anchor) ? clamp(anchor.y, -1e6, 1e6) : area.y + area.height * (.16 + phase(i * .227) * .7);
		const p = phase(t / (13500 + i * 430) + i * .17), dusk = (1 - daylight) * (1 - rain) * (1 - fog * .7);
		const pulse = .4 + .6 * smooth((Math.sin(t / (1100 + i * 90) + i) + .3) / 1.3);
		frame.motes.push({ x: x + Math.sin(p * TAU + i) * 16 + wind.x * p * 9,
			y: y - 7 - p * 22 + Math.cos(p * TAU + i * .6) * 4,
			alpha: envelope(p, .2) * (sunlight.intensity * .23 + dusk * .62 * pulse),
			color: pigment(daylight > .35 ? P.cream : P.yellow), size: daylight > .35 || i % 3 ? 1 : 2 });
	}
	for (let i = 0; i < SHELTER_ATMOSPHERE_LIMITS.clouds; i++) {
		const p = phase(t / (76000 + i * 9000) + .18 + i * .29);
		frame.clouds.push({
			x: area.x + area.width * p,
			y: area.y + area.height * (.25 + i * .25) + Math.sin(p * TAU + i) * Math.min(12, area.height * .05),
			width: Math.min(230, area.width * .3 + 20), height: Math.min(72, area.height * .15 + 8),
			alpha: .028 * envelope(p, .2) * shadowStrength * (1 + rain * .8),
		});
	}
	const emitters = input.smokeEmitters ?? [];
	for (let i = 0; i < Math.min(emitters.length, SHELTER_ATMOSPHERE_LIMITS.smokeEmitters); i++) {
		const emitter = emitters[i]!;
		if (!validPoint(emitter)) continue;
		const fire = emitter.kind === "fire", sourceHeight = clamp(finite(emitter.height ?? (fire ? 7 : 42)), 0, 100), strength = clamp(finite(emitter.strength ?? 1, 1), 0, 1);
		if (fire) {
			const lift = input.reducedMotion ? 0 : Math.sin(t / 1900 * TAU + i * .7);
			frame.flames.push({
				x: clamp(emitter.x, -1e6, 1e6), y: clamp(emitter.y, -1e6, 1e6) - .6,
				width: 5.3 + lift * .25, height: clamp(sourceHeight, 3, 12) + lift * .8,
				lean: wind.x * 1.05 + (input.reducedMotion ? 0 : Math.sin(t / 3100 * TAU + i) * .55), alpha: .87 * strength,
			});
			if (!input.reducedMotion) for (let ember = 0; ember < SHELTER_ATMOSPHERE_LIMITS.embersPerFire; ember++) {
				const p = phase(t / (2300 + ember * 270) + ember / 3 + i * .17), rise = 4 + p * 17;
				frame.embers.push({ x: clamp(emitter.x, -1e6, 1e6) + wind.x * rise * .8 + Math.sin(p * TAU + ember) * 2,
					y: clamp(emitter.y, -1e6, 1e6) - rise, alpha: envelope(p, .22) * (1 - p) * .65 * strength,
					color: pigment(ember % 2 ? P.woodLight : P.yellow) });
			}
		}
		for (let j = 0; j < SHELTER_ATMOSPHERE_LIMITS.puffsPerEmitter; j++) {
			const p = phase(t / (fire ? 5700 : 7300) + j / 3 + phase(i * .371 + .21));
			const rise = (fire ? 27 : 37) * p;
			frame.smoke.push({
				id: i * SHELTER_ATMOSPHERE_LIMITS.puffsPerEmitter + j,
				x: clamp(emitter.x, -1e6, 1e6) + wind.x * rise + Math.sin(p * TAU + i) * 2.1 * p,
				y: clamp(emitter.y, -1e6, 1e6) - sourceHeight - rise + wind.y * rise,
				width: 5 + p * (fire ? 16 : 19), height: 3.8 + p * 10,
				alpha: (fire ? .1 : .15) * strength * envelope(p, .24) * (1 - p * .58),
				color: pigment(fire ? P.panel : P.steelLight),
			});
		}
	}
	const lights = input.lights ?? [];
	for (let i = 0; i < Math.min(lights.length, SHELTER_ATMOSPHERE_LIMITS.lights); i++) {
		const light = lights[i]!;
		if (!validPoint(light)) continue;
		const fire = light.kind === "fire", pulse = input.reducedMotion ? 1 : 1 + Math.sin(t / (fire ? 4100 : 13000) * TAU + i * .83) * (fire ? .07 : .025);
		const height = clamp(finite(light.height ?? (fire ? 7 : 21)), 0, 100), color = pigment(fire ? P.woodLight : P.yellow);
		// Input x/y stays on the real ground projection. Raising the light moves
		// its glowing bulb only; it never lifts the illumination off the yard.
		const width = (fire ? 66 : 38 + height * 1.2) * pulse;
		frame.groundLights.push({ x: clamp(light.x, -1e6, 1e6), y: clamp(light.y, -1e6, 1e6),
			width, height: width * .5, alpha: (fire ? .32 : .28) * pulse * lightStrength, color });
		frame.glows.push({
			x: clamp(light.x, -1e6, 1e6), y: clamp(light.y, -1e6, 1e6) - height,
			width: (fire ? 22 : 16) * pulse, height: (fire ? 15 : 12) * pulse,
			alpha: (fire ? .13 : .1) * pulse * lightStrength, coreAlpha: Math.min(1, (fire ? .7 : .57) * pulse * lightStrength), color,
		});
	}
	if (input.birdBounds) frame.birds = sampleWorldBirds({ timeMs: t, bounds: input.birdBounds, groundBounds: area, daylight, rain, fog, reducedMotion: input.reducedMotion });
	const zones = input.mistZones ?? [];
	for (let i = 0; i < Math.min(zones.length, SHELTER_ATMOSPHERE_LIMITS.mist); i++) {
		const zone = bounds(zones[i]!), drift = Math.sin(t / 42000 * TAU + i * 1.3);
		frame.mist.push({ x: zone.x + zone.width * .5 + drift * Math.min(12, zone.width * .08), y: zone.y + zone.height * .5, width: zone.width, height: zone.height, alpha: (.025 + Math.sin(t / 58000 * TAU + i) * .005) * (1 - fog * .85) });
	}
	return frame;
}

/** Five integer bands form an airy stepped silhouette without blurred ellipses. */
function patch(g: Phaser.GameObjects.Graphics, x: number, y: number, width: number, height: number): void {
	const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
	const left = Math.round(x - w / 2), top = Math.round(y - h / 2), bands = Math.min(5, h);
	for (let row = 0; row < bands; row++) {
		const inset = Math.round(w * ([.24, .08, 0, .08, .24][Math.floor(row / bands * 5)] ?? 0));
		const from = Math.round(row * h / bands), to = Math.round((row + 1) * h / bands);
		g.fillRect(left + inset, top + from, Math.max(1, w - inset * 2), Math.max(1, to - from));
	}
}

/** A separate, low ground layer leaves roofs, characters, and controls unobscured. */
export function paintShelterAtmosphereGround(g: Phaser.GameObjects.Graphics, frame: ShelterAtmosphereFrame): void {
	g.clear();
	for (const cloud of frame.clouds) {
		g.fillStyle(pigment(P.ink), cloud.alpha);
		patch(g, cloud.x, cloud.y, cloud.width, cloud.height);
		g.fillStyle(pigment(P.ink), cloud.alpha * .4);
		patch(g, cloud.x + cloud.width * .28, cloud.y + cloud.height * .12, cloud.width * .55, cloud.height * .8);
	}
	for (const bird of frame.birds) {
		if (bird.shadowAlpha <= 0) continue;
		g.lineStyle(1, pigment(P.ink), bird.shadowAlpha);
		g.lineBetween(Math.round(bird.shadowX - bird.size * 1.15), Math.round(bird.shadowY + bird.wing * .4), Math.round(bird.shadowX), Math.round(bird.shadowY));
		g.lineBetween(Math.round(bird.shadowX), Math.round(bird.shadowY), Math.round(bird.shadowX + bird.size * 1.15), Math.round(bird.shadowY + bird.wing * .4));
	}
}

/** Additive pools sit above the terrain and below people, roofs and furniture.
 * Three quiet bands keep a clear 2:1 footprint without a blurred vector halo. */
export function paintShelterAtmosphereGroundLights(g: Phaser.GameObjects.Graphics, frame: ShelterAtmosphereFrame): void {
	g.clear();
	for (const pool of frame.sunlight.pools) {
		g.fillStyle(pool.color, pool.alpha * .5);
		patch(g, pool.x, pool.y, pool.width, pool.height);
		g.fillStyle(pool.color, pool.alpha * .28);
		patch(g, pool.x + 4, pool.y + 2, pool.width * .65, pool.height * .7);
	}
	for (const light of frame.groundLights) {
		for (const [size, opacity] of [[1, .17], [.74, .29], [.45, .5]]) {
			g.fillStyle(light.color, light.alpha * opacity!);
			patch(g, light.x, light.y, light.width * size!, light.height * size!);
		}
	}
}

export function paintShelterAtmosphereAir(g: Phaser.GameObjects.Graphics, frame: ShelterAtmosphereFrame): void {
	g.clear();
	for (const shaft of frame.sunlight.shafts) {
		// Wide staircase pixels follow the sun direction. Six bands per shaft,
		// fading toward the ground, preserve the established unblurred art.
		for (let band = 0; band < 6; band++) {
			const p = band / 6, next = (band + 1) / 6, width = shaft.width * (.6 + p * .7);
			const x = shaft.from.x + (shaft.to.x - shaft.from.x) * p, y = shaft.from.y + (shaft.to.y - shaft.from.y) * p;
			g.fillStyle(frame.sunlight.color, shaft.alpha * Math.sin((p + .12) * Math.PI));
			g.fillRect(Math.round(x - width / 2), Math.round(y), Math.max(1, Math.round(width)), Math.max(1, Math.round((shaft.to.y - shaft.from.y) * (next - p))));
		}
	}
	for (const mist of frame.mist) {
		g.fillStyle(pigment(P.steelLight), mist.alpha * .3);
		patch(g, mist.x, mist.y, mist.width, mist.height);
	}
	for (const puff of frame.smoke) {
		g.fillStyle(puff.color, puff.alpha);
		patch(g, puff.x, puff.y, puff.width, puff.height);
		g.fillStyle(puff.color, puff.alpha * .45);
		patch(g, puff.x - puff.width * .2, puff.y - puff.height * .2, puff.width * .55, puff.height * .45);
		g.fillStyle(puff.color, puff.alpha * .6);
		patch(g, puff.x + puff.width * .22, puff.y - puff.height * .24, puff.width * .4, puff.height * .5);
	}
	for (const flame of frame.flames) {
		g.fillStyle(pigment(P.rust), flame.alpha);
		patch(g, flame.x, flame.y - flame.height * .35, flame.width, flame.height * .7);
		g.fillStyle(pigment(P.yellow), flame.alpha);
		patch(g, flame.x + flame.lean, flame.y - flame.height * .66, flame.width * .55, flame.height * .7);
		g.fillStyle(pigment(P.cream), flame.alpha).fillRect(Math.round(flame.x - 1), Math.round(flame.y - 3), 2, 3);
	}
	for (const ember of frame.embers) g.fillStyle(ember.color, ember.alpha).fillRect(Math.round(ember.x), Math.round(ember.y), 1, 1);
	for (const mote of frame.motes) {
		if (mote.alpha > .001) g.fillStyle(mote.color, mote.alpha).fillRect(Math.round(mote.x), Math.round(mote.y), mote.size, 1);
	}
	for (const bird of frame.birds) {
		if (bird.alpha <= 0) continue;
		g.lineStyle(1, pigment(P.ink), bird.alpha);
		g.lineBetween(Math.round(bird.x - bird.size), Math.round(bird.y + bird.wing - bird.bank), Math.round(bird.x), Math.round(bird.y));
		g.lineBetween(Math.round(bird.x), Math.round(bird.y), Math.round(bird.x + bird.size), Math.round(bird.y + bird.wing + bird.bank));
		g.fillStyle(pigment(P.ink), bird.alpha).fillRect(Math.round(bird.x + bird.heading), Math.round(bird.y - 1), 1, 2);
	}
}

export function paintShelterAtmosphereGlows(g: Phaser.GameObjects.Graphics, frame: ShelterAtmosphereFrame): void {
	g.clear();
	for (const glow of frame.glows) {
		g.fillStyle(glow.color, glow.alpha);
		patch(g, glow.x, glow.y, glow.width, glow.height);
		g.fillStyle(pigment(P.cream), glow.coreAlpha).fillRect(Math.round(glow.x - 1), Math.round(glow.y - 1), 3, 2);
	}
}
