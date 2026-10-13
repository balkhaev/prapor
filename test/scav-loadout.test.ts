import { describe, expect, test } from "bun:test";
import { craftGear, craftModule, createGame, dispatchRaid, equipGear, equipWeapon, installModule, removeModule, saveGame } from "../src/game/engine";
import { WEAPON_BY_ID } from "../src/game/data";
import { FACTORY_KITS, MODULE_SLOTS } from "../src/game/modules";
import { GEAR_MODEL_BY_ID, type Loadout } from "../src/game/systems";
import { getHostileVisualLoadout, getRaidVisualLoadout, getScavVisualLoadout, weaponVisualSignature } from "../src/scav-loadout";
import { weaponActorArt } from "../src/armory-art";

const NOW = 1_792_000_000_000;
const emptyLoadout = (): Loadout => ({ armorItemId: null, backpackItemId: null, ammoType: "standard", medkit: false });

function outfitted() {
	const state = createGame(NOW);
	state.money = 50_000; state.supplies.scrap = 500; state.base.workshop = 5;
	state.blueprints.push("plate_armor", "cargo_pack");
	for (const modelId of ["light_vest", "plate_armor", "scout_pack", "cargo_pack"]) expect(craftGear(state, modelId).ok).toBe(true);
	return state;
}

describe("physical inventory drives scav equipment art", () => {
	test("equipping, swapping and removing owned gear immediately changes the visible models", () => {
		const state = outfitted(), scav = state.scavs[0]!;
		scav.gear = { armor: 3, backpack: 3 };
		const gun = state.weapons.find((weapon) => weapon.id === scav.weaponInstanceId)!;
		expect(getScavVisualLoadout(scav, state.gearItems, state.weapons)).toEqual({ helmetModelId: null, armorModelId: null, packModelId: null, weapon: gun });
		for (const [armorModelId, packModelId] of [["light_vest", "scout_pack"], ["plate_armor", "cargo_pack"]] as const) {
			expect(equipGear(state, scav.id, "armor", state.gearItems.find((item) => item.modelId === armorModelId)!.id).ok).toBe(true);
			expect(equipGear(state, scav.id, "backpack", state.gearItems.find((item) => item.modelId === packModelId)!.id).ok).toBe(true);
			expect(getScavVisualLoadout(scav, state.gearItems, state.weapons)).toEqual({ helmetModelId: null, armorModelId, packModelId, weapon: gun });
		}
		expect(equipGear(state, scav.id, "armor", null).ok).toBe(true);
		expect(equipGear(state, scav.id, "backpack", null).ok).toBe(true);
		expect(getScavVisualLoadout(scav, state.gearItems, state.weapons)).toEqual({ helmetModelId: null, armorModelId: null, packModelId: null, weapon: gun });
		const pistol = state.weapons.find((weapon) => weapon.weaponId === "pm")!;
		expect(equipWeapon(state, scav.id, pistol.id).ok).toBe(true);
		expect(getScavVisualLoadout(scav, state.gearItems, state.weapons).weapon).toBe(pistol);
		scav.weaponInstanceId = null;
		expect(getScavVisualLoadout(scav, state.gearItems, state.weapons).weapon).toBeNull();
	});

	test("missing, unknown and wrong-slot items cannot invent visible player equipment", () => {
		const loadout = emptyLoadout();
		loadout.armorItemId = "armor"; loadout.backpackItemId = "pack";
		const scav = { loadout, gear: { armor: 3, backpack: 3 }, weaponInstanceId: "missing" };
		const empty = { helmetModelId: null, armorModelId: null, packModelId: null, weapon: null };
		expect(getScavVisualLoadout(scav)).toEqual(empty);
		expect(getScavVisualLoadout({ gear: scav.gear })).toEqual(empty);
		expect(getScavVisualLoadout(scav, [
			{ id: "armor", modelId: "scout_pack", durability: 100 },
			{ id: "pack", modelId: "plate_armor", durability: 100 },
		])).toEqual(empty);
		expect(getScavVisualLoadout(scav, [
			{ id: "armor", modelId: "toString", durability: 100 },
			{ id: "pack", modelId: "unknown", durability: 100 },
		])).toEqual(empty);
		const weapon = createGame(NOW).weapons[0]!;
		expect(getScavVisualLoadout({ weaponInstanceId: weapon.id }, [], [{ ...weapon, weaponId: "constructor" }]).weapon).toBeNull();
	});

	test("all helmet models are independent inventory layers and an empty or wrong-slot helmet stays empty", () => {
		const state = outfitted(), scav = state.scavs[0]!;
		for (const helmetModelId of ["steel_helmet", "kevlar_helmet", "tactical_helmet", "visor_helmet"]) {
			expect(craftGear(state, helmetModelId).ok).toBe(true);
			const helmet = state.gearItems.find((item) => item.modelId === helmetModelId)!;
			expect(equipGear(state, scav.id, "helmet", helmet.id).ok).toBe(true);
			const visible = getScavVisualLoadout(scav, state.gearItems, state.weapons);
			expect(visible.helmetModelId).toBe(helmetModelId);
			expect(visible.armorModelId).toBeNull(); expect(visible.packModelId).toBeNull();
		}
		expect(equipGear(state, scav.id, "helmet", null).ok).toBe(true);
		expect(getScavVisualLoadout(scav, state.gearItems, state.weapons).helmetModelId).toBeNull();
		for (const modelId of ["light_vest", "scout_pack", "missing", "constructor"]) {
			scav.loadout.helmetItemId = "visual-helmet";
			expect(getScavVisualLoadout(scav, [{ id: "visual-helmet", modelId, durability: 100 }], state.weapons).helmetModelId).toBeNull();
		}
	});

	test("helmets in a sortie use the paid departure model, including an explicitly empty slot", () => {
		const state = outfitted(), scav = state.scavs[0]!;
		expect(craftGear(state, "steel_helmet").ok).toBe(true);
		const helmet = state.gearItems.find((item) => item.modelId === "steel_helmet")!;
		expect(equipGear(state, scav.id, "helmet", helmet.id).ok).toBe(true);
		expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
		const raid = state.raids[0]!;
		helmet.modelId = "visor_helmet"; scav.loadout.helmetItemId = null;
		expect(getRaidVisualLoadout(raid, null).helmetModelId).toBe("steel_helmet");
		for (const empty of [null, undefined, "none", "unknown", "light_vest", "scout_pack", "constructor"]) {
			raid.expedition!.loadout.helmetModelId = empty;
			expect(getRaidVisualLoadout(raid, null).helmetModelId).toBeNull();
		}
	});

	test("a sortie reads its frozen departure gear and keeps genuinely empty snapshot slots empty", () => {
		const state = outfitted(), scav = state.scavs[0]!;
		const armor = state.gearItems.find((item) => item.modelId === "light_vest")!, pack = state.gearItems.find((item) => item.modelId === "scout_pack")!;
		expect(equipGear(state, scav.id, "armor", armor.id).ok).toBe(true);
		expect(equipGear(state, scav.id, "backpack", pack.id).ok).toBe(true);
		expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
		const raid = state.raids[0]!, weapon = state.weapons.find((item) => item.id === raid.weaponInstanceId)!;
		armor.modelId = "plate_armor"; pack.modelId = "cargo_pack";
		scav.loadout.armorItemId = null; scav.loadout.backpackItemId = null;
		expect(getRaidVisualLoadout(raid, weapon)).toEqual({ helmetModelId: null, armorModelId: "light_vest", packModelId: "scout_pack", weapon });
		raid.armorLevel = 3; raid.backpackLevel = 3;
		for (const modelId of ["none", "unknown", "constructor"]) {
			raid.expedition!.loadout.armorModelId = modelId;
			raid.expedition!.loadout.packModelId = modelId;
			expect(getRaidVisualLoadout(raid, weapon)).toEqual({ helmetModelId: null, armorModelId: null, packModelId: null, weapon });
		}
		raid.expedition!.loadout.armorModelId = "cargo_pack";
		raid.expedition!.loadout.packModelId = "light_vest";
		expect(getRaidVisualLoadout(raid, null)).toEqual({ helmetModelId: null, armorModelId: null, packModelId: null, weapon: null });
		expect(getRaidVisualLoadout(raid, state.weapons[1]!).weapon).toBeNull();
	});

	test("migrated sorties can display the gear levels that were paid before physical item slots existed", () => {
		const state = createGame(NOW);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		const raid = state.raids[0]!; raid.expedition = null;
		for (const [level, armorModelId, packModelId] of [[0, null, null], [1, "light_vest", "scout_pack"], [2, "plate_armor", "cargo_pack"], [3, "plate_armor", "cargo_pack"]] as const) {
			raid.armorLevel = level; raid.backpackLevel = level;
			expect(getRaidVisualLoadout(raid, null)).toEqual({ helmetModelId: null, armorModelId, packModelId, weapon: null });
		}
	});

	test("ambient hostile props are deterministic, independent and never alter inventory, RNG or model catalogs", () => {
		const state = createGame(NOW), before = saveGame(state), kitsBefore = JSON.stringify(FACTORY_KITS);
		const weapons = new Set<string>();
		const armorModels = new Set<string>(), helmetModels = new Set<string>(), packModels = new Set<string>();
		for (let appearance = 0; appearance < 32; appearance++) {
			const first = getHostileVisualLoadout(appearance), second = getHostileVisualLoadout(appearance);
			expect(first).toEqual(second); expect(first.weapon).not.toBe(second.weapon);
			const weapon = first.weapon!;
			weapons.add(weapon.weaponId);
			expect(Object.hasOwn(WEAPON_BY_ID, weapon.weaponId)).toBe(true);
			expect(weapon.id.startsWith("visual-hostile-")).toBe(true);
			for (const slot of MODULE_SLOTS) expect(weapon.modules[slot]?.modelId).toBe(FACTORY_KITS[weapon.weaponId]![slot]);
			if (first.armorModelId) { expect(GEAR_MODEL_BY_ID[first.armorModelId]!.slot).toBe("armor"); armorModels.add(first.armorModelId); }
			if (first.helmetModelId) { expect(GEAR_MODEL_BY_ID[first.helmetModelId]!.slot).toBe("helmet"); helmetModels.add(first.helmetModelId); }
			if (first.packModelId) { expect(GEAR_MODEL_BY_ID[first.packModelId]!.slot).toBe("backpack"); packModels.add(first.packModelId); }
			weapon.modules.barrel!.durability = 1;
			expect(getHostileVisualLoadout(appearance).weapon!.modules.barrel!.durability).toBe(100);
		}
		expect(weapons.size).toBe(6);
		expect(armorModels.size).toBe(6); expect(helmetModels.size).toBe(4); expect(packModels.size).toBe(6);
		for (const invalid of [-1, 32, NaN, Infinity]) expect(getHostileVisualLoadout(invalid)).toEqual(getHostileVisualLoadout(0));
		expect(saveGame(state)).toBe(before); expect(JSON.stringify(FACTORY_KITS)).toBe(kitsBefore);
	});

	test("real in-place module installations and removals invalidate the held weapon's shape signature", () => {
		const state = outfitted(), weapon = state.weapons.find((item) => item.weaponId === "sks")!;
		const scav = state.scavs.find((item) => item.weaponInstanceId === weapon.id)!;
		for (const modelId of ["handguard-sks-rail", "optic-reflex", "foregrip-vertical", "barrel-sks-7.62x39-long", "stock-sks-tactical", "magazine-sks-7.62x39-extended", "muzzle-7.62x39-suppressor"]) {
			let part = state.modules.find((item) => item.modelId === modelId);
			if (!part) { expect(craftModule(state, modelId).ok).toBe(true); part = state.modules.at(-1)!; }
			const before = weaponVisualSignature(weapon);
			const beforeArt = weaponActorArt(getScavVisualLoadout(scav, state.gearItems, state.weapons).weapon!).svg;
			expect(installModule(state, weapon.id, part.id).ok).toBe(true);
			expect(weaponVisualSignature(weapon)).not.toBe(before);
			expect(weaponVisualSignature(weapon)).toContain(modelId);
			const current = getScavVisualLoadout(scav, state.gearItems, state.weapons).weapon!;
			expect(current).toBe(weapon); expect(weaponActorArt(current).svg).not.toBe(beforeArt);
		}
		const before = weaponVisualSignature(weapon);
		expect(removeModule(state, weapon.id, "optic").ok).toBe(true);
		expect(weaponVisualSignature(weapon)).not.toBe(before);
		expect(weaponVisualSignature(weapon)).toContain("optic:none");
	});

	test("weapon shape keys include weapon model and visible wear while ignoring IDs, timestamps and part insertion order", () => {
		const state = createGame(NOW), weapon = state.weapons[0]!, copy = structuredClone(weapon);
		const before = weaponVisualSignature(weapon), stateBefore = saveGame(state);
		copy.id = "other-gun"; copy.foundAt += 1000;
		copy.modules = Object.fromEntries(Object.entries(copy.modules).reverse());
		for (const part of Object.values(copy.modules)) { part.id = `other-${part.id}`; part.foundAt += 1000; }
		expect(weaponVisualSignature(copy)).toBe(before);
		const signatures = new Set(Array.from({ length: 6 }, (_, index) => weaponVisualSignature(getHostileVisualLoadout(index).weapon!)));
		expect(signatures.size).toBe(6);
		copy.modules.barrel!.durability = 79;
		const worn = weaponVisualSignature(copy);
		expect(worn).not.toBe(before); expect(worn).toContain(`${copy.modules.barrel!.modelId}:60`);
		copy.modules.barrel!.durability = 61;
		expect(weaponVisualSignature(copy)).toBe(worn);
		copy.modules.barrel!.durability = 59;
		expect(weaponVisualSignature(copy)).not.toBe(worn);
		expect(saveGame(state)).toBe(stateBefore);
	});
});
