import { describe, expect, test } from "bun:test";
import { withoutMedical } from "./legacy-health-fixture";
import { withoutLoot } from "./legacy-loot-fixture";
import { withoutArsenalLoot } from "./legacy-strategy-fixture";
import {
	advance, continueExpedition, createGame, creditMarketMoney, dispatchRaid, extractRaid, getCargoValue, getCargoWeight, getLootCapacity,
	getSupplyCapacity, getTradeAssetRow, getTradeInventory, getTradeQuote, LOOT_MODELS, parseSave, parseTradeAsset, receiveTradeAsset,
	recycleLootItem, saveGame, sellLootItem, setLoadoutOption, takeTradeAsset, SAVE_VERSION, type GameState, type LootItem,
} from "../src/game/engine";
import { MAPS } from "../src/game/data";
import { getRaidLootPool, rollRaidLoot } from "../src/game/loot";
import { ensureShelterLogistics } from "../src/game/shelter-logistics";

const NOW = 1_792_000_000_000;
function start(seed = 9) {
	const state = createGame(NOW); state.money = 10_000; state.supplies.ammo = 60; state.supplies.intel = 10;
	expect(setLoadoutOption(state, state.scavs[0]!.id, "medkit", true).ok).toBe(true);
	expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
	const raid = state.raids[0]!; raid.seed = seed; raid.chance = 1; raid.expedition!.capacity = 50;
	return { state, raid };
}
// These shelf/receipt fixtures exercise useful trophies from the released catalog; junk delivery has separate coverage.
function checkpoint(seed = 9) { const value = start(seed); value.raid.expedition!.lootCatalogVersion = 20; advance(value.state, value.raid.endsAt); return value; }
function put(state: GameState, modelId = "duct-tape"): LootItem { const item = { id: `loot-${state.nextId++}`, modelId, foundAt: state.lastUpdated }; (state.lootItems ??= []).push(item); return item; }
function valid(state: GameState) { expect(parseSave(saveGame(state))).toEqual(state); }
function random(seed: number) { let x = seed; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; }; }

describe("named physical raid loot", () => {
	test("v15 ammunition saves migrate without adding loot rules to their already paid sortie", () => {
		const state = createGame(NOW); state.scavs[0]!.loadout.ammoType = "tracer";
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		const old = withoutMedical(withoutLoot(withoutArsenalLoot(structuredClone(state)))); old.schemaVersion = 15;
		const migrated = parseSave(saveGame(old))!; expect(migrated).not.toBeNull(); expect(migrated.schemaVersion).toBe(SAVE_VERSION);
		expect(migrated.raids[0]!.lootVersion).toBeUndefined(); expect(migrated.raids[0]!.expedition!.ammunition).toEqual(old.raids[0]!.expedition!.ammunition);
		expect(migrated.scavs[0]!.loadout.ammoType).toBe("tracer"); migrated.raids[0]!.chance = 1;
		advance(migrated, migrated.raids[0]!.endsAt); expect(migrated.raids[0]!.expedition!.cargo.lootItems).toBeUndefined(); valid(migrated);
		const premature = structuredClone(old); premature.schemaVersion = 14; expect(parseSave(saveGame(premature))).toBeNull();
		const contaminated = withoutMedical(structuredClone(state)); contaminated.schemaVersion = 15; expect(parseSave(saveGame(contaminated))).toBeNull();
	});
	test("all 32 finds have distinct identities, weights and prices; useful trophies offer salvage while marked junk sells", () => {
		expect(LOOT_MODELS).toHaveLength(32); expect(new Set(LOOT_MODELS.map(item => item.id)).size).toBe(32);
		expect(new Set(LOOT_MODELS.map(item => item.category)).size).toBe(7);
		for (const model of LOOT_MODELS) {
			expect(model.weight).toBeGreaterThan(0); expect(model.guidePrice).toBeGreaterThanOrEqual(model.autoSell ? 2 : 25); expect(model.guidePrice).toBeLessThanOrEqual(1050);
			expect(Object.values(model.salvage).some(value => value > 0)).toBe(!model.autoSell);
			expect(MAPS.some(map => getRaidLootPool(map.id, "scavenge", 3).some(entry => entry.model.id === model.id))).toBe(true);
		}
	});
	test("sector and branch pools differ, and closed-zone valuables require the promised depth", () => {
		const backyard = getRaidLootPool("courtyard", "scavenge", 1);
		expect(backyard.some(entry => entry.model.rarity === "epic")).toBe(false);
		expect(getRaidLootPool("bunker", "recon", 2).some(entry => entry.model.id === "cipher-book")).toBe(false);
		expect(getRaidLootPool("bunker", "recon", 3).some(entry => entry.model.id === "cipher-book")).toBe(true);
		const weight = (map: string, branch: "scavenge" | "recon", id: string) => getRaidLootPool(map, branch, 3).find(entry => entry.model.id === id)!.weight;
		expect(weight("factory", "scavenge", "copper-wire")).toBeGreaterThan(weight("forest", "scavenge", "copper-wire"));
		expect(weight("depot", "recon", "patrol-log")).toBeGreaterThan(weight("depot", "scavenge", "patrol-log"));
		expect(getRaidLootPool("__proto__", "scavenge", 1)).toEqual([]);
		const found = new Set<string>();
		for (const map of MAPS) for (let seed = 1; seed <= 500; seed++) for (const model of rollRaidLoot(map.id, "scavenge", 3, random(seed * 7919))) found.add(model.id);
		expect(found.size).toBe(32);
	});
	test("new loot changes no combat, cash, parts or perk rolls and only begins on newly dispatched sorties", () => {
		for (let seed = 1; seed <= 30; seed++) {
			const modern = start(seed), old = start(seed); delete old.raid.lootVersion;
			advance(modern.state, modern.raid.endsAt); advance(old.state, old.raid.endsAt);
			expect(modern.raid.expedition!.cargo.lootItems!.length).toBeGreaterThanOrEqual(1);
			expect(old.raid.expedition!.cargo.lootItems).toBeUndefined();
			expect(modern.state.scavs[0]!.health).toBe(old.state.scavs[0]!.health);
			expect(modern.state.weapons[0]!.durability).toBe(old.state.weapons[0]!.durability);
			expect(modern.raid.expedition!.cargo.money).toBe(old.raid.expedition!.cargo.money);
			expect(modern.raid.expedition!.cargo.supplies).toEqual(old.raid.expedition!.cargo.supplies);
			expect(modern.raid.expedition!.cargo.modules).toEqual(old.raid.expedition!.cargo.modules);
			expect(modern.raid.expedition!.offers).toEqual(old.raid.expedition!.offers);
			expect(modern.state.rng).toBe(old.state.rng); valid(modern.state); valid(old.state);
		}
	});
	test("physical finds are escrowed until extraction, independently copied into delivered receipts and lost on failure", () => {
		const { state, raid } = checkpoint(); const items = structuredClone(raid.expedition!.cargo.lootItems!);
		expect(state.lootItems).toBeUndefined();
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true); expect(state.lootItems).toEqual(items); expect(state.history[0]!.lootItems).toEqual(items);
		state.lootItems![0]!.modelId = "coffee"; expect(state.history[0]!.lootItems![0]!.modelId).toBe(items[0]!.modelId); valid(state);
		const failed = checkpoint(); const carried = structuredClone(failed.raid.expedition!.cargo.lootItems!);
		expect(continueExpedition(failed.state, failed.raid.id, "scavenge", failed.raid.expedition!.offers[0]!, failed.state.lastUpdated).ok).toBe(true);
		failed.raid.chance = 0; advance(failed.state, failed.raid.endsAt);
		expect(failed.state.lootItems).toBeUndefined(); expect(failed.state.history[0]!.lootItems).toEqual([]); expect(failed.state.history[0]!.lostCargo!.lootItems).toEqual(carried); valid(failed.state);
	});
	test("full loot shelves preserve overflow intact without choosing a sale for the player", () => {
		const { state, raid } = checkpoint(); for (let count = 0; count < getLootCapacity(state); count++) put(state);
		const carried = structuredClone(raid.expedition!.cargo.lootItems!), cash = raid.expedition!.cargo.money;
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		const report = state.history[0]!; expect(report.lootItems).toEqual([]); expect(report.lootPending).toEqual(carried); expect(report.lootAutoSold).toBeUndefined();
		expect(report.money).toBe(cash); expect(report.description).toContain("ждут в посылке"); expect(state.pendingLoot![0]!.items).toEqual(carried);
		expect(state.lootItems).toHaveLength(getLootCapacity(state)); valid(state);
	});
	test("cargo totals include named finds and new bags retain higher value per weight instead of heavy junk", () => {
		const { state, raid } = start(1); const valuable = { id: `loot-${state.nextId++}`, modelId: "old-watch", foundAt: state.lastUpdated };
		raid.expedition!.capacity = 8; raid.expedition!.cargo.lootItems = [valuable]; raid.expedition!.cargo.supplies.scrap = 80;
		const base = { money: 0, supplies: { ammo: 0, medicine: 0, scrap: 0, intel: 0 }, weaponIds: [], modules: [], lootItems: [valuable] };
		expect(getCargoWeight(base)).toBe(.2); expect(getCargoValue(base)).toBe(85);
		advance(state, raid.endsAt); expect(getCargoWeight(raid.expedition!.cargo)).toBeLessThanOrEqual(8);
		expect(raid.expedition!.cargo.lootItems!.some(item => item.id === valuable.id)).toBe(true); expect(raid.expedition!.cargo.supplies.scrap).toBeLessThan(16); valid(state);
	});
	test("private outcomes choose finds independently of the public street seed", () => {
		const first = start(1), second = start(2); first.raid.outcomeSeed = second.raid.outcomeSeed = 58319;
		advance(first.state, first.raid.endsAt); advance(second.state, second.raid.endsAt);
		expect(first.raid.expedition!.cargo.lootItems).toEqual(second.raid.expedition!.cargo.lootItems);
	});
	test("malformed, duplicate, nonfinite and impossible-depth loot snapshots are rejected", () => {
		const { state } = checkpoint(); const item = put(state); valid(state);
		for (const mutate of [
			(value: GameState) => { value.lootItems!.push({ ...item }); },
			(value: GameState) => { value.lootItems![0]!.modelId = "__proto__"; },
			(value: GameState) => { value.lootItems![0]!.foundAt = Number.POSITIVE_INFINITY; },
			(value: GameState) => { value.raids[0]!.lootVersion = 2 as 1; },
			(value: GameState) => { delete value.raids[0]!.lootVersion; },
			(value: GameState) => { value.raids[0]!.expedition!.cargo.lootItems![0]!.modelId = "secure-drive"; },
			(value: GameState) => { for (let i = 0; i <= getLootCapacity(value); i++) put(value); },
		]) { const altered = structuredClone(state); mutate(altered); expect(parseSave(saveGame(altered))).toBeNull(); }
	});
	test("sale and salvage are distinct choices, and salvage refuses a partially fitting yield atomically", () => {
		const state = createGame(NOW), item = put(state, "surgical-kit"), before = state.money;
		expect(sellLootItem(state, item.id).ok).toBe(true); expect(state.money - before).toBe(121); expect(state.stats.moneyEarned).toBe(121);
		const compound = put(state, "water-filter"); state.supplies.scrap = getSupplyCapacity(state).scrap;
		const snapshot = saveGame(state); expect(recycleLootItem(state, compound.id).ok).toBe(false); expect(saveGame(state)).toBe(snapshot);
		state.supplies.scrap -= 2; const meds = state.supplies.medicine; expect(recycleLootItem(state, compound.id).ok).toBe(true); expect(state.supplies.medicine).toBe(meds + 2); valid(state);
	});
});

describe("trade inventory and atomic physical delivery", () => {
	test("all six inventory families expose exact stack quotes, real condition and prices without transferring provenance", () => {
		const state = createGame(NOW), loot = put(state), kits = ensureShelterLogistics(state).kits; kits.maintenance = 2;
		state.gearItems.push({ id: `gear-${state.nextId++}`, modelId: "canvas_pack", durability: 75 });
		const rows = getTradeInventory(state); expect(new Set(rows.map(row => row.ref.kind)).size).toBe(6);
		expect(rows.find(row => row.ref.id === loot.id)!.traderPrice).toBe(13);
		expect(rows.find(row => row.ref.kind === "gear")!.condition).toBe(75);
		const quote = getTradeQuote(state, { kind: "supply", id: "ammo", quantity: 10 }); expect(quote.guidePrice).toBe(65); expect(quote.asset).toEqual({ kind: "supply", id: "ammo", quantity: 10 });
		const kit = getTradeQuote(state, { kind: "kit", id: "maintenance", quantity: 2 }); expect(kit.guidePrice).toBe(176); expect(getTradeAssetRow(kit.asset!).guidePrice).toBe(176);
		valid(state);
	});
	test("escrow cannot remove assigned equipment, installed parts, the last usable gun or nonexistent stacks", () => {
		const state = createGame(NOW), before = saveGame(state), gun = state.weapons[0]!;
		for (const ref of [{ kind: "weapon" as const, id: gun.id, quantity: 1 }, { kind: "module" as const, id: gun.modules.receiver!.id, quantity: 1 }, { kind: "supply" as const, id: "ammo", quantity: 25 }]) expect(takeTradeAsset(state, ref).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		state.scavs.forEach(scav => { scav.weaponInstanceId = null; }); for (const spare of state.weapons.slice(1)) { spare.durability = 0; spare.modules.receiver!.durability = 0; }
		expect(getTradeQuote(state, { kind: "weapon", id: gun.id, quantity: 1 }).reason).toContain("готовую"); valid(state);
	});
	test("a gun delivery allocates fresh identifiers for the complete build while cancellation restores the exact owned object", () => {
		const source = createGame(NOW), target = createGame(NOW), gun = source.weapons.at(-1)!, original = structuredClone(gun);
		const take = takeTradeAsset(source, { kind: "weapon", id: gun.id, quantity: 1 }); expect(take.ok).toBe(true);
		const beforeIds = target.nextId; expect(receiveTradeAsset(target, take.asset!, NOW).ok).toBe(true);
		const bought = target.weapons.at(-1)!; expect(bought.id).toBe(`gun-${beforeIds}`); expect(Object.values(bought.modules).every(part => Number(part.id.split("-")[1]) >= beforeIds)).toBe(true);
		expect(bought.weaponId).toBe(original.weaponId); expect(bought.durability).toBe(original.durability); expect(target.stats.weaponsFound).toBe(0); expect(target.achievements.active.loot).toEqual([]);
		expect(receiveTradeAsset(source, take.asset!, NOW, false).ok).toBe(true); expect(source.weapons.at(-1)).toEqual(original); valid(source); valid(target);
	});
	test("bad nested payloads, duplicated cancellation IDs and capacity failures leave the whole recipient unchanged", () => {
		const state = createGame(NOW), gun = state.weapons.at(-1)!, asset = { kind: "weapon" as const, item: structuredClone(gun) };
		const forged = structuredClone(asset); forged.item.modules.receiver!.modelId = "receiver-svd";
		expect(parseTradeAsset(forged)).toBeNull(); expect(parseTradeAsset({ ...asset, price: 1 })).toBeNull(); expect(parseTradeAsset({ kind: "supply", id: "ammo", quantity: .5 })).toBeNull();
		const initial = saveGame(state); expect(receiveTradeAsset(state, asset, NOW, false).ok).toBe(false); expect(receiveTradeAsset(state, forged, NOW).ok).toBe(false); expect(saveGame(state)).toBe(initial);
		state.supplies.ammo = getSupplyCapacity(state).ammo - 2; const packed = saveGame(state); expect(receiveTradeAsset(state, { kind: "supply", id: "ammo", quantity: 3 }, NOW).ok).toBe(false); expect(saveGame(state)).toBe(packed);
		for (let index = 0; index < getLootCapacity(state); index++) put(state);
		const full = saveGame(state); expect(receiveTradeAsset(state, { kind: "loot", item: { id: "loot-999", modelId: "coffee", foundAt: NOW } }, NOW).ok).toBe(false); expect(saveGame(state)).toBe(full); valid(state);
	});
	test("market supply receipts invalidate supply chains and verified money credits reject unsafe sums", () => {
		const state = createGame(NOW), ammoVersion = state.achievements.ammoVersion;
		expect(receiveTradeAsset(state, { kind: "supply", id: "ammo", quantity: 1 }, NOW).ok).toBe(true); expect(state.achievements.ammoVersion).toBe(ammoVersion + 1);
		const snapshot = saveGame(state); for (const amount of [-1, .5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER]) expect(creditMarketMoney(state, amount).ok).toBe(false);
		expect(saveGame(state)).toBe(snapshot); expect(creditMarketMoney(state, 15).ok).toBe(true); expect(state.stats.moneyEarned).toBe(15); valid(state);
	});
});
