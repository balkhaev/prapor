import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameService, type GameService } from '../server/game';
import { createLiveService, type LiveService } from '../server/live';
import { getBoss, type BossId } from '../src/game/bosses';
import { getLiveBossArena } from '../src/game/live-boss-arenas';
import { getLiveMap, hasLiveLineOfSight, isLiveWalkable } from '../src/game/live-maps';
import { createHealth, healthPercent } from '../src/game/health';
import { getLiveLootWeight } from '../src/game/live-loot';
import { BARTER_OFFERS } from '../src/game/barter';
import type { GameActionSnapshot, GameCommand, GameSnapshot } from '../src/game/commands';
import type { LiveCommand, LiveSnapshot } from '../src/game/live';
import { readLiveSnapshot, readLiveStatus } from '../src/live-client';

const ORIGIN = 'http://bosses.test', NOW = 1_800_000_000_000, world = getLiveMap('perimeter');
const fixtures: Array<{ folder: string; game: GameService; live: LiveService }> = [];
afterEach(async () => { for (const f of fixtures.splice(0)) { f.live.close(); f.game.close(); await rm(f.folder, { recursive: true, force: true }); } });
interface Player { cookie: string; game: GameSnapshot; live: LiveSnapshot }
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'prapor-bosses-')), gamePath = join(folder, 'game.sqlite'), livePath = join(folder, 'live.sqlite');
  let time = NOW;
  const game = createGameService({ dbPath: gamePath, secureCookies: false, allowedOrigins: [ORIGIN], now: () => time });
  const options = { dbPath: livePath, secureCookies: false, allowedOrigins: [ORIGIN], now: () => time, random: () => .9, automaticTicks: false, economy: game.liveEconomy };
  const f = { folder, game, live: createLiveService(options) }; fixtures.push(f);
  const request = (path: string, player?: Player, body?: unknown) => new Request(`${ORIGIN}/api/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: {
    ...(body === undefined ? {} : { origin: ORIGIN, 'content-type': 'application/json' }),
    ...(player ? { cookie: player.cookie, 'x-prapor-game': player.game.identity.id, 'x-prapor-live': player.live.selfId } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  async function enter(): Promise<Player> {
    const reply = (await game.fetch(request('game/join', undefined, {})))!; expect(reply.status).toBe(200);
    const player = { cookie: reply.headers.get('set-cookie')!.split(';')[0]!, game: await reply.json() as GameSnapshot, live: { selfId: '' } as LiveSnapshot };
    const live = (await f.live.fetch(request('live/join', player, { purpose: 'boss' })))!; expect(live.status).toBe(200);
    player.live = readLiveSnapshot(await live.json()); return player;
  }
  async function state(player: Player) { const response = (await f.live.fetch(request('live/state', player)))!; expect(response.status).toBe(200); player.live = readLiveSnapshot(await response.json()); return player.live; }
  async function act(player: Player, command: LiveCommand | object, status = 200) {
    const response = (await f.live.fetch(request('live/action', player, command)))!; expect(response.status).toBe(status);
    if (response.ok) player.live = readLiveSnapshot(await response.json()); return response;
  }
  async function gameState(player: Player) { const response = (await game.fetch(request('game/state', player)))!; expect(response.status).toBe(200); player.game = await response.json() as GameSnapshot; return player.game; }
  async function gameAct(player: Player, command: GameCommand) {
    const response = (await game.fetch(request('game/action', player, { revision: player.game.revision, command })))!;
    expect(response.status).toBe(200); player.game = await response.json() as GameActionSnapshot; expect((player.game as GameActionSnapshot).result.ok).toBe(true);
  }
  async function restart(players: Player[] = [], edit?: (db: Database) => void) {
    f.live.close();
    if (edit) { const db = new Database(livePath); try { edit(db); } finally { db.close(); } }
    f.live = createLiveService(options);
    for (const player of players) { const response = (await f.live.fetch(request('live/join', player, {})))!; expect(response.status).toBe(200); player.live = readLiveSnapshot(await response.json()); }
  }
  const readBoss = (db: Database, bossId: BossId) => JSON.parse(db.query<{ state: string }, [string]>('SELECT state FROM live_bosses WHERE boss_id=?').get(bossId)!.state);
  function bossState(bossId: BossId) { const db = new Database(livePath); try { return readBoss(db, bossId); } finally { db.close(); } }
  async function place(players: Player[], bossId?: BossId, exit = false, freezeBoss = false) {
    await restart(players, db => {
      const row = db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!, saved = JSON.parse(row.state);
      for (const scav of saved.scavs) { scav.body = createHealth(); scav.body.parts.head.hp = 0; scav.health = 0; scav.respawnAt = time + 10_000_000; }
      db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(saved));
      const boss = bossId ? readBoss(db, bossId) : undefined;
      if (boss && freezeBoss) { boss.nextAttack = time + 10_000_000; boss.nextMove = time + 10_000_000; db.query('UPDATE live_bosses SET state=? WHERE boss_id=?').run(JSON.stringify(boss), bossId!); }
      const center = exit ? world.extracts[0]! : boss ?? world.extracts[0]!;
      const positions = [{ x: center.x - 1, y: center.y }, { x: center.x + 1, y: center.y }, { x: center.x, y: center.y - 1 }, { x: center.x, y: center.y + 1 }]
        .filter(point => isLiveWalkable(world, point) && hasLiveLineOfSight(world, point, center));
      expect(positions.length).toBeGreaterThanOrEqual(players.length);
      for (const [index, player] of players.entries()) {
        const row = db.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').all().find(row => JSON.parse(row.state).id === player.live.selfId)!;
        const saved = JSON.parse(row.state);
        Object.assign(saved, exit ? world.extracts[0]! : positions[index]!, { body: createHealth(), health: 100, healthAt: time, safeUntil: 0, dangerUntil: 0, lastCombatAt: 0, nextAttack: 0, leaveAt: 0, targetId: null });
        db.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(saved), row.identity);
      }
    });
  }
  async function advance(ms: number, players: Player[] = []) {
    for (let elapsed = 0; elapsed < ms; elapsed += 250) { time += Math.min(250, ms - elapsed); f.live.tick(); if (elapsed % 1000 === 0) for (const player of players) await state(player); }
    for (const player of players) await state(player);
  }
  const jump = (ms: number) => { time += ms; f.live.tick(); };
  return { f, request, enter, state, act, gameState, gameAct, restart, readBoss, bossState, place, advance, jump, clock: () => time, setClock: (value: number) => { time = value; } };
}

describe('persistent shared live boss hunts', () => {
  test('old worlds reconcile four bosses at authored dangerous posts; roster exposes arenas while unseen bodies and rewards stay private', async () => {
    const f = await fixture(), player = await f.enter();
    expect(player.live.self.purpose).toBe('boss'); expect(player.live.server.bosses).toHaveLength(4);
    expect(player.live.entities.some(entity => entity.bossId)).toBe(false);
    for (const boss of player.live.server.bosses!) {
      const definition = getBoss(boss.bossId)!, arena = getLiveBossArena(world, boss.bossId), poi = world.pois.find(poi => poi.id === boss.poiId)!;
      expect(poi.danger).toBe(3); expect(poi.templateId).toBe(definition.poiTemplateId); expect(poi.districtId).toBe(definition.districtId);
      expect(boss.area).toEqual(arena.area); expect(boss).toMatchObject({ state: 'alive', respawnAt: 0 });
      expect(Object.keys(boss).sort()).toEqual(['area', 'bossId', 'districtId', 'name', 'poiId', 'respawnAt', 'state']);
      expect(f.bossState(boss.bossId)).not.toHaveProperty('items');
    }
    await f.restart([player], db => db.query('DELETE FROM live_bosses').run());
    expect(player.live.server.bosses).toHaveLength(4);
    const legacy = structuredClone(player.live); delete legacy.server.bosses; delete legacy.self.bossKills;
    expect(readLiveSnapshot(legacy)).toEqual(legacy);
  });

  test('two real headquarters kill one tougher boss, contend for its exact four trophies, extract and barter its token once', async () => {
    const f = await fixture(), first = await f.enter(), second = await f.enter(); await f.place([first, second], 'bugor');
    const boss = first.live.entities.find(entity => entity.bossId === 'bugor')!;
    expect(boss.health).toBe(100); expect(boss).not.toHaveProperty('body'); expect(boss).not.toHaveProperty('bossLastHit');
    await f.advance(750, [first, second]);
    await Promise.all([f.act(first, { type: 'attack', targetId: boss.id, aimed: true }), f.act(second, { type: 'attack', targetId: boss.id, aimed: true })]);
    await f.advance(1000, [first, second]); expect(f.bossState('bugor').health).toBe(100);
    await f.advance(1000, [first, second]);
    const corpse = first.live.drops.find(drop => drop.bossId === 'bugor')!, definition = getBoss('bugor')!;
    expect(corpse).toBeDefined(); expect(corpse.amount).toBe(definition.bounty); expect(corpse.items!.map(item => item.modelId)).toEqual([definition.trophyModelId, definition.lootModelId, definition.gearModelId, definition.moduleModelId]);
    expect(corpse.items!.flatMap(item => item.kind === 'gear' || item.kind === 'module' ? [item.durability] : [])).toEqual([90, 90]);
    expect(corpse.items!.reduce((weight, item) => weight + getLiveLootWeight(item), 0)).toBeLessThanOrEqual(12);
    expect(first.live.self.bossKills! + second.live.self.bossKills!).toBe(1);
    expect([first, second].some(player => Object.values(player.live.self.body.parts).some(part => part.hp < part.maxHp))).toBe(true);
    const outcomes = await Promise.all([f.act(first, { type: 'loot', id: corpse.id }), f.act(second, { type: 'loot', id: corpse.id }, 409)]);
    expect(outcomes.map(response => response.status)).toEqual([200, 409]); expect(first.live.self.lootItems).toEqual(corpse.items);
    await f.place([first, second], undefined, true); await f.act(first, { type: 'extract' });
    const delivered = await f.gameState(first), token = delivered.state.lootItems!.find(item => item.modelId === definition.trophyModelId)!;
    expect(delivered.state.gearItems.find(item => item.modelId === definition.gearModelId)!.durability).toBe(90);
    expect(delivered.state.modules.find(item => item.modelId === definition.moduleModelId)!.durability).toBe(90);
    const offer = BARTER_OFFERS.find(offer => offer.requirements.some(need => need.modelId === definition.trophyModelId))!;
    await f.gameAct(first, { type: 'barterGear', args: [offer.id, [token.id]] });
    expect(first.game.state.lootItems!.some(item => item.id === token.id)).toBe(false);
    expect(first.game.state.gearItems.filter(item => item.modelId === definition.gearModelId).map(item => item.durability).sort((a, b) => a - b)).toEqual([90, 100]);
    const before = structuredClone(first.game.state); await f.restart([first, second]);
    await f.act(first, { type: 'loot', id: corpse.id }, 409); await f.act(first, { type: 'extract' });
    expect((await f.gameState(first)).state.gearItems).toEqual(before.gearItems); expect(first.game.state.modules).toEqual(before.modules);
    expect((await f.gameState(second)).state.lootItems ?? []).toEqual([]);
  });

  test('corpse identity, defeated body, kill credit and absolute cooldown survive geometry migration and repeated restarts; respawn starts one new cycle', async () => {
    const f = await fixture(), player = await f.enter(); await f.place([player], 'komendant', false, true);
    const id = 'boss-komendant';
    for (let shot = 0; shot < 3; shot++) { await f.act(player, { type: 'attack', targetId: id, aimed: true }); await f.advance(2000, [player]); if (shot < 2) await f.advance(2000, [player]); }
    const corpse = structuredClone(player.live.drops.find(drop => drop.bossId === 'komendant')!), killed = f.bossState('komendant');
    expect(corpse.items).toHaveLength(4); expect(corpse.items!.reduce((sum, item) => sum + getLiveLootWeight(item), 0)).toBeLessThanOrEqual(12);
    expect(killed).toMatchObject({ bossCycle: 1, bossDeathSettled: true, health: 0 }); expect(player.live.self.bossKills).toBe(1);
    await f.restart([player], db => {
      const row = db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!, saved = JSON.parse(row.state); saved.geometryVersion = 'previous-layout';
      db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(saved));
    });
    expect(player.live.drops.find(drop => drop.id === corpse.id)).toEqual(corpse); expect(f.bossState('komendant').body).toEqual(killed.body);
    expect(f.bossState('komendant').respawnAt).toBe(killed.respawnAt); expect(player.live.self.bossKills).toBe(1);
    await f.restart([player]); expect(player.live.drops.filter(drop => drop.bossId === 'komendant')).toHaveLength(1);
    f.setClock(killed.respawnAt - 1); f.f.live.tick(); expect(f.bossState('komendant').bossCycle).toBe(1);
    const status = (await f.f.live.fetch(f.request('live/status')))!;
    expect(readLiveStatus(await status.json()).bosses!.find(boss => boss.bossId === 'komendant')!.state).toBe('defeated');
    f.jump(1001); expect(f.bossState('komendant')).toMatchObject({ bossCycle: 2, bossDeathSettled: false, health: 100 });
    await f.restart([player]); expect(player.live.drops.some(drop => drop.bossId === 'komendant')).toBe(false);
    expect(f.bossState('komendant').bossCycle).toBe(2); expect(player.live.self.bossKills).toBe(1);
  });

  test('offline blood loss settles one exact death and recent owner credit, without minting another corpse on restart', async () => {
    const f = await fixture(), player = await f.enter();
    f.setClock(NOW + 2000);
    await f.restart([player], db => {
      const boss = f.readBoss(db, 'lesnik'), row = db.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').all().find(row => JSON.parse(row.state).id === player.live.selfId)!;
      boss.body.parts.head.hp = .2; boss.body.parts.head.bleeding = 'heavy'; boss.health = healthPercent(boss.body); boss.healthAt = NOW;
      boss.bossLastHit = { identity: row.identity, playerId: player.live.selfId, at: NOW };
      db.query('UPDATE live_bosses SET state=? WHERE boss_id=?').run(JSON.stringify(boss), 'lesnik');
    });
    expect(f.bossState('lesnik').respawnAt).toBe(NOW + 800 + getBoss('lesnik')!.live.respawnMs); expect(player.live.self.bossKills).toBe(1);
    const killed = f.bossState('lesnik'); await f.restart([player]); expect(f.bossState('lesnik')).toEqual(killed); expect(player.live.self.bossKills).toBe(1);
  });

  test('a failed death transaction preserves the last committed boss and creates neither a corpse nor kill credit during recovery', async () => {
    const f = await fixture(), first = await f.enter(), second = await f.enter(); await f.place([first, second], 'bugor', false, true);
    await f.restart([first, second], db => db.exec("CREATE TRIGGER fail_boss_death BEFORE UPDATE ON live_bosses WHEN json_extract(NEW.state,'$.bossDeathSettled')=1 BEGIN SELECT RAISE(ABORT,'injected boss death storage failure'); END"));
    await Promise.all([f.act(first, { type: 'attack', targetId: 'boss-bugor', aimed: true }), f.act(second, { type: 'attack', targetId: 'boss-bugor', aimed: true })]);
    f.jump(2000); expect(f.f.live.healthy()).toBe(false);
    expect(f.bossState('bugor')).toMatchObject({ health: 100, bossCycle: 1, bossDeathSettled: false });
    await f.restart([first, second], db => {
      expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM live_boss_kill_credits').get()!.n).toBe(0);
      const saved = JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state);
      expect(saved.drops.some((drop: { bossId?: string }) => drop.bossId === 'bugor')).toBe(false);
      db.exec('DROP TRIGGER fail_boss_death');
    });
    expect(first.live.self.bossKills).toBe(0); expect(second.live.self.bossKills).toBe(0);
    expect(first.live.drops.some(drop => drop.bossId === 'bugor')).toBe(false); expect(f.f.live.healthy()).toBe(true);
  });

  test('ordinary rivals ignore bosses and bosses ignore NPCs; strict commands and metadata cannot fabricate a defeat or reward', async () => {
    const f = await fixture(), player = await f.enter();
    await f.restart([player], db => {
      const row = db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!, saved = JSON.parse(row.state), boss = f.readBoss(db, 'bugor');
      const point = [{ x: boss.x + 1, y: boss.y }, { x: boss.x - 1, y: boss.y }].find(point => isLiveWalkable(world, point))!;
      const scav = saved.scavs[0]; Object.assign(scav, point, { faction: 'scavs', role: 'guard', home: point, route: [point], body: createHealth(), health: 100, nextMove: NOW + 10_000_000, nextAttack: 0 });
      for (const other of saved.scavs.slice(1)) { other.body = createHealth(); other.body.parts.head.hp = 0; other.health = 0; other.respawnAt = NOW + 10_000_000; }
      db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(saved));
    });
    await f.advance(5000, [player]); expect(f.bossState('bugor').health).toBe(100);
    for (const command of [{ type: 'attack', targetId: 'boss-bugor', damage: 9999 }, { type: 'loot', id: 'boss-bugor', items: [] }, { type: 'respawn', bossId: 'bugor' }, { type: 'defeatBoss', bossId: 'bugor' }]) await f.act(player, command, 400);
    expect(f.bossState('bugor').bossDeathSettled).toBe(false); expect(player.live.self.bossKills).toBe(0);
    const unknown = structuredClone(player.live.server); unknown.bosses![0]!.bossId = 'client-boss' as BossId; expect(() => readLiveStatus(unknown)).toThrow();
    const privateRoster = structuredClone(player.live.server); Object.assign(privateRoster.bosses![0]!, { items: [] }); expect(() => readLiveStatus(privateRoster)).toThrow();
    const duplicated = structuredClone(player.live.server); duplicated.bosses![1] = duplicated.bosses![0]!; expect(() => readLiveStatus(duplicated)).toThrow();
    const forged = structuredClone(player.live); forged.entities[0]!.bossId = 'bugor'; expect(() => readLiveSnapshot(forged)).toThrow();
  });
});
