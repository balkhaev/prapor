import { describe, expect, test } from "bun:test";
import { projectShelterPoint, shelterRoomPolygon, shelterRoomPosition } from "../src/shelter-isometric";
import {
	getShelterCorridorPoint, getShelterCorridorSegments, getShelterLayoutCell,
	getShelterRoomDoor, getShelterWalkingRoute, getShelterWorldBounds, type ShelterLayoutSite,
} from "../src/shelter-layout";
import { advanceShelterRoute, type ShelterPoint } from "../src/shelter-motion";

const sites: ShelterLayoutSite[] = [{ column: 0, row: 0 }, { column: 1, row: 0 }, { column: 1, row: 1 }];
const inside = (column: number, row: number, x = 50, y = 40): ShelterPoint => {
	const origin = shelterRoomPosition(column, row);
	return { x: origin.x + x, y: origin.y + y };
};
function expectOrthogonal(from: ShelterPoint, route: readonly ShelterPoint[]) {
	let previous = from;
	for (const point of route) {
		expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
		expect(point.x === previous.x || point.y === previous.y).toBe(true);
		expect(point).not.toEqual(previous);
		previous = point;
	}
}
function expectCorridorTravel(from: ShelterPoint, route: readonly ShelterPoint[], cells: readonly ShelterLayoutSite[]) {
	const segments = getShelterCorridorSegments(cells);
	let previous = from;
	for (const point of route) {
		const midpoint = { x: (previous.x + point.x) / 2, y: (previous.y + point.y) / 2 };
		expect(segments.some(({ from: a, to: b }) => a.x === b.x ? midpoint.x === a.x && midpoint.y >= Math.min(a.y, b.y) && midpoint.y <= Math.max(a.y, b.y)
			: midpoint.y === a.y && midpoint.x >= Math.min(a.x, b.x) && midpoint.x <= Math.max(a.x, b.x))).toBe(true);
		previous = point;
	}
}

describe("expandable surface shelter layout", () => {
	test("uniform cells extend left, right and deeper while floor hits exclude passage gaps", () => {
		for (const column of [-4, -1, 0, 3, 8]) for (const row of [-2, 0, 2, 11]) {
			const origin = shelterRoomPosition(column, row);
			expect(origin).toEqual({ x: 40 + column * 192, y: 148 + row * 132 });
			expect(getShelterLayoutCell(inside(column, row))).toEqual({ column, row });
			expect(getShelterLayoutCell({ x: origin.x + 172, y: origin.y + 40 })).toBeNull();
			expect(getShelterLayoutCell({ x: origin.x + 40, y: origin.y + 100 })).toBeNull();
		}
		expect(getShelterLayoutCell({ x: Number.NaN, y: 10 })).toBeNull();
	});

	test("shared corridor edges are unique and unopened neighbours never create passages", () => {
		const single = getShelterCorridorSegments([{ column: 0, row: 0 }]);
		expect(single).toHaveLength(4);
		expect(getShelterCorridorSegments([...sites, ...sites])).toHaveLength(10);
		for (const segment of single) {
			expectOrthogonal(segment.from, [segment.to]);
			expect([132, 264].includes(segment.from.y) || [30, 222].includes(segment.from.x)).toBe(true);
		}
	});

	test("a worker uses doors and connected corridor corners to reach another row", () => {
		const from = inside(0, 0), to = inside(1, 1, 135, 75), original = structuredClone(sites);
		const route = getShelterWalkingRoute(from, to, sites);
		expect(route.length).toBeGreaterThan(5);
		expectOrthogonal(from, route);
		expect(route).toContainEqual(getShelterRoomDoor(sites[0]!));
		expect(route).toContainEqual(getShelterCorridorPoint(sites[0]!));
		expect(route).toContainEqual(getShelterRoomDoor(sites[2]!));
		expect(route.at(-1)).toEqual(to);
		const firstCorridor = route.findIndex((point) => point.x === 126 && point.y === 264);
		const lastCorridor = route.findIndex((point) => point.x === 318 && point.y === 396);
		expectCorridorTravel(route[firstCorridor]!, route.slice(firstCorridor + 1, lastCorridor + 1), sites);
		expect(sites).toEqual(original);
		const arrival = advanceShelterRoute(from, route, 10000);
		expect(arrival.arrived).toBe(true);
		expect(arrival.point).toEqual(to);
	});

	test("a carved L shape does not grant a diagonal shortcut through missing rock", () => {
		const from = getShelterCorridorPoint(sites[0]!), to = getShelterCorridorPoint(sites[2]!);
		const route = getShelterWalkingRoute(from, to, sites);
		expectOrthogonal(from, route);
		expectCorridorTravel(from, route, sites);
		expect(getShelterWalkingRoute(inside(0, 0), inside(0, 1), sites)).toEqual([]);
		expect(getShelterWalkingRoute(inside(0, 0), inside(6, 4), [...sites, { column: 6, row: 4 }])).toEqual([]);
	});

	test("endpoints in the same passage split that edge without detouring, and replanning mid-walk stays connected", () => {
		const from = { x: 70, y: 264 }, to = { x: 170, y: 264 };
		expect(getShelterWalkingRoute(from, to, sites)).toEqual([to]);
		const original = getShelterWalkingRoute(inside(0, 0), inside(1, 1), sites);
		const walking = advanceShelterRoute(inside(0, 0), original, 150);
		const redirect = getShelterWalkingRoute(walking.point, inside(1, 0), sites);
		expect(redirect.length).toBeGreaterThan(0);
		expectOrthogonal(walking.point, redirect);
		expect(redirect.at(-1)).toEqual(inside(1, 0));
		const inDoor = { x: 126, y: 254 }, throughDoor = getShelterWalkingRoute(inDoor, inside(1, 0), sites);
		expect(throughDoor[0]).toEqual({ x: 126, y: 264 });
		expectOrthogonal(inDoor, throughDoor);
		expect(getShelterWalkingRoute(inside(1, 0), inDoor, sites).at(-1)).toEqual(inDoor);
	});

	test("street access enters from the north without a lift and within-room movement stays inside", () => {
		const from = { x: 126, y: 70 }, to = inside(1, 0);
		const route = getShelterWalkingRoute(from, to, sites);
		expectOrthogonal(from, route);
		expect(route[0]).toEqual({ x: 126, y: 132 });
		expect(route.at(-1)).toEqual(to);
		expect(getShelterWalkingRoute(to, from, sites).at(-1)).toEqual(from);
		const local = getShelterWalkingRoute(inside(0, 0, 30, 30), inside(0, 0, 90, 60), sites);
		expect(local).toEqual([inside(0, 0, 90, 30), inside(0, 0, 90, 60)]);
	});

	test("world bounds contain left/deep expansion, unopened walls, street and tall equipment", () => {
		const expanded = [...sites, { column: -3, row: 2 }, { column: 7, row: 9 }];
		const frontier = [{ column: -4, row: 2 }, { column: 7, row: 10 }];
		const bounds = getShelterWorldBounds(expanded, frontier);
		for (const cell of [...expanded, ...frontier]) for (const corner of shelterRoomPolygon(cell.column, cell.row)) {
			expect(corner.x).toBeGreaterThan(bounds.x);
			expect(corner.x).toBeLessThan(bounds.x + bounds.width);
			expect(corner.y - 64).toBeGreaterThan(bounds.y);
			expect(corner.y + 5).toBeLessThan(bounds.y + bounds.height);
		}
		const street = projectShelterPoint({ x: 126, y: -20 });
		expect(street.x).toBeGreaterThan(bounds.x);
		expect(street.x).toBeLessThan(bounds.x + bounds.width);
		expect(street.y).toBeGreaterThan(bounds.y);
		expect(street.y).toBeLessThan(bounds.y + bounds.height);
		expect(getShelterWorldBounds([]).width).toBeGreaterThan(0);
	});
});
