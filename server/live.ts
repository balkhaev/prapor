import { Database } from "bun:sqlite";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LIVE_CAPACITY, LIVE_LOOT_CAPACITY, LIVE_LOOT_WEIGHT, LIVE_PENDING_CAPACITY, LIVE_SERVER_ID, LIVE_SERVER_NAME, type LiveCommand, type LiveDistrictId, type LiveDrop, type LiveEntity, type LiveEvent, type LiveMapId, type LivePlayer, type LivePoint, type LivePurpose, type LiveSnapshot, type LiveStatus, type LiveWorld } from "../src/game/live";
import { LIVE_MAPS } from "../src/game/live-maps";
import { createLiveNavigation } from "./live-navigation";
import { getRaidLootPool, LOOT_MODEL_BY_ID, type LootModel } from "../src/game/loot";
import type { AccountService } from "./accounts";
import { LiveEconomyError, type EconomyLoot, type LiveDelivery, type LiveEconomy, type LiveEconomyIdentity, type LiveSupplyRequest } from "./live-economy";

export interface LiveOptions {
  dbPath: string;
  secureCookies?: boolean;
  allowedOrigins?: string[];
  accounts?: Pick<AccountService, "resolveLiveIdentity">;
  economy?: LiveEconomy;
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
interface PathCache { path: LivePoint[]; pathGoal: LivePoint | null; replanAt: number }
interface Participant extends LiveEntity, LivePlayer, PathCache {
  mapId: LiveMapId;
  identity: string;
  online: boolean;
  heartbeat: number;
  destination: LivePoint | null;
  nextMove: number;
  nextAttack: number;
  lastCombatAt: number;
  disconnectAt: number;
  searchedDropIds: string[];
  economyOwner?: string;
}
interface Scav extends LiveEntity, PathCache {
  mapId: LiveMapId; faction: "scavs" | "raiders"; role: "patrol" | "guard" | "marksman";
  home: LivePoint; route: LivePoint[]; routeIndex: number; spawnIndex: number;
  respawnAt: number; nextMove: number; nextAttack: number;
}
interface Drop extends LiveDrop { mapId: LiveMapId; expiresAt: number; source?: "supply" | "body" }
interface MapEvent extends LiveEvent { mapId: LiveMapId; point?: LivePoint }
interface EconomyBinding { live_identity: string; owner_key: string; game_id: string }
interface OutboxRow { id: string; identity: string; kind: "delivery" | "supply"; payload: string; message: string }
const TICK_MS = 250, HEARTBEAT_MS = 15_000, RESPAWN_MS = 10_000, COOKIE_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_MAP: LiveMapId = "perimeter", WORLD_VERSION = 3, COMBAT_TRAVEL_MS = 8000, VISION_RADIUS = 24;
const maps = new Map(LIVE_MAPS.map(map => [map.id, map]));
const mapFrom = (id: unknown): LiveMapId | null => typeof id === "string" && maps.has(id as LiveMapId) ? id as LiveMapId : null;
const worldFor = (id: LiveMapId): LiveWorld => {
  const { npcSpawns: _npcs, lootSpawns: _loot, ...world } = maps.get(id)!;
  return world;
};
const navigation = new Map(LIVE_MAPS.map(map => [map.id, createLiveNavigation(map)]));
const districtFrom = (value: unknown): LiveDistrictId | null => ["customs", "sawmill", "depot", "village"].includes(value as string) ? value as LiveDistrictId : null;
const purposeFrom = (value: unknown): LivePurpose | null => ["pvp", "pve", "loot", "quests"].includes(value as string) ? value as LivePurpose : null;
const districtAt = (point: LivePoint): LiveDistrictId => {
  const districts = maps.get(DEFAULT_MAP)!.districts;
  return districts.find(district => point.x >= district.x && point.y >= district.y && point.x < district.x + district.width && point.y < district.y + district.height)?.id
    ?? [...districts].sort((a, b) => Math.hypot(point.x - a.x - a.width / 2, point.y - a.y - a.height / 2) - Math.hypot(point.x - b.x - b.width / 2, point.y - b.y - b.height / 2))[0]!.id;
};
const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
const distance = (a: LivePoint, b: LivePoint): number => Math.hypot(a.x - b.x, a.y - b.y);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (body: Record<string, unknown>, keys: string[]): boolean => Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body, key));
const walkable = (mapId: LiveMapId, { x, y }: LivePoint): boolean => {
  return navigation.get(mapId)!.walkable({ x, y });
};
/** Authored danger zones select the same trophy catalog used by headquarters. */
export function getLiveLootPool(mapId: LiveMapId, point: LivePoint): { model: LootModel; weight: number }[] {
  const world = maps.get(mapId)!;
  const depth = world.zones.filter(zone => point.x >= zone.x && point.x < zone.x + zone.width && point.y >= zone.y && point.y < zone.y + zone.height)
    .reduce((danger, zone) => Math.max(danger, zone.danger), 1);
  const district = districtAt(point);
  const pool = getRaidLootPool(({ customs: "factory", sawmill: "forest", depot: "reserve", village: "forest" } as const)[district],
    ({ customs: "scavenge", sawmill: "recon", depot: "combat", village: "scavenge" } as const)[district], depth);
  const table = world.containers.find(anchor => anchor.x === point.x && anchor.y === point.y)?.lootTable;
  const category = table === "medical" ? "medicine" : table;
  const matching = pool.filter(entry => entry.model.category === category);
  return matching.length ? matching : pool;
}

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
function commandFrom(body: Record<string, unknown>, mapId: LiveMapId): LiveCommand {
  if (typeof body.type !== "string") throw new LiveError(400, "invalid_command");
  if (body.type === "move" && exactKeys(body, ["type", "x", "y"]) && typeof body.x === "number" && typeof body.y === "number" && walkable(mapId, { x: body.x, y: body.y })) return { type: "move", x: body.x, y: body.y };
  if (body.type === "attack" && exactKeys(body, ["type", "targetId"]) && typeof body.targetId === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(body.targetId)) return { type: "attack", targetId: body.targetId };
  if (body.type === "engage" && exactKeys(body, ["type", "targetId"]) && (body.targetId === null || typeof body.targetId === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(body.targetId))) return { type: "engage", targetId: body.targetId };
  if (body.type === "travel" && exactKeys(body, ["type", "mapId"])) {
    const destination = mapFrom(body.mapId);
    if (destination) return { type: "travel", mapId: destination };
  }
  if (["loot", "search"].includes(body.type) && exactKeys(body, ["type", "id"]) && typeof body.id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(body.id)) return { type: body.type as "loot" | "search", id: body.id };
  if (body.type === "patrol" && exactKeys(body, ["type", "enabled"]) && typeof body.enabled === "boolean") return { type: "patrol", enabled: body.enabled };
  if (["heal", "extract", "resupply"].includes(body.type) && exactKeys(body, ["type"])) return { type: body.type as "heal" | "extract" | "resupply" };
  if (body.type === "respawn" && Object.keys(body).every(key => ["type", "districtId", "purpose"].includes(key))
    && (body.districtId === undefined || districtFrom(body.districtId)) && (body.purpose === undefined || purposeFrom(body.purpose)))
    return { type: "respawn", ...(body.districtId ? { districtId: body.districtId as LiveDistrictId } : {}), ...(body.purpose ? { purpose: body.purpose as LivePurpose } : {}) };
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

/** One authoritative server with persistent shared maps. Browsers submit intents, never simulation state. */
export function createLiveService(options: LiveOptions): LiveService {
  const now = options.now ?? Date.now, random = options.random ?? (() => randomInt(0x1_0000_0000) / 0x1_0000_0000), secure = options.secureCookies ?? true;
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
    CREATE TABLE IF NOT EXISTS live_world(id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS live_game_owners(owner_key TEXT PRIMARY KEY, game_id TEXT NOT NULL, live_identity TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS live_economy_outbox(id TEXT PRIMARY KEY, identity TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, message TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS live_outbox_pending ON live_economy_outbox(acknowledged,identity);`);
  if (!db.query<{ name: string }, []>("PRAGMA table_info(live_economy_outbox)").all().some(column => column.name === "attempts"))
    db.exec("ALTER TABLE live_economy_outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
  const players = new Map<string, Participant>(), scavs = new Map<string, Scav>(), drops = new Map<string, Drop>();
  const lootCooldowns = new Map<string, number>();
  const lootKey = (mapId: LiveMapId, point: LivePoint, containerId?: string): string => containerId ? `container:${containerId}` : `${mapId}:${point.x}:${point.y}`;
  const freshPath = (): PathCache => ({ path: [], pathGoal: null, replanAt: 0 });
  const durable = (entity: Participant | Scav): Omit<Participant | Scav, keyof PathCache> => {
    const { path: _path, pathGoal: _goal, replanAt: _replan, ...state } = entity;
    return state;
  };
  const translateLegacy = (point: LivePoint, oldMap: unknown): LivePoint => {
    const districtId = districtFrom(oldMap), district = districtId ? maps.get(DEFAULT_MAP)!.districts.find(item => item.id === districtId) : undefined;
    return district ? { x: point.x + district.x, y: point.y + district.y } : { x: point.x, y: point.y };
  };
  let startedAt = now(), events: MapEvent[] = [], closed = false, failed = false, lastSave = now(), lastTick = now(), lastCleanup = now(), lastEconomy = -Infinity;
  let prepared: OutboxRow[] = [], preparedBindings: EconomyBinding[] = [];
  const byOwner = db.query<EconomyBinding, [string]>("SELECT owner_key,game_id,live_identity FROM live_game_owners WHERE owner_key=?");
  const byLive = db.query<EconomyBinding, [string]>("SELECT owner_key,game_id,live_identity FROM live_game_owners WHERE live_identity=?");
  const pendingRows = db.query<OutboxRow, [string]>("SELECT id,identity,kind,payload,message FROM live_economy_outbox WHERE identity=? AND acknowledged=0 ORDER BY rowid");
  const insertOutbox = db.query("INSERT INTO live_economy_outbox(id,identity,kind,payload,message) VALUES(?,?,?,?,?)");
  const readGuest = db.query<{ identity: string }, [string, number]>("SELECT identity FROM live_guests WHERE token_hash=? AND expires_at>?");
  const savePlayer = db.query("INSERT INTO live_players(identity,state) VALUES(?,?) ON CONFLICT(identity) DO UPDATE SET state=excluded.state");
  const saveWorld = db.query("INSERT INTO live_world(id,state) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state");
  const readPlayer = db.query<{ state: string }, [string]>("SELECT state FROM live_players WHERE identity=?");
  const loadPlayer = (identity: string): Participant | undefined => {
    const row = readPlayer.get(identity);
    if (!row) return undefined;
    const player = JSON.parse(row.state) as Participant;
    if (player.identity !== identity) throw new Error("Invalid stored live player");
    if (player.mapId !== DEFAULT_MAP) Object.assign(player, translateLegacy(player, player.mapId));
    player.mapId = DEFAULT_MAP;
    player.districtId = districtFrom(player.districtId) ?? districtAt(player); player.purpose = purposeFrom(player.purpose) ?? "loot";
    if (!walkable(player.mapId, player)) Object.assign(player, nearestFree(player, player.districtId));
    Object.assign(player, freshPath()); player.searching = null; player.searchedDropIds ??= [];
    const binding = byLive.get(identity);
    if (binding) { player.economyOwner = binding.owner_key; player.gameId = binding.game_id; }
    if (options.economy) player.lootItems ??= [];
    player.targetId = null; player.travelReadyAt ??= 0; player.lastCombatAt ??= 0; player.disconnectAt = 0;
    player.online = false; player.destination = null; player.patrol = false; player.action = player.health <= 0 ? "downed" : "idle";
    return player;
  };
  const event = (mapId: LiveMapId, kind: LiveEvent["kind"], text: string, actorId?: string, targetId?: string, shot?: Pick<LiveEvent, "from" | "to" | "damage">): void => {
    const actor = actorId ? [...players.values(), ...scavs.values()].find(entity => entity.id === actorId) : undefined;
    events.push({ mapId, id: randomUUID(), at: now(), kind, text, ...(actor ? { point: { x: actor.x, y: actor.y } } : {}), ...(actorId ? { actorId } : {}), ...(targetId ? { targetId } : {}), ...shot });
    // Each map keeps its own recent feed, even when another map has a busy battle.
    for (const map of LIVE_MAPS) {
      const local = events.filter(item => item.mapId === map.id);
      if (local.length > 120) { const keep = new Set(local.slice(-120).map(item => item.id)); events = events.filter(item => item.mapId !== map.id || keep.has(item.id)); }
    }
  };
  const occupied = (mapId: LiveMapId, point: LivePoint, exceptId?: string): boolean => [...players.values(), ...scavs.values()].some(entity => entity.mapId === mapId && entity.id !== exceptId && entity.health > 0 && (!("online" in entity) || entity.online) && entity.x === point.x && entity.y === point.y);
  const clear = (mapId: LiveMapId, point: LivePoint, exceptId?: string): boolean => walkable(mapId, point) && !occupied(mapId, point, exceptId);
  const pickPoint = (mapId: LiveMapId, spawn = false, districtId: LiveDistrictId = "customs"): LivePoint => {
    const world = maps.get(mapId)!;
    const points: LivePoint[] = [];
    if (spawn) {
      const seen = new Set<number>();
      for (const anchor of world.districts.find(district => district.id === districtId)!.spawns) for (let y = anchor.y - 4; y <= anchor.y + 4; y++) for (let x = anchor.x - 4; x <= anchor.x + 4; x++) {
        const point = { x, y }, key = navigation.get(mapId)!.key(point);
        if (!seen.has(key) && distance(point, anchor) <= 4 && clear(mapId, point)) { points.push(point); seen.add(key); }
      }
    } else {
      // Random movement is selected from a bounded candidate sample instead of scanning the world per NPC.
      for (let attempt = 0; attempt < 64; attempt++) {
        const point = { x: Math.floor(random() * world.width), y: Math.floor(random() * world.height) };
        if (clear(mapId, point)) { points.push(point); break; }
      }
      if (!points.length) for (let y = 0; y < world.height && !points.length; y++) for (let x = 0; x < world.width && !points.length; x++) if (clear(mapId, { x, y })) points.push({ x, y });
    }
    if (!points.length) {
      if (spawn) return pickPoint(mapId);
      throw new LiveError(503, "server_full");
    }
    const sheltered = spawn ? points.filter(point => ![...scavs.values()].some(scav => scav.mapId === mapId && scav.health > 0 && distance(point, scav) < 8)) : [];
    const choices = sheltered.length ? sheltered : points;
    return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]!;
  };
  const nearestFree = (point: LivePoint, districtId: LiveDistrictId): LivePoint => {
    const world = maps.get(DEFAULT_MAP)!, start = { x: Math.min(world.width - 1, Math.max(0, Math.round(point.x))), y: Math.min(world.height - 1, Math.max(0, Math.round(point.y))) };
    for (let radius = 0; radius <= 16; radius++) for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const candidate = { x: start.x + dx, y: start.y + dy };
      if (clear(DEFAULT_MAP, candidate)) return candidate;
    }
    return pickPoint(DEFAULT_MAP, true, districtId);
  };
  const publicEntity = (entity: LiveEntity): LiveEntity => ({ id: entity.id, kind: entity.kind, name: entity.name, appearance: entity.appearance, health: entity.health, action: entity.action, safeUntil: entity.safeUntil, x: entity.x, y: entity.y, ...(entity.faction ? { faction: entity.faction } : {}), ...(entity.role ? { role: entity.role } : {}) });
  const persist = (): void => {
    db.transaction(() => {
      for (const player of players.values()) savePlayer.run(player.identity, JSON.stringify(durable(player)));
      for (const binding of preparedBindings) db.query("INSERT INTO live_game_owners(owner_key,game_id,live_identity) VALUES(?,?,?)").run(binding.owner_key, binding.game_id, binding.live_identity);
      for (const row of prepared) insertOutbox.run(row.id, row.identity, row.kind, row.payload, row.message);
      saveWorld.run(JSON.stringify({ version: WORLD_VERSION, geometryVersion: maps.get(DEFAULT_MAP)!.version, startedAt, scavs: [...scavs.values()].map(durable), drops: [...drops.values()], events, lootCooldowns: [...lootCooldowns] }));
    })();
    prepared = []; preparedBindings = [];
    lastSave = now();
  };
  const prepare = (player: Participant, kind: OutboxRow["kind"], payload: LiveDelivery | LiveSupplyRequest): void => {
    if (kind === "delivery" && pendingRows.all(player.identity).filter(row => row.kind === "delivery").length + prepared.filter(row => row.identity === player.identity && row.kind === "delivery").length >= LIVE_PENDING_CAPACITY)
      throw new LiveError(409, "delivery_pending_full");
    prepared.push({ id: payload.id, identity: player.identity, kind, payload: JSON.stringify(payload),
      message: kind === "delivery" ? "Груз ожидает место на складе убежища." : "Пополнение ожидает подтверждения убежища." });
  };
  const prepareDelivery = (player: Participant): void => {
    if (!options.economy) { player.stash += player.cargo; player.cargo = 0; return; }
    const money = player.cargo + player.stash, items = player.lootItems ?? [];
    if (!money && !items.length) return;
    if (!player.economyOwner || !player.gameId) throw new LiveError(401, "join_required");
    prepare(player, "delivery", { id: randomUUID(), owner: player.economyOwner, gameId: player.gameId, createdAt: now(), money, items: structuredClone(items) });
    // The parcel and this withdrawal are saved in the same live database transaction.
    player.cargo = 0; player.stash = 0; player.lootItems = [];
  };
  const flushEconomy = (): void => {
    if (!options.economy) return;
    const rows = db.query<OutboxRow, []>("SELECT id,identity,kind,payload,message FROM live_economy_outbox WHERE acknowledged=0 ORDER BY attempts,rowid LIMIT 64").all();
    for (const row of rows) {
      // Rotate failures durably; a full warehouse cannot starve other players' parcels.
      db.query("UPDATE live_economy_outbox SET attempts=attempts+1 WHERE id=? AND acknowledged=0").run(row.id);
      const payload = JSON.parse(row.payload) as LiveDelivery | LiveSupplyRequest;
      let receipt: { ammo: number; medkits: number; message: string } | undefined, message: string;
      try {
        if (row.kind === "delivery") {
          const delivery = options.economy.deliver(payload as LiveDelivery);
          message = delivery.message;
          if (!delivery.ok) { db.query("UPDATE live_economy_outbox SET message=? WHERE id=? AND acknowledged=0").run(message, row.id); continue; }
        } else {
          receipt = options.economy.supply(payload as LiveSupplyRequest); message = receipt.message;
          const requested = payload as LiveSupplyRequest;
          if (!Number.isInteger(receipt.ammo) || !Number.isInteger(receipt.medkits) || receipt.ammo < 0 || receipt.medkits < 0 || receipt.ammo > requested.ammo || receipt.medkits > requested.medkits)
            throw new Error("Invalid headquarters supply receipt");
        }
      } catch (error) {
        // Transport/game availability failures leave the durable parcel for the next tick.
        if (!(error instanceof LiveEconomyError) && !(error instanceof Error)) throw error;
        db.query("UPDATE live_economy_outbox SET message=? WHERE id=? AND acknowledged=0").run("Убежище временно недоступно; груз и запрос сохранены.", row.id);
        continue;
      }
      const loaded = players.get(row.identity), original = loaded ?? loadPlayer(row.identity);
      if (!original) throw new Error("Pending economy owner has no persistent live player");
      const updated = structuredClone(original);
      if (receipt) {
        if (updated.ammo + receipt.ammo > 60 || updated.medkits + receipt.medkits > 2) throw new Error("Supply would exceed live capacity");
        updated.ammo += receipt.ammo; updated.medkits += receipt.medkits;
      }
      updated.economyMessage = message;
      // A retry after an accepted game debit reuses the receipt; applying it and acknowledging it are atomic here.
      db.transaction(() => {
        const changed = db.query("UPDATE live_economy_outbox SET acknowledged=1,message=? WHERE id=? AND acknowledged=0").run(message, row.id);
        if (changed.changes !== 1) throw new Error("Economy parcel changed during acknowledgement");
        savePlayer.run(updated.identity, JSON.stringify(durable(updated)));
      })();
      if (loaded) Object.assign(loaded, updated);
    }
    lastEconomy = now();
  };
  const spawnScav = (mapId: LiveMapId, index: number, id = `scav-${mapId}-${index}`): Scav => {
    const spawn = maps.get(mapId)!.npcSpawns[index % maps.get(mapId)!.npcSpawns.length]!;
    const nearby: LivePoint[] = [];
    if (!clear(mapId, spawn.point, id)) for (let y = spawn.point.y - 4; y <= spawn.point.y + 4; y++) for (let x = spawn.point.x - 4; x <= spawn.point.x + 4; x++) {
      const point = { x, y };
      if (distance(point, spawn.point) <= 4 && clear(mapId, point, id) && !maps.get(mapId)!.extracts.some(exit => distance(exit, point) < 6)) nearby.push(point);
    }
    nearby.sort((a, b) => distance(a, spawn.point) - distance(b, spawn.point));
    const point = clear(mapId, spawn.point, id) ? spawn.point : nearby[0];
    return { ...point, ...freshPath(), mapId, id, kind: "scav", name: spawn.faction === "raiders" ? ["Рейдер Борз", "Рейдер Яр", "Рейдер Туман", "Рейдер Север"][index % 4]! : ["Косой", "Бродяга", "Шрам", "Лис", "Глухарь", "Рыжий"][index % 6]!,
      x: point?.x ?? spawn.point.x, y: point?.y ?? spawn.point.y,
      appearance: (spawn.faction === "raiders" ? 16 : 0) + index % 16, faction: spawn.faction, role: spawn.role,
      home: { ...spawn.point }, route: spawn.route.length ? spawn.route.map(point => ({ ...point })) : [{ ...spawn.point }], routeIndex: Math.max(0, spawn.route.findIndex(point => point.x === spawn.point.x && point.y === spawn.point.y)), spawnIndex: index,
      health: point ? 100 : 0, action: point ? "idle" : "downed", safeUntil: 0, respawnAt: point ? 0 : now() + 1000, nextMove: now() + 750, nextAttack: now() + 1000 };
  };
  const rollItems = (mapId: LiveMapId, point: LivePoint): EconomyLoot[] => {
    const pool = getLiveLootPool(mapId, point), total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    const count = random() < .35 ? 2 : 1, result: EconomyLoot[] = [];
    for (let index = 0; index < count; index++) {
      let roll = random() * total;
      const model = (pool.find(entry => (roll -= entry.weight) < 0) ?? pool.at(-1)!).model;
      result.push({ id: randomUUID(), modelId: model.id, foundAt: now() });
    }
    return result;
  };
  const addDrop = (mapId: LiveMapId, point: LivePoint, amount: number, source: Drop["source"] = "body", items?: EconomyLoot[]): void => {
    const id = randomUUID();
    const generated = options.economy && items === undefined ? rollItems(mapId, point) : items;
    const container = source === "supply" ? maps.get(mapId)!.containers.find(anchor => anchor.x === point.x && anchor.y === point.y) : undefined;
    drops.set(id, { mapId, id, x: point.x, y: point.y, amount: generated && items === undefined ? 0 : amount, source, ...(generated ? { items: structuredClone(generated) } : {}),
      ...(container ? { containerId: container.id, containerKind: container.kind } : {}), expiresAt: container ? Number.MAX_SAFE_INTEGER : now() + 120_000 });
  };
  const stored = db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get();
  if (stored) {
    const world = JSON.parse(stored.state) as { version?: number; geometryVersion?: string; startedAt: number; scavs: Scav[]; drops: Drop[]; events: MapEvent[]; lootCooldowns?: Array<[string, number]> };
    startedAt = world.startedAt;
    // Old NPC layouts are replaced once; verified player bodies and dropped cargo are retained.
    for (const [index, scav] of (world.version === WORLD_VERSION && world.geometryVersion === maps.get(DEFAULT_MAP)!.version ? world.scavs : []).entries()) {
      scav.mapId = mapFrom(scav.mapId) ?? DEFAULT_MAP;
      if (!walkable(scav.mapId, scav)) Object.assign(scav, pickPoint(scav.mapId));
      scav.faction = scav.faction === "raiders" ? "raiders" : "scavs";
      scav.role = ["patrol", "guard", "marksman"].includes(scav.role) ? scav.role : "patrol";
      scav.home = scav.home && walkable(scav.mapId, scav.home) ? scav.home : { x: scav.x, y: scav.y };
      scav.route = scav.route?.filter(point => walkable(scav.mapId, point)) ?? [scav.home];
      if (!scav.route.length) scav.route = [scav.home];
      scav.routeIndex ??= 0; scav.spawnIndex ??= index; Object.assign(scav, freshPath());
      scavs.set(scav.id, scav);
    }
    for (const drop of world.drops) {
      if (drop.source === "supply" && (world.version !== WORLD_VERSION || world.geometryVersion !== maps.get(DEFAULT_MAP)!.version)) continue;
      if (drop.mapId !== DEFAULT_MAP) Object.assign(drop, translateLegacy(drop, drop.mapId));
      drop.mapId = mapFrom(drop.mapId) ?? DEFAULT_MAP;
      if (!walkable(drop.mapId, drop)) Object.assign(drop, nearestFree(drop, districtAt(drop)));
      if (drop.expiresAt > now() && walkable(drop.mapId, drop)) drops.set(drop.id, drop);
    }
    if (world.version === WORLD_VERSION && world.geometryVersion === maps.get(DEFAULT_MAP)!.version) {
      events = world.events.slice(-120).map(item => ({ ...item, mapId: DEFAULT_MAP }));
      for (const [key, ready] of world.lootCooldowns ?? []) if (ready > now()) lootCooldowns.set(key, ready);
    }
  }
  for (const map of LIVE_MAPS) {
    if (![...scavs.values()].some(scav => scav.mapId === map.id)) for (let index = 0; index < map.npcSpawns.length; index++) {
      const scav = spawnScav(map.id, index); scavs.set(scav.id, scav);
    }
    for (const anchor of map.containers) if (![...drops.values()].some(drop => drop.containerId === anchor.id) && (lootCooldowns.get(lootKey(map.id, anchor, anchor.id)) ?? 0) <= now()) addDrop(map.id, anchor, 10 + Math.floor(random() * 21), "supply");
  }
  const status = (): LiveStatus => ({ id: LIVE_SERVER_ID, name: LIVE_SERVER_NAME, online: [...players.values()].filter(player => player.online).length, capacity: LIVE_CAPACITY, startedAt,
    maps: LIVE_MAPS.map(map => ({ id: map.id, name: map.name, description: map.description, theme: map.theme, width: map.width, height: map.height,
      online: [...players.values()].filter(player => player.online && player.mapId === map.id).length, npcs: [...scavs.values()].filter(scav => scav.mapId === map.id && scav.health > 0).length })),
    districts: maps.get(DEFAULT_MAP)!.districts.map(district => ({ ...district,
      online: [...players.values()].filter(player => player.online && districtAt(player) === district.id).length,
      npcs: [...scavs.values()].filter(scav => scav.health > 0 && districtAt(scav) === district.id).length })) });
  const lineOfSight = (mapId: LiveMapId, a: LivePoint, b: LivePoint): boolean => navigation.get(mapId)!.hasLineOfSight(a, b);
  const snapshot = (player: Participant, request?: Request): Omit<LiveSnapshot, "world"> & { world?: LiveWorld } => {
    const world = worldFor(player.mapId), visible = (point: LivePoint): boolean => distance(player, point) <= VISION_RADIUS && lineOfSight(player.mapId, player, point);
    player.districtId = districtAt(player);
    const chunkX = Math.floor(player.x / world.chunkSize), chunkY = Math.floor(player.y / world.chunkSize), visibleChunks: LivePoint[] = [];
    for (let y = chunkY - 1; y <= chunkY + 1; y++) for (let x = chunkX - 1; x <= chunkX + 1; x++) if (x >= 0 && y >= 0 && x * world.chunkSize < world.width && y * world.chunkSize < world.height) visibleChunks.push({ x, y });
    return {
      server: status(), now: now(), ...(request?.headers.get("x-prapor-world-version") === world.version ? {} : { world }), worldVersion: world.version, visibleChunks, selfId: player.id,
      self: { id: player.id, ammo: player.ammo, medkits: player.medkits, cargo: player.cargo, stash: player.stash, kills: player.kills, respawnAt: player.respawnAt, patrol: player.patrol, targetId: player.targetId, travelReadyAt: player.travelReadyAt,
        districtId: player.districtId, purpose: player.purpose, searching: player.searching ? { ...player.searching } : null,
        ...(options.economy ? { gameId: player.gameId, lootItems: structuredClone(player.lootItems ?? []),
          pendingDelivery: pendingRows.all(player.identity).filter(row => row.kind === "delivery").map(row => {
            const parcel = JSON.parse(row.payload) as LiveDelivery;
            return { items: parcel.items, money: parcel.money, message: row.message };
          }), economyMessage: player.economyMessage ?? "Находки с выхода поступают в убежище; пополнение расходует его запасы." } : {}) },
      entities: [...players.values()].filter(other => other.online && other.mapId === player.mapId && (other.id === player.id || visible(other))).map(publicEntity)
        .concat([...scavs.values()].filter(scav => scav.mapId === player.mapId && visible(scav)).map(publicEntity)),
      drops: [...drops.values()].filter(drop => drop.mapId === player.mapId && visible(drop)).map(drop => {
        const searched = player.searchedDropIds.includes(drop.id);
        return { id: drop.id, x: drop.x, y: drop.y, amount: !drop.containerId || searched ? drop.amount : 0,
          ...(drop.containerId ? { containerId: drop.containerId, containerKind: drop.containerKind, searched } : {}),
          ...(drop.items && (!drop.containerId || searched) ? { items: structuredClone(drop.items) } : {}) };
      }),
      events: events.filter(item => item.mapId === player.mapId && (item.actorId === player.id || item.targetId === player.id
        || (item.from && item.to ? visible(item.from) && visible(item.to) : item.point && visible(item.point))))
        .slice(-40).map(({ mapId: _mapId, point: _point, ...item }) => item),
    };
  };
  const pathStep = (entity: Participant | Scav, destination: LivePoint): LivePoint | null => {
    if (entity.x === destination.x && entity.y === destination.y) return null;
    const next = entity.path[0], changed = entity.pathGoal?.x !== destination.x || entity.pathGoal?.y !== destination.y;
    if (changed || !next || !clear(entity.mapId, next, entity.id)) {
      if (!changed && entity.replanAt > now()) return null;
      const nav = navigation.get(entity.mapId)!;
      const occupiedCells = new Set([...players.values(), ...scavs.values()].filter(other => other.id !== entity.id && other.mapId === entity.mapId && other.health > 0 && (!("online" in other) || other.online)).map(nav.key));
      entity.path = nav.findPath(entity, destination, occupiedCells) ?? [];
      entity.pathGoal = { ...destination }; entity.replanAt = now() + 1000;
    }
    const step = entity.path[0];
    if (!step || !clear(entity.mapId, step, entity.id)) return null;
    entity.path.shift(); return step;
  };
  const down = (target: Participant | Scav, attacker: Participant | Scav): void => {
    target.health = 0; target.action = "downed"; target.respawnAt = now() + RESPAWN_MS;
    const amount = "cargo" in target ? target.cargo : 25 + Math.floor(random() * 26);
    if ("cargo" in target) {
      if (amount > 0 || target.lootItems?.length) addDrop(target.mapId, target, amount, "body", target.lootItems ?? []);
      target.cargo = 0; if (options.economy) target.lootItems = [];
      target.destination = null; target.patrol = false; target.targetId = null; target.searching = null; Object.assign(target, freshPath());
    } else if (amount > 0) addDrop(target.mapId, target, amount);
    if ("kills" in attacker) attacker.kills++;
  };
  const rangeOf = (entity: Participant | Scav): number => entity.kind === "player" || "role" in entity && entity.role === "marksman" ? 7 : 5;
  const attack = (attacker: Participant | Scav, target: Participant | Scav): void => {
    if (target.mapId !== attacker.mapId || target.health <= 0 || attacker.health <= 0 || target.id === attacker.id || "online" in target && !target.online) throw new LiveError(409, "target_unavailable");
    if (now() < target.safeUntil) throw new LiveError(409, "spawn_protection");
    if (distance(attacker, target) > rangeOf(attacker) || !lineOfSight(attacker.mapId, attacker, target)) throw new LiveError(409, "target_out_of_range");
    if (attacker.nextAttack > now()) throw new LiveError(429, "action_cooldown", 1);
    if ("ammo" in attacker && attacker.ammo <= 0) throw new LiveError(409, "no_ammo");
    if ("ammo" in attacker) { attacker.ammo--; attacker.destination = null; attacker.searching = null; Object.assign(attacker, freshPath()); }
    attacker.safeUntil = 0; attacker.nextAttack = now() + (attacker.kind === "player" ? 900 : 1500); attacker.action = "combat";
    if ("lastCombatAt" in attacker) attacker.lastCombatAt = now();
    if ("lastCombatAt" in target) { target.lastCombatAt = now(); target.searching = null; }
    const damage = Math.min(target.health, attacker.kind === "player" ? 25 : "faction" in attacker && attacker.faction === "raiders" ? 20 : 15);
    target.health -= damage;
    if (target.health <= 0) down(target, attacker);
    event(attacker.mapId, "combat", target.health <= 0 ? `${attacker.name} победил ${target.name}.` : `${attacker.name} стреляет в ${target.name}.`, attacker.id, target.id,
      { from: { x: attacker.x, y: attacker.y }, to: { x: target.x, y: target.y }, damage });
  };
  const finishSearch = (player: Participant): void => {
    if (!player.searching) return;
    const drop = drops.get(player.searching.id);
    if (!player.online || player.disconnectAt > 0 || player.health <= 0 || !drop || drop.expiresAt <= now() || !drop.containerId || distance(player, drop) > 1.5 || !lineOfSight(player.mapId, player, drop)) {
      player.searching = null; return;
    }
    if (player.searching.readyAt > now()) return;
    if (!player.searchedDropIds.includes(drop.id)) player.searchedDropIds.push(drop.id);
    player.searching = null;
    event(player.mapId, "loot", `${player.name} закончил обыск.`, player.id);
  };
  const search = (player: Participant, id: string, patrol = false): void => {
    const drop = drops.get(id);
    if (!drop || drop.mapId !== player.mapId || drop.expiresAt <= now()) throw new LiveError(409, "loot_unavailable");
    if (!drop.containerId) throw new LiveError(409, "search_not_required");
    if (distance(player, drop) > 1.5 || !lineOfSight(player.mapId, player, drop)) throw new LiveError(409, "loot_out_of_range");
    if (player.searchedDropIds.includes(id) || player.searching?.id === id) return;
    const container = maps.get(player.mapId)!.containers.find(anchor => anchor.id === drop.containerId);
    if (!container) throw new LiveError(409, "loot_unavailable");
    player.searching = { id, readyAt: now() + container.searchMs };
    player.destination = null; player.patrol = patrol; player.targetId = null; player.action = "idle"; Object.assign(player, freshPath());
  };
  const canCarry = (player: Participant, drop: Drop): boolean => {
    const items = [...(player.lootItems ?? []), ...(drop.items ?? [])];
    return player.cargo + drop.amount <= 500 && items.length <= LIVE_LOOT_CAPACITY
      && items.reduce((sum, item) => sum + LOOT_MODEL_BY_ID[item.modelId]!.weight, 0) <= LIVE_LOOT_WEIGHT + 1e-9;
  };
  const loot = (player: Participant, id: string): void => {
    const drop = drops.get(id);
    if (!drop || drop.mapId !== player.mapId || drop.expiresAt <= now()) throw new LiveError(409, "loot_unavailable");
    if (distance(player, drop) > 1.5 || !lineOfSight(player.mapId, player, drop)) throw new LiveError(409, "loot_out_of_range");
    finishSearch(player);
    if (drop.containerId && !player.searchedDropIds.includes(id)) throw new LiveError(409, "search_required");
    if (!canCarry(player, drop)) throw new LiveError(409, "cargo_full");
    drops.delete(id); player.cargo += drop.amount;
    if (drop.items?.length) player.lootItems = [...(player.lootItems ?? []), ...structuredClone(drop.items)];
    if (drop.source === "supply") lootCooldowns.set(lootKey(player.mapId, drop, drop.containerId), now() + 30_000);
    const names = drop.items?.slice(0, 4).map(item => LOOT_MODEL_BY_ID[item.modelId]!.label).join(", ");
    event(player.mapId, "loot", drop.items?.length ? `${player.name} забрал: ${names}${drop.items.length > 4 ? ` и ещё ${drop.items.length - 4}` : ""}${drop.amount ? ` и ${drop.amount} ₽` : ""}.` : `${player.name} забрал груз: ${drop.amount}.`, player.id);
  };
  const respawn = (player: Participant, districtId = player.districtId, purpose = player.purpose): void => {
    if (player.health > 0) throw new LiveError(409, "already_alive");
    if (player.respawnAt > now()) throw new LiveError(409, "respawn_not_ready");
    const point = pickPoint(player.mapId, true, districtId);
    player.x = point.x; player.y = point.y; player.health = 100; player.cargo = 0;
    if (!options.economy) { player.ammo = 60; player.medkits = 2; }
    else player.lootItems = [];
    player.respawnAt = 0; player.safeUntil = now() + 5000; player.destination = null; player.action = "idle"; player.nextAttack = 0; player.targetId = null; player.patrol = false;
    player.districtId = districtId; player.purpose = purpose; player.searching = null; Object.assign(player, freshPath());
    event(player.mapId, "respawn", `${player.name} вернулся в район «${maps.get(player.mapId)!.districts.find(district => district.id === districtId)!.name}».`, player.id);
  };
  const limits = new Map<string, { count: number; expires: number }>();
  const limit = (key: string, maximum: number, windowMs = 60_000): void => {
    const time = now();
    if (time - lastCleanup >= 60_000) {
      for (const [key, value] of limits) if (value.expires <= time) limits.delete(key);
      db.query("DELETE FROM live_guests WHERE expires_at<=?").run(time);
      db.query("DELETE FROM live_players WHERE identity LIKE 'guest:%' AND identity NOT IN (SELECT identity FROM live_guests) AND identity NOT IN (SELECT live_identity FROM live_game_owners) AND identity NOT IN (SELECT identity FROM live_economy_outbox WHERE acknowledged=0)").run();
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
    for (const player of players.values()) if (player.online && (player.disconnectAt > 0 ? now() >= player.disconnectAt : now() - player.heartbeat >= HEARTBEAT_MS)) {
      player.online = false; player.destination = null; player.patrol = false; player.targetId = null; player.searching = null; Object.assign(player, freshPath()); player.action = player.health > 0 ? "idle" : "downed";
      event(player.mapId, "leave", player.disconnectAt ? `${player.name} покинул район.` : `${player.name} потерял связь.`, player.id);
      player.disconnectAt = 0;
    }
    for (const [identity, player] of players) if (!player.online && now() - player.heartbeat >= 60_000) {
      savePlayer.run(identity, JSON.stringify(durable(player))); players.delete(identity);
    }
  };
  const leashOf = (scav: Scav): number => scav.role === "patrol" ? Math.max(14, ...scav.route.map(point => distance(scav.home, point) + 9)) : scav.role === "marksman" ? 10 : 8;
  const nearestTarget = (entity: Participant | Scav): Participant | Scav | undefined => {
    const targets: Array<Participant | Scav> = "identity" in entity
      ? [...scavs.values()].filter(scav => scav.mapId === entity.mapId && scav.health > 0)
      : [...players.values(), ...scavs.values()].filter(target => target.id !== entity.id && target.mapId === entity.mapId && target.health > 0 && target.safeUntil <= now()
        && ("online" in target ? target.online : target.faction !== entity.faction)
        && distance(entity, target) <= (entity.role === "marksman" ? 11 : entity.role === "patrol" ? 9 : 7)
        && distance(entity.home, target) <= leashOf(entity));
    return targets.sort((a, b) => distance(entity, a) - distance(entity, b))[0];
  };
  const targetFor = (player: Participant, id: string): Participant | Scav => {
    const target = [...players.values(), ...scavs.values()].find(entity => entity.id === id && entity.mapId === player.mapId && entity.health > 0 && (!("online" in entity) || entity.online));
    if (!target || target.id === player.id) throw new LiveError(409, "target_unavailable");
    return target;
  };
  const simulate = (): void => {
    expire();
    for (const drop of drops.values()) if (drop.expiresAt <= now()) drops.delete(drop.id);
    for (const [key, ready] of lootCooldowns) if (ready <= now()) lootCooldowns.delete(key);
    for (const map of LIVE_MAPS) for (const anchor of map.containers) if ((lootCooldowns.get(lootKey(map.id, anchor, anchor.id)) ?? 0) <= now() && ![...drops.values()].some(drop => drop.containerId === anchor.id)) addDrop(map.id, anchor, 10 + Math.floor(random() * 21), "supply");
    for (const scav of scavs.values()) {
      if (scav.health <= 0) {
        if (scav.respawnAt <= now()) { Object.assign(scav, spawnScav(scav.mapId, scav.spawnIndex, scav.id)); event(scav.mapId, "respawn", `${scav.name} появился в районе.`, scav.id); }
        continue;
      }
      const target = nearestTarget(scav);
      scav.action = "idle";
      if (target && distance(scav, target) <= rangeOf(scav) && lineOfSight(scav.mapId, scav, target)) {
        if (scav.nextAttack <= now()) attack(scav, target);
        scav.action = "combat";
      } else if (scav.nextMove <= now()) {
        const routePoint = scav.route[scav.routeIndex % scav.route.length]!;
        if (distance(scav, routePoint) < 1.5) scav.routeIndex = (scav.routeIndex + 1) % scav.route.length;
        // Guards and marksmen stay near their post; patrols follow authored routes.
        const destination = target ?? (scav.role === "patrol" ? scav.route[scav.routeIndex]! : scav.home);
        const approach = target || occupied(scav.mapId, destination, scav.id);
        const goal = approach ? [{ x: destination.x + 1, y: destination.y }, { x: destination.x - 1, y: destination.y }, { x: destination.x, y: destination.y + 1 }, { x: destination.x, y: destination.y - 1 }]
          .filter(point => clear(scav.mapId, point, scav.id) && (!target || distance(scav.home, point) <= leashOf(scav))).sort((a, b) => distance(scav, a) - distance(scav, b))[0] : destination;
        const step = goal ? pathStep(scav, goal) : null;
        if (step) { scav.x = step.x; scav.y = step.y; scav.action = "moving"; }
        scav.nextMove = now() + 750;
      }
    }
    for (const player of players.values()) {
      if (!player.online || player.health <= 0) continue;
      player.searchedDropIds = player.searchedDropIds.filter(id => drops.has(id));
      finishSearch(player);
      if (player.searching) continue;
      if (player.action === "combat" && player.nextAttack <= now()) player.action = "idle";
      if (player.targetId) {
        let target: Participant | Scav | undefined;
        try { target = targetFor(player, player.targetId); } catch (error) { if (!(error instanceof LiveError)) throw error; player.targetId = null; }
        if (player.ammo <= 0) player.targetId = null;
        if (target && player.targetId && target.safeUntil <= now() && distance(player, target) <= rangeOf(player) && lineOfSight(player.mapId, player, target)) {
          if (player.nextAttack <= now()) attack(player, target);
          if (target.health <= 0) player.targetId = null;
          continue;
        }
      }
      if (player.patrol) {
        const target = nearestTarget(player);
        if (target && target.safeUntil <= now() && distance(player, target) <= 7 && lineOfSight(player.mapId, player, target) && player.ammo > 0) {
          if (player.nextAttack <= now()) attack(player, target);
          continue;
        }
        const drop = [...drops.values()].filter(drop => drop.mapId === player.mapId && canCarry(player, drop)).sort((a, b) => distance(player, a) - distance(player, b))[0];
        if (drop && distance(player, drop) <= 1.5 && lineOfSight(player.mapId, player, drop)) {
          if (drop.containerId && !player.searchedDropIds.includes(drop.id)) { search(player, drop.id, true); continue; }
          loot(player, drop.id); player.destination = null;
        }
        if (!player.destination) player.destination = drop ?? pickPoint(player.mapId);
      }
      if (player.destination && player.nextMove <= now()) {
        const step = pathStep(player, player.destination);
        if (step) { player.x = step.x; player.y = step.y; player.action = "moving"; }
        else player.action = "idle";
        if (player.destination?.x === player.x && player.destination.y === player.y) { player.destination = null; player.action = "idle"; }
        player.nextMove = now() + 350;
      }
    }
  };
  const tick = (): void => {
    if (closed || failed) return;
    try {
      if (now() - lastTick >= TICK_MS) { simulate(); lastTick = now(); }
      const retryEconomy = Boolean(options.economy) && now() - lastEconomy >= 1000;
      if (now() - lastSave >= 1000 || retryEconomy) persist();
      if (retryEconomy) flushEconomy();
    } catch (error) { failed = true; console.error("Live simulation stopped after a storage or simulation error:", error); }
  };
  const tokenFrom = (request: Request): string | null => {
    const cookies = (request.headers.get("cookie") ?? "").split(";").map(cookie => cookie.trim()).filter(cookie => cookie.startsWith(`${cookieName}=`));
    if (cookies.length !== 1) return null;
    const token = cookies[0]!.slice(cookieName.length + 1);
    return /^[a-zA-Z0-9_-]{43}$/.test(token) ? token : null;
  };
  const legacyIdentityFrom = (request: Request): { identity: string; name?: string } | null => {
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
  const identityFrom = (request: Request, joining = false): { identity: string; name?: string; economy?: LiveEconomyIdentity } | null => {
    if (!options.economy) return legacyIdentityFrom(request);
    let economy: LiveEconomyIdentity;
    try { economy = options.economy.resolve(request); }
    catch (error) { if (error instanceof LiveEconomyError) throw new LiveError(error.status, error.code); throw error; }
    const legacy = legacyIdentityFrom(request), owner = byOwner.get(economy.key);
    if (owner && owner.game_id !== economy.gameId) throw new LiveError(401, "game_identity_changed");
    if (legacy) {
      const bound = byLive.get(legacy.identity);
      if (bound && (bound.owner_key !== economy.key || bound.game_id !== economy.gameId) || owner && owner.live_identity !== legacy.identity)
        throw new LiveError(401, "game_identity_changed");
    }
    const identity = owner?.live_identity ?? (legacy && (players.has(legacy.identity) || readPlayer.get(legacy.identity)) ? legacy.identity : economy.key);
    if (!owner) {
      if (!joining) throw new LiveError(401, "join_required");
      const bound = byLive.get(identity);
      if (bound && (bound.owner_key !== economy.key || bound.game_id !== economy.gameId)) throw new LiveError(401, "game_identity_changed");
      preparedBindings.push({ owner_key: economy.key, game_id: economy.gameId, live_identity: identity });
    }
    return { identity, name: economy.name, economy };
  };
  const currentPlayer = (request: Request): Participant => {
    const identity = identityFrom(request), player = identity ? players.get(identity.identity) : null;
    if (!player || !player.online || player.disconnectAt > 0) throw new LiveError(401, "join_required");
    if (request.headers.get("x-prapor-live") !== player.id) throw new LiveError(401, "live_identity_changed");
    if (identity?.economy && (player.gameId !== identity.economy.gameId || player.economyOwner !== identity.economy.key)) throw new LiveError(401, "game_identity_changed");
    return player;
  };
  const doCommand = (player: Participant, command: LiveCommand): void => {
    if (command.type === "respawn") { respawn(player, command.districtId ?? player.districtId, command.purpose ?? player.purpose); return; }
    if (player.health <= 0) throw new LiveError(409, "player_downed");
    if (command.type === "move") { player.destination = { x: command.x, y: command.y }; player.patrol = false; player.targetId = null; player.searching = null; Object.assign(player, freshPath()); }
    if (command.type === "attack") {
      const target = targetFor(player, command.targetId);
      attack(player, target); player.patrol = false; player.targetId = null;
    }
    if (command.type === "engage") {
      if (command.targetId === null) { player.targetId = null; return; }
      const target = targetFor(player, command.targetId);
      if (distance(player, target) > VISION_RADIUS || !lineOfSight(player.mapId, player, target)) throw new LiveError(409, "target_unavailable");
      if (target.safeUntil > now()) throw new LiveError(409, "spawn_protection");
      if (player.ammo <= 0) throw new LiveError(409, "no_ammo");
      player.targetId = target.id; player.patrol = false; player.destination = null; player.searching = null; Object.assign(player, freshPath());
      if (player.nextAttack <= now() && distance(player, target) <= rangeOf(player) && lineOfSight(player.mapId, player, target)) attack(player, target);
      if (target.health <= 0) player.targetId = null;
    }
    if (command.type === "travel") {
      throw new LiveError(409, "already_on_map");
    }
    if (command.type === "search") search(player, command.id);
    if (command.type === "loot") loot(player, command.id);
    if (command.type === "heal") {
      if (player.health >= 100) throw new LiveError(409, "already_healthy");
      if (player.medkits <= 0) throw new LiveError(409, "no_medkits");
      player.medkits--; player.health = Math.min(100, player.health + 45);
    }
    if (command.type === "extract") {
      if (!maps.get(player.mapId)!.extracts.some(exit => distance(player, exit) <= 1.5)) throw new LiveError(409, "extract_out_of_range");
      if (options.economy && player.lastCombatAt > now() - COMBAT_TRAVEL_MS) throw new LiveError(409, "in_combat");
      const amount = player.cargo + (options.economy ? player.stash : 0), itemCount = player.lootItems?.length ?? 0;
      prepareDelivery(player);
      if (!options.economy) { player.ammo = 60; player.medkits = 2; }
      player.destination = null; player.patrol = false; player.targetId = null; player.searching = null; Object.assign(player, freshPath());
      event(player.mapId, "extract", options.economy ? `${player.name} отправил в убежище: ${itemCount} находок и ${amount} ₽.`
        : amount ? `${player.name} сохранил груз: ${amount}.` : `${player.name} пополнил боекомплект на выходе.`, player.id);
    }
    if (command.type === "resupply") {
      if (!options.economy) throw new LiveError(409, "economy_unavailable");
      if (!maps.get(player.mapId)!.extracts.some(exit => distance(player, exit) <= 1.5)) throw new LiveError(409, "extract_out_of_range");
      if (player.lastCombatAt > now() - COMBAT_TRAVEL_MS) throw new LiveError(409, "in_combat");
      if (pendingRows.all(player.identity).some(row => row.kind === "supply")) throw new LiveError(409, "supply_pending");
      const ammo = 60 - player.ammo, medkits = 2 - player.medkits;
      if (!ammo && !medkits) throw new LiveError(409, "already_supplied");
      if (!player.economyOwner || !player.gameId) throw new LiveError(401, "join_required");
      prepare(player, "supply", { id: randomUUID(), owner: player.economyOwner, gameId: player.gameId, createdAt: now(), ammo, medkits });
      player.economyMessage = "Пополнение из убежища ожидает подтверждения.";
    }
    if (command.type === "patrol") { player.patrol = command.enabled; player.destination = null; player.targetId = null; player.searching = null; Object.assign(player, freshPath()); }
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
        if (!Object.keys(body).every(key => ["districtId", "purpose"].includes(key)) || body.districtId !== undefined && !districtFrom(body.districtId) || body.purpose !== undefined && !purposeFrom(body.purpose)) throw new LiveError(400, "invalid_request");
        limit(`join:${ipKey}`, 120);
        let identity = identityFrom(request, true), token: string | undefined;
        let player = identity ? players.get(identity.identity) ?? loadPlayer(identity.identity) : undefined;
        if (!player?.online && status().online >= LIVE_CAPACITY) throw new LiveError(503, "server_full");
        if (!identity) {
          limit(`guest:${ipKey}`, 12, 60 * 60_000);
          token = randomBytes(32).toString("base64url"); identity = { identity: `guest:${randomUUID()}` };
          db.query("INSERT INTO live_guests(token_hash,identity,expires_at) VALUES(?,?,?)").run(hashToken(token), identity.identity, now() + COOKIE_SECONDS * 1000);
        }
        if (!player) {
          const mapId = DEFAULT_MAP, districtId = districtFrom(body.districtId) ?? "customs", purpose = purposeFrom(body.purpose) ?? "loot", id = randomUUID(), point = pickPoint(mapId, true, districtId);
          player = { id, mapId, ...point, kind: "player", identity: identity.identity, name: identity.name ?? `Дикий ${id.slice(0, 4).toUpperCase()}`, appearance: Math.floor(random() * 32),
            health: 100, safeUntil: now() + 5000, action: "idle", ammo: 60, medkits: 2, cargo: 0, stash: 0, kills: 0, respawnAt: 0, patrol: false,
            targetId: null, travelReadyAt: 0, districtId, purpose, searching: null, searchedDropIds: [], ...freshPath(), lastCombatAt: 0, disconnectAt: 0, online: false, heartbeat: now(), destination: null, nextMove: 0, nextAttack: 0 };
          players.set(player.identity, player);
        }
        players.set(player.identity, player);
        if (identity.economy) { player.economyOwner = identity.economy.key; player.gameId = identity.economy.gameId; player.lootItems ??= []; }
        if (identity.name) player.name = identity.name;
        if (body.purpose !== undefined) player.purpose = body.purpose as LivePurpose;
        if (!player.online) {
          if (player.health > 0 && occupied(player.mapId, player, player.id)) Object.assign(player, nearestFree(player, districtAt(player)));
          event(player.mapId, "join", `${player.name} вышел в район «${maps.get(player.mapId)!.name}».`, player.id);
        }
        player.online = true; player.disconnectAt = 0; player.heartbeat = now(); persist(); flushEconomy();
        return response(snapshot(player, request), 200, token ? { "Set-Cookie": `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_SECONDS}${secure ? "; Secure" : ""}` } : {});
      }
      let player = currentPlayer(request);
      limit(`player:${player.id}`, 600);
      if (path === "/api/live/state") { player.heartbeat = now(); return response(snapshot(player, request)); }
      const body = await readJson(request);
      // A slow body can outlive eviction/rejoin: refresh both ownership and the actual mutable instance.
      const current = currentPlayer(request);
      if (current.id !== player.id) throw new LiveError(401, "live_identity_changed");
      player = current;
      player.heartbeat = now();
      if (path === "/api/live/leave") {
        if (!exactKeys(body, [])) throw new LiveError(400, "invalid_request");
        player.destination = null; player.patrol = false; player.targetId = null; player.searching = null; Object.assign(player, freshPath()); player.action = player.health > 0 ? "idle" : "downed";
        if (player.health > 0 && player.lastCombatAt > now() - COMBAT_TRAVEL_MS) {
          // Leaving the view cannot make a body disappear in the middle of a fight.
          player.disconnectAt = now() + COMBAT_TRAVEL_MS;
          event(player.mapId, "leave", `${player.name} выходит из района; тело остаётся уязвимым ещё 8 секунд.`, player.id);
        } else {
          player.online = false; player.disconnectAt = 0;
          event(player.mapId, "leave", `${player.name} покинул район.`, player.id);
        }
        persist(); return response({ ok: true });
      }
      limit(`action:${player.id}`, 180);
      doCommand(player, commandFrom(body, player.mapId)); persist(); flushEconomy();
      return response(snapshot(player, request));
    } catch (error) {
      if (error instanceof LiveError) { preparedBindings = []; prepared = []; return response({ code: error.code }, error.status, error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}); }
      failed = true; console.error("Live request failed:", error); return response({ code: "service_unavailable" }, 503);
    }
  };
  persist(); flushEconomy();
  const timer = options.automaticTicks === false ? undefined : setInterval(tick, TICK_MS);
  timer?.unref();
  return { fetch: fetchApi, tick, healthy: () => { try { return !closed && !failed && Boolean(db.query("SELECT 1 AS ready").get()); } catch { return false; } }, close: () => {
    if (closed) return;
    if (timer) clearInterval(timer);
    try { if (!failed) persist(); } finally { closed = true; db.close(); }
  } };
}
