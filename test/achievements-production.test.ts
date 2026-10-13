import { fundConstructionLoot } from './loot-material-fixture';
import { describe, expect, test } from "bun:test";
import {
	advance, assignWorker, buildRoom, cancelProduction, continueExpedition, craftGear, createGame,
	dispatchRaid, equipGear, extractRaid, getRaidQuote, getRaidSocialSupport, getRoomUpgradeQuote,
	getScavRelations, getSquadSocialEvents, getSupplyCapacity, parseSave, queueModuleProduction,
	resolveSocialEvent, saveGame, setRaidTactic, setRoomRecipe, upgradeRoom, type GameState,
} from "../src/game/engine";
import { useWeaponPlatformFixture } from "./weapon-fixtures";
import { MAP_BY_ID } from "../src/game/data";

const NOW = 1_792_000_000_000;

function funded() {
	const state = createGame(NOW);
	state.money = 30_000;
	state.supplies = { ammo: 500, medicine: 6, scrap: 1_000, intel: 100 };
	return fundConstructionLoot(state);
}
function room(state: GameState, type: "workshop" | "medbay" | "recycler") {
	return state.shelter.rooms.find((item) => item.type === type)!;
}
function addRoom(state: GameState, type: "workshop" | "recycler") {
	const site = state.shelter.sites.find((site) => !state.shelter.rooms.some((item) => item.column === site.column && item.row === site.row))!;
	expect(buildRoom(state, type, site.column, site.row, state.lastUpdated).ok).toBe(true);
	const result = state.shelter.rooms.at(-1)!;
	advance(state, state.lastUpdated + 90_000);
	expect(result.status).toBe("ready");
	return result;
}
function finishJob(state: GameState, jobId: string) {
	for (let count = 0; count < 600 && state.shelter.rooms.some((room) => room.queue.some((job) => job.id === jobId)); count++)
		advance(state, state.lastUpdated + 1_000);
	expect(state.shelter.rooms.some((room) => room.queue.some((job) => job.id === jobId))).toBe(false);
}
function makePart(state: GameState, roomId = room(state, "workshop").id) {
	expect(queueModuleProduction(state, roomId, "factory-sks-stock", state.lastUpdated).ok).toBe(true);
	const bench = state.shelter.rooms.find((item) => item.id === roomId)!;
	const jobId = bench.queue.at(-1)!.id;
	finishJob(state, jobId);
	return jobId;
}
function checkpoint(state: GameState) {
	const scav = state.scavs[0]!;
	expect(assignWorker(state, scav.id, null, state.lastUpdated).ok).toBe(true);
	expect(dispatchRaid(state, scav.id, "courtyard", state.lastUpdated).ok).toBe(true);
	const raid = state.raids.find((item) => item.scavId === scav.id)!;
	// Only combat success is fixed; cargo and all achievement events use real settlement.
	raid.chance = 1;
	advance(state, raid.endsAt);
	expect(raid.expedition!.status).toBe("choice");
	return raid;
}
function conflictingPair() {
	const state = funded(), bench = room(state, "workshop"), first = state.scavs[0]!, second = state.scavs[1]!;
	const quote = getRoomUpgradeQuote(state, bench.id);
	expect(upgradeRoom(state, bench.id, state.lastUpdated).ok).toBe(true);
	advance(state, state.lastUpdated + quote.duration * 1_000);
	expect(assignWorker(state, first.id, bench.id, state.lastUpdated).ok).toBe(true);
	expect(assignWorker(state, second.id, bench.id, state.lastUpdated).ok).toBe(true);
	for (let count = 0; count < 3; count++) makePart(state);
	const shift = getSquadSocialEvents(state).find((event) => event.eventId === "first_shift")!;
	expect(resolveSocialEvent(state, shift.id, "respect").ok).toBe(true);
	for (let count = 0; count < 3; count++) makePart(state);
	expect(getScavRelations(state, first).find((view) => view.peerId === second.id)!.status).toBe("rival");
	const event = getSquadSocialEvents(state).find((event) => event.eventId === "friction")!;
	expect(event).toBeDefined();
	return { state, bench, first, second, event };
}
function friendlyPair() {
	const state = funded(), bench = room(state, "workshop");
	const best = state.scavs.flatMap((scav) => getScavRelations(state, scav).map((view) => ({ scav, view })))
		.sort((a, b) => b.view.compatibility - a.view.compatibility)[0]!;
	const departing = best.scav, supporter = state.scavs.find((scav) => scav.id === best.view.peerId)!;
	const quote = getRoomUpgradeQuote(state, bench.id);
	expect(upgradeRoom(state, bench.id, state.lastUpdated).ok).toBe(true);
	advance(state, state.lastUpdated + quote.duration * 1_000);
	for (const worker of [departing, supporter]) expect(assignWorker(state, worker.id, bench.id, state.lastUpdated).ok).toBe(true);
	for (let count = 0; count < 3; count++) makePart(state);
	const shift = getSquadSocialEvents(state).find((event) => event.eventId === "first_shift")!;
	expect(resolveSocialEvent(state, shift.id, "tea").ok).toBe(true);
	return { state, bench, departing, supporter };
}
function deepExtraction(state: GameState, raid: GameState["raids"][number]) {
	raid.chance = 1;
	advance(state, Math.max(state.lastUpdated, raid.endsAt));
	expect(continueExpedition(state, raid.id, "recon", raid.expedition!.offers[0]!, state.lastUpdated).ok).toBe(true);
	raid.chance = 1;
	advance(state, raid.endsAt);
	expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
}

describe("achievement production causality", () => {
	test("radio unloading requires full delivery AND completion of the exact paid order", () => {
		const state = funded(), raid = checkpoint(state), cargo = structuredClone(raid.expedition!.cargo.supplies);
		expect(cargo.scrap).toBeGreaterThan(0);
		const cap = getSupplyCapacity(state);
		for (const key of Object.keys(cargo) as (keyof typeof cargo)[]) state.supplies[key] = cap[key] - cargo[key];
		state.supplies.scrap++;
		expect(assignWorker(state, state.scavs[2]!.id, room(state, "workshop").id, state.lastUpdated).ok).toBe(true);
		expect(queueModuleProduction(state, room(state, "workshop").id, "factory-sks-stock", state.lastUpdated).ok).toBe(true);
		const jobId = room(state, "workshop").queue[0]!.id;
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		expect(state.history[0]!.supplies).toEqual(cargo);
		expect(state.achievements.unlocked["radio-unload"]).toBeUndefined();
		finishJob(state, jobId);
		expect(state.achievements.unlocked["radio-unload"]).toBeDefined();
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("cancelling the space-making order never grants radio unloading", () => {
		const state = funded(), raid = checkpoint(state), cargo = raid.expedition!.cargo.supplies, cap = getSupplyCapacity(state);
		for (const key of Object.keys(cargo) as (keyof typeof cargo)[]) state.supplies[key] = cap[key] - cargo[key];
		state.supplies.scrap++;
		expect(queueModuleProduction(state, room(state, "workshop").id, "factory-sks-stock", state.lastUpdated).ok).toBe(true);
		const jobId = room(state, "workshop").queue[0]!.id;
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		expect(cancelProduction(state, room(state, "workshop").id, jobId, state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated + 120_000);
		expect(state.achievements.unlocked["radio-unload"]).toBeUndefined();
	});

	test("a blocked batch needs useful fabrication and use of that same item", () => {
		const state = funded(), recycler = addRoom(state, "recycler"), worker = state.scavs[0]!;
		state.supplies.scrap = getSupplyCapacity(state).scrap - 6;
		expect(assignWorker(state, worker.id, recycler.id, state.lastUpdated).ok).toBe(true);
		expect(setRoomRecipe(state, recycler.id, "scrap-batch", false, state.lastUpdated).ok).toBe(true);
		const jobId = recycler.queue[0]!.id;
		state.supplies.scrap = getSupplyCapacity(state).scrap;
		advance(state, state.lastUpdated + 80_000);
		expect(recycler.queue[0]!.id).toBe(jobId);
		expect(recycler.queue[0]!.workDone).toBe(recycler.queue[0]!.workRequired);
		expect(craftGear(state, "patrol_armor").ok).toBe(true);
		const gearId = state.gearItems.at(-1)!.id;
		advance(state, state.lastUpdated);
		expect(recycler.queue).toHaveLength(0);
		expect(state.achievements.unlocked["storage-chain"]).toBeUndefined();
		expect(equipGear(state, worker.id, "armor", gearId).ok).toBe(true);
		expect(assignWorker(state, worker.id, null, state.lastUpdated).ok).toBe(true);
		expect(dispatchRaid(state, worker.id, "courtyard", state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked["storage-chain"]).toBeDefined();
	});

	test("a cancelled blocked batch cannot be replaced with a new job for its achievement", () => {
		const state = funded(), recycler = addRoom(state, "recycler");
		state.supplies.scrap = getSupplyCapacity(state).scrap - 6;
		expect(assignWorker(state, state.scavs[1]!.id, recycler.id, state.lastUpdated).ok).toBe(true);
		expect(setRoomRecipe(state, recycler.id, "scrap-batch", false, state.lastUpdated).ok).toBe(true);
		const jobId = recycler.queue[0]!.id;
		state.supplies.scrap = getSupplyCapacity(state).scrap;
		advance(state, state.lastUpdated + 80_000);
		expect(cancelProduction(state, recycler.id, jobId, state.lastUpdated).ok).toBe(true);
		expect(craftGear(state, "patrol_armor").ok).toBe(true);
		expect(equipGear(state, state.scavs[0]!.id, "armor", state.gearItems.at(-1)!.id).ok).toBe(true);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked["storage-chain"]).toBeUndefined();
	});

	test("renovation preserves the paid original while its worker completes real work elsewhere", () => {
		const state = funded(), original = room(state, "workshop"), alternate = addRoom(state, "workshop"), worker = state.scavs[0]!;
		expect(assignWorker(state, worker.id, original.id, state.lastUpdated).ok).toBe(true);
		expect(queueModuleProduction(state, original.id, "factory-sks-stock", state.lastUpdated).ok).toBe(true);
		const originalId = original.queue[0]!.id;
		advance(state, state.lastUpdated + 5_000);
		expect(original.queue[0]!.workDone).toBeGreaterThan(0);
		const quote = getRoomUpgradeQuote(state, original.id);
		expect(upgradeRoom(state, original.id, state.lastUpdated).ok).toBe(true);
		expect(assignWorker(state, worker.id, alternate.id, state.lastUpdated).ok).toBe(true);
		makePart(state, alternate.id);
		expect(original.status).toBe("upgrading");
		expect(state.achievements.unlocked.renovation).toBeUndefined();
		advance(state, state.lastUpdated + quote.duration * 1_000);
		expect(assignWorker(state, worker.id, original.id, state.lastUpdated).ok).toBe(true);
		finishJob(state, originalId);
		expect(state.achievements.unlocked.renovation).toBeDefined();
		expect(parseSave(saveGame(state))).toEqual(state);
	});
});

describe("achievement social consequences", () => {
	for (const choiceId of ["mediate", "space"] as const) test(`truce needs actual improved work after ${choiceId}, not just dialogue`, () => {
		const { state, event } = conflictingPair();
		expect(resolveSocialEvent(state, event.id, choiceId).ok).toBe(true);
		expect(state.achievements.unlocked.truce).toBeUndefined();
		makePart(state);
		expect(state.achievements.unlocked.truce).toBeDefined();
		const evidence = structuredClone(state.achievements.unlocked.truce);
		makePart(state);
		expect(state.achievements.unlocked.truce).toEqual(evidence);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("boundaries earn their own achievement through two separate productive assignments", () => {
		const { state, first, second, event, bench } = conflictingPair();
		expect(resolveSocialEvent(state, event.id, "space").ok).toBe(true);
		expect(assignWorker(state, second.id, room(state, "medbay").id, state.lastUpdated).ok).toBe(true);
		expect(queueModuleProduction(state, bench.id, "factory-sks-stock", state.lastUpdated).ok).toBe(true);
		expect(setRoomRecipe(state, room(state, "medbay").id, "medicine-batch", false, state.lastUpdated).ok).toBe(true);
		const firstJob = bench.queue[0]!.id, secondJob = room(state, "medbay").queue[0]!.id;
		finishJob(state, firstJob);
		expect(state.achievements.unlocked["separate-benches"]).toBeUndefined();
		finishJob(state, secondJob);
		expect(first.assignment).not.toBe(second.assignment);
		expect(state.achievements.unlocked["separate-benches"]).toBeDefined();
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("two fronts links a real shared shift, base support, paid work and deep extraction", () => {
		const { state, bench, departing, supporter } = friendlyPair();
		expect(getRaidSocialSupport(state, departing.id, "courtyard").supporterId).toBe(supporter.id);
		expect(assignWorker(state, departing.id, null, state.lastUpdated).ok).toBe(true);
		expect(dispatchRaid(state, departing.id, "courtyard", state.lastUpdated).ok).toBe(true);
		const raid = state.raids.find((item) => item.scavId === departing.id)!;
		raid.chance = 1;
		expect(queueModuleProduction(state, bench.id, "factory-sks-stock", state.lastUpdated).ok).toBe(true);
		const jobId = bench.queue[0]!.id;
		finishJob(state, jobId);
		expect(state.achievements.unlocked["two-fronts"]).toBeUndefined();
		deepExtraction(state, raid);
		expect(state.achievements.unlocked["two-fronts"]).toBeDefined();
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("support erased by the chance ceiling is not credited as a useful second front", () => {
		const { state, bench, departing } = friendlyPair();
		const weapon = state.weapons.find((item) => item.id === departing.weaponInstanceId)!;
		useWeaponPlatformFixture(state, weapon, "pkp");
		departing.combat = 100; departing.scouting = 100; departing.health = 100;
		departing.xp = 60 * 14 ** 2; departing.level = 15;
		expect(setRaidTactic(state, departing.id, "cautious").ok).toBe(true);
		expect(assignWorker(state, departing.id, null, state.lastUpdated).ok).toBe(true);
		expect(getRaidSocialSupport(state, departing.id, "courtyard").chance).toBeGreaterThan(0);
		expect(getRaidQuote(state, departing, MAP_BY_ID.courtyard! ).chance).toBe(0.97);
		expect(dispatchRaid(state, departing.id, "courtyard", state.lastUpdated).ok).toBe(true);
		const raid = state.raids.find((item) => item.scavId === departing.id)!;
		raid.chance = 1;
		makePart(state, bench.id);
		deepExtraction(state, raid);
		expect(state.achievements.unlocked["two-fronts"]).toBeUndefined();
	});

	test("a supporter assigned just before collection did not complete a real second-front shift", () => {
		const { state, bench, departing, supporter } = friendlyPair();
		for (const worker of [departing, supporter]) expect(assignWorker(state, worker.id, null, state.lastUpdated).ok).toBe(true);
		const substitute = state.scavs.find((scav) => scav.id !== departing.id && scav.id !== supporter.id)!;
		expect(assignWorker(state, substitute.id, bench.id, state.lastUpdated).ok).toBe(true);
		expect(dispatchRaid(state, departing.id, "courtyard", state.lastUpdated).ok).toBe(true);
		const raid = state.raids.find((item) => item.scavId === departing.id)!;
		raid.chance = 1;
		expect(queueModuleProduction(state, bench.id, "factory-sks-stock", state.lastUpdated).ok).toBe(true);
		const job = bench.queue[0]!;
		while (job.workDone < job.workRequired * 0.9) advance(state, state.lastUpdated + 1_000);
		while (job.workDone < job.workRequired * 0.99) advance(state, state.lastUpdated + 10);
		expect(assignWorker(state, substitute.id, null, state.lastUpdated).ok).toBe(true);
		expect(assignWorker(state, supporter.id, bench.id, state.lastUpdated).ok).toBe(true);
		finishJob(state, job.id);
		deepExtraction(state, raid);
		expect(state.achievements.unlocked["two-fronts"]).toBeUndefined();
		expect(parseSave(saveGame(state))).toEqual(state);
	});
});
