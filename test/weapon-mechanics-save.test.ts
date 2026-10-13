import { withoutArsenalLoot, withoutRaidStrategy } from "./legacy-strategy-fixture";
import { describe, expect, test } from "bun:test";
import {
	SAVE_VERSION, advance, continueExpedition, craftModule, createGame, dispatchRaid, dispatchSquadRaid,
	getExpeditionChoices, getRaidQuote, getWeaponRole, getWeaponStats, installModule,
	loadGameWithSummary, parseSave, saveGame, setAutoRaid, setAutoRaidDepth, setRaidTactic,
	type GameState, type Raid,
} from "../src/game/engine";
import { MAP_BY_ID } from "../src/game/data";
import { EXPEDITION_BRANCHES, type ExpeditionBranch, type RunPerk } from "../src/game/systems";
import { getWeaponMechanics, getWeaponRouteEffect } from "../src/game/weapon-mechanics";
import { getAmmoEffect } from "../src/game/ammunition";

const NOW = 1_792_000_000_000;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
function funded(now = NOW): GameState {
	const state = createGame(now);
	state.money = 50_000;
	state.supplies = { ammo: 500, medicine: 50, scrap: 1_000, intel: 100 };
	state.base.workshop = 4;
	return state;
}
function copy(state: GameState): GameState {
	const loaded = parseSave(saveGame(state));
	expect(loaded).not.toBeNull();
	return loaded!;
}
function install(state: GameState, modelId: string) {
	let item = state.modules.find((part) => part.modelId === modelId);
	if (!item) {
		expect(craftModule(state, modelId).ok).toBe(true);
		item = state.modules.at(-1)!;
	}
	expect(installModule(state, state.weapons[0]!.id, item.id).ok).toBe(true);
}
function detailedBuild(state: GameState) {
	for (const modelId of ["handguard-sks-rail", "optic-reflex", "mount-barrel-ring", "flashlight-wide", "laser-box", "muzzle-7.62x39-suppressor"]) install(state, modelId);
}
function advanceIrregularly(state: GameState, until: number) {
	const steps = [997, 131, 7_001, 20_013, 301, 8_999];
	for (let index = 0; state.lastUpdated < until; index++) advance(state, Math.min(until, state.lastUpdated + steps[index % steps.length]!));
}
function freeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
/** Uses genuine seeded departures and arrivals; it never changes a combat roll. */
function checkpoint(count = 1, legacyCatalog = false) {
	for (let offset = 0; offset < 512; offset++) {
		const state = funded(NOW + offset);
		detailedBuild(state);
		const weaponAtDeparture = structuredClone(state.weapons[0]!);
		const ids = state.scavs.slice(0, count).map((scav) => scav.id);
		const result = count === 1 ? dispatchRaid(state, ids[0]!, "courtyard", state.lastUpdated)
			: dispatchSquadRaid(state, ids, "courtyard", state.lastUpdated);
		expect(result.ok).toBe(true);
		if (legacyCatalog) withoutArsenalLoot(state);
		const departure = copy(state);
		advance(state, Math.max(...state.raids.map((raid) => raid.endsAt)));
		if (state.raids.length === count && state.raids.every((raid) => raid.expedition?.status === "choice"))
			return { state, raid: state.raids[0]!, departure, weaponAtDeparture };
	}
	throw new Error("No genuine successful weapon mechanics checkpoint found");
}
function legacyChance(state: GameState, raid: Raid, branch: ExpeditionBranch, perk: RunPerk) {
	const expedition = raid.expedition!, weapon = state.weapons.find((gun) => gun.id === raid.weaponInstanceId)!;
	const perks = [...expedition.perks, perk];
	return clamp(expedition.baseChance - expedition.stage * .09 + EXPEDITION_BRANCHES[branch].chanceBonus
		+ (branch === "combat" ? expedition.gunCombatBonus : 0) + (getWeaponRole(weapon).branches[branch] ?? 0)
		+ (perks.includes("careful") ? .06 : 0) - (perks.includes("haggler") ? .04 : 0), .15, .97);
}

describe("weapon mechanics remain real through raid clocks and saves", () => {
	test("departure freezes real condition and weapon effects, pays the shown quote and restores without rerolling", () => {
		const state = funded();
		detailedBuild(state);
		const scav = state.scavs[0]!, weapon = state.weapons[0]!, stats = getWeaponStats(weapon), map = MAP_BY_ID.courtyard!;
		const quote = getRaidQuote(state, scav, map), before = { money: state.money, ammo: state.supplies.ammo, intel: state.supplies.intel };
		expect(quote.reason).toBeNull();
		expect(dispatchRaid(state, scav.id, map.id, state.lastUpdated).ok).toBe(true);
		const raid = state.raids[0]!;
		expect(state.schemaVersion).toBe(SAVE_VERSION);
		expect(raid.chance).toBe(quote.chance);
		expect(raid.endsAt - raid.startedAt).toBe(quote.duration * 1_000);
		expect(state.money).toBe(before.money - quote.money);
		expect(state.supplies.ammo).toBe(before.ammo - quote.ammo);
		expect(state.supplies.intel).toBe(before.intel - quote.intel);
		expect(raid.expedition!.weaponMechanics).toEqual({ power: stats.power, reliability: stats.reliability,
			firstBonus: getWeaponRouteEffect(weapon, map.id, "scavenge", scav.tactic, stats).bonus,
			wearMultiplier: getWeaponMechanics(weapon).wearMultiplier });
		expect(raid.expedition!.weaponMechanics!.wearMultiplier).toBeGreaterThan(1);
		expect(copy(state)).toEqual(state);
	});

	test("all repeated route previews are pure and the next stage accounts for actual checkpoint wear", () => {
		const { state, raid, weaponAtDeparture } = checkpoint(), perk = raid.expedition!.offers[0]!;
		const before = saveGame(state), rng = state.rng, nextId = state.nextId, frozen = freeze(copy(state)), frozenBefore = saveGame(frozen);
		const choices = getExpeditionChoices(frozen, frozen.raids[0]!, perk);
		for (let index = 0; index < 25; index++) expect(getExpeditionChoices(frozen, frozen.raids[0]!, perk)).toEqual(choices);
		expect(saveGame(state)).toBe(before);
		expect(saveGame(frozen)).toBe(frozenBefore);
		expect(state.rng).toBe(rng);
		expect(state.nextId).toBe(nextId);
		const combat = choices.find((choice) => choice.branch === "combat")!, expedition = raid.expedition!;
		const fresh = getWeaponStats(weaponAtDeparture), bonuses = getWeaponRouteEffect(weaponAtDeparture, raid.mapId, "combat", raid.tactic, fresh).bonus;
		const withoutWear = clamp(expedition.baseChance - .09 + EXPEDITION_BRANCHES.combat.chanceBonus
			+ bonuses - expedition.weaponMechanics!.firstBonus + (getWeaponRole(weaponAtDeparture).branches.combat ?? 0)
			+ getAmmoEffect(weaponAtDeparture, expedition.loadout.ammoType, raid.mapId, "combat", 2, raid.tactic).bonus - expedition.ammunition!.firstBonus
			+ (perk === "careful" ? .06 : 0) - (perk === "haggler" ? .04 : 0), .15, .97);
		expect(combat.reason).toBeNull();
		expect(combat.chance).toBeLessThan(withoutWear);
	});

	test("continuing charges exactly the displayed costs and commits the displayed chance without refreshing departure bonuses", () => {
		const { state, raid } = checkpoint(), perk = raid.expedition!.offers[0]!;
		const quote = getExpeditionChoices(state, raid, perk).find((choice) => choice.branch === "combat")!;
		const snapshot = structuredClone(raid.expedition!.weaponMechanics), before = { money: state.money, ammo: state.supplies.ammo, intel: state.supplies.intel };
		expect(quote.reason).toBeNull();
		expect(continueExpedition(state, raid.id, "combat", perk, state.lastUpdated).ok).toBe(true);
		expect(raid.chance).toBe(quote.chance);
		expect(raid.endsAt - raid.startedAt).toBe(quote.duration * 1_000);
		expect(state.money).toBe(before.money - quote.money);
		expect(state.supplies.ammo).toBe(before.ammo - quote.ammo);
		expect(state.supplies.intel).toBe(before.intel - quote.intel);
		expect(raid.expedition!.weaponMechanics).toEqual(snapshot);
		expect(copy(state)).toEqual(state);
	});

	test("a pre-mechanics v10 active decision retains its old branch rules and settles identically after migration", () => {
		const { state } = checkpoint(1, true), raw = JSON.parse(saveGame(state));
		withoutRaidStrategy(raw); raw.schemaVersion = 10;
		for (const raid of raw.raids) { delete raid.expedition.weaponMechanics; delete raid.expedition.ammunition; }
		const legacy = parseSave(JSON.stringify(raw))!;
		expect(legacy).not.toBeNull();
		expect(legacy.schemaVersion).toBe(SAVE_VERSION);
		const raid = legacy.raids[0]!, perk = raid.expedition!.offers[0]!;
		expect(raid.expedition!.weaponMechanics).toBeUndefined();
		expect(raid.chance).toBe(state.raids[0]!.chance);
		expect(raid.expedition!.baseChance).toBe(state.raids[0]!.expedition!.baseChance);
		const expected = getExpeditionChoices(legacy, raid, perk);
		for (const choice of expected) expect(choice.chance).toBe(legacyChance(legacy, raid, choice.branch, perk));
		const restored = copy(legacy);
		expect(getExpeditionChoices(restored, restored.raids[0]!, perk)).toEqual(expected);
		const until = legacy.lastUpdated + expected.find((choice) => choice.branch === "combat")!.duration * 1_000 + 1_319;
		for (const current of [legacy, restored]) expect(continueExpedition(current, current.raids[0]!.id, "combat", perk, current.lastUpdated).ok).toBe(true);
		advance(legacy, until);
		advanceIrregularly(restored, until);
		expect(restored).toEqual(legacy);
		expect(copy(legacy)).toEqual(legacy);
	});

	test("legacy decisions ignore new contextual bonuses and current power deltas until the next departure", () => {
		const { state } = checkpoint(), raid = state.raids[0]!, perk = raid.expedition!.offers[0]!;
		delete raid.expedition!.weaponMechanics;
		delete raid.expedition!.ammunition;
		const before = getExpeditionChoices(state, raid, perk), weapon = state.weapons.find((gun) => gun.id === raid.weaponInstanceId)!;
		weapon.durability = weapon.modules.receiver!.durability = 10;
		for (const slot of ["optic", "flashlight", "laser", "muzzle"] as const) if (weapon.modules[slot]) weapon.modules[slot]!.durability = 0;
		expect(getWeaponStats(weapon).ready).toBe(true);
		const after = getExpeditionChoices(state, raid, perk);
		expect(after.map((choice) => choice.chance)).toEqual(before.map((choice) => choice.chance));
		for (const choice of after) expect(choice.chance).toBe(legacyChance(state, raid, choice.branch, perk));
	});

	test("invalid snapshot numbers, omitted fields and injected mechanics are rejected rather than influencing a paid raid", () => {
		const state = funded();
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		const raw = JSON.parse(saveGame(state));
		const edits: ((snapshot: Record<string, unknown>) => void)[] = [
			(snapshot) => { snapshot.power = -1; }, (snapshot) => { snapshot.power = 251; }, (snapshot) => { snapshot.power = 1.5; },
			(snapshot) => { snapshot.reliability = 9; }, (snapshot) => { snapshot.reliability = 101; }, (snapshot) => { snapshot.reliability = 89.5; },
			(snapshot) => { snapshot.firstBonus = .120001; }, (snapshot) => { snapshot.firstBonus = -.120001; },
			(snapshot) => { snapshot.wearMultiplier = .84999; }, (snapshot) => { snapshot.wearMultiplier = 1.40001; },
			(snapshot) => { snapshot.power = NaN; }, (snapshot) => { snapshot.firstBonus = Infinity; },
			(snapshot) => { snapshot.wearMultiplier = -Infinity; }, (snapshot) => { snapshot.power = "47"; },
			(snapshot) => { snapshot.freeAmmo = true; },
			...(["power", "reliability", "firstBonus", "wearMultiplier"] as const).map((key) => (snapshot: Record<string, unknown>) => { delete snapshot[key]; }),
		];
		for (const edit of edits) {
			const forged = structuredClone(raw);
			edit(forged.raids[0].expedition.weaponMechanics);
			expect(parseSave(JSON.stringify(forged))).toBeNull();
		}
		for (const invalid of [null, [], "mechanics", 42]) {
			const forged = structuredClone(raw);
			forged.raids[0].expedition.weaponMechanics = invalid;
			expect(parseSave(JSON.stringify(forged))).toBeNull();
		}
		const forgedV10 = structuredClone(raw);
		forgedV10.schemaVersion = 10;
		expect(parseSave(JSON.stringify(forgedV10))).toBeNull();
		expect(copy(state)).toEqual(state);
	});

	test("real suppressor back pressure increases checkpoint wear for identical settlement seeds", () => {
		const bare = funded(), suppressed = funded();
		install(suppressed, "muzzle-7.62x39-suppressor");
		for (const state of [bare, suppressed]) expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		expect(suppressed.raids[0]!.seed).toBe(bare.raids[0]!.seed);
		expect(bare.raids[0]!.expedition!.weaponMechanics!.wearMultiplier).toBe(1);
		expect(suppressed.raids[0]!.expedition!.weaponMechanics!.wearMultiplier).toBeGreaterThan(1);
		const ordinaryGun = bare.weapons[0]!, suppressedGun = suppressed.weapons[0]!;
		advance(bare, bare.raids[0]!.endsAt);
		advance(suppressed, suppressed.raids[0]!.endsAt);
		expect(suppressedGun.durability).toBeLessThan(ordinaryGun.durability);
	});

	test("three-stage automatic mechanics settle identically in bulk, irregular ticks and an offline reload", () => {
		const initial = funded();
		detailedBuild(initial);
		for (const scav of initial.scavs) {
			expect(setRaidTactic(initial, scav.id, "cautious").ok).toBe(true);
			expect(setAutoRaidDepth(initial, scav.id, 3).ok).toBe(true);
			expect(setAutoRaid(initial, scav.id, "courtyard", 25, initial.lastUpdated).ok).toBe(true);
		}
		expect(initial.raids).toHaveLength(3);
		expect(initial.raids.every((raid) => raid.expedition?.weaponMechanics)).toBe(true);
		const bulk = copy(initial), irregular = copy(initial), until = initial.lastUpdated + 15 * 60_000;
		advance(bulk, until);
		advanceIrregularly(irregular, until);
		const offline = loadGameWithSummary(saveGame(initial), until)!;
		expect(offline).not.toBeNull();
		expect(bulk.history.length).toBeGreaterThan(0);
		expect(irregular).toEqual(bulk);
		expect(offline.state).toEqual(bulk);
		expect(copy(bulk)).toEqual(bulk);
	});

	test("two and three member squad continuations keep each weapon snapshot, match the group quote and remain deterministic", () => {
		for (const count of [2, 3]) {
			const { state, raid } = checkpoint(count), perk = raid.expedition!.offers[0]!;
			const quote = getExpeditionChoices(state, raid, perk).find((choice) => choice.branch === "combat")!;
			const snapshots = state.raids.map((member) => structuredClone(member.expedition!.weaponMechanics));
			const before = { money: state.money, ammo: state.supplies.ammo, intel: state.supplies.intel };
			expect(quote.reason).toBeNull();
			expect(continueExpedition(state, raid.id, "combat", perk, state.lastUpdated).ok).toBe(true);
			expect(state.money).toBe(before.money - quote.money);
			expect(state.supplies.ammo).toBe(before.ammo - quote.ammo);
			expect(state.supplies.intel).toBe(before.intel - quote.intel);
			expect(state.raids.reduce((chance, member) => chance * member.chance, 1)).toBeCloseTo(quote.chance, 12);
			expect(state.raids.map((member) => member.expedition!.weaponMechanics)).toEqual(snapshots);
			const bulk = copy(state), irregular = copy(state), until = raid.endsAt + 7_119;
			advance(bulk, until);
			advanceIrregularly(irregular, until);
			const offline = loadGameWithSummary(saveGame(state), until)!;
			expect(irregular).toEqual(bulk);
			expect(offline.state).toEqual(bulk);
			expect(copy(bulk)).toEqual(bulk);
		}
	});
});
