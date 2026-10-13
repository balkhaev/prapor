import { unprojectShelterPoint } from "./shelter-isometric";

interface PlanBounds { x: number; y: number; width: number; height: number }

/** Undo both responsive scaling and the yard's isometric projection without snapping. */
export function getTerritoryPlanPoint(view: PlanBounds, projected: PlanBounds, clientX: number, clientY: number): { x: number; y: number } | null {
	if (![view.x, view.y, view.width, view.height, projected.x, projected.y, projected.width, projected.height, clientX, clientY].every(Number.isFinite)
		|| view.width <= 0 || view.height <= 0 || projected.width <= 0 || projected.height <= 0
		|| clientX < view.x || clientX > view.x + view.width || clientY < view.y || clientY > view.y + view.height) return null;
	return unprojectShelterPoint({ x: projected.x + (clientX - view.x) / view.width * projected.width, y: projected.y + (clientY - view.y) / view.height * projected.height });
}
