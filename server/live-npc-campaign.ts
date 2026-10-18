import type { LiveDistrictId, LivePoint } from '../src/game/live';
import type { LiveMapDefinition } from '../src/game/live-maps';
import type { NpcFactionAlerts } from './live-faction-alerts';
import type { NpcSquadActor, NpcSquadFaction, NpcSquadPlan, NpcSquadState, NpcTerritoryPlan } from './live-squads';

export const NPC_CAMPAIGN_RETREAT_MS = 600_000;
export const NPC_CAMPAIGN_REGROUP_MS = 30_000;
export const NPC_CAMPAIGN_STRANDED_WITHDRAW_MS = 60_000;
export const NPC_CAMPAIGN_ROUTE_LIMIT = 512;
export interface NpcCampaignBase {
  id: string; point: LivePoint; districtId: LiveDistrictId; rallyPoints: LivePoint[]; escapePoints: LivePoint[];
  targets: NpcSquadPlan['targets']; responseTargets: NonNullable<NpcSquadPlan['responseTargets']>;
  assaultTargets: NonNullable<NpcSquadPlan['assaultTargets']>;
}
export interface NpcCampaignRoute { fromId: string; toId: string; pathLength: number }
export interface NpcCampaignGeometry { bases: NpcCampaignBase[]; routes: NpcCampaignRoute[] }
export interface NpcSquadCamp {
  squadId: string; baseId: string | null; lostBaseId: string | null; lossId: string | null;
  lossRoster: Array<{ id: string; lifeCycle: number }>;
  relocateUntil: number; regroupUntil: number; holdPoint: LivePoint | null;
}
export interface NpcCampaignState { version: 1; squads: NpcSquadCamp[] }
type Navigation = { walkable(point: LivePoint): boolean; findPath(from: LivePoint, to: LivePoint): LivePoint[] | null; hasLineOfSight?(from: LivePoint, to: LivePoint): boolean };
const copy = ({ x, y }: LivePoint): LivePoint => ({ x, y });
const distance = (a: LivePoint, b: LivePoint): number => Math.hypot(a.x - b.x, a.y - b.y);
const same = (a: LivePoint, b: LivePoint): boolean => a.x === b.x && a.y === b.y;

/** Immutable route geometry is built once; ownership never changes authored homes. */
export function buildNpcCampaignGeometry(world: LiveMapDefinition, squads: { squads: NpcSquadPlan[]; territories: NpcTerritoryPlan[] }, navigation: Navigation, excluded: (point: LivePoint) => boolean = () => false): NpcCampaignGeometry {
  const routes: NpcCampaignRoute[] = [], baseIds = new Set(squads.squads.map(plan => plan.baseId));
  const pathCache = new Map<string, number>();
  const length = (a: LivePoint, b: LivePoint): number => {
    const key = `${a.x},${a.y}:${b.x},${b.y}`;
    if (!pathCache.has(key)) pathCache.set(key, navigation.findPath(a, b)?.length ?? Infinity);
    return pathCache.get(key)!;
  };
  const safe = (point: LivePoint): boolean => navigation.walkable(point) && !excluded(point);
  const bases = squads.squads.map(plan => {
    // Enough nearby cells for several physically cohosted groups. Slots are
    // allocated across all residents below, rather than copied per group.
    const rallyPoints = [copy(plan.base)], escapePoints: LivePoint[] = [];
    for (let radius = 1; radius <= 5; radius++) for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
      const point = { x: plan.base.x + x, y: plan.base.y + y };
      if (Math.max(Math.abs(x), Math.abs(y)) !== radius || distance(point, plan.base) > 5 || !safe(point) || length(plan.base, point) > 12
        || navigation.hasLineOfSight && !navigation.hasLineOfSight(point, plan.base)
        || world.npcSpawns.some(spawn => spawn.role !== 'patrol' && same(spawn.point, point))) continue;
      rallyPoints.push(point);
    }
    for (const radius of [14, 20, 26]) for (const [x, y] of [[radius, 0], [0, radius], [-radius, 0], [0, -radius]]) {
      const point = { x: plan.base.x + x!, y: plan.base.y + y! };
      if (safe(point) && length(plan.base, point) <= 40) escapePoints.push(point);
    }
    const targets = squads.territories.filter(site => !baseIds.has(site.id) && site.districtId === plan.districtId && distance(plan.base, site.point) >= 12 && distance(plan.base, site.point) <= 72)
      .map(site => ({ territoryId: site.id, point: copy(site.point), pathLength: length(plan.base, site.point), hasSupplies: world.containers.some(container => container.poiId === site.poiId) }))
      .filter(target => target.pathLength <= 104).sort((a, b) => a.pathLength - b.pathLength || a.territoryId.localeCompare(b.territoryId)).slice(0, 12);
    const responseTargets = squads.territories.filter(site => distance(plan.base, site.point) <= (baseIds.has(site.id) ? NPC_CAMPAIGN_ROUTE_LIMIT : 192))
      .map(site => ({ territoryId: site.id, point: copy(site.point), pathLength: length(plan.base, site.point), kind: baseIds.has(site.id) ? 'base' as const : 'control' as const }))
      .filter(target => target.pathLength <= (target.kind === 'base' ? NPC_CAMPAIGN_ROUTE_LIMIT : 256))
      .sort((a, b) => a.pathLength - b.pathLength || a.territoryId.localeCompare(b.territoryId));
    for (const target of responseTargets) if (target.kind === 'base') routes.push({ fromId: plan.baseId, toId: target.territoryId, pathLength: target.pathLength });
    const assaultTargets = responseTargets.filter(target => target.kind === 'base' && distance(plan.base, target.point) <= 192 && target.pathLength <= 256);
    return { id: plan.baseId, point: copy(plan.base), districtId: plan.districtId, rallyPoints, escapePoints, targets, responseTargets, assaultTargets };
  });
  return { bases, routes };
}

export function createNpcCampaignState(plans: readonly NpcSquadPlan[]): NpcCampaignState {
  return { version: 1, squads: plans.map(plan => ({ squadId: plan.id, baseId: plan.baseId, lostBaseId: null, lossId: null, lossRoster: [], relocateUntil: 0, regroupUntil: 0, holdPoint: null })) };
}
export function restoreNpcCampaignState(plans: readonly NpcSquadPlan[], geometry: NpcCampaignGeometry, value: unknown, _now: number): NpcCampaignState {
  const state = createNpcCampaignState(plans);
  if (!value || typeof value !== 'object' || (value as NpcCampaignState).version !== 1 || !Array.isArray((value as NpcCampaignState).squads)) return state;
  const saved = (value as NpcCampaignState).squads;
  if (saved.length > plans.length || new Set(saved.map(camp => camp?.squadId)).size !== saved.length) return state;
  for (const plan of plans) {
    const camp = saved.find(camp => camp?.squadId === plan.id);
    if (!camp || !(camp.baseId === null || geometry.bases.some(base => base.id === camp.baseId))
      || !(camp.lostBaseId === null || geometry.bases.some(base => base.id === camp.lostBaseId))
      || !(camp.lossId === null || typeof camp.lossId === 'string' && /^loss-[1-9]\d*$/.test(camp.lossId))
      || ![camp.relocateUntil, camp.regroupUntil].every(time => Number.isSafeInteger(time) && time >= 0)
      || !Array.isArray(camp.lossRoster) || camp.lossRoster.length > plan.memberIds.length
      || camp.lossRoster.some(member => !member || !plan.memberIds.includes(member.id) || !Number.isSafeInteger(member.lifeCycle) || member.lifeCycle < 0)
      || new Set(camp.lossRoster.map(member => member.id)).size !== camp.lossRoster.length
      || !(camp.holdPoint === null || geometry.bases.find(base => base.id === (camp.lostBaseId ?? plan.baseId))?.escapePoints.some(point => same(point, camp.holdPoint!)))
      || camp.baseId === null && camp.lostBaseId === null || camp.lossId !== null && camp.lostBaseId === null) continue;
    Object.assign(state.squads.find(entry => entry.squadId === plan.id)!, structuredClone(camp));
  }
  return state;
}
export function getNpcOperationalBase(state: NpcCampaignState, squadId: string): string | null {
  return state.squads.find(camp => camp.squadId === squadId)?.baseId ?? null;
}
/** Cross-district refuges are real authored bases with a prevalidated route. */
export function chooseNpcRefuge(geometry: NpcCampaignGeometry, fromBaseId: string, faction: NpcSquadFaction, owners: ReadonlyMap<string, NpcSquadFaction | null>): string | null {
  return geometry.routes.filter(route => route.fromId === fromBaseId && route.toId !== fromBaseId && owners.get(route.toId) === faction && route.pathLength <= NPC_CAMPAIGN_ROUTE_LIMIT)
    .sort((a, b) => a.pathLength - b.pathLength || a.toId.localeCompare(b.toId))[0]?.toId ?? null;
}

/** Read-only projection is also used before restoring active squad state. */
export function npcCampaignPlans(geometry: NpcCampaignGeometry, campaign: NpcCampaignState, authored: readonly NpcSquadPlan[]): NpcSquadPlan[] {
  const used = new Map<string, Set<string>>();
  return authored.map(plan => {
    const camp = campaign.squads.find(entry => entry.squadId === plan.id), base = geometry.bases.find(base => base.id === camp?.baseId);
    if (!camp || !base) return { ...plan, operational: false, base: copy(camp?.holdPoint ?? plan.base), rallyPoints: plan.memberIds.map(() => copy(camp?.holdPoint ?? plan.base)),
      targets: [], responseTargets: [], assaultTargets: [], strandedUntil: camp?.holdPoint ? camp.relocateUntil : 0 };
    const allocated = used.get(base.id) ?? new Set<string>(); used.set(base.id, allocated);
    const slots = plan.memberIds.map((_, index) => {
      const original = base.id === plan.baseId ? plan.rallyPoints[index] : undefined;
      const candidate = original && base.rallyPoints.some(point => same(point, original)) && !allocated.has(`${original.x},${original.y}`) ? original
        : base.rallyPoints.find(point => !allocated.has(`${point.x},${point.y}`)) ?? base.point;
      allocated.add(`${candidate.x},${candidate.y}`); return copy(candidate);
    });
    return { ...plan, operational: true, baseId: base.id, base: copy(base.point), districtId: base.districtId, rallyPoints: slots,
      targets: base.targets, responseTargets: base.responseTargets, assaultTargets: base.assaultTargets,
      recoveryLossId: camp.lossId, recoveryRoster: camp.lossRoster, recoveryReadyAt: camp.relocateUntil ? Number.MAX_SAFE_INTEGER : camp.regroupUntil,
      recoveryPending: Boolean(camp.relocateUntil || camp.regroupUntil), strandedUntil: 0 };
  });
}

/** Losses change orders only. Actual walking, damage and inventory stay in live.ts. */
export function advanceNpcCampaign(geometry: NpcCampaignGeometry, campaign: NpcCampaignState, plans: readonly NpcSquadPlan[], states: Map<string, NpcSquadState>, actors: ReadonlyMap<string, NpcSquadActor>, owners: ReadonlyMap<string, NpcSquadFaction | null>, alerts: NpcFactionAlerts, now: number, canSee: (from: LivePoint, to: LivePoint) => boolean = () => true): NpcSquadPlan[] {
  for (const plan of plans) {
    const camp = campaign.squads.find(entry => entry.squadId === plan.id)!;
    const state = states.get(plan.id), residents = plan.memberIds.flatMap(id => { const actor = actors.get(id); return actor && actor.health > 0 ? [actor] : []; });
    if (camp.baseId !== null && owners.get(camp.baseId) !== plan.faction) {
      const lostBaseId = camp.baseId, loss = alerts.losses.find(order => order.siteId === lostBaseId && order.faction === plan.faction && order.kind === 'base');
      camp.lostBaseId = lostBaseId; camp.lossId = loss?.id ?? null;
      camp.lossRoster = residents.map(actor => ({ id: actor.id, lifeCycle: actor.lifeCycle }));
      camp.baseId = chooseNpcRefuge(geometry, lostBaseId, plan.faction, owners); camp.regroupUntil = 0;
      const lostBase = geometry.bases.find(base => base.id === lostBaseId)!;
      camp.holdPoint = camp.baseId ? null : lostBase.escapePoints[0] ? copy(lostBase.escapePoints[0]) : null;
      camp.relocateUntil = now + (camp.baseId ? NPC_CAMPAIGN_RETREAT_MS : NPC_CAMPAIGN_STRANDED_WITHDRAW_MS);
      if (state) {
        state.phase = 'return'; state.missionKind = 'capture'; state.targetId = null; state.responseId = null; state.localDefense = false; state.evacuating = true;
        state.members = camp.lossRoster.map(member => ({ ...member })); state.leaderId = state.members[0]?.id ?? null;
        state.phaseUntil = camp.relocateUntil; state.returnUntil = camp.relocateUntil; state.missionUntil = camp.relocateUntil;
        state.retreating = true; state.outcome = 'unavailable'; state.trail = []; state.waitSince = null;
      }
    }
    if (camp.baseId === null && camp.lostBaseId) {
      const refuge = chooseNpcRefuge(geometry, camp.lostBaseId, plan.faction, owners)
        ?? (owners.get(camp.lostBaseId) === plan.faction ? camp.lostBaseId : null);
      if (refuge) {
        camp.baseId = refuge; camp.holdPoint = null; camp.relocateUntil = now + NPC_CAMPAIGN_RETREAT_MS; camp.regroupUntil = 0;
        if (state) { state.phase = 'return'; state.missionKind = 'capture'; state.targetId = null; state.responseId = null; state.localDefense = false;
          state.evacuating = true; state.retreating = true; state.returnUntil = camp.relocateUntil; state.phaseUntil = camp.relocateUntil;
          state.members = residents.filter(actor => camp.lossRoster.some(member => member.id === actor.id && member.lifeCycle === actor.lifeCycle)).map(actor => ({ id: actor.id, lifeCycle: actor.lifeCycle }));
          state.leaderId = state.members[0]?.id ?? null; state.trail = []; state.waitSince = null; }
      }
    }
    if (camp.baseId && camp.relocateUntil) {
      const base = geometry.bases.find(base => base.id === camp.baseId)!, survivors = residents.filter(actor => camp.lossRoster.some(member => member.id === actor.id && member.lifeCycle === actor.lifeCycle));
      if (survivors.length && survivors.every(actor => distance(actor, base.point) <= 6 && canSee(actor, base.point))) {
        camp.relocateUntil = 0; camp.regroupUntil = now + NPC_CAMPAIGN_REGROUP_MS;
        if (state) { state.phase = 'rest'; state.evacuating = false; state.restUntil = camp.regroupUntil; state.phaseUntil = camp.regroupUntil;
          state.targetId = null; state.responseId = null; state.localDefense = false; state.members = []; state.leaderId = null; state.trail = []; state.waitSince = null; }
      } else if (now >= camp.relocateUntil) {
        // A blocked route cannot turn remote survivors into an assembled crew.
        // Keep the real refuge for later walking, but spend this loss response.
        const loss = alerts.losses.find(order => order.id === camp.lossId); if (loss?.status === 'pending') loss.status = 'spent';
        camp.relocateUntil = 0; camp.regroupUntil = 0;
        if (state) state.evacuating = false;
      }
    }
    if (camp.regroupUntil && now >= camp.regroupUntil) camp.regroupUntil = 0;
    if (camp.lossId && !camp.relocateUntil && !camp.regroupUntil && !alerts.losses.some(order => order.id === camp.lossId)) { camp.lossId = null; camp.lossRoster = []; }
  }
  return npcCampaignPlans(geometry, campaign, plans);
}

/** The caller invokes this only after physically completing the base capture. */
export function occupyNpcBase(campaign: NpcCampaignState, squadId: string, baseId: string, _now: number): void {
  const camp = campaign.squads.find(entry => entry.squadId === squadId); if (!camp) return;
  camp.baseId = baseId; camp.lostBaseId = null; camp.lossId = null; camp.lossRoster = [];
  camp.relocateUntil = 0; camp.regroupUntil = 0; camp.holdPoint = null;
}
