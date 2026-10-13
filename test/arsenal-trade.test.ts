import { describe, expect, test } from "bun:test";
import { WEAPONS } from "../src/game/data";
import { FACTORY_KITS, MODULE_MODELS } from "../src/game/modules";
import { getWeaponStats, parseTradeModule, parseTradeWeapon, type WeaponInstance } from "../src/game/engine";

function factory(weaponId: string): WeaponInstance {
	return { id: "gun-9001", weaponId, durability: 55, foundAt: 1000, attachments: { optic: 0, magazine: 0, stock: 0 },
		modules: Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId], index) => [slot, { id: `module-${9002 + index}`, modelId, durability: 55, foundAt: 1000 }])) };
}

describe("expanded arsenal remains physical in trade", () => {
	test("all nine new assembled platforms retain their actual parts, condition and statistics", () => {
		for (const definition of WEAPONS.slice(16)) {
			const gun = factory(definition.id), restored = parseTradeWeapon(gun);
			expect(restored, definition.id).toEqual(gun);
			expect(getWeaponStats(restored!), definition.id).toEqual(getWeaponStats(gun));
		}
	});
	test("every new module is accepted individually with the same model and physical identity", () => {
		for (const model of MODULE_MODELS.slice(411)) {
			const item = { id: "module-9010", modelId: model.id, durability: 46, foundAt: 1000 };
			expect(parseTradeModule(item), model.id).toEqual(item);
		}
	});
	test("forged cross-caliber parts and inconsistent receiver condition remain rejected", () => {
		const gun = factory("m4a1");
		gun.modules.barrel!.modelId = FACTORY_KITS.scarh!.barrel!;
		expect(parseTradeWeapon(gun)).toBeNull();
		const worn = factory("trg42"); worn.modules.receiver!.durability = 100;
		expect(parseTradeWeapon(worn)).toBeNull();
		expect(parseTradeModule({ id: "module-9010", modelId: "__proto__", durability: 46, foundAt: 1000 })).toBeNull();
	});
});
