import { describe, expect, test } from "bun:test";
import {
	MAX_OFFLINE_MS,
	RUN_PERKS,
	EXPEDITION_BRANCHES,
	advance,
	continueExpedition,
	createGame,
	dispatchRaid,
	extractRaid,
	getExpeditionChoices,
	getCargoWeight,
	getRaidQuote,
	loadGameWithSummary,
	parseSave,
	saveGame,
	setAutoRaid,
	setAutoRaidDepth,
	setRaidTactic,
	craftGear,
	equipGear,
	type GameState,
	type Raid,
} from "../src/game/engine";
import { MAPS } from "../src/game/data";

const NOW = 1_792_000_000_000;

function copy(state: GameState): GameState {
	const result = parseSave(saveGame(state));
	expect(result).not.toBeNull();
	return result!;
}

function checkpoint(): { state: GameState; raid: Raid } {
	const state = createGame(NOW);
	expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
	const raid = state.raids[0]!;
	expect(raid.expedition).not.toBeNull();
	raid.chance = 1;
	expect(advance(state, raid.endsAt).completedCount).toBe(0);
	expect(raid.expedition!.status).toBe("choice");
	return { state, raid };
}

// A passive-only control separates raid cargo from production at the same clock.
function withoutActiveRaid(state: GameState): GameState {
	const control = structuredClone(state);
	control.raids = [];
	for (const scav of control.scavs) if (scav.status === "raiding") scav.status = scav.health >= 25 ? "ready" : "wounded";
	return control;
}

describe("checkpoint expeditions", () => {
	test("finding cargo reaches a decision without crediting it or completing the raid", () => {
		const state = createGame(NOW);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		const raid = state.raids[0]!;
		const control = withoutActiveRaid(state);
		raid.chance = 1;
		advance(control, raid.endsAt);
		const summary = advance(state, raid.endsAt);
		expect(summary.completedCount).toBe(0);
		expect(state.history).toHaveLength(0);
		expect(state.stats.raidsCompleted).toBe(0);
		expect(state.raids).toHaveLength(1);
		expect(raid.expedition!.status).toBe("choice");
		expect(raid.expedition!.cargo.money).toBeGreaterThan(0);
		expect(state.money).toBe(control.money);
		expect(state.supplies).toEqual(control.supplies);
		expect(state.scavs[0]!.status).toBe("raiding");
		expect(parseSave(saveGame(state))).not.toBeNull();
	});

	test("a manual decision survives offline caps, reloads and clock rollback without healing or rerolling cargo", () => {
		const { state, raid } = checkpoint();
		const expedition = structuredClone(raid.expedition!);
		const health = state.scavs[0]!.health;
		const rng = state.rng;
		const nextId = state.nextId;
		const loaded = loadGameWithSummary(saveGame(state), NOW + MAX_OFFLINE_MS * 3)!;
		expect(loaded).not.toBeNull();
		expect(loaded.summary.capped).toBe(true);
		expect(loaded.summary.completedCount).toBe(0);
		expect(loaded.state.raids[0]!.expedition).toEqual(expedition);
		expect(loaded.state.scavs[0]!.health).toBe(health);
		expect(loaded.state.rng).toBe(rng);
		expect(loaded.state.nextId).toBe(nextId);
		expect(loaded.state.history).toHaveLength(0);
		expect(parseSave(saveGame(loaded.state))).not.toBeNull();
		const rollback = loadGameWithSummary(saveGame(loaded.state), NOW - 60_000)!;
		const rolledExpedition = rollback.state.raids[0]!.expedition!;
		expect({ ...rolledExpedition, trail: [] }).toEqual({ ...expedition, trail: [] });
		expect(rolledExpedition.trail.every((event, index) => event.at <= rollback.state.lastUpdated && (index === 0 || event.at >= rolledExpedition.trail[index - 1]!.at))).toBe(true);
		expect(rollback.summary.elapsedMs).toBe(0);
		expect(parseSave(saveGame(rollback.state))).not.toBeNull();
		const saved = saveGame(rollback.state);
		expect(advance(rollback.state, rollback.state.lastUpdated).completedCount).toBe(0);
		expect(saveGame(rollback.state)).toBe(saved);
	});

	test("extracting banks the carried cargo exactly once and frees the surviving loadout", () => {
		const { state, raid } = checkpoint();
		const cargo = structuredClone(raid.expedition!.cargo);
		const before = state.money;
		const supplies = { ...state.supplies };
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		expect(state.raids).toHaveLength(0);
		expect(state.history).toHaveLength(1);
		expect(state.history[0]!.success).toBe(true);
		expect(state.history[0]!.money).toBeGreaterThanOrEqual(cargo.money);
		expect(state.money).toBe(before + state.history[0]!.money);
		for (const key of ["ammo", "medicine", "scrap", "intel"] as const)
			expect(state.supplies[key]).toBe(supplies[key] + cargo.supplies[key]);
		expect(state.stats.raidsCompleted).toBe(1);
		expect(state.scavs[0]!.status).not.toBe("raiding");
		const saved = saveGame(state);
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(false);
		expect(advance(state, state.lastUpdated).completedCount).toBe(0);
		expect(saveGame(state)).toBe(saved);
		expect(parseSave(saved)).not.toBeNull();
	});

	test("continuing requires a real offered perk and affordable branch quote, then charges the displayed costs once", () => {
		const { state, raid } = checkpoint();
		const offer = raid.expedition!.offers[0]!;
		const quote = getExpeditionChoices(state, raid, offer).find((item) => item.branch === "scavenge")!;
		expect(quote).toBeDefined();
		state.supplies.ammo = Math.max(0, quote.ammo - 1);
		const unaffordable = saveGame(state);
		expect(continueExpedition(state, raid.id, "scavenge", offer, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(unaffordable);
		state.supplies.ammo = 100;
		state.supplies.intel = 100;
		const before = saveGame(state);
		expect(continueExpedition(state, raid.id, "constructor" as "scavenge", offer, state.lastUpdated).ok).toBe(false);
		expect(continueExpedition(state, raid.id, "scavenge", "constructor" as typeof offer, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		const actual = getExpeditionChoices(state, raid, offer).find((item) => item.branch === "scavenge")!;
		const ammo = state.supplies.ammo;
		const intel = state.supplies.intel;
		const money = state.money;
		expect(continueExpedition(state, raid.id, "scavenge", offer, state.lastUpdated).ok).toBe(true);
		expect(raid.expedition!.status).toBe("travel");
		expect(raid.expedition!.perks).toContain(offer);
		expect(state.supplies.ammo).toBe(ammo - actual.ammo);
		expect(state.supplies.intel).toBe(intel - actual.intel);
		expect(state.money).toBe(money - actual.money);
		const travelling = saveGame(state);
		expect(continueExpedition(state, raid.id, "scavenge", offer, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(travelling);
		expect(parseSave(travelling)).not.toBeNull();
	});

	test("a later ambush destroys unbanked cargo but keeps permanent route knowledge", () => {
		const { state, raid } = checkpoint();
		const permanent = [...state.blueprints];
		expect(permanent).toContain("route:courtyard");
		const cargo = raid.expedition!.cargo.money;
		expect(cargo).toBeGreaterThan(0);
		state.supplies.ammo = 100;
		state.supplies.intel = 100;
		expect(continueExpedition(state, raid.id, "combat", raid.expedition!.offers[0]!, state.lastUpdated).ok).toBe(true);
		raid.chance = 0;
		const control = withoutActiveRaid(state);
		advance(control, raid.endsAt);
		const summary = advance(state, raid.endsAt);
		expect(summary.completedCount).toBe(1);
		expect(state.history[0]!.success).toBe(false);
		expect(state.history[0]!.money).toBe(0);
		expect(state.history[0]!.supplies).toEqual({ ammo: 0, medicine: 0, scrap: 0, intel: 0 });
		expect(state.money).toBe(control.money);
		for (const blueprint of permanent) expect(state.blueprints).toContain(blueprint);
		expect(state.raids).toHaveLength(0);
		expect(parseSave(saveGame(state))).not.toBeNull();
	});

	test("automatic depth is frozen for the current run and irregular ticks give the same complete state", () => {
		const long = createGame(NOW);
		long.money = 5_000;
		long.supplies = { ammo: 200, medicine: 30, scrap: 100, intel: 80 };
		for (const scav of long.scavs) {
			expect(setRaidTactic(long, scav.id, "cautious").ok).toBe(true);
			expect(setAutoRaidDepth(long, scav.id, 2).ok).toBe(true);
			expect(setAutoRaid(long, scav.id, "courtyard", 70, NOW).ok).toBe(true);
		}
		const current = long.raids[0]!;
		expect(current.expedition!.autoDepth).toBe(2);
		expect(setAutoRaidDepth(long, current.scavId, 1).ok).toBe(true);
		expect(current.expedition!.autoDepth).toBe(2);
		const short = copy(long);
		const until = NOW + 15 * 60_000;
		const count = advance(long, until).completedCount;
		const intervals = [997, 13_007, 29_991, 3_013];
		let time = NOW;
		let ticks = 0;
		let shortCount = 0;
		while (time < until) {
			time = Math.min(until, time + intervals[ticks++ % intervals.length]!);
			shortCount += advance(short, time).completedCount;
		}
		expect(count).toBeGreaterThan(0);
		expect(shortCount).toBe(count);
		expect(short).toEqual(long);
		expect(parseSave(saveGame(long))).not.toBeNull();
	});

	test("an automatic order waiting for its departure fee wakes at production time rather than the next browser tick", () => {
		const long = createGame(NOW);
		long.money = 0;
		const scav = long.scavs[0]!;
		expect(getRaidQuote(long, scav, MAPS[0]!).money).toBe(15);
		expect(setAutoRaid(long, scav.id, "courtyard", 70, NOW).ok).toBe(true);
		expect(long.raids).toHaveLength(0);
		const short = copy(long);
		advance(long, NOW + 149_999);
		expect(long.raids).toHaveLength(0);
		advance(long, NOW + 150_000);
		expect(long.raids).toHaveLength(1);
		expect(long.raids[0]!.startedAt).toBe(NOW + 150_000);
		expect(long.money).toBe(0);
		advance(long, NOW + 300_000);
		for (let elapsed = 997; elapsed < 300_000; elapsed += 997) advance(short, NOW + elapsed);
		advance(short, NOW + 300_000);
		expect(short).toEqual(long);
		expect(parseSave(saveGame(long))).not.toBeNull();
	});

	test("a three-stage automatic route extracts at its final checkpoint and agrees under irregular offline ticks", () => {
		const long = createGame(NOW);
		long.money = 20_000;
		long.supplies = { ammo: 200, medicine: 40, scrap: 100, intel: 100 };
		long.base.medbay = 5;
		const scav = long.scavs[0]!;
		scav.combat = 100;
		scav.scouting = 100;
		expect(setRaidTactic(long, scav.id, "cautious").ok).toBe(true);
		expect(setAutoRaidDepth(long, scav.id, 3).ok).toBe(true);
		expect(setAutoRaid(long, scav.id, "courtyard", 70, NOW).ok).toBe(true);
		long.raids[0]!.chance = 1;
		const short = copy(long);
		const until = NOW + 20 * 60_000;
		advance(long, until);
		let cursor = NOW;
		let index = 0;
		const intervals = [61_013, 997, 7_313, 19_123];
		while (cursor < until) {
			cursor = Math.min(until, cursor + intervals[index++ % intervals.length]!);
			advance(short, cursor);
		}
		expect(long.history.some((report) => report.success && report.depth === 3)).toBe(true);
		expect(short).toEqual(long);
		expect(long.raids.every((raid) => raid.expedition?.status !== "choice")).toBe(true);
		expect(parseSave(saveGame(long))).not.toBeNull();
	});

	test("a full three-stage run respects carrying capacity, ends at its final checkpoint and leaves temporary perks behind", () => {
		const { state, raid } = checkpoint();
		const chosenPerks: string[] = [];
		for (const branch of ["scavenge", "combat"] as const) {
			const expedition = raid.expedition!;
			chosenPerks.push(RUN_PERKS[expedition.offers[0]!].label);
			expect(continueExpedition(state, raid.id, branch, expedition.offers[0]!, state.lastUpdated).ok).toBe(true);
			raid.chance = 1;
			expect(advance(state, raid.endsAt).completedCount).toBe(0);
			expect(raid.expedition!.status).toBe("choice");
			expect(getCargoWeight(raid.expedition!.cargo)).toBeLessThanOrEqual(raid.expedition!.capacity);
			expect(parseSave(saveGame(state))).not.toBeNull();
		}
		expect(raid.expedition!.stage).toBe(3);
		expect(raid.expedition!.perks).toHaveLength(2);
		expect(new Set(raid.expedition!.perks).size).toBe(2);
		expect(raid.expedition!.offers).toHaveLength(0);
		expect(getExpeditionChoices(state, raid)).toHaveLength(0);
		expect(state.blueprints).toContain("cargo_pack");
		expect(state.blueprints).toContain("plate_armor");
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		expect(state.history[0]!.depth).toBe(3);
		const trail = state.history[0]!.events;
		expect(trail[0]!.at).toBe(NOW);
		expect(trail.at(-1)!.at).toBe(state.lastUpdated);
		expect(trail.at(-1)!.kind).toBe("success");
		expect(trail.every((event, index) => event.at <= state.lastUpdated && (index === 0 || event.at >= trail[index - 1]!.at))).toBe(true);
		for (const branch of ["scavenge", "combat"] as const) expect(trail.some((event) => event.text.includes(EXPEDITION_BRANCHES[branch].label))).toBe(true);
		for (const perk of chosenPerks) expect(trail.some((event) => event.text.includes(perk))).toBe(true);
		expect(state.stats.raidsCompleted).toBe(1);
		expect(dispatchRaid(state, raid.scavId, "courtyard", state.lastUpdated).ok).toBe(true);
		const next = state.raids[0]!.expedition!;
		expect(next.stage).toBe(1);
		expect(next.perks).toHaveLength(0);
		expect(next.offers).toHaveLength(0);
		expect(next.cargo).toEqual({ money: 0, supplies: { ammo: 0, medicine: 0, scrap: 0, intel: 0 }, weaponIds: [] });
		expect(state.blueprints).toContain("plate_armor");
		expect(parseSave(saveGame(state))).not.toBeNull();
	});

	test("fatal expedition losses remove only the missing scav's owned gear, preserve transmitted unlocks and cannot resurrect on reload", () => {
		const initial = createGame(NOW);
		expect(craftGear(initial, "light_vest").ok).toBe(true);
		const lostGearId = initial.gearItems.at(-1)!.id;
		expect(craftGear(initial, "scout_pack").ok).toBe(true);
		const safeGearId = initial.gearItems.at(-1)!.id;
		const scavId = initial.scavs[0]!.id;
		expect(equipGear(initial, scavId, "armor", lostGearId).ok).toBe(true);
		expect(dispatchRaid(initial, scavId, "courtyard", NOW).ok).toBe(true);
		initial.raids[0]!.chance = 1;
		advance(initial, initial.raids[0]!.endsAt);
		const cargo = structuredClone(initial.raids[0]!.expedition!.cargo);
		let lethal: GameState | null = null;
		for (let seed = 1; seed <= 1_000; seed++) {
			const candidate = copy(initial);
			const raid = candidate.raids[0]!;
			expect(continueExpedition(candidate, raid.id, "combat", raid.expedition!.offers[0]!, candidate.lastUpdated).ok).toBe(true);
			raid.chance = 0;
			raid.seed = seed;
			advance(candidate, raid.endsAt);
			if (candidate.history[0]!.lostScav) { lethal = candidate; break; }
		}
		expect(lethal).not.toBeNull();
		expect(lethal!.history[0]!.lostCargo).toEqual(cargo);
		expect(lethal!.history[0]!.lostWeapon).toBe(true);
		expect(lethal!.history[0]!.money).toBe(0);
		expect(lethal!.scavs.some((scav) => scav.id === scavId)).toBe(false);
		expect(lethal!.gearItems.some((item) => item.id === lostGearId)).toBe(false);
		expect(lethal!.gearItems.some((item) => item.id === safeGearId)).toBe(true);
		expect(lethal!.blueprints).toContain("route:courtyard");
		expect(lethal!.blueprints).toContain("plate_armor");
		const loaded = loadGameWithSummary(saveGame(lethal!), lethal!.lastUpdated + MAX_OFFLINE_MS)!;
		expect(loaded).not.toBeNull();
		expect(loaded.summary.completedCount).toBe(0);
		expect(loaded.state.stats.lostScavs).toBe(1);
		expect(loaded.state.stats.raidsCompleted).toBe(1);
		expect(loaded.state.scavs.some((scav) => scav.id === scavId)).toBe(false);
		expect(loaded.state.gearItems.some((item) => item.id === lostGearId)).toBe(false);
		expect(parseSave(saveGame(loaded.state))).not.toBeNull();
	});

	test("malformed checkpoint state cannot introduce foreign owners, nonfinite cargo, invalid choices or duplicate discoveries", () => {
		const { state } = checkpoint();
		const mutations: ((value: ReturnType<typeof JSON.parse>) => void)[] = [
			(value) => { value.raids[0].expedition.cargo.money = -1; },
			(value) => { value.raids[0].expedition.cargo.money = Number.POSITIVE_INFINITY; },
			(value) => { value.raids[0].expedition.cargo.supplies.scrap = -1; },
			(value) => { value.raids[0].expedition.cargo.weaponIds = ["constructor"]; },
			(value) => { value.raids[0].expedition.status = "constructor"; },
			(value) => { value.raids[0].expedition.branch = "constructor"; },
			(value) => { value.raids[0].expedition.stage = 99; },
			(value) => { value.raids[0].expedition.autoDepth = 0; },
			(value) => { value.raids[0].expedition.perks = ["constructor"]; },
			(value) => { value.raids[0].expedition.offers = ["careful", "careful"]; },
			(value) => { value.raids[0].expedition.loadout.ammoType = "constructor"; },
			(value) => { value.raids[0].expedition.loadout.medkit = true; },
			(value) => { value.blueprints.push(value.blueprints[0]); },
			(value) => { value.raids[0].scavId = "scav-999"; },
		];
		for (const mutate of mutations) {
			const value = JSON.parse(saveGame(state));
			mutate(value);
			expect(parseSave(JSON.stringify(value))).toBeNull();
		}
		expect(parseSave(saveGame(state))).toEqual(state);
	});
});
