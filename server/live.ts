import { Database } from "bun:sqlite";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LIVE_CAPACITY, LIVE_LOOT_CAPACITY, LIVE_LOOT_WEIGHT, LIVE_MEDICAL_CAPACITY, LIVE_PENDING_CAPACITY, LIVE_SERVER_ID, LIVE_SERVER_NAME, liveMedicalSupplyNeeded, type LiveCommand, type LiveDistrictId, type LiveDrop, type LiveEntity, type LiveEvent, type LiveMapId, type LivePlayer, type LivePoint, type LivePurpose, type LiveSnapshot, type LiveStatus, type LiveWorld } from "../src/game/live";
import { LIVE_MAPS } from "../src/game/live-maps";
import { createLiveNavigation } from "./live-navigation";
import { createLiveSortie, type LiveSortiePlan } from './live-autobattle';
import { migratedContainerAnchor, migratedLootCooldownKey } from "./live-world-migration";
import { migrateExpandedLiveCoordinates } from './live-coordinate-migration';
import { BODY_PARTS, BODY_PART_LABELS, TREATMENT_DURATION_MS, TREATMENT_LABELS, advanceBleeding, applyHit, canTreat, completeTreatment, createHealth, createMedicalInventory, healthPercent, injuryEffects, isAlive, isStable, parseHealth, parseMedicalInventory, selectTreatment, type BodyPart, type HealthState, type TreatmentType } from "../src/game/health";
import { type LootModel } from "../src/game/loot";
import { getLiveLootSource, getLiveNamedLootPool } from '../src/game/live-loot-pool';
import { getLiveLootDefinition, getLiveLootWeight, readEconomyLootItems } from '../src/game/live-loot';
import { getLiveLootFamilyOdds, rollLiveLootModel } from '../src/game/live-physical-loot';
import { BOSSES, getBoss, type BossId } from '../src/game/bosses';
import { getLiveBossArenas } from '../src/game/live-boss-arenas';
import type { AccountService } from "./accounts";
import { LiveEconomyError, type EconomyLoot, type LiveDelivery, type LiveEconomy, type LiveEconomyIdentity, type LiveSupplyRequest } from "./live-economy";
import { LIVE_FIELD_KITS, getLiveLoadout, isLiveKitId, quoteLiveKits, type LiveEntry, type LiveKitId } from '../src/game/live-entry';

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
  sortie?: LiveSortiePlan;
  threatId?: string;
  mapId: LiveMapId;
  identity: string;
  online: boolean;
  heartbeat: number;
  destination: LivePoint | null;
  nextMove: number;
  nextAttack: number;
  healthAt: number;
  dangerUntil: number;
  graceUntil: number;
  aim: { targetId: string; endsAt: number; part: BodyPart } | null;
  lastCombatAt: number;
  disconnectAt: number;
  searchedDropIds: string[];
  economyOwner?: string;
  /** Saved before the headquarters debit, consumed in the same transaction as its acknowledgement. */
  entryPending?: { id: string; districtId: LiveDistrictId; purpose: LivePurpose; x: number; y: number; respawn: boolean; automatic?: boolean };
}
interface Scav extends LiveEntity, PathCache {
  body: HealthState; healthAt: number; aim: { targetId: string; endsAt: number; part: BodyPart } | null;
  mapId: LiveMapId; faction: "scavs" | "raiders"; role: "patrol" | "guard" | "marksman";
  home: LivePoint; route: LivePoint[]; routeIndex: number; spawnIndex: number;
  respawnAt: number; nextMove: number; nextAttack: number;
  bossCycle?: number; bossDeathSettled?: boolean;
  bossLastHit?: { identity: string; playerId: string; at: number };
}
interface BossKillCredit { bossId: BossId; cycle: number; identity: string; playerId: string; at: number }
const isParticipant = (entity: Participant | Scav): entity is Participant => entity.kind === "player";
interface Drop extends LiveDrop { mapId: LiveMapId; expiresAt: number; source?: "supply" | "body" }
interface MapEvent extends LiveEvent { mapId: LiveMapId; point?: LivePoint }
interface EconomyBinding { live_identity: string; owner_key: string; game_id: string }
interface OutboxRow { id: string; identity: string; kind: "delivery" | "supply"; payload: string; message: string }
const TICK_MS = 250, HEARTBEAT_MS = 15_000, RESPAWN_MS = 10_000, COOKIE_SECONDS = 30 * 24 * 60 * 60;
const DISCONNECT_GRACE_MS = 30_000, LEAVE_MS = 5000;
const MEDICINES: TreatmentType[] = ["medkit", "bandage", "tourniquet", "splint", "painkiller", "surgery"];
const LIVE_PROTECTION: Partial<Record<BodyPart, number>> = { head: .2, chest: .3, stomach: .3 };
function storedBody(value: unknown, legacyHealth: number): HealthState {
  if (value !== undefined) return parseHealth(value);
  const body = createHealth(legacyHealth);
  if (legacyHealth <= 0) body.parts.head.hp = 0;
  return body;
}
const DEFAULT_MAP: LiveMapId = "perimeter", WORLD_VERSION = 3, COMBAT_TRAVEL_MS = 8000, VISION_RADIUS = 24, VISIBLE_DROP_CAPACITY = 512;
const maps = new Map(LIVE_MAPS.map(map => [map.id, map]));
const mapFrom = (id: unknown): LiveMapId | null => typeof id === "string" && maps.has(id as LiveMapId) ? id as LiveMapId : null;
const worldFor = (id: LiveMapId): LiveWorld => {
  const { npcSpawns: _npcs, lootSpawns: _loot, ...world } = maps.get(id)!;
  return world;
};
const navigation = new Map(LIVE_MAPS.map(map => [map.id, createLiveNavigation(map)]));
const districtFrom = (value: unknown): LiveDistrictId | null => ["customs", "sawmill", "depot", "village"].includes(value as string) ? value as LiveDistrictId : null;
const purposeFrom = (value: unknown): LivePurpose | null => ["pvp", "pve", "loot", "quests", "boss"].includes(value as string) ? value as LivePurpose : null;
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
function liveLootLocation(mapId: LiveMapId, point: LivePoint) {
  const world = maps.get(mapId)!;
  return { world, ...getLiveLootSource(world, point) };
}
export function getLiveLootPool(mapId: LiveMapId, point: LivePoint): { model: LootModel; weight: number }[] {
  return getLiveNamedLootPool(maps.get(mapId)!, point);
}

class LiveError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryAfter?: number) { super(code); }
}
class BossSpawnBlockedError extends Error {}
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
  if (body.type === "attack" && (exactKeys(body, ["type", "targetId"]) || exactKeys(body, ["type", "targetId", "aimed"]) && typeof body.aimed === "boolean") && typeof body.targetId === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(body.targetId)) return { type: "attack", targetId: body.targetId, ...(typeof body.aimed === "boolean" ? { aimed: body.aimed } : {}) };
  if (body.type === "treat" && exactKeys(body, ["type", "medicine", "part"]) && MEDICINES.includes(body.medicine as TreatmentType) && BODY_PARTS.includes(body.part as BodyPart)) return { type: "treat", medicine: body.medicine as TreatmentType, part: body.part as BodyPart };
  if (body.type === "engage" && exactKeys(body, ["type", "targetId"]) && (body.targetId === null || typeof body.targetId === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(body.targetId))) return { type: "engage", targetId: body.targetId };
  if (body.type === "travel" && exactKeys(body, ["type", "mapId"])) {
    const destination = mapFrom(body.mapId);
    if (destination) return { type: "travel", mapId: destination };
  }
  if (["loot", "search"].includes(body.type) && exactKeys(body, ["type", "id"]) && typeof body.id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(body.id)) return { type: body.type as "loot" | "search", id: body.id };
  if (body.type === "patrol" && exactKeys(body, ["type", "enabled"]) && typeof body.enabled === "boolean") return { type: "patrol", enabled: body.enabled };
  if (body.type === 'automation' && (exactKeys(body, ['type', 'enabled']) || exactKeys(body, ['type', 'enabled', 'routeId'])) && typeof body.enabled === 'boolean'
    && (body.routeId === undefined || typeof body.routeId === 'string' && maps.get(mapId)!.routes?.some(route => route.id === body.routeId)))
    return { type: 'automation', enabled: body.enabled, ...(typeof body.routeId === 'string' ? { routeId: body.routeId } : {}) };
  if (["heal", "extract", "resupply", "cancelTreatment", 'recall'].includes(body.type) && exactKeys(body, ["type"])) return { type: body.type as "heal" | "extract" | "resupply" | "cancelTreatment" | 'recall' };
  if (body.type === "respawn" && Object.keys(body).every(key => ["type", "districtId", "purpose", "kitId"].includes(key))
    && (body.districtId === undefined || districtFrom(body.districtId)) && (body.purpose === undefined || purposeFrom(body.purpose)) && (body.kitId === undefined || isLiveKitId(body.kitId)))
    return { type: "respawn", ...(body.districtId ? { districtId: body.districtId as LiveDistrictId } : {}), ...(body.purpose ? { purpose: body.purpose as LivePurpose } : {}), ...(isLiveKitId(body.kitId) ? { kitId: body.kitId } : {}) };
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
    CREATE TABLE IF NOT EXISTS live_bosses(boss_id TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS live_boss_kill_credits(boss_id TEXT NOT NULL, cycle INTEGER NOT NULL, identity TEXT NOT NULL, player_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(boss_id,cycle));
    CREATE TABLE IF NOT EXISTS live_game_owners(owner_key TEXT PRIMARY KEY, game_id TEXT NOT NULL, live_identity TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS live_economy_outbox(id TEXT PRIMARY KEY, identity TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, message TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS live_outbox_pending ON live_economy_outbox(acknowledged,identity);`);
  if (!db.query<{ name: string }, []>("PRAGMA table_info(live_economy_outbox)").all().some(column => column.name === "attempts"))
    db.exec("ALTER TABLE live_economy_outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
  migrateExpandedLiveCoordinates(db, maps.get(DEFAULT_MAP)!);
  const players = new Map<string, Participant>(), scavs = new Map<string, Scav>(), drops = new Map<string, Drop>();
  const bossArenas = new Map(getLiveBossArenas(maps.get(DEFAULT_MAP)!).map(arena => [arena.bossId, arena]));
  let preparedBossCredits: BossKillCredit[] = [];
  const lootCooldowns = new Map<string, number>();
  const lootKey = (mapId: LiveMapId, point: LivePoint, containerId?: string): string => containerId ? `container:${containerId}` : `${mapId}:${point.x}:${point.y}`;
  const freshPath = (): PathCache => ({ path: [], pathGoal: null, replanAt: 0 });
  const startSortie = (player: Participant, routeId?: string): void => {
    const bossPois = [...bossArenas.values()].sort((a, b) => Number(getBoss(b.bossId)!.districtId === player.districtId) - Number(getBoss(a.bossId)!.districtId === player.districtId)
      || distance(player, a.home) - distance(player, b.home)).map(arena => arena.poiId);
    Object.assign(player, createLiveSortie(maps.get(player.mapId)!, player.districtId, player.purpose, now(), routeId, bossPois));
    player.patrol = false; player.destination = null; player.targetId = null; player.searching = null; Object.assign(player, freshPath());
  };
  const pauseSortie = (player: Participant, reason = 'Ручное управление'): void => {
    if (!player.automation || player.automation.stage === 'complete' || player.automation.stage === 'downed') return;
    Object.assign(player.automation, { enabled: false, stage: 'paused', goal: 'Автобой приостановлен', reason, target: null, targetId: null });
  };
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
    const wasAlive = player.health > 0;
    player.body = storedBody(player.body, player.health);
    player.medicine = player.medicine ? parseMedicalInventory(player.medicine) : createMedicalInventory({ medkit: Math.max(0, player.medkits) * 40 });
    player.healthAt = Number.isFinite(player.healthAt) ? player.healthAt : now();
    if (player.automation?.stage !== 'complete') advanceBleeding(player.body, Math.max(0, now() - player.healthAt));
    player.healthAt = now(); player.health = isAlive(player.body) ? healthPercent(player.body) : 0;
    player.medkits = Math.ceil(player.medicine.medkit / 40); player.treatment = null; player.aim = null; player.leaveAt = 0;
    player.dangerUntil = Number.isFinite(player.dangerUntil) ? player.dangerUntil : 0; player.graceUntil = Number.isFinite(player.graceUntil) ? player.graceUntil : 0;
    if (player.health <= 0 && !player.respawnAt) player.respawnAt = now() + RESPAWN_MS;
    const binding = byLive.get(identity);
    if (binding) { player.economyOwner = binding.owner_key; player.gameId = binding.game_id; }
    if (options.economy) player.lootItems ??= [];
    if (player.lootItems) player.lootItems = readEconomyLootItems(player.lootItems, LIVE_LOOT_CAPACITY, LIVE_LOOT_WEIGHT);
    player.targetId = null; player.travelReadyAt ??= 0; player.lastCombatAt ??= 0; player.disconnectAt = 0;
    player.online = false; player.destination = null; player.patrol = false; player.action = player.health <= 0 ? "downed" : "idle";
    if (player.automation) { player.automation.target = null; player.automation.targetId = null; }
    if (wasAlive && player.health <= 0) down(player);
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
  const exposed = (player: Participant): boolean => player.automation?.stage !== 'complete' && (player.online || player.graceUntil > now());
  const occupied = (mapId: LiveMapId, point: LivePoint, exceptId?: string): boolean => {
    for (const player of players.values()) if (player.mapId === mapId && player.id !== exceptId && player.health > 0 && exposed(player) && player.x === point.x && player.y === point.y) return true;
    for (const scav of scavs.values()) if (scav.mapId === mapId && scav.id !== exceptId && scav.health > 0 && scav.x === point.x && scav.y === point.y) return true;
    return false;
  };
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
  const publicEntity = (entity: Participant | Scav): LiveEntity => ({ id: entity.id, kind: entity.kind, name: entity.name, appearance: entity.appearance, health: entity.health, action: entity.action, safeUntil: entity.safeUntil, x: entity.x, y: entity.y, ...(entity.faction ? { faction: entity.faction } : {}), ...(entity.role ? { role: entity.role } : {}), ...(entity.bossId ? { bossId: entity.bossId } : {}), bleeding: BODY_PARTS.some(part => entity.body.parts[part].bleeding !== "none"), limping: injuryEffects(entity.body, now()).movement < 1, ...(entity.aim ? { aimUntil: entity.aim.endsAt, aimTargetId: entity.aim.targetId } : {}) });
  const persist = (): void => {
    db.transaction(() => {
      for (const player of players.values()) savePlayer.run(player.identity, JSON.stringify(durable(player)));
      for (const binding of preparedBindings) db.query("INSERT INTO live_game_owners(owner_key,game_id,live_identity) VALUES(?,?,?)").run(binding.owner_key, binding.game_id, binding.live_identity);
      for (const row of prepared) insertOutbox.run(row.id, row.identity, row.kind, row.payload, row.message);
      for (const boss of scavs.values()) if (boss.bossId) db.query("INSERT INTO live_bosses(boss_id,state) VALUES(?,?) ON CONFLICT(boss_id) DO UPDATE SET state=excluded.state").run(boss.bossId, JSON.stringify(durable(boss)));
      for (const credit of preparedBossCredits) {
        const recorded = db.query("INSERT OR IGNORE INTO live_boss_kill_credits(boss_id,cycle,identity,player_id,created_at) VALUES(?,?,?,?,?)").run(credit.bossId, credit.cycle, credit.identity, credit.playerId, credit.at);
        if (recorded.changes !== 1) continue;
        const loaded = players.get(credit.identity), row = loaded ? undefined : readPlayer.get(credit.identity);
        const player = loaded ?? (row ? JSON.parse(row.state) as Participant : undefined);
        if (!player || player.id !== credit.playerId) continue;
        player.kills++; player.bossKills = (player.bossKills ?? 0) + 1;
        savePlayer.run(credit.identity, JSON.stringify(durable(player)));
      }
      saveWorld.run(JSON.stringify({ version: WORLD_VERSION, geometryVersion: maps.get(DEFAULT_MAP)!.version, startedAt, scavs: [...scavs.values()].filter(scav => !scav.bossId).map(durable), drops: [...drops.values()], events, lootCooldowns: [...lootCooldowns] }));
    })();
    prepared = []; preparedBindings = []; preparedBossCredits = [];
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
      if (row.kind === 'delivery') (payload as LiveDelivery).items = readEconomyLootItems((payload as LiveDelivery).items, LIVE_LOOT_CAPACITY, LIVE_LOOT_WEIGHT);
      let receipt: ReturnType<LiveEconomy['supply']> | undefined, message: string;
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
          if (requested.kitId && (JSON.stringify(receipt.loadout) !== JSON.stringify(getLiveLoadout(requested.kitId)) || receipt.money !== LIVE_FIELD_KITS[requested.kitId].money || receipt.ammo < 1))
            throw new Error('Invalid headquarters field kit receipt');
        }
      } catch (error) {
        // Transport/game availability failures leave the durable parcel for the next tick.
        if (!(error instanceof LiveEconomyError) && !(error instanceof Error)) throw error;
        db.query("UPDATE live_economy_outbox SET message=? WHERE id=? AND acknowledged=0").run("Убежище временно недоступно; груз и запрос сохранены.", row.id);
        continue;
      }
      const dropCount = drops.size;
      const loaded = players.get(row.identity), original = loaded ?? loadPlayer(row.identity);
      if (!original) throw new Error("Pending economy owner has no persistent live player");
      const updated = structuredClone(original);
      if (receipt) {
        const launching = (payload as LiveSupplyRequest).kitId !== undefined;
        if (launching) {
          const pending = updated.entryPending;
          if (!pending || pending.id !== row.id || !receipt.loadout) throw new Error('Field kit receipt has no matching saved entry');
          // A corpse's remaining medicines and ammunition cannot be carried into a newly paid life.
          updated.ammo = 0; updated.medicine = createMedicalInventory({ medkit: 0, bandage: 0, tourniquet: 0, splint: 0, painkiller: 0, surgery: 0 });
          updated.loadout = { ...receipt.loadout };
          updated.safeUntil = now() + 5000;
          if (pending.respawn) {
            updated.body = createHealth(); updated.health = 100;
            updated.healthAt = now(); updated.treatment = null; updated.aim = null; updated.leaveAt = 0;
            const point = clear(updated.mapId, pending, updated.id) ? pending : nearestFree(pending, pending.districtId);
            updated.x = point.x; updated.y = point.y; updated.districtId = pending.districtId; updated.purpose = pending.purpose;
            updated.cargo = 0; updated.lootItems = []; updated.respawnAt = 0; updated.safeUntil = now() + 5000;
            updated.dangerUntil = 0; updated.graceUntil = 0; updated.disconnectAt = 0; updated.destination = null; updated.action = 'idle';
            updated.nextAttack = 0; updated.targetId = null; updated.patrol = false; updated.searching = null; Object.assign(updated, freshPath());
          }
          delete updated.entryPending;
          if (pending.automatic) startSortie(updated);
        }
        if (updated.ammo + receipt.ammo > (updated.loadout?.maxAmmo ?? 60)) throw new Error("Supply would exceed live capacity");
        updated.ammo += receipt.ammo;
        // The same acknowledgement commits all physical field medicines. An
        // accepted receipt can never replay or produce free stock on respawn.
        updated.medicine.medkit = Math.min(Math.max(LIVE_MEDICAL_CAPACITY.medkit, updated.medicine.medkit), updated.medicine.medkit + receipt.medkits * 40);
        for (const type of ['bandage', 'tourniquet', 'splint', 'painkiller', 'surgery'] as const)
          updated.medicine[type] = Math.min(Math.max(LIVE_MEDICAL_CAPACITY[type], updated.medicine[type]), updated.medicine[type] + receipt.medkits);
        updated.medkits = Math.ceil(updated.medicine.medkit / 40);
      }
      updated.economyMessage = message;
      // A retry after an accepted game debit reuses the receipt; applying it and acknowledging it are atomic here.
      db.transaction(() => {
        const changed = db.query("UPDATE live_economy_outbox SET acknowledged=1,message=? WHERE id=? AND acknowledged=0").run(message, row.id);
        if (changed.changes !== 1) throw new Error("Economy parcel changed during acknowledgement");
        savePlayer.run(updated.identity, JSON.stringify(durable(updated)));
        // Loading an offline wounded body can cause death and drop its remaining
        // inventory. Commit that drop with the saved body, even during startup recovery.
        if (drops.size !== dropCount) saveWorld.run(JSON.stringify({ version: WORLD_VERSION, geometryVersion: maps.get(DEFAULT_MAP)!.version, startedAt,
          scavs: [...scavs.values()].map(durable), drops: [...drops.values()], events, lootCooldowns: [...lootCooldowns] }));
      })();
      if (loaded) { Object.assign(loaded, updated); if (!updated.entryPending) delete loaded.entryPending; }
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
      health: point ? 100 : 0, body: storedBody(undefined, point ? 100 : 0), healthAt: now(), aim: null, action: point ? "idle" : "downed", safeUntil: 0, respawnAt: point ? 0 : now() + 1000, nextMove: now() + 750, nextAttack: now() + 1000 };
  };
  const insideBossArena = (bossId: BossId, point: LivePoint): boolean => {
    const arena = bossArenas.get(bossId)!, area = arena.area;
    return districtAt(point) === getBoss(bossId)!.districtId && point.x >= area.x && point.y >= area.y && point.x < area.x + area.width && point.y < area.y + area.height
      && distance(arena.home, point) <= 16 && walkable(DEFAULT_MAP, point);
  };
  const bossSpawnPoint = (bossId: BossId): LivePoint => {
    const arena = bossArenas.get(bossId)!, candidates: LivePoint[] = [];
    for (let y = arena.area.y; y < arena.area.y + arena.area.height; y++) for (let x = arena.area.x; x < arena.area.x + arena.area.width; x++) {
      const point = { x, y };
      if (insideBossArena(bossId, point) && clear(DEFAULT_MAP, point, `boss-${bossId}`)) candidates.push(point);
    }
    const point = candidates.sort((a, b) => distance(arena.home, a) - distance(arena.home, b) || a.y - b.y || a.x - b.x)[0];
    if (!point) throw new BossSpawnBlockedError(`Boss arena has no available spawn: ${bossId}`);
    return point;
  };
  const spawnBoss = (bossId: BossId, cycle = 1): Scav => {
    const definition = getBoss(bossId)!, arena = bossArenas.get(bossId)!, point = bossSpawnPoint(bossId);
    return { ...point, ...freshPath(), id: `boss-${bossId}`, bossId, bossCycle: cycle, bossDeathSettled: false,
      mapId: DEFAULT_MAP, kind: 'scav', name: definition.name, appearance: 28 + BOSSES.findIndex(boss => boss.id === bossId), faction: 'raiders', role: 'guard',
      home: { ...arena.home }, route: [{ ...arena.home }], routeIndex: 0, spawnIndex: -1, health: 100, body: createHealth(), healthAt: now(),
      aim: null, action: 'idle', safeUntil: 0, respawnAt: 0, nextMove: now() + 750, nextAttack: now() + 1000 };
  };
  const loadBoss = (bossId: BossId): Scav => {
    const row = db.query<{ state: string }, [string]>("SELECT state FROM live_bosses WHERE boss_id=?").get(bossId);
    if (!row) return spawnBoss(bossId);
    const stored = JSON.parse(row.state) as Scav;
    if (stored.bossId !== bossId || stored.id !== `boss-${bossId}` || !Number.isSafeInteger(stored.bossCycle) || stored.bossCycle! < 1
      || typeof stored.bossDeathSettled !== 'boolean' || !Number.isSafeInteger(stored.respawnAt) || stored.respawnAt < 0
      || !Number.isSafeInteger(stored.healthAt) || stored.healthAt < 0) throw new Error('Invalid stored live boss');
    const arena = bossArenas.get(bossId)!, definition = getBoss(bossId)!;
    stored.body = parseHealth(stored.body); stored.health = isAlive(stored.body) ? healthPercent(stored.body) : 0;
    if (stored.bossDeathSettled && stored.health > 0) throw new Error('Invalid living settled boss');
    if (stored.bossLastHit && (!isObject(stored.bossLastHit) || typeof stored.bossLastHit.identity !== 'string' || typeof stored.bossLastHit.playerId !== 'string'
      || !Number.isSafeInteger(stored.bossLastHit.at) || stored.bossLastHit.at < 0)) throw new Error('Invalid stored boss hit');
    if (!insideBossArena(bossId, stored)) Object.assign(stored, bossSpawnPoint(bossId));
    Object.assign(stored, freshPath(), { mapId: DEFAULT_MAP, kind: 'scav', name: definition.name, faction: 'raiders', role: 'guard', home: { ...arena.home }, route: [{ ...arena.home }], routeIndex: 0, spawnIndex: -1, aim: null });
    stored.healthAt = Math.min(now(), stored.healthAt);
    return stored;
  };
  const rollItems = (mapId: LiveMapId, point: LivePoint): EconomyLoot[] => {
    const pool = getLiveLootPool(mapId, point), location = liveLootLocation(mapId, point);
    const odds = getLiveLootFamilyOdds(location.world.containers.find(anchor => anchor.x === point.x && anchor.y === point.y)?.lootTable);
    const count = random() < .35 ? 2 : 1, result: EconomyLoot[] = [];
    for (let index = 0; index < count; index++) {
      const item = { id: randomUUID(), ...rollLiveLootModel(location.sector, location.branch, location.depth, pool, random, odds), foundAt: now() };
      if (result.reduce((sum, value) => sum + getLiveLootWeight(value), 0) + getLiveLootWeight(item) <= LIVE_LOOT_WEIGHT) result.push(item);
    }
    return result;
  };
  const addDrop = (mapId: LiveMapId, point: LivePoint, amount: number, source: Drop["source"] = "body", items?: EconomyLoot[], boss?: { bossId: BossId; expiresAt: number }): void => {
    const id = randomUUID();
    const generated = options.economy && items === undefined ? rollItems(mapId, point) : items;
    const container = source === "supply" ? maps.get(mapId)!.containers.find(anchor => anchor.x === point.x && anchor.y === point.y) : undefined;
    drops.set(id, { mapId, id, x: point.x, y: point.y, amount: generated && items === undefined ? 0 : amount, source, ...(generated ? { items: structuredClone(generated) } : {}),
      ...(container ? { containerId: container.id, containerKind: container.kind } : {}), ...(boss ? { bossId: boss.bossId } : {}), expiresAt: boss?.expiresAt ?? (container ? Number.MAX_SAFE_INTEGER : now() + 120_000) });
  };
  const stored = db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get();
  if (stored) {
    const world = JSON.parse(stored.state) as { version?: number; geometryVersion?: string; startedAt: number; scavs: Scav[]; drops: Drop[]; events: MapEvent[]; lootCooldowns?: Array<[string, number]> };
    startedAt = world.startedAt;
    // Old NPC layouts are replaced once; verified player bodies and dropped cargo are retained.
    for (const [index, scav] of (world.version === WORLD_VERSION && world.geometryVersion === maps.get(DEFAULT_MAP)!.version ? world.scavs : []).entries()) {
      if (scav.bossId || scav.id.startsWith('boss-')) continue;
      scav.mapId = mapFrom(scav.mapId) ?? DEFAULT_MAP;
      if (!walkable(scav.mapId, scav)) Object.assign(scav, pickPoint(scav.mapId));
      scav.faction = scav.faction === "raiders" ? "raiders" : "scavs";
      scav.role = ["patrol", "guard", "marksman"].includes(scav.role) ? scav.role : "patrol";
      scav.home = scav.home && walkable(scav.mapId, scav.home) ? scav.home : { x: scav.x, y: scav.y };
      scav.route = scav.route?.filter(point => walkable(scav.mapId, point)) ?? [scav.home];
      if (!scav.route.length) scav.route = [scav.home];
      scav.routeIndex ??= 0; scav.spawnIndex ??= index; Object.assign(scav, freshPath());
      scav.body = storedBody(scav.body, scav.health); scav.healthAt = now(); scav.aim = null;
      scav.health = isAlive(scav.body) ? healthPercent(scav.body) : 0;
      scavs.set(scav.id, scav);
    }
    const claimedAnchors = new Set<string>(), currentWorld = maps.get(DEFAULT_MAP)!;
    for (const drop of world.drops) {
      if (drop.items) drop.items = readEconomyLootItems(drop.items, LIVE_LOOT_CAPACITY, LIVE_LOOT_WEIGHT);
      if (drop.bossId && (!getBoss(drop.bossId) || drop.source !== 'body' || drop.containerId)) throw new Error('Invalid stored boss corpse');
      // A geometry revision moves existing cycles; it never rolls replacements for their contents.
      if (drop.source === "supply" && drop.containerId) {
        const anchor = migratedContainerAnchor(currentWorld, drop.containerId);
        if (anchor && !claimedAnchors.has(anchor.id)) {
          Object.assign(drop, { mapId: DEFAULT_MAP, x: anchor.x, y: anchor.y, containerId: anchor.id, containerKind: anchor.kind });
          if (drop.expiresAt > now()) claimedAnchors.add(anchor.id);
        } else {
          // Retired/duplicate anchors become loose cargo with the same drop and item identities.
          delete drop.containerId; delete drop.containerKind; drop.source = "body";
        }
      } else if (drop.source === "supply" && (world.version !== WORLD_VERSION || world.geometryVersion !== currentWorld.version)) drop.source = "body";
      if (drop.mapId !== DEFAULT_MAP) Object.assign(drop, translateLegacy(drop, drop.mapId));
      drop.mapId = mapFrom(drop.mapId) ?? DEFAULT_MAP;
      if (!walkable(drop.mapId, drop)) Object.assign(drop, nearestFree(drop, districtAt(drop)));
      if (drop.expiresAt > now() && walkable(drop.mapId, drop)) drops.set(drop.id, drop);
    }
    if (world.version === WORLD_VERSION && world.geometryVersion === maps.get(DEFAULT_MAP)!.version) {
      events = world.events.slice(-120).map(item => ({ ...item, mapId: DEFAULT_MAP }));
    }
    for (const [previousKey, ready] of world.lootCooldowns ?? []) if (Number.isFinite(ready) && ready > now()) {
      const key = migratedLootCooldownKey(currentWorld, previousKey);
      if (key) lootCooldowns.set(key, Math.max(ready, lootCooldowns.get(key) ?? 0));
    }
  }
  for (const map of LIVE_MAPS) {
    if (![...scavs.values()].some(scav => scav.mapId === map.id && !scav.bossId)) for (let index = 0; index < map.npcSpawns.length; index++) {
      const scav = spawnScav(map.id, index); scavs.set(scav.id, scav);
    }
    for (const anchor of map.containers) if (![...drops.values()].some(drop => drop.containerId === anchor.id) && (lootCooldowns.get(lootKey(map.id, anchor, anchor.id)) ?? 0) <= now()) addDrop(map.id, anchor, 10 + Math.floor(random() * 21), "supply");
  }
  for (const definition of BOSSES) { const boss = loadBoss(definition.id); scavs.set(boss.id, boss); }
  const routeSummaries = (maps.get(DEFAULT_MAP)!.routes ?? []).map(route => ({ id: route.id, name: route.name, description: route.description,
    districtId: route.districtId, purpose: route.purpose, stops: route.poiIds.map(id => maps.get(DEFAULT_MAP)!.pois.find(poi => poi.id === id)!.name) }));
  const status = (includeRoutes = true): LiveStatus => ({ id: LIVE_SERVER_ID, name: LIVE_SERVER_NAME, online: [...players.values()].filter(player => player.online && exposed(player)).length, capacity: LIVE_CAPACITY, startedAt,
    ...(includeRoutes ? { routes: routeSummaries } : {}),
    bosses: BOSSES.map(definition => {
      const boss = scavs.get(`boss-${definition.id}`)!, arena = bossArenas.get(definition.id)!;
      return { bossId: definition.id, name: definition.name, districtId: definition.districtId, poiId: arena.poiId, area: { ...arena.area }, state: boss.health > 0 ? 'alive' : 'defeated', respawnAt: boss.health > 0 ? 0 : boss.respawnAt };
    }),
    maps: LIVE_MAPS.map(map => ({ id: map.id, name: map.name, description: map.description, theme: map.theme, width: map.width, height: map.height,
      ...(includeRoutes && map.city ? { city: map.city } : {}),
      online: [...players.values()].filter(player => player.online && exposed(player) && player.mapId === map.id).length, npcs: [...scavs.values()].filter(scav => scav.mapId === map.id && scav.health > 0).length })),
    districts: maps.get(DEFAULT_MAP)!.districts.map(district => ({ ...district,
      online: [...players.values()].filter(player => player.online && exposed(player) && districtAt(player) === district.id).length,
      npcs: [...scavs.values()].filter(scav => scav.health > 0 && districtAt(scav) === district.id).length })) });
  const lineOfSight = (mapId: LiveMapId, a: LivePoint, b: LivePoint): boolean => navigation.get(mapId)!.hasLineOfSight(a, b);
  const snapshot = (player: Participant, request?: Request): Omit<LiveSnapshot, "world"> & { world?: LiveWorld } => {
    const world = worldFor(player.mapId), visible = (point: LivePoint): boolean => distance(player, point) <= VISION_RADIUS && lineOfSight(player.mapId, player, point);
    const automation = player.automation ? structuredClone(player.automation) : undefined;
    if (automation?.targetId) {
      const target = drops.get(automation.targetId) ?? [...players.values(), ...scavs.values()].find(entity => entity.id === automation.targetId && entity.health > 0);
      if (!target || !visible(target)) { automation.targetId = null; automation.target = null; }
    }
    player.districtId = districtAt(player);
    const chunkX = Math.floor(player.x / world.chunkSize), chunkY = Math.floor(player.y / world.chunkSize), visibleChunks: LivePoint[] = [];
    for (let y = chunkY - 1; y <= chunkY + 1; y++) for (let x = chunkX - 1; x <= chunkX + 1; x++) if (x >= 0 && y >= 0 && x * world.chunkSize < world.width && y * world.chunkSize < world.height) visibleChunks.push({ x, y });
    return {
      server: status(false), now: now(), ...(request?.headers.get("x-prapor-world-version") === world.version ? {} : { world }), worldVersion: world.version, visibleChunks, selfId: player.id,
      self: { id: player.id, ammo: player.ammo, medkits: Math.ceil(player.medicine.medkit / 40), cargo: player.cargo, stash: player.stash, kills: player.kills, bossKills: player.bossKills ?? 0, respawnAt: player.respawnAt, patrol: player.patrol, targetId: automation?.enabled ? automation.stage === 'combat' ? automation.targetId : null : player.targetId, travelReadyAt: player.travelReadyAt,
        ...(player.loadout ? { loadout: { ...player.loadout } } : {}), ...(player.entryPending ? { launchPending: true } : {}), ...(automation ? { automation } : {}),
        body: player.body, medicine: player.medicine, treatment: player.treatment, leaveAt: player.leaveAt, districtId: player.districtId, purpose: player.purpose, searching: player.searching ? { ...player.searching } : null,
        ...(options.economy ? { gameId: player.gameId, lootItems: structuredClone(player.lootItems ?? []),
          pendingDelivery: pendingRows.all(player.identity).filter(row => row.kind === "delivery").map(row => {
            const parcel = JSON.parse(row.payload) as LiveDelivery;
            return { items: parcel.items, money: parcel.money, message: row.message };
          }), economyMessage: player.economyMessage ?? "Находки с выхода поступают в убежище; пополнение расходует его запасы." } : {}) },
      entities: [...players.values()].filter(other => other.mapId === player.mapId && (other.id === player.id || exposed(other) && visible(other))).map(publicEntity)
        .concat([...scavs.values()].filter(scav => scav.mapId === player.mapId && visible(scav)).map(publicEntity)),
      // Dense fights can leave more cargo than one bounded packet can contain.
      // Project a stable page; keep every physical UUID in the durable world.
      drops: [...drops.values()].filter(drop => drop.mapId === player.mapId && visible(drop)).sort((a, b) =>
        Number(b.id === player.searching?.id) - Number(a.id === player.searching?.id)
        || Number(Boolean(b.containerId)) - Number(Boolean(a.containerId))
        || distance(player, a) - distance(player, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, VISIBLE_DROP_CAPACITY).map(drop => {
        const searched = player.searchedDropIds.includes(drop.id);
        return { id: drop.id, x: drop.x, y: drop.y, amount: !drop.containerId || searched ? drop.amount : 0,
          ...(drop.bossId ? { bossId: drop.bossId } : {}),
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
      const occupiedCells = new Set<number>();
      for (const other of players.values()) if (other.id !== entity.id && other.mapId === entity.mapId && other.health > 0 && exposed(other)) occupiedCells.add(nav.key(other));
      for (const other of scavs.values()) if (other.id !== entity.id && other.mapId === entity.mapId && other.health > 0) occupiedCells.add(nav.key(other));
      entity.path = nav.findPath(entity, destination, occupiedCells) ?? [];
      entity.pathGoal = { ...destination }; entity.replanAt = now() + 1000;
    }
    const step = entity.path[0];
    if (!step || !clear(entity.mapId, step, entity.id)) return null;
    entity.path.shift(); return step;
  };
  const down = (target: Participant | Scav, attacker?: Participant | Scav, defeatedAt = now()): void => {
    if (!isParticipant(target) && target.bossId) {
      if (target.bossDeathSettled) return;
      const definition = getBoss(target.bossId)!;
      const items: EconomyLoot[] = [
        { id: randomUUID(), modelId: definition.trophyModelId, foundAt: defeatedAt },
        { id: randomUUID(), modelId: definition.lootModelId, foundAt: defeatedAt },
        { id: randomUUID(), kind: 'gear', modelId: definition.gearModelId, durability: 90, foundAt: defeatedAt },
        { id: randomUUID(), kind: 'module', modelId: definition.moduleModelId, durability: 90, foundAt: defeatedAt },
      ];
      // The complete authored reward is validated, never trimmed or rolled again on a retry.
      readEconomyLootItems(items, LIVE_LOOT_CAPACITY, LIVE_LOOT_WEIGHT);
      target.health = 0; target.action = 'downed'; target.aim = null; target.bossDeathSettled = true;
      target.respawnAt = defeatedAt + definition.live.respawnMs;
      addDrop(target.mapId, target, definition.bounty, 'body', items, { bossId: target.bossId, expiresAt: defeatedAt + definition.live.corpseMs });
      const direct = attacker && isParticipant(attacker) ? { identity: attacker.identity, playerId: attacker.id, at: defeatedAt } : undefined;
      const credit = direct ?? (target.bossLastHit && defeatedAt >= target.bossLastHit.at && defeatedAt - target.bossLastHit.at <= DISCONNECT_GRACE_MS ? target.bossLastHit : undefined);
      if (credit) preparedBossCredits.push({ ...credit, bossId: target.bossId, cycle: target.bossCycle! });
      event(target.mapId, 'combat', `${definition.name} повержен. Трофеи лежат на месте боя; новый выход через ${definition.live.respawnMs / 60_000} минут.`, direct?.playerId ?? credit?.playerId, target.id);
      return;
    }
    target.health = 0; target.action = "downed"; target.respawnAt = now() + RESPAWN_MS; target.aim = null;
    const amount = "cargo" in target ? target.cargo : 25 + Math.floor(random() * 26);
    if ("cargo" in target) {
      if (amount > 0 || target.lootItems?.length) addDrop(target.mapId, target, amount, "body", target.lootItems ?? []);
      target.cargo = 0; if (options.economy) target.lootItems = [];
      target.destination = null; target.patrol = false; target.targetId = null; target.treatment = null; target.searching = null; Object.assign(target, freshPath());
      if (target.automation) Object.assign(target.automation, { enabled: false, stage: 'downed', goal: 'Боец погиб', target: null, targetId: null, reason: 'Груз остался на месте боя', completedAt: defeatedAt });
    } else if (amount > 0) addDrop(target.mapId, target, amount);
    if (attacker && "kills" in attacker) attacker.kills++;
    event(target.mapId, "combat", attacker ? `${attacker.name} победил ${target.name}.` : `${target.name} погиб от кровопотери.`, attacker?.id, target.id);
  };
  const settleBossHealth = (boss: Scav, time: number): void => {
    if (!boss.bossId || boss.bossDeathSettled) return;
    const elapsed = Math.max(0, time - boss.healthAt);
    const rate = BODY_PARTS.reduce((sum, part) => sum + (boss.body.parts[part].bleeding === 'heavy' ? 250 : boss.body.parts[part].bleeding === 'light' ? 50 : 0), 0);
    const fatalMs = rate ? Math.min(Math.ceil(boss.body.parts.head.hp * 1_000_000 / rate), Math.ceil(boss.body.parts.chest.hp * 1_000_000 / rate)) : Infinity;
    const defeatedAt = boss.healthAt + Math.min(elapsed, fatalMs);
    advanceBleeding(boss.body, elapsed); boss.healthAt = time;
    boss.health = isAlive(boss.body) ? healthPercent(boss.body) : 0;
    if (boss.health <= 0) down(boss, undefined, Math.max(0, defeatedAt));
  };
  const findTarget = (id: string): Participant | Scav | undefined => [...players.values(), ...scavs.values()].find(target => target.id === id);
  const rangeOf = (entity: Participant | Scav): number => isParticipant(entity) && entity.loadout ? entity.loadout.range : entity.bossId ? getBoss(entity.bossId)!.live.range : entity.kind === "player" || "role" in entity && entity.role === "marksman" ? 7 : 5;
  const attackTarget = (attacker: Participant | Scav, target: Participant | Scav): void => {
    if (!isParticipant(attacker) && (target.bossId || attacker.bossId && !isParticipant(target))) throw new LiveError(409, 'target_unavailable');
    if (target.mapId !== attacker.mapId || target.health <= 0 || attacker.health <= 0 || target.id === attacker.id || "online" in target && !exposed(target)) throw new LiveError(409, "target_unavailable");
    if (now() < target.safeUntil) throw new LiveError(409, "spawn_protection");
    if (distance(attacker, target) > rangeOf(attacker) || !lineOfSight(attacker.mapId, attacker, target)) throw new LiveError(409, "target_out_of_range");
    if ("ammo" in attacker && attacker.ammo <= 0) throw new LiveError(409, "no_ammo");
  };
  const cancelTreatment = (player: Participant): void => {
    if (player.treatment) { player.treatment = null; event(player.mapId, "combat", `${player.name} прервал лечение; средство сохранено.`, player.id); }
  };
  const shot = (attacker: Participant | Scav, target: Participant | Scav, part: BodyPart, aimed = false): void => {
    attackTarget(attacker, target);
    if ("ammo" in attacker) { attacker.ammo--; attacker.destination = null; attacker.dangerUntil = now() + DISCONNECT_GRACE_MS; cancelTreatment(attacker); attacker.searching = null; Object.assign(attacker, freshPath()); }
    if ("dangerUntil" in target) target.dangerUntil = now() + DISCONNECT_GRACE_MS;
    if (isParticipant(attacker)) attacker.lastCombatAt = now();
    if (isParticipant(target)) target.lastCombatAt = now();
    if (isParticipant(target)) target.threatId = attacker.id;
    attacker.safeUntil = 0; attacker.action = "combat"; attacker.aim = null;
    const outgoing = attacker.bossId ? getBoss(attacker.bossId)!.live.outgoingDamage : 1, incoming = target.bossId ? getBoss(target.bossId)!.live.incomingDamage : 1;
    const damage = (isParticipant(attacker) && attacker.loadout ? attacker.loadout.damage + (aimed ? 5 : 0) : aimed ? 45 : attacker.kind === "player" ? 40 : "faction" in attacker && attacker.faction === "raiders" ? 33 : 25) * outgoing * incoming;
    const protection = isParticipant(target) && target.loadout ? part === 'head' ? target.loadout.helmetProtection : ['chest', 'stomach'].includes(part) ? target.loadout.armorProtection : 0 : LIVE_PROTECTION[part] ?? 0;
    const roll = random(), result = applyHit(target.body, part, damage, { protection, penetration: .1,
      ...(roll < .16 ? { bleeding: "heavy" as const } : roll < .4 ? { bleeding: "light" as const } : {}),
      ...(!["head", "chest", "stomach"].includes(part) && roll < .2 ? { fracture: true } : {}) });
    if (result.damage > 0 && isParticipant(target)) { cancelTreatment(target); target.searching = null; Object.assign(target, freshPath()); }
    if (result.damage > 0 && target.bossId && !isParticipant(target) && isParticipant(attacker)) target.bossLastHit = { identity: attacker.identity, playerId: attacker.id, at: now() };
    target.health = isAlive(target.body) ? healthPercent(target.body) : 0;
    const wound = target.body.parts[part];
    event(attacker.mapId, "combat", `${attacker.name} → ${target.name}: ${BODY_PART_LABELS[part]}, −${Math.round(result.damage)} HP${result.absorbed > 0 ? `; броня остановила ${Math.round(result.absorbed)}` : ""}${wound.bleeding !== "none" ? `; ${wound.bleeding === "heavy" ? "тяжёлое" : "лёгкое"} кровотечение` : ""}${wound.fracture ? "; перелом" : ""}${wound.hp <= 0 ? "; зона выбита" : ""}.`, attacker.id, target.id, { from: { x: attacker.x, y: attacker.y }, to: { x: target.x, y: target.y }, damage: result.damage });
    if (target.health <= 0) down(target, attacker);
  };
  const randomPart = (): BodyPart => {
    const roll = random();
    return roll < .45 ? "chest" : roll < .65 ? "stomach" : roll < .735 ? "leftArm" : roll < .82 ? "rightArm" : roll < .91 ? "leftLeg" : "rightLeg";
  };
  const attack = (attacker: Participant | Scav, target: Participant | Scav, aimed = false): void => {
    attackTarget(attacker, target);
    if (attacker.nextAttack > now() || attacker.aim) throw new LiveError(429, "action_cooldown", 1);
    const effects = injuryEffects(attacker.body, now()), slowdown = Math.max(.25, effects.aim * effects.reload);
    if ("destination" in attacker) { attacker.destination = null; cancelTreatment(attacker); attacker.searching = null; Object.assign(attacker, freshPath()); }
    attacker.safeUntil = 0;
    if (aimed || attacker.kind === "scav") {
      attacker.aim = { targetId: target.id, endsAt: now() + Math.ceil((aimed ? 1800 : 1000) / slowdown), part: aimed ? "head" : randomPart() };
      attacker.action = "combat"; attacker.nextAttack = attacker.bossId ? now() + Math.ceil(getBoss(attacker.bossId)!.live.attackMs / slowdown) : attacker.aim.endsAt + Math.ceil((isParticipant(attacker) && attacker.loadout ? attacker.loadout.attackMs : aimed ? 2000 : 1500) / slowdown);
      if ("dangerUntil" in attacker) attacker.dangerUntil = now() + DISCONNECT_GRACE_MS;
      if ("dangerUntil" in target) target.dangerUntil = now() + DISCONNECT_GRACE_MS;
      if (isParticipant(attacker)) attacker.lastCombatAt = now();
      if (isParticipant(target)) target.lastCombatAt = now();
      if (isParticipant(target)) target.threatId = attacker.id;
      event(attacker.mapId, "combat", `${attacker.name} ${aimed ? "готовит прицельный выстрел в голову" : "прицеливается"} в ${target.name}: найди укрытие.`, attacker.id, target.id);
    } else {
      attacker.nextAttack = now() + Math.ceil((isParticipant(attacker) && attacker.loadout ? attacker.loadout.attackMs : 900) / slowdown); shot(attacker, target, randomPart());
    }
  };
  const finishSearch = (player: Participant): void => {
    if (!player.searching) return;
    const drop = drops.get(player.searching.id);
    if (!player.online || player.disconnectAt > 0 || player.leaveAt > 0 || player.treatment || player.aim || player.health <= 0 || !drop || drop.expiresAt <= now() || !drop.containerId || distance(player, drop) > 1.5 || !lineOfSight(player.mapId, player, drop)) {
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
      && items.reduce((sum, item) => sum + getLiveLootWeight(item), 0) <= LIVE_LOOT_WEIGHT + 1e-9;
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
    const names = drop.items?.slice(0, 4).map(item => getLiveLootDefinition(item).label).join(", ");
    event(player.mapId, "loot", drop.items?.length ? `${player.name} забрал: ${names}${drop.items.length > 4 ? ` и ещё ${drop.items.length - 4}` : ""}${drop.amount ? ` и ${drop.amount} ₽` : ""}.` : `${player.name} забрал груз: ${drop.amount}.`, player.id);
  };
  const respawn = (player: Participant, districtId = player.districtId, purpose = player.purpose): void => {
    if (player.health > 0) throw new LiveError(409, "already_alive");
    if (player.respawnAt > now()) throw new LiveError(409, "respawn_not_ready");
    const point = pickPoint(player.mapId, true, districtId);
    player.body = createHealth(); player.treatment = null; player.healthAt = now(); player.aim = null; player.leaveAt = 0; player.dangerUntil = 0; player.graceUntil = 0; player.disconnectAt = 0;
    player.x = point.x; player.y = point.y; player.health = 100; player.cargo = 0;
    if (!options.economy) { player.ammo = 60; player.medicine = createMedicalInventory(); player.medkits = Math.ceil(player.medicine.medkit / 40); }
    else player.lootItems = [];
    player.respawnAt = 0; player.safeUntil = now() + 5000; player.destination = null; player.action = "idle"; player.nextAttack = 0; player.targetId = null; player.patrol = false;
    player.districtId = districtId; player.purpose = purpose; player.searching = null; Object.assign(player, freshPath());
    startSortie(player);
    event(player.mapId, "respawn", `${player.name} вернулся в район «${maps.get(player.mapId)!.districts.find(district => district.id === districtId)!.name}».`, player.id);
  };
  const startTreatment = (player: Participant, type: TreatmentType, part: BodyPart): void => {
    if (player.treatment) throw new LiveError(409, "treatment_in_progress");
    const validation = canTreat(player.body, player.medicine, type, part, now());
    if (!validation.ok) throw new LiveError(409, "medicine_unavailable");
    player.destination = null; player.aim = null; player.leaveAt = 0; player.targetId = null; player.searching = null; Object.assign(player, freshPath()); player.action = "idle";
    player.treatment = { type, part, startedAt: now(), endsAt: now() + Math.ceil(TREATMENT_DURATION_MS[type] * injuryEffects(player.body, now()).treatment) };
    event(player.mapId, "combat", `${player.name} начинает лечение: ${TREATMENT_LABELS[type]}, ${BODY_PART_LABELS[part]}.`, player.id);
  };
  const extractCargo = (player: Participant): void => {
    if (!maps.get(player.mapId)!.extracts.some(exit => distance(player, exit) <= 1.5)) throw new LiveError(409, 'extract_out_of_range');
    if (options.economy && player.lastCombatAt > now() - COMBAT_TRAVEL_MS) throw new LiveError(409, 'in_combat');
    const amount = player.cargo + (options.economy ? player.stash : 0), itemCount = player.lootItems?.length ?? 0;
    prepareDelivery(player);
    if (!options.economy) { player.ammo = 60; player.medicine = createMedicalInventory(); player.medkits = Math.ceil(player.medicine.medkit / 40); }
    player.destination = null; player.patrol = false; player.targetId = null; player.searching = null; Object.assign(player, freshPath());
    event(player.mapId, 'extract', options.economy ? `${player.name} отправил в убежище: ${itemCount} находок и ${amount} ₽.`
      : amount ? `${player.name} сохранил груз: ${amount}.` : `${player.name} пополнил боекомплект на выходе.`, player.id);
  };
  const returnSortie = (player: Participant, reason: string): void => {
    if (!player.automation || !player.sortie) startSortie(player);
    player.sortie!.recalling = true;
    player.sortie!.extractTarget = null; player.sortie!.blockedExtractKeys = []; player.sortie!.blockedAt = 0;
    Object.assign(player.automation!, { enabled: true, stage: 'extract', goal: 'Возвращение к выходу', reason, targetId: null, target: null });
    player.targetId = null; player.destination = null; player.searching = null; player.patrol = false; Object.assign(player, freshPath());
  };
  /** Pick a legal adjacent approach if another actor occupies a public landmark. */
  const approachPoint = (player: Participant, point: LivePoint, corners = false): LivePoint | null => {
    return [point, { x: point.x + 1, y: point.y }, { x: point.x - 1, y: point.y }, { x: point.x, y: point.y + 1 }, { x: point.x, y: point.y - 1 },
      ...(corners ? [{ x: point.x - 1, y: point.y - 1 }, { x: point.x + 1, y: point.y - 1 }, { x: point.x - 1, y: point.y + 1 }, { x: point.x + 1, y: point.y + 1 }] : [])]
      .filter(candidate => clear(player.mapId, candidate, player.id)).sort((a, b) => distance(player, a) - distance(player, b))[0] ?? null;
  };
  const automaticOrders = (player: Participant): boolean => {
    const automatic = player.automation, plan = player.sortie;
    if (!automatic?.enabled || !plan) return false;
    const world = maps.get(player.mapId)!, time = now();
    const observe = (point: LivePoint) => distance(player, point) <= VISION_RADIUS && lineOfSight(player.mapId, player, point);
    const status = (stage: NonNullable<LivePlayer['automation']>['stage'], goal: string, target: LivePoint | null = null, targetId: string | null = null): void => {
      Object.assign(automatic, { stage, goal, target: target ? { x: target.x, y: target.y } : null, targetId });
      player.targetId = stage === 'combat' ? targetId : null;
    };
    const navigate = (point: LivePoint, stage: 'route' | 'loot' | 'extract', goal: string, targetId: string | null = null): void => {
      status(stage, goal, point, targetId);
      const destination = approachPoint(player, point, stage === 'extract');
      if (!destination) { player.destination = null; plan.blockedAt ||= time; return; }
      if (player.destination?.x !== destination.x || player.destination?.y !== destination.y) Object.assign(player, freshPath());
      player.destination = { x: destination.x, y: destination.y };
    };
    const weight = (player.lootItems ?? []).reduce((sum, item) => sum + getLiveLootWeight(item), 0);
    if (!plan.recalling) {
      const reason = player.ammo <= Math.max(3, Math.floor((player.loadout?.maxAmmo ?? 60) * .15)) ? 'Боекомплект на исходе'
        : player.health < 40 ? 'Критическое состояние'
        : weight >= LIVE_LOOT_WEIGHT * .8 || (player.lootItems?.length ?? 0) >= 24 || player.cargo >= 400 ? 'Рюкзак заполнен'
        : time - automatic.startedAt >= 12 * 60_000 ? 'Пора возвращаться'
        : null;
      if (reason) returnSortie(player, reason);
    }
    // Automation has the same sight and protection rules as a browser command.
    // Non-PvP plans defend against players only when that player threatened them.
    const hostiles = [...players.values(), ...scavs.values()].filter(target => target.id !== player.id && target.mapId === player.mapId
      && target.health > 0 && target.safeUntil <= time && (!isParticipant(target) || exposed(target)) && observe(target)
      && (!isParticipant(target) || player.purpose === 'pvp' || player.threatId === target.id && player.lastCombatAt > time - COMBAT_TRAVEL_MS))
      .sort((a, b) => Number(b.id === player.threatId) - Number(a.id === player.threatId)
        || (player.purpose === 'pvp' ? Number(isParticipant(b)) - Number(isParticipant(a)) : 0)
        || (player.purpose === 'boss' ? Number(Boolean(b.bossId)) - Number(Boolean(a.bossId)) : 0)
        || distance(player, a) - distance(player, b));
    const inRange = hostiles.find(target => distance(player, target) <= rangeOf(player));
    if (inRange && player.ammo > 0 && !(plan.recalling && player.health < 40)) {
      status('combat', `Бой: ${inRange.name}`, inRange, inRange.id);
      player.destination = null; player.searching = null;
      if (player.treatment) cancelTreatment(player);
      if (!player.aim && player.nextAttack <= time) attack(player, inRange);
      return true;
    }
    if (player.treatment) { status('treat', TREATMENT_LABELS[player.treatment.type]); return true; }
    if (player.aim) return true;
    if (!(inRange && plan.recalling && player.health < 40) && (!isStable(player.body) || player.health < 72 || injuryEffects(player.body, time).movement < .75)) {
      const treatment = selectTreatment(player.body, player.medicine, time);
      if (treatment) { startTreatment(player, treatment.type, treatment.part); status('treat', TREATMENT_LABELS[treatment.type]); return true; }
      if (!plan.recalling) returnSortie(player, 'Медицина закончилась');
    }
    if (plan.recalling) {
      plan.blockedExtractKeys ??= [];
      if (plan.blockedAt && time - plan.blockedAt >= 8_000) {
        if (plan.extractTarget) plan.blockedExtractKeys.push(`${plan.extractTarget.x},${plan.extractTarget.y}`);
        plan.extractTarget = null; plan.blockedAt = 0; player.destination = null; Object.assign(player, freshPath());
      }
      if (!plan.extractTarget) {
        const nav = navigation.get(player.mapId)!;
        const reachable = world.extracts.filter(exit => !plan.blockedExtractKeys.includes(`${exit.x},${exit.y}`)).flatMap(exit => {
          const approaches = Array.from({ length: 9 }, (_, index) => ({ x: exit.x + index % 3 - 1, y: exit.y + Math.floor(index / 3) - 1 }))
            .filter(point => clear(player.mapId, point, player.id)).sort((a, b) => distance(player, a) - distance(player, b));
          for (const approach of approaches) {
            const path = nav.findPath(player, approach);
            if (path) return [{ exit, length: path.length }];
          }
          return [];
        }).sort((a, b) => a.length - b.length);
        plan.extractTarget = reachable[0]?.exit ?? null;
      }
      const exit = plan.extractTarget;
      if (!exit) {
        pauseSortie(player, 'Выходы временно перекрыты'); player.automation!.goal = 'Возвращение приостановлено';
        player.destination = null; player.targetId = null; Object.assign(player, freshPath());
        return true;
      }
      navigate(exit, 'extract', 'Возвращение к выходу');
      if (distance(player, exit) <= 1.5) {
        player.destination = null;
        if (player.lastCombatAt > time - COMBAT_TRAVEL_MS) { status('extract', 'Ожидание безопасного выхода', exit); return true; }
        extractCargo(player);
        Object.assign(automatic, { enabled: false, stage: 'complete', goal: 'Выход завершён · груз вынесен', target: null, targetId: null, completedAt: time });
        player.action = 'idle'; player.graceUntil = 0;
        event(player.mapId, 'leave', `${player.name} завершил автоматический выход.`, player.id);
        return true;
      }
      return false;
    }
    const chasing = hostiles.find(target => distance(player, target) <= (player.purpose === 'pvp' || player.purpose === 'boss' ? 14 : rangeOf(player) + 2));
    if (chasing && player.ammo > 0 && ['pvp', 'pve', 'boss'].includes(player.purpose)) {
      navigate(chasing, 'route', `Сближение: ${chasing.name}`, chasing.id);
      return false;
    }
    if (player.searching) { status('search', 'Обыск контейнера', drops.get(player.searching.id) ?? null, player.searching.id); return true; }
    const poi = world.pois.find(poi => poi.id === plan.poiIds[automatic.stopIndex]);
    if (!poi) { returnSortie(player, 'Маршрут пройден'); return false; }
    if (plan.blockedAt && time - plan.blockedAt >= 8_000) {
      const blockedDrop = automatic.targetId ? drops.get(automatic.targetId) : undefined;
      const blocked = automatic.target;
      const anchor = blockedDrop?.containerId ? world.containers.find(anchor => anchor.id === blockedDrop.containerId)
        : blocked && world.containers.find(anchor => anchor.poiId === poi.id && anchor.x === blocked.x && anchor.y === blocked.y);
      if (blockedDrop) plan.skippedDropIds.push(blockedDrop.id);
      if (anchor) plan.visitedContainerIds.push(anchor.id);
      else if (!blockedDrop) { automatic.stopIndex++; plan.enteredStop = -1; }
      plan.blockedAt = 0; player.destination = null; Object.assign(player, freshPath());
      return false;
    }
    const visibleDrops = [...drops.values()].filter(drop => drop.mapId === player.mapId && drop.expiresAt > time && !plan.skippedDropIds.includes(drop.id) && observe(drop)
      && (!drop.containerId || !plan.visitedContainerIds.includes(drop.containerId))
      && (distance(player, drop) <= 5 || plan.enteredStop === automatic.stopIndex && world.containers.some(anchor => anchor.id === drop.containerId && anchor.poiId === poi.id)))
      .sort((a, b) => distance(player, a) - distance(player, b));
    const drop = visibleDrops[0];
    if (drop) {
      // Unsearched contents are never considered by the planner, including weight.
      const searched = !drop.containerId || player.searchedDropIds.includes(drop.id);
      if (searched && !canCarry(player, drop)) {
        plan.skippedDropIds.push(drop.id);
        if (drop.containerId) plan.visitedContainerIds.push(drop.containerId);
        if (player.cargo > 0 || player.lootItems?.length) returnSortie(player, 'Следующая находка не помещается');
        return false;
      }
      navigate(drop, 'loot', drop.containerId ? 'Проверка контейнера' : 'Сбор трофеев', drop.id);
      if (distance(player, drop) <= 1.5 && lineOfSight(player.mapId, player, drop)) {
        if (!searched) { search(player, drop.id); status('search', 'Обыск контейнера', drop, drop.id); return true; }
        loot(player, drop.id);
        if (drop.containerId) plan.visitedContainerIds.push(drop.containerId);
        plan.skippedDropIds.push(drop.id); player.destination = null;
        return true;
      }
      return false;
    }
    if (plan.enteredStop !== automatic.stopIndex) {
      const entrance = [...poi.entrances].sort((a, b) => distance(player, a) - distance(player, b))[0]!;
      if (distance(player, entrance) <= 1.5) { plan.enteredStop = automatic.stopIndex; plan.blockedAt = 0; }
      else { navigate(entrance, 'route', `Маршрут: ${poi.name}`); return false; }
    }
    const anchor = world.containers.filter(anchor => anchor.poiId === poi.id && !plan.visitedContainerIds.includes(anchor.id))
      .sort((a, b) => distance(player, a) - distance(player, b))[0];
    if (anchor) {
      if (distance(player, anchor) <= 1.5 && lineOfSight(player.mapId, player, anchor) && ![...drops.values()].some(drop => drop.containerId === anchor.id)) {
        plan.visitedContainerIds.push(anchor.id); player.destination = null;
      } else navigate(anchor, 'route', `Осмотр: ${poi.name}`);
    } else { automatic.stopIndex++; plan.enteredStop = -1; player.destination = null; Object.assign(player, freshPath()); }
    return false;
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
    for (const player of players.values()) if (player.online && player.leaveAt > 0 && player.leaveAt <= now()) {
      player.online = false; player.searching = null; Object.assign(player, freshPath()); player.leaveAt = 0; player.destination = null; player.patrol = false; player.aim = null; cancelTreatment(player);
      player.action = player.health > 0 ? "idle" : "downed"; player.targetId = null; player.disconnectAt = 0;
      event(player.mapId, "leave", `${player.name} покинул район. Ранения сохранены.`, player.id);
    }
    for (const player of players.values()) if (player.online && now() - player.heartbeat >= HEARTBEAT_MS) {
      player.online = false; player.searching = null; Object.assign(player, freshPath()); player.destination = null; player.patrol = false; player.aim = null; cancelTreatment(player); player.graceUntil = now() + DISCONNECT_GRACE_MS; player.action = player.health > 0 ? "idle" : "downed";
      player.targetId = null; player.disconnectAt = 0;
      event(player.mapId, "leave", `${player.name} потерял связь; боец остаётся в мире ещё 30 секунд.`, player.id);
    }
    for (const [identity, player] of players) if (!player.online && now() - player.heartbeat >= 60_000) {
      savePlayer.run(identity, JSON.stringify(durable(player))); players.delete(identity);
    }
  };
  const leashOf = (scav: Scav): number => scav.bossId ? getBoss(scav.bossId)!.live.aggroRange : scav.role === "patrol" ? Math.max(14, ...scav.route.map(point => distance(scav.home, point) + 9)) : scav.role === "marksman" ? 10 : 8;
  const nearestTarget = (entity: Participant | Scav): Participant | Scav | undefined => {
    const targets: Array<Participant | Scav> = "identity" in entity
      ? [...scavs.values()].filter(scav => scav.mapId === entity.mapId && scav.health > 0 && (entity.purpose !== 'boss' || scav.bossId))
      : [...players.values(), ...scavs.values()].filter(target => target.id !== entity.id && target.mapId === entity.mapId && target.health > 0 && target.safeUntil <= now()
        && (isParticipant(target) ? exposed(target) : !entity.bossId && !target.bossId && target.faction !== entity.faction)
        && distance(entity, target) <= (entity.bossId ? getBoss(entity.bossId)!.live.aggroRange : entity.role === "marksman" ? 11 : entity.role === "patrol" ? 9 : 7)
        && distance(entity.home, target) <= leashOf(entity));
    return targets.sort((a, b) => distance(entity, a) - distance(entity, b))[0];
  };
  const targetFor = (player: Participant, id: string): Participant | Scav => {
    const target = [...players.values(), ...scavs.values()].find(entity => entity.id === id && entity.mapId === player.mapId && entity.health > 0 && (!isParticipant(entity) || exposed(entity)));
    if (!target || target.id === player.id) throw new LiveError(409, "target_unavailable");
    return target;
  };
  const simulate = (): void => {
    for (const entity of [...players.values(), ...scavs.values()]) {
      const time = now();
      // A completed sortie has returned to headquarters. Preserve its wounds
      // without simulating further blood loss or replenishing field supplies.
      if (isParticipant(entity) && entity.automation?.stage === 'complete') { entity.healthAt = time; continue; }
      if (!isParticipant(entity) && entity.bossId) settleBossHealth(entity, time);
      if (entity.health <= 0) { entity.healthAt = time; continue; }
      if (isParticipant(entity) && entity.online) {
        const cancellationAt = Math.min(entity.heartbeat + HEARTBEAT_MS, entity.leaveAt > 0 ? entity.leaveAt : Infinity);
        // A lost connection cancels a still-running action, while a treatment
        // already completed before that boundary retains its real completion.
        if (cancellationAt <= time) {
          if (entity.treatment && cancellationAt <= entity.treatment.endsAt) cancelTreatment(entity);
          if (entity.aim && cancellationAt <= entity.aim.endsAt) entity.aim = null;
        }
      }
      const treatment = isParticipant(entity) && entity.treatment && entity.treatment.endsAt <= time ? entity.treatment : null;
      const boundary = treatment ? treatment.endsAt : time;
      advanceBleeding(entity.body, Math.max(0, boundary - entity.healthAt)); entity.healthAt = Math.max(entity.healthAt, boundary);
      entity.health = isAlive(entity.body) ? healthPercent(entity.body) : 0;
      if (entity.health <= 0) { down(entity); continue; }
      if (isParticipant(entity) && treatment) {
        entity.treatment = null;
        const result = completeTreatment(entity.body, entity.medicine, treatment.type, treatment.part, treatment.endsAt);
        entity.medkits = Math.ceil(entity.medicine.medkit / 40); entity.health = healthPercent(entity.body);
        event(entity.mapId, "combat", result.ok ? `${entity.name}: ${TREATMENT_LABELS[treatment.type]}, ${BODY_PART_LABELS[treatment.part]}${result.healed ? ` +${Math.round(result.healed)} HP` : ""}.` : `${entity.name}: лечение больше не требуется; средство сохранено.`, entity.id);
      }
      advanceBleeding(entity.body, Math.max(0, time - entity.healthAt)); entity.healthAt = time;
      entity.health = isAlive(entity.body) ? healthPercent(entity.body) : 0;
      if (entity.health <= 0) { down(entity); continue; }
      if (entity.aim && entity.aim.endsAt <= now()) {
        const aim = entity.aim; entity.aim = null; const target = findTarget(aim.targetId);
        if (target) {
          try { shot(entity, target, aim.part, aim.part === "head"); }
          catch (error) { if (!(error instanceof LiveError)) throw error; event(entity.mapId, "combat", `${entity.name} потерял линию огня.`, entity.id, aim.targetId); }
        }
      }
    }
    expire();
    for (const drop of drops.values()) if (drop.expiresAt <= now()) drops.delete(drop.id);
    for (const [key, ready] of lootCooldowns) if (ready <= now()) lootCooldowns.delete(key);
    for (const map of LIVE_MAPS) for (const anchor of map.containers) if ((lootCooldowns.get(lootKey(map.id, anchor, anchor.id)) ?? 0) <= now() && ![...drops.values()].some(drop => drop.containerId === anchor.id)) addDrop(map.id, anchor, 10 + Math.floor(random() * 21), "supply");
    for (const scav of scavs.values()) {
      if (scav.health <= 0) {
        if (scav.respawnAt <= now()) {
          if (scav.bossId) {
            let fresh: Scav;
            try { fresh = spawnBoss(scav.bossId, scav.bossCycle! + 1); }
            catch (error) { if (error instanceof BossSpawnBlockedError) continue; throw error; }
            delete scav.bossLastHit; Object.assign(scav, fresh);
          }
          else Object.assign(scav, spawnScav(scav.mapId, scav.spawnIndex, scav.id));
          event(scav.mapId, "respawn", `${scav.name} появился в районе.`, scav.id);
        }
        continue;
      }
      const target = nearestTarget(scav);
      scav.action = scav.aim ? "combat" : "idle";
      if (target && distance(scav, target) <= rangeOf(scav) && lineOfSight(scav.mapId, scav, target)) {
        if (scav.nextAttack <= now() && !scav.aim) attack(scav, target);
        scav.action = "combat";
      } else if (scav.nextMove <= now()) {
        const routePoint = scav.route[scav.routeIndex % scav.route.length]!;
        if (distance(scav, routePoint) < 1.5) scav.routeIndex = (scav.routeIndex + 1) % scav.route.length;
        // Guards and marksmen stay near their post; patrols follow authored routes.
        const destination = target ?? (scav.role === "patrol" ? scav.route[scav.routeIndex]! : scav.home);
        const approach = target || occupied(scav.mapId, destination, scav.id);
        const goal = approach ? [{ x: destination.x + 1, y: destination.y }, { x: destination.x - 1, y: destination.y }, { x: destination.x, y: destination.y + 1 }, { x: destination.x, y: destination.y - 1 }]
          .filter(point => clear(scav.mapId, point, scav.id) && (!target || distance(scav.home, point) <= leashOf(scav)) && (!scav.bossId || insideBossArena(scav.bossId, point))).sort((a, b) => distance(scav, a) - distance(scav, b))[0] : destination;
        const step = goal ? pathStep(scav, goal) : null;
        if (step && (!scav.bossId || insideBossArena(scav.bossId, step))) { scav.x = step.x; scav.y = step.y; scav.action = "moving"; }
        scav.aim = null; scav.nextMove = now() + Math.ceil(750 / Math.max(.25, injuryEffects(scav.body, now()).movement));
      }
    }
    for (const player of players.values()) {
      if (!player.online || player.health <= 0) continue;
      if (player.automation?.stage === 'complete') continue;
      player.searchedDropIds = player.searchedDropIds.filter(id => drops.has(id));
      finishSearch(player);
      if (player.automation?.enabled && !player.leaveAt) {
        try { if (automaticOrders(player)) continue; }
        catch (error) {
          // Expected refusal of one fighter's action (for example a full delivery
          // journal) must preserve its cargo and keep the shared simulation alive.
          if (!(error instanceof LiveError)) throw error;
          pauseSortie(player, error.code === 'delivery_pending_full'
            ? 'Освободи место для ожидающих доставок в убежище'
            : 'Действие прервано. Проверь бойца и продолжи рейд');
          player.automation!.goal = 'Автобой ожидает приказа';
          player.destination = null; player.targetId = null; player.searching = null; player.aim = null; player.action = 'idle';
          cancelTreatment(player); Object.assign(player, freshPath());
          continue;
        }
      }
      if (player.searching) continue;
      if (player.treatment || player.aim || player.leaveAt) continue;
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
        if (!isStable(player.body) || healthPercent(player.body) < 65 || injuryEffects(player.body, now()).movement < .75) {
          const medical = selectTreatment(player.body, player.medicine, now());
          if (medical) { startTreatment(player, medical.type, medical.part); continue; }
          player.patrol = false; player.destination = maps.get(player.mapId)!.extracts.reduce((nearest, exit) => distance(player, exit) < distance(player, nearest) ? exit : nearest);
          event(player.mapId, "combat", `${player.name} отступает к выходу: медицина закончилась.`, player.id);
        }
      }
      if (player.patrol) {
        const target = nearestTarget(player);
        if (target && target.safeUntil <= now() && distance(player, target) <= rangeOf(player) && lineOfSight(player.mapId, player, target) && player.ammo > 0) {
          if (player.nextAttack <= now()) attack(player, target);
          continue;
        }
        const drop = [...drops.values()].filter(drop => drop.mapId === player.mapId && canCarry(player, drop)).sort((a, b) => distance(player, a) - distance(player, b))[0];
        if (drop && distance(player, drop) <= 1.5 && lineOfSight(player.mapId, player, drop)) {
          if (drop.containerId && !player.searchedDropIds.includes(drop.id)) { search(player, drop.id, true); continue; }
          loot(player, drop.id); player.destination = null;
        }
        if (player.purpose === 'boss' && target) player.destination = { x: target.x, y: target.y };
        else if (!player.destination) player.destination = drop ?? pickPoint(player.mapId);
      }
      if (player.destination && player.nextMove <= now()) {
        const step = pathStep(player, player.destination);
        if (step) { player.x = step.x; player.y = step.y; player.action = "moving"; if (player.sortie) player.sortie.blockedAt = 0; }
        else { player.action = "idle"; if (player.sortie && player.automation?.enabled) player.sortie.blockedAt ||= now(); }
        if (player.destination?.x === player.x && player.destination.y === player.y) { player.destination = null; player.action = "idle"; }
        player.nextMove = now() + Math.ceil(350 / Math.max(.25, injuryEffects(player.body, now()).movement));
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
  const identityFrom = (request: Request, joining = false, prepareBinding = true): { identity: string; name?: string; economy?: LiveEconomyIdentity } | null => {
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
      if (prepareBinding) preparedBindings.push({ owner_key: economy.key, game_id: economy.gameId, live_identity: identity });
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
  const entry = (request: Request): LiveEntry => {
    const identity = identityFrom(request, true, false);
    if (!identity) throw new LiveError(401, 'join_required');
    const row = readPlayer.get(identity.identity), player = players.get(identity.identity) ?? (row ? JSON.parse(row.state) as Participant : undefined);
    const stock = identity.economy && options.economy?.entry ? options.economy.entry(identity.economy) : null;
    const fighter = player && (player.automation?.stage !== 'complete' || player.entryPending) ? { id: player.id, name: player.name, x: player.x, y: player.y, health: player.health,
      body: storedBody(player.body, player.health), medicine: player.medicine ? parseMedicalInventory(player.medicine) : createMedicalInventory({ medkit: player.medkits * 40 }),
      ammo: player.ammo, districtId: districtFrom(player.districtId) ?? districtAt(player), purpose: purposeFrom(player.purpose) ?? 'loot',
      cargo: player.cargo, lootCount: player.lootItems?.length ?? 0, respawnAt: player.respawnAt,
      online: Boolean(players.get(identity.identity)?.online), ...(player.loadout ? { loadout: { ...player.loadout } } : {}), ...(player.entryPending ? { launchPending: true } : {}) } : null;
    return { server: status(), now: now(), mode: !fighter ? 'new' : fighter.health > 0 ? 'continue' : 'downed', fighter, stock,
      kits: stock ? quoteLiveKits(stock) : [] };
  };
  const validateLaunch = (identity: LiveEconomyIdentity, kitId: LiveKitId): void => {
    const stock = options.economy?.entry?.(identity);
    if (!stock) throw new LiveError(409, 'economy_unavailable');
    if (stock.money < LIVE_FIELD_KITS[kitId].money) throw new LiveError(409, 'insufficient_money');
    if (Math.floor(stock.ammo) < 1) throw new LiveError(409, 'no_ammo');
  };
  const launch = (player: Participant, kitId: LiveKitId, districtId: LiveDistrictId, purpose: LivePurpose, respawning: boolean, automatic = true): void => {
    if (player.entryPending) return;
    if (!player.economyOwner || !player.gameId) throw new LiveError(401, 'join_required');
    if (pendingRows.all(player.identity).some(row => row.kind === 'supply')) throw new LiveError(409, 'supply_pending');
    validateLaunch({ key: player.economyOwner, gameId: player.gameId, name: player.name }, kitId);
    const point = respawning ? pickPoint(player.mapId, true, districtId) : { x: player.x, y: player.y }, id = randomUUID();
    player.entryPending = { id, districtId, purpose, ...point, respawn: respawning, automatic };
    player.destination = null; player.targetId = null; player.patrol = false; player.searching = null; Object.assign(player, freshPath());
    prepare(player, 'supply', { id, owner: player.economyOwner, gameId: player.gameId, createdAt: now(), ammo: LIVE_FIELD_KITS[kitId].maxAmmo, medkits: 2, kitId });
    // One durable request precedes the other database's debit. Retries use this exact receipt id.
    persist(); flushEconomy();
  };
  const doCommand = (player: Participant, command: LiveCommand): void => {
    if (command.type === "respawn") {
      if (options.economy?.entry) {
        if (!player.entryPending && player.health > 0) throw new LiveError(409, 'already_alive');
        if (!player.entryPending && player.respawnAt > now()) throw new LiveError(409, 'respawn_not_ready');
        launch(player, command.kitId ?? player.loadout?.kitId ?? 'scav', command.districtId ?? player.districtId, command.purpose ?? player.purpose, true);
      } else respawn(player, command.districtId ?? player.districtId, command.purpose ?? player.purpose);
      return;
    }
    if (player.entryPending) throw new LiveError(409, 'launch_pending');
    if (player.health <= 0) throw new LiveError(409, "player_downed");
    if (player.automation?.stage === 'complete') throw new LiveError(409, 'sortie_complete');
    if (command.type === 'automation') {
      if (!command.enabled) {
        pauseSortie(player, 'Приказ игрока'); cancelTreatment(player); player.aim = null; player.searching = null; player.targetId = null; player.destination = null; player.patrol = false; Object.assign(player, freshPath());
      } else {
        if (!player.automation || !player.sortie || command.routeId) {
          const route = command.routeId ? maps.get(player.mapId)!.routes!.find(route => route.id === command.routeId)! : undefined;
          if (route) player.purpose = route.purpose;
          startSortie(player, command.routeId);
        } else {
          Object.assign(player.automation, { enabled: true, stage: player.sortie.recalling ? 'extract' : 'route', goal: player.sortie.recalling ? 'Возвращение к выходу' : 'Продолжение маршрута', reason: player.sortie.recalling ? player.automation.reason : null });
          if (player.sortie.recalling) { player.sortie.blockedExtractKeys = []; player.sortie.extractTarget = null; player.sortie.blockedAt = 0; }
        }
        player.leaveAt = 0; player.patrol = false;
      }
      return;
    }
    if (command.type === 'recall') { returnSortie(player, 'Приказ на возвращение'); player.aim = null; player.leaveAt = 0; return; }
    if (command.type === "cancelTreatment") { cancelTreatment(player); pauseSortie(player); return; }
    if (command.type === "move") { cancelTreatment(player); player.aim = null; player.leaveAt = 0; player.destination = { x: command.x, y: command.y }; player.patrol = false; player.targetId = null; player.searching = null; Object.assign(player, freshPath()); }
    if (command.type === "attack") {
      const target = targetFor(player, command.targetId);
      attack(player, target, command.aimed); player.patrol = false; player.targetId = null; player.leaveAt = 0;
    }
    if (command.type === "engage") {
      if (command.targetId === null) { player.targetId = null; pauseSortie(player); return; }
      const target = targetFor(player, command.targetId);
      if (distance(player, target) > VISION_RADIUS || !lineOfSight(player.mapId, player, target)) throw new LiveError(409, "target_unavailable");
      if (target.safeUntil > now()) throw new LiveError(409, "spawn_protection");
      if (player.ammo <= 0) throw new LiveError(409, "no_ammo");
      cancelTreatment(player); player.aim = null; player.leaveAt = 0;
      player.targetId = target.id; player.patrol = false; player.destination = null; player.searching = null; Object.assign(player, freshPath());
      if (player.nextAttack <= now() && distance(player, target) <= rangeOf(player) && lineOfSight(player.mapId, player, target)) attack(player, target);
      if (target.health <= 0) player.targetId = null;
    }
    if (command.type === "travel") {
      throw new LiveError(409, "already_on_map");
    }
    if (player.treatment && ["search", "loot", "extract", "resupply", "patrol"].includes(command.type)) throw new LiveError(409, "treatment_in_progress");
    if (player.aim && ["search", "loot", "extract", "resupply", "patrol"].includes(command.type)) throw new LiveError(409, "aim_in_progress");
    if (command.type === "search") search(player, command.id);
    if (command.type === "loot") loot(player, command.id);
    if (command.type === "heal") {
      const part = BODY_PARTS.filter(part => canTreat(player.body, player.medicine, "medkit", part, now()).ok).sort((a, b) => player.body.parts[a].hp / player.body.parts[a].maxHp - player.body.parts[b].hp / player.body.parts[b].maxHp)[0];
      if (!part) throw new LiveError(409, player.medicine.medkit <= 0 ? "no_medkits" : "already_healthy");
      startTreatment(player, "medkit", part); player.patrol = false;
    }
    if (command.type === "treat") { startTreatment(player, command.medicine, command.part); player.patrol = false; }
    if (command.type === "extract") {
      extractCargo(player);
    }
    if (command.type === "resupply") {
      if (!options.economy) throw new LiveError(409, "economy_unavailable");
      if (!maps.get(player.mapId)!.extracts.some(exit => distance(player, exit) <= 1.5)) throw new LiveError(409, "extract_out_of_range");
      if (player.lastCombatAt > now() - COMBAT_TRAVEL_MS) throw new LiveError(409, "in_combat");
      if (pendingRows.all(player.identity).some(row => row.kind === "supply")) throw new LiveError(409, "supply_pending");
      const ammo = Math.max(0, (player.loadout?.maxAmmo ?? 60) - player.ammo), medkits = liveMedicalSupplyNeeded(player.medicine);
      if (!ammo && !medkits) throw new LiveError(409, "already_supplied");
      if (!player.economyOwner || !player.gameId) throw new LiveError(401, "join_required");
      prepare(player, "supply", { id: randomUUID(), owner: player.economyOwner, gameId: player.gameId, createdAt: now(), ammo, medkits });
      player.economyMessage = "Пополнение из убежища ожидает подтверждения.";
    }
    if (command.type === "patrol") { player.patrol = command.enabled; player.destination = null; player.targetId = null; player.leaveAt = 0; player.searching = null; Object.assign(player, freshPath()); }
    pauseSortie(player);
  };
  const fetchApi = async (request: Request, clientAddress = "unknown"): Promise<Response | null> => {
    const url = new URL(request.url), path = url.pathname;
    if (path !== "/api/live" && !path.startsWith("/api/live/")) return null;
    try {
      if (closed || failed) throw new LiveError(503, "service_unavailable");
      if (!hosts.has(url.host)) throw new LiveError(403, "host_not_allowed");
      const method = ["/api/live/status", "/api/live/state", '/api/live/entry'].includes(path) ? "GET" : ["/api/live/join", "/api/live/action", "/api/live/leave"].includes(path) ? "POST" : null;
      if (!method) return response({ code: "not_found" }, 404);
      if (request.method !== method) return response({ code: "method_not_allowed" }, 405, { Allow: method });
      const ipKey = hashToken(clientAddress);
      limit(`api:${ipKey}`, 6000);
      if (request.method === "POST" && (!origins.has(request.headers.get("origin") ?? "") || request.headers.get("sec-fetch-site") === "cross-site")) throw new LiveError(403, "origin_not_allowed");
      if (path === '/api/live/entry') return response(entry(request));
      tick();
      if (failed) throw new LiveError(503, "service_unavailable");
      expire();
      if (path === "/api/live/status") return response(status());
      if (path === "/api/live/join") {
        const body = await readJson(request);
        if (!Object.keys(body).every(key => ["districtId", "purpose", 'kitId', 'intent'].includes(key)) || body.districtId !== undefined && !districtFrom(body.districtId) || body.purpose !== undefined && !purposeFrom(body.purpose)
          || body.kitId !== undefined && !isLiveKitId(body.kitId) || body.intent !== undefined && !['deploy', 'continue'].includes(body.intent as string)) throw new LiveError(400, "invalid_request");
        limit(`join:${ipKey}`, 120);
        let identity = identityFrom(request, true), token: string | undefined;
        let player = identity ? players.get(identity.identity) ?? loadPlayer(identity.identity) : undefined;
        if (body.intent === 'continue' && !player) throw new LiveError(409, 'no_fighter');
        if (body.intent === 'deploy' && player && player.health > 0 && !player.entryPending && player.automation?.stage !== 'complete') throw new LiveError(409, 'fighter_alive');
        const creating = !player;
        if (creating && options.economy?.entry && identity?.economy) validateLaunch(identity.economy, isLiveKitId(body.kitId) ? body.kitId : 'scav');
        if ((!player?.online || player.automation?.stage === 'complete' && body.intent === 'deploy') && status().online >= LIVE_CAPACITY) throw new LiveError(503, "server_full");
        if (!identity) {
          limit(`guest:${ipKey}`, 12, 60 * 60_000);
          token = randomBytes(32).toString("base64url"); identity = { identity: `guest:${randomUUID()}` };
          db.query("INSERT INTO live_guests(token_hash,identity,expires_at) VALUES(?,?,?)").run(hashToken(token), identity.identity, now() + COOKIE_SECONDS * 1000);
        }
        if (!player) {
          const mapId = DEFAULT_MAP, districtId = districtFrom(body.districtId) ?? "customs", purpose = purposeFrom(body.purpose) ?? "loot", id = randomUUID(), point = pickPoint(mapId, true, districtId);
          player = { id, mapId, ...point, kind: "player", identity: identity.identity, name: identity.name ?? `Дикий ${id.slice(0, 4).toUpperCase()}`, appearance: Math.floor(random() * 32),
            health: 100, body: createHealth(), medicine: options.economy ? createMedicalInventory(LIVE_MEDICAL_CAPACITY) : createMedicalInventory(), treatment: null, leaveAt: 0, healthAt: now(), dangerUntil: 0, graceUntil: 0, aim: null, safeUntil: now() + 5000, action: "idle", ammo: 60, medkits: options.economy ? 2 : 3, cargo: 0, stash: 0, kills: 0, respawnAt: 0, patrol: false,
            targetId: null, travelReadyAt: 0, districtId, purpose, searching: null, searchedDropIds: [], ...freshPath(), lastCombatAt: 0, disconnectAt: 0, online: false, heartbeat: now(), destination: null, nextMove: 0, nextAttack: 0 };
          players.set(player.identity, player);
          if (body.intent === 'deploy' && !options.economy?.entry) startSortie(player);
        }
        players.set(player.identity, player);
        if (identity.economy) { player.economyOwner = identity.economy.key; player.gameId = identity.economy.gameId; player.lootItems ??= []; }
        if (creating && options.economy?.entry) {
          player.ammo = 0; player.medicine = createMedicalInventory(false); player.medkits = 0;
          launch(player, isLiveKitId(body.kitId) ? body.kitId : 'scav', player.districtId, player.purpose, false, body.intent === 'deploy');
        } else if (player.entryPending) { persist(); flushEconomy(); }
        else if (body.intent === 'deploy' && player.automation?.stage === 'complete') {
          if (options.economy?.entry) launch(player, isLiveKitId(body.kitId) ? body.kitId : 'scav', districtFrom(body.districtId) ?? player.districtId, purposeFrom(body.purpose) ?? player.purpose, true);
          else {
            const districtId = districtFrom(body.districtId) ?? player.districtId;
            Object.assign(player, pickPoint(player.mapId, true, districtId), { districtId, purpose: purposeFrom(body.purpose) ?? player.purpose, safeUntil: now() + 5000 });
            startSortie(player);
          }
        }
        else if (body.intent === 'deploy' && player.health <= 0 && options.economy?.entry) {
          if (player.respawnAt > now()) throw new LiveError(409, 'respawn_not_ready');
          launch(player, isLiveKitId(body.kitId) ? body.kitId : 'scav', districtFrom(body.districtId) ?? player.districtId, purposeFrom(body.purpose) ?? player.purpose, true);
        }
        if (player.entryPending) throw new LiveError(409, 'launch_pending');
        if (identity.name) player.name = identity.name;
        if (body.purpose !== undefined) player.purpose = body.purpose as LivePurpose;
        if (!player.online) {
          if (player.health > 0 && occupied(player.mapId, player, player.id)) Object.assign(player, nearestFree(player, districtAt(player)));
          event(player.mapId, "join", `${player.name} вышел в район «${maps.get(player.mapId)!.name}».`, player.id);
        }
        player.online = true; player.disconnectAt = 0; player.heartbeat = now(); player.leaveAt = 0; player.graceUntil = 0; persist(); flushEconomy();
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
        player.searching = null; Object.assign(player, freshPath());
        cancelTreatment(player); player.aim = null; player.targetId = null;
        if (player.automation?.stage !== 'complete' && player.health > 0 && (player.dangerUntil > now() || !isStable(player.body))) {
          const duration = player.lastCombatAt > now() - COMBAT_TRAVEL_MS ? COMBAT_TRAVEL_MS : LEAVE_MS;
          player.leaveAt = now() + duration; player.destination = null; player.patrol = false; player.action = "idle";
          event(player.mapId, "leave", `${player.name} выходит из района: ещё ${duration / 1000} секунд в опасной зоне.`, player.id); persist(); return response({ ok: true, leaveAt: player.leaveAt });
        }
        player.online = false; player.destination = null; player.patrol = false; player.action = player.health > 0 ? "idle" : "downed";
        event(player.mapId, "leave", `${player.name} покинул район.`, player.id); persist(); return response({ ok: true });
      }
      limit(`action:${player.id}`, 180);
      doCommand(player, commandFrom(body, player.mapId)); persist(); flushEconomy();
      return response(snapshot(player, request));
    } catch (error) {
      if (error instanceof LiveError) { preparedBindings = []; prepared = []; return response({ code: error.code }, error.status, error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}); }
      failed = true; console.error("Live request failed:", error); return response({ code: "service_unavailable" }, 503);
    }
  };
  for (const boss of scavs.values()) if (boss.bossId) settleBossHealth(boss, now());
  persist(); flushEconomy();
  const timer = options.automaticTicks === false ? undefined : setInterval(tick, TICK_MS);
  timer?.unref();
  return { fetch: fetchApi, tick, healthy: () => { try { return !closed && !failed && Boolean(db.query("SELECT 1 AS ready").get()); } catch { return false; } }, close: () => {
    if (closed) return;
    if (timer) clearInterval(timer);
    try { if (!failed) persist(); } finally { closed = true; db.close(); }
  } };
}
