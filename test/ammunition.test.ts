import { describe, expect, test } from "bun:test";
import { AMMO_BY_ID, AMMO_MODELS, AMMO_TYPES, getAmmoEffect, getAmmoModel, getAmmoSupplyMultiplier, getEnemyArmorProfile, isAmmoType, type AmmoType } from "../src/game/ammunition";
import { MAPS, WEAPONS } from "../src/game/data";
import { RECEIVER_INFO } from "../src/game/modules";
import { TACTICS, type RaidTactic } from "../src/game/operations";
import { EXPEDITION_BRANCHES, type ExpeditionBranch } from "../src/game/systems";

const branches = Object.keys(EXPEDITION_BRANCHES) as ExpeditionBranch[];
const tactics = Object.keys(TACTICS) as RaidTactic[];
const weapon = (weaponId: string) => ({ weaponId });

describe("calibre-specific ammunition and armour interaction", () => {
	test("each of the twenty-two receiver calibres has eight real, distinct ammunition models", () => {
		const calibers = [...new Set(Object.values(RECEIVER_INFO).map((info) => info.caliber))];
		expect(calibers).toHaveLength(22);
		expect(AMMO_MODELS).toHaveLength(176);
		expect(new Set(AMMO_MODELS.map((model) => model.id)).size).toBe(176);
		for (const caliber of calibers) {
			const models = AMMO_MODELS.filter((model) => model.caliber === caliber);
			expect(models.map((model) => model.type)).toEqual([...AMMO_TYPES]);
			expect(new Set(models.map((model) => `${model.damage}:${model.penetration}`)).size).toBe(8);
			for (const model of models) {
				expect(AMMO_BY_ID[model.id]).toBe(model);
				expect(model.label.length).toBeGreaterThan(6);
				expect(model.description.length).toBeGreaterThan(40);
				expect(model.damage).toBeGreaterThan(0);
				expect(model.penetration).toBeGreaterThanOrEqual(0);
				expect(model.armorDamage).toBeGreaterThanOrEqual(0);
				expect(model.armorDamage).toBeLessThanOrEqual(1);
				expect(model.ammoMultiplier).toBeGreaterThanOrEqual(.75);
				expect(model.wearMultiplier).toBeGreaterThanOrEqual(.96);
			}
		}
	});

	test("a weapon uses its receiver calibre, and shared-calibre guns resolve the same stock", () => {
		for (const definition of WEAPONS) {
			for (const type of AMMO_TYPES) {
				const model = getAmmoModel(weapon(definition.id), type);
				expect(model.caliber).toBe(RECEIVER_INFO[definition.id]!.caliber);
				expect(model.type).toBe(type);
			}
		}
		for (const type of AMMO_TYPES) {
			expect(getAmmoModel(weapon("sks"), type)).toBe(getAmmoModel(weapon("akm"), type));
			expect(getAmmoModel(weapon("rpk"), type)).toBe(getAmmoModel(weapon("akm"), type));
			expect(getAmmoModel(weapon("pm"), type)).toBe(getAmmoModel(weapon("pp91"), type));
			expect(getAmmoModel(weapon("ak74"), type)).not.toBe(getAmmoModel(weapon("akm"), type));
		}
	});

	test("shotguns distinguish pellets, dart and single slug instead of calling all rounds expanding or tracer", () => {
		for (const id of ["toz", "mp133", "saiga"]) {
			expect(getAmmoModel(weapon(id), "standard").label).toContain("Картечь");
			expect(getAmmoModel(weapon(id), "piercing").label).toContain("дротик");
			expect(getAmmoModel(weapon(id), "expanding").label).toContain("Дробь");
			expect(getAmmoModel(weapon(id), "precision").label).toContain("Пуля");
			expect(getAmmoModel(weapon(id), "precision").description).toContain("Одиночная пуля");
		}
	});

	test("higher flesh damage, penetration, supply cost and weapon wear stay separate trade-offs", () => {
		for (const definition of WEAPONS) {
			const standard = getAmmoModel(weapon(definition.id), "standard");
			const piercing = getAmmoModel(weapon(definition.id), "piercing");
			const expanding = getAmmoModel(weapon(definition.id), "expanding");
			const precision = getAmmoModel(weapon(definition.id), "precision");
			expect(expanding.damage).toBeGreaterThan(standard.damage);
			expect(expanding.penetration).toBeLessThan(standard.penetration);
			expect(piercing.damage).toBeLessThan(standard.damage);
			expect(piercing.penetration).toBeGreaterThan(standard.penetration);
			expect(piercing.armorDamage).toBeGreaterThan(standard.armorDamage);
			expect(piercing.ammoMultiplier).toBe(1.65);
			expect(piercing.wearMultiplier).toBe(1.12);
			expect(expanding.ammoMultiplier).toBe(1.15);
			expect(precision.ammoMultiplier).toBe(1.2);
			expect(standard.ammoMultiplier).toBe(1);
		}
	});

	test("the supply quote without a weapon preserves every ammunition's cost and rejects forged types", () => {
		expect(getAmmoSupplyMultiplier("standard")).toBe(1);
		expect(getAmmoSupplyMultiplier("piercing")).toBe(1.65);
		expect(getAmmoSupplyMultiplier("expanding")).toBe(1.15);
		expect(getAmmoSupplyMultiplier("precision")).toBe(1.2);
		for (const model of AMMO_MODELS) expect(getAmmoSupplyMultiplier(model.type)).toBe(model.ammoMultiplier);
		for (const invalid of ["incendiary", "constructor", "__proto__", undefined, null]) expect(() => getAmmoSupplyMultiplier(invalid as AmmoType)).toThrow();
	});

	test("sector intelligence exposes actual armour class and the share of protected targets", () => {
		const expected = {
			courtyard: [1, .15], depot: [2, .35], forest: [2, .25],
			factory: [3, .55], reserve: [4, .7], bunker: [5, .85],
		} as const;
		for (const map of MAPS) {
			const base = getEnemyArmorProfile(map.id, "scavenge", 1);
			const values = expected[map.id as keyof typeof expected];
			expect(base.armorClass).toBe(values[0]);
			expect(base.armoredShare).toBe(values[1]);
			expect(base.label).toContain(`${base.armorClass} класса`);
			const combat = getEnemyArmorProfile(map.id, "combat", 1);
			const recon = getEnemyArmorProfile(map.id, "recon", 1);
			expect(combat.armorClass).toBe(base.armorClass + 1);
			expect(combat.armoredShare).toBeGreaterThanOrEqual(base.armoredShare);
			expect(recon.armoredShare).toBeLessThan(base.armoredShare);
			expect(getEnemyArmorProfile(map.id, "scavenge", 3).armoredShare).toBeGreaterThan(base.armoredShare);
		}
		expect(getEnemyArmorProfile("courtyard", "recon", 1).armoredShare).toBe(0);
		expect(getEnemyArmorProfile("bunker", "combat", 3).armoredShare).toBe(.95);
	});

	test("expanding rounds beat penetrators against soft targets for every platform", () => {
		for (const definition of WEAPONS) {
			const effects = Object.fromEntries(AMMO_TYPES.map((type) => [type, getAmmoEffect(weapon(definition.id), type, "courtyard", "scavenge", 1, "balanced")])) as Record<AmmoType, ReturnType<typeof getAmmoEffect>>;
			expect(effects.expanding.bonus).toBeGreaterThan(effects.standard.bonus);
			expect(effects.expanding.bonus).toBeGreaterThan(effects.piercing.bonus);
			expect(effects.expanding.bonus).toBeGreaterThan(effects.precision.bonus);
			expect(effects.expanding.effectiveDamage).toBeGreaterThan(effects.piercing.effectiveDamage);
			expect(effects.piercing.injuryMultiplier).toBeGreaterThan(effects.expanding.injuryMultiplier);
		}
	});

	test("penetrators beat flesh damage on heavy combat routes, without making a pistol equal to a rifle", () => {
		for (const definition of WEAPONS) {
			const piercing = getAmmoEffect(weapon(definition.id), "piercing", "bunker", "combat", 3, "balanced");
			for (const type of ["standard", "expanding", "precision"] as const) {
				const other = getAmmoEffect(weapon(definition.id), type, "bunker", "combat", 3, "balanced");
				expect(piercing.bonus).toBeGreaterThan(other.bonus);
				expect(piercing.effectiveDamage).toBeGreaterThan(other.effectiveDamage);
				expect(piercing.injuryMultiplier).toBeLessThan(other.injuryMultiplier);
			}
		}
		const pistol = getAmmoEffect(weapon("pm"), "piercing", "bunker", "combat", 3, "balanced");
		const rifle = getAmmoEffect(weapon("svd"), "standard", "bunker", "combat", 3, "balanced");
		expect(pistol.penetrationChance).toBeLessThan(rifle.penetrationChance);
		expect(pistol.effectiveDamage).toBeLessThan(rifle.effectiveDamage);
	});

	test("match ammunition has an actual distant reconnaissance niche and loses its accuracy boost in close quarters", () => {
		for (const definition of WEAPONS) {
			const distant = getAmmoEffect(weapon(definition.id), "precision", "reserve", "recon", 1, "cautious");
			for (const type of ["standard", "expanding", "piercing"] as const) {
				expect(distant.bonus).toBeGreaterThan(getAmmoEffect(weapon(definition.id), type, "reserve", "recon", 1, "cautious").bonus);
			}
			const rushed = getAmmoEffect(weapon(definition.id), "precision", "reserve", "recon", 1, "bold");
			expect(distant.effectiveDamage).toBe(rushed.effectiveDamage);
			expect(distant.bonus).toBeGreaterThan(rushed.bonus);
			const closeSteady = getAmmoEffect(weapon(definition.id), "precision", "factory", "recon", 1, "cautious");
			const closeRushed = getAmmoEffect(weapon(definition.id), "precision", "factory", "recon", 1, "bold");
			expect(closeSteady.bonus).toBe(closeRushed.bonus);
		}
	});

	test("armour damage contributes during blocked-hit exchanges instead of remaining a display-only index", () => {
		for (const type of AMMO_TYPES) {
			const effect = getAmmoEffect(weapon("ak74"), type, "bunker", "combat", 3, "balanced");
			const withoutArmourDamage = effect.model.damage * (1 - effect.enemy.armoredShare * (1 - effect.penetrationChance) * .85);
			expect(effect.effectiveDamage).toBeGreaterThan(withoutArmourDamage);
			expect(effect.effectiveDamage).toBeLessThan(effect.model.damage);
		}
	});

	test("every weapon, sector, route, depth and tactic combination stays finite and bounded", () => {
		let combinations = 0;
		for (const definition of WEAPONS) for (const map of MAPS) for (const branch of branches) for (const stage of [1, 2, 3]) for (const tactic of tactics) for (const type of AMMO_TYPES) {
			const effect = getAmmoEffect(weapon(definition.id), type, map.id, branch, stage, tactic);
			for (const value of [effect.penetrationChance, effect.effectiveDamage, effect.bonus, effect.injuryMultiplier]) expect(Number.isFinite(value)).toBe(true);
			expect(effect.penetrationChance).toBeGreaterThan(0);
			expect(effect.penetrationChance).toBeLessThan(1);
			expect(effect.effectiveDamage).toBeGreaterThan(0);
			expect(effect.effectiveDamage).toBeLessThanOrEqual(effect.model.damage);
			expect(Math.abs(effect.bonus)).toBeLessThanOrEqual(.1);
			expect(effect.injuryMultiplier).toBeGreaterThanOrEqual(.8);
			expect(effect.injuryMultiplier).toBeLessThanOrEqual(1.2);
			combinations += 1;
		}
		expect(combinations).toBe(WEAPONS.length * MAPS.length * branches.length * 3 * tactics.length * AMMO_TYPES.length);
	});

	test("forged weapons, ammo and sector IDs are rejected rather than silently falling back", () => {
		for (const invalid of [null, undefined, "incendiary", "constructor", "__proto__", {}, 1]) expect(isAmmoType(invalid)).toBe(false);
		for (const type of AMMO_TYPES) expect(isAmmoType(type)).toBe(true);
		for (const id of ["ak", "constructor", "__proto__", "ammo-9x18-piercing"]) expect(() => getAmmoModel(weapon(id), "standard")).toThrow();
		expect(() => getAmmoModel(weapon("ak74"), "ammo-9x18-piercing" as AmmoType)).toThrow();
		expect(() => getEnemyArmorProfile("constructor", "combat", 1)).toThrow();
		expect(() => getEnemyArmorProfile("bunker", "invalid" as ExpeditionBranch, 1)).toThrow();
		expect(() => getEnemyArmorProfile("bunker", "combat", Number.NaN)).toThrow();
		expect(() => getAmmoEffect(weapon("ak74"), "standard", "bunker", "combat", 1, "invalid" as RaidTactic)).toThrow();
	});
});
