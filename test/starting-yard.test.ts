import { describe, expect, test } from "bun:test";
import {
	advance, assignWorker, constructRoom, createGame, excavateShelter,
	getRoomFreePlacementReason, getShelterSites, parseSave, placeRoom,
	saveGame, SAVE_VERSION, setRoomRecipe, setRoomStockTarget,
	type GameState,
} from "../src/game/engine";
import { getStartingShelterSites } from "../src/game/shelter";
import { fundConstructionLoot } from "./loot-material-fixture";

const NOW = 1_792_000_000_000;
const legacySites = () => getShelterSites({}).map(site => ({ ...site }));
function legacyStarter(): GameState {
	const state = createGame(NOW);
	state.schemaVersion = 26;
	state.shelter.sites = legacySites();
	state.money = 20_000;
	state.supplies = { ammo: 100, medicine: 0, scrap: 200, intel: 20 };
	return fundConstructionLoot(state);
}
function roundTrip(state: GameState): GameState {
	const copy = parseSave(saveGame(state));
	expect(copy).not.toBeNull();
	return copy!;
}

describe("larger starting shelter territory", () => {
	test("new bases have twice the land and added ground permits exact free movement", () => {
		const state = createGame(NOW), room = state.shelter.rooms[0]!;
		expect(getShelterSites(state.shelter)).toHaveLength(24);
		expect(getShelterSites({})).toHaveLength(12);
		expect(state.shelter.rooms).toHaveLength(4);
		const before = saveGame(state), money = state.money, supplies = { ...state.supplies };
		expect(getRoomFreePlacementReason(state, room.id, 808.25, 412.75)).toBeNull();
		expect(saveGame(state)).toBe(before);
		expect(placeRoom(state, room.id, 808.25, 412.75, NOW).ok).toBe(true);
		expect(room.position).toEqual({ x: 808.25, y: 412.75 });
		expect(room.column).toBe(4);
		expect(state.money).toBe(money);
		expect(state.supplies).toEqual(supplies);
		expect(roundTrip(state)).toEqual(state);
	});

	test("a released starter save gains land while preserving placements, paid work and every asset", () => {
		const state = legacyStarter(), medbay = state.shelter.rooms.find(room => room.type === "medbay")!;
		expect(placeRoom(state, "room-workshop", 89.375, 301.625, NOW, 0, 1).ok).toBe(true);
		expect(constructRoom(state, "ammo", 450.125, 415.5, NOW).ok).toBe(true);
		expect(assignWorker(state, state.scavs[0]!.id, medbay.id, NOW).ok).toBe(true);
		expect(setRoomRecipe(state, medbay.id, "medicine-batch", true, NOW).ok).toBe(true);
		expect(setRoomStockTarget(state, medbay.id, 9, NOW).ok).toBe(true);
		advance(state, NOW + 1000);
		expect(medbay.queue[0]!.workDone).toBeGreaterThan(0);
		expect(state.shelter.rooms.at(-1)!.construction!.workDone).toBeGreaterThan(0);
		const before = structuredClone(state), copy = roundTrip(state);
		expect(copy).toEqual({ ...before, schemaVersion: SAVE_VERSION,
			shelter: { ...before.shelter, sites: getStartingShelterSites() } });
		expect(copy.shelter.rooms[0]!.position).toEqual({ x: 89.375, y: 301.625 });
		expect(copy.shelter.rooms[0]!.facing).toBe(1);
		expect(roundTrip(copy)).toEqual(copy);
		expect(saveGame(state)).toBe(JSON.stringify(before));
	});

	test("a paid existing expansion keeps its territory and costs without another starting grant", () => {
		const state = legacyStarter();
		expect(excavateShelter(state, 4, 1, NOW).ok).toBe(true);
		advance(state, NOW + 20_000);
		expect(state.shelter.sites).toHaveLength(13);
		expect(constructRoom(state, "ammo", 808.125, 280.5, state.lastUpdated).ok).toBe(true);
		const before = structuredClone(state), copy = roundTrip(state);
		expect(copy).toEqual({ ...before, schemaVersion: SAVE_VERSION });
		expect(copy.shelter.sites).toContainEqual({ column: 4, row: 1 });
		expect(roundTrip(copy)).toEqual(copy);
	});

	test("a paid unfinished expansion retains its exact reservation, charge and progress", () => {
		const state = legacyStarter();
		expect(excavateShelter(state, 4, 1, NOW).ok).toBe(true);
		advance(state, NOW + 7319);
		expect(state.shelter.expansions[0]!.workDone).toBe(7_319_000);
		const before = structuredClone(state), copy = roundTrip(state);
		expect(copy).toEqual({ ...before, schemaVersion: SAVE_VERSION });
		expect(copy.shelter.sites).toHaveLength(12);
		expect(roundTrip(copy)).toEqual(copy);
	});

	test("the grant never repairs a forged missing foundation or a building on unowned ground", () => {
		const state = legacyStarter();
		const missing = JSON.parse(saveGame(state));
		missing.shelter.sites = missing.shelter.sites.filter((site: { column: number; row: number }) => !(site.column === 3 && site.row === 2));
		expect(parseSave(JSON.stringify(missing))).toBeNull();
		const outside = JSON.parse(saveGame(state));
		outside.shelter.rooms[0].position = { x: 808.25, y: 412.75 };
		outside.shelter.rooms[0].column = 4;
		outside.shelter.rooms[0].row = 2;
		expect(parseSave(JSON.stringify(outside))).toBeNull();
	});
});
