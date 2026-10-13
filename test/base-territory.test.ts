import { fundConstructionLoot } from './loot-material-fixture';
import { describe, expect, test } from "bun:test";
import {
	advance, assignWorker, buildRoom, createGame, excavateShelter, getBuildRoomQuote,
	getExcavationQuote, getModuleCapacity, getRoomFootprint, getRoomPlacementReason,
	getRoomSites, getShelterRoomAt, getStorageCapacity, getSupplyCapacity, moveRoom,
	parseSave, queueModuleProduction, rotateRoom, saveGame, setRoomRecipe, setRoomStockTarget,
	upgradeRoom, type GameState,
} from "../src/game/engine";

const NOW = 1_792_000_000_000;
function funded(level = 1): GameState {
	const state = createGame(NOW);
	state.level = level; state.xp = (level - 1) ** 2 * 90;
	state.money = 20_000;
	state.supplies = { ammo: 100, medicine: 0, scrap: 200, intel: 20 };
	return fundConstructionLoot(state);
}
function restored(state: GameState): GameState {
	const copy = parseSave(saveGame(state)); expect(copy).not.toBeNull(); return copy!;
}
function hangar(state: GameState) { return state.shelter.rooms.find(room => room.type === "hangar")!; }
function addThirdRow(state: GameState) {
	for (const column of [0, 1]) expect(excavateShelter(state, column, 3, state.lastUpdated).ok).toBe(true);
	advance(state, state.lastUpdated + 20_000);
}

describe("free placement on expandable base territory", () => {
	test("compact foundation structures move freely and all previews are pure", () => {
		const state = funded(), room = state.shelter.rooms[0]!, before = saveGame(state);
		expect(getRoomFootprint(room)).toEqual({ width: 1, height: 1 });
		expect(getRoomPlacementReason(state, room.id, 3, 2)).toBeNull();
		expect(getRoomPlacementReason(state, room.id, room.column, room.row)).toBeNull();
		expect(getRoomPlacementReason(state, room.id, 1, 0)).not.toBeNull();
		expect(getRoomPlacementReason(state, room.id, 4, 2)).not.toBeNull();
		expect(getRoomPlacementReason(state, room.id, 0, -1)).not.toBeNull();
		expect(getRoomPlacementReason(state, "unknown", 0, 1)).not.toBeNull();
		expect(saveGame(state)).toBe(before);
		const original = structuredClone(room), money = state.money, supplies = { ...state.supplies };
		expect(moveRoom(state, room.id, 3, 2, NOW).ok).toBe(true);
		expect(room).toEqual({ ...original, column: 3, row: 2 });
		expect(state.money).toBe(money); expect(state.supplies).toEqual(supplies);
		expect(getShelterRoomAt(state.shelter, 0, 0)).toBeUndefined();
		expect(getShelterRoomAt(state.shelter, 3, 2)).toBe(room);
		expect(restored(state)).toEqual(state);
	});

	test("moving busy production keeps workers, job identity, progress, recipe and targets", () => {
		const state = funded(), room = state.shelter.rooms.find(room => room.type === "medbay")!, worker = state.scavs[0]!;
		expect(assignWorker(state, worker.id, room.id, NOW).ok).toBe(true);
		expect(setRoomRecipe(state, room.id, "medicine-batch", true, NOW).ok).toBe(true);
		expect(setRoomStockTarget(state, room.id, 9, NOW).ok).toBe(true);
		advance(state, NOW + 5000);
		const control = restored(state), original = structuredClone(room);
		expect(room.queue[0]!.workDone).toBeGreaterThan(0);
		expect(moveRoom(state, room.id, 3, 2, state.lastUpdated).ok).toBe(true);
		expect(room).toEqual({ ...original, column: 3, row: 2 });
		expect(worker.assignment).toBe(room.id);
		expect(restored(state)).toEqual(state);
		advance(state, NOW + 200_000); advance(control, NOW + 200_000);
		const moved = state.shelter.rooms.find(value => value.id === room.id)!;
		moved.column = original.column; moved.row = original.row;
		expect(state).toEqual(control);
	});

	test("moving a paid module queue keeps its output ownership and completes exactly once", () => {
		const state = funded(), room = state.shelter.rooms[0]!, worker = state.scavs[0]!, count = state.modules.length;
		expect(assignWorker(state, worker.id, room.id, NOW).ok).toBe(true);
		expect(queueModuleProduction(state, room.id, "factory-sks-stock", NOW).ok).toBe(true);
		advance(state, NOW + 1000);
		const jobId = room.queue[0]!.id, progress = room.queue[0]!.workDone;
		expect(moveRoom(state, room.id, 0, 2, state.lastUpdated).ok).toBe(true);
		expect(room.queue[0]!.id).toBe(jobId); expect(room.queue[0]!.workDone).toBe(progress);
		const copy = restored(state); advance(copy, NOW + 600_000);
		expect(copy.modules).toHaveLength(count + 1);
		expect(copy.shelter.rooms.find(value => value.id === room.id)!.cycles).toBe(1);
		advance(copy, copy.lastUpdated); expect(copy.modules).toHaveLength(count + 1);
	});

	test("new building identity survives a move and rebuilding its vacated site cannot collide", () => {
		const state = funded();
		expect(buildRoom(state, "ammo", 0, 1, NOW).ok).toBe(true);
		advance(state, NOW + 60_000);
		const original = getShelterRoomAt(state.shelter, 0, 1)!;
		expect(moveRoom(state, original.id, 3, 2, state.lastUpdated).ok).toBe(true);
		expect(buildRoom(state, "recycler", 0, 1, state.lastUpdated).ok).toBe(true);
		expect(getShelterRoomAt(state.shelter, 0, 1)!.id).not.toBe(original.id);
		expect(original.id).toMatch(/^room-[1-9]\d*$/);
		expect(restored(state)).toEqual(state);
	});

	test("unfinished structures, occupied ground, street coordinates and malformed rotations reject without payment", () => {
		const state = funded(); expect(buildRoom(state, "ammo", 0, 1, NOW).ok).toBe(true);
		const room = getShelterRoomAt(state.shelter, 0, 1)!;
		let before = saveGame(state);
		expect(moveRoom(state, room.id, 0, 2, NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		advance(state, NOW + 60_000); expect(upgradeRoom(state, room.id, state.lastUpdated).ok).toBe(true);
		before = saveGame(state); expect(moveRoom(state, room.id, 0, 2, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		const ready = state.shelter.rooms[0]!;
		for (const [column, row] of [[1, 0], [4, 2], [0, -1], [0.5, 2], [129, 0], [0, NaN]]) expect(moveRoom(state, ready.id, column!, row!, state.lastUpdated).ok).toBe(false);
		for (const rotation of [-1, 2, .5, null]) expect(moveRoom(state, ready.id, 3, 2, state.lastUpdated, rotation as 0).ok).toBe(false);
		for (const now of [NaN, Infinity, -1]) expect(moveRoom(state, ready.id, 3, 2, now).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
	});

	test("the future hangar unlocks at level four, occupies six sites and adds storage after construction", () => {
		const locked = funded(3), before = saveGame(locked);
		expect(getBuildRoomQuote(locked, "hangar", 0, 1).reason).toContain("4");
		expect(buildRoom(locked, "hangar", 0, 1, NOW).ok).toBe(false); expect(saveGame(locked)).toBe(before);
		const state = funded(4), guns = getStorageCapacity(state), modules = getModuleCapacity(state), supplies = getSupplyCapacity(state);
		expect(getBuildRoomQuote(state, "hangar", 0, 1)).toMatchObject({ money: 900, scrap: 30, duration: 180, reason: null });
		expect(buildRoom(state, "hangar", 0, 1, NOW).ok).toBe(true);
		expect(state.money).toBe(19_100); expect(state.supplies.scrap).toBe(170);
		const room = hangar(state); expect(getRoomSites(room)).toHaveLength(6);
		for (const site of getRoomSites(room)) expect(getShelterRoomAt(state.shelter, site.column, site.row)).toBe(room);
		expect(getBuildRoomQuote(state, "ammo", 2, 2).reason).not.toBeNull();
		expect(getStorageCapacity(state)).toBe(guns); expect(getModuleCapacity(state)).toBe(modules);
		expect(restored(state)).toEqual(state);
		advance(state, NOW + 180_000);
		expect(getStorageCapacity(state)).toBe(guns + 18); expect(getModuleCapacity(state)).toBe(modules + 48);
		expect(getSupplyCapacity(state)).toEqual({ ammo: supplies.ammo + 120, medicine: supplies.medicine + 16, scrap: supplies.scrap + 60, intel: supplies.intel + 16 });
		expect(restored(state)).toEqual(state);
	});

	test("large footprints require owned sites and cannot overlap a compact structure at a non-origin cell", () => {
		const state = funded(4);
		expect(getBuildRoomQuote(state, "hangar", 2, 1).reason).not.toBeNull();
		expect(getBuildRoomQuote(state, "hangar", 0, 1, 1).reason).not.toBeNull();
		expect(buildRoom(state, "ammo", 2, 2, NOW).ok).toBe(true);
		expect(getBuildRoomQuote(state, "hangar", 0, 1).reason).not.toBeNull();
		advance(state, NOW + 60_000);
		expect(moveRoom(state, getShelterRoomAt(state.shelter, 2, 2)!.id, 3, 1, state.lastUpdated).ok).toBe(true);
		expect(buildRoom(state, "hangar", 0, 1, state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated + 180_000);
		expect(getRoomPlacementReason(state, hangar(state).id, 1, 1)).not.toBeNull();
		expect(getRoomPlacementReason(state, state.shelter.rooms[0]!.id, 2, 2)).not.toBeNull();
		const before = saveGame(state); expect(moveRoom(state, hangar(state).id, 1, 1, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
	});

	test("paid expansion creates room for a rotation and rotation never consumes or loses structure state", () => {
		const state = funded(4); expect(buildRoom(state, "hangar", 0, 1, NOW).ok).toBe(true);
		advance(state, NOW + 180_000); const room = hangar(state), original = structuredClone(room);
		const before = saveGame(state); expect(rotateRoom(state, room.id, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		expect(getExcavationQuote(state, 0, 3)).toEqual({ money: 60, scrap: 2, duration: 20, reason: null });
		addThirdRow(state);
		const money = state.money, supplies = { ...state.supplies };
		expect(rotateRoom(state, room.id, state.lastUpdated).ok).toBe(true);
		expect(getRoomFootprint(room)).toEqual({ width: 2, height: 3 });
		expect(room).toEqual({ ...original, rotation: 1 });
		expect(getShelterRoomAt(state.shelter, 2, 2)).toBeUndefined();
		expect(getShelterRoomAt(state.shelter, 1, 3)).toBe(room);
		expect(state.money).toBe(money); expect(state.supplies).toEqual(supplies);
		expect(restored(state)).toEqual(state);
		expect(rotateRoom(state, room.id, state.lastUpdated).ok).toBe(true);
		expect(getRoomFootprint(room)).toEqual({ width: 3, height: 2 });
	});

	test("rotation plus relocation is atomic, respects collisions, and accepts rotated construction", () => {
		const state = funded(4); addThirdRow(state);
		expect(buildRoom(state, "hangar", 0, 1, state.lastUpdated, 1).ok).toBe(true);
		const room = hangar(state); expect(room.rotation).toBe(1);
		advance(state, state.lastUpdated + 180_000);
		expect(buildRoom(state, "ammo", 2, 2, state.lastUpdated).ok).toBe(true);
		const before = saveGame(state);
		expect(moveRoom(state, room.id, 0, 1, state.lastUpdated, 0).ok).toBe(false);
		expect(saveGame(state)).toBe(before); expect(room.rotation).toBe(1);
		advance(state, state.lastUpdated + 60_000);
		expect(moveRoom(state, getShelterRoomAt(state.shelter, 2, 2)!.id, 3, 0, state.lastUpdated).ok).toBe(false);
		expect(moveRoom(state, getShelterRoomAt(state.shelter, 2, 2)!.id, 3, 2, state.lastUpdated).ok).toBe(true);
		expect(moveRoom(state, room.id, 0, 1, state.lastUpdated, 0).ok).toBe(true);
		expect(room.rotation).toBe(0); expect(restored(state)).toEqual(state);
	});
});

describe("territory save migrations and integrity", () => {
	test("v18 coordinate ids migrate without changing and remain valid after movement", () => {
		const state = funded(); expect(buildRoom(state, "ammo", 0, 1, NOW).ok).toBe(true);
		advance(state, NOW + 60_000);
		const raw = JSON.parse(saveGame(state)); raw.schemaVersion = 18;
		raw.shelter.rooms.find((room: { type: string }) => room.type === "ammo").id = "room-0-1";
		const migrated = parseSave(JSON.stringify(raw)); expect(migrated).not.toBeNull();
		const room = getShelterRoomAt(migrated!.shelter, 0, 1)!; expect(room.id).toBe("room-0-1");
		expect(moveRoom(migrated!, room.id, 3, 2, migrated!.lastUpdated).ok).toBe(true);
		expect(buildRoom(migrated!, "ammo", 0, 1, migrated!.lastUpdated).ok).toBe(true);
		expect(restored(migrated!)).toEqual(migrated!);
		expect(getShelterRoomAt(restored(migrated!).shelter, 3, 2)!.id).toBe("room-0-1");
	});

	test("forged footprints, rotations, IDs, unlocks and unpaid large construction reject", () => {
		const state = funded(4); expect(buildRoom(state, "hangar", 0, 1, NOW).ok).toBe(true);
		const mutations: ((value: any) => void)[] = [
			value => { value.shelter.rooms.at(-1).column = 2; },
			value => { value.shelter.rooms.at(-1).row = 0; },
			value => { value.shelter.rooms.at(-1).rotation = 1; },
			value => { value.shelter.rooms.at(-1).rotation = -1; },
			value => { value.shelter.rooms.at(-1).rotation = 2; },
			value => { value.shelter.rooms.at(-1).rotation = .5; },
			value => { value.shelter.rooms.at(-1).rotation = "1"; },
			value => { value.shelter.rooms.at(-1).footprint = { width: 1, height: 1 }; },
			value => { value.shelter.rooms.at(-1).construction.cost.money = 0; },
			value => { value.shelter.rooms.at(-1).construction.cost.scrap = 1; },
			value => { value.shelter.rooms.at(-1).construction.workRequired = 1; },
			value => { value.level = 3; value.xp = 360; },
			value => { value.shelter.rooms.at(-1).id = `room-${value.nextId}`; },
			value => { value.shelter.rooms.at(-1).id = "room--129-0"; },
			value => { value.shelter.rooms.at(-1).id = "room-00-1"; },
			value => { value.shelter.rooms.at(-1).id = "forged-id"; },
			value => { value.shelter.rooms.at(-1).id = "room-hangar"; },
			value => { value.schemaVersion = 18; value.shelter.rooms.at(-1).id = "room-0-1"; },
		];
		for (const mutate of mutations) { const raw = JSON.parse(saveGame(state)); mutate(raw); expect(parseSave(JSON.stringify(raw))).toBeNull(); }
		expect(restored(state)).toEqual(state);
	});
});
