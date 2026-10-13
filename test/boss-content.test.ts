import { describe, expect, test } from 'bun:test';
import { BOSSES, BOSS_SAVE_VERSION, getBoss, getBossForMap } from '../src/game/bosses';
import { MAPS, MAP_BY_ID, WEAPON_BY_ID } from '../src/game/data';
import { LOOT_MODEL_BY_ID, getRaidLootPool, lootAvailableInCatalog } from '../src/game/loot';
import { MODULE_BY_ID } from '../src/game/modules';
import { GEAR_MODEL_BY_ID } from '../src/game/systems';
import { BARTER_OFFERS } from '../src/game/barter';
import { getLootDecisionProfile, getLootHuntOptions } from '../src/game/loot-value';
import { getLiveMap, isLiveWalkable } from '../src/game/live-maps';
import { getLiveBossArenas } from '../src/game/live-boss-arenas';

describe('boss districts, exclusive trophies and meaningful uses', () => {
  test('four different bosses have real weapon platforms and a complete valuable bundle within a live pack', () => {
    expect(BOSSES).toHaveLength(4);
    expect(new Set(BOSSES.map(boss => boss.districtId)).size).toBe(4);
    expect(new Set(BOSSES.map(boss => boss.mapId)).size).toBe(4);
    for (const boss of BOSSES) {
      expect(getBoss(boss.id)).toBe(boss); expect(getBossForMap(boss.mapId)).toBe(boss);
      expect(MAP_BY_ID[boss.mapId]).toBeDefined(); expect(WEAPON_BY_ID[boss.weaponId]).toBeDefined();
      const trophy = LOOT_MODEL_BY_ID[boss.trophyModelId]!, extra = LOOT_MODEL_BY_ID[boss.lootModelId]!;
      const module = MODULE_BY_ID[boss.moduleModelId]!, gear = GEAR_MODEL_BY_ID[boss.gearModelId]!;
      expect(module.weaponId).toBe(boss.weaponId); expect(module.slot).toBe('receiver');
      expect(trophy.bossId).toBe(boss.id); expect(trophy.autoSell).toBeFalsy();
      expect(trophy.weight + extra.weight + module.stats.weight + gear.weight).toBeLessThanOrEqual(12);
      expect(boss.chancePenalty).toBeGreaterThan(0); expect(boss.extraAmmo).toBeGreaterThan(0);
      expect(boss.live.respawnMs).toBeGreaterThan(boss.live.corpseMs);
    }
    expect(getBoss('__proto__')).toBeNull(); expect(getBossForMap('courtyard')).toBeNull();
  });

  test('exclusive hunt rewards never enter random pools or contaminate any paid v25 draw', () => {
    for (const map of MAPS) for (const branch of ['scavenge', 'combat', 'recon'] as const) for (const depth of [1, 2, 3]) {
      const old = getRaidLootPool(map.id, branch, depth, 25), current = getRaidLootPool(map.id, branch, depth, BOSS_SAVE_VERSION);
      expect(current).toEqual(old); expect(current.some(entry => entry.model.bossId)).toBe(false);
    }
    for (const boss of BOSSES) {
      expect(lootAvailableInCatalog(boss.trophyModelId, 25)).toBe(false);
      expect(lootAvailableInCatalog(boss.trophyModelId, BOSS_SAVE_VERSION)).toBe(true);
      expect(getLootHuntOptions(boss.trophyModelId, 25)).toEqual([]);
      expect(getLootHuntOptions(boss.trophyModelId)).toEqual([{ mapId: boss.mapId, branch: 'combat', depth: boss.depth,
        pickChance: 1, checkpointChance: 1, bossId: boss.id, requiresBossHunt: true }]);
    }
  });

  test('each unique trophy competes between a player-priced sale, salvage and one concrete wearable barter', () => {
    for (const boss of BOSSES) {
      const profile = getLootDecisionProfile(boss.trophyModelId)!;
      expect(profile.vendorPrice).toBeGreaterThan(0); expect(profile.marketGuideNet).toBeGreaterThan(profile.vendorPrice);
      expect(profile.barters).toHaveLength(1);
      const offer = BARTER_OFFERS.find(offer => offer.id === profile.barters[0]!.offerId)!;
      expect(offer.requirements).toEqual([{ modelId: boss.trophyModelId, quantity: 1 }]);
      expect(GEAR_MODEL_BY_ID[offer.gearModelId]).toBeDefined();
      expect(Object.values(LOOT_MODEL_BY_ID[boss.trophyModelId]!.salvage).some(amount => amount > 0)).toBe(true);
    }
  });

  test('live bosses occupy stable walkable authored arenas in their specific districts', () => {
    const world = getLiveMap('perimeter'), arenas = getLiveBossArenas(world);
    expect(arenas).toHaveLength(4); expect(new Set(arenas.map(arena => arena.poiId)).size).toBe(4);
    for (const arena of arenas) {
      const boss = getBoss(arena.bossId)!, poi = world.pois.find(poi => poi.id === arena.poiId)!;
      expect(poi.districtId).toBe(boss.districtId); expect(poi.templateId).toBe(boss.poiTemplateId);
      expect(poi.danger).toBeGreaterThanOrEqual(boss.depth); expect(poi.tags).toContain('contested');
      expect(isLiveWalkable(world, arena.home)).toBe(true);
      expect(getLiveBossArenas({ ...world, pois: [...world.pois].reverse() }).find(candidate => candidate.bossId === boss.id)).toEqual(arena);
    }
  });
});
