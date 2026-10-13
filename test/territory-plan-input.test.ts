import { describe, expect, test } from "bun:test";
import { getTerritoryPlanPoint } from "../src/territory-plan-input";

describe("continuous territory plan input", () => {
	const land = { x: -250, y: 60, width: 1400, height: 660 };
	test("retains a fractional position after viewport resizing and scrolling", () => {
		const point = { x: 57.25, y: 285.75 };
		for (const view of [{ x: 44, y: 120, width: 700, height: 330 }, { x: 12, y: -95, width: 350, height: 165 }]) {
			const clientX = view.x + (point.x - land.x) / land.width * view.width;
			const clientY = view.y + (point.y - land.y) / land.height * view.height;
			expect(getTerritoryPlanPoint(view, land, clientX, clientY)).toEqual(point);
		}
	});
	test("keeps boundary points and rejects clicks outside or unusable layouts", () => {
		const view = { x: 10, y: 20, width: 700, height: 330 };
		expect(getTerritoryPlanPoint(view, land, 10, 20)).toEqual({ x: -250, y: 60 });
		expect(getTerritoryPlanPoint(view, land, 710, 350)).toEqual({ x: 1150, y: 720 });
		for (const [x, y] of [[9, 20], [710.01, 350], [10, 351], [NaN, 20]]) expect(getTerritoryPlanPoint(view, land, x!, y!)).toBeNull();
		expect(getTerritoryPlanPoint({ ...view, width: 0 }, land, 10, 20)).toBeNull();
		expect(getTerritoryPlanPoint(view, { ...land, width: Infinity }, 10, 20)).toBeNull();
	});
});
