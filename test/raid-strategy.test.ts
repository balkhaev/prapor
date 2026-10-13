import { describe, expect, test } from "bun:test";
import {
	advance, continueExpedition, createGame, dispatchRaid, dispatchSquadRaid, extractRaid,
	getCargoWeight, getExpeditionChoices, getRaidChance, getRaidDuration, getRaidQuote,
	getSectorIntel, parseSave, saveGame, setRaidPlan, SAVE_VERSION,
	type GameState, type RaidObjective,
} from "../src/game/engine";
import { MAP_BY_ID } from "../src/game/data";

const NOW = 1_792_000_000_000;
function funded(now = NOW) {
	const state = createGame(now);
	state.money = 10_000;
	state.supplies = { ammo: 200, medicine: 30, scrap: 20, intel: 100 };
	return state;
}
function start(objective: RaidObjective = "general", preparation: "none" | "scouted" = "none") {
	const state = funded();
	expect(setRaidPlan(state, state.scavs[0]!.id, objective, preparation).ok).toBe(true);
	expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
	return { state, raid: state.raids[0]! };
}
function checkpoint(objective: RaidObjective = "general", preparation: "none" | "scouted" = "none") {
	const result = start(objective, preparation);
	result.raid.chance = 1;
	advance(result.state, result.raid.endsAt);
	expect(result.raid.expedition!.status).toBe("choice");
	return result;
}
function restore(state: GameState) {
	const restored = parseSave(saveGame(state));
	expect(restored).not.toBeNull();
	return restored!;
}

describe("supplies, preparation and sector strategy", () => {
	test("neutral general quotes retain the original chance and duration, and scouted adds only the promised personal fee", () => {
		const state = funded(), scav = state.scavs[0]!, map = MAP_BY_ID.courtyard!;
		const original = getRaidQuote(state, scav, map);
		expect(original.chance).toBe(getRaidChance(state, scav, map));
		expect(original.duration).toBe(getRaidDuration(state, scav, map));
		expect(setRaidPlan(state, scav.id, "general", "scouted").ok).toBe(true);
		const prepared = getRaidQuote(state, scav, map);
		expect(prepared.money - original.money).toBe(20);
		expect(prepared.intel - original.intel).toBe(2);
		expect(prepared.chance).toBeCloseTo(Math.min(.97, original.chance + .05));
		expect(prepared.duration).toBe(Math.round(original.duration * .9));
		expect(prepared.preparationMoney).toBe(20);
		expect(prepared.preparationIntel).toBe(2);
		state.supplies.intel = prepared.intel - 1;
		const before = saveGame(state);
		expect(dispatchRaid(state, scav.id, map.id, NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
	});

	test("paid route conditions persist through future-order edits, changing sectors and later stages", () => {
		const { state, raid } = checkpoint("medicine", "scouted");
		const snapshot = structuredClone(raid.strategy), base = { chance: raid.expedition!.baseChance, duration: raid.expedition!.baseDuration };
		const perk = raid.expedition!.offers[0]!, before = getExpeditionChoices(state, raid, perk);
		state.sectorIntel = { courtyard: { knowledge: 5, pressure: 6 } };
		expect(setRaidPlan(state, raid.scavId, "ammo", "none").ok).toBe(true);
		expect(getExpeditionChoices(state, raid, perk)).toEqual(before);
		expect(raid.strategy).toEqual(snapshot);
		const selected = before.find(choice => choice.branch === "scavenge")!;
		const money = state.money, intel = state.supplies.intel;
		expect(continueExpedition(state, raid.id, "scavenge", perk, state.lastUpdated).ok).toBe(true);
		expect(state.money).toBe(money - selected.money);
		expect(state.supplies.intel).toBe(intel - selected.intel);
		expect({ chance: raid.expedition!.baseChance, duration: raid.expedition!.baseDuration }).toEqual(base);
		expect(restore(state).raids[0]!.strategy).toEqual(snapshot);
	});

	test("same-seed supply objectives add their promised resource while trading cash and modules; damage and perks keep their RNG", () => {
		const general = checkpoint();
		for (const [objective, bonus] of [["ammo", 4], ["medicine", 2], ["scrap", 3], ["intel", 2]] as const) {
			const focused = checkpoint(objective);
			expect(focused.raid.seed).toBe(general.raid.seed);
			expect(focused.raid.expedition!.cargo.supplies[objective]).toBe(general.raid.expedition!.cargo.supplies[objective] + bonus);
			expect(Math.abs(focused.raid.expedition!.cargo.money - general.raid.expedition!.cargo.money * .75)).toBeLessThanOrEqual(1);
			expect(focused.raid.expedition!.cargo.modules.length).toBeLessThanOrEqual(general.raid.expedition!.cargo.modules.length);
			expect(focused.state.scavs[0]!.health).toBe(general.state.scavs[0]!.health);
			expect(focused.state.weapons[0]!.durability).toBe(general.state.weapons[0]!.durability);
			expect(focused.raid.expedition!.offers).toEqual(general.raid.expedition!.offers);
			expect(focused.state.rng).toBe(general.state.rng);
			expect(restore(focused.state)).toEqual(focused.state);
		}
	});

	test("a small bag retains the target ahead of bulk supplies and trophies; a general sortie preserves its previous drop order", () => {
		for (const objective of ["ammo", "general"] as const) {
			const { state, raid } = start(objective);
			raid.expedition!.capacity = 8;
			raid.expedition!.cargo.supplies = { ammo: 60, medicine: 10, scrap: 50, intel: 10 };
			raid.expedition!.cargo.weaponIds = ["ak74", "akm", "vss"];
			raid.chance = 1;
			advance(state, raid.endsAt);
			expect(getCargoWeight(raid.expedition!.cargo)).toBeLessThanOrEqual(8);
			if (objective === "ammo") expect(raid.expedition!.cargo.supplies.ammo).toBeGreaterThanOrEqual(64);
			else expect(raid.expedition!.cargo.supplies.ammo).toBe(0);
			expect(restore(state)).toEqual(state);
		}
	});

	test("target supplies remain escrowed until extraction and failed sorties never pay their bonus or learn the sector", () => {
		const { state, raid } = start("intel");
		raid.chance = 0;
		advance(state, raid.endsAt);
		expect(state.history[0]!.success).toBe(false);
		expect(state.history[0]!.supplies).toEqual({ ammo: 0, medicine: 0, scrap: 0, intel: 0 });
		expect(getSectorIntel(state, "courtyard")).toEqual({ knowledge: 0, pressure: 1 });
		expect(restore(state)).toEqual(state);
		const extracted = checkpoint("intel"), cargo = extracted.raid.expedition!.cargo.supplies.intel;
		expect(getSectorIntel(extracted.state, "courtyard")).toEqual({ knowledge: 0, pressure: 0 });
		extracted.state.supplies.intel = 3;
		const banked = extracted.state.supplies.intel;
		expect(extractRaid(extracted.state, extracted.raid.id, extracted.state.lastUpdated).ok).toBe(true);
		expect(extracted.state.supplies.intel).toBe(banked + cargo);
		expect(extracted.state.history[0]!.strategy!.objective).toBe("intel");
		expect(extracted.state.history[0]!.sectorOutcome).toEqual({ knowledge: 1, pressure: 1 });
		expect(restore(extracted.state)).toEqual(extracted.state);
		const full = checkpoint("intel");
		expect(extractRaid(full.state, full.raid.id, full.state.lastUpdated).ok).toBe(true);
		expect(full.state.history[0]!.supplies.intel).toBe(0);
		expect(getSectorIntel(full.state, "courtyard").knowledge).toBe(1);
	});

	test("a successful recon stage learns only on extraction, including after switching to a different branch", () => {
		const { state, raid } = checkpoint();
		for (const branch of ["recon", "scavenge"] as const) {
			const perk = raid.expedition!.offers[0]!;
			expect(continueExpedition(state, raid.id, branch, perk, state.lastUpdated).ok).toBe(true);
			raid.chance = 1;
			advance(state, raid.endsAt);
			expect(getSectorIntel(state, "courtyard")).toEqual({ knowledge: 0, pressure: 0 });
			expect(raid.expedition!.reconCompleted).toBe(true);
			expect(restore(state)).toEqual(state);
		}
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		expect(getSectorIntel(state, "courtyard")).toEqual({ knowledge: 1, pressure: 2 });
		expect(state.history[0]!.reconCompleted).toBe(true);
		expect(restore(state)).toEqual(state);
	});

	test("sector improvements are capped, pressure is capped, and a different physical sortie cools other sectors once", () => {
		const state = funded();
		state.sectorIntel = { courtyard: { knowledge: 5, pressure: 6 }, forest: { knowledge: 2, pressure: 4 } };
		const scav = state.scavs[0]!, base = getRaidChance(state, scav, MAP_BY_ID.courtyard!);
		expect(getRaidQuote(state, scav, MAP_BY_ID.courtyard!).chance).toBeCloseTo(base - .03);
		expect(setRaidPlan(state, scav.id, "intel", "none").ok).toBe(true);
		expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
		const raid = state.raids[0]!; raid.chance = 1;
		advance(state, raid.endsAt);
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		expect(getSectorIntel(state, "courtyard")).toEqual({ knowledge: 5, pressure: 6 });
		expect(getSectorIntel(state, "forest")).toEqual({ knowledge: 2, pressure: 3 });
		const snapshot = getSectorIntel(state, "forest"); snapshot.pressure = 0;
		expect(getSectorIntel(state, "forest").pressure).toBe(3);
		expect(restore(state)).toEqual(state);
	});

	test("mixed member objectives learn and raise patrol pressure once for the party", () => {
		const state = funded(), ids = state.scavs.slice(0, 2).map(scav => scav.id);
		expect(setRaidPlan(state, ids[0]!, "intel", "scouted").ok).toBe(true);
		expect(setRaidPlan(state, ids[1]!, "scrap", "none").ok).toBe(true);
		expect(dispatchSquadRaid(state, ids, "courtyard", NOW).ok).toBe(true);
		const end = state.raids[0]!.endsAt;
		advance(state, end);
		if (state.raids[0]) expect(extractRaid(state, state.raids[0]!.id, state.lastUpdated).ok).toBe(true);
		expect(getSectorIntel(state, "courtyard").pressure).toBe(1);
		expect(state.history).toHaveLength(2);
		expect(state.history[0]!.sectorOutcome).toEqual(state.history[1]!.sectorOutcome);
		expect(restore(state)).toEqual(state);
	});

	test("v11 active raids keep their paid weapon mechanics and original settlement without retroactive sector progress", () => {
		const original = start().state;
		delete original.scavs[0]!.raidPlan;
		delete original.raids[0]!.strategy;
		const raw = JSON.parse(saveGame(original)); raw.schemaVersion = 11;
		const migrated = parseSave(JSON.stringify(raw));
		expect(migrated).not.toBeNull();
		expect(migrated!.schemaVersion).toBe(SAVE_VERSION);
		expect(migrated!.raids[0]!.strategy).toBeUndefined();
		expect(migrated!.raids[0]!.expedition!.weaponMechanics).toEqual(original.raids[0]!.expedition!.weaponMechanics);
		for (const current of [original, migrated!]) {
			advance(current, current.raids[0]!.endsAt);
			if (current.raids[0]) expect(extractRaid(current, current.raids[0]!.id, current.lastUpdated).ok).toBe(true);
		}
		expect(migrated).toEqual(original);
		expect(getSectorIntel(migrated!, "courtyard")).toEqual({ knowledge: 0, pressure: 0 });
		expect(migrated!.history[0]!.strategy).toBeUndefined();
	});

	test("a slow prepared operation remains within the persisted travel window on deeper stages", () => {
		const { state, raid } = checkpoint("medicine");
		raid.expedition!.baseDuration = 600;
		const perk = raid.expedition!.offers[0]!;
		for (const quote of getExpeditionChoices(state, raid, perk)) expect(quote.duration).toBeLessThanOrEqual(600);
		expect(continueExpedition(state, raid.id, "scavenge", perk, state.lastUpdated).ok).toBe(true);
		expect(raid.endsAt - raid.startedAt).toBeLessThanOrEqual(600_000);
		expect(restore(state)).toEqual(state);
	});
});
