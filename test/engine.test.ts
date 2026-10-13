import { copyWeaponFixture } from "./weapon-fixtures";
import { describe, expect, test } from "bun:test";
import {
	MAX_OFFLINE_MS,
	advance,
	claimContract,
	createGame,
	dispatchRaid,
	equipWeapon,
	getRaidChance,
	getRaidDuration,
	getRaidAmmoCost,
	getGearCost,
	getContractProgress,
	getContractLockReason,
	getRaidPhase,
	getRaidQuote,
	getRecoveryAllowance,
	getSupplyCapacity,
	getWeaponPower,
	healScav,
	loadGame,
	loadGameWithSummary,
	modWeapon,
	parseSave,
	recruitScav,
	repairWeapon,
	saveGame,
	sellWeapon,
	setAutoRaid,
	setRaidTactic,
	upgradeScavGear,
	upgradeBase,
	type GameState,
} from "../src/game/engine";
import { CONTRACTS, MAPS } from "../src/game/data";

const NOW = 1_792_000_000_000;

// These original one-return regressions cover migrated v1/v2 sorties. New
// dispatches use checkpoint expeditions, covered independently in roguelite.test.
function dispatchLegacyRaid(state: GameState, scavId: string, mapId: string, now: number) {
	const result = dispatchRaid(state, scavId, mapId, now);
	if (result.ok) {
		const raid = state.raids.find((raid) => raid.id === result.raidId)!;
		raid.expedition = null;
		delete raid.strategy;
	}
	return result;
}

describe("the Prapor game loop", () => {
	test("starts with a playable roster, equipment, supplies and a safe short raid", () => {
		const state = createGame(NOW);
		expect(state.scavs).toHaveLength(3);
		expect(state.weapons).toHaveLength(4);
		expect(state.scavs.every((scav) => scav.weaponInstanceId !== null)).toBe(
			true
		);
		expect(getRaidChance(state, state.scavs[0]!, MAPS[0]!)).toBeGreaterThan(
			0.8
		);
		const quote = getRaidQuote(state, state.scavs[0]!, MAPS[0]!);
		const result = dispatchLegacyRaid(state, state.scavs[0]!.id, "courtyard", NOW);
		expect(result.ok).toBe(true);
		expect(state.raids[0]!.endsAt - NOW).toBe(quote.duration * 1000);
		expect(state.raids[0]!.endsAt - NOW).toBeLessThanOrEqual(40_000);
		expect(state.supplies.ammo).toBe(24 - quote.ammo);
	});

	test("settles a raid once and rejects duplicate dispatch or changing its loadout", () => {
		const state = createGame(NOW);
		const scav = state.scavs[0]!;
		const raid = dispatchLegacyRaid(state, scav.id, "courtyard", NOW);
		expect(raid.ok).toBe(true);
		expect(dispatchLegacyRaid(state, scav.id, "courtyard", NOW).ok).toBe(false);
		expect(equipWeapon(state, scav.id, state.weapons[3]!.id).ok).toBe(false);
		expect(repairWeapon(state, scav.weaponInstanceId!).ok).toBe(false);
		const summary = advance(state, NOW + 40_000);
		expect(summary.completed).toHaveLength(1);
		expect(state.history).toHaveLength(1);
		expect(state.stats.raidsCompleted).toBe(1);
		expect(state.raids).toHaveLength(0);
		const money = state.money;
		expect(advance(state, NOW + 40_000).completed).toHaveLength(0);
		expect(state.money).toBe(money);
		expect(state.stats.raidsCompleted).toBe(1);
	});

	test("a save resumed mid-raid has the same outcome as the uninterrupted game", () => {
		const state = createGame(NOW);
		dispatchLegacyRaid(state, state.scavs[0]!.id, "courtyard", NOW);
		dispatchLegacyRaid(state, state.scavs[1]!.id, "courtyard", NOW);
		advance(state, NOW + 10_000);
		const resumed = loadGame(saveGame(state), NOW + 10_000)!;
		expect(resumed).not.toBeNull();
		advance(state, NOW + 90_000);
		advance(resumed, NOW + 90_000);
		expect(resumed).toEqual(state);
	});

	test("a long advance agrees with small advances across simultaneous raid events", () => {
		const long = createGame(NOW);
		dispatchLegacyRaid(long, long.scavs[0]!.id, "courtyard", NOW);
		dispatchLegacyRaid(long, long.scavs[1]!.id, "courtyard", NOW);
		const short = parseSave(saveGame(long))!;
		advance(long, NOW + 120_000);
		for (let seconds = 1; seconds <= 120; seconds++)
			advance(short, NOW + seconds * 1000);
		expect(short.money).toBe(long.money);
		expect(short.supplies).toEqual(long.supplies);
		expect(short.history).toEqual(long.history);
		expect(short.raids).toEqual(long.raids);
		short.scavs.forEach((scav, index) =>
			expect(scav.health).toBeCloseTo(long.scavs[index]!.health, 8)
		);
	});

	test("offline income is capped at eight hours and cannot be replayed", () => {
		const state = createGame(NOW);
		state.money = 0;
		const before = state.money;
		const summary = advance(state, NOW + MAX_OFFLINE_MS * 3);
		expect(summary.capped).toBe(true);
		expect(summary.elapsedMs).toBe(MAX_OFFLINE_MS);
		expect(state.money - before).toBe(getRecoveryAllowance(state));
		const earned = state.money;
		advance(state, NOW + MAX_OFFLINE_MS * 3);
		expect(state.money).toBe(earned);
		expect(state.supplies.ammo).toBe(getSupplyCapacity(state).ammo);
	});

	test("locked sectors and paid actions never produce negative resources", () => {
		const state = createGame(NOW);
		state.money = 0;
		state.supplies.scrap = 0;
		const initial = saveGame(state);
		expect(dispatchLegacyRaid(state, state.scavs[0]!.id, "bunker", NOW).ok).toBe(
			false
		);
		expect(upgradeBase(state, "workshop").ok).toBe(false);
		expect(modWeapon(state, state.weapons[0]!.id, "optic").ok).toBe(false);
		expect(saveGame(state)).toBe(initial);
	});

	test("inherited dictionary keys cannot become raid destinations", () => {
		const state = createGame(NOW);
		const before = saveGame(state);
		for (const mapId of ["__proto__", "constructor", "toString"]) {
			expect(dispatchLegacyRaid(state, state.scavs[0]!.id, mapId, NOW).ok).toBe(
				false
			);
		}
		expect(saveGame(state)).toBe(before);
		expect(parseSave(saveGame(state))).not.toBeNull();
	});

	test("weapon mods increase power; repairing requires supplies and restores durability", () => {
		const state = createGame(NOW);
		const weapon = state.weapons[0]!;
		const power = getWeaponPower(weapon);
		expect(modWeapon(state, weapon.id, "optic").ok).toBe(true);
		expect(getWeaponPower(weapon)).toBeGreaterThan(power);
		weapon.durability = 21;
		state.supplies.scrap = 0;
		const money = state.money;
		expect(repairWeapon(state, weapon.id).ok).toBe(false);
		expect(state.money).toBe(money);
		state.supplies.scrap = 20;
		expect(repairWeapon(state, weapon.id).ok).toBe(true);
		expect(weapon.durability).toBe(100);
	});

	test("roster capacity follows radio upgrades and equipment has only one owner", () => {
		const state = createGame(NOW);
		expect(recruitScav(state).ok).toBe(false);
		expect(upgradeBase(state, "radio").ok).toBe(true);
		expect(recruitScav(state).ok).toBe(true);
		expect(state.scavs).toHaveLength(4);
		const first = state.scavs[0]!;
		const second = state.scavs[1]!;
		const weaponId = first.weaponInstanceId!;
		expect(equipWeapon(state, second.id, weaponId).ok).toBe(true);
		expect(first.weaponInstanceId).toBeNull();
		expect(second.weaponInstanceId).toBe(weaponId);
		expect(parseSave(saveGame(state))).not.toBeNull();
	});

	test("a ruined roster has a free recruit with emergency equipment", () => {
		const state = createGame(NOW);
		state.scavs = [];
		state.weapons = [];
		state.money = 0;
		expect(recruitScav(state).ok).toBe(true);
		expect(state.scavs).toHaveLength(1);
		expect(state.scavs[0]!.weaponInstanceId).toBe(state.weapons[0]!.id);
		expect(dispatchLegacyRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(
			true
		);
	});

	test("an injured scav recovers for free and medicine can accelerate healing", () => {
		const state = createGame(NOW);
		const scav = state.scavs[0]!;
		scav.health = 0;
		scav.status = "wounded";
		state.supplies.medicine = 0;
		expect(healScav(state, scav.id).ok).toBe(false);
		expect(dispatchLegacyRaid(state, scav.id, "courtyard", NOW).ok).toBe(false);
		advance(state, NOW + 400_000);
		expect(scav.health).toBeGreaterThanOrEqual(25);
		expect(String(scav.status)).toBe("ready");
		state.supplies.medicine = 10;
		expect(healScav(state, scav.id).ok).toBe(true);
		expect(scav.medicalTreatment).toBeDefined();
		expect(scav.health).toBeLessThan(100);
		advance(state, scav.medicalTreatment!.endsAt);
		expect(scav.health).toBe(100);
	});

	test("contract rewards cannot be claimed twice", () => {
		const state = createGame(NOW);
		state.stats.raidsWon = 1;
		state.stats.raidsCompleted = 1;
		const before = state.money;
		expect(claimContract(state, "first-return").ok).toBe(true);
		expect(state.money).toBe(before + 220);
		const after = saveGame(state);
		expect(claimContract(state, "first-return").ok).toBe(false);
		expect(saveGame(state)).toBe(after);
	});

	test("the last gun cannot be sold, and selling assigned guns clears equipment", () => {
		const state = createGame(NOW);
		const first = state.scavs[0]!;
		expect(sellWeapon(state, first.weaponInstanceId!).ok).toBe(true);
		expect(first.weaponInstanceId).toBeNull();
		while (state.weapons.length > 1)
			expect(sellWeapon(state, state.weapons[0]!.id).ok).toBe(true);
		expect(sellWeapon(state, state.weapons[0]!.id).ok).toBe(false);
	});

	test("weapon loss and missing scavs leave no dangling equipment or active raid", () => {
		for (const seed of [1, 40]) {
			const state = createGame(NOW);
			const scavId = state.scavs[0]!.id;
			const gunId = state.scavs[0]!.weaponInstanceId;
			dispatchLegacyRaid(state, scavId, "courtyard", NOW);
			state.raids[0]!.chance = 0;
			state.raids[0]!.seed = seed;
			advance(state, NOW + 40_000);
			const report = state.history[0]!;
			expect(report.success).toBe(false);
			expect(report.lostWeapon).toBe(true);
			expect(state.weapons.some((weapon) => weapon.id === gunId)).toBe(false);
			expect(state.raids).toHaveLength(0);
			if (seed === 40) {
				expect(report.lostScav).toBe(true);
				expect(state.scavs.some((scav) => scav.id === scavId)).toBe(false);
				expect(state.stats.lostScavs).toBe(1);
			} else
				expect(
					state.scavs.find((scav) => scav.id === scavId)!.weaponInstanceId
				).toBeNull();
			expect(parseSave(saveGame(state))).not.toBeNull();
		}
	});

	test("a full arsenal sells new loot automatically and keeps the discovered collection", () => {
		const state = createGame(NOW);
		const template = state.weapons[3]!;
		while (state.weapons.length < 25) {
			state.weapons.push(copyWeaponFixture(state, template));
		}
		dispatchLegacyRaid(state, state.scavs[0]!.id, "courtyard", NOW);
		state.raids[0]!.chance = 1;
		state.raids[0]!.seed = 1;
		advance(state, NOW + 40_000);
		const report = state.history[0]!;
		expect(report.success).toBe(true);
		expect(report.weaponAutoSold).toBe(true);
		expect(report.weaponId).not.toBeNull();
		expect(state.weapons).toHaveLength(25);
		expect(state.stats.weaponsFound).toBe(1);
		expect(state.discoveredWeapons).toContain(report.weaponId!);
		expect(parseSave(saveGame(state))).not.toBeNull();
	});
});

describe("save boundaries", () => {
	test("current real-world timestamps round trip and malformed saves are rejected", () => {
		const original = createGame(NOW);
		expect(parseSave(saveGame(original))).toEqual(original);
		expect(loadGame(null, NOW)).toBeNull();
		expect(parseSave("broken")).toBeNull();
		expect(parseSave('{"schemaVersion":99}')).toBeNull();
		const cases = [
			{ ...original, money: -1 },
			{ ...original, level: 20 },
			{ ...original, rng: 0 },
			{ ...original, base: { ...original.base, radio: 9 } },
			{ ...original, weapons: [original.weapons[0], original.weapons[0]] },
			{ ...original, scavs: [{ ...original.scavs[0], health: 500 }] },
			{ ...original, nextId: 1 },
			{ ...original, discoveredWeapons: ["__proto__"] },
			{ ...original, claimedContracts: ["first-return", "first-return"] },
		];
		for (const invalid of cases)
			expect(parseSave(JSON.stringify(invalid))).toBeNull();
	});

	test("a raid with missing owner, duplicated settlement, or impossible timeline is rejected", () => {
		const state = createGame(NOW);
		dispatchLegacyRaid(state, state.scavs[0]!.id, "courtyard", NOW);
		const raid = state.raids[0]!;
		expect(parseSave(saveGame(state))).not.toBeNull();
		expect(
			parseSave(
				JSON.stringify({ ...state, raids: [{ ...raid, scavId: "scav-999" }] })
			)
		).toBeNull();
		expect(
			parseSave(
				JSON.stringify({ ...state, raids: [{ ...raid, endsAt: NOW - 1 }] })
			)
		).toBeNull();
		expect(
			parseSave(
				JSON.stringify({
					...state,
					raids: [{ ...raid, endsAt: NOW + 1_000_000 }],
				})
			)
		).toBeNull();
		expect(
			parseSave(
				JSON.stringify({
					...state,
					raids: [raid, { ...raid, id: "raid-99" }],
					nextId: 100,
				})
			)
		).toBeNull();
	});

	test("moving the local clock backwards preserves remaining raid time", () => {
		const state = createGame(NOW);
		dispatchLegacyRaid(state, state.scavs[0]!.id, "courtyard", NOW);
		advance(state, NOW + 10_000);
		const remaining = state.raids[0]!.endsAt - state.lastUpdated;
		const loaded = loadGame(saveGame(state), NOW - 5000)!;
		expect(loaded.raids[0]!.endsAt - loaded.lastUpdated).toBe(remaining);
		expect(parseSave(saveGame(loaded))).not.toBeNull();
	});

	test("dispatch after a live clock rollback preserves existing raids and a valid save", () => {
		const state = createGame(NOW);
		dispatchLegacyRaid(state, state.scavs[0]!.id, "courtyard", NOW);
		advance(state, NOW + 10_000);
		const remaining = state.raids[0]!.endsAt - state.lastUpdated;
		const rolledBackNow = NOW - 60_000;
		expect(
			dispatchLegacyRaid(state, state.scavs[1]!.id, "courtyard", rolledBackNow).ok
		).toBe(true);
		expect(state.raids[0]!.endsAt - state.lastUpdated).toBe(remaining);
		expect(state.raids[1]!.startedAt).toBe(rolledBackNow);
		expect(state.lastUpdated).toBe(rolledBackNow);
		expect(parseSave(saveGame(state))).not.toBeNull();
		advance(state, rolledBackNow + 40_000);
		expect(state.stats.raidsCompleted).toBe(2);
		expect(state.raids).toHaveLength(0);
		expect(parseSave(saveGame(state))).not.toBeNull();
	});

	test("automatic ticks rebase a live clock rollback without freezing routes or granting retroactive income", () => {
		const state = createGame(NOW);
		const scav = state.scavs[0]!;
		setAutoRaid(state, scav.id, "courtyard", 70, NOW);
		// This regression isolates repeat scheduling across clock rollback.
		// The new expedition seed stream differs from the legacy sortie stream.
		state.raids[0]!.chance = 1;
		advance(state, NOW + 10_000);
		const raidId = state.raids[0]!.id;
		const remaining = state.raids[0]!.endsAt - state.lastUpdated;
		const money = state.money;
		const rollback = NOW - 60_000;
		const summary = advance(state, rollback);
		expect(summary.elapsedMs).toBe(0);
		expect(summary.money).toBe(0);
		expect(state.money).toBe(money);
		expect(state.lastUpdated).toBe(rollback);
		expect(state.raids[0]!.id).toBe(raidId);
		expect(state.raids[0]!.endsAt - rollback).toBe(remaining);
		expect(parseSave(saveGame(state))).not.toBeNull();
		const reloaded = loadGame(saveGame(state), rollback)!;
		const finished = advance(state, rollback + remaining);
		expect(finished.completedCount).toBe(1);
		expect(state.history[0]!.raidId).toBe(raidId);
		expect(state.raids).toHaveLength(1);
		expect(state.raids[0]!.id).not.toBe(raidId);
		advance(reloaded, rollback + remaining);
		expect(reloaded).toEqual(state);
		expect(parseSave(saveGame(state))).not.toBeNull();
	});
});

describe("tactics, loadout and contract chains", () => {
	test("tactics trade travel time, success, loot and ammunition instead of creating a free bonus", () => {
		const state = createGame(NOW);
		const scav = state.scavs[0]!;
		const map = MAPS[1]!;
		const ordinary = { chance: getRaidChance(state, scav, map), duration: getRaidDuration(state, scav, map), ammo: getRaidAmmoCost(scav, map) };
		expect(setRaidTactic(state, scav.id, "cautious").ok).toBe(true);
		expect(getRaidChance(state, scav, map)).toBeGreaterThan(ordinary.chance);
		expect(getRaidDuration(state, scav, map)).toBeGreaterThan(ordinary.duration);
		expect(getRaidAmmoCost(scav, map)).toBeLessThanOrEqual(ordinary.ammo);
		expect(setRaidTactic(state, scav.id, "bold").ok).toBe(true);
		expect(getRaidChance(state, scav, map)).toBeLessThan(ordinary.chance);
		expect(getRaidDuration(state, scav, map)).toBeLessThan(ordinary.duration);
		expect(getRaidAmmoCost(scav, map)).toBeGreaterThan(ordinary.ammo);
	});

	test("personal gear pays atomically, stops at level three and snapshots its effects for the raid", () => {
		const state = createGame(NOW);
		const scav = state.scavs[0]!;
		const original = getRaidChance(state, scav, MAPS[0]!);
		const cost = getGearCost(scav, "armor");
		state.supplies.scrap = cost.scrap - 1;
		const before = saveGame(state);
		expect(upgradeScavGear(state, scav.id, "armor").ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		state.money = 10_000;
		state.supplies.scrap = 100;
		for (let level = 0; level < 3; level++) expect(upgradeScavGear(state, scav.id, "armor").ok).toBe(true);
		expect(getRaidChance(state, scav, MAPS[0]!)).toBeGreaterThan(original);
		expect(upgradeScavGear(state, scav.id, "armor").ok).toBe(false);
		expect(upgradeScavGear(state, scav.id, "backpack").ok).toBe(true);
		expect(dispatchLegacyRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
		expect(state.raids[0]!.armorLevel).toBe(3);
		expect(state.raids[0]!.backpackLevel).toBe(1);
		const lootBonus = state.raids[0]!.lootBonus;
		expect(setRaidTactic(state, scav.id, "bold").ok).toBe(true);
		expect(state.raids[0]!.tactic).toBe("balanced");
		expect(state.raids[0]!.lootBonus).toBe(lootBonus);
		expect(upgradeScavGear(state, scav.id, "backpack").ok).toBe(false);
	});

	test("raid phases reveal travel progress and completed stories agree with the actual outcome", () => {
		for (const success of [true, false]) {
			const state = createGame(NOW);
			dispatchLegacyRaid(state, state.scavs[0]!.id, "courtyard", NOW);
			const raid = state.raids[0]!;
			raid.chance = success ? 1 : 0;
			expect(getRaidPhase(raid, NOW - 1).progress).toBe(0);
			expect(getRaidPhase(raid, raid.endsAt + 1).progress).toBe(1);
			expect(getRaidPhase(raid, raid.startedAt + (raid.endsAt - raid.startedAt) * 0.55).label).toBe("Опасный участок");
			advance(state, raid.endsAt);
			const report = state.history[0]!;
			expect(report.events).toHaveLength(4);
			expect(report.events[0]!.at).toBe(raid.startedAt);
			expect(report.events[3]!.at).toBe(raid.endsAt);
			expect(report.events[3]!.text).toContain(report.description);
			expect(report.events[3]!.kind).toBe(success ? "success" : "danger");
			expect(parseSave(saveGame(state))).not.toBeNull();
		}
	});

	test("a contract may have enough progress but waits for its predecessor's claimed reward", () => {
		const state = createGame(NOW);
		const gear = CONTRACTS.find((contract) => contract.id === "gear-ready")!;
		state.scavs[0]!.gear.armor = 2;
		expect(getContractProgress(state, gear)).toBe(2);
		expect(getContractLockReason(state, gear)).toContain("Первый выход");
		const before = saveGame(state);
		expect(claimContract(state, gear.id).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		state.stats.raidsWon = 1;
		state.stats.raidsCompleted = 1;
		expect(claimContract(state, "first-return").ok).toBe(true);
		expect(getContractLockReason(state, gear)).toBeNull();
		expect(claimContract(state, gear.id).ok).toBe(true);
		expect(claimContract(state, gear.id).ok).toBe(false);
	});

	test("a disabled policy retains its health threshold, and a repaired weapon resumes a waiting route", () => {
		const state = createGame(NOW);
		const scav = state.scavs[0]!;
		expect(setAutoRaid(state, scav.id, null, 95, NOW).ok).toBe(true);
		expect(scav.autoRaid.minHealth).toBe(95);
		const weapon = state.weapons.find((item) => item.id === scav.weaponInstanceId)!;
		weapon.durability = 0;
		expect(setAutoRaid(state, scav.id, "courtyard", 95, NOW).ok).toBe(true);
		expect(state.raids).toHaveLength(0);
		expect(scav.autoRaid.waitingReason).toContain("ремонт");
		expect(repairWeapon(state, weapon.id).ok).toBe(true);
		advance(state, NOW);
		expect(state.raids).toHaveLength(1);
		expect(state.raids[0]!.isAuto).toBe(true);
	});

	test("loading exposes the actual offline result once, without replaying rewards", () => {
		const state = createGame(NOW);
		setAutoRaid(state, state.scavs[0]!.id, "courtyard", 70, NOW);
		const loaded = loadGameWithSummary(saveGame(state), NOW + 60_000)!;
		expect(loaded.summary.elapsedMs).toBe(60_000);
		expect(loaded.summary.completedCount).toBeGreaterThan(0);
		expect(loaded.state.stats.raidsCompleted).toBe(loaded.summary.completedCount);
		const twice = loadGameWithSummary(saveGame(loaded.state), NOW + 60_000)!;
		expect(twice.summary.completedCount).toBe(0);
		expect(twice.summary.money).toBe(0);
		expect(twice.state).toEqual(loaded.state);
	});
});
