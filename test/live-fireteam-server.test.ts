import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveService, type LiveService } from '../server/live';
import { buildNpcSquadPlans } from '../server/live-squads';
import { createLiveNavigation } from '../src/game/live-navigation';
import { getLiveMap } from '../src/game/live-maps';
import { createHealth } from '../src/game/health';
import { LIVE_FIRETEAM_SUPPORT_MS } from '../src/game/live-fireteam';
import type { LiveCommand, LiveEntity, LiveEvent, LivePoint, LiveSnapshot } from '../src/game/live';

const ORIGIN = 'http://fireteam.test', NOW = 1_800_000_000_000;
const world = getLiveMap('perimeter'), nav = createLiveNavigation(world);
const squad = buildNpcSquadPlans(world, nav).squads.find(plan => plan.id === 'squad-customs-raiders-0')!;
const origin = { x: 366, y: 465 }, threat = { x: origin.x + 5, y: origin.y };
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

async function fixture(authored = true, canFire = true, corner = false) {
  const directory = mkdtempSync(join(tmpdir(), 'prapor-fireteam-')), dbPath = join(directory, 'live.sqlite');
  let time = NOW, id = '', cookie = '', roll = .99;
  const options = { dbPath, now: () => time, random: () => roll, automaticTicks: false, secureCookies: false, allowedOrigins: [ORIGIN] };
  let service: LiveService = createLiveService(options);
  cleanups.push(() => { service.close(); rmSync(directory, { recursive: true, force: true }); });
  async function call(path: string, body?: object, session?: { id: string; cookie: string }): Promise<LiveSnapshot> {
    const credentials = session ?? { id, cookie };
    const reply = await service.fetch(new Request(`${ORIGIN}/api/live/${path}`, { method: body ? 'POST' : 'GET', headers: {
      ...(body ? { origin: ORIGIN, 'content-type': 'application/json' } : {}), ...(credentials.cookie ? { cookie: credentials.cookie, 'x-prapor-live': credentials.id } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) }));
    expect(reply?.status).toBe(200);
    const snapshot = await reply!.json() as LiveSnapshot;
    cookie ||= reply!.headers.get('set-cookie')!.split(';')[0]!; id ||= snapshot.selfId;
    return snapshot;
  }
  await call('join', {});
  let observer: { id: string; cookie: string } | undefined;
  if (corner) {
    const reply = (await service.fetch(new Request(`${ORIGIN}/api/live/join`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{}' })))!;
    expect(reply.status).toBe(200); const snapshot = await reply.json() as LiveSnapshot;
    observer = { id: snapshot.selfId, cookie: reply.headers.get('set-cookie')!.split(';')[0]! };
  }
  service.close();
  const db = new Database(dbPath);
  try {
    const value = JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state);
    value.scavs = value.scavs.filter((actor: { id: string }) => squad.memberIds.includes(actor.id));
    value.scavs.forEach((actor: Record<string, unknown>, index: number) => {
      Object.assign(actor, { x: corner ? 411 : origin.x, y: corner ? 480 - index : origin.y + index, health: 100, body: createHealth(), healthAt: time,
        nextMove: corner ? time + 750 : 0, nextAttack: canFire ? 0 : time + 60_000, aim: null, action: 'idle', safeUntil: 0, alife: undefined, npcGarrison: undefined });
      if (!authored) actor.home = { x: origin.x, y: origin.y + index };
    });
    if (corner) value.scavs.push({ ...structuredClone(value.scavs[0]), id: 'secondary-opponent', name: 'Второй противник',
      x: 415, y: 475, home: { x: 415, y: 475 }, route: [{ x: 415, y: 475 }], faction: 'scavs', role: 'guard',
      nextMove: time + 60_000, nextAttack: time + 60_000 });
    value.events = [];
    for (const state of value.npcSquads) { state.phase = 'rest'; state.restUntil = time + 60_000; }
    db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(value));
    const row = db.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').all().find(row => JSON.parse(row.state).id === id)!;
    const player = JSON.parse(row.state);
    Object.assign(player, corner ? { x: 415, y: 480 } : threat, { health: 100, body: createHealth(), healthAt: time, safeUntil: 0, dangerUntil: 0, graceUntil: 0,
      nextAttack: 0, destination: null, targetId: null, patrol: false, automation: undefined, aim: null, ammo: 60, leaveAt: 0 });
    db.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(player), row.identity);
    if (observer) {
      const row = db.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').all().find(row => JSON.parse(row.state).id === observer!.id)!;
      const player = JSON.parse(row.state); Object.assign(player, { x: 409, y: 478, safeUntil: time + 60_000 });
      db.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(player), row.identity);
    }
  } finally { db.close(); }
  service = createLiveService(options); await call('join', {}); if (observer) await call('join', {}, observer);
  return { id, now: () => time, state: () => call('state'), act: async (body: LiveCommand) => {
    roll = .5; try { return await call('action', body); } finally { roll = .99; }
  },
    observe: () => call('state', undefined, observer),
    tick: async (ms = 50) => { for (let elapsed = 0; elapsed < ms; elapsed += 50) { time += 50; service.tick(); } return call('state'); }, healthy: () => service.healthy() };
}
const location = (entity: LivePoint): LivePoint => ({ x: entity.x, y: entity.y });

describe('authoritative squad fire and movement', () => {
  test('a briefly hidden primary threat keeps the active bound despite a second visible opponent', async () => {
    const f = await fixture(true, true, true);
    let started = false;
    for (let elapsed = 0; elapsed < 12_000; elapsed += 50) {
      await f.tick(); const snapshot = await f.observe();
      if (snapshot.entities.some(actor => actor.combatRole === 'flanking')) { started = true; break; }
    }
    expect(started).toBe(true);
    await f.act({ type: 'move', x: 415, y: 482 });
    let hiddenAdvance = false, secondaryVisible = false;
    const previous = new Map<string, LivePoint>();
    for (let elapsed = 0; elapsed < 2000; elapsed += 50) {
      const player = await f.tick(), snapshot = await f.observe();
      const primary = player.entities.find(actor => actor.id === f.id)!;
      for (const actor of snapshot.entities.filter(actor => squad.memberIds.includes(actor.id))) {
        const before = previous.get(actor.id), moved = before && (actor.x !== before.x || actor.y !== before.y);
        if (!nav.hasLineOfSight(actor, primary) && nav.hasLineOfSight(actor, { x: 415, y: 475 })) {
          secondaryVisible = true;
          hiddenAdvance ||= Boolean(moved && actor.combatRole === 'flanking');
          if (actor.aimTargetId) expect(actor.aimTargetId).toBe(f.id);
        }
        previous.set(actor.id, location(actor));
      }
    }
    expect(secondaryVisible).toBe(true); expect(hiddenAdvance).toBe(true); expect(f.healthy()).toBe(true);
  });
  test('a real squad advances a flanker only behind recent actual covering rounds and keeps legal separate positions', async () => {
    for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++) expect(nav.walkable({ x: origin.x + x, y: origin.y + y })).toBe(true);
    const f = await fixture(), previous = new Map<string, LivePoint>(), events = new Map<string, LiveEvent>();
    let advances = 0, covering = false, regrouping = false;
    for (let elapsed = 0; elapsed < 18_000; elapsed += 250) {
      const snapshot = await f.tick(250);
      for (const event of snapshot.events) if (event.from && event.to) events.set(event.id, event);
      const actors = snapshot.entities.filter(actor => squad.memberIds.includes(actor.id));
      expect(new Set(actors.map(actor => `${actor.x},${actor.y}`)).size).toBe(actors.length);
      for (const actor of actors) {
        expect(actor.npcSquad?.id).toBe(squad.id); expect(nav.walkable(actor)).toBe(true);
        const before = previous.get(actor.id), moved = before && Math.abs(actor.x - before.x) + Math.abs(actor.y - before.y);
        if (before) expect(moved).toBeLessThanOrEqual(1);
        if (moved && actor.combatRole === 'flanking') {
          advances++;
          const receipt = [...events.values()].find(event => event.actorId !== actor.id && squad.memberIds.includes(event.actorId ?? '')
            && event.targetId === f.id && event.at <= f.now() && f.now() - event.at <= LIVE_FIRETEAM_SUPPORT_MS);
          expect(receipt).toBeDefined();
          expect(nav.hasLineOfSight(receipt!.from!, receipt!.to!)).toBe(true);
          expect([...events.values()].some(event => event.actorId === actor.id && event.at === f.now())).toBe(false);
        }
        covering ||= actor.combatRole === 'covering'; regrouping ||= actor.combatRole === 'regrouping';
        previous.set(actor.id, location(actor));
      }
    }
    expect(advances).toBeGreaterThanOrEqual(3); expect(covering).toBe(true); expect(regrouping).toBe(true); expect(f.healthy()).toBe(true);
    expect([...events.values()].some(event => squad.memberIds.includes(event.actorId ?? '') && Math.abs(event.from!.y - origin.y) >= 3)).toBe(true);
    expect([...events.values()].filter(event => squad.memberIds.includes(event.actorId ?? '')).every(event => event.damage === 0)).toBe(true);
  });

  test('strong incoming fire interrupts the flank and causes physical withdrawal with a sustained regrouping pause', async () => {
    const f = await fixture(), targetId = squad.memberIds[0]!;
    await f.tick(); await f.act({ type: 'attack', targetId });
    await f.tick(900);
    const before = (await f.state()).entities.find(actor => actor.id === targetId)!;
    await f.act({ type: 'attack', targetId });
    let withdrawal: LiveEntity | undefined, regroup = false, firstRetreat = 0, lastRetreat = 0;
    for (let elapsed = 0; elapsed < 6000; elapsed += 250) {
      const snapshot = await f.tick(250), actor = snapshot.entities.find(entity => entity.id === targetId);
      if (actor?.combatRole === 'withdrawing' || actor?.combatRole === 'regrouping') {
        firstRetreat ||= f.now(); lastRetreat = f.now();
        expect(actor.aimUntil).toBeUndefined();
        expect(snapshot.events.some(event => event.actorId === targetId && event.from && event.at === f.now())).toBe(false);
        if (actor.combatRole === 'withdrawing') withdrawal = actor;
        regroup ||= actor.combatRole === 'regrouping';
      }
    }
    expect(withdrawal).toBeDefined(); expect(regroup).toBe(true);
    expect(Math.hypot(withdrawal!.x - threat.x, withdrawal!.y - threat.y)).toBeGreaterThan(Math.hypot(before.x - threat.x, before.y - threat.y));
    expect(lastRetreat - firstRetreat).toBeGreaterThanOrEqual(3000); expect(f.healthy()).toBe(true);
  });

  test('matching faction and proximity alone cannot invent an authored fireteam', async () => {
    const f = await fixture(false);
    for (let elapsed = 0; elapsed < 4000; elapsed += 250) {
      const snapshot = await f.tick(250);
      for (const actor of snapshot.entities.filter(actor => squad.memberIds.includes(actor.id))) {
        expect(actor.npcSquad).toBeUndefined(); expect(actor.combatRole).toBeUndefined();
      }
    }
    expect(f.healthy()).toBe(true);
  });

  test('an aiming teammate without a validated round cannot release a flank', async () => {
    const f = await fixture(true, false);
    let covering = false, waiting = false;
    for (let elapsed = 0; elapsed < 4000; elapsed += 250) {
      const snapshot = await f.tick(250);
      expect(snapshot.events.some(event => event.from && squad.memberIds.includes(event.actorId ?? ''))).toBe(false);
      for (const actor of snapshot.entities.filter(actor => squad.memberIds.includes(actor.id))) {
        expect(actor.combatRole).not.toBe('flanking');
        covering ||= actor.combatRole === 'covering'; waiting ||= actor.combatRole === 'regrouping';
      }
    }
    expect(covering).toBe(true); expect(waiting).toBe(true); expect(f.healthy()).toBe(true);
  });
});
