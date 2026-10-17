import { describe, expect, test } from 'bun:test';
import type { EconomyLoot } from '../server/live-economy';
import { canNpcCarry, depositNpcLoot, drainNpcLoot, readNpcCacheInventory, readNpcInventory, takeNpcLoot, type NpcInventory } from '../server/live-npc-loot';

const NOW = 1_800_000_000_000;
let sequence = 0;
function item(modelId = 'coffee'): EconomyLoot {
  return { id: `00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, '0')}`, modelId, foundAt: NOW };
}
const empty = (): NpcInventory => ({ items: [], money: 0 });

describe('physical NPC cargo and base caches', () => {
  test('only an absent legacy inventory becomes empty; records are validated and cloned without changing physical metadata', () => {
    expect(readNpcInventory(undefined)).toEqual(empty()); expect(readNpcCacheInventory(undefined)).toEqual(empty());
    const gear: EconomyLoot = { ...item('padded_vest'), kind: 'gear', durability: 65 };
    const module: EconomyLoot = { ...item('factory-sks-stock'), kind: 'module', durability: 77 };
    const source = { items: [gear, module, item('local-map')], money: 150 }, parsed = readNpcInventory(source);
    expect(parsed).toEqual(source); expect(parsed).not.toBe(source); expect(parsed.items).not.toBe(source.items);
    parsed.items[0]!.foundAt++;
    expect(source.items[0]!.foundAt).toBe(NOW);
    for (const value of [null, [], {}, { items: [] }, { items: [], money: 0, reward: 1 }, { items: [], money: '0' },
      { items: [], money: NaN }, { items: [], money: Infinity }, { items: [], money: -1 }, { items: [], money: .5 }, { items: [], money: 151 },
      { items: new Array(1), money: 0 }])
      expect(() => readNpcInventory(value)).toThrow();
  });

  test('unknown models, bad identities and duplicate source identities are rejected without accepting partial loot', () => {
    const valid = item(), inventory = { items: [valid], money: 7 };
    for (const bad of [item('invented-loot'), { ...item(), id: 'invented-id' }, { ...item(), reward: 500 },
      { ...item('padded_vest'), kind: 'gear', durability: 0 }, { ...item('factory-sks-stock'), kind: 'module', durability: 101 }]) {
      const parcel = { items: [bad as EconomyLoot], money: 10 }, before = structuredClone({ inventory, parcel });
      expect(canNpcCarry(inventory, parcel.items, parcel.money)).toBe(false);
      expect(takeNpcLoot(inventory, parcel)).toBe(false); expect({ inventory, parcel }).toEqual(before);
    }
    const duplicate = { items: [valid], money: 10 };
    expect(takeNpcLoot(inventory, duplicate)).toBe(false); expect(inventory).toEqual({ items: [valid], money: 7 });
    expect(() => readNpcInventory({ items: [valid, valid], money: 0 })).toThrow();
  });

  test('a whole bundle must fit item count, weight and money, with both source and carrier unchanged on refusal', () => {
    const cases = [
      { inventory: { items: [item(), item()], money: 0 }, parcel: { items: [item(), item()], money: 0 } },
      { inventory: { items: [item('tool-case')], money: 0 }, parcel: { items: [item('tool-case')], money: 0 } },
      { inventory: { items: [], money: 140 }, parcel: { items: [item()], money: 11 } },
      { inventory: empty(), parcel: { items: [item()], money: NaN } },
    ];
    for (const { inventory, parcel } of cases) {
      const before = structuredClone({ inventory, parcel });
      expect(takeNpcLoot(inventory, parcel)).toBe(false); expect({ inventory, parcel }).toEqual(before);
    }
    const inventory = { items: [item('tool-case')], money: 149 }, parcel = { items: [item('local-map')], money: 1 };
    const before = structuredClone(parcel);
    expect(canNpcCarry(inventory, parcel.items, parcel.money)).toBe(true);
    expect(takeNpcLoot(inventory, parcel)).toBe(true); expect(inventory.items.at(-1)).toEqual(parcel.items[0]); expect(inventory.money).toBe(150);
    expect(parcel).toEqual(before); expect(inventory.items.at(-1)).not.toBe(parcel.items[0]);
  });

  test('a full or corrupt cache preserves carried cargo until space is available', () => {
    const carried = { items: [item('local-map')], money: 10 };
    const caches: NpcInventory[] = [
      { items: Array.from({ length: 32 }, () => item('local-map')), money: 0 },
      { items: Array.from({ length: 4 }, () => item('tool-case')), money: 0 },
      { items: [], money: 491 },
      { items: [item('invented-loot')], money: 0 },
      { items: [{ ...carried.items[0]! }], money: 0 },
    ];
    for (const cache of caches) {
      const before = structuredClone({ carried, cache });
      expect(depositNpcLoot(carried, cache)).toBe(false); expect({ carried, cache }).toEqual(before);
    }
    const cache = { items: [item()], money: 490 }, delivered = structuredClone(carried), existing = structuredClone(cache);
    expect(depositNpcLoot(carried, cache)).toBe(true);
    expect(cache).toEqual({ items: [...existing.items, ...delivered.items], money: 500 }); expect(carried).toEqual(empty());
    expect(depositNpcLoot(carried, cache)).toBe(true); expect(cache).toEqual({ items: [...existing.items, ...delivered.items], money: 500 });
  });

  test('cache limits remain compatible with one player bag, and self-transfers cannot duplicate or erase money', () => {
    expect(readNpcCacheInventory({ items: Array.from({ length: 4 }, () => item('tool-case')), money: 500 }).items).toHaveLength(4);
    expect(readNpcCacheInventory({ items: Array.from({ length: 32 }, () => item('local-map')), money: 0 }).items).toHaveLength(32);
    expect(() => readNpcCacheInventory({ items: [], money: 501 })).toThrow();
    expect(() => readNpcCacheInventory({ items: Array.from({ length: 5 }, () => item('tool-case')), money: 0 })).toThrow();
    const carried = { items: [], money: 50 };
    expect(takeNpcLoot(carried, carried)).toBe(false); expect(depositNpcLoot(carried, carried)).toBe(false);
    expect(carried).toEqual({ items: [], money: 50 });
  });

  test('foraging, carrying, depositing and death move the same identities exactly once across repeated restarts', () => {
    const initial = { items: [item(), { ...item('factory-sks-stock'), kind: 'module' as const, durability: 77 }], money: 91 };
    const source = structuredClone(initial), carrier = empty(), cache = empty();
    expect(takeNpcLoot(carrier, source)).toBe(true); source.items = []; source.money = 0;
    expect(source).toEqual(empty());
    const reloaded = readNpcInventory(JSON.parse(JSON.stringify(carrier)));
    expect(reloaded).toEqual(initial); expect(depositNpcLoot(reloaded, cache)).toBe(true);
    const persistedCache = readNpcCacheInventory(JSON.parse(JSON.stringify(cache)));
    expect(persistedCache).toEqual(initial); expect(reloaded).toEqual(empty());
    const corpseCarrier = readNpcInventory(initial), corpse = drainNpcLoot(corpseCarrier);
    expect(corpse).toEqual(initial); expect(corpseCarrier).toEqual(empty()); expect(drainNpcLoot(corpseCarrier)).toEqual(empty());
    expect(corpse.items[0]).not.toBe(initial.items[0]);
    const broken = { items: [item('invented-loot')], money: 10 }, before = structuredClone(broken);
    expect(() => drainNpcLoot(broken)).toThrow(); expect(broken).toEqual(before);
  });
});
