import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameService, readGameCommand, type GameService } from '../server/game';
import { getLoadoutStats, getLootCapacity, parseSave, saveGame, type GameState } from '../src/game/engine';
import type { GameActionSnapshot, GameCommand, GameSnapshot } from '../src/game/commands';
import { BARTER_OFFERS, getBarterQuote, type BarterOffer } from '../src/game/barter';
import { GEAR_MODEL_BY_ID } from '../src/game/systems';
import { readMarketSnapshot } from '../src/game/flea';

const NOW = 1_792_000_000_000, ORIGIN = 'http://barter.test';
const services: GameService[] = [], folders: string[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) service.close();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
interface Client { cookie: string; snapshot: GameSnapshot }
function snapshotValue(snapshot: GameSnapshot): GameSnapshot {
  const { state, revision, serverNow, identity } = snapshot;
  return { state, revision, serverNow, identity };
}
function request(path: string, player?: Client, body?: unknown, extra: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/game/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: {
    ...(body === undefined ? {} : { origin: ORIGIN, 'content-type': 'application/json' }),
    ...(player ? { cookie: player.cookie, 'x-prapor-game': player.snapshot.identity.id } : {}), ...extra,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function setup(path = ':memory:') {
  const service = createGameService({ dbPath: path, secureCookies: false, allowedOrigins: [ORIGIN], now: () => NOW });
  services.push(service); return service;
}
async function disk() {
  const folder = await mkdtemp(join(tmpdir(), 'prapor-barter-')); folders.push(folder); return join(folder, 'game.sqlite');
}
async function client(service: GameService, cookie = ''): Promise<Client> {
  const response = (await service.fetch(request('join', undefined, {}, { cookie })))!; expect(response.status).toBe(200);
  return { cookie: response.headers.get('set-cookie')?.split(';')[0] ?? cookie, snapshot: await response.json() as GameSnapshot };
}
async function action(service: GameService, player: Client, command: GameCommand, revision = player.snapshot.revision) {
  const response = (await service.fetch(request('action', player, { revision, command })))!;
  const body = await response.json() as GameActionSnapshot & { snapshot?: GameSnapshot };
  if (response.ok) player.snapshot = body; else if (body.snapshot) player.snapshot = body.snapshot;
  return { response, body };
}
async function state(service: GameService, player: Client) {
  const response = (await service.fetch(request('state', player)))!; expect(response.status).toBe(200);
  player.snapshot = await response.json() as GameSnapshot; return player.snapshot;
}
function seed(path: string, player: Client, change: (state: GameState) => void) {
  const db = new Database(path);
  try {
    const row = db.query<{ state: string }, [string]>('SELECT state FROM authoritative_games WHERE id=?').get(player.snapshot.identity.id)!;
    const value = parseSave(row.state)!; change(value); const encoded = saveGame(value); expect(parseSave(encoded)).not.toBeNull();
    db.query('UPDATE authoritative_games SET state=? WHERE id=?').run(encoded, player.snapshot.identity.id);
  } finally { db.close(); }
}
function giveRecipe(value: GameState, offer: BarterOffer) {
  const ids: string[] = [];
  for (const { modelId, quantity } of offer.requirements) for (let count = 0; count < quantity; count++) {
    const item = { id: `loot-${value.nextId++}`, modelId, foundAt: NOW };
    (value.lootItems ??= []).push(item); ids.push(item.id);
  }
  return ids;
}
async function market(service: GameService, player: Client) {
  const response = (await service.fetch(request('market', player)))!; expect(response.status).toBe(200);
  return readMarketSnapshot(await response.json());
}

describe('authoritative trophy barter and collection', () => {
  test('all recipes consume exactly selected physical items and issue real wearable gear without charging or teaching blueprints', async () => {
    const path = await disk(), service = setup(path), player = await client(service);
    const received: string[] = [];
    for (const offer of BARTER_OFFERS) {
      let itemIds: string[] = [], spareId = '';
      seed(path, player, value => {
        value.lootItems = [];
        // Put an identical spare first: the submitted objects, rather than a suggested recipe, must be removed.
        const spare = { id: `loot-${value.nextId++}`, modelId: offer.requirements[0]!.modelId, foundAt: NOW };
        value.lootItems.push(spare); spareId = spare.id; itemIds = giveRecipe(value, offer);
      });
      await state(service, player); const before = structuredClone(player.snapshot);
      expect(getBarterQuote(before.state, offer.id).reason).toBeNull();
      const result = await action(service, player, { type: 'barterGear', args: [offer.id, itemIds] });
      expect(result.response.status).toBe(200); expect(result.body.result.ok).toBe(true);
      expect(player.snapshot.revision).toBe(before.revision + 1);
      expect(player.snapshot.state.lootItems!.map(item => item.id)).toEqual([spareId]);
      expect(player.snapshot.state.money).toBe(before.state.money); expect(player.snapshot.state.supplies).toEqual(before.state.supplies);
      expect(player.snapshot.state.blueprints).toEqual(before.state.blueprints);
      const gear = player.snapshot.state.gearItems.at(-1)!;
      expect(gear.modelId).toBe(offer.gearModelId); expect(gear.durability).toBe(100); expect(received).not.toContain(gear.id); received.push(gear.id);
      const scav = player.snapshot.state.scavs[0]!, model = GEAR_MODEL_BY_ID[gear.modelId]!;
      expect((await action(service, player, { type: 'equipGear', args: [scav.id, model.slot, gear.id] })).body.result.ok).toBe(true);
      const slot = model.slot === 'armor' ? 'armorItemId' : model.slot === 'helmet' ? 'helmetItemId' : 'backpackItemId';
      expect(player.snapshot.state.scavs[0]!.loadout[slot]).toBe(gear.id);
      const loadout = getLoadoutStats(player.snapshot.state, player.snapshot.state.scavs[0]!);
      if (model.slot === 'backpack') expect(loadout.capacity).toBeGreaterThanOrEqual(model.capacity);
      else expect(loadout.protection).toBeGreaterThanOrEqual(model.protection);
      expect(parseSave(saveGame(player.snapshot.state))).not.toBeNull();
    }
    expect(received).toHaveLength(20); const beforeRestart = structuredClone(player.snapshot);
    service.close(); const restored = setup(path), same = await client(restored, player.cookie);
    expect(snapshotValue(same.snapshot)).toEqual(snapshotValue(beforeRestart)); expect(same.snapshot.state.gearItems).toHaveLength(20);
  });

  test('stale, extra, wrong and another owner selections fail without consuming trophies; a repeated request cannot mint twice', async () => {
    const path = await disk(), service = setup(path), player = await client(service), other = await client(service), offer = BARTER_OFFERS[0]!;
    let selected: string[] = [], foreignId = '', extraId = '';
    seed(path, player, value => {
      selected = giveRecipe(value, offer); extraId = `loot-${value.nextId++}`;
      value.lootItems!.push({ id: extraId, modelId: 'secure-drive', foundAt: NOW });
    });
    seed(path, other, value => {
      value.nextId += 100;
      foreignId = giveRecipe(value, offer)[0]!;
    });
    await state(service, player); const before = structuredClone(player.snapshot);
    for (const ids of [selected.slice(1), [...selected, extraId], [extraId, ...selected.slice(1)], [foreignId, ...selected.slice(1)], ['loot-999999', ...selected.slice(1)]]) {
      expect((await action(service, player, { type: 'barterGear', args: [offer.id, ids] })).body.result.ok).toBe(false);
      expect(snapshotValue(player.snapshot)).toEqual(snapshotValue(before));
    }
    const command: GameCommand = { type: 'barterGear', args: [offer.id, selected] }, oldRevision = player.snapshot.revision;
    expect((await action(service, player, command)).body.result.ok).toBe(true); const success = structuredClone(player.snapshot);
    expect((await action(service, player, command, oldRevision)).response.status).toBe(409);
    expect(snapshotValue(player.snapshot)).toEqual(snapshotValue(success));
    expect((await action(service, player, command)).body.result.ok).toBe(false);
    expect(snapshotValue(player.snapshot)).toEqual(snapshotValue(success)); expect(player.snapshot.state.gearItems).toHaveLength(1);
    expect(player.snapshot.state.lootItems!.map(item => item.id)).toEqual([extraId]);
  });

  test('an escrowed trophy is unavailable for barter until its seller chooses to cancel; full gear capacity preserves the entire recipe', async () => {
    const path = await disk(), service = setup(path), player = await client(service), offer = BARTER_OFFERS[0]!;
    let selected: string[] = [];
    seed(path, player, value => { selected = giveRecipe(value, offer); }); await state(service, player);
    const selectedId = selected[0]!;
    expect((await action(service, player, { type: 'listMarketItem', args: [{ kind: 'loot', id: selectedId, quantity: 1 }, 100] })).body.result.ok).toBe(true);
    const listing = (await market(service, player)).mine[0]!, escrowed = structuredClone(player.snapshot);
    expect((await action(service, player, { type: 'barterGear', args: [offer.id, selected] })).body.result.ok).toBe(false);
    expect(snapshotValue(player.snapshot)).toEqual(snapshotValue(escrowed)); expect((await market(service, player)).mine[0]!.status).toBe('active');
    expect((await action(service, player, { type: 'cancelMarketListing', args: [listing.id] })).body.result.ok).toBe(true);
    seed(path, player, value => { value.gearItems = Array.from({ length: 28 }, () => ({ id: `gear-${value.nextId++}`, modelId: 'canvas_pack', durability: 100 })); });
    await state(service, player); const full = structuredClone(player.snapshot);
    expect((await action(service, player, { type: 'barterGear', args: [offer.id, selected] })).body.result.ok).toBe(false);
    expect(snapshotValue(player.snapshot)).toEqual(snapshotValue(full));
    const released = full.state.gearItems[0]!;
    expect((await action(service, player, { type: 'listMarketItem', args: [{ kind: 'gear', id: released.id, quantity: 1 }, 100] })).body.result.ok).toBe(true);
    expect((await action(service, player, { type: 'barterGear', args: [offer.id, selected] })).body.result.ok).toBe(true);
    expect(player.snapshot.state.gearItems).toHaveLength(28); expect(player.snapshot.state.gearItems.at(-1)!.modelId).toBe(offer.gearModelId);
  });

  test('two windows cannot both list and barter the same physical trophy at the same revision', async () => {
    const path = await disk(), service = setup(path), player = await client(service), offer = BARTER_OFFERS[0]!;
    let selected: string[] = [];
    seed(path, player, value => { selected = giveRecipe(value, offer); });
    await state(service, player); const otherWindow = await client(service, player.cookie), revision = player.snapshot.revision;
    const outcomes = await Promise.all([
      action(service, player, { type: 'barterGear', args: [offer.id, selected] }, revision),
      action(service, otherWindow, { type: 'listMarketItem', args: [{ kind: 'loot', id: selected[0]!, quantity: 1 }, 100] }, revision),
    ]);
    expect(outcomes.filter(result => result.response.status === 200 && result.body.result.ok)).toHaveLength(1);
    expect(outcomes.filter(result => result.response.status === 409)).toHaveLength(1);
    const final = await state(service, player), active = (await market(service, player)).mine.filter(listing => listing.status === 'active');
    expect(final.revision).toBe(revision + 1);
    if (final.state.gearItems.length) {
      expect(final.state.gearItems).toHaveLength(1); expect(final.state.lootItems).toHaveLength(0);
      expect(active).toHaveLength(0); expect(final.state.money).toBe(640);
    } else {
      expect(active).toHaveLength(1); expect(final.state.lootItems).toHaveLength(selected.length - 1);
      expect(final.state.money).toBe(638);
    }
  });

  test('loot from the private live bridge stays a trophy until the owner barters it, while a second player can buy the missing ingredient and equip armor', async () => {
    const service = setup(), seller = await client(service), buyer = await client(service);
    const armorOffer = BARTER_OFFERS.find(offer => offer.gearModelId === 'padded_vest')!;
    const linked = (player: Client) => service.liveEconomy.resolve(request('state', player));
    const deliver = (player: Client, models: string[]) => {
      const owner = linked(player);
      return service.liveEconomy.deliver({ id: randomUUID(), owner: owner.key, gameId: owner.gameId, createdAt: NOW, money: 0,
        items: models.map(modelId => ({ id: randomUUID(), modelId, foundAt: NOW - 1000 })) });
    };
    const recipeModels = armorOffer.requirements.flatMap(requirement => Array<string>(requirement.quantity).fill(requirement.modelId));
    expect(deliver(seller, recipeModels).ok).toBe(true);
    await state(service, seller); const sellerMoney = seller.snapshot.state.money;
    expect(seller.snapshot.state.lootItems).toHaveLength(recipeModels.length); expect(seller.snapshot.state.gearItems).toHaveLength(0);
    // The seller explicitly lists one ingredient; the other three remain owned for later decisions.
    const chosen = seller.snapshot.state.lootItems![0]!;
    expect((await action(service, seller, { type: 'listMarketItem', args: [{ kind: 'loot', id: chosen.id, quantity: 1 }, 50] })).body.result.ok).toBe(true);
    expect(seller.snapshot.state.lootItems).toHaveLength(recipeModels.length - 1); expect(seller.snapshot.state.money).toBe(sellerMoney - 1);
    expect(deliver(buyer, recipeModels.slice(1)).ok).toBe(true); await state(service, buyer);
    expect(getBarterQuote(buyer.snapshot.state, armorOffer.id).reason).not.toBeNull();
    const listing = (await market(service, buyer)).offers[0]!, originalBuyerIds = new Set(buyer.snapshot.state.lootItems!.map(item => item.id));
    expect((await action(service, buyer, { type: 'buyMarketListing', args: [listing.id] })).body.result.ok).toBe(true);
    const selected = getBarterQuote(buyer.snapshot.state, armorOffer.id).itemIds, before = structuredClone(buyer.snapshot);
    expect(selected).toHaveLength(recipeModels.length);
    const purchased = buyer.snapshot.state.lootItems!.find(item => !originalBuyerIds.has(item.id))!;
    expect(purchased.modelId).toBe(chosen.modelId); expect(selected).toContain(purchased.id);
    expect((await action(service, buyer, { type: 'barterGear', args: [armorOffer.id, selected] })).body.result.ok).toBe(true);
    expect(buyer.snapshot.state.money).toBe(before.state.money); expect(buyer.snapshot.state.supplies).toEqual(before.state.supplies);
    expect(buyer.snapshot.state.stats.raidsCompleted).toBe(0); expect(buyer.snapshot.state.lootItems).toHaveLength(0);
    const gear = buyer.snapshot.state.gearItems[0]!, scav = buyer.snapshot.state.scavs[0]!, protection = getLoadoutStats(buyer.snapshot.state, scav).protection;
    expect((await action(service, buyer, { type: 'equipGear', args: [scav.id, 'armor', gear.id] })).body.result.ok).toBe(true);
    expect(buyer.snapshot.state.scavs[0]!.loadout.armorItemId).toBe(gear.id);
    expect(getLoadoutStats(buyer.snapshot.state, buyer.snapshot.state.scavs[0]!).protection).toBeCloseTo(protection + .03);
    expect((await state(service, seller)).state.lootItems).toHaveLength(recipeModels.length - 1);
    const spoof = { ...seller, snapshot: buyer.snapshot };
    expect((await service.fetch(request('action', spoof, { revision: buyer.snapshot.revision, command: { type: 'equipGear', args: [scav.id, 'armor', null] } })))!.status).toBe(401);
    expect((await state(service, buyer)).state.scavs[0]!.loadout.armorItemId).toBe(gear.id);
  });

  test('pending raid trophies remain a whole parcel on a full shelf and can be claimed once, survive restart and then be bartered', async () => {
    const path = await disk(), service = setup(path), player = await client(service), other = await client(service), offer = BARTER_OFFERS[0]!;
    let deliveryId = '', selected: string[] = [];
    seed(path, player, value => {
      value.lootItems = [];
      selected = giveRecipe(value, offer);
      const items = value.lootItems; value.lootItems = Array.from({ length: getLootCapacity(value) - 1 }, () => ({ id: `loot-${value.nextId++}`, modelId: 'local-map', foundAt: NOW }));
      deliveryId = `delivery-${value.nextId++}`;
      value.pendingLoot = [{ id: deliveryId, raidId: `raid-${value.nextId++}`, at: NOW, items }];
    });
    await state(service, player); const before = structuredClone(player.snapshot);
    expect((await action(service, player, { type: 'claimLootDelivery', args: [deliveryId] })).body.result.ok).toBe(false);
    expect(snapshotValue(player.snapshot)).toEqual(snapshotValue(before)); expect(player.snapshot.state.money).toBe(before.state.money);
    expect((await action(service, other, { type: 'claimLootDelivery', args: [deliveryId] })).body.result.ok).toBe(false);
    service.close(); const restored = setup(path), same = await client(restored, player.cookie);
    expect(same.snapshot).toEqual(before); expect(same.snapshot.state.pendingLoot![0]!.items.map(item => item.id)).toEqual(selected);
    for (let count = 0; count < selected.length - 1; count++) {
      const shelfId = same.snapshot.state.lootItems![0]!.id;
      expect((await action(restored, same, { type: 'sellLootItem', args: [shelfId] })).body.result.ok).toBe(true);
    }
    const revision = same.snapshot.revision, money = same.snapshot.state.money;
    expect((await action(restored, same, { type: 'claimLootDelivery', args: [deliveryId] })).body.result.ok).toBe(true);
    expect(same.snapshot.state.lootItems).toHaveLength(getLootCapacity(same.snapshot.state)); expect(same.snapshot.state.pendingLoot).toHaveLength(0);
    expect(same.snapshot.state.money).toBe(money); expect(same.snapshot.state.lootItems!.filter(item => selected.includes(item.id)).map(item => item.id)).toEqual(selected);
    expect((await action(restored, same, { type: 'claimLootDelivery', args: [deliveryId] }, revision)).response.status).toBe(409);
    expect((await action(restored, same, { type: 'claimLootDelivery', args: [deliveryId] })).body.result.ok).toBe(false);
    expect((await action(restored, same, { type: 'barterGear', args: [offer.id, selected] })).body.result.ok).toBe(true);
    expect(same.snapshot.state.gearItems[0]!.modelId).toBe(offer.gearModelId); expect(same.snapshot.state.lootItems).toHaveLength(getLootCapacity(same.snapshot.state) - selected.length);
  });

  test('accepts intent only and rejects duplicate selections, client rewards, clocks and quantities before mutation', async () => {
    const service = setup(), player = await client(service), before = structuredClone(player.snapshot);
    const offerId = BARTER_OFFERS[0]!.id;
    for (const command of [
      { type: 'barterGear', args: [offerId, []] },
      { type: 'barterGear', args: [offerId, ['loot-1', 'loot-1']] },
      { type: 'barterGear', args: [offerId, Array.from({ length: 17 }, (_, index) => `loot-${index + 1}`)] },
      { type: 'barterGear', args: [offerId, [{ id: 'loot-1', modelId: 'duct-tape', quantity: 2 }]] },
      { type: 'barterGear', args: [offerId, ['loot-1'], NOW] },
      { type: 'barterGear', args: [offerId, ['loot-1']], gearModelId: 'heavy_armor' },
      { type: 'barterGear', args: [offerId, ['loot-1']], owner: player.snapshot.identity.id },
      { type: 'barterGear', args: [offerId, ['loot-1']], money: 1e9 },
      { type: 'claimLootDelivery', args: ['loot-1', 2] },
      { type: 'claimLootDelivery', args: ['loot-1', NOW] },
      { type: 'claimLootDelivery', args: [{ id: 'loot-1', modelId: 'secure-drive' }] },
      { type: 'claimLootDelivery', args: ['loot-1'], items: ['secure-drive'] },
    ]) {
      expect(() => readGameCommand(command)).toThrow();
      expect((await service.fetch(request('action', player, { revision: before.revision, command })))!.status).toBe(400);
    }
    const valid = { type: 'barterGear', args: [offerId, ['loot-1']] };
    expect((await service.fetch(request('action', player, { revision: before.revision, command: valid }, { origin: 'https://evil.test' })))!.status).toBe(403);
    expect((await service.fetch(request('action', undefined, { revision: 0, command: valid })))!.status).toBe(401);
    const other = await client(service), spoof = { ...other, snapshot: player.snapshot };
    expect((await service.fetch(request('action', spoof, { revision: 0, command: valid })))!.status).toBe(401);
    for (const route of ['barter', 'rewards', 'deliver']) expect((await service.fetch(request(route, player, valid)))!.status).toBe(404);
    expect(await state(service, player)).toEqual(before);
  });
});
