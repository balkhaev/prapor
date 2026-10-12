export type ShelterPoint = { x: number; y: number };
export const SHELTER_FLOOR_Y = [129, 228, 339, 450] as const;
export const SHELTER_SHAFT_X = 420;
const EPSILON = .001;
const finitePoint = (point: ShelterPoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
const samePoint = (a: ShelterPoint, b: ShelterPoint) => Math.hypot(a.x - b.x, a.y - b.y) < EPSILON;

/** Horizontal passages meet at the central shaft; no route crosses a ceiling diagonally. */
export function planShelterRoute(from: ShelterPoint, to: ShelterPoint): ShelterPoint[] {
	if (!finitePoint(from) || !finitePoint(to) || samePoint(from, to)) return [];
	const route: ShelterPoint[] = [];
	const append = (point: ShelterPoint) => {
		const previous = route.at(-1) ?? from;
		if (!samePoint(previous, point)) route.push({ ...point });
	};
	if (Math.abs(from.y - to.y) < EPSILON) append(to);
	else {
		append({ x: SHELTER_SHAFT_X, y: from.y });
		append({ x: SHELTER_SHAFT_X, y: to.y });
		append(to);
	}
	return route;
}

/** Consuming distance, rather than frame time, makes walking independent of refresh rate. */
export function advanceShelterRoute(point: ShelterPoint, route: readonly ShelterPoint[], distance: number): {
	point: ShelterPoint; route: ShelterPoint[]; arrived: boolean; facing: -1 | 1; vertical: boolean;
} {
	let next = { ...point };
	const remaining = route.map((waypoint) => ({ ...waypoint }));
	let budget = Number.isFinite(distance) ? Math.max(0, distance) : 0;
	let facing: -1 | 1 = 1;
	let vertical = false;
	while (remaining.length) {
		const target = remaining[0]!;
		const length = Math.hypot(target.x - next.x, target.y - next.y);
		if (length < EPSILON) { remaining.shift(); continue; }
		if (!budget) break;
		if (Math.abs(target.x - next.x) > EPSILON) facing = target.x > next.x ? 1 : -1;
		vertical = Math.abs(target.y - next.y) > EPSILON;
		if (budget < length) {
			const share = budget / length;
			next = { x: next.x + (target.x - next.x) * share, y: next.y + (target.y - next.y) * share };
			budget = 0;
		} else { next = { ...target }; budget -= length; remaining.shift(); }
	}
	return { point: next, route: remaining, arrived: remaining.length === 0, facing, vertical: remaining.length > 0 && vertical };
}

/** Phaser FIT puts letterboxing outside this rectangle; the caller supplies the canvas, not its parent. */
export function clientToShelterPoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, logicalWidth = 840, logicalHeight = 520): ShelterPoint | null {
	if (![clientX, clientY, rect.left, rect.top, rect.width, rect.height, logicalWidth, logicalHeight].every(Number.isFinite)
		|| rect.width <= 0 || rect.height <= 0 || logicalWidth <= 0 || logicalHeight <= 0) return null;
	const x = (clientX - rect.left) / rect.width;
	const y = (clientY - rect.top) / rect.height;
	if (x < 0 || x >= 1 || y < 0 || y >= 1) return null;
	return { x: x * logicalWidth, y: y * logicalHeight };
}

export function getShelterCell(point: ShelterPoint): { column: number; row: number } | null {
	if (!finitePoint(point)) return null;
	const column = [40, 220, 448, 628].findIndex((x) => point.x >= x && point.x < x + 172);
	const row = [148, 259, 370].findIndex((y) => point.y >= y && point.y < y + 100);
	return column < 0 || row < 0 ? null : { column, row };
}
