import { copyWeaponFixture, useWeaponPlatformFixture } from "./weapon-fixtures";
import { describe, expect, test } from "bun:test";
import {
	MAX_OFFLINE_MS,
	SAVE_KEY,
	SAVE_VERSION,
	advance,
	createGame,
	equipWeapon,
	loadGame,
	parseSave,
	recruitScav,
	getRecruitmentBoard,
	refreshRecruitment,
	saveGame,
	setAutoRaid,
	setRaidTactic,
	stopAllAutoRaids,
	upgradeScavGear,
	type GameState,
} from "../src/game/engine";

const NOW = 1_792_000_000_000;

// Captured from the actual version 1 engine before the migration was introduced.
// In particular, none of the new scav, raid, or report fields exist in this save.
const VERSION_ONE_SAVE = `{"schemaVersion":1,"createdAt":1792000000000,"lastUpdated":1792000010000,"money":644,"supplies":{"ammo":22,"medicine":6,"scrap":18,"intel":3},"xp":0,"level":1,"base":{"workshop":1,"medbay":1,"radio":1,"storage":1},"scavs":[{"id":"scav-5","name":"Борода","personality":"veteran","combat":36,"scouting":31,"level":1,"xp":0,"health":100,"weaponInstanceId":"gun-1","status":"raiding","raids":0},{"id":"scav-6","name":"Рыжий","personality":"collector","combat":29,"scouting":42,"level":1,"xp":0,"health":100,"weaponInstanceId":"gun-2","status":"ready","raids":0},{"id":"scav-7","name":"Шустрый","personality":"runner","combat":27,"scouting":35,"level":1,"xp":0,"health":100,"weaponInstanceId":"gun-3","status":"ready","raids":0}],"weapons":[{"id":"gun-1","weaponId":"sks","durability":100,"attachments":{"optic":0,"magazine":0,"stock":0},"foundAt":1792000000000},{"id":"gun-2","weaponId":"pp91","durability":100,"attachments":{"optic":0,"magazine":0,"stock":0},"foundAt":1792000000000},{"id":"gun-3","weaponId":"mp133","durability":100,"attachments":{"optic":0,"magazine":0,"stock":0},"foundAt":1792000000000},{"id":"gun-4","weaponId":"pm","durability":100,"attachments":{"optic":0,"magazine":0,"stock":0},"foundAt":1792000000000}],"raids":[{"id":"raid-8","scavId":"scav-5","scavName":"Борода","mapId":"courtyard","weaponInstanceId":"gun-1","startedAt":1792000000000,"endsAt":1792000034000,"chance":0.8510000000000001,"lootBonus":0.1088888888888889,"seed":1300907748}],"history":[],"claimedContracts":[],"discoveredWeapons":["sks","pp91","mp133","pm"],"stats":{"raidsWon":0,"raidsCompleted":0,"weaponsFound":0,"rareWeaponsFound":0,"moneyEarned":4,"mapsVisited":["courtyard"],"lostScavs":0},"clock":{"income":0,"ammo":10000,"scrap":10000,"intel":10000},"rng":1300907748,"nextId":9}`;

function squad(size: number, seed = 0x70a90211): GameState {
	const state = createGame(NOW);
	state.base = { workshop: 5, medbay: 5, radio: 5, storage: 5 };
	state.money = 100_000;
	state.supplies = { ammo: 500, medicine: 100, scrap: 500, intel: 150 };
	state.xp = 90 * 11 ** 2;
	state.level = 12;
	state.scavs.length = Math.min(size, state.scavs.length);
	while (state.scavs.length < size) {
		if (!getRecruitmentBoard(state).length) expect(refreshRecruitment(state).ok).toBe(true);
		expect(recruitScav(state).ok).toBe(true);
	}
	for (const scav of state.scavs) {
		if (!scav.weaponInstanceId) {
			const template = state.weapons[0]!;
			const weapon = copyWeaponFixture(state, template);
			state.weapons.push(weapon);
			expect(equipWeapon(state, scav.id, weapon.id).ok).toBe(true);
		}
	}
	state.rng = seed;
	return state;
}

function clone(state: GameState): GameState {
	const copy = parseSave(saveGame(state));
	expect(copy).not.toBeNull();
	return copy!;
}

function varyTicks(state: GameState, until: number): number {
	const pattern = [997, 30_103, 1_234, 8_777, 60_606, 1_999, 17_003];
	let cursor = state.lastUpdated;
	let tick = 0;
	let completed = 0;
	while (cursor < until) {
		cursor = Math.min(until, cursor + pattern[tick++ % pattern.length]!);
		completed += advance(state, cursor).completedCount;
	}
	return completed;
}

describe("automatic operation regression coverage", () => {
	test("two to seven automatic scavs produce identical state under irregular render ticks", () => {
		for (const size of [2, 3, 5, 7]) {
			const long = squad(size, 123_456_789 + size);
			long.scavs.forEach((scav, index) => {
				expect(setRaidTactic(long, scav.id, ["cautious", "balanced", "bold"][index % 3] as "cautious" | "balanced" | "bold").ok).toBe(true);
				expect(setAutoRaid(long, scav.id, ["courtyard", "depot", "forest"][index % 3]!, [25, 70, 95][index % 3]!, NOW).ok).toBe(true);
			});
			const short = clone(long);
			const longSummary = advance(long, NOW + 45 * 60_000);
			const shortCount = varyTicks(short, NOW + 45 * 60_000);
			expect(shortCount).toBe(longSummary.completedCount);
			expect(short).toEqual(long);
			expect(parseSave(saveGame(long))).not.toBeNull();
		}
	});

	test("a midpoint save reload retains automatic policies, RNG, outcomes and loot", () => {
		const uninterrupted = squad(7, 0x12345678);
		uninterrupted.scavs.forEach((scav, index) => {
			expect(setRaidTactic(uninterrupted, scav.id, "cautious").ok).toBe(true);
			expect(setAutoRaid(uninterrupted, scav.id, index % 2 ? "depot" : "courtyard", 95, NOW).ok).toBe(true);
		});
		varyTicks(uninterrupted, NOW + 257_713);
		const reloaded = loadGame(saveGame(uninterrupted), uninterrupted.lastUpdated)!;
		expect(reloaded).not.toBeNull();
		expect(reloaded).toEqual(uninterrupted);
		advance(uninterrupted, NOW + 3_600_000);
		varyTicks(reloaded, NOW + 3_600_000);
		expect(reloaded).toEqual(uninterrupted);
	});

	test("shared empty ammunition waits for production and awards simultaneous contenders in a stable order", () => {
		const state = createGame(NOW);
		state.supplies.ammo = 0;
		// Equal costs make these actual simultaneous resource contenders; gun
		// roles now let a cheap shotgun leave before a more costly rifle.
		for (const scav of state.scavs) useWeaponPlatformFixture(state, state.weapons.find((weapon) => weapon.id === scav.weaponInstanceId)!, "pm");
		for (const scav of [...state.scavs].reverse())
			expect(setAutoRaid(state, scav.id, "courtyard", 70, NOW).ok).toBe(true);
		expect(state.raids).toHaveLength(0);
		advance(state, NOW + 59_999);
		expect(state.raids).toHaveLength(0);
		advance(state, NOW + 60_000);
		expect(state.raids).toHaveLength(1);
		expect(state.raids[0]!.scavId).toBe([...state.scavs].sort((a, b) => a.id.localeCompare(b.id))[0]!.id);
		expect(state.raids[0]!.startedAt).toBe(NOW + 60_000);
		expect(state.supplies.ammo).toBe(0);
		const resumed = clone(state);
		advance(state, NOW + 600_000);
		varyTicks(resumed, NOW + 600_000);
		expect(resumed).toEqual(state);
		expect(Object.values(state.supplies).every((value) => value >= 0)).toBe(true);
	});

	test("an injured automatic scav heals up to its policy threshold before its first departure", () => {
		const state = createGame(NOW);
		const scav = state.scavs[0]!;
		scav.health = 24;
		scav.status = "wounded";
		expect(setAutoRaid(state, scav.id, "courtyard", 70, NOW).ok).toBe(true);
		advance(state, NOW + 600_000);
		expect(state.raids).toHaveLength(0);
		expect(scav.health).toBeCloseTo(63, 5);
		advance(state, NOW + 710_000);
		expect(state.raids).toHaveLength(1);
		expect(state.raids[0]!.startedAt).toBeGreaterThan(NOW + 700_000);
		expect(state.raids[0]!.startedAt).toBeLessThanOrEqual(NOW + 710_000);
		expect(scav.health).toBeGreaterThanOrEqual(70);
	});

	test("disabling repeats during an active raid settles that raid once without restarting it", () => {
		const state = createGame(NOW);
		const scav = state.scavs[0]!;
		expect(setAutoRaid(state, scav.id, "courtyard", 70, NOW).ok).toBe(true);
		const raidId = state.raids[0]!.id;
		expect(setAutoRaid(state, scav.id, null, 70, NOW + 1_000).ok).toBe(true);
		expect(state.raids[0]!.id).toBe(raidId);
		const summary = advance(state, NOW + MAX_OFFLINE_MS);
		expect(summary.completedCount).toBe(1);
		expect(state.history[0]!.raidId).toBe(raidId);
		expect(state.raids).toHaveLength(0);
		expect(state.stats.raidsCompleted).toBe(1);
		expect(advance(state, NOW + MAX_OFFLINE_MS + 60_000).completedCount).toBe(0);
	});

	test("stopping the whole roster at a simultaneous return settles old raids before any new departure", () => {
		const state = createGame(NOW);
		for (const scav of state.scavs) {
			scav.personality = "veteran";
			useWeaponPlatformFixture(state, state.weapons.find((weapon) => weapon.id === scav.weaponInstanceId)!, "sks");
			expect(setAutoRaid(state, scav.id, "courtyard", 25, NOW).ok).toBe(true);
		}
		const endsAt = state.raids[0]!.endsAt;
		expect(state.raids.every((raid) => raid.endsAt === endsAt)).toBe(true);
		const expected = clone(state);
		for (const scav of expected.scavs)
			expect(setAutoRaid(expected, scav.id, null, 25, NOW).ok).toBe(true);
		advance(expected, endsAt);
		stopAllAutoRaids(state, endsAt);
		expect(state).toEqual(expected);
		expect(state.stats.raidsCompleted).toBe(3);
		expect(state.raids).toHaveLength(0);
		expect(state.scavs.every((scav) => !scav.autoRaid.enabled)).toBe(true);
		expect(parseSave(saveGame(state))).not.toBeNull();
	});

	test("a mid-raid stop-all disables every order while preserving all three current runs", () => {
		const state = createGame(NOW);
		for (const scav of state.scavs)
			expect(setAutoRaid(state, scav.id, "courtyard", 70, NOW).ok).toBe(true);
		const raids = structuredClone(state.raids);
		stopAllAutoRaids(state, NOW + 5_000);
		expect(state.raids).toEqual(raids);
		expect(state.scavs.every((scav) => !scav.autoRaid.enabled)).toBe(true);
		expect(advance(state, NOW + 120_000).completedCount).toBe(3);
		expect(state.raids).toHaveLength(0);
	});

	test("a missing automatic scav cannot be resurrected by recovery, another tick or reload", () => {
		const initial = createGame(NOW);
		const scavId = initial.scavs[0]!.id;
		expect(setAutoRaid(initial, scavId, "courtyard", 25, NOW).ok).toBe(true);
		initial.raids[0]!.chance = 0;
		let lethal: GameState | null = null;
		for (let seed = 1; seed <= 1000; seed++) {
			const candidate = clone(initial);
			candidate.raids[0]!.seed = seed;
			advance(candidate, candidate.raids[0]!.endsAt);
			if (candidate.history[0]!.lostScav) {
				lethal = candidate;
				break;
			}
		}
		expect(lethal).not.toBeNull();
		advance(lethal!, NOW + MAX_OFFLINE_MS);
		expect(lethal!.scavs.some((scav) => scav.id === scavId)).toBe(false);
		expect(lethal!.raids.some((raid) => raid.scavId === scavId)).toBe(false);
		expect(lethal!.stats.raidsCompleted).toBe(1);
		expect(lethal!.stats.lostScavs).toBe(1);
		const reloaded = loadGame(saveGame(lethal!), lethal!.lastUpdated)!;
		expect(reloaded).toEqual(lethal!);
		advance(reloaded, NOW + MAX_OFFLINE_MS + 60_000);
		expect(reloaded.scavs.some((scav) => scav.id === scavId)).toBe(false);
		expect(reloaded.stats.lostScavs).toBe(1);
	});

	test("the eight-hour automatic summary counts every completed raid while keeping only recent reports", () => {
		const state = squad(7, 654_321);
		for (const scav of state.scavs) {
			expect(setRaidTactic(state, scav.id, "cautious").ok).toBe(true);
			expect(setAutoRaid(state, scav.id, "courtyard", 25, NOW).ok).toBe(true);
		}
		const summary = advance(state, NOW + MAX_OFFLINE_MS * 3);
		expect(summary.capped).toBe(true);
		expect(summary.elapsedMs).toBe(MAX_OFFLINE_MS);
		expect(summary.completedCount).toBe(state.stats.raidsCompleted);
		expect(summary.completedCount).toBeGreaterThan(40);
		expect(summary.completed).toHaveLength(40);
		expect(state.history).toHaveLength(40);
		expect(new Set(summary.completed.map((report) => report.raidId)).size).toBe(40);
		expect(state.lastUpdated).toBe(NOW + MAX_OFFLINE_MS * 3);
		for (const raid of state.raids) {
			expect(raid.startedAt).toBeLessThanOrEqual(state.lastUpdated);
			expect(raid.endsAt).toBeGreaterThan(state.lastUpdated);
		}
		expect(parseSave(saveGame(state))).not.toBeNull();
		const saved = saveGame(state);
		expect(advance(state, state.lastUpdated).completedCount).toBe(0);
		expect(saveGame(state)).toBe(saved);
	});

	test("busy gear upgrades spend nothing and the next-raid tactic cannot alter the current snapshot", () => {
		const state = squad(3);
		const scav = state.scavs[0]!;
		expect(setAutoRaid(state, scav.id, "courtyard", 70, NOW).ok).toBe(true);
		const saved = saveGame(state);
		expect(upgradeScavGear(state, scav.id, "armor").ok).toBe(false);
		expect(upgradeScavGear(state, scav.id, "backpack").ok).toBe(false);
		expect(saveGame(state)).toBe(saved);
		const raid = { ...state.raids[0]! };
		expect(setRaidTactic(state, scav.id, "bold").ok).toBe(true);
		expect(state.raids[0]).toEqual(raid);
	});
});

describe("legacy migration regression coverage", () => {
	test("a real v1 save keeps its running raid and disabled automatic policies under the existing storage key", () => {
		expect(SAVE_KEY).toBe("prapor.save.v1");
		const state = parseSave(VERSION_ONE_SAVE)!;
		expect(state).not.toBeNull();
		expect(state.schemaVersion).toBe(SAVE_VERSION);
		expect(state.money).toBe(644);
		expect(state.rng).toBe(1_300_907_748);
		expect(state.scavs.every((scav) => !scav.autoRaid.enabled)).toBe(true);
		expect(state.raids).toHaveLength(1);
		expect(state.raids[0]!.id).toBe("raid-8");
		expect(state.raids[0]!.seed).toBe(1_300_907_748);
		expect(state.raids[0]!.startedAt).toBe(NOW);
		expect(state.raids[0]!.endsAt).toBe(NOW + 34_000);
		expect(state.raids[0]!.isAuto).toBe(false);
		expect(state.raids[0]!.tactic).toBe("balanced");
		expect(state.raids[0]!.armorLevel).toBe(0);
		expect(state.raids[0]!.backpackLevel).toBe(0);
		expect(advance(state, NOW + 34_000).completedCount).toBe(1);
		// Golden result from the pre-migration engine, using this same persisted seed.
		// The migrated loot remains identical. This old balance already exceeds
		// the new recovery allowance, so it receives no extra idle cash.
		expect(state.money).toBe(760);
		expect(state.supplies).toEqual({ ammo: 28, medicine: 6, scrap: 22, intel: 4 });
		expect(state.history[0]!.success).toBe(true);
		expect(state.history[0]!.money).toBe(116);
		expect(state.history[0]!.supplies).toEqual({ ammo: 5, medicine: 0, scrap: 4, intel: 1 });
		expect(state.history[0]!.weaponId).toBeNull();
		expect(state.weapons[0]!.durability).toBe(87);
		expect(state.scavs[0]!.health).toBe(92);
		expect(state.rng).toBe(1_300_907_748);
		// Migration allocates one distinct physical id for each factory component.
		expect(state.nextId).toBe(10 + state.weapons.reduce((count, gun) => count + Object.keys(gun.modules).length, 0));
		expect(advance(state, NOW + 600_000).completedCount).toBe(0);
		expect(state.stats.raidsCompleted).toBe(1);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("a v2 save migrates personal upgrades, automatic policies and old weapon mods without replacing its active outcome", () => {
		const legacy = JSON.parse(VERSION_ONE_SAVE);
		legacy.schemaVersion = 2;
		for (const scav of legacy.scavs) {
			scav.tactic = "balanced";
			scav.gear = { armor: 0, backpack: 0 };
			scav.autoRaid = { mapId: "courtyard", enabled: false, minHealth: 70, runs: 0, waitingReason: null };
		}
		legacy.scavs[1].gear = { armor: 3, backpack: 2 };
		legacy.scavs[1].tactic = "cautious";
		legacy.scavs[1].autoRaid.enabled = true;
		legacy.scavs[2].autoRaid.minHealth = 95;
		// The former workshop accepted these mods even on a PM: migrate the
		// owner's existing item, while new installs respect compatibility.
		legacy.weapons[3].attachments = { optic: 2, magazine: 3, stock: 1 };
		Object.assign(legacy.raids[0], { isAuto: false, tactic: "balanced", armorLevel: 0, backpackLevel: 0 });
		legacy.stats.autoRaidsCompleted = 0;
		legacy.stats.mapWins = {};
		const state = parseSave(JSON.stringify(legacy))!;
		expect(state).not.toBeNull();
		expect(state.schemaVersion).toBe(SAVE_VERSION);
		expect(state.scavs[1]!.gear).toEqual({ armor: 3, backpack: 2 });
		expect(state.scavs[1]!.tactic).toBe("cautious");
		expect(state.scavs[1]!.autoRaid.enabled).toBe(true);
		expect(state.scavs[1]!.autoRaid.maxDepth).toBe(1);
		expect(state.scavs[2]!.autoRaid.minHealth).toBe(95);
		expect(state.weapons[3]!.attachments).toEqual({ optic: 2, magazine: 3, stock: 1 });
		expect(state.raids[0]!.expedition).toBeNull();
		expect(state.raids[0]!.seed).toBe(1_300_907_748);
		expect(advance(state, NOW + 34_000).completedCount).toBe(1);
		expect(state.history[0]!.money).toBe(116);
		expect(state.history[0]!.supplies).toEqual({ ammo: 5, medicine: 0, scrap: 4, intel: 1 });
		expect(state.weapons[0]!.durability).toBe(87);
		expect(state.scavs[0]!.health).toBe(92);
		expect(state.raids.some((raid) => raid.scavId === state.scavs[1]!.id && raid.expedition !== null)).toBe(true);
		expect(parseSave(saveGame(state))).toEqual(state);
		const after = saveGame(state);
		expect(advance(state, state.lastUpdated).completedCount).toBe(0);
		expect(saveGame(state)).toBe(after);
	});
});
