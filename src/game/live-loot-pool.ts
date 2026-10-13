import { balanceLootPool, getRaidLootPool, type LootCategory, type LootModel } from './loot';
import type { LiveDistrictId, LivePoint, LiveWorld } from './live';
import type { ExpeditionBranch } from './systems';

/** The named-purpose profile does not change weapon platform or gear gates in this location. */
export function getLiveLootSource(world: LiveWorld, point: LivePoint) {
  const depth = world.zones.filter(zone => point.x >= zone.x && point.x < zone.x + zone.width && point.y >= zone.y && point.y < zone.y + zone.height)
    .reduce((danger, zone) => Math.max(danger, zone.danger), 1);
  const district = world.districts.find(area => point.x >= area.x && point.y >= area.y && point.x < area.x + area.width && point.y < area.y + area.height)
    ?? [...world.districts].sort((a, b) => Math.hypot(point.x - a.x - a.width / 2, point.y - a.y - a.height / 2) - Math.hypot(point.x - b.x - b.width / 2, point.y - b.y - b.height / 2))[0]!;
  const districtId = district.id as LiveDistrictId, table = world.containers.find(anchor => anchor.x === point.x && anchor.y === point.y)?.lootTable;
  const sector = depth === 3 && districtId === 'depot' ? 'bunker' : ({ customs: 'factory', sawmill: 'forest', depot: 'reserve', village: 'forest' } as const)[districtId];
  const branch: ExpeditionBranch = ({ customs: 'scavenge', sawmill: 'recon', depot: 'combat', village: 'scavenge' } as const)[districtId];
  const namedSector = depth === 3 && table === 'medical' ? 'reserve' : depth === 3 && table === 'intel' ? 'bunker' : sector;
  return { depth, districtId, table, sector, namedSector, branch, technical: depth === 3 && districtId === 'depot' && table === 'tools' };
}
/** Shared by world generation and hunting guidance; all rates describe a future unsearched cycle. */
export function getLiveNamedLootPool(world: LiveWorld, point: LivePoint): { model: LootModel; weight: number }[] {
  const source = getLiveLootSource(world, point), pool = getRaidLootPool(source.namedSector, source.branch, source.depth);
  const category: LootCategory | undefined = source.table === 'medical' ? 'medicine' : ['tools', 'intel', 'valuables', 'provisions'].includes(source.table ?? '') ? source.table as LootCategory : undefined;
  if (!category) return pool;
  let matching = pool.filter(entry => entry.model.category === category || source.technical && entry.model.category === 'electronics');
  if (!matching.length) return pool;
  if (source.technical) {
    // Where both purposes have a tier, favour tools 3:1. Electronics-only epic/legendary tiers retain their own rarity budget.
    matching = matching.map(entry => {
      const tier = matching.filter(value => value.model.rarity === entry.model.rarity), sameCategory = tier.filter(value => value.model.category === entry.model.category);
      const categoryTotal = sameCategory.reduce((sum, value) => sum + value.weight, 0);
      const both = tier.some(value => value.model.category === 'tools') && tier.some(value => value.model.category === 'electronics');
      return { model: entry.model, weight: entry.weight / categoryTotal * (both ? entry.model.category === 'tools' ? .75 : .25 : 1) };
    });
  }
  return balanceLootPool([...matching, ...pool.filter(entry => entry.model.autoSell)], source.depth, .10, source.branch);
}
