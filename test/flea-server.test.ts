import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameService, readGameCommand, type GameService } from '../server/game';
import { getSupplyCapacity, parseSave, saveGame, type GameState } from '../src/game/engine';
import type { GameActionSnapshot, GameCommand, GameSnapshot } from '../src/game/commands';
import { getMarketFees, readMarketSnapshot, type MarketListing, type MarketSnapshot } from '../src/game/flea';
import type { TradeRef } from '../src/game/trade';
import { ensureShelterLogistics } from '../src/game/shelter-logistics';

const NOW = 1_792_000_000_000, ORIGIN = 'http://flea.test';
const services: GameService[] = [], folders: string[] = [];
afterEach(async () => { for (const service of services.splice(0)) service.close(); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
interface Client { cookie: string; snapshot: GameSnapshot }
function request(path: string, client?: Client, body?: unknown, extra: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/game/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: {
    ...(body === undefined ? {} : { origin: ORIGIN, 'content-type': 'application/json' }),
    ...(client ? { cookie: client.cookie, 'x-prapor-game': client.snapshot.identity.id } : {}), ...extra,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function setup(path = ':memory:') {
  let time = NOW;
  const service = createGameService({ dbPath: path, secureCookies: false, allowedOrigins: [ORIGIN], now: () => time }); services.push(service);
  return { service, setTime: (value: number) => { time = value; } };
}
async function disk() { const folder = await mkdtemp(join(tmpdir(), 'prapor-flea-')); folders.push(folder); return join(folder, 'game.sqlite'); }
async function client(service: GameService, cookie = ''): Promise<Client> {
  const response = (await service.fetch(request('join', undefined, {}, { cookie })))!;
  expect(response.status).toBe(200);
  return { cookie: response.headers.get('set-cookie')?.split(';')[0] ?? cookie, snapshot: await response.json() as GameSnapshot };
}
async function action(service: GameService, player: Client, command: GameCommand, revision = player.snapshot.revision) {
  const response = (await service.fetch(request('action', player, { revision, command })))!;
  const body = await response.json() as GameActionSnapshot & { code?: string; snapshot?: GameSnapshot };
  if (response.ok) player.snapshot = body; else if (body.snapshot) player.snapshot = body.snapshot;
  return { response, body };
}
async function state(service: GameService, player: Client) {
  const response = (await service.fetch(request('state', player)))!; expect(response.status).toBe(200);
  player.snapshot = await response.json() as GameSnapshot; return player.snapshot.state;
}
async function market(service: GameService, player: Client): Promise<MarketSnapshot> {
  const response = (await service.fetch(request('market', player)))!; expect(response.status).toBe(200);
  const result = readMarketSnapshot(await response.json()); expect(result.identity.id).toBe(player.snapshot.identity.id); return result;
}
async function list(service: GameService, owner: Client, ref: TradeRef, price = 100): Promise<MarketListing> {
  const result = await action(service, owner, { type: 'listMarketItem', args: [ref, price] }); expect(result.body.result.ok).toBe(true);
  return (await market(service, owner)).mine.find(item => item.status === 'active')!;
}
function seed(path: string, player: Client, change: (state: GameState) => void) {
  const db = new Database(path);
  try {
    const row = db.query<{ state: string }, [string]>('SELECT state FROM authoritative_games WHERE id=?').get(player.snapshot.identity.id)!;
    const state = parseSave(row.state)!; change(state); const encoded = saveGame(state); expect(parseSave(encoded)).not.toBeNull();
    db.query('UPDATE authoritative_games SET state=? WHERE id=?').run(encoded, player.snapshot.identity.id);
  } finally { db.close(); }
}

describe('persistent shared player flea market', () => {
  test('escrows the verified item, charges exactly once, transfers to another player and pays the seller exactly once', async () => {
    const { service } = setup(), owner = await client(service), buyer = await client(service), otherWindow = await client(service, owner.cookie);
    const original = structuredClone(owner.snapshot.state.modules[0]!), buyerIds = new Set(buyer.snapshot.state.modules.map(item => item.id));
    const initialOwner = owner.snapshot.state.money, initialBuyer = buyer.snapshot.state.money;
    const offer = await list(service, owner, { kind: 'module', id: original.id, quantity: 1 }, 101);
    expect(offer.price).toBe(101); expect(offer.listingFee).toBe(3); expect(offer.commission).toBe(6); expect(offer.proceeds).toBe(95);
    expect(owner.snapshot.state.money).toBe(initialOwner - 3); expect(owner.snapshot.state.modules.some(item => item.id === original.id)).toBe(false);
    expect((await action(service, otherWindow, { type: 'listMarketItem', args: [{ kind: 'module', id: original.id, quantity: 1 }, 101] }, 0)).response.status).toBe(409);
    expect((await action(service, owner, { type: 'buyMarketListing', args: [offer.id] })).body.result.ok).toBe(false);
    expect((await action(service, buyer, { type: 'buyMarketListing', args: [offer.id] })).body.result.ok).toBe(true);
    expect(buyer.snapshot.state.money).toBe(initialBuyer - 101);
    const delivered = buyer.snapshot.state.modules.find(item => !buyerIds.has(item.id))!;
    expect(delivered).toBeDefined(); expect(delivered.id).not.toBe(original.id); expect({ ...delivered, id: original.id }).toEqual(original);
    expect((await state(service, owner)).money).toBe(initialOwner - 3);
    const receipt = await market(service, owner); expect(receipt.offers).toHaveLength(0); expect(receipt.receivables).toBe(95); expect(receipt.mine[0]!.claimable).toBe(true);
    const claimRevision = owner.snapshot.revision;
    expect((await action(service, owner, { type: 'claimMarketSale', args: [offer.id] })).body.result.ok).toBe(true);
    expect(owner.snapshot.state.money).toBe(initialOwner - 3 + 95); expect(owner.snapshot.state.stats.moneyEarned).toBe(95);
    expect((await action(service, owner, { type: 'claimMarketSale', args: [offer.id] }, claimRevision)).response.status).toBe(409);
    expect((await action(service, owner, { type: 'claimMarketSale', args: [offer.id] })).body.result.ok).toBe(false);
    expect(owner.snapshot.state.money).toBe(initialOwner - 3 + 95); expect((await market(service, owner)).receivables).toBe(0);
  });

  test('simultaneous independent buyers can purchase only one escrow item', async () => {
    const { service } = setup(), owner = await client(service), first = await client(service), second = await client(service);
    const offer = await list(service, owner, { kind: 'module', id: owner.snapshot.state.modules[0]!.id, quantity: 1 }, 120);
    const originalCounts = [first, second].map(player => player.snapshot.state.modules.length);
    const outcomes = await Promise.all([action(service, first, { type: 'buyMarketListing', args: [offer.id] }), action(service, second, { type: 'buyMarketListing', args: [offer.id] })]);
    expect(outcomes.filter(result => result.body.result.ok)).toHaveLength(1);
    const states = await Promise.all([state(service, first), state(service, second)]);
    expect(states.map(value => value.money).sort()).toEqual([520, 640]);
    expect(states.reduce((sum, value, index) => sum + value.modules.length - originalCounts[index]!, 0)).toBe(1);
    expect((await market(service, owner)).receivables).toBe(114);
  });

  test('offers and unclaimed sale payments survive service restarts; another identity cannot cancel or claim them', async () => {
    const path = await disk(), first = setup(path), owner = await client(first.service), buyer = await client(first.service);
    const offer = await list(first.service, owner, { kind: 'supply', id: 'ammo', quantity: 5 }, 77);
    expect(owner.snapshot.state.supplies.ammo).toBe(19); first.service.close();
    const second = setup(path), restored = await client(second.service, owner.cookie);
    expect((await market(second.service, restored)).mine[0]!.id).toBe(offer.id);
    expect((await action(second.service, buyer, { type: 'cancelMarketListing', args: [offer.id] })).body.result.ok).toBe(false);
    expect((await action(second.service, buyer, { type: 'buyMarketListing', args: [offer.id] })).body.result.ok).toBe(true);
    expect(buyer.snapshot.state.supplies.ammo).toBe(29);
    expect((await action(second.service, buyer, { type: 'claimMarketSale', args: [offer.id] })).body.result.ok).toBe(false);
    second.service.close(); const third = setup(path), seller = await client(third.service, owner.cookie);
    expect((await market(third.service, seller)).receivables).toBe(73);
    expect((await action(third.service, seller, { type: 'claimMarketSale', args: [offer.id] })).body.result.ok).toBe(true);
    expect(seller.snapshot.state.money).toBe(640 - 2 + 73);
  });

  test('weapons with nested parts, physical gear, raid loot and field kits retain their complete contents on delivery', async () => {
    const path = await disk(), { service } = setup(path), owner = await client(service), buyer = await client(service);
    const spare = owner.snapshot.state.weapons.find(weapon => !owner.snapshot.state.scavs.some(scav => scav.weaponInstanceId === weapon.id))!;
    const originalGun = structuredClone(spare), originalPartIds = Object.values(originalGun.modules).map(part => part.id), buyerGunIds = new Set(buyer.snapshot.state.weapons.map(gun => gun.id));
    const gunOffer = await list(service, owner, { kind: 'weapon', id: spare.id, quantity: 1 }, 70);
    expect((await action(service, buyer, { type: 'buyMarketListing', args: [gunOffer.id] })).body.result.ok).toBe(true);
    const deliveredGun = buyer.snapshot.state.weapons.find(weapon => !buyerGunIds.has(weapon.id) && weapon.weaponId === spare.weaponId)!;
    expect(deliveredGun).toBeDefined(); expect(deliveredGun.id).not.toBe(originalGun.id);
    expect(deliveredGun.durability).toBe(originalGun.durability); expect(deliveredGun.foundAt).toBe(originalGun.foundAt);
    for (const [slot, part] of Object.entries(originalGun.modules)) {
      const deliveredPart = deliveredGun.modules[slot as keyof typeof deliveredGun.modules]!;
      expect(originalPartIds).not.toContain(deliveredPart.id); expect({ ...deliveredPart, id: part.id }).toEqual(part);
    }
    expect((await action(service, owner, { type: 'craftGear', args: ['light_vest'] })).body.result.ok).toBe(true);
    const originalGear = structuredClone(owner.snapshot.state.gearItems.at(-1)!);
    const gearOffer = await list(service, owner, { kind: 'gear', id: originalGear.id, quantity: 1 }, 70);
    expect((await action(service, buyer, { type: 'buyMarketListing', args: [gearOffer.id] })).body.result.ok).toBe(true);
    const deliveredGear = buyer.snapshot.state.gearItems.at(-1)!; expect(deliveredGear.id).not.toBe(originalGear.id); expect({ ...deliveredGear, id: originalGear.id }).toEqual(originalGear);
    seed(path, owner, state => {
      const item = { id: `loot-${state.nextId++}`, modelId: 'duct-tape', foundAt: NOW };
      (state.lootItems ??= []).push(item); ensureShelterLogistics(state).kits.maintenance = 2;
    }); await state(service, owner);
    const originalLoot = structuredClone(owner.snapshot.state.lootItems![0]!);
    const lootOffer = await list(service, owner, { kind: 'loot', id: originalLoot.id, quantity: 1 }, 70);
    expect((await action(service, buyer, { type: 'buyMarketListing', args: [lootOffer.id] })).body.result.ok).toBe(true);
    const deliveredLoot = buyer.snapshot.state.lootItems!.at(-1)!; expect(deliveredLoot.id).not.toBe(originalLoot.id); expect({ ...deliveredLoot, id: originalLoot.id }).toEqual(originalLoot);
    const kitOffer = await list(service, owner, { kind: 'kit', id: 'maintenance', quantity: 2 }, 70);
    expect(ensureShelterLogistics(owner.snapshot.state).kits.maintenance).toBe(0);
    expect((await action(service, buyer, { type: 'buyMarketListing', args: [kitOffer.id] })).body.result.ok).toBe(true);
    expect(ensureShelterLogistics(buyer.snapshot.state).kits.maintenance).toBe(2);
    expect(parseSave(saveGame(buyer.snapshot.state))).not.toBeNull();
  });

  test('a full buyer or seller warehouse rolls back the complete transfer while keeping escrow available', async () => {
    const path = await disk(), { service } = setup(path), owner = await client(service), buyer = await client(service);
    const offer = await list(service, owner, { kind: 'supply', id: 'ammo', quantity: 5 }, 99);
    seed(path, buyer, state => { state.supplies.ammo = getSupplyCapacity(state).ammo - 2; }); await state(service, buyer);
    const buyerBefore = structuredClone(buyer.snapshot);
    const failedBuy = await action(service, buyer, { type: 'buyMarketListing', args: [offer.id] });
    expect(failedBuy.body.result.ok).toBe(false); expect(buyer.snapshot.state).toEqual(buyerBefore.state); expect(buyer.snapshot.revision).toBe(buyerBefore.revision);
    seed(path, owner, state => { state.supplies.ammo = getSupplyCapacity(state).ammo; }); await state(service, owner);
    const ownerBefore = structuredClone(owner.snapshot);
    expect((await action(service, owner, { type: 'cancelMarketListing', args: [offer.id] })).body.result.ok).toBe(false);
    expect(owner.snapshot.state).toEqual(ownerBefore.state); expect((await market(service, owner)).mine[0]!.status).toBe('active');
    seed(path, owner, state => { state.supplies.ammo -= 5; }); await state(service, owner);
    expect((await action(service, owner, { type: 'cancelMarketListing', args: [offer.id] })).body.result.ok).toBe(true);
    expect(owner.snapshot.state.supplies.ammo).toBe(getSupplyCapacity(owner.snapshot.state).ammo);
    expect(owner.snapshot.state.money).toBe(638);
    expect((await action(service, owner, { type: 'cancelMarketListing', args: [offer.id] })).body.result.ok).toBe(false);
    expect((await market(service, buyer)).offers).toHaveLength(0);
  });

  test('strict commands reject supplied asset data, clocks, fees, seller ids and invalid prices before any charge', async () => {
    const { service } = setup(), owner = await client(service), before = structuredClone(owner.snapshot), ref = { kind: 'module', id: before.state.modules[0]!.id, quantity: 1 };
    for (const command of [
      { type: 'listMarketItem', args: [{ ...ref, asset: before.state.modules[0] }, 100] },
      { type: 'listMarketItem', args: [{ ...ref, seller: 'someone' }, 100] },
      { type: 'listMarketItem', args: [{ ...ref, guidePrice: 1 }, 100] },
      { type: 'listMarketItem', args: [{ ...ref, quantity: 0 }, 100] },
      { type: 'listMarketItem', args: [{ ...ref, quantity: 1.5 }, 100] },
      { type: 'listMarketItem', args: [ref, 0] }, { type: 'listMarketItem', args: [ref, -1] },
      { type: 'listMarketItem', args: [ref, 1.1] }, { type: 'listMarketItem', args: [ref, 1_000_001] },
      { type: 'listMarketItem', args: [ref, 100, NOW + 1] }, { type: 'listMarketItem', args: [ref, 100], paid: 0 },
      { type: 'buyMarketListing', args: ['listing', 1] }, { type: 'claimMarketSale', args: ['listing', 999999] },
    ]) {
      expect(() => readGameCommand(command)).toThrow();
      expect((await service.fetch(request('action', owner, { revision: 0, command })))!.status).toBe(400);
    }
    expect((await service.fetch(request('action', owner, { revision: 0, command: { type: 'listMarketItem', args: [ref, 100] } }, { origin: 'https://evil.test' })))!.status).toBe(403);
    expect((await service.fetch(request('market')))!.status).toBe(401);
    const other = await client(service), spoof = { ...other, snapshot: owner.snapshot };
    expect((await service.fetch(request('market', spoof)))!.status).toBe(401);
    expect(await state(service, owner)).toEqual(before.state);
    const assigned = before.state.weapons.find(weapon => before.state.scavs.some(scav => scav.weaponInstanceId === weapon.id))!;
    expect((await action(service, owner, { type: 'listMarketItem', args: [{ kind: 'weapon', id: assigned.id, quantity: 1 }, 100] })).body.result.ok).toBe(false);
    expect((await action(service, owner, { type: 'listMarketItem', args: [{ kind: 'module', id: ref.id, quantity: 2 }, 100] })).body.result.ok).toBe(false);
    expect(owner.snapshot.state).toEqual(before.state);
  });

  test('a last remaining gun cannot be escrowed even after all scav assignments are removed', async () => {
    const path = await disk(), { service } = setup(path), owner = await client(service);
    seed(path, owner, state => { const spare = state.weapons.at(-1)!; state.scavs.forEach(scav => { scav.weaponInstanceId = null; }); state.weapons = [spare]; });
    await state(service, owner); const before = structuredClone(owner.snapshot);
    expect((await action(service, owner, { type: 'listMarketItem', args: [{ kind: 'weapon', id: owner.snapshot.state.weapons[0]!.id, quantity: 1 }, 100] })).body.result.ok).toBe(false);
    expect(owner.snapshot.state).toEqual(before.state); expect((await market(service, owner)).offers).toHaveLength(0);
  });

  test('a payout that exceeds wallet bounds remains claimable and cannot be lost by a failed claim', async () => {
    const path = await disk(), { service } = setup(path), owner = await client(service), buyer = await client(service);
    const offer = await list(service, owner, { kind: 'supply', id: 'ammo', quantity: 1 }, 100);
    expect((await action(service, buyer, { type: 'buyMarketListing', args: [offer.id] })).body.result.ok).toBe(true);
    seed(path, owner, state => { state.money = 1e15; }); await state(service, owner);
    const revision = owner.snapshot.revision;
    expect((await action(service, owner, { type: 'claimMarketSale', args: [offer.id] })).body.result.ok).toBe(false);
    expect(owner.snapshot.state.money).toBe(1e15); expect(owner.snapshot.revision).toBe(revision); expect((await market(service, owner)).receivables).toBe(95);
    seed(path, owner, state => { state.money -= 100; }); await state(service, owner);
    expect((await action(service, owner, { type: 'claimMarketSale', args: [offer.id] })).body.result.ok).toBe(true);
    expect(owner.snapshot.state.money).toBe(1e15 - 5); expect((await market(service, owner)).receivables).toBe(0);
  });

  test('market snapshots expose no private identities or future game state and reject tampered fees or receipts', async () => {
    const { service } = setup(), owner = await client(service), buyer = await client(service);
    await list(service, owner, { kind: 'supply', id: 'ammo', quantity: 2 }, 101);
    const snapshot = await market(service, buyer), wire = JSON.stringify(snapshot);
    expect(wire).not.toContain('guest:'); expect(wire).not.toContain('account:'); expect(wire).not.toContain('outcomeSeed'); expect(wire).not.toContain('rng');
    expect(snapshot.offers[0]!.owner).toBe(false); expect(snapshot.mine).toHaveLength(0);
    for (const edit of [
      (value: MarketSnapshot) => { value.offers[0]!.listingFee = 0; },
      (value: MarketSnapshot) => { value.offers[0]!.proceeds += 1; },
      (value: MarketSnapshot) => { value.offers[0]!.claimable = true; },
      (value: MarketSnapshot) => { value.offers[0]!.soldAt = NOW; },
      (value: MarketSnapshot) => { (value.offers[0]!.asset as { quantity: number }).quantity = -1; },
      (value: MarketSnapshot) => { value.offers.push(value.offers[0]!); },
    ]) { const tampered = structuredClone(snapshot); edit(tampered); expect(() => readMarketSnapshot(tampered)).toThrow(); }
  });

  test('six active slots and upfront fees create a real cost even when an offer is cancelled', async () => {
    const { service } = setup(), owner = await client(service);
    for (let index = 0; index < 6; index++) await list(service, owner, { kind: 'supply', id: 'ammo', quantity: 1 }, 1);
    expect(owner.snapshot.state.money).toBe(634); expect(owner.snapshot.state.supplies.ammo).toBe(18);
    expect((await action(service, owner, { type: 'listMarketItem', args: [{ kind: 'supply', id: 'ammo', quantity: 1 }, 1] })).body.result.ok).toBe(false);
    const offers = await market(service, owner); expect(offers.mine.filter(item => item.status === 'active')).toHaveLength(6);
    expect((await action(service, owner, { type: 'cancelMarketListing', args: [offers.mine[0]!.id] })).body.result.ok).toBe(true);
    expect(owner.snapshot.state.money).toBe(634); expect(owner.snapshot.state.supplies.ammo).toBe(19);
    expect(getMarketFees(1)).toEqual({ listingFee: 1, commission: 1, proceeds: 0 });
    expect(getMarketFees(1_000_000)).toEqual({ listingFee: 20_000, commission: 50_000, proceeds: 950_000 });
  });

  test('guest token cleanup retains active escrow and unpaid proceeds but can clean fully closed histories', async () => {
    const path = await disk(), { service, setTime } = setup(path), activeOwner = await client(service), soldOwner = await client(service), closedOwner = await client(service), buyer = await client(service);
    const activeOffer = await list(service, activeOwner, { kind: 'supply', id: 'ammo', quantity: 1 }, 100);
    const soldOffer = await list(service, soldOwner, { kind: 'supply', id: 'ammo', quantity: 1 }, 100);
    await action(service, buyer, { type: 'buyMarketListing', args: [soldOffer.id] });
    const closedOffer = await list(service, closedOwner, { kind: 'supply', id: 'ammo', quantity: 1 }, 100);
    await action(service, closedOwner, { type: 'cancelMarketListing', args: [closedOffer.id] });
    const db = new Database(path);
    try { db.query('UPDATE authoritative_guests SET expires_at=?').run(NOW); } finally { db.close(); }
    setTime(NOW + 60_001); expect((await service.fetch(request('market', buyer)))!.status).toBe(401);
    const inspect = new Database(path, { readonly: true });
    try {
      expect(inspect.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM authoritative_guests').get()!.count).toBe(0);
      expect(inspect.query<{ status: string }, [string]>('SELECT status FROM authoritative_market WHERE id=?').get(activeOffer.id)!.status).toBe('active');
      expect(inspect.query<{ proceeds: number }, [string]>('SELECT proceeds FROM authoritative_market WHERE id=?').get(soldOffer.id)!.proceeds).toBe(95);
      expect(inspect.query('SELECT id FROM authoritative_market WHERE id=?').get(closedOffer.id)).toBeNull();
      expect(inspect.query('SELECT id FROM authoritative_games WHERE id=?').get(activeOwner.snapshot.identity.id)).not.toBeNull();
      expect(inspect.query('SELECT id FROM authoritative_games WHERE id=?').get(soldOwner.snapshot.identity.id)).not.toBeNull();
      expect(inspect.query('SELECT id FROM authoritative_games WHERE id=?').get(closedOwner.snapshot.identity.id)).toBeNull();
      expect(service.healthy()).toBe(true);
    } finally { inspect.close(); }
  });
});
