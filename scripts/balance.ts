import {
	advance, continueExpedition, craftGear, createGame, dispatchRaid, equipGear,
	extractRaid, getGearModel, getGearRepairCost, getRepairCost,
	getWeaponDefinition, getWeaponSaleValue, type GameState,
} from "../src/game/engine";
import type { ExpeditionBranch } from "../src/game/systems";

// Controlled comparisons use the same seeds, fresh fighters and unlimited cash.
// Cash above the recovery allowance produces no passive income during a run.
const NOW = 1_792_000_000_000;
const samples = Math.max(20, Math.min(5_000, Number(Bun.argv[2]) || 300));
const builds = [
	{ label: "Без комплекта", items: [] },
	{ label: "Лёгкий", items: ["light_vest", "scout_pack"] },
	{ label: "Тяжёлый", items: ["plate_armor", "cargo_pack"] },
];
const rows: Record<string, string | number>[] = [];

function recoveryCost(state: GameState, originalWeapon: GameState["weapons"][number], initialGear: GameState["gearItems"]) {
	const weapon = state.weapons.find((item) => item.id === originalWeapon.id);
	const weaponCost = weapon ? getRepairCost(weapon) : { money: getWeaponDefinition(originalWeapon).value, scrap: 0 };
	let value = weaponCost.money + weaponCost.scrap * 14.5;
	for (const old of initialGear) {
		const item = state.gearItems.find((entry) => entry.id === old.id);
		const cost = item ? getGearRepairCost(item) : getGearModel(old);
		value += cost.money + cost.scrap * 14.5;
	}
	return value;
}

for (const build of builds) for (const branch of ["scavenge", "combat", "recon"] as ExpeditionBranch[]) for (const depth of [1, 2, 3]) {
	let successes = 0, cash = 0, repairs = 0, newGuns = 0, trophyValue = 0, reachedDepth = 0;
	for (let index = 0; index < samples; index++) {
		const state = createGame(NOW);
		state.rng = Math.imul(index + 1, 0x9e3779b1) >>> 0 || 1;
		state.money = 50_000;
		state.supplies.scrap = 40;
		state.blueprints.push("plate_armor", "cargo_pack");
		const scav = state.scavs[0]!;
		for (const modelId of build.items) {
			const crafted = craftGear(state, modelId);
			if (!crafted.ok) throw new Error(crafted.message);
			const item = state.gearItems.at(-1)!;
			const equipped = equipGear(state, scav.id, getGearModel(item).slot, item.id);
			if (!equipped.ok) throw new Error(equipped.message);
		}
		const originalWeapon = structuredClone(state.weapons.find((item) => item.id === scav.weaponInstanceId)!);
		const initialGear = structuredClone(state.gearItems);
		const initialIds = new Set(state.weapons.map((item) => item.id));
		const initialMoney = state.money;
		const started = dispatchRaid(state, scav.id, "courtyard", NOW);
		if (!started.ok) throw new Error(started.message);
		let cursor = NOW;
		for (let guard = 0; state.raids.length && guard < 4; guard++) {
			const raid = state.raids[0]!;
			cursor = Math.max(cursor, raid.endsAt);
			advance(state, cursor);
			const waiting = state.raids[0];
			if (!waiting) break;
			if (waiting.expedition?.status !== "choice") throw new Error("Checkpoint did not resolve");
			if (waiting.expedition.stage >= depth) {
				const result = extractRaid(state, waiting.id, cursor);
				if (!result.ok) throw new Error(result.message);
			} else {
				const result = continueExpedition(state, waiting.id, branch, waiting.expedition.offers[0]!, cursor);
				if (!result.ok) {
					const evacuation = extractRaid(state, waiting.id, cursor);
					if (!evacuation.ok) throw new Error(evacuation.message);
				}
			}
		}
		if (state.raids.length || !state.history[0]) throw new Error("Expedition failed to terminate");
		const report = state.history[0]!;
		successes += Number(report.success);
		cash += state.money - initialMoney;
		repairs += recoveryCost(state, originalWeapon, initialGear);
		const trophies = state.weapons.filter((item) => !initialIds.has(item.id));
		newGuns += trophies.length;
		trophyValue += trophies.reduce((sum, item) => sum + getWeaponSaleValue(item), 0);
		reachedDepth += report.depth;
	}
	rows.push({
		build: build.label, branch, targetDepth: depth,
		evacuatedPct: Math.round(successes * 1000 / samples) / 10,
		averageDepth: Math.round(reachedDepth * 100 / samples) / 100,
		cashAfterFees: Math.round(cash / samples),
		recoveryCost: Math.round(repairs / samples),
		trophyResale: Math.round(trophyValue / samples),
		netAfterRecovery: Math.round((cash + trophyValue - repairs) / samples),
		trophiesPerRun: Math.round(newGuns * 100 / samples) / 100,
	});
}
console.log(JSON.stringify({ samples, sector: "courtyard", tactic: "balanced", weapon: "sks", rows }, null, 2));
