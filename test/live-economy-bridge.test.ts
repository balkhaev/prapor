import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameService, type GameOptions, type GameService } from '../server/game';
import { LiveEconomyError, type LiveDelivery, type LiveEconomyIdentity, type LiveSupplyRequest } from '../server/live-economy';
import { getLootCapacity, parseSave, saveGame, type GameState } from '../src/game/engine';
import type { GameActionSnapshot, GameCommand, GameSnapshot } from '../src/game/commands';
import { readMarketSnapshot } from '../src/game/flea';

const NOW = 1_792_000_000_000, ORIGIN = 'http://live-economy.test';
const services: GameService[] = [], folders: string[] = [];
afterEach(async () => { services.splice(0).forEach(service => service.close()); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
interface Client { cookie: string; snapshot: GameSnapshot }
function request(path: string, player?: Client, body?: unknown, extra: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/game/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: {
    ...(body === undefined ? {} : { origin: ORIGIN, 'content-type': 'application/json' }),
    ...(player ? { cookie: player.cookie, 'x-prapor-game': player.snapshot.identity.id } : {}), ...extra,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function setup(path = ':memory:', extra: Partial<GameOptions> = {}) {
  let time = NOW;
  const service = createGameService({ dbPath: path, secureCookies: false, allowedOrigins: [ORIGIN], now: () => time, ...extra }); services.push(service);
  return { service, setTime: (value: number) => { time = value; } };
}
async function disk() { const folder = await mkdtemp(join(tmpdir(), 'prapor-live-economy-')); folders.push(folder); return join(folder, 'game.sqlite'); }
async function client(service: GameService, cookie = '', headers: Record<string, string> = {}): Promise<Client> {
  const response = (await service.fetch(request('join', undefined, {}, { cookie, ...headers })))!; expect(response.status).toBe(200);
  return { cookie: response.headers.get('set-cookie')?.split(';')[0] ?? cookie, snapshot: await response.json() as GameSnapshot };
}
async function state(service: GameService, player: Client) {
  const response = (await service.fetch(request('state', player)))!; expect(response.status).toBe(200);
  player.snapshot = await response.json() as GameSnapshot; return player.snapshot;
}
async function action(service: GameService, player: Client, command: GameCommand, revision = player.snapshot.revision) {
  const response = (await service.fetch(request('action', player, { revision, command })))!;
  const body = await response.json() as GameActionSnapshot & { snapshot?: GameSnapshot };
  if (response.ok) player.snapshot = body; else if (body.snapshot) player.snapshot = body.snapshot;
  return { response, body };
}
function identity(service: GameService, player: Client) { return service.liveEconomy.resolve(request('state', player)); }
function delivery(owner: LiveEconomyIdentity, models = ['old-watch'], money = 0): LiveDelivery {
  return { id: randomUUID(), owner: owner.key, gameId: owner.gameId, createdAt: NOW, money, items: models.map(modelId => ({ id: randomUUID(), modelId, foundAt: NOW - 1000 })) };
}
function supply(owner: LiveEconomyIdentity, ammo = 60, medkits = 2): LiveSupplyRequest {
  return { id: randomUUID(), owner: owner.key, gameId: owner.gameId, createdAt: NOW, ammo, medkits };
}
function seed(path: string, player: Client, change: (state: GameState) => void) {
  const db = new Database(path);
  try {
    const row = db.query<{ state: string }, [string]>('SELECT state FROM authoritative_games WHERE id=?').get(player.snapshot.identity.id)!;
    const state = parseSave(row.state)!; change(state); const encoded = saveGame(state); expect(parseSave(encoded)).not.toBeNull();
    db.query('UPDATE authoritative_games SET state=? WHERE id=?').run(encoded, player.snapshot.identity.id);
  } finally { db.close(); }
}
function count(path: string, table: 'authoritative_live_links' | 'authoritative_live_deliveries' | 'authoritative_live_items' | 'authoritative_live_supplies') {
  const db = new Database(path, { readonly: true });
  try { return db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count; } finally { db.close(); }
}
function rejects(action: () => unknown, status: number, code?: string) {
  try { action(); throw new Error('Bridge action unexpectedly accepted'); }
  catch (error) { expect(error).toBeInstanceOf(LiveEconomyError); expect((error as LiveEconomyError).status).toBe(status); if (code) expect((error as LiveEconomyError).code).toBe(code); }
}

describe('private live world to persistent headquarters economy', () => {
  test('delivery commits normal inventory ids, legacy cash and one revision; retry survives restart without rewards twice', async () => {
    const path = await disk(), { service } = setup(path), player = await client(service), owner = identity(service, player), before = structuredClone(player.snapshot);
    const parcel = delivery(owner, ['old-watch', 'circuit-board'], 17), receipt = service.liveEconomy.deliver(parcel);
    expect(receipt.ok).toBe(true); const delivered = await state(service, player);
    expect(delivered.revision).toBe(before.revision + 1); expect(delivered.state.money).toBe(before.state.money + 17);
    expect(delivered.state.stats.moneyEarned).toBe(before.state.stats.moneyEarned + 17); expect(delivered.state.stats.raidsCompleted).toBe(before.state.stats.raidsCompleted);
    expect(delivered.state.lootItems!.map(item => item.modelId)).toEqual(['old-watch', 'circuit-board']);
    expect(new Set(delivered.state.lootItems!.map(item => item.id)).size).toBe(2);
    for (const item of delivered.state.lootItems!) { expect(item.id).toMatch(/^loot-\d+$/); expect(item.foundAt).toBe(NOW - 1000); expect(parcel.items.map(source => source.id)).not.toContain(item.id); }
    expect(parseSave(saveGame(delivered.state))).not.toBeNull();
    const stale = await action(service, player, { type: 'buySupplies', args: ['ammo'] }, before.revision); expect(stale.response.status).toBe(409);
    expect(service.liveEconomy.deliver(structuredClone(parcel))).toEqual(receipt); expect(await state(service, player)).toEqual(delivered);
    service.close(); const restored = setup(path).service;
    expect(restored.liveEconomy.deliver({ items: parcel.items, money: parcel.money, createdAt: parcel.createdAt, gameId: parcel.gameId, owner: parcel.owner, id: parcel.id })).toEqual(receipt);
    expect(await state(restored, player)).toEqual(delivered); expect(count(path, 'authoritative_live_deliveries')).toBe(1); expect(count(path, 'authoritative_live_items')).toBe(2);
  });

  test('an immutable receipt cannot be reused with changed rewards, owner or source uuid', async () => {
    const { service } = setup(), player = await client(service), other = await client(service), owner = identity(service, player), otherOwner = identity(service, other);
    const parcel = delivery(owner); expect(service.liveEconomy.deliver(parcel).ok).toBe(true); const before = await state(service, player);
    rejects(() => service.liveEconomy.deliver({ ...parcel, money: 1 }), 409, 'live_delivery_changed');
    rejects(() => service.liveEconomy.deliver({ ...parcel, owner: otherOwner.key, gameId: otherOwner.gameId }), 409, 'live_delivery_changed');
    rejects(() => service.liveEconomy.deliver({ ...parcel, gameId: otherOwner.gameId }), 401, 'game_identity_changed');
    rejects(() => service.liveEconomy.deliver({ ...parcel, id: randomUUID() }), 409, 'live_item_already_delivered');
    expect(await state(service, player)).toEqual(before); expect((await state(service, other)).state.lootItems ?? []).toHaveLength(0);
  });

  test('a partly fitting parcel and wallet overflow leave no state or receipt; capacity fixes permit the same retry', async () => {
    const path = await disk(), { service } = setup(path), player = await client(service), owner = identity(service, player);
    seed(path, player, state => { state.lootItems = Array.from({ length: getLootCapacity(state) - 1 }, () => ({ id: `loot-${state.nextId++}`, modelId: 'old-watch', foundAt: NOW })); });
    const before = await state(service, player), parcel = delivery(owner, ['duct-tape', 'silver-chain'], 23);
    expect(service.liveEconomy.deliver(parcel).ok).toBe(false); expect(await state(service, player)).toEqual(before);
    expect(count(path, 'authoritative_live_deliveries')).toBe(0); expect(count(path, 'authoritative_live_items')).toBe(0);
    seed(path, player, state => { state.lootItems!.pop(); state.money = 1e15; });
    const walletFull = await state(service, player); expect(service.liveEconomy.deliver(parcel).ok).toBe(false); expect(await state(service, player)).toEqual(walletFull);
    expect(count(path, 'authoritative_live_deliveries')).toBe(0);
    seed(path, player, state => { state.money -= 100; }); const available = await state(service, player);
    expect(service.liveEconomy.deliver(parcel).ok).toBe(true); const delivered = await state(service, player);
    expect(delivered.state.lootItems).toHaveLength(getLootCapacity(delivered.state)); expect(delivered.state.money).toBe(available.state.money + 23); expect(delivered.revision).toBe(available.revision + 1);
  });

  test('bound identities reject stale cookies, asserted accounts, wrong games and unauthorised origins', async () => {
    const { service } = setup(), player = await client(service), other = await client(service);
    rejects(() => service.liveEconomy.resolve(request('state')), 401, 'join_required');
    rejects(() => service.liveEconomy.resolve(request('state', { ...player, snapshot: other.snapshot })), 401, 'game_identity_changed');
    rejects(() => service.liveEconomy.resolve(request('state', player, undefined, { 'x-prapor-account': randomUUID() })), 401, 'account_changed');
    rejects(() => service.liveEconomy.resolve(request('action', player, {}, { origin: 'https://evil.test' })), 403, 'origin_not_allowed');
    rejects(() => service.liveEconomy.resolve(new Request('http://evil.test/api/live/state', { headers: { cookie: player.cookie, 'x-prapor-game': player.snapshot.identity.id } })), 403, 'host_not_allowed');
    const owner = identity(service, player); expect(owner.gameId).toBe(player.snapshot.identity.id); expect(owner.key).toMatch(/^guest:/);
    expect(service.liveEconomy.resolve(request('state', player))).toEqual(owner);
    for (const path of ['live/deliver', 'live/supply', 'delivery']) expect((await service.fetch(request(path, player, delivery(owner))))!.status).toBe(404);
    service.close(); rejects(() => service.liveEconomy.deliver(delivery(owner)), 503, 'service_unavailable');
  });

  test('account changes never bridge one headquarters into another identity', async () => {
    const accountId = randomUUID(); let active = true;
    const { service } = setup(':memory:', { accounts: { resolveLiveIdentity: () => active ? { id: accountId, name: 'Registered' } : null } });
    const player = await client(service, '', { 'x-prapor-account': accountId });
    const requestForAccount = () => request('state', player, undefined, { 'x-prapor-account': accountId });
    const owner = service.liveEconomy.resolve(requestForAccount()); expect(owner.key).toBe(`account:${accountId}`);
    active = false; rejects(() => service.liveEconomy.resolve(requestForAccount()), 401, 'account_changed');
    rejects(() => service.liveEconomy.resolve(request('state', player)), 401, 'join_required');
  });

  test('expired guests retain linked state and pending deliveries while their old cookie cannot resolve', async () => {
    const path = await disk(), { service, setTime } = setup(path), linked = await client(service), unlinked = await client(service), owner = identity(service, linked), parcel = delivery(owner, ['local-map'], 7);
    const db = new Database(path); try { db.query('UPDATE authoritative_guests SET expires_at=?').run(NOW); } finally { db.close(); }
    setTime(NOW + 60_001); expect((await service.fetch(request('state', linked)))!.status).toBe(401);
    rejects(() => service.liveEconomy.resolve(request('state', linked)), 401, 'join_required');
    const inspect = new Database(path, { readonly: true });
    try { expect(inspect.query('SELECT id FROM authoritative_games WHERE id=?').get(linked.snapshot.identity.id)).not.toBeNull(); expect(inspect.query('SELECT id FROM authoritative_games WHERE id=?').get(unlinked.snapshot.identity.id)).toBeNull(); } finally { inspect.close(); }
    expect(count(path, 'authoritative_live_links')).toBe(1); expect(service.liveEconomy.deliver(parcel).ok).toBe(true); expect(service.healthy()).toBe(true);
    const newGuest = await client(service, linked.cookie); expect(newGuest.snapshot.identity.id).not.toBe(owner.gameId); expect(newGuest.snapshot.state.lootItems ?? []).toHaveLength(0);
  });

  test('live loot is sold to another player on the same market and bought supplies feed live loadouts exactly once', async () => {
    const { service } = setup(), seller = await client(service), buyer = await client(service), sellerOwner = identity(service, seller), buyerOwner = identity(service, buyer);
    expect(service.liveEconomy.deliver(delivery(sellerOwner)).ok).toBe(true); await state(service, seller);
    const trophy = seller.snapshot.state.lootItems![0]!;
    expect((await action(service, seller, { type: 'listMarketItem', args: [{ kind: 'loot', id: trophy.id, quantity: 1 }, 100] })).body.result.ok).toBe(true);
    const market = async (player: Client) => readMarketSnapshot(await (await service.fetch(request('market', player)))!.json());
    const offer = (await market(buyer)).offers[0]!; expect(offer.asset.kind).toBe('loot'); expect(offer.owner).toBe(false);
    expect((await action(service, buyer, { type: 'buyMarketListing', args: [offer.id] })).body.result.ok).toBe(true);
    expect(buyer.snapshot.state.lootItems![0]!.modelId).toBe(trophy.modelId); expect(buyer.snapshot.state.stats.raidsCompleted).toBe(0);
    expect((await action(service, seller, { type: 'claimMarketSale', args: [offer.id] })).body.result.ok).toBe(true); expect(seller.snapshot.state.money).toBe(640 - 2 + 95);
    expect((await action(service, seller, { type: 'listMarketItem', args: [{ kind: 'supply', id: 'ammo', quantity: 5 }, 30] })).body.result.ok).toBe(true);
    const ammoOffer = (await market(buyer)).offers[0]!; expect((await action(service, buyer, { type: 'buyMarketListing', args: [ammoOffer.id] })).body.result.ok).toBe(true);
    const before = structuredClone(buyer.snapshot), loadout = supply(buyerOwner), receipt = service.liveEconomy.supply(loadout);
    expect(receipt.ammo).toBe(before.state.supplies.ammo); expect(receipt.medkits).toBe(Math.min(2, before.state.supplies.medicine));
    expect(receipt.ammo).toBe(29); await state(service, buyer); expect(buyer.snapshot.state.supplies.ammo).toBe(0); expect(buyer.snapshot.revision).toBe(before.revision + 1);
    expect(service.liveEconomy.supply(loadout)).toEqual(receipt); expect((await state(service, buyer)).revision).toBe(before.revision + 1);
  });

  test('supply debit returns only whole available amounts, survives restart and never follows a changed request', async () => {
    const path = await disk(), { service } = setup(path), player = await client(service), owner = identity(service, player);
    seed(path, player, state => { state.supplies.ammo = 3.5; state.supplies.medicine = 1.5; }); await state(service, player);
    const request = supply(owner), receipt = service.liveEconomy.supply(request); expect(receipt.ammo).toBe(3); expect(receipt.medkits).toBe(1);
    const delivered = await state(service, player); expect(delivered.state.supplies.ammo).toBe(.5); expect(delivered.state.supplies.medicine).toBe(.5);
    rejects(() => service.liveEconomy.supply({ ...request, ammo: 2 }), 409, 'live_supply_changed'); expect(await state(service, player)).toEqual(delivered);
    service.close(); const restored = setup(path).service; expect(restored.liveEconomy.supply(request)).toEqual(receipt); expect(await state(restored, player)).toEqual(delivered); expect(count(path, 'authoritative_live_supplies')).toBe(1);
    const empty = restored.liveEconomy.supply(supply(owner)); expect(empty.ammo).toBe(0); expect(empty.medkits).toBe(0);
  });

  test('strict bounded parcels reject unknown items, duplicate UUIDs, huge weight and injected metadata without mutation', async () => {
    const { service } = setup(), player = await client(service), owner = identity(service, player), parcel = delivery(owner), before = structuredClone(player.snapshot);
    for (const invalid of [
      { ...parcel, money: -1 }, { ...parcel, money: 1.5 }, { ...parcel, money: 1e9 + 1 }, { ...parcel, createdAt: Infinity },
      { ...parcel, id: 'loot-1' }, { ...parcel, seller: owner.key },
      { ...parcel, items: [{ ...parcel.items[0]!, modelId: 'unknown' }] }, { ...parcel, items: [{ ...parcel.items[0]!, guidePrice: 9999 }] },
      { ...parcel, items: [parcel.items[0]!, parcel.items[0]!] }, delivery(owner, Array(33).fill('local-map')), delivery(owner, Array(5).fill('tool-case')),
    ]) rejects(() => service.liveEconomy.deliver(invalid as LiveDelivery), 400, 'invalid_live_delivery');
    for (const invalid of [{ ...supply(owner), ammo: 61 }, { ...supply(owner), medkits: 3 }, { ...supply(owner), ammo: 2.5 }, { ...supply(owner), now: NOW }]) rejects(() => service.liveEconomy.supply(invalid as LiveSupplyRequest), 400, 'invalid_live_supply');
    expect(await state(service, player)).toEqual(before);
  });

  test('immutable source dates and receipts survive a server clock rollback', async () => {
    const path = await disk(), { service } = setup(path), player = await client(service), owner = identity(service, player), parcel = delivery(owner);
    parcel.createdAt = NOW + 50_000; parcel.items[0]!.foundAt = NOW + 49_000;
    expect(service.liveEconomy.deliver(parcel).ok).toBe(true); expect((await state(service, player)).state.lootItems![0]!.foundAt).toBe(NOW + 49_000);
    const before = structuredClone(player.snapshot); service.close(); const restored = setup(path, { now: () => NOW - 60_000 }).service;
    expect(restored.liveEconomy.deliver(parcel).ok).toBe(true); expect(await state(restored, player)).toEqual(before);
  });
});
