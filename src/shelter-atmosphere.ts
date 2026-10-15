import type Phaser from "phaser";
import type { ShelterRect } from "./shelter-camera";
import type { ShelterPoint } from "./shelter-motion";
import { PIXEL_PALETTE as P } from "./pixel-art";
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
export interface ShelterBird extends ShelterPoint { size: number; wing: number; alpha: number }
export interface ShelterLightGlow extends AtmosphereEllipse { color: number; coreAlpha: number }
export interface ShelterAtmosphereFrame {
	wind: ShelterWind;
	clouds: AtmosphereEllipse[];
	smoke: ShelterSmokePuff[];
	flames: ShelterFlame[];
	birds: ShelterBird[];
	glows: ShelterLightGlow[];
	mist: AtmosphereEllipse[];
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
}

export const SHELTER_ATMOSPHERE_LIMITS = Object.freeze({ smokeEmitters: 24, puffsPerEmitter: 3, flames: 24, lights: 32, birds: 6, clouds: 3, mist: 6 });
const TAU = Math.PI * 2;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
const time = (value: number, reducedMotion = false) => reducedMotion ? 0 : clamp(finite(value), 0, 1e12);
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
export function sampleShelterWind(timeMs: number, reducedMotion = false): ShelterWind {
	if (reducedMotion) return { x: 0, y: 0, sway: 0 };
	const t = time(timeMs);
	return {
		x: .48 + Math.sin(t / 24000 * TAU) * .22 + Math.sin(t / 61000 * TAU + .7) * .08,
		y: Math.sin(t / 31000 * TAU + .5) * .08,
		sway: Math.sin(t / 7500 * TAU) * .68 + Math.sin(t / 19000 * TAU + .8) * .22,
	};
}

/** Visual time only: no persistent particles, random calls, or game-state mutations. */
export function sampleShelterAtmosphere(input: ShelterAtmosphereInput): ShelterAtmosphereFrame {
	const t = time(input.timeMs, input.reducedMotion), area = bounds(input.groundBounds), wind = sampleShelterWind(t, input.reducedMotion);
	const frame: ShelterAtmosphereFrame = { wind, clouds: [], smoke: [], flames: [], birds: [], glows: [], mist: [] };
	for (let i = 0; i < SHELTER_ATMOSPHERE_LIMITS.clouds; i++) {
		const p = phase(t / (76000 + i * 9000) + .18 + i * .29);
		frame.clouds.push({
			x: area.x + area.width * p,
			y: area.y + area.height * (.25 + i * .25) + Math.sin(p * TAU + i) * Math.min(12, area.height * .05),
			width: Math.min(230, area.width * .3 + 20), height: Math.min(72, area.height * .15 + 8),
			alpha: .028 * envelope(p, .2),
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
		frame.glows.push({
			x: clamp(light.x, -1e6, 1e6), y: clamp(light.y, -1e6, 1e6) - clamp(finite(light.height ?? (fire ? 7 : 21)), 0, 100),
			width: (fire ? 22 : 16) * pulse, height: (fire ? 15 : 12) * pulse,
			alpha: (fire ? .13 : .1) * pulse, coreAlpha: (fire ? .7 : .57) * pulse, color: pigment(fire ? P.woodLight : P.yellow),
		});
	}
	if (input.birdBounds && !input.reducedMotion) {
		const sky = bounds(input.birdBounds), p = phase(t / 58000 + .075), alpha = envelope(p / .37, .18) * .72;
		for (let i = 0; i < SHELTER_ATMOSPHERE_LIMITS.birds; i++) {
			frame.birds.push({
				x: sky.x + sky.width * clamp(p / .37, 0, 1) - (i % 3) * 9,
				y: sky.y + sky.height * .46 + Math.floor(i / 3) * 10 + Math.sin(t / 3800 + i * .9) * 2.5,
				size: 2.2 + (i % 2) * .55, wing: Math.sin(t / 470 * TAU + i * .65) * 1.8,
				alpha,
			});
		}
	}
	const zones = input.mistZones ?? [];
	for (let i = 0; i < Math.min(zones.length, SHELTER_ATMOSPHERE_LIMITS.mist); i++) {
		const zone = bounds(zones[i]!), drift = Math.sin(t / 42000 * TAU + i * 1.3);
		frame.mist.push({ x: zone.x + zone.width * .5 + drift * Math.min(12, zone.width * .08), y: zone.y + zone.height * .5, width: zone.width, height: zone.height, alpha: .025 + Math.sin(t / 58000 * TAU + i) * .005 });
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
	}
}

export function paintShelterAtmosphereAir(g: Phaser.GameObjects.Graphics, frame: ShelterAtmosphereFrame): void {
	g.clear();
	for (const mist of frame.mist) {
		g.fillStyle(pigment(P.steelLight), mist.alpha * .3);
		patch(g, mist.x, mist.y, mist.width, mist.height);
	}
	for (const puff of frame.smoke) {
		g.fillStyle(puff.color, puff.alpha);
		patch(g, puff.x, puff.y, puff.width, puff.height);
		g.fillStyle(puff.color, puff.alpha * .45);
		patch(g, puff.x - puff.width * .2, puff.y - puff.height * .2, puff.width * .55, puff.height * .45);
	}
	for (const flame of frame.flames) {
		g.fillStyle(pigment(P.rust), flame.alpha);
		patch(g, flame.x, flame.y - flame.height * .35, flame.width, flame.height * .7);
		g.fillStyle(pigment(P.yellow), flame.alpha);
		patch(g, flame.x + flame.lean, flame.y - flame.height * .66, flame.width * .55, flame.height * .7);
		g.fillStyle(pigment(P.cream), flame.alpha).fillRect(Math.round(flame.x - 1), Math.round(flame.y - 3), 2, 3);
	}
	for (const bird of frame.birds) {
		if (bird.alpha <= 0) continue;
		g.lineStyle(1, pigment(P.ink), bird.alpha);
		g.lineBetween(Math.round(bird.x - bird.size), Math.round(bird.y + bird.wing), Math.round(bird.x), Math.round(bird.y));
		g.lineBetween(Math.round(bird.x), Math.round(bird.y), Math.round(bird.x + bird.size), Math.round(bird.y + bird.wing));
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
