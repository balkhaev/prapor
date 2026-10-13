import { describe, expect, test } from "bun:test";
import { MAPS } from "../src/game/data";
import {
	MAX_OFFLINE_MS,
	SCAV_TALENTS,
	advance,
	assignWorker,
	chooseScavTalent,
	craftGear,
	createGame,
	dismissScav,
	dispatchRaid,
	equipGear,
	extractRaid,
	getLoadoutStats,
	getCargoWeight,
	getRaidQuote,
	getRecruitCandidateQuote,
	getRecruitmentBoard,
	getRecruitmentRefreshQuote,
	getScavCapacity,
	getScavProfileEffects,
	getScavTalentOffers,
	getStorageCapacity,
	getWeaponStats,
	hireRecruitCandidate,
	loadGameWithSummary,
	parseSave,
	queueModuleProduction,
	recruitScav,
	refreshRecruitment,
	saveGame,
	setAutoRaid,
	upgradeBase,
	type GameState,
	type Scav,
} from "../src/game/engine";
import { copyWeaponFixture, useWeaponPlatformFixture } from "./weapon-fixtures";
import { exportGameSave, parseGameSave } from "../src/game-save";
import { readGameSession } from "../src/game-session";

const NOW = 1_792_000_000_000;

function fundedCamp(now = NOW) {
	const state = createGame(now);
	state.money = 100_000;
	state.supplies = { ammo: 1_000, medicine: 100, scrap: 1_000, intel: 100 };
	for (let index = 0; index < 3; index++) expect(upgradeBase(state, "radio").ok).toBe(true);
	expect(getScavCapacity(state)).toBeGreaterThanOrEqual(6);
	return state;
}

function levelScav(scav: Scav, level: number) {
	scav.level = level;
	scav.xp = (level - 1) ** 2 * 60;
}

function freeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

function legacyV5(state: GameState) {
	const source = JSON.parse(saveGame(state));
	source.schemaVersion = 5;
	delete source.recruitment;
	delete source.memorials;
	for (const scav of source.scavs) { delete scav.profile; delete scav.story; }
	return source;
}

function hire(state: GameState, role: "assault" | "scout" | "technician" = "assault") {
	const candidate = getRecruitmentBoard(state).find((offer) => offer.role === role)!;
	expect(candidate).toBeDefined();
	const previous = new Set(state.scavs.map((scav) => scav.id));
	expect(hireRecruitCandidate(state, candidate.id).ok).toBe(true);
	return state.scavs.find((scav) => !previous.has(scav.id))!;
}

function finishSuccessfulRaid(state: GameState, mapId: string) {
	const scav = state.scavs[0]!;
	scav.health = 100;
	scav.status = "ready";
	const weapon = state.weapons.find((item) => item.id === scav.weaponInstanceId)!;
	weapon.durability = 100;
	for (const part of Object.values(weapon.modules)) part.durability = 100;
	expect(dispatchRaid(state, scav.id, mapId, state.lastUpdated).ok).toBe(true);
	const raid = state.raids.find((item) => item.scavId === scav.id)!;
	// The roll is fixed to exercise the network's settlement trigger, rather
	// than editing the counters whose provenance this test verifies.
	raid.chance = 1;
	expect(advance(state, raid.endsAt).completedCount).toBe(0);
	expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
}

describe("a persistent roguelite recruitment draft", () => {
	test("all preview getters are safe on frozen state and do not consume either random stream", () => {
		const state = fundedCamp();
		levelScav(state.scavs[0]!, 2);
		const before = saveGame(state);
		freeze(state);
		for (let index = 0; index < 30; index++) {
			const board = getRecruitmentBoard(state);
			expect(board).toHaveLength(3);
			expect(new Set(board.map((offer) => offer.role)).size).toBe(3);
			for (const candidate of board) getRecruitCandidateQuote(state, candidate.id);
			getRecruitmentRefreshQuote(state);
			for (const scav of state.scavs) {
				getScavTalentOffers(scav);
				getScavProfileEffects(scav);
				getRaidQuote(state, scav, MAPS[0]!);
			}
		}
		expect(saveGame(state)).toBe(before);
	});

	test("the same actual offers, prices and independent board seed survive reload, offline time and rollback", () => {
		const state = fundedCamp(), board = structuredClone(getRecruitmentBoard(state));
		const recruitment = structuredClone(state.recruitment), raidRng = state.rng;
		const nextId = state.nextId;
		for (const now of [NOW, NOW + MAX_OFFLINE_MS * 2, NOW - 60_000]) {
			const loaded = loadGameWithSummary(saveGame(state), now)!;
			expect(loaded).not.toBeNull();
			expect(getRecruitmentBoard(loaded.state)).toEqual(board);
			expect(loaded.state.recruitment).toEqual(recruitment);
			expect(loaded.state.rng).toBe(raidRng);
			expect(loaded.state.nextId).toBe(nextId);
			expect(parseSave(saveGame(loaded.state))).toEqual(loaded.state);
		}
	});

	test("the recruitment screen and selected owned scav resume from the same envelope as its board and build", () => {
		const state = fundedCamp(), scav = hire(state, "technician");
		levelScav(scav, 2);
		expect(chooseScavTalent(state, scav.id, getScavTalentOffers(scav)!.offers[0]!.id).ok).toBe(true);
		const session = readGameSession({ version: 1, page: "recruits", view: "base", scavId: scav.id }, state);
		const saved = saveGame(state), envelope = exportGameSave(state, session);
		const reloaded = parseGameSave(envelope, state.lastUpdated)!;
		expect(reloaded).not.toBeNull();
		expect(reloaded.state).toEqual(state);
		expect(getRecruitmentBoard(reloaded.state)).toEqual(getRecruitmentBoard(state));
		expect(reloaded.state.scavs.find((item) => item.id === scav.id)!.profile.talents).toEqual(scav.profile.talents);
		expect(readGameSession(reloaded.session, reloaded.state)).toEqual(session);
		expect(session.page).toBe("recruits");
		expect(session.scavId).toBe(scav.id);
		expect(saveGame(state)).toBe(saved);
		expect(readGameSession({ ...session, scavId: "scav-999999" }, reloaded.state).scavId).toBeNull();
	});

	test("a named candidate joins with exactly the quoted price and profile once, without stealing another loadout", () => {
		const state = fundedCamp(), candidate = structuredClone(getRecruitmentBoard(state)[0]!);
		const quote = getRecruitCandidateQuote(state, candidate.id);
		const beforeScavs = structuredClone(state.scavs), beforeGear = structuredClone(state.gearItems);
		const beforeGuns = structuredClone(state.weapons), beforeModules = structuredClone(state.modules);
		const beforeBoard = structuredClone(getRecruitmentBoard(state));
		const money = state.money, rng = state.rng;
		expect(quote.reason).toBeNull();
		expect(hireRecruitCandidate(state, candidate.id).ok).toBe(true);
		const recruited = state.scavs.at(-1)!;
		expect(state.money).toBe(money - quote.money);
		expect(recruited.name).toBe(candidate.name);
		expect(recruited.combat).toBe(candidate.combat);
		expect(recruited.scouting).toBe(candidate.scouting);
		expect(recruited.profile).toMatchObject({ candidateId: candidate.id, backgroundId: candidate.backgroundId, traitId: candidate.traitId, drawbackId: candidate.drawbackId, talents: [] });
		expect(recruited.weaponInstanceId).toBe(quote.weaponId);
		expect(state.scavs.slice(0, beforeScavs.length)).toEqual(beforeScavs);
		expect(state.weapons).toEqual(beforeGuns);
		expect(state.modules).toEqual(beforeModules);
		expect(state.gearItems).toEqual(beforeGear);
		expect(state.rng).toBe(rng);
		expect(getRecruitmentBoard(state)).toEqual(beforeBoard.filter((offer) => offer.id !== candidate.id));
		const saved = saveGame(state);
		expect(hireRecruitCandidate(state, candidate.id).ok).toBe(false);
		expect(saveGame(state)).toBe(saved);
		expect(parseSave(saved)).toEqual(state);
	});

	test("full capacity, a missing candidate and insufficient money reject without charging, consuming IDs or rerolling", () => {
		const state = createGame(NOW), candidate = getRecruitmentBoard(state)[0]!;
		const full = saveGame(state);
		expect(hireRecruitCandidate(state, candidate.id).ok).toBe(false);
		expect(refreshRecruitment(state).ok).toBe(false);
		expect(saveGame(state)).toBe(full);
		state.money = 10_000;
		state.supplies.scrap = 100;
		expect(upgradeBase(state, "radio").ok).toBe(true);
		state.money = getRecruitCandidateQuote(state, candidate.id).money - 1;
		const poor = saveGame(state);
		expect(hireRecruitCandidate(state, candidate.id).ok).toBe(false);
		for (const invalid of ["constructor", "__proto__", "candidate-999999-0", ""]) expect(hireRecruitCandidate(state, invalid).ok).toBe(false);
		expect(saveGame(state)).toBe(poor);
	});

	test("a successful paid refresh charges its full quote once, expires old IDs and cannot alter the next raid seed", () => {
		const state = fundedCamp(), control = structuredClone(state);
		const oldBoard = structuredClone(getRecruitmentBoard(state));
		const oldGeneration = state.recruitment.generation, oldRng = state.recruitment.rng;
		const quote = getRecruitmentRefreshQuote(state), money = state.money, intel = state.supplies.intel;
		expect(quote.reason).toBeNull();
		expect(refreshRecruitment(state).ok).toBe(true);
		expect(state.money).toBe(money - quote.money);
		expect(state.supplies.intel).toBe(intel - quote.intel);
		expect(state.recruitment.generation).toBe(oldGeneration + 1);
		expect(state.recruitment.rng).not.toBe(oldRng);
		expect(getRecruitmentBoard(state).map((offer) => offer.id)).not.toEqual(oldBoard.map((offer) => offer.id));
		expect(state.rng).toBe(control.rng);
		expect(state.nextId).toBe(control.nextId);
		const saved = saveGame(state);
		for (const offer of oldBoard) expect(hireRecruitCandidate(state, offer.id).ok).toBe(false);
		expect(saveGame(state)).toBe(saved);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		expect(dispatchRaid(control, control.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		expect(state.raids).toEqual(control.raids);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("a blocked paid refresh preserves the entire board and ledger for either missing resource", () => {
		for (const missing of ["money", "intel"] as const) {
			const state = fundedCamp(), quote = getRecruitmentRefreshQuote(state);
			if (missing === "money") state.money = quote.money - 1;
			else state.supplies.intel = quote.intel - 1;
			const before = saveGame(state);
			expect(getRecruitmentRefreshQuote(state).reason).not.toBeNull();
			expect(refreshRecruitment(state).ok).toBe(false);
			expect(saveGame(state)).toBe(before);
		}
	});

	test("dismissing a free scav retains every physical weapon and wearable, with no refund or recruitment progress", () => {
		const state = fundedCamp(), scav = state.scavs[0]!;
		expect(craftGear(state, "light_vest").ok).toBe(true);
		const armor = state.gearItems.at(-1)!;
		expect(equipGear(state, scav.id, "armor", armor.id).ok).toBe(true);
		const weapons = structuredClone(state.weapons), modules = structuredClone(state.modules), gear = structuredClone(state.gearItems);
		const recruitment = structuredClone(state.recruitment), money = state.money, stats = structuredClone(state.stats), rng = state.rng;
		expect(dismissScav(state, scav.id).ok).toBe(true);
		expect(state.scavs.some((item) => item.id === scav.id)).toBe(false);
		expect(state.weapons).toEqual(weapons);
		expect(state.modules).toEqual(modules);
		expect(state.gearItems).toEqual(gear);
		expect(state.recruitment).toEqual(recruitment);
		expect(state.stats).toEqual(stats);
		expect(state.money).toBe(money);
		expect(state.rng).toBe(rng);
		const saved = saveGame(state);
		expect(dismissScav(state, scav.id).ok).toBe(false);
		expect(saveGame(state)).toBe(saved);
		expect(parseSave(saved)).toEqual(state);
	});

	test("workers, active sorties, enabled automatic orders and the last surviving scav cannot be dismissed", () => {
		const working = fundedCamp(), worker = working.scavs[0]!;
		expect(assignWorker(working, worker.id, working.shelter.rooms[0]!.id, NOW).ok).toBe(true);
		const assigned = saveGame(working);
		expect(dismissScav(working, worker.id).ok).toBe(false);
		expect(saveGame(working)).toBe(assigned);
		const raiding = fundedCamp();
		expect(dispatchRaid(raiding, raiding.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		const active = saveGame(raiding);
		expect(dismissScav(raiding, raiding.scavs[0]!.id).ok).toBe(false);
		expect(saveGame(raiding)).toBe(active);
		const automatic = fundedCamp();
		automatic.supplies.ammo = 0;
		expect(setAutoRaid(automatic, automatic.scavs[0]!.id, "courtyard", 70, NOW).ok).toBe(true);
		expect(automatic.raids).toHaveLength(0);
		const ordered = saveGame(automatic);
		expect(dismissScav(automatic, automatic.scavs[0]!.id).ok).toBe(false);
		expect(saveGame(automatic)).toBe(ordered);
		const last = fundedCamp();
		for (const scav of [...last.scavs].slice(1)) expect(dismissScav(last, scav.id).ok).toBe(true);
		const lone = saveGame(last);
		expect(dismissScav(last, last.scavs[0]!.id).ok).toBe(false);
		expect(saveGame(last)).toBe(lone);
	});

	test("network contacts unlock from completed expeditions, while hiring and dismissal cannot farm them", () => {
		const state = fundedCamp();
		for (let index = 0; index < 3; index++) {
			const scav = hire(state);
			expect(dismissScav(state, scav.id).ok).toBe(true);
			if (index < 2) expect(refreshRecruitment(state).ok).toBe(true);
		}
		expect(getRecruitmentRefreshQuote(state).tier).toBe(0);
		finishSuccessfulRaid(state, "courtyard");
		finishSuccessfulRaid(state, "courtyard");
		expect(getRecruitmentRefreshQuote(state).tier).toBe(0);
		finishSuccessfulRaid(state, "depot");
		expect(state.stats.raidsCompleted).toBe(3);
		expect(new Set(state.stats.mapsVisited).size).toBe(2);
		expect(getRecruitmentRefreshQuote(state).tier).toBe(1);
		const existingOffers = structuredClone(getRecruitmentBoard(state));
		expect(state.recruitment.boardTier).toBe(0);
		expect(getRecruitmentBoard(state)).toEqual(existingOffers);
		expect(refreshRecruitment(state).ok).toBe(true);
		expect(state.recruitment.tier).toBe(1);
		finishSuccessfulRaid(state, "courtyard");
		finishSuccessfulRaid(state, "depot");
		expect(state.stats.raidsWon).toBe(5);
		expect(getRecruitmentRefreshQuote(state).tier).toBe(2);
		expect(refreshRecruitment(state).ok).toBe(true);
		expect(state.recruitment.tier).toBe(2);
		expect(parseSave(saveGame(state))).toEqual(state);
	});
});

describe("individual scav builds and safe campaign migration", () => {
	test("levels 2, 4 and 6 offer a permanent one-of-three build, with no duplicate or unoffered choice", () => {
		const state = fundedCamp(), scav = state.scavs[0]!;
		expect(getScavTalentOffers(scav)).toBeNull();
		for (const level of [2, 4, 6] as const) {
			levelScav(scav, level);
			const offered = getScavTalentOffers(scav)!;
			expect(offered.level).toBe(level);
			expect(offered.offers).toHaveLength(3);
			expect(new Set(offered.offers.map((talent) => talent.id)).size).toBe(3);
			const before = saveGame(state);
			expect(chooseScavTalent(state, scav.id, "constructor").ok).toBe(false);
			const notOffered = Object.values(SCAV_TALENTS).find((talent) => !offered.offers.some((offer) => offer.id === talent.id) && !scav.profile.talents.includes(talent.id));
			if (notOffered) expect(chooseScavTalent(state, scav.id, notOffered.id).ok).toBe(false);
			expect(saveGame(state)).toBe(before);
			const selected = offered.offers[0]!.id;
			expect(chooseScavTalent(state, scav.id, selected).ok).toBe(true);
			expect(scav.profile.talents).toHaveLength((level / 2));
			expect(scav.profile.talents).toContain(selected);
			expect(getScavTalentOffers(scav)).toBeNull();
			const chosen = saveGame(state);
			expect(chooseScavTalent(state, scav.id, selected).ok).toBe(false);
			expect(saveGame(state)).toBe(chosen);
			expect(parseSave(chosen)).toEqual(state);
		}
	});

	test("talent offers persist through reload and an active raid freezes the individual build and every sortie field", () => {
		const state = fundedCamp(), scav = hire(state, "scout");
		levelScav(scav, 6);
		const offers = getScavTalentOffers(scav)!;
		const loaded = parseSave(saveGame(state))!;
		expect(getScavTalentOffers(loaded.scavs.find((item) => item.id === scav.id)!)).toEqual(offers);
		expect(scav.weaponInstanceId).not.toBeNull();
		expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
		const raid = structuredClone(state.raids[0]!), saved = saveGame(state);
		expect(chooseScavTalent(state, scav.id, offers.offers[0]!.id).ok).toBe(false);
		expect(state.raids[0]).toEqual(raid);
		expect(saveGame(state)).toBe(saved);
	});

	test("every drafted role has bounded effects and real raid or production benefits after a build choice", () => {
		for (const role of ["assault", "scout", "technician"] as const) {
			const state = fundedCamp(), scav = hire(state, role);
			const before = getScavProfileEffects(scav);
			levelScav(scav, 2);
			const offers = getScavTalentOffers(scav)!;
			const initial = structuredClone(scav);
			const effects = offers.offers.map((offer) => {
				const trial = structuredClone(state), trialScav = trial.scavs.find((item) => item.id === scav.id)!;
				expect(chooseScavTalent(trial, trialScav.id, offer.id).ok).toBe(true);
				expect(trialScav.combat).toBe(initial.combat);
				expect(trialScav.scouting).toBe(initial.scouting);
				return getScavProfileEffects(trialScav);
			});
			expect(effects.some((effect) => JSON.stringify(effect) !== JSON.stringify(before))).toBe(true);
			for (const effect of [before, ...effects]) {
				for (const value of Object.values(effect)) expect(Number.isFinite(value)).toBe(true);
				expect(Math.abs(effect.chance)).toBeLessThanOrEqual(0.15);
				expect(Math.abs(effect.loot)).toBeLessThanOrEqual(0.5);
				expect(effect.duration).toBeGreaterThanOrEqual(0.65);
				expect(effect.duration).toBeLessThanOrEqual(1.5);
				expect(effect.ammo).toBeGreaterThanOrEqual(0.65);
				expect(effect.ammo).toBeLessThanOrEqual(1.5);
				expect(Math.abs(effect.capacity)).toBeLessThanOrEqual(10);
				expect(effect.work).toBeGreaterThanOrEqual(0.65);
				expect(effect.work).toBeLessThanOrEqual(1.5);
			}
		}
	});

	test("specialist builds change the real departure quote and snapshotted carrying capacity", () => {
		const assaultState = fundedCamp(), assault = hire(assaultState, "assault");
		levelScav(assault, 2);
		const depot = MAPS.find((map) => map.id === "depot")!;
		const original = getRaidQuote(assaultState, assault, depot);
		expect(chooseScavTalent(assaultState, assault.id, "contact_drill").ok).toBe(true);
		const upgraded = getRaidQuote(assaultState, assault, depot);
		expect(upgraded.chance).toBeCloseTo(original.chance + 0.025, 8);
		expect(dispatchRaid(assaultState, assault.id, depot.id, NOW).ok).toBe(true);
		expect(assaultState.raids[0]!.chance).toBe(upgraded.chance);
		expect(assaultState.raids[0]!.expedition!.baseChance).toBe(upgraded.chance);
		const scoutState = fundedCamp(), scout = hire(scoutState, "scout");
		levelScav(scout, 2);
		const originalCapacity = getLoadoutStats(scoutState, scout).capacity;
		expect(chooseScavTalent(scoutState, scout.id, "cargo_rig").ok).toBe(true);
		expect(getLoadoutStats(scoutState, scout).capacity).toBe(originalCapacity + 2);
		expect(dispatchRaid(scoutState, scout.id, "courtyard", NOW).ok).toBe(true);
		expect(scoutState.raids[0]!.expedition!.capacity).toBe(originalCapacity + 2);
	});

	test("a technician's work talent speeds the real paid queue without paying again or minting an early module", () => {
		const skilled = fundedCamp(), worker = hire(skilled, "technician");
		levelScav(worker, 2);
		const room = skilled.shelter.rooms[0]!;
		expect(assignWorker(skilled, worker.id, room.id, NOW).ok).toBe(true);
		expect(queueModuleProduction(skilled, room.id, "factory-sks-stock", NOW).ok).toBe(true);
		const ordinary = structuredClone(skilled), payment = { money: skilled.money, supplies: { ...skilled.supplies } };
		const modules = structuredClone(skilled.modules);
		expect(chooseScavTalent(skilled, worker.id, "bench_rhythm").ok).toBe(true);
		expect(skilled.money).toBe(payment.money);
		expect(skilled.supplies).toEqual(payment.supplies);
		advance(skilled, NOW + 1_000);
		advance(ordinary, NOW + 1_000);
		expect(room.queue).toHaveLength(1);
		expect(room.queue[0]!.workDone).toBeGreaterThan(ordinary.shelter.rooms[0]!.queue[0]!.workDone);
		expect(room.queue[0]!.paid).toEqual(ordinary.shelter.rooms[0]!.queue[0]!.paid);
		expect(skilled.modules).toEqual(modules);
		expect(skilled.money).toBe(ordinary.money);
		expect(skilled.supplies).toEqual(ordinary.supplies);
		expect(parseSave(saveGame(skilled))).toEqual(skilled);
	});

	test("a v5 campaign keeps paid work, active cargo, ownership, clocks and raid RNG byte-for-byte apart from neutral profiles", () => {
		const state = createGame(NOW);
		expect(assignWorker(state, state.scavs[0]!.id, state.shelter.rooms[0]!.id, NOW).ok).toBe(true);
		expect(queueModuleProduction(state, state.shelter.rooms[0]!.id, "factory-sks-stock", NOW).ok).toBe(true);
		expect(dispatchRaid(state, state.scavs[1]!.id, "courtyard", NOW).ok).toBe(true);
		advance(state, NOW + 5_000);
		const source = legacyV5(state), loaded = parseSave(JSON.stringify(source))!;
		expect(loaded).not.toBeNull();
		expect(legacyV5(loaded)).toEqual(source);
		for (const scav of loaded.scavs) expect(scav.profile).toEqual({ backgroundId: null, traitId: null, drawbackId: null, talents: [], candidateId: null });
		expect(getRecruitmentBoard(loaded)).toHaveLength(3);
		expect(loaded.rng).toBe(source.rng);
		expect(loaded.nextId).toBe(source.nextId);
		expect(parseSave(saveGame(loaded))).toEqual(loaded);
	});

	test("malformed offers, profiles, ledger and talent ownership cannot cross the strict save boundary", () => {
		const state = fundedCamp(), scav = hire(state, "scout");
		levelScav(scav, 2);
		expect(chooseScavTalent(state, scav.id, getScavTalentOffers(scav)!.offers[0]!.id).ok).toBe(true);
		const mutations: ((source: any) => void)[] = [
			(source) => { source.recruitment.rng = 0; },
			(source) => { source.recruitment.boardSeed = -1; },
			(source) => { source.recruitment.tier = 3; },
			(source) => { source.recruitment.board[0].cost = -1; },
			(source) => { source.recruitment.board[0].combat += 1; },
			(source) => { source.recruitment.board[0].traitId = "constructor"; },
			(source) => { source.recruitment.board[0].role = "constructor"; },
			(source) => { source.recruitment.board[1] = source.recruitment.board[0]; },
			(source) => { source.recruitment.hiredCandidateIds.push(source.recruitment.board[0].id); },
			(source) => { source.scavs.at(-1).profile.backgroundId = "constructor"; },
			(source) => { source.scavs.at(-1).profile.traitId = "constructor"; },
			(source) => { source.scavs.at(-1).profile.drawbackId = "constructor"; },
			(source) => { source.scavs.at(-1).profile.talents = ["constructor"]; },
			(source) => { source.scavs.at(-1).profile.talents.push(source.scavs.at(-1).profile.talents[0]); },
			(source) => { source.scavs.at(-1).profile.talents = Object.values(SCAV_TALENTS).filter((talent) => talent.role !== "any" && talent.role !== "scout").slice(0, 1).map((talent) => talent.id); },
			(source) => { source.scavs.at(-1).level = 1; source.scavs.at(-1).xp = 0; },
		];
		for (const mutate of mutations) {
			const source = JSON.parse(saveGame(state));
			mutate(source);
			expect(parseSave(JSON.stringify(source))).toBeNull();
		}
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("a wiped roster gets exactly one free recovery recruit and a usable run, even after its saved draft was exhausted", () => {
		for (const exhausted of [false, true]) {
			const state = fundedCamp();
			if (exhausted) for (const candidate of [...getRecruitmentBoard(state)]) expect(hireRecruitCandidate(state, candidate.id).ok).toBe(true);
			state.scavs = [];
			state.weapons = [];
			state.money = 0;
			state.supplies.ammo = 0;
			const rng = state.rng, boardBefore = structuredClone(state.recruitment);
			const emergency = getRecruitmentBoard(state).find((candidate) => getRecruitCandidateQuote(state, candidate.id).money === 0)!;
			expect(emergency).toBeDefined();
			expect(state.recruitment).toEqual(boardBefore);
			expect(hireRecruitCandidate(state, emergency.id).ok).toBe(true);
			expect(state.scavs).toHaveLength(1);
			const scav = state.scavs[0]!, gun = state.weapons.find((item) => item.id === scav.weaponInstanceId)!;
			expect(getWeaponStats(gun).ready).toBe(true);
			expect(state.rng).toBe(rng);
			expect(state.money).toBe(15);
			expect(state.supplies.ammo).toBe(3);
			expect(getRaidQuote(state, scav, MAPS[0]!).reason).toBeNull();
			const recovered = saveGame(state);
			expect(hireRecruitCandidate(state, emergency.id).ok).toBe(false);
			expect(dismissScav(state, scav.id).ok).toBe(false);
			expect(saveGame(state)).toBe(recovered);
			expect(parseSave(recovered)).toEqual(state);
		}
	});

	test("emergency recovery repairs one affordable ruined physical kit instead of duplicating a full arsenal", () => {
		const state = fundedCamp();
		state.scavs = [];
		const source = state.weapons[3]!;
		while (state.weapons.length < getStorageCapacity(state)) state.weapons.push(copyWeaponFixture(state, source));
		for (const gun of state.weapons) {
			gun.durability = 0;
			for (const part of Object.values(gun.modules)) part.durability = 0;
		}
		const weaponIds = state.weapons.map((gun) => gun.id), moduleIds = state.weapons.flatMap((gun) => Object.values(gun.modules).map((part) => part.id));
		state.money = 0;
		state.supplies.ammo = 0;
		expect(recruitScav(state).ok).toBe(true);
		expect(state.weapons.map((gun) => gun.id)).toEqual(weaponIds);
		expect(state.weapons.flatMap((gun) => Object.values(gun.modules).map((part) => part.id))).toEqual(moduleIds);
		expect(getWeaponStats(state.weapons.find((gun) => gun.id === state.scavs[0]!.weaponInstanceId)!).ready).toBe(true);
		expect(getLoadoutStats(state, state.scavs[0]!).capacity).toBeGreaterThan(0);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("a technician's small-pack drawback keeps its real eight-unit expedition valid on reload and limits found cargo", () => {
		let state: GameState | null = null;
		for (let offset = 0; offset < 64 && !state; offset++) {
			const candidate = fundedCamp(NOW + offset);
			if (getRecruitmentBoard(candidate).some((offer) => offer.role === "technician" && offer.drawbackId === "light_pack")) state = candidate;
		}
		expect(state).not.toBeNull();
		const scav = hire(state!, "technician");
		expect(scav.loadout.backpackItemId).toBeNull();
		expect(getLoadoutStats(state!, scav).capacity).toBe(8);
		expect(dispatchRaid(state!, scav.id, "courtyard", state!.lastUpdated).ok).toBe(true);
		const raid = state!.raids[0]!;
		expect(raid.expedition!.capacity).toBe(8);
		expect(parseSave(saveGame(state!))).toEqual(state);
		raid.chance = 1;
		advance(state!, raid.endsAt);
		expect(getCargoWeight(raid.expedition!.cargo)).toBeLessThanOrEqual(8);
		expect(parseSave(saveGame(state!))).toEqual(state);
		expect(extractRaid(state!, raid.id, state!.lastUpdated).ok).toBe(true);
		expect(parseSave(saveGame(state!))).toEqual(state);
	});

	test("a free recovery recruit using a retained heavy rifle receives enough ammunition for its actual first quote", () => {
		const state = createGame(NOW), rifle = state.weapons[0]!;
		useWeaponPlatformFixture(state, rifle, "mosin");
		state.scavs = [];
		state.weapons = [rifle];
		state.money = 0;
		state.supplies.ammo = 0;
		const weapon = structuredClone(rifle);
		expect(recruitScav(state).ok).toBe(true);
		const scav = state.scavs[0]!, quote = getRaidQuote(state, scav, MAPS[0]!);
		expect(scav.weaponInstanceId).toBe(rifle.id);
		expect(state.weapons).toEqual([weapon]);
		expect(state.supplies.ammo).toBeGreaterThanOrEqual(quote.ammo);
		expect(quote.reason).toBeNull();
		expect(parseSave(saveGame(state))).toEqual(state);
		expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
		expect(state.supplies.ammo).toBeGreaterThanOrEqual(0);
		expect(parseSave(saveGame(state))).toEqual(state);
	});
});
