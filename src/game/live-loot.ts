import type { EconomyLoot } from '../../server/live-economy';
import { LOOT_MODEL_BY_ID, getLootTraderPrice, type LootCategory } from './loot';
import { MODULE_BY_ID } from './modules';
import { GEAR_MODEL_BY_ID } from './systems';
import type { Rarity } from './data';

export interface LiveLootDefinition {
  kind: 'loot' | 'gear' | 'module'; modelId: string; label: string; description: string;
  weight: number; guidePrice: number; traderPrice: number | null; rarity: Rarity;
  category: LootCategory | 'gear' | 'module'; condition: number | null; autoSell: boolean;
}
/** Source UUIDs belong to the live world, independently of headquarters inventory IDs. */
export function readEconomyLoot(value: unknown): EconomyLoot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('live-loot-object');
  const item = value as Record<string, unknown>, physical = item.kind === 'gear' || item.kind === 'module';
  const keys = physical ? ['id', 'modelId', 'foundAt', 'kind', 'durability'] : ['id', 'modelId', 'foundAt', ...(Object.hasOwn(item, 'kind') ? ['kind'] : [])];
  if (Object.keys(item).length !== keys.length || Object.keys(item).some(key => !keys.includes(key))
    || typeof item.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(item.id)
    || typeof item.modelId !== 'string' || typeof item.foundAt !== 'number' || !Number.isInteger(item.foundAt) || item.foundAt < 0 || item.foundAt > 1e15) throw new Error('live-loot-item');
  const base = { id: item.id, modelId: item.modelId, foundAt: item.foundAt };
  if (physical) {
    if (typeof item.durability !== 'number' || !Number.isInteger(item.durability) || item.durability < 1 || item.durability > 100
      || !Object.hasOwn(item.kind === 'gear' ? GEAR_MODEL_BY_ID : MODULE_BY_ID, item.modelId)) throw new Error('live-loot-model');
    return { ...base, kind: item.kind as 'gear' | 'module', durability: item.durability };
  }
  if (!(item.kind === undefined || item.kind === 'loot') || !Object.hasOwn(LOOT_MODEL_BY_ID, item.modelId)) throw new Error('live-loot-model');
  return { ...base, ...(item.kind === 'loot' ? { kind: 'loot' as const } : {}) };
}
export function getLiveLootDefinition(item: EconomyLoot): LiveLootDefinition {
  if (item.kind === 'gear') {
    const model = Object.hasOwn(GEAR_MODEL_BY_ID, item.modelId) ? GEAR_MODEL_BY_ID[item.modelId]! : null;
    if (!model) throw new Error('live-loot-model');
    return { kind: 'gear', modelId: model.id, label: model.label, description: model.description, weight: model.weight,
      guidePrice: Math.round(model.money * (.4 + item.durability * .006)), traderPrice: null,
      rarity: model.money >= 430 ? 'epic' : model.money >= 295 ? 'rare' : model.money >= 145 ? 'uncommon' : 'common', category: 'gear', condition: item.durability, autoSell: false };
  }
  if (item.kind === 'module') {
    const model = Object.hasOwn(MODULE_BY_ID, item.modelId) ? MODULE_BY_ID[item.modelId]! : null;
    if (!model) throw new Error('live-loot-model');
    return { kind: 'module', modelId: model.id, label: model.label, description: model.description, weight: model.stats.weight,
      guidePrice: Math.max(2, Math.round(model.value * (.4 + item.durability * .006))), traderPrice: Math.max(2, Math.floor(model.value * (.2 + item.durability * .003))),
      rarity: model.rarity, category: 'module', condition: item.durability, autoSell: false };
  }
  const model = Object.hasOwn(LOOT_MODEL_BY_ID, item.modelId) ? LOOT_MODEL_BY_ID[item.modelId]! : null;
  if (!model) throw new Error('live-loot-model');
  return { kind: 'loot', modelId: model.id, label: model.label, description: model.description, weight: model.weight,
    guidePrice: model.guidePrice, traderPrice: getLootTraderPrice(item), rarity: model.rarity, category: model.category, condition: null, autoSell: model.autoSell === true };
}
export function getLiveLootWeight(item: EconomyLoot): number { return getLiveLootDefinition(item).weight; }
export function readEconomyLootItems(value: unknown, maxCount: number, maxWeight: number): EconomyLoot[] {
  if (!Array.isArray(value) || value.length > maxCount) throw new Error('live-loot-capacity');
  const items = value.map(readEconomyLoot);
  if (new Set(items.map(item => item.id)).size !== items.length || items.reduce((sum, item) => sum + getLiveLootWeight(item), 0) > maxWeight + 1e-9) throw new Error('live-loot-capacity');
  return items;
}
