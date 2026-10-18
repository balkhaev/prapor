import { describe, expect, test } from 'bun:test';
import { createNpcFactionAlerts, recordNpcBaseContact, recordNpcTerritoryLoss, restoreNpcFactionAlerts, reconcileNpcFactionAlerts,
  NPC_RETAKE_DELAY_MS, NPC_RETAKE_EXPIRES_MS, NPC_BASE_RETAKE_EXPIRES_MS } from '../server/live-faction-alerts';
import type { NpcSquadPlan, NpcTerritoryPlan } from '../server/live-squads';

const NOW = 1_800_000_000_000;
function fixture() {
  const plans: NpcSquadPlan[] = [
    { id: 'squad-customs-scavs-0', faction: 'scavs', districtId: 'customs', baseId: 'original-base', base: { x: 10, y: 10 },
      memberIds: ['one', 'two'], spawnIndices: [0, 1], rallyPoints: [{ x: 10, y: 10 }, { x: 12, y: 10 }], targets: [],
      responseTargets: [{ territoryId: 'control', kind: 'control', point: { x: 20, y: 20 }, pathLength: 20 }] },
    { id: 'squad-sawmill-raiders-0', faction: 'raiders', districtId: 'sawmill', baseId: 'refuge-base', base: { x: 200, y: 10 },
      memberIds: ['three', 'four'], spawnIndices: [2, 3], rallyPoints: [{ x: 200, y: 10 }, { x: 202, y: 10 }], targets: [], responseTargets: [] },
  ];
  const territories: NpcTerritoryPlan[] = [...plans.map(plan => ({ id: plan.baseId, poiId: plan.baseId, point: plan.base, districtId: plan.districtId, initialOwner: plan.faction })),
    { id: 'control', poiId: 'control', point: { x: 20, y: 20 }, districtId: 'customs', initialOwner: 'scavs' }];
  const owners = new Map(territories.map(site => [site.id, site.initialOwner]));
  return { plans, territories, owners, alerts: createNpcFactionAlerts() };
}

describe('captured base alert persistence', () => {
  test('a captured base restores its current owner and spent helper despite the helper having no authored route', () => {
    const f = fixture(); f.owners.set('original-base', 'raiders');
    const alarm = recordNpcBaseContact(f.alerts, 'original-base', 'raiders', NOW);
    alarm.homeRecalled = true; alarm.helperSquadId = f.plans[1]!.id;
    const restored = restoreNpcFactionAlerts(f.plans, f.territories, structuredClone(f.alerts), NOW + 1000, f.owners);
    expect(restored.alarms).toEqual([alarm]);
    expect(recordNpcBaseContact(restored, 'original-base', 'raiders', NOW + 2000).helperSquadId).toBe(alarm.helperSquadId);
    expect(restored.alarms[0]!.openedAt).toBe(NOW);
    // Omitting owners retains the pre-capture, authored ownership semantics.
    expect(restoreNpcFactionAlerts(f.plans, f.territories, f.alerts, NOW + 1000).alarms).toHaveLength(0);
    const wrongHelper = structuredClone(f.alerts); wrongHelper.alarms[0]!.helperSquadId = f.plans[0]!.id;
    expect(restoreNpcFactionAlerts(f.plans, f.territories, wrongHelper, NOW + 1000, f.owners).alarms).toHaveLength(0);
  });

  test('physical ownership loss retires the defeated alarm and creates exactly one finite base-loss epoch', () => {
    const f = fixture(); recordNpcBaseContact(f.alerts, 'original-base', 'scavs', NOW);
    const loss = recordNpcTerritoryLoss(f.alerts, 'original-base', 'scavs', 'raiders', NOW + 1000, 'base')!;
    expect(f.alerts.alarms).toHaveLength(0); expect(loss.kind).toBe('base');
    expect(loss.readyAt).toBe(NOW + 1000 + NPC_RETAKE_DELAY_MS);
    expect(loss.expiresAt).toBe(NOW + 1000 + NPC_BASE_RETAKE_EXPIRES_MS);
    expect(recordNpcTerritoryLoss(f.alerts, 'original-base', 'scavs', 'raiders', NOW + 1000, 'base')).toBe(loss);
    expect(f.alerts.losses).toHaveLength(1);
    f.owners.set('original-base', 'raiders');
    const restored = restoreNpcFactionAlerts(f.plans, f.territories, f.alerts, NOW + NPC_RETAKE_EXPIRES_MS + 2000, f.owners);
    expect(restored.losses).toEqual([loss]);
    reconcileNpcFactionAlerts(restored, f.owners, loss.expiresAt);
    expect(restored.losses[0]!.status).toBe('spent');
    expect(restored.losses[0]!.expiresAt).toBe(loss.expiresAt);
    const afterRestart = restoreNpcFactionAlerts(f.plans, f.territories, restored, loss.expiresAt + 1000, f.owners);
    expect(afterRestart.losses).toEqual(restored.losses);
  });

  test('base retake budgets survive relocation across district and route changes, including the original home squad', () => {
    const f = fixture();
    const loss = recordNpcTerritoryLoss(f.alerts, 'original-base', 'raiders', 'scavs', NOW, 'base')!;
    loss.status = 'assigned'; loss.assignedSquadId = f.plans[1]!.id;
    expect(restoreNpcFactionAlerts(f.plans, f.territories, f.alerts, NOW + 1000, f.owners).losses).toEqual([loss]);
    const foreign = structuredClone(f.alerts); foreign.losses[0]!.assignedSquadId = f.plans[0]!.id;
    expect(restoreNpcFactionAlerts(f.plans, f.territories, foreign, NOW + 1000, f.owners).losses).toHaveLength(0);
    const own = recordNpcTerritoryLoss(f.alerts, 'original-base', 'scavs', 'raiders', NOW + 2000, 'base')!;
    own.status = 'spent'; own.assignedSquadId = f.plans[0]!.id; f.owners.set('original-base', 'raiders');
    expect(restoreNpcFactionAlerts(f.plans, f.territories, f.alerts, NOW + 3000, f.owners).losses).toEqual([own]);
  });

  test('legacy control losses keep their deadline while mismatched kinds and noncanonical base IDs are rejected', () => {
    const f = fixture(), control = recordNpcTerritoryLoss(f.alerts, 'control', 'scavs', 'raiders', NOW)!;
    delete control.kind;
    expect(control.expiresAt).toBe(NOW + NPC_RETAKE_EXPIRES_MS);
    expect(restoreNpcFactionAlerts(f.plans, f.territories, f.alerts, NOW + 1000).losses).toEqual([control]);
    for (const change of [{ kind: null }, { kind: 'base' }, { kind: 'unlimited' }, { siteId: 'original-base' }, { siteId: 'unknown-base' }, { expiresAt: NOW + NPC_BASE_RETAKE_EXPIRES_MS }]) {
      const bad = structuredClone(f.alerts); Object.assign(bad.losses[0]!, change);
      expect(restoreNpcFactionAlerts(f.plans, f.territories, bad, NOW + 1000).losses).toHaveLength(0);
    }
  });

  test('a relocated control responder keeps its assigned budget without an authored route in the old district', () => {
    const f = fixture(), loss = recordNpcTerritoryLoss(f.alerts, 'control', 'raiders', 'scavs', NOW)!;
    loss.status = 'assigned'; loss.assignedSquadId = f.plans[1]!.id;
    expect(f.plans[1]!.responseTargets).toEqual([]);
    expect(restoreNpcFactionAlerts(f.plans, f.territories, f.alerts, NOW + 1000, f.owners).losses).toEqual([loss]);
  });

  test('reconciliation removes an old owner alarm immediately and recapture starts a new loss cycle only for the new loser', () => {
    const f = fixture(), alarm = recordNpcBaseContact(f.alerts, 'original-base', 'scavs', NOW);
    alarm.helperSquadId = f.plans[0]!.id;
    f.owners.set('original-base', 'raiders');
    reconcileNpcFactionAlerts(f.alerts, f.owners, NOW + 1);
    expect(f.alerts.alarms).toHaveLength(0);
    const loss = recordNpcTerritoryLoss(f.alerts, 'original-base', 'scavs', 'raiders', NOW + 2, 'base')!;
    loss.status = 'spent';
    const next = recordNpcTerritoryLoss(f.alerts, 'original-base', 'raiders', 'scavs', NOW + 100_000, 'base')!;
    f.owners.set('original-base', 'scavs'); reconcileNpcFactionAlerts(f.alerts, f.owners, NOW + 100_000);
    expect(f.alerts.losses).toEqual([next]); expect(next.id).not.toBe(loss.id); expect(next.faction).toBe('raiders');
    expect(next.status).toBe('pending');
  });
});
