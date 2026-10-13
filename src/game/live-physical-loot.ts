import { MAP_BY_ID } from './data';
import { moduleAvailableInSave } from './catalog-releases';
import { MODULE_MODELS, RECEIVER_INFO, type ModuleModel } from './modules';
import { getRaidGearLootPool } from './raid-gear-loot';
import type { ExpeditionBranch } from './systems';
import type { LootModel } from './loot';
import type { LiveContainerAnchor } from './live';

export interface LiveLootFamilyOdds { gear: number; module: number }
export function getLiveLootFamilyOdds(table?: LiveContainerAnchor['lootTable']): LiveLootFamilyOdds {
  if (table === 'medical') return { gear: .02, module: .03 };
  if (table === 'intel') return { gear: .03, module: .07 };
  if (table === 'valuables') return { gear: .05, module: .1 };
  if (table === 'tools') return { gear: .05, module: .35 };
  return { gear: .15, module: .25 };
}

export function getLiveModuleLootPool(mapId: string, depth: number): { model: ModuleModel; weight: number }[] {
  if (!Object.hasOwn(MAP_BY_ID, mapId) || !Number.isInteger(depth) || depth < 1 || depth > 3) return [];
  const map = MAP_BY_ID[mapId]!, weapons = map.weapons.filter(id => Object.hasOwn(RECEIVER_INFO, id));
  return MODULE_MODELS.filter(model => moduleAvailableInSave(model.id, 23) && model.lootTier <= depth + (depth === 3 && map.level >= 7 ? 1 : 0)
    && (model.slot === 'receiver' ? weapons.includes(model.weaponId!) : weapons.some(weaponId => {
      const receiver = RECEIVER_INFO[weaponId]!;
      return (model.platforms.includes('*') || model.platforms.includes(receiver.platform))
        && (model.calibers.includes('*') || model.calibers.includes(receiver.caliber));
    }))).map(model => ({ model, weight: ({ common: 8, uncommon: 4, rare: 1.5, epic: .4, legendary: .1 }[model.rarity]) * (model.slot === 'receiver' ? .35 : 1) }));
}
function pick<T>(pool: { model: T; weight: number }[], random: () => number): T {
  let roll = random() * pool.reduce((sum, entry) => sum + entry.weight, 0);
  return (pool.find(entry => (roll -= entry.weight) < 0) ?? pool.at(-1)!).model;
}
/** Family odds are per item: about 15% real gear, 25% real compatible modules, 60% named trophies. */
export function rollLiveLootModel(mapId: string, branch: ExpeditionBranch, depth: number, named: { model: LootModel; weight: number }[], random: () => number, odds = getLiveLootFamilyOdds()):
  { kind?: 'loot'; modelId: string } | { kind: 'gear' | 'module'; modelId: string; durability: number } {
  const family = random(), condition = () => 55 + Math.min(45, Math.floor(Math.max(0, random()) * 46));
  if (family < odds.gear) {
    const pool = getRaidGearLootPool(mapId, branch, depth);
    if (pool.length) return { kind: 'gear', modelId: pick(pool, random).id, durability: condition() };
  } else if (family < odds.gear + odds.module) {
    const pool = getLiveModuleLootPool(mapId, depth);
    if (pool.length) return { kind: 'module', modelId: pick(pool, random).id, durability: condition() };
  }
  if (!named.length) throw new Error('live-loot-pool');
  return { modelId: pick(named, random).id };
}
