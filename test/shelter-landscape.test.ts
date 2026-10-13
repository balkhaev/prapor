import { describe, expect, test } from "bun:test";
import { getShelterLandscape } from "../src/shelter-landscape";
import { getShelterBuildingRect, getShelterCorridorPoint, getShelterCorridorSegments, getShelterRoomDoor, getShelterRoomEntranceDirection, getShelterTerritoryCell, getShelterWorldBounds, isShelterPointInTerritory, type ShelterLayoutBuilding } from "../src/shelter-layout";
import { projectShelterPoint, shelterRoomPosition } from "../src/shelter-isometric";
import type { ShelterPoint } from "../src/shelter-motion";

const sites = Array.from({ length: 3 }, (_, row) => Array.from({ length: 4 }, (_, column) => ({ column, row }))).flat();
const buildings: ShelterLayoutBuilding[] = Array.from({ length: 4 }, (_, column) => ({ column, row: 0, width: 1, height: 1 }));
function overlaps(point: ShelterPoint, radius: number, building: ShelterLayoutBuilding): boolean {
	const rect = getShelterBuildingRect(building);
	return point.x + radius > rect.x && point.x - radius < rect.x + rect.width && point.y + radius > rect.y && point.y - radius < rect.y + rect.height;
}

describe("surface base landscaping", () => {
	test("all four facings redraw worn paths and gravel thresholds on the selected entrance side", () => {
		const base: ShelterLayoutBuilding = { column: 1, row: 1, width: 1, height: 1, position: { x: 311.25, y: 288.75 } }, plans = [];
		for (const facing of [0, 1, 2, 3] as const) {
			const room = { ...base, facing }, plan = getShelterLandscape(sites, [room]), door = getShelterRoomDoor(room), normal = getShelterRoomEntranceDirection(room), outside = getShelterCorridorPoint(room);
			const threshold = plan.paths.find(({ from, to }) => from.x === outside.x && from.y === outside.y && to.x === door.x && to.y === door.y);
			expect(threshold).toBeDefined();
			expect(plan.aprons).toHaveLength(1);
			for (const point of plan.aprons[0]!.points) {
				expect(isShelterPointInTerritory(point, sites)).toBe(true);
				expect((point.x - door.x) * normal.x + (point.y - door.y) * normal.y).toBeGreaterThanOrEqual(0);
			}
			expect(plan.decorations.filter((d) => d.kind !== "gate").every((d) => !overlaps(d.point, d.radius + 12, room))).toBe(true);
			expect(getShelterLandscape([...sites].reverse(), [room])).toEqual(plan);
			plans.push(plan);
		}
		for (let i = 1; i < plans.length; i++) expect(plans[i]!.aprons).not.toEqual(plans[i - 1]!.aprons);
	});

	test("entrance aprons shrink in a narrow gap and stay clear of neighbouring buildings", () => {
		const left: ShelterLayoutBuilding = { column: 1, row: 1, width: 1, height: 1, position: { x: 311, y: 285 }, facing: 3 };
		const right: ShelterLayoutBuilding = { column: 2, row: 1, width: 1, height: 1, position: { x: 419, y: 300 }, facing: 0 };
		const plan = getShelterLandscape(sites, [left, right]), door = getShelterRoomDoor(left), normal = getShelterRoomEntranceDirection(left);
		const apron = plan.aprons.find((item) => item.points.some((point) => point.x === door.x));
		expect(apron).toBeDefined();
		expect(Math.max(...apron!.points.map((point) => (point.x - door.x) * normal.x + (point.y - door.y) * normal.y))).toBe(8);
		for (const item of plan.aprons) for (const point of item.points) for (const building of [left, right]) {
			const rect = getShelterBuildingRect(building);
			expect(point.x > rect.x + .001 && point.x < rect.x + rect.width - .001 && point.y > rect.y + .001 && point.y < rect.y + rect.height - .001).toBe(false);
		}
	});

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

	test("wet hollows and everyday furniture stay clear of walked routes in a freely planned yard", () => {
		const rooms = buildings.map((building) => ({ ...building, position: shelterRoomPosition(building.column, building.row), facing: 0 as const }));
		const plan = getShelterLandscape(sites, rooms);
		expect(plan.decorations.some((decoration) => decoration.kind === "puddle" && decoration.owned)).toBe(true);
		expect(plan.decorations.some((decoration) => decoration.kind === "woodpile" && decoration.owned)).toBe(true);
		expect(plan.decorations.some((decoration) => decoration.kind === "fern" && !decoration.owned)).toBe(true);
		for (const decoration of plan.decorations.filter((item) => item.kind !== "gate")) for (const { from, to } of plan.paths) {
			const dx = to.x - from.x, dy = to.y - from.y, length = dx * dx + dy * dy;
			const t = length ? Math.max(0, Math.min(1, ((decoration.point.x - from.x) * dx + (decoration.point.y - from.y) * dy) / length)) : 0;
			expect(Math.hypot(decoration.point.x - from.x - dx * t, decoration.point.y - from.y - dy * t)).toBeGreaterThanOrEqual(decoration.radius + 12);
		}
		for (const [kind, limit] of [["camp", 1], ["bench", 2], ["barrels", 3], ["woodpile", 1], ["puddle", 3]] as const) {
			expect(plan.decorations.filter((decoration) => decoration.owned && decoration.kind === kind).length).toBeLessThanOrEqual(limit);
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

	test("continuous dragging reculls props and redraws paths to fractional south doors", () => {
		const first: ShelterLayoutBuilding = { column: 1, row: 1, width: 1, height: 1, position: { x: 307.75, y: 346.4 } };
		const moved: ShelterLayoutBuilding = { ...first, position: { x: 487.3, y: 379.15 } };
		const initial = getShelterLandscape(sites, [first]), plan = getShelterLandscape(sites, [moved]), door = getShelterRoomDoor(moved);
		expect(plan.decorations).not.toEqual(initial.decorations);
		expect(plan.paths).not.toEqual(initial.paths);
		expect(plan.paths.some(({ from, to }) => [from, to].some((p) => p.x === door.x && p.y === door.y))).toBe(true);
		expect(plan.decorations.filter((d) => d.kind !== "gate").every((d) => !overlaps(d.point, d.radius + 12, moved))).toBe(true);
	});

	test("a freely placed rotated hangar clears scenery across its actual full footprint", () => {
		const hangar: ShelterLayoutBuilding = { column: 1, row: 0, width: 2, height: 3, position: { x: 306.2, y: 141.8 } };
		const plan = getShelterLandscape(sites, [hangar]), door = getShelterRoomDoor(hangar);
		expect(plan.decorations.filter((d) => d.kind !== "gate").every((d) => !overlaps(d.point, d.radius + 12, hangar))).toBe(true);
		expect(plan.paths.some(({ from, to }) => [from, to].some((p) => p.x === door.x && p.y === door.y))).toBe(true);
	});
});
