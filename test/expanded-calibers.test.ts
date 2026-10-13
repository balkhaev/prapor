import { describe, expect, test } from "bun:test";
import {
	SAVE_VERSION, advance, continueExpedition, createGame, dispatchRaid, dispatchSquadRaid, extractRaid, getExpeditionChoices,
	getLoadoutStats, getRaidQuote, getWeaponRole, getWeaponStats, installModule, loadGameWithSummary,
	parseSave, saveGame, setLoadoutOption, setRaidTactic, type GameState, type Raid,
} from "../src/game/engine";
import { AMMO_MODELS, AMMO_TYPES, getAmmoEffect, getAmmoModel, type AmmoType } from "../src/game/ammunition";
import { MAP_BY_ID } from "../src/game/data";
import { RECEIVER_INFO } from "../src/game/modules";
import { TACTICS } from "../src/game/operations";
import { EXPEDITION_BRANCHES } from "../src/game/systems";
import { getAmmunitionArtwork } from "../src/ammunition-art";
import { ammunitionCaliberLabel, ammunitionCards, ammunitionSnapshot } from "../src/ammunition-ui";
import { useWeaponPlatformFixture } from "./weapon-fixtures";
import { withoutArsenalLoot } from "./legacy-strategy-fixture";
import { withoutLoot } from "./legacy-loot-fixture";

const NOW = 1_792_210_000_000;
const NEW_PLATFORMS = ["m4a1", "hk416", "p90", "mp7", "ump45", "m1911", "mcx", "scarh", "trg42"] as const;
const NEW_CALIBERS = {
	"5.56x45": { gun: "m4a1", damage: 42, penetration: 34, piercingGain: 22, rounds: 20, label: "5,56×45 мм" },
	"5.7x28": { gun: "p90", damage: 26, penetration: 26, piercingGain: 26, rounds: 50, label: "5,7×28 мм" },
	"4.6x30": { gun: "mp7", damage: 24, penetration: 28, piercingGain: 24, rounds: 50, label: "4,6×30 мм" },
	".45acp": { gun: "ump45", damage: 39, penetration: 10, piercingGain: 28, rounds: 50, label: ".45 ACP" },
	".300blk": { gun: "mcx", damage: 51, penetration: 29, piercingGain: 24, rounds: 20, label: ".300 BLK" },
	"7.62x51": { gun: "scarh", damage: 64, penetration: 43, piercingGain: 22, rounds: 20, label: "7,62×51 мм" },
	".338lapua": { gun: "trg42", damage: 88, penetration: 48, piercingGain: 22, rounds: 10, label: ".338 Lapua" },
} as const;
const LEGACY_BALLISTICS: Record<string, readonly [number, number, number]> = {
	"9x18": [28, 8, 28], "7.62x25": [32, 18, 26], "20g": [58, 10, 28], "12g": [70, 14, 26],
	"7.62x39": [46, 30, 22], "5.45x39": [40, 32, 22], "9x19": [30, 13, 28], "7.62x54": [62, 45, 22], "9x39": [50, 40, 22],
};
const LEGACY_SPECS: Record<AmmoType, readonly [number, number, number, number, number]> = {
	standard: [1, 0, .3, 1, 1], piercing: [.82, 0, .8, 1.65, 1.12], expanding: [1.4, -12, .1, 1.15, 1],
	precision: [.95, 5, .35, 1.2, 1.03], subsonic: [.82, -6, .25, 1.25, .96], tracer: [.97, 0, .3, 1.25, 1.04],
	highpressure: [1.12, 8, .4, 1.4, 1.22], surplus: [.88, -3, .25, .75, 1.18],
};
function funded(weaponId: string, type: AmmoType, now = NOW): GameState {
	const state = createGame(now), scav = state.scavs[0]!, weapon = state.weapons[0]!;
	state.money = 100_000;
	state.supplies = { ammo: 10_000, medicine: 100, scrap: 1_000, intel: 100 };
	useWeaponPlatformFixture(state, weapon, weaponId);
	scav.combat = 90; scav.scouting = 90;
	expect(setRaidTactic(state, scav.id, "cautious").ok).toBe(true);
	expect(setLoadoutOption(state, scav.id, "ammoType", type).ok).toBe(true);
	return state;
}
function restore(state: GameState): GameState {
	const migrated = parseSave(saveGame(state));
	expect(migrated).not.toBeNull();
	return migrated!;
}
function checkpoint(weaponId: string, type: AmmoType, legacyCatalog = false): { state: GameState; raid: Raid } {
	for (let offset = 0; offset < 128; offset++) {
		const state = funded(weaponId, type, NOW + offset);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		if (legacyCatalog) withoutLoot(withoutArsenalLoot(state));
		const raid = state.raids[0]!;
		advance(state, raid.endsAt);
		if (state.raids[0]?.expedition?.status === "choice") return { state, raid };
	}
	throw new Error(`No genuine ${weaponId}/${type} checkpoint`);
}
function settleIrregularly(state: GameState, until: number) {
	const intervals = [271, 2_093, 11_017, 997, 37_021];
	for (let index = 0; state.lastUpdated < until; index++) advance(state, Math.min(until, state.lastUpdated + intervals[index % intervals.length]!));
}

describe("seven new calibers on physical modular weapon platforms", () => {
	test("all 72 released cartridges retain order, IDs, ballistics and their supply and wear coefficients", () => {
		const released = AMMO_MODELS.slice(0, 72);
		expect(released.map((model) => model.id)).toEqual(Object.keys(LEGACY_BALLISTICS).flatMap((caliber) => AMMO_TYPES.map((type) => `ammo-${caliber}-${type}`)));
		for (const model of released) {
			const [baseDamage, basePenetration, gain] = LEGACY_BALLISTICS[model.caliber]!;
			const [damageMultiplier, penetrationOffset, armorDamage, ammoMultiplier, wearMultiplier] = LEGACY_SPECS[model.type];
			expect(model.damage).toBe(Math.round(baseDamage * damageMultiplier * 10) / 10);
			expect(model.penetration).toBe(model.type === "piercing" ? basePenetration + gain : Math.max(0, basePenetration + penetrationOffset));
			expect([model.armorDamage, model.ammoMultiplier, model.wearMultiplier]).toEqual([armorDamage, ammoMultiplier, wearMultiplier]);
		}
	});

	test("seven distinctive calibers append 56 usable models with their own labels, pack counts and atlas", () => {
		expect(AMMO_MODELS).toHaveLength(128);
		expect(new Set(AMMO_MODELS.map((model) => model.caliber)).size).toBe(16);
		for (const [caliber, identity] of Object.entries(NEW_CALIBERS)) {
			const state = funded(identity.gun, "standard"), weapon = state.weapons[0]!;
			expect(RECEIVER_INFO[weapon.weaponId]!.caliber).toBe(caliber);
			expect(ammunitionCaliberLabel(caliber)).toBe(identity.label);
			expect(getAmmoModel(weapon, "standard").damage).toBe(identity.damage);
			expect(getAmmoModel(weapon, "standard").penetration).toBe(identity.penetration);
			expect(getAmmoModel(weapon, "piercing").penetration).toBe(identity.penetration + identity.piercingGain);
			for (const type of AMMO_TYPES) {
				const model = getAmmoModel(weapon, type);
				expect(model.id).toBe(`ammo-${caliber}-${type}`);
				expect(model.packRounds).toBe(identity.rounds);
				expect(model.label).toContain(identity.label);
				expect(getAmmunitionArtwork(model)!.url).toBe(`/art/ammo/ammo-${caliber}.png`);
				expect(ammunitionSnapshot(model.id)).toContain(identity.label);
				expect(ammunitionCards(weapon, type)).toContain(`data-ammo-art="${model.id}"`);
			}
		}
		for (const type of AMMO_TYPES) {
			expect(getAmmoModel({ weaponId: "m4a1" }, type)).toBe(getAmmoModel({ weaponId: "hk416" }, type));
			expect(getAmmoModel({ weaponId: "ump45" }, type)).toBe(getAmmoModel({ weaponId: "m1911" }, type));
		}
	});

	test("PDW penetrators trade flesh impact for penetration while heavy cartridges do not grant free mobility", () => {
		const impact = (gun: string) => getAmmoModel({ weaponId: gun }, "standard");
		for (const gun of ["p90", "mp7"]) {
			expect(impact(gun).damage).toBeLessThan(impact("ump45").damage);
			expect(impact(gun).penetration).toBeGreaterThan(impact("ump45").penetration);
		}
		expect(impact("trg42").damage).toBeGreaterThan(impact("scarh").damage);
		expect(impact("trg42").penetration).toBeGreaterThan(impact("scarh").penetration);
		const heavy = funded("trg42", "standard"), light = funded("m4a1", "standard");
		expect(getWeaponStats(heavy.weapons[0]!).weight).toBeGreaterThan(getWeaponStats(light.weapons[0]!).weight);
		expect(getRaidQuote(heavy, heavy.scavs[0]!, MAP_BY_ID.forest!).ammo).toBeGreaterThan(getRaidQuote(light, light.scavs[0]!, MAP_BY_ID.forest!).ammo);
	});

	test(".300 BLK gains its quiet niche only through an actual working compatible suppressor", () => {
		const state = funded("mcx", "subsonic"), weapon = state.weapons[0]!, effect = () => getAmmoEffect(weapon, "subsonic", "forest", "recon", 1, "cautious");
		const bare = effect();
		const suppressor = { id: `module-${state.nextId++}`, modelId: "muzzle-.300blk-suppressor", durability: 100, foundAt: NOW };
		state.modules.push(suppressor);
		expect(installModule(state, weapon.id, suppressor.id).ok).toBe(true);
		expect(effect().bonus - bare.bonus).toBeCloseTo(.03, 12);
		weapon.modules.muzzle!.durability = 50;
		expect(effect().bonus - bare.bonus).toBeCloseTo(.015, 12);
		weapon.modules.muzzle!.durability = 9;
		expect(effect().bonus).toBe(bare.bonus);
		weapon.modules.muzzle!.modelId = "muzzle-7.62x51-suppressor";
		weapon.modules.muzzle!.durability = 100;
		expect(effect().bonus).toBe(bare.bonus);
		delete weapon.modules.muzzle;
		expect(restore(state)).toEqual(state);
	});

	test("all nine new receivers pay all eight real compatible quotes and keep immutable raid snapshots", () => {
		let dispatches = 0;
		for (const gun of NEW_PLATFORMS) for (const type of AMMO_TYPES) {
			const state = funded(gun, type), scav = state.scavs[0]!, weapon = state.weapons[0]!, map = MAP_BY_ID.courtyard!;
			const model = getAmmoModel(weapon, type), quote = getRaidQuote(state, scav, map), before = saveGame(state);
			for (let index = 0; index < 3; index++) expect(getRaidQuote(state, scav, map)).toEqual(quote);
			expect(saveGame(state)).toBe(before);
			expect(quote.ammunition).toEqual(getAmmoEffect(weapon, type, map.id, "scavenge", 1, scav.tactic));
			expect(quote.ammo).toBe(Math.max(1, Math.ceil(map.ammoCost * TACTICS[scav.tactic].ammoMultiplier * getWeaponRole(weapon).ammoMultiplier * getWeaponStats(weapon).ammoMultiplier * getLoadoutStats(state, scav).ammoMultiplier * model.ammoMultiplier)));
			const resources = { money: state.money, ammo: state.supplies.ammo, intel: state.supplies.intel };
			expect(dispatchRaid(state, scav.id, map.id, state.lastUpdated).ok).toBe(true);
			const raid = state.raids[0]!, snapshot = structuredClone(raid.expedition!.ammunition);
			expect(raid.chance).toBe(quote.chance);
			expect(raid.endsAt - raid.startedAt).toBe(quote.duration * 1_000);
			expect(state.money).toBe(resources.money - quote.money);
			expect(state.supplies.ammo).toBe(resources.ammo - quote.ammo);
			expect(state.supplies.intel).toBe(resources.intel - quote.intel);
			expect(snapshot).toEqual({ modelId: model.id, firstBonus: quote.ammunition!.bonus, wearMultiplier: model.wearMultiplier, ammoMultiplier: model.ammoMultiplier });
			expect(setLoadoutOption(state, scav.id, "ammoType", type === "standard" ? "surplus" : "standard").ok).toBe(false);
			expect(raid.expedition!.ammunition).toEqual(snapshot);
			expect(restore(state)).toEqual(state);
			dispatches++;
		}
		expect(dispatches).toBe(72);
	});

	test("all 56 new products use actual next-route armor, pay their quoted cost and settle identically offline", () => {
		for (const identity of Object.values(NEW_CALIBERS)) for (const type of AMMO_TYPES) {
			const { state, raid } = checkpoint(identity.gun, type), expedition = raid.expedition!, perk = expedition.offers[0]!;
			const weapon = state.weapons.find((item) => item.id === raid.weaponInstanceId)!, model = getAmmoModel(weapon, type);
			const snapshot = structuredClone(expedition.ammunition), before = saveGame(state), choices = getExpeditionChoices(state, raid, perk);
			for (const choice of choices) {
				expect(choice.ammunition).toEqual(getAmmoEffect(weapon, type, raid.mapId, choice.branch, 2, raid.tactic));
				expect(choice.ammo).toBe(Math.max(1, Math.ceil(MAP_BY_ID[raid.mapId]!.ammoCost * TACTICS[raid.tactic].ammoMultiplier * EXPEDITION_BRANCHES[choice.branch].ammoMultiplier * expedition.ammoMultiplier * model.ammoMultiplier) + ([...expedition.perks, perk].includes("pathfinder") ? 1 : 0)));
			}
			expect(saveGame(state)).toBe(before);
			const choice = choices.find((item) => item.branch === "combat")!, resources = { money: state.money, ammo: state.supplies.ammo, intel: state.supplies.intel };
			expect(continueExpedition(state, raid.id, choice.branch, perk, state.lastUpdated).ok).toBe(true);
			expect(raid.chance).toBe(choice.chance);
			expect(state.money).toBe(resources.money - choice.money);
			expect(state.supplies.ammo).toBe(resources.ammo - choice.ammo);
			expect(state.supplies.intel).toBe(resources.intel - choice.intel);
			expect(expedition.ammunition).toEqual(snapshot);
			const irregular = restore(state), raw = saveGame(state), until = raid.endsAt + 3_017;
			advance(state, until); settleIrregularly(irregular, until);
			expect(irregular).toEqual(state);
			expect(loadGameWithSummary(raw, until)!.state).toEqual(state);
		}
	});

	test("new platforms suffer real additional receiver wear from high-pressure ammunition at matched encounter seeds", () => {
		for (const gun of NEW_PLATFORMS) {
			const standard = funded(gun, "standard"), pressure = funded(gun, "highpressure");
			for (const state of [standard, pressure]) expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
			expect(pressure.raids[0]!.seed).toBe(standard.raids[0]!.seed);
			expect(pressure.rng).toBe(standard.rng);
			const standardWeapon = standard.weapons[0]!, pressureWeapon = pressure.weapons[0]!;
			for (const state of [standard, pressure]) advance(state, state.raids[0]!.endsAt);
			expect(pressureWeapon.durability).toBeLessThan(standardWeapon.durability);
			expect(pressureWeapon.modules.receiver!.durability).toBe(pressureWeapon.durability);
		}
	});

	test("v15 preserves all eight released types and paid state while rejecting future guns, parts and wrong-caliber snapshots", () => {
		for (const type of AMMO_TYPES) {
			const { state, raid } = checkpoint("pm", type, true), raw = JSON.parse(saveGame(state)); raw.schemaVersion = 15;
			const migrated = parseSave(JSON.stringify(raw));
			expect(migrated).not.toBeNull();
			expect(migrated!.schemaVersion).toBe(SAVE_VERSION);
			expect(migrated).toEqual(state);
			expect(getExpeditionChoices(migrated!, migrated!.raids[0]!, raid.expedition!.offers[0]!)).toEqual(getExpeditionChoices(state, raid, raid.expedition!.offers[0]!));
		}
		for (const gun of NEW_PLATFORMS) {
			const state = funded(gun, "standard"), raw = JSON.parse(saveGame(state));
			expect(parseSave(JSON.stringify(raw))).not.toBeNull();
			raw.schemaVersion = 15;
			expect(parseSave(JSON.stringify(raw))).toBeNull();
			const discovery = JSON.parse(saveGame(funded("pm", "standard")));
			discovery.discoveredWeapons.push(gun);
			expect(parseSave(JSON.stringify(discovery))).not.toBeNull();
			discovery.schemaVersion = 15;
			expect(parseSave(JSON.stringify(discovery))).toBeNull();
		}
		for (const identity of Object.values(NEW_CALIBERS)) {
			const state = funded("pm", "standard"), caliber = RECEIVER_INFO[identity.gun]!.caliber;
			state.modules.push({ id: `module-${state.nextId++}`, modelId: `muzzle-${caliber}-suppressor`, durability: 100, foundAt: NOW });
			const raw = JSON.parse(saveGame(state));
			expect(parseSave(JSON.stringify(raw))).not.toBeNull();
			raw.schemaVersion = 15;
			expect(parseSave(JSON.stringify(raw))).toBeNull();
			const active = funded("pm", "standard");
			expect(dispatchRaid(active, active.scavs[0]!.id, "courtyard", active.lastUpdated).ok).toBe(true);
			const paid = JSON.parse(saveGame(active));
			paid.raids[0].expedition.ammunition.modelId = `ammo-${caliber}-standard`;
			expect(parseSave(JSON.stringify(paid))).toBeNull();
		}
	});

	test("a mixed new-caliber squad saves each fighter's physical gun and compatible ammunition through active and historical snapshots", () => {
		let checkpointState: GameState | undefined;
		for (let offset = 0; offset < 128; offset++) {
			const state = funded("m4a1", "precision", NOW + offset), guns = ["m4a1", "mcx", "trg42"] as const, types = ["precision", "subsonic", "piercing"] as const;
			for (const [index, scav] of state.scavs.entries()) {
				const weapon = state.weapons.find((item) => item.id === scav.weaponInstanceId)!;
				useWeaponPlatformFixture(state, weapon, guns[index]!);
				scav.combat = 90; scav.scouting = 90;
				expect(setLoadoutOption(state, scav.id, "ammoType", types[index]!).ok).toBe(true);
			}
			expect(dispatchSquadRaid(state, state.scavs.map((scav) => scav.id), "courtyard", state.lastUpdated).ok).toBe(true);
			expect(restore(state)).toEqual(state);
			for (const raid of state.raids) {
				const member = raid.squad!.members.find((fighter) => fighter.scavId === raid.scavId)!, weapon = state.weapons.find((item) => item.id === member.weaponInstanceId)!;
				expect(member.weaponId).toBe(weapon.weaponId);
				expect(member.weaponModules).toEqual(Object.fromEntries(Object.entries(weapon.modules).map(([slot, part]) => [slot, part.modelId])));
				expect(raid.expedition!.ammunition!.modelId).toBe(getAmmoModel(weapon, member.loadout.ammoType).id);
			}
			advance(state, Math.max(...state.raids.map((raid) => raid.endsAt)));
			if (state.raids.length === 3 && state.raids.every((raid) => raid.expedition?.status === "choice")) { checkpointState = state; break; }
		}
		expect(checkpointState).toBeDefined();
		const state = checkpointState!;
		expect(extractRaid(state, state.raids[0]!.id, state.lastUpdated).ok).toBe(true);
		expect(state.history).toHaveLength(3);
		expect(restore(state)).toEqual(state);
		for (const report of state.history) {
			expect(report.squad!.members.map((member) => member.weaponId)).toEqual(["m4a1", "mcx", "trg42"]);
			expect(report.squad!.members.map((member) => member.loadout.ammoType)).toEqual(["precision", "subsonic", "piercing"]);
		}
		const legacyHistory = JSON.parse(saveGame(state)); legacyHistory.schemaVersion = 15;
		expect(parseSave(JSON.stringify(legacyHistory))).toBeNull();
	});
});
