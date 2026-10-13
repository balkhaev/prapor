import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameService, type GameService } from '../server/game';
import { createLiveService, getLiveLootPool, type LiveService } from '../server/live';
import { LiveEconomyError, type EconomyLoot, type LiveDelivery } from '../server/live-economy';
import { getModuleCapacity, getTradeAssetRow, parseSave, saveGame, type GameState } from '../src/game/engine';
import { getLiveLootDefinition, getLiveLootWeight, readEconomyLoot, readEconomyLootItems } from '../src/game/live-loot';
import { getLiveLootFamilyOdds, getLiveModuleLootPool, rollLiveLootModel } from '../src/game/live-physical-loot';
import { getLiveMap } from '../src/game/live-maps';
import { MAP_BY_ID } from '../src/game/data';
import { RECEIVER_INFO } from '../src/game/modules';
import type { GameSnapshot } from '../src/game/commands';

const NOW = 1_792_000_000_000, ORIGIN = 'http://live-physical.test';
const services: Array<GameService | LiveService> = [], folders: string[] = [];
afterEach(async () => { services.splice(0).forEach(service => service.close()); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
const named = (modelId = 'coffee'): EconomyLoot => ({ id: randomUUID(), modelId, foundAt: NOW - 1000 });
const physical = (kind: 'gear' | 'module', modelId: string, durability = 73): EconomyLoot => ({ id: randomUUID(), kind, modelId, foundAt: NOW - 2000, durability });
function random(seed: number) { let value = seed; return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 4294967296; }; }
interface Client { cookie: string; snapshot: GameSnapshot }
function request(path: string, player?: Client, body?: unknown) {
  return new Request(`${ORIGIN}/api/game/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: {
    ...(body === undefined ? {} : { origin: ORIGIN, 'content-type': 'application/json' }),
    ...(player ? { cookie: player.cookie, 'x-prapor-game': player.snapshot.identity.id } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function disk() { const folder = await mkdtemp(join(tmpdir(), 'prapor-live-physical-')); folders.push(folder); return join(folder, 'game.sqlite'); }
function setup(path: string) { const service = createGameService({ dbPath: path, secureCookies: false, allowedOrigins: [ORIGIN], now: () => NOW }); services.push(service); return service; }
async function client(service: GameService): Promise<Client> {
  const response = (await service.fetch(request('join', undefined, {})))!; expect(response.status).toBe(200);
  return { cookie: response.headers.get('set-cookie')!.split(';')[0]!, snapshot: await response.json() as GameSnapshot };
}
async function state(service: GameService, player: Client) { const response = (await service.fetch(request('state', player)))!; expect(response.status).toBe(200); player.snapshot = await response.json() as GameSnapshot; return player.snapshot; }
function seed(path: string, player: Client, change: (state: GameState) => void) {
  const db = new Database(path);
  try { const row = db.query<{ state: string }, [string]>('SELECT state FROM authoritative_games WHERE id=?').get(player.snapshot.identity.id)!;
    const value = parseSave(row.state)!; change(value); const encoded = saveGame(value); expect(parseSave(encoded)).not.toBeNull(); db.query('UPDATE authoritative_games SET state=? WHERE id=?').run(encoded, player.snapshot.identity.id);
  } finally { db.close(); }
}

describe('typed live physical trophies', () => {
  test('strict sources preserve old named records and typed condition, reject wrong models and use real inventory price formulas', () => {
    const old = named(), gear = physical('gear', 'padded_vest'), module = physical('module', 'factory-sks-stock');
    expect(readEconomyLootItems([old, gear, module], 32, 12)).toEqual([old, gear, module]);
    expect(readEconomyLoot({ ...old, kind: 'loot' })).toEqual({ ...old, kind: 'loot' });
    for (const item of [gear, module]) {
      const view = getLiveLootDefinition(item); expect(view.condition).toBe(73); expect(view.autoSell).toBe(false);
      const asset = item.kind === 'gear' ? { kind: 'gear' as const, item: { id: 'gear-1', modelId: item.modelId, durability: item.durability } }
        : { kind: 'module' as const, item: { id: 'module-1', modelId: item.modelId, durability: item.kind === 'module' ? item.durability : 73, foundAt: item.foundAt } };
      const price = getTradeAssetRow(asset); expect(view.weight).toBe(price.weight); expect(view.guidePrice).toBe(price.guidePrice); expect(view.traderPrice).toBe(price.traderPrice);
    }
    for (const invalid of [
      { ...gear, modelId: 'coffee' }, { ...module, modelId: 'padded_vest' }, { ...gear, durability: 0 }, { ...gear, durability: 101 },
      { ...module, durability: 1.5 }, { ...gear, guidePrice: 9999 }, { ...module, legacyAttachments: { optic: 3 } },
      { ...old, durability: 73 }, { ...old, kind: 'weapon' }, { ...module, foundAt: NaN }, { ...module, id: 'module-1' },
    ]) expect(() => readEconomyLoot(invalid)).toThrow();
    expect(() => readEconomyLootItems([module, { ...module }], 32, 12)).toThrow();
    expect(() => readEconomyLootItems([physical('gear', 'heavy_armor'), physical('gear', 'heavy_armor')], 32, 12)).toThrow();
  });

  test('module pools follow real receiver compatibility and danger tiers; specialist medical containers keep their purpose', () => {
    for (const mapId of ['courtyard', 'bunker']) for (const entry of getLiveModuleLootPool(mapId, 3)) {
      const model = entry.model, weapons = MAP_BY_ID[mapId]!.weapons;
      expect(model.slot === 'receiver' ? weapons.includes(model.weaponId!) : weapons.some(id => {
        const receiver = RECEIVER_INFO[id]!; return (model.platforms.includes('*') || model.platforms.includes(receiver.platform)) && (model.calibers.includes('*') || model.calibers.includes(receiver.caliber));
      })).toBe(true);
    }
    expect(getLiveModuleLootPool('courtyard', 1).every(entry => entry.model.lootTier <= 1)).toBe(true);
    expect(getLiveModuleLootPool('bunker', 3).some(entry => entry.model.lootTier === 4)).toBe(true);
    const world = getLiveMap('perimeter'), medical = world.containers.find(anchor => anchor.lootTable === 'medical')!;
    const pool = getLiveLootPool('perimeter', medical), rng = random(7919), medicalKinds: string[] = [], mixedKinds: string[] = [];
    let actualMedicine = 0;
    for (let index = 0; index < 2000; index++) {
      const item = rollLiveLootModel('reserve', 'combat', 3, pool, rng, getLiveLootFamilyOdds('medical'));
      const kind = item.kind ?? 'loot'; medicalKinds.push(kind);
      if (getLiveLootDefinition({ id: randomUUID(), foundAt: NOW, ...item }).category === 'medicine') actualMedicine++;
      mixedKinds.push(rollLiveLootModel('reserve', 'combat', 3, pool, rng).kind ?? 'loot');
    }
    expect(medicalKinds.filter(kind => kind !== 'loot').length / 2000).toBeLessThan(.08); expect(actualMedicine / 2000).toBeGreaterThan(.7);
    expect(mixedKinds.filter(kind => kind === 'gear').length / 2000).toBeGreaterThan(.1);
    expect(mixedKinds.filter(kind => kind === 'module').length / 2000).toBeGreaterThan(.2);
  });

  test('all capacity families block a mixed parcel atomically, then real gear and modules arrive once with exact source condition and dates', async () => {
    const path = await disk(), service = setup(path), player = await client(service), owner = service.liveEconomy.resolve(request('state', player));
    seed(path, player, value => {
      value.gearItems = Array.from({ length: 28 }, () => ({ id: `gear-${value.nextId++}`, modelId: 'canvas_pack', durability: 100 }));
      value.modules = Array.from({ length: getModuleCapacity(value) }, () => ({ id: `module-${value.nextId++}`, modelId: 'factory-sks-stock', durability: 100, foundAt: NOW }));
    }); await state(service, player); const before = structuredClone(player.snapshot);
    const module = physical('module', 'factory-sks-stock', 77), gear = physical('gear', 'padded_vest', 65);
    const parcel: LiveDelivery = { id: randomUUID(), owner: owner.key, gameId: owner.gameId, createdAt: NOW, money: 7, items: [gear, module, named('perfume'), named('broken-phone')] };
    expect(service.liveEconomy.deliver(parcel).ok).toBe(false); expect(await state(service, player)).toEqual(before);
    seed(path, player, value => { value.gearItems.pop(); }); await state(service, player); const moduleFull = structuredClone(player.snapshot);
    expect(service.liveEconomy.deliver(parcel).ok).toBe(false); expect(await state(service, player)).toEqual(moduleFull);
    seed(path, player, value => { value.modules.pop(); }); await state(service, player); const available = structuredClone(player.snapshot);
    const receipt = service.liveEconomy.deliver(parcel); expect(receipt.ok).toBe(true); const after = await state(service, player);
    expect(after.state.gearItems.at(-1)).toEqual({ id: `gear-${available.state.nextId}`, modelId: 'padded_vest', durability: 65 });
    expect(after.state.modules.at(-1)).toEqual({ id: `module-${available.state.nextId + 1}`, modelId: 'factory-sks-stock', durability: 77, foundAt: module.foundAt });
    expect(after.state.lootItems!.map(item => item.modelId)).toEqual(['perfume']); expect(after.state.money).toBe(available.state.money + 16);
    expect(after.revision).toBe(available.revision + 1); expect(receipt.message).toContain('(65%)'); expect(receipt.message).toContain('(77%)');
    service.close(); const restored = setup(path); expect(restored.liveEconomy.deliver(parcel)).toEqual(receipt); expect(await state(restored, player)).toEqual(after);
    try { restored.liveEconomy.deliver({ ...parcel, id: randomUUID(), items: [{ id: gear.id, modelId: 'coffee', foundAt: gear.foundAt }] }); throw new Error('Reused source accepted'); }
    catch (error) { expect(error).toBeInstanceOf(LiveEconomyError); expect((error as LiveEconomyError).code).toBe('live_item_already_delivered'); }
    expect(await state(restored, player)).toEqual(after);
  });

  test('newly generated paired hardware never exceeds a whole bag limit and stored typed drops survive restart', async () => {
    const path = await disk(); let step = 0;
    // Repeatedly ask for two gear items, favouring the last eligible item (deep pools end in a 6.5 kg frame).
    const draws = [.5, 0, .01, .999999, .5, .01, .999999, .5], opts = { dbPath: path, secureCookies: false, allowedOrigins: [ORIGIN], now: () => NOW, automaticTicks: false,
      random: () => draws[step++ % draws.length]!, economy: { resolve: () => { throw new Error('No test player'); }, deliver: () => ({ ok: true, message: 'accepted' }), supply: () => ({ ammo: 0, medkits: 0, message: 'none' }) } };
    const live = createLiveService(opts); services.push(live);
    const readDrops = () => { const db = new Database(path, { readonly: true }); try { return (JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state) as { drops: { items: EconomyLoot[] }[] }).drops; } finally { db.close(); } };
    const drops = readDrops(); expect(drops.length).toBeGreaterThan(0);
    expect(drops.every(drop => drop.items.length >= 1 && drop.items.reduce((sum, item) => sum + getLiveLootWeight(item), 0) <= 12)).toBe(true);
    expect(drops.some(drop => drop.items.length === 1 && getLiveLootWeight(drop.items[0]!) > 6)).toBe(true);
    live.close(); const restarted = createLiveService(opts); services.push(restarted); expect(readDrops()).toEqual(drops);
  });
});
