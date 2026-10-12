import { MAP_BY_ID } from "../src/game/data";
import {
	advance, continueExpedition, craftGear, craftModule, createGame, dispatchRaid,
	equipGear, extractRaid, getModuleSaleValue, getRaidQuote, getRepairCost,
	getWeaponSaleValue, getWeaponStats, installModule, MODULE_BY_ID,
} from "../src/game/engine";

const NOW = 1_792_000_000_000;
const samples = Math.max(20, Math.min(5_000, Number(Bun.argv[2]) || 300));
const builds = [
	{ label: "Штатная СКС", parts: [] },
	{ label: "Лёгкая СКС", parts: ["barrel-sks-7.62x39-short", "handguard-sks-light", "stock-sks-folding", "magazine-sks-7.62x39-quick"] },
	{ label: "Устойчивая СКС", parts: ["barrel-sks-7.62x39-long", "handguard-sks-rail", "stock-sks-tactical", "magazine-sks-7.62x39-extended", "optic-scope", "foregrip-vertical", "muzzle-7.62x39-brake"] },
];
const rows: Record<string, unknown>[] = [];

for (const build of builds) for (const branch of ["scavenge", "combat", "recon"] as const) for (const depth of [1, 2, 3]) {
	let survived = 0, cash = 0, salvage = 0, restoration = 0, modules = 0, guns = 0;
	let initialStats: ReturnType<typeof getWeaponStats> | undefined;
	let initialQuote: ReturnType<typeof getRaidQuote> | undefined;
	for (let seed = 1; seed <= samples; seed++) {
		const state = createGame(NOW);
		state.rng = Math.imul(seed, 0x9e3779b1) >>> 0 || 1;
		state.money = 50_000;
		state.supplies.scrap = 1_000;
		state.base.workshop = 5;
		const gun = state.weapons[0]!, scav = state.scavs[0]!;
		for (const modelId of build.parts) {
			const made = craftModule(state, modelId);
			if (!made.ok) throw new Error(made.message);
			const installed = installModule(state, gun.id, state.modules.at(-1)!.id);
			if (!installed.ok) throw new Error(installed.message);
		}
		craftGear(state, "scout_pack");
		equipGear(state, scav.id, "backpack", state.gearItems.at(-1)!.id);
		initialStats = getWeaponStats(gun);
		initialQuote = getRaidQuote(state, scav, MAP_BY_ID.courtyard!);
		const existingGunIds = new Set(state.weapons.map((item) => item.id));
		const existingModuleIds = new Set(state.modules.map((item) => item.id));
		const replacementCost = Object.values(gun.modules).reduce((sum, part) => {
			const cost = MODULE_BY_ID[part.modelId]!.craftCost;
			return sum + cost.money + cost.scrap * 14.5;
		}, 0);
		const moneyBefore = state.money;
		const dispatched = dispatchRaid(state, scav.id, "courtyard", NOW);
		if (!dispatched.ok) throw new Error(dispatched.message);
		for (let guard = 0; state.raids.length && guard < 4; guard++) {
			const raid = state.raids[0]!;
			advance(state, raid.endsAt);
			if (!state.raids.length) break;
			if (raid.expedition?.status !== "choice") throw new Error("Missing checkpoint");
			if (raid.expedition.stage >= depth) extractRaid(state, raid.id, state.lastUpdated);
			else if (!continueExpedition(state, raid.id, branch, raid.expedition.offers[0]!, state.lastUpdated).ok)
				extractRaid(state, raid.id, state.lastUpdated);
		}
		const report = state.history[0]!;
		if (state.raids.length || !report) throw new Error("Run did not finish");
		survived += Number(report.success);
		cash += state.money - moneyBefore;
		const foundParts = state.modules.filter((item) => !existingModuleIds.has(item.id));
		const foundGuns = state.weapons.filter((item) => !existingGunIds.has(item.id));
		modules += foundParts.length; guns += foundGuns.length;
		salvage += foundParts.reduce((sum, item) => sum + getModuleSaleValue(item), 0)
			+ foundGuns.reduce((sum, item) => sum + getWeaponSaleValue(item), 0);
		if (state.weapons.includes(gun)) {
			const cost = getRepairCost(gun);
			restoration += cost.money + cost.scrap * 14.5;
		} else restoration += replacementCost;
	}
	rows.push({ build: build.label, branch, depth, stats: initialStats, firstQuote: initialQuote,
		upgradePurchase: build.parts.reduce((sum, modelId) => { const cost = MODULE_BY_ID[modelId]!.craftCost; return sum + cost.money + cost.scrap * 14.5; }, 0),
		evacuatedPct: Math.round(survived * 1000 / samples) / 10,
		cashAfterFees: Math.round(cash / samples), salvageResale: Math.round(salvage / samples),
		weaponRestoration: Math.round(restoration / samples),
		netAfterWeaponRestoration: Math.round((cash + salvage - restoration) / samples),
		modulesPerRun: Math.round(modules * 100 / samples) / 100, gunsPerRun: Math.round(guns * 100 / samples) / 100 });
}
console.log(JSON.stringify({ samples, sector: "courtyard", armor: "none", backpack: "scout_pack", tactic: "balanced", rows }, null, 2));
