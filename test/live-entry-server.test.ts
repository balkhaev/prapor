import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameService, type GameService } from '../server/game';
import { createLiveService, type LiveService } from '../server/live';
import { LiveEconomyError, type LiveSupplyRequest } from '../server/live-economy';
import { parseSave, saveGame, type GameState } from '../src/game/engine';
import { applyHit, createHealth, createMedicalInventory } from '../src/game/health';
import { createLiveNavigation } from '../server/live-navigation';
import { getLiveLoadout, LIVE_FIELD_KITS, type LiveEntry, type LiveKitId } from '../src/game/live-entry';
import type { GameSnapshot } from '../src/game/commands';
import type { LiveSnapshot } from '../src/game/live';

const ORIGIN = 'http://field-entry.test', NOW = 1_792_000_000_000;
interface Client { cookie: string; game: GameSnapshot; live?: LiveSnapshot }
interface Fixture {
  folder: string; gamePath: string; livePath: string; game: GameService; live: LiveService;
  interrupt(): void; setTime(value: number): void; client(): Promise<Client>;
  call(path: string, client: Client, body?: unknown): Promise<Response>; entry(client: Client): Promise<LiveEntry>;
  enter(client: Client, kitId?: LiveKitId, intent?: 'continue' | 'deploy'): Promise<LiveSnapshot>;
  state(client: Client): Promise<GameSnapshot>; seed(client: Client, change: (state: GameState) => void): void;
  restart(change?: (db: Database) => void): void;
}
const fixtures: Fixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) { f.live.close(); f.game.close(); await rm(f.folder, { recursive: true, force: true }); } });
async function fixture(): Promise<Fixture> {
  const folder = await mkdtemp(join(tmpdir(), 'prapor-field-entry-')), gamePath = join(folder, 'game.sqlite'), livePath = join(folder, 'live.sqlite');
  let time = NOW, interrupted = false;
  const gameOptions = { dbPath: gamePath, secureCookies: false, allowedOrigins: [ORIGIN], now: () => time };
  let game: GameService = createGameService(gameOptions);
  const bridge = { resolve: (request: Request) => game.liveEconomy.resolve(request), entry: (identity: Parameters<NonNullable<typeof game.liveEconomy.entry>>[0]) => game.liveEconomy.entry!(identity),
    deliver: (parcel: Parameters<typeof game.liveEconomy.deliver>[0]) => game.liveEconomy.deliver(parcel),
    supply: (request: LiveSupplyRequest) => { const receipt = game.liveEconomy.supply(request); if (interrupted) { interrupted = false; throw new Error('Interrupted after committed launch debit'); } return receipt; } };
  const liveOptions = { dbPath: livePath, secureCookies: false, allowedOrigins: [ORIGIN], now: () => time, random: () => 0, automaticTicks: false, economy: bridge };
  const f: Fixture = { folder, gamePath, livePath, game, live: createLiveService(liveOptions), interrupt: () => { interrupted = true; }, setTime: (value: number) => { time = value; },
    async client(): Promise<Client> {
      const reply = (await game.fetch(request('game/join', undefined, {})))!; expect(reply.status).toBe(200);
      return { cookie: reply.headers.get('set-cookie')!.split(';')[0]!, game: await reply.json() as GameSnapshot };
    },
    async call(path: string, client: Client, body?: unknown) { return (await f.live.fetch(request(`live/${path}`, client, body)))!; },
    async entry(client: Client) { const reply = await f.call('entry', client); expect(reply.status).toBe(200); return await reply.json() as LiveEntry; },
    async enter(client: Client, kitId?: LiveKitId, intent?: 'continue' | 'deploy') { const reply = await f.call('join', client, { ...(kitId ? { kitId } : {}), ...(intent ? { intent } : {}) }); expect(reply.status).toBe(200); client.live = await reply.json() as LiveSnapshot; return client.live; },
    async state(client: Client) { const reply = (await game.fetch(request('game/state', client)))!; expect(reply.status).toBe(200); client.game = await reply.json() as GameSnapshot; return client.game; },
    seed(client: Client, change: (state: GameState) => void) {
      const db = new Database(gamePath); try { const row = db.query<{state: string}, [string]>('SELECT state FROM authoritative_games WHERE id=?').get(client.game.identity.id)!;
        const state = parseSave(row.state)!; change(state); const encoded = saveGame(state); expect(parseSave(encoded)).not.toBeNull(); db.query('UPDATE authoritative_games SET state=? WHERE id=?').run(encoded, client.game.identity.id); } finally { db.close(); }
    },
    restart(change?: (db: Database) => void) { f.live.close(); if (change) { const db = new Database(livePath); try { change(db); } finally { db.close(); } } f.game.close(); game = createGameService(gameOptions); f.game = game; f.live = createLiveService(liveOptions); },
  };
  function request(path: string, client?: Client, body?: unknown) { return new Request(`${ORIGIN}/api/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: {
    ...(body === undefined ? {} : { origin: ORIGIN, 'content-type': 'application/json' }), ...(client ? { cookie: client.cookie, 'x-prapor-game': client.game.identity.id, ...(client.live ? { 'x-prapor-live': client.live.selfId } : {}) } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  fixtures.push(f); return f;
}
function count(path: string, table: string) { const db = new Database(path, { readonly: true }); try { return db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n; } finally { db.close(); } }
function stored(path: string, table: 'authoritative_games' | 'live_world') { const db = new Database(path, { readonly: true }); try { return db.query<{ state: string }, []>(`SELECT state FROM ${table}`).all().map(row => row.state); } finally { db.close(); } }

describe('authoritative multiplayer preparation and immutable field kits', () => {
  test('entry is a read-only plan; it neither creates a fighter nor enrols an economy link or changes progress', async () => {
    const f = await fixture(), player = await f.client(), beforeGame = stored(f.gamePath, 'authoritative_games'), beforeWorld = stored(f.livePath, 'live_world');
    for (let i = 0; i < 3; i++) {
      const entry = await f.entry(player); expect(entry.mode).toBe('new'); expect(entry.fighter).toBeNull(); expect(entry.stock).toEqual({ money: 640, ammo: 24, medicine: 6 });
      expect(entry.kits.map(kit => [kit.kitId, kit.ammo, kit.medkits, kit.cost.money])).toEqual([['scav', 24, 2, 0], ['assault', 24, 2, 180], ['scout', 24, 2, 140]]);
    }
    expect(count(f.livePath, 'live_players')).toBe(0); expect(count(f.livePath, 'live_game_owners')).toBe(0); expect(count(f.livePath, 'live_economy_outbox')).toBe(0);
    expect(count(f.gamePath, 'authoritative_live_links')).toBe(0); expect(count(f.gamePath, 'authoritative_live_supplies')).toBe(0);
    expect(stored(f.gamePath, 'authoritative_games')).toEqual(beforeGame); expect(stored(f.livePath, 'live_world')).toEqual(beforeWorld);
    const other = await f.client(); const stolen = new Request(`${ORIGIN}/api/live/entry`, { headers: { cookie: player.cookie, 'x-prapor-game': other.game.identity.id } });
    expect((await f.live.fetch(stolen))!.status).toBe(401);
  });

  test.each(['scav', 'assault', 'scout'] as const)('%s spends only real stock and its server cash price once; continuing never buys another life or kit', async kitId => {
    const f = await fixture(), player = await f.client(), before = structuredClone(player.game), snapshot = await f.enter(player, kitId);
    expect(snapshot.self.loadout).toEqual(getLiveLoadout(kitId)); expect(snapshot.self.ammo).toBe(24); expect(snapshot.self.medicine.medkit).toBe(80);
    const paid = await f.state(player); expect(paid.state.money).toBe(before.state.money - LIVE_FIELD_KITS[kitId].money); expect(paid.state.supplies.ammo).toBe(0); expect(paid.state.supplies.medicine).toBe(4);
    expect(paid.state.weapons).toEqual(before.state.weapons); expect(paid.state.gearItems).toEqual(before.state.gearItems); expect(paid.revision).toBe(before.revision + 1);
    expect((await f.entry(player)).mode).toBe('continue'); expect((await f.call('join', player, { intent: 'deploy', kitId: 'scav' })).status).toBe(409);
    for (let i = 0; i < 2; i++) { const resumed = await f.enter(player, kitId === 'scav' ? 'assault' : 'scav', 'continue'); expect(resumed.selfId).toBe(snapshot.selfId); expect(resumed.self.body).toEqual(snapshot.self.body); expect(resumed.self.loadout).toEqual(snapshot.self.loadout); expect(resumed.self.ammo).toBe(snapshot.self.ammo); }
    expect(await f.state(player)).toEqual(paid); expect(count(f.gamePath, 'authoritative_live_supplies')).toBe(1);
  });

  test('unknown or forged kits and unaffordable entry leave no body, debit or receipt, while default still charges actual supplies', async () => {
    const f = await fixture(), player = await f.client();
    for (const body of [{ kitId: 'admin' }, { kitId: 'scav', ammo: 999 }, { kitId: 'scout', damage: 999 }, { kitId: 'assault', cost: 0 }]) expect((await f.call('join', player, body)).status).toBe(400);
    f.seed(player, state => { state.money = 100; }); const before = await f.state(player);
    const denied = await f.call('join', player, { intent: 'deploy', kitId: 'assault' }); expect(denied.status).toBe(409); expect(await denied.json()).toEqual({ code: 'insufficient_money' });
    expect(count(f.livePath, 'live_players')).toBe(0); expect(count(f.gamePath, 'authoritative_live_supplies')).toBe(0); expect(await f.state(player)).toEqual(before);
    await f.enter(player); expect((await f.state(player)).state.supplies.ammo).toBe(0);
  });

  test('a lost response after committed cash and supplies replays the same launch journal across two restarts', async () => {
    const f = await fixture(), player = await f.client(); f.interrupt();
    const failed = await f.call('join', player, { kitId: 'scout', intent: 'deploy', districtId: 'village', purpose: 'quests' });
    expect(failed.status).toBe(409); expect(await failed.json()).toEqual({ code: 'launch_pending' }); expect(f.live.healthy()).toBe(true);
    const pending = await f.entry(player), paid = await f.state(player); expect(pending.fighter?.launchPending).toBe(true); expect(paid.state.money).toBe(500); expect(paid.state.supplies.ammo).toBe(0); expect(paid.state.supplies.medicine).toBe(4);
    expect((await f.call('join', player, { kitId: 'admin' })).status).toBe(400);
    f.restart(); const resumed = await f.enter(player, 'assault', 'continue'); expect(resumed.selfId).toBe(pending.fighter!.id); expect(resumed.self.loadout?.kitId).toBe('scout'); expect(resumed.self.districtId).toBe('village'); expect(resumed.self.ammo).toBe(24); expect(resumed.self.launchPending).toBeUndefined();
    expect(await f.state(player)).toEqual(paid); f.restart(); expect((await f.enter(player, undefined, 'continue')).self).toMatchObject({ ammo: 24, loadout: getLiveLoadout('scout') });
    expect(await f.state(player)).toEqual(paid); expect(count(f.gamePath, 'authoritative_live_supplies')).toBe(1);
  });

  test('bridge kit receipts reject altered id, owner and price requests and cash failure cannot partly debit ammunition', async () => {
    const f = await fixture(), player = await f.client(); await f.enter(player); f.seed(player, state => { state.supplies.ammo = 60; state.money = 139; }); const before = await f.state(player);
    const owner = f.game.liveEconomy.resolve(new Request(`${ORIGIN}/api/game/state`, { headers: { cookie: player.cookie, 'x-prapor-game': player.game.identity.id } }));
    const request: LiveSupplyRequest = { id: randomUUID(), owner: owner.key, gameId: owner.gameId, createdAt: NOW, ammo: 40, medkits: 2, kitId: 'scout' };
    expect(() => f.game.liveEconomy.supply(request)).toThrow('insufficient_money'); expect(await f.state(player)).toEqual(before); expect(count(f.gamePath, 'authoritative_live_supplies')).toBe(1);
    f.seed(player, state => { state.money = 140; }); const receipt = f.game.liveEconomy.supply(request); expect(receipt.money).toBe(140); const after = await f.state(player);
    expect(f.game.liveEconomy.supply({ ...request })).toEqual(receipt); expect(() => f.game.liveEconomy.supply({ ...request, kitId: 'assault', ammo: 60 })).toThrow(LiveEconomyError);
    expect(() => f.game.liveEconomy.supply({ ...request, ammo: 1 })).toThrow('invalid_live_supply'); expect(await f.state(player)).toEqual(after);
  });

  test('a dead fighter purchases a fresh kit after the cooldown; living and legacy bodies cannot be healed or teleported by entry', async () => {
    const f = await fixture(), player = await f.client(); const first = await f.enter(player);
    f.seed(player, state => { state.supplies.ammo = 60; });
    f.restart(db => { const row = db.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').get()!; const body = JSON.parse(row.state); body.body = createHealth(); body.body.parts.head.hp = 0; body.health = 0; body.respawnAt = NOW + 10_000; body.ammo = 7; body.medicine = createMedicalInventory({ medkit: 23, bandage: 0 }); db.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(body), row.identity); });
    expect((await f.entry(player)).mode).toBe('downed'); expect((await f.call('join', player, { intent: 'deploy', kitId: 'assault' })).status).toBe(409);
    f.setTime(NOW + 10_000); const next = await f.enter(player, 'assault', 'deploy'); expect(next.selfId).toBe(first.selfId); expect(next.self.ammo).toBe(60); expect(next.self.medicine.medkit).toBe(80); expect(next.self.body.parts.head.hp).toBeGreaterThan(0);
    expect((await f.state(player)).state.money).toBe(460); expect(count(f.gamePath, 'authoritative_live_supplies')).toBe(2);
    f.restart(db => { const row = db.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').get()!, body = JSON.parse(row.state); delete body.loadout; body.body = createHealth(71); body.health = 71; body.ammo = 17; body.cargo = 65; body.x = 6; body.y = 6; body.medicine = createMedicalInventory({ medkit: 27, bandage: 0 }); db.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(body), row.identity); });
    const paid = await f.state(player), legacy = await f.enter(player, 'scout', 'continue'); expect(legacy.self.loadout).toBeUndefined(); expect(legacy.self.ammo).toBe(17); expect(legacy.self.cargo).toBe(65); expect(legacy.self.body).toEqual(createHealth(71)); expect(legacy.self.medicine.medkit).toBe(27); expect(await f.state(player)).toEqual(paid);
  });

  test.each(['scav', 'assault', 'scout'] as const)('%s uses its real damage, shot interval and protection during shared PvP', async kitId => {
    const f = await fixture(), attacker = await f.client(), target = await f.client();
    const first = await f.enter(attacker, kitId); await f.enter(target, 'assault');
    const nav = createLiveNavigation(first.world); let position: { x: number; y: number } | undefined;
    for (let y = 3; y < 45 && !position; y++) for (let x = 3; x < 45 && !position; x++) if (nav.walkable({ x, y }) && nav.walkable({ x: x + 3, y }) && nav.hasLineOfSight({ x, y }, { x: x + 3, y })) position = { x, y };
    expect(position).toBeDefined();
    f.restart(db => {
      for (const row of db.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').all()) { const body = JSON.parse(row.state); const offset = body.id === first.selfId ? 0 : 3; Object.assign(body, { x: position!.x + offset, y: position!.y, safeUntil: 0, health: 100, body: createHealth(), nextAttack: 0 }); db.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(body), row.identity); }
      const row = db.query<{ state: string }, []>('SELECT state FROM live_world').get()!, world = JSON.parse(row.state); for (const npc of world.scavs) { npc.health = 0; npc.body = createHealth(); npc.body.parts.head.hp = 0; npc.respawnAt = NOW + 100_000; } db.query('UPDATE live_world SET state=?').run(JSON.stringify(world));
    });
    await f.enter(attacker, undefined, 'continue'); await f.enter(target, undefined, 'continue');
    const hit = await f.call('action', attacker, { type: 'attack', targetId: target.live!.selfId }); expect(hit.status).toBe(200); const shot = await hit.json() as LiveSnapshot;
    const expected = applyHit(createHealth(), 'chest', LIVE_FIELD_KITS[kitId].damage, { protection: LIVE_FIELD_KITS.assault.armorProtection, penetration: .1, bleeding: 'heavy' });
    expect([...shot.events].reverse().find(event => event.actorId === attacker.live!.selfId && event.targetId === target.live!.selfId)?.damage).toBe(expected.damage);
    expect(shot.self.ammo).toBe(first.self.ammo - 1);
    f.setTime(NOW + LIVE_FIELD_KITS[kitId].attackMs - 1); expect((await f.call('action', attacker, { type: 'attack', targetId: target.live!.selfId })).status).toBe(429);
    f.setTime(NOW + LIVE_FIELD_KITS[kitId].attackMs); expect((await f.call('action', attacker, { type: 'attack', targetId: target.live!.selfId })).status).toBe(200); expect(f.live.healthy()).toBe(true);
  });

  test('a local launch acknowledgement storage failure preserves the debit and recovers one exact body and field kit', async () => {
    const f = await fixture(), player = await f.client();
    const db = new Database(f.livePath); try { db.exec("CREATE TRIGGER reject_launch_ack BEFORE UPDATE OF acknowledged ON live_economy_outbox WHEN NEW.acknowledged=1 BEGIN SELECT RAISE(ABORT,'injected launch acknowledgement failure'); END"); } finally { db.close(); }
    expect((await f.call('join', player, { kitId: 'assault', districtId: 'depot' })).status).toBe(503); expect(f.live.healthy()).toBe(false);
    const paid = await f.state(player); expect(paid.state.money).toBe(460); expect(paid.state.supplies.ammo).toBe(0); expect(paid.state.supplies.medicine).toBe(4);
    f.restart(db => { db.exec('DROP TRIGGER reject_launch_ack'); }); const joined = await f.enter(player, undefined, 'continue'); expect(joined.self.loadout).toEqual(getLiveLoadout('assault')); expect(joined.self.ammo).toBe(24); expect(joined.self.medicine.medkit).toBe(80); expect(joined.self.districtId).toBe('depot');
    expect(await f.state(player)).toEqual(paid); expect(count(f.gamePath, 'authoritative_live_supplies')).toBe(1); f.restart(); expect((await f.enter(player, undefined, 'continue')).selfId).toBe(joined.selfId); expect(await f.state(player)).toEqual(paid);
  });
});
