import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveService } from '../server/live';
import { createLiveNavigation } from '../server/live-navigation';
import { buildNpcSquadPlans, createNpcSquadState, type NpcSquadState } from '../server/live-squads';
import { createNpcFactionAlerts, type NpcFactionAlerts } from '../server/live-faction-alerts';
import type { NpcCampaignState } from '../server/live-npc-campaign';
import type { NpcInventory } from '../server/live-npc-loot';
import type { EconomyLoot } from '../server/live-economy';
import { createHealth, type HealthState } from '../src/game/health';
import { getLiveMap } from '../src/game/live-maps';
import { getLiveBossArenas } from '../src/game/live-boss-arenas';
import type { LiveCommand, LiveDrop, LiveEntity, LiveEvent, LivePoint, LiveSnapshot } from '../src/game/live';

const NOW = 1_800_000_000_000, ORIGIN = 'https://npc-base-capture.test';
const world = getLiveMap('perimeter'), nav = createLiveNavigation(world), arenas = getLiveBossArenas(world);
const geometry = buildNpcSquadPlans(world, nav, point => arenas.some(({ area }) => point.x >= area.x && point.y >= area.y && point.x < area.x + area.width && point.y < area.y + area.height));
const attacker = geometry.squads.find(plan => plan.id === 'squad-customs-raiders-0')!;
const defeated = geometry.squads.find(plan => plan.id === 'squad-customs-scavs-2')!;
const refuge = geometry.squads.find(plan => plan.id === 'squad-customs-scavs-1')!;
const guardId = 'scav-perimeter-96';
const point = ({ x, y }: LivePoint): LivePoint => ({ x, y });
const distance = (a: LivePoint, b: LivePoint) => Math.hypot(a.x - b.x, a.y - b.y);
interface Actor extends LiveEntity {
  body: HealthState; home: LivePoint; faction: 'scavs' | 'raiders'; npcGeneration: number; npcInventory?: NpcInventory;
  nextMove: number; nextAttack: number; respawnAt: number; respawnQuietSince: number | null;
  npcGarrison?: { baseId: string | null; lostBaseId: string; lossId: string | null; retreatUntil: number; holdPoint: LivePoint; arrivedAt: number | null };
}
interface Drop extends LiveDrop { source: string; expiresAt: number; mapId: string }
interface SavedWorld {
  scavs: Actor[]; drops: Drop[]; events: LiveEvent[]; npcSquads: NpcSquadState[]; npcFactionAlerts: NpcFactionAlerts; npcCampaign?: NpcCampaignState;
  territoryOwners: Array<[string, 'scavs' | 'raiders' | null]>; lootCooldowns: Array<[string, number]>;
}
const fixtures: Array<{ close(): void }> = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.close(); });
function nearby(origin: LivePoint, radius: number) {
  return Array.from({ length: (radius * 2 + 1) ** 2 }, (_, i) => ({ x: origin.x + i % (radius * 2 + 1) - radius,
    y: origin.y + Math.floor(i / (radius * 2 + 1)) - radius })).filter(at => nav.walkable(at));
}

function fixture(survivors = false, guard = false) {
  const directory = mkdtempSync(join(tmpdir(), 'prapor-base-capture-')), dbPath = join(directory, 'live.sqlite');
  let time = NOW, playerId: string | undefined;
  const gameId = randomUUID(), options = { dbPath, now: () => time, random: () => .5, automaticTicks: false, allowedOrigins: [ORIGIN], economy: {
    resolve: () => ({ key: `test:${gameId}`, gameId, name: 'Наблюдатель' }),
    deliver: () => ({ ok: true, message: 'Доставлено' }), supply: () => ({ ammo: 0, medkits: 0, message: 'Пусто' }),
  } };
  let service = createLiveService(options), db = new Database(dbPath, { readonly: true });
  const saved = (): SavedWorld => JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state);
  function restart(edit?: (value: SavedWorld, writer: Database) => void, offlineMs = 0) {
    db.close(); service.close(); const writer = new Database(dbPath);
    try {
      const value = JSON.parse(writer.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state) as SavedWorld;
      edit?.(value, writer); writer.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(value));
      for (const row of writer.query<{ boss_id: string; state: string }, []>('SELECT boss_id,state FROM live_bosses').all()) {
        const boss = JSON.parse(row.state); Object.assign(boss, { nextMove: time + 2_000_000, nextAttack: time + 2_000_000 });
        writer.query('UPDATE live_bosses SET state=? WHERE boss_id=?').run(JSON.stringify(boss), row.boss_id);
      }
    } finally { writer.close(); }
    time += offlineMs; service = createLiveService(options); db = new Database(dbPath, { readonly: true });
  }
  function activate(actor: Actor, at: LivePoint, wounded = false) {
    Object.assign(actor, point(at), { body: createHealth(wounded ? 80 : 100), health: wounded ? 80 : 100, healthAt: time,
      npcGeneration: 0, npcInventory: { items: [], money: 0 }, nextMove: time + 2_000_000, nextAttack: time + 2_000_000,
      safeUntil: 0, aim: null, alife: undefined });
  }
  const cacheItem: EconomyLoot = { id: randomUUID(), modelId: 'coffee', foundAt: NOW };
  const carriedItem: EconomyLoot = { id: randomUUID(), modelId: 'coffee', foundAt: NOW - 1000 }, cacheId = randomUUID();
  restart(value => {
    for (const actor of value.scavs) {
      actor.body = createHealth(); actor.body.parts.head.hp = 0; actor.health = 0; actor.respawnAt = time + 2_000_000;
      actor.npcInventory = { items: [], money: 0 };
    }
    const occupied = new Set<string>(), attackPositions = [defeated.base, ...nearby(defeated.base, 3)]
      .filter(at => distance(at, defeated.base) <= 3 && nav.hasLineOfSight(at, defeated.base));
    for (const id of attacker.memberIds) {
      const at = attackPositions.find(at => !occupied.has(`${at.x},${at.y}`))!; occupied.add(`${at.x},${at.y}`);
      activate(value.scavs.find(actor => actor.id === id)!, at);
    }
    if (survivors || guard) {
      const retreatPositions = nearby(defeated.base, 24).filter(at => distance(at, defeated.base) >= 18 && distance(at, defeated.base) <= 22
        && at.x < defeated.base.x && attackPositions.slice(0, attacker.memberIds.length).every(attacker => distance(attacker, at) > 14)
        && nav.findPath(at, refuge.base)).sort((a, b) => distance(a, refuge.base) - distance(b, refuge.base));
      const ids = [...(survivors ? defeated.memberIds : []), ...(guard ? [guardId] : [])];
      for (const [index, id] of ids.entries()) activate(value.scavs.find(actor => actor.id === id)!, retreatPositions[index]!, true);
      if (survivors) value.scavs.find(actor => actor.id === defeated.memberIds[0])!.npcInventory = { items: [carriedItem], money: 17 };
    }
    value.npcSquads = geometry.squads.map(plan => ({ ...createNpcSquadState(plan, time), restUntil: time + 2_000_000 }));
    const assault = value.npcSquads.find(state => state.id === attacker.id)!;
    Object.assign(assault, { phase: 'objective', missionKind: 'assault', targetId: defeated.baseId, leaderId: attacker.memberIds[0],
      members: attacker.memberIds.map(id => ({ id, lifeCycle: 0 })), startedAt: time, missionUntil: time + 600_000, phaseUntil: time + 600_000 });
    value.npcFactionAlerts = createNpcFactionAlerts();
    value.drops = [{ id: cacheId, mapId: 'perimeter', ...defeated.base, source: 'base', npcBase: { id: defeated.baseId, faction: defeated.faction },
      items: [cacheItem], amount: 41, expiresAt: Number.MAX_SAFE_INTEGER }];
    value.lootCooldowns = world.containers.map(anchor => [`container:${anchor.id}`, time + 2_000_000]);
    value.events = [];
  });
  async function request(path: string, command?: object) {
    const response = await service.fetch(new Request(`${ORIGIN}/api/live/${path}`, { method: command ? 'POST' : 'GET', headers: {
      'x-prapor-world-version': world.version, ...(playerId ? { 'x-prapor-live': playerId } : {}),
      ...(command ? { origin: ORIGIN, 'content-type': 'application/json' } : {}),
    }, ...(command ? { body: JSON.stringify(command) } : {}) })); expect(response).not.toBeNull(); return response!;
  }
  async function enter() {
    const response = await request('join', {}); expect(response.status).toBe(200);
    const snapshot = await response.json() as LiveSnapshot; playerId = snapshot.selfId; return snapshot;
  }
  async function player(at: LivePoint) {
    if (!playerId) await enter();
    restart((_, writer) => {
      const row = writer.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').all().find(row => JSON.parse(row.state).id === playerId)!;
      const value = JSON.parse(row.state); Object.assign(value, point(at), { body: createHealth(), health: 100, healthAt: time,
        safeUntil: time + 2_000_000, nextMove: time + 2_000_000, ammo: 60, destination: null, targetId: null, automation: undefined });
      writer.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(value), row.identity);
    }); return enter();
  }
  async function advance(ms: number) {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      time += Math.min(1000, ms - elapsed); service.tick();
      if (playerId && elapsed % 5000 === 0) expect((await request('state')).status).toBe(200);
    }
    expect(service.healthy()).toBe(true);
  }
  const campaign = () => saved().npcCampaign!.squads.find(entry => entry.squadId === defeated.id)!;
  const owner = () => saved().territoryOwners.find(([id]) => id === defeated.baseId)![1];
  const release = () => restart(value => {
    for (const actor of value.scavs.filter(actor => defeated.memberIds.includes(actor.id) || actor.id === guardId)) actor.nextMove = time;
  });
  const close = () => { db.close(); service.close(); rmSync(directory, { recursive: true, force: true }); }; fixtures.push({ close });
  return { saved, restart, enter, player, advance, campaign, owner, release, cacheItem, cacheId, carriedItem, now: () => time,
    act: (command: LiveCommand) => request('action', command) };
}

describe('NPC base conquest and survivor relocation', () => {
  test('capturing a base requires a real uncontested thirty-second hold and preserves the captured cache across restart', async () => {
    const f = fixture(), cache = f.saved().drops.find(drop => drop.id === f.cacheId)!;
    await f.player(defeated.base); await f.advance(35_000); expect(f.owner()).toBe(defeated.faction);
    await f.player({ x: 0, y: 0 }); await f.advance(15_000); expect(f.owner()).toBe(defeated.faction);
    f.restart(undefined, 60_000); expect(f.owner()).toBe(defeated.faction); await f.enter();
    await f.advance(14_000); expect(f.owner()).toBe(defeated.faction);
    await f.advance(2000); expect(f.owner()).toBe(attacker.faction);
    const captured = f.saved().drops.find(drop => drop.id === f.cacheId)!;
    expect(captured).toEqual({ ...cache, npcBase: { id: defeated.baseId, faction: attacker.faction } });
    expect(f.saved().npcCampaign!.squads.find(entry => entry.squadId === attacker.id)!.baseId).toBe(defeated.baseId);
    f.restart(); expect(f.owner()).toBe(attacker.faction); expect(f.saved().drops.find(drop => drop.id === f.cacheId)).toEqual(captured);
    const visible = await f.player(defeated.base);
    expect(visible.factionSites?.find(site => site.id === defeated.baseId)?.owner).toBe(attacker.faction);
    expect(JSON.stringify(visible)).not.toContain('npcCampaign'); expect(JSON.stringify(visible)).not.toContain('npcGarrison');
    const picked = await f.act({ type: 'loot', id: f.cacheId }); expect(picked.status).toBe(200);
    const snapshot = await picked.json() as LiveSnapshot; expect(snapshot.self.lootItems).toEqual([f.cacheItem]); expect(snapshot.self.cargo).toBe(41);
    expect((await f.act({ type: 'loot', id: f.cacheId })).status).toBe(409);
  }, 20_000);

  test('wounded survivors and their guard walk to an owned refuge, retain generations and cargo, then regroup before counterattack', async () => {
    const f = fixture(true, true), initial = f.saved(), memberIds = [...defeated.memberIds, guardId];
    await f.advance(31_000); expect(f.owner()).toBe(attacker.faction);
    expect(f.campaign().baseId).toBe(refuge.baseId); expect(f.campaign().lostBaseId).toBe(defeated.baseId);
    expect(f.campaign().lossRoster).toEqual(defeated.memberIds.map(id => ({ id, lifeCycle: 0 })));
    const lossId = f.campaign().lossId!; expect(lossId).toBeTruthy(); f.release();
    let last = new Map(f.saved().scavs.map(actor => [actor.id, point(actor)])), steps = 0, restarted = false;
    for (let second = 0; second < 300 && !f.campaign().regroupUntil; second++) {
      await f.advance(1000);
      for (const actor of f.saved().scavs.filter(actor => memberIds.includes(actor.id))) {
        const old = last.get(actor.id)!, delta = Math.abs(actor.x - old.x) + Math.abs(actor.y - old.y);
        expect(delta).toBeLessThanOrEqual(1); expect(nav.walkable(actor)).toBe(true); steps += delta; last.set(actor.id, point(actor));
        const before = initial.scavs.find(before => before.id === actor.id)!;
        expect(actor.home).toEqual(before.home); expect(actor.body).toEqual(before.body); expect(actor.npcGeneration).toBe(before.npcGeneration); expect(actor.faction).toBe(before.faction);
      }
      expect(f.saved().npcSquads.find(state => state.id === defeated.id)!.missionKind).not.toBe('retake');
      if (!restarted && steps >= 25) {
        const savedCampaign = f.campaign(), held = f.saved().scavs.find(actor => actor.id === defeated.memberIds[0])!.npcInventory;
        f.restart(); expect(f.campaign()).toEqual(savedCampaign); expect(f.saved().scavs.find(actor => actor.id === defeated.memberIds[0])!.npcInventory).toEqual(held); restarted = true;
      }
    }
    expect(restarted).toBe(true); expect(steps).toBeGreaterThan(80);
    expect(f.campaign().regroupUntil).toBeGreaterThanOrEqual(f.now() + 29_000);
    for (const actor of f.saved().scavs.filter(actor => defeated.memberIds.includes(actor.id))) expect(distance(actor, refuge.base)).toBeLessThanOrEqual(6);
    const regroupUntil = f.campaign().regroupUntil; f.restart(); expect(f.campaign().regroupUntil).toBe(regroupUntil);
    await f.advance(Math.max(0, regroupUntil - f.now() - 1000));
    expect(f.saved().npcSquads.find(state => state.id === defeated.id)!.missionKind).not.toBe('retake');
    await f.advance(10_000);
    const counter = f.saved().npcSquads.find(state => state.id === defeated.id)!;
    expect(counter.missionKind).toBe('retake'); expect(counter.responseId).toBe(lossId); expect(counter.targetId).toBe(defeated.baseId);
    expect(counter.members).toEqual(defeated.memberIds.map(id => ({ id, lifeCycle: 0 })));
    const parcel = f.saved().drops.filter(drop => drop.items?.some(item => item.id === f.carriedItem.id));
    expect(parcel).toHaveLength(1); expect(parcel[0]).toMatchObject({ source: 'base', npcBase: { id: refuge.baseId, faction: defeated.faction }, items: [f.carriedItem], amount: 17 });
    expect(f.saved().scavs.find(actor => actor.id === defeated.memberIds[0])!.npcInventory).toEqual({ items: [], money: 0 });
    const guard = f.saved().scavs.find(actor => actor.id === guardId)!;
    expect(guard.npcGarrison?.baseId).toBe(refuge.baseId); expect(guard.npcGarrison?.arrivedAt).not.toBeNull(); expect(distance(guard, refuge.base)).toBeLessThanOrEqual(6);
    expect(f.saved().scavs.map(actor => actor.id)).toEqual(initial.scavs.map(actor => actor.id));

    // Remove the occupying defenders as a battle fixture; the recovering survivors
    // still have to walk the entire return route and perform the normal base hold.
    f.restart(value => {
      for (const actor of value.scavs.filter(actor => attacker.memberIds.includes(actor.id))) {
        actor.body.parts.head.hp = 0; actor.health = 0; actor.respawnAt = f.now() + 2_000_000;
      }
    });
    last = new Map(f.saved().scavs.map(actor => [actor.id, point(actor)]));
    let returnSteps = 0, firstPresenceAt: number | undefined;
    for (let second = 0; second < 300 && f.owner() !== defeated.faction; second++) {
      await f.advance(1000);
      const returning = f.saved().scavs.filter(actor => defeated.memberIds.includes(actor.id));
      for (const actor of returning) {
        const old = last.get(actor.id)!, delta = Math.abs(actor.x - old.x) + Math.abs(actor.y - old.y);
        expect(delta).toBeLessThanOrEqual(1); returnSteps += delta; last.set(actor.id, point(actor));
        expect(actor.npcGeneration).toBe(0); expect(actor.body).toEqual(initial.scavs.find(before => before.id === actor.id)!.body);
      }
      if (returning.every(actor => distance(actor, defeated.base) <= 6 && nav.hasLineOfSight(actor, defeated.base))) firstPresenceAt ??= f.now();
      if (!firstPresenceAt || f.now() - firstPresenceAt < 29_000) expect(f.owner()).toBe(attacker.faction);
    }
    expect(returnSteps).toBeGreaterThan(100); expect(f.owner()).toBe(defeated.faction);
    expect(f.campaign().baseId).toBe(defeated.baseId); expect(f.campaign().lostBaseId).toBeNull();
    expect(f.saved().drops.find(drop => drop.id === f.cacheId)).toMatchObject({ items: [f.cacheItem], amount: 41, npcBase: { id: defeated.baseId, faction: defeated.faction } });
    expect(f.saved().events.some(event => event.text.includes('отбил'))).toBe(true);
  }, 30_000);

  test('dead former owners cannot replenish inside a captured base, even after their normal quiet respawn deadline', async () => {
    const f = fixture(); await f.advance(31_000); expect(f.owner()).toBe(attacker.faction);
    f.restart(value => {
      for (const actor of value.scavs.filter(actor => defeated.memberIds.includes(actor.id) || actor.id === guardId)) {
        actor.respawnAt = f.now(); actor.respawnQuietSince = f.now() - 30_000;
      }
    });
    await f.advance(240_000);
    for (const actor of f.saved().scavs.filter(actor => defeated.memberIds.includes(actor.id) || actor.id === guardId)) {
      expect(actor.health).toBe(0); expect(actor.npcGeneration ?? 0).toBe(0);
      expect(f.saved().events.some(event => event.kind === 'respawn' && event.actorId === actor.id)).toBe(false);
    }
    expect(f.owner()).toBe(attacker.faction); f.restart();
    expect(f.saved().scavs.filter(actor => defeated.memberIds.includes(actor.id) || actor.id === guardId).every(actor => actor.health === 0)).toBe(true);
  }, 20_000);

  test('losing every friendly base leaves survivors in a finite refuge-less state without deleting their cargo or producing waves', async () => {
    const f = fixture(true, true), ids = f.saved().scavs.map(actor => actor.id);
    f.restart(value => {
      const baseIds = new Set(geometry.squads.map(plan => plan.baseId));
      value.territoryOwners = value.territoryOwners.map(([id, owner]) => [id, baseIds.has(id) && id !== defeated.baseId ? attacker.faction : owner]);
    });
    await f.advance(31_000); expect(f.owner()).toBe(attacker.faction); expect(f.campaign().baseId).toBeNull(); f.release();
    const lossId = f.campaign().lossId!, relocationDeadline = f.campaign().relocateUntil;
    expect(relocationDeadline).toBeLessThanOrEqual(f.now() + 600_000); expect(f.campaign().holdPoint).not.toBeNull();
    await f.advance(610_000);
    const camp = f.campaign(); expect(camp.baseId).toBeNull(); expect(camp.relocateUntil).toBeLessThanOrEqual(f.now());
    const stranded = f.saved().scavs.filter(actor => defeated.memberIds.includes(actor.id)).map(actor => ({ id: actor.id, ...point(actor) }));
    expect(f.saved().npcSquads.find(state => state.id === defeated.id)!.phase).toBe('rest');
    expect(f.saved().scavs.find(actor => actor.id === defeated.memberIds[0])!.npcInventory).toEqual({ items: [f.carriedItem], money: 17 });
    f.restart(); await f.advance(10_000);
    expect(f.saved().scavs.filter(actor => defeated.memberIds.includes(actor.id)).map(actor => ({ id: actor.id, ...point(actor) }))).toEqual(stranded);
    expect(f.saved().npcFactionAlerts.losses.find(order => order.id === lossId)?.assignedSquadId).toBeNull();
    expect(f.saved().scavs.map(actor => actor.id)).toEqual(ids);
  }, 30_000);

  test('death during evacuation drops the exact carried parcel once and never replaces the lost survivor for a counterattack', async () => {
    const f = fixture(true), carrierId = defeated.memberIds[0]!;
    await f.advance(31_000); expect(f.owner()).toBe(attacker.faction); f.release(); await f.advance(5000);
    const roster = f.campaign().lossRoster;
    f.restart(value => { const carrier = value.scavs.find(actor => actor.id === carrierId)!; carrier.body.parts.head.hp = .1; carrier.body.parts.chest.bleeding = 'heavy'; });
    await f.advance(1000);
    const parcel = f.saved().drops.filter(drop => drop.items?.some(item => item.id === f.carriedItem.id));
    expect(parcel).toHaveLength(1); expect(parcel[0]).toMatchObject({ source: 'body', items: [f.carriedItem], amount: 17 });
    expect(f.saved().scavs.find(actor => actor.id === carrierId)!.npcInventory).toEqual({ items: [], money: 0 });
    f.restart(); expect(f.saved().drops.filter(drop => drop.items?.some(item => item.id === f.carriedItem.id))).toEqual(parcel);
    await f.advance(240_000);
    expect(f.saved().scavs.find(actor => actor.id === carrierId)!.health).toBe(0);
    expect(f.campaign().lossRoster).toEqual(roster);
    expect(f.saved().npcSquads.find(state => state.id === defeated.id)!.missionKind).not.toBe('retake');
  }, 20_000);

  test('a legacy save without campaign state keeps authored bases and exact stored cargo on migration', () => {
    const f = fixture(true), held = f.saved().scavs.find(actor => actor.id === defeated.memberIds[0])!.npcInventory;
    f.restart(value => { delete value.npcCampaign; });
    expect(f.campaign().baseId).toBe(defeated.baseId); expect(f.campaign().lostBaseId).toBeNull();
    expect(f.saved().scavs.find(actor => actor.id === defeated.memberIds[0])!.npcInventory).toEqual(held);
    expect(f.saved().drops.find(drop => drop.id === f.cacheId)).toMatchObject({ items: [f.cacheItem], amount: 41, npcBase: { id: defeated.baseId, faction: defeated.faction } });
  });
});
