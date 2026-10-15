import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveService, type LiveService } from '../server/live';
import { getLiveMap, hasLiveLineOfSight, isLiveWalkable } from '../src/game/live-maps';
import { createHealth, createMedicalInventory, healthPercent, type HealthState } from '../src/game/health';
import type { LiveCommand, LiveSnapshot } from '../src/game/live';
import { LiveApiError, readLiveSnapshot } from '../src/live-client';

const ORIGIN = 'https://game.delopusk.ru';
const world = getLiveMap('perimeter');
interface Session { id: string; cookie: string }
let folder: string, dbPath: string, service: LiveService, time: number;
const options = () => ({ dbPath, secureCookies: true, allowedOrigins: [ORIGIN], now: () => time, random: () => .5, automaticTicks: false });
async function call(path: string, session?: Session, body?: unknown) {
  const post = !['state', 'status'].includes(path);
  return (await service.fetch(new Request(`${ORIGIN}/api/live/${path}`, { method: post ? 'POST' : 'GET', headers: {
    ...(post ? { origin: ORIGIN, 'content-type': 'application/json' } : {}), ...(session ? { cookie: session.cookie, 'x-prapor-live': session.id } : {}),
  }, ...(post ? { body: JSON.stringify(body ?? {}) } : {}) }), '192.0.2.71'))!;
}
async function enter(session?: Session, body: unknown = {}) {
  const reply = await call('join', session, body); expect(reply.status).toBe(200);
  const state = readLiveSnapshot(await reply.json());
  return { session: session ?? { id: state.selfId, cookie: reply.headers.get('set-cookie')!.split(';')[0]! }, state };
}
async function state(session: Session): Promise<LiveSnapshot> {
  const reply = await call('state', session); expect(reply.status).toBe(200); return readLiveSnapshot(await reply.json());
}
async function act(session: Session, body: LiveCommand) {
  const reply = await call('action', session, body); expect(reply.status).toBe(200); return readLiveSnapshot(await reply.json());
}
async function advance(ms: number, sessions: Session[]) {
  for (let elapsed = 0; elapsed < ms; elapsed += 250) {
    time += Math.min(250, ms - elapsed); service.tick();
    if (elapsed % 1000 === 0) for (const session of sessions) await state(session);
  }
}
function editStorage(edit: (db: Database) => void) {
  service.close(); const db = new Database(dbPath); edit(db); db.close(); service = createLiveService(options());
}
function place(session: Session, fields: Record<string, unknown>) {
  editStorage(db => {
    const row = db.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').all().find(row => JSON.parse(row.state).id === session.id)!;
    const player = JSON.parse(row.state);
    Object.assign(player, { x: 0, y: 0, safeUntil: 0 }, fields);
    if (fields.body) player.health = healthPercent(fields.body as HealthState);
    db.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(player), row.identity);
  });
}
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'prapor-autobattle-')); dbPath = join(folder, 'live.sqlite'); time = 1_800_000_000_000;
  service = createLiveService(options());
  editStorage(db => {
    const stored = JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state);
    stored.scavs = [{ id: 'distant-scav', mapId: 'perimeter', kind: 'scav', name: 'Косой', appearance: 0, faction: 'scavs', role: 'guard',
      home: { x: 127, y: 0 }, route: [{ x: 127, y: 0 }], routeIndex: 0, x: 127, y: 0, health: 100, body: createHealth(), action: 'idle', safeUntil: 0,
      respawnAt: 0, nextMove: time + 1_000_000, nextAttack: time + 1_000_000 }];
    db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(stored));
  });
});
afterEach(async () => { service.close(); await rm(folder, { recursive: true, force: true }); });

describe('authoritative automatic sorties', () => {
  test('deploy chooses the authored purpose route, moves one server step, and pause/resume survives reconnect and restart', async () => {
    const fighter = await enter(undefined, { intent: 'deploy', districtId: 'customs', purpose: 'loot' });
    expect(fighter.state.self.automation?.routeId).toBe('route-customs-loot');
    const origin = fighter.state.entities.find(entity => entity.id === fighter.session.id)!;
    await advance(250, [fighter.session]);
    const moved = await state(fighter.session), position = moved.entities.find(entity => entity.id === fighter.session.id)!;
    expect(Math.abs(position.x - origin.x) + Math.abs(position.y - origin.y)).toBe(1);
    await act(fighter.session, { type: 'automation', enabled: false });
    await advance(1000, [fighter.session]);
    expect((await state(fighter.session)).entities.find(entity => entity.id === fighter.session.id)).toMatchObject({ x: position.x, y: position.y });
    service.close(); service = createLiveService(options());
    const restored = (await enter(fighter.session, { intent: 'continue' })).state;
    expect(restored.self.automation?.stage).toBe('paused'); expect(restored.self.automation?.startedAt).toBe(fighter.state.self.automation!.startedAt);
    const resumed = await act(fighter.session, { type: 'automation', enabled: true });
    expect(resumed.self.automation?.enabled).toBe(true); expect(resumed.self.automation?.routeId).toBe('route-customs-loot');
    expect((await call('action', fighter.session, { type: 'automation', enabled: true, routeId: 'foreign-route' })).status).toBe(400);
    expect((await call('action', fighter.session, { type: 'automation', enabled: true, reward: 500 })).status).toBe(400);
    expect((await act(fighter.session, { type: 'move', x: 0, y: 0 })).self.automation?.stage).toBe('paused');
  });

  test('search uses the real deadline and transfers one concealed physical find before continuing the route', async () => {
    const fighter = await enter();
    const anchor = world.containers.find(anchor => world.pois.find(poi => poi.id === anchor.poiId)!.districtId === 'customs')!;
    place(fighter.session, { x: anchor.x, y: anchor.y, purpose: 'loot' }); await enter(fighter.session);
    await act(fighter.session, { type: 'automation', enabled: true });
    await advance(250, [fighter.session]);
    const searching = await state(fighter.session), drop = searching.drops.find(drop => drop.containerId === anchor.id)!;
    expect(searching.self.automation?.stage).toBe('search'); expect(drop.items).toBeUndefined(); expect(drop.amount).toBe(0);
    const readyAt = searching.self.searching!.readyAt;
    await advance(readyAt - time - 250, [fighter.session]);
    expect((await state(fighter.session)).self.cargo).toBe(0);
    await advance(250, [fighter.session]);
    const collected = await state(fighter.session);
    expect(collected.drops.some(drop => drop.id === searching.self.searching!.id)).toBe(false);
    expect(collected.self.cargo).toBeGreaterThan(0);
    expect((await call('action', fighter.session, { type: 'loot', id: drop.id })).status).toBe(409);
  });

  test('automated PvP respects cover and spawn protection, and non-PvP plans do not start fights with unthreatening players', async () => {
    const fighter = await enter(), rival = await enter();
    place(fighter.session, { x: 0, y: 0, purpose: 'pvp' }); place(rival.session, { x: 1, y: 0, safeUntil: time + 5000 });
    await enter(fighter.session); await enter(rival.session);
    await act(fighter.session, { type: 'automation', enabled: true }); await advance(250, [fighter.session, rival.session]);
    expect((await state(fighter.session)).self.ammo).toBe(60);
    await act(fighter.session, { type: 'automation', enabled: false });
    const pair = world.obstacles.filter(wall => wall.kind !== 'water').map(wall => [{ x: wall.x, y: wall.y - 1 }, { x: wall.x, y: wall.y + wall.height }])
      .find(([a, b]) => isLiveWalkable(world, a!) && isLiveWalkable(world, b!) && Math.hypot(a!.x - b!.x, a!.y - b!.y) <= 7 && !hasLiveLineOfSight(world, a!, b!))!;
    place(fighter.session, pair[0]!); place(rival.session, pair[1]!); await enter(fighter.session); await enter(rival.session);
    await act(fighter.session, { type: 'automation', enabled: true }); await advance(250, [fighter.session, rival.session]);
    expect((await state(fighter.session)).self.ammo).toBe(60);
    place(fighter.session, { x: 0, y: 0, purpose: 'loot', automation: undefined, sortie: undefined }); place(rival.session, { x: 1, y: 0 });
    await enter(fighter.session); await enter(rival.session); await act(fighter.session, { type: 'automation', enabled: true });
    await advance(250, [fighter.session, rival.session]); expect((await state(fighter.session)).self.ammo).toBe(60);
    place(fighter.session, { x: 0, y: 0, purpose: 'pvp', automation: undefined, sortie: undefined }); await enter(fighter.session); await enter(rival.session);
    await act(fighter.session, { type: 'automation', enabled: true }); await advance(250, [fighter.session, rival.session]);
    const fighting = await state(fighter.session);
    expect(fighting.self.ammo).toBe(59); expect(fighting.self.automation?.stage).toBe('combat'); expect(fighting.self.automation?.targetId).toBe(rival.session.id);
  });

  test('automatic treatment uses and completes the existing physical medicine rather than healing immediately', async () => {
    const fighter = await enter(), body = createHealth(); body.parts.chest.hp = 45; body.parts.chest.bleeding = 'heavy';
    place(fighter.session, { body, medicine: createMedicalInventory(), purpose: 'loot' }); await enter(fighter.session);
    await act(fighter.session, { type: 'automation', enabled: true }); await advance(250, [fighter.session]);
    const treating = await state(fighter.session);
    expect(treating.self.automation?.stage).toBe('treat'); expect(treating.self.treatment?.type).toBe('tourniquet'); expect(treating.self.body.parts.chest.bleeding).toBe('heavy');
    await advance(treating.self.treatment!.endsAt - time, [fighter.session]);
    const treated = await state(fighter.session);
    expect(treated.self.body.parts.chest.bleeding).toBe('none'); expect(treated.self.medicine.tourniquet).toBe(0);
  });

  test('low ammo recalls to extraction, banks cargo once, removes the returned fighter from combat and stops instead of repeating', async () => {
    const fighter = await enter(), rival = await enter(), exit = world.extracts[0]!;
    place(fighter.session, { ...exit, ammo: 3, cargo: 125, purpose: 'loot' }); place(rival.session, { x: exit.x + 1, y: exit.y });
    await enter(fighter.session); await enter(rival.session); await act(fighter.session, { type: 'automation', enabled: true });
    await advance(250, [fighter.session, rival.session]);
    const returned = await state(fighter.session);
    expect(returned.self.automation).toMatchObject({ enabled: false, stage: 'complete', reason: 'Боекомплект на исходе' });
    expect(returned.self.cargo).toBe(0); expect(returned.self.stash).toBe(125);
    expect((await state(rival.session)).entities.some(entity => entity.id === fighter.session.id)).toBe(false);
    expect((await call('action', rival.session, { type: 'attack', targetId: fighter.session.id })).status).toBe(409);
    await advance(35_000, [fighter.session, rival.session]);
    const later = await state(fighter.session);
    expect(later.self.automation?.stage).toBe('complete'); expect(later.self.stash).toBe(125);
    expect(later.entities.find(entity => entity.id === fighter.session.id)).toMatchObject(exit);
    service.close(); service = createLiveService(options());
    expect((await enter(fighter.session, { intent: 'continue' })).state.self.automation?.stage).toBe('complete');
  // Replays 35 seconds of the full shared world for two players, including restart.
  // Keep its assertions while allowing for slower runs of the complete suite.
  }, 15_000);

  test('recall waits for the authoritative combat lock; route completion automatically makes the same finite return', async () => {
    const fighter = await enter(), exit = world.extracts[0]!;
    place(fighter.session, { ...exit, cargo: 80, lastCombatAt: time }); await enter(fighter.session);
    await act(fighter.session, { type: 'recall' }); await advance(250, [fighter.session]);
    const waiting = await state(fighter.session); expect(waiting.self.automation?.stage).toBe('extract'); expect(waiting.self.cargo).toBe(80);
    await advance(8000, [fighter.session]); expect((await state(fighter.session)).self.automation?.stage).toBe('complete');
    expect((await call('action', fighter.session, { type: 'automation', enabled: true })).status).toBe(409);
    expect((await call('action', fighter.session, { type: 'recall' })).status).toBe(409);
    await enter(fighter.session, { intent: 'deploy' });
    editStorage(db => {
      const row = db.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').get()!, player = JSON.parse(row.state);
      player.automation.stopIndex = player.automation.stopCount; player.cargo = 20; Object.assign(player, exit);
      db.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(player), row.identity);
    });
    await enter(fighter.session); await advance(500, [fighter.session]);
    const completed = await state(fighter.session); expect(completed.self.automation?.reason).toBe('Маршрут пройден'); expect(completed.self.stash).toBe(100);
  });

  test('wire parsing accepts old manual snapshots but rejects forged automation goals, routes and positions', async () => {
    const legacy = await enter(); expect(legacy.state.self.automation).toBeUndefined();
    const automatic = await act(legacy.session, { type: 'automation', enabled: true });
    for (const forged of [{ target: { x: world.width, y: 0 } }, { stopIndex: 500 }, { routeId: 'hidden-route' }, { stage: 'complete', enabled: true }, { reward: 10 }, { target: { x: .5, y: 0 } }]) {
      const packet = structuredClone(automatic); Object.assign(packet.self.automation!, forged);
      expect(() => readLiveSnapshot(packet)).toThrow(LiveApiError);
    }
    expect(service.healthy()).toBe(true);
  });

  test('a stalled extraction tries another reachable exit and pauses explicitly after every exit has been blocked', async () => {
    const fighter = await enter(); place(fighter.session, { x: 0, y: 0, purpose: 'loot' }); await enter(fighter.session);
    await act(fighter.session, { type: 'recall' });
    editStorage(db => {
      const row = db.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').get()!, player = JSON.parse(row.state);
      player.sortie.extractTarget = world.extracts[0]; player.sortie.blockedAt = time - 9000;
      db.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(player), row.identity);
    });
    await enter(fighter.session); await advance(250, [fighter.session]);
    const alternative = await state(fighter.session);
    expect(alternative.self.automation?.stage).toBe('extract'); expect(alternative.self.automation?.target).not.toEqual(world.extracts[0]);
    editStorage(db => {
      const row = db.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').get()!, player = JSON.parse(row.state);
      player.sortie.blockedExtractKeys = world.extracts.map(exit => `${exit.x},${exit.y}`); player.sortie.extractTarget = null;
      db.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(player), row.identity);
    });
    await enter(fighter.session); await advance(250, [fighter.session]);
    const paused = await state(fighter.session);
    expect(paused.self.automation).toMatchObject({ enabled: false, stage: 'paused', reason: 'Выходы временно перекрыты' });
    await act(fighter.session, { type: 'automation', enabled: true }); await advance(250, [fighter.session]);
    expect((await state(fighter.session)).self.automation?.stage).toBe('extract');
  });
});
