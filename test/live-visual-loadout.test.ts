import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameService, type GameService } from '../server/game';
import { createLiveService, type LiveService } from '../server/live';
import { readLiveSnapshot } from '../src/live-client';
import { BOSSES } from '../src/game/bosses';
import { WEAPON_BY_ID } from '../src/game/data';
import { FACTORY_KITS } from '../src/game/modules';
import { parseSave, saveGame } from '../src/game/engine';
import { createHealth } from '../src/game/health';
import { getLiveLoadout, type LiveKitId } from '../src/game/live-entry';
import { getLiveMap, hasLiveLineOfSight, isLiveWalkable } from '../src/game/live-maps';
import type { LiveEntity, LivePoint, LiveSnapshot, LiveVisualLoadout } from '../src/game/live';
import { GEAR_MODEL_BY_ID } from '../src/game/systems';
import type { GameSnapshot } from '../src/game/commands';

const ORIGIN = 'http://visible-equipment.test', NOW = 1_800_000_000_000, world = getLiveMap('perimeter');
interface Session { cookie: string; gameId: string; id: string }
interface SavedEntity extends LiveEntity { nextMove: number; nextAttack: number; respawnAt: number; body: ReturnType<typeof createHealth> }
const fixtures: Array<{ folder: string; game: GameService; live: LiveService }> = [];
afterEach(async () => { for (const f of fixtures.splice(0)) { f.live.close(); f.game.close(); await rm(f.folder, { recursive: true, force: true }); } });

async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'prapor-visible-equipment-')), gamePath = join(folder, 'game.sqlite'), livePath = join(folder, 'live.sqlite');
  let time = NOW;
  const game = createGameService({ dbPath: gamePath, secureCookies: false, allowedOrigins: [ORIGIN], now: () => time });
  const options = { dbPath: livePath, secureCookies: false, allowedOrigins: [ORIGIN], now: () => time, random: () => 0, automaticTicks: false, economy: game.liveEconomy };
  const f = { folder, game, live: createLiveService(options) }; fixtures.push(f);
  function request(path: string, session?: Session, body?: unknown) { return new Request(`${ORIGIN}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { origin: ORIGIN, 'content-type': 'application/json' }),
      ...(session ? { cookie: session.cookie, 'x-prapor-game': session.gameId, ...(session.id ? { 'x-prapor-live': session.id } : {}) } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }); }
  async function state(session: Session, body?: unknown): Promise<LiveSnapshot> {
    const reply = (await f.live.fetch(request(body === undefined ? 'live/state' : 'live/join', session, body)))!;
    expect(reply.status).toBe(200); const result = readLiveSnapshot(await reply.json()); session.id = result.selfId; return result;
  }
  async function enter(kitId: LiveKitId = 'scav') {
    const reply = (await game.fetch(request('game/join', undefined, {})))!; expect(reply.status).toBe(200);
    const result = await reply.json() as GameSnapshot;
    const session: Session = { cookie: reply.headers.get('set-cookie')!.split(';')[0]!, gameId: result.identity.id, id: '' };
    return { session, snapshot: await state(session, { kitId }) };
  }
  function restart(edit: (db: Database) => void = () => {}) {
    f.live.close(); const db = new Database(livePath); try { edit(db); } finally { db.close(); } f.live = createLiveService(options);
  }
  function player(db: Database, session: Session, edit: (saved: Record<string, unknown>) => void) {
    const row = db.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').all().find(row => JSON.parse(row.state).id === session.id)!;
    const saved = JSON.parse(row.state); edit(saved); db.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(saved), row.identity);
  }
  function savedWorld() {
    const db = new Database(livePath, { readonly: true }); try { return JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state) as { scavs: SavedEntity[] }; } finally { db.close(); }
  }
  function nearby(center: LivePoint): LivePoint {
    for (const offset of [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }]) {
      const point = { x: center.x + offset.x, y: center.y + offset.y };
      if (isLiveWalkable(world, point) && hasLiveLineOfSight(world, point, center)) return point;
    }
    throw new Error('No nearby visible point');
  }
  const own = (snapshot: LiveSnapshot) => snapshot.entities.find(entity => entity.id === snapshot.selfId)!;
  return { f, gamePath, livePath, enter, state, restart, player, savedWorld, nearby, own, advance: (ms: number) => { time += ms; f.live.tick(); } };
}

describe('authoritative public actor equipment', () => {
  test.each(['scav', 'assault', 'scout'] as const)('%s shows its issued weapon and only public gear flags, including after reconnect', async kitId => {
    const f = await fixture(), { session, snapshot } = await f.enter(kitId), kit = getLiveLoadout(kitId);
    const expected: LiveVisualLoadout = { profile: kitId === 'scav' ? 'light' : kitId, weaponId: kit.weaponId, modules: FACTORY_KITS[kit.weaponId], helmet: true, armor: true, backpack: false };
    expect(f.own(snapshot).visualLoadout).toEqual(expected);
    expect(Object.keys(f.own(snapshot).visualLoadout!).sort()).toEqual(['armor', 'backpack', 'helmet', 'modules', 'profile', 'weaponId']);
    expect(Object.values(f.own(snapshot).visualLoadout!.modules!).every(model => typeof model === 'string')).toBe(true);
    f.restart(db => f.player(db, session, saved => { saved.ammo = 1; saved.cargo = 7; }));
    const resumed = await f.state(session, { intent: 'continue', kitId: kitId === 'scav' ? 'assault' : 'scav' });
    expect(resumed.self.ammo).toBe(1); expect(resumed.self.cargo).toBe(7); expect(f.own(resumed).visualLoadout).toEqual(expected);
    expect(f.own(resumed)).not.toHaveProperty('loadout'); expect(f.own(resumed)).not.toHaveProperty('medicine'); expect(f.own(resumed)).not.toHaveProperty('ammo');
  });

  test('a newly paid life updates the same actor model; a legacy fighter without a field kit stays compatible', async () => {
    const f = await fixture(), { session, snapshot } = await f.enter('scav');
    const gameDb = new Database(f.gamePath); try {
      const row = gameDb.query<{ state: string }, [string]>('SELECT state FROM authoritative_games WHERE id=?').get(session.gameId)!, game = parseSave(row.state)!;
      game.supplies.ammo = 100; gameDb.query('UPDATE authoritative_games SET state=? WHERE id=?').run(saveGame(game), session.gameId);
    } finally { gameDb.close(); }
    f.restart(db => f.player(db, session, saved => { const body = createHealth(); body.parts.head.hp = 0; Object.assign(saved, { body, health: 0, respawnAt: NOW }); }));
    const next = await f.state(session, { intent: 'deploy', kitId: 'assault' });
    expect(next.selfId).toBe(snapshot.selfId); expect(next.self.loadout?.weaponId).toBe('pp91'); expect(f.own(next).visualLoadout?.weaponId).toBe('pp91');
    expect(f.own(next).visualLoadout?.profile).toBe('assault');
    f.restart(db => f.player(db, session, saved => { delete saved.loadout; }));
    const legacy = await f.state(session, { intent: 'continue' }); expect(legacy.self.loadout).toBeUndefined(); expect(f.own(legacy).visualLoadout).toBeUndefined();
  });

  test('other visible players expose their actual equipment while out-of-sight players and private supplies remain absent', async () => {
    const f = await fixture(), first = await f.enter('scout'), second = await f.enter('assault');
    const point = first.snapshot.entities.find(entity => entity.id === first.session.id)!, near = f.nearby(point);
    f.restart(db => f.player(db, second.session, saved => { Object.assign(saved, near, { ammo: 3, cargo: 4 }); }));
    await f.state(second.session, { intent: 'continue' }); const visible = await f.state(first.session, { intent: 'continue' });
    const other = visible.entities.find(entity => entity.id === second.session.id)!;
    expect(other.visualLoadout).toEqual({ profile: 'assault', weaponId: 'pp91', modules: FACTORY_KITS.pp91, helmet: true, armor: true, backpack: false });
    for (const key of ['loadout', 'body', 'medicine', 'ammo', 'cargo', 'lootItems', 'pendingDelivery']) expect(other).not.toHaveProperty(key);
    const far = world.districts.find(district => Math.hypot(district.spawns[0]!.x - point.x, district.spawns[0]!.y - point.y) > 24)!.spawns[0]!;
    f.restart(db => f.player(db, second.session, saved => { Object.assign(saved, far); }));
    await f.state(second.session, { intent: 'continue' }); const hidden = await f.state(first.session, { intent: 'continue' });
    expect(hidden.entities.some(entity => entity.id === second.session.id)).toBe(false);
    expect(JSON.stringify(hidden.entities)).not.toContain(second.session.id);
  });

  test('every NPC role has a server-authored catalog weapon, reconciles old saves and keeps its equipment on respawn', async () => {
    const f = await fixture(), { session } = await f.enter(), original = f.savedWorld().scavs;
    const expectedWeapons: Record<string, string> = { 'scavs:patrol': 'pm', 'scavs:guard': 'pp91', 'scavs:marksman': 'mosin', 'raiders:patrol': 'akm', 'raiders:guard': 'akm', 'raiders:marksman': 'svd' };
    const representatives = new Map(original.map(scav => [`${scav.faction}:${scav.role}`, scav])); expect(representatives.size).toBe(6);
    for (const [key, scav] of representatives) {
      expect(scav.visualLoadout?.weaponId).toBe(expectedWeapons[key]!); expect(WEAPON_BY_ID[scav.visualLoadout!.weaponId!]).toBeDefined();
      expect(scav.visualLoadout).toMatchObject({ helmet: true, armor: true, backpack: false });
    }
    const target = representatives.get('raiders:marksman')!, before = target.visualLoadout;
    f.restart(db => {
      const saved = f.savedWorld(); for (const scav of saved.scavs) delete scav.visualLoadout;
      const targetSaved = saved.scavs.find(scav => scav.id === target.id)!; targetSaved.body = createHealth(); targetSaved.body.parts.head.hp = 0; targetSaved.health = 0; targetSaved.respawnAt = NOW;
      db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify({ ...JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state), scavs: saved.scavs }));
      f.player(db, session, player => { Object.assign(player, f.nearby(target)); });
    });
    let snapshot = await f.state(session, { intent: 'continue' }); expect(snapshot.entities.find(entity => entity.id === target.id)?.visualLoadout).toEqual(before);
    f.advance(250); snapshot = await f.state(session); const respawned = snapshot.entities.find(entity => entity.id === target.id)!;
    expect(respawned.health).toBe(100); expect(respawned.visualLoadout).toEqual(before);
  });

  test('boss bodies use their exact authored weapon and gear slot while unseen bosses expose no loadout', async () => {
    const f = await fixture(), { session, snapshot } = await f.enter(); expect(snapshot.entities.some(entity => entity.bossId)).toBe(false);
    for (const definition of BOSSES) {
      let boss!: SavedEntity;
      f.restart(db => { boss = JSON.parse(db.query<{ state: string }, [string]>('SELECT state FROM live_bosses WHERE boss_id=?').get(definition.id)!.state); f.player(db, session, player => { Object.assign(player, f.nearby(boss)); }); });
      const observed = await f.state(session, { intent: 'continue' }), body = observed.entities.find(entity => entity.bossId === definition.id)!;
      expect(body).toBeDefined(); const slot = GEAR_MODEL_BY_ID[definition.armorModelId]!.slot;
      expect(body.visualLoadout).toEqual({ profile: WEAPON_BY_ID[definition.weaponId]!.category === 'sniper' ? 'scout' : 'assault', weaponId: definition.weaponId, modules: FACTORY_KITS[definition.weaponId],
        helmet: slot === 'helmet', armor: slot === 'armor', backpack: slot === 'backpack' });
      for (const key of ['body', 'bossLastHit', 'items', 'ammo', 'loadout']) expect(body).not.toHaveProperty(key);
    }
  });
});
