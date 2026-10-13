import { describe, expect, test } from "bun:test";
import { getShelterCorridorSegments, getShelterRoomDoor, getShelterTerritoryCell, getShelterWalkingRoute, type ShelterLayoutBuilding } from "../src/shelter-layout";
import { projectShelterPoint, shelterRoomPolygon, shelterRoomPosition, shelterRoomRect, unprojectShelterPoint } from "../src/shelter-isometric";

const land = Array.from({ length: 5 }, (_, row) => Array.from({ length: 5 }, (_, column) => ({ column, row }))).flat();
const inside = (building: ShelterLayoutBuilding, x = 40, y = 40) => { const origin = shelterRoomPosition(building.column, building.row); return { x: origin.x + x, y: origin.y + y }; };
const contains = (building: ShelterLayoutBuilding, point: { x: number; y: number }) => {
	const rect = shelterRoomRect(building.column, building.row, building.width, building.height);
	return point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height;
};

describe("outdoor base with large structures", () => {
	test("whole lots can be selected in path gaps and negative land coordinates", () => {
		expect(getShelterTerritoryCell({ x: 218, y: 254 })).toEqual({ column: 0, row: 0 });
		expect(getShelterTerritoryCell({ x: 222, y: 264 })).toEqual({ column: 1, row: 1 });
		expect(getShelterTerritoryCell({ x: -162, y: 150 })).toEqual({ column: -1, row: 0 });
		expect(getShelterTerritoryCell({ x: Number.NaN, y: 250 })).toBeNull();
	});

	test("a hangar covers its internal gaps and its rotated or moved polygon stays invertible", () => {
		for (const building of [{ column: 1, row: 1, width: 3, height: 2 }, { column: -2, row: 2, width: 2, height: 3 }]) {
			const rect = shelterRoomRect(building.column, building.row, building.width, building.height);
			expect(rect.width).toBe(building.width * 192 - 20);
			expect(rect.height).toBe(building.height * 132 - 32);
			const corners = shelterRoomPolygon(building.column, building.row, building.width, building.height).map(unprojectShelterPoint);
			expect(corners[0]!.x).toBeCloseTo(rect.x, 8);
			expect(corners[2]!.x).toBeCloseTo(rect.x + rect.width, 8);
			expect(corners[2]!.y).toBeCloseTo(rect.y + rect.height, 8);
			expect(getShelterRoomDoor(building)).toEqual({ x: rect.x + rect.width / 2, y: rect.y + rect.height });
		}
	});

	test("walking between other buildings goes around a hangar, never through its interior", () => {
		const hangar = { column: 1, row: 1, width: 3, height: 2 }, fromBuilding = { column: 0, row: 0, width: 1, height: 1 }, toBuilding = { column: 4, row: 4, width: 1, height: 1 };
		const buildings = [hangar, fromBuilding, toBuilding];
		for (const segment of getShelterCorridorSegments(land, buildings)) expect(contains(hangar, { x: (segment.from.x + segment.to.x) / 2, y: (segment.from.y + segment.to.y) / 2 })).toBe(false);
		const from = inside(fromBuilding), to = inside(toBuilding), route = getShelterWalkingRoute(from, to, land, buildings);
		expect(route.length).toBeGreaterThan(0);
		expect(route.at(-1)).toEqual(to);
		let previous = from;
		for (const point of route) {
			expect(point.x === previous.x || point.y === previous.y).toBe(true);
			for (let fraction = 0; fraction <= 1; fraction += .1) expect(contains(hangar, { x: previous.x + (point.x - previous.x) * fraction, y: previous.y + (point.y - previous.y) * fraction })).toBe(false);
			previous = point;
		}
	});

	test("a visitor enters one large structure by its south door and can cross its internal grid gaps", () => {
		const hangar = { column: 1, row: 1, width: 3, height: 2 };
		const destination = inside(hangar, 480, 180), from = { x: 318, y: 90 };
		const route = getShelterWalkingRoute(from, destination, land, [hangar]);
		expect(route.at(-1)).toEqual(destination);
		expect(route).toContainEqual(getShelterRoomDoor(hangar));
		const local = getShelterWalkingRoute(inside(hangar, 40, 40), destination, land, [hangar]);
		expect(local).toEqual([inside(hangar, 480, 40), destination]);
		const visual = projectShelterPoint(destination);
		expect(unprojectShelterPoint(visual).x).toBeCloseTo(destination.x, 8);
	});
});
