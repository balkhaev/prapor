import { describe, expect, test } from "bun:test";
import {
	advance, assignWorker, constructRoom, createGame, faceRoom, getFreeBuildRoomQuote,
	getRoomBounds, getRoomEntrance, getRoomFacing, getRoomFootprint, getRoomFreePlacementReason,
	getRoomLocalPoint, getRoomLocalSize, getRoomPosition, moveRoom, parseSave, placeRoom,
	queueModuleProduction, rotateRoom, saveGame, SAVE_VERSION,
	type GameState, type RoomFacing,
} from "../src/game/engine";
import { fundConstructionLoot } from "./loot-material-fixture";

const NOW = 1_792_000_000_000;
function funded(): GameState {
	const state = createGame(NOW);
	state.level = 4; state.xp = 810; state.money = 20_000;
	state.supplies = { ammo: 100, medicine: 0, scrap: 200, intel: 20 };
	return fundConstructionLoot(state);
}
function restored(state: GameState) {
	const result = parseSave(saveGame(state)); expect(result).not.toBeNull(); return result!;
}

describe("four-direction building facing", () => {
	test("the whole physical rectangle, local geometry and entrance turn around the same origin", () => {
		const room = { ...funded().shelter.rooms[0]!, position: { x: 89.375, y: 301.625 } };
		expect(getRoomFacing(room)).toBe(0); expect(getRoomLocalSize(room)).toEqual({ width: 172, height: 100 });
		const expected = [
			{ size: { width: 172, height: 100 }, door: { x: 175.375, y: 401.625 }, approach: { x: 175.375, y: 417.625 }, corner: { x: 89.375, y: 301.625 } },
			{ size: { width: 100, height: 172 }, door: { x: 89.375, y: 387.625 }, approach: { x: 73.375, y: 387.625 }, corner: { x: 189.375, y: 301.625 } },
			{ size: { width: 172, height: 100 }, door: { x: 175.375, y: 301.625 }, approach: { x: 175.375, y: 285.625 }, corner: { x: 261.375, y: 401.625 } },
			{ size: { width: 100, height: 172 }, door: { x: 189.375, y: 387.625 }, approach: { x: 205.375, y: 387.625 }, corner: { x: 89.375, y: 473.625 } },
		];
		for (const facing of [0, 1, 2, 3] as const) {
			const turned = { ...room, facing }, geometry = expected[facing]!;
			expect(getRoomBounds(turned)).toEqual({ ...room.position, ...geometry.size });
			expect(getRoomEntrance(turned)).toEqual(geometry.door);
			expect(getRoomEntrance(turned, 16)).toEqual(geometry.approach);
			expect(getRoomLocalPoint(turned, 0, 0)).toEqual(geometry.corner);
		}
	});

	test("facing preserves exact fractional coordinates, paid queues, workers and resources in every direction", () => {
		const state = funded(), room = state.shelter.rooms[0]!, worker = state.scavs[0]!;
		expect(assignWorker(state, worker.id, room.id, NOW).ok).toBe(true);
		expect(queueModuleProduction(state, room.id, "factory-sks-stock", NOW).ok).toBe(true);
		advance(state, NOW + 1000);
		expect(placeRoom(state, room.id, 89.375, 301.625, state.lastUpdated).ok).toBe(true);
		const baseline = structuredClone(room), money = state.money, supplies = { ...state.supplies }, trophies = structuredClone(state.lootItems);
		for (const facing of [1, 2, 3, 0] as const) {
			const before = saveGame(state);
			expect(getRoomFreePlacementReason(state, room.id, 89.375, 301.625, undefined, facing)).toBeNull();
			expect(saveGame(state)).toBe(before);
			expect(faceRoom(state, room.id, facing, state.lastUpdated).ok).toBe(true);
			expect(room).toEqual({ ...baseline, facing });
			expect(worker.assignment).toBe(room.id);
			expect(state.money).toBe(money); expect(state.supplies).toEqual(supplies); expect(state.lootItems).toEqual(trophies);
			expect(restored(state)).toEqual(state);
		}
		const modules = state.modules.length;
		advance(state, NOW + 600_000); expect(state.modules.length).toBe(modules + 1);
		expect(room.queue).toHaveLength(0); expect(room.cycles).toBe(1);
	});

	test("turning checks the resulting rectangle, completed land, clearance and readiness before mutating", () => {
		const state = funded(), room = state.shelter.rooms[0]!;
		expect(placeRoom(state, room.id, 400.25, 300.5, NOW, 0, 1).ok).toBe(true);
		expect(constructRoom(state, "ammo", 512.5, 300.5, NOW, 0, 1).ok).toBe(true);
		const before = saveGame(state);
		expect(getRoomFreePlacementReason(state, room.id, 400.25, 300.5, 0, 0)).toContain("другая постройка");
		expect(faceRoom(state, room.id, 0, NOW + 1000).ok).toBe(false);
		expect(faceRoom(state, state.shelter.rooms.at(-1)!.id, 2, NOW + 1000).ok).toBe(false);
		expect(faceRoom(state, "missing", 0, NOW + 1000).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		const border = funded(), edge = border.shelter.rooms[0]!;
		expect(placeRoom(border, edge.id, 80, 552, NOW, 0, 0).ok).toBe(true);
		const edgeBefore = saveGame(border);
		expect(faceRoom(border, edge.id, 1, NOW + 1000).ok).toBe(false); expect(saveGame(border)).toBe(edgeBefore);
	});

	test("native construction receives the chosen facing and consumes physical inputs exactly once", () => {
		for (const facing of [0, 1, 2, 3] as const) {
			const state = funded(), quote = getFreeBuildRoomQuote(state, "ammo", 270.125, 290.75, 0, facing);
			expect(quote.reason).toBeNull();
			const inputs = state.lootItems!.filter(item => quote.lootItemIds.includes(item.id)), money = state.money;
			expect(constructRoom(state, "ammo", 270.125, 290.75, NOW, 0, facing).ok).toBe(true);
			const room = state.shelter.rooms.at(-1)!;
			expect(getRoomFacing(room)).toBe(facing); expect(room.position).toEqual({ x: 270.125, y: 290.75 });
			expect(room.construction!.paidLoot).toEqual(inputs); expect(state.money).toBe(money - quote.money);
			expect(state.lootItems!.some(item => quote.lootItemIds.includes(item.id))).toBe(false);
			expect(restored(state)).toEqual(state);
		}
	});

	test("large structures use their native proportions in all four directions without altering legacy rotation", () => {
		const state = funded();
		for (const row of [4, 5]) for (const column of [0, 1, 2, 3]) state.shelter.sites.push({ column, row });
		expect(constructRoom(state, "hangar", 40.25, 280.125, NOW, 0, 0).ok).toBe(true);
		advance(state, NOW + 180_000);
		const room = state.shelter.rooms.at(-1)!, baseline = structuredClone(room), money = state.money, supplies = { ...state.supplies };
		for (const facing of [1, 2, 3, 0] as const) {
			expect(faceRoom(state, room.id, facing, state.lastUpdated).ok).toBe(true);
			expect(getRoomBounds(room)).toEqual({ x: 40.25, y: 280.125, ...(facing % 2 ? { width: 232, height: 556 } : { width: 556, height: 232 }) });
			expect(getRoomFootprint(room)).toEqual({ width: 3, height: 2 });
			expect(room).toEqual({ ...baseline, facing });
			expect(state.money).toBe(money); expect(state.supplies).toEqual(supplies); expect(restored(state)).toEqual(state);
		}
	});

	test("unfunded or malformed facing intents cannot advance production, spend or consume materials", () => {
		const state = funded(), room = state.shelter.rooms[0]!, worker = state.scavs[0]!;
		expect(assignWorker(state, worker.id, room.id, NOW).ok).toBe(true);
		expect(queueModuleProduction(state, room.id, "factory-sks-stock", NOW).ok).toBe(true);
		const before = saveGame(state);
		for (const facing of [-1, .5, 4, NaN, Infinity, "1", null] as unknown as RoomFacing[]) {
			expect(faceRoom(state, room.id, facing, NOW + 1000).ok).toBe(false);
			expect(placeRoom(state, room.id, 89.375, 301.625, NOW + 1000, 0, facing).ok).toBe(false);
			expect(constructRoom(state, "ammo", 270.125, 290.75, NOW + 1000, 0, facing).ok).toBe(false);
			expect(saveGame(state)).toBe(before);
		}
		for (const missing of ["money", "scrap", "loot"] as const) {
			const unfunded = funded();
			if (missing === "money") unfunded.money = 0;
			else if (missing === "scrap") unfunded.supplies.scrap = 0;
			else unfunded.lootItems = [];
			const unpaid = saveGame(unfunded);
			expect(constructRoom(unfunded, "ammo", 270.125, 290.75, NOW + 1000, 0, 3).ok).toBe(false);
			expect(saveGame(unfunded)).toBe(unpaid);
		}
		state.money = 0; state.lootItems = [];
		expect(placeRoom(state, room.id, 89.375, 301.625, NOW, 0, 3).ok).toBe(true);
		expect(faceRoom(state, room.id, 2, NOW).ok).toBe(true);
	});

	test("ordinary and legacy moves preserve facing, and old footprint rotation remains compatible", () => {
		const state = funded(), room = state.shelter.rooms[0]!;
		expect(placeRoom(state, room.id, 89.375, 301.625, NOW, 0, 3).ok).toBe(true);
		expect(placeRoom(state, room.id, 280.125, 290.75, NOW).ok).toBe(true); expect(room.facing).toBe(3);
		expect(moveRoom(state, room.id, 0, 1, NOW).ok).toBe(true); expect(room.facing).toBe(3);
		expect(getRoomPosition(room)).toEqual({ x: 40, y: 280 });
		const large = { ...room, type: "hangar" as const, facing: 0 as const, rotation: 1 as const };
		expect(getRoomFootprint(large)).toEqual({ width: 2, height: 3 });
		expect(getRoomLocalSize(large)).toEqual({ width: 364, height: 364 });
		expect(getRoomBounds(large)).toEqual({ x: 40, y: 280, width: 364, height: 364 });
		expect(rotateRoom(state, room.id, NOW).ok).toBe(false); expect(room.facing).toBe(3);
		expect(restored(state)).toEqual(state);
	});

	test("version 22 positions and paid construction migrate unchanged; facing is strictly version 23", () => {
		const state = funded();
		expect(placeRoom(state, "room-workshop", 89.375, 301.625, NOW).ok).toBe(true);
		expect(constructRoom(state, "ammo", 270.125, 290.75, NOW).ok).toBe(true);
		const old = JSON.parse(saveGame(state)); old.schemaVersion = 22;
		const migrated = parseSave(JSON.stringify(old)); expect(migrated).not.toBeNull();
		expect(migrated).toEqual({ ...state, schemaVersion: SAVE_VERSION });
		expect(getRoomFacing(migrated!.shelter.rooms[0]!)).toBe(0);
		for (const facing of [-1, 4, .5, null, "1", { value: 1 }]) {
			const malformed = JSON.parse(saveGame(state)); malformed.shelter.rooms[0].facing = facing;
			expect(parseSave(JSON.stringify(malformed))).toBeNull();
		}
		old.shelter.rooms[0].facing = 0; expect(parseSave(JSON.stringify(old))).toBeNull();
		expect(faceRoom(state, "room-workshop", 3, NOW).ok).toBe(true); expect(restored(state)).toEqual(state);
		const facingSave = JSON.parse(saveGame(state)); facingSave.schemaVersion = 23;
		expect(parseSave(JSON.stringify(facingSave))).toEqual(state);
		const forged = JSON.parse(saveGame(state)); forged.shelter.rooms[0].position = { x: 80, y: 552 }; forged.shelter.rooms[0].column = 0; forged.shelter.rooms[0].row = 3;
		expect(parseSave(JSON.stringify(forged))).toBeNull();
	});
});
