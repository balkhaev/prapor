import { describe, expect, test } from "bun:test";
import { advance, claimLootDelivery, createGame, dispatchRaid, extractRaid, getLootCapacity, getLootTraderPrice, getRaidQuote, MAX_PENDING_LOOT_DELIVERIES, parseSave, PENDING_LOOT_RAID_LIMIT, SAVE_VERSION, saveGame, sellLootItem, setAutoRaid, type GameState, type LootDelivery, type LootItem } from "../src/game/engine";
import { MAP_BY_ID } from "../src/game/data";
import { withoutBarters } from "./legacy-loot-fixture";

const NOW = 1_792_000_000_000;
function put(state: GameState, modelId = "duct-tape"): LootItem {
	const item = { id: `loot-${state.nextId++}`, modelId, foundAt: state.lastUpdated };
	(state.lootItems ??= []).push(item); return item;
}
function parcel(state: GameState, modelIds = ["coffee"]): LootDelivery {
	const items = modelIds.map(modelId => put(state, modelId)), ids = new Set(items.map(item => item.id));
	state.lootItems = state.lootItems!.filter(item => !ids.has(item.id));
	const result = { id: `delivery-${state.nextId++}`, raidId: `raid-${state.nextId++}`, at: state.lastUpdated, items };
	(state.pendingLoot ??= []).push(result); return result;
}
function valid(state: GameState): GameState { const result = parseSave(saveGame(state)); expect(result).toEqual(state); return result!; }
function fullReturn() {
	const state = createGame(NOW); state.money = 5000; state.supplies.ammo = 72;
	expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
	const raid = state.raids[0]!; raid.seed = 9; raid.chance = 1; raid.expedition!.capacity = 50;
	advance(state, raid.endsAt); raid.expedition!.cargo.modules = []; raid.expedition!.cargo.weaponIds = [];
	for (let count = 0; count < getLootCapacity(state); count++) put(state);
	const cargo = structuredClone(raid.expedition!.cargo), cash = state.money;
	expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
	return { state, cargo, cash, delivery: state.pendingLoot![0]! };
}

describe("player-owned pending loot deliveries", () => {
	test("overflow extracts intact with exact receipt and cash excludes any unrequested sale", () => {
		const { state, cargo, cash, delivery } = fullReturn();
		expect(delivery.items).toEqual(cargo.lootItems!); expect(state.history[0]!.lootPending).toEqual(cargo.lootItems!);
		expect(state.history[0]!.money).toBe(cargo.money); expect(state.money - cash).toBe(cargo.money);
		expect(state.history[0]!.lootAutoSold).toBeUndefined(); expect(state.history[0]!.description).not.toContain("проданы торговцу"); valid(state);
	});
	test("a parcel is all or nothing, preserves physical IDs and acquisition dates and cannot be claimed twice", () => {
		const state = createGame(NOW), delivery = parcel(state, ["old-watch", "coffee"]), original = structuredClone(delivery.items);
		for (let count = 0; count < getLootCapacity(state) - 1; count++) put(state);
		const crowded = saveGame(state); expect(claimLootDelivery(state, delivery.id).ok).toBe(false); expect(saveGame(state)).toBe(crowded);
		const beforeMoney = state.money; expect(sellLootItem(state, state.lootItems![0]!.id).ok).toBe(true);
		const afterChosenSale = state.money, beforeIds = state.nextId;
		expect(afterChosenSale - beforeMoney).toBe(13); expect(claimLootDelivery(state, delivery.id).ok).toBe(true);
		expect(state.lootItems!.slice(-2)).toEqual(original); expect(state.nextId).toBe(beforeIds); expect(state.money).toBe(afterChosenSale); expect(state.pendingLoot).toEqual([]);
		const claimed = saveGame(state); expect(claimLootDelivery(state, delivery.id).ok).toBe(false); expect(saveGame(state)).toBe(claimed); valid(state);
	});
	test("already paid raids return safely while the delivery guard stops new manual and automatic sorties", () => {
		const state = createGame(NOW); state.money = 10000; state.supplies.ammo = 72;
		for (let index = 0; index < PENDING_LOOT_RAID_LIMIT - 1; index++) parcel(state);
		for (let index = 0; index < getLootCapacity(state); index++) put(state);
		for (const scav of state.scavs) expect(setAutoRaid(state, scav.id, "courtyard", 25, NOW).ok).toBe(true);
		const launched = state.scavs.length; expect(state.raids).toHaveLength(launched);
		for (const raid of state.raids) { raid.seed = 9; raid.chance = 1; }
		advance(state, Math.max(...state.raids.map(raid => raid.endsAt)));
		expect(state.raids).toEqual([]); expect(state.pendingLoot).toHaveLength(PENDING_LOOT_RAID_LIMIT - 1 + launched);
		expect(state.history.every(report => report.success && report.lootPending!.length > 0)).toBe(true);
		expect(state.scavs.every(scav => scav.autoRaid.enabled && scav.autoRaid.waitingReason?.includes("посылки"))).toBe(true);
		const scav = state.scavs[0]!; expect(getRaidQuote(state, scav, MAP_BY_ID.courtyard!).reason).toContain("посылки");
		const beforeCash = state.money; expect(dispatchRaid(state, scav.id, "courtyard", state.lastUpdated).ok).toBe(false); expect(state.money).toBe(beforeCash); valid(state);
	});
	test("pending property survives a journal rollover, reload and backward clock without rewriting find dates", () => {
		const { state, delivery } = fullReturn(), source = structuredClone(delivery.items), oldAt = delivery.at;
		state.history = []; const restored = valid(state);
		advance(restored, restored.lastUpdated - 60_000); expect(restored.pendingLoot![0]!.items).toEqual(source);
		expect(restored.pendingLoot![0]!.at).toBe(oldAt - 60_000); valid(restored);
		for (let index = 0; index < source.length; index++) expect(sellLootItem(restored, restored.lootItems![0]!.id).ok).toBe(true);
		expect(claimLootDelivery(restored, delivery.id).ok).toBe(true); expect(restored.lootItems!.slice(-source.length)).toEqual(source); valid(restored);
	});
	test("historic v19 overflow sales stay paid history and never restore sold objects during migration", () => {
		const { state, delivery } = fullReturn(), report = state.history[0]!, sold = delivery.items.map(item => ({ item, money: getLootTraderPrice(item) }));
		state.schemaVersion = 19; withoutBarters(state); report.lootAutoSold = sold;
		const proceeds = sold.reduce((sum, value) => sum + value.money, 0); state.money += proceeds; state.stats.moneyEarned += proceeds; report.money += proceeds;
		const migrated = parseSave(saveGame(state))!; expect(migrated).not.toBeNull(); expect(migrated.schemaVersion).toBe(SAVE_VERSION);
		expect(migrated.pendingLoot).toBeUndefined(); expect(migrated.history[0]!.lootAutoSold).toEqual(sold); expect(migrated.money).toBe(state.money); expect(migrated.lootItems).toEqual(state.lootItems);
		expect(claimLootDelivery(migrated, delivery.id).ok).toBe(false); valid(migrated);
	});
	test("pending ownership and report fields begin at v20 while released medical and territory saves remain readable", () => {
		for (const version of [18, 19]) {
			const state = createGame(NOW); state.schemaVersion = version; withoutBarters(state);
			expect(parseSave(saveGame(state))).not.toBeNull();
			parcel(state); expect(parseSave(saveGame(state))).toBeNull();
			const { state: history, delivery } = fullReturn(), sold = delivery.items.map(item => ({ item, money: getLootTraderPrice(item) }));
			history.schemaVersion = version; withoutBarters(history); history.history[0]!.lootAutoSold = sold;
			const proceeds = sold.reduce((sum, value) => sum + value.money, 0); history.money += proceeds; history.stats.moneyEarned += proceeds; history.history[0]!.money += proceeds;
			expect(parseSave(saveGame(history))).not.toBeNull();
			history.history[0]!.lootPending = []; expect(parseSave(saveGame(history))).toBeNull();
		}
	});
	test("strict parcel parsing rejects duplicate ownership, impossible sources and receipt tampering", () => {
		const { state } = fullReturn(); valid(state);
		for (const mutate of [
			(value: GameState) => { value.pendingLoot![0]!.items.push({ ...value.pendingLoot![0]!.items[0]! }); },
			(value: GameState) => { value.lootItems![0] = { ...value.pendingLoot![0]!.items[0]! }; },
			(value: GameState) => { value.pendingLoot![0]!.at = value.lastUpdated + 1; },
			(value: GameState) => { value.pendingLoot![0]!.id = "loot-12"; },
			(value: GameState) => { value.pendingLoot![0]!.raidId = `raid-${value.nextId}`; },
			(value: GameState) => { value.pendingLoot![0]!.items = []; },
			(value: GameState) => { value.pendingLoot![0]!.items[0]!.modelId = "__proto__"; },
			(value: GameState) => { value.history[0]!.lootPending![0]!.modelId = "coffee"; value.pendingLoot![0]!.items[0]!.modelId = "duct-tape"; },
			(value: GameState) => { value.history[0]!.lootItems = structuredClone(value.history[0]!.lootPending!); },
			(value: GameState) => { value.schemaVersion = 19; },
		]) { const altered = structuredClone(state); mutate(altered); expect(parseSave(saveGame(altered))).toBeNull(); }
		const extra = JSON.parse(saveGame(state)); extra.pendingLoot[0].price = 1; expect(parseSave(JSON.stringify(extra))).toBeNull();
		const bounded = createGame(NOW); for (let index = 0; index < MAX_PENDING_LOOT_DELIVERIES; index++) parcel(bounded);
		valid(bounded); parcel(bounded); expect(parseSave(saveGame(bounded))).toBeNull();
		const unreserved = createGame(NOW); expect(dispatchRaid(unreserved, unreserved.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		for (let index = 0; index < MAX_PENDING_LOOT_DELIVERIES; index++) parcel(unreserved);
		expect(parseSave(saveGame(unreserved))).toBeNull();
	});
});
