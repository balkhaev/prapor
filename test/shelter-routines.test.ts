import { describe, expect, test } from "bun:test";
import { getShelterBuildingRect, getShelterRoomDoor, getShelterWalkingRoute, isShelterPointInTerritory, type ShelterLayoutBuilding, type ShelterLayoutSite } from "../src/shelter-layout";
import type { ShelterLandscapeDecoration } from "../src/shelter-landscape";
import { getShelterLandscape } from "../src/shelter-landscape";
import type { ShelterPoint } from "../src/shelter-motion";
import { getShelterRoutine, restoreShelterRoutine, type ShelterRoutineInput } from "../src/shelter-routines";

const sites: ShelterLayoutSite[] = Array.from({ length: 9 }, (_, index) => ({ column: index % 3, row: Math.floor(index / 3) }));
const buildings: ShelterLayoutBuilding[] = [{ column: 0, row: 0, width: 1, height: 1, position: { x: 48, y: 156 }, facing: 0 }];
const prop = (kind: ShelterLandscapeDecoration["kind"], x: number, y: number, radius: number, owned = true): ShelterLandscapeDecoration => ({ kind, point: { x, y }, radius, owned, seed: 17 });
const decorations: ShelterLandscapeDecoration[] = [prop("camp", 350, 350, 20), prop("bench", 560, 440, 17), prop("barrels", 120, 430, 17), prop("gate", 318, 132, 0)];
const input: ShelterRoutineInput = { scavId: "scav-boroda", personality: "veteran", visit: 0, sites, buildings, decorations, from: { x: 350, y: 250 } };
const distance = (a: ShelterPoint, b: ShelterPoint) => Math.hypot(a.x - b.x, a.y - b.y);
function expectOpen(point: ShelterPoint, land: readonly ShelterLayoutSite[], rooms: readonly ShelterLayoutBuilding[]) {
	expect(isShelterPointInTerritory(point, land)).toBe(true);
	for (const room of rooms) {
		const rect = getShelterBuildingRect(room);
		const clearance = Math.hypot(Math.max(rect.x - point.x, 0, point.x - rect.x - rect.width), Math.max(rect.y - point.y, 0, point.y - rect.y - rect.height));
		expect(clearance).toBeGreaterThanOrEqual(8);
	}
}
function expectRouteOnGround(from: ShelterPoint, to: ShelterPoint, land: readonly ShelterLayoutSite[], rooms: readonly ShelterLayoutBuilding[]) {
	const route = getShelterWalkingRoute(from, to, land, rooms);
	if (distance(from, to) < .001) { expect(route).toEqual([]); return; }
	expect(route.at(-1)).toEqual(to);
	let previous = from;
	for (const end of route) {
		for (let step = 1; step <= 20; step++) {
			const point = { x: previous.x + (end.x - previous.x) * step / 20, y: previous.y + (end.y - previous.y) * step / 20 };
			expect(isShelterPointInTerritory(point, land)).toBe(true);
			for (const room of rooms) {
				const rect = getShelterBuildingRect(room);
				expect(point.x > rect.x + .01 && point.x < rect.x + rect.width - .01 && point.y > rect.y + .01 && point.y < rect.y + rect.height - .01).toBe(false);
			}
		}
		previous = end;
	}
}

describe("cosmetic shelter resident routines", () => {
	test("stable inputs give repeatable routines without modifying shared scenery or using random state", () => {
		const frozen = structuredClone(input), before = structuredClone(frozen);
		const first = getShelterRoutine(frozen);
		expect(first).not.toBeNull();
		expect(getShelterRoutine(frozen)).toEqual(first);
		expect(getShelterRoutine({ ...frozen, sites: [...frozen.sites].reverse(), decorations: [...frozen.decorations].reverse() })).toEqual(first);
		expect(frozen).toEqual(before);
		expect(first!.dwellMs).toBeGreaterThanOrEqual(4000);
		expect(first!.dwellMs).toBeLessThanOrEqual(35000);
		expect(first!.label.length).toBeGreaterThan(0);
		first!.point.x = -999;
		expect(getShelterRoutine(frozen)!.point.x).not.toBe(-999);
	});

	test("residents alternate meaningful activities at actual props with independent visit sequences", () => {
		const routines = Array.from({ length: 30 }, (_, visit) => getShelterRoutine({ ...input, visit })).filter((routine) => routine !== null);
		expect(routines).toHaveLength(30);
		expect(new Set(routines.map((routine) => routine.activity)).size).toBeGreaterThanOrEqual(4);
		expect(new Set(routines.map((routine) => `${routine.point.x}:${routine.point.y}`)).size).toBeGreaterThan(5);
		const other = Array.from({ length: 6 }, (_, visit) => getShelterRoutine({ ...input, scavId: "scav-tihaya", personality: "careful", visit }));
		expect(other).not.toEqual(routines.slice(0, 6));
		for (const routine of routines) {
			expectOpen(routine.point, sites, buildings);
			if (routine.activity !== "stroll") expect(routine.lookAt).toBeDefined();
			for (const decoration of decorations.filter((item) => item.kind !== "gate")) expect(distance(routine.point, decoration.point)).toBeGreaterThanOrEqual(decoration.radius + 7);
		}
	});

	test("all four building directions preserve owned, accessible targets and stay out of rooms", () => {
		for (const facing of [0, 1, 2, 3] as const) {
			const rooms: ShelterLayoutBuilding[] = [{ column: 1, row: 1, width: 1, height: 1, position: { x: 270, y: 290 }, facing }];
			const from = { x: 150, y: 300 };
			for (let visit = 0; visit < 6; visit++) {
				const routine = getShelterRoutine({ ...input, buildings: rooms, decorations: [], from, visit });
				expect(routine).not.toBeNull();
				expectOpen(routine!.point, sites, rooms);
				expectRouteOnGround(from, routine!.point, sites, rooms);
				expect(routine!.point).not.toEqual(getShelterRoomDoor(rooms[0]!));
			}
		}
	});

	test("a newly unassigned resident leaves through the real door before choosing an outdoor routine", () => {
		for (const facing of [0, 1, 2, 3] as const) {
			const room: ShelterLayoutBuilding = { column: 1, row: 1, width: 1, height: 1, position: { x: 270, y: 290 }, facing };
			const rect = getShelterBuildingRect(room), from = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
			const routine = getShelterRoutine({ ...input, buildings: [room], decorations: [], from });
			expect(routine).not.toBeNull();
			expectOpen(routine!.point, sites, [room]);
			const route = getShelterWalkingRoute(from, routine!.point, sites, [room]);
			expect(route).toContainEqual(getShelterRoomDoor(room));
			expect(route.at(-1)).toEqual(routine!.point);
		}
	});

	test("an irregular yard and isolated owned island never produce a shortcut through unopened land", () => {
		const land: ShelterLayoutSite[] = [{ column: 0, row: 0 }, { column: 1, row: 0 }, { column: 1, row: 1 }, { column: 5, row: 4 }];
		const from = { x: 90, y: 260 }, props = [prop("camp", 1100, 740, 20), prop("bench", 270, 340, 17)];
		for (let visit = 0; visit < 15; visit++) {
			const routine = getShelterRoutine({ ...input, sites: land, decorations: props, from, visit });
			expect(routine).not.toBeNull();
			expect(routine!.point.x).toBeLessThan(500);
			expectOpen(routine!.point, land, buildings);
			expectRouteOnGround(from, routine!.point, land, buildings);
		}
	});

	test("moving a building onto the previous gathering point replans from the current geometry", () => {
		const first = getShelterRoutine({ ...input, decorations: [] })!;
		expect(first).not.toBeNull();
		const moved = [...buildings, { column: 1, row: 1, width: 1, height: 1, position: { x: first.point.x - 20, y: first.point.y - 20 }, facing: 0 as const }];
		const next = getShelterRoutine({ ...input, buildings: moved, decorations: [] });
		expect(next).not.toBeNull();
		expect(next!.point).not.toEqual(first.point);
		expectOpen(next!.point, sites, moved);
	});

	test("reserved gathering spots leave realistic room for another person and provide a chat partner", () => {
		const reserved = [{ x: 382, y: 350 }];
		const routines = Array.from({ length: 24 }, (_, visit) => getShelterRoutine({ ...input, reservedTargets: reserved, visit })).filter((routine) => routine !== null);
		for (const routine of routines) expect(distance(routine.point, reserved[0]!)).toBeGreaterThanOrEqual(18);
		expect(routines.some((routine) => routine.activity === "chat" && distance(routine.point, reserved[0]!) <= 32 && routine.lookAt?.x === reserved[0]!.x && routine.lookAt?.y === reserved[0]!.y)).toBe(true);
	});

	test("foreground and unowned props cannot attract residents outside the fence", () => {
		const props = [prop("camp", 350, 350, 20, false), prop("bench", 2500, 2500, 17, true), prop("gate", 318, 114, 0, true)];
		for (let visit = 0; visit < 12; visit++) {
			const routine = getShelterRoutine({ ...input, decorations: props, visit });
			expect(routine).not.toBeNull();
			expect(["stroll", "sweep"]).toContain(routine!.activity);
			expectOpen(routine!.point, sites, buildings);
		}
	});

	test("paths to props do not walk through a camp or storage pile", () => {
		const props = [prop("camp", 350, 350, 20), prop("barrels", 450, 350, 17), prop("bench", 550, 350, 17)];
		const from = { x: 590, y: 350 };
		for (let visit = 0; visit < 18; visit++) {
			const routine = getShelterRoutine({ ...input, decorations: props, from, visit });
			expect(routine).not.toBeNull();
			let previous = from;
			for (const end of getShelterWalkingRoute(from, routine!.point, sites, buildings)) {
				const steps = Math.ceil(distance(previous, end));
				for (let step = 0; step <= steps; step++) {
					const point = { x: previous.x + (end.x - previous.x) * step / steps, y: previous.y + (end.y - previous.y) * step / steps };
					for (const decoration of props) expect(distance(point, decoration.point)).toBeGreaterThanOrEqual(decoration.radius + 2.9);
				}
				previous = end;
			}
		}
	});

	test("an entirely blocked or missing yard has no safe cosmetic destination", () => {
		expect(getShelterRoutine({ ...input, sites: [] })).toBeNull();
		expect(getShelterRoutine({ ...input, sites: [{ column: 0, row: 0 }], decorations: [prop("camp", 126, 198, 300)], from: { x: 40, y: 140 } })).toBeNull();
		expect(getShelterRoutine({ ...input, from: { x: Number.NaN, y: 250 } })).toBeNull();
	});

	test("captured camp, bench and chat routines restore from current anchors and ignore saved presentation fields", () => {
		for (const activity of ["warm", "rest", "chat"] as const) {
			const originalInput = { ...input, reservedTargets: [{ x: 382, y: 350 }] };
			let capture: ReturnType<typeof getShelterRoutine> = null, visit = 0;
			for (; visit < 50; visit++) {
				capture = getShelterRoutine({ ...originalInput, visit });
				if (capture?.activity === activity) break;
			}
			expect(capture?.activity).toBe(activity);
			const saved = { point: capture!.point, activity, label: "fake saved label", lookAt: { x: -9999, y: -9999 }, dwellMs: -1 };
			const restored = restoreShelterRoutine({ ...originalInput, visit, from: capture!.point }, saved);
			expect(restored).toEqual(capture);
			expect(restored!.label).not.toBe(saved.label);
			expect(restored!.lookAt).not.toEqual(saved.lookAt);
			expect(restored!.dwellMs).toBeGreaterThan(0);
			expect(saved.label).toBe("fake saved label");
		}
	});

	test("restoration rejects changed buildings, new props, missing gathering anchors and an unreachable route", () => {
		let original: ReturnType<typeof getShelterRoutine> = null, visit = 0;
		for (; visit < 50; visit++) {
			original = getShelterRoutine({ ...input, visit });
			if (original?.activity === "warm") break;
		}
		expect(original?.activity).toBe("warm");
		const saved = { point: original!.point, activity: original!.activity };
		const restoreInput = { ...input, visit, from: original!.point };
		expect(restoreShelterRoutine(restoreInput, saved)).not.toBeNull();
		const moved: ShelterLayoutBuilding = { column: 1, row: 1, width: 1, height: 1, position: { x: original!.point.x - 20, y: original!.point.y - 20 }, facing: 1 };
		expect(restoreShelterRoutine({ ...restoreInput, buildings: [...buildings, moved] }, saved)).toBeNull();
		expect(restoreShelterRoutine({ ...restoreInput, decorations: [...decorations, prop("barrels", original!.point.x, original!.point.y, 17)] }, saved)).toBeNull();
		expect(restoreShelterRoutine({ ...restoreInput, decorations: decorations.filter((item) => item.kind !== "camp") }, saved)).toBeNull();
		expect(restoreShelterRoutine({ ...restoreInput, sites: [{ column: 1, row: 1 }], from: input.from }, saved)).toBeNull();
		const midpoint = { x: (input.from.x + original!.point.x) / 2, y: (input.from.y + original!.point.y) / 2 };
		expect(restoreShelterRoutine({ ...restoreInput, from: input.from, decorations: [...decorations, prop("tree", midpoint.x, midpoint.y, 12)] }, saved)).toBeNull();
	});

	test("malformed captures and arbitrary open coordinates cannot invent an activity", () => {
		const malformed: unknown[] = [null, [], "warm", {}, { point: null, activity: "warm" }, { point: [], activity: "warm" },
			{ point: { x: "382", y: 350 }, activity: "warm" }, { point: { x: Number.NaN, y: 350 }, activity: "warm" },
			{ point: { x: 382, y: Number.POSITIVE_INFINITY }, activity: "warm" }, { point: { x: 382, y: 350 }, activity: "attack" },
			{ point: { x: 150, y: 300 }, activity: "warm" }];
		for (const saved of malformed) expect(restoreShelterRoutine(input, saved)).toBeNull();
		const capture = getShelterRoutine(input)!;
		expect(restoreShelterRoutine(input, { point: { x: capture.point.x + 1, y: capture.point.y }, activity: capture.activity })).toBeNull();
		expect(restoreShelterRoutine(input, { point: capture.point, activity: "lookout" })).toBeNull();
	});

	test("supply carrying, sweeping and small repairs happen at reachable ground or their actual props", () => {
		const props = [...decorations, prop("woodpile", 440, 470, 17)];
		const routines = Array.from({ length: 80 }, (_, visit) => getShelterRoutine({ ...input, decorations: props, visit }));
		for (const activity of ["carry", "sweep", "maintain"] as const) expect(routines.some((routine) => routine?.activity === activity)).toBe(true);
		for (const routine of routines) {
			expect(routine).not.toBeNull();
			expectOpen(routine!.point, sites, buildings);
			expectRouteOnGround(input.from, routine!.point, sites, buildings);
			if (routine!.activity === "carry") {
				const anchor = props.find((decoration) => decoration.kind !== "gate" && distance(decoration.point, routine!.lookAt!) < .01);
				expect(anchor).toBeDefined();
				expect(["barrels", "woodpile", "logs"]).toContain(anchor!.kind);
				expect(routine!.cargo).toBe(anchor!.kind === "barrels" ? "crate" : "firewood");
				expect(routine!.dwellMs).toBeGreaterThanOrEqual(8500);
				expect(routine!.dwellMs).toBeLessThanOrEqual(14500);
			}
			if (routine!.activity === "maintain") {
				expect(routine!.lookAt).toEqual(props.find((decoration) => decoration.kind === "bench")!.point);
				expect(routine!.dwellMs).toBeGreaterThanOrEqual(12000);
				expect(routine!.dwellMs).toBeLessThanOrEqual(20500);
			}
		}
	});

	test("visits rotate between available chores rather than repeatedly rolling the same activity", () => {
		const props = [...decorations, prop("woodpile", 440, 470, 17)];
		const routines = Array.from({ length: 24 }, (_, visit) => getShelterRoutine({ ...input, decorations: props, visit }));
		const firstCycle = routines.slice(0, 8).map((routine) => routine!.activity);
		expect(new Set(firstCycle).size).toBe(8);
		expect(routines.slice(8, 16).map((routine) => routine!.activity)).toEqual(firstCycle);
		expect(routines.slice(16, 24).map((routine) => routine!.activity)).toEqual(firstCycle);
	});

	test("chores respect prop clearance and reserved residents throughout their routes", () => {
		const props = [...decorations, prop("woodpile", 440, 470, 17)];
		const reservedTargets = [{ x: 120, y: 462 }, { x: 560, y: 408 }];
		for (let visit = 0; visit < 30; visit++) {
			const routine = getShelterRoutine({ ...input, decorations: props, reservedTargets, visit })!;
			expect(routine).not.toBeNull();
			for (const reserved of reservedTargets) expect(distance(routine.point, reserved)).toBeGreaterThanOrEqual(18);
			let previous = input.from;
			for (const end of getShelterWalkingRoute(input.from, routine.point, sites, buildings)) {
				const steps = Math.max(1, Math.ceil(distance(previous, end)));
				for (let step = 0; step <= steps; step++) {
					const point = { x: previous.x + (end.x - previous.x) * step / steps, y: previous.y + (end.y - previous.y) * step / steps };
					for (const decoration of props.filter((item) => item.kind !== "gate")) expect(distance(point, decoration.point)).toBeGreaterThanOrEqual(decoration.radius + 2.9);
				}
				previous = end;
			}
		}
	});

	test("restored chores rebuild tools and cargo from current scenery and reject a missing worksite", () => {
		const props = [...decorations, prop("woodpile", 440, 470, 17)];
		for (const activity of ["carry", "sweep", "maintain"] as const) {
			const visit = Array.from({ length: 30 }, (_, index) => index).find((index) => getShelterRoutine({ ...input, decorations: props, visit: index })?.activity === activity)!;
			const routine = getShelterRoutine({ ...input, decorations: props, visit })!;
			const saved = { ...routine, label: "Invented bonus", cargo: "money", dwellMs: Number.POSITIVE_INFINITY };
			const restored = restoreShelterRoutine({ ...input, decorations: props, visit, from: routine.point }, saved);
			expect(restored).toEqual(routine);
			if (activity !== "sweep") {
				const remaining = props.filter((decoration) => distance(decoration.point, routine.lookAt!) > .01);
				expect(restoreShelterRoutine({ ...input, decorations: remaining, visit, from: routine.point }, saved)).toBeNull();
			}
			const blocked = prop("tree", routine.point.x, routine.point.y, 12);
			expect(restoreShelterRoutine({ ...input, decorations: [...props, blocked], visit, from: routine.point }, saved)).toBeNull();
		}
	});

	test("the generated starting yard supports chores over successive walks, without synthetic furniture", () => {
		const land = Array.from({ length: 12 }, (_, index) => ({ column: index % 4, row: Math.floor(index / 4) }));
		const rooms: ShelterLayoutBuilding[] = Array.from({ length: 4 }, (_, column) => ({ column, row: 0, width: 1, height: 1, position: { x: 40 + column * 192, y: 148 }, facing: 0 }));
		const scenery = getShelterLandscape(land, rooms);
		for (const [index, personality] of ["veteran", "collector", "runner"].entries()) {
			let from = { x: 126 + index * 192, y: 346 };
			const activities = new Set<string>();
			for (let visit = 0; visit < 32; visit++) {
				const routine = getShelterRoutine({ ...input, scavId: `resident-${index}`, personality, sites: land, buildings: rooms, decorations: scenery.decorations, from, visit });
				expect(routine).not.toBeNull();
				expectOpen(routine!.point, land, rooms);
				expectRouteOnGround(from, routine!.point, land, rooms);
				activities.add(routine!.activity); from = routine!.point;
			}
			for (const chore of ["carry", "sweep", "maintain"]) expect(activities.has(chore)).toBe(true);
			expect(activities.size).toBeGreaterThanOrEqual(6);
		}
	});
});
