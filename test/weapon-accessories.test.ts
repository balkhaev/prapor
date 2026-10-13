import { describe, expect, test } from "bun:test";
import {
	advance, assignWorker, craftModule, createGame, dispatchRaid, extractRaid, getModuleCraftReason, getModuleInstallReason,
	getModuleProductionQuote, getModuleRecycleYield, getModuleRemoveReason, getModuleSaleValue, getWeaponStats,
	installModule, parseSave, queueModuleProduction, removeModule, saveGame, type GameState, type WeaponInstance,
} from "../src/game/engine";
import {
	getResolvedModuleMounts, MODULE_BY_ID, MODULE_MODELS, MODULE_SLOTS, RECEIVER_INFO,
	type ModuleInstance, type ModuleModel,
} from "../src/game/modules";
import { useWeaponPlatformFixture } from "./weapon-fixtures";

const NOW = 1_792_000_000_000;
const accessories = MODULE_MODELS.slice(381);
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
function install(state: GameState, gun: WeaponInstance, modelId: string): ModuleInstance {
	const part = craft(state, modelId);
	expect(getModuleInstallReason(state, gun.id, part.id)).toBeNull();
	expect(installModule(state, gun.id, part.id).ok).toBe(true);
	return part;
}
function litSks() {
	const state = funded(), gun = state.weapons[0]!;
	install(state, gun, "mount-barrel-ring");
	install(state, gun, "flashlight-mini");
	install(state, gun, "laser-micro");
	return { state, gun };
}

describe("rooted weapon accessory connections", () => {
	test("30 new physical parts append to all 381 existing IDs with independent optional slots and meaningful costs", () => {
		expect(MODULE_MODELS).toHaveLength(411);
		expect(accessories).toHaveLength(30);
		expect(accessories.filter((part) => part.slot === "mount")).toHaveLength(14);
		expect(accessories.filter((part) => part.slot === "flashlight")).toHaveLength(8);
		expect(accessories.filter((part) => part.slot === "laser")).toHaveLength(8);
		expect(MODULE_SLOTS.slice(8)).toEqual(["mount", "flashlight", "laser"]);
		expect(new Set(MODULE_MODELS.map((part) => part.id)).size).toBe(411);
		for (const info of Object.values(RECEIVER_INFO)) {
			for (const slot of ["mount", "flashlight", "laser"] as const) expect(info.requiredSlots).not.toContain(slot);
		}
		for (const part of accessories) {
			expect(part.requiresMount).not.toBeNull();
			expect(part.providesMounts).not.toContain(part.requiresMount!);
			expect(part.stats.weight).toBeGreaterThan(0);
			expect(part.stats.ammoMultiplier).toBe(1);
			expect(part.workshopLevel).toBeGreaterThanOrEqual(1);
			expect(part.workshopLevel).toBeLessThanOrEqual(4);
			expect(part.lootTier).toBe(part.workshopLevel);
			const instance = { id: "quote", modelId: part.id, durability: 100, foundAt: NOW };
			expect(getModuleSaleValue(instance)).toBeLessThan(part.craftCost.money);
			expect(getModuleRecycleYield(instance)).toBeLessThan(part.craftCost.scrap);
		}
	});

	test("every accessory really installs on an existing rooted platform and survives wear and ownership reload", () => {
		for (const model of accessories) {
			const state = funded(), gun = state.weapons[0]!;
			if (model.requiresMount === "dovetail") useWeaponPlatformFixture(state, gun, "ak74");
			if (["rail-top", "rail-bottom"].includes(model.requiresMount!)) install(state, gun, "handguard-sks-carbon");
			if (model.requiresMount === "rail-side") install(state, gun, "mount-barrel-ring");
			const part = craft(state, model.id);
			part.durability = 61;
			const oldIds = Object.values(gun.modules).map((item) => item.id), rng = state.rng;
			expect(getModuleInstallReason(state, gun.id, part.id)).toBeNull();
			expect(installModule(state, gun.id, part.id).ok).toBe(true);
			expect(gun.modules[model.slot]).toBe(part);
			expect(Object.values(gun.modules).map((item) => item.id)).toEqual(expect.arrayContaining(oldIds));
			expect(getWeaponStats(gun).ready).toBe(true);
			expect(state.rng).toBe(rng);
			expect(parseSave(saveGame(state))).toEqual(state);
		}
	});

	test("a flashlight and laser need a real side rail and coexist with each other and the separate foregrip", () => {
		const state = funded(), gun = state.weapons[0]!;
		const light = craft(state, "flashlight-mini"), laser = craft(state, "laser-micro"), initial = saveGame(state);
		expect(installModule(state, gun.id, light.id).ok).toBe(false);
		expect(installModule(state, gun.id, laser.id).ok).toBe(false);
		expect(saveGame(state)).toBe(initial);
		const base = getWeaponStats(gun);
		install(state, gun, "handguard-sks-carbon");
		install(state, gun, "foregrip-stubby");
		expect(installModule(state, gun.id, light.id).ok).toBe(true);
		expect(installModule(state, gun.id, laser.id).ok).toBe(true);
		expect(gun.modules.flashlight).toBe(light);
		expect(gun.modules.laser).toBe(laser);
		expect(gun.modules.foregrip!.modelId).toBe("foregrip-stubby");
		expect(getWeaponStats(gun).damage).toBe(base.damage + 2);
		expect(getWeaponStats(gun).ammoMultiplier).toBe(base.ammoMultiplier);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("a dovetail adapter creates a real top and side rail and cannot be removed under its three children", () => {
		const state = funded(), gun = state.weapons[0]!;
		useWeaponPlatformFixture(state, gun, "ak74");
		const optic = craft(state, "optic-reflex"), before = saveGame(state);
		expect(installModule(state, gun.id, optic.id).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		install(state, gun, "mount-dovetail-high");
		expect(installModule(state, gun.id, optic.id).ok).toBe(true);
		install(state, gun, "flashlight-armored");
		install(state, gun, "laser-precision");
		expect(getResolvedModuleMounts(gun.modules)).toEqual(expect.arrayContaining(["dovetail", "rail-top", "rail-side"]));
		const mounted = saveGame(state), replacement = craft(state, "mount-barrel-ring"), swap = saveGame(state);
		expect(removeModule(state, gun.id, "mount").ok).toBe(false);
		expect(installModule(state, gun.id, replacement.id).ok).toBe(false);
		expect(saveGame(state)).toBe(swap);
		for (const slot of ["optic", "flashlight", "laser"] as const) expect(removeModule(state, gun.id, slot).ok).toBe(true);
		expect(removeModule(state, gun.id, "mount").ok).toBe(true);
		expect(getResolvedModuleMounts(gun.modules)).not.toContain("rail-top");
		expect(parseSave(mounted)).not.toBeNull();
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("a barrel clamp protects its real barrel yet permits a rooted barrel replacement without losing accessories", () => {
		const { state, gun } = litSks(), mounted = saveGame(state), attached = structuredClone({ mount: gun.modules.mount, flashlight: gun.modules.flashlight, laser: gun.modules.laser });
		expect(getModuleRemoveReason(state, gun.id, "barrel")).toContain("Сначала сними");
		expect(removeModule(state, gun.id, "barrel").ok).toBe(false);
		expect(saveGame(state)).toBe(mounted);
		const oldBarrel = gun.modules.barrel!;
		install(state, gun, "barrel-sks-7.62x39-fluted");
		expect(state.modules.filter((part) => part.id === oldBarrel.id)).toEqual([oldBarrel]);
		expect({ mount: gun.modules.mount, flashlight: gun.modules.flashlight, laser: gun.modules.laser }).toEqual(attached);
		expect(getWeaponStats(gun).ready).toBe(true);
		for (const slot of ["flashlight", "laser", "mount", "barrel"] as const) expect(removeModule(state, gun.id, slot).ok).toBe(true);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("a lower rail adapter blocks replacement and removal of the source under the entire dependency chain", () => {
		const state = funded(), gun = state.weapons[0]!;
		install(state, gun, "handguard-sks-vented");
		install(state, gun, "mount-bottom-offset");
		install(state, gun, "flashlight-scout");
		install(state, gun, "laser-offset");
		const wood = craft(state, "handguard-sks-wood"), before = saveGame(state);
		expect(installModule(state, gun.id, wood.id).ok).toBe(false);
		expect(removeModule(state, gun.id, "handguard").ok).toBe(false);
		expect(removeModule(state, gun.id, "mount").ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		for (const slot of ["flashlight", "laser", "mount"] as const) expect(removeModule(state, gun.id, slot).ok).toBe(true);
		expect(installModule(state, gun.id, wood.id).ok).toBe(true);
		expect(getResolvedModuleMounts(gun.modules)).not.toContain("rail-side");
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("pistols and integral VAL barrels have no invented clamp or side rail while real long guns do", () => {
		for (const weaponId of ["pm", "tt", "vss", "asval"]) {
			const state = funded(), gun = state.weapons[0]!;
			useWeaponPlatformFixture(state, gun, weaponId);
			expect(getResolvedModuleMounts(gun.modules)).not.toContain("barrel-clamp");
			const clamp = craft(state, "mount-barrel-ring"), before = saveGame(state);
			expect(installModule(state, gun.id, clamp.id).ok).toBe(false);
			expect(saveGame(state)).toBe(before);
		}
		for (const weaponId of ["toz", "mp133", "sks", "mosin", "pkp"]) {
			const state = funded(), gun = state.weapons[0]!;
			useWeaponPlatformFixture(state, gun, weaponId);
			install(state, gun, weaponId === "toz" ? "mount-barrel-ring" : "mount-barrel-dual");
			install(state, gun, "flashlight-long");
			install(state, gun, "laser-box");
			expect(getWeaponStats(gun).ready).toBe(true);
			expect(parseSave(saveGame(state))).toEqual(state);
		}
	});

	test("short barrels expose no new clamp socket and compact wide clamps need a real longer barrel", () => {
		for (const weaponId of ["toz", "pp91", "sks", "ak74", "rpk"]) {
			const state = funded(), gun = state.weapons[0]!;
			useWeaponPlatformFixture(state, gun, weaponId);
			const info = RECEIVER_INFO[weaponId]!;
			install(state, gun, `barrel-${info.platform}-${info.caliber}-short`);
			for (const clampId of ["mount-barrel-ring", "mount-barrel-offset", "mount-barrel-dual", "mount-barrel-long"]) {
				const clamp = craft(state, clampId), before = saveGame(state);
				expect(installModule(state, gun.id, clamp.id).ok).toBe(false);
				expect(saveGame(state)).toBe(before);
			}
			expect(getResolvedModuleMounts(gun.modules)).not.toContain("barrel-clamp");
			expect(getResolvedModuleMounts(gun.modules)).not.toContain("barrel-clamp-wide");
		}
		for (const weaponId of ["toz", "pp91"]) {
			const state = funded(), gun = state.weapons[0]!;
			useWeaponPlatformFixture(state, gun, weaponId);
			const info = RECEIVER_INFO[weaponId]!, wide = craft(state, "mount-barrel-long");
			expect(getResolvedModuleMounts(gun.modules)).toContain("barrel-clamp");
			expect(getModuleInstallReason(state, gun.id, wide.id)).toContain("широкого хомута");
			install(state, gun, `barrel-${info.platform}-${info.caliber}-heavy`);
			expect(getModuleInstallReason(state, gun.id, wide.id)).not.toBeNull();
			install(state, gun, `barrel-${info.platform}-${info.caliber}-fluted`);
			expect(getResolvedModuleMounts(gun.modules)).toContain("barrel-clamp-wide");
			expect(installModule(state, gun.id, wide.id).ok).toBe(true);
			install(state, gun, "flashlight-mini");
			install(state, gun, "laser-micro");
			const forged = JSON.parse(saveGame(state));
			forged.weapons[0].modules.barrel.modelId = `factory-${weaponId}-barrel`;
			expect(parseSave(JSON.stringify(forged))).toBeNull();
			for (const appearance of ["short", "heavy"]) {
				const shorter = craft(state, `barrel-${info.platform}-${info.caliber}-${appearance}`), before = saveGame(state);
				expect(installModule(state, gun.id, shorter.id).ok).toBe(false);
				expect(saveGame(state)).toBe(before);
			}
			install(state, gun, `barrel-${info.platform}-${info.caliber}-long`);
			expect(gun.modules.mount).toBe(wide);
			expect(parseSave(saveGame(state))).toEqual(state);
		}
	});

	test("mount resolution excludes a removed source, unknown models and parts put into false slots", () => {
		const { gun } = litSks();
		expect(getResolvedModuleMounts(gun.modules)).toContain("rail-side");
		expect(getResolvedModuleMounts(gun.modules, "barrel")).not.toContain("rail-side");
		expect(getResolvedModuleMounts({ mount: gun.modules.mount })).toEqual([]);
		expect(getResolvedModuleMounts({ mount: { ...gun.modules.mount!, modelId: "mount-top-offset" } })).toEqual([]);
		expect(getResolvedModuleMounts({ mount: gun.modules.barrel })).toEqual([]);
		expect(getResolvedModuleMounts({ receiver: { ...gun.modules.barrel!, modelId: "constructor" } })).toEqual([]);
	});

	test("adapters cannot bootstrap themselves or each other through a cycle without a real rail", () => {
		const template = MODULE_BY_ID["mount-top-offset"]!;
		const synthetic: ModuleModel[] = [
			{ ...template, id: "test-accessory-cycle-a", slot: "mount", requiresMount: "rail-side", providesMounts: ["rail-top"] },
			{ ...template, id: "test-accessory-cycle-b", slot: "flashlight", requiresMount: "rail-top", providesMounts: ["rail-side"] },
		];
		try {
			for (const model of synthetic) MODULE_BY_ID[model.id] = model;
			const parts = { mount: { id: "a", modelId: synthetic[0]!.id, durability: 100, foundAt: NOW }, flashlight: { id: "b", modelId: synthetic[1]!.id, durability: 100, foundAt: NOW } };
			expect(getResolvedModuleMounts(parts)).toEqual([]);
			const actualRail = { id: "real", modelId: "handguard-sks-carbon", durability: 100, foundAt: NOW };
			expect(getResolvedModuleMounts({ ...parts, handguard: actualRail })).toEqual(expect.arrayContaining(["rail-top", "rail-side"]));
			expect(getResolvedModuleMounts({ ...parts, handguard: actualRail }, "handguard")).toEqual([]);
		} finally {
			for (const model of synthetic) delete MODULE_BY_ID[model.id];
		}
	});

	test("reload accepts old builds with no new slots and rejects forged missing adapter sources and wrong slots", () => {
		const old = createGame(NOW);
		expect(old.weapons.every((gun) => !gun.modules.mount && !gun.modules.flashlight && !gun.modules.laser)).toBe(true);
		expect(parseSave(saveGame(old))).toEqual(old);
		const { state } = litSks(), valid = saveGame(state);
		for (const slot of ["barrel", "mount"] as const) {
			const forged = JSON.parse(valid);
			delete forged.weapons[0].modules[slot];
			expect(parseSave(JSON.stringify(forged))).toBeNull();
		}
		const wrong = JSON.parse(valid);
		wrong.weapons[0].modules.flashlight.modelId = "laser-micro";
		expect(parseSave(JSON.stringify(wrong))).toBeNull();
		expect(parseSave(valid)).toEqual(state);
	});

	test("all 30 accessories require their actual workshop level and pay exact bounded costs", () => {
		for (const model of accessories) {
			const state = funded(), room = state.shelter.rooms.find((candidate) => candidate.type === "workshop")!;
			state.base.workshop = room.level = model.workshopLevel - 1;
			const initial = saveGame(state);
			expect(getModuleCraftReason(state, model.id)).not.toBeNull();
			expect(craftModule(state, model.id).ok).toBe(false);
			expect(getModuleProductionQuote(state, room.id, model.id).reason).not.toBeNull();
			expect(saveGame(state)).toBe(initial);
			state.base.workshop = room.level = model.workshopLevel;
			const quote = getModuleProductionQuote(state, room.id, model.id), money = state.money, scrap = state.supplies.scrap;
			expect(quote.reason).toBeNull();
			expect(quote.duration).toBeGreaterThanOrEqual(25);
			expect(quote.money).toBe(model.craftCost.money);
			expect(quote.scrap).toBe(model.craftCost.scrap);
			craft(state, model.id);
			expect(state.money).toBe(money - quote.money);
			expect(state.supplies.scrap).toBe(scrap - quote.scrap);
		}
	});

	test("paid mount, light and laser orders persist and finish once without minting premature parts", () => {
		const state = funded(), room = state.shelter.rooms.find((candidate) => candidate.type === "workshop")!;
		room.level = 4;
		expect(assignWorker(state, state.scavs[0]!.id, room.id, NOW).ok).toBe(true);
		for (const modelId of ["mount-dovetail-bridge", "flashlight-focus", "laser-range"]) {
			const before = structuredClone(state.modules), quote = getModuleProductionQuote(state, room.id, modelId), money = state.money;
			expect(queueModuleProduction(state, room.id, modelId, NOW).ok).toBe(true);
			expect(state.money).toBe(money - quote.money);
			expect(state.modules).toEqual(before);
		}
		const loaded = parseSave(saveGame(state))!;
		expect(loaded).toEqual(state);
		advance(loaded, NOW + 600_000);
		for (const modelId of ["mount-dovetail-bridge", "flashlight-focus", "laser-range"]) expect(loaded.modules.filter((part) => part.modelId === modelId)).toHaveLength(1);
		expect(loaded.shelter.rooms.find((candidate) => candidate.id === room.id)!.queue).toHaveLength(0);
		const ids = loaded.modules.map((part) => part.id);
		advance(loaded, NOW + 700_000);
		expect(loaded.modules.map((part) => part.id)).toEqual(ids);
		expect(parseSave(saveGame(loaded))).toEqual(loaded);
	});

	test("a deployed gun locks its attached devices and their replacements atomically", () => {
		const { state, gun } = litSks(), replacement = craft(state, "flashlight-focus");
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		const active = saveGame(state);
		expect(installModule(state, gun.id, replacement.id).ok).toBe(false);
		for (const slot of ["mount", "flashlight", "laser"] as const) expect(removeModule(state, gun.id, slot).ok).toBe(false);
		expect(saveGame(state)).toBe(active);
		expect(parseSave(active)).toEqual(state);
	});

	test("new devices actually enter raid loot, survive reload and become usable only after one extraction", () => {
		let state: GameState | undefined;
		for (let seed = 1; seed <= 256; seed++) {
			const candidate = funded();
			expect(dispatchRaid(candidate, candidate.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
			const raid = candidate.raids[0]!;
			raid.seed = seed;
			raid.chance = 1;
			advance(candidate, raid.endsAt);
			if (raid.expedition!.cargo.modules.some((part) => ["mount", "flashlight", "laser"].includes(MODULE_BY_ID[part.modelId]!.slot))) {
				state = candidate;
				break;
			}
		}
		expect(state).toBeDefined();
		if (!state) throw new Error("The deterministic accessory loot search found no accessory.");
		const loaded = parseSave(saveGame(state))!, raid = loaded.raids[0]!;
		expect(loaded).toEqual(state);
		const found = raid.expedition!.cargo.modules.find((part) => ["mount", "flashlight", "laser"].includes(MODULE_BY_ID[part.modelId]!.slot))!;
		expect(MODULE_BY_ID[found.modelId]!.lootTier).toBeLessThanOrEqual(raid.expedition!.stage);
		const beforeExtraction = saveGame(loaded);
		expect(installModule(loaded, loaded.weapons[1]!.id, found.id).ok).toBe(false);
		expect(saveGame(loaded)).toBe(beforeExtraction);
		expect(extractRaid(loaded, raid.id, loaded.lastUpdated).ok).toBe(true);
		expect(loaded.modules.filter((part) => part.id === found.id)).toEqual([found]);
		const extracted = saveGame(loaded);
		expect(extractRaid(loaded, raid.id, loaded.lastUpdated).ok).toBe(false);
		expect(saveGame(loaded)).toBe(extracted);
		expect(parseSave(extracted)).toEqual(loaded);
	});
});
