import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameService, type GameService } from '../server/game';
import { LiveEconomyError, type LiveDelivery } from '../server/live-economy';
import { getLootCapacity, parseSave, ROOM_DEFINITIONS, saveGame, type GameState } from '../src/game/engine';
import { getLootTraderPrice, JUNK_MODELS, LOOT_MODEL_BY_ID } from '../src/game/loot';
import type { GameActionSnapshot, GameCommand, GameSnapshot } from '../src/game/commands';
import { readMarketSnapshot } from '../src/game/flea';
import { addLootInputs } from './loot-material-fixture';

const NOW = 1_792_000_000_000, ORIGIN = 'http://junk-live.test';
const services: GameService[] = [], folders: string[] = [];
afterEach(async () => { services.splice(0).forEach(service => service.close()); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
interface Client { cookie: string; snapshot: GameSnapshot }
function request(path: string, player?: Client, body?: unknown) {
  return new Request(`${ORIGIN}/api/game/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: {
    ...(body === undefined ? {} : { origin: ORIGIN, 'content-type': 'application/json' }),
    ...(player ? { cookie: player.cookie, 'x-prapor-game': player.snapshot.identity.id } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function setup(path: string) { const service = createGameService({ dbPath: path, secureCookies: false, allowedOrigins: [ORIGIN], now: () => NOW }); services.push(service); return service; }
async function disk() { const folder = await mkdtemp(join(tmpdir(), 'prapor-junk-live-')); folders.push(folder); return join(folder, 'game.sqlite'); }
async function client(service: GameService): Promise<Client> {
  const response = (await service.fetch(request('join', undefined, {})))!; expect(response.status).toBe(200);
  return { cookie: response.headers.get('set-cookie')!.split(';')[0]!, snapshot: await response.json() as GameSnapshot };
}
async function state(service: GameService, player: Client) {
  const response = (await service.fetch(request('state', player)))!; expect(response.status).toBe(200);
  player.snapshot = await response.json() as GameSnapshot; return player.snapshot;
}
function parcel(service: GameService, player: Client, models: string[], money = 0): LiveDelivery {
  const owner = service.liveEconomy.resolve(request('state', player));
  return { id: randomUUID(), owner: owner.key, gameId: owner.gameId, createdAt: NOW, money,
    items: models.map(modelId => ({ id: randomUUID(), modelId, foundAt: NOW - 1000 })) };
}
function seed(path: string, player: Client, change: (state: GameState) => void) {
  const db = new Database(path);
  try {
    const row = db.query<{ state: string }, [string]>('SELECT state FROM authoritative_games WHERE id=?').get(player.snapshot.identity.id)!;
    const value = parseSave(row.state)!; change(value); const encoded = saveGame(value); expect(parseSave(encoded)).not.toBeNull();
    db.query('UPDATE authoritative_games SET state=? WHERE id=?').run(encoded, player.snapshot.identity.id);
  } finally { db.close(); }
}
function fullShelf(value: GameState, free = 0) {
  value.lootItems = Array.from({ length: getLootCapacity(value) - free }, () => ({ id: `loot-${value.nextId++}`, modelId: 'duct-tape', foundAt: NOW }));
}
function ledger(path: string) {
  const db = new Database(path, { readonly: true });
  try { return { deliveries: db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM authoritative_live_deliveries').get()!.count,
    items: db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM authoritative_live_items').get()!.count }; } finally { db.close(); }
}
function rejected(run: () => unknown, code: string) {
  try { run(); throw new Error('Delivery was unexpectedly accepted'); } catch (error) { expect(error).toBeInstanceOf(LiveEconomyError); expect((error as LiveEconomyError).code).toBe(code); }
}

describe('private multiplayer junk delivery', () => {
  test('all junk sells at exact NPC prices on a full shelf, consumes no inventory identifiers and credits once across restart', async () => {
    const path = await disk(), service = setup(path), player = await client(service);
    seed(path, player, fullShelf); await state(service, player); const before = structuredClone(player.snapshot);
    const delivery = parcel(service, player, JUNK_MODELS.map(model => model.id)), receipt = service.liveEconomy.deliver(delivery);
    expect(receipt.ok).toBe(true); const after = await state(service, player);
    expect(after.state.money).toBe(before.state.money + 19); expect(after.state.stats.moneyEarned).toBe(before.state.stats.moneyEarned + 19);
    expect(after.state.lootItems).toEqual(before.state.lootItems); expect(after.state.nextId).toBe(before.state.nextId); expect(after.revision).toBe(before.revision + 1);
    expect(receipt.message).toContain('0 полезных трофеев'); expect(receipt.message).toContain('за 19 ₽');
    for (const model of JUNK_MODELS) expect(receipt.message).toContain(`${model.label} — ${getLootTraderPrice({ id: 'loot-1', modelId: model.id, foundAt: NOW })} ₽`);
    expect(ledger(path)).toEqual({ deliveries: 1, items: 6 }); expect(service.liveEconomy.deliver(structuredClone(delivery))).toEqual(receipt);
    expect(await state(service, player)).toEqual(after);
    service.close(); const restored = setup(path);
    expect(restored.liveEconomy.deliver(delivery)).toEqual(receipt); expect(await state(restored, player)).toEqual(after);
    rejected(() => restored.liveEconomy.deliver({ ...delivery, id: randomUUID() }), 'live_item_already_delivered');
    rejected(() => restored.liveEconomy.deliver({ ...delivery, money: 1 }), 'live_delivery_changed');
    expect(await state(restored, player)).toEqual(after);
  });

  test('mixed deliveries stay atomic until useful items fit, then preserve common useful trophies and sell only marked junk', async () => {
    const path = await disk(), service = setup(path), player = await client(service);
    seed(path, player, value => fullShelf(value, 1)); await state(service, player); const before = structuredClone(player.snapshot);
    const delivery = parcel(service, player, ['empty-can', 'duct-tape', 'local-map', 'broken-phone'], 7);
    expect(service.liveEconomy.deliver(delivery).ok).toBe(false);
    expect(await state(service, player)).toEqual(before); expect(ledger(path)).toEqual({ deliveries: 0, items: 0 });
    seed(path, player, value => { value.lootItems!.pop(); }); await state(service, player); const room = structuredClone(player.snapshot);
    const receipt = service.liveEconomy.deliver(delivery); expect(receipt.ok).toBe(true); const after = await state(service, player);
    expect(after.state.money).toBe(room.state.money + 17); expect(after.state.stats.moneyEarned).toBe(room.state.stats.moneyEarned + 17);
    expect(after.state.lootItems!.slice(-2).map(item => item.modelId)).toEqual(['duct-tape', 'local-map']);
    expect(after.state.lootItems!.slice(-2).every(item => item.foundAt === NOW - 1000)).toBe(true);
    expect(after.state.nextId).toBe(room.state.nextId + 2); expect(after.state.lootItems).toHaveLength(getLootCapacity(after.state));
    expect(receipt.message).toContain('2 полезных трофеев и 7 ₽'); expect(receipt.message).toContain('Мусор продан при доставке за 10 ₽');
    expect(receipt.message).not.toContain(`${LOOT_MODEL_BY_ID['duct-tape']!.label} —`); expect(receipt.message).not.toContain(`${LOOT_MODEL_BY_ID['local-map']!.label} —`);
    expect(ledger(path)).toEqual({ deliveries: 1, items: 4 }); expect(service.liveEconomy.deliver(delivery)).toEqual(receipt);
    expect(await state(service, player)).toEqual(after);
  });

  test('wallet overflow waits without discarding junk or source receipts and allows a safe identical retry', async () => {
    const path = await disk(), service = setup(path), player = await client(service);
    seed(path, player, value => { fullShelf(value); value.money = 1e15; }); await state(service, player); const before = structuredClone(player.snapshot);
    const delivery = parcel(service, player, ['broken-phone']); expect(service.liveEconomy.deliver(delivery).ok).toBe(false);
    expect(await state(service, player)).toEqual(before); expect(ledger(path)).toEqual({ deliveries: 0, items: 0 });
    seed(path, player, value => { value.money -= 9; }); await state(service, player);
    expect(service.liveEconomy.deliver(delivery).ok).toBe(true); const after = await state(service, player);
    expect(after.state.money).toBe(1e15); expect(after.state.lootItems).toEqual(before.state.lootItems);
    expect(service.liveEconomy.deliver(delivery).ok).toBe(true); expect(await state(service, player)).toEqual(after);
  });

  test('useful legendary loot remains a real item; client flags and prices cannot turn a useful item into automatic sale', async () => {
    const path = await disk(), service = setup(path), player = await client(service);
    const delivery = parcel(service, player, ['military-cpu', 'prototype-optics']);
    for (const field of [{ autoSell: true }, { guidePrice: 1e9 }, { rarity: 'junk' }]) rejected(() => service.liveEconomy.deliver({ ...delivery, items: [{ ...delivery.items[0]!, ...field }] }), 'invalid_live_delivery');
    const cash = player.snapshot.state.money; expect(service.liveEconomy.deliver(delivery).ok).toBe(true); const after = await state(service, player);
    expect(after.state.money).toBe(cash); expect(after.state.lootItems!.map(item => item.modelId)).toEqual(['military-cpu', 'prototype-optics']);
    expect(after.state.stats.raidsCompleted).toBe(0); expect(after.state.stats.moneyEarned).toBe(0); expect(ledger(path)).toEqual({ deliveries: 1, items: 2 });
  });

  test('listing a required material and starting construction in two windows can consume it only once under the protected owner', async () => {
    for (const buildFirst of [false, true]) {
      const path = await disk(), service = setup(path), player = await client(service), other = await client(service);
      seed(path, player, value => { value.money = 5000; value.supplies.scrap = 40; addLootInputs(value, ROOM_DEFINITIONS.ammo.lootRequirements); });
      await state(service, player); const before = structuredClone(player.snapshot), needed = before.state.lootItems![0]!;
      const listing: GameCommand = { type: 'listMarketItem', args: [{ kind: 'loot', id: needed.id, quantity: 1 }, 100] };
      const build: GameCommand = { type: 'buildRoom', args: ['ammo', 0, 1] };
      const rejectedOther = (await service.fetch(request('action', other, { revision: other.snapshot.revision, command: listing })))!;
      expect((await rejectedOther.json() as GameActionSnapshot).result.ok).toBe(false);
      expect((await state(service, other)).state.lootItems ?? []).toHaveLength(0);
      const commands = buildFirst ? [build, listing] : [listing, build];
      const responses = await Promise.all(commands.map(command => service.fetch(request('action', player, { revision: before.revision, command }))));
      const results = await Promise.all(responses.map(response => response!.json() as Promise<GameActionSnapshot>));
      expect(responses.filter(response => response!.status === 200)).toHaveLength(1);
      expect(responses.filter(response => response!.status === 409)).toHaveLength(1);
      expect(results.filter(result => result.result?.ok)).toHaveLength(1);
      const after = await state(service, player), marketResponse = (await service.fetch(request('market', player)))!;
      const offers = readMarketSnapshot(await marketResponse.json()).mine.filter(offer => offer.status === 'active');
      const built = after.state.shelter.rooms.filter(room => room.type === 'ammo' && room.column === 0 && room.row === 1);
      expect(after.revision).toBe(before.revision + 1); expect(built.length + offers.length).toBe(1);
      expect(after.state.lootItems!.some(item => item.id === needed.id)).toBe(false);
      if (built.length) {
        expect(built).toHaveLength(1); expect(offers).toHaveLength(0); expect(built[0]!.construction!.paidLoot!.map(item => item.id).sort()).toEqual(before.state.lootItems!.map(item => item.id).sort());
        expect(after.state.lootItems).toHaveLength(0); expect(after.state.money).toBe(before.state.money - ROOM_DEFINITIONS.ammo.cost.money);
        expect(after.state.supplies.scrap).toBe(before.state.supplies.scrap - ROOM_DEFINITIONS.ammo.cost.scrap);
      } else {
        expect(offers).toHaveLength(1); expect(built).toHaveLength(0); expect(offers[0]!.asset.kind).toBe('loot');
        expect(after.state.lootItems).toHaveLength(before.state.lootItems!.length - 1);
        expect(after.state.money).toBe(before.state.money - 2); expect(after.state.supplies).toEqual(before.state.supplies);
      }
      expect(parseSave(saveGame(after.state))).not.toBeNull();
    }
  });
});
