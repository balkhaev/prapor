import { describe, expect, test } from "bun:test";
import { getShelterLandscape } from "../src/shelter-landscape";
import { getShelterCorridorSegments, getShelterRoomDoor, getShelterTerritoryCell, getShelterWorldBounds, type ShelterLayoutBuilding } from "../src/shelter-layout";
import { projectShelterPoint, shelterRoomPosition, shelterRoomRect } from "../src/shelter-isometric";
import type { ShelterPoint } from "../src/shelter-motion";

const sites = Array.from({ length: 3 }, (_, row) => Array.from({ length: 4 }, (_, column) => ({ column, row }))).flat();
const buildings: ShelterLayoutBuilding[] = Array.from({ length: 4 }, (_, column) => ({ column, row: 0, width: 1, height: 1 }));
function overlaps(point: ShelterPoint, radius: number, building: ShelterLayoutBuilding): boolean {
	const rect = shelterRoomRect(building.column, building.row, building.width, building.height);
	return point.x + radius > rect.x && point.x - radius < rect.x + rect.width && point.y + radius > rect.y && point.y - radius < rect.y + rect.height;
}

describe("surface base landscaping", () => {
	test("a contiguous yard has one exterior fence and one clear entrance", () => {
		const plan = getShelterLandscape(sites, buildings);
		expect(plan.perimeter).toHaveLength(5);
		expect(plan.perimeter.filter((edge) => edge.side === "north")).toEqual([
			{ from: { x: 30, y: 132 }, to: { x: 288, y: 132 }, side: "north" },
			{ from: { x: 348, y: 132 }, to: { x: 798, y: 132 }, side: "north" },
		]);
		expect(plan.paths.length).toBeLessThan(getShelterCorridorSegments(sites, buildings).length);
		for (const building of buildings) expect(plan.paths.some(({ from, to }) => [from, to].some((p) => p.x === getShelterRoomDoor(building).x && p.y === getShelterRoomDoor(building).y))).toBe(true);
		expect(plan.decorations.some((d) => d.kind === "gate" && d.point.x === 318 && d.point.y === 132)).toBe(true);
		expect(plan.decorations.some((d) => ["camp", "bench", "barrels"].includes(d.kind))).toBe(true);
	});

	test("scenery is stable regardless of input order and avoids the squad clearing", () => {
		const original = structuredClone(sites), plan = getShelterLandscape(sites, buildings);
		expect(getShelterLandscape([...sites].reverse(), buildings)).toEqual(plan);
		expect(sites).toEqual(original);
		for (const decoration of plan.decorations.filter((d) => d.owned && d.kind !== "gate")) {
			const cell = getShelterTerritoryCell(decoration.point)!;
			expect(sites.some((site) => site.column === cell.column && site.row === cell.row)).toBe(true);
			const p = shelterRoomPosition(cell.column, cell.row);
			const nearHome = decoration.point.x + decoration.radius > p.x + 52 && decoration.point.x - decoration.radius < p.x + 114 && decoration.point.y + decoration.radius > p.y + 50 && decoration.point.y - decoration.radius < p.y + 110;
			expect(nearHome).toBe(false);
		}
	});

	test("moving and rotating large buildings clears furniture and keeps paths at actual south doors", () => {
		const before = getShelterLandscape(sites, buildings);
		for (const large of [{ column: 0, row: 1, width: 3, height: 2 }, { column: 1, row: 0, width: 2, height: 3 }]) {
			const plan = getShelterLandscape(sites, [large]);
			expect(plan.decorations.filter((d) => d.kind !== "gate").every((d) => !overlaps(d.point, d.radius + 12, large))).toBe(true);
			const door = getShelterRoomDoor(large);
			expect(plan.paths.some(({ from, to }) => [from, to].some((point) => point.x === door.x && point.y === door.y))).toBe(true);
			expect(plan.decorations).not.toEqual(before.decorations);
		}
	});

	test("L-shaped expansion keeps its recess outside the owned ground and removes old exterior plants", () => {
		const initial = [{ column: 0, row: 0 }, { column: 1, row: 0 }, { column: 0, row: 1 }];
		const before = getShelterLandscape(initial), outside = before.decorations.find((d) => !d.owned && d.kind === "tree")!;
		const newSite = getShelterTerritoryCell(outside.point)!;
		const expanded = getShelterLandscape([...initial, newSite]);
		expect(before.lots.some((rect) => rect.x <= 250 && rect.x + rect.width > 250 && rect.y <= 300 && rect.y + rect.height > 300)).toBe(false);
		expect(expanded.decorations.some((d) => !d.owned && d.point.x === outside.point.x && d.point.y === outside.point.y)).toBe(false);
		const border = before.perimeter;
		expect(border.some(({ from, to }) => from.x === 222 && to.x === 222 && from.y === 264 && to.y === 396)).toBe(true);
	});

	test("active expansion stays clear of exterior trees and decoration bounds fit the camera", () => {
		const reserved = [{ column: -1, row: 0 }], plan = getShelterLandscape(sites, buildings, reserved);
		const position = shelterRoomPosition(-1, 0);
		expect(plan.decorations.filter((d) => !d.owned).every((d) => d.point.x + d.radius <= position.x - 10 || d.point.x - d.radius >= position.x + 182 || d.point.y + d.radius <= position.y - 16 || d.point.y - d.radius >= position.y + 116)).toBe(true);
		const frontier = [...new Map(plan.decorations.filter((d) => !d.owned && d.kind !== "lamp").map((d) => { const cell = getShelterTerritoryCell(d.point)!; return [`${cell.column}:${cell.row}`, cell]; })).values()];
		const bounds = getShelterWorldBounds(sites, frontier);
		for (const decoration of plan.decorations) {
			const at = projectShelterPoint(decoration.point);
			expect(at.x - 25).toBeGreaterThan(bounds.x);
			expect(at.x + 25).toBeLessThan(bounds.x + bounds.width);
			expect(at.y - 55).toBeGreaterThan(bounds.y);
			expect(at.y + 10).toBeLessThan(bounds.y + bounds.height);
		}
	});
});
