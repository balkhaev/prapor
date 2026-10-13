import { Database } from "bun:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LIVE_CAPACITY, LIVE_SERVER_ID, LIVE_SERVER_NAME, type LiveCommand, type LiveDrop, type LiveEntity, type LiveEvent, type LivePlayer, type LivePoint, type LiveSnapshot, type LiveStatus, type LiveWorld } from "../src/game/live";
import type { AccountService } from "./accounts";

export interface LiveOptions {
  dbPath: string;
  secureCookies?: boolean;
  allowedOrigins?: string[];
  accounts?: Pick<AccountService, "resolveLiveIdentity">;
  now?: () => number;
  random?: () => number;
  /** Tests drive the same simulation explicitly, without background timers. */
  automaticTicks?: boolean;
}
export interface LiveService {
  fetch(request: Request, clientAddress?: string): Promise<Response | null>;
  tick(): void;
  healthy(): boolean;
  close(): void;
}
interface Participant extends LiveEntity, LivePlayer {
  identity: string;
  online: boolean;
  heartbeat: number;
  destination: LivePoint | null;
  nextMove: number;
  nextAttack: number;
}
interface Scav extends LiveEntity { respawnAt: number; nextMove: number; nextAttack: number }
interface Drop extends LiveDrop { expiresAt: number }
const TICK_MS = 250, HEARTBEAT_MS = 15_000, RESPAWN_MS = 10_000, COOKIE_SECONDS = 30 * 24 * 60 * 60;
const WORLD: LiveWorld = {
  width: 32, height: 24,
  obstacles: [
    { x: 7, y: 4, width: 4, height: 4 }, { x: 16, y: 3, width: 3, height: 6 },
    { x: 23, y: 6, width: 5, height: 3 }, { x: 4, y: 13, width: 5, height: 4 },
    { x: 12, y: 12, width: 6, height: 3 }, { x: 22, y: 15, width: 4, height: 5 },
  ],
  extracts: [{ x: 2, y: 2 }, { x: 29, y: 21 }],
};
const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
const distance = (a: LivePoint, b: LivePoint): number => Math.hypot(a.x - b.x, a.y - b.y);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (body: Record<string, unknown>, keys: string[]): boolean => Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body, key));
const walkable = ({ x, y }: LivePoint): boolean => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < WORLD.width && y < WORLD.height && !WORLD.obstacles.some(wall => x >= wall.x && x < wall.x + wall.width && y >= wall.y && y < wall.y + wall.height);

class LiveError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryAfter?: number) { super(code); }
}
function response(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY", "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", ...extra,
  } });
}
async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("content-type") ?? "")) throw new LiveError(415, "json_required");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 1024)) throw new LiveError(413, "body_too_large");
  if (!request.body) throw new LiveError(400, "invalid_json");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > 1024) { try { await reader.cancel(); } catch { /* Intake is already rejected. */ } throw new LiveError(413, "body_too_large"); }
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (error instanceof LiveError) throw error;
    throw new LiveError(400, "invalid_json");
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!isObject(value)) throw new Error("object_required");
    return value;
  } catch { throw new LiveError(400, "invalid_json"); }
}
function commandFrom(body: Record<string, unknown>): LiveCommand {
  if (typeof body.type !== "string") throw new LiveError(400, "invalid_command");
  if (body.type === "move" && exactKeys(body, ["type", "x", "y"]) && typeof body.x === "number" && typeof body.y === "number" && walkable({ x: body.x, y: body.y })) return { type: "move", x: body.x, y: body.y };
  if (body.type === "attack" && exactKeys(body, ["type", "targetId"]) && typeof body.targetId === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(body.targetId)) return { type: "attack", targetId: body.targetId };
  if (body.type === "loot" && exactKeys(body, ["type", "id"]) && typeof body.id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(body.id)) return { type: "loot", id: body.id };
  if (body.type === "patrol" && exactKeys(body, ["type", "enabled"]) && typeof body.enabled === "boolean") return { type: "patrol", enabled: body.enabled };
  if (["heal", "extract", "respawn"].includes(body.type) && exactKeys(body, ["type"])) return { type: body.type as "heal" | "extract" | "respawn" };
  throw new LiveError(400, "invalid_command");
}

export function readLiveOptions(env: Record<string, string | undefined>, accounts?: LiveOptions["accounts"]): LiveOptions {
  const production = env.NODE_ENV === "production";
  return {
    dbPath: env.LIVE_DB_PATH ?? (process.platform === "win32" && !production ? "F:/AI/prapor/live.sqlite" : "/app/data/live.sqlite"),
    secureCookies: production, accounts,
    allowedOrigins: (env.APP_ORIGINS ?? (production ? "https://game.delopusk.ru,https://game.balkhaev.com" : "http://localhost:3020,http://127.0.0.1:3020,http://localhost:3000,http://127.0.0.1:3000")).split(",").map(value => value.trim()).filter(Boolean),
  };
}

/** One authoritative, persistent world. Browsers submit intents, never simulation state. */
export function createLiveService(options: LiveOptions): LiveService {
  const now = options.now ?? Date.now, random = options.random ?? Math.random, secure = options.secureCookies ?? true;
  const cookieName = secure ? "__Host-prapor_live" : "prapor_live";
  const origins = new Set(options.allowedOrigins ?? ["https://game.delopusk.ru", "https://game.balkhaev.com"]), hosts = new Set<string>();
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol) || secure && url.protocol !== "https:") throw new Error("APP_ORIGINS must contain complete permitted origins");
    hosts.add(url.host);
  }
  if (!origins.size) throw new Error("APP_ORIGINS must not be empty");
  if (options.dbPath !== ":memory:") { mkdirSync(dirname(options.dbPath), { recursive: true, mode: 0o700 }); }
  const db = new Database(options.dbPath, { create: true });
  if (options.dbPath !== ":memory:" && process.platform !== "win32") chmodSync(options.dbPath, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS live_players(identity TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS live_guests(token_hash TEXT PRIMARY KEY, identity TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS live_guest_expiry ON live_guests(expires_at);
    CREATE TABLE IF NOT EXISTS live_world(id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL);`);
  const players = new Map<string, Participant>(), scavs = new Map<string, Scav>(), drops = new Map<string, Drop>();
  let startedAt = now(), events: LiveEvent[] = [], closed = false, failed = false, lastSave = now(), lastTick = now(), lastCleanup = now();
  const readGuest = db.query<{ identity: string }, [string, number]>("SELECT identity FROM live_guests WHERE token_hash=? AND expires_at>?");
  const savePlayer = db.query("INSERT INTO live_players(identity,state) VALUES(?,?) ON CONFLICT(identity) DO UPDATE SET state=excluded.state");
  const saveWorld = db.query("INSERT INTO live_world(id,state) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state");
  const readPlayer = db.query<{ state: string }, [string]>("SELECT state FROM live_players WHERE identity=?");
  const loadPlayer = (identity: string): Participant | undefined => {
    const row = readPlayer.get(identity);
    if (!row) return undefined;
    const player = JSON.parse(row.state) as Participant;
    if (player.identity !== identity || !walkable(player)) throw new Error("Invalid stored live player");
    player.online = false; player.destination = null; player.patrol = false; player.action = player.health <= 0 ? "downed" : "idle";
    return player;
  };
  const stored = db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get();
  if (stored) {
    const world = JSON.parse(stored.state) as { startedAt: number; scavs: Scav[]; drops: Drop[]; events: LiveEvent[] };
    startedAt = world.startedAt;
    for (const scav of world.scavs) scavs.set(scav.id, scav);
    for (const drop of world.drops) if (drop.expiresAt > now()) drops.set(drop.id, drop);
    events = world.events.slice(-40);
  }
  const event = (kind: LiveEvent["kind"], text: string, actorId?: string, targetId?: string): void => {
    events.push({ id: randomUUID(), at: now(), kind, text, ...(actorId ? { actorId } : {}), ...(targetId ? { targetId } : {}) });
    events = events.slice(-40);
  };
  const occupied = (point: LivePoint, exceptId?: string): boolean => [...players.values(), ...scavs.values()].some(entity => entity.id !== exceptId && entity.health > 0 && (!("online" in entity) || entity.online) && entity.x === point.x && entity.y === point.y);
  const clear = (point: LivePoint, exceptId?: string): boolean => walkable(point) && !occupied(point, exceptId);
  const pickPoint = (spawn = false): LivePoint => {
    const points: LivePoint[] = [];
    for (let y = 0; y < WORLD.height; y++) for (let x = 0; x < WORLD.width; x++) {
      const point = { x, y };
      if (clear(point) && (!spawn || WORLD.extracts.some(exit => distance(point, exit) <= 4))) points.push(point);
    }
    return points[Math.min(points.length - 1, Math.floor(random() * points.length))] ?? { x: 0, y: 0 };
  };
  const publicEntity = (entity: LiveEntity): LiveEntity => ({ id: entity.id, kind: entity.kind, name: entity.name, appearance: entity.appearance, health: entity.health, action: entity.action, safeUntil: entity.safeUntil, x: entity.x, y: entity.y });
  const persist = (): void => {
    db.transaction(() => {
      for (const player of players.values()) savePlayer.run(player.identity, JSON.stringify(player));
      saveWorld.run(JSON.stringify({ startedAt, scavs: [...scavs.values()], drops: [...drops.values()], events }));
    })();
    lastSave = now();
  };
  const spawnScav = (index: number): Scav => ({ ...pickPoint(), id: `scav-${index}`, kind: "scav", name: ["Косой", "Бродяга", "Шрам", "Лис", "Глухарь", "Рыжий"][index % 6]!, appearance: index % 32, health: 100, action: "idle", safeUntil: 0, respawnAt: 0, nextMove: now() + 750, nextAttack: 0 });
  if (!scavs.size) for (let index = 0; index < 12; index++) scavs.set(`scav-${index}`, spawnScav(index));
  const addDrop = (point: LivePoint, amount: number): void => {
    const id = randomUUID();
    drops.set(id, { id, x: point.x, y: point.y, amount, expiresAt: now() + 120_000 });
  };
  if (!drops.size) for (let index = 0; index < 10; index++) addDrop(pickPoint(), 10 + Math.floor(random() * 21));
  const status = (): LiveStatus => ({ id: LIVE_SERVER_ID, name: LIVE_SERVER_NAME, online: [...players.values()].filter(player => player.online).length, capacity: LIVE_CAPACITY, startedAt });
  const snapshot = (player: Participant): LiveSnapshot => ({
    server: status(), now: now(), world: WORLD, selfId: player.id,
    self: { id: player.id, ammo: player.ammo, medkits: player.medkits, cargo: player.cargo, stash: player.stash, kills: player.kills, respawnAt: player.respawnAt, patrol: player.patrol },
    entities: [...players.values()].filter(player => player.online).map(publicEntity).concat([...scavs.values()].map(publicEntity)),
    drops: [...drops.values()].map(drop => ({ id: drop.id, x: drop.x, y: drop.y, amount: drop.amount })), events,
  });
  const lineOfSight = (a: LivePoint, b: LivePoint): boolean => {
    const steps = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 4;
    for (let index = 1; index < steps; index++) {
      if (!walkable({ x: Math.round(a.x + (b.x - a.x) * index / steps), y: Math.round(a.y + (b.y - a.y) * index / steps) })) return false;
    }
    return true;
  };
  const pathStep = (entity: LiveEntity, destination: LivePoint): LivePoint | null => {
    if (entity.x === destination.x && entity.y === destination.y) return null;
    const key = (point: LivePoint): number => point.y * WORLD.width + point.x;
    const queue: LivePoint[] = [{ x: entity.x, y: entity.y }], parents = new Map<number, LivePoint | null>([[key(entity), null]]);
    let found: LivePoint | null = null;
    for (let index = 0; index < queue.length; index++) {
      const point = queue[index]!;
      if (point.x === destination.x && point.y === destination.y) { found = point; break; }
      for (const next of [{ x: point.x + 1, y: point.y }, { x: point.x - 1, y: point.y }, { x: point.x, y: point.y + 1 }, { x: point.x, y: point.y - 1 }]) {
        if (!clear(next, entity.id) || parents.has(key(next))) continue;
        parents.set(key(next), point); queue.push(next);
      }
    }
    if (!found) return null;
    for (;;) {
      const parent = parents.get(key(found));
      if (!parent || parent.x === entity.x && parent.y === entity.y) return found;
      found = parent;
    }
  };
  const down = (target: Participant | Scav, attacker: Participant | Scav): void => {
    target.health = 0; target.action = "downed"; target.respawnAt = now() + RESPAWN_MS;
    const amount = "cargo" in target ? target.cargo : 25 + Math.floor(random() * 26);
    if (amount > 0) addDrop(target, amount);
    if ("cargo" in target) { target.cargo = 0; target.destination = null; target.patrol = false; }
    if ("kills" in attacker) attacker.kills++;
    event("combat", `${attacker.name} победил ${target.name}.`, attacker.id, target.id);
  };
  const attack = (attacker: Participant | Scav, target: Participant | Scav): void => {
    if (target.health <= 0 || attacker.health <= 0 || target.id === attacker.id || "online" in target && !target.online) throw new LiveError(409, "target_unavailable");
    if (now() < target.safeUntil) throw new LiveError(409, "spawn_protection");
    if (distance(attacker, target) > (attacker.kind === "player" ? 7 : 5) || !lineOfSight(attacker, target)) throw new LiveError(409, "target_out_of_range");
    if (attacker.nextAttack > now()) throw new LiveError(429, "action_cooldown", 1);
    if ("ammo" in attacker && attacker.ammo <= 0) throw new LiveError(409, "no_ammo");
    if ("ammo" in attacker) { attacker.ammo--; attacker.destination = null; }
    attacker.safeUntil = 0; attacker.nextAttack = now() + (attacker.kind === "player" ? 900 : 1500); attacker.action = "combat";
    target.health = Math.max(0, target.health - (attacker.kind === "player" ? 25 : 15));
    if (target.health <= 0) down(target, attacker);
    else event("combat", `${attacker.name} стреляет в ${target.name}.`, attacker.id, target.id);
  };
  const loot = (player: Participant, id: string): void => {
    const drop = drops.get(id);
    if (!drop || drop.expiresAt <= now()) throw new LiveError(409, "loot_unavailable");
    if (distance(player, drop) > 1.5) throw new LiveError(409, "loot_out_of_range");
    if (player.cargo + drop.amount > 500) throw new LiveError(409, "cargo_full");
    drops.delete(id); player.cargo += drop.amount;
    event("loot", `${player.name} забрал груз: ${drop.amount}.`, player.id);
  };
  const respawn = (player: Participant): void => {
    if (player.health > 0) throw new LiveError(409, "already_alive");
    if (player.respawnAt > now()) throw new LiveError(409, "respawn_not_ready");
    const point = pickPoint(true);
    player.x = point.x; player.y = point.y; player.health = 100; player.ammo = 60; player.medkits = 2; player.cargo = 0;
    player.respawnAt = 0; player.safeUntil = now() + 5000; player.destination = null; player.action = "idle"; player.nextAttack = 0;
    event("respawn", `${player.name} вернулся на Периметр.`, player.id);
  };
  const limits = new Map<string, { count: number; expires: number }>();
  const limit = (key: string, maximum: number, windowMs = 60_000): void => {
    const time = now();
    if (time - lastCleanup >= 60_000) {
      for (const [key, value] of limits) if (value.expires <= time) limits.delete(key);
      db.query("DELETE FROM live_guests WHERE expires_at<=?").run(time);
      db.query("DELETE FROM live_players WHERE identity LIKE 'guest:%' AND identity NOT IN (SELECT identity FROM live_guests)").run();
      lastCleanup = time;
    }
    let bucket = limits.get(key);
    if (!bucket || bucket.expires <= time) {
      if (!bucket && limits.size >= 10_000) throw new LiveError(429, "rate_limited", 60);
      bucket = { count: 0, expires: time + windowMs }; limits.set(key, bucket);
    }
    if (++bucket.count > maximum) throw new LiveError(429, "rate_limited", Math.max(1, Math.ceil((bucket.expires - time) / 1000)));
  };
  const expire = (): void => {
    for (const player of players.values()) if (player.online && now() - player.heartbeat >= HEARTBEAT_MS) {
      player.online = false; player.destination = null; player.patrol = false; player.action = player.health > 0 ? "idle" : "downed";
      event("leave", `${player.name} потерял связь.`, player.id);
    }
    for (const [identity, player] of players) if (!player.online && now() - player.heartbeat >= 60_000) {
      savePlayer.run(identity, JSON.stringify(player)); players.delete(identity);
    }
  };
  const nearestTarget = (entity: LiveEntity): Participant | Scav | undefined => {
    const targets: Array<Participant | Scav> = entity.kind === "player"
      ? [...scavs.values()].filter(scav => scav.health > 0)
      : [...players.values()].filter(player => player.online && player.health > 0 && player.safeUntil <= now());
    return targets.sort((a, b) => distance(entity, a) - distance(entity, b))[0];
  };
  const simulate = (): void => {
    expire();
    for (const drop of drops.values()) if (drop.expiresAt <= now()) drops.delete(drop.id);
    while (drops.size < 10) addDrop(pickPoint(), 10 + Math.floor(random() * 21));
    for (const scav of scavs.values()) {
      if (scav.health <= 0) {
        if (scav.respawnAt <= now()) { Object.assign(scav, spawnScav(Number(scav.id.slice(5)))); event("respawn", `${scav.name} появился в районе.`, scav.id); }
        continue;
      }
      const target = nearestTarget(scav);
      scav.action = "idle";
      if (target && distance(scav, target) <= 5 && lineOfSight(scav, target)) {
        if (scav.nextAttack <= now()) attack(scav, target);
        scav.action = "combat";
      } else if (scav.nextMove <= now()) {
        const destination = target && distance(scav, target) <= 11 ? target : pickPoint();
        // Target's occupied tile is never entered; approach a free adjacent tile instead.
        const goal = target === destination ? [{ x: target.x + 1, y: target.y }, { x: target.x - 1, y: target.y }, { x: target.x, y: target.y + 1 }, { x: target.x, y: target.y - 1 }].filter(point => clear(point, scav.id)).sort((a, b) => distance(scav, a) - distance(scav, b))[0] : destination;
        const step = goal ? pathStep(scav, goal) : null;
        if (step) { scav.x = step.x; scav.y = step.y; scav.action = "moving"; }
        scav.nextMove = now() + 750;
      }
    }
    for (const player of players.values()) {
      if (!player.online || player.health <= 0) continue;
      if (player.action === "combat" && player.nextAttack <= now()) player.action = "idle";
      if (player.patrol) {
        const target = nearestTarget(player);
        if (target && distance(player, target) <= 7 && lineOfSight(player, target) && player.ammo > 0) {
          if (player.nextAttack <= now()) attack(player, target);
          continue;
        }
        const drop = [...drops.values()].filter(drop => drop.amount + player.cargo <= 500).sort((a, b) => distance(player, a) - distance(player, b))[0];
        if (drop && distance(player, drop) <= 1.5) { loot(player, drop.id); player.destination = null; }
        if (!player.destination) player.destination = drop ?? pickPoint();
      }
      if (player.destination && player.nextMove <= now()) {
        const step = pathStep(player, player.destination);
        if (step) { player.x = step.x; player.y = step.y; player.action = "moving"; }
        else { player.destination = null; player.action = "idle"; }
        if (player.destination?.x === player.x && player.destination.y === player.y) { player.destination = null; player.action = "idle"; }
        player.nextMove = now() + 350;
      }
    }
  };
  const tick = (): void => {
    if (closed || failed) return;
    try {
      if (now() - lastTick >= TICK_MS) { simulate(); lastTick = now(); }
      if (now() - lastSave >= 1000) persist();
    } catch (error) { failed = true; console.error("Live simulation stopped after a storage or simulation error:", error); }
  };
  const tokenFrom = (request: Request): string | null => {
    const cookies = (request.headers.get("cookie") ?? "").split(";").map(cookie => cookie.trim()).filter(cookie => cookie.startsWith(`${cookieName}=`));
    if (cookies.length !== 1) return null;
    const token = cookies[0]!.slice(cookieName.length + 1);
    return /^[a-zA-Z0-9_-]{43}$/.test(token) ? token : null;
  };
  const identityFrom = (request: Request): { identity: string; name?: string } | null => {
    const account = options.accounts?.resolveLiveIdentity(request);
    const assertedAccount = request.headers.get("x-prapor-account");
    if (account) {
      if (assertedAccount !== account.id) throw new LiveError(401, "account_changed");
      return { identity: `account:${account.id}`, name: account.name };
    }
    if (assertedAccount) throw new LiveError(401, "account_changed");
    const token = tokenFrom(request), guest = token ? readGuest.get(hashToken(token), now()) : null;
    return guest ? { identity: guest.identity } : null;
  };
  const currentPlayer = (request: Request): Participant => {
    const identity = identityFrom(request), player = identity ? players.get(identity.identity) : null;
    if (!player || !player.online) throw new LiveError(401, "join_required");
    if (request.headers.get("x-prapor-live") !== player.id) throw new LiveError(401, "live_identity_changed");
    return player;
  };
  const doCommand = (player: Participant, command: LiveCommand): void => {
    if (command.type === "respawn") { respawn(player); return; }
    if (player.health <= 0) throw new LiveError(409, "player_downed");
    if (command.type === "move") { player.destination = { x: command.x, y: command.y }; player.patrol = false; }
    if (command.type === "attack") {
      const target = [...players.values(), ...scavs.values()].find(target => target.id === command.targetId);
      if (!target) throw new LiveError(409, "target_unavailable");
      attack(player, target); player.patrol = false;
    }
    if (command.type === "loot") loot(player, command.id);
    if (command.type === "heal") {
      if (player.health >= 100) throw new LiveError(409, "already_healthy");
      if (player.medkits <= 0) throw new LiveError(409, "no_medkits");
      player.medkits--; player.health = Math.min(100, player.health + 45);
    }
    if (command.type === "extract") {
      if (!WORLD.extracts.some(exit => distance(player, exit) <= 1.5)) throw new LiveError(409, "extract_out_of_range");
      if (player.cargo <= 0) throw new LiveError(409, "no_cargo");
      const amount = player.cargo; player.stash += amount; player.cargo = 0; player.ammo = 60; player.medkits = 2;
      player.destination = null; player.patrol = false;
      event("extract", `${player.name} сохранил груз: ${amount}.`, player.id);
    }
    if (command.type === "patrol") { player.patrol = command.enabled; player.destination = null; }
  };
  const fetchApi = async (request: Request, clientAddress = "unknown"): Promise<Response | null> => {
    const url = new URL(request.url), path = url.pathname;
    if (path !== "/api/live" && !path.startsWith("/api/live/")) return null;
    try {
      if (closed || failed) throw new LiveError(503, "service_unavailable");
      if (!hosts.has(url.host)) throw new LiveError(403, "host_not_allowed");
      const method = ["/api/live/status", "/api/live/state"].includes(path) ? "GET" : ["/api/live/join", "/api/live/action", "/api/live/leave"].includes(path) ? "POST" : null;
      if (!method) return response({ code: "not_found" }, 404);
      if (request.method !== method) return response({ code: "method_not_allowed" }, 405, { Allow: method });
      const ipKey = hashToken(clientAddress);
      limit(`api:${ipKey}`, 6000);
      if (request.method === "POST" && (!origins.has(request.headers.get("origin") ?? "") || request.headers.get("sec-fetch-site") === "cross-site")) throw new LiveError(403, "origin_not_allowed");
      expire();
      if (path === "/api/live/status") return response(status());
      if (path === "/api/live/join") {
        const body = await readJson(request);
        if (!exactKeys(body, [])) throw new LiveError(400, "invalid_request");
        limit(`join:${ipKey}`, 120);
        let identity = identityFrom(request), token: string | undefined;
        let player = identity ? players.get(identity.identity) ?? loadPlayer(identity.identity) : undefined;
        if (!player?.online && status().online >= LIVE_CAPACITY) throw new LiveError(503, "server_full");
        if (!identity) {
          limit(`guest:${ipKey}`, 12, 60 * 60_000);
          token = randomBytes(32).toString("base64url"); identity = { identity: `guest:${randomUUID()}` };
          db.query("INSERT INTO live_guests(token_hash,identity,expires_at) VALUES(?,?,?)").run(hashToken(token), identity.identity, now() + COOKIE_SECONDS * 1000);
        }
        if (!player) {
          const id = randomUUID(), point = pickPoint(true);
          player = { id, ...point, kind: "player", identity: identity.identity, name: identity.name ?? `Дикий ${id.slice(0, 4).toUpperCase()}`, appearance: Math.floor(random() * 32),
            health: 100, safeUntil: now() + 5000, action: "idle", ammo: 60, medkits: 2, cargo: 0, stash: 0, kills: 0, respawnAt: 0, patrol: false,
            online: false, heartbeat: now(), destination: null, nextMove: 0, nextAttack: 0 };
          players.set(player.identity, player);
        }
        players.set(player.identity, player);
        if (identity.name) player.name = identity.name;
        if (!player.online) {
          if (player.health > 0 && occupied(player, player.id)) { const point = pickPoint(true); player.x = point.x; player.y = point.y; }
          event("join", `${player.name} вышел на Периметр.`, player.id);
        }
        player.online = true; player.heartbeat = now(); persist();
        return response(snapshot(player), 200, token ? { "Set-Cookie": `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_SECONDS}${secure ? "; Secure" : ""}` } : {});
      }
      const player = currentPlayer(request);
      limit(`player:${player.id}`, 600);
      if (path === "/api/live/state") { player.heartbeat = now(); return response(snapshot(player)); }
      const body = await readJson(request);
      // Re-read identity after asynchronous body intake; logout or recovery revokes old requests.
      if (currentPlayer(request).id !== player.id) throw new LiveError(401, "live_identity_changed");
      player.heartbeat = now();
      if (path === "/api/live/leave") {
        if (!exactKeys(body, [])) throw new LiveError(400, "invalid_request");
        player.online = false; player.destination = null; player.patrol = false; player.action = player.health > 0 ? "idle" : "downed";
        event("leave", `${player.name} покинул Периметр.`, player.id); persist(); return response({ ok: true });
      }
      limit(`action:${player.id}`, 180);
      doCommand(player, commandFrom(body)); persist();
      return response(snapshot(player));
    } catch (error) {
      if (error instanceof LiveError) return response({ code: error.code }, error.status, error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {});
      failed = true; console.error("Live request failed:", error); return response({ code: "service_unavailable" }, 503);
    }
  };
  persist();
  const timer = options.automaticTicks === false ? undefined : setInterval(tick, TICK_MS);
  timer?.unref();
  return { fetch: fetchApi, tick, healthy: () => { try { return !closed && !failed && Boolean(db.query("SELECT 1 AS ready").get()); } catch { return false; } }, close: () => {
    if (closed) return;
    if (timer) clearInterval(timer);
    try { if (!failed) persist(); } finally { closed = true; db.close(); }
  } };
}
