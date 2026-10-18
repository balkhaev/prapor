import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveService } from '../server/live';
import { createLiveNavigation } from '../server/live-navigation';
import { buildNpcSquadPlans, createNpcSquadState, type NpcSquadPlan, type NpcSquadState } from '../server/live-squads';
import { createNpcFactionAlerts, NPC_BASE_ALARM_QUIET_MS, NPC_RETAKE_DELAY_MS, NPC_RESPONSE_MUSTER_MS, type NpcFactionAlerts } from '../server/live-faction-alerts';
import type { NpcLifeState } from '../server/live-alife';
import type { NpcInventory } from '../server/live-npc-loot';
import type { EconomyLoot } from '../server/live-economy';
import { createHealth, type HealthState } from '../src/game/health';
import { getLiveMap } from '../src/game/live-maps';
import { getLiveBossArenas } from '../src/game/live-boss-arenas';
import type { LiveCommand, LiveDrop, LiveEntity, LiveEvent, LivePoint, LiveSnapshot } from '../src/game/live';

const NOW = 1_800_000_000_000, ORIGIN = 'https://npc-defense.test';
const world = getLiveMap('perimeter'), nav = createLiveNavigation(world), arenas = getLiveBossArenas(world);
const geometry = buildNpcSquadPlans(world, nav, point => arenas.some(({ area }) => point.x >= area.x && point.y >= area.y && point.x < area.x + area.width && point.y < area.y + area.height));
const home = geometry.squads.find(plan => plan.id === 'squad-customs-scavs-1')!;
const helpers = geometry.squads.filter(plan => plan.districtId === home.districtId && plan.faction === home.faction && plan.id !== home.id);
const defender = geometry.squads.find(plan => plan.id === 'squad-customs-scavs-2')!;
const invader = geometry.squads.find(plan => plan.id === 'squad-customs-raiders-0')!;
const lostSite = geometry.territories.find(site => site.id === 'city-old-center-2')!;
const point = ({ x, y }: LivePoint): LivePoint => ({ x, y });
const distance = (a: LivePoint, b: LivePoint) => Math.hypot(a.x - b.x, a.y - b.y);
interface Actor extends LiveEntity {
  body: HealthState; home: LivePoint; route: LivePoint[]; spawnIndex: number; faction: 'scavs' | 'raiders'; role: 'patrol' | 'guard' | 'marksman';
  npcGeneration: number; npcInventory?: NpcInventory; nextMove: number; nextAttack: number; respawnAt: number; alife?: NpcLifeState;
}
interface Drop extends LiveDrop { source: string; expiresAt: number; mapId: string }
interface SavedWorld {
  scavs: Actor[]; drops: Drop[]; events: LiveEvent[]; npcSquads: NpcSquadState[]; npcFactionAlerts: NpcFactionAlerts;
  territoryOwners: Array<[string, 'scavs' | 'raiders' | null]>; lootCooldowns: Array<[string, number]>;
}
interface Session { key: string; id: string; gameId: string }
const fixtures: Array<{ close(): void }> = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.close(); });

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'prapor-npc-defense-')), dbPath = join(directory, 'live.sqlite');
  let time = NOW;
  const identities = new Map<string, string>(), sessions = new Map<string, Session>();
  const options = { dbPath, now: () => time, random: () => .5, automaticTicks: false, allowedOrigins: [ORIGIN], economy: {
    resolve: (request: Request) => {
      const key = request.headers.get('x-test-player') ?? 'one';
      let gameId = identities.get(key); if (!gameId) { gameId = randomUUID(); identities.set(key, gameId); }
      return { key: `test:${key}:${gameId}`, gameId, name: `Наблюдатель ${key}` };
    }, deliver: () => ({ ok: true, message: 'Доставлено' }), supply: () => ({ ammo: 0, medkits: 0, message: 'Пусто' }),
  } };
  let service = createLiveService(options), db = new Database(dbPath, { readonly: true });
  const saved = (): SavedWorld => JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state);
  function restart(edit?: (value: SavedWorld, writer: Database) => void, offlineMs = 0) {
    db.close(); service.close(); const writer = new Database(dbPath);
    try {
      const value = JSON.parse(writer.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state) as SavedWorld;
      edit?.(value, writer); writer.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(value));
      for (const row of writer.query<{ boss_id: string; state: string }, []>('SELECT boss_id,state FROM live_bosses').all()) {
        const boss = JSON.parse(row.state); Object.assign(boss, { nextMove: time + 1_000_000, nextAttack: time + 1_000_000 });
        writer.query('UPDATE live_bosses SET state=? WHERE boss_id=?').run(JSON.stringify(boss), row.boss_id);
      }
    } finally { writer.close(); }
    time += offlineMs; service = createLiveService(options); db = new Database(dbPath, { readonly: true });
  }
  function activate(actor: Actor, at: LivePoint, moving = false) {
    Object.assign(actor, point(at), { body: createHealth(), health: 100, healthAt: time, npcGeneration: 0, npcInventory: { items: [], money: 0 },
      nextMove: moving ? time : time + 1_000_000, nextAttack: time + 1_000_000, safeUntil: 0, alife: undefined, aim: null });
  }
  function crew(value: SavedWorld, plan: NpcSquadPlan, moving = false) {
    for (const [index, id] of plan.memberIds.entries()) activate(value.scavs.find(actor => actor.id === id)!, plan.rallyPoints[index]!, moving);
  }
  restart(value => {
    for (const actor of value.scavs) {
      actor.body = createHealth(); actor.body.parts.head.hp = 0; actor.health = 0; actor.respawnAt = time + 1_000_000;
      actor.npcInventory = { items: [], money: 0 };
    }
    value.npcSquads = geometry.squads.map(plan => ({ ...createNpcSquadState(plan, time), restUntil: time + 1_000_000 }));
    value.npcFactionAlerts = createNpcFactionAlerts(); value.events = [];
  });
  async function request(path: string, key: string, command?: object) {
    const session = sessions.get(key);
    const response = await service.fetch(new Request(`${ORIGIN}/api/live/${path}`, { method: command ? 'POST' : 'GET', headers: {
      'x-prapor-world-version': world.version, 'x-test-player': key,
      ...(session ? { 'x-prapor-live': session.id } : {}), ...(command ? { origin: ORIGIN, 'content-type': 'application/json' } : {}),
    }, ...(command ? { body: JSON.stringify(command) } : {}) })); expect(response).not.toBeNull(); return response!;
  }
  async function enter(key = 'one') {
    const response = await request('join', key, {}); expect(response.status).toBe(200);
    const snapshot = await response.json() as LiveSnapshot;
    sessions.set(key, { key, id: snapshot.selfId, gameId: identities.get(key)! }); return sessions.get(key)!;
  }
  async function reenter() { for (const key of sessions.keys()) await enter(key); }
  async function players(placements: Array<[string, LivePoint]>) {
    for (const [key] of placements) if (!sessions.has(key)) await enter(key);
    restart((_, writer) => {
      for (const [key, at] of placements) {
        const row = writer.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').all().find(row => JSON.parse(row.state).id === sessions.get(key)!.id)!;
        const value = JSON.parse(row.state); Object.assign(value, point(at), { body: createHealth(), health: 100, healthAt: time,
          safeUntil: 0, dangerUntil: 0, graceUntil: 0, nextMove: time + 1_000_000, nextAttack: 0, ammo: 60, destination: null,
          targetId: null, automation: undefined, patrol: false, searching: null, aim: null });
        writer.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(value), row.identity);
      }
    }); await reenter();
  }
  async function advance(ms: number) {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      time += Math.min(1000, ms - elapsed); service.tick();
      if (elapsed % 5000 === 0) for (const key of sessions.keys()) expect((await request('state', key)).status).toBe(200);
    }
    expect(service.healthy()).toBe(true);
  }
  const close = () => { db.close(); service.close(); rmSync(directory, { recursive: true, force: true }); }; fixtures.push({ close });
  return { saved, restart, crew, activate, players, enter, reenter, advance, now: () => time,
    act: (key: string, command: LiveCommand) => request('action', key, command),
    snapshot: async (key = 'one') => (await request('state', key)).json() as Promise<LiveSnapshot> };
}

function surrounding(origin: LivePoint, radius: number): LivePoint[] {
  return Array.from({ length: (radius * 2 + 1) ** 2 }, (_, index) => ({ x: origin.x + index % (radius * 2 + 1) - radius,
    y: origin.y + Math.floor(index / (radius * 2 + 1)) - radius })).filter(at => nav.walkable(at));
}
function alarmFixture() {
  const f = fixture();
  f.restart(value => {
    for (const plan of [home, ...helpers]) f.crew(value, plan);
    f.activate(value.scavs.find(actor => actor.id === 'scav-perimeter-15')!, world.npcSpawns[15]!.point);
  });
  const victim = f.saved().scavs.find(actor => actor.id === 'scav-perimeter-15')!;
  const positions = surrounding(victim, 4).filter(at => distance(at, victim) >= 2 && distance(at, victim) <= 4
    && nav.hasLineOfSight(at, victim) && !f.saved().scavs.some(actor => actor.health > 0 && actor.x === at.x && actor.y === at.y));
  expect(positions.length).toBeGreaterThanOrEqual(2);
  return { f, victim, positions };
}

function retakeFixture() {
  const f = fixture();
  f.restart(value => {
    f.crew(value, defender, true);
    const placements = surrounding(lostSite.point, 3).filter(at => distance(at, lostSite.point) <= 3 && nav.hasLineOfSight(at, lostSite.point));
    for (const [index, id] of invader.memberIds.entries()) f.activate(value.scavs.find(actor => actor.id === id)!, placements[index]!, true);
    const state = value.npcSquads.find(state => state.id === invader.id)!;
    Object.assign(state, { phase: 'objective', missionKind: 'capture', targetId: lostSite.id, leaderId: invader.memberIds[0],
      members: invader.memberIds.map(id => ({ id, lifeCycle: 0 })), startedAt: f.now(), missionUntil: f.now() + 240_000, phaseUntil: f.now() + 240_000 });
    value.territoryOwners = value.territoryOwners.map(([id, owner]) => [id, id === lostSite.id ? defender.faction : owner]);
  });
  return f;
}

describe('physical faction defense and retaliation', () => {
  test('passive presence and a refused shot do not alarm a base; repeated real attackers share one durable response budget', async () => {
    const { f, victim, positions } = alarmFixture();
    const roster = f.saved().scavs.map(actor => ({ id: actor.id, home: actor.home, generation: actor.npcGeneration }));
    await f.players([['one', positions[0]!], ['two', positions[1]!]]); await f.advance(2000);
    expect(f.saved().npcFactionAlerts.alarms).toEqual([]);
    const farTarget = f.saved().scavs.find(actor => actor.id === helpers[0]!.memberIds[0])!;
    expect((await f.act('one', { type: 'attack', targetId: farTarget.id })).status).toBe(409);
    expect(f.saved().npcFactionAlerts.alarms).toEqual([]);
    expect((await f.act('one', { type: 'attack', targetId: victim.id })).status).toBe(200); await f.advance(1000);
    const opened = f.saved().npcFactionAlerts.alarms.find(alarm => alarm.baseId === home.baseId)!;
    expect(opened).toBeDefined(); expect(opened.homeRecalled).toBe(true); expect(opened.helperSquadId).not.toBeNull();
    expect(Object.keys(opened).sort()).toEqual(['id', 'baseId', 'faction', 'openedAt', 'lastContactAt', 'homeRecalled', 'helperSquadId'].sort());
    expect(f.saved().npcSquads.filter(state => state.responseId === opened.id).map(state => state.id).sort()).toEqual([home.id, opened.helperSquadId!].sort());
    expect((await f.act('two', { type: 'attack', targetId: victim.id })).status).toBe(200); await f.advance(1000);
    const beforeRestart = f.saved().npcFactionAlerts; f.restart(); expect(f.saved().npcFactionAlerts).toEqual(beforeRestart); await f.reenter();
    expect((await f.act('one', { type: 'attack', targetId: victim.id })).status).toBe(200); await f.advance(1000);
    const repeated = f.saved().npcFactionAlerts.alarms.find(alarm => alarm.baseId === home.baseId)!;
    expect(repeated.id).toBe(opened.id); expect(repeated.openedAt).toBe(opened.openedAt); expect(repeated.helperSquadId).toBe(opened.helperSquadId);
    expect(f.saved().npcSquads.filter(state => state.responseId === opened.id).map(state => state.id).sort()).toEqual([home.id, opened.helperSquadId!].sort());
    expect(f.saved().scavs.map(actor => ({ id: actor.id, home: actor.home, generation: actor.npcGeneration }))).toEqual(roster);
    const snapshot = await f.snapshot(); expect(JSON.stringify(snapshot)).not.toContain('npcFactionAlerts'); expect(JSON.stringify(snapshot)).not.toContain('responseId');
    // Merely remaining visible after the last shot cannot renew the incident.
    await f.advance(NPC_BASE_ALARM_QUIET_MS + 1000);
    expect(f.saved().npcFactionAlerts.alarms.some(alarm => alarm.id === opened.id)).toBe(false);
    expect(f.saved().npcSquads.filter(state => state.responseId === opened.id).every(state => state.phase === 'return' || state.phase === 'rest')).toBe(true);
  });

  test('hidden NPCs cannot raise or steer a base alarm; a witnessed invasion alerts the existing garrison', async () => {
    const { f, victim } = alarmFixture(), intruderId = invader.memberIds[0]!;
    const observers = f.saved().scavs.filter(actor => actor.health > 0 && distance(actor.home, home.base) <= 18);
    const hidden = surrounding(home.base, 13).filter(at => distance(at, home.base) <= 13 && observers.every(actor => !nav.hasLineOfSight(actor, at)));
    expect(hidden.length).toBeGreaterThan(1);
    const visible = surrounding(victim, 8).find(at => distance(at, victim) >= 6 && distance(at, victim) <= 7 && distance(at, home.base) <= 14
      && nav.hasLineOfSight(victim, at) && !observers.some(actor => distance(actor, at) === 0))!;
    expect(visible).toBeDefined();
    f.restart(value => f.activate(value.scavs.find(actor => actor.id === intruderId)!, hidden[0]!));
    await f.advance(2000); expect(f.saved().npcFactionAlerts.alarms).toEqual([]);
    f.restart(value => {
      Object.assign(value.scavs.find(actor => actor.id === intruderId)!, point(visible));
      value.scavs.find(actor => actor.id === victim.id)!.nextMove = f.now();
    });
    await f.advance(1000);
    const alarm = f.saved().npcFactionAlerts.alarms.find(alarm => alarm.baseId === home.baseId)!;
    expect(alarm).toBeDefined();
    const responding = f.saved().scavs.find(actor => actor.id === victim.id)!;
    expect(distance(responding, victim)).toBe(1); expect(responding.alife?.targetId).toBe(intruderId);
    f.restart(value => {
      Object.assign(value.scavs.find(actor => actor.id === intruderId)!, point(hidden[1]!));
      for (const actor of value.scavs.filter(actor => actor.health > 0 && actor.faction === home.faction)) actor.nextMove = f.now() + 1_000_000;
    });
    await f.advance(12_000);
    const quiet = f.saved().npcFactionAlerts.alarms.find(candidate => candidate.id === alarm.id)!;
    expect(quiet.lastContactAt).toBe(alarm.lastContactAt);
    for (const actor of f.saved().scavs.filter(actor => actor.health > 0 && actor.faction === home.faction)) {
      expect(actor.alife?.targetId).not.toBe(intruderId);
      expect(actor.alife?.lastSeen).not.toEqual(point(hidden[1]!));
    }
  });

  test('a lethal hit on the last local defender still dispatches existing helpers who walk from their own base', async () => {
    const { f, victim, positions } = alarmFixture();
    f.restart(value => {
      for (const actor of value.scavs.filter(actor => home.memberIds.includes(actor.id))) { actor.body.parts.head.hp = 0; actor.health = 0; actor.respawnAt = f.now() + 1_000_000; }
      value.scavs.find(actor => actor.id === victim.id)!.body.parts.head.hp = 1;
      for (const actor of value.scavs.filter(actor => helpers.some(plan => plan.memberIds.includes(actor.id)))) actor.nextMove = f.now();
    });
    const before = f.saved(), ids = before.scavs.map(actor => actor.id);
    await f.players([['one', positions[0]!]]);
    expect((await f.act('one', { type: 'attack', targetId: victim.id, aimed: true })).status).toBe(200);
    expect(f.saved().npcFactionAlerts.alarms).toEqual([]);
    await f.advance(2000);
    expect(f.saved().scavs.find(actor => actor.id === victim.id)!.health).toBe(0);
    const alarm = f.saved().npcFactionAlerts.alarms.find(alarm => alarm.baseId === home.baseId)!;
    expect(alarm).toBeDefined(); expect(alarm.homeRecalled).toBe(false); expect(alarm.helperSquadId).not.toBeNull();
    const helper = helpers.find(plan => plan.id === alarm.helperSquadId)!;
    let last = new Map(f.saved().scavs.map(actor => [actor.id, point(actor)])), steps = 0;
    for (let second = 0; second < 35; second++) {
      await f.advance(1000);
      for (const actor of f.saved().scavs.filter(actor => helper.memberIds.includes(actor.id))) {
        const old = last.get(actor.id)!, delta = Math.abs(actor.x - old.x) + Math.abs(actor.y - old.y);
        expect(delta).toBeLessThanOrEqual(1); expect(nav.walkable(actor)).toBe(true); steps += delta; last.set(actor.id, point(actor));
        expect(actor.npcGeneration).toBe(before.scavs.find(previous => previous.id === actor.id)!.npcGeneration);
      }
    }
    expect(steps).toBeGreaterThan(20);
    expect(f.saved().scavs.filter(actor => helper.memberIds.includes(actor.id)).every(actor => distance(actor, helper.base) > 6)).toBe(true);
    expect(f.saved().scavs.map(actor => actor.id)).toEqual(ids);
    expect(f.saved().events.filter(event => event.kind === 'respawn')).toEqual([]);
  });

  test('a real ownership loss dispatches from base, follows legal cells, and only recaptures after physical uncontested presence', async () => {
    const f = retakeFixture(), roster = f.saved().scavs.map(actor => actor.id);
    await f.advance(21_000);
    expect(f.saved().territoryOwners.find(([id]) => id === lostSite.id)?.[1]).toBe(invader.faction);
    const loss = f.saved().npcFactionAlerts.losses.find(order => order.siteId === lostSite.id)!;
    expect(loss).toBeDefined(); expect(loss.faction).toBe(defender.faction); expect(loss.status).toBe('pending');
    expect(loss.readyAt).toBe(loss.lostAt + NPC_RETAKE_DELAY_MS);
    f.restart(undefined, 5000);
    expect(f.saved().npcFactionAlerts.losses.find(order => order.id === loss.id)).toEqual(loss);
    expect(f.saved().territoryOwners.find(([id]) => id === lostSite.id)?.[1]).toBe(invader.faction);
    await f.advance(Math.max(0, loss.readyAt - f.now() - 1000));
    expect(f.saved().npcSquads.find(state => state.id === defender.id)?.responseId).not.toBe(loss.id);
    await f.advance(1000);
    const dispatched = f.saved().npcSquads.find(state => state.id === defender.id)!;
    expect(dispatched.missionKind).toBe('retake'); expect(dispatched.responseId).toBe(loss.id); expect(dispatched.phase).toBe('assemble');
    expect(dispatched.departAfter).toBe(f.now() + NPC_RESPONSE_MUSTER_MS);
    for (const actor of f.saved().scavs.filter(actor => defender.memberIds.includes(actor.id))) expect(distance(actor, defender.base)).toBeLessThanOrEqual(6);
    const savedOrder = f.saved().npcFactionAlerts.losses.find(order => order.id === loss.id)!;
    f.restart(); expect(f.saved().npcFactionAlerts.losses.find(order => order.id === loss.id)).toEqual(savedOrder);
    expect(f.saved().npcSquads.find(state => state.id === defender.id)!.departAfter).toBe(dispatched.departAfter);
    let previous = new Map(f.saved().scavs.map(actor => [actor.id, point(actor)])), traveled = 0, firstPresence: number | undefined;
    for (let second = 0; second < 180; second++) {
      await f.advance(1000); const current = f.saved(), members = current.scavs.filter(actor => defender.memberIds.includes(actor.id));
      for (const actor of members) {
        const old = previous.get(actor.id)!, step = Math.abs(actor.x - old.x) + Math.abs(actor.y - old.y);
        expect(step).toBeLessThanOrEqual(1); expect(nav.walkable(actor)).toBe(true); traveled += step; previous.set(actor.id, point(actor));
      }
      if (members.length === 2 && members.every(actor => distance(actor, lostSite.point) <= 6 && nav.hasLineOfSight(actor, lostSite.point))) firstPresence ??= f.now();
      const owner = current.territoryOwners.find(([id]) => id === lostSite.id)?.[1];
      if (owner === defender.faction) { expect(firstPresence).toBeDefined(); expect(f.now() - firstPresence!).toBeGreaterThanOrEqual(19_000); break; }
      expect(owner).toBe(invader.faction);
    }
    expect(traveled).toBeGreaterThanOrEqual(80);
    expect(f.saved().territoryOwners.find(([id]) => id === lostSite.id)?.[1]).toBe(defender.faction);
    expect(f.saved().scavs.map(actor => actor.id)).toEqual(roster);
    expect(f.saved().npcSquads.find(state => state.id === defender.id)!.outcome).toBe('completed');
    expect(f.saved().npcFactionAlerts.losses.some(order => order.id === loss.id)).toBe(false);
  }, 20_000);

  test('a casualty spends the retaliation attempt and a later physical respawn cannot join or relaunch that mission', async () => {
    const f = retakeFixture(), initialIds = f.saved().scavs.map(actor => actor.id);
    await f.advance(62_000);
    const response = f.saved().npcSquads.find(state => state.id === defender.id)!;
    expect(response.missionKind).toBe('retake'); expect(response.phase).toBe('travel');
    const leaderId = response.leaderId!, responseId = response.responseId!;
    const oldGeneration = f.saved().scavs.find(actor => actor.id === leaderId)!.npcGeneration;
    expect(distance(f.saved().scavs.find(actor => actor.id === leaderId)!, defender.base)).toBeGreaterThan(6);
    f.restart(value => {
      const leader = value.scavs.find(actor => actor.id === leaderId)!;
      leader.body.parts.head.hp = .1; leader.body.parts.chest.bleeding = 'heavy';
    });
    await f.advance(2000);
    expect(f.saved().scavs.find(actor => actor.id === leaderId)!.health).toBe(0);
    const returning = f.saved().npcSquads.find(state => state.id === defender.id)!;
    expect(returning.outcome).toBe('casualty'); expect(['return', 'rest']).toContain(returning.phase);
    if (returning.phase === 'return') expect(returning.members).toEqual(response.members);
    else for (const actor of f.saved().scavs.filter(actor => actor.health > 0 && defender.memberIds.includes(actor.id))) expect(distance(actor, defender.base)).toBeLessThanOrEqual(6);
    const spent = f.saved().npcFactionAlerts.losses.find(order => order.id === responseId)!;
    expect(spent.status).toBe('spent'); expect(spent.assignedSquadId).toBe(defender.id);
    f.restart(); expect(f.saved().npcFactionAlerts.losses.find(order => order.id === responseId)).toEqual(spent);
    await f.advance(185_000);
    const replacement = f.saved().scavs.find(actor => actor.id === leaderId)!;
    expect(replacement.health).toBeGreaterThan(0); expect(replacement.npcGeneration).toBe(oldGeneration + 1);
    expect(f.saved().scavs.map(actor => actor.id)).toEqual(initialIds);
    expect(f.saved().npcFactionAlerts.losses.find(order => order.id === responseId)).toEqual(spent);
    expect(f.saved().npcSquads.some(state => state.responseId === responseId)).toBe(false);
    expect(f.saved().territoryOwners.find(([id]) => id === lostSite.id)?.[1]).toBe(invader.faction);
  }, 20_000);

  test('a loaded resident cannot be recruited as a helper, and defense never consumes or duplicates its physical cargo', async () => {
    const { f, victim, positions } = alarmFixture(), loadedPlan = helpers[0]!, carrierId = loadedPlan.memberIds[0]!;
    const item: EconomyLoot = { id: randomUUID(), modelId: 'coffee', foundAt: NOW }, held = { items: [item], money: 17 };
    const cacheItems: EconomyLoot[] = Array.from({ length: 4 }, () => ({ id: randomUUID(), modelId: 'tool-case', foundAt: NOW }));
    f.restart(value => {
      value.scavs.find(actor => actor.id === carrierId)!.npcInventory = held;
      value.drops.push({ id: randomUUID(), mapId: 'perimeter', ...loadedPlan.base, source: 'base',
        npcBase: { id: loadedPlan.baseId, faction: loadedPlan.faction }, items: cacheItems, amount: 500, expiresAt: Number.MAX_SAFE_INTEGER });
    });
    const supplies = f.saved().drops.filter(drop => drop.source === 'supply');
    await f.players([['one', positions[0]!]]);
    expect((await f.act('one', { type: 'attack', targetId: victim.id })).status).toBe(200); await f.advance(10_000);
    const alarm = f.saved().npcFactionAlerts.alarms.find(alarm => alarm.baseId === home.baseId)!;
    expect(alarm).toBeDefined(); expect(alarm.helperSquadId).not.toBe(loadedPlan.id);
    expect(f.saved().npcSquads.find(state => state.id === loadedPlan.id)!.members.some(member => member.id === carrierId)).toBe(false);
    expect(f.saved().scavs.find(actor => actor.id === carrierId)!.npcInventory).toEqual(held);
    expect(f.saved().drops.filter(drop => drop.source === 'supply')).toEqual(supplies);
    f.restart();
    expect(f.saved().scavs.find(actor => actor.id === carrierId)!.npcInventory).toEqual(held);
    expect(f.saved().drops.filter(drop => drop.items?.some(candidate => candidate.id === item.id))).toEqual([]);
  });
});
