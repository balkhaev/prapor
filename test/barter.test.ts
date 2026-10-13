import { describe, expect, test } from "bun:test";
import { barterGear, BARTER_OFFERS, createGame, dispatchRaid, equipGear, getBarterQuote, getGearCraftReason, getLoadoutStats, getRaidQuote, USEFUL_LOOT_MODELS, parseSave, saveGame, takeTradeAsset, type BarterOffer, type GameState, type LootItem } from "../src/game/engine";
import { MAP_BY_ID } from "../src/game/data";
import { GEAR_MODELS, GEAR_MODEL_BY_ID } from "../src/game/systems";

const NOW = 1_792_000_000_000;
function put(state: GameState, modelId: string): LootItem {
	const item = { id: `loot-${state.nextId++}`, modelId, foundAt: state.lastUpdated };
	(state.lootItems ??= []).push(item); return item;
}
function prepare(state: GameState, offer: BarterOffer): string[] {
	return offer.requirements.flatMap(value => Array.from({ length: value.quantity }, () => put(state, value.modelId).id));
}
function valid(state: GameState) { expect(parseSave(saveGame(state))).toEqual(state); }

describe("physical trophy barters", () => {
	test("all named loot feeds balanced exchanges for every wearable gear model", () => {
		expect(BARTER_OFFERS).toHaveLength(26); expect(new Set(BARTER_OFFERS.map(offer => offer.id)).size).toBe(26);
		expect(new Set(BARTER_OFFERS.map(offer => offer.gearModelId))).toEqual(new Set(GEAR_MODELS.map(model => model.id)));
		expect(new Set(BARTER_OFFERS.flatMap(offer => offer.requirements.map(value => value.modelId)))).toEqual(new Set(USEFUL_LOOT_MODELS.map(model => model.id)));
		for (const offer of BARTER_OFFERS) {
			const state = createGame(NOW), quote = getBarterQuote(state, offer.id), model = GEAR_MODEL_BY_ID[offer.gearModelId]!;
			expect(quote.guideInputValue).toBeGreaterThanOrEqual((model.money + model.scrap * 14.5) * .9);
			expect(quote.guideInputValue).toBeLessThanOrEqual((model.money + model.scrap * 14.5) * 1.2);
			expect(offer.requirements.every(value => Number.isInteger(value.quantity) && value.quantity > 0)).toBe(true);
			expect(offer.requirements.reduce((sum, value) => sum + value.quantity, 0)).toBeLessThanOrEqual(6);
		}
	});
	test("all exchanges consume exact owned objects and produce intact real equipment without money or blueprints", () => {
		for (const offer of BARTER_OFFERS) {
			const state = createGame(NOW); state.money = 0; state.supplies.scrap = 0; state.blueprints = [];
			const ids = prepare(state, offer), untouched = put(state, offer.requirements[0]!.modelId), before = structuredClone(state);
			const quote = getBarterQuote(state, offer.id); expect(quote.reason).toBeNull(); expect(quote.itemIds).toEqual(ids);
			expect(getGearCraftReason(state, offer.gearModelId)).not.toBeNull();
			const result = barterGear(state, offer.id, [...ids].reverse()); expect(result.ok, result.message).toBe(true);
			expect(state.lootItems).toEqual([untouched]); expect(state.gearItems.at(-1)).toEqual({ id: result.gearItemId!, modelId: offer.gearModelId, durability: 100 });
			expect(state.money).toBe(before.money); expect(state.supplies).toEqual(before.supplies); expect(state.blueprints).toEqual([]);
			expect(state.stats).toEqual(before.stats); expect(state.achievements.active.crafts).toEqual(before.achievements.active.crafts);
			expect(state.achievements.active.loot).toEqual(before.achievements.active.loot); valid(state);
		}
	});
	test("the wearer gains actual armor protection with the corresponding weight and raid cost", () => {
		const state = createGame(NOW), scav = state.scavs[0]!, offer = BARTER_OFFERS.find(value => value.gearModelId === "heavy_armor")!;
		const baseline = getLoadoutStats(state, scav), quote = getRaidQuote(state, scav, MAP_BY_ID.courtyard!);
		const result = barterGear(state, offer.id, prepare(state, offer)); expect(result.ok).toBe(true);
		expect(equipGear(state, scav.id, "armor", result.gearItemId!).ok).toBe(true);
		const armored = getLoadoutStats(state, scav); expect(armored.protection - baseline.protection).toBeCloseTo(.15);
		expect(armored.weight - baseline.weight).toBe(9.5); expect(armored.speedMultiplier).toBeGreaterThan(baseline.speedMultiplier);
		expect(armored.ammoMultiplier).toBeGreaterThan(baseline.ammoMultiplier); expect(getRaidQuote(state, scav, MAP_BY_ID.courtyard!).chance).toBeGreaterThan(quote.chance);
		state.money = 1000; state.supplies.ammo = 72; expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
		expect(state.raids[0]!.expedition!.loadout.armorModelId).toBe("heavy_armor"); expect(state.raids[0]!.expedition!.loadout.armorCondition).toBe(100); valid(state);
	});
	test("full equipment stands, wrong bundles, duplicate and stale IDs cannot consume a single trophy", () => {
		const state = createGame(NOW), offer = BARTER_OFFERS[0]!, ids = prepare(state, offer), wrong = put(state, "bandage-roll").id;
		for (const [offerId, selected] of [
			["__proto__", ids], [offer.id, ids.slice(1)], [offer.id, [...ids, wrong]], [offer.id, [ids[0]!, ids[0]!, ids[2]!]],
			[offer.id, [ids[0]!, ids[1]!, wrong]], [offer.id, [ids[0]!, ids[1]!, "loot-999999"]],
		] as [string, string[]][]) { const before = saveGame(state); expect(barterGear(state, offerId, selected).ok).toBe(false); expect(saveGame(state)).toBe(before); }
		for (let index = 0; index < 28; index++) state.gearItems.push({ id: `gear-${state.nextId++}`, modelId: "canvas_pack", durability: 100 });
		const full = saveGame(state); expect(barterGear(state, offer.id, ids).ok).toBe(false); expect(saveGame(state)).toBe(full); valid(state);
	});
	test("same-model spare objects stay selectable and repeated exchanges never reuse their consumed identifiers", () => {
		const state = createGame(NOW), offer = BARTER_OFFERS[0]!, first = prepare(state, offer), second = prepare(state, offer);
		expect(barterGear(state, offer.id, second).ok).toBe(true); expect(state.lootItems!.map(item => item.id)).toEqual(first);
		const before = saveGame(state); expect(barterGear(state, offer.id, second).ok).toBe(false); expect(saveGame(state)).toBe(before);
		expect(barterGear(state, offer.id, first).ok).toBe(true); expect(new Set(state.gearItems.map(item => item.id)).size).toBe(2); valid(state);
	});
	test("escrow and unclaimed delivery objects are unavailable for barter until they are owned on the shelf", () => {
		const state = createGame(NOW), offer = BARTER_OFFERS[0]!, ids = prepare(state, offer);
		expect(takeTradeAsset(state, { kind: "loot", id: ids[0]!, quantity: 1 }).ok).toBe(true);
		const escrowed = saveGame(state); expect(barterGear(state, offer.id, ids).ok).toBe(false); expect(saveGame(state)).toBe(escrowed);
		const pending = put(state, "duct-tape"); state.lootItems = state.lootItems!.filter(item => item.id !== pending.id);
		state.pendingLoot = [{ id: `delivery-${state.nextId++}`, raidId: `raid-${state.nextId++}`, at: NOW, items: [pending] }];
		expect(getBarterQuote(state, offer.id).requirements.find(value => value.modelId === "duct-tape")!.owned).toBe(1); valid(state);
	});
});
