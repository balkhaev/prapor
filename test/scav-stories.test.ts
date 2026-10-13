import { withoutRaidStrategy } from "./legacy-strategy-fixture";
import { describe, expect, test } from "bun:test";
import { MAPS } from "../src/game/data";
import {
	MAX_OFFLINE_MS, SAVE_VERSION, advance, assignWorker, cancelProduction, continueExpedition, createGame,
	dismissScav, dispatchRaid, extractRaid, getRaidQuote, getRecruitCandidateQuote, getRecruitmentBoard,
	getRecruitCandidateIdentity, getScavIdentity, getScavMemories, getScavMemorials,
	getScavPersonalEvent, getScavStoryEffects, hireRecruitCandidate,
	loadGameWithSummary, parseSave, queueModuleProduction, resolveScavPersonalEvent,
	saveGame, setRaidTactic, setRoomRecipe, upgradeBase, type GameState, type Scav,
} from "../src/game/engine";
import { exportGameSave, parseGameSave } from "../src/game-save";
import { readGameSession } from "../src/game-session";

const NOW = 1_792_000_000_000;

function funded(now = NOW) {
	const state = createGame(now);
	state.money = 30_000;
	state.supplies = { ammo: 1_000, medicine: 100, scrap: 1_000, intel: 100 };
	return state;
}

function freeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

function resolveCurrent(state: GameState, scav: Scav) {
	const event = getScavPersonalEvent(state, scav)!;
	expect(event).not.toBeNull();
	const choice = event.choices.find((item) => item.reason === null)!;
	expect(choice).toBeDefined();
	expect(resolveScavPersonalEvent(state, scav.id, event.id, choice.id).ok).toBe(true);
	return { event, choice };
}

function paidModules(state: GameState, scav: Scav, count: number) {
	const workshop = state.shelter.rooms.find((room) => room.type === "workshop")!;
	expect(assignWorker(state, scav.id, workshop.id, state.lastUpdated).ok).toBe(true);
	for (let index = 0; index < count; index++) {
		expect(queueModuleProduction(state, workshop.id, "factory-sks-stock", state.lastUpdated).ok).toBe(true);
		while (workshop.queue.length) advance(state, state.lastUpdated + 1_000);
	}
	return workshop;
}

function successfulRaid(state: GameState, scav: Scav, depth = 1) {
	scav.health = 100;
	scav.status = "ready";
	const gun = state.weapons.find((weapon) => weapon.id === scav.weaponInstanceId)!;
	gun.durability = 100;
	for (const part of Object.values(gun.modules)) part.durability = 100;
	expect(dispatchRaid(state, scav.id, "courtyard", state.lastUpdated).ok).toBe(true);
	const raid = state.raids.find((item) => item.scavId === scav.id)!;
	// Fix only the combat branch under test. Story progress is earned by the
	// actual checkpoint, extraction and paid-departure actions, never counters.
	for (let stage = 1; stage <= depth; stage++) {
		raid.chance = 1;
		expect(advance(state, raid.endsAt).completedCount).toBe(0);
		if (stage < depth) expect(continueExpedition(state, raid.id, "recon", raid.expedition!.offers[0]!, state.lastUpdated).ok).toBe(true);
	}
	expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
	return state.history[0]!;
}

/** A genuine historical shape with no modern fields hidden inside it. */
function legacy(state: GameState, version: number) {
	const source = withoutRaidStrategy(JSON.parse(saveGame(state)));
	source.schemaVersion = version;
	delete source.memorials; delete source.social; delete source.achievements;
	if (version < 11) for (const raid of source.raids) if (raid.expedition) delete raid.expedition.weaponMechanics;
	if (version < 13) for (const raid of source.raids) if (raid.expedition) delete raid.expedition.ammunition;
	for (const scav of source.scavs) {
		delete scav.story;
		if (version < 6) delete scav.appearance;
		if (version < 6) delete scav.profile;
		if (version < 5) delete scav.assignment;
		if (version < 3) { delete scav.loadout; delete scav.autoRaid.maxDepth; }
		if (version < 2) { delete scav.tactic; delete scav.gear; delete scav.autoRaid; }
	}
	if (version >= 6) for (const candidate of source.recruitment.board) delete candidate.appearance;
	else delete source.recruitment;
	if (version < 6) {
		for (const raid of source.raids) delete raid.scavAppearance;
		for (const report of source.history) delete report.scavAppearance;
	}
	if (version < 5) delete source.shelter;
	if (version < 4) {
		delete source.modules;
		for (const gun of source.weapons) delete gun.modules;
		for (const raid of source.raids) if (raid.expedition) {
			delete raid.expedition.legacyLoot;
			delete raid.expedition.gunCombatBonus;
			delete raid.expedition.cargo.modules;
		}
		for (const report of source.history) { delete report.moduleIds; if (report.lostCargo) delete report.lostCargo.modules; }
	}
	if (version < 3) {
		delete source.gearItems; delete source.blueprints;
		for (const raid of source.raids) delete raid.expedition;
		for (const report of source.history) { delete report.depth; delete report.discoveries; delete report.lostCargo; }
	}
	if (version < 2) {
		delete source.stats.autoRaidsCompleted; delete source.stats.mapWins;
		for (const raid of source.raids) { delete raid.isAuto; delete raid.tactic; delete raid.armorLevel; delete raid.backpackLevel; }
		for (const report of source.history) { delete report.isAuto; delete report.tactic; delete report.events; }
	}
	return source;
}

function fatalRun(mode: "expedition" | "legacy") {
	// Search campaign creation seeds, retaining the real combat quote and all
	// random rolls. The memorial fixture must not fabricate a death report.
	for (let offset = 0; offset < 4_096; offset++) {
		let state = createGame(NOW + offset);
		const scav = state.scavs[0]!;
		expect(setRaidTactic(state, scav.id, "bold").ok).toBe(true);
		expect(dispatchRaid(state, scav.id, "courtyard", state.lastUpdated).ok).toBe(true);
		if (mode === "legacy") state = parseSave(JSON.stringify(legacy(state, 2)))!;
		const departing = structuredClone(state.scavs.find((item) => item.id === scav.id)!);
		const before = structuredClone(state);
		advance(state, state.raids[0]!.endsAt);
		if (state.history[0]?.lostScav) return { state, before, departing, report: state.history[0]!, offset };
	}
	throw new Error(`No real fatal ${mode} run found`);
}

describe("stable personal identities and decisions", () => {
	test("identity, event, memory and memorial previews are pure on frozen state", () => {
		const state = funded(), before = saveGame(state);
		freeze(state);
		for (let index = 0; index < 15; index++) {
			for (const candidate of getRecruitmentBoard(state)) getRecruitCandidateIdentity(candidate, state);
			for (const scav of state.scavs) {
				getScavIdentity(scav); getScavPersonalEvent(state, scav);
				getScavMemories(scav); getScavStoryEffects(scav); getRaidQuote(state, scav, MAPS[0]!);
			}
			getScavMemorials(state);
		}
		expect(saveGame(state)).toBe(before);
	});

	test("a candidate keeps the advertised person and face when hired and after envelope reload", () => {
		const state = funded();
		expect(upgradeBase(state, "radio").ok).toBe(true);
		const candidate = structuredClone(getRecruitmentBoard(state)[0]!);
		const identity = getRecruitCandidateIdentity(candidate, state), rng = state.rng;
		expect(identity.realName.length).toBeGreaterThan(3);
		expect(identity.age).toBeGreaterThanOrEqual(18);
		expect(identity.age).toBeLessThanOrEqual(70);
		for (const field of ["profession", "habit", "motive", "keepsake", "quote", "temperament", "temperamentDescription"] as const)
			expect(identity[field].length).toBeGreaterThan(3);
		expect(hireRecruitCandidate(state, candidate.id).ok).toBe(true);
		const scav = state.scavs.at(-1)!;
		expect(getScavIdentity(scav)).toEqual(identity);
		expect(scav.appearance).toBe(candidate.appearance);
		expect(state.rng).toBe(rng);
		const session = readGameSession({ version: 1, page: "recruits", view: "base", scavId: scav.id }, state);
		const loaded = parseGameSave(exportGameSave(state, session), state.lastUpdated)!;
		expect(loaded).not.toBeNull();
		const restored = loaded.state.scavs.find((item) => item.id === scav.id)!;
		expect(restored.story).toEqual(scav.story);
		expect(restored.appearance).toBe(scav.appearance);
		expect(getScavIdentity(restored)).toEqual(identity);
		expect(readGameSession(loaded.session, loaded.state).scavId).toBe(scav.id);
	});

	test("starting fighters have distinct people, motives and appearances independent of their callsigns", () => {
		const state = createGame(NOW), identities = state.scavs.map(getScavIdentity);
		expect(new Set(state.scavs.map((scav) => scav.appearance)).size).toBe(state.scavs.length);
		expect(new Set(state.scavs.map((scav) => scav.story.identityKey)).size).toBe(state.scavs.length);
		expect(new Set(identities.map((identity) => JSON.stringify(identity))).size).toBe(identities.length);
		const first = structuredClone(state.scavs[0]!);
		first.name = "Тёзка";
		expect(getScavIdentity(first)).toEqual(identities[0]!);
	});

	test("both free recovery paths keep their previewed person and start a fresh story without inheriting a lost career", () => {
		for (const exhausted of [false, true]) {
			const state = funded();
			if (exhausted) {
				for (let index = 0; index < 3; index++) expect(upgradeBase(state, "radio").ok).toBe(true);
				for (const candidate of [...getRecruitmentBoard(state)]) expect(hireRecruitCandidate(state, candidate.id).ok).toBe(true);
			}
			state.scavs = []; state.weapons = []; state.money = 0; state.supplies.ammo = 0;
			const candidate = getRecruitmentBoard(state).find((offer) => getRecruitCandidateQuote(state, offer.id).money === 0)!;
			const identity = getRecruitCandidateIdentity(candidate, state), appearance = candidate.appearance, rng = state.rng;
			expect(hireRecruitCandidate(state, candidate.id).ok).toBe(true);
			const scav = state.scavs[0]!;
			expect(getScavIdentity(scav)).toEqual(identity);
			expect(scav.appearance).toBe(appearance);
			expect(scav.story.completedEvents).toEqual([]);
			expect(scav.story.counters).toEqual({ wins: 0, injuries: 0, deepReturns: 0, modules: 0, batches: 0 });
			expect(getScavPersonalEvent(state, scav)!.id).toBe("arrival");
			expect(state.rng).toBe(rng);
			expect(state.memorials).toEqual([]);
			expect(parseSave(saveGame(state))).toEqual(state);
		}
	});

	test("personal choices charge exactly the visible cost, change only the owned relationship and resolve once", () => {
		const state = funded(), scav = state.scavs[0]!, event = getScavPersonalEvent(state, scav)!;
		expect(event.id).toBe("arrival");
		expect(event.choices.length).toBeGreaterThanOrEqual(2);
		for (const choice of event.choices) {
			const trial = structuredClone(state), person = trial.scavs[0]!, before = structuredClone(trial);
			expect(resolveScavPersonalEvent(trial, person.id, event.id, choice.id).ok).toBe(true);
			expect(trial.money).toBe(before.money - choice.cost.money);
			for (const key of ["ammo", "medicine", "scrap", "intel"] as const)
				expect(trial.supplies[key]).toBe(before.supplies[key] - choice.cost.supplies[key]);
			expect(person.story.bond).toBe(Math.max(0, Math.min(100, before.scavs[0]!.story.bond + choice.effects.bond)));
			expect(person.story.stress).toBe(Math.max(0, Math.min(100, before.scavs[0]!.story.stress + choice.effects.stress)));
			expect(person.story.completedEvents).toContain(event.id);
			expect(trial.scavs.slice(1)).toEqual(before.scavs.slice(1));
			expect(trial.weapons).toEqual(before.weapons);
			expect(trial.modules).toEqual(before.modules);
			expect(trial.gearItems).toEqual(before.gearItems);
			expect(trial.rng).toBe(before.rng);
			expect(trial.nextId).toBe(before.nextId);
			const saved = saveGame(trial);
			expect(resolveScavPersonalEvent(trial, person.id, event.id, choice.id).ok).toBe(false);
			expect(saveGame(trial)).toBe(saved);
			expect(parseSave(saved)).toEqual(trial);
		}
	});

	test("unknown or stale decisions, unaffordable choices and an active raid leave the whole state unchanged", () => {
		const state = funded(), scav = state.scavs[0]!, event = getScavPersonalEvent(state, scav)!;
		for (const [id, eventId, choiceId] of [["scav-missing", event.id, event.choices[0]!.id], [scav.id, "constructor", event.choices[0]!.id], [scav.id, event.id, "__proto__"], [scav.id, "first_return", event.choices[0]!.id]]) {
			const before = saveGame(state);
			expect(resolveScavPersonalEvent(state, id!, eventId!, choiceId!).ok).toBe(false);
			expect(saveGame(state)).toBe(before);
		}
		const costly = event.choices.find((choice) => choice.cost.money > 0 || Object.values(choice.cost.supplies).some((amount) => amount > 0))!;
		expect(costly).toBeDefined();
		const poor = structuredClone(state);
		poor.money = 0; poor.supplies = { ammo: 0, medicine: 0, scrap: 0, intel: 0 };
		const poorSaved = saveGame(poor);
		expect(getScavPersonalEvent(poor, poor.scavs[0]!)!.choices.find((choice) => choice.id === costly.id)!.reason).not.toBeNull();
		expect(resolveScavPersonalEvent(poor, scav.id, event.id, costly.id).ok).toBe(false);
		expect(saveGame(poor)).toBe(poorSaved);
		expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
		const departed = saveGame(state);
		for (const choice of event.choices) expect(resolveScavPersonalEvent(state, scav.id, event.id, choice.id).ok).toBe(false);
		expect(saveGame(state)).toBe(departed);
	});
});

describe("personal events come from actual work and return boundaries", () => {
	test("cancelled orders and completed resource batches cannot masquerade as five assembled weapon modules", () => {
		const state = funded(), worker = state.scavs[0]!;
		resolveCurrent(state, worker);
		const workshop = state.shelter.rooms.find((room) => room.type === "workshop")!;
		expect(assignWorker(state, worker.id, workshop.id, NOW).ok).toBe(true);
		expect(queueModuleProduction(state, workshop.id, "factory-sks-stock", NOW).ok).toBe(true);
		const jobId = workshop.queue[0]!.id;
		advance(state, NOW + 1_000);
		expect(cancelProduction(state, workshop.id, jobId, state.lastUpdated).ok).toBe(true);
		expect(worker.story.counters.modules).toBe(0);
		expect(worker.story.counters.batches).toBe(0);
		state.supplies.medicine = 0;
		expect(upgradeBase(state, "storage").ok).toBe(true);
		const medbay = state.shelter.rooms.find((room) => room.type === "medbay")!;
		expect(assignWorker(state, worker.id, medbay.id, state.lastUpdated).ok).toBe(true);
		for (let index = 0; index < 5; index++) {
			expect(setRoomRecipe(state, medbay.id, "medicine-batch", false, state.lastUpdated).ok).toBe(true);
			while (medbay.queue.length) advance(state, state.lastUpdated + 1_000);
		}
		expect(worker.story.counters.batches).toBe(5);
		expect(worker.story.counters.modules).toBe(0);
		expect(getScavPersonalEvent(state, worker)).toBeNull();
		expect(worker.story.memories.some((memory) => memory.kind === "module")).toBe(false);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("five delivered paid modules earn the craftsman event once and preserve the actual queue payment", () => {
		const state = funded(), worker = state.scavs[0]!;
		resolveCurrent(state, worker);
		const beforeModules = state.modules.length;
		paidModules(state, worker, 4);
		expect(worker.story.counters.modules).toBe(4);
		expect(getScavPersonalEvent(state, worker)).toBeNull();
		const workshop = state.shelter.rooms.find((room) => room.type === "workshop")!;
		expect(queueModuleProduction(state, workshop.id, "factory-sks-stock", state.lastUpdated).ok).toBe(true);
		const paid = structuredClone(workshop.queue[0]!.paid), money = state.money, scrap = state.supplies.scrap;
		advance(state, state.lastUpdated + 1_000);
		expect(workshop.queue[0]!.paid).toEqual(paid);
		expect(worker.story.counters.modules).toBe(4);
		while (workshop.queue.length) advance(state, state.lastUpdated + 1_000);
		expect(state.modules).toHaveLength(beforeModules + 5);
		expect(state.money).toBe(money);
		expect(state.supplies.scrap).toBeGreaterThanOrEqual(scrap);
		expect(worker.story.counters.modules).toBe(5);
		expect(getScavPersonalEvent(state, worker)!.id).toBe("craftsman");
		resolveCurrent(state, worker);
		paidModules(state, worker, 1);
		expect(worker.story.counters.modules).toBe(6);
		expect(getScavPersonalEvent(state, worker)).toBeNull();
		expect(worker.story.completedEvents.filter((id) => id === "craftsman")).toHaveLength(1);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("bulk offline production and irregular ticks give the same personal counters, event and memory", () => {
		const long = funded(), worker = long.scavs[0]!;
		resolveCurrent(long, worker);
		const workshop = long.shelter.rooms.find((room) => room.type === "workshop")!;
		expect(assignWorker(long, worker.id, workshop.id, NOW).ok).toBe(true);
		for (let index = 0; index < 5; index++) expect(queueModuleProduction(long, workshop.id, "factory-sks-stock", NOW).ok).toBe(true);
		const short = structuredClone(long), end = NOW + 12 * 60_000;
		advance(long, end);
		const intervals = [997, 7013, 331, 19997];
		let index = 0;
		while (short.lastUpdated < end) advance(short, Math.min(end, short.lastUpdated + intervals[index++ % intervals.length]!));
		expect(short).toEqual(long);
		expect(worker.story.counters.modules).toBe(5);
		expect(getScavPersonalEvent(long, worker)!.id).toBe("craftsman");
		const story = structuredClone(worker.story);
		const loaded = loadGameWithSummary(saveGame(long), end + MAX_OFFLINE_MS * 3)!;
		expect(loaded.summary.capped).toBe(true);
		expect(loaded.state.scavs[0]!.story).toEqual(story);
		expect(parseSave(saveGame(loaded.state))).toEqual(loaded.state);
	});

	test("a checkpoint does not count as a return, extraction earns first_return once and deeper extraction earns deep_return", () => {
		const state = funded(), scav = state.scavs[0]!;
		resolveCurrent(state, scav);
		expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
		const raid = state.raids[0]!;
		raid.chance = 1;
		advance(state, raid.endsAt);
		expect(scav.story.counters.wins).toBe(0);
		expect(getScavPersonalEvent(state, scav)).toBeNull();
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		expect(scav.story.counters.wins).toBe(1);
		expect(getScavPersonalEvent(state, scav)!.id).toBe("first_return");
		resolveCurrent(state, scav);
		successfulRaid(state, scav, 2);
		expect(scav.story.counters.wins).toBe(2);
		expect(scav.story.counters.deepReturns).toBe(1);
		expect(getScavPersonalEvent(state, scav)!.id).toBe("deep_return");
		resolveCurrent(state, scav);
		successfulRaid(state, scav, 2);
		expect(scav.story.counters.deepReturns).toBe(2);
		expect(getScavPersonalEvent(state, scav)).toBeNull();
		expect(scav.story.completedEvents.filter((id) => id === "first_return")).toHaveLength(1);
		expect(scav.story.completedEvents.filter((id) => id === "deep_return")).toHaveLength(1);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("trust waits for five actual successful extractions and leaves a permanent personal memory", () => {
		const state = funded(), scav = state.scavs[0]!;
		resolveCurrent(state, scav);
		for (let index = 0; index < 4; index++) {
			successfulRaid(state, scav);
			if (getScavPersonalEvent(state, scav)) resolveCurrent(state, scav);
		}
		expect(scav.story.counters.wins).toBe(4);
		expect(scav.story.completedEvents).not.toContain("trusted");
		successfulRaid(state, scav);
		expect(getScavPersonalEvent(state, scav)!.id).toBe("trusted");
		resolveCurrent(state, scav);
		expect(scav.story.completedEvents).toContain("trusted");
		expect(getScavMemories(scav).length).toBeGreaterThan(1);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("a surviving ambush records distress once while healing and repeating a settled tick do not invent new incidents", () => {
		let found: GameState | null = null;
		let personId = "";
		for (let offset = 0; offset < 256 && !found; offset++) {
			const trial = createGame(NOW + offset), scav = trial.scavs[0]!;
			resolveCurrent(trial, scav);
			expect(setRaidTactic(trial, scav.id, "bold").ok).toBe(true);
			expect(dispatchRaid(trial, scav.id, "courtyard", trial.lastUpdated).ok).toBe(true);
			advance(trial, trial.raids[0]!.endsAt);
			if (trial.history[0] && !trial.history[0].success && !trial.history[0].lostScav) { found = trial; personId = scav.id; }
		}
		expect(found).not.toBeNull();
		const state = found!, scav = state.scavs.find((item) => item.id === personId)!;
		expect(scav.story.counters.injuries).toBe(1);
		expect(scav.story.stress).toBeGreaterThan(0);
		expect(getScavPersonalEvent(state, scav)!.id).toBe("shaken");
		const saved = saveGame(state);
		expect(advance(state, state.lastUpdated).completedCount).toBe(0);
		expect(saveGame(state)).toBe(saved);
		resolveCurrent(state, scav);
		const story = structuredClone(scav.story);
		advance(state, state.lastUpdated + 60_000);
		expect(scav.story).toEqual(story);
		expect(getScavPersonalEvent(state, scav)).toBeNull();
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("relationship effects stay bounded, enter only new departure snapshots and do not consume raid RNG", () => {
		const state = funded(), scav = state.scavs[0]!, control = structuredClone(state);
		const effectsBefore = getScavStoryEffects(scav), rng = state.rng;
		resolveCurrent(state, scav);
		expect(state.rng).toBe(rng);
		const effects = getScavStoryEffects(scav);
		for (const value of Object.values(effects)) expect(Number.isFinite(value)).toBe(true);
		expect(Math.abs(effects.chance)).toBeLessThanOrEqual(0.1);
		expect(effects.work).toBeGreaterThanOrEqual(0.7);
		expect(effects.work).toBeLessThanOrEqual(1.3);
		const quote = getRaidQuote(state, scav, MAPS[0]!);
		expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
		expect(dispatchRaid(control, control.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		expect(state.raids[0]!.seed).toBe(control.raids[0]!.seed);
		expect(state.raids[0]!.chance).toBe(quote.chance);
		expect(state.raids[0]!.expedition!.baseChance).toBe(quote.chance);
		const departure = structuredClone(state.raids[0]!);
		getScavIdentity(scav); getScavStoryEffects(scav); getScavPersonalEvent(state, scav);
		expect(state.raids[0]).toEqual(departure);
		expect(effectsBefore).toEqual(getScavStoryEffects(control.scavs[0]!));
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("a long career bounds ordinary memories while retaining every permanent personal decision", () => {
		const state = funded(), scav = state.scavs[0]!;
		resolveCurrent(state, scav);
		for (let index = 0; index < 20; index++) {
			successfulRaid(state, scav);
			while (getScavPersonalEvent(state, scav)) resolveCurrent(state, scav);
		}
		expect(scav.story.counters.wins).toBe(20);
		expect(scav.story.memories.length).toBeLessThanOrEqual(12);
		const decisions = scav.story.memories.filter((memory) => memory.kind === "event");
		expect(decisions.map((memory) => memory.eventId)).toEqual(scav.story.completedEvents);
		expect(scav.story.completedEvents).toContain("arrival");
		expect(scav.story.completedEvents).toContain("first_return");
		expect(scav.story.completedEvents).toContain("trusted");
		const restored = parseSave(saveGame(state))!;
		expect(restored).not.toBeNull();
		expect(restored.scavs[0]!.story).toEqual(scav.story);
		expect(getScavMemories(restored.scavs[0]!)).toEqual(getScavMemories(scav));
	});
});

describe("a loss keeps the person, never grants a payout", () => {
	for (const mode of ["expedition", "legacy"] as const) test(`${mode} fatal settlement retains the exact fighter, portrait and relationship once`, () => {
		const { state, before, departing, report } = fatalRun(mode);
		expect(report.success).toBe(false);
		expect(report.money).toBe(0);
		expect(report.supplies).toEqual({ ammo: 0, medicine: 0, scrap: 0, intel: 0 });
		expect(state.scavs.some((scav) => scav.id === departing.id)).toBe(false);
		expect(state.memorials).toHaveLength(1);
		const memorial = state.memorials[0]!;
		expect(memorial.id).toBe(departing.id);
		expect(memorial.name).toBe(departing.name);
		expect(memorial.appearance).toBe(departing.appearance!);
		expect(memorial.profile).toEqual(departing.profile);
		expect(memorial.story.identityKey).toBe(departing.story.identityKey);
		expect(memorial.story.bond).toBe(departing.story.bond);
		expect(memorial.mapId).toBe(report.mapId);
		expect(memorial.raidId).toBe(report.raidId);
		expect(memorial.at).toBe(report.at);
		expect(getScavMemorials(state)).toHaveLength(1);
		expect(getScavMemorials(state)[0]!.identity).toEqual(getScavIdentity(departing));
		expect(memorial.story.memories.at(-1)!.kind).toBe("lost");
		expect(getScavMemorials(state)[0]!.memories.at(-1)!.text).not.toContain("В убежище его дождались");
		expect(state.modules).toEqual(before.modules);
		expect(state.recruitment.generation).toBe(before.recruitment.generation);
		expect(state.recruitment.rng).toBe(before.recruitment.rng);
		expect(state.stats.lostScavs).toBe(1);
		const saved = saveGame(state);
		expect(advance(state, state.lastUpdated).completedCount).toBe(0);
		expect(extractRaid(state, report.raidId, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(saved);
		const restored = parseSave(saved)!;
		expect(restored).not.toBeNull();
		expect(restored.memorials).toEqual(state.memorials);
		expect(getScavMemorials(restored)).toEqual(getScavMemorials(state));
	});

	test("dismissing a living fighter does not create a casualty or transfer personal progress to a new hire", () => {
		const state = funded(), scav = state.scavs[0]!;
		resolveCurrent(state, scav);
		const stats = structuredClone(state.stats), gear = structuredClone(state.weapons);
		expect(dismissScav(state, scav.id).ok).toBe(true);
		expect(state.memorials).toEqual([]);
		expect(state.stats).toEqual(stats);
		expect(state.weapons).toEqual(gear);
		const candidate = getRecruitmentBoard(state)[0]!;
		expect(hireRecruitCandidate(state, candidate.id).ok).toBe(true);
		const replacement = state.scavs.at(-1)!;
		expect(replacement.story.identityKey).not.toBe(scav.story.identityKey);
		expect(replacement.story.completedEvents).toEqual([]);
		expect(replacement.story.counters).toEqual({ wins: 0, injuries: 0, deepReturns: 0, modules: 0, batches: 0 });
		expect(parseSave(saveGame(state))).toEqual(state);
	});
});

describe("strict story saves and conservative historical migration", () => {
	test("versions one through six gain stable neutral relationships without rerolling actual active raids", () => {
		for (let version = 1; version <= 6; version++) {
			const original = createGame(NOW);
			expect(dispatchRaid(original, original.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
			const old = legacy(original, version), raw = JSON.stringify(old);
			const state = parseSave(raw)!;
			expect(state).not.toBeNull();
			expect(state.schemaVersion).toBe(SAVE_VERSION);
			expect(state.rng).toBe(old.rng);
			expect(state.money).toBe(old.money);
			expect(state.supplies).toEqual(old.supplies);
			expect(state.memorials).toEqual([]);
			expect(state.raids[0]!.seed).toBe(old.raids[0].seed);
			expect(state.raids[0]!.chance).toBe(old.raids[0].chance);
			expect(state.raids[0]!.startedAt).toBe(old.raids[0].startedAt);
			expect(state.raids[0]!.endsAt).toBe(old.raids[0].endsAt);
			for (const scav of state.scavs) {
				expect(scav.story.bond).toBe(20);
				expect(scav.story.stress).toBe(0);
				expect(getScavPersonalEvent(state, scav)).toBeNull();
			}
			const again = parseSave(raw)!;
			expect(state.scavs.map(getScavIdentity)).toEqual(again.scavs.map(getScavIdentity));
			expect(state.scavs.map((scav) => scav.appearance)).toEqual(again.scavs.map((scav) => scav.appearance));
			expect(parseSave(saveGame(state))).toEqual(state);
		}
	});

	test("v6 migration keeps paid production, active cargo, profiles and clocks intact", () => {
		const original = funded(), worker = original.scavs[0]!;
		expect(assignWorker(original, worker.id, original.shelter.rooms[0]!.id, NOW).ok).toBe(true);
		expect(queueModuleProduction(original, original.shelter.rooms[0]!.id, "factory-sks-stock", NOW).ok).toBe(true);
		expect(dispatchRaid(original, original.scavs[1]!.id, "courtyard", NOW).ok).toBe(true);
		advance(original, NOW + 1_000);
		withoutRaidStrategy(original);
		for (const raid of original.raids) if (raid.expedition) { delete raid.expedition.weaponMechanics; delete raid.expedition.ammunition; }
		const old = legacy(original, 6), migrated = parseSave(JSON.stringify(old))!;
		expect(migrated).not.toBeNull();
		expect(legacy(migrated, 6)).toEqual(old);
		expect(migrated.rng).toBe(original.rng);
		expect(migrated.nextId).toBe(original.nextId);
		expect(migrated.raids).toEqual(original.raids);
		expect(migrated.shelter).toEqual(original.shelter);
		expect(migrated.scavs.map((scav) => scav.profile)).toEqual(original.scavs.map((scav) => scav.profile));
		expect(migrated.scavs.map((scav) => scav.appearance)).toEqual(original.scavs.map((scav) => scav.appearance));
	});

	test("clock rollback preserves valid memorial provenance and personal choices without rerolling identity or outcomes", () => {
		const { state } = fatalRun("expedition"), original = structuredClone(state);
		const rollbackAt = state.lastUpdated - 60_000;
		const loaded = loadGameWithSummary(saveGame(state), rollbackAt)!;
		expect(loaded).not.toBeNull();
		expect(loaded.summary.elapsedMs).toBe(0);
		expect(loaded.state.rng).toBe(original.rng);
		expect(loaded.state.money).toBe(original.money);
		expect(loaded.state.supplies).toEqual(original.supplies);
		expect(loaded.state.memorials[0]!.appearance).toBe(original.memorials[0]!.appearance);
		expect(getScavMemorials(loaded.state)[0]!.identity).toEqual(getScavMemorials(original)[0]!.identity);
		expect(loaded.state.memorials[0]!.story.counters).toEqual(original.memorials[0]!.story.counters);
		expect(loaded.state.memorials[0]!.story.completedEvents).toEqual(original.memorials[0]!.story.completedEvents);
		expect(parseSave(saveGame(loaded.state))).toEqual(loaded.state);
	});

	test("unknown data, forged identity, out-of-range relationships and unsupported future schema are rejected", () => {
		const state = funded();
		const mutations: ((source: any) => void)[] = [
			(source) => { source.schemaVersion = SAVE_VERSION + 1; },
			(source) => { source.memories = []; },
			(source) => { source.scavs[0].story.unknown = true; },
			(source) => { source.scavs[0].story.identityKey = "constructor"; },
			(source) => { source.scavs[0].story.bond = 101; },
			(source) => { source.scavs[0].story.stress = -1; },
			(source) => { source.scavs[0].story.counters.modules = -1; },
			(source) => { source.scavs[0].story.counters.wins = 999999; },
			(source) => { source.scavs[0].story.pending.eventId = "constructor"; },
			(source) => { source.scavs[0].story.pending.eventId = "craftsman"; },
			(source) => { source.scavs[0].story.pending.at = source.lastUpdated + 1; },
			(source) => { source.scavs[0].story.completedEvents = ["constructor"]; },
			(source) => { source.scavs[0].story.completedEvents = ["arrival", "arrival"]; },
			(source) => { source.scavs[0].appearance = 32; },
			(source) => { source.recruitment.board[0].appearance = 32; },
		];
		for (const mutate of mutations) {
			const source = JSON.parse(saveGame(state)); mutate(source);
			expect(parseSave(JSON.stringify(source))).toBeNull();
		}
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("a casualty cannot also be alive, be duplicated or claim a nonexistent fatal raid", () => {
		const { state, departing } = fatalRun("expedition");
		const mutations: ((source: any) => void)[] = [
			(source) => { source.memorials.push(structuredClone(source.memorials[0])); },
			(source) => { source.scavs.push(departing); },
			(source) => { source.memorials[0].raidId = "raid-999999"; },
			(source) => { source.memorials[0].mapId = "constructor"; },
			(source) => { source.memorials[0].mapId = "depot"; },
			(source) => { source.memorials[0].appearance = 9; },
			(source) => { source.memorials[0].at = source.lastUpdated + 1; },
			(source) => { source.memorials[0].story.identityKey = "constructor"; },
			(source) => { source.memorials[0].appearance = 32; },
		];
		for (const mutate of mutations) {
			const source = JSON.parse(saveGame(state)); mutate(source);
			expect(parseSave(JSON.stringify(source))).toBeNull();
		}
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("an arrival decision cannot be relabelled as a raid memory and deeper first returns retain their real source", () => {
		const state = funded(), scav = state.scavs[0]!;
		resolveCurrent(state, scav);
		const report = successfulRaid(state, scav, 2);
		expect(scav.story.pending!.eventId).toBe("first_return");
		expect(scav.story.pending!.sourceId).toBe(report.raidId);
		expect(scav.story.pending!.mapId).toBe(report.mapId);
		const corrupted = JSON.parse(saveGame(state));
		const arrival = corrupted.scavs[0].story.memories.find((memory: any) => memory.kind === "event" && memory.eventId === "arrival");
		arrival.sourceId = report.raidId;
		arrival.mapId = report.mapId;
		expect(parseSave(JSON.stringify(corrupted))).toBeNull();
		expect(parseSave(saveGame(state))).toEqual(state);
	});
});
