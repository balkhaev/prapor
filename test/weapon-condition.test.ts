import { describe, expect, test } from "bun:test";
import { getModuleEffectiveStats, getWeaponStats, type WeaponInstance } from "../src/game/engine";
import { WEAPONS, WEAPON_BY_ID } from "../src/game/data";
import { FACTORY_KITS, MODULE_BY_ID, MODULE_MODELS, RECEIVER_INFO, type ModuleInstance, type ModuleSlot } from "../src/game/modules";
import { getWeaponMechanics } from "../src/game/weapon-mechanics";

const NOW = 1_792_000_000_000;
function part(modelId: string, durability = 100): ModuleInstance {
	return { id: `condition-${modelId}`, modelId, durability, foundAt: NOW };
}
function factory(weaponId = "sks"): WeaponInstance {
	return { id: "gun-condition", weaponId, durability: 100, foundAt: NOW, attachments: { optic: 0, magazine: 0, stock: 0 },
		modules: Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId]) => [slot, part(modelId!)])) };
}
function replace(gun: WeaponInstance, modelId: string, durability = 100) {
	const item = part(modelId, durability);
	gun.modules[MODULE_BY_ID[modelId]!.slot] = item;
	return item;
}

describe("weapon condition has real costs", () => {
	test("all catalog parts lose benefits under wear without shedding drawbacks, mass or ammo cost", () => {
		for (const model of MODULE_MODELS) {
			const original = structuredClone(model.stats), item = part(model.id);
			expect(getModuleEffectiveStats(item)).toEqual(original);
			let previous = getModuleEffectiveStats(item);
			for (const durability of [75, 50, 10, 9, 0]) {
				item.durability = durability;
				const worn = getModuleEffectiveStats(item);
				expect(worn.damage).toBeLessThanOrEqual(previous.damage);
				expect(worn.ergonomics).toBeLessThanOrEqual(previous.ergonomics);
				expect(worn.recoil).toBeGreaterThanOrEqual(previous.recoil);
				expect(worn.reliability).toBeLessThanOrEqual(previous.reliability);
				expect(worn.weight).toBe(original.weight);
				expect(worn.ammoMultiplier).toBe(original.ammoMultiplier);
				previous = worn;
			}
			expect(previous.damage).toBe(Math.min(0, original.damage));
			expect(previous.ergonomics).toBe(Math.min(0, original.ergonomics));
			expect(previous.recoil).toBe(Math.max(0, original.recoil));
			expect(previous.reliability).toBe(Math.min(0, original.reliability));
			expect(model.stats).toEqual(original);
		}
	});

	test("a worn folding stock keeps its recoil penalty while losing handling and reliability", () => {
		const gun = factory(), base = getWeaponStats(gun), stock = replace(gun, "stock-sks-folding"), fresh = getWeaponStats(gun);
		expect(fresh.recoil).toBeGreaterThan(base.recoil);
		expect(fresh.ergonomics).toBeGreaterThan(base.ergonomics);
		stock.durability = 10;
		const worn = getWeaponStats(gun);
		expect(worn.ready).toBe(true);
		expect(worn.recoil).toBe(fresh.recoil);
		expect(worn.ergonomics).toBeLessThan(fresh.ergonomics);
		expect(worn.reliability).toBeLessThan(fresh.reliability);
		expect(worn.weight).toBe(fresh.weight);
	});

	test("a broken optional scope provides no aiming bonus and still burdens a ready weapon", () => {
		const gun = factory();
		replace(gun, "handguard-sks-rail");
		const base = getWeaponStats(gun), baseMechanics = getWeaponMechanics(gun), optic = replace(gun, "optic-longscope"), fresh = getWeaponStats(gun);
		expect(fresh.ready).toBe(true);
		expect(fresh.damage).toBe(base.damage);
		expect(getWeaponMechanics(gun).rangeBonus).toBeGreaterThan(baseMechanics.rangeBonus);
		optic.durability = 9;
		const broken = getWeaponStats(gun);
		expect(broken.ready).toBe(true);
		expect(broken.damage).toBe(base.damage);
		expect(broken.ergonomics).toBe(fresh.ergonomics);
		expect(broken.reliability).toBe(fresh.reliability);
		expect(broken.weight).toBe(fresh.weight);
		expect(broken.power).toBe(fresh.power);
		expect(getWeaponMechanics(gun).rangeBonus).toBe(baseMechanics.rangeBonus);
	});

	test("wear weakens recoil control and never turns a compact magazine into a powerful one", () => {
		const gun = factory();
		replace(gun, "handguard-sks-rail");
		const grip = replace(gun, "foregrip-vertical"), magazine = replace(gun, "magazine-sks-7.62x39-compact"), fresh = getWeaponStats(gun);
		grip.durability = 0;
		magazine.durability = 10;
		const worn = getWeaponStats(gun);
		expect(worn.ready).toBe(true);
		expect(worn.recoil).toBeGreaterThan(fresh.recoil);
		expect(worn.damage).toBe(fresh.damage);
		expect(worn.ergonomics).toBeLessThan(fresh.ergonomics);
		expect(worn.ammoMultiplier).toBe(fresh.ammoMultiplier);
		expect(worn.weight).toBe(fresh.weight);
	});

	test("receiver wear reduces reliability on every platform while preserving full-condition factory values", () => {
		for (const definition of WEAPONS) {
			const gun = factory(definition.id);
			expect(getWeaponStats(gun).reliability).toBe(definition.reliability);
			for (const durability of [50, 10]) {
				gun.durability = gun.modules.receiver!.durability = durability;
				const stats = getWeaponStats(gun);
				expect(stats.ready).toBe(true);
				expect(stats.reliability).toBe(definition.reliability - (100 - durability) * 0.2);
			}
			gun.durability = gun.modules.receiver!.durability = 0;
			expect(getWeaponStats(gun).reliability).toBe(definition.reliability - 20);
		}
	});

	test("missing or broken required parts and invalid mounting all report zero usable power", () => {
		for (const definition of WEAPONS) {
			for (const slot of RECEIVER_INFO[definition.id]!.requiredSlots) {
				const gun = factory(definition.id);
				gun.modules[slot]!.durability = 9;
				if (slot === "receiver") gun.durability = 9;
				expect(getWeaponStats(gun).ready).toBe(false);
				expect(getWeaponStats(gun).power).toBe(0);
				delete gun.modules[slot];
				expect(getWeaponStats(gun).ready).toBe(false);
				expect(getWeaponStats(gun).power).toBe(0);
			}
		}
		const unmounted = factory();
		replace(unmounted, "optic-reflex");
		expect(getWeaponStats(unmounted).issues.some((issue) => issue.includes("крепления"))).toBe(true);
		expect(getWeaponStats(unmounted).ready).toBe(false);
		expect(getWeaponStats(unmounted).power).toBe(0);
		const incompatible = factory();
		incompatible.modules.barrel = part(FACTORY_KITS.ak74!.barrel!);
		expect(getWeaponStats(incompatible).ready).toBe(false);
		expect(getWeaponStats(incompatible).power).toBe(0);
	});

	test("required component wear adds to receiver wear and legacy tuning keeps its existing effective power", () => {
		const gun = factory();
		for (const slot of RECEIVER_INFO.sks!.requiredSlots.filter((slot): slot is Exclude<ModuleSlot, "receiver"> => slot !== "receiver")) gun.modules[slot]!.durability = 50;
		expect(getWeaponStats(gun).reliability).toBe(WEAPON_BY_ID.sks!.reliability - 5);
		gun.durability = gun.modules.receiver!.durability = 50;
		expect(getWeaponStats(gun).reliability).toBe(WEAPON_BY_ID.sks!.reliability - 15);
		const legacy = factory();
		legacy.durability = legacy.modules.receiver!.durability = 89;
		legacy.attachments = { optic: 2, magazine: 1, stock: 1 };
		legacy.modules.receiver!.legacyAttachments = { ...legacy.attachments };
		expect(getWeaponStats(legacy).power).toBe(Math.round(52 * (0.35 + 89 * 0.0065)));
	});
});
