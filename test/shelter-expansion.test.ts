import { fundConstructionLoot } from './loot-material-fixture';
import { describe, expect, test } from "bun:test";
import {
	advance, buildRoom, createGame, excavateShelter, getBuildRoomQuote, getExcavationQuote,
	getShelterFrontier, getShelterSites, MAX_OFFLINE_MS, MAX_SHELTER_SITES, parseSave, saveGame,
	type GameState,
} from "../src/game/engine";

const NOW = 1_792_000_000_000;
function funded(): GameState {
	const state = createGame(NOW);
	// Existing purchased yards retain the original foundation and expansion semantics.
	state.shelter.sites = getShelterSites({}).map(site => ({ ...site }));
	state.money = 10_000;
	state.supplies = { ammo: 60, medicine: 0, scrap: 50, intel: 10 };
	return fundConstructionLoot(state);
}
function restored(state: GameState): GameState {
	const copy = parseSave(saveGame(state));
	expect(copy).not.toBeNull();
	return copy!;
}
const at = (column: number, row: number) => ({ column, row });
const hasSite = (state: GameState, column: number, row: number) => getShelterSites(state.shelter).some((site) => site.column === column && site.row === row);

describe("paid excavation of the shelter perimeter", () => {
	test("the original foundation remains compatible and the frontier permits only left, right and deeper walls", () => {
		const state = funded(), before = saveGame(state);
		expect(getShelterSites(state.shelter)).toHaveLength(12);
		expect(getShelterSites({ rooms: [] })).toEqual(state.shelter.sites);
		expect(getShelterFrontier(state.shelter)).toEqual([
			at(-1, 0), at(4, 0), at(-1, 1), at(4, 1), at(-1, 2), at(4, 2),
			at(0, 3), at(1, 3), at(2, 3), at(3, 3),
		]);
		expect(getExcavationQuote(state, -1, 1)).toEqual({ money: 60, scrap: 2, duration: 20, reason: null });
		for (const [column, row] of [[0, -1], [-1, -1], [-2, 1], [5, 0], [0, 4], [-129, 1], [129, 1], [0, 129], [.5, 0], [0, NaN]]) {
			expect(getExcavationQuote(state, column!, row!).reason).not.toBeNull();
			expect(excavateShelter(state, column!, row!, NOW).ok).toBe(false);
		}
		expect(saveGame(state)).toBe(before);
	});

	test("excavation pays once, waits exactly twenty seconds, and a room cannot be built on unfinished ground", () => {
		const state = funded(), money = state.money, scrap = state.supplies.scrap;
		expect(getBuildRoomQuote(state, "ammo", -1, 1).reason).not.toBeNull();
		expect(excavateShelter(state, -1, 1, NOW).ok).toBe(true);
		expect(state.money).toBe(money - 60);
		expect(state.supplies.scrap).toBe(scrap - 2);
		expect(state.shelter.expansions).toEqual([{ column: -1, row: 1, workDone: 0, workRequired: 20_000_000, cost: { money: 60, scrap: 2 } }]);
		expect(getShelterFrontier(state.shelter)).not.toContainEqual(at(-1, 1));
		expect(getExcavationQuote(state, -2, 1).reason).not.toBeNull();
		const paid = saveGame(state);
		expect(excavateShelter(state, -1, 1, NOW).ok).toBe(false);
		expect(buildRoom(state, "ammo", -1, 1, NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(paid);
		advance(state, NOW + 19_999);
		expect(hasSite(state, -1, 1)).toBe(false);
		expect(state.shelter.expansions[0]!.workDone).toBe(19_999_000);
		// The room action settles the excavation at its boundary before checking the site.
		expect(buildRoom(state, "ammo", -1, 1, NOW + 20_000).ok).toBe(true);
		expect(hasSite(state, -1, 1)).toBe(true);
		expect(state.shelter.expansions).toEqual([]);
		expect(getExcavationQuote(state, -2, 1).reason).toBeNull();
		const room = state.shelter.rooms.find((room) => room.column === -1 && room.row === 1)!;
		expect(room.status).toBe("building");
		advance(state, NOW + 80_000);
		expect(room.status).toBe("ready");
		expect(restored(state)).toEqual(state);
	});

	test("independent perimeter jobs complete offline and preserve future frontier after reload and irregular ticks", () => {
		const long = funded();
		for (const [column, row] of [[-1, 0], [4, 2], [2, 3]]) expect(excavateShelter(long, column!, row!, NOW).ok).toBe(true);
		const short = restored(long);
		advance(long, NOW + 71_337);
		for (const elapsed of [131, 997, 7331]) advance(short, NOW + elapsed);
		const reloaded = restored(short);
		for (const elapsed of [19_999, 20_000, 20_001, 37_093, 71_337]) advance(reloaded, NOW + elapsed);
		expect(reloaded).toEqual(long);
		expect(long.shelter.sites).toHaveLength(15);
		expect(long.shelter.expansions).toHaveLength(0);
		for (const site of [at(-2, 0), at(5, 2), at(2, 4)]) expect(getShelterFrontier(long.shelter)).toContainEqual(site);
		expect(getShelterFrontier(long.shelter).every((site) => site.row >= 0)).toBe(true);
		expect(restored(long)).toEqual(long);
	});

	test("invalid time, insufficient supplies and the combined site limit cannot reserve work or take payment", () => {
		const state = funded(), before = saveGame(state);
		for (const time of [NaN, Infinity, -1]) expect(excavateShelter(state, -1, 0, time).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		state.money = 59;
		let blocked = saveGame(state);
		expect(excavateShelter(state, -1, 0, NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(blocked);
		state.money = 100; state.supplies.scrap = 1;
		blocked = saveGame(state);
		expect(excavateShelter(state, -1, 0, NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(blocked);
		const full = funded();
		full.shelter.sites = Array.from({ length: 4 }, (_, row) => Array.from({ length: 64 }, (_, column) => at(column, row))).flat();
		expect(full.shelter.sites).toHaveLength(MAX_SHELTER_SITES);
		expect(restored(full)).toEqual(full);
		blocked = saveGame(full);
		expect(getExcavationQuote(full, 64, 0).reason).not.toBeNull();
		expect(excavateShelter(full, 64, 0, NOW).ok).toBe(false);
		expect(saveGame(full)).toBe(blocked);
		full.shelter.sites.pop();
		expect(excavateShelter(full, 64, 0, NOW).ok).toBe(true);
		expect(getExcavationQuote(full, 63, 3).reason).not.toBeNull();
		expect(full.shelter.sites.length + full.shelter.expansions.length).toBe(MAX_SHELTER_SITES);
		expect(restored(full)).toEqual(full);
	});

	test("discarded offline time and repeated settlement never duplicate an excavated site", () => {
		const state = funded();
		expect(excavateShelter(state, 0, 3, NOW).ok).toBe(true);
		advance(state, NOW + MAX_OFFLINE_MS * 2);
		expect(state.shelter.sites).toHaveLength(13);
		const settled = saveGame(state);
		advance(state, state.lastUpdated);
		expect(saveGame(state)).toBe(settled);
		expect(restored(state)).toEqual(state);
	});
});

describe("expansion save integrity", () => {
	test("old v5 shelter fields receive the larger starting yard without changing gameplay progress", () => {
		const original = funded();
		const value = JSON.parse(saveGame(original));
		value.schemaVersion = 5;
		delete value.lootItems;
		delete value.recruitment;
		delete value.memorials; delete value.social; delete value.achievements;
		for (const scav of value.scavs) { delete scav.profile; delete scav.story; }
		delete value.shelter.sites; delete value.shelter.expansions;
		const transferred = parseSave(JSON.stringify(value))!;
		expect(transferred).not.toBeNull();
		original.shelter.sites = transferred.shelter.sites.map(site => ({ ...site }));
		const withoutPersonalHistory = (game: GameState) => {
			const copy = JSON.parse(saveGame(game));
			delete copy.memorials; delete copy.social; delete copy.achievements;
			delete copy.lootItems;
			for (const scav of copy.scavs) delete scav.story;
			return copy;
		};
		expect(withoutPersonalHistory(transferred)).toEqual(withoutPersonalHistory(original));
		for (const scav of transferred.scavs) {
			expect(scav.story.pending).toBeNull();
			expect(scav.story.bond).toBe(20);
			expect(scav.story.stress).toBe(0);
		}
		const migrated = restored(original);
		expect(migrated.schemaVersion).toBe(original.schemaVersion);
		expect(migrated.shelter.sites).toHaveLength(24);
	});

	test("forged disconnected floors, duplicate reservations, street sites and unpaid jobs cannot be imported", () => {
		const state = funded();
		expect(excavateShelter(state, -1, 1, NOW).ok).toBe(true);
		advance(state, NOW + 7319);
		const mutations: ((value: any) => void)[] = [
			value => { value.shelter.sites.push(value.shelter.sites[0]); },
			value => { value.shelter.sites.shift(); },
			value => { value.shelter.sites.push(at(-8, 8)); },
			value => { value.shelter.sites.push(at(1, -1)); },
			value => { value.shelter.sites.push(at(-129, 0)); },
			value => { value.shelter.sites.push(at(0, 129)); },
			value => { value.shelter.sites.push(at(.5, 3)); },
			value => { value.shelter.expansions.push(value.shelter.expansions[0]); },
			value => { value.shelter.expansions[0].column = 0; },
			value => { value.shelter.expansions[0].column = -2; },
			value => { value.shelter.expansions[0].row = -1; },
			value => { value.shelter.expansions[0].cost.money = 0; },
			value => { value.shelter.expansions[0].cost.scrap = 1; },
			value => { value.shelter.expansions[0].workRequired = 1; },
			value => { value.shelter.expansions[0].workDone = -1; },
			value => { value.shelter.expansions[0].workDone = 20_000_001; },
			value => { value.shelter.expansions[0].workDone = 10.5; },
			value => { value.shelter.expansions[0].free = true; },
			value => { value.shelter.expansions.push({ ...value.shelter.expansions[0], column: -2 }); },
			value => { value.shelter.rooms[0].column = -1; value.shelter.rooms[0].row = 1; },
			value => { value.shelter.rooms[0].column = -4; value.shelter.sites.push(at(-4, 0)); },
			value => { value.shelter.sites = Array.from({ length: 4 }, (_, row) => Array.from({ length: 64 }, (_, column) => at(column, row))).flat(); },
		];
		for (const mutate of mutations) {
			const value = JSON.parse(saveGame(state)); mutate(value);
			expect(parseSave(JSON.stringify(value))).toBeNull();
		}
		expect(restored(state)).toEqual(state);
	});
});
