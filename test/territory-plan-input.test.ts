import { describe, expect, test } from "bun:test";
import { getTerritoryPlanPoint } from "../src/territory-plan-input";
import { projectShelterPoint, unprojectShelterPoint } from "../src/shelter-isometric";

describe("continuous territory plan input", () => {
	const land = { x: -250, y: 60, width: 1400, height: 660 };
	test("retains fractional ground positions through isometry, resizing and scrolling", () => {
		for (const point of [{ x: 57.25, y: 285.75 }, { x: -159.875, y: 517.125 }, { x: 873.375, y: 740.625 }]) {
			const projected = projectShelterPoint(point);
			for (const view of [{ x: 44, y: 120, width: 700, height: 330 }, { x: 12, y: -95, width: 350, height: 165 }]) {
				const clientX = view.x + (projected.x - land.x) / land.width * view.width;
				const clientY = view.y + (projected.y - land.y) / land.height * view.height;
				const result = getTerritoryPlanPoint(view, land, clientX, clientY);
				expect(result).not.toBeNull();
				expect(result!.x).toBeCloseTo(point.x, 10);
				expect(result!.y).toBeCloseTo(point.y, 10);
			}
		}
	});
	test("keeps boundary points and rejects clicks outside or unusable layouts", () => {
		const view = { x: 10, y: 20, width: 700, height: 330 };
		expect(getTerritoryPlanPoint(view, land, 10, 20)).toEqual(unprojectShelterPoint({ x: -250, y: 60 }));
		expect(getTerritoryPlanPoint(view, land, 710, 350)).toEqual(unprojectShelterPoint({ x: 1150, y: 720 }));
		for (const [x, y] of [[9, 20], [710.01, 350], [10, 351], [NaN, 20]]) expect(getTerritoryPlanPoint(view, land, x!, y!)).toBeNull();
		expect(getTerritoryPlanPoint({ ...view, width: 0 }, land, 10, 20)).toBeNull();
		expect(getTerritoryPlanPoint(view, { ...land, width: Infinity }, 10, 20)).toBeNull();
	});
});
