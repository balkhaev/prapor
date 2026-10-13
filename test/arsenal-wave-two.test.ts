import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { MAPS, WEAPONS } from "../src/game/data";
import {
	assembleWeapon, craftModule, createGame, disassembleWeapon, dispatchRaid,
	getModuleCraftReason, getModuleInstallReason, getModuleSaleValue, getRaidQuote,
	getWeaponBuildIssues, getWeaponStats, installModule, parseSave, parseTradeModule,
	parseTradeWeapon, removeModule, saveGame, sellModule, SAVE_VERSION,
	type GameState, type WeaponInstance,
} from "../src/game/engine";
import { FACTORY_KITS, getResolvedModuleMounts, MODULE_BY_ID, MODULE_MODELS, RECEIVER_INFO, type ModuleModel } from "../src/game/modules";
import { getWeaponMechanics, getWeaponRouteEffect, WEAPON_MECHANICAL_PROFILES } from "../src/game/weapon-mechanics";
import { useWeaponPlatformFixture } from "./weapon-fixtures";

const NOW = 1_792_000_000_000;
const gunIds = ["g36", "aug", "fal", "sr25", "vector", "fiveseven", "sr2", "sr1", "glock20", "ash12", "vpo209", "svdk", "awm", "m870"];
const calibers = ["5.56x45", "5.56x45", "7.62x51", "7.62x51", ".45acp", "5.7x28", "9x21", "9x21", "10mm", "12.7x55", ".366tkm", "9.3x64", ".300winmag", "12g"];
const additions = MODULE_MODELS.slice(621);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const releasedObject = (value: Record<string, unknown>) => Object.fromEntries(WEAPONS.slice(0, 25).map((weapon) => [weapon.id, value[weapon.id]]));
function funded(): GameState {
	const state = createGame(NOW);
	state.base.workshop = 4; state.money = 1_000_000; state.supplies.scrap = 5_000;
	return state;
}
function factory(state: GameState, weaponId: string): WeaponInstance {
	const gun = state.weapons[0]!; gun.durability = 100;
	useWeaponPlatformFixture(state, gun, weaponId);
	return gun;
}
function craft(state: GameState, modelId: string) {
	expect(craftModule(state, modelId).ok, modelId).toBe(true);
	return state.modules.at(-1)!;
}
function matchingGun(part: ModuleModel): string {
	return gunIds.find((weaponId) => {
		const info = RECEIVER_INFO[weaponId]!;
		return (!part.weaponId || part.weaponId === weaponId) && (part.platforms.includes("*") || part.platforms.includes(info.platform)) && (part.calibers.includes("*") || part.calibers.includes(info.caliber));
	})!;
}

describe("second modular arsenal wave", () => {
	test("all released 25 guns, 621 complete model objects, physical metadata and native mechanics remain exact", () => {
		expect(hash(WEAPONS.slice(0, 25))).toBe("253c665113a4a688d52fbebec1313dc0d3c91183298cb98270778fb386d9a0b3");
		expect(hash(MODULE_MODELS.slice(0, 621))).toBe("f31e7143881f339dff037d824f4e2bb86efa44db088a957d5a5a720fcddf6dc5");
		expect(hash(releasedObject(RECEIVER_INFO))).toBe("3229273c0aac16c0d8742e8a59c771d9833cab29c0664de5ad7596d631c3af8a");
		expect(hash(releasedObject(FACTORY_KITS))).toBe("445b819550decc0ff3be8eff5f4322c4ff5d76c93bc205638761679e610e689f");
		expect(hash(releasedObject(WEAPON_MECHANICAL_PROFILES))).toBe("10c2ff4a228bb905f7e9cf0441a232af6336dbb40a5df4ec066fcd711d3eb732");
	});
	test("14 reachable platforms append six calibers and 313 compatible models without starter grants", () => {
		expect(WEAPONS).toHaveLength(39);
		expect(WEAPONS.slice(25).map((weapon) => weapon.id)).toEqual(gunIds);
		expect(gunIds.map((id) => RECEIVER_INFO[id]!.caliber)).toEqual(calibers);
		expect(new Set(Object.values(RECEIVER_INFO).map((info) => info.caliber)).size).toBe(22);
		expect(additions).toHaveLength(313); expect(MODULE_MODELS).toHaveLength(934);
		expect(MODULE_MODELS[621]!.id).toBe("receiver-g36");
		expect(new Set(MODULE_MODELS.map((part) => part.id)).size).toBe(934);
		for (const id of gunIds) {
			expect(MAPS.some((map) => map.level >= 2 && map.weapons.includes(id)), id).toBe(true);
			expect(MAPS[0]!.weapons.includes(id), id).toBe(false);
			expect(Object.keys(FACTORY_KITS[id]!)).toEqual(RECEIVER_INFO[id]!.requiredSlots);
		}
		const fresh = createGame(NOW);
		expect(fresh.weapons.some((gun) => gunIds.includes(gun.weaponId))).toBe(false);
		expect(fresh.discoveredWeapons.some((id) => gunIds.includes(id))).toBe(false);
		for (const part of additions) {
			expect(matchingGun(part), part.id).toBeDefined();
			expect(Object.values(part.stats).every(Number.isFinite), part.id).toBe(true);
			expect(part.stats.weight, part.id).toBeGreaterThan(0);
			expect(part.stats.ammoMultiplier, part.id).toBeGreaterThan(0);
			expect(part.craftCost.money, part.id).toBeGreaterThan(part.value);
		}
	});
	test("every appended model has paid physical ownership, compatible installation and exact current save/trade roundtrip", () => {
		for (const model of additions) {
			const state = funded(), gun = factory(state, matchingGun(model));
			const cash = state.money, scrap = state.supplies.scrap, rng = state.rng;
			const item = craft(state, model.id); item.durability = 62;
			expect(state.money, model.id).toBe(cash - model.craftCost.money);
			expect(state.supplies.scrap, model.id).toBe(scrap - model.craftCost.scrap);
			const ids = [item.id, ...Object.values(gun.modules).map((part) => part.id)];
			expect(getModuleInstallReason(state, gun.id, item.id), model.id).toBeNull();
			expect(installModule(state, gun.id, item.id).ok, model.id).toBe(true);
			expect(gun.modules[model.slot], model.id).toEqual(item);
			expect(getWeaponBuildIssues(gun), model.id).toEqual([]);
			expect(getWeaponStats(gun).ready, model.id).toBe(true);
			expect(state.rng).toBe(rng);
			expect([...state.modules, ...Object.values(gun.modules)].map((part) => part.id)).toEqual(expect.arrayContaining(ids));
			expect(parseTradeModule(item), model.id).toEqual(item);
			expect(parseTradeWeapon(gun), model.id).toEqual(gun);
			expect(JSON.parse(saveGame(state)).schemaVersion).toBe(SAVE_VERSION);
			expect(parseSave(saveGame(state)), model.id).toEqual(state);
		}
	});
	test("discovered receivers can be paid, assembled, disassembled and rebuilt with their exact original part identities", () => {
		for (const id of gunIds) {
			const state = funded();
			expect(getModuleCraftReason(state, `receiver-${id}`)).toContain("найди");
			state.discoveredWeapons.push(id);
			const receiver = craft(state, `receiver-${id}`);
			expect(assembleWeapon(state, receiver.id).ok).toBe(true);
			const gun = state.weapons.at(-1)!;
			for (const slot of RECEIVER_INFO[id]!.requiredSlots) if (slot !== "receiver") expect(installModule(state, gun.id, craft(state, FACTORY_KITS[id]![slot]!).id).ok).toBe(true);
			const parts = structuredClone(gun.modules);
			expect(getWeaponStats(gun).ready).toBe(true);
			expect(disassembleWeapon(state, gun.id).ok).toBe(true);
			for (const part of Object.values(parts)) expect(state.modules.filter((item) => item.id === part.id)).toEqual([part]);
			expect(assembleWeapon(state, receiver.id).ok).toBe(true);
			const rebuilt = state.weapons.at(-1)!;
			for (const slot of RECEIVER_INFO[id]!.requiredSlots) if (slot !== "receiver") expect(installModule(state, rebuilt.id, parts[slot]!.id).ok).toBe(true);
			expect(rebuilt.modules).toEqual(parts);
			expect(getWeaponStats(rebuilt).ready).toBe(true);
			expect(parseSave(saveGame(state))).toEqual(state);
		}
	});
	test("AUG and ASh rear feed, Vector offset feed and M870 tube are retained across every available feed/support variant", () => {
		for (const id of ["aug", "ash12"]) {
			expect(RECEIVER_INFO[id]!.feedGeometry).toBe("rear-box");
			expect(MODULE_BY_ID[`stock-${id}-folding`]).toBeUndefined();
			for (const model of MODULE_MODELS.filter((part) => part.platforms.includes(id) && part.slot === "stock")) expect(model.description).toContain("заднюю опору буллпапа");
			for (const model of MODULE_MODELS.filter((part) => part.platforms.includes(id) && part.slot === "magazine")) expect(model.description).toContain("позади спусковой");
		}
		expect(RECEIVER_INFO.vector!.feedGeometry).toBe("box");
		expect(RECEIVER_INFO.vector!.bodyGeometry).toBe("vector");
		expect(RECEIVER_INFO.m870!.feedGeometry).toBe("tube"); expect(RECEIVER_INFO.m870!.action).toBe("pump");
		const state = funded(), pump = factory(state, "m870");
		expect(getResolvedModuleMounts(pump.modules)).not.toContain("thread:12g");
		for (const model of MODULE_MODELS.filter((part) => part.platforms.includes("m870") && part.slot === "magazine")) {
			expect(model.label.toLowerCase()).toContain("трубка подачи"); expect(model.description).toContain("Подствольная трубка");
			expect(model.appearance).not.toBe("drum");
		}
		const muzzle = craft(state, "muzzle-12g-brake"), before = saveGame(state);
		expect(installModule(state, pump.id, muzzle.id).ok).toBe(false); expect(saveGame(state)).toBe(before);
	});
	test("each new pistol and FAL opens optics only through its own rooted bridge and locks dependent attachments", () => {
		for (const id of ["fiveseven", "sr1", "glock20", "fal"]) {
			const state = funded(), gun = factory(state, id), platform = RECEIVER_INFO[id]!.platform;
			if (id !== "fal") expect(RECEIVER_INFO[id]!.requiredSlots).toEqual(["receiver", "barrel", "magazine"]);
			const optic = craft(state, "optic-reflex");
			expect(installModule(state, gun.id, optic.id).ok).toBe(false);
			expect(installModule(state, gun.id, craft(state, `mount-${platform}-bridge`).id).ok).toBe(true);
			expect(installModule(state, gun.id, optic.id).ok).toBe(true);
			expect(installModule(state, gun.id, craft(state, "flashlight-mini").id).ok).toBe(true);
			expect(installModule(state, gun.id, craft(state, "laser-micro").id).ok).toBe(true);
			const before = saveGame(state);
			expect(removeModule(state, gun.id, "mount").ok).toBe(false); expect(saveGame(state)).toBe(before);
			if (id !== "fal") expect(installModule(state, gun.id, craft(state, "foregrip-vertical").id).ok).toBe(false);
			expect(parseSave(saveGame(state))).toEqual(state);
		}
	});
	test("visually related weapon families and same-caliber foreign feed parts cannot bypass platform or caliber checks", () => {
		for (const [weaponId, wrongParts] of [
			["sr25", ["factory-m4a1-barrel", "factory-fal-magazine", "muzzle-5.56x45-brake"]],
			["vpo209", ["factory-akm-barrel", "factory-akm-magazine", "muzzle-7.62x39-suppressor"]],
			["svdk", ["factory-svd-barrel", "factory-svd-magazine"]],
			["ash12", ["factory-aug-stock", "factory-scarh-magazine"]],
			["sr1", ["mount-fiveseven-bridge", "factory-sr2-magazine"]],
			["awm", ["factory-trg42-magazine", "muzzle-.338lapua-suppressor"]],
		] as const) {
			const state = funded(), gun = factory(state, weaponId);
			for (const modelId of wrongParts) {
				const item = craft(state, modelId), before = saveGame(state);
				expect(installModule(state, gun.id, item.id).ok, `${weaponId} / ${modelId}`).toBe(false); expect(saveGame(state)).toBe(before);
			}
		}
	});
	test("route affinities stay bounded, heavy powerful guns pay real reserve costs, and the Vector keeps its close niche", () => {
		const state = funded(), scav = state.scavs[0]!, forest = MAPS.find((map) => map.id === "forest")!;
		state.level = 10; factory(state, "m4a1");
		const m4Ammo = getRaidQuote(state, scav, forest).ammo;
		for (const id of ["sr25", "svdk", "awm", "ash12"]) {
			factory(state, id); expect(getRaidQuote(state, scav, forest).ammo, id).toBeGreaterThan(m4Ammo);
		}
		const vector = structuredClone(factory(state, "vector")), awm = structuredClone(factory(state, "awm"));
		expect(getWeaponRouteEffect(vector, "factory", "combat", "balanced", getWeaponStats(vector)).bonus).toBeGreaterThan(getWeaponRouteEffect(awm, "factory", "combat", "balanced", getWeaponStats(awm)).bonus);
		expect(getWeaponRouteEffect(awm, "forest", "recon", "cautious", getWeaponStats(awm)).bonus).toBeGreaterThan(getWeaponRouteEffect(vector, "forest", "recon", "cautious", getWeaponStats(vector)).bonus);
		for (const id of gunIds) {
			const gun = factory(state, id), stats = getWeaponStats(gun), mechanics = getWeaponMechanics(gun);
			expect(stats.ready).toBe(true); expect(mechanics.label.length).toBeGreaterThan(0);
			for (const map of MAPS) for (const branch of ["scavenge", "combat", "recon"] as const) {
				const bonus = getWeaponRouteEffect(gun, map.id, branch, "balanced", stats).bonus;
				expect(Number.isFinite(bonus)).toBe(true); expect(Math.abs(bonus)).toBeLessThanOrEqual(.12);
			}
		}
	});
	test("variant parts change real handling and reserve consumption instead of giving a universal upgrade", () => {
		for (const id of gunIds) {
			const state = funded(), gun = factory(state, id), info = RECEIVER_INFO[id]!;
			const stock = getWeaponStats(gun);
			const short = craft(state, `barrel-${info.platform}-${info.caliber}-short`);
			expect(installModule(state, gun.id, short.id).ok).toBe(true);
			const light = getWeaponStats(gun);
			expect(light.ergonomics, id).toBeGreaterThan(stock.ergonomics); expect(light.power, id).toBeLessThan(stock.power);
			const heavy = craft(state, `barrel-${info.platform}-${info.caliber}-heavy`);
			expect(installModule(state, gun.id, heavy.id).ok).toBe(true);
			const supported = getWeaponStats(gun);
			expect(supported.recoil, id).toBeLessThan(light.recoil); expect(supported.weight, id).toBeGreaterThan(light.weight);
			const quick = craft(state, `magazine-${info.platform}-${info.caliber}-quick`);
			expect(installModule(state, gun.id, quick.id).ok).toBe(true);
			const economical = getWeaponStats(gun);
			expect(installModule(state, gun.id, craft(state, `magazine-${info.platform}-${info.caliber}-extended`).id).ok).toBe(true);
			expect(getWeaponStats(gun).ammoMultiplier, id).toBeGreaterThan(economical.ammoMultiplier);
		}
	});
	test("new module sales remove the owned physical item and pay the condition-dependent quote", () => {
		for (const model of additions) {
			const state = funded(); state.discoveredWeapons.push(...gunIds);
			const item = craft(state, model.id); item.durability = 41;
			const cash = state.money, expected = getModuleSaleValue(item);
			expect(sellModule(state, item.id).ok).toBe(true); expect(state.money).toBe(cash + expected);
			expect(state.modules.some((part) => part.id === item.id)).toBe(false);
		}
	});
	test("a dispatched new gun locks every physical component until the paid raid finishes", () => {
		for (const id of gunIds) {
			const state = funded(), gun = factory(state, id), scav = state.scavs[0]!, info = RECEIVER_INFO[id]!;
			const extra = craft(state, `barrel-${info.platform}-${info.caliber}-long`);
			expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok, id).toBe(true);
			const before = saveGame(state);
			expect(installModule(state, gun.id, extra.id).ok).toBe(false); expect(removeModule(state, gun.id, "barrel").ok).toBe(false); expect(disassembleWeapon(state, gun.id).ok).toBe(false);
			expect(saveGame(state)).toBe(before); expect(parseSave(before)).toEqual(state);
		}
	});
});
