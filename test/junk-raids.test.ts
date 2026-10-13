import { expect, test } from "bun:test";
import { advance, continueExpedition, createGame, dispatchRaid, extractRaid, getLootCapacity, getLootTraderPrice, parseSave, SAVE_VERSION, saveGame, setLoadoutOption, type GameState, type LootItem } from "../src/game/engine";

const NOW = 1_792_000_000_000;
const make = (state: GameState, modelId: string): LootItem => ({ id: `loot-${state.nextId++}`, modelId, foundAt: state.lastUpdated });
function checkpoint() {
	const state = createGame(NOW); state.money = 5000; state.supplies.ammo = 72;
	expect(setLoadoutOption(state, state.scavs[0]!.id, "medkit", true).ok).toBe(true);
	expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
	const raid = state.raids[0]!; raid.chance = 1; raid.seed = 9; raid.expedition!.capacity = 50;
	advance(state, raid.endsAt);
	expect(raid.expedition!.status).toBe("choice");
	raid.expedition!.cargo.modules = []; raid.expedition!.cargo.weaponIds = [];
	raid.expedition!.cargo.lootItems = [make(state, "empty-can"), make(state, "broken-phone"), make(state, "duct-tape")];
	return { state, raid };
}

test("delivered junk sells once even on a full shelf while useful common loot stays intact", () => {
	const { state, raid } = checkpoint();
	state.lootItems = Array.from({ length: getLootCapacity(state) }, () => make(state, "duct-tape"));
	const cargo = structuredClone(raid.expedition!.cargo), beforeMoney = state.money;
	const junk = cargo.lootItems!.filter(item => item.modelId !== "duct-tape");
	const autoMoney = junk.reduce((sum, item) => sum + getLootTraderPrice(item), 0);
	expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
	const report = state.history[0]!;
	expect(report.lootAutoSold).toEqual(junk.map(item => ({ item, money: getLootTraderPrice(item) })));
	expect(state.money - beforeMoney).toBe(cargo.money + autoMoney);
	expect(report.money).toBe(cargo.money + autoMoney);
	expect(state.lootItems).toHaveLength(getLootCapacity(state));
	expect(state.pendingLoot![0]!.items).toEqual([cargo.lootItems![2]!]);
	expect(report.lootPending).toEqual([cargo.lootItems![2]!]);
	expect(parseSave(saveGame(state))).toEqual(state);
	const saved = saveGame(state);
	expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(false);
	expect(saveGame(state)).toBe(saved);
	const restored = parseSave(saved)!; advance(restored, restored.lastUpdated);
	expect(restored.money).toBe(state.money);
});

test("lost junk remains lost cargo rather than selling before evacuation", () => {
	const { state, raid } = checkpoint(), loot = structuredClone(raid.expedition!.cargo.lootItems!);
	expect(continueExpedition(state, raid.id, "scavenge", raid.expedition!.offers[0]!, state.lastUpdated).ok).toBe(true);
	raid.chance = 0;
	advance(state, raid.endsAt);
	const report = state.history[0]!;
	expect(report.success).toBe(false); expect(report.money).toBe(0);
	expect(report.lootAutoSold ?? []).toHaveLength(0);
	expect(report.lostCargo!.lootItems).toEqual(loot);
	expect(state.pendingLoot ?? []).toHaveLength(0);
	expect(parseSave(saveGame(state))).toEqual(state);
});

test("new garbage and legendary models cannot be injected into a pre-release save", () => {
	for (const modelId of ["empty-can", "military-cpu", "prototype-optics"]) {
		const state = createGame(NOW); state.lootItems = [make(state, modelId)];
		expect(parseSave(saveGame(state))).toEqual(state);
		state.schemaVersion = 20;
		expect(parseSave(saveGame(state))).toBeNull();
		state.schemaVersion = SAVE_VERSION;
		expect(parseSave(saveGame(state))).toEqual(state);
	}
});
