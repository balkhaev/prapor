import type { LiveAutomation, LiveDistrictId, LivePoint, LivePurpose, LiveWorld } from '../src/game/live';

export const LIVE_LOOT_COMMITMENT_MS = 45_000;

/** Only public, authored landmarks form the plan; live actors and cargo stay observed. */
export interface LiveSortiePlan {
  poiIds: string[];
  visitedContainerIds: string[];
  skippedDropIds: string[];
  enteredStop: number;
  recalling: boolean;
  blockedAt: number;
  extractTarget: LivePoint | null;
  blockedExtractKeys: string[];
  /** A previously observed static container; never a moving actor or hidden contents. */
  lootCommitment?: { containerId: string; dropId: string; point: LivePoint; stopIndex: number; until: number };
}

export function createLiveSortie(world: LiveWorld, districtId: LiveDistrictId, purpose: LivePurpose, time: number, routeId?: string, bossPoiIds: string[] = []): { automation: LiveAutomation; sortie: LiveSortiePlan } {
  const route = routeId ? world.routes?.find(route => route.id === routeId)
    : world.routes?.find(route => route.districtId === districtId && route.purpose === purpose);
  const poiIds = route?.poiIds ?? (purpose === 'boss' ? bossPoiIds.slice(0, 1)
    : world.pois.filter(poi => poi.districtId === districtId).slice(0, 3).map(poi => poi.id));
  return {
    automation: { enabled: true, stage: 'route', goal: 'Выдвижение по маршруту', targetId: null, target: null,
      routeId: route?.id ?? null, routeName: route?.name ?? (purpose === 'boss' ? 'Охота на босса' : null),
      stopIndex: 0, stopCount: poiIds.length, reason: null, startedAt: time, completedAt: 0 },
    sortie: { poiIds: [...poiIds], visitedContainerIds: [], skippedDropIds: [], enteredStop: -1, recalling: false, blockedAt: 0, extractTarget: null, blockedExtractKeys: [] },
  };
}
