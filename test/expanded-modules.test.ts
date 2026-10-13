import { describe, expect, test } from "bun:test";
import {
	advance, assignWorker, craftModule, createGame, dispatchRaid, getModuleCraftReason,
	getModuleInstallReason, getModuleProductionQuote, getModuleRecycleYield,
	getModuleSaleValue, getWeaponStats, installModule, parseSave, queueModuleProduction,
	removeModule, saveGame, type GameState, type WeaponInstance,
} from "../src/game/engine";
import { WEAPONS } from "../src/game/data";
import { FACTORY_KITS, MODULE_BY_ID, MODULE_MODELS, RECEIVER_INFO, type ModuleInstance, type ModuleModel } from "../src/game/modules";
import { useWeaponPlatformFixture } from "./weapon-fixtures";

const NOW = 1_792_000_000_000;
const additions = MODULE_MODELS.slice(207, 381);

function funded(): GameState {
	const state = createGame(NOW);
	state.base.workshop = 4;
	state.money = 100_000;
	state.supplies.scrap = 5_000;
	return state;
}
function craft(state: GameState, modelId: string): ModuleInstance {
	expect(craftModule(state, modelId).ok).toBe(true);
	return state.modules.at(-1)!;
}
function fitGun(model: ModuleModel): { state: GameState; gun: WeaponInstance } {
	const weapon = WEAPONS.find((candidate) => {
		const info = RECEIVER_INFO[candidate.id]!;
		return (model.platforms.includes("*") || model.platforms.includes(info.platform))
			&& (model.calibers.includes("*") || model.calibers.includes(info.caliber))
			&& (!model.requiresMount?.startsWith("rail-") || candidate.category !== "pistol")
			&& (model.requiresMount !== "dovetail" || MODULE_BY_ID[`receiver-${candidate.id}`]!.providesMounts.includes("dovetail"));
	})!;
	expect(weapon).toBeDefined();
	const state = funded(), gun = state.weapons[0]!;
	useWeaponPlatformFixture(state, gun, weapon.id);
	const info = RECEIVER_INFO[weapon.id]!;
	if (model.requiresMount?.startsWith("rail-")) {
		expect(installModule(state, gun.id, craft(state, `handguard-${info.platform}-carbon`).id).ok).toBe(true);
	}
	if (model.requiresMount?.startsWith("thread:") && !Object.values(gun.modules).some((part) => MODULE_BY_ID[part.modelId]!.providesMounts.includes(model.requiresMount!))) {
		expect(installModule(state, gun.id, craft(state, `barrel-${info.platform}-${info.caliber}-heavy`).id).ok).toBe(true);
	}
	return { state, gun };
}

describe("expanded physical module catalogue", () => {
	test("174 new parts retain the original factory kits and remain bounded physical tradeoffs", () => {
		expect(additions).toHaveLength(174);
		expect(MODULE_MODELS).toHaveLength(934);
		expect(new Set(MODULE_MODELS.map((item) => item.id)).size).toBe(MODULE_MODELS.length);
		expect(Object.keys(MODULE_BY_ID)).toHaveLength(MODULE_MODELS.length);
		for (const weapon of WEAPONS) {
			const info = RECEIVER_INFO[weapon.id]!, kit = FACTORY_KITS[weapon.id]!;
			expect(Object.keys(kit)).toEqual(info.requiredSlots);
			for (const slot of info.requiredSlots) {
				expect(kit[slot]).toBe(slot === "receiver" ? `receiver-${weapon.id}` : `factory-${weapon.id}-${slot}`);
				expect(MODULE_BY_ID[kit[slot]!]!.appearance).toBe("factory");
			}
		}
		for (const item of additions) {
			expect(item.slot).not.toBe("receiver");
			expect(item.workshopLevel).toBeGreaterThanOrEqual(1);
			expect(item.workshopLevel).toBeLessThanOrEqual(4);
			expect(item.lootTier).toBeGreaterThanOrEqual(1);
			expect(item.lootTier).toBeLessThanOrEqual(4);
			expect(item.stats.weight).toBeGreaterThan(0);
			expect(item.stats.weight).toBeLessThan(3);
			expect(Object.values(item.stats).every(Number.isFinite)).toBe(true);
			expect(item.stats.ammoMultiplier).toBeGreaterThanOrEqual(.8);
			expect(item.stats.ammoMultiplier).toBeLessThanOrEqual(1.35);
			const instance = { id: "quote", modelId: item.id, durability: 100, foundAt: NOW };
			expect(getModuleSaleValue(instance)).toBeLessThan(item.craftCost.money);
			expect(getModuleRecycleYield(instance)).toBeLessThan(item.craftCost.scrap);
		}
	});

	test("every new model fits an actual existing platform and survives ownership and wear reload", () => {
		for (const model of additions) {
			const { state, gun } = fitGun(model), part = craft(state, model.id);
			part.durability = 63;
			const rng = state.rng, physicalIds = [part.id, ...Object.values(gun.modules).map((installed) => installed.id)];
			expect(getModuleInstallReason(state, gun.id, part.id)).toBeNull();
			expect(installModule(state, gun.id, part.id).ok).toBe(true);
			expect(gun.modules[model.slot]).toEqual(part);
			expect(state.rng).toBe(rng);
			expect([...state.modules, ...Object.values(gun.modules)].map((installed) => installed.id)).toEqual(expect.arrayContaining(physicalIds));
			expect(getWeaponStats(gun).ready).toBe(true);
			expect(parseSave(saveGame(state))).toEqual(state);
		}
	});

	test("crafting and workshop quotes require the real level and pay exact nonprofitable costs", () => {
		for (const model of additions) {
			const state = funded(), bench = state.shelter.rooms.find((room) => room.type === "workshop")!;
			state.base.workshop = model.workshopLevel - 1;
			bench.level = model.workshopLevel - 1;
			const before = saveGame(state);
			expect(getModuleCraftReason(state, model.id)).not.toBeNull();
			expect(craftModule(state, model.id).ok).toBe(false);
			expect(getModuleProductionQuote(state, bench.id, model.id).reason).not.toBeNull();
			expect(saveGame(state)).toBe(before);
			state.base.workshop = model.workshopLevel;
			bench.level = model.workshopLevel;
			const quote = getModuleProductionQuote(state, bench.id, model.id);
			expect(quote.reason).toBeNull();
			expect(quote.money).toBe(model.craftCost.money);
			expect(quote.scrap).toBe(model.craftCost.scrap);
			expect(quote.duration).toBeGreaterThanOrEqual(25);
			const cash = state.money, scrap = state.supplies.scrap;
			craft(state, model.id);
			expect(state.money).toBe(cash - quote.money);
			expect(state.supplies.scrap).toBe(scrap - quote.scrap);
		}
	});

	test("new optics and grips require the precise rail and protect their real parent", () => {
		const state = funded(), gun = state.weapons[0]!;
		const optic = craft(state, "optic-holo"), grip = craft(state, "foregrip-folding");
		const before = saveGame(state);
		expect(installModule(state, gun.id, optic.id).ok).toBe(false);
		expect(installModule(state, gun.id, grip.id).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		expect(installModule(state, gun.id, craft(state, "handguard-sks-vented").id).ok).toBe(true);
		expect(installModule(state, gun.id, grip.id).ok).toBe(true);
		expect(installModule(state, gun.id, optic.id).ok).toBe(false);
		expect(installModule(state, gun.id, craft(state, "handguard-sks-carbon").id).ok).toBe(true);
		expect(installModule(state, gun.id, optic.id).ok).toBe(true);
		const wood = craft(state, "handguard-sks-wood"), mounted = saveGame(state);
		expect(installModule(state, gun.id, wood.id).ok).toBe(false);
		expect(saveGame(state)).toBe(mounted);
		const forged = JSON.parse(mounted);
		forged.weapons[0].modules.handguard.modelId = "handguard-sks-wood";
		expect(parseSave(JSON.stringify(forged))).toBeNull();
	});

	test("new matching caliber and platform restrictions reject atomic and forged swaps", () => {
		const { state, gun } = fitGun(MODULE_BY_ID["barrel-ak-5.45x39-heavy"]!);
		for (const modelId of ["barrel-ak-7.62x39-heavy", "stock-sks-precision", "magazine-ak-7.62x39-drum", "muzzle-9x19-compact-suppressor"]) {
			const part = craft(state, modelId), before = saveGame(state);
			expect(installModule(state, gun.id, part.id).ok).toBe(false);
			expect(saveGame(state)).toBe(before);
			const forged = JSON.parse(before), slot = MODULE_BY_ID[modelId]!.slot;
			if (forged.weapons[0].modules[slot]) forged.weapons[0].modules[slot].modelId = modelId;
			else { forged.weapons[0].modules[slot] = part; forged.modules = forged.modules.filter((item: ModuleInstance) => item.id !== part.id); }
			expect(parseSave(JSON.stringify(forged))).toBeNull();
		}
	});

	test("feed geometry respects detachable drums, pistol magazines, pump tubes and integral barrels", () => {
		const drums = additions.filter((model) => model.appearance === "drum");
		expect(drums).toHaveLength(7);
		expect(drums.every((model) => model.platforms.every((platform) => ["ak", "rpk", "saiga", "vityaz", "kedr", "val"].includes(platform)))).toBe(true);
		expect(MODULE_BY_ID["magazine-mp133-12g-window"]!.label).toContain("Трубчатый");
		expect(MODULE_BY_ID["magazine-pkp-7.62x54-window"]!.label).toContain("ленты");
		expect(MODULE_BY_ID["muzzle-12g-compact-suppressor"]).toBeUndefined();
		expect(MODULE_BY_ID["muzzle-20g-compact-suppressor"]).toBeUndefined();
		const { state, gun } = fitGun(MODULE_BY_ID["barrel-val-9x39-heavy"]!);
		expect(installModule(state, gun.id, craft(state, "barrel-val-9x39-heavy").id).ok).toBe(true);
		const suppressor = craft(state, "muzzle-9x39-compact-suppressor"), before = saveGame(state);
		expect(installModule(state, gun.id, suppressor.id).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
	});

	test("a new integral barrel cannot silently discard the owned external muzzle on a legacy VAL build", () => {
		const { state, gun } = fitGun(MODULE_BY_ID["barrel-val-9x39-heavy"]!);
		const muzzle = craft(state, "muzzle-9x39-compact-suppressor");
		expect(installModule(state, gun.id, muzzle.id).ok).toBe(true);
		const barrel = craft(state, "barrel-val-9x39-heavy"), before = saveGame(state);
		expect(installModule(state, gun.id, barrel.id).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		const forged = JSON.parse(before);
		forged.weapons[0].modules.barrel.modelId = barrel.modelId;
		expect(parseSave(JSON.stringify(forged))).toBeNull();
		expect(removeModule(state, gun.id, "muzzle").ok).toBe(true);
		expect(state.modules.filter((part) => part.id === muzzle.id)).toEqual([muzzle]);
		expect(installModule(state, gun.id, barrel.id).ok).toBe(true);
		expect(gun.modules.muzzle).toBeUndefined();
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("shared VAL and VSS factory components cross-fit without replacing receiver identity or losing physical parts", () => {
		const state = funded(), gun = state.weapons[0]!;
		useWeaponPlatformFixture(state, gun, "asval");
		const original = gun.modules.stock!, vssStock = craft(state, "factory-vss-stock");
		expect(installModule(state, gun.id, vssStock.id).ok).toBe(true);
		expect(gun.modules.stock!.modelId).toBe("factory-vss-stock");
		expect(state.modules.filter((part) => part.id === original.id)).toEqual([original]);
		state.discoveredWeapons.push("vss");
		const wrongReceiver = craft(state, "receiver-vss"), before = saveGame(state);
		expect(installModule(state, gun.id, wrongReceiver.id).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		expect(gun.weaponId).toBe("asval");
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("a control build and a compact build retain different costs, recoil and handling", () => {
		const control = funded(), mobile = funded(), heavyGun = control.weapons[0]!, lightGun = mobile.weapons[0]!;
		for (const modelId of ["barrel-sks-7.62x39-heavy", "handguard-sks-carbon", "stock-sks-precision", "magazine-sks-7.62x39-window", "optic-longscope", "foregrip-bipod", "muzzle-7.62x39-ported"]) {
			expect(installModule(control, heavyGun.id, craft(control, modelId).id).ok).toBe(true);
		}
		for (const modelId of ["barrel-sks-7.62x39-short", "handguard-sks-vented", "stock-sks-skeleton", "magazine-sks-7.62x39-compact", "foregrip-angled", "muzzle-7.62x39-flash"]) {
			expect(installModule(mobile, lightGun.id, craft(mobile, modelId).id).ok).toBe(true);
		}
		const stable = getWeaponStats(heavyGun), handy = getWeaponStats(lightGun);
		expect(stable.damage).toBeGreaterThan(handy.damage);
		expect(stable.recoil).toBeLessThan(handy.recoil);
		expect(stable.ergonomics).toBeLessThan(handy.ergonomics);
		expect(stable.weight).toBeGreaterThan(handy.weight);
		expect(control.money).toBeLessThan(mobile.money);
		expect(handy.ammoMultiplier).toBeLessThan(stable.ammoMultiplier);
	});

	test("paid new-module production reloads and finishes once without creating early parts", () => {
		const state = funded(), bench = state.shelter.rooms.find((room) => room.type === "workshop")!;
		bench.level = 4;
		expect(assignWorker(state, state.scavs[0]!.id, bench.id, NOW).ok).toBe(true);
		for (const modelId of ["optic-longscope", "foregrip-bipod", "handguard-sks-carbon"]) {
			const before = structuredClone(state.modules), quote = getModuleProductionQuote(state, bench.id, modelId), money = state.money;
			expect(queueModuleProduction(state, bench.id, modelId, NOW).ok).toBe(true);
			expect(state.money).toBe(money - quote.money);
			expect(state.modules).toEqual(before);
		}
		const loaded = parseSave(saveGame(state))!;
		expect(loaded).toEqual(state);
		advance(loaded, NOW + 600_000);
		for (const modelId of ["optic-longscope", "foregrip-bipod", "handguard-sks-carbon"]) {
			expect(loaded.modules.filter((part) => part.modelId === modelId)).toHaveLength(1);
		}
		expect(loaded.shelter.rooms.find((room) => room.id === bench.id)!.queue).toHaveLength(0);
		const ids = loaded.modules.map((part) => part.id);
		advance(loaded, NOW + 700_000);
		expect(loaded.modules.map((part) => part.id)).toEqual(ids);
		expect(parseSave(saveGame(loaded))).toEqual(loaded);
	});

	test("larger loot pools preserve deterministic draws across renderer ticks and saves", () => {
		const state = funded();
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		const raid = state.raids[0]!;
		raid.chance = 1;
		const split = parseSave(saveGame(state))!;
		advance(state, raid.endsAt);
		advance(split, NOW + Math.floor((raid.endsAt - NOW) / 2));
		const resumed = parseSave(saveGame(split))!;
		advance(resumed, raid.endsAt);
		expect(resumed).toEqual(state);
		expect(state.raids[0]!.expedition!.cargo.modules.every((part) => Object.hasOwn(MODULE_BY_ID, part.modelId))).toBe(true);
		expect(parseSave(saveGame(state))).toEqual(state);
	});
});
