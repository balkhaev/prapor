import { describe, expect, test } from "bun:test";
import { MAPS, WEAPONS } from "../src/game/data";
import {
	assembleWeapon, craftModule, createGame, disassembleWeapon, dispatchRaid,
	getModuleCraftReason, getModuleInstallReason, getRaidQuote, getWeaponBuildIssues,
	getWeaponStats, installModule, parseSave, removeModule, saveGame,
	type GameState, type WeaponInstance,
} from "../src/game/engine";
import { FACTORY_KITS, getResolvedModuleMounts, MODULE_BY_ID, MODULE_MODELS, RECEIVER_INFO, type ModuleInstance, type ModuleModel } from "../src/game/modules";
import { getWeaponMechanics, getWeaponRouteEffect } from "../src/game/weapon-mechanics";
import { useWeaponPlatformFixture } from "./weapon-fixtures";

const NOW = 1_792_000_000_000;
const newGuns = ["m4a1", "hk416", "p90", "mp7", "ump45", "m1911", "mcx", "scarh", "trg42"];
const expectedCalibers = ["5.56x45", "5.56x45", "5.7x28", "4.6x30", ".45acp", ".45acp", ".300blk", "7.62x51", ".338lapua"];
const additions = MODULE_MODELS.slice(411, 621);

function funded(): GameState {
	const state = createGame(NOW);
	state.base.workshop = 4;
	state.money = 100_000;
	state.supplies.scrap = 5_000;
	return state;
}
function craft(state: GameState, modelId: string): ModuleInstance {
	const result = craftModule(state, modelId);
	expect(result.ok).toBe(true);
	return state.modules.at(-1)!;
}
function factory(state: GameState, weaponId: string): WeaponInstance {
	const gun = state.weapons[0]!;
	gun.durability = 100;
	useWeaponPlatformFixture(state, gun, weaponId);
	return gun;
}
function build(state: GameState, weaponId: string): WeaponInstance {
	state.discoveredWeapons.push(weaponId);
	const receiver = craft(state, `receiver-${weaponId}`);
	expect(assembleWeapon(state, receiver.id).ok).toBe(true);
	const gun = state.weapons.at(-1)!;
	for (const slot of RECEIVER_INFO[weaponId]!.requiredSlots) {
		if (slot !== "receiver") expect(installModule(state, gun.id, craft(state, FACTORY_KITS[weaponId]![slot]!).id).ok).toBe(true);
	}
	return gun;
}
function matchingGun(part: ModuleModel): string {
	return newGuns.find((weaponId) => {
		const info = RECEIVER_INFO[weaponId]!;
		return (!part.weaponId || part.weaponId === weaponId) && (part.platforms.includes("*") || part.platforms.includes(info.platform)) && (part.calibers.includes("*") || part.calibers.includes(info.caliber));
	})!;
}

describe("expanded modular arsenal", () => {
	test("nine new weapons add seven calibers without changing the original definitions", () => {
		expect(WEAPONS.slice(16, 25).map((weapon) => weapon.id)).toEqual(newGuns);
		expect(newGuns.map((weaponId) => RECEIVER_INFO[weaponId]!.caliber)).toEqual(expectedCalibers);
		expect(new Set(WEAPONS.slice(0, 25).map((weapon) => RECEIVER_INFO[weapon.id]!.caliber)).size).toBe(16);
		expect(WEAPONS.slice(0, 16).map((weapon) => [weapon.id, weapon.power, weapon.reliability, weapon.value])).toEqual([
			["pm", 15, 82, 70], ["tt", 20, 73, 90], ["toz", 24, 68, 110], ["mp133", 32, 80, 185],
			["pp91", 34, 78, 210], ["sks", 38, 87, 245], ["ak74", 47, 89, 390], ["saiga", 49, 77, 420],
			["vityaz", 44, 90, 360], ["mosin", 52, 84, 460], ["akm", 61, 86, 690], ["vss", 66, 82, 850],
			["rpk", 69, 88, 930], ["svd", 72, 91, 1060], ["asval", 83, 92, 1700], ["pkp", 92, 94, 2200],
		]);
		for (const weaponId of newGuns) expect(MAPS.some((map) => map.level >= 2 && map.weapons.includes(weaponId))).toBe(true);
		expect(MAPS[0]!.weapons.some((weaponId) => newGuns.includes(weaponId))).toBe(false);
	});

	test("210 appended modules cover the real platforms and keep unique physical recipes", () => {
		expect(additions).toHaveLength(210);
		expect(MODULE_MODELS.slice(0, 621)).toHaveLength(621);
		expect(MODULE_MODELS[410]!.id).toBe("laser-precision");
		expect(MODULE_MODELS[411]!.id).toBe("receiver-m4a1");
		expect(new Set(MODULE_MODELS.map((part) => part.id)).size).toBe(MODULE_MODELS.length);
		for (const part of additions) {
			expect(Object.values(part.stats).every(Number.isFinite)).toBe(true);
			expect(part.stats.weight).toBeGreaterThan(0);
			expect(part.stats.ammoMultiplier).toBeGreaterThan(0);
			expect(part.craftCost.money).toBeGreaterThan(part.value);
			expect(matchingGun(part)).toBeDefined();
		}
		for (const weaponId of newGuns) {
			const info = RECEIVER_INFO[weaponId]!;
			expect(Object.keys(FACTORY_KITS[weaponId]!)).toEqual(info.requiredSlots);
			for (const style of ["short", "long", "heavy", "fluted"]) expect(MODULE_BY_ID[`barrel-${info.platform}-${info.caliber}-${style}`]).toBeDefined();
			for (const style of ["extended", "quick", "window", "compact"]) expect(MODULE_BY_ID[`magazine-${info.platform}-${info.caliber}-${style}`]).toBeDefined();
			for (const style of ["brake", "suppressor", "flash", "ported", "compact-suppressor"]) expect(MODULE_BY_ID[`muzzle-${info.caliber}-${style}`]).toBeDefined();
		}
	});

	test("every new model installs in a compatible complete gun and retains paid ownership on reload", () => {
		for (const model of additions) {
			const state = funded(), gun = factory(state, matchingGun(model));
			const cash = state.money, scrap = state.supplies.scrap;
			const part = craft(state, model.id);
			part.durability = 64;
			expect(state.money).toBe(cash - model.craftCost.money);
			expect(state.supplies.scrap).toBe(scrap - model.craftCost.scrap);
			const rng = state.rng, ids = [part.id, ...Object.values(gun.modules).map((item) => item.id)];
			expect(getModuleInstallReason(state, gun.id, part.id)).toBeNull();
			expect(installModule(state, gun.id, part.id).ok).toBe(true);
			expect(gun.modules[model.slot]).toEqual(part);
			expect(getWeaponBuildIssues(gun)).toEqual([]);
			expect(getWeaponStats(gun).ready).toBe(true);
			expect(state.rng).toBe(rng);
			expect([...state.modules, ...Object.values(gun.modules)].map((item) => item.id)).toEqual(expect.arrayContaining(ids));
			expect(parseSave(saveGame(state))).toEqual(state);
		}
	});

	test("new platforms are crafted from a discovered receiver, disassembled and rebuilt with the same parts", () => {
		for (const weaponId of newGuns) {
			const state = funded();
			expect(getModuleCraftReason(state, `receiver-${weaponId}`)).toContain("найди");
			const gun = build(state, weaponId);
			expect(getWeaponStats(gun).ready).toBe(true);
			const parts = structuredClone(gun.modules);
			expect(disassembleWeapon(state, gun.id).ok).toBe(true);
			for (const part of Object.values(parts)) expect(state.modules.filter((item) => item.id === part.id)).toEqual([part]);
			expect(assembleWeapon(state, parts.receiver!.id).ok).toBe(true);
			const rebuilt = state.weapons.at(-1)!;
			for (const slot of RECEIVER_INFO[weaponId]!.requiredSlots) if (slot !== "receiver") expect(installModule(state, rebuilt.id, parts[slot]!.id).ok).toBe(true);
			expect(rebuilt.modules).toEqual(parts);
			expect(getWeaponStats(rebuilt).ready).toBe(true);
			expect(parseSave(saveGame(state))).toEqual(state);
		}
	});

	test("M4 and HK416 share modular AR components while MCX and mismatched calibers reject swaps atomically", () => {
		const state = funded(), gun = factory(state, "m4a1");
		for (const slot of ["barrel", "handguard", "stock", "magazine"] as const) {
			const part = craft(state, FACTORY_KITS.hk416![slot]!);
			expect(installModule(state, gun.id, part.id).ok).toBe(true);
		}
		expect(gun.weaponId).toBe("m4a1");
		for (const modelId of ["receiver-hk416", "barrel-mcx-.300blk-long", "magazine-scar-7.62x51-window", "muzzle-7.62x51-suppressor"]) {
			if (modelId.startsWith("receiver-")) state.discoveredWeapons.push("hk416");
			const part = craft(state, modelId), before = saveGame(state);
			expect(installModule(state, gun.id, part.id).ok).toBe(false);
			expect(saveGame(state)).toBe(before);
		}
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("P90 horizontal feed, MP7 grip feed and the M1911 bridge expose actual rooted attachment sockets", () => {
		expect(RECEIVER_INFO.p90!.feedGeometry).toBe("horizontal");
		expect(RECEIVER_INFO.mp7!.feedGeometry).toBe("grip");
		expect(RECEIVER_INFO.trg42!.action).toBe("bolt");
		expect(RECEIVER_INFO.m1911!.requiredSlots).toEqual(["receiver", "barrel", "magazine"]);
		expect(MODULE_BY_ID["stock-p90-folding"]).toBeUndefined();
		expect(MODULE_BY_ID["magazine-p90-5.7x28-drum"]).toBeUndefined();
		const p90State = funded(), p90 = factory(p90State, "p90");
		expect(MODULE_BY_ID[p90.modules.magazine!.modelId]!.label).toContain("горизонтальный");
		expect(installModule(p90State, p90.id, craft(p90State, "flashlight-mini").id).ok).toBe(true);
		const lightGuard = craft(p90State, "handguard-p90-light"), before = saveGame(p90State);
		expect(installModule(p90State, p90.id, lightGuard.id).ok).toBe(false);
		expect(saveGame(p90State)).toBe(before);
		const state = funded(), pistol = factory(state, "m1911"), optic = craft(state, "optic-reflex");
		expect(getResolvedModuleMounts(pistol.modules)).toContain("pistol-rail");
		expect(installModule(state, pistol.id, optic.id).ok).toBe(false);
		expect(installModule(state, pistol.id, craft(state, "mount-1911-bridge").id).ok).toBe(true);
		expect(installModule(state, pistol.id, optic.id).ok).toBe(true);
		expect(installModule(state, pistol.id, craft(state, "flashlight-mini").id).ok).toBe(true);
		expect(installModule(state, pistol.id, craft(state, "laser-micro").id).ok).toBe(true);
		expect(installModule(state, pistol.id, craft(state, "foregrip-vertical").id).ok).toBe(false);
		const mounted = saveGame(state);
		expect(removeModule(state, pistol.id, "mount").ok).toBe(false);
		expect(saveGame(state)).toBe(mounted);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("new tactical affinities retain distinct bounded niches and TRG logistics cost in an actual quote", () => {
		const state = funded(), gun = factory(state, "m4a1");
		state.level = 10;
		const scav = state.scavs[0]!;
		const forest = MAPS.find((map) => map.id === "forest")!;
		const m4Cost = getRaidQuote(state, scav, forest).ammo;
		factory(state, "trg42");
		expect(getRaidQuote(state, scav, forest).ammo).toBeGreaterThan(m4Cost);
		expect(getWeaponStats(gun).weight).toBe(7.8);
		const p90State = funded(), p90 = factory(p90State, "p90");
		expect(getWeaponRouteEffect(p90, "factory", "combat", "balanced", getWeaponStats(p90)).bonus).toBeGreaterThan(getWeaponRouteEffect(gun, "factory", "combat", "balanced", getWeaponStats(gun)).bonus);
		expect(getWeaponRouteEffect(gun, "forest", "recon", "cautious", getWeaponStats(gun)).bonus).toBeGreaterThan(getWeaponRouteEffect(p90, "forest", "recon", "cautious", getWeaponStats(p90)).bonus);
		for (const weaponId of newGuns) {
			const scopedState = funded(), weapon = factory(scopedState, weaponId), stats = getWeaponStats(weapon), mechanics = getWeaponMechanics(weapon);
			expect(stats.ready).toBe(true);
			expect(mechanics.label.length).toBeGreaterThan(0);
			for (const map of MAPS) for (const branch of ["scavenge", "combat", "recon"] as const) {
				const effect = getWeaponRouteEffect(weapon, map.id, branch, "balanced", stats);
				expect(Number.isFinite(effect.bonus)).toBe(true);
				expect(Math.abs(effect.bonus)).toBeLessThanOrEqual(.12);
			}
		}
	});

	test("an actual dispatched new gun locks every installed slot and preserves its physical modules in the save", () => {
		for (const weaponId of newGuns) {
			const state = funded(), gun = factory(state, weaponId), scav = state.scavs[0]!;
			const extra = craft(state, `barrel-${RECEIVER_INFO[weaponId]!.platform}-${RECEIVER_INFO[weaponId]!.caliber}-long`);
			expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
			const locked = saveGame(state);
			expect(installModule(state, gun.id, extra.id).ok).toBe(false);
			expect(removeModule(state, gun.id, "barrel").ok).toBe(false);
			expect(disassembleWeapon(state, gun.id).ok).toBe(false);
			expect(saveGame(state)).toBe(locked);
			expect(parseSave(locked)).toEqual(state);
		}
	});
});
