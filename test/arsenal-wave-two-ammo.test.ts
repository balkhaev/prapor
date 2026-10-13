import { describe, expect, test } from "bun:test";
import {
	SAVE_VERSION, advance, continueExpedition, createGame, dispatchRaid, getExpeditionChoices,
	getLoadoutStats, getRaidQuote, getWeaponRole, getWeaponStats, loadGameWithSummary,
	parseSave, saveGame, setLoadoutOption, setRaidTactic, type GameState,
} from "../src/game/engine";
import { AMMO_MODELS, AMMO_TYPES, getAmmoEffect, getAmmoModel, type AmmoType } from "../src/game/ammunition";
import { MAP_BY_ID } from "../src/game/data";
import { RECEIVER_INFO } from "../src/game/modules";
import { TACTICS } from "../src/game/operations";
import { EXPEDITION_BRANCHES } from "../src/game/systems";
import { getAmmunitionArtwork } from "../src/ammunition-art";
import { ammunitionCaliberLabel, ammunitionCards, ammunitionOptions, ammunitionSnapshot } from "../src/ammunition-ui";
import { useWeaponPlatformFixture } from "./weapon-fixtures";

const NOW = 1_792_230_000_000;
const CALIBERS = {
	"9x21": { gun: "sr2", damage: 34, penetration: 24, piercingGain: 25, rounds: 50, label: "9×21 мм" },
	"10mm": { gun: "glock20", damage: 42, penetration: 16, piercingGain: 27, rounds: 50, label: "10mm Auto" },
	".366tkm": { gun: "vpo209", damage: 63, penetration: 20, piercingGain: 27, rounds: 20, label: ".366 ТКМ" },
	"12.7x55": { gun: "ash12", damage: 79, penetration: 34, piercingGain: 24, rounds: 10, label: "12,7×55 мм" },
	"9.3x64": { gun: "svdk", damage: 77, penetration: 46, piercingGain: 22, rounds: 10, label: "9,3×64 мм" },
	".300winmag": { gun: "awm", damage: 81, penetration: 47, piercingGain: 22, rounds: 10, label: ".300 Win Mag" },
} as const;
const GUNS = ["sr2", "sr1", "glock20", "vpo209", "ash12", "svdk", "awm"] as const;

function funded(gun: string, type: AmmoType, now = NOW): GameState {
	const state = createGame(now), scav = state.scavs[0]!;
	state.money = 100_000;
	state.supplies = { ammo: 10_000, medicine: 100, scrap: 1_000, intel: 100 };
	useWeaponPlatformFixture(state, state.weapons[0]!, gun);
	scav.combat = 90; scav.scouting = 90;
	expect(setRaidTactic(state, scav.id, "cautious").ok).toBe(true);
	expect(setLoadoutOption(state, scav.id, "ammoType", type).ok).toBe(true);
	return state;
}
function restore(state: GameState): GameState {
	const parsed = parseSave(saveGame(state));
	expect(parsed).not.toBeNull();
	return parsed!;
}
function checkpoint(gun: string, type: AmmoType): GameState {
	for (let offset = 0; offset < 128; offset++) {
		const state = funded(gun, type, NOW + offset);
		expect(setLoadoutOption(state, state.scavs[0]!.id, "medkit", true).ok).toBe(true);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		advance(state, state.raids[0]!.endsAt);
		const raid = state.raids[0];
		if (raid?.expedition?.status === "choice" && getExpeditionChoices(state, raid, raid.expedition.offers[0]!).some((choice) => choice.branch === "combat" && !choice.reason)) return state;
	}
	throw new Error(`No genuine ${gun}/${type} checkpoint`);
}

describe("second modular arsenal ammunition release", () => {
	test("all 128 released models preserve exact IDs, order, labels, packaging, descriptions and mechanics", () => {
		// Read-only golden from committed dcfa432: JSON of its complete AMMO_MODELS.
		const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(AMMO_MODELS.slice(0, 128))).digest("hex");
		expect(digest).toBe("84f60e53c81d484187148a17b11227c36acf8e1cc605f1a1cdb1792558b3db07");
		expect(AMMO_MODELS.slice(128).map((model) => model.id)).toEqual(Object.keys(CALIBERS).flatMap((caliber) => AMMO_TYPES.map((type) => `ammo-${caliber}-${type}`)));
		expect(AMMO_MODELS).toHaveLength(176);
		expect(new Set(AMMO_MODELS.map((model) => model.caliber)).size).toBe(22);
	});

	test("48 new products retain distinct caliber identity, correct labels, packaging and fixed atlas order", () => {
		for (const [caliber, identity] of Object.entries(CALIBERS)) {
			const state = funded(identity.gun, "standard"), weapon = state.weapons[0]!;
			expect(RECEIVER_INFO[identity.gun]!.caliber).toBe(caliber);
			expect(ammunitionCaliberLabel(caliber)).toBe(identity.label);
			expect(getAmmoModel(weapon, "standard").damage).toBe(identity.damage);
			expect(getAmmoModel(weapon, "standard").penetration).toBe(identity.penetration);
			expect(getAmmoModel(weapon, "piercing").penetration).toBe(identity.penetration + identity.piercingGain);
			for (const [index, type] of AMMO_TYPES.entries()) {
				const model = getAmmoModel(weapon, type), artwork = getAmmunitionArtwork(model)!;
				expect(model.id).toBe(`ammo-${caliber}-${type}`);
				expect(model.packRounds).toBe(identity.rounds);
				expect(model.label).toContain(identity.label);
				expect(artwork).toEqual({ url: `/art/ammo/ammo-${caliber}.png`, column: index % 4, row: Math.floor(index / 4), position: `${index % 4 / 3 * 100}% ${Math.floor(index / 4) * 100}%` });
				expect(ammunitionSnapshot(model.id)).toContain(identity.label);
				expect(ammunitionCards(weapon, type)).toContain(`data-ammo-art="${model.id}"`);
			}
		}
		for (const type of AMMO_TYPES) expect(getAmmoModel({ weaponId: "sr1" }, type)).toBe(getAmmoModel({ weaponId: "sr2" }, type));
		const magnum = funded("awm", "precision").weapons[0]!;
		expect(ammunitionOptions(magnum, "precision")).toContain("Повышенной точности");
		expect(ammunitionOptions(magnum, "expanding")).not.toContain("Дробовые");
		expect(ammunitionSnapshot("ammo-.300winmag-precision")).not.toContain("Пулевые");
	});

	test("each caliber has a meaningful flesh-versus-heavy-armor choice with bounded raid and injury effects", () => {
		for (const identity of Object.values(CALIBERS)) {
			const weapon = funded(identity.gun, "standard").weapons[0]!;
			const impact = (type: AmmoType, map: string) => getAmmoEffect(weapon, type, map, "combat", 3, "cautious");
			expect(impact("expanding", "courtyard").effectiveDamage).toBeGreaterThan(impact("piercing", "courtyard").effectiveDamage);
			expect(impact("piercing", "bunker").effectiveDamage).toBeGreaterThan(impact("expanding", "bunker").effectiveDamage);
			expect(impact("piercing", "bunker").effectiveDamage).toBeGreaterThan(impact("highpressure", "bunker").effectiveDamage);
			for (const type of AMMO_TYPES) for (const map of ["courtyard", "forest", "bunker"]) for (const branch of ["scavenge", "combat", "recon"] as const) {
				const effect = getAmmoEffect(weapon, type, map, branch, 3, "cautious");
				expect(effect.bonus).toBeGreaterThanOrEqual(-.1); expect(effect.bonus).toBeLessThanOrEqual(.1);
				expect(effect.injuryMultiplier).toBeGreaterThanOrEqual(.8); expect(effect.injuryMultiplier).toBeLessThanOrEqual(1.2);
				expect(effect.penetrationChance).toBeGreaterThanOrEqual(.03); expect(effect.penetrationChance).toBeLessThanOrEqual(.97);
			}
		}
		const tkm = getAmmoModel({ weaponId: "vpo209" }, "standard"), rifle = getAmmoModel({ weaponId: "sks" }, "standard");
		expect(tkm.damage).toBeGreaterThan(rifle.damage); expect(tkm.penetration).toBeLessThan(rifle.penetration);
		const handgun = getAmmoModel({ weaponId: "glock20" }, "standard"), sr = getAmmoModel({ weaponId: "sr1" }, "standard");
		expect(handgun.damage).toBeGreaterThan(sr.damage); expect(handgun.penetration).toBeLessThan(sr.penetration);
	});

	test("heavy calibers pay actual supply and mobility costs instead of a free stronger round", () => {
		const light = funded("m4a1", "standard"), reference = getRaidQuote(light, light.scavs[0]!, MAP_BY_ID.forest!);
		for (const gun of ["ash12", "svdk", "awm"]) {
			const heavy = funded(gun, "standard"), quote = getRaidQuote(heavy, heavy.scavs[0]!, MAP_BY_ID.forest!);
			expect(getWeaponStats(heavy.weapons[0]!).weight).toBeGreaterThan(getWeaponStats(light.weapons[0]!).weight);
			expect(quote.ammo).toBeGreaterThan(reference.ammo);
		}
	});

	test("seven physical platforms pay all 56 compatible quotes and preserve the charged immutable ammunition snapshot", () => {
		let dispatches = 0;
		for (const gun of GUNS) for (const type of AMMO_TYPES) {
			const state = funded(gun, type), scav = state.scavs[0]!, weapon = state.weapons[0]!, map = MAP_BY_ID.courtyard!;
			const model = getAmmoModel(weapon, type), quote = getRaidQuote(state, scav, map), before = saveGame(state);
			expect(getRaidQuote(state, scav, map)).toEqual(quote); expect(saveGame(state)).toBe(before);
			expect(quote.ammunition).toEqual(getAmmoEffect(weapon, type, map.id, "scavenge", 1, scav.tactic));
			expect(quote.ammo).toBe(Math.max(1, Math.ceil(map.ammoCost * TACTICS[scav.tactic].ammoMultiplier * getWeaponRole(weapon).ammoMultiplier * getWeaponStats(weapon).ammoMultiplier * getLoadoutStats(state, scav).ammoMultiplier * model.ammoMultiplier)));
			const resources = { money: state.money, ammo: state.supplies.ammo, intel: state.supplies.intel };
			expect(dispatchRaid(state, scav.id, map.id, state.lastUpdated).ok).toBe(true);
			const raid = state.raids[0]!, snapshot = structuredClone(raid.expedition!.ammunition);
			expect(raid.chance).toBe(quote.chance); expect(raid.endsAt - raid.startedAt).toBe(quote.duration * 1_000);
			expect(state.money).toBe(resources.money - quote.money); expect(state.supplies.ammo).toBe(resources.ammo - quote.ammo); expect(state.supplies.intel).toBe(resources.intel - quote.intel);
			expect(snapshot).toEqual({ modelId: model.id, firstBonus: quote.ammunition!.bonus, wearMultiplier: model.wearMultiplier, ammoMultiplier: model.ammoMultiplier });
			expect(setLoadoutOption(state, scav.id, "ammoType", type === "standard" ? "surplus" : "standard").ok).toBe(false);
			expect(raid.expedition!.ammunition).toEqual(snapshot); expect(restore(state)).toEqual(state);
			expect(JSON.parse(saveGame(state)).schemaVersion).toBe(SAVE_VERSION);
			dispatches++;
		}
		expect(dispatches).toBe(56);
	});

	test("48 new cartridges use the next route's actual armor, charge its quote and settle identically offline", () => {
		for (const identity of Object.values(CALIBERS)) for (const type of AMMO_TYPES) {
			const state = checkpoint(identity.gun, type), raid = state.raids[0]!, expedition = raid.expedition!, perk = expedition.offers[0]!;
			const weapon = state.weapons.find((item) => item.id === raid.weaponInstanceId)!, model = getAmmoModel(weapon, type);
			const snapshot = structuredClone(expedition.ammunition), before = saveGame(state), choices = getExpeditionChoices(state, raid, perk);
			for (const choice of choices) {
				expect(choice.ammunition).toEqual(getAmmoEffect(weapon, type, raid.mapId, choice.branch, 2, raid.tactic));
				expect(choice.ammo).toBe(Math.max(1, Math.ceil(MAP_BY_ID[raid.mapId]!.ammoCost * TACTICS[raid.tactic].ammoMultiplier * EXPEDITION_BRANCHES[choice.branch].ammoMultiplier * expedition.ammoMultiplier * model.ammoMultiplier) + ([...expedition.perks, perk].includes("pathfinder") ? 1 : 0)));
			}
			expect(saveGame(state)).toBe(before);
			const choice = choices.find((item) => item.branch === "combat")!, resources = { money: state.money, ammo: state.supplies.ammo, intel: state.supplies.intel };
			expect(continueExpedition(state, raid.id, choice.branch, perk, state.lastUpdated).ok).toBe(true);
			expect(raid.chance).toBe(choice.chance); expect(state.money).toBe(resources.money - choice.money); expect(state.supplies.ammo).toBe(resources.ammo - choice.ammo); expect(state.supplies.intel).toBe(resources.intel - choice.intel);
			expect(expedition.ammunition).toEqual(snapshot);
			const irregular = restore(state), raw = saveGame(state), until = raid.endsAt + 3_017;
			advance(state, until);
			while (irregular.lastUpdated < until) advance(irregular, Math.min(until, irregular.lastUpdated + 17_021));
			expect(irregular).toEqual(state); expect(loadGameWithSummary(raw, until)!.state).toEqual(state);
		}
	});

	test("high-pressure loads cause additional actual receiver wear in all seven new-caliber guns", () => {
		for (const gun of GUNS) {
			const standard = funded(gun, "standard"), pressure = funded(gun, "highpressure");
			for (const state of [standard, pressure]) expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
			expect(pressure.raids[0]!.seed).toBe(standard.raids[0]!.seed);
			const standardWeapon = standard.weapons[0]!, pressureWeapon = pressure.weapons[0]!;
			for (const state of [standard, pressure]) advance(state, state.raids[0]!.endsAt);
			expect(pressureWeapon.durability).toBeLessThan(standardWeapon.durability);
			expect(pressureWeapon.modules.receiver!.durability).toBe(pressureWeapon.durability);
		}
	});

	test("a paid raid rejects new incompatible caliber snapshots and unknown ammunition products", () => {
		for (const identity of Object.values(CALIBERS)) {
			const state = funded(identity.gun, "standard");
			expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
			const raw = JSON.parse(saveGame(state));
			raw.raids[0].expedition.ammunition.modelId = "ammo-9x18-standard";
			expect(parseSave(JSON.stringify(raw))).toBeNull();
			raw.raids[0].expedition.ammunition.modelId = "ammo-unknown-standard";
			expect(parseSave(JSON.stringify(raw))).toBeNull();
		}
	});
});
