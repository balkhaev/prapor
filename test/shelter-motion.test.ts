import { expect, test } from "bun:test";
import { advanceShelterRoute, clientToShelterPoint, getShelterCell, planShelterRoute, SHELTER_SHAFT_X } from "../src/shelter-motion";

test("workers change floors through the shaft and stay on horizontal floor passages", () => {
	const start = { x: 108, y: 228 }, end = { x: 712, y: 450 };
	const route = planShelterRoute(start, end);
	expect(route).toEqual([{ x: 420, y: 228 }, { x: 420, y: 450 }, end]);
	let previous = start;
	for (const point of route) {
		expect(point.x === previous.x || point.y === previous.y).toBe(true);
		if (point.y !== previous.y) expect(point.x).toBe(SHELTER_SHAFT_X);
		previous = point;
	}
	expect(planShelterRoute(start, { x: 540, y: 228 })).toEqual([{ x: 540, y: 228 }]);
	expect(planShelterRoute(start, start)).toEqual([]);
});

test("retargeting a worker while climbing keeps the path in the shaft", () => {
	expect(planShelterRoute({ x: 420, y: 301 }, { x: 290, y: 129 })).toEqual([{ x: 420, y: 129 }, { x: 290, y: 129 }]);
});

test("walking consumes distance consistently across frame partitions without mutating its inputs", () => {
	const start = { x: 108, y: 228 }, route = planShelterRoute(start, { x: 712, y: 450 });
	const before = JSON.stringify({ start, route });
	const all = advanceShelterRoute(start, route, 647);
	let stepped = advanceShelterRoute(start, route, 0);
	for (const distance of [17, 41, 89, 200, 300]) stepped = advanceShelterRoute(stepped.point, stepped.route, distance);
	expect(stepped.point.x).toBeCloseTo(all.point.x, 8);
	expect(stepped.point.y).toBeCloseTo(all.point.y, 8);
	expect(stepped.route).toEqual(all.route);
	expect(JSON.stringify({ start, route })).toBe(before);
	expect(advanceShelterRoute(start, route, 10000)).toMatchObject({ point: { x: 712, y: 450 }, arrived: true, route: [] });
	for (const invalid of [-1, Number.NaN, Infinity]) expect(advanceShelterRoute(start, route, invalid).point).toEqual(start);
});

test("drop coordinates use the actual scaled canvas rectangle and exclude letterboxes", () => {
	const rect = { left: 200, top: 130, width: 420, height: 260 };
	expect(clientToShelterPoint(410, 260, rect)).toEqual({ x: 420, y: 260 });
	expect(clientToShelterPoint(199, 260, rect)).toBeNull();
	expect(clientToShelterPoint(410, 129, rect)).toBeNull();
	expect(clientToShelterPoint(620, 260, rect)).toBeNull();
	expect(clientToShelterPoint(410, 390, rect)).toBeNull();
	expect(clientToShelterPoint(410, 260, { ...rect, width: 0 })).toBeNull();
	expect(clientToShelterPoint(Number.NaN, 260, rect)).toBeNull();
});

test("drop targets exclude gaps, central lift and surrounding ground", () => {
	expect(getShelterCell({ x: 40, y: 148 })).toEqual({ column: 0, row: 0 });
	expect(getShelterCell({ x: 799, y: 469 })).toEqual({ column: 3, row: 2 });
	for (const point of [{ x: 212, y: 220 }, { x: 420, y: 300 }, { x: 600, y: 250 }, { x: 800, y: 220 }, { x: 100, y: 100 }]) expect(getShelterCell(point)).toBeNull();
});
