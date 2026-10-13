import { describe, expect, test } from "bun:test";
import { MAPS } from "../src/game/data";
import {
	MAX_OFFLINE_MS, advance, assignWorker, cancelProduction, continueExpedition, createGame, dispatchRaid, dismissScav, extractRaid,
	craftModule, getModuleCapacity, sellModule,
	getRaidQuote, getRecruitmentBoard, getRoomProductionState, getRoomUpgradeQuote,
	getLossReaction, getRaidSocialSupport, getRoomSocialEffects, getScavRelations, getSquadSocialEvents,
	hireRecruitCandidate, loadGameWithSummary, parseSave, queueModuleProduction, saveGame,
	resolveSocialEvent, setRaidTactic, upgradeRoom, type GameState,
} from "../src/game/engine";
import { exportGameSave, parseGameSave } from "../src/game-save";
import { readGameSession } from "../src/game-session";

const NOW = 1_792_000_000_000;

function funded(now = NOW): GameState {
	const state = createGame(now);
	state.money = 30_000;
	state.supplies = { ammo: 500, medicine: 50, scrap: 1_000, intel: 100 };
	return state;
}

function workshopPair(state: GameState, first = state.scavs[0]!, second = state.scavs[1]!) {
	const room = state.shelter.rooms.find((item) => item.type === "workshop")!;
	if (room.level < 2) {
		const quote = getRoomUpgradeQuote(state, room.id);
		expect(upgradeRoom(state, room.id, state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated + quote.duration * 1_000);
	}
	expect(assignWorker(state, first.id, room.id, state.lastUpdated).ok).toBe(true);
	expect(assignWorker(state, second.id, room.id, state.lastUpdated).ok).toBe(true);
	return room;
}

function completePaidModules(state: GameState, count: number) {
	const room = state.shelter.rooms.find((item) => item.type === "workshop")!;
	for (let index = 0; index < count; index++) {
		expect(queueModuleProduction(state, room.id, "factory-sks-stock", state.lastUpdated).ok).toBe(true);
		while (room.queue.length) advance(state, state.lastUpdated + 1_000);
	}
	return room;
}

function freeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

function irregularTicks(state: GameState, until: number) {
	const steps = [997, 7_001, 131, 20_013, 301, 8_999];
	for (let index = 0; state.lastUpdated < until; index++)
		advance(state, Math.min(until, state.lastUpdated + steps[index % steps.length]!));
}

function relation(state: GameState, first = state.scavs[0]!, second = state.scavs[1]!) {
	return getScavRelations(state, first.id).find((item) => item.peerId === second.id)!;
}

function chooseEvent(state: GameState, eventKind: string, choiceId?: string) {
	const event = getSquadSocialEvents(state).find((item) => item.eventId === eventKind)!;
	expect(event).toBeDefined();
	const choice = choiceId ? event.choices.find((item) => item.id === choiceId)! : event.choices[0]!;
	expect(choice).toBeDefined();
	expect(resolveSocialEvent(state, event.id, choice.id).ok).toBe(true);
	return { event, choice };
}

function pairedWork(count = 3, now = NOW) {
	const state = funded(now);
	workshopPair(state);
	completePaidModules(state, count);
	return state;
}

function v7(state: GameState) {
	const raw = JSON.parse(saveGame(state));
	raw.schemaVersion = 7;
	delete raw.social;
	return raw;
}

function bestInitialPair(state: GameState) {
	const first = state.scavs[0]!;
	const view = state.scavs.flatMap((scav) => getScavRelations(state, scav.id).map((item) => ({ scav, item })))
		.sort((a, b) => b.item.compatibility - a.item.compatibility)[0];
	return view ? [view.scav, state.scavs.find((item) => item.id === view.item.peerId)!] as const : [first, state.scavs[1]!] as const;
}

function fatalFriend(mode: "expedition" | "legacy") {
	for (let offset = 0; offset < 4_096; offset++) {
		const state = funded(NOW + offset), [departing, survivor] = bestInitialPair(state);
		workshopPair(state, departing, survivor); completePaidModules(state, 3);
		chooseEvent(state, "first_shift");
		if (relation(state, departing, survivor).status !== "friend") throw new Error("No friendly initial pair after real co-work");
		for (const scav of [departing, survivor]) expect(assignWorker(state, scav.id, null, state.lastUpdated).ok).toBe(true);
		expect(setRaidTactic(state, departing.id, "bold").ok).toBe(true);
		expect(setRaidTactic(state, survivor.id, "cautious").ok).toBe(true);
		expect(dispatchRaid(state, departing.id, "courtyard", state.lastUpdated).ok).toBe(true);
		expect(dispatchRaid(state, survivor.id, "courtyard", state.lastUpdated).ok).toBe(true);
		const victimRaid = state.raids.find((item) => item.scavId === departing.id)!;
		if (mode === "legacy") victimRaid.expedition = null;
		const survivorRaid = state.raids.find((item) => item.scavId === survivor.id)!;
		if (victimRaid.endsAt >= survivorRaid.endsAt) throw new Error("Friend must still be on the street when death settles");
		const before = structuredClone(state);
		advance(state, victimRaid.endsAt);
		const report = state.history.find((item) => item.raidId === victimRaid.id);
		if (report?.lostScav) return { state, before, departing, survivor, survivorRaid, report, offset };
	}
	throw new Error(`No genuine fatal ${mode} friend run found`);
}

function overlappingReturns(state: GameState, first = state.scavs[0]!, second = state.scavs[1]!) {
	for (const scav of [first, second]) {
		if (scav.assignment) expect(assignWorker(state, scav.id, null, state.lastUpdated).ok).toBe(true);
		scav.health = 100; scav.status = "ready";
		const gun = state.weapons.find((item) => item.id === scav.weaponInstanceId)!;
		gun.durability = 100;
		for (const module of Object.values(gun.modules)) module.durability = 100;
		expect(dispatchRaid(state, scav.id, "courtyard", state.lastUpdated).ok).toBe(true);
	}
	const raids = state.raids.filter((item) => [first.id, second.id].includes(item.scavId));
	for (const raid of raids) raid.chance = 1;
	advance(state, Math.max(...raids.map((item) => item.endsAt)));
	for (const raid of raids) expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
	return raids;
}

describe("earned, persistent squad relationships", () => {
	test("initial, legacy and UI previews are neutral, deterministic and pure on a frozen save", () => {
		const state = funded(), saved = saveGame(state), rng = state.rng;
		freeze(state);
		for (let repeat = 0; repeat < 10; repeat++) {
			for (const scav of state.scavs) {
				expect(getScavRelations(state, scav.id).every((item) => item.score === 0 && item.status === "neutral")).toBe(true);
				expect(getLossReaction(state, scav.id)).toEqual([]);
				getSquadSocialEvents(state, scav.id);
				getRaidSocialSupport(state, scav.id, "courtyard");
				getRaidQuote(state, scav, MAPS[0]!);
			}
			for (const room of state.shelter.rooms) getRoomSocialEffects(state, room.id);
			expect(getSquadSocialEvents(state)).toEqual([]);
		}
		expect(state.rng).toBe(rng);
		expect(saveGame(state)).toBe(saved);
		expect(getScavRelations(state, "scav-missing")).toEqual([]);
	});

	test("real paid co-work earns one shared event and reciprocal progress; idle time and assignment clicks do not", () => {
		const state = funded(), first = state.scavs[0]!, second = state.scavs[1]!, third = state.scavs[2]!;
		const room = workshopPair(state), before = getScavRelations(state, first.id), rng = state.rng, modulesBefore = state.modules.length;
		for (let index = 0; index < 30; index++) {
			expect(assignWorker(state, second.id, null, state.lastUpdated).ok).toBe(true);
			expect(assignWorker(state, second.id, room.id, state.lastUpdated).ok).toBe(true);
		}
		advance(state, state.lastUpdated + 120_000);
		expect(getScavRelations(state, first.id)).toEqual(before);
		expect(getSquadSocialEvents(state)).toEqual([]);
		completePaidModules(state, 2);
		expect(relation(state, first, second).workTogether).toBe(2);
		expect(getSquadSocialEvents(state)).toEqual([]);
		completePaidModules(state, 1);
		const shared = getSquadSocialEvents(state).find((item) => item.eventId === "first_shift")!;
		expect(shared).toBeDefined();
		expect(new Set(shared.scavIds)).toEqual(new Set([first.id, second.id]));
		expect(shared.choices).toHaveLength(2);
		expect(relation(state, first, second).workTogether).toBe(3);
		expect(relation(state, second, first).score).toBe(relation(state, first, second).score);
		expect(relation(state, first, third).workTogether).toBe(0);
		expect(state.modules).toHaveLength(modulesBefore + 3);
		expect(state.rng).toBe(rng);
		const completed = saveGame(state);
		advance(state, state.lastUpdated);
		expect(saveGame(state)).toBe(completed);
		expect(parseSave(completed)).toEqual(state);
	});

	test("a cancelled paid order or a lone worker does not create shared progress", () => {
		const state = funded(), room = workshopPair(state);
		expect(queueModuleProduction(state, room.id, "factory-sks-stock", state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated + 1_000);
		expect(cancelProduction(state, room.id, room.queue[0]!.id, state.lastUpdated).ok).toBe(true);
		expect(relation(state).workTogether).toBe(0);
		expect(assignWorker(state, state.scavs[1]!.id, null, state.lastUpdated).ok).toBe(true);
		completePaidModules(state, 3);
		expect(relation(state).workTogether).toBe(0);
		expect(getSquadSocialEvents(state)).toEqual([]);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("shared choices charge exactly their advertised cost, preserve inventory/RNG and cannot be replayed", () => {
		const source = pairedWork(), event = getSquadSocialEvents(source)[0]!;
		for (const choice of event.choices) {
			const state = structuredClone(source), before = structuredClone(state);
			expect(resolveSocialEvent(state, event.id, choice.id).ok).toBe(true);
			expect(state.money).toBe(before.money - choice.cost.money);
			for (const key of ["ammo", "medicine", "scrap", "intel"] as const)
				expect(state.supplies[key]).toBe(before.supplies[key] - choice.cost.supplies[key]);
			expect(state.rng).toBe(before.rng);
			expect(state.nextId).toBe(before.nextId);
			expect(state.weapons).toEqual(before.weapons);
			expect(state.modules).toEqual(before.modules);
			expect(state.gearItems).toEqual(before.gearItems);
			expect(state.stats).toEqual(before.stats);
			expect(getSquadSocialEvents(state).some((item) => item.id === event.id)).toBe(false);
			const completed = saveGame(state);
			expect(resolveSocialEvent(state, event.id, choice.id).ok).toBe(false);
			expect(saveGame(state)).toBe(completed);
			expect(parseSave(completed)).toEqual(state);
		}
	});

	test("unaffordable, unknown and stale event choices leave every resource and saved relation intact", () => {
		const state = pairedWork(), event = getSquadSocialEvents(state)[0]!;
		for (const [eventId, choiceId] of [["missing", event.choices[0]!.id], [event.id, "__proto__"], [event.id, "missing"]]) {
			const saved = saveGame(state);
			expect(resolveSocialEvent(state, eventId!, choiceId!).ok).toBe(false);
			expect(saveGame(state)).toBe(saved);
		}
		const costly = event.choices.find((item) => item.cost.money > 0 || Object.values(item.cost.supplies).some((amount) => amount > 0))!;
		expect(costly).toBeDefined();
		state.money = 0; state.supplies = { ammo: 0, medicine: 0, scrap: 0, intel: 0 };
		expect(getSquadSocialEvents(state).find((item) => item.id === event.id)!.choices.find((item) => item.id === costly.id)!.reason).not.toBeNull();
		const saved = saveGame(state);
		expect(resolveSocialEvent(state, event.id, costly.id).ok).toBe(false);
		expect(saveGame(state)).toBe(saved);
		expect(resolveSocialEvent(state, event.id, event.choices.find((item) => item.cost.money === 0)!.id).ok).toBe(true);
	});

	test("paid co-work settles identically offline, online and after irregular ticks", () => {
		const source = funded(), room = workshopPair(source);
		// The third batch crosses into an actual rivalry. Its speed penalty
		// changes the completion times of the remaining prepaid batches.
		completePaidModules(source, 2);
		for (let index = 0; index < 3; index++) expect(queueModuleProduction(source, room.id, "factory-sks-stock", source.lastUpdated).ok).toBe(true);
		const bulk = structuredClone(source), irregular = structuredClone(source), restored = parseSave(saveGame(source))!;
		const until = source.lastUpdated + 240_000;
		advance(bulk, until); irregularTicks(irregular, until); advance(restored, until);
		expect(irregular).toEqual(bulk);
		expect(restored).toEqual(bulk);
		expect(relation(bulk).workTogether).toBe(5);
		expect(relation(bulk).status).toBe("rival");
		expect(getSquadSocialEvents(bulk)).toHaveLength(1);
		expect(parseSave(saveGame(bulk))).toEqual(bulk);
	});
});

describe("shared deployment and production effects", () => {
	test("incompatible workers develop a persistent conflict that slows their shared station and offers two distinct repairs", () => {
		const state = funded(), first = state.scavs[0]!, second = state.scavs[1]!, room = workshopPair(state, first, second);
		expect(relation(state, first, second).compatibility).toBeLessThan(0);
		completePaidModules(state, 3); chooseEvent(state, "first_shift", "respect");
		completePaidModules(state, 2);
		expect(relation(state, first, second).status).toBe("rival");
		const event = getSquadSocialEvents(state).find((item) => item.eventId === "friction")!;
		expect(event).toBeDefined();
		expect(new Set(event.scavIds)).toEqual(new Set([first.id, second.id]));
		const neutral = parseSave(JSON.stringify(v7(state)))!;
		expect(getRoomProductionState(state, room).rate).toBeLessThan(getRoomProductionState(neutral, room).rate);
		const social = getRoomSocialEffects(state, room.id);
		expect(social.multiplier).toBeGreaterThanOrEqual(0.88);
		expect(social.multiplier).toBeLessThan(1);
		expect(social.workers.every((worker) => worker.multiplier < 1)).toBe(true);
		const solutions = event.choices.map((choice) => {
			const copy = structuredClone(state), beforeScore = relation(copy).score;
			expect(resolveSocialEvent(copy, event.id, choice.id).ok).toBe(true);
			expect(relation(copy).score).toBeGreaterThan(beforeScore);
			expect(getRoomProductionState(copy, copy.shelter.rooms.find((item) => item.id === room.id)!).rate).toBeGreaterThan(getRoomProductionState(state, room).rate);
			expect(parseSave(saveGame(copy))).toEqual(copy);
			return relation(copy).score;
		});
		expect(new Set(solutions).size).toBe(2);
	});

	test("support comes from a healthy friend on base radio or in the same sector, with no help from another sector", () => {
		const state = funded(), [first, second] = bestInitialPair(state), room = workshopPair(state, first, second);
		completePaidModules(state, 3); chooseEvent(state, "first_shift");
		for (const scav of [first, second]) expect(assignWorker(state, scav.id, null, state.lastUpdated).ok).toBe(true);
		expect(getRaidSocialSupport(state, first.id, MAPS[0]!.id).supporterId).toBe(second.id);
		second.health = 24; second.status = "wounded";
		expect(getRaidSocialSupport(state, first.id, MAPS[0]!.id).supporterId).toBeNull();
		second.health = 100; second.status = "ready"; state.level = 10; state.xp = 90 * 9 ** 2;
		expect(dispatchRaid(state, second.id, MAPS[1]!.id, state.lastUpdated).ok).toBe(true);
		expect(getRaidSocialSupport(state, first.id, MAPS[0]!.id).supporterId).toBeNull();
		expect(getRaidSocialSupport(state, first.id, MAPS[1]!.id).supporterId).toBe(second.id);
		expect(getRoomSocialEffects(state, room.id).workers).toEqual([]);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("a long paid career stays within modifier bounds and keeps authored events resolved", () => {
		const state = funded(), [first, second] = bestInitialPair(state), room = workshopPair(state, first, second);
		completePaidModules(state, 3); const { event } = chooseEvent(state, "first_shift");
		completePaidModules(state, 27);
		const view = relation(state, first, second);
		expect(view.workTogether).toBe(30);
		expect(view.score).toBeGreaterThanOrEqual(-60);
		expect(view.score).toBeLessThanOrEqual(60);
		expect(getSquadSocialEvents(state).some((item) => item.id === event.id)).toBe(false);
		const neutral = parseSave(JSON.stringify(v7(state)))!;
		const boost = getRoomProductionState(state, room).rate / getRoomProductionState(neutral, room).rate;
		expect(boost).toBeGreaterThan(1);
		expect(boost).toBeLessThanOrEqual(1.151);
		for (const scav of state.scavs) {
			const effect = getRaidSocialSupport(state, scav.id, "courtyard");
			expect(Number.isFinite(effect.chance)).toBe(true);
			expect(Math.abs(effect.chance)).toBeLessThanOrEqual(0.1);
		}
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("friendship improves only co-located work and an actual same-sector buddy departure, without rewriting running raids", () => {
		const state = funded(), [first, second] = bestInitialPair(state);
		const room = workshopPair(state, first, second);
		completePaidModules(state, 3); chooseEvent(state, "first_shift");
		expect(relation(state, first, second).status).toBe("friend");
		const togetherRate = getRoomProductionState(state, room).rate;
		const neutralRaw = v7(state), neutral = parseSave(JSON.stringify(neutralRaw))!;
		// Same fighter skills, personal stories and paid work, but a genuine
		// historical save predates all pair modifiers.
		expect(togetherRate).toBeGreaterThan(getRoomProductionState(neutral, neutral.shelter.rooms.find((item) => item.id === room.id)!).rate);
		const rng = state.rng;
		expect(assignWorker(state, second.id, null, state.lastUpdated).ok).toBe(true);
		expect(getRoomProductionState(state, room).rate).toBe(getRoomProductionState(parseSave(JSON.stringify(v7(state)))!, room).rate);
		expect(assignWorker(state, first.id, null, state.lastUpdated).ok).toBe(true);
		const soloState = parseSave(JSON.stringify(v7(state)))!;
		const soloQuote = getRaidQuote(soloState, soloState.scavs.find((item) => item.id === second.id)!, MAPS[0]!);
		const baseSupportedQuote = getRaidQuote(state, second, MAPS[0]!);
		expect(baseSupportedQuote.chance).toBeGreaterThan(soloQuote.chance);
		expect(dispatchRaid(state, first.id, "courtyard", state.lastUpdated).ok).toBe(true);
		const firstSnapshot = structuredClone(state.raids[0]!);
		const pairedQuote = getRaidQuote(state, second, MAPS[0]!);
		expect(pairedQuote.chance).toBeGreaterThan(soloQuote.chance);
		expect(pairedQuote.chance).toBe(baseSupportedQuote.chance);
		expect(getRaidSocialSupport(state, second.id, "courtyard").supporterId).toBe(first.id);
		expect(dispatchRaid(state, second.id, "courtyard", state.lastUpdated).ok).toBe(true);
		expect(state.raids.find((item) => item.scavId === first.id)).toEqual(firstSnapshot);
		expect(state.raids.find((item) => item.scavId === second.id)!.chance).toBe(pairedQuote.chance);
		for (const scav of state.scavs) getScavRelations(state, scav.id);
		expect(state.raids.find((item) => item.scavId === first.id)).toEqual(firstSnapshot);
		expect(rng).toBe(neutral.rng);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("dismissing a living friend creates no grief, and a namesake recruit cannot inherit links", () => {
		const state = pairedWork(), departing = state.scavs[0]!, survivor = state.scavs[1]!;
		chooseEvent(state, "first_shift");
		for (const scav of [departing, survivor]) expect(assignWorker(state, scav.id, null, state.lastUpdated).ok).toBe(true);
		const stats = structuredClone(state.stats), gear = structuredClone(state.weapons), rng = state.rng;
		expect(dismissScav(state, departing.id).ok).toBe(true);
		expect(state.stats).toEqual(stats);
		expect(state.weapons).toEqual(gear);
		expect(state.memorials).toEqual([]);
		expect(getLossReaction(state, survivor.id)).toEqual([]);
		expect(getScavRelations(state, survivor.id).some((item) => item.peerId === departing.id)).toBe(false);
		expect(getSquadSocialEvents(state).some((item) => item.scavIds.includes(departing.id))).toBe(false);
		const offer = getRecruitmentBoard(state)[0]!;
		expect(hireRecruitCandidate(state, offer.id).ok).toBe(true);
		const newPerson = state.scavs.at(-1)!;
		newPerson.name = departing.name;
		expect(newPerson.id).not.toBe(departing.id);
		expect(newPerson.story.identityKey).not.toBe(departing.story.identityKey);
		expect(getScavRelations(state, newPerson.id).every((item) => item.score === 0 && item.workTogether === 0 && item.sortiesTogether === 0)).toBe(true);
		expect(getLossReaction(state, newPerson.id)).toEqual([]);
		expect(state.rng).toBe(rng);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("a waiting pair event cannot be chosen while either participant is in a raid", () => {
		const source = pairedWork(), event = getSquadSocialEvents(source)[0]!;
		for (const scavId of event.scavIds) {
			const state = structuredClone(source);
			for (const id of event.scavIds) expect(assignWorker(state, id, null, state.lastUpdated).ok).toBe(true);
			expect(dispatchRaid(state, scavId, "courtyard", state.lastUpdated).ok).toBe(true);
			const saved = saveGame(state);
			expect(getSquadSocialEvents(state).find((item) => item.id === event.id)!.choices.every((item) => item.reason !== null)).toBe(true);
			expect(resolveSocialEvent(state, event.id, event.choices[0]!.id).ok).toBe(false);
			expect(saveGame(state)).toBe(saved);
		}
	});

	test("same-sector overlap records surviving returns, not departure clicks or merely coincident solo raids", () => {
		const state = funded(), first = state.scavs[0]!, second = state.scavs[1]!;
		for (let index = 0; index < 2; index++) {
			first.health = 100; second.health = 100;
			for (const scav of [first, second]) {
				const gun = state.weapons.find((item) => item.id === scav.weaponInstanceId)!;
				gun.durability = 100;
				for (const part of Object.values(gun.modules)) part.durability = 100;
				expect(dispatchRaid(state, scav.id, "courtyard", state.lastUpdated).ok).toBe(true);
			}
			expect(relation(state, first, second).sortiesTogether).toBe(index);
			const pairRaids = state.raids.filter((item) => [first.id, second.id].includes(item.scavId));
			// Combat success is fixed for this integration branch; social progress
			// still comes only from paid departures, checkpoints and extractions.
			for (const raid of pairRaids) raid.chance = 1;
			advance(state, Math.max(...pairRaids.map((item) => item.endsAt)));
			expect(relation(state, first, second).sortiesTogether).toBe(index);
			expect(extractRaid(state, pairRaids[0]!.id, state.lastUpdated).ok).toBe(true);
			expect(relation(state, first, second).sortiesTogether).toBe(index);
			const waiting = parseSave(saveGame(state))!;
			expect(waiting).not.toBeNull();
			expect(extractRaid(state, pairRaids[1]!.id, state.lastUpdated).ok).toBe(true);
			expect(extractRaid(waiting, pairRaids[1]!.id, waiting.lastUpdated).ok).toBe(true);
			expect(waiting).toEqual(state);
			expect(relation(state, first, second).sortiesTogether).toBe(index + 1);
			expect(parseSave(saveGame(state))).toEqual(state);
		}
		const event = getSquadSocialEvents(state).find((item) => item.eventId === "crossed_routes")!;
		expect(event).toBeDefined();
		expect(event.scavIds).toContain(first.id);
		expect(event.scavIds).toContain(second.id);
		chooseEvent(state, "crossed_routes");
		expect(relation(state, first, second).status).toBe("friend");
		const saved = saveGame(state);
		expect(extractRaid(state, state.history[0]!.raidId, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(saved);
	});

	test("sequential solo departures create no shared sortie credit", () => {
		const state = funded(), first = state.scavs[0]!, second = state.scavs[1]!;
		for (const scav of [first, second]) {
			expect(dispatchRaid(state, scav.id, "courtyard", state.lastUpdated).ok).toBe(true);
			const raid = state.raids[0]!; raid.chance = 1;
			advance(state, raid.endsAt);
			expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		}
		expect(relation(state, first, second).sortiesTogether).toBe(0);
		expect(getSquadSocialEvents(state)).toEqual([]);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("overlapping departures to different sectors cannot earn friendship or a joint-return event", () => {
		const state = funded(), first = state.scavs[0]!, second = state.scavs[1]!;
		state.level = 10; state.xp = 90 * 9 ** 2;
		expect(dispatchRaid(state, first.id, MAPS[0]!.id, state.lastUpdated).ok).toBe(true);
		expect(dispatchRaid(state, second.id, MAPS[1]!.id, state.lastUpdated).ok).toBe(true);
		const raids = [...state.raids];
		for (const raid of raids) raid.chance = 1;
		advance(state, Math.max(...raids.map((item) => item.endsAt)));
		for (const raid of raids) expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		expect(relation(state, first, second).sortiesTogether).toBe(0);
		expect(relation(state, first, second).score).toBe(0);
		expect(getSquadSocialEvents(state)).toEqual([]);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("an unhealthy bystander is excluded from co-work, and recovering or swapping after a finished order cannot invent it", () => {
		const state = funded(), room = workshopPair(state), first = state.scavs[0]!, second = state.scavs[1]!;
		second.health = 0; second.status = "wounded";
		completePaidModules(state, 1);
		expect(relation(state, first, second).workTogether).toBe(0);
		expect(getSquadSocialEvents(state)).toEqual([]);
		second.health = 100; second.status = "ready";
		advance(state, state.lastUpdated);
		expect(relation(state, first, second).workTogether).toBe(0);
		expect(assignWorker(state, second.id, null, state.lastUpdated).ok).toBe(true);
		completePaidModules(state, 1);
		expect(assignWorker(state, state.scavs[2]!.id, room.id, state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated);
		expect(getScavRelations(state, first.id).every((item) => item.workTogether === 0)).toBe(true);
		expect(parseSave(saveGame(state))).toEqual(state);
	});
});

describe("save migration and social provenance", () => {
	test("a new buddy overlap formed after capped time can save, continue deeper and return across a clock rollback", () => {
		const state = funded(), firstScav = state.scavs[0]!, secondScav = state.scavs[1]!;
		expect(dispatchRaid(state, firstScav.id, "courtyard", state.lastUpdated).ok).toBe(true);
		// NOW is a real creation seed whose two paid sorties reach the
		// checkpoints below. No combat probability, seed or report is changed.
		const first = state.raids[0]!;
		advance(state, first.endsAt);
		expect(first.expedition!.status).toBe("choice");
		const summary = advance(state, state.lastUpdated + MAX_OFFLINE_MS + 86_400_000);
		expect(summary.capped).toBe(true);
		expect(parseSave(saveGame(state))).toEqual(state);
		expect(dispatchRaid(state, secondScav.id, "courtyard", state.lastUpdated).ok).toBe(true);
		const second = state.raids.find((item) => item.scavId === secondScav.id)!;
		expect(parseSave(saveGame(state))).toEqual(state);
		expect(continueExpedition(state, first.id, "recon", first.expedition!.offers[0]!, state.lastUpdated).ok).toBe(true);
		expect(parseSave(saveGame(state))).toEqual(state);
		const bulk = structuredClone(state), irregular = structuredClone(state), until = Math.max(first.endsAt, second.endsAt);
		advance(bulk, until); irregularTicks(irregular, until);
		expect(irregular).toEqual(bulk);
		expect(parseSave(saveGame(bulk))).toEqual(bulk);
		expect(extractRaid(bulk, second.id, bulk.lastUpdated).ok).toBe(true);
		const restored = loadGameWithSummary(saveGame(bulk), bulk.lastUpdated - 30_000)!;
		expect(restored).not.toBeNull();
		expect(restored.summary.elapsedMs).toBe(0);
		expect(parseSave(saveGame(restored.state))).toEqual(restored.state);
		expect(extractRaid(restored.state, first.id, restored.state.lastUpdated).ok).toBe(true);
		expect(relation(restored.state).sortiesTogether).toBe(1);
		expect(parseSave(saveGame(restored.state))).toEqual(restored.state);
	});

	test("the original overlap survives deeper-stage departure, irregular advance and backwards-clock restoration", () => {
		const state = funded();
		for (const scav of state.scavs.slice(0, 2)) expect(dispatchRaid(state, scav.id, "courtyard", state.lastUpdated).ok).toBe(true);
		const first = state.raids.find((item) => item.scavId === state.scavs[0]!.id)!, second = state.raids.find((item) => item.scavId === state.scavs[1]!.id)!;
		const originalStarts = [first.startedAt, second.startedAt];
		first.chance = 1; second.chance = 1;
		advance(state, Math.max(first.endsAt, second.endsAt));
		expect(continueExpedition(state, first.id, "recon", first.expedition!.offers[0]!, state.lastUpdated).ok).toBe(true);
		expect(first.startedAt).toBeGreaterThan(originalStarts[0]!);
		first.chance = 1;
		const restored = parseSave(saveGame(state))!;
		expect(restored).not.toBeNull();
		expect(restored.raids).toEqual(state.raids);
		const bulk = structuredClone(state), irregular = structuredClone(state), until = first.endsAt + 60_000;
		advance(bulk, until); irregularTicks(irregular, until);
		expect(irregular).toEqual(bulk);
		expect(parseSave(saveGame(bulk))).toEqual(bulk);
		const back = loadGameWithSummary(saveGame(state), state.lastUpdated - 45_000)!;
		expect(back).not.toBeNull();
		expect(back.summary.elapsedMs).toBe(0);
		expect(back.state.rng).toBe(state.rng);
		expect(back.state.raids.find((item) => item.id === first.id)!.expedition!.stage).toBe(2);
		expect(parseSave(saveGame(back.state))).toEqual(back.state);
	});

	test("a returned buddy and the held deeper sortie preserve their overlap across capped offline time", () => {
		const state = funded();
		for (const scav of state.scavs.slice(0, 2)) expect(dispatchRaid(state, scav.id, "courtyard", state.lastUpdated).ok).toBe(true);
		const first = state.raids.find((item) => item.scavId === state.scavs[0]!.id)!, second = state.raids.find((item) => item.scavId === state.scavs[1]!.id)!;
		first.chance = 1; second.chance = 1;
		advance(state, Math.max(first.endsAt, second.endsAt));
		expect(continueExpedition(state, second.id, "recon", second.expedition!.offers[0]!, state.lastUpdated).ok).toBe(true);
		second.chance = 1;
		expect(extractRaid(state, first.id, state.lastUpdated).ok).toBe(true);
		const summary = advance(state, state.lastUpdated + MAX_OFFLINE_MS + 3_600_000);
		expect(summary.capped).toBe(true);
		expect(relation(state).sortiesTogether).toBe(0);
		const restored = parseSave(saveGame(state))!;
		expect(restored).not.toBeNull();
		expect(extractRaid(restored, second.id, restored.lastUpdated).ok).toBe(true);
		expect(relation(restored).sortiesTogether).toBe(1);
		expect(parseSave(saveGame(restored))).toEqual(restored);
	});

	test("an unanswered work event can later reveal the earned route event with its actual sector source", () => {
		const state = pairedWork(), pending = getSquadSocialEvents(state).find((item) => item.eventId === "first_shift")!;
		overlappingReturns(state); overlappingReturns(state);
		expect(relation(state).sortiesTogether).toBe(2);
		expect(getSquadSocialEvents(state).find((item) => item.id === pending.id)).toBeDefined();
		expect(resolveSocialEvent(state, pending.id, "respect").ok).toBe(true);
		const next = getSquadSocialEvents(state).find((item) => item.eventId === "crossed_routes")!;
		expect(next).toBeDefined();
		expect(next.text).toContain(MAPS[0]!.name);
		expect(parseSave(saveGame(state))).toEqual(state);
		expect(resolveSocialEvent(state, next.id, "debrief").ok).toBe(true);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("a queued conflict decision stays valid after actual returns improve the pair's current score", () => {
		const state = pairedWork(); chooseEvent(state, "first_shift", "respect"); completePaidModules(state, 2);
		const conflict = getSquadSocialEvents(state).find((item) => item.eventId === "friction")!;
		expect(conflict).toBeDefined();
		overlappingReturns(state); overlappingReturns(state);
		expect(relation(state).score).toBeGreaterThan(-8);
		expect(getSquadSocialEvents(state).find((item) => item.id === conflict.id)).toBeDefined();
		expect(parseSave(saveGame(state))).toEqual(state);
		expect(resolveSocialEvent(state, conflict.id, "mediate").ok).toBe(true);
		expect(getSquadSocialEvents(state).some((item) => item.id === conflict.id)).toBe(false);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("an overlap ledger must refer to the actual two owners, sector and not-yet-settled raids", () => {
		const state = funded();
		for (const scav of state.scavs.slice(0, 2)) expect(dispatchRaid(state, scav.id, "courtyard", state.lastUpdated).ok).toBe(true);
		const raw = JSON.parse(saveGame(state)), index = raw.social.pairs.findIndex((item: { overlap: unknown }) => item.overlap !== null);
		expect(index).toBeGreaterThanOrEqual(0);
		const edits: ((source: any) => void)[] = [
			(source) => source.social.pairs[index].overlap.raidIds[0] = "raid-missing",
			(source) => source.social.pairs[index].overlap.raidIds.reverse(),
			(source) => source.social.pairs[index].overlap.mapId = MAPS[1]!.id,
			(source) => source.social.pairs[index].overlap.at = source.lastUpdated + 1,
			(source) => source.social.pairs[index].overlap.returned = [{ raidId: source.social.pairs[index].overlap.raidIds[0], at: source.lastUpdated, success: true }],
			(source) => source.social.pairs[index].overlap.unknown = "field",
		];
		for (const edit of edits) {
			const copy = structuredClone(raw); edit(copy);
			expect(parseSave(JSON.stringify(copy))).toBeNull();
		}
		expect(parseSave(JSON.stringify(raw))).toEqual(state);
	});

	test("v7 gains neutral links while preserving exact paid work, active sortie and its quote", () => {
		const original = funded(), worker = original.scavs[0]!, runner = original.scavs[1]!;
		const workshop = original.shelter.rooms.find((item) => item.type === "workshop")!;
		expect(assignWorker(original, worker.id, workshop.id, original.lastUpdated).ok).toBe(true);
		expect(queueModuleProduction(original, workshop.id, "factory-sks-stock", original.lastUpdated).ok).toBe(true);
		expect(dispatchRaid(original, runner.id, "courtyard", original.lastUpdated).ok).toBe(true);
		advance(original, original.lastUpdated + 1_000);
		const raw = v7(original), migrated = parseSave(JSON.stringify(raw))!;
		expect(migrated).not.toBeNull();
		expect(v7(migrated)).toEqual(raw);
		expect(migrated.raids).toEqual(original.raids);
		expect(migrated.shelter).toEqual(original.shelter);
		expect(migrated.rng).toBe(original.rng);
		expect(migrated.nextId).toBe(original.nextId);
		for (const scav of migrated.scavs) {
			expect(getScavRelations(migrated, scav.id).every((item) => item.score === 0 && item.workTogether === 0 && item.sortiesTogether === 0)).toBe(true);
			expect(getLossReaction(migrated, scav.id)).toEqual([]);
			expect(getRaidQuote(migrated, scav, MAPS[0]!)).toEqual(getRaidQuote(original, original.scavs.find((item) => item.id === scav.id)!, MAPS[0]!));
		}
		expect(getRoomProductionState(migrated, migrated.shelter.rooms[0]!)).toEqual(getRoomProductionState(original, workshop));
		expect(parseSave(saveGame(migrated))).toEqual(migrated);
	});

	test("screen state and shared choices survive a portable export without resetting their ledger", () => {
		const state = pairedWork();
		chooseEvent(state, "first_shift");
		const session = readGameSession({ version: 1, page: "squad", view: "base", scavId: state.scavs[0]!.id }, state);
		const exported = exportGameSave(state, session), restored = parseGameSave(exported, state.lastUpdated)!;
		expect(restored).not.toBeNull();
		expect(restored.state).toEqual(state);
		expect(restored.session).toEqual(JSON.parse(JSON.stringify(session)));
		expect(readGameSession(restored.session, restored.state).page).toBe("squad");
		expect(getScavRelations(restored.state, state.scavs[0]!.id)).toEqual(getScavRelations(state, state.scavs[0]!.id));
	});

	test("malformed links, duplicate decisions and forged event provenance are rejected as a whole save", () => {
		const state = pairedWork();
		chooseEvent(state, "first_shift");
		const raw = JSON.parse(saveGame(state)), social = raw.social;
		expect(social.pairs.length).toBeGreaterThan(0);
		const chosenIndex = social.pairs.findIndex((item: { decisions: unknown[] }) => item.decisions.length > 0);
		expect(chosenIndex).toBeGreaterThanOrEqual(0);
		const edits: ((source: any) => void)[] = [
			(source) => source.social = null,
			(source) => source.social.unknown = "field",
			(source) => source.social.pairs.push(structuredClone(source.social.pairs[0])),
			(source) => source.social.pairs[0].scavIds[0] = "scav-missing",
			(source) => source.social.pairs[0].scavIds[1] = source.social.pairs[0].scavIds[0],
			(source) => source.social.pairs[0].score = 61,
			(source) => source.social.pairs[0].score = -61,
			(source) => source.social.pairs[chosenIndex].score += 1,
			(source) => source.social.pairs[0].compatibility = 99,
			(source) => source.social.pairs[0].workTogether = 1.5,
			(source) => source.social.pairs[0].sortiesTogether = -1,
			(source) => source.social.pairs[0].lastAt = source.lastUpdated + 1,
			(source) => source.social.pairs[chosenIndex].decisions.push(structuredClone(source.social.pairs[chosenIndex].decisions[0])),
			(source) => source.social.pairs[chosenIndex].decisions[0].eventId = "constructor",
			(source) => source.social.pairs[chosenIndex].decisions[0].choiceId = "__proto__",
			(source) => source.social.pairs[chosenIndex].decisions[0].at = source.lastUpdated + 1,
			(source) => source.social.pairs[chosenIndex].decisions[0].workTogether = 0,
		];
		for (const edit of edits) {
			const source = structuredClone(raw); edit(source);
			expect(parseSave(JSON.stringify(source))).toBeNull();
		}
		expect(parseSave(JSON.stringify(raw))).toEqual(state);
	});

	test("partial paid co-work and pending decisions roundtrip across a backwards clock without new income", () => {
		const state = pairedWork(), room = state.shelter.rooms.find((item) => item.type === "workshop")!;
		expect(queueModuleProduction(state, room.id, "factory-sks-stock", state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated + 1_000);
		const original = structuredClone(state), at = state.lastUpdated - 30_000;
		const loaded = loadGameWithSummary(saveGame(state), at)!;
		expect(loaded).not.toBeNull();
		expect(loaded.summary.elapsedMs).toBe(0);
		expect(loaded.state.money).toBe(original.money);
		expect(loaded.state.supplies).toEqual(original.supplies);
		expect(loaded.state.rng).toBe(original.rng);
		expect(getScavRelations(loaded.state, state.scavs[0]!.id).map(({ score, workTogether, sortiesTogether }) => ({ score, workTogether, sortiesTogether })))
			.toEqual(getScavRelations(original, state.scavs[0]!.id).map(({ score, workTogether, sortiesTogether }) => ({ score, workTogether, sortiesTogether })));
		expect(getSquadSocialEvents(loaded.state).map(({ id, eventId, choices }) => ({ id, eventId, choices })))
			.toEqual(getSquadSocialEvents(original).map(({ id, eventId, choices }) => ({ id, eventId, choices })));
		expect(loaded.state.shelter.rooms.find((item) => item.id === room.id)!.queue[0]!.workDone).toBe(room.queue[0]!.workDone);
		expect(parseSave(saveGame(loaded.state))).toEqual(loaded.state);
	});

	test("an in-progress social credit cannot reference another room, unknown job or impossible amount", () => {
		const state = funded(), room = workshopPair(state);
		expect(queueModuleProduction(state, room.id, "factory-sks-stock", state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated + 1_000);
		const raw = JSON.parse(saveGame(state));
		const index = raw.social.pairs.findIndex((item: { workCredit: unknown }) => item.workCredit !== null);
		expect(index).toBeGreaterThanOrEqual(0);
		const edits: ((source: any) => void)[] = [
			(source) => source.social.pairs[index].workCredit.jobId = "job-missing",
			(source) => source.social.pairs[index].workCredit.roomId = "room-missing",
			(source) => source.social.pairs[index].workCredit.workDone = -1,
			(source) => source.social.pairs[index].workCredit.workDone = 1e15,
			(source) => source.social.pairs[index].workCredit.unknown = true,
		];
		for (const edit of edits) {
			const changed = structuredClone(raw); edit(changed);
			expect(parseSave(JSON.stringify(changed))).toBeNull();
		}
		expect(parseSave(JSON.stringify(raw))).toEqual(state);
	});
});

describe("losses affect survivors without changing already-dispatched outcomes", () => {
	test("loss evidence rejects mismatched portraits, impossible recovery, duplicate choices and active peers used as dead", () => {
		const { state, survivor } = fatalFriend("expedition"), raw = JSON.parse(saveGame(state));
		const index = raw.social.losses.findIndex((item: { scavId: string }) => item.scavId === survivor.id);
		expect(index).toBeGreaterThanOrEqual(0);
		const edits: ((source: any) => void)[] = [
			(source) => source.social.losses[index].scavId = "scav-missing",
			(source) => source.social.losses[index].fallenId = survivor.id,
			(source) => source.social.losses[index].fallenName = "Другое имя",
			(source) => source.social.losses[index].fallenAppearance = 100,
			(source) => source.social.losses[index].at = source.lastUpdated + 1,
			(source) => source.social.losses[index].severity = 25,
			(source) => source.social.losses[index].workCompleted = 1e6,
			(source) => source.social.losses[index].returnsCompleted = 1e6,
			(source) => source.social.losses[index].choiceId = "listen",
			(source) => source.social.losses[index].choiceAt = source.lastUpdated,
			(source) => source.social.losses[index].workCredit = { jobId: "job-missing", roomId: "room-missing", workDone: 1 },
			(source) => source.social.losses.push(structuredClone(source.social.losses[index])),
		];
		for (const edit of edits) {
			const changed = structuredClone(raw); edit(changed);
			expect(parseSave(JSON.stringify(changed))).toBeNull();
		}
		expect(parseSave(JSON.stringify(raw))).toEqual(state);
		const at = state.lastUpdated - 30_000, restored = loadGameWithSummary(saveGame(state), at)!;
		expect(restored).not.toBeNull();
		expect(restored.summary.elapsedMs).toBe(0);
		expect(restored.state.money).toBe(state.money);
		expect(restored.state.rng).toBe(state.rng);
		expect(getLossReaction(restored.state, survivor.id)[0]!.remaining).toBe(getLossReaction(state, survivor.id)[0]!.remaining);
		expect(parseSave(saveGame(restored.state))).toEqual(restored.state);
	});

	test("grief recovers through paid completed work, real returns and one supported choice, never idle time", () => {
		const { state, survivor } = fatalFriend("expedition");
		const initial = getLossReaction(state, survivor.id)[0]!;
		expect(initial.relationshipLabel).toBe("Друзья");
		expect(initial.remaining).toBe(24);
		const event = getSquadSocialEvents(state, survivor.id).find((item) => item.eventId === "loss")!;
		expect(event).toBeDefined();
		expect(event.choices.every((item) => item.reason !== null)).toBe(true);
		const waiting = saveGame(state);
		expect(resolveSocialEvent(state, event.id, "listen").ok).toBe(false);
		expect(saveGame(state)).toBe(waiting);
		const raid = state.raids.find((item) => item.scavId === survivor.id)!;
		raid.chance = 1;
		advance(state, raid.endsAt);
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		expect(getLossReaction(state, survivor.id)[0]!.remaining).toBe(20);
		const workshop = state.shelter.rooms.find((item) => item.type === "workshop")!;
		expect(assignWorker(state, survivor.id, workshop.id, state.lastUpdated).ok).toBe(true);
		completePaidModules(state, 3);
		expect(getLossReaction(state, survivor.id)[0]!.remaining).toBe(17);
		advance(state, state.lastUpdated + 120_000);
		expect(getLossReaction(state, survivor.id)[0]!.remaining).toBe(17);
		expect(queueModuleProduction(state, workshop.id, "factory-sks-stock", state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated + 1_000);
		expect(cancelProduction(state, workshop.id, workshop.queue[0]!.id, state.lastUpdated).ok).toBe(true);
		expect(getLossReaction(state, survivor.id)[0]!.remaining).toBe(17);
		const liveEvent = getSquadSocialEvents(state, survivor.id).find((item) => item.id === event.id)!;
		const quote = liveEvent.choices.find((item) => item.id === "ritual")!, money = state.money, medicine = state.supplies.medicine;
		expect(resolveSocialEvent(state, event.id, quote.id).ok).toBe(true);
		expect(state.money).toBe(money - quote.cost.money);
		expect(state.supplies.medicine).toBe(medicine - quote.cost.supplies.medicine);
		expect(getLossReaction(state, survivor.id)[0]!.remaining).toBe(5);
		expect(getLossReaction(state, survivor.id)[0]!.resolved).toBe(true);
		const resolved = saveGame(state);
		expect(resolveSocialEvent(state, event.id, quote.id).ok).toBe(false);
		expect(saveGame(state)).toBe(resolved);
		completePaidModules(state, 6);
		expect(getLossReaction(state, survivor.id)[0]!.remaining).toBe(0);
		expect(getLossReaction(state, survivor.id)[0]!.fallenName).toBe(initial.fallenName);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("a newly assigned survivor cannot recover grief by collecting a blocked order completed by someone else", () => {
		const { state, survivor } = fatalFriend("expedition"), raid = state.raids.find((item) => item.scavId === survivor.id)!;
		raid.chance = 1; advance(state, raid.endsAt);
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		const room = state.shelter.rooms.find((item) => item.type === "workshop")!, worker = state.scavs.find((item) => item.id !== survivor.id)!;
		expect(assignWorker(state, worker.id, room.id, state.lastUpdated).ok).toBe(true);
		while (state.modules.length < getModuleCapacity(state)) expect(craftModule(state, "factory-sks-stock").ok).toBe(true);
		expect(queueModuleProduction(state, room.id, "factory-sks-stock", state.lastUpdated).ok).toBe(true);
		const job = room.queue[0]!;
		while (job.workDone < job.workRequired) advance(state, state.lastUpdated + 1_000);
		expect(getRoomProductionState(state, room).reason).not.toBeNull();
		const reaction = structuredClone(getLossReaction(state, survivor.id));
		expect(assignWorker(state, survivor.id, room.id, state.lastUpdated).ok).toBe(true);
		expect(sellModule(state, state.modules[0]!.id).ok).toBe(true);
		advance(state, state.lastUpdated);
		expect(room.queue).toHaveLength(0);
		expect(getLossReaction(state, survivor.id)).toEqual(reaction);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	for (const mode of ["expedition", "legacy"] as const) test(`a real ${mode} friend casualty keeps a death snapshot and grief once, without free loot`, () => {
		const { state, before, departing, survivor, survivorRaid, report } = fatalFriend(mode);
		expect(report.success).toBe(false);
		expect(report.money).toBe(0);
		expect(report.supplies).toEqual({ ammo: 0, medicine: 0, scrap: 0, intel: 0 });
		expect(state.modules).toEqual(before.modules);
		expect(state.scavs.some((item) => item.id === departing.id)).toBe(false);
		expect(state.memorials.find((item) => item.id === departing.id)!.appearance).toBe(departing.appearance!);
		const reactions = getLossReaction(state, survivor.id);
		expect(reactions).toHaveLength(1);
		expect(JSON.stringify(reactions)).toContain(departing.name);
		expect(state.raids.find((item) => item.id === survivorRaid.id)).toEqual(before.raids.find((item) => item.id === survivorRaid.id));
		expect(getRaidSocialSupport(state, survivor.id, "courtyard").griefPenalty).toBeGreaterThan(0);
		expect(getRaidSocialSupport(state, survivor.id, "courtyard").chance).toBeLessThan(0);
		expect(getScavRelations(state, survivor.id).some((item) => item.peerId === departing.id)).toBe(false);
		const saved = saveGame(state);
		advance(state, state.lastUpdated);
		expect(saveGame(state)).toBe(saved);
		expect(parseSave(saved)).toEqual(state);
		const restored = parseSave(saved)!;
		expect(getLossReaction(restored, survivor.id)).toEqual(reactions);
		expect(extractRaid(state, report.raidId, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(saved);
	});
});

