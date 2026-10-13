import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { MAPS } from '../src/game/data';
import { getLootTraderPrice, getRaidLootPool, isAutoSellLoot, JUNK_MODELS, LOOT_MODELS, lootAvailableInCatalog, parseLootItem, parseLootItemForVersion, rollRaidLoot, USEFUL_LOOT_MODELS } from '../src/game/loot';
import type { ExpeditionBranch } from '../src/game/systems';

function random(seed: number) { let value = seed; return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 4294967296; }; }

describe('named junk and useful rarity catalog', () => {
  test('only twelve distinct low-value junk models opt into automatic sale; useful common items remain owned choices', () => {
    expect(LOOT_MODELS).toHaveLength(54); expect(JUNK_MODELS).toHaveLength(12); expect(USEFUL_LOOT_MODELS).toHaveLength(42);
    expect(JUNK_MODELS.map(model => model.id)).toEqual(['empty-can', 'torn-cloth', 'broken-phone', 'bottle-cap', 'spent-casing', 'cracked-lens',
      'faded-receipt', 'crushed-bottle', 'rusty-nail', 'plastic-shard', 'dead-battery', 'broken-circuit']);
    for (const model of JUNK_MODELS) {
      expect(model.category).toBe('junk'); expect(model.autoSell).toBe(true); expect(model.rarity).toBe('common');
      expect(model.description).toContain('Мусор · автопродажа при доставке');
      expect(model.guidePrice).toBeLessThan(25); expect(model.weight).toBeGreaterThan(0);
      expect(Object.values(model.salvage).every(amount => amount === 0)).toBe(true);
      expect(isAutoSellLoot({ modelId: model.id })).toBe(true);
    }
    expect(JUNK_MODELS.slice(0, 6).reduce((sum, model) => sum + getLootTraderPrice({ id: 'loot-1', modelId: model.id, foundAt: 0 }), 0)).toBe(19);
    expect(JUNK_MODELS.reduce((sum, model) => sum + getLootTraderPrice({ id: 'loot-1', modelId: model.id, foundAt: 0 }), 0)).toBe(44);
    for (const model of USEFUL_LOOT_MODELS) expect(isAutoSellLoot({ modelId: model.id })).toBe(false);
    for (const modelId of ['duct-tape', 'bandage-roll', 'ration', 'copper-wire', 'local-map']) expect(isAutoSellLoot({ modelId })).toBe(false);
    expect(isAutoSellLoot({ modelId: '__proto__' })).toBe(false);
  });

  test('legendary useful finds require deep late-sector sorties; paid v24 pools retain common dominance', () => {
    const legendary = USEFUL_LOOT_MODELS.filter(model => model.rarity === 'legendary');
    expect(legendary.map(model => model.id)).toEqual(['military-cpu', 'prototype-optics', 'boss-komendant-seal']);
    expect(legendary.every(model => model.minDepth === 3 && model.minSectorLevel >= 7)).toBe(true);
    expect(getRaidLootPool('reserve', 'recon', 3).some(entry => entry.model.id === 'military-cpu')).toBe(true);
    expect(getRaidLootPool('reserve', 'recon', 3).some(entry => entry.model.id === 'prototype-optics')).toBe(false);
    expect(getRaidLootPool('bunker', 'recon', 3).filter(entry => entry.model.rarity === 'legendary')).toHaveLength(2);
    for (const map of MAPS) for (const branch of ['scavenge', 'combat', 'recon'] as const) for (const depth of [1, 2, 3]) {
	  const pool = getRaidLootPool(map.id, branch, depth, 24), total = pool.reduce((sum, entry) => sum + entry.weight, 0);
      const common = pool.filter(entry => entry.model.rarity === 'common').reduce((sum, entry) => sum + entry.weight, 0);
      const rare = pool.filter(entry => ['rare', 'epic', 'legendary'].includes(entry.model.rarity)).reduce((sum, entry) => sum + entry.weight, 0);
      expect(common).toBeGreaterThan(rare);
      expect(pool.filter(entry => entry.model.rarity === 'legendary').reduce((sum, entry) => sum + entry.weight, 0) / total).toBeLessThan(.015);
      if (depth < 3) expect(pool.some(entry => entry.model.rarity === 'legendary')).toBe(false);
    }
  });

  test('paid v16-v20 catalogs preserve every released pool weight and seeded outcome exactly', () => {
    // Captured from the released 0afe959 catalog: 54 map/branch/depth pools and 20 independent seeds per pool.
    const rows: { map: string; branch: ExpeditionBranch; depth: number; pools: [string, number][]; rolls: string[][] }[] = [];
    for (const map of MAPS) for (const branch of ['scavenge', 'combat', 'recon'] as const) for (const depth of [1, 2, 3]) {
      const pools: [string, number][] = getRaidLootPool(map.id, branch, depth, 20).map(entry => [entry.model.id, entry.weight]);
      const rolls = Array.from({ length: 20 }, (_, index) => rollRaidLoot(map.id, branch, depth, random((index + 1) * 7919), 20).map(model => model.id));
      rows.push({ map: map.id, branch, depth, pools, rolls });
      for (const version of [16, 17, 18, 19]) {
        expect(getRaidLootPool(map.id, branch, depth, version).map(entry => [entry.model.id, entry.weight])).toEqual(pools);
        expect(rollRaidLoot(map.id, branch, depth, random(7919), version).map(model => model.id)).toEqual(rolls[0]!);
      }
      expect(pools.every(([id]) => LOOT_MODELS.slice(0, 24).some(model => model.id === id))).toBe(true);
    }
    expect(createHash('sha256').update(JSON.stringify(rows)).digest('hex')).toBe('3e3cc03c2b393024d653a18e47d062b78456a38b79a51c79e1bdba819f231637');
    // The subsequent released catalog has 32 models; v21-v23 retain all 1,080 results through the rotation release.
    const newerRows = [];
    for (const map of MAPS) for (const branch of ['scavenge', 'combat', 'recon'] as const) for (const depth of [1, 2, 3]) {
      const pool = getRaidLootPool(map.id, branch, depth, 22).map(entry => [entry.model.id, entry.weight]);
      const rolls = Array.from({ length: 20 }, (_, index) => rollRaidLoot(map.id, branch, depth, random((index + 1) * 7919), 22).map(model => model.id));
      newerRows.push({ map: map.id, branch, depth, pool, rolls });
      expect(getRaidLootPool(map.id, branch, depth, 21).map(entry => [entry.model.id, entry.weight])).toEqual(pool);
      expect(rollRaidLoot(map.id, branch, depth, random(7919), 21).map(model => model.id)).toEqual(rolls[0]!);
      expect(getRaidLootPool(map.id, branch, depth, 23).map(entry => [entry.model.id, entry.weight])).toEqual(pool);
      const released23Rolls = Array.from({ length: 20 }, (_, index) => rollRaidLoot(map.id, branch, depth, random((index + 1) * 7919), 23).map(model => model.id));
      expect(released23Rolls).toEqual(rolls);
    }
    expect(createHash('sha256').update(JSON.stringify(newerRows)).digest('hex')).toBe('7dc5713e8e71da2020c8c84ca3fb2314addbee7a98434958a0b6c76c733148bd');
  });

  test('strict save readers gate newly released models and remain safe when used as array callbacks', () => {
    const old = { id: 'loot-1', modelId: 'duct-tape', foundAt: 0 };
    expect(parseLootItemForVersion(old, 16)).toEqual(old);
    for (const [index, model] of LOOT_MODELS.slice(24).entries()) {
      const value = { id: 'loot-2', modelId: model.id, foundAt: 0 };
      const releasedIn = index < 8 ? 21 : index < 26 ? 24 : 26;
      expect(model.releasedIn).toBe(releasedIn);
      for (const version of [16, 20, 21, 22, 23, 24, 25, 26]) {
        expect(lootAvailableInCatalog(model.id, version)).toBe(version >= releasedIn);
        if (version < releasedIn) expect(() => parseLootItemForVersion(value, version)).toThrow();
        else expect(parseLootItemForVersion(value, version)).toEqual(value);
      }
      expect([old, value].map(parseLootItem)).toEqual([old, value]);
      expect(() => parseLootItem({ ...value, autoSell: true })).toThrow(); expect(() => parseLootItem({ ...value, guidePrice: 1e9 })).toThrow();
    }
    expect(lootAvailableInCatalog('__proto__', 21)).toBe(false);
  });
});
