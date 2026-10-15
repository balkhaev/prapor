import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameService, readGameCommand, readGameOptions, type GameService } from '../server/game';
import { advance, createGame, dispatchRaid, dispatchSquadRaid, getModuleSaleValue, getRaidQuote, parseSave, saveGame, setAutoRaid, setAutoRaidDepth, setGameOutcomeSeedSource, setRaidPlan, type GameState } from '../src/game/engine';
import { MAP_BY_ID } from '../src/game/data';
import { getLootModel, getLootTraderPrice } from '../src/game/loot';
import { Database } from 'bun:sqlite';
import { getRaidFieldPlan } from '../src/raid-field';
import type { GameActionSnapshot, GameCommand, GameSnapshot } from '../src/game/commands';

const NOW = 1_792_000_000_000, ORIGIN = 'http://game.test';
const services: GameService[] = [], folders: string[] = [];
afterEach(async () => { for (const service of services.splice(0)) service.close(); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
function setup(extra: Partial<Parameters<typeof createGameService>[0]> = {}) {
  let clock = NOW;
  const service = createGameService({ dbPath: ':memory:', secureCookies: false, allowedOrigins: [ORIGIN], now: () => clock, outcomeSeed: () => 698906565, ...extra }); services.push(service);
  return { service, setTime: (time: number) => { clock = time; } };
}
function publicFresh() { const state = createGame(NOW); state.rng = 1; return state; }
interface Client { cookie: string; snapshot: GameSnapshot; account?: string }
function request(path: string, method = 'GET', body?: unknown, client?: Client, extra: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/game/${path}`, { method, headers: { ...(method === 'POST' ? { origin: ORIGIN, 'content-type': 'application/json' } : {}), ...(client ? { cookie: client.cookie, 'x-prapor-game': client.snapshot.identity.id, ...(client.account ? { 'x-prapor-account': client.account } : {}) } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function joinClient(service: GameService, cookie = '', account?: string): Promise<Client> {
  const response = (await service.fetch(request('join', 'POST', {}, undefined, { cookie, ...(account ? { 'x-prapor-account': account } : {}) }), 'test-ip'))!;
  expect(response.status).toBe(200);
  return { cookie: response.headers.get('set-cookie')?.split(';')[0] ?? cookie, snapshot: await response.json() as GameSnapshot, account };
}
async function action(service: GameService, client: Client, command: GameCommand, revision = client.snapshot.revision) {
  const response = (await service.fetch(request('action', 'POST', { revision, command }, client), 'test-ip'))!;
  const body = await response.json() as GameActionSnapshot & { code?: string; snapshot?: GameSnapshot };
  if (response.ok) client.snapshot = body;
  else if (body.snapshot) client.snapshot = body.snapshot;
  return { response, body };
}
async function state(service: GameService, client: Client) {
  const response = (await service.fetch(request('state', 'GET', undefined, client), 'test-ip'))!; expect(response.status).toBe(200);
  client.snapshot = await response.json() as GameSnapshot; return client.snapshot;
}

/** Fixture a historical server save; retired public commands are never used to create it. */
function storeLegacy(path: string, client: Client, arrange: (value: GameState) => void, seed = 698906565): void {
  const db = new Database(path);
  try {
    const row = db.query<{state: string}, [string]>('SELECT state FROM authoritative_games WHERE id=?').get(client.snapshot.identity.id)!;
    const saved = parseSave(row.state)!;
    setGameOutcomeSeedSource(saved, () => seed); arrange(saved);
    expect(parseSave(saveGame(saved))).not.toBeNull();
    db.query('UPDATE authoritative_games SET state=? WHERE id=?').run(saveGame(saved), client.snapshot.identity.id);
  } finally { db.close(); }
}
async function legacySetup() {
  const folder = await mkdtemp(join(tmpdir(), 'prapor-paid-return-')); folders.push(folder);
  const path = join(folder, 'game.sqlite'), h = setup({dbPath: path}), client = await joinClient(h.service);
  return {...h, path, client};
}

describe('authoritative game state and commands', () => {
  test('starts fresh on the server and guest cookie restores the same state', async () => {
    const { service } = setup(), client = await joinClient(service);
    expect(client.cookie).toMatch(/^prapor_game=[A-Za-z0-9_-]{43}$/);
    expect(client.snapshot.state).toEqual(publicFresh());
    expect(client.snapshot.serverNow).toBe(NOW);
    expect(client.snapshot.identity.kind).toBe('guest');
    const rejoined = await joinClient(service, client.cookie);
    expect(rejoined.snapshot).toEqual(client.snapshot);
    expect(parseSave(saveGame(rejoined.snapshot.state))).not.toBeNull();
  });

  test('does not accept client state, balances, RNG, clocks, or arbitrary engine functions', async () => {
    const { service } = setup(), client = await joinClient(service), initial = structuredClone(client.snapshot);
    const hostile = [
      { revision: 0, state: { money: 999999 }, command: { type: 'stopAllAutoRaids', args: [] } },
      { revision: 0, command: { type: 'advance', args: [NOW + 86_400_000] } },
      { revision: 0, command: { type: 'createGame', args: [] } },
      { revision: 0, command: { type: 'saveGame', args: [] } },
      { revision: 0, command: { type: '__proto__', args: [] } },
      { revision: 0, command: { type: { toString: null }, args: [] } },
      { revision: 0, command: { type: 'dispatchRaid', args: [client.snapshot.state.scavs[0]!.id, 'courtyard', NOW + 86_400_000] } },
      { revision: 0, command: { type: 'buildRoom', args: ['workshop', 99999999, 0] } },
      { revision: 0, command: { type: 'setAutoRaid', args: [client.snapshot.state.scavs[0]!.id, 'courtyard', 0] } },
      { revision: 0, command: { type: 'setLoadoutOption', args: [client.snapshot.state.scavs[0]!.id, 'medkit', 'piercing'] } },
      { revision: 0, command: { type: 'craftModule', args: ['optic-reflex'] } },
    ];
    for (const body of hostile) expect((await service.fetch(request('action', 'POST', body, client)))!.status).toBe(400);
    expect((await service.fetch(request('join', 'POST', { state: { money: 999999 } }, client)))!.status).toBe(400);
    expect((await service.fetch(request('join', 'POST', { save: saveGame(initial.state) }, client)))!.status).toBe(413);
    expect(await state(service, client)).toEqual(initial);
    expect(service.healthy()).toBe(true);
  });

  test('two clients of the same identity cannot spend or receive a sale twice', async () => {
    const { service } = setup(), one = await joinClient(service), two = await joinClient(service, one.cookie);
    const item = one.snapshot.state.modules[0]!, balance = one.snapshot.state.money, value = getModuleSaleValue(item);
    const command: GameCommand = { type: 'sellModule', args: [item.id] };
    const [first, duplicate] = await Promise.all([action(service, one, command), action(service, two, command)]);
    expect([first.response.status, duplicate.response.status].sort()).toEqual([200, 409]);
    const delivered = await state(service, one);
    expect(delivered.state.money).toBe(balance + value);
    expect(delivered.state.modules.some(part => part.id === item.id)).toBe(false);
    const again = await action(service, one, command);
    expect(again.response.status).toBe(200); expect(again.body.result.ok).toBe(false);
    expect(again.body.state.money).toBe(balance + value);
  });

  test('independent guests cannot substitute another player id or affect their economy', async () => {
    const { service } = setup(), one = await joinClient(service), two = await joinClient(service);
    expect(one.snapshot.identity.id).not.toBe(two.snapshot.identity.id);
    const spoof = { ...two, snapshot: one.snapshot };
    expect((await service.fetch(request('state', 'GET', undefined, spoof)))!.status).toBe(401);
    expect((await service.fetch(request('action', 'POST', { revision: 0, command: { type: 'sellModule', args: [one.snapshot.state.modules[0]!.id] } }, spoof)))!.status).toBe(401);
    await action(service, one, { type: 'sellModule', args: [one.snapshot.state.modules[0]!.id] });
    expect((await state(service, two)).state).toEqual(publicFresh());
  });

  test('two windows can poll idle progress without invalidating a command, while accepted commands invalidate replays', async () => {
    const { service, setTime } = setup(), client = await joinClient(service), otherWindow = await joinClient(service, client.cookie), originalRevision = client.snapshot.revision;
    const expected = structuredClone(client.snapshot.state); advance(expected, NOW + 60_000);
    setTime(NOW + 60_000);
    expect((await state(service, client)).state).toEqual(expected);
    expect(client.snapshot.serverNow).toBe(NOW + 60_000);
    expect(client.snapshot.revision).toBe(originalRevision);
    advance(expected, NOW + 120_000); setTime(NOW + 120_000);
    expect((await state(service, otherWindow)).state).toEqual(expected);
    expect(otherWindow.snapshot.revision).toBe(originalRevision);
    const item = client.snapshot.state.modules[0]!, money = expected.money, value = getModuleSaleValue(item);
    const accepted = await action(service, client, { type: 'sellModule', args: [item.id] }, originalRevision);
    expect(accepted.response.status).toBe(200); expect(accepted.body.result.ok).toBe(true);
    expect(client.snapshot.revision).toBe(originalRevision + 1);
    expect(client.snapshot.state.money).toBe(money + value);
    const committed = structuredClone(client.snapshot.state);
    const stale = await action(service, otherWindow, { type: 'sellModule', args: [item.id] }, originalRevision);
    expect(stale.response.status).toBe(409); expect(stale.body.code).toBe('revision_conflict'); expect(stale.body.snapshot!.state).toEqual(committed);
    setTime(NOW - 1000); const rollback = await state(service, client);
    expect(rollback.serverNow).toBe(NOW + 120_000); expect(rollback.state).toEqual(committed);
  });

  test('raid settlement and reward extraction are driven by the server and not replayable', async () => {
    const { service, setTime, path, client } = await legacySetup();
    storeLegacy(path, client, saved => { expect(dispatchRaid(saved, saved.scavs[0]!.id, 'courtyard', NOW).ok).toBe(true); });
    await state(service, client);
    const raid = client.snapshot.state.raids[0]!; expect(raid.startedAt).toBe(NOW);
    const expected = structuredClone(client.snapshot.state); expected.raids[0]!.outcomeSeed = 698906565; advance(expected, raid.endsAt);
    for (const active of expected.raids) delete active.outcomeSeed;
    setTime(raid.endsAt); expect((await state(service, client)).state).toEqual(expected);
    expect(client.snapshot.state.raids[0]!.expedition!.status).toBe('choice');
    const carried = client.snapshot.state.raids[0]!.expedition!.cargo;
    const cargo = carried.money + (carried.lootItems ?? []).filter(item => getLootModel(item).autoSell).reduce((sum, item) => sum + getLootTraderPrice(item), 0), money = client.snapshot.state.money;
    const before = client.snapshot.revision;
    const extracted = await action(service, client, { type: 'extractRaid', args: [raid.id] }); expect(extracted.body.result.ok).toBe(true);
    expect(client.snapshot.state.money).toBe(money + cargo);
    const replay = await action(service, client, { type: 'extractRaid', args: [raid.id] }, before); expect(replay.response.status).toBe(409);
    const repeated = await action(service, client, { type: 'extractRaid', args: [raid.id] }); expect(repeated.body.result.ok).toBe(false);
    expect(client.snapshot.state.money).toBe(money + cargo); expect(client.snapshot.state.history).toHaveLength(1);
  });

  test('saved paid scouting retains frozen costs and settles once after migration', async () => {
    const { service, setTime, path, client } = await legacySetup(), scavId = client.snapshot.state.scavs[0]!.id;
    storeLegacy(path, client, saved => {
      expect(setRaidPlan(saved, scavId, 'intel', 'scouted').ok).toBe(true);
      const quote = getRaidQuote(saved, saved.scavs[0]!, MAP_BY_ID.courtyard!);
      expect(quote.preparationMoney).toBe(20); expect(quote.preparationIntel).toBe(2);
      expect(dispatchRaid(saved, scavId, 'courtyard', NOW).ok).toBe(true);
    });
    await state(service, client);
    const money = client.snapshot.state.money, raid = structuredClone(client.snapshot.state.raids[0]!);
    const duplicate = await action(service, client, { type: 'dispatchRaid', args: [scavId, 'courtyard'] });
    expect(duplicate.body.result.ok).toBe(false);
    expect(client.snapshot.state.money).toBe(money);
    await action(service, client, { type: 'setRaidPlan', args: [scavId, 'ammo', 'none'] });
    expect(client.snapshot.state.raids[0]!.strategy).toEqual(raid.strategy);
    setTime(raid.endsAt); await state(service, client);
    expect(client.snapshot.state.sectorIntel?.courtyard).toBeUndefined();
    const extracted = await action(service, client, { type: 'extractRaid', args: [raid.id] }); expect(extracted.body.result.ok).toBe(true);
    expect(client.snapshot.state.sectorIntel!.courtyard).toEqual({ knowledge: 1, pressure: 1 });
    await action(service, client, { type: 'extractRaid', args: [raid.id] });
    expect(client.snapshot.state.sectorIntel!.courtyard).toEqual({ knowledge: 1, pressure: 1 });
    expect(() => readGameCommand({ type: 'setRaidPlan', args: [scavId, 'free-cash', 'scouted'] })).toThrow();
  });

  test('retired solo, squad and automatic entry cannot create or charge a small raid', async () => {
    const {service} = setup(), client = await joinClient(service), before = structuredClone(client.snapshot);
    const ids = client.snapshot.state.scavs.slice(0, 2).map(scav => scav.id);
    const attempts: GameCommand[] = [
      {type: 'dispatchRaid', args: [ids[0]!, 'courtyard']},
      {type: 'dispatchSquadRaid', args: [ids, 'courtyard']},
      {type: 'setAutoRaid', args: [ids[0]!, 'courtyard', 70]},
    ];
    for (const command of attempts.slice(0, 3)) {
      const result = await action(service, client, command);
      expect(result.response.status).toBe(200); expect(result.body.result.ok).toBe(false);
      expect(result.body.result.message).toContain('общем Периметре');
      expect(client.snapshot.revision).toBe(before.revision);
      expect(client.snapshot.state).toEqual(before.state);
    }
    expect((await action(service, client, {type: 'setAutoRaid', args: [ids[0]!, null, 70]})).body.result.ok).toBe(true);
  });

  test('old repeat orders stop before offline catchup and the already paid stage returns its physical cargo once', async () => {
    const {service, setTime, path, client} = await legacySetup();
    let endsAt = 0, raidId = '', lootId = '';
    storeLegacy(path, client, saved => {
      expect(setAutoRaidDepth(saved, saved.scavs[0]!.id, 3).ok).toBe(true);
      expect(setAutoRaid(saved, saved.scavs[0]!.id, 'courtyard', 70, NOW).ok).toBe(true);
      const raid = saved.raids[0]!; endsAt = raid.endsAt; raidId = raid.id;
      raid.expedition!.cargo.money = 73;
      lootId = `loot-${saved.nextId++}`;
      raid.expedition!.cargo.lootItems = [{id: lootId, modelId: 'old-watch', foundAt: NOW}];
    });
    setTime(endsAt + 8 * 60 * 60_000);
    const returned = (await state(service, client)).state;
    expect(returned.scavs.every(scav => !scav.autoRaid.enabled)).toBe(true);
    expect(returned.raids).toHaveLength(0);
    expect(returned.history).toHaveLength(1);
    expect(returned.history[0]!.raidId).toBe(raidId);
    expect(returned.history[0]!.depth).toBe(1);
    expect(returned.history[0]!.success).toBe(true);
    expect(returned.history[0]!.money).toBeGreaterThanOrEqual(73);
    expect(returned.history[0]!.lootItems?.some(item => item.id === lootId)).toBe(true);
    expect((returned.lootItems ?? []).some(item => item.id === lootId)).toBe(true);
    const settled = structuredClone(returned);
    expect((await state(service, client)).state).toEqual(settled);
  });

  test('expanded ammunition is accepted through the real ammo enum and invalid ammo is rejected', async () => {
    const { service } = setup(), client = await joinClient(service), scavId = client.snapshot.state.scavs[0]!.id;
    for (const ammo of ['standard', 'piercing', 'expanding', 'precision'] as const) {
      const result = await action(service, client, { type: 'setLoadoutOption', args: [scavId, 'ammoType', ammo] });
      expect(result.body.result.ok).toBe(true); expect(client.snapshot.state.scavs[0]!.loadout.ammoType).toBe(ammo);
    }
    expect(() => readGameCommand({ type: 'setLoadoutOption', args: [scavId, 'ammoType', 'unlimited'] })).toThrow();
  });

  test('authoritative database survives restart without importing a legacy client save', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'prapor-authority-')); folders.push(folder);
    const path = join(folder, 'game.sqlite');
    const first = setup({ dbPath: path }), client = await joinClient(first.service);
    await action(first.service, client, { type: 'sellModule', args: [client.snapshot.state.modules[0]!.id] });
    const saved = structuredClone(await state(first.service, client)); first.service.close();
    const second = setup({ dbPath: path }), restored = await joinClient(second.service, client.cookie);
    expect(restored.snapshot).toEqual(saved);
  });

  test('saved paid stage entropy stays private and new stage continuation is refused', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'prapor-secrets-')); folders.push(folder);
    const path = join(folder, 'game.sqlite'); let seed = 698906565;
    const { service, setTime } = setup({ dbPath: path, outcomeSeed: () => seed }), client = await joinClient(service);
    const originalDb = new Database(path, { readonly: true });
    try {
      const freshInternal = parseSave(originalDb.query<{ state: string }, []>('SELECT state FROM authoritative_games LIMIT 1').get()!.state)!;
      expect(freshInternal.rng).not.toBe(createGame(client.snapshot.serverNow).rng);
    } finally { originalDb.close(); }
    storeLegacy(path, client, saved => { expect(dispatchRaid(saved, saved.scavs[0]!.id, 'courtyard', NOW).ok).toBe(true); }, seed);
    await state(service, client);
    const publicRaid = client.snapshot.state.raids[0]!;
    expect(publicRaid.outcomeSeed).toBeUndefined(); expect(client.snapshot.state.rng).toBe(1);
    const db = new Database(path, { readonly: true });
    const readStored = () => parseSave(db.query<{ state: string }, []>('SELECT state FROM authoritative_games LIMIT 1').get()!.state)!;
    try {
      const internal = readStored(); expect(internal.raids[0]!.outcomeSeed).toBe(seed);
      expect(getRaidFieldPlan(internal.raids[0]!)).toEqual(getRaidFieldPlan(publicRaid));
      expect(internal.rng).not.toBe(1);
      setTime(publicRaid.endsAt); await state(service, client); expect(client.snapshot.state.raids[0]!.expedition!.status).toBe('choice');
      seed = 123456789;
      const cargo = structuredClone(client.snapshot.state.raids[0]!.expedition!.cargo), revision = client.snapshot.revision;
      const next = await action(service, client, { type: 'continueExpedition', args: [publicRaid.id, 'scavenge', client.snapshot.state.raids[0]!.expedition!.offers[0]!] });
      expect(next.body.result.ok).toBe(false);
      expect(next.body.revision).toBe(revision);
      expect(readStored().raids[0]!.outcomeSeed).toBe(698906565);
      expect(client.snapshot.state.raids[0]!.expedition!.cargo).toEqual(cargo);
      expect(client.snapshot.state.raids[0]!.expedition!.status).toBe('choice');
      expect(JSON.stringify(client.snapshot)).not.toContain('outcomeSeed');
      expect(client.snapshot.state.raids[0]!.seed).toBe(publicRaid.seed);
    } finally { db.close(); }
  });

  test('public squad routes disclose only actions which have already occurred', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'prapor-squad-secrets-')); folders.push(folder);
    const path = join(folder, 'game.sqlite');
    const { service, setTime } = setup({ dbPath: path, outcomeSeed: () => 123456789 }), client = await joinClient(service);
    storeLegacy(path, client, saved => { expect(dispatchSquadRaid(saved, saved.scavs.slice(0, 2).map(scav => scav.id), 'courtyard', NOW).ok).toBe(true); }, 123456789);
    await state(service, client);
    const raid = client.snapshot.state.raids[0]!;
    expect(raid.squad!.actions).toEqual([]);
    expect(JSON.stringify(client.snapshot)).not.toContain('outcomeSeed');
    expect(parseSave(saveGame(client.snapshot.state), { publicSnapshot: true })).not.toBeNull();
    const db = new Database(path, { readonly: true });
    try {
      const internal = parseSave(db.query<{ state: string }, []>('SELECT state FROM authoritative_games LIMIT 1').get()!.state)!;
      expect(internal).not.toBeNull(); expect(internal.raids[0]!.squad!.actions.length).toBeGreaterThan(0);
      expect(internal.raids[0]!.squad!.members.every(member => member.outcomeSeed === 123456789)).toBe(true);
      expect(getRaidFieldPlan(internal.raids[0]!)).toEqual(getRaidFieldPlan(raid));
      const firstAt = Math.min(...internal.raids[0]!.squad!.actions.map(action => action.progress));
      const time = raid.startedAt + Math.ceil((raid.endsAt - raid.startedAt) * firstAt); setTime(time);
      await state(service, client);
      expect(client.snapshot.state.raids[0]!.squad!.actions.length).toBeGreaterThan(0);
      expect(client.snapshot.state.raids[0]!.squad!.actions.every(action => action.progress <= (time - raid.startedAt) / (raid.endsAt - raid.startedAt))).toBe(true);
      setTime(raid.endsAt); await state(service, client);
      expect(parseSave(saveGame(client.snapshot.state), { publicSnapshot: true })).not.toBeNull();
      expect(JSON.stringify(client.snapshot)).not.toContain('outcomeSeed');
    } finally { db.close(); }
  });

  test('account identity is session-bound and a changed session rejects an in-flight action', async () => {
    let account: { id: string; name: string } | null = { id: 'account-one', name: 'Test' };
    const { service } = setup({ accounts: { resolveLiveIdentity: () => account } });
    expect((await service.fetch(request('join', 'POST', {})))!.status).toBe(401);
    const client = await joinClient(service, '', account.id); expect(client.snapshot.identity.kind).toBe('account');
    expect((await service.fetch(request('state', 'GET', undefined, client, { 'x-prapor-account': 'account-two' })))!.status).toBe(401);
    let push!: () => void;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { push = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify({ revision: client.snapshot.revision, command: { type: 'stopAllAutoRaids', args: [] } }))); controller.close(); }; } });
    const pending = service.fetch(new Request(`${ORIGIN}/api/game/action`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-prapor-account': 'account-one', 'x-prapor-game': client.snapshot.identity.id }, body: stream }));
    await Promise.resolve(); account = null; push();
    expect((await pending)!.status).toBe(401);
  });

  test('origin, host, methods, cookies, oversized bodies and aborted streams are checked', async () => {
    const { service } = setup();
    expect((await service.fetch(request('join', 'POST', {}, undefined, { origin: 'https://evil.test' })))!.status).toBe(403);
    expect((await service.fetch(new Request('http://evil.test/api/game/join', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{}' })))!.status).toBe(403);
    expect((await service.fetch(request('join')) )!.status).toBe(405);
    expect((await service.fetch(request('join', 'POST', {}, undefined, { 'content-length': '5000' })))!.status).toBe(413);
    const broken = new ReadableStream({ pull(controller) { controller.error(new Error('disconnected')); } });
    expect((await service.fetch(new Request(`${ORIGIN}/api/game/join`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: broken })))!.status).toBe(400);
    expect(service.healthy()).toBe(true); await joinClient(service);
    const secure = setup({ secureCookies: true, allowedOrigins: ['https://game.test'] }).service;
    const response = (await secure.fetch(new Request('https://game.test/api/game/join', { method: 'POST', headers: { origin: 'https://game.test', 'content-type': 'application/json' }, body: '{}' })))!;
    expect(response.headers.get('set-cookie')).toContain('__Host-prapor_game='); expect(response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Lax'); expect(response.headers.get('set-cookie')).toContain('; Secure');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  test('rate limits commands and denies invalid command shapes without changing state', async () => {
    const { service } = setup(), client = await joinClient(service);
    for (let index = 0; index < 120; index++) await action(service, client, { type: 'repairWeapon', args: ['gun-missing'] });
    expect((await action(service, client, { type: 'repairWeapon', args: ['gun-missing'] })).response.status).toBe(429);
    for (const invalid of [null, [], { type: 'sellModule', args: [null] }, { type: 'dispatchSquadRaid', args: [['scav-1', 'scav-1'], 'courtyard'] }, { type: 'markAchievementsSeen', args: [['unknown']] }]) expect(() => readGameCommand(invalid)).toThrow();
  });

  test('production paths are independent of DevHub', () => {
    expect(readGameOptions({ NODE_ENV: 'production', DEVHUB_ROOT: 'ignored' }).dbPath).toBe('/app/data/game.sqlite');
    expect(readGameOptions({ GAME_DB_PATH: 'custom.sqlite' }).dbPath).toBe('custom.sqlite');
  });
});
