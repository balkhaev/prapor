import { describe, expect, test } from "bun:test";
import { createGame } from "../src/game/engine";
import { MODULE_MODELS } from "../src/game/modules";
import { GEAR_MODELS } from "../src/game/systems";
import { getTradeAssetRow, getTradeQuote, type TradeAsset } from "../src/game/trade";
import { getMarketFees } from "../src/game/flea";
import { LOOT_MODELS, getLootTraderPrice } from "../src/game/loot";

describe("item value and whole-parcel prices", () => {
	test("every physical module and gear model has a positive price which falls with actual wear", () => {
		for (const model of MODULE_MODELS) {
			const fresh: TradeAsset = { kind: "module", item: { id: "module-1", modelId: model.id, durability: 100, foundAt: 0 } };
			const worn: TradeAsset = { kind: "module", item: { ...fresh.item, durability: 20 } };
			expect(getTradeAssetRow(worn).guidePrice).toBeGreaterThan(0);
			expect(getTradeAssetRow(fresh).guidePrice).toBeGreaterThan(getTradeAssetRow(worn).guidePrice);
		}
		for (const model of GEAR_MODELS) {
			const fresh: TradeAsset = { kind: "gear", item: { id: "gear-1", modelId: model.id, durability: 100 } };
			const worn: TradeAsset = { kind: "gear", item: { ...fresh.item, durability: 20 } };
			expect(getTradeAssetRow(worn).guidePrice).toBeGreaterThan(0);
			expect(getTradeAssetRow(fresh).guidePrice).toBeGreaterThan(getTradeAssetRow(worn).guidePrice);
		}
	});
	test("a whole build keeps the value of its installed physical parts instead of reverting to a factory price", () => {
		const state = createGame(0), gun = state.weapons[0]!;
		gun.modules.stock!.durability = 20;
		const build = getTradeAssetRow({ kind: "weapon", item: gun });
		const parts = Object.values(gun.modules).map(item => getTradeAssetRow({ kind: "module", item }));
		expect(build.guidePrice).toBe(parts.reduce((sum, row) => sum + row.guidePrice, 0));
		expect(build.traderPrice).toBe(parts.reduce((sum, row) => sum + row.traderPrice!, 0));
		const before = build.guidePrice;
		delete gun.modules.stock;
		expect(getTradeAssetRow({ kind: "weapon", item: gun }).guidePrice).toBeLessThan(before);
	});
	test("quantity uses the whole parcel value and real listing fees remain below guide-price loot proceeds", () => {
		const state = createGame(0); state.supplies.ammo = 20;
		const quote = getTradeQuote(state, { kind: "supply", id: "ammo", quantity: 10 });
		expect(quote.guidePrice).toBe(65);
		expect(quote.asset).toEqual({ kind: "supply", id: "ammo", quantity: 10 });
		expect(getTradeAssetRow(quote.asset!).guidePrice).toBe(65);
		for (const model of LOOT_MODELS) {
			const item = { id: "loot-1", modelId: model.id, foundAt: 0 }, fees = getMarketFees(model.guidePrice);
			expect(fees.proceeds - fees.listingFee).toBeGreaterThan(getLootTraderPrice(item));
		}
	});
});
