import { BOSSES, getBoss, type BossId } from './bosses';
import type { LiveBossStatus, LivePoint, LiveWorld } from './live';
import { isLiveWalkable } from './live-maps';

export interface LiveBossArena {
  bossId: BossId; poiId: string; area: LiveBossStatus['area']; home: LivePoint;
}
/** Stable authored places, rather than a random NPC spawn or a client-selected position. */
export function getLiveBossArena(world: LiveWorld, bossId: BossId): LiveBossArena {
  const boss = getBoss(bossId)!;
  const dangerAt = (point: LivePoint) => world.zones.filter(zone => point.x >= zone.x && point.y >= zone.y && point.x < zone.x + zone.width && point.y < zone.y + zone.height).reduce((danger, zone) => Math.max(danger, zone.danger), 1);
  const candidates = world.pois.filter(poi => poi.districtId === boss.districtId && poi.danger >= boss.depth && poi.tags.includes('contested')
    && poi.entrances.some(point => isLiveWalkable(world, point) && dangerAt(point) >= boss.depth))
    .sort((a, b) => Number(b.tags.includes(`boss-arena:${bossId}`)) - Number(a.tags.includes(`boss-arena:${bossId}`))
      || Number(b.templateId === boss.poiTemplateId) - Number(a.templateId === boss.poiTemplateId) || b.danger - a.danger || a.id.localeCompare(b.id));
  const poi = candidates[0];
  if (!poi) throw new Error(`Missing authored boss arena: ${bossId}`);
  const home = poi.entrances.find(point => isLiveWalkable(world, point) && dangerAt(point) >= boss.depth)!;
  return { bossId, poiId: poi.id, area: { x: poi.x, y: poi.y, width: poi.width, height: poi.height }, home: { ...home } };
}
export function getLiveBossArenas(world: LiveWorld): LiveBossArena[] { return BOSSES.map(boss => getLiveBossArena(world, boss.id)); }
