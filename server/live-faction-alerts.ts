import type { NpcSquadFaction, NpcSquadPlan, NpcTerritoryPlan } from './live-squads';

export const NPC_BASE_ALARM_QUIET_MS = 60_000;
export const NPC_RESPONSE_DISPATCH_MS = 90_000;
export const NPC_RESPONSE_MUSTER_MS = 8_000;
export const NPC_RESPONSE_MISSION_MS = 360_000;
export const NPC_RESPONSE_RETURN_MS = 240_000;
export const NPC_RETAKE_DELAY_MS = 20_000;
export const NPC_RETAKE_EXPIRES_MS = 600_000;
export interface NpcBaseAlarm {
  id: string; baseId: string; faction: NpcSquadFaction;
  openedAt: number; lastContactAt: number; homeRecalled: boolean; helperSquadId: string | null;
}
export interface NpcRetakeOrder {
  id: string; siteId: string; faction: NpcSquadFaction;
  lostAt: number; readyAt: number; expiresAt: number;
  assignedSquadId: string | null; status: 'pending' | 'assigned' | 'spent';
}
export interface NpcFactionAlerts { nextEpoch: number; alarms: NpcBaseAlarm[]; losses: NpcRetakeOrder[] }
export const createNpcFactionAlerts = (): NpcFactionAlerts => ({ nextEpoch: 1, alarms: [], losses: [] });
const faction = (value: unknown): value is NpcSquadFaction => value === 'scavs' || value === 'raiders';
const timestamp = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const epochOf = (value: unknown, prefix: 'base' | 'loss'): number | null => {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}-[1-9][0-9]{0,8}$`).test(value)) return null;
  return Number(value.slice(prefix.length + 1));
};

/** The caller supplies only a genuine local observation, never passive player proximity. */
export function recordNpcBaseContact(state: NpcFactionAlerts, baseId: string, owner: NpcSquadFaction, now: number): NpcBaseAlarm {
  let alarm = state.alarms.find(alarm => alarm.baseId === baseId && alarm.faction === owner);
  if (alarm && now - alarm.lastContactAt < NPC_BASE_ALARM_QUIET_MS) { alarm.lastContactAt = Math.max(alarm.lastContactAt, now); return alarm; }
  state.alarms = state.alarms.filter(alarm => alarm.baseId !== baseId);
  alarm = { id: `base-${state.nextEpoch++}`, baseId, faction: owner, openedAt: now, lastContactAt: now, homeRecalled: false, helperSquadId: null };
  state.alarms.push(alarm); return alarm;
}

/** Invoke once at the actual committed ownership transition, never while polling owners. */
export function recordNpcTerritoryLoss(state: NpcFactionAlerts, siteId: string, previousOwner: NpcSquadFaction | null, newOwner: NpcSquadFaction | null, now: number): NpcRetakeOrder | null {
  if (!faction(previousOwner) || !faction(newOwner) || previousOwner === newOwner) return null;
  const duplicate = state.losses.find(order => order.siteId === siteId && order.faction === previousOwner && order.lostAt === now);
  if (duplicate) return duplicate;
  // Recapture closes the winner's previous loss cycle; the defeated faction gets
  // one new epoch. An exhausted continuously-lost point remains reserved.
  state.losses = state.losses.filter(order => order.siteId !== siteId);
  const order: NpcRetakeOrder = { id: `loss-${state.nextEpoch++}`, siteId, faction: previousOwner, lostAt: now,
    readyAt: now + NPC_RETAKE_DELAY_MS, expiresAt: now + NPC_RETAKE_EXPIRES_MS, assignedSquadId: null, status: 'pending' };
  state.losses.push(order); return order;
}

export function restoreNpcFactionAlerts(plans: readonly NpcSquadPlan[], territories: readonly NpcTerritoryPlan[], value: unknown, now: number): NpcFactionAlerts {
  const restored = createNpcFactionAlerts();
  if (!value || typeof value !== 'object') return restored;
  const stored = value as Partial<NpcFactionAlerts>;
  if (!timestamp(stored.nextEpoch) || stored.nextEpoch < 1 || stored.nextEpoch > 1_000_000_000) return restored;
  restored.nextEpoch = stored.nextEpoch;
  const seen = new Set<string>(), ids = new Set<string>();
  for (const alarm of (Array.isArray(stored.alarms) ? stored.alarms : []).slice(0, plans.length)) {
    const home = alarm && plans.find(plan => plan.baseId === alarm.baseId && plan.faction === alarm.faction);
    if (!home || epochOf(alarm.id, 'base') === null || ids.has(alarm.id) || seen.has(alarm.baseId) || !timestamp(alarm.openedAt) || !timestamp(alarm.lastContactAt)
      || alarm.lastContactAt < alarm.openedAt || alarm.lastContactAt > now || typeof alarm.homeRecalled !== 'boolean'
      || !(alarm.helperSquadId === null || plans.some(plan => plan.id === alarm.helperSquadId && plan.id !== home.id && plan.faction === alarm.faction && plan.districtId === home.districtId
        && plan.responseTargets?.some(target => target.kind === 'base' && target.territoryId === alarm.baseId)))) continue;
    if (now - alarm.lastContactAt >= NPC_BASE_ALARM_QUIET_MS) continue;
    seen.add(alarm.baseId); ids.add(alarm.id); restored.nextEpoch = Math.max(restored.nextEpoch, epochOf(alarm.id, 'base')! + 1); restored.alarms.push({ ...alarm });
  }
  seen.clear();
  for (const order of (Array.isArray(stored.losses) ? stored.losses : []).slice(0, territories.length)) {
    const site = order && territories.find(site => site.id === order.siteId && !plans.some(plan => plan.baseId === site.id));
    if (!site || epochOf(order.id, 'loss') === null || ids.has(order.id) || seen.has(order.siteId) || !faction(order.faction)
      || !timestamp(order.lostAt) || order.lostAt > now || order.readyAt !== order.lostAt + NPC_RETAKE_DELAY_MS || order.expiresAt !== order.lostAt + NPC_RETAKE_EXPIRES_MS
      || !['pending', 'assigned', 'spent'].includes(order.status)
      || !(order.assignedSquadId === null || plans.some(plan => plan.id === order.assignedSquadId && plan.faction === order.faction && plan.districtId === site.districtId
        && plan.responseTargets?.some(target => target.kind === 'control' && target.territoryId === order.siteId)))
      || order.status === 'assigned' && !order.assignedSquadId || order.status === 'pending' && order.assignedSquadId !== null) continue;
    seen.add(order.siteId); ids.add(order.id); restored.nextEpoch = Math.max(restored.nextEpoch, epochOf(order.id, 'loss')! + 1);
    restored.losses.push({ ...order, status: order.status === 'pending' && now >= order.expiresAt ? 'spent' : order.status });
  }
  return restored;
}

export function reconcileNpcFactionAlerts(state: NpcFactionAlerts, owners: ReadonlyMap<string, NpcSquadFaction | null>, now: number): void {
  state.alarms = state.alarms.filter(alarm => now - alarm.lastContactAt < NPC_BASE_ALARM_QUIET_MS);
  state.losses = state.losses.filter(order => owners.get(order.siteId) !== order.faction);
  for (const order of state.losses) if (order.status === 'pending' && now >= order.expiresAt) order.status = 'spent';
}
