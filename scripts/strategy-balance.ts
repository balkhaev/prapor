import { MAP_BY_ID, type Supplies } from "../src/game/data";
import {
	advance, continueExpedition, createGame, dispatchRaid, extractRaid,
	getExpeditionChoices, getRaidQuote, setRaidPlan, type ActionResult,
} from "../src/game/engine";

// Compare equal departures, including failed exits, with the same seeds in every row.
// Cash stays above the recovery allowance; delivered supplies come from reports,
// never from passive production or speculative checkpoint cargo.
const NOW = 1_792_000_000_000;
const requested = Number(Bun.argv[2]);
const samples = Number.isFinite(requested) && requested > 0 ? Math.max(80, Math.min(150, Math.floor(requested))) : 120;
const objectives = ["general", "ammo", "medicine", "scrap", "intel"] as const;
const preparations = ["none", "scouted"] as const;
const supplyKeys = ["ammo", "medicine", "scrap", "intel"] as const;
const blankSupplies = (): Supplies => ({ ammo: 0, medicine: 0, scrap: 0, intel: 0 });
const round = (value: number) => Math.round(value * 100) / 100;
const requireAction = (result: ActionResult) => { if (!result.ok) throw new Error(result.message); };
const rows = [];

for (const depth of [1, 2]) for (const preparation of preparations) for (const objective of objectives) {
	let extracted = 0, returned = 0, cash = 0, moduleCount = 0, seconds = 0, reachedDepth = 0;
	const delivered = blankSupplies(), paid = { money: 0, ...blankSupplies() }, firstPaid = { money: 0, ...blankSupplies() };
	for (let seed = 1; seed <= samples; seed++) {
		const state = createGame(NOW);
		state.rng = Math.imul(seed, 0x9e3779b1) >>> 0 || 1;
		state.money = 10_000;
		state.supplies = { ammo: 24, medicine: 2, scrap: 0, intel: 4 };
		const scav = state.scavs[0]!, moneyBefore = state.money;
		requireAction(setRaidPlan(state, scav.id, objective, preparation));
		const first = getRaidQuote(state, scav, MAP_BY_ID.courtyard!);
		if (first.reason) throw new Error(`Unfunded departure: ${first.reason}`);
		const before = { money: state.money, ...state.supplies };
		requireAction(dispatchRaid(state, scav.id, "courtyard", NOW));
		for (const key of ["money", "ammo", "medicine", "intel"] as const) {
			const charged = before[key] - (key === "money" ? state.money : state.supplies[key]);
			if (charged !== first[key]) throw new Error(`Departure ${key}: charged ${charged}, quoted ${first[key]}`);
			paid[key] += charged;
			firstPaid[key] += charged;
		}
		for (let guard = 0; state.raids.length && guard < 3; guard++) {
			const raid = state.raids[0]!;
			advance(state, raid.endsAt);
			if (!state.raids.length) break;
			if (raid.expedition?.status !== "choice") throw new Error("Missing real checkpoint");
			if (raid.expedition.stage >= depth) requireAction(extractRaid(state, raid.id, state.lastUpdated));
			else {
				const perk = raid.expedition.offers[0]!;
				const next = getExpeditionChoices(state, raid, perk).find((choice) => choice.branch === "scavenge")!;
				if (next.reason) throw new Error(`Unfunded continuation: ${next.reason}`);
				const beforeNext = { money: state.money, ...state.supplies };
				requireAction(continueExpedition(state, raid.id, "scavenge", perk, state.lastUpdated));
				for (const key of ["money", "ammo", "intel"] as const) {
					const charged = beforeNext[key] - (key === "money" ? state.money : state.supplies[key]);
					if (charged !== next[key]) throw new Error(`Continuation ${key}: charged ${charged}, quoted ${next[key]}`);
					paid[key] += charged;
				}
			}
		}
		const report = state.history[0];
		if (state.raids.length || !report) throw new Error("Exit did not terminate");
		extracted += Number(report.success);
		returned += Number(!report.lostScav);
		cash += state.money - moneyBefore;
		seconds += (state.lastUpdated - NOW) / 1_000;
		reachedDepth += report.depth;
		moduleCount += report.moduleIds.length;
		for (const key of supplyKeys) delivered[key] += report.supplies[key];
	}
	rows.push({ objective, preparation, targetDepth: depth,
		extractedPct: round(extracted * 100 / samples), fighterReturnedPct: round(returned * 100 / samples),
		averageSettledDepth: round(reachedDepth / samples), averageSeconds: round(seconds / samples),
		firstCost: Object.fromEntries(Object.entries(firstPaid).map(([key, value]) => [key, round(value / samples)])),
		allStageCost: Object.fromEntries(Object.entries(paid).map(([key, value]) => [key, round(value / samples)])),
		cashAfterFees: round(cash / samples), modulesDelivered: round(moduleCount / samples),
		targetDelivered: objective === "general" ? null : round(delivered[objective] / samples),
		deliveredSupplies: Object.fromEntries(supplyKeys.map((key) => [key, round(delivered[key] / samples)])),
		netDeliveredAfterFees: Object.fromEntries(supplyKeys.map((key) => [key, round((delivered[key] - paid[key]) / samples)])),
	});
}

console.log(JSON.stringify({ samples, sector: "courtyard", tactic: "balanced", weapon: "factory sks", branchAfterFirst: "scavenge",
	conditions: `Every row starts fresh with the same ${samples} deterministic seeds, 100% health and weapon condition, no equipped armor/backpack, 10000 cash, ammo24/medicine2/scrap0/intel4 and neutral sector knowledge/pressure. Perks use the first genuinely offered option. All failed exits count as zero delivered loot. Costs are checked against actual deductions; cash excludes repair/replacement and resale. Supply net means real delivered supplies minus departure/continuation fees; it excludes passive production. Cargo weight and stash capacity remain active.`,
	rows }, null, 2));
