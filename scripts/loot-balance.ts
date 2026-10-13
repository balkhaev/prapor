import { MAP_BY_ID, type Rarity } from "../src/game/data";
import {
	advance, continueExpedition, createGame, dispatchRaid, extractRaid, craftGear, equipGear,
	getExpeditionChoices, getRaidGearValue, setRaidPlan, xpForLevel, type ActionResult,
} from "../src/game/engine";
import { LOOT_MODELS, getLootModel, getLootTraderPrice, getRaidLootPool } from "../src/game/loot";
import { getMarketFees } from "../src/game/flea";
import { getLootDecisionProfile, getLootHuntOptions } from "../src/game/loot-value";
import { BOSSES } from "../src/game/bosses";

const NOW = 1_792_000_000_000;
const requested = Number(Bun.argv[2]);
const samples = Number.isFinite(requested) && requested > 0 ? Math.max(80, Math.min(300, Math.floor(requested))) : 120;
const round = (value: number) => Math.round(value * 100) / 100;
const requireAction = (result: ActionResult) => { if (!result.ok) throw new Error(result.message); };
const rows = [];

// Count all departures, including zero delivery on failure. The guide and its
// hypothetical sale are separate from real banked cash and guaranteed vendor money.
for (const sector of ["courtyard", "depot", "factory", "bunker"]) {
	if (!MAP_BY_ID[sector]) throw new Error(`Unknown sector ${sector}`);
	for (const branch of ["scavenge", "combat", "recon"] as const) for (const targetDepth of [1, 3]) for (const backpack of ["none", "cargo_pack"]) {
		let extracted = 0, deliveredCount = 0, deliveredWeight = 0, guide = 0, vendor = 0, hypotheticalNet = 0, cash = 0, settledDepth = 0, junkCount = 0, junkCash = 0, gearCount = 0, gearGuide = 0, moduleCount = 0;
		const rarities: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
		const models = new Set<string>();
		for (let seed = 1; seed <= samples; seed++) {
			const state = createGame(NOW), scav = state.scavs[0]!;
			state.level = 9; state.xp = xpForLevel(9); state.money = 20_000;
			state.supplies = { ammo: 72, medicine: 0, scrap: 12, intel: 12 };
			if (backpack !== "none") {
				state.blueprints.push("cargo_pack");
				requireAction(craftGear(state, backpack));
				const pack = state.gearItems.find(item => item.modelId === backpack)!;
				requireAction(equipGear(state, scav.id, "backpack", pack.id));
			}
			state.supplies.scrap = 0;
			state.rng = Math.imul(seed, 0x9e3779b1) >>> 0 || 1;
			const beforeMoney = state.money;
			const initialModuleIds = new Set(state.modules.map(item => item.id));
			requireAction(dispatchRaid(state, scav.id, sector, NOW));
			for (let guard = 0; state.raids.length && guard < 4; guard++) {
				const raid = state.raids[0]!;
				advance(state, raid.endsAt);
				if (!state.raids.length) break;
				if (raid.expedition?.status !== "choice") throw new Error("Missing actual checkpoint");
				if (raid.expedition.stage >= targetDepth) requireAction(extractRaid(state, raid.id, state.lastUpdated));
				else {
					const perk = raid.expedition.offers[0]!, choice = getExpeditionChoices(state, raid, perk).find(item => item.branch === branch)!;
					if (choice.reason) requireAction(extractRaid(state, raid.id, state.lastUpdated));
					else requireAction(continueExpedition(state, raid.id, branch, perk, state.lastUpdated));
				}
			}
			const report = state.history[0];
			if (!report || state.raids.length) throw new Error("Unsettled sortie");
			extracted += Number(report.success); settledDepth += report.depth; cash += state.money - beforeMoney;
			gearCount += report.gearItems?.length ?? 0;
			gearGuide += (report.gearItems ?? []).reduce((sum, item) => sum + getRaidGearValue(item), 0);
			moduleCount += state.modules.filter(item => !initialModuleIds.has(item.id)).length;
			for (const item of report.lootItems ?? []) {
				const model = getLootModel(item), fees = getMarketFees(model.guidePrice);
				deliveredCount++; deliveredWeight += model.weight; guide += model.guidePrice; vendor += getLootTraderPrice(item);
				hypotheticalNet += fees.proceeds - fees.listingFee; rarities[model.rarity]++; models.add(model.id);
			}
			for (const sale of report.lootAutoSold ?? []) {
				if (!getLootModel(sale.item).autoSell) throw new Error("Useful trophy sold without player choice");
				junkCount++; junkCash += sale.money;
			}
		}
		rows.push({ sector, branchAfterFirst: branch, targetDepth, backpack, extractedPct: round(extracted * 100 / samples),
			averageSettledDepth: round(settledDepth / samples), cashAfterRaidFees: round(cash / samples),
			junkAutomaticallySold: round(junkCount / samples), junkCashIncludedInRaidCash: round(junkCash / samples),
			gearDelivered: round(gearCount / samples), gearGuideValueDelivered: round(gearGuide / samples), physicalModulesDelivered: round(moduleCount / samples),
			namedItemsDelivered: round(deliveredCount / samples), namedWeightDelivered: round(deliveredWeight / samples),
			guideValueDelivered: round(guide / samples), guaranteedVendorValue: round(vendor / samples),
			hypotheticalMarketNetAtGuide: round(hypotheticalNet / samples), distinctModels: models.size,
			rarityDelivered: Object.fromEntries(Object.entries(rarities).map(([key, value]) => [key, round(value / samples)])) });
	}
}

const bossRows = [];
for (const boss of BOSSES) for (const preparation of ['bare', 'armored-and-scouted'] as const) {
	let fought = 0, victories = 0, deliveredTrophies = 0, chanceSum = 0;
	for (let seed = 1; seed <= samples; seed++) {
		const state = createGame(NOW), scav = state.scavs[0]!;
		state.level = 9; state.xp = xpForLevel(9); state.money = 20_000;
		state.supplies = { ammo: 72, medicine: 8, scrap: 40, intel: 12 };
		if (preparation === 'armored-and-scouted') {
			for (const model of ['plate_armor', 'cargo_pack']) {
				if (!state.blueprints.includes(model)) state.blueprints.push(model);
				requireAction(craftGear(state, model));
				const item = state.gearItems.find(item => item.modelId === model)!;
				requireAction(equipGear(state, scav.id, model === 'plate_armor' ? 'armor' : 'backpack', item.id));
			}
		}
		state.supplies.scrap = 0; state.rng = Math.imul(seed, 0x9e3779b1) >>> 0 || 1;
		requireAction(setRaidPlan(state, scav.id, 'boss', preparation === 'bare' ? 'none' : 'scouted'));
		requireAction(dispatchRaid(state, scav.id, boss.mapId, NOW));
		for (let guard = 0; state.raids.length && guard < 4; guard++) {
			const raid = state.raids[0]!;
			advance(state, raid.endsAt);
			if (!state.raids.length) break;
			if (raid.expedition!.stage >= boss.depth) requireAction(extractRaid(state, raid.id, state.lastUpdated));
			else {
				const perk = raid.expedition!.offers[0]!, choice = getExpeditionChoices(state, raid, perk).find(choice => choice.branch === 'combat')!;
				if (choice.reason) requireAction(extractRaid(state, raid.id, state.lastUpdated));
				else {
					if (choice.boss) { fought++; chanceSum += choice.chance; }
					requireAction(continueExpedition(state, raid.id, 'combat', perk, state.lastUpdated));
				}
			}
		}
		const report = state.history[0]!;
		victories += Number(report.bossEncounter?.defeated ?? false);
		deliveredTrophies += Number(report.lootItems?.some(item => item.modelId === boss.trophyModelId) ?? false);
	}
	bossRows.push({ boss: boss.id, preparation, attemptedBossFights: fought, averagePaidFightChancePct: fought ? round(chanceSum * 100 / fought) : null,
		victoriesPerDeparturePct: round(victories * 100 / samples), trophyDeliveredPerDeparturePct: round(deliveredTrophies * 100 / samples) });
}

console.log(JSON.stringify({ samples,
	bossConditions: 'Same fresh Boroda/SKS and seeds. Bare pack versus actually crafted plate armor/cargo frame plus paid scouted approach. Boss goal is explicitly selected, combat branches lead to the required depth and extraction immediately follows a passed target stage. Paid chances count only actual affordable boss fights; victories and delivered trophies divide by all departures, including approach failures, early retreat, injuries and cargo trimming. No bonus reward or guaranteed victory is injected.',
	conditions: "Fresh Boroda/SKS, 100% health and condition, balanced tactic, no armor/support kit, neutral sector, reputation9 only to open all sectors. Ordinary small bag or actually crafted/equipped cargo frame. Each condition uses the same seeds; the first genuinely offered perk is selected. Money stays above passive allowance; no production runs. Failures deliver zero loot. Named trophies, actual gear and free modules count separately after bag trimming; stash is empty. Gear found in this run is not equipped automatically. Repairs, hiring, weapon/module value and sale of gear or supplies are excluded from cash and named trophy proceeds. Guide price is not a measured market price; hypothetical net assumes every separate named trophy gets a real buyer at its guide, deducting both fees. No simulated buyer or actual flea trade is performed.",
	catalog: LOOT_MODELS.map(model => ({ model: model.id, label: model.label, rarity: model.rarity, weight: model.weight,
		guide: model.guidePrice, disposition: model.autoSell ? "junk-auto-sale" : "useful-player-choice", guaranteedVendor: getLootTraderPrice({ id: "loot-1", modelId: model.id, foundAt: NOW }),
		guidePerWeight: round(model.guidePrice / model.weight), salvage: model.salvage, minDepth: model.minDepth, minSectorLevel: model.minSectorLevel,
		availablePools: Object.keys(MAP_BY_ID).flatMap(map => [1, 2, 3].filter(depth => getRaidLootPool(map, "scavenge", depth).some(entry => entry.model.id === model.id)).map(depth => `${map}:${depth}`)) })),
	huntTargets: LOOT_MODELS.filter(model => ['rare', 'epic', 'legendary'].includes(model.rarity)).map(model => ({
		model: model.id, label: model.label,
		bestCurrent: getLootHuntOptions(model.id).slice(0, 3), bestPaidV24: getLootHuntOptions(model.id, 24)[0],
		valueChoices: getLootDecisionProfile(model.id),
	})),
	rows, bossRows }, null, 2));
