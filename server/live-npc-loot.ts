import type { EconomyLoot } from './live-economy';
import { readEconomyLootItems } from '../src/game/live-loot';

export interface NpcInventory { items: EconomyLoot[]; money: number }
export const NPC_INVENTORY_ITEM_LIMIT = 3;
export const NPC_INVENTORY_WEIGHT_LIMIT = 4;
export const NPC_INVENTORY_MONEY_LIMIT = 150;
export const NPC_CACHE_ITEM_LIMIT = 32;
export const NPC_CACHE_WEIGHT_LIMIT = 12;
export const NPC_CACHE_MONEY_LIMIT = 500;

function readInventory(value: unknown, count: number, weight: number, cash: number): NpcInventory {
  // An absent field is the only legacy migration. Invalid saved cargo is never
  // silently discarded, shortened, converted to money or replaced with a roll.
  if (value === undefined) return { items: [], money: 0 };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('npc-inventory-object');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !Object.hasOwn(record, 'items') || !Object.hasOwn(record, 'money')
    || typeof record.money !== 'number' || !Number.isSafeInteger(record.money) || record.money < 0 || record.money > cash) throw new Error('npc-inventory-capacity');
  if (!Array.isArray(record.items) || record.items.length > count) throw new Error('npc-inventory-capacity');
  // Densifying prevents a sparse array from skipping item validation in map/reduce.
  return { items: readEconomyLootItems(Array.from(record.items), count, weight), money: record.money };
}

/** Strict, independent records preserve source identity, condition and discovery time. */
export function readNpcInventory(value: unknown): NpcInventory {
  return readInventory(value, NPC_INVENTORY_ITEM_LIMIT, NPC_INVENTORY_WEIGHT_LIMIT, NPC_INVENTORY_MONEY_LIMIT);
}
export function readNpcCacheInventory(value: unknown): NpcInventory {
  return readInventory(value, NPC_CACHE_ITEM_LIMIT, NPC_CACHE_WEIGHT_LIMIT, NPC_CACHE_MONEY_LIMIT);
}

function combined(inventory: NpcInventory, items: readonly EconomyLoot[], money: number, cache = false): NpcInventory | null {
  try {
    const read = cache ? readNpcCacheInventory : readNpcInventory;
    const current = read(inventory), incoming = read({ items, money });
    return read({ items: [...current.items, ...incoming.items], money: current.money + incoming.money });
  } catch { return null; }
}

export function canNpcCarry(inventory: NpcInventory, items: readonly EconomyLoot[], money: number): boolean {
  return combined(inventory, items, money) !== null;
}

/** The caller removes the source parcel only after success, in the same world update. */
export function takeNpcLoot(inventory: NpcInventory, parcel: NpcInventory): boolean {
  if (inventory === parcel) return false;
  const next = combined(inventory, parcel.items, parcel.money);
  if (!next) return false;
  inventory.items = next.items; inventory.money = next.money;
  return true;
}

/** Deposit all carried contents or change neither owner. A full base cannot eat cargo. */
export function depositNpcLoot(inventory: NpcInventory, cache: NpcInventory): boolean {
  if (inventory === cache) return false;
  let carried: NpcInventory;
  try { carried = readNpcInventory(inventory); } catch { return false; }
  const next = combined(cache, carried.items, carried.money, true);
  if (!next) return false;
  cache.items = next.items; cache.money = next.money;
  inventory.items = []; inventory.money = 0;
  return true;
}

/** Death transfers these exact contents; an immediate repeat returns an empty parcel. */
export function drainNpcLoot(inventory: NpcInventory): NpcInventory {
  const parcel = readNpcInventory(inventory);
  inventory.items = []; inventory.money = 0;
  return parcel;
}
