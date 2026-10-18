import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveService } from '../server/live';
import type { EconomyLoot } from '../server/live-economy';
import { readNpcCacheInventory, readNpcInventory, type NpcInventory } from '../server/live-npc-loot';
import { createLiveNavigation } from '../server/live-navigation';
import { buildNpcSquadPlans, npcSquadCountsExpedition, type NpcSquadState } from '../server/live-squads';
import type { NpcFactionAlerts } from '../server/live-faction-alerts';
import type { NpcCampaignState } from '../server/live-npc-campaign';
import { getLiveBossArenas } from '../src/game/live-boss-arenas';
import { getLiveMap } from '../src/game/live-maps';
import type { LiveEvent, LivePoint } from '../src/game/live';

interface Actor extends LivePoint { id: string; health: number; faction: 'scavs' | 'raiders'; npcInventory?: NpcInventory; npcGeneration?: number }
interface Drop { id: string; source?: string; items?: EconomyLoot[]; amount: number; expiresAt: number; npcBase?: { id: string; faction: string } }
interface SavedWorld {
  scavs: Actor[]; drops: Drop[]; events: LiveEvent[];
  npcSquads?: NpcSquadState[];
  territoryOwners?: Array<[string, string | null]>;
  npcForageCooldowns?: Array<[string, number]>;
  npcFactionAlerts?: NpcFactionAlerts;
  npcCampaign?: NpcCampaignState;
}
interface OwnedItem { item: EconomyLoot; owner: string; kind: string; expiresAt: number }
const fingerprint = (item: EconomyLoot) => JSON.stringify([item.id, item.modelId, item.kind ?? 'loot', item.foundAt, 'durability' in item ? item.durability : null]);

/** A physical-item audit of the production simulation, including a real 20 Hz probe. */
export function runSquadBalance(seconds = 1800) {
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 7200) throw new Error('Choose 1–7200 simulated seconds');
  const world = getLiveMap('perimeter'), directory = mkdtempSync(join(tmpdir(), 'prapor-squad-balance-'));
  const arenas = getLiveBossArenas(world);
  const geometry = buildNpcSquadPlans(world, createLiveNavigation(world), point => arenas.some(arena => point.x >= arena.area.x
    && point.y >= arena.area.y && point.x < arena.area.x + arena.area.width && point.y < arena.area.y + arena.area.height));
  const plans = new Map(geometry.squads.map(plan => [plan.id, plan]));
  const bases = new Map(geometry.squads.map(plan => [plan.baseId, plan]));
  const planByActor = new Map(geometry.squads.flatMap(plan => plan.memberIds.map(id => [id, plan] as const)));
  const authoredBaseByActor = new Map(planByActor);
  for (const [index, spawn] of world.npcSpawns.entries()) {
    const id = `scav-${world.id}-${index}`; if (authoredBaseByActor.has(id)) continue;
    const poi = world.pois.filter(poi => spawn.point.x >= poi.x && spawn.point.y >= poi.y && spawn.point.x < poi.x + poi.width && spawn.point.y < poi.y + poi.height)
      .sort((a, b) => a.width * a.height - b.width * b.height)[0];
    const base = poi && bases.get(poi.id);
    if (base && base.faction === spawn.faction && Math.hypot(spawn.point.x - base.base.x, spawn.point.y - base.base.y) <= 18) authoredBaseByActor.set(id, base);
  }
  const operationalBase = (saved: SavedWorld, squadId: string) => {
    const camp = saved.npcCampaign?.squads.find(camp => camp.squadId === squadId);
    return camp ? camp.baseId ? bases.get(camp.baseId) : undefined : plans.get(squadId);
  };
  let time = 1_800_000_000_000, seed = 97331;
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
  const options = { dbPath: join(directory, 'live.sqlite'), now: () => time, random, automaticTicks: false,
    economy: { resolve: () => { throw new Error('No player enters this simulation'); },
      deliver: () => ({ ok: true, message: 'No deliveries' }), supply: () => ({ ammo: 0, medkits: 0, message: 'No supplies' }) } };
  let service = createLiveService(options);
  const db = new Database(options.dbPath, { readonly: true });
  const statement = db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1');
  const read = (): SavedWorld => JSON.parse(statement.get()!.state);
  const blocked = new Uint8Array(world.width * world.height);
  for (const obstacle of world.obstacles) for (let y = obstacle.y; y < obstacle.y + obstacle.height; y++) for (let x = obstacle.x; x < obstacle.x + obstacle.width; x++) blocked[y * world.width + x] = 1;
  if (world.terrainRows) for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) if (world.terrainRows[y]?.[x] === 'w') blocked[y * world.width + x] = 1;
  const metrics = { seconds, population: world.npcSpawns.length, squads: 0, healthy: true, restarts: 0,
    uniqueItems: 0, expiredBodyItems: 0, foragedItems: 0, depositedItems: 0, carriedDeathItems: 0,
    duplicateItems: 0, mutatedItems: 0, unexplainedLosses: 0, resurrectedItems: 0, invalidBirths: 0, capacityErrors: 0,
    illegalSteps: 0, collisions: 0, populationChanges: 0, totalSteps: 0, captures: 0, completedForages: 0, completedDeposits: 0,
    siteCooldownViolations: 0, minimumSupplyContainers: Number.MAX_SAFE_INTEGER, maximumCaches: 0, maximumCarriers: 0,
    final: { itemsInSupplies: 0, itemsInBodies: 0, itemsInCarriers: 0, itemsInBases: 0, caches: 0, alive: 0 },
    squadPhases: {} as Record<string, number>, changedTerritories: [] as string[],
    responses: { alarms: 0, losses: 0, homeRecalls: 0, helperDispatches: 0, retakeDispatches: 0, completedRetakes: 0,
      maximumPendingRetakes: 0, traveledSteps: 0, budgetViolations: 0, departureViolations: 0, generationReplacements: 0, deadlineViolations: 0,
      samples: {} as Record<string, number> },
    campaign: { assaultDispatches: 0, baseCaptures: 0, relocations: 0, displacedSurvivors: 0, refugeArrivals: 0, survivorCounterattacks: 0, strandedGroups: 0, evacuationSteps: 0,
      unsafeAssaultDepartures: 0, prematureCounterattacks: 0, replacedSurvivors: 0, hostileRespawns: 0, invalidCacheOwners: 0, healthGainViolations: 0 },
    districtActivity: Object.fromEntries(world.districts.map(district => [district.id, { squads: geometry.squads.filter(plan => plan.districtId === district.id).length,
      activeSamples: 0, restSamples: 0, localDefenseSamples: 0, maximumActive: 0, launchedMissions: 0, finalActive: 0, finalRest: 0 }])),
    finalSquads: [] as Array<Pick<NpcSquadState, 'id' | 'phase' | 'missionKind' | 'cycle' | 'outcome' | 'targetId' | 'responseId' | 'localDefense' | 'evacuating'> & { districtId: string; operatingBaseId: string | null }>,
    finalCarriers: [] as Array<{ id: string; items: number; money: number; point: LivePoint; baseId: string | null; base: LivePoint | null; distanceToBase: number | null }>,
    minutes: [] as Array<{ minute: number; alive: number; moving: number; carriers: number; caches: number; supplies: number }>,
    errors: [] as string[], elapsedMs: 0, productionCadence: { ticks: 600, p50: 0, p95: 0, max: 0 } };
  const known = new Map<string, string>(), retired = new Set<string>(), events = new Set<string>(), sites = new Map<string, number>();
  const changedTerritories = new Set<string>(), minuteMovers = new Set<string>();
  const alarms = new Set<string>(), losses = new Set<string>(), recalls = new Set<string>(), helpers = new Map<string, string>(), retakes = new Map<string, string>();
  const manifests = new Map<string, string>(), launches = new Map<string, number>();
  const assaults = new Set<string>(), relocations = new Set<string>(), refugeArrivals = new Set<string>(), survivorCounterattacks = new Set<string>(), stranded = new Set<string>();
  let previous = new Map<string, OwnedItem>(), previousActors = new Map<string, Actor>(), previousOwners = new Map<string, string | null>();
  const error = (message: string) => { if (metrics.errors.length < 12) metrics.errors.push(message); };
  function sample(initial = false) {
    const saved = read(), current = new Map<string, OwnedItem>(), occupied = new Set<number>(), squadStates = new Map((saved.npcSquads ?? []).map(state => [state.id, state]));
    const owners = new Map(saved.territoryOwners ?? []), camps = new Map((saved.npcCampaign?.squads ?? []).map(camp => [camp.squadId, camp]));
    const supplies = saved.drops.filter(drop => drop.source === 'supply'), caches = saved.drops.filter(drop => drop.source === 'base');
    const carriers = saved.scavs.filter(actor => actor.npcInventory && (actor.npcInventory.items.length || actor.npcInventory.money));
    metrics.squads = saved.npcSquads?.length ?? 0; metrics.healthy &&= service.healthy();
    metrics.minimumSupplyContainers = Math.min(metrics.minimumSupplyContainers, supplies.length);
    metrics.maximumCaches = Math.max(metrics.maximumCaches, caches.length); metrics.maximumCarriers = Math.max(metrics.maximumCarriers, carriers.length);
    if (saved.scavs.length !== metrics.population) metrics.populationChanges++;
    function add(item: EconomyLoot, owner: string, kind: string, expiresAt = Number.MAX_SAFE_INTEGER) {
      if (current.has(item.id)) { metrics.duplicateItems++; error(`Duplicate ${item.id}: ${current.get(item.id)!.owner} and ${owner}`); }
      const hash = fingerprint(item);
      if (!known.has(item.id)) {
        known.set(item.id, hash);
        if (!initial && !['supply', 'body'].includes(kind)) { metrics.invalidBirths++; error(`New item first appears in ${owner}`); }
      } else if (known.get(item.id) !== hash) { metrics.mutatedItems++; error(`Changed physical item ${item.id}`); }
      if (retired.has(item.id)) { metrics.resurrectedItems++; error(`Expired item returned ${item.id}`); }
      const old = previous.get(item.id);
      if (old?.kind === 'supply' && kind === 'carrier') metrics.foragedItems++;
      if (old?.kind === 'carrier' && kind === 'base') metrics.depositedItems++;
      if (old?.kind === 'carrier' && kind === 'body') metrics.carriedDeathItems++;
      current.set(item.id, { item, owner, kind, expiresAt });
    }
    for (const drop of saved.drops) {
      if (drop.source === 'base') try { readNpcCacheInventory({ items: drop.items ?? [], money: drop.amount }); }
      catch { metrics.capacityErrors++; error(`Invalid cache ${drop.id}`); }
      if (drop.source === 'base' && drop.npcBase && owners.get(drop.npcBase.id) !== drop.npcBase.faction) {
        metrics.campaign.invalidCacheOwners++; error(`Cache ${drop.id} does not belong to its physical base owner`);
      }
      for (const item of drop.items ?? []) add(item, `drop:${drop.id}`, drop.source ?? 'body', drop.expiresAt);
    }
    for (const actor of saved.scavs) {
      try { readNpcInventory(actor.npcInventory); } catch { metrics.capacityErrors++; error(`Invalid inventory ${actor.id}`); }
      for (const item of actor.npcInventory?.items ?? []) add(item, `npc:${actor.id}`, 'carrier');
      if (actor.health <= 0) continue;
      const key = actor.y * world.width + actor.x;
      if (actor.x < 0 || actor.y < 0 || actor.x >= world.width || actor.y >= world.height || !Number.isInteger(key) || blocked[key]) metrics.illegalSteps++;
      if (occupied.has(key)) metrics.collisions++; occupied.add(key);
      const old = previousActors.get(actor.id);
      const authoredBase = authoredBaseByActor.get(actor.id);
      if (old && old.health <= 0 && authoredBase && owners.get(authoredBase.baseId) !== actor.faction) {
        metrics.campaign.hostileRespawns++; error(`${actor.id} replenished after losing its authored base`);
      }
      if (old && old.health > 0 && old.npcGeneration === actor.npcGeneration) {
        if (actor.health > old.health + .01) { metrics.campaign.healthGainViolations++; error(`${actor.id} healed during its existing generation`); }
        const step = Math.abs(actor.x - old.x) + Math.abs(actor.y - old.y);
        if (step > 1) metrics.illegalSteps++;
        if (step) minuteMovers.add(actor.id); metrics.totalSteps += step;
        const plan = planByActor.get(actor.id); if (plan && squadStates.get(plan.id)?.responseId) metrics.responses.traveledSteps += step;
        if (plan && squadStates.get(plan.id)?.evacuating) metrics.campaign.evacuationSteps += step;
      }
    }
    for (const [id, old] of previous) if (!current.has(id)) {
      if (old.kind === 'body' && old.expiresAt <= time) { metrics.expiredBodyItems++; retired.add(id); }
      else { metrics.unexplainedLosses++; error(`Lost ${id} from ${old.owner} at ${time}`); }
    }
    for (const [id, until] of saved.npcForageCooldowns ?? []) {
      const old = sites.get(id); if (old !== undefined && until > old && until - old < 180_000) { metrics.siteCooldownViolations++; error(`Foraged ${id} again before 180 seconds`); }
      sites.set(id, until);
    }
    for (const event of saved.events) if (!events.has(event.id)) {
      events.add(event.id);
      if (event.text.includes('забрал припасы')) metrics.completedForages++;
      if (event.text.includes('доставил добычу на базу')) metrics.completedDeposits++;
      if (event.text.includes('взял под контроль') || event.text.includes('отбил') || event.text.includes('захватил базу')) metrics.captures++;
      if (event.text.includes('отбил')) metrics.responses.completedRetakes++;
    }
    for (const alarm of saved.npcFactionAlerts?.alarms ?? []) {
      alarms.add(alarm.id); if (alarm.homeRecalled) recalls.add(alarm.id);
      if (alarm.helperSquadId) {
        if (helpers.has(alarm.id) && helpers.get(alarm.id) !== alarm.helperSquadId) { metrics.responses.budgetViolations++; error(`Second helper for ${alarm.id}`); }
        helpers.set(alarm.id, alarm.helperSquadId);
      }
    }
    const orders = saved.npcFactionAlerts?.losses ?? [];
    metrics.responses.maximumPendingRetakes = Math.max(metrics.responses.maximumPendingRetakes, orders.filter(order => order.status === 'pending').length);
    for (const order of orders) {
      losses.add(order.id);
      if (order.assignedSquadId) {
        if (retakes.has(order.id) && retakes.get(order.id) !== order.assignedSquadId) { metrics.responses.budgetViolations++; error(`Second retaliation for ${order.id}`); }
        retakes.set(order.id, order.assignedSquadId);
      }
    }
    const activeByDistrict = new Map<string, number>();
    for (const squad of saved.npcSquads ?? []) {
      const phase = squad.phase ?? 'unknown'; metrics.squadPhases[phase] = (metrics.squadPhases[phase] ?? 0) + 1;
      const plan = plans.get(squad.id), base = operationalBase(saved, squad.id), districtId = base?.districtId ?? plan?.districtId;
      const district = districtId && metrics.districtActivity[districtId];
      if (district) {
        if (phase === 'rest') district.restSamples++;
        else {
          district.activeSamples++;
          if (squad.localDefense) district.localDefenseSamples++;
          else if (plan && npcSquadCountsExpedition({ ...plan, baseId: base?.baseId ?? plan.baseId, districtId: base?.districtId ?? plan.districtId }, squad)) {
            activeByDistrict.set(districtId!, (activeByDistrict.get(districtId!) ?? 0) + 1);
          }
        }
      }
      if (squad.missionKind === 'assault' && squad.members.length && plan) {
        const key = `${squad.id}:${squad.startedAt}`;
        if (!assaults.has(key)) {
          assaults.add(key);
          for (const member of squad.members) {
            const actor = previousActors.get(member.id) ?? saved.scavs.find(actor => actor.id === member.id);
            if (!actor || !base || owners.get(base.baseId) !== plan.faction || Math.hypot(actor.x - base.base.x, actor.y - base.base.y) > 6) {
              metrics.campaign.unsafeAssaultDepartures++; error(`Assault ${key} dispatched away from an owned base`);
            }
          }
        }
      }
      if (squad.responseId && plan) {
        const key = `${squad.responseId}:${squad.id}`, manifest = JSON.stringify(squad.members);
        metrics.responses.samples[squad.missionKind] = (metrics.responses.samples[squad.missionKind] ?? 0) + 1;
        if (!launches.has(key)) {
          launches.set(key, squad.startedAt); manifests.set(key, manifest);
          if (squad.missionKind === 'retake' || squad.targetId !== base?.baseId) {
            for (const member of squad.members) {
              const actor = previousActors.get(member.id) ?? saved.scavs.find(actor => actor.id === member.id);
              if (!actor || !base || owners.get(base.baseId) !== plan.faction || Math.hypot(actor.x - base.base.x, actor.y - base.base.y) > 6) { metrics.responses.departureViolations++; error(`Response ${key} dispatched away from an owned base`); }
            }
          }
        } else {
          if (launches.get(key) !== squad.startedAt) { metrics.responses.budgetViolations++; error(`Response ${key} launched again`); launches.set(key, squad.startedAt); }
          if (manifests.get(key) !== manifest) { metrics.responses.generationReplacements++; error(`Response ${key} replaced its manifest`); manifests.set(key, manifest); }
        }
        if (!['rest', 'return'].includes(phase) && time >= squad.missionUntil + 1000) { metrics.responses.deadlineViolations++; error(`Expired response ${key} is still active`); }
      }
      const camp = camps.get(squad.id);
      if (camp?.lostBaseId && camp.lossId) {
        const key = `${camp.squadId}:${camp.lossId}`;
        if (!relocations.has(key)) metrics.campaign.displacedSurvivors += camp.lossRoster.length;
        relocations.add(key);
        if (camp.baseId === null) stranded.add(key);
        if (camp.regroupUntil) refugeArrivals.add(`${key}:${camp.baseId}`);
        if (squad.missionKind === 'retake' && squad.responseId && squad.responseId === camp.lossId) {
          survivorCounterattacks.add(key);
          if (camp.relocateUntil || camp.regroupUntil > time) { metrics.campaign.prematureCounterattacks++; error(`Survivors ${key} counterattacked before refuge arrival and regroup`); }
          if (squad.members.some(member => !camp.lossRoster.some(survivor => survivor.id === member.id && survivor.lifeCycle === member.lifeCycle))) {
            metrics.campaign.replacedSurvivors++; error(`Survivors ${key} were replaced before counterattack`);
          }
        }
      }
    }
    for (const [id, active] of activeByDistrict) metrics.districtActivity[id]!.maximumActive = Math.max(metrics.districtActivity[id]!.maximumActive, active);
    for (const [id, owner] of saved.territoryOwners ?? []) if (previousOwners.has(id) && previousOwners.get(id) !== owner) {
      changedTerritories.add(id); if (bases.has(id)) metrics.campaign.baseCaptures++;
    }
    metrics.final = { itemsInSupplies: [...current.values()].filter(item => item.kind === 'supply').length,
      itemsInBodies: [...current.values()].filter(item => item.kind === 'body').length,
      itemsInCarriers: [...current.values()].filter(item => item.kind === 'carrier').length,
      itemsInBases: [...current.values()].filter(item => item.kind === 'base').length,
      caches: caches.length, alive: saved.scavs.filter(actor => actor.health > 0).length };
    previous = current; previousActors = new Map(saved.scavs.map(actor => [actor.id, actor])); previousOwners = new Map(saved.territoryOwners ?? []);
    return { alive: metrics.final.alive, carriers: carriers.length, caches: caches.length, supplies: supplies.length };
  }
  const began = performance.now();
  try {
    sample(true);
    for (let second = 1; second <= seconds; second++) {
      time += 1000; service.tick(); const frame = sample();
      if (second % 60 === 0 || second === seconds) {
        metrics.minutes.push({ minute: Math.ceil(second / 60), moving: minuteMovers.size, ...frame }); minuteMovers.clear();
      }
      if (second % 300 === 0 && second < seconds) {
        service.close(); service = createLiveService(options); metrics.restarts++; sample();
      }
    }
    const final = read();
    metrics.finalSquads = (final.npcSquads ?? []).map(({ id, phase, missionKind, cycle, outcome, targetId, responseId, localDefense, evacuating }) => {
      const base = operationalBase(final, id), districtId = base?.districtId ?? plans.get(id)?.districtId ?? 'unknown', district = metrics.districtActivity[districtId];
      if (district) { district.launchedMissions += cycle; if (phase === 'rest') district.finalRest++; else district.finalActive++; }
      return { id, districtId, phase, missionKind, cycle, outcome, targetId, responseId, localDefense, evacuating, operatingBaseId: base?.baseId ?? null };
    });
    metrics.finalCarriers = final.scavs.filter(actor => actor.npcInventory && (actor.npcInventory.items.length || actor.npcInventory.money)).map(actor => {
      const authored = planByActor.get(actor.id), plan = authored && operationalBase(final, authored.id);
      return { id: actor.id, items: actor.npcInventory!.items.length, money: actor.npcInventory!.money, point: { x: actor.x, y: actor.y },
        baseId: plan?.baseId ?? null, base: plan ? { ...plan.base } : null,
        distanceToBase: plan ? Math.round(Math.hypot(actor.x - plan.base.x, actor.y - plan.base.y) * 100) / 100 : null };
    });
    const ticks: number[] = [];
    for (let tick = 0; tick < 600; tick++) { time += 50; const began = performance.now(); service.tick(); ticks.push(performance.now() - began); }
    metrics.healthy &&= service.healthy(); ticks.sort((a, b) => a - b);
    metrics.productionCadence = { ticks: ticks.length, p50: Math.round(ticks[300]! * 100) / 100, p95: Math.round(ticks[570]! * 100) / 100, max: Math.round(ticks.at(-1)! * 100) / 100 };
    metrics.uniqueItems = known.size; metrics.changedTerritories = [...changedTerritories]; metrics.elapsedMs = Math.round(performance.now() - began);
    Object.assign(metrics.responses, { alarms: alarms.size, losses: losses.size, homeRecalls: recalls.size, helperDispatches: helpers.size, retakeDispatches: retakes.size });
    Object.assign(metrics.campaign, { assaultDispatches: assaults.size, relocations: relocations.size, refugeArrivals: refugeArrivals.size, survivorCounterattacks: survivorCounterattacks.size, strandedGroups: stranded.size });
    return metrics;
  } finally { db.close(); service.close(); rmSync(directory, { recursive: true, force: true }); }
}

if (import.meta.main) {
  const result = runSquadBalance(Number(Bun.argv[2]) || 1800);
  console.log(JSON.stringify(result, null, 2));
  if (!result.healthy || result.duplicateItems || result.mutatedItems || result.unexplainedLosses || result.resurrectedItems || result.invalidBirths
    || result.capacityErrors || result.illegalSteps || result.collisions || result.populationChanges || result.siteCooldownViolations
    || result.responses.budgetViolations || result.responses.departureViolations || result.responses.generationReplacements || result.responses.deadlineViolations
    || result.campaign.unsafeAssaultDepartures || result.campaign.prematureCounterattacks || result.campaign.replacedSurvivors || result.campaign.hostileRespawns
    || result.campaign.invalidCacheOwners || result.campaign.healthGainViolations) process.exitCode = 1;
}
