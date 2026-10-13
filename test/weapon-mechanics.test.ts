import { describe, expect, test } from "bun:test";
import { MAPS, WEAPONS } from "../src/game/data";
import { createGame, dispatchRaid, getExpeditionChoices, getRaidQuote, getWeaponBuildIssues, getWeaponStats, saveGame, type WeaponInstance } from "../src/game/engine";
import { FACTORY_KITS, getResolvedModuleMounts, MODULE_BY_ID, MODULE_MODELS, RECEIVER_INFO, type ModuleInstance, type ModuleModel } from "../src/game/modules";
import { TACTICS, type RaidTactic } from "../src/game/operations";
import { EXPEDITION_BRANCHES, type ExpeditionBranch } from "../src/game/systems";
import { getWeaponMechanics, getWeaponRouteEffect } from "../src/game/weapon-mechanics";

const NOW = 1_792_000_000_000;
const branches = Object.keys(EXPEDITION_BRANCHES) as ExpeditionBranch[];
const tactics = Object.keys(TACTICS) as RaidTactic[];

function factory(weaponId = "sks"): WeaponInstance {
	const weapon = structuredClone(createGame(NOW).weapons[0]!);
	weapon.weaponId = weaponId;
	weapon.durability = 100;
	weapon.attachments = { optic: 0, magazine: 0, stock: 0 };
	weapon.modules = Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId]) => [slot,
		{ id: `fixture-${slot}`, modelId, durability: 100, foundAt: NOW } satisfies ModuleInstance]));
	return weapon;
}
function attach(weapon: WeaponInstance, modelId: string, durability = 100) {
	const model = MODULE_BY_ID[modelId]!;
	weapon.modules[model.slot] = { id: `fixture-${model.slot}`, modelId, durability, foundAt: NOW };
	return weapon;
}
function railed(weaponId = "sks") {
	const weapon = factory(weaponId);
	return attach(weapon, `handguard-${RECEIVER_INFO[weaponId]!.platform}-carbon`);
}
function effect(weapon: WeaponInstance, map = "courtyard", branch: ExpeditionBranch = "combat", tactic: RaidTactic = "balanced") {
	return getWeaponRouteEffect(weapon, map, branch, tactic, getWeaponStats(weapon));
}
function buildFor(model: ModuleModel): WeaponInstance {
	const candidates = [...WEAPONS].sort((a, b) => Number(b.id === "sks") - Number(a.id === "sks"));
	for (const definition of candidates) {
		if (model.weaponId && model.weaponId !== definition.id) continue;
		const info = RECEIVER_INFO[definition.id]!;
		if (!model.platforms.includes("*") && !model.platforms.includes(info.platform)) continue;
		if (!model.calibers.includes("*") && !model.calibers.includes(info.caliber)) continue;
		const weapon = factory(definition.id);
		if (model.requiresMount) {
			const carbon = `handguard-${info.platform}-carbon`;
			if (MODULE_BY_ID[carbon]) attach(weapon, carbon);
			const barrel = `barrel-${info.platform}-${info.caliber}-long`;
			if (MODULE_BY_ID[barrel]) attach(weapon, barrel);
		}
		attach(weapon, model.id);
		if (getWeaponBuildIssues(weapon).length === 0) return weapon;
	}
	throw new Error(`No rooted, usable fixture for ${model.id}`);
}

describe("weapon mechanics and contextual loadout balance", () => {
	test("all 16 factory weapons have explicit, bounded profiles and different tactical roles", () => {
		const signatures = new Set<string>();
		for (const definition of WEAPONS) {
			const weapon = factory(definition.id), profile = getWeaponMechanics(weapon);
			expect(profile.label.length).toBeGreaterThan(0);
			for (const value of [profile.closeBonus, profile.rangeBonus, profile.stealthBonus, profile.illumination,
				profile.targeting, profile.reloadBonus, profile.supportBonus]) {
				expect(Number.isFinite(value)).toBe(true);
				expect(Math.abs(value)).toBeLessThanOrEqual(.12);
			}
			expect(profile.wearMultiplier).toBeGreaterThan(0);
			expect(getWeaponStats(weapon).ready).toBe(true);
			signatures.add(JSON.stringify([profile.closeBonus, profile.rangeBonus, profile.stealthBonus, profile.supportBonus, profile.wearMultiplier]));
		}
		expect(WEAPONS).toHaveLength(16);
		expect(signatures.size).toBe(16);
		expect(effect(factory("pp91"), "factory").bonus).toBeGreaterThan(effect(factory("mosin"), "factory").bonus);
		expect(effect(factory("mosin"), "forest").bonus).toBeGreaterThan(effect(factory("pp91"), "forest").bonus);
	});

	test("every sector exposes its actual range and darkness instead of a universal attachment multiplier", () => {
		const expected = {
			courtyard: ["mixed", 0], depot: ["mixed", .35], forest: ["far", 0],
			factory: ["close", .65], reserve: ["far", .25], bunker: ["close", 1],
		} as const;
		for (const map of MAPS) {
			const environment = effect(factory(), map.id).environment;
			expect(environment.distance).toBe(expected[map.id as keyof typeof expected][0]);
			expect(environment.darkness).toBe(expected[map.id as keyof typeof expected][1]);
			expect(environment.label.length).toBeGreaterThan(0);
		}
	});

	test("magnified optics favour open sight lines and retain their close-range drawback when worn", () => {
		const bare = railed(), scope = attach(railed(), "optic-longscope"), reflex = attach(railed(), "optic-reflex");
		expect(getWeaponStats(scope).damage).toBe(getWeaponStats(bare).damage);
		expect(getWeaponStats(reflex).damage).toBe(getWeaponStats(bare).damage);
		expect(effect(scope, "forest").bonus).toBeGreaterThan(effect(bare, "forest").bonus);
		expect(effect(scope, "factory").bonus).toBeLessThan(effect(bare, "factory").bonus);
		expect(effect(reflex, "factory").bonus).toBeGreaterThan(effect(scope, "factory").bonus);
		const worn = attach(railed(), "optic-longscope", 0), halfway = attach(railed(), "optic-longscope", 50);
		expect(getWeaponMechanics(halfway).rangeBonus).toBeGreaterThan(getWeaponMechanics(worn).rangeBonus);
		expect(getWeaponMechanics(halfway).rangeBonus).toBeLessThan(getWeaponMechanics(scope).rangeBonus);
		expect(getWeaponMechanics(worn).rangeBonus).toBe(getWeaponMechanics(bare).rangeBonus);
		expect(getWeaponMechanics(worn).closeBonus).toBeLessThan(getWeaponMechanics(bare).closeBonus);
		expect(getWeaponStats(worn).weight).toBe(getWeaponStats(scope).weight);
	});

	test("flashlights help in darkness, expose a recon route, and never add bullet damage", () => {
		const bare = railed(), light = attach(railed(), "flashlight-focus");
		expect(getWeaponMechanics(light).illumination).toBeGreaterThan(0);
		expect(getWeaponStats(light).damage).toBe(getWeaponStats(bare).damage);
		expect(effect(light, "forest", "combat").bonus).toBe(effect(bare, "forest", "combat").bonus);
		expect(effect(light, "bunker", "combat").bonus).toBeGreaterThan(effect(bare, "bunker", "combat").bonus);
		const combatDelta = effect(light, "bunker", "combat").bonus - effect(bare, "bunker", "combat").bonus;
		const reconDelta = effect(light, "bunker", "recon").bonus - effect(bare, "bunker", "recon").bonus;
		expect(reconDelta).toBeLessThan(combatDelta);
		const worn = attach(railed(), "flashlight-focus", 0);
		expect(getWeaponMechanics(worn).illumination).toBe(0);
		expect(effect(worn, "bunker").bonus).toBe(effect(bare, "bunker").bonus);
		expect(getWeaponStats(worn).weight).toBe(getWeaponStats(light).weight);
	});

	test("ordinary lasers improve close targeting rather than recoil or bullet damage", () => {
		const bare = railed(), laser = attach(railed(), "laser-micro");
		expect(getWeaponMechanics(laser).targeting).toBeGreaterThan(0);
		expect(getWeaponStats(laser).damage).toBe(getWeaponStats(bare).damage);
		expect(getWeaponStats(laser).recoil).toBe(getWeaponStats(bare).recoil);
		const nearDelta = effect(laser, "factory").bonus - effect(bare, "factory").bonus;
		const farDelta = effect(laser, "forest").bonus - effect(bare, "forest").bonus;
		expect(nearDelta).toBeGreaterThan(0);
		expect(nearDelta).toBeGreaterThan(farDelta);
		expect(getWeaponMechanics(attach(railed(), "laser-micro", 0)).targeting).toBe(0);
	});

	test("suppressors trade a stealth benefit for weight, handling and additional wear", () => {
		const bare = factory(), suppressed = attach(factory(), "muzzle-7.62x39-suppressor");
		expect(getWeaponMechanics(suppressed).stealthBonus).toBeGreaterThan(getWeaponMechanics(bare).stealthBonus);
		expect(effect(suppressed, "forest", "recon").bonus).toBeGreaterThan(effect(bare, "forest", "recon").bonus);
		expect(getWeaponStats(suppressed).damage).toBe(getWeaponStats(bare).damage);
		expect(getWeaponStats(suppressed).weight).toBeGreaterThan(getWeaponStats(bare).weight);
		expect(getWeaponStats(suppressed).ergonomics).toBeLessThan(getWeaponStats(bare).ergonomics);
		expect(getWeaponMechanics(suppressed).wearMultiplier).toBeGreaterThan(getWeaponMechanics(bare).wearMultiplier);
		const worn = attach(factory(), "muzzle-7.62x39-suppressor", 0);
		expect(getWeaponMechanics(worn).stealthBonus).toBe(getWeaponMechanics(bare).stealthBonus);
		expect(getWeaponMechanics(worn).wearMultiplier).toBeGreaterThan(getWeaponMechanics(bare).wearMultiplier);
		expect(getWeaponStats(worn).weight).toBe(getWeaponStats(suppressed).weight);
	});

	test("bipods reward a prepared combat position and lose that support while rushing", () => {
		const bare = railed("rpk"), supported = attach(railed("rpk"), "foregrip-bipod");
		expect(getWeaponMechanics(supported).supportBonus).toBeGreaterThan(getWeaponMechanics(bare).supportBonus);
		const steadyDelta = effect(supported, "forest", "combat", "balanced").bonus - effect(bare, "forest", "combat", "balanced").bonus;
		const rushingDelta = effect(supported, "forest", "combat", "bold").bonus - effect(bare, "forest", "combat", "bold").bonus;
		expect(steadyDelta).toBeGreaterThan(0);
		expect(steadyDelta).toBeGreaterThan(rushingDelta);
	});

	test("magazine capacity affects sustained fire and reloads without changing per-shot damage", () => {
		const bare = factory("ak74"), quick = attach(factory("ak74"), "magazine-ak-5.45x39-quick"), drum = attach(factory("ak74"), "magazine-ak-5.45x39-drum");
		expect(getWeaponMechanics(quick).reloadBonus).toBeGreaterThan(getWeaponMechanics(bare).reloadBonus);
		expect(getWeaponStats(quick).damage).toBe(getWeaponStats(bare).damage);
		expect(getWeaponStats(drum).damage).toBe(getWeaponStats(bare).damage);
		expect(getWeaponStats(drum).ammoMultiplier).toBeGreaterThan(getWeaponStats(bare).ammoMultiplier);
		expect(getWeaponStats(drum).weight).toBeGreaterThan(getWeaponStats(bare).weight);
		expect(getWeaponStats(quick).ammoMultiplier).toBeLessThan(getWeaponStats(bare).ammoMultiplier);
	});

	test("a missing or broken essential part cancels every route bonus", () => {
		for (const failure of ["missing", "broken"] as const) {
			const weapon = attach(attach(railed(), "flashlight-focus"), "optic-longscope");
			if (failure === "missing") delete weapon.modules.magazine;
			else weapon.modules.barrel!.durability = 0;
			expect(getWeaponStats(weapon).ready).toBe(false);
			for (const branch of branches) expect(effect(weapon, "bunker", branch).bonus).toBe(0);
		}
	});

	test("repeated build and route inspection never spends resources or advances the random stream", () => {
		const state = createGame(NOW), scav = state.scavs[0]!;
		state.money = 100_000;
		state.level = 50;
		state.supplies.ammo = state.supplies.intel = 10_000;
		const before = saveGame(state), weapon = state.weapons[0]!;
		for (let inspection = 0; inspection < 20; inspection++) for (const map of MAPS) {
			getWeaponMechanics(weapon);
			getRaidQuote(state, scav, map);
			for (const branch of branches) for (const tactic of tactics) getWeaponRouteEffect(weapon, map.id, branch, tactic, getWeaponStats(weapon));
		}
		expect(saveGame(state)).toBe(before);
		expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
		const dispatched = saveGame(state), raid = state.raids[0]!;
		const choices = getExpeditionChoices(state, raid);
		for (let inspection = 0; inspection < 30; inspection++) expect(getExpeditionChoices(state, raid)).toEqual(choices);
		expect(saveGame(state)).toBe(dispatched);
	});

	test("all 411 real modules stay finite and bounded across every sector, branch, tactic and wear level", () => {
		for (const model of MODULE_MODELS) {
			const healthy = buildFor(model);
			expect(getWeaponBuildIssues(healthy), model.id).toEqual([]);
			for (const condition of [100, 50, 0]) {
				const weapon = structuredClone(healthy);
				weapon.modules[model.slot]!.durability = condition;
				if (model.slot === "receiver") weapon.durability = condition;
				const stats = getWeaponStats(weapon);
				for (const map of MAPS) for (const branch of branches) for (const tactic of tactics) {
					const route = getWeaponRouteEffect(weapon, map.id, branch, tactic, stats);
					expect(Number.isFinite(route.bonus), `${model.id}/${condition}/${map.id}/${branch}/${tactic}`).toBe(true);
					expect(route.bonus).toBeGreaterThanOrEqual(-.12);
					expect(route.bonus).toBeLessThanOrEqual(.12);
					if (!stats.ready) expect(route.bonus).toBe(0);
					for (const item of route.contributions) expect(Number.isFinite(item.bonus)).toBe(true);
				}
			}
		}
	});

	test("fully stacked compatible builds cannot bypass the contextual bonus cap", () => {
		let capped = 0, setups = 0;
		for (const definition of WEAPONS) for (let variant = 0; variant < 8; variant++) {
			const weapon = factory(definition.id), info = RECEIVER_INFO[definition.id]!;
			const barrelStyle = ["long", "fluted", "heavy", "short"][variant % 4]!;
			attach(weapon, `barrel-${info.platform}-${info.caliber}-${barrelStyle}`);
			for (const slot of ["handguard", "stock", "magazine"] as const) {
				const styles = slot === "handguard" ? ["carbon", "rail", "vented"] : slot === "stock" ? ["precision", "tactical", "skeleton"] : ["drum", "quick", "extended"];
				const compatible = MODULE_MODELS.filter((part) => part.slot === slot && styles.includes(part.appearance)
					&& part.platforms.includes(info.platform) && part.calibers.includes(info.caliber));
				const part = compatible[variant % compatible.length];
				if (part) attach(weapon, part.id);
			}
			for (const slot of ["mount", "optic", "muzzle", "foregrip", "flashlight", "laser"] as const) {
				const available = getResolvedModuleMounts(weapon.modules);
				const compatible = MODULE_MODELS.filter((part) => part.slot === slot
					&& (part.platforms.includes("*") || part.platforms.includes(info.platform))
					&& (part.calibers.includes("*") || part.calibers.includes(info.caliber))
					&& (!part.requiresMount || available.includes(part.requiresMount)));
				const part = compatible[(variant * 3 + setups) % compatible.length];
				if (part) attach(weapon, part.id);
			}
			expect(getWeaponBuildIssues(weapon)).toEqual([]);
			const stats = getWeaponStats(weapon);
			for (const map of MAPS) for (const branch of branches) for (const tactic of tactics) {
				const route = getWeaponRouteEffect(weapon, map.id, branch, tactic, stats);
				const raw = route.contributions.reduce((sum, item) => sum + item.bonus, 0);
				expect(route.bonus).toBeCloseTo(Math.max(-.12, Math.min(.12, raw)), 10);
				if (Math.abs(raw) > .12) capped++;
			}
			setups++;
		}
		expect(setups).toBe(128);
		expect(capped).toBeGreaterThan(0);
	});
});
