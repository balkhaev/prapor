import { MAPS } from './data';
import { BARTER_OFFERS } from './barter';
import { getMarketFees } from './flea';
import { getRaidLootPool, LOOT_MODEL_BY_ID, getLootTraderPrice, lootAvailableInCatalog } from './loot';
import { BOSS_SAVE_VERSION, getBoss, type BossId } from './bosses';
import { RESOURCE_RECIPES } from './shelter';
import { GEAR_MODEL_BY_ID } from './systems';
import type { ExpeditionBranch } from './systems';

export interface LootHuntOption {
	mapId: string; branch: ExpeditionBranch; depth: number;
	/** Conditional on passing this checkpoint, before capacity trimming and extraction. */
	pickChance: number; checkpointChance: number;
	bossId?: BossId; requiresBossHunt?: true;
}
const hunts = new Map<string, readonly LootHuntOption[]>();
export function getLootHuntOptions(modelId: string, catalogVersion = BOSS_SAVE_VERSION): readonly LootHuntOption[] {
	if (!Object.hasOwn(LOOT_MODEL_BY_ID, modelId) || !Number.isInteger(catalogVersion) || catalogVersion < 16 || catalogVersion > BOSS_SAVE_VERSION || !lootAvailableInCatalog(modelId, catalogVersion)) return [];
	const key = `${catalogVersion}:${modelId}`, cached = hunts.get(key); if (cached) return cached;
	const bossId = LOOT_MODEL_BY_ID[modelId]!.bossId, boss = bossId ? getBoss(bossId) : null;
	if (boss) {
		const options: LootHuntOption[] = [{ mapId: boss.mapId, branch: 'combat', depth: boss.depth, pickChance: 1, checkpointChance: 1, bossId: boss.id, requiresBossHunt: true }];
		hunts.set(key, options); return options;
	}
	const options: LootHuntOption[] = [];
	for (const map of MAPS) for (const depth of [1, 2, 3]) for (const branch of ['scavenge', 'combat', 'recon'] as const) {
		if (depth === 1 && branch !== 'scavenge') continue;
		const pool = getRaidLootPool(map.id, branch, depth, catalogVersion), entry = pool.find(value => value.model.id === modelId);
		if (!entry) continue;
		const pickChance = entry.weight / pool.reduce((sum, value) => sum + value.weight, 0);
		const secondPickChance = (branch === 'scavenge' ? .3 : .15) + (depth - 1) * .12;
		options.push({ mapId: map.id, branch, depth, pickChance, checkpointChance: pickChance + secondPickChance * pickChance * (1 - pickChance) });
	}
	options.sort((a, b) => (Math.abs(b.checkpointChance - a.checkpointChance) > 1e-12 ? b.checkpointChance - a.checkpointChance : 0) || a.depth - b.depth || MAPS.find(value => value.id === a.mapId)!.level - MAPS.find(value => value.id === b.mapId)!.level || a.mapId.localeCompare(b.mapId));
	hunts.set(key, options); return options;
}
/** Whole bundles stay separate from one item's cash price; a market sale needs a buyer. */
export function getLootDecisionProfile(modelId: string) {
	if (!Object.hasOwn(LOOT_MODEL_BY_ID, modelId)) return null;
	const model = LOOT_MODEL_BY_ID[modelId]!, sample = { id: 'loot-1', modelId, foundAt: 0 }, fees = getMarketFees(model.guidePrice);
	const inputValues = (requirements: readonly { modelId: string; quantity: number }[]) => ({
		inputGuideValue: requirements.reduce((sum, need) => sum + LOOT_MODEL_BY_ID[need.modelId]!.guidePrice * need.quantity, 0),
		inputTraderValue: requirements.reduce((sum, need) => sum + getLootTraderPrice({ ...sample, modelId: need.modelId }) * need.quantity, 0),
	});
	return {
		vendorPrice: getLootTraderPrice(sample), marketGuideNet: fees.proceeds - fees.listingFee, salvage: { ...model.salvage },
		barters: BARTER_OFFERS.filter(offer => offer.requirements.some(need => need.modelId === modelId)).map(offer => ({
			offerId: offer.id, gearModelId: offer.gearModelId, ...inputValues(offer.requirements), craftMoney: GEAR_MODEL_BY_ID[offer.gearModelId]!.money, craftScrap: GEAR_MODEL_BY_ID[offer.gearModelId]!.scrap,
		})),
		recipes: RESOURCE_RECIPES.filter(recipe => recipe.lootRequirements?.some(need => need.modelId === modelId)).map(recipe => ({
			recipeId: recipe.id, ...inputValues(recipe.lootRequirements!), money: recipe.cost.money, durationSeconds: recipe.durationSeconds,
			output: { ...recipe.output }, ...(recipe.outputKit ? { outputKit: recipe.outputKit } : {}), roomType: recipe.roomType, minLevel: recipe.minLevel ?? 1,
		})),
	};
}
