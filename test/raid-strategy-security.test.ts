import { describe, expect, test } from "bun:test";
import {
	advance, continueExpedition, createGame, dispatchRaid, dispatchSquadRaid,
	extractRaid, getExpeditionChoices, getRaidPlan, getRaidQuote, getSectorIntel, getSquadRaidQuote,
	parseSave, saveGame, setRaidPlan, type ActionResult, type GameState,
} from "../src/game/engine";
import { MAP_BY_ID } from "../src/game/data";

const NOW = 1_792_000_000_000;
const requireAction = (result: ActionResult) => expect(result.ok, result.message).toBe(true);
function funded(seed = 1): GameState {
	const state = createGame(NOW);
	state.rng = Math.imul(seed, 0x9e3779b1) >>> 0 || 1;
	state.money = 10_000;
	state.supplies = { ammo: 100, medicine: 4, scrap: 0, intel: 100 };
	return state;
}
function restore(state: GameState): GameState {
	const restored = parseSave(saveGame(state));
	expect(restored).not.toBeNull();
	return restored!;
}
function checkpoint(partySize = 1, wanted: "success" | "failure" = "success") {
	for (let seed = 1; seed <= 128; seed++) {
		const state = funded(seed), scavIds = state.scavs.slice(0, partySize).map((scav) => scav.id);
		for (const scavId of scavIds) requireAction(setRaidPlan(state, scavId, "intel", "scouted"));
		requireAction(partySize === 1 ? dispatchRaid(state, scavIds[0]!, "courtyard", NOW)
			: dispatchSquadRaid(state, scavIds, "courtyard", NOW));
		const departure = restore(state);
		advance(state, state.raids[0]!.endsAt);
		if (wanted === "success" && state.raids.length === partySize && state.raids.every((raid) => raid.expedition?.status === "choice") && getExpeditionChoices(state, state.raids[0]!, state.raids[0]!.expedition!.offers[0]).every(choice => !choice.reason))
			return { state, departure, scavIds };
		if (wanted === "failure" && !state.raids.length && state.history.some((report) => !report.success))
			return { state, departure, scavIds };
	}
	throw new Error(`No genuine ${wanted} checkpoint found`);
}
function advanceIrregularly(state: GameState, until: number) {
	const steps = [719, 5_991, 41, 2_301, 11_003];
	for (let index = 0; state.lastUpdated < until; index++)
		advance(state, Math.min(until, state.lastUpdated + steps[index % steps.length]!));
}

describe("raid strategy security and event ownership", () => {
	test("invalid orders fail without changing funds, random state or stored plans", () => {
		const state = funded(), scav = state.scavs[0]!;
		for (const [objective, preparation] of [["toString", "none"], ["__proto__", "none"], ["general", "toString"], ["general", "__proto__"], ["ammo", "prepared"]]) {
			const before = saveGame(state);
			expect(setRaidPlan(state, scav.id, objective as "general", preparation as "none").ok).toBe(false);
			expect(saveGame(state)).toBe(before);
		}
		const before = saveGame(state);
		expect(setRaidPlan(state, "missing", "intel", "scouted").ok).toBe(false);
		expect(saveGame(state)).toBe(before);
	});

	test("plans and sector previews are pure; config changes never rewrite a paid raid", () => {
		const state = funded(), scav = state.scavs[0]!;
		requireAction(setRaidPlan(state, scav.id, "medicine", "scouted"));
		const before = saveGame(state), quote = getRaidQuote(state, scav, MAP_BY_ID.courtyard!);
		for (let index = 0; index < 10; index++) {
			expect(getRaidPlan(scav)).toEqual({ objective: "medicine", preparation: "scouted" });
			expect(getSectorIntel(state, "courtyard")).toEqual({ knowledge: 0, pressure: 0 });
			expect(getRaidQuote(state, scav, MAP_BY_ID.courtyard!)).toEqual(quote);
		}
		expect(saveGame(state)).toBe(before);
		requireAction(dispatchRaid(state, scav.id, "courtyard", NOW));
		const raid = state.raids[0]!, snapshot = structuredClone(raid.strategy);
		requireAction(setRaidPlan(state, scav.id, "ammo", "none"));
		expect(raid.strategy).toEqual(snapshot);
		expect(restore(state).raids[0]!.strategy).toEqual(snapshot);
	});

	test("each prepared squad member pays exactly once and every paid snapshot survives import", () => {
		const state = funded(), ids = state.scavs.map((scav) => scav.id);
		for (const id of ids) requireAction(setRaidPlan(state, id, "intel", "scouted"));
		const quote = getSquadRaidQuote(state, ids, "courtyard"), before = { money: state.money, ...state.supplies };
		expect(quote.reason).toBeNull();
		requireAction(dispatchSquadRaid(state, ids, "courtyard", NOW));
		expect(state.money).toBe(before.money - quote.money);
		for (const key of ["ammo", "intel", "medicine"] as const) expect(state.supplies[key]).toBe(before[key] - quote[key]);
		expect(state.raids.map((raid) => raid.strategy)).toEqual(ids.map(() => ({ objective: "intel", preparation: "scouted", knowledge: 0, pressure: 0 })));
		expect(restore(state)).toEqual(state);
		const paid = saveGame(state);
		expect(dispatchSquadRaid(state, ids, "courtyard", NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(paid);
	});

	test("individual and squad settlement are identical across whole and irregular restored clocks", () => {
		for (const partySize of [1, 3]) {
			const { departure } = checkpoint(partySize);
			const whole = restore(departure), fine = restore(departure), until = whole.raids[0]!.endsAt;
			advance(whole, until);
			advanceIrregularly(fine, until);
			expect(fine).toEqual(whole);
			const raid = whole.raids[0]!, perk = raid.expedition!.offers[0]!;
			for (const current of [whole, fine]) requireAction(continueExpedition(current, current.raids[0]!.id, "recon", perk, current.lastUpdated));
			const finalAt = whole.raids[0]!.endsAt;
			advance(whole, finalAt); advanceIrregularly(fine, finalAt);
			for (const current of [whole, fine]) if (current.raids[0]) requireAction(extractRaid(current, current.raids[0]!.id, current.lastUpdated));
			expect(fine).toEqual(whole);
			expect(restore(whole)).toEqual(whole);
		}
	});

	test("a physical squad increases sector pressure once on extraction or disruption and reloading never credits it twice", () => {
		for (const wanted of ["success", "failure"] as const) {
			const { state } = checkpoint(3, wanted);
			if (wanted === "success") {
				expect(getSectorIntel(state, "courtyard").pressure).toBe(0);
				requireAction(extractRaid(state, state.raids[0]!.id, state.lastUpdated));
			}
			expect(getSectorIntel(state, "courtyard").pressure).toBe(1);
			const before = getSectorIntel(state, "courtyard"), reloaded = restore(state);
			advance(reloaded, reloaded.lastUpdated + 60_000);
			expect(getSectorIntel(reloaded, "courtyard")).toEqual(before);
		}
	});

	test("strict imports reject invented strategy advantages, malformed sector values and unknown fields", () => {
		const state = funded(), scav = state.scavs[0]!;
		requireAction(setRaidPlan(state, scav.id, "intel", "scouted"));
		requireAction(dispatchRaid(state, scav.id, "courtyard", NOW));
		const raw = JSON.parse(saveGame(state));
		for (const change of [
			(value: any) => { value.scavs[0].raidPlan.objective = "toString"; },
			(value: any) => { value.scavs[0].raidPlan.preparation = "__proto__"; },
			(value: any) => { value.scavs[0].raidPlan.freeLoot = true; },
			(value: any) => { value.raids[0].strategy.objective = "toString"; },
			(value: any) => { value.raids[0].strategy.preparation = "__proto__"; },
			(value: any) => { value.raids[0].strategy.knowledge = 6; },
			(value: any) => { value.raids[0].strategy.knowledge = 1.1; },
			(value: any) => { value.raids[0].strategy.pressure = -1; },
			(value: any) => { value.raids[0].strategy.pressure = 7; },
			(value: any) => { value.raids[0].strategy.freeLoot = true; },
			(value: any) => { value.sectorIntel = { courtyard: { knowledge: 0, pressure: 7 } }; },
			(value: any) => { value.sectorIntel = { courtyard: { knowledge: "5", pressure: 0 } }; },
			(value: any) => { value.sectorIntel = { missing: { knowledge: 0, pressure: 0 } }; },
			(value: any) => { value.sectorIntel = { courtyard: { knowledge: 0, pressure: 0, freeLoot: true } }; },
		]) {
			const changed = structuredClone(raw); change(changed);
			expect(parseSave(JSON.stringify(changed))).toBeNull();
		}
		expect(restore(state)).toEqual(state);
	});

	test("retained reports validate paid strategy snapshots and bounded sector results", () => {
		const { state } = checkpoint();
		requireAction(extractRaid(state, state.raids[0]!.id, state.lastUpdated));
		const raw = JSON.parse(saveGame(state));
		for (const change of [
			(value: any) => { value.history[0].strategy.objective = "__proto__"; },
			(value: any) => { value.history[0].strategy.preparation = "free"; },
			(value: any) => { value.history[0].strategy.knowledge = 6; },
			(value: any) => { value.history[0].sectorOutcome.pressure = 6.1; },
			(value: any) => { value.history[0].sectorOutcome.knowledge = -1; },
			(value: any) => { value.history[0].sectorOutcome.extra = true; },
		]) {
			const changed = structuredClone(raw); change(changed);
			expect(parseSave(JSON.stringify(changed))).toBeNull();
		}
		expect(restore(state)).toEqual(state);
	});
});
