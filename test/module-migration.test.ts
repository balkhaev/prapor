import { describe, expect, test } from "bun:test";
import {
	SAVE_VERSION, advance, assembleWeapon, disassembleWeapon, extractRaid,
	getWeaponStats, installModule, parseSave, saveGame,
} from "../src/game/engine";
import { FACTORY_KITS } from "../src/game/modules";

// Captured from the actual 0.4 engine: the second combat stage is in flight.
// Its loot, injury, gun wear and paid supplies must survive schema migration.
const raw = await Bun.file(new URL("./fixtures/legacy-v3-expedition.json", import.meta.url)).text();
const legacyV3 = JSON.parse(raw);

describe("the existing arsenal enters the modular workshop", () => {
	test("v3 ownership, old workshop bonuses and the carried cargo survive migration", () => {
		const state = parseSave(raw)!;
		expect(state).not.toBeNull();
		expect(state.schemaVersion).toBe(SAVE_VERSION);
		expect(state.money).toBe(457);
		expect(state.weapons).toHaveLength(4);
		expect(state.weapons[0]!.attachments).toEqual({ optic: 2, magazine: 1, stock: 1 });
		expect(state.weapons[0]!.durability).toBe(89);
		expect(getWeaponStats(state.weapons[0]!).ready).toBe(true);
		expect(getWeaponStats(state.weapons[0]!).power).toBe(Math.round(52 * (0.35 + 89 * 0.0065)));
		expect(Object.keys(state.weapons[0]!.modules).sort()).toEqual(Object.keys(FACTORY_KITS.sks!).sort());
		expect(state.scavs[0]!.weaponInstanceId).toBe("gun-1");
		expect(state.scavs[0]!.loadout.armorItemId).toBe("gear-8");
		expect(state.raids[0]!.expedition!.cargo).toEqual({ ...legacyV3.raids[0]!.expedition.cargo, modules: [] });
		expect(state.raids[0]!.expedition!.baseChance).toBe(legacyV3.raids[0]!.expedition.baseChance);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("an already paid v3 expedition settles its original result without new module rolls", () => {
		const state = parseSave(raw)!;
		const raid = state.raids[0]!;
		expect(advance(state, raid.endsAt).completedCount).toBe(0);
		expect(raid.expedition!.cargo).toEqual({ money: 204, supplies: { ammo: 0, medicine: 0, scrap: 0, intel: 0 }, weaponIds: ["mp133"], modules: [] });
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		expect(state.money).toBe(661);
		expect(state.supplies).toEqual({ ammo: 18, medicine: 6, scrap: 14, intel: 3 });
		expect(state.scavs[0]!.health).toBe(85);
		expect(state.weapons[0]!.durability).toBe(71);
		expect(state.history[0]!.money).toBe(204);
		expect(state.history[0]!.weaponId).toBe("mp133");
		expect(state.rng).toBe(11_355_432);
		expect(state.blueprints).toEqual(["light_vest", "scout_pack", "route:courtyard", "plate_armor"]);
		expect(parseSave(saveGame(state))).toEqual(state);
		const settled = saveGame(state);
		expect(advance(state, state.lastUpdated).completedCount).toBe(0);
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(settled);
	});

	test("a migrated worn receiver cannot restore its condition through disassembly", () => {
		const state = parseSave(raw)!;
		const gun = state.weapons[3]!;
		// Simulate a pre-module spare already worn in the old save.
		const altered = JSON.parse(raw);
		altered.weapons[3].durability = 31;
		const worn = parseSave(JSON.stringify(altered))!;
		const receiver = worn.weapons[3]!.modules.receiver!;
		expect(receiver.durability).toBe(31);
		expect(disassembleWeapon(worn, gun.id).ok).toBe(true);
		expect(assembleWeapon(worn, receiver.id).ok).toBe(true);
		expect(worn.weapons.at(-1)!.durability).toBe(31);
		expect(worn.weapons.at(-1)!.modules.receiver!.id).toBe(receiver.id);
		expect(parseSave(saveGame(worn))).toEqual(worn);
	});

	test("earned pre-module workshop tuning follows its receiver through a physical rebuild", () => {
		const altered = JSON.parse(raw);
		// Early saves allowed these levels even on a pistol. Preserve that investment.
		altered.weapons[3].attachments = { optic: 2, magazine: 3, stock: 1 };
		altered.weapons[3].durability = 31;
		const state = parseSave(JSON.stringify(altered))!;
		const weapon = state.weapons[3]!, before = getWeaponStats(weapon);
		const parts = structuredClone(weapon.modules);
		expect(disassembleWeapon(state, weapon.id).ok).toBe(true);
		expect(assembleWeapon(state, parts.receiver!.id).ok).toBe(true);
		const rebuilt = state.weapons.at(-1)!;
		for (const part of Object.values(parts)) if (part !== parts.receiver && part.id !== parts.receiver!.id)
			expect(installModule(state, rebuilt.id, part.id).ok).toBe(true);
		expect(rebuilt.attachments).toEqual({ optic: 2, magazine: 3, stock: 1 });
		expect(getWeaponStats(rebuilt)).toEqual(before);
		expect(parseSave(saveGame(state))).toEqual(state);
	});
});
