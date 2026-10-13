import { describe, expect, test } from "bun:test";
import { AMMO_MODELS, AMMO_TYPES, getAmmoEffect, getAmmoModel, getEnemyArmorProfile, type AmmoType } from "../src/game/ammunition";
import { MAPS, WEAPONS } from "../src/game/data";
import type { WeaponInstance } from "../src/game/engine";
import { FACTORY_KITS, RECEIVER_INFO, type ModuleInstance } from "../src/game/modules";
import { TACTICS, type RaidTactic } from "../src/game/operations";
import { EXPEDITION_BRANCHES, type ExpeditionBranch } from "../src/game/systems";
import { WEAPON_ENVIRONMENTS } from "../src/game/weapon-mechanics";

const originalTypes = ["standard", "piercing", "expanding", "precision", "subsonic", "tracer", "highpressure", "surplus"] as const;
const originalBallistics: Record<string, [number, number, number]> = {
	"9x18": [28, 8, 28], "7.62x25": [32, 18, 26], "20g": [58, 10, 28],
	"12g": [70, 14, 26], "7.62x39": [46, 30, 22], "5.45x39": [40, 32, 22],
	"9x19": [30, 13, 28], "7.62x54": [62, 45, 22], "9x39": [50, 40, 22],
};
const originalSpecs = {
	standard: [1, .3, 1, 1], piercing: [.82, .8, 1.65, 1.12],
	expanding: [1.4, .1, 1.15, 1], precision: [.95, .35, 1.2, 1.03],
	subsonic: [.82, .25, 1.25, .96], tracer: [.97, .3, 1.25, 1.04],
	highpressure: [1.12, .4, 1.4, 1.22], surplus: [.88, .25, .75, 1.18],
} as const;
const part = (modelId: string, durability = 100): ModuleInstance => ({ id: `test-${modelId}`, modelId, durability, foundAt: 1 });
const factory = (weaponId: string): WeaponInstance => ({
	id: `test-${weaponId}`, weaponId, durability: 100, attachments: { optic: 0, magazine: 0, stock: 0 }, foundAt: 1,
	modules: Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId]) => [slot, part(modelId!)])),
});
const suppressed = (weaponId = "sks", durability = 100): WeaponInstance => {
	const gun = factory(weaponId);
	gun.modules.muzzle = part(`muzzle-${RECEIVER_INFO[weaponId]!.caliber}-suppressor`, durability);
	return gun;
};
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

describe("eight ammunition niches and identifiable calibre packs", () => {
	test("128 packages have exact calibre, type code and decorative round count", () => {
		expect(AMMO_TYPES).toEqual(["standard", "piercing", "expanding", "precision", "subsonic", "tracer", "highpressure", "surplus"]);
		const codes: Record<AmmoType, string> = { standard: "FMJ", piercing: "AP", expanding: "HP", precision: "MATCH", subsonic: "SUB", tracer: "TR", highpressure: "+P", surplus: "STOCK" };
		for (const model of AMMO_MODELS) {
			expect(model.packCode).toBe(codes[model.type]);
			expect(model.packRounds).toBe(["12g", "20g", ".338lapua"].includes(model.caliber) ? 10 : ["9x18", "7.62x25", "9x19", "5.7x28", "4.6x30", ".45acp"].includes(model.caliber) ? 50 : 20);
			expect(model.id).toBe(`ammo-${model.caliber}-${model.type}`);
		}
		for (const id of ["toz", "mp133", "saiga"]) {
			expect(getAmmoModel({ weaponId: id }, "subsonic").label).toContain("Низкоскоростная картечь");
			expect(getAmmoModel({ weaponId: id }, "tracer").label).toContain("Трассирующая пуля");
			expect(getAmmoModel({ weaponId: id }, "highpressure").label).toContain("Магнум");
			expect(getAmmoModel({ weaponId: id }, "surplus").label).toContain("долгого хранения");
		}
	});

	test("the existing 72 models retain their IDs, ballistics, costs and original exact outcomes", () => {
		for (const definition of WEAPONS.filter((weapon) => Object.hasOwn(originalBallistics, RECEIVER_INFO[weapon.id]!.caliber))) for (const type of originalTypes) {
			const weapon = factory(definition.id), model = getAmmoModel(weapon, type);
			const [baseDamage, basePenetration, piercingGain] = originalBallistics[model.caliber]!;
			const [damageMultiplier, armorDamage, ammoMultiplier, wearMultiplier] = originalSpecs[type];
			expect(model.damage).toBe(Math.round(baseDamage * damageMultiplier * 10) / 10);
			const offset = { standard: 0, piercing: piercingGain, expanding: -12, precision: 5, subsonic: -6, tracer: 0, highpressure: 8, surplus: -3 }[type];
			expect(model.penetration).toBe(Math.max(0, basePenetration + offset));
			expect(model.armorDamage).toBe(armorDamage);
			expect(model.ammoMultiplier).toBe(ammoMultiplier);
			expect(model.wearMultiplier).toBe(wearMultiplier);
			for (const map of MAPS) for (const branch of Object.keys(EXPEDITION_BRANCHES) as ExpeditionBranch[]) for (const stage of [1, 2, 3]) for (const tactic of Object.keys(TACTICS) as RaidTactic[]) {
				const enemy = getEnemyArmorProfile(map.id, branch, stage);
				const penetrationChance = clamp(.5 + (model.penetration - enemy.armorClass * 10) / 40, .03, .97);
				const effectiveDamage = model.damage * (1 - enemy.armoredShare * (1 - penetrationChance) * (.85 * (1 - armorDamage * .5)));
				const contactWeight = branch === "combat" ? 1 : branch === "scavenge" ? .65 : .45;
				const distance = WEAPON_ENVIRONMENTS[map.id]!.distance;
				const precisionBonus = type === "precision" ? (distance === "far" ? .015 : distance === "mixed" ? .008 : 0) * (tactic === "cautious" ? 1 : tactic === "balanced" ? .8 : .4) : 0;
				const quietBonus = type === "subsonic" && branch !== "combat" && ["asval", "vss"].includes(weapon.weaponId)
					? (branch === "recon" ? .03 : .018) * (tactic === "cautious" ? 1 : tactic === "balanced" ? .8 : .35) : 0;
				const tracerBonus = type === "tracer" ? branch === "combat" ? .012 : branch === "recon" ? -.015 : 0 : 0;
				const bonus = clamp((effectiveDamage / baseDamage - 1) * .15 * contactWeight + precisionBonus + quietBonus + tracerBonus, -.1, .1);
				const effect = getAmmoEffect(weapon, type, map.id, branch, stage, tactic);
				expect(effect.penetrationChance).toBe(penetrationChance);
				expect(effect.effectiveDamage).toBe(effectiveDamage);
				expect(effect.bonus).toBe(bonus);
				expect(effect.injuryMultiplier).toBe(clamp(1 - bonus * 2, .8, 1.2));
			}
		}
	});

	test("low-speed rounds require a working compatible suppressor, not an ammunition label", () => {
		const noSuppressor = factory("sks"), realSuppressor = suppressed();
		const effect = (weapon: WeaponInstance) => getAmmoEffect(weapon, "subsonic", "courtyard", "recon", 1, "cautious");
		const base = effect(noSuppressor);
		expect(base.bonus).toBeLessThan(0);
		expect(effect(realSuppressor).bonus - base.bonus).toBeCloseTo(.03, 12);
		expect(effect(suppressed("sks", 50)).bonus - base.bonus).toBeCloseTo(.015, 12);
		expect(effect(suppressed("sks", 9)).bonus).toBe(base.bonus);
		for (const modelId of ["muzzle-7.62x39-brake", "muzzle-9x18-suppressor", "optic-reflex", "constructor"]) {
			const gun = factory("sks"); gun.modules.muzzle = part(modelId);
			expect(effect(gun).bonus).toBe(base.bonus);
		}
		const missingMount = suppressed(); delete missingMount.modules.barrel;
		expect(effect(missingMount).bonus).toBe(base.bonus);
		const wrongBarrel = suppressed(); wrongBarrel.modules.barrel = part("factory-akm-barrel");
		expect(effect(wrongBarrel).bonus).toBe(base.bonus);
		const brokenBarrel = suppressed(); brokenBarrel.modules.barrel!.durability = 9;
		expect(effect(brokenBarrel).bonus).toBe(base.bonus);
		for (const durability of [Number.NaN, Number.POSITIVE_INFINITY, -1]) expect(effect(suppressed("sks", durability)).bonus).toBe(base.bonus);
		const combat = getAmmoEffect(realSuppressor, "subsonic", "courtyard", "combat", 1, "cautious");
		expect(combat.bonus).toBe(getAmmoEffect(noSuppressor, "subsonic", "courtyard", "combat", 1, "cautious").bonus);
		expect(getAmmoEffect(realSuppressor, "subsonic", "courtyard", "scavenge", 1, "cautious").bonus).toBeGreaterThan(getAmmoEffect(noSuppressor, "subsonic", "courtyard", "scavenge", 1, "cautious").bonus);
		expect(getAmmoEffect(realSuppressor, "subsonic", "courtyard", "recon", 1, "bold").bonus).toBeLessThan(effect(realSuppressor).bonus);
	});

	test("integral suppression belongs to working VAL and VSS barrels and gives a real reconnaissance niche", () => {
		for (const weaponId of ["asval", "vss"]) {
			const gun = factory(weaponId);
			const effect = getAmmoEffect(gun, "subsonic", "courtyard", "recon", 1, "cautious");
			expect(effect.bonus).toBeGreaterThan(getAmmoEffect(gun, "standard", "courtyard", "recon", 1, "cautious").bonus);
			expect(effect.bonus).toBe(getAmmoEffect({ weaponId }, "subsonic", "courtyard", "recon", 1, "cautious").bonus);
			gun.modules.barrel!.durability = 9;
			expect(getAmmoEffect(gun, "subsonic", "courtyard", "recon", 1, "cautious").bonus).toBeLessThan(0);
			gun.modules.barrel = part("factory-sks-barrel");
			expect(getAmmoEffect(gun, "subsonic", "courtyard", "recon", 1, "cautious").bonus).toBeLessThan(0);
		}
	});

	test("tracer correction helps combat but its exposure hurts reconnaissance regardless of suppressor", () => {
		for (const definition of WEAPONS) for (const map of MAPS) {
			for (const branch of ["combat", "recon", "scavenge"] as const) {
				const effect = getAmmoEffect(factory(definition.id), "tracer", map.id, branch, 1, "balanced");
				const reference = getAmmoModel({ weaponId: definition.id }, "standard").damage;
				const ballistic = (effect.effectiveDamage / reference - 1) * .15 * (branch === "combat" ? 1 : branch === "scavenge" ? .65 : .45);
				expect(effect.bonus - ballistic).toBeCloseTo(branch === "combat" ? .012 : branch === "recon" ? -.015 : 0, 12);
			}
		}
	});

	test("boosted loads do not replace AP against heavy plates or expanding rounds against soft targets", () => {
		for (const definition of WEAPONS) {
			const weapon = factory(definition.id);
			const ap = getAmmoEffect(weapon, "piercing", "bunker", "combat", 3, "balanced");
			const boosted = getAmmoEffect(weapon, "highpressure", "bunker", "combat", 3, "balanced");
			expect(ap.effectiveDamage).toBeGreaterThan(boosted.effectiveDamage);
			expect(ap.bonus).toBeGreaterThan(boosted.bonus);
			const soft = getAmmoEffect(weapon, "expanding", "courtyard", "recon", 1, "cautious");
			for (const type of AMMO_TYPES.filter((candidate) => candidate !== "expanding")) {
				const other = getAmmoEffect(weapon, type, "courtyard", "recon", 1, "cautious");
				expect(soft.effectiveDamage).toBeGreaterThan(other.effectiveDamage);
			}
		}
	});

	test("storage loads save supply at the expense of impact and maintenance; quiet rounds reduce wear", () => {
		for (const definition of WEAPONS) {
			const standard = getAmmoModel({ weaponId: definition.id }, "standard");
			const surplus = getAmmoModel({ weaponId: definition.id }, "surplus");
			const quiet = getAmmoModel({ weaponId: definition.id }, "subsonic");
			const boosted = getAmmoModel({ weaponId: definition.id }, "highpressure");
			expect(surplus.ammoMultiplier).toBeLessThan(standard.ammoMultiplier);
			expect(surplus.damage).toBeLessThan(standard.damage);
			expect(surplus.penetration).toBeLessThan(standard.penetration);
			expect(surplus.wearMultiplier).toBeGreaterThan(standard.wearMultiplier);
			expect(quiet.wearMultiplier).toBeLessThan(standard.wearMultiplier);
			expect(boosted.damage).toBeGreaterThan(standard.damage);
			expect(boosted.wearMultiplier).toBeGreaterThan(surplus.wearMultiplier);
		}
	});

	test("new effects are deterministic, bounded and never mutate the actual weapon assembly", () => {
		const gun = suppressed("ak74"), before = JSON.stringify(gun);
		for (const type of AMMO_TYPES) for (const map of MAPS) for (const branch of Object.keys(EXPEDITION_BRANCHES) as ExpeditionBranch[]) {
			const effect = getAmmoEffect(gun, type, map.id, branch, 3, "cautious");
			expect(effect).toEqual(getAmmoEffect(gun, type, map.id, branch, 3, "cautious"));
			for (const value of [effect.effectiveDamage, effect.penetrationChance, effect.bonus, effect.injuryMultiplier]) expect(Number.isFinite(value)).toBe(true);
			expect(Math.abs(effect.bonus)).toBeLessThanOrEqual(.1);
		}
		expect(JSON.stringify(gun)).toBe(before);
	});
});
