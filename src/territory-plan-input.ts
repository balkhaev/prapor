interface PlanBounds { x: number; y: number; width: number; height: number }

/** The overview and the yard share continuous coordinates, including fractional positions. */
export function getTerritoryPlanPoint(view: PlanBounds, land: PlanBounds, clientX: number, clientY: number): { x: number; y: number } | null {
	if (![view.x, view.y, view.width, view.height, land.x, land.y, land.width, land.height, clientX, clientY].every(Number.isFinite)
		|| view.width <= 0 || view.height <= 0 || land.width <= 0 || land.height <= 0
		|| clientX < view.x || clientX > view.x + view.width || clientY < view.y || clientY > view.y + view.height) return null;
	return { x: land.x + (clientX - view.x) / view.width * land.width, y: land.y + (clientY - view.y) / view.height * land.height };
}
