export type ScavDirection = "se" | "sw" | "ne" | "nw";
export const SCAV_DIRECTIONS = ["se", "sw", "ne", "nw"] as const satisfies readonly ScavDirection[];
export const SCAV_POSES = ["idle", "walk-a", "walk-b", "work"] as const;
export type ScavPose = typeof SCAV_POSES[number];

/** Every atlas frame shares a source canvas and a ground contact at the feet. */
export const SCAV_ORIGIN = { x: .5, y: 480 / 512 } as const;
export const SCAV_REFERENCE_HEIGHT = 360;

const APPEARANCES: Readonly<Record<string, number>> = { veteran: 0, collector: 1, runner: 2, careful: 3 };
const normalizeAppearance = (appearance: number) => Number.isFinite(appearance) ? ((Math.trunc(appearance) % 4) + 4) % 4 : 0;

/** The world character matches the personality-based portrait even after a new sortie. */
export function scavAppearance(personality?: string, fallback = 0): number {
	return personality && Object.hasOwn(APPEARANCES, personality) ? APPEARANCES[personality]! : normalizeAppearance(fallback);
}

export function scavTexture(appearance: number): string {
	return `scav-iso-${normalizeAppearance(appearance)}`;
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
