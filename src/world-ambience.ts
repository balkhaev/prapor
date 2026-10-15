/** Small, deterministic world-space accents shared by the shelter and the raid.
 * No timers, random state, game events or persistent particle collections. */
export interface AmbiencePoint { x: number; y: number }
export interface AmbienceBounds extends AmbiencePoint { width: number; height: number }
export interface AmbiencePatch extends AmbienceBounds { alpha: number; color: number }
export interface WorldSunshaft { from: AmbiencePoint; to: AmbiencePoint; width: number; alpha: number }
export interface WorldSunlight {
	intensity: number;
	color: number;
	direction: AmbiencePoint;
	shafts: WorldSunshaft[];
	pools: AmbiencePatch[];
}
export interface WorldBird extends AmbiencePoint {
	size: number; wing: number; alpha: number; heading: 1 | -1; bank: number;
	shadowX: number; shadowY: number; shadowAlpha: number;
}
export interface WorldAmbienceInput {
	timeMs: number;
	bounds: AmbienceBounds;
	/** The selected light profile supplies this, so manual night also extinguishes the sun. */
	daylight?: number;
	rain?: number;
	fog?: number;
	reducedMotion?: boolean;
}
export interface WorldSunlightInput extends WorldAmbienceInput { dayPhase?: number }
export interface WorldBirdInput extends WorldAmbienceInput { groundBounds?: AmbienceBounds }
export const WORLD_AMBIENCE_LIMITS = Object.freeze({ birds: 6, sunshafts: 4, sunPools: 7 });
const TAU = Math.PI * 2;
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, finite(value)));
const phase = (value: number): number => value - Math.floor(value);
const smooth = (value: number): number => { const p = clamp(value); return p * p * (3 - 2 * p); };
const envelope = (p: number, edge = .16): number => smooth(p / edge) * smooth((1 - p) / edge);
const visualTime = (input: WorldAmbienceInput): number => input.reducedMotion ? 0 : clamp(input.timeMs, 0, 1e15);
function safeBounds(input: AmbienceBounds): AmbienceBounds {
	return { x: clamp(input.x, -1e6, 1e6), y: clamp(input.y, -1e6, 1e6),
		width: clamp(finite(input.width, 840), 1, 10000), height: clamp(finite(input.height, 520), 1, 10000) };
}
function visibility(input: WorldAmbienceInput): number {
	return clamp(finite(input.daylight ?? 1, 1)) * (1 - clamp(input.rain ?? 0)) * (1 - clamp(input.fog ?? 0) * .85);
}

/** Light travels in one coherent direction, and cloud openings drift slowly over
 * the ground. Broad, low-opacity shafts are filled with integer pixel bands by
 * each renderer; they never require a full-screen blur or extra framebuffer. */
export function sampleWorldSunlight(input: WorldSunlightInput): WorldSunlight {
	const t = visualTime(input), area = safeBounds(input.bounds), intensity = visibility(input);
	const day = clamp(finite(input.dayPhase ?? .43, .43));
	const direction = { x: .32 + Math.cos((day - .28) * Math.PI) * .48, y: .72 };
	const frame: WorldSunlight = { intensity, color: 0xdad0ac, direction, shafts: [], pools: [] };
	if (intensity <= .001) return frame;
	const reach = Math.min(250, area.height * .62), drift = Math.sin(t / 91000 * TAU) * Math.min(28, area.width * .03);
	for (let i = 0; i < WORLD_AMBIENCE_LIMITS.sunshafts; i++) {
		const from = { x: area.x + area.width * (.08 + i * .25) + drift, y: area.y - 18 + i % 2 * 19 };
		frame.shafts.push({ from, to: { x: from.x + reach * direction.x, y: from.y + reach * direction.y },
			width: 12 + i % 3 * 9, alpha: intensity * (.042 + Math.sin(t / 39000 + i * 1.7) * .01) });
	}
	for (let i = 0; i < WORLD_AMBIENCE_LIMITS.sunPools; i++) {
		const offset = Math.sin(t / (37000 + i * 3100) * TAU + i * 2.1);
		frame.pools.push({ x: area.x + area.width * (.1 + phase(i * .371) * .78) + drift,
			y: area.y + area.height * (.2 + phase(i * .217 + .14) * .65) + offset * 3,
			width: 21 + i % 3 * 14, height: 5 + i % 3 * 3,
			alpha: intensity * (.09 + offset * .025), color: frame.color });
	}
	return frame;
}

/** A loose staggered flock alternates flight direction between visits. Wings
 * have individual timing and long glides rather than six synchronized V marks.
 * Flight wraps only after the whole flock has faded out. */
export function sampleWorldBirds(input: WorldBirdInput): WorldBird[] {
	if (input.reducedMotion) return [];
	const t = visualTime(input), area = safeBounds(input.bounds), ground = input.groundBounds ? safeBounds(input.groundBounds) : null;
	const cycle = Math.floor(t / 46000 + .075), heading: 1 | -1 = cycle % 2 ? -1 : 1;
	const p = phase(t / 46000 + .075) / .61, alpha = envelope(p, .18) * .72 * visibility(input);
	const travel = clamp(p), birds: WorldBird[] = [];
	for (let i = 0; i < WORLD_AMBIENCE_LIMITS.birds; i++) {
		const rank = Math.floor((i + 1) / 2), side = i % 2 ? -1 : 1;
		const x = area.x + (heading > 0 ? travel : 1 - travel) * area.width - heading * rank * 11;
		const y = area.y + area.height * .45 + side * rank * 5 + Math.sin(t / 2400 + i * .9) * 2.5;
		const glide = smooth((Math.sin(t / 4200 + i * .76) + .22) / .75);
		const wing = Math.sin(t / (430 + i * 17) * TAU + i * .8) * (1 - glide * .86) * 2.2;
		const sx = x + 24, sy = y + 94 + rank * 2;
		const inside = !ground || sx >= ground.x && sx <= ground.x + ground.width && sy >= ground.y && sy <= ground.y + ground.height;
		birds.push({ x, y, size: 4 + i % 3 * .5, wing, alpha, heading,
			bank: Math.sin(t / 3000 + i * .8) * .6,
			shadowX: sx, shadowY: sy, shadowAlpha: inside ? alpha * .17 : 0 });
	}
	return birds;
}
