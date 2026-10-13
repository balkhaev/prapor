import { describe, expect, test } from 'bun:test';
import { getLiveMap } from '../src/game/live-maps';
import { getLiveLootPool } from '../server/live';
import { getLiveLootSource, getLiveNamedLootPool } from '../src/game/live-loot-pool';
import { getLiveLootFamilyOdds, getLiveModuleLootPool } from '../src/game/live-physical-loot';
import { LOOT_RARITY_BUDGETS, USEFUL_LOOT_MODELS } from '../src/game/loot';
import { getRaidGearLootPool } from '../src/game/raid-gear-loot';
import { GEAR_MODELS } from '../src/game/systems';
import { MAPS, type Rarity } from '../src/game/data';
import type { LiveContainerAnchor, LiveWorld } from '../src/game/live';

const world = getLiveMap('perimeter'), sum = (pool: readonly { weight: number }[]) => pool.reduce((total, entry) => total + entry.weight, 0);
const specialistAnchor = (table: LiveContainerAnchor['lootTable'], physical: string) => {
  const anchor = world.containers.find(anchor => {
    const source = getLiveLootSource(world, anchor);
    return anchor.lootTable === table && source.depth === 3 && source.sector === physical && (table !== 'tools' || source.technical);
  });
  if (!anchor) throw new Error(`Missing authored danger-three ${table} source in ${physical}`);
  return anchor;
};
const namedChance = (anchor: LiveContainerAnchor, modelId: string) => {
  const pool = getLiveNamedLootPool(world, anchor), family = getLiveLootFamilyOdds(anchor.lootTable);
  return (pool.find(entry => entry.model.id === modelId)?.weight ?? 0) / sum(pool) * (1 - family.gear - family.module);
};

describe('live rare hunting and usable module distribution', () => {
  test('authored danger-three specialist locations offer their promised rare targets without raising physical weapon or gear gates', () => {
    const cases = [
      { anchor: specialistAnchor('medical', 'forest'), sector: 'reserve', physical: 'forest', target: 'lab-reagents', minimum: .05 },
      { anchor: specialistAnchor('intel', 'forest'), sector: 'bunker', physical: 'forest', target: 'cipher-book', minimum: .05 },
      { anchor: specialistAnchor('tools', 'bunker'), sector: 'bunker', physical: 'bunker', target: 'military-cpu', minimum: .004 },
      { anchor: specialistAnchor('tools', 'bunker'), sector: 'bunker', physical: 'bunker', target: 'prototype-optics', minimum: .004 },
    ];
    for (const scenario of cases) {
      const anchor = scenario.anchor, source = getLiveLootSource(world, anchor);
      expect(source.depth).toBe(3); expect(source.namedSector).toBe(scenario.sector); expect(source.sector).toBe(scenario.physical);
      expect(source.sector).toBe(getLiveLootSource({ ...world, containers: [] }, anchor).sector);
      expect(namedChance(scenario.anchor, scenario.target)).toBeGreaterThan(scenario.minimum);
      expect(getLiveLootPool('perimeter', anchor)).toEqual(getLiveNamedLootPool(world, anchor));
    }
  });

  test('every ordinary useful trophy and wearable model has a real authored future source; boss trophies stay exclusive', () => {
    const named = new Set(world.containers.flatMap(anchor => {
      const pool = getLiveNamedLootPool(world, anchor);
      expect(getLiveLootPool('perimeter', anchor)).toEqual(pool);
      return pool.filter(entry => entry.weight > 0).map(entry => entry.model.id);
    }));
    for (const model of USEFUL_LOOT_MODELS) expect(named.has(model.id), model.label).toBe(!model.bossId);
    const gear = new Set(world.containers.flatMap(anchor => {
      const source = getLiveLootSource(world, anchor);
      return getLiveLootFamilyOdds(anchor.lootTable).gear > 0 ? getRaidGearLootPool(source.sector, source.branch, source.depth).filter(entry => entry.weight > 0).map(entry => entry.model.id) : [];
    }));
    expect(gear).toEqual(new Set(GEAR_MODELS.map(model => model.id)));
  });

  test('specialist junk remains ten percent and uncommon model counts cannot dilute the rare tier', () => {
    for (const anchor of world.containers.filter(anchor => anchor.lootTable !== 'mixed')) {
      const pool = getLiveNamedLootPool(world, anchor), source = getLiveLootSource(world, anchor);
      expect(sum(pool)).toBeCloseTo(1, 12);
      expect(sum(pool.filter(entry => entry.model.autoSell))).toBeCloseTo(.1, 12);
      const tier = pool.filter(entry => !entry.model.autoSell), available = [...new Set(tier.map(entry => entry.model.rarity))];
      const boost = source.branch === 'combat' ? 1.35 : source.branch === 'recon' ? 1.2 : 1;
      const budget = (rarity: Rarity) => LOOT_RARITY_BUDGETS[source.depth]![rarity] * (['rare', 'epic', 'legendary'].includes(rarity) ? boost : 1);
      const total = available.reduce((total, rarity) => total + budget(rarity), 0);
      for (const rarity of available) expect(sum(tier.filter(entry => entry.model.rarity === rarity))).toBeCloseTo(.9 * budget(rarity) / total, 12);
    }
  });

  test('zone danger controls specialist tiers even when a point of interest advertises a harder challenge', () => {
    const weaker: LiveWorld = { ...world, zones: world.zones.map(zone => ({ ...zone, danger: Math.min(zone.danger, 2) as 1 | 2 })) };
    const anchors = world.containers.filter(anchor => {
      const source = getLiveLootSource(world, anchor);
      return source.depth === 3 && (anchor.lootTable === 'medical' || anchor.lootTable === 'intel' || source.technical);
    });
    expect(new Set(anchors.map(anchor => anchor.lootTable))).toEqual(new Set(['medical', 'intel', 'tools']));
    for (const anchor of anchors) {
      const source = getLiveLootSource(weaker, anchor);
      expect(source.depth).toBe(2); expect(source.namedSector).toBe(source.sector); expect(source.technical).toBe(false);
      expect(getLiveNamedLootPool(weaker, anchor).some(entry => ['epic', 'legendary'].includes(entry.model.rarity))).toBe(false);
    }
  });

  test('receivers retain twelve percent of each module family and rarity budgets for parts do not depend on hundreds of variants', () => {
    for (const map of MAPS) for (const depth of [1, 2, 3]) {
      const pool = getLiveModuleLootPool(map.id, depth), receivers = pool.filter(entry => entry.model.slot === 'receiver'), parts = pool.filter(entry => entry.model.slot !== 'receiver');
      expect(receivers.length).toBeGreaterThan(0); expect(parts.length).toBeGreaterThan(0);
      expect(sum(pool)).toBeCloseTo(1, 12); expect(sum(receivers)).toBeCloseTo(.12, 12); expect(sum(parts)).toBeCloseTo(.88, 12);
      const tiers = [...new Set(parts.map(entry => entry.model.rarity))], total = tiers.reduce((value, rarity) => value + LOOT_RARITY_BUDGETS[depth]![rarity], 0);
      for (const rarity of tiers) expect(sum(parts.filter(entry => entry.model.rarity === rarity))).toBeCloseTo(.88 * LOOT_RARITY_BUDGETS[depth]![rarity] / total, 12);
    }
  });
});
