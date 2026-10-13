import { SCAV_APPEARANCES, defaultScavAppearance, isScavAppearance } from "./game/scav-appearances";

export type ScavDirection = "se" | "sw" | "ne" | "nw";
export const SCAV_DIRECTIONS = ["se", "sw", "ne", "nw"] as const satisfies readonly ScavDirection[];
export const SCAV_POSES = ["idle", "walk-a", "walk-b", "work"] as const;
export type ScavPose = typeof SCAV_POSES[number];

/** Every atlas frame shares a source canvas and a ground contact at the feet. */
export const SCAV_ORIGIN = { x: .5, y: 480 / 512 } as const;
export const SCAV_REFERENCE_HEIGHT = 360;

const legacyAppearance = (appearance: number) => Number.isFinite(appearance) ? ((Math.trunc(appearance) % 4) + 4) % 4 : 0;

/** Saved visual identity takes priority; older saves retain their original personality model. */
export function scavAppearance(personality?: string, fallback = 0, appearance?: number): number {
	if (isScavAppearance(appearance)) return appearance;
	return SCAV_APPEARANCES.some((look) => look.personality === personality) ? defaultScavAppearance(personality ?? "") : legacyAppearance(fallback);
}

export function scavTexture(appearance: number): string {
	return `scav-iso-${isScavAppearance(appearance) ? appearance : legacyAppearance(appearance)}`;
}

/** A queued atlas uses a loaded model of the same personality until its whole atlas is ready. */
export function scavAvailableAppearance(appearance: number, isLoaded: (texture: string) => boolean): number {
	const valid = isScavAppearance(appearance) ? appearance : legacyAppearance(appearance);
	return isLoaded(scavTexture(valid)) ? valid : defaultScavAppearance(SCAV_APPEARANCES[valid]?.personality ?? "");
}

/** Only the four compatibility atlases and the current roster are needed at startup. */
export function scavPreloadAppearances(scavs: readonly { personality?: string; appearance?: number }[] = []): number[] {
	return [...new Set([0, 1, 2, 3, ...scavs.map((scav) => scavAppearance(scav.personality, 0, scav.appearance))])];
}

/** Equipment follows the same blended torso motion as the character's animated poses. */
export function scavTorsoAnchor(poses: readonly { weight: number; torso?: { x: number; y: number } }[]): { x: number; y: number } | undefined {
	let x = 0, y = 0, total = 0;
	for (const { weight, torso } of poses) {
		if (!torso || weight <= 0 || ![weight, torso.x, torso.y].every(Number.isFinite)) continue;
		x += torso.x * weight; y += torso.y * weight; total += weight;
	}
	return total > 0 ? { x: x / total, y: y / total } : undefined;
}

export function scavFrame(pose: ScavPose, direction: ScavDirection): string {
	return `${pose}-${direction}`;
}

/** Screen-space movement owns the view. A missing component keeps its previous side. */
export function scavDirection(dx: number, dy: number, previous: ScavDirection = "se"): ScavDirection {
	if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx === 0 && dy === 0) return previous;
	const front = dy === 0 ? previous[0] === "s" : dy > 0;
	const right = dx === 0 ? previous[1] === "e" : dx > 0;
	return front ? right ? "se" : "sw" : right ? "ne" : "nw";
}

export interface ScavAttachment {
	x: number;
	y: number;
	/** World-space bearing in degrees, including the left-facing half-turn. */
	angle: number;
	behind: boolean;
	flipX: boolean;
}

/** Hand anchors are expressed at the 48px display height used by the raid view. */
export function scavAttachment(direction: ScavDirection, working = false): ScavAttachment {
	const right = direction[1] === "e", rear = direction[0] === "n";
	const angle = Math.atan2(rear ? -.5 : .5, right ? 1 : -1) * 180 / Math.PI;
	return { x: (right ? 1 : -1) * (working ? 9 : 8), y: rear ? -27 : working ? -23 : -25, angle, behind: rear, flipX: !right };
}
