import { Database } from 'bun:sqlite';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as engine from '../src/game/engine';
import { creditMarketMoney, getTradeQuote, parseTradeAsset, receiveTradeAsset, takeTradeAsset } from '../src/game/trade';
import type { TradeRef } from '../src/game/trade';
import { getMarketCommission, getMarketListingFee, MARKET_MAX_ACTIVE, MARKET_MAX_PRICE } from '../src/game/flea';
import type { MarketListing, MarketSnapshot } from '../src/game/flea';
import type { AccountService } from './accounts';
import type { GameActionSnapshot, GameCommand, GameCommandType, GameIdentity, GameSnapshot } from '../src/game/commands';
import { LOOT_MODEL_BY_ID } from '../src/game/loot';
import { LIVE_LOOT_CAPACITY, LIVE_LOOT_WEIGHT } from '../src/game/live';
import { LiveEconomyError, type LiveDelivery, type LiveEconomy, type LiveSupplyRequest, type LiveSupplyReceipt } from './live-economy';

export interface GameOptions {
  dbPath: string; secureCookies?: boolean; allowedOrigins?: string[];
  accounts?: Pick<AccountService, 'resolveLiveIdentity'>; now?: () => number;
  /** Injectable private entropy for deterministic tests; production always uses crypto randomness. */
  outcomeSeed?: () => number;
}
export interface GameService {
  fetch(request: Request, clientAddress?: string): Promise<Response | null>;
  /** Private bridge used by the live simulation; no HTTP reward endpoint exists. */
  liveEconomy: LiveEconomy;
  healthy(): boolean; close(): void;
}
interface GameRow { identity: string; id: string; name: string; state: string; revision: number }
interface MarketRow {
  id: string; owner: string; buyer: string | null; asset: string; label: string; guide_price: number;
  price: number; listing_fee: number; commission: number; proceeds: number; created_at: number;
  status: MarketListing['status']; sold_at: number | null; claimed_at: number | null;
}
type Identity = { key: string; kind: GameIdentity['kind']; name: string };
type Rule = (value: unknown) => boolean;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const id: Rule = value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,160}$/.test(value);
const nullableId: Rule = value => value === null || id(value);
const bool: Rule = value => typeof value === 'boolean';
const integer = (min: number, max: number): Rule => value => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const choose = (...values: string[]): Rule => value => typeof value === 'string' && values.includes(value);
const ids = (max: number, min = 0): Rule => value => Array.isArray(value) && value.length >= min && value.length <= max && value.every(id) && new Set(value).size === value.length;
const coord = integer(-engine.SHELTER_COORDINATE_LIMIT, engine.SHELTER_COORDINATE_LIMIT), rowCoord = integer(0, engine.SHELTER_COORDINATE_LIMIT);
const slot = choose(...engine.MODULE_SLOTS);
const gear = choose('armor', 'backpack', 'helmet');
const fieldKit = choose(...Object.keys(engine.FIELD_KITS));
const tradeRef: Rule = value => object(value) && exact(value, ['kind', 'id', 'quantity'])
  && choose('loot', 'weapon', 'module', 'gear', 'supply', 'kit')(value.kind) && id(value.id) && integer(1, 1_000_000)(value.quantity);
const productionReserve: Rule = value => {
  if (!object(value) || !exact(value, ['money', 'supplies']) || !integer(0, 1e9)(value.money) || !object(value.supplies)) return false;
  return exact(value.supplies, ['ammo', 'medicine', 'scrap', 'intel']) && Object.values(value.supplies).every(integer(0, 1e6));
};
const COMMAND_RULES: Record<GameCommandType, Rule[]> = {
  listMarketItem: [tradeRef, integer(1, MARKET_MAX_PRICE)], buyMarketListing: [id], cancelMarketListing: [id], claimMarketSale: [id],
  sellLootItem: [id], recycleLootItem: [id],
  barterGear: [id, ids(16, 1)], claimLootDelivery: [id],
  excavateShelter: [coord, rowCoord], buildRoom: [choose(...Object.keys(engine.ROOM_DEFINITIONS)), coord, rowCoord, integer(0, 1)], upgradeRoom: [id],
  moveRoom: [id, coord, rowCoord, integer(0, 1)], rotateRoom: [id],
  assignWorker: [id, nullableId], queueModuleProduction: [id, id], setRoomRecipe: [id, nullableId, bool], cancelProduction: [id, id],
  setProductionReserve: [productionReserve], setRoomStockTarget: [id, value => value === null || integer(0, 1e6)(value)],
  setFieldKit: [id, choose('none', ...Object.keys(engine.FIELD_KITS))], queueFieldKitProduction: [id, fieldKit],
  installModule: [id, id], removeModule: [id, slot], assembleWeapon: [id], disassembleWeapon: [id], sellModule: [id], recycleModule: [id], repairModule: [id],
  buySupplies: [id], craftGear: [id], equipGear: [id, gear, nullableId], repairGear: [id], recycleGear: [id],
  setLoadoutOption: [id, choose('ammoType', 'medkit'), value => typeof value === 'boolean' || engine.isAmmoType(value)],
  upgradeScavGear: [id, choose('armor', 'backpack')], setRaidTactic: [id, choose(...Object.keys(engine.TACTICS))], setRaidPlan: [id, choose(...Object.keys(engine.RAID_OBJECTIVES)), choose(...Object.keys(engine.RAID_PREPARATIONS))], setAutoRaidDepth: [id, integer(1, 3)],
  setAutoRaid: [id, nullableId, integer(25, 100)], stopAllAutoRaids: [], dispatchRaid: [id, id], dispatchSquadRaid: [ids(3, 2), id], equipWeapon: [id, nullableId],
  refreshRecruitment: [], hireRecruitCandidate: [id], dismissScav: [id], chooseScavTalent: [id, id],
  upgradeBase: [choose('workshop', 'medbay', 'radio', 'storage')], repairWeapon: [id], sellWeapon: [id], recycleWeapon: [id],
  healScav: [id], claimContract: [id], continueExpedition: [id, choose(...Object.keys(engine.EXPEDITION_BRANCHES)), choose(...Object.keys(engine.RUN_PERKS))], extractRaid: [id],
  resolveScavPersonalEvent: [id, id, id], resolveSocialEvent: [id, id], markAchievementsSeen: [ids(64)],
};
class GameError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryAfter?: number) { super(code); }
}
export function readGameCommand(value: unknown): GameCommand {
  if (!object(value) || !exact(value, ['type', 'args']) || typeof value.type !== 'string' || !Object.hasOwn(COMMAND_RULES, value.type) || !Array.isArray(value.args)) throw new GameError(400, 'invalid_command');
  const rules = COMMAND_RULES[value.type as GameCommandType];
  const optionalRotation = (value.type === 'buildRoom' || value.type === 'moveRoom') && value.args.length === 3;
  if ((!optionalRotation && value.args.length !== rules.length) || !rules.slice(0, value.args.length).every((rule, index) => rule((value.args as unknown[])[index]))) throw new GameError(400, 'invalid_command');
  if (value.type === 'setLoadoutOption' && (value.args[1] === 'medkit' ? typeof value.args[2] !== 'boolean' : typeof value.args[2] !== 'string')) throw new GameError(400, 'invalid_command');
  if (value.type === 'markAchievementsSeen' && !(value.args[0] as string[]).every(id => engine.ACHIEVEMENTS.some(achievement => achievement.id === id))) throw new GameError(400, 'invalid_command');
  return value as unknown as GameCommand;
}
function execute(state: engine.GameState, command: GameCommand, now: number): engine.ActionResult {
  if (command.type === 'listMarketItem' || command.type === 'buyMarketListing' || command.type === 'cancelMarketListing' || command.type === 'claimMarketSale') throw new Error('Market commands require the authoritative escrow transaction');
  if (command.type === 'markAchievementsSeen') {
    engine.markAchievementsSeen(state, command.args[0] as engine.AchievementId[]);
    return { ok: true, message: 'Нашивки просмотрены.' };
  }
  if (command.type === 'buildRoom') return engine.buildRoom(state, command.args[0] as engine.ShelterRoomType, command.args[1], command.args[2], now, command.args[3]);
  if (command.type === 'moveRoom') return engine.moveRoom(state, command.args[0], command.args[1], command.args[2], now, command.args[3]);
  // The own-key whitelist above is the only path to an engine action. Extra clocks are never accepted.
  const action = engine[command.type] as unknown as (state: engine.GameState, ...args: unknown[]) => engine.ActionResult;
  return action(state, ...command.args, now);
}
function reply(value: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", ...extra } });
}
/** Public routes and confirmed findings are retained; private future outcomes are omitted. */
function publicSnapshot<T extends GameSnapshot>(snapshot: T): T {
  const visible = structuredClone(snapshot);
  visible.state.rng = 1;
  for (const raid of visible.state.raids) {
    delete raid.outcomeSeed;
    if (raid.squad) {
      for (const member of raid.squad.members) delete member.outcomeSeed;
      const progress = raid.expedition?.status === 'choice' ? 1 : Math.max(0, Math.min(1, (visible.serverNow - raid.startedAt) / (raid.endsAt - raid.startedAt)));
      raid.squad.actions = raid.squad.actions.filter(action => action.progress <= progress);
    }
  }
  for (const report of visible.state.history) if (report.squad) for (const member of report.squad.members) delete member.outcomeSeed;
  return visible;
}
async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type') ?? '')) throw new GameError(415, 'json_required');
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 4096)) throw new GameError(413, 'body_too_large');
  if (!request.body) throw new GameError(400, 'invalid_json');
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.length;
      if (length > 4096) { await reader.cancel(); throw new GameError(413, 'body_too_large'); }
      chunks.push(chunk.value);
    }
  } catch (error) { if (error instanceof GameError) throw error; throw new GameError(400, 'invalid_json'); }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); if (!object(value)) throw new Error('object_required'); return value; }
  catch { throw new GameError(400, 'invalid_json'); }
}
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const COOKIE_SECONDS = 30 * 24 * 60 * 60;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const timestamp = integer(0, 1e15);
function readLiveDelivery(value: unknown): LiveDelivery {
  if (!object(value) || !exact(value, ['id', 'owner', 'gameId', 'createdAt', 'money', 'items']) || !uuid(value.id) || !id(value.owner) || !uuid(value.gameId)
    || !timestamp(value.createdAt) || !integer(0, 1e9)(value.money) || !Array.isArray(value.items) || value.items.length > LIVE_LOOT_CAPACITY) throw new LiveEconomyError(400, 'invalid_live_delivery');
  const items = value.items.map(item => {
    if (!object(item) || !exact(item, ['id', 'modelId', 'foundAt']) || !uuid(item.id) || typeof item.modelId !== 'string' || !Object.hasOwn(LOOT_MODEL_BY_ID, item.modelId)
      || !timestamp(item.foundAt)) throw new LiveEconomyError(400, 'invalid_live_delivery');
    return { id: item.id, modelId: item.modelId, foundAt: item.foundAt as number };
  });
  if (new Set(items.map(item => item.id)).size !== items.length || items.reduce((sum, item) => sum + LOOT_MODEL_BY_ID[item.modelId]!.weight, 0) > LIVE_LOOT_WEIGHT + 1e-9) throw new LiveEconomyError(400, 'invalid_live_delivery');
  return { id: value.id, owner: value.owner as string, gameId: value.gameId, createdAt: value.createdAt as number, money: value.money as number, items };
}
function readLiveSupply(value: unknown): LiveSupplyRequest {
  if (!object(value) || !exact(value, ['id', 'owner', 'gameId', 'createdAt', 'ammo', 'medkits']) || !uuid(value.id) || !id(value.owner) || !uuid(value.gameId)
    || !timestamp(value.createdAt) || !integer(0, 60)(value.ammo) || !integer(0, 2)(value.medkits)) throw new LiveEconomyError(400, 'invalid_live_supply');
  return { id: value.id, owner: value.owner as string, gameId: value.gameId, createdAt: value.createdAt as number, ammo: value.ammo as number, medkits: value.medkits as number };
}
export function readGameOptions(env: Record<string, string | undefined>, accounts?: GameOptions['accounts']): GameOptions {
  const production = env.NODE_ENV === 'production';
  return { dbPath: env.GAME_DB_PATH ?? (process.platform === 'win32' && !production ? 'F:/AI/prapor/game.sqlite' : '/app/data/game.sqlite'), secureCookies: production, accounts,
    allowedOrigins: (env.APP_ORIGINS ?? (production ? 'https://game.delopusk.ru,https://game.balkhaev.com' : 'http://localhost:3020,http://127.0.0.1:3020,http://localhost:3000,http://127.0.0.1:3000')).split(',').map(value => value.trim()).filter(Boolean) };
}

/** Persistent server state. Legacy browser/cloud documents never enter this database. */
export function createGameService(options: GameOptions): GameService {
  const now = options.now ?? Date.now, secure = options.secureCookies ?? true;
  const cookieName = secure ? '__Host-prapor_game' : 'prapor_game';
  const origins = new Set(options.allowedOrigins ?? ['https://game.delopusk.ru', 'https://game.balkhaev.com']), hosts = new Set<string>();
  for (const origin of origins) { const url = new URL(origin); if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || secure && url.protocol !== 'https:') throw new Error('APP_ORIGINS must contain permitted complete origins'); hosts.add(url.host); }
  if (!origins.size) throw new Error('APP_ORIGINS must not be empty');
  if (options.dbPath !== ':memory:') mkdirSync(dirname(options.dbPath), { recursive: true, mode: 0o700 });
  const db = new Database(options.dbPath, { create: true, strict: true });
  if (options.dbPath !== ':memory:' && process.platform !== 'win32') chmodSync(options.dbPath, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS authoritative_games(identity TEXT PRIMARY KEY,id TEXT NOT NULL UNIQUE,name TEXT NOT NULL,state TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS authoritative_guests(token_hash TEXT PRIMARY KEY,identity TEXT NOT NULL REFERENCES authoritative_games(identity) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS authoritative_guest_expiry ON authoritative_guests(expires_at);
    CREATE TABLE IF NOT EXISTS authoritative_market(
      id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES authoritative_games(identity),buyer TEXT REFERENCES authoritative_games(identity) ON DELETE SET NULL,
      asset TEXT NOT NULL,label TEXT NOT NULL,guide_price INTEGER NOT NULL CHECK(guide_price>=0),
      price INTEGER NOT NULL CHECK(price BETWEEN 1 AND ${MARKET_MAX_PRICE}),listing_fee INTEGER NOT NULL CHECK(listing_fee>=1),
      commission INTEGER NOT NULL CHECK(commission>=1),proceeds INTEGER NOT NULL CHECK(proceeds>=0),created_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','sold','cancelled')),sold_at INTEGER,claimed_at INTEGER);
    CREATE INDEX IF NOT EXISTS authoritative_market_active ON authoritative_market(status,created_at);
    CREATE INDEX IF NOT EXISTS authoritative_market_owner ON authoritative_market(owner,status,claimed_at);
    CREATE TABLE IF NOT EXISTS authoritative_live_links(identity TEXT PRIMARY KEY REFERENCES authoritative_games(identity),game_id TEXT NOT NULL UNIQUE REFERENCES authoritative_games(id),linked_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS authoritative_live_deliveries(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES authoritative_live_links(identity),payload TEXT NOT NULL,receipt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS authoritative_live_items(id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL REFERENCES authoritative_live_deliveries(id));
    CREATE TABLE IF NOT EXISTS authoritative_live_supplies(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES authoritative_live_links(identity),payload TEXT NOT NULL,receipt TEXT NOT NULL);`);
  const read = db.query<GameRow, [string]>('SELECT identity,id,name,state,revision FROM authoritative_games WHERE identity=?');
  const update = db.query('UPDATE authoritative_games SET state=?,revision=?,name=? WHERE identity=?');
  const guests = db.query<{ identity: string; name: string }, [string, number]>('SELECT g.identity,p.name FROM authoritative_guests g JOIN authoritative_games p ON p.identity=g.identity WHERE g.token_hash=? AND g.expires_at>?');
  const marketRow = db.query<MarketRow, [string]>('SELECT * FROM authoritative_market WHERE id=?');
  let closed = false, lastCleanup = now();
  const limits = new Map<string, { count: number; expires: number }>();
  const limit = (key: string, max: number, window = 60_000) => {
    const time = now();
    if (time - lastCleanup >= 60_000) {
      for (const [key, bucket] of limits) if (bucket.expires <= time) limits.delete(key);
      db.transaction(() => {
        db.query('DELETE FROM authoritative_guests WHERE expires_at<=?').run(time);
        // A token can expire; escrow, payments and pending live deliveries must never vanish with it.
        db.query("DELETE FROM authoritative_market WHERE owner LIKE 'guest:%' AND owner NOT IN (SELECT identity FROM authoritative_guests) AND owner NOT IN (SELECT identity FROM authoritative_live_links) AND owner NOT IN (SELECT owner FROM authoritative_market WHERE status='active' OR (status='sold' AND claimed_at IS NULL))").run();
        db.query("DELETE FROM authoritative_games WHERE identity LIKE 'guest:%' AND identity NOT IN (SELECT identity FROM authoritative_guests) AND identity NOT IN (SELECT identity FROM authoritative_live_links) AND identity NOT IN (SELECT owner FROM authoritative_market WHERE status='active' OR (status='sold' AND claimed_at IS NULL))").run();
      })();
      lastCleanup = time;
    }
    let bucket = limits.get(key); if (!bucket || bucket.expires <= time) { if (!bucket && limits.size >= 10_000) throw new GameError(429, 'rate_limited', 60); bucket = { count: 0, expires: time + window }; limits.set(key, bucket); }
    if (++bucket.count > max) throw new GameError(429, 'rate_limited', Math.max(1, Math.ceil((bucket.expires - time) / 1000)));
  };
  const tokenFrom = (request: Request) => {
    const cookies = (request.headers.get('cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${cookieName}=`));
    const token = cookies.length === 1 ? cookies[0]!.slice(cookieName.length + 1) : '';
    return /^[a-zA-Z0-9_-]{43}$/.test(token) ? token : null;
  };
  const identityFrom = (request: Request): Identity | null => {
    const account = options.accounts?.resolveLiveIdentity(request), asserted = request.headers.get('x-prapor-account');
    if (account) { if (asserted !== account.id) throw new GameError(401, 'account_changed'); return { key: `account:${account.id}`, kind: 'account', name: account.name }; }
    if (asserted) throw new GameError(401, 'account_changed');
    const token = tokenFrom(request), guest = token ? guests.get(hash(token), now()) : null;
    return guest ? { key: guest.identity, kind: 'guest', name: guest.name } : null;
  };
  const current = (request: Request): { identity: Identity; row: GameRow } => {
    const identity = identityFrom(request), row = identity ? read.get(identity.key) : null;
    if (!identity || !row) throw new GameError(401, 'join_required');
    if (request.headers.get('x-prapor-game') !== row.id) throw new GameError(401, 'game_identity_changed');
    return { identity, row };
  };
  const advanceRow = (row: GameRow, identity: Identity): { snapshot: GameSnapshot; before: string } => {
    const state = engine.parseSave(row.state); if (!state) throw new Error('Invalid stored authoritative game');
    engine.setGameOutcomeSeedSource(state, options.outcomeSeed ?? (() => randomInt(1, 4294967296)));
    const time = Math.max(state.lastUpdated, now()); engine.advance(state, time);
    return { snapshot: { state, revision: row.revision, serverNow: time, identity: { id: row.id, kind: identity.kind, name: identity.name } }, before: row.state };
  };
  const persistSnapshot = (identity: Identity, snapshot: GameSnapshot, before: string, action = false) => {
    const encoded = engine.saveGame(snapshot.state);
    // Polling advances authoritative time, but only an accepted command consumes a command revision.
    // Every action still reads and validates against the latest complete state inside its transaction.
    if (encoded !== before || action) { if (action) snapshot.revision++; update.run(encoded, snapshot.revision, identity.name, identity.key); }
  };
  const marketAsset = (row: MarketRow) => {
    const asset = parseTradeAsset(JSON.parse(row.asset) as unknown);
    if (!asset) throw new Error('Invalid stored market escrow');
    return asset;
  };
  const publicListing = (row: MarketRow, identity: Identity): MarketListing => ({
    id: row.id, asset: marketAsset(row), label: row.label, guidePrice: row.guide_price, price: row.price,
    listingFee: row.listing_fee, commission: row.commission, proceeds: row.proceeds, createdAt: row.created_at,
    status: row.status, soldAt: row.sold_at, claimedAt: row.claimed_at, owner: row.owner === identity.key,
    claimable: row.owner === identity.key && row.status === 'sold' && row.claimed_at === null,
  });
  const marketSnapshot = (identity: Identity, snapshot: GameSnapshot): MarketSnapshot => ({
    serverNow: snapshot.serverNow, identity: snapshot.identity,
    offers: db.query<MarketRow, []>("SELECT * FROM authoritative_market WHERE status='active' ORDER BY created_at DESC,id LIMIT 200").all().map(row => publicListing(row, identity)),
    mine: db.query<MarketRow, [string]>("SELECT * FROM authoritative_market WHERE owner=? ORDER BY CASE WHEN status='active' THEN 0 WHEN status='sold' AND claimed_at IS NULL THEN 1 ELSE 2 END,created_at DESC,id LIMIT 50").all(identity.key).map(row => publicListing(row, identity)),
    receivables: db.query<{ total: number }, [string]>("SELECT COALESCE(SUM(proceeds),0) AS total FROM authoritative_market WHERE owner=? AND status='sold' AND claimed_at IS NULL").get(identity.key)!.total,
  });
  const validateTransfer = (state: engine.GameState) => {
    if (!engine.parseSave(engine.saveGame(state))) throw new Error('Economy transfer produced an invalid authoritative game');
  };
  const linkedGame = (owner: string, gameId: string) => {
    const link = db.query<{ game_id: string }, [string]>('SELECT game_id FROM authoritative_live_links WHERE identity=?').get(owner), row = read.get(owner);
    if (!link || !row || link.game_id !== gameId || row.id !== gameId) throw new LiveEconomyError(401, 'game_identity_changed');
    const kind = owner.startsWith('account:') ? 'account' as const : 'guest' as const;
    return { row, identity: { key: owner, kind, name: row.name } };
  };
  const liveEconomy: LiveEconomy = {
    resolve(request) {
      try {
        if (closed) throw new LiveEconomyError(503, 'service_unavailable');
        if (!hosts.has(new URL(request.url).host)) throw new LiveEconomyError(403, 'host_not_allowed');
        if (request.method !== 'GET' && (!origins.has(request.headers.get('origin') ?? '') || request.headers.get('sec-fetch-site') === 'cross-site')) throw new LiveEconomyError(403, 'origin_not_allowed');
        return db.transaction(() => {
          const { identity, row } = current(request);
          db.query('INSERT OR IGNORE INTO authoritative_live_links(identity,game_id,linked_at) VALUES(?,?,?)').run(identity.key, row.id, now());
          linkedGame(identity.key, row.id);
          return { key: identity.key, gameId: row.id, name: identity.name };
        })();
      } catch (error) { if (error instanceof GameError) throw new LiveEconomyError(error.status, error.code); throw error; }
    },
    deliver(input) {
      if (closed) throw new LiveEconomyError(503, 'service_unavailable');
      const parcel = readLiveDelivery(input), payload = JSON.stringify(parcel);
      return db.transaction(() => {
        const { identity, row } = linkedGame(parcel.owner, parcel.gameId);
        const previous = db.query<{ payload: string; receipt: string }, [string]>('SELECT payload,receipt FROM authoritative_live_deliveries WHERE id=?').get(parcel.id);
        if (previous) {
          if (previous.payload !== payload) throw new LiveEconomyError(409, 'live_delivery_changed');
          return JSON.parse(previous.receipt) as { ok: boolean; message: string };
        }
        const { snapshot, before } = advanceRow(row, identity), state = structuredClone(snapshot.state);
        for (const item of parcel.items) {
          if (db.query('SELECT id FROM authoritative_live_items WHERE id=?').get(item.id)) throw new LiveEconomyError(409, 'live_item_already_delivered');
          const received = receiveTradeAsset(state, { kind: 'loot', item: { id: 'loot-1', modelId: item.modelId, foundAt: item.foundAt } }, snapshot.serverNow, true);
          if (!received.ok) return { ok: false, message: 'На складе нет места для всей посылки. Освободите место и заберите доставку.' };
          state.lootItems!.at(-1)!.foundAt = item.foundAt;
        }
        const credited = creditMarketMoney(state, parcel.money);
        if (!credited.ok) return { ok: false, message: 'Доставка ждёт свободного места в кошельке.' };
        validateTransfer(state);
        const receipt = { ok: true, message: `На склад доставлено ${parcel.items.length} трофеев${parcel.money ? ` и ${parcel.money} ₽` : ''}.` };
        db.query('INSERT INTO authoritative_live_deliveries(id,owner,payload,receipt) VALUES(?,?,?,?)').run(parcel.id, parcel.owner, payload, JSON.stringify(receipt));
        for (const item of parcel.items) db.query('INSERT INTO authoritative_live_items(id,delivery_id) VALUES(?,?)').run(item.id, parcel.id);
        snapshot.state = state;
        persistSnapshot(identity, snapshot, before, true);
        return receipt;
      })();
    },
    supply(input) {
      if (closed) throw new LiveEconomyError(503, 'service_unavailable');
      const request = readLiveSupply(input), payload = JSON.stringify(request);
      return db.transaction(() => {
        const { identity, row } = linkedGame(request.owner, request.gameId);
        const previous = db.query<{ payload: string; receipt: string }, [string]>('SELECT payload,receipt FROM authoritative_live_supplies WHERE id=?').get(request.id);
        if (previous) {
          if (previous.payload !== payload) throw new LiveEconomyError(409, 'live_supply_changed');
          return JSON.parse(previous.receipt) as LiveSupplyReceipt;
        }
        const { snapshot, before } = advanceRow(row, identity), state = structuredClone(snapshot.state);
        const ammo = Math.min(request.ammo, Math.floor(state.supplies.ammo)), medkits = Math.min(request.medkits, Math.floor(state.supplies.medicine));
        state.supplies.ammo -= ammo; state.supplies.medicine -= medkits;
        validateTransfer(state);
        const receipt: LiveSupplyReceipt = { ammo, medkits, message: ammo || medkits ? `Из убежища взято ${ammo} патронов и ${medkits} аптечек.` : 'На складе нет патронов и аптечек для пополнения.' };
        db.query('INSERT INTO authoritative_live_supplies(id,owner,payload,receipt) VALUES(?,?,?,?)').run(request.id, request.owner, payload, JSON.stringify(receipt));
        snapshot.state = state;
        persistSnapshot(identity, snapshot, before, true);
        return receipt;
      })();
    },
  };
  const executeMarket = (identity: Identity, snapshot: GameSnapshot, command: GameCommand): engine.ActionResult | null => {
    const fail = (message: string): engine.ActionResult => ({ ok: false, message });
    const time = snapshot.serverNow;
    if (command.type === 'listMarketItem') {
      const [ref, price] = command.args;
      const count = db.query<{ total: number }, [string]>("SELECT COUNT(*) AS total FROM authoritative_market WHERE owner=? AND status='active'").get(identity.key)!.total;
      if (count >= MARKET_MAX_ACTIVE) return fail(`На барахолке можно держать ${MARKET_MAX_ACTIVE} объявлений одновременно.`);
      const quote = getTradeQuote(snapshot.state, ref as TradeRef);
      if (quote.reason || !quote.asset) return fail(quote.reason ?? 'Предмет недоступен для продажи.');
      const fee = getMarketListingFee(price);
      if (snapshot.state.money < fee) return fail(`Для объявления нужно ${fee} ₽. Сбор не возвращается.`);
      const state = structuredClone(snapshot.state), taken = takeTradeAsset(state, ref);
      if (!taken.ok || !taken.asset) return taken;
      const asset = parseTradeAsset(taken.asset);
      if (!asset) throw new Error('Invalid verified market asset');
      state.money -= fee; validateTransfer(state);
      const commission = getMarketCommission(price);
      db.query('INSERT INTO authoritative_market(id,owner,asset,label,guide_price,price,listing_fee,commission,proceeds,created_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,\'active\')')
        .run(randomUUID(), identity.key, JSON.stringify(asset), quote.label, quote.guidePrice, price, fee, commission, price - commission, time);
      snapshot.state = state;
      return { ok: true, message: `${quote.label}: объявление за ${price} ₽ размещено. Сбор ${fee} ₽ оплачен.` };
    }
    if (!['buyMarketListing', 'cancelMarketListing', 'claimMarketSale'].includes(command.type)) return null;
    const listing = marketRow.get(command.args[0] as string);
    if (!listing) return fail('Объявление не найдено.');
    if (command.type === 'buyMarketListing') {
      if (listing.owner === identity.key) return fail('Собственное объявление купить нельзя.');
      if (listing.status !== 'active') return fail('Этот предмет уже продан или снят с продажи.');
      if (snapshot.state.money < listing.price) return fail(`Для покупки нужно ${listing.price} ₽.`);
      const state = structuredClone(snapshot.state), received = receiveTradeAsset(state, marketAsset(listing), time, true);
      if (!received.ok) return received;
      state.money -= listing.price; validateTransfer(state);
      const sold = db.query("UPDATE authoritative_market SET status='sold',buyer=?,sold_at=? WHERE id=? AND status='active'").run(identity.key, Math.max(time, listing.created_at), listing.id);
      if (sold.changes !== 1) return fail('Этот предмет уже продан или снят с продажи.');
      snapshot.state = state;
      return { ok: true, message: `${listing.label} куплен за ${listing.price} ₽ и доставлен на склад.` };
    }
    if (listing.owner !== identity.key) return fail('Это чужое объявление.');
    if (command.type === 'cancelMarketListing') {
      if (listing.status !== 'active') return fail('Это объявление уже закрыто.');
      const state = structuredClone(snapshot.state), returned = receiveTradeAsset(state, marketAsset(listing), time, false);
      if (!returned.ok) return returned;
      validateTransfer(state);
      const cancelled = db.query("UPDATE authoritative_market SET status='cancelled' WHERE id=? AND owner=? AND status='active'").run(listing.id, identity.key);
      if (cancelled.changes !== 1) return fail('Это объявление уже закрыто.');
      snapshot.state = state;
      return { ok: true, message: `${listing.label} возвращён на склад. Сбор за объявление не возвращается.` };
    }
    if (listing.status !== 'sold' || listing.claimed_at !== null) return fail('Выручки к получению нет.');
    const state = structuredClone(snapshot.state);
    const credited = creditMarketMoney(state, listing.proceeds);
    if (!credited.ok) return credited;
    validateTransfer(state);
    const claimed = db.query("UPDATE authoritative_market SET claimed_at=? WHERE id=? AND owner=? AND status='sold' AND claimed_at IS NULL").run(Math.max(time, listing.sold_at ?? time), listing.id, identity.key);
    if (claimed.changes !== 1) return fail('Выручка уже получена.');
    snapshot.state = state;
    return { ok: true, message: `Получено ${listing.proceeds} ₽ за ${listing.label}. Комиссия ${listing.commission} ₽ удержана.` };
  };
  return { liveEconomy, fetch: async (request, clientAddress = 'unknown') => {
    const url = new URL(request.url), path = url.pathname;
    if (path !== '/api/game' && !path.startsWith('/api/game/')) return null;
    try {
      if (closed) throw new GameError(503, 'service_unavailable');
      if (!hosts.has(url.host)) throw new GameError(403, 'host_not_allowed');
      const method = ['/api/game/state', '/api/game/market'].includes(path) ? 'GET' : ['/api/game/join', '/api/game/action'].includes(path) ? 'POST' : null;
      if (!method) return reply({ code: 'not_found' }, 404);
      if (request.method !== method) return reply({ code: 'method_not_allowed' }, 405, { Allow: method });
      const ip = hash(clientAddress); limit(`api:${ip}`, 6000);
      if (request.method === 'POST' && (!origins.has(request.headers.get('origin') ?? '') || request.headers.get('sec-fetch-site') === 'cross-site')) throw new GameError(403, 'origin_not_allowed');
      if (path === '/api/game/join') {
        const body = await readJson(request); if (!exact(body, [])) throw new GameError(400, 'invalid_request'); limit(`join:${ip}`, 120);
        let identity = identityFrom(request), token: string | null = null;
        if (!identity) { limit(`guest:${ip}`, 12, 60 * 60_000); token = randomBytes(32).toString('base64url'); identity = { key: `guest:${randomUUID()}`, kind: 'guest', name: 'Гость' }; }
        const joinedIdentity = identity;
        const snapshot = db.transaction(() => {
          let row = read.get(joinedIdentity.key);
          if (!row) {
            const id = randomUUID(), state = engine.createGame(now());
            state.rng = randomInt(1, 4294967296);
            db.query('INSERT INTO authoritative_games(identity,id,name,state) VALUES(?,?,?,?)').run(joinedIdentity.key, id, joinedIdentity.name, engine.saveGame(state)); row = read.get(joinedIdentity.key)!;
          }
          if (token) db.query('INSERT INTO authoritative_guests(token_hash,identity,expires_at) VALUES(?,?,?)').run(hash(token), joinedIdentity.key, now() + COOKIE_SECONDS * 1000);
          const { snapshot, before } = advanceRow(row, joinedIdentity); persistSnapshot(joinedIdentity, snapshot, before); return snapshot;
        })();
        return reply(publicSnapshot(snapshot), 200, token ? { 'Set-Cookie': `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_SECONDS}${secure ? '; Secure' : ''}` } : {});
      }
      const previous = current(request); limit(`player:${previous.row.id}`, 240);
      if (path === '/api/game/state') {
        const snapshot = db.transaction(() => { const { identity, row } = current(request); const { snapshot, before } = advanceRow(row, identity); persistSnapshot(identity, snapshot, before); return snapshot; })();
        return reply(publicSnapshot(snapshot));
      }
      if (path === '/api/game/market') {
        const snapshot = db.transaction(() => { const { identity, row } = current(request); const { snapshot, before } = advanceRow(row, identity); persistSnapshot(identity, snapshot, before); return marketSnapshot(identity, snapshot); })();
        return reply(snapshot);
      }
      const body = await readJson(request);
      if (!exact(body, ['revision', 'command']) || !Number.isSafeInteger(body.revision) || (body.revision as number) < 0) throw new GameError(400, 'invalid_request');
      const command = readGameCommand(body.command); limit(`action:${previous.row.id}`, 120);
      const outcome = db.transaction(() => {
        const { identity, row } = current(request); if (row.id !== previous.row.id) throw new GameError(401, 'game_identity_changed');
        const { snapshot, before } = advanceRow(row, identity);
        if (body.revision !== row.revision) { persistSnapshot(identity, snapshot, before); return { conflict: true as const, snapshot }; }
        const result = executeMarket(identity, snapshot, command) ?? execute(snapshot.state, command, snapshot.serverNow);
        persistSnapshot(identity, snapshot, before, result.ok);
        return { conflict: false as const, snapshot: { ...snapshot, result } satisfies GameActionSnapshot };
      })();
      return outcome.conflict ? reply({ code: 'revision_conflict', snapshot: publicSnapshot(outcome.snapshot) }, 409) : reply(publicSnapshot(outcome.snapshot));
    } catch (error) { if (error instanceof GameError) return reply({ code: error.code }, error.status, error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {}); console.error('Authoritative game request failed:', error); return reply({ code: 'service_unavailable' }, 503); }
  }, healthy: () => { try { return !closed && Boolean(db.query('SELECT 1 AS ready').get()); } catch { return false; } }, close: () => { if (!closed) { closed = true; db.close(); } } };
}
