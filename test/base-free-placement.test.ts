import { describe, expect, test } from "bun:test";
import {
	advance, assignWorker, buildRoom, constructRoom, createGame, getFreeBuildRoomQuote,
	getRoomBounds, getRoomFreePlacementReason, getRoomPosition, getRoomSites,
	getShelterRoomAtPoint, moveRoom, parseSave, placeRoom, queueModuleProduction,
	rotateRoom, saveGame, setRoomRecipe, setRoomStockTarget, upgradeRoom,
	type GameState,
} from "../src/game/engine";

const NOW = 1_792_000_000_000;
function funded(level = 1): GameState {
	const state = createGame(NOW);
	state.level = level; state.xp = (level - 1) ** 2 * 90;
	state.money = 20_000; state.supplies = { ammo: 100, medicine: 0, scrap: 200, intel: 20 };
	return state;
}
const restored = (state: GameState) => { const copy = parseSave(saveGame(state)); expect(copy).not.toBeNull(); return copy!; };

describe("continuous ground placement", () => {
	test("fractional movement is exact, free, and previews never mutate state", () => {
		const state = funded(), room = state.shelter.rooms[0]!, original = structuredClone(room), before = saveGame(state);
		expect(getRoomPosition(room)).toEqual({ x: 40, y: 148 });
		expect(getRoomBounds(room)).toEqual({ x: 40, y: 148, width: 172, height: 100 });
		expect(getRoomFreePlacementReason(state, room.id, 89.375, 301.625)).toBeNull();
		expect(saveGame(state)).toBe(before);
		expect(placeRoom(state, room.id, 89.375, 301.625, NOW).ok).toBe(true);
		expect(room).toEqual({ ...original, column: 0, row: 1, position: { x: 89.375, y: 301.625 } });
		expect(state.money).toBe(20_000); expect(state.supplies.scrap).toBe(200);
		expect(getRoomSites(room)).toEqual([{ column: 0, row: 1 }, { column: 1, row: 1 }, { column: 0, row: 2 }, { column: 1, row: 2 }]);
		expect(restored(state)).toEqual(state);
		expect(moveRoom(state, room.id, 3, 2, NOW).ok).toBe(true);
		expect(room.position).toBeUndefined(); expect(getRoomPosition(room)).toEqual({ x: 616, y: 412 });
	});

	test("separate rectangles can share land lots, and selecting a gap selects no building", () => {
		const state = funded();
		expect(constructRoom(state, "ammo", 80.125, 290.75, NOW).ok).toBe(true);
		expect(constructRoom(state, "recycler", 270.125, 290.75, NOW).ok).toBe(true);
		const [first, second] = state.shelter.rooms.slice(-2);
		expect(getRoomSites(first!)).toContainEqual({ column: 1, row: 1 });
		expect(getRoomSites(second!)).toContainEqual({ column: 1, row: 1 });
		expect(getShelterRoomAtPoint(state.shelter, 81, 291)).toBe(first);
		expect(getShelterRoomAtPoint(state.shelter, 280, 350)).toBe(second);
		expect(getShelterRoomAtPoint(state.shelter, 260, 350)).toBeUndefined();
		expect(getShelterRoomAtPoint(state.shelter, 252.125, 350)).toBeUndefined();
		expect(restored(state)).toEqual(state);
	});

	test("collisions use rectangle clearance, reject overlap, and accept exactly eight pixels", () => {
		const state = funded(), room = state.shelter.rooms[0]!;
		expect(placeRoom(state, room.id, 80, 290, NOW).ok).toBe(true);
		expect(getFreeBuildRoomQuote(state, "ammo", 259.999, 290).reason).not.toBeNull();
		expect(getFreeBuildRoomQuote(state, "ammo", 260, 290).reason).toBeNull();
		expect(getFreeBuildRoomQuote(state, "ammo", 83, 300).reason).not.toBeNull();
		expect(getFreeBuildRoomQuote(state, "ammo", 80, 398).reason).toBeNull();
		const before = saveGame(state);
		expect(constructRoom(state, "ammo", 259.999, 290, NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
	});

	test("entire footprint stays on completed owned land, including holes and the gate opening", () => {
		const state = funded(4);
		state.shelter.sites.push({ column: 0, row: 3 }, { column: 2, row: 3 });
		expect(getFreeBuildRoomQuote(state, "hangar", 40, 380).reason).not.toBeNull();
		state.shelter.sites.push({ column: 1, row: 3 });
		expect(getFreeBuildRoomQuote(state, "hangar", 40, 380).reason).toBeNull();
		expect(getRoomFreePlacementReason(state, state.shelter.rooms[1]!.id, 280, 132)).toContain("вход");
		expect(getFreeBuildRoomQuote(state, "ammo", 29.999, 300).reason).not.toBeNull();
		expect(getFreeBuildRoomQuote(state, "ammo", 30, 300).reason).toBeNull();
		expect(getFreeBuildRoomQuote(state, "ammo", 626, 400).reason).toBeNull();
		expect(getFreeBuildRoomQuote(state, "ammo", 626.001, 400).reason).not.toBeNull();
		state.shelter.expansions.push({ column: 4, row: 1, workDone: 0, workRequired: 20_000_000, cost: { money: 60, scrap: 2 } });
		expect(getFreeBuildRoomQuote(state, "ammo", 710, 290).reason).not.toBeNull();
	});

	test("a working production room keeps paid progress, workers, repeat policy and stock targets", () => {
		const state = funded(), room = state.shelter.rooms[1]!, worker = state.scavs[0]!;
		expect(assignWorker(state, worker.id, room.id, NOW).ok).toBe(true);
		expect(setRoomRecipe(state, room.id, "medicine-batch", true, NOW).ok).toBe(true);
		expect(setRoomStockTarget(state, room.id, 9, NOW).ok).toBe(true);
		advance(state, NOW + 1000); const oldRoom = structuredClone(room), control = restored(state);
		expect(oldRoom.queue[0]!.workDone).toBeGreaterThan(0);
		expect(placeRoom(state, room.id, 372.25, 360.125, state.lastUpdated).ok).toBe(true);
		expect(room).toEqual({ ...oldRoom, column: 1, row: 1, position: { x: 372.25, y: 360.125 } });
		expect(worker.assignment).toBe(room.id); expect(restored(state)).toEqual(state);
		advance(state, NOW + 200_000); advance(control, NOW + 200_000);
		delete room.position; room.column = oldRoom.column; room.row = oldRoom.row;
		expect(state).toEqual(control);
	});

	test("unready rooms and malformed positions cannot move or spend", () => {
		const state = funded(); expect(constructRoom(state, "ammo", 85.5, 320.25, NOW).ok).toBe(true);
		const building = state.shelter.rooms.at(-1)!; let before = saveGame(state);
		expect(placeRoom(state, building.id, 400.75, 340.25, NOW).ok).toBe(false); expect(saveGame(state)).toBe(before);
		advance(state, NOW + 60_000); expect(upgradeRoom(state, building.id, state.lastUpdated).ok).toBe(true);
		before = saveGame(state); expect(placeRoom(state, building.id, 400.75, 340.25, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		const ready = state.shelter.rooms[0]!;
		for (const [x, y] of [[NaN, 300], [Infinity, 300], [90, NaN], [90, Infinity], [30_001, 300], [90, -1]]) {
			expect(placeRoom(state, ready.id, x!, y!, state.lastUpdated).ok).toBe(false);
			expect(constructRoom(state, "ammo", x!, y!, state.lastUpdated).ok).toBe(false);
		}
		for (const rotation of [NaN, 2, .5, null]) expect(placeRoom(state, ready.id, 500, 350, state.lastUpdated, rotation as 0).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
	});

	test("free large buildings rotate around their exact origin and preserve their construction charge", () => {
		const state = funded(4);
		state.shelter.sites.push({ column: 0, row: 3 }, { column: 1, row: 3 }, { column: 2, row: 3 });
		expect(constructRoom(state, "hangar", 40.25, 290.125, NOW).ok).toBe(true);
		const room = state.shelter.rooms.at(-1)!;
		expect(getRoomBounds(room)).toEqual({ x: 40.25, y: 290.125, width: 556, height: 232 });
		expect(room.construction!.cost).toEqual({ money: 900, scrap: 30 });
		advance(state, NOW + 180_000);
		expect(rotateRoom(state, room.id, state.lastUpdated).ok).toBe(true);
		expect(getRoomBounds(room)).toEqual({ x: 40.25, y: 290.125, width: 364, height: 364 });
		expect(getRoomPosition(room)).toEqual({ x: 40.25, y: 290.125 }); expect(restored(state)).toEqual(state);
	});
});

describe("continuous save integrity and migration", () => {
	test("v20 saves preserve old grid placement and every paid job and construction field", () => {
		const state = funded();
		expect(assignWorker(state, state.scavs[0]!.id, "room-workshop", NOW).ok).toBe(true);
		expect(queueModuleProduction(state, "room-workshop", "factory-sks-stock", NOW).ok).toBe(true);
		expect(buildRoom(state, "ammo", 2, 2, NOW).ok).toBe(true); advance(state, NOW + 1000);
		const raw = JSON.parse(saveGame(state)); raw.schemaVersion = 20;
		const copy = parseSave(JSON.stringify(raw))!; expect(copy).toEqual(state);
		for (const room of copy.shelter.rooms) expect(room.position).toBeUndefined();
		expect(getRoomPosition(copy.shelter.rooms.at(-1)!)).toEqual({ x: 424, y: 412 });
		expect(copy.shelter.rooms.at(-1)!.construction).toEqual(state.shelter.rooms.at(-1)!.construction);
	});

	test("forged coordinates, lot metadata, unknown fields, holes, overlaps and blocked gate reject", () => {
		const state = funded(); expect(placeRoom(state, "room-workshop", 89.375, 301.625, NOW).ok).toBe(true);
		const mutations: ((value: any) => void)[] = [
			value => { value.shelter.rooms[0].position = null; },
			value => { value.shelter.rooms[0].position.x = "90"; },
			value => { value.shelter.rooms[0].position.y = -1; },
			value => { value.shelter.rooms[0].position.x = 30_001; },
			value => { value.shelter.rooms[0].position.z = 0; },
			value => { value.shelter.rooms[0].column = 1; },
			value => { value.shelter.rooms[0].row = 2; },
			value => { value.shelter.rooms[0].position = { x: 710, y: 300 }; value.shelter.rooms[0].column = 3; },
			value => { value.shelter.rooms[0].position = { x: 232, y: 148 }; value.shelter.rooms[0].column = 1; value.shelter.rooms[0].row = 0; },
			value => { value.shelter.rooms[0].position = { x: 280, y: 132 }; value.shelter.rooms[0].column = 1; value.shelter.rooms[0].row = 0; },
			value => { value.schemaVersion = 20; },
		];
		for (const mutate of mutations) { const raw = JSON.parse(saveGame(state)); mutate(raw); expect(parseSave(JSON.stringify(raw))).toBeNull(); }
		expect(restored(state)).toEqual(state);
	});
});
