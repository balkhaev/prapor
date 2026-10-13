import { describe, expect, test } from "bun:test";
import { projectShelterPoint, shelterRoomPolygon, shelterRoomPosition } from "../src/shelter-isometric";
import {
	getShelterCorridorPoint, getShelterCorridorSegments, getShelterLayoutCell,
	getShelterRoomDoor, getShelterWalkingRoute, getShelterWorldBounds, type ShelterLayoutSite,
	getShelterBuildingRect, getShelterBuildingPosition, getShelterOpenGroundPoints, isShelterPointInTerritory, type ShelterLayoutBuilding,
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

const ownedYard = Array.from({ length: 3 }, (_, row) => Array.from({ length: 4 }, (_, column) => ({ column, row }))).flat();
function expectFreeGroundRoute(from: ShelterPoint, route: readonly ShelterPoint[], cells: readonly ShelterLayoutSite[], buildings: readonly ShelterLayoutBuilding[]) {
	let previous = from;
	for (const point of route) {
		const length = Math.hypot(point.x - previous.x, point.y - previous.y), steps = Math.max(2, Math.ceil(length / 3));
		for (let i = 0; i <= steps; i++) {
			const p = { x: previous.x + (point.x - previous.x) * i / steps, y: previous.y + (point.y - previous.y) * i / steps };
			expect(isShelterPointInTerritory(p, cells)).toBe(true);
			for (const building of buildings) {
				const rect = getShelterBuildingRect(building);
				expect(p.x > rect.x + .002 && p.x < rect.x + rect.width - .002 && p.y > rect.y + .002 && p.y < rect.y + rect.height - .002).toBe(false);
			}
		}
		previous = point;
	}
}

describe("continuous building navigation", () => {
	test("fractional room positions retain their actual south doors and route around moved obstacles", () => {
		const rooms: ShelterLayoutBuilding[] = [
			{ column: 0, row: 0, width: 1, height: 1, position: { x: 73.25, y: 158.75 } },
			{ column: 2, row: 1, width: 1, height: 1, position: { x: 531.6, y: 348.2 } },
			{ column: 1, row: 1, width: 1, height: 1, position: { x: 308.3, y: 227.5 } },
		];
		const from = { x: 113.25, y: 198.75 }, to = { x: 591.6, y: 408.2 }, route = getShelterWalkingRoute(from, to, ownedYard, rooms);
		expect(getShelterBuildingPosition(rooms[0]!)).toEqual({ x: 73.25, y: 158.75 });
		expect(getShelterRoomDoor(rooms[0]!)).toEqual({ x: 159.25, y: 258.75 });
		expect(route).toContainEqual(getShelterRoomDoor(rooms[0]!));
		expect(route).toContainEqual(getShelterRoomDoor(rooms[1]!));
		expect(route.at(-1)).toEqual(to);
		const departure = route.findIndex((p) => p.x === 159.25 && p.y === 258.75), arrival = route.findIndex((p) => p.x === 617.6 && p.y === 448.2);
		expect(departure).toBeGreaterThanOrEqual(0); expect(arrival).toBeGreaterThan(departure);
		expectFreeGroundRoute(route[departure]!, route.slice(departure + 1, arrival + 1), ownedYard, rooms);
	});

	test("a rotated hangar routes workers to its actual long footprint door", () => {
		const hangar: ShelterLayoutBuilding = { column: 1, row: 0, width: 2, height: 3, position: { x: 311.125, y: 139.25 } };
		expect(getShelterBuildingRect(hangar)).toEqual({ x: 311.125, y: 139.25, width: 364, height: 364 });
		const from = { x: 117.8, y: 432.3 }, to = { x: 361.125, y: 209.25 }, route = getShelterWalkingRoute(from, to, ownedYard, [hangar]);
		const door = getShelterRoomDoor(hangar), arrival = route.findIndex((p) => p.x === door.x && p.y === door.y);
		expect(door).toEqual({ x: 493.125, y: 503.25 }); expect(arrival).toBeGreaterThanOrEqual(0);
		expectFreeGroundRoute(from, route.slice(0, arrival + 1), ownedYard, [hangar]);
		expect(route.at(-1)).toEqual(to);
	});

	test("the concave owned boundary prevents a diagonal through unpurchased land", () => {
		const land = [{ column: 0, row: 0 }, { column: 1, row: 0 }, { column: 0, row: 1 }];
		const rooms: ShelterLayoutBuilding[] = [
			{ column: 1, row: 0, width: 1, height: 1, position: { x: 237.25, y: 147.8 } },
			{ column: 0, row: 1, width: 1, height: 1, position: { x: 46.7, y: 282.35 } },
		];
		const from = getShelterRoomDoor(rooms[0]!), to = getShelterRoomDoor(rooms[1]!), route = getShelterWalkingRoute(from, to, land, rooms);
		expect(route.length).toBeGreaterThan(1); expect(route.at(-1)).toEqual(to);
		expectFreeGroundRoute(from, route, land, rooms);
		expect(isShelterPointInTerritory({ x: 280, y: 330 }, land)).toBe(false);
	});

	test("redirecting an actor mid-route keeps its fractional location and cannot join disconnected land", () => {
		const room: ShelterLayoutBuilding = { column: 1, row: 1, width: 1, height: 1, position: { x: 310.45, y: 297.2 } };
		const from = { x: 95.23, y: 155.27 }, to = { x: 703.15, y: 470.6 };
		const route = getShelterWalkingRoute(from, to, ownedYard, [room]), moving = advanceShelterRoute(from, route, 251.8);
		const newTarget = { x: 157.35, y: 463.8 }, redirected = getShelterWalkingRoute(moving.point, newTarget, ownedYard, [room]);
		expect(redirected.at(-1)).toEqual(newTarget);
		expectFreeGroundRoute(moving.point, redirected, ownedYard, [room]);
		const disjoint = [{ column: 0, row: 0 }, { column: 4, row: 0 }];
		expect(getShelterWalkingRoute(from, { x: 835.5, y: 203.8 }, disjoint, [room])).toEqual([]);
	});

	test("an unpurchased hole in the territory stays outside every route segment", () => {
		const ring = Array.from({ length: 3 }, (_, row) => Array.from({ length: 3 }, (_, column) => ({ column, row }))).flat().filter((site) => site.column !== 1 || site.row !== 1);
		const room: ShelterLayoutBuilding = { column: 0, row: 0, width: 1, height: 1, position: { x: 45.2, y: 149.75 } };
		const from = { x: 318.5, y: 235.3 }, to = { x: 317.8, y: 438.1 }, route = getShelterWalkingRoute(from, to, ring, [room]);
		expect(route.length).toBeGreaterThan(1); expect(route.at(-1)).toEqual(to);
		expectFreeGroundRoute(from, route, ring, [room]);
		expect(isShelterPointInTerritory({ x: 318, y: 330 }, ring)).toBe(false);
	});

	test("street arrivals use the gate before free ground, and squad gathering points avoid moved rooms", () => {
		const room: ShelterLayoutBuilding = { column: 0, row: 1, width: 1, height: 1, position: { x: 69.75, y: 336.4 } };
		const to = { x: 120.5, y: 390.4 }, route = getShelterWalkingRoute({ x: 114.4, y: 70 }, to, ownedYard, [room]);
		expect(route.slice(0, 2)).toEqual([{ x: 318, y: 70 }, { x: 318, y: 132 }]);
		expect(route).toContainEqual(getShelterRoomDoor(room));
		expect(route.at(-1)).toEqual(to);
		for (const point of getShelterOpenGroundPoints(ownedYard, [room])) {
			expect(isShelterPointInTerritory(point, ownedYard)).toBe(true);
			const rect = getShelterBuildingRect(room);
			expect(point.x >= rect.x - 10 && point.x <= rect.x + rect.width + 10 && point.y >= rect.y - 10 && point.y <= rect.y + rect.height + 10).toBe(false);
		}
	});
});
