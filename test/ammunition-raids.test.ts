import { withoutMedical } from './legacy-health-fixture';
import { describe, expect, test } from "bun:test";
import {
	SAVE_VERSION, advance, continueExpedition, createGame, dispatchRaid, dispatchSquadRaid,
	getExpeditionChoices, getLoadoutStats, getRaidQuote, getSquadRaidQuote, getSectorIntel, getWeaponRole,
	getWeaponStats, loadGameWithSummary, parseSave, saveGame, setAutoRaid, setAutoRaidDepth,
	setLoadoutOption, setRaidPlan, setRaidTactic, type GameState, type Raid,
} from "../src/game/engine";
import { AMMO_TYPES, getAmmoEffect, getAmmoModel } from "../src/game/ammunition";
import { MAP_BY_ID } from "../src/game/data";
import { TACTICS } from "../src/game/operations";
import { EXPEDITION_BRANCHES, type AmmoType, type RunPerk } from "../src/game/systems";
import { getWeaponRouteEffect } from "../src/game/weapon-mechanics";
import { useWeaponPlatformFixture } from "./weapon-fixtures";
import { withoutArsenalLoot, withoutRaidStrategy } from "./legacy-strategy-fixture";
import { withoutLoot } from "./legacy-loot-fixture";

const NOW = 1_792_000_000_000;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
function funded(now = NOW): GameState {
	const state = createGame(now);
	state.money = 50_000;
	state.supplies = { ammo: 1_000, medicine: 100, scrap: 1_000, intel: 100 };
	return state;
}
function copy(state: GameState): GameState {
	const restored = parseSave(saveGame(state));
	expect(restored).not.toBeNull();
	return restored!;
}
function freeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
function tickIrregularly(state: GameState, until: number) {
	const intervals = [997, 131, 7_001, 20_013, 301, 8_999];
	for (let index = 0; state.lastUpdated < until; index++) advance(state, Math.min(until, state.lastUpdated + intervals[index % intervals.length]!));
}
/** Finds earned checkpoints using actual dispatch and settlement, without forcing outcomes. */
function checkpoint(ammoType: AmmoType, count = 1, legacyCatalog = false) {
	for (let offset = 0; offset < 512; offset++) {
		const state = funded(NOW + offset), ids = state.scavs.slice(0, count).map((scav) => scav.id);
		for (const [index, id] of ids.entries()) expect(setLoadoutOption(state, id, "ammoType", count === 1 ? ammoType : AMMO_TYPES[index]!).ok).toBe(true);
		const result = count === 1 ? dispatchRaid(state, ids[0]!, "courtyard", state.lastUpdated)
			: dispatchSquadRaid(state, ids, "courtyard", state.lastUpdated);
		expect(result.ok).toBe(true);
		if (legacyCatalog) withoutLoot(withoutArsenalLoot(state));
		advance(state, Math.max(...state.raids.map((raid) => raid.endsAt)));
		if (state.raids.length === count && state.raids.every((raid) => raid.expedition?.status === "choice")) return { state, raid: state.raids[0]! };
	}
	throw new Error("No genuine ammunition checkpoint found");
}
function expectedNextChance(state: GameState, raid: Raid, branch: "scavenge" | "combat" | "recon", perk: RunPerk) {
	const expedition = raid.expedition!, snapshot = expedition.weaponMechanics!, ammo = expedition.ammunition!;
	const weapon = state.weapons.find((gun) => gun.id === raid.weaponInstanceId)!, current = getWeaponStats(weapon);
	const perks = [...expedition.perks, perk];
	return clamp(expedition.baseChance - expedition.stage * .09 + EXPEDITION_BRANCHES[branch].chanceBonus
		+ (current.power - snapshot.power) / 360 + (current.reliability - snapshot.reliability) / 1000
		+ getWeaponRouteEffect(weapon, raid.mapId, branch, raid.tactic, current).bonus - snapshot.firstBonus
		+ getAmmoEffect(weapon, expedition.loadout.ammoType, raid.mapId, branch, expedition.stage + 1, raid.tactic).bonus - ammo.firstBonus
		+ (getWeaponRole(weapon).branches[branch] ?? 0)
		+ (perks.includes("careful") ? .06 : 0) - (perks.includes("haggler") ? .04 : 0), .15, .97);
}

describe("caliber ammunition changes real paid raids", () => {
	test("all supported choices pay the shown supply cost and freeze the actual cartridge instead of a universal AP bonus", () => {
		for (const ammoType of AMMO_TYPES) {
			const state = funded(), scav = state.scavs[0]!, weapon = state.weapons[0]!, map = MAP_BY_ID.courtyard!;
			expect(setLoadoutOption(state, scav.id, "ammoType", ammoType).ok).toBe(true);
			const effect = getAmmoEffect(weapon, ammoType, map.id, "scavenge", 1, scav.tactic), model = getAmmoModel(weapon, ammoType);
			const quote = getRaidQuote(state, scav, map), before = { money: state.money, ammo: state.supplies.ammo, intel: state.supplies.intel };
			expect(quote.ammunition).toEqual(effect);
			expect(quote.ammo).toBe(Math.max(1, Math.ceil(map.ammoCost * TACTICS[scav.tactic].ammoMultiplier
				* getWeaponRole(weapon).ammoMultiplier * getWeaponStats(weapon).ammoMultiplier * getLoadoutStats(state, scav).ammoMultiplier * model.ammoMultiplier)));
			expect(dispatchRaid(state, scav.id, map.id, state.lastUpdated).ok).toBe(true);
			const raid = state.raids[0]!;
			expect(raid.chance).toBe(quote.chance);
			expect(raid.endsAt - raid.startedAt).toBe(quote.duration * 1_000);
			expect(state.money).toBe(before.money - quote.money);
			expect(state.supplies.ammo).toBe(before.ammo - quote.ammo);
			expect(state.supplies.intel).toBe(before.intel - quote.intel);
			expect(raid.expedition!.ammunition).toEqual({ modelId: model.id, firstBonus: effect.bonus,
				wearMultiplier: model.wearMultiplier, ammoMultiplier: model.ammoMultiplier });
			expect(raid.expedition!.loadout.ammoType).toBe(ammoType);
			expect(copy(state)).toEqual(state);
		}
	});

	test("real quote ordering rewards flesh damage in the yards and penetration against the bunker armor", () => {
		const state = funded(), scav = state.scavs[0]!, weapon = state.weapons[0]!;
		state.level = 9; state.xp = 5_760;
		scav.combat = 10; scav.scouting = 10; scav.health = 80;
		const quotes = (mapId: string) => Object.fromEntries(AMMO_TYPES.map((type) => {
			expect(setLoadoutOption(state, scav.id, "ammoType", type).ok).toBe(true);
			return [type, getRaidQuote(state, scav, MAP_BY_ID[mapId]!)];
		})) as Record<AmmoType, ReturnType<typeof getRaidQuote>>;
		const yards = quotes("courtyard"), bunker = quotes("bunker");
		expect(yards.expanding.chance).toBeGreaterThan(yards.piercing.chance);
		expect(bunker.piercing.chance).toBeGreaterThan(bunker.expanding.chance);
		expect(bunker.piercing.chance).toBeGreaterThan(bunker.standard.chance);
		for (const rows of [yards, bunker]) {
			const difference = rows.piercing.chance - rows.standard.chance;
			expect(difference).toBeCloseTo(rows.piercing.ammunition!.bonus - rows.standard.ammunition!.bonus, 12);
			expect(difference).not.toBeCloseTo(.055, 8);
		}
		expect(weapon.weaponId).toBe("sks");
	});

	test("next stage replaces only the departure ammunition effect with the deeper branch profile and commits its exact quote", () => {
		for (const ammoType of AMMO_TYPES) {
			const { state, raid } = checkpoint(ammoType), expedition = raid.expedition!, perk = expedition.offers[0]!;
			const snapshot = structuredClone(expedition.ammunition), choices = getExpeditionChoices(state, raid, perk);
			for (const choice of choices) expect(choice.chance).toBeCloseTo(expectedNextChance(state, raid, choice.branch, perk), 12);
			const combat = choices.find((choice) => choice.branch === "combat")!, map = MAP_BY_ID[raid.mapId]!;
			expect(combat.ammo).toBe(Math.max(1, Math.ceil(map.ammoCost * TACTICS[raid.tactic].ammoMultiplier
				* EXPEDITION_BRANCHES.combat.ammoMultiplier * expedition.ammoMultiplier * snapshot!.ammoMultiplier) + (perk === "pathfinder" ? 1 : 0)));
			const before = { money: state.money, ammo: state.supplies.ammo, intel: state.supplies.intel };
			expect(continueExpedition(state, raid.id, "combat", perk, state.lastUpdated).ok).toBe(true);
			expect(raid.chance).toBe(combat.chance);
			expect(state.money).toBe(before.money - combat.money);
			expect(state.supplies.ammo).toBe(before.ammo - combat.ammo);
			expect(state.supplies.intel).toBe(before.intel - combat.intel);
			expect(expedition.ammunition).toEqual(snapshot);
			expect(copy(state)).toEqual(state);
		}
	});

	test("active cartridges are locked and pure repeated previews neither draw randomness nor change paid gear", () => {
		const { state, raid } = checkpoint("precision"), scav = state.scavs[0]!, perk = raid.expedition!.offers[0]!;
		const before = saveGame(state), rng = state.rng, nextId = state.nextId;
		for (const type of AMMO_TYPES) expect(setLoadoutOption(state, scav.id, "ammoType", type).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		const frozen = freeze(copy(state)), frozenBefore = saveGame(frozen), choices = getExpeditionChoices(frozen, frozen.raids[0]!, perk);
		for (let index = 0; index < 30; index++) expect(getExpeditionChoices(frozen, frozen.raids[0]!, perk)).toEqual(choices);
		expect(saveGame(frozen)).toBe(frozenBefore);
		expect(state.rng).toBe(rng); expect(state.nextId).toBe(nextId);
		// An allowed next-sortie tactic cannot alter this sortie's ammo effects.
		expect(setRaidTactic(state, scav.id, scav.tactic === "bold" ? "cautious" : "bold").ok).toBe(true);
		expect(getExpeditionChoices(state, raid, perk)).toEqual(choices);
	});

	test("AP pressure produces additional real wear for identical settlement seeds and old unsnapshotted raids retain classic wear", () => {
		const standard = funded(), ap = funded();
		expect(setLoadoutOption(ap, ap.scavs[0]!.id, "ammoType", "piercing").ok).toBe(true);
		for (const state of [standard, ap]) expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		expect(ap.raids[0]!.seed).toBe(standard.raids[0]!.seed);
		expect(ap.raids[0]!.expedition!.ammunition!.wearMultiplier).toBeGreaterThan(1);
		const legacy = copy(ap); delete legacy.raids[0]!.expedition!.ammunition;
		for (const state of [standard, ap, legacy]) advance(state, state.raids[0]!.endsAt);
		expect(ap.weapons[0]!.durability).toBeLessThan(standard.weapons[0]!.durability);
		expect(legacy.weapons[0]!.durability).toBe(standard.weapons[0]!.durability);
	});

	test("penetrating bunker armor reduces actual wounds without introducing extra combat rolls", () => {
		let compared = false;
		for (let offset = 0; offset < 512 && !compared; offset++) {
			const ap = funded(NOW + offset), expanding = funded(NOW + offset);
			for (const [state, type] of [[ap, "piercing"], [expanding, "expanding"]] as const) {
				state.level = 9; state.xp = 5_760;
				expect(setLoadoutOption(state, state.scavs[0]!.id, "ammoType", type).ok).toBe(true);
				expect(dispatchRaid(state, state.scavs[0]!.id, "bunker", state.lastUpdated).ok).toBe(true);
			}
			const apRaid = ap.raids[0]!, hpRaid = expanding.raids[0]!, scavId = ap.scavs[0]!.id;
			expect(apRaid.seed).toBe(hpRaid.seed);
			expect(ap.rng).toBe(expanding.rng);
			advance(ap, apRaid.endsAt); advance(expanding, hpRaid.endsAt);
			const apReport = ap.history.find((report) => report.raidId === apRaid.id), hpReport = expanding.history.find((report) => report.raidId === hpRaid.id);
			// Compare genuine matched failed encounters; success and failure consume different outcome draws.
			if (apReport?.success !== false || hpReport?.success !== false) continue;
			const apScav = ap.scavs.find((scav) => scav.id === scavId), hpScav = expanding.scavs.find((scav) => scav.id === scavId);
			if (!apScav || !hpScav) continue;
			expect(apScav.health).toBeGreaterThan(hpScav.health);
			expect(ap.rng).toBe(expanding.rng);
			expect(copy(ap)).toEqual(ap); expect(copy(expanding)).toEqual(expanding);
			compared = true;
		}
		expect(compared).toBe(true);
	});

	test("v11 active AP raids retain paid chances, seed, frozen mechanics and classic branch cost through migration", () => {
		const { state } = checkpoint("piercing", 1, true), raw = JSON.parse(saveGame(state));
		raw.schemaVersion = 11;
		for (const raid of raw.raids) {
			// Historical AP applied a flat +5.5 points at departure. Preserve its paid result.
			raid.chance = raid.expedition.baseChance = clamp(raid.expedition.baseChance - raid.expedition.ammunition.firstBonus + .055, .22, .97);
			delete raid.expedition.ammunition;
		}
		withoutRaidStrategy(raw);
		const old = parseSave(JSON.stringify(raw))!;
		expect(old).not.toBeNull(); expect(old.schemaVersion).toBe(SAVE_VERSION);
		const raid = old.raids[0]!, expedition = raid.expedition!, perk = expedition.offers[0]!, map = MAP_BY_ID[raid.mapId]!;
		expect(expedition.ammunition).toBeUndefined();
		expect(raid.seed).toBe(state.raids[0]!.seed);
		expect(raid.chance).toBe(raw.raids[0].chance);
		expect(expedition.baseChance).toBe(raw.raids[0].expedition.baseChance);
		expect(expedition.weaponMechanics).toEqual(state.raids[0]!.expedition!.weaponMechanics);
		expect(old.money).toBe(state.money); expect(old.supplies).toEqual(state.supplies);
		const weapon = old.weapons.find((gun) => gun.id === raid.weaponInstanceId)!, current = getWeaponStats(weapon), snapshot = expedition.weaponMechanics!;
		const choices = getExpeditionChoices(old, raid, perk);
		for (const choice of choices) {
			expect(choice.ammo).toBe(Math.max(1, Math.ceil(map.ammoCost * TACTICS[raid.tactic].ammoMultiplier
				* EXPEDITION_BRANCHES[choice.branch].ammoMultiplier * expedition.ammoMultiplier * 1.65) + (perk === "pathfinder" ? 1 : 0)));
			expect(choice.chance).toBeCloseTo(clamp(expedition.baseChance - .09 + EXPEDITION_BRANCHES[choice.branch].chanceBonus
				+ (current.power - snapshot.power) / 360 + (current.reliability - snapshot.reliability) / 1000
				+ getWeaponRouteEffect(weapon, raid.mapId, choice.branch, raid.tactic, current).bonus - snapshot.firstBonus
				+ (getWeaponRole(weapon).branches[choice.branch] ?? 0) + (perk === "careful" ? .06 : 0) - (perk === "haggler" ? .04 : 0), .15, .97), 12);
		}
		const restored = copy(old);
		for (const state of [old, restored]) expect(continueExpedition(state, state.raids[0]!.id, "combat", perk, state.lastUpdated).ok).toBe(true);
		const until = old.raids[0]!.endsAt + 1_319;
		advance(old, until); tickIrregularly(restored, until);
		expect(restored).toEqual(old); expect(copy(old)).toEqual(old);
	});

	test("released v12 strategy raids keep paid quotes, sector knowledge and completed recon while using classic ammunition", () => {
		let original: GameState | null = null;
		for (let offset = 0; offset < 512 && !original; offset++) {
			const state = funded(NOW + offset), scav = state.scavs[0]!;
			state.sectorIntel = { courtyard: { knowledge: 3, pressure: 2 } };
			expect(setLoadoutOption(state, scav.id, "ammoType", "piercing").ok).toBe(true);
			expect(setRaidPlan(state, scav.id, "intel", "scouted").ok).toBe(true);
			expect(dispatchRaid(state, scav.id, "courtyard", state.lastUpdated).ok).toBe(true);
			withoutArsenalLoot(state);
			const raid = state.raids[0]!;
			advance(state, raid.endsAt);
			if (state.raids[0]?.expedition?.status !== "choice") continue;
			expect(continueExpedition(state, raid.id, "recon", raid.expedition!.offers[0]!, state.lastUpdated).ok).toBe(true);
			advance(state, raid.endsAt);
			if (state.raids[0]?.expedition?.status === "choice") original = state;
		}
		expect(original).not.toBeNull();
		const current = withoutMedical(withoutLoot(original!)), paid = current.raids[0]!;
		expect(paid.expedition!.reconCompleted).toBe(true);
		delete paid.expedition!.ammunition;
		const raw = JSON.parse(saveGame(current)); raw.schemaVersion = 12;
		const old = parseSave(JSON.stringify(raw))!;
		expect(old).not.toBeNull(); expect(old.schemaVersion).toBe(SAVE_VERSION);
		expect(old).toEqual(current);
		expect(getSectorIntel(old, "courtyard")).toEqual({ knowledge: 3, pressure: 2 });
		expect(old.scavs[0]!.raidPlan).toEqual({ objective: "intel", preparation: "scouted" });
		const raid = old.raids[0]!, expedition = raid.expedition!, perk = expedition.offers[0]!;
		expect(raid.strategy).toEqual(paid.strategy);
		expect(expedition.reconCompleted).toBe(true);
		expect(expedition.ammunition).toBeUndefined();
		const choices = getExpeditionChoices(old, raid, perk), map = MAP_BY_ID[raid.mapId]!;
		expect(choices).toEqual(getExpeditionChoices(current, paid, perk));
		for (const choice of choices) {
			expect(choice.ammunition).toBeNull();
			expect(choice.ammo).toBe(Math.max(1, Math.ceil(map.ammoCost * TACTICS[raid.tactic].ammoMultiplier
				* EXPEDITION_BRANCHES[choice.branch].ammoMultiplier * expedition.ammoMultiplier * 1.65)
				+ ([...expedition.perks, perk].includes("pathfinder") ? 1 : 0)));
		}
		for (const state of [current, old]) {
			const member = state.raids[0]!, before = state.supplies.ammo;
			const quote = getExpeditionChoices(state, member, perk).find((choice) => choice.branch === "combat")!;
			expect(continueExpedition(state, member.id, "combat", perk, state.lastUpdated).ok).toBe(true);
			expect(member.chance).toBe(quote.chance);
			expect(state.supplies.ammo).toBe(before - quote.ammo);
		}
		const until = current.raids[0]!.endsAt + 1_319;
		advance(current, until); tickIrregularly(old, until);
		expect(old).toEqual(current); expect(copy(old)).toEqual(old);
	});

	test("unknown and mismatched caliber cartridges, extra fields and malformed frozen costs reject the whole save", () => {
		const state = funded();
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		const raw = JSON.parse(saveGame(state)), incompatible = getAmmoModel({ weaponId: "pm" }, "standard").id;
		const edits: ((snapshot: Record<string, unknown>) => void)[] = [
			(snapshot) => { snapshot.modelId = "unknown-ammo"; }, (snapshot) => { snapshot.modelId = "constructor"; },
			(snapshot) => { snapshot.modelId = incompatible; },
			(snapshot) => { snapshot.modelId = getAmmoModel(state.weapons[0]!, "piercing").id; },
			(snapshot) => { snapshot.firstBonus = -1; }, (snapshot) => { snapshot.firstBonus = 1; },
			(snapshot) => { snapshot.firstBonus = Infinity; }, (snapshot) => { snapshot.wearMultiplier = NaN; },
			(snapshot) => { snapshot.ammoMultiplier = 0; }, (snapshot) => { snapshot.ammoMultiplier = 100; },
			(snapshot) => { snapshot.wearMultiplier = 0; }, (snapshot) => { snapshot.wearMultiplier = 100; },
			(snapshot) => { snapshot.freeAmmo = true; },
			...(["modelId", "firstBonus", "wearMultiplier", "ammoMultiplier"] as const).map((key) => (snapshot: Record<string, unknown>) => { delete snapshot[key]; }),
		];
		for (const edit of edits) {
			const forged = structuredClone(raw); edit(forged.raids[0].expedition.ammunition);
			expect(parseSave(JSON.stringify(forged))).toBeNull();
		}
		for (const value of [null, [], "ammunition", 42]) {
			const forged = structuredClone(raw); forged.raids[0].expedition.ammunition = value;
			expect(parseSave(JSON.stringify(forged))).toBeNull();
		}
		const injectedV12 = structuredClone(raw); injectedV12.schemaVersion = 12;
		withoutArsenalLoot(injectedV12);
		expect(parseSave(JSON.stringify(injectedV12))).toBeNull();
		for (const type of ["expanding", "precision"]) {
			const unsupportedV12 = structuredClone(raw); unsupportedV12.schemaVersion = 12;
			withoutArsenalLoot(unsupportedV12);
			delete unsupportedV12.raids[0].expedition.ammunition;
			unsupportedV12.scavs[0].loadout.ammoType = type;
			expect(parseSave(JSON.stringify(unsupportedV12))).toBeNull();
		}
		expect(copy(state)).toEqual(state);
	});

	test("three-stage automatic ammunition remains deterministic in bulk, irregular ticks and an offline reload", () => {
		const initial = funded();
		for (const [index, scav] of initial.scavs.entries()) {
			expect(setLoadoutOption(initial, scav.id, "ammoType", AMMO_TYPES[index + 1]!).ok).toBe(true);
			expect(setRaidTactic(initial, scav.id, "cautious").ok).toBe(true);
			expect(setAutoRaidDepth(initial, scav.id, 3).ok).toBe(true);
			expect(setAutoRaid(initial, scav.id, "courtyard", 25, initial.lastUpdated).ok).toBe(true);
		}
		expect(initial.raids).toHaveLength(3);
		expect(new Set(initial.raids.map((raid) => raid.expedition!.ammunition!.modelId)).size).toBe(3);
		const bulk = copy(initial), irregular = copy(initial), until = initial.lastUpdated + 15 * 60_000;
		advance(bulk, until); tickIrregularly(irregular, until);
		const offline = loadGameWithSummary(saveGame(initial), until)!;
		expect(bulk.history.length).toBeGreaterThan(0);
		expect(irregular).toEqual(bulk); expect(offline.state).toEqual(bulk); expect(copy(bulk)).toEqual(bulk);
	});

	test("mixed-caliber squads pay each member's cartridge and retain all frozen loads through a shared continuation", () => {
		for (const count of [2, 3]) {
			const initial = funded(), ids = initial.scavs.slice(0, count).map((scav) => scav.id);
			for (const [index, id] of ids.entries()) {
				const scav = initial.scavs.find((item) => item.id === id)!, gun = initial.weapons.find((item) => item.id === scav.weaponInstanceId)!;
				useWeaponPlatformFixture(initial, gun, ["sks", "pm", "ak74"][index]!);
				expect(setLoadoutOption(initial, id, "ammoType", AMMO_TYPES[index + 1]!).ok).toBe(true);
			}
			const quote = getSquadRaidQuote(initial, ids, "courtyard"), ammo = initial.supplies.ammo;
			expect(dispatchSquadRaid(initial, ids, "courtyard", initial.lastUpdated).ok).toBe(true);
			expect(initial.supplies.ammo).toBe(ammo - quote.ammo);
			const modelIds = initial.raids.map((raid) => raid.expedition!.ammunition!.modelId);
			expect(new Set(modelIds).size).toBe(count); expect(copy(initial)).toEqual(initial);
			const { state, raid } = checkpoint("standard", count), perk = raid.expedition!.offers[0]!;
			const choice = getExpeditionChoices(state, raid, perk).find((item) => item.branch === "combat")!;
			const snapshots = state.raids.map((member) => structuredClone(member.expedition!.ammunition)), before = state.supplies.ammo;
			expect(continueExpedition(state, raid.id, "combat", perk, state.lastUpdated).ok).toBe(true);
			expect(state.supplies.ammo).toBe(before - choice.ammo);
			expect(state.raids.reduce((product, member) => product * member.chance, 1)).toBeCloseTo(choice.chance, 12);
			expect(state.raids.map((member) => member.expedition!.ammunition)).toEqual(snapshots);
			const bulk = copy(state), irregular = copy(state), until = raid.endsAt + 7_119;
			advance(bulk, until); tickIrregularly(irregular, until);
			expect(irregular).toEqual(bulk); expect(loadGameWithSummary(saveGame(state), until)!.state).toEqual(bulk);
		}
	});
});
