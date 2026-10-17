import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveService, type LiveService } from '../server/live';
import { NPC_RESPAWN_MS, NPC_RESPAWN_QUIET_MS } from '../server/live-spawning';
import { createNpcLifePlans } from '../server/live-alife';
import { createLiveNavigation } from '../server/live-navigation';
import { createHealth } from '../src/game/health';
import { getLiveMap, hasLiveLineOfSight, isLiveWalkable } from '../src/game/live-maps';
import type { LiveCommand, LiveEntity, LiveEvent, LivePoint, LiveSnapshot } from '../src/game/live';

const ORIGIN = 'http://npc-respawn.test', NOW = 1_800_000_000_000, world = getLiveMap('perimeter');
const navigation = createLiveNavigation(world);
const lifePlans = createNpcLifePlans(world, navigation.walkable, navigation.hasLineOfSight, () => false);
// The two authored sawmill posts beside the reported PP-91 raid's death tile.
const PATROL = 167, GUARD = 166, DEATH_TILE = { x: 755, y: 292 };
interface Session { cookie: string; id: string }
interface SavedNpc extends LiveEntity {
  spawnIndex: number; home: LivePoint; route: LivePoint[]; routeIndex: number;
  body: ReturnType<typeof createHealth>; healthAt: number; respawnAt: number;
  respawnQuietSince?: number | null; nextMove: number; nextAttack: number;
}
interface SavedWorld { scavs: SavedNpc[]; events: LiveEvent[] }
const fixtures: Array<{ directory: string; live: LiveService }> = [];
afterEach(async () => { for (const f of fixtures.splice(0)) { f.live.close(); await rm(f.directory, { recursive: true, force: true }); } });

async function fixture(spawnIndex = PATROL) {
  const directory = await mkdtemp(join(tmpdir(), 'prapor-npc-respawn-')), dbPath = join(directory, 'live.sqlite');
  let time = NOW, worldVersion: string | undefined;
  const options = { dbPath, secureCookies: false, allowedOrigins: [ORIGIN], now: () => time, random: () => 0, automaticTicks: false };
  const f = { directory, live: createLiveService(options) }; fixtures.push(f);
  const readWorld = (db: Database): SavedWorld => JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state);
  const writeWorld = (db: Database, saved: SavedWorld) => db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(saved));
  function restart(edit?: (db: Database) => void) {
    f.live.close(); const db = new Database(dbPath); try { edit?.(db); } finally { db.close(); } f.live = createLiveService(options);
  }
  function savedWorld(): SavedWorld { const db = new Database(dbPath, { readonly: true }); try { return readWorld(db); } finally { db.close(); } }
  function player(db: Database, session: Session, point: LivePoint, alive = true) {
    const row = db.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').all().find(row => JSON.parse(row.state).id === session.id)!;
    const saved = JSON.parse(row.state), body = createHealth(); if (!alive) body.parts.head.hp = 0;
    Object.assign(saved, point, { body, health: alive ? 100 : 0, healthAt: time, safeUntil: 0, dangerUntil: 0, graceUntil: 0,
      respawnAt: alive ? 0 : time + 10_000, nextAttack: 0, destination: null, targetId: null, patrol: false, automation: undefined });
    db.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(saved), row.identity);
  }
  async function call(path: string, session?: Session, body?: object): Promise<Response> {
    const response = await f.live.fetch(new Request(`${ORIGIN}/api/live/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: {
      ...(body === undefined ? {} : { origin: ORIGIN, 'content-type': 'application/json' }),
      ...(session ? { cookie: session.cookie, 'x-prapor-live': session.id } : {}),
      ...(worldVersion ? { 'x-prapor-world-version': worldVersion } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    expect(response).toBeDefined(); expect(response!.status).toBe(200); return response!;
  }
  async function snapshot(response: Response) {
    const result = await response.json() as LiveSnapshot; worldVersion = result.worldVersion; return result;
  }
  async function enter(session?: Session) {
    const response = await call('join', session, {}), state = await snapshot(response);
    return { session: session ?? { id: state.selfId, cookie: response.headers.get('set-cookie')!.split(';')[0]! }, state };
  }
  const state = async (session: Session) => snapshot(await call('state', session));
  const act = async (session: Session, command: LiveCommand) => snapshot(await call('action', session, command));
  async function advance(ms: number, sessions: Session[] = []) {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      time += Math.min(1000, ms - elapsed); f.live.tick();
      for (const session of sessions) await state(session);
    }
  }
  const targetId = `scav-perimeter-${spawnIndex}`;
  restart(db => {
    const saved = readWorld(db);
    saved.scavs = saved.scavs.filter(npc => npc.spawnIndex === spawnIndex || npc.spawnIndex === GUARD);
    for (const npc of saved.scavs) { npc.nextMove = NOW + 10_000_000; npc.nextAttack = NOW + 10_000_000; }
    saved.events = []; writeWorld(db, saved);
  });
  function dead(db: Database) {
    const saved = readWorld(db), npc = saved.scavs.find(npc => npc.id === targetId)!;
    npc.body = createHealth(); npc.body.parts.head.hp = 0; npc.health = 0; npc.respawnAt = time;
    npc.respawnQuietSince = null; writeWorld(db, saved);
  }
  return { f, enter, state, act, advance, restart, player, readWorld, writeWorld, savedWorld, dead, targetId, clock: () => time,
    target: () => savedWorld().scavs.find(npc => npc.id === targetId)!, respawns: () => savedWorld().events.filter(event => event.kind === 'respawn' && event.actorId === targetId) };
}

describe('ordinary NPC replenishment after a shared encounter', () => {
  test('the sawmill patrol stays dead while the player fights its second guard, including beyond the old ten-second loop', async () => {
    const f = await fixture(), { session } = await f.enter();
    f.restart(db => {
      f.player(db, session, DEATH_TILE);
      const saved = f.readWorld(db), target = saved.scavs.find(npc => npc.id === f.targetId)!;
      target.body = createHealth(25); target.health = 25; f.writeWorld(db, saved);
    });
    await f.enter(session);
    await f.act(session, { type: 'attack', targetId: f.targetId });
    expect(f.target().health).toBe(0); expect(f.target().respawnAt).toBe(f.clock() + NPC_RESPAWN_MS);
    await f.advance(10_000, [session]);
    const secondCombat = await f.act(session, { type: 'attack', targetId: `scav-perimeter-${GUARD}` });
    expect(secondCombat.entities.find(npc => npc.id === `scav-perimeter-${GUARD}`)!.health).toBeGreaterThan(0);
    expect(f.target().health).toBe(0); expect(f.respawns()).toHaveLength(0);
    await f.advance(NPC_RESPAWN_MS, [session]);
    expect(f.target().health).toBe(0); expect(f.respawns()).toHaveLength(0);
  });

  test('cover does not refill an occupied encounter; thirty quiet seconds and its restart-persistent timer are required after leaving', async () => {
    const f = await fixture(), { session } = await f.enter(), cover = { x: 755, y: 270 };
    expect(isLiveWalkable(world, cover)).toBe(true); expect(hasLiveLineOfSight(world, cover, world.npcSpawns[PATROL]!.point)).toBe(false);
    f.restart(db => { f.dead(db); f.player(db, session, cover); }); await f.enter(session);
    await f.advance(NPC_RESPAWN_QUIET_MS + 1000, [session]);
    expect(f.target().health).toBe(0); expect(f.target().respawnQuietSince).toBeNull();
    f.restart(db => f.player(db, session, { x: 0, y: 0 })); await f.enter(session);
    await f.advance(1000, [session]); const quietSince = f.target().respawnQuietSince;
    expect(quietSince).toBe(f.clock());
    await f.advance(15_000, [session]); f.restart(); await f.enter(session);
    expect(f.target().respawnQuietSince).toBe(quietSince);
    await f.advance(14_000, [session]); expect(f.target().health).toBe(0);
    await f.advance(1000, [session]); expect(f.target().health).toBe(100); expect(f.respawns()).toHaveLength(1);
  });

  test('an online dead observer cannot see an NPC materialize; an unseen nearby candidate remains eligible', async () => {
    const f = await fixture(), { session } = await f.enter();
    f.restart(db => { f.dead(db); f.player(db, session, DEATH_TILE, false); }); await f.enter(session);
    await f.advance(NPC_RESPAWN_QUIET_MS + 1000, [session]);
    const npc = f.target();
    if (npc.health > 0) {
      expect(hasLiveLineOfSight(world, DEATH_TILE, npc)).toBe(false);
      expect((await f.state(session)).entities.some(entity => entity.id === f.targetId)).toBe(false);
      expect(Math.hypot(npc.x - npc.home.x, npc.y - npc.home.y) <= 4
        || lifePlans[PATROL]!.approaches.some(point => point.x === npc.x && point.y === npc.y)).toBe(true);
    } else expect(f.respawns()).toHaveLength(0);
  });

  test('another connected fighter still protects the encounter after the first leaves, including ticks before reconnect after restart', async () => {
    const f = await fixture(), first = await f.enter(), second = await f.enter();
    f.restart(db => { f.dead(db); f.player(db, first.session, DEATH_TILE); f.player(db, second.session, { x: 754, y: 292 }); });
    await f.enter(first.session); await f.enter(second.session); await f.advance(1000, [first.session, second.session]);
    f.restart(db => f.player(db, first.session, { x: 0, y: 0 })); await f.enter(first.session); await f.enter(second.session);
    await f.advance(NPC_RESPAWN_QUIET_MS + 1000, [first.session, second.session]);
    expect(f.target().health).toBe(0); expect(f.target().respawnQuietSince).toBeNull();
    f.restart(); await f.advance(1000);
    expect(f.target().health).toBe(0); expect(f.target().respawnQuietSince).toBeNull();
    await f.enter(second.session); await f.advance(NPC_RESPAWN_QUIET_MS + 1000, [second.session]);
    expect(f.target().health).toBe(0); expect(f.respawns()).toHaveLength(0);
  });

  test('a persisted death with the legacy ten-second timer receives the new cooldown exactly once', async () => {
    const f = await fixture();
    f.restart(db => {
      f.dead(db); const saved = f.readWorld(db), target = saved.scavs.find(npc => npc.id === f.targetId)!;
      target.respawnAt = NOW + 10_000; delete target.respawnQuietSince; f.writeWorld(db, saved);
    });
    expect(f.target().respawnAt).toBe(NOW + NPC_RESPAWN_MS);
    f.restart(); expect(f.target().respawnAt).toBe(NOW + NPC_RESPAWN_MS);
    await f.advance(NPC_RESPAWN_MS - 1000); expect(f.target().health).toBe(0);
    await f.advance(1000); expect(f.target().health).toBe(100); expect(f.respawns()).toHaveLength(1);
  });

  test('a blocked post is deferred without a false respawn event, then produces exactly one fresh NPC when a cell opens', async () => {
    const f = await fixture(), home = world.npcSpawns[PATROL]!.point;
    f.restart(db => {
      f.dead(db); const saved = f.readWorld(db), target = saved.scavs.find(npc => npc.id === f.targetId)!;
      saved.scavs = [target];
      const candidates = [...lifePlans[PATROL]!.approaches];
      for (let y = home.y - 4; y <= home.y + 4; y++) for (let x = home.x - 4; x <= home.x + 4; x++) {
        const point = { x, y }; if (Math.hypot(x - home.x, y - home.y) <= 4 && isLiveWalkable(world, point)) candidates.push(point);
      }
      for (const point of new Map(candidates.map(point => [`${point.x}-${point.y}`, point])).values())
        saved.scavs.push({ ...structuredClone(target), ...point, id: `blocker-${point.x}-${point.y}`, health: 100, body: createHealth(), respawnAt: 0 });
      f.writeWorld(db, saved);
    });
    await f.advance(NPC_RESPAWN_QUIET_MS + 2000);
    expect(f.target().health).toBe(0); expect(f.respawns()).toHaveLength(0);
    f.restart(db => { const saved = f.readWorld(db); saved.scavs = saved.scavs.filter(npc => npc.id === f.targetId); f.writeWorld(db, saved); });
    await f.advance(NPC_RESPAWN_QUIET_MS);
    expect(f.target().health).toBe(100); expect(f.respawns()).toHaveLength(1);
    await f.advance(5000); expect(f.respawns()).toHaveLength(1);
  });
});
