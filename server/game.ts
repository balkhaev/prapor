import { Database } from 'bun:sqlite';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as engine from '../src/game/engine';
import type { AccountService } from './accounts';
import type { GameActionSnapshot, GameCommand, GameCommandType, GameIdentity, GameSnapshot } from '../src/game/commands';

export interface GameOptions {
  dbPath: string; secureCookies?: boolean; allowedOrigins?: string[];
  accounts?: Pick<AccountService, 'resolveLiveIdentity'>; now?: () => number;
  /** Injectable private entropy for deterministic tests; production always uses crypto randomness. */
  outcomeSeed?: () => number;
}
export interface GameService {
  fetch(request: Request, clientAddress?: string): Promise<Response | null>;
  healthy(): boolean; close(): void;
}
interface GameRow { identity: string; id: string; name: string; state: string; revision: number }
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
const COMMAND_RULES: Record<GameCommandType, Rule[]> = {
  excavateShelter: [coord, rowCoord], buildRoom: [choose(...Object.keys(engine.ROOM_DEFINITIONS)), coord, rowCoord], upgradeRoom: [id],
  assignWorker: [id, nullableId], queueModuleProduction: [id, id], setRoomRecipe: [id, nullableId, bool], cancelProduction: [id, id],
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
  if (value.args.length !== rules.length || !rules.every((rule, index) => rule((value.args as unknown[])[index]))) throw new GameError(400, 'invalid_command');
  if (value.type === 'setLoadoutOption' && (value.args[1] === 'medkit' ? typeof value.args[2] !== 'boolean' : typeof value.args[2] !== 'string')) throw new GameError(400, 'invalid_command');
  if (value.type === 'markAchievementsSeen' && !(value.args[0] as string[]).every(id => engine.ACHIEVEMENTS.some(achievement => achievement.id === id))) throw new GameError(400, 'invalid_command');
  return value as unknown as GameCommand;
}
function execute(state: engine.GameState, command: GameCommand, now: number): engine.ActionResult {
  if (command.type === 'markAchievementsSeen') {
    engine.markAchievementsSeen(state, command.args[0] as engine.AchievementId[]);
    return { ok: true, message: 'Нашивки просмотрены.' };
  }
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
    CREATE INDEX IF NOT EXISTS authoritative_guest_expiry ON authoritative_guests(expires_at);`);
  const read = db.query<GameRow, [string]>('SELECT identity,id,name,state,revision FROM authoritative_games WHERE identity=?');
  const update = db.query('UPDATE authoritative_games SET state=?,revision=?,name=? WHERE identity=?');
  const guests = db.query<{ identity: string; name: string }, [string, number]>('SELECT g.identity,p.name FROM authoritative_guests g JOIN authoritative_games p ON p.identity=g.identity WHERE g.token_hash=? AND g.expires_at>?');
  let closed = false, lastCleanup = now();
  const limits = new Map<string, { count: number; expires: number }>();
  const limit = (key: string, max: number, window = 60_000) => {
    const time = now();
    if (time - lastCleanup >= 60_000) {
      for (const [key, bucket] of limits) if (bucket.expires <= time) limits.delete(key);
      db.transaction(() => { db.query('DELETE FROM authoritative_guests WHERE expires_at<=?').run(time); db.query("DELETE FROM authoritative_games WHERE identity LIKE 'guest:%' AND identity NOT IN (SELECT identity FROM authoritative_guests)").run(); })();
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
    if (encoded !== before || action) { snapshot.revision++; update.run(encoded, snapshot.revision, identity.name, identity.key); }
  };
  return { fetch: async (request, clientAddress = 'unknown') => {
    const url = new URL(request.url), path = url.pathname;
    if (path !== '/api/game' && !path.startsWith('/api/game/')) return null;
    try {
      if (closed) throw new GameError(503, 'service_unavailable');
      if (!hosts.has(url.host)) throw new GameError(403, 'host_not_allowed');
      const method = path === '/api/game/state' ? 'GET' : ['/api/game/join', '/api/game/action'].includes(path) ? 'POST' : null;
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
      const body = await readJson(request);
      if (!exact(body, ['revision', 'command']) || !Number.isSafeInteger(body.revision) || (body.revision as number) < 0) throw new GameError(400, 'invalid_request');
      const command = readGameCommand(body.command); limit(`action:${previous.row.id}`, 120);
      const outcome = db.transaction(() => {
        const { identity, row } = current(request); if (row.id !== previous.row.id) throw new GameError(401, 'game_identity_changed');
        const { snapshot, before } = advanceRow(row, identity);
        if (body.revision !== row.revision) { persistSnapshot(identity, snapshot, before); return { conflict: true as const, snapshot }; }
        const result = execute(snapshot.state, command, snapshot.serverNow);
        persistSnapshot(identity, snapshot, before, result.ok);
        return { conflict: false as const, snapshot: { ...snapshot, result } satisfies GameActionSnapshot };
      })();
      return outcome.conflict ? reply({ code: 'revision_conflict', snapshot: publicSnapshot(outcome.snapshot) }, 409) : reply(publicSnapshot(outcome.snapshot));
    } catch (error) { if (error instanceof GameError) return reply({ code: error.code }, error.status, error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {}); console.error('Authoritative game request failed:', error); return reply({ code: 'service_unavailable' }, 503); }
  }, healthy: () => { try { return !closed && Boolean(db.query('SELECT 1 AS ready').get()); } catch { return false; } }, close: () => { if (!closed) { closed = true; db.close(); } } };
}
