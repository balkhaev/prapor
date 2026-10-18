import { Database } from "bun:sqlite";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LIVE_CAPACITY, LIVE_LOOT_CAPACITY, LIVE_LOOT_WEIGHT, LIVE_MEDICAL_CAPACITY, LIVE_PENDING_CAPACITY, LIVE_SERVER_ID, LIVE_SERVER_NAME, liveMedicalSupplyNeeded, type LiveCommand, type LiveDistrictId, type LiveDrop, type LiveEntity, type LiveEvent, type LiveMapId, type LivePlayer, type LivePoint, type LivePurpose, type LiveSnapshot, type LiveStatus, type LiveVisualLoadout, type LiveWorld } from "../src/game/live";
import { LIVE_MAPS } from "../src/game/live-maps";
import { createLiveNavigation } from "./live-navigation";
import { findLiveCombatCover, LIVE_COVER_CONTACT_MS, type LiveCoverPlan } from './live-combat-cover';
import { createLiveFireteamState, stepLiveFireteam, LIVE_FIRETEAM_SUPPORT_MS, type LiveFireteamActor, type LiveFireteamOrder } from '../src/game/live-fireteam';
import { applyLiveIncomingFire, createLiveFirefightState, liveFirefightHitChance, stepLiveFirefight, type LiveFirefightState } from '../src/game/live-firefight';
import { traceLiveBulletImpact } from '../src/game/live-ballistics';
import { createLiveSortie, LIVE_LOOT_COMMITMENT_MS, type LiveSortiePlan } from './live-autobattle';
import { NPC_RESPAWN_MS, NPC_RESPAWN_QUIET_MS, NPC_RESPAWN_CLEAR_RADIUS, NPC_RESPAWN_CHECK_MS, NPC_SITE_REPLENISH_MS } from './live-spawning';
import { advanceNpcRoutine, createNpcLife, createNpcLifePlans, investigateNpcNoise, rememberNpcContact, restoreNpcLife, NPC_HEARING_RADIUS, NPC_NOISE_INCIDENT_MS, NPC_NOISE_RESPONDERS, NPC_THINK_MS, type NpcLifeState } from './live-alife';
import { buildNpcSquadPlans, createNpcSquadState, restoreNpcSquadState, advanceNpcSquads, completeObjective, type NpcSquadState, type NpcSquadDecision, type NpcSquadPlan } from './live-squads';
import { readNpcInventory, readNpcCacheInventory, canNpcCarry, takeNpcLoot, depositNpcLoot, drainNpcLoot, type NpcInventory } from './live-npc-loot';
import { createNpcFactionAlerts, restoreNpcFactionAlerts, recordNpcBaseContact, recordNpcTerritoryLoss, NPC_BASE_ALARM_QUIET_MS, type NpcFactionAlerts } from './live-faction-alerts';
import { buildNpcCampaignGeometry, createNpcCampaignState, restoreNpcCampaignState, npcCampaignPlans, advanceNpcCampaign, occupyNpcBase, getNpcOperationalBase, chooseNpcRefuge, type NpcCampaignState } from './live-npc-campaign';
import { migratedContainerAnchor, migratedLootCooldownKey } from "./live-world-migration";
import { migrateExpandedLiveCoordinates } from './live-coordinate-migration';
import { invalidateLiveGeometryRoutes } from './live-geometry-revision';
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
import { WEAPON_BY_ID } from '../src/game/data';
import { FACTORY_KITS } from '../src/game/modules';
import { GEAR_MODEL_BY_ID } from '../src/game/systems';
import { LIVE_TICK_MS, liveMovementInterval } from '../src/game/live-timing';

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
  aim: { targetId: string; endsAt: number; part: BodyPart; reactive?: boolean } | null;
  lastCombatAt: number;
  disconnectAt: number;
  searchedDropIds: string[];
  economyOwner?: string;
  /** Saved before the headquarters debit, consumed in the same transaction as its acknowledgement. */
  entryPending?: { id: string; districtId: LiveDistrictId; purpose: LivePurpose; x: number; y: number; respawn: boolean; automatic?: boolean };
}
interface NpcGarrison {
  baseId: string | null; lostBaseId: string; lossId: string | null;
  retreatUntil: number; holdPoint: LivePoint; arrivedAt: number | null;
}
interface NpcBaseHome { baseId: string; base: LivePoint; faction: 'scavs' | 'raiders' }
interface Scav extends LiveEntity, PathCache {
  visualLoadout: LiveVisualLoadout;
  body: HealthState; healthAt: number; aim: { targetId: string; endsAt: number; part: BodyPart; reactive?: boolean } | null;
  mapId: LiveMapId; faction: "scavs" | "raiders"; role: "patrol" | "guard" | "marksman";
  home: LivePoint; route: LivePoint[]; routeIndex: number; spawnIndex: number;
  respawnAt: number; nextMove: number; nextAttack: number;
  /** Absolute vacancy time survives restarts; proximity resets it, never the death cooldown. */
  respawnQuietSince?: number | null;
  nextRespawnCheckAt?: number;
  alife?: NpcLifeState;
  npcGeneration?: number;
  npcInventory?: NpcInventory;
  npcGarrison?: NpcGarrison;
  bossCycle?: number; bossDeathSettled?: boolean;
  bossLastHit?: { identity: string; playerId: string; at: number };
}
interface BossKillCredit { bossId: BossId; cycle: number; identity: string; playerId: string; at: number }
const isParticipant = (entity: Participant | Scav): entity is Participant => entity.kind === "player";
interface Drop extends LiveDrop { mapId: LiveMapId; expiresAt: number; source?: "supply" | "body" | "base" }
interface SquadWork {
  targetId: string; lastAt: number; captureMs: number;
  carrierId?: string; containerId?: string; dropId?: string; readyAt?: number; attempted: string[];
}
interface MapEvent extends LiveEvent { mapId: LiveMapId; point?: LivePoint }
interface NoiseIncident { id: string; mapId: LiveMapId; point: LivePoint; until: number; responders: number }
interface CombatCover {
  targetId: string; observed: LivePoint; seenAt: number; rethinkAt: number;
  plan: LiveCoverPlan | null; fight: LiveFirefightState; stance?: LiveEntity['combatStance'];
  behavior?: LiveEntity['combatBehavior']; avoid: LivePoint[]; movedAt: number;
}
interface EconomyBinding { live_identity: string; owner_key: string; game_id: string }
interface OutboxRow { id: string; identity: string; kind: "delivery" | "supply"; payload: string; message: string }
const HEARTBEAT_MS = 15_000, RESPAWN_MS = 10_000, COOKIE_SECONDS = 30 * 24 * 60 * 60;
const DISCONNECT_GRACE_MS = 30_000, LEAVE_MS = 5000;
const MEDICINES: TreatmentType[] = ["medkit", "bandage", "tourniquet", "splint", "painkiller", "surgery"];
const LIVE_PROTECTION: Partial<Record<BodyPart, number>> = { head: .2, chest: .3, stomach: .3 };
/** Authored equipment is a silhouette; scavenged cargo is tracked separately by physical item ID. */
const NPC_VISUAL_LOADOUTS: Readonly<Record<Scav['faction'], Readonly<Record<Scav['role'], LiveVisualLoadout>>>> = {
  scavs: {
    patrol: { profile: 'light', weaponId: 'pm', helmet: true, armor: true, backpack: false },
    guard: { profile: 'assault', weaponId: 'pp91', helmet: true, armor: true, backpack: false },
    marksman: { profile: 'scout', weaponId: 'mosin', helmet: true, armor: true, backpack: false },
  },
  raiders: {
    patrol: { profile: 'assault', weaponId: 'akm', helmet: true, armor: true, backpack: false },
    guard: { profile: 'assault', weaponId: 'akm', helmet: true, armor: true, backpack: false },
    marksman: { profile: 'scout', weaponId: 'svd', helmet: true, armor: true, backpack: false },
  },
};
function npcVisualLoadout(faction: Scav['faction'], role: Scav['role'], bossId?: BossId): LiveVisualLoadout {
  if (!bossId) {
    const visible = NPC_VISUAL_LOADOUTS[faction][role];
    return { ...visible, modules: { ...FACTORY_KITS[visible.weaponId!] } };
  }
  const boss = getBoss(bossId)!, slot = GEAR_MODEL_BY_ID[boss.armorModelId]?.slot;
  return { profile: WEAPON_BY_ID[boss.weaponId]?.category === 'sniper' ? 'scout' : 'assault', weaponId: boss.weaponId,
    modules: { ...FACTORY_KITS[boss.weaponId] }, helmet: slot === 'helmet', armor: slot === 'armor', backpack: slot === 'backpack' };
}
function visibleLoadout(entity: Participant | Scav): LiveVisualLoadout | undefined {
  if (!isParticipant(entity)) return { ...entity.visualLoadout, ...(entity.npcInventory?.items.length || entity.npcInventory?.money ? { backpack: true } : {}), ...(entity.visualLoadout.modules ? { modules: { ...entity.visualLoadout.modules } } : {}) };
  const kit = entity.loadout;
  return kit ? { profile: kit.kitId === 'scav' ? 'light' : kit.kitId, weaponId: kit.weaponId,
    modules: { ...FACTORY_KITS[kit.weaponId] }, helmet: kit.helmetProtection > 0, armor: kit.armorProtection > 0, backpack: false } : undefined;
}
function storedBody(value: unknown, legacyHealth: number): HealthState {
  if (value !== undefined) return parseHealth(value);
  const body = createHealth(legacyHealth);
  if (legacyHealth <= 0) body.parts.head.hp = 0;
  return body;
}
const DEFAULT_MAP: LiveMapId = "perimeter", WORLD_VERSION = 3, COMBAT_TRAVEL_MS = 8000, VISION_RADIUS = 24, VISIBLE_ENTITY_CAPACITY = 256, VISIBLE_DROP_CAPACITY = 512;
const maps = new Map(LIVE_MAPS.map(map => [map.id, map]));
const mapFrom = (id: unknown): LiveMapId | null => typeof id === "string" && maps.has(id as LiveMapId) ? id as LiveMapId : null;
const worldFor = (id: LiveMapId): LiveWorld => {
  const { npcSpawns: _npcs, lootSpawns: _loot, ...world } = maps.get(id)!;
  return world;
};
const navigation = new Map(LIVE_MAPS.map(map => [map.id, createLiveNavigation(map)]));
// Geometry/path validation is shared by services; only runtime orders and ownership are mutable.
const squadGeometry = (() => {
  const world = maps.get(DEFAULT_MAP)!, arenas = getLiveBossArenas(world);
  return buildNpcSquadPlans(world, navigation.get(DEFAULT_MAP)!, point => arenas.some(arena =>
    point.x >= arena.area.x && point.y >= arena.area.y && point.x < arena.area.x + arena.area.width && point.y < arena.area.y + arena.area.height));
})();
const campaignGeometry = buildNpcCampaignGeometry(maps.get(DEFAULT_MAP)!, squadGeometry, navigation.get(DEFAULT_MAP)!, point => getLiveBossArenas(maps.get(DEFAULT_MAP)!).some(arena =>
  point.x >= arena.area.x && point.y >= arena.area.y && point.x < arena.area.x + arena.area.width && point.y < arena.area.y + arena.area.height));
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
  invalidateLiveGeometryRoutes(db, maps.get(DEFAULT_MAP)!.version);
  const players = new Map<string, Participant>(), scavs = new Map<string, Scav>(), drops = new Map<string, Drop>();
  // Short-lived tactical observations never survive a restart or reveal enemy routes.
  const combatCover = new Map<string, CombatCover>();
  const fireteamStates = new Map<string, ReturnType<typeof createLiveFireteamState>>();
  const fireteamOrders = new Map<string, LiveFireteamOrder>();
  const fireteamTargets = new Map<string, string>();
  // Only accepted projectiles count as covering fire. Aim animations, timers and
  // a remembered enemy position cannot release a buddy into the open.
  const combatShots = new Map<string, { at: number; targetId: string }>();
  const bossArenas = new Map(getLiveBossArenas(maps.get(DEFAULT_MAP)!).map(arena => [arena.bossId, arena]));
  const lifePlans = new Map(LIVE_MAPS.map(map => [map.id, createNpcLifePlans(map, point => walkable(map.id, point), (a, b) => navigation.get(map.id)!.hasLineOfSight(a, b),
    point => [...bossArenas.values()].some(arena => point.x >= arena.area.x && point.y >= arena.area.y && point.x < arena.area.x + arena.area.width && point.y < arena.area.y + arena.area.height))]));
  const planOf = (scav: Scav) => lifePlans.get(scav.mapId)![scav.spawnIndex % lifePlans.get(scav.mapId)!.length]!;
  const npcReplenishments = new Map<string, number>();
  const noiseIncidents: NoiseIncident[] = [];
  const squadStates = new Map(squadGeometry.squads.map(plan => [plan.id, createNpcSquadState(plan, now())]));
  let npcCampaign = createNpcCampaignState(squadGeometry.squads);
  let operationalPlans = npcCampaignPlans(campaignGeometry, npcCampaign, squadGeometry.squads);
  let npcFactionAlerts = createNpcFactionAlerts();
  const territoryOwners = new Map(squadGeometry.territories.map(site => [site.id, site.initialOwner]));
  const territoryById = new Map(squadGeometry.territories.map(site => [site.id, site]));
  const baseIds = new Set(squadGeometry.squads.map(plan => plan.baseId));
  const squadByActor = new Map(squadGeometry.squads.flatMap(plan => plan.memberIds.map(id => [id, plan] as const)));
  const squadWork = new Map<string, SquadWork>(), npcForageCooldowns = new Map<string, number>();
  const squadOrders = new Map<string, { plan: NpcSquadPlan; decision: NpcSquadDecision; directive: NpcSquadDecision['directives'][number] }>();
  const contestedSites = new Set<string>();
  const baseDefenseOrders = new Map<string, NpcBaseHome>();
  const garrisonOrders = new Map<string, { destination: LivePoint | null; activity: 'withdraw' | 'regroup' | 'defend' | 'rest'; withdrawing: boolean }>();
  const garrisonRefugeChecks = new Map<string, string>();
  let nextSquadThinkAt = 0;
  const squadOf = (scav: Scav): NpcSquadPlan | undefined => {
    const plan = squadByActor.get(scav.id), authored = maps.get(scav.mapId)!.npcSpawns[scav.spawnIndex];
    return plan && !scav.bossId && scav.mapId === DEFAULT_MAP && authored && scav.role === 'patrol' && authored.role === scav.role
      && scav.faction === plan.faction && authored.faction === scav.faction && distance(scav.home, authored.point) === 0 ? plan : undefined;
  };
  const authoredBaseOf = (scav: Scav): NpcSquadPlan | undefined => {
    if (scav.bossId || scav.mapId !== DEFAULT_MAP) return;
    const authored = maps.get(DEFAULT_MAP)!.npcSpawns[scav.spawnIndex];
    if (!authored || authored.faction !== scav.faction || distance(authored.point, scav.home) !== 0) return;
    return squadOf(scav) ?? squadGeometry.squads.find(plan => plan.faction === scav.faction && plan.baseId === planOf(scav).siteId && distance(scav.home, plan.base) <= 18);
  };
  const ownedBase = (id: string | null | undefined, faction: Scav['faction']): NpcBaseHome | undefined => {
    if (!id || territoryOwners.get(id) !== faction) return;
    const base = campaignGeometry.bases.find(base => base.id === id);
    return base ? { baseId: id, base: base.point, faction } : undefined;
  };
  const homeBaseOf = (scav: Scav): NpcBaseHome | undefined => {
    const squad = squadOf(scav);
    return ownedBase(squad ? getNpcOperationalBase(npcCampaign, squad.id) : scav.npcGarrison ? scav.npcGarrison.baseId : authoredBaseOf(scav)?.baseId, scav.faction);
  };
  const defendedBaseOf = (scav: Scav): NpcBaseHome | undefined => {
    const order = squadOrders.get(scav.id);
    return order?.decision.missionKind === 'defend' && !order.decision.retreating && order.decision.phase !== 'return'
      ? ownedBase(order.decision.targetId, scav.faction) : ownedBase(baseDefenseOrders.get(scav.id)?.baseId, scav.faction);
  };
  let preparedBossCredits: BossKillCredit[] = [];
  const lootCooldowns = new Map<string, number>();
  const lootKey = (mapId: LiveMapId, point: LivePoint, containerId?: string): string => containerId ? `container:${containerId}` : `${mapId}:${point.x}:${point.y}`;
  const freshPath = (): PathCache => ({ path: [], pathGoal: null, replanAt: 0 });
  const startSortie = (player: Participant, routeId?: string): void => {
    combatCover.delete(player.id);
    if (player.aim?.reactive) player.aim = null;
    const bossPois = [...bossArenas.values()].sort((a, b) => Number(getBoss(b.bossId)!.districtId === player.districtId) - Number(getBoss(a.bossId)!.districtId === player.districtId)
      || distance(player, a.home) - distance(player, b.home)).map(arena => arena.poiId);
    Object.assign(player, createLiveSortie(maps.get(player.mapId)!, player.districtId, player.purpose, now(), routeId, bossPois));
    player.patrol = false; player.destination = null; player.targetId = null; player.searching = null; Object.assign(player, freshPath());
  };
  const pauseSortie = (player: Participant, reason = 'Ручное управление'): void => {
    combatCover.delete(player.id);
    if (player.aim?.reactive) player.aim = null;
    if (!player.automation || player.automation.stage === 'complete' || player.automation.stage === 'downed') return;
    if (player.sortie) delete player.sortie.lootCommitment;
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
  const event = (mapId: LiveMapId, kind: LiveEvent["kind"], text: string, actorId?: string, targetId?: string, shot?: Pick<LiveEvent, "from" | "to" | "damage" | "impact" | "impactPoint">): void => {
    const actor = actorId ? [...players.values(), ...scavs.values()].find(entity => entity.id === actorId) : undefined;
    events.push({ mapId, id: randomUUID(), at: now(), kind, text, ...(actor ? { point: { x: actor.x, y: actor.y } } : {}), ...(actorId ? { actorId } : {}), ...(targetId ? { targetId } : {}), ...shot });
    // Each map keeps its own recent feed, even when another map has a busy battle.
    for (const map of LIVE_MAPS) {
      const local = events.filter(item => item.mapId === map.id);
      if (local.length > 120) { const keep = new Set(local.slice(-120).map(item => item.id)); events = events.filter(item => item.mapId !== map.id || keep.has(item.id)); }
    }
  };
  const exposed = (player: Participant): boolean => player.automation?.stage !== 'complete' && (player.online || player.graceUntil > now());
  // Players reconnect lazily after a server restart. Retain their last observed
  // positions briefly so a tick or a geometry rebuild cannot refill their fight
  // before their first join request restores the authoritative participant.
  const restoredSpawnObservers = new Map(db.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').all().flatMap(row => {
    const player = JSON.parse(row.state) as Participant;
    if (!player.online && !(player.graceUntil > now())) return [];
    return [[row.identity, { mapId: player.mapId, x: player.x, y: player.y, alive: player.health > 0 && player.automation?.stage !== 'complete',
      watching: player.online, until: Math.max(now() + DISCONNECT_GRACE_MS, player.graceUntil || 0) }] as const];
  }));
  const spawnObservers = (mapId: LiveMapId) => {
    for (const [identity, player] of restoredSpawnObservers) if (players.has(identity) || player.until <= now()) restoredSpawnObservers.delete(identity);
    return [
      ...[...players.values()].filter(player => player.mapId === mapId && (exposed(player) || player.online))
        .map(player => ({ x: player.x, y: player.y, alive: player.health > 0 && exposed(player), watching: player.online })),
      ...[...restoredSpawnObservers.values()].filter(player => player.mapId === mapId),
    ];
  };
  const spawnAreaOccupied = (mapId: LiveMapId, points: readonly LivePoint[]): boolean => spawnObservers(mapId)
    .some(player => player.alive && points.some(point => distance(player, point) <= NPC_RESPAWN_CLEAR_RADIUS));
  const spawnPointVisible = (mapId: LiveMapId, point: LivePoint): boolean => spawnObservers(mapId)
    .some(player => player.watching && distance(player, point) <= VISION_RADIUS && navigation.get(mapId)!.hasLineOfSight(player, point));
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
  const publicEntity = (entity: Participant | Scav): LiveEntity => {
    const visualLoadout = visibleLoadout(entity), squad = !isParticipant(entity) && entity.health > 0 ? squadOf(entity) : undefined;
    const order = squadOrders.get(entity.id);
    return { id: entity.id, kind: entity.kind, name: entity.name, appearance: entity.appearance, health: entity.health, action: entity.action, safeUntil: entity.safeUntil, x: entity.x, y: entity.y,
      ...(visualLoadout ? { visualLoadout } : {}), ...(entity.faction ? { faction: entity.faction } : {}), ...(entity.role ? { role: entity.role } : {}), ...(entity.bossId ? { bossId: entity.bossId } : {}),
      ...(!isParticipant(entity) && !entity.bossId && entity.health > 0 && entity.alife ? { npcActivity: entity.aim ? 'combat' as const : order?.directive.activity ?? garrisonOrders.get(entity.id)?.activity ?? (baseDefenseOrders.has(entity.id) ? 'defend' as const : entity.alife.phase) } : {}),
      ...(squad ? { npcSquad: { id: squad.id, leader: squadStates.get(squad.id)?.leaderId === entity.id } } : {}),
      bleeding: BODY_PARTS.some(part => entity.body.parts[part].bleeding !== "none"), limping: injuryEffects(entity.body, now()).movement < 1,
      moveIntervalMs: liveMovementInterval(entity.kind, injuryEffects(entity.body, now()).movement),
      ...(entity.health > 0 && combatCover.get(entity.id)?.stance ? { combatStance: combatCover.get(entity.id)!.stance } : {}),
      ...(entity.health > 0 && combatCover.get(entity.id)?.behavior ? { combatBehavior: combatCover.get(entity.id)!.behavior, suppression: Math.round(combatCover.get(entity.id)!.fight.suppression * 100) / 100 } : {}),
      ...(entity.health > 0 && fireteamOrders.has(entity.id) ? { combatRole: fireteamOrders.get(entity.id)!.role } : {}),
      ...(entity.aim ? { aimUntil: entity.aim.endsAt, aimTargetId: entity.aim.targetId } : {}) };
  };
  const durableWorld = () => ({ version: WORLD_VERSION, geometryVersion: maps.get(DEFAULT_MAP)!.version, startedAt,
    scavs: [...scavs.values()].filter(scav => !scav.bossId).map(durable), drops: [...drops.values()], events,
    lootCooldowns: [...lootCooldowns], npcReplenishments: [...npcReplenishments], noiseIncidents,
    npcSquads: [...squadStates.values()], npcFactionAlerts, npcCampaign, territoryOwners: [...territoryOwners], squadWork: [...squadWork], npcForageCooldowns: [...npcForageCooldowns] });
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
      saveWorld.run(JSON.stringify(durableWorld()));
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
        if (drops.size !== dropCount) saveWorld.run(JSON.stringify(durableWorld()));
      })();
      if (loaded) { Object.assign(loaded, updated); if (!updated.entryPending) delete loaded.entryPending; }
    }
    lastEconomy = now();
  };
  const spawnScav = (mapId: LiveMapId, index: number, id = `scav-${mapId}-${index}`, replenishing = false): Scav => {
    const spawn = maps.get(mapId)!.npcSpawns[index % maps.get(mapId)!.npcSpawns.length]!;
    const nearby: LivePoint[] = [];
    const acceptable = (point: LivePoint): boolean => clear(mapId, point, id) && !spawnPointVisible(mapId, point)
      && !spawnAreaOccupied(mapId, [point]) && (!replenishing || ![...scavs.values()].some(other => other.mapId === mapId && other.health > 0 && other.faction !== spawn.faction && distance(other, point) < 12));
    const vacant = !spawnAreaOccupied(mapId, [spawn.point, ...spawn.route]);
    if (vacant && !acceptable(spawn.point)) for (let y = spawn.point.y - 4; y <= spawn.point.y + 4; y++) for (let x = spawn.point.x - 4; x <= spawn.point.x + 4; x++) {
      const point = { x, y };
      if (distance(point, spawn.point) <= 4 && acceptable(point) && navigation.get(mapId)!.hasLineOfSight(spawn.point, point)
        && !maps.get(mapId)!.extracts.some(exit => distance(exit, point) < 6)) nearby.push(point);
    }
    nearby.sort((a, b) => distance(a, spawn.point) - distance(b, spawn.point) || a.y - b.y || a.x - b.x);
    const approach = vacant && replenishing ? lifePlans.get(mapId)![index % lifePlans.get(mapId)!.length]!.approaches.find(candidate => {
      if (!acceptable(candidate)) return false;
      const path = navigation.get(mapId)!.findPath(candidate, spawn.point);
      return path !== null && path.length <= 48;
    }) : undefined;
    const point = vacant ? approach ?? (acceptable(spawn.point) ? spawn.point : nearby[0]) : undefined;
    const result: Scav = { ...point, ...freshPath(), mapId, id, kind: "scav", name: spawn.faction === "raiders" ? ["Рейдер Борз", "Рейдер Яр", "Рейдер Туман", "Рейдер Север"][index % 4]! : ["Косой", "Бродяга", "Шрам", "Лис", "Глухарь", "Рыжий"][index % 6]!,
      x: point?.x ?? spawn.point.x, y: point?.y ?? spawn.point.y,
      appearance: (spawn.faction === "raiders" ? 16 : 0) + index % 16, faction: spawn.faction, role: spawn.role,
      visualLoadout: npcVisualLoadout(spawn.faction, spawn.role),
      home: { ...spawn.point }, route: spawn.route.length ? spawn.route.map(point => ({ ...point })) : [{ ...spawn.point }], routeIndex: Math.max(0, spawn.route.findIndex(point => point.x === spawn.point.x && point.y === spawn.point.y)), spawnIndex: index,
      health: point ? 100 : 0, body: storedBody(undefined, point ? 100 : 0), healthAt: now(), aim: null, action: point ? "idle" : "downed", safeUntil: 0,
      respawnAt: point ? 0 : now(), respawnQuietSince: null, nextRespawnCheckAt: 0, nextMove: now() + 750, nextAttack: now() + 1000 };
    result.alife = createNpcLife(result, now(), Boolean(approach));
    return result;
  };
  const insideBossArena = (bossId: BossId, point: LivePoint): boolean => {
    const arena = bossArenas.get(bossId)!, area = arena.area;
    return districtAt(point) === getBoss(bossId)!.districtId && point.x >= area.x && point.y >= area.y && point.x < area.x + area.width && point.y < area.y + area.height
      && distance(arena.home, point) <= 16 && walkable(DEFAULT_MAP, point);
  };
  const bossSpawnPoint = (bossId: BossId, unobserved = false): LivePoint => {
    const arena = bossArenas.get(bossId)!, candidates: LivePoint[] = [];
    for (let y = arena.area.y; y < arena.area.y + arena.area.height; y++) for (let x = arena.area.x; x < arena.area.x + arena.area.width; x++) {
      const point = { x, y };
      if (insideBossArena(bossId, point) && clear(DEFAULT_MAP, point, `boss-${bossId}`)
        && (!unobserved || !spawnPointVisible(DEFAULT_MAP, point) && !spawnAreaOccupied(DEFAULT_MAP, [point]))) candidates.push(point);
    }
    const point = candidates.sort((a, b) => distance(arena.home, a) - distance(arena.home, b) || a.y - b.y || a.x - b.x)[0];
    if (!point) throw new BossSpawnBlockedError(`Boss arena has no available spawn: ${bossId}`);
    return point;
  };
  const spawnBoss = (bossId: BossId, cycle = 1, unobserved = false): Scav => {
    const definition = getBoss(bossId)!, arena = bossArenas.get(bossId)!, point = bossSpawnPoint(bossId, unobserved);
    return { ...point, ...freshPath(), id: `boss-${bossId}`, bossId, bossCycle: cycle, bossDeathSettled: false,
      mapId: DEFAULT_MAP, kind: 'scav', name: definition.name, appearance: 28 + BOSSES.findIndex(boss => boss.id === bossId), faction: 'raiders', role: 'guard',
      visualLoadout: npcVisualLoadout('raiders', 'guard', bossId),
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
    Object.assign(stored, freshPath(), { mapId: DEFAULT_MAP, kind: 'scav', name: definition.name, faction: 'raiders', role: 'guard', visualLoadout: npcVisualLoadout('raiders', 'guard', bossId), home: { ...arena.home }, route: [{ ...arena.home }], routeIndex: 0, spawnIndex: -1, aim: null });
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
    const world = JSON.parse(stored.state) as { version?: number; geometryVersion?: string; startedAt: number; scavs: Scav[]; drops: Drop[]; events: MapEvent[]; lootCooldowns?: Array<[string, number]>; npcReplenishments?: Array<[string, number]>; noiseIncidents?: NoiseIncident[];
      npcSquads?: NpcSquadState[]; npcFactionAlerts?: NpcFactionAlerts; npcCampaign?: NpcCampaignState; territoryOwners?: Array<[string, 'scavs' | 'raiders' | null]>; squadWork?: Array<[string, SquadWork]>; npcForageCooldowns?: Array<[string, number]> };
    startedAt = world.startedAt;
    if (world.version === WORLD_VERSION && world.geometryVersion === maps.get(DEFAULT_MAP)!.version) {
      // Ownership is authoritative for caches, alarms and operational homes.
      // Restore it before any of those records are interpreted.
      for (const [id, owner] of world.territoryOwners ?? []) if (territoryById.has(id)
        && (owner === 'scavs' || owner === 'raiders' || owner === null && !baseIds.has(id))) territoryOwners.set(id, owner);
      npcCampaign = restoreNpcCampaignState(squadGeometry.squads, campaignGeometry, world.npcCampaign, now());
      operationalPlans = npcCampaignPlans(campaignGeometry, npcCampaign, squadGeometry.squads);
    }
    if (world.version !== WORLD_VERSION || world.geometryVersion !== maps.get(DEFAULT_MAP)!.version) for (const previous of world.scavs) {
      const carried = readNpcInventory(previous.npcInventory);
      if (!carried.items.length && !carried.money) continue;
      const point = previous.mapId === DEFAULT_MAP ? previous : translateLegacy(previous, previous.mapId);
      const position = walkable(DEFAULT_MAP, point) ? point : nearestFree(point, districtAt(point));
      // Replacing an authored roster must preserve its already-found physical cargo.
      addDrop(DEFAULT_MAP, position, carried.money, 'body', carried.items);
    }
    // Old NPC layouts are replaced once; verified player bodies and dropped cargo are retained.
    for (const [index, scav] of (world.version === WORLD_VERSION && world.geometryVersion === maps.get(DEFAULT_MAP)!.version ? world.scavs : []).entries()) {
      if (scav.bossId || scav.id.startsWith('boss-')) continue;
      scav.mapId = mapFrom(scav.mapId) ?? DEFAULT_MAP;
      if (!walkable(scav.mapId, scav)) Object.assign(scav, pickPoint(scav.mapId));
      scav.faction = scav.faction === "raiders" ? "raiders" : "scavs";
      scav.role = ["patrol", "guard", "marksman"].includes(scav.role) ? scav.role : "patrol";
      scav.visualLoadout = npcVisualLoadout(scav.faction, scav.role);
      scav.home = scav.home && walkable(scav.mapId, scav.home) ? scav.home : { x: scav.x, y: scav.y };
      scav.route = scav.route?.filter(point => walkable(scav.mapId, point)) ?? [scav.home];
      if (!scav.route.length) scav.route = [scav.home];
      scav.routeIndex ??= 0; scav.spawnIndex ??= index; Object.assign(scav, freshPath());
      scav.body = storedBody(scav.body, scav.health); scav.healthAt = now(); scav.aim = null;
      scav.health = isAlive(scav.body) ? healthPercent(scav.body) : 0;
      // A pre-policy death used the player's ten-second timer. Migrate that
      // absolute deadline once; subsequent restarts preserve the NPC deadline.
      if (scav.health <= 0 && scav.respawnQuietSince === undefined)
        scav.respawnAt += NPC_RESPAWN_MS - RESPAWN_MS;
      scav.respawnQuietSince = Number.isSafeInteger(scav.respawnQuietSince) && scav.respawnQuietSince! >= 0 && scav.respawnQuietSince! <= now() ? scav.respawnQuietSince : null;
      scav.nextRespawnCheckAt = 0;
      scav.alife = restoreNpcLife(scav.alife, scav, now(), point => walkable(scav.mapId, point));
      scav.npcGeneration = Number.isSafeInteger(scav.npcGeneration) && scav.npcGeneration! >= 0 ? scav.npcGeneration : 0;
      scav.npcInventory = readNpcInventory(scav.npcInventory);
      if (scav.npcGarrison) {
        const refuge = scav.npcGarrison;
        if (squadOf(scav) || !authoredBaseOf(scav) || !baseIds.has(refuge.lostBaseId) || !(refuge.baseId === null || baseIds.has(refuge.baseId))
          || !(refuge.lossId === null || typeof refuge.lossId === 'string' && /^loss-[1-9][0-9]*$/.test(refuge.lossId))
          || !Number.isSafeInteger(refuge.retreatUntil) || refuge.retreatUntil < 0
          || !(refuge.arrivedAt === null || Number.isSafeInteger(refuge.arrivedAt) && refuge.arrivedAt >= 0 && refuge.arrivedAt <= now())
          || !refuge.holdPoint || !walkable(scav.mapId, refuge.holdPoint)) delete scav.npcGarrison;
      }
      scavs.set(scav.id, scav);
    }
    const claimedAnchors = new Set<string>(), currentWorld = maps.get(DEFAULT_MAP)!;
    for (const drop of world.drops) {
      if (drop.items) drop.items = readEconomyLootItems(drop.items, LIVE_LOOT_CAPACITY, LIVE_LOOT_WEIGHT);
      if (drop.source === 'base') {
        if (!drop.npcBase || typeof drop.npcBase.id !== 'string' || !['scavs', 'raiders'].includes(drop.npcBase.faction) || drop.containerId || drop.bossId) throw new Error('Invalid stored NPC cache');
        readNpcCacheInventory({ items: drop.items ?? [], money: drop.amount });
        drop.expiresAt = Number.MAX_SAFE_INTEGER;
        if (!baseIds.has(drop.npcBase.id)) {
          // A retired base becomes unowned physical cargo rather than blocking startup or deleting loot.
          drop.source = 'body'; delete drop.npcBase;
        } else drop.npcBase.faction = territoryOwners.get(drop.npcBase.id)!;
      } else if (drop.npcBase) throw new Error('Invalid NPC cache source');
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
      for (const plan of operationalPlans) squadStates.set(plan.id, restoreNpcSquadState(plan, world.npcSquads?.find(state => state.id === plan.id), now()));
      npcFactionAlerts = restoreNpcFactionAlerts(squadGeometry.squads, squadGeometry.territories, world.npcFactionAlerts, now(), territoryOwners);
      for (const [id, work] of world.squadWork ?? []) if (squadStates.has(id) && work && territoryById.has(work.targetId)
        && [work.lastAt, work.captureMs, work.readyAt ?? 0].every(value => Number.isSafeInteger(value) && value >= 0)
        && work.captureMs <= (baseIds.has(work.targetId) ? 30_000 : 20_000) && Array.isArray(work.attempted) && work.attempted.length <= 4 && work.attempted.every(value => typeof value === 'string')
        && (work.carrierId === undefined || typeof work.carrierId === 'string') && (work.dropId === undefined || typeof work.dropId === 'string')
        && (work.containerId === undefined || typeof work.containerId === 'string')) {
        // Offline time cannot finish a capture or a container search.
        if (work.readyAt) work.readyAt = now() + Math.min(10_000, Math.max(0, work.readyAt - work.lastAt));
        work.lastAt = now(); squadWork.set(id, work);
      }
      for (const [id, until] of world.npcForageCooldowns ?? []) if (territoryById.has(id) && Number.isSafeInteger(until) && until > now()) npcForageCooldowns.set(id, until);
    }
    for (const [previousKey, ready] of world.lootCooldowns ?? []) if (Number.isFinite(ready) && ready > now()) {
      const key = migratedLootCooldownKey(currentWorld, previousKey);
      if (key) lootCooldowns.set(key, Math.max(ready, lootCooldowns.get(key) ?? 0));
    }
    for (const [site, ready] of world.npcReplenishments ?? []) if (typeof site === 'string' && Number.isSafeInteger(ready) && ready > now()) npcReplenishments.set(site, ready);
    for (const incident of (world.noiseIncidents ?? []).slice(-64)) if (incident.mapId === DEFAULT_MAP && walkable(incident.mapId, incident.point)
      && typeof incident.id === 'string' && Number.isSafeInteger(incident.until) && incident.until > now() && Number.isInteger(incident.responders) && incident.responders >= 0 && incident.responders <= NPC_NOISE_RESPONDERS) noiseIncidents.push(incident);
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
        .concat([...scavs.values()].filter(scav => scav.mapId === player.mapId && visible(scav)).map(publicEntity))
        .sort((a, b) => Number(b.id === player.id) - Number(a.id === player.id)
          || distance(player, a) - distance(player, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, VISIBLE_ENTITY_CAPACITY),
      // Dense fights can leave more cargo than one bounded packet can contain.
      // Project a stable page; keep every physical UUID in the durable world.
      drops: [...drops.values()].filter(drop => drop.mapId === player.mapId && visible(drop)).sort((a, b) =>
        Number(b.id === player.searching?.id) - Number(a.id === player.searching?.id)
        || Number(Boolean(b.containerId)) - Number(Boolean(a.containerId))
        || distance(player, a) - distance(player, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, VISIBLE_DROP_CAPACITY).map(drop => {
        const searched = player.searchedDropIds.includes(drop.id);
        return { id: drop.id, x: drop.x, y: drop.y, amount: !drop.containerId || searched ? drop.amount : 0,
          ...(drop.bossId ? { bossId: drop.bossId } : {}),
          ...(drop.npcBase ? { npcBase: { ...drop.npcBase } } : {}),
          ...(drop.containerId ? { containerId: drop.containerId, containerKind: drop.containerKind, searched } : {}),
          ...(drop.items && (!drop.containerId || searched) ? { items: structuredClone(drop.items) } : {}) };
      }),
      factionSites: squadGeometry.territories.filter(site => visible(site.point)).slice(0, 64).map(site => ({ id: site.id, ...site.point,
        kind: baseIds.has(site.id) ? 'base' as const : 'control' as const, owner: territoryOwners.get(site.id) ?? null, contested: contestedSites.has(site.id) })),
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
    combatCover.delete(target.id);
    fireteamOrders.delete(target.id); fireteamTargets.delete(target.id); combatShots.delete(target.id);
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
    target.health = 0; target.action = "downed"; target.respawnAt = defeatedAt + (isParticipant(target) ? RESPAWN_MS : NPC_RESPAWN_MS); target.aim = null;
    if (!isParticipant(target)) { target.respawnQuietSince = null; target.nextRespawnCheckAt = 0; }
    const amount = "cargo" in target ? target.cargo : 25 + Math.floor(random() * 26);
    if ("cargo" in target) {
      if (amount > 0 || target.lootItems?.length) addDrop(target.mapId, target, amount, "body", target.lootItems ?? []);
      target.cargo = 0; if (options.economy) target.lootItems = [];
      target.destination = null; target.patrol = false; target.targetId = null; target.treatment = null; target.searching = null; Object.assign(target, freshPath());
      if (target.sortie) delete target.sortie.lootCommitment;
      if (target.automation) Object.assign(target.automation, { enabled: false, stage: 'downed', goal: 'Боец погиб', target: null, targetId: null, reason: 'Груз остался на месте боя', completedAt: defeatedAt });
    } else {
      const carried = drainNpcLoot(target.npcInventory ??= { items: [], money: 0 });
      // Carried cargo is a separate exact parcel, never folded into a generated corpse roll.
      if (carried.items.length || carried.money) addDrop(target.mapId, target, carried.money, 'body', carried.items);
      if (amount > 0) addDrop(target.mapId, target, amount);
    }
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
  const clearSquadFireLane = (attacker: Participant | Scav, target: LivePoint): boolean => {
    const squad = isParticipant(attacker) ? undefined : squadOf(attacker);
    if (!squad) return true;
    const dx = target.x - attacker.x, dy = target.y - attacker.y, length2 = dx * dx + dy * dy;
    if (!length2) return false;
    return squad.memberIds.every(id => {
      const buddy = scavs.get(id); if (!buddy || buddy.id === attacker.id || buddy.health <= 0 || buddy.mapId !== attacker.mapId) return true;
      const t = ((buddy.x - attacker.x) * dx + (buddy.y - attacker.y) * dy) / length2;
      return t <= 0 || t >= 1 || distance(buddy, { x: attacker.x + t * dx, y: attacker.y + t * dy }) >= .65;
    });
  };
  const attackTarget = (attacker: Participant | Scav, target: Participant | Scav): void => {
    if (!isParticipant(attacker) && (target.bossId || attacker.bossId && !isParticipant(target))) throw new LiveError(409, 'target_unavailable');
    if (target.mapId !== attacker.mapId || target.health <= 0 || attacker.health <= 0 || target.id === attacker.id || "online" in target && !exposed(target)) throw new LiveError(409, "target_unavailable");
    if (now() < target.safeUntil) throw new LiveError(409, "spawn_protection");
    if (distance(attacker, target) > rangeOf(attacker) || !lineOfSight(attacker.mapId, attacker, target) || !clearSquadFireLane(attacker, target)) throw new LiveError(409, "target_out_of_range");
    if ("ammo" in attacker && attacker.ammo <= 0) throw new LiveError(409, "no_ammo");
  };
  const cancelTreatment = (player: Participant): void => {
    if (player.treatment) { player.treatment = null; event(player.mapId, "combat", `${player.name} прервал лечение; средство сохранено.`, player.id); }
  };
  const hearShot = (attacker: Participant | Scav, target: Participant | Scav): void => {
    // Boss encounters retain their authored participants and combat cadence.
    if (attacker.bossId || target.bossId) return;
    const time = now();
    for (let index = noiseIncidents.length - 1; index >= 0; index--) if (noiseIncidents[index]!.until <= time) noiseIncidents.splice(index, 1);
    // Both sides of a sustained firefight share one response budget. A new wave
    // needs a genuinely quiet interval, including across a process restart.
    let incident = noiseIncidents.find(item => item.mapId === attacker.mapId && distance(item.point, attacker) <= 14);
    if (!incident) {
      if (noiseIncidents.length >= 64) return;
      incident = { id: randomUUID(), mapId: attacker.mapId, point: { x: attacker.x, y: attacker.y }, until: time + NPC_NOISE_INCIDENT_MS, responders: 0 };
      noiseIncidents.push(incident);
    }
    incident.until = time + NPC_NOISE_INCIDENT_MS;
    if (incident.responders >= NPC_NOISE_RESPONDERS) return;
    const candidates = [...scavs.values()].filter(scav => !scav.bossId && !squadOf(scav) && !scav.npcGarrison && scav.role === 'patrol' && scav.health > 0 && scav.mapId === attacker.mapId && scav.id !== attacker.id && scav.id !== target.id
      && !scav.aim && scav.alife && scav.alife.respondAfter <= time && scav.alife.phase !== 'combat' && scav.alife.phase !== 'investigate'
      && distance(scav, attacker) <= NPC_HEARING_RADIUS && distance(scav.home, attacker) <= planOf(scav).leash)
      .sort((a, b) => distance(a, attacker) - distance(b, attacker) || a.spawnIndex - b.spawnIndex);
    for (const scav of candidates.slice(0, NPC_NOISE_RESPONDERS - incident.responders)) {
      investigateNpcNoise(scav.alife!, incident.id, attacker, time); Object.assign(scav, freshPath()); incident.responders++;
    }
  };
  const shot = (attacker: Participant | Scav, target: Participant | Scav, part: BodyPart, aimed = false, reactive = false): void => {
    attackTarget(attacker, target);
    if (!isParticipant(attacker) && squadOf(attacker)) combatShots.set(attacker.id, { at: now(), targetId: target.id });
    // A validated attack can be reported even by the last defender before a
    // lethal hit. The radio carries the base location, never the attacker's GPS.
    if (!isParticipant(target) && !target.bossId) {
      const base = defendedBaseOf(target) ?? homeBaseOf(target);
      if (base && distance(target, base.base) <= 14) recordNpcBaseContact(npcFactionAlerts, base.baseId, base.faction, now());
    }
    if ("ammo" in attacker) { attacker.ammo--; attacker.destination = null; attacker.dangerUntil = now() + DISCONNECT_GRACE_MS; cancelTreatment(attacker); attacker.searching = null; Object.assign(attacker, freshPath()); }
    if ("dangerUntil" in target) target.dangerUntil = now() + DISCONNECT_GRACE_MS;
    if (isParticipant(attacker)) attacker.lastCombatAt = now();
    if (isParticipant(target)) target.lastCombatAt = now();
    if (isParticipant(target)) target.threatId = attacker.id;
    attacker.safeUntil = 0; attacker.action = "combat"; attacker.aim = null;
    const firing = combatCover.get(attacker.id);
    const hit = !reactive || random() < liveFirefightHitChance({ distance: distance(attacker, target), range: rangeOf(attacker),
      suppression: firing?.fight.suppression ?? 0, settledMs: firing ? now() - firing.fight.settledSince : 0,
      targetMoving: target.action === 'moving' });
    const reactToRound = (strength: number): void => {
      if (target.bossId || isParticipant(target) && !target.automation?.enabled && !target.patrol) return;
      let response = combatCover.get(target.id);
      if (!response) {
        response = createCombatContact(target, attacker, now());
        combatCover.set(target.id, response);
      }
      applyLiveIncomingFire(response.fight, now(), strength);
      response.behavior = 'suppressed'; target.aim = null;
    };
    if (!hit) {
      const length = Math.max(.01, distance(attacker, target)), side = random() < .5 ? -1 : 1, spread = .7 + random() * 1.1;
      const dx = (target.x - attacker.x) / length, dy = (target.y - attacker.y) / length;
      const impact = traceLiveBulletImpact(maps.get(attacker.mapId)!, attacker, { x: target.x + dx * .8 - dy * side * spread, y: target.y + dy * .8 + dx * side * spread });
      if (distance(impact.impactPoint, target) <= 2.2) reactToRound(.3);
      event(attacker.mapId, 'combat', `${attacker.name}: выстрел рядом с ${target.name}.`, attacker.id, target.id,
        { from: { x: attacker.x, y: attacker.y }, to: { x: target.x, y: target.y }, damage: 0, ...impact });
      hearShot(attacker, target); return;
    }
    reactToRound(.46);
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
    event(attacker.mapId, "combat", `${attacker.name} → ${target.name}: ${BODY_PART_LABELS[part]}, −${Math.round(result.damage)} HP${result.absorbed > 0 ? `; броня остановила ${Math.round(result.absorbed)}` : ""}${wound.bleeding !== "none" ? `; ${wound.bleeding === "heavy" ? "тяжёлое" : "лёгкое"} кровотечение` : ""}${wound.fracture ? "; перелом" : ""}${wound.hp <= 0 ? "; зона выбита" : ""}.`, attacker.id, target.id, { from: { x: attacker.x, y: attacker.y }, to: { x: target.x, y: target.y }, impactPoint: { x: target.x, y: target.y }, damage: result.damage, impact: result.absorbed > 0 ? 'armor' : 'body' });
    hearShot(attacker, target);
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
  const createCombatContact = (entity: Participant | Scav, target: Participant | Scav, time: number, previous?: CombatCover): CombatCover => {
    const fight = previous?.fight ?? createLiveFirefightState([...entity.id].reduce((seed, letter) => Math.imul(seed, 31) + letter.charCodeAt(0), 17), time);
    if (previous) {
      // Choosing another observed threat interrupts acquisition, not wounds,
      // pressure or the ammunition/reload already spent on the first threat.
      fight.roundsLeft = 0; fight.settledSince = 0;
      if (fight.phase === 'acquiring' || fight.phase === 'firing') { fight.phase = 'recovering'; fight.until = time + 500; }
    }
    return { targetId: target.id, observed: { x: target.x, y: target.y }, seenAt: time, rethinkAt: 0, plan: null,
      fight, avoid: [], movedAt: previous?.movedAt ?? (entity.action === 'moving' ? time : 0) };
  };
  /** Physical shelter and shared reactive timing own automatic contacts, including
   * open ground. Only current visual contact can authorize a projectile. */
  const takeCombatCover = (entity: Participant | Scav, visibleTarget?: Participant | Scav): boolean => {
    if (entity.bossId || visibleTarget?.bossId) {
      combatCover.delete(entity.id); if (entity.aim?.reactive) entity.aim = null; return false;
    }
    const time = now(), nav = navigation.get(entity.mapId)!;
    let cover = combatCover.get(entity.id);
    if (!visibleTarget && cover) {
      const known = findTarget(cover.targetId);
      if (known && known.health > 0 && known.mapId === entity.mapId && known.safeUntil <= time && (!isParticipant(known) || exposed(known))
        && distance(entity, known) <= (isParticipant(entity) ? VISION_RADIUS : perceptionOf(entity))
        && (isParticipant(entity) || insidePursuit(entity, known)) && lineOfSight(entity.mapId, entity, known)) visibleTarget = known;
    }
    const clearContact = (): false => { combatCover.delete(entity.id); if (entity.aim?.reactive) entity.aim = null; return false; };
    if (visibleTarget && distance(entity, visibleTarget) > rangeOf(entity)) return clearContact();
    const previous = visibleTarget && cover && cover.targetId !== visibleTarget.id ? cover : undefined;
    if (cover && (visibleTarget && cover.targetId !== visibleTarget.id || !visibleTarget && time - cover.seenAt > LIVE_COVER_CONTACT_MS)) {
      clearContact(); cover = undefined;
    }
    if (!cover && !visibleTarget) return false;
    if (!cover) { cover = createCombatContact(entity, visibleTarget!, time, previous); combatCover.set(entity.id, cover); }
    if (visibleTarget) { cover.observed = { x: visibleTarget.x, y: visibleTarget.y }; cover.seenAt = time; }
    const holdPosition = fireteamOrders.get(entity.id)?.holdPosition === true;
    if (holdPosition) cover.plan = null;
    const resetForCover = (): void => {
      cover!.fight.roundsLeft = 0; cover!.fight.settledSince = 0;
      if (!['suppressed', 'reloading', 'recovering'].includes(cover!.fight.phase)) cover!.fight.phase = 'seeking';
    };
    const abandonPlan = (): void => {
      cover!.plan = null; cover!.stance = undefined; cover!.rethinkAt = time + 700;
      resetForCover(); entity.aim = null;
    };
    if (cover.plan && visibleTarget && (nav.hasLineOfSight(cover.plan.covered, cover.observed)
      || !nav.hasLineOfSight(cover.plan.peek, cover.observed) || distance(cover.plan.peek, cover.observed) > rangeOf(entity))) abandonPlan();
    const findPlan = (avoid = cover!.avoid): LiveCoverPlan | null => findLiveCombatCover(entity, cover!.observed, rangeOf(entity), {
      clear: point => clear(entity.mapId, point, entity.id), hasLineOfSight: nav.hasLineOfSight,
      permitted: point => isParticipant(entity) || insidePursuit(entity, point), avoid,
      solid: nav.blocksSight,
    });
    if (!holdPosition && !cover.plan && cover.rethinkAt <= time) {
      cover.plan = findPlan(); cover.rethinkAt = time + 2000;
      if (cover.plan) { resetForCover(); Object.assign(entity, freshPath()); }
    }
    if (isParticipant(entity)) { entity.destination = null; entity.searching = null; cancelTreatment(entity); }
    const at = (point: LivePoint): boolean => point.x === entity.x && point.y === entity.y;
    const move = (destination: LivePoint): boolean => {
      if (entity.nextMove > time || at(destination)) return true;
      const step = Math.abs(entity.x - destination.x) + Math.abs(entity.y - destination.y) === 1 ? destination : pathStep(entity, destination);
      if (!step || !clear(entity.mapId, step, entity.id)) { abandonPlan(); return false; }
      entity.x = step.x; entity.y = step.y; entity.action = 'moving'; entity.aim = null; cover!.movedAt = time;
      entity.nextMove = time + liveMovementInterval(entity.kind, injuryEffects(entity.body, time).movement);
      cover!.stance = cover!.plan ? at(cover!.plan.covered) ? 'covered' : at(cover!.plan.peek) ? 'peeking' : 'seeking-cover' : undefined;
      return true;
    };
    entity.action = 'combat';
    const effects = injuryEffects(entity.body, time), plan = cover.plan;
    const weaponId = isParticipant(entity) ? entity.loadout?.weaponId : entity.visualLoadout.weaponId;
    const decision = stepLiveFirefight(cover.fight, { now: time, visible: Boolean(visibleTarget),
      canFire: Boolean(visibleTarget && entity.nextAttack <= time && (!isParticipant(entity) || entity.ammo > 0) && clearSquadFireLane(entity, visibleTarget)),
      hasCover: Boolean(plan), inCover: Boolean(plan && at(plan.covered)), atPeek: Boolean(plan && at(plan.peek)),
      covering: fireteamOrders.get(entity.id)?.role === 'covering',
      moving: time - cover.movedAt < 300, weaponCategory: weaponId ? WEAPON_BY_ID[weaponId]?.category : 'pistol',
      attackMs: (isParticipant(entity) ? entity.loadout?.attackMs ?? 900 : 2500) / Math.max(.25, effects.aim * effects.reload),
      injured: !isParticipant(entity) && (entity.health < 28 || effects.movement < .35),
    });
    cover.behavior = decision.behavior;
    cover.stance = plan ? at(plan.covered) ? 'covered' : at(plan.peek) ? 'peeking' : 'seeking-cover' : undefined;
    if (decision.action === 'relocate' && plan) {
      const avoided = [...cover.avoid, plan.covered].slice(-3), alternate = findPlan(avoided);
      if (alternate) {
        cover.avoid = avoided; cover.plan = alternate; cover.fight.phase = 'seeking'; cover.stance = 'seeking-cover';
        cover.behavior = 'relocating'; Object.assign(entity, freshPath());
        move(alternate.covered);
      } else { cover.fight.phase = 'holding'; cover.fight.until = time + 1100; }
      entity.aim = null; return true;
    }
    if (decision.action === 'cover' && plan) { entity.aim = null; move(plan.covered); return true; }
    if (decision.action === 'peek' && plan) { entity.aim = null; move(plan.peek); return true; }
    if (decision.action === 'fire' && visibleTarget) {
      entity.aim = null;
      try { shot(entity, visibleTarget, randomPart(), false, true); }
      catch (error) { if (!(error instanceof LiveError)) throw error; cover.fight.phase = 'recovering'; cover.fight.until = time + 500; }
      // This is an observed round, never a burst-sized damage multiplier.
      entity.nextAttack = time + 150;
      return true;
    }
    if (decision.behavior === 'acquiring' && visibleTarget && (!plan || at(plan.peek))) {
      entity.aim = { targetId: visibleTarget.id, endsAt: Math.max(time + 50, cover.fight.until), part: 'chest', reactive: true };
    } else entity.aim = null;
    return true;
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
    combatCover.delete(player.id);
    if (player.aim?.reactive) player.aim = null;
    if (!player.automation || !player.sortie) startSortie(player);
    player.sortie!.recalling = true;
    player.sortie!.extractTarget = null; player.sortie!.blockedExtractKeys = []; player.sortie!.blockedAt = 0;
    delete player.sortie!.lootCommitment;
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
    // A safe dressing must finish; the firing loop cannot cancel its own
    // medicine on every tick. A real hit still interrupts through shot().
    if (player.treatment) { status('treat', TREATMENT_LABELS[player.treatment.type]); return true; }
    const protectedContact = combatCover.get(player.id);
    if (!plan.recalling && (!inRange || protectedContact?.stance === 'covered')
      && (!isStable(player.body) || player.health < 72 || injuryEffects(player.body, time).movement < .75)) {
      const treatment = selectTreatment(player.body, player.medicine, time);
      if (treatment) {
        if (protectedContact) { protectedContact.behavior = 'recovering'; protectedContact.fight.phase = 'recovering'; protectedContact.fight.until = time + 700; }
        startTreatment(player, treatment.type, treatment.part); status('treat', TREATMENT_LABELS[treatment.type]); return true;
      }
      returnSortie(player, 'Медицина закончилась');
    }
    if (!plan.recalling && player.ammo > 0 && takeCombatCover(player, inRange)) {
      delete plan.lootCommitment;
      status('combat', combatCover.get(player.id)?.stance === 'covered' ? 'За укрытием' : combatCover.get(player.id)?.stance === 'peeking' ? 'Огонь из укрытия' : 'Занимаю укрытие', inRange ?? null, inRange?.id ?? null);
      return true;
    }
    if (inRange && player.ammo > 0 && !plan.recalling) {
      delete plan.lootCommitment;
      status('combat', `Бой: ${inRange.name}`, inRange, inRange.id);
      player.destination = null; player.searching = null;
      if (player.treatment) cancelTreatment(player);
      if (!player.aim && player.nextAttack <= time) attack(player, inRange);
      return true;
    }
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
      delete plan.lootCommitment;
      navigate(chasing, 'route', `Сближение: ${chasing.name}`, chasing.id);
      return false;
    }
    if (player.searching) { status('search', 'Обыск контейнера', drops.get(player.searching.id) ?? null, player.searching.id); return true; }
    const poi = world.pois.find(poi => poi.id === plan.poiIds[automatic.stopIndex]);
    if (!poi) { returnSortie(player, 'Маршрут пройден'); return false; }
    let remembered = plan.lootCommitment;
    const rememberedAnchor = remembered && world.containers.find(anchor => anchor.id === remembered!.containerId);
    // A restart retains this fixed observation, never a hidden live position.
    // Changed geometry or route invalidates it instead of following stale data.
    if (remembered && (!rememberedAnchor || remembered.point?.x !== rememberedAnchor.x || remembered.point?.y !== rememberedAnchor.y
      || typeof remembered.dropId !== 'string' || remembered.stopIndex !== automatic.stopIndex || !Number.isSafeInteger(remembered.until)
      || remembered.until > time + LIVE_LOOT_COMMITMENT_MS || plan.visitedContainerIds.includes(remembered.containerId) || plan.skippedDropIds.includes(remembered.dropId))) {
      delete plan.lootCommitment; remembered = undefined;
    }
    const skipRememberedContainer = (): void => {
      if (remembered) {
        plan.skippedDropIds.push(remembered.dropId); plan.visitedContainerIds.push(remembered.containerId);
      }
      delete plan.lootCommitment; remembered = undefined; plan.blockedAt = 0;
      player.destination = null; Object.assign(player, freshPath()); status('route', 'Продолжение маршрута');
    };
    if (remembered && remembered.until <= time) { skipRememberedContainer(); return false; }
    if (plan.blockedAt && time - plan.blockedAt >= 8_000) {
      if (remembered) { skipRememberedContainer(); return false; }
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
    // Continue to a container that was actually seen even if a doorway hides it
    // for one step. Re-selecting only currently visible drops can oscillate forever.
    if (remembered && !observe(remembered.point)) {
      navigate(remembered.point, 'loot', 'Проверка контейнера', remembered.dropId);
      return false;
    }
    const rememberedDrop = remembered ? drops.get(remembered.dropId) : undefined;
    if (remembered && (!rememberedDrop || rememberedDrop.mapId !== player.mapId || rememberedDrop.expiresAt <= time || rememberedDrop.containerId !== remembered.containerId
      || rememberedDrop.x !== remembered.point.x || rememberedDrop.y !== remembered.point.y)) {
      // Only a current observation can establish that the remembered cycle is gone.
      skipRememberedContainer(); return false;
    }
    const visibleDrops = [...drops.values()].filter(drop => drop.mapId === player.mapId && drop.expiresAt > time && !plan.skippedDropIds.includes(drop.id) && observe(drop)
      && (!drop.containerId || !plan.visitedContainerIds.includes(drop.containerId))
      && (distance(player, drop) <= 5 || plan.enteredStop === automatic.stopIndex && world.containers.some(anchor => anchor.id === drop.containerId && anchor.poiId === poi.id)))
      .sort((a, b) => distance(player, a) - distance(player, b));
    const drop = rememberedDrop ?? visibleDrops[0];
    if (drop) {
      if (!remembered && drop.containerId) {
        const anchor = world.containers.find(anchor => anchor.id === drop.containerId && anchor.x === drop.x && anchor.y === drop.y);
        if (anchor) plan.lootCommitment = { containerId: anchor.id, dropId: drop.id, point: { x: anchor.x, y: anchor.y }, stopIndex: automatic.stopIndex, until: time + LIVE_LOOT_COMMITMENT_MS };
      }
      // Unsearched contents are never considered by the planner, including weight.
      const searched = !drop.containerId || player.searchedDropIds.includes(drop.id);
      if (searched && !canCarry(player, drop)) {
        delete plan.lootCommitment;
        plan.skippedDropIds.push(drop.id);
        if (drop.containerId) plan.visitedContainerIds.push(drop.containerId);
        if (player.cargo > 0 || player.lootItems?.length) returnSortie(player, 'Следующая находка не помещается');
        return false;
      }
      navigate(drop, 'loot', drop.containerId ? 'Проверка контейнера' : 'Сбор трофеев', drop.id);
      if (distance(player, drop) <= 1.5 && lineOfSight(player.mapId, player, drop)) {
        if (!searched) { search(player, drop.id); delete plan.lootCommitment; status('search', 'Обыск контейнера', drop, drop.id); return true; }
        loot(player, drop.id);
        delete plan.lootCommitment;
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
      combatCover.delete(player.id);
      player.online = false; player.searching = null; Object.assign(player, freshPath()); player.leaveAt = 0; player.destination = null; player.patrol = false; player.aim = null; cancelTreatment(player);
      player.action = player.health > 0 ? "idle" : "downed"; player.targetId = null; player.disconnectAt = 0;
      event(player.mapId, "leave", `${player.name} покинул район. Ранения сохранены.`, player.id);
    }
    for (const player of players.values()) if (player.online && now() - player.heartbeat >= HEARTBEAT_MS) {
      combatCover.delete(player.id);
      player.online = false; player.searching = null; Object.assign(player, freshPath()); player.destination = null; player.patrol = false; player.aim = null; cancelTreatment(player); player.graceUntil = now() + DISCONNECT_GRACE_MS; player.action = player.health > 0 ? "idle" : "downed";
      player.targetId = null; player.disconnectAt = 0;
      event(player.mapId, "leave", `${player.name} потерял связь; боец остаётся в мире ещё 30 секунд.`, player.id);
    }
    for (const [identity, player] of players) if (!player.online && now() - player.heartbeat >= 60_000) {
      combatCover.delete(player.id);
      savePlayer.run(identity, JSON.stringify(durable(player))); players.delete(identity);
    }
  };
  const leashOf = (scav: Scav): number => {
    if (scav.bossId) return getBoss(scav.bossId)!.live.aggroRange;
    const order = squadOrders.get(scav.id), target = order?.decision.targetId ? territoryById.get(order.decision.targetId) : undefined;
    const defense = defendedBaseOf(scav);
    const garrison = scav.npcGarrison ? homeBaseOf(scav) : undefined;
    return Math.max(planOf(scav).leash, order ? distance(scav.home, order.plan.base) + 10 : 0,
      target ? distance(scav.home, target.point) + (order?.decision.missionKind === 'defend' ? 14 : 10) : 0,
      defense ? distance(scav.home, defense.base) + 14 : 0, garrison ? distance(scav.home, garrison.base) + 14 : 0,
      scav.npcGarrison ? distance(scav.home, scav.npcGarrison.holdPoint) + 10 : 0);
  };
  const perceptionOf = (scav: Scav): number => defendedBaseOf(scav) ? 14 : scav.role === 'marksman' ? 11 : scav.role === 'patrol' ? 9 : 7;
  const insidePursuit = (scav: Scav, point: LivePoint): boolean => {
    const defense = defendedBaseOf(scav);
    const garrison = scav.npcGarrison, station = garrison ? homeBaseOf(scav)?.base ?? garrison.holdPoint : undefined;
    return distance(scav.home, point) <= leashOf(scav) && (!defense || distance(scav, defense.base) > 18 || distance(point, defense.base) <= 14)
      && (!station || distance(point, station) <= 14);
  };
  const advanceGarrisons = (time: number): void => {
    garrisonOrders.clear();
    const ownership = campaignGeometry.bases.map(base => `${base.id}:${territoryOwners.get(base.id)}`).join('|');
    for (const scav of scavs.values()) {
      if (scav.bossId || scav.health <= 0 || squadOf(scav)) continue;
      const authored = authoredBaseOf(scav);
      if (!authored) continue;
      let refuge = scav.npcGarrison;
      const currentBase = refuge ? refuge.baseId : authored.baseId;
      if (currentBase === null || territoryOwners.get(currentBase) !== scav.faction) {
        const from = currentBase ?? refuge?.lostBaseId ?? authored.baseId;
        const candidate = chooseNpcRefuge(campaignGeometry, from, scav.faction, territoryOwners)
          ?? (territoryOwners.get(from) === scav.faction ? from : null);
        // An unchanged stranded order must not restart its escape timer each tick.
        if (!refuge || currentBase !== null || candidate !== null && garrisonRefugeChecks.get(scav.id) !== ownership) {
          garrisonRefugeChecks.set(scav.id, ownership);
          const base = campaignGeometry.bases.find(base => base.id === candidate);
          const reachable = base && (navigation.get(DEFAULT_MAP)!.findPath(scav, base.point)?.length ?? Infinity) <= 640 ? base : undefined;
          const lost = campaignGeometry.bases.find(base => base.id === from);
          const escape = lost?.escapePoints.find(point => (navigation.get(DEFAULT_MAP)!.findPath(scav, point)?.length ?? Infinity) <= 80);
          if (!refuge || currentBase !== null || reachable) {
            refuge = scav.npcGarrison = { baseId: reachable?.id ?? null, lostBaseId: from,
              lossId: npcFactionAlerts.losses.find(order => order.siteId === from && order.faction === scav.faction)?.id ?? refuge?.lossId ?? null,
              retreatUntil: time + (reachable ? 600_000 : 60_000), holdPoint: reachable ? { ...reachable.point } : escape ? { ...escape } : { x: scav.x, y: scav.y }, arrivedAt: null };
            scav.aim = null; if (scav.alife) { scav.alife.targetId = null; scav.alife.lastSeen = null; scav.alife.lastSeenUntil = 0; }
            Object.assign(scav, freshPath());
          }
        }
      }
      if (!refuge) continue;
      const base = refuge.baseId ? campaignGeometry.bases.find(base => base.id === refuge!.baseId) : undefined;
      if (base && refuge.arrivedAt === null && distance(scav, base.point) <= 6 && lineOfSight(DEFAULT_MAP, scav, base.point)) refuge.arrivedAt = time;
      if (refuge.arrivedAt === null && time >= refuge.retreatUntil) {
        // A blocked retreat has a finite order and retains the body where it
        // actually stopped. It cannot fall back to its lost authored home.
        garrisonOrders.set(scav.id, { destination: null, activity: 'rest', withdrawing: false }); continue;
      }
      const arrived = refuge.arrivedAt !== null;
      const rally = base?.rallyPoints.filter(point => lineOfSight(DEFAULT_MAP, point, base.point));
      const station = rally?.length ? rally[(scav.spawnIndex + 1) % rally.length]! : refuge.holdPoint;
      const carrying = Boolean(scav.npcInventory?.items.length || scav.npcInventory?.money);
      const destination = base && (carrying || !arrived) ? { ...base.point } : distance(scav, station) > 1.5 ? { ...station } : null;
      const alarm = base && npcFactionAlerts.alarms.some(alarm => alarm.baseId === base.id && alarm.faction === scav.faction);
      garrisonOrders.set(scav.id, { destination, activity: !arrived ? 'withdraw' : time < refuge.arrivedAt! + 30_000 ? 'regroup' : alarm ? 'defend' : 'rest', withdrawing: !arrived });
    }
  };
  const nearestTarget = (entity: Participant | Scav): Participant | Scav | undefined => {
    let nearest: Participant | Scav | undefined, nearestDistance = Infinity;
    const participant = isParticipant(entity), time = now();
    const range = participant ? Infinity : entity.bossId ? getBoss(entity.bossId)!.live.aggroRange : perceptionOf(entity);
    const consider = (target: Participant | Scav): void => {
      if (target.mapId !== entity.mapId || target.health <= 0 || target.id === entity.id) return;
      if (participant) { if (isParticipant(target) || entity.purpose === 'boss' && !target.bossId) return; }
      else if (target.safeUntil > time || (isParticipant(target) ? !exposed(target) : entity.bossId || target.bossId || target.faction === entity.faction)) return;
      const separation = distance(entity, target);
      if (separation >= nearestDistance || separation > range || !participant && !insidePursuit(entity, target)) return;
      if (!participant && !entity.bossId && !lineOfSight(entity.mapId, entity, target)) return;
      nearest = target; nearestDistance = separation;
    };
    // Keep the old stable player-before-NPC tie order, without allocating and sorting N arrays per tick.
    if (!participant) for (const player of players.values()) consider(player);
    for (const scav of scavs.values()) consider(scav);
    return nearest;
  };
  const npcWithdrawing = (scav: Scav, time: number): boolean => {
    const order = squadOrders.get(scav.id);
    return scav.health < 28 || injuryEffects(scav.body, time).movement < .35 || Boolean(garrisonOrders.get(scav.id)?.withdrawing
      || order && (order.decision.retreating || order.decision.phase === 'return' || ['haul', 'withdraw'].includes(order.directive.activity)));
  };
  const npcSees = (scav: Scav, target: Participant | Scav, time: number): boolean => target.health > 0 && target.id !== scav.id
    && target.mapId === scav.mapId && !target.bossId && target.safeUntil <= time
    && (isParticipant(target) ? exposed(target) : target.faction !== scav.faction)
    && distance(scav, target) <= perceptionOf(scav) && insidePursuit(scav, target) && lineOfSight(scav.mapId, scav, target);
  /** All members decide from one observation snapshot before any member moves.
   * Authored membership and personal sight are both required: a shared faction
   * or another squad's distant contact is never enough to issue a flank. */
  const advanceFireteams = (time: number): void => {
    fireteamOrders.clear(); fireteamTargets.clear();
    for (const [id, receipt] of combatShots) if (time - receipt.at > LIVE_COVER_CONTACT_MS) combatShots.delete(id);
    for (const plan of squadGeometry.squads) {
      const members = plan.memberIds.flatMap(id => {
        const actor = scavs.get(id);
        return actor && actor.health > 0 && squadOf(actor) && !npcWithdrawing(actor, time) ? [actor] : [];
      });
      if (members.length < 2 && !fireteamStates.has(plan.id)) continue;
      if (!members.length) { fireteamStates.delete(plan.id); continue; }
      if (!fireteamStates.has(plan.id) && !members.some(actor => actor.alife?.targetId || combatCover.has(actor.id))) continue;
      const candidates = new Map<string, Participant | Scav>();
      for (const actor of members) {
        const nearest = nearestTarget(actor), remembered = combatCover.get(actor.id), known = remembered && findTarget(remembered.targetId);
        if (nearest) candidates.set(nearest.id, nearest);
        if (known && npcSees(actor, known, time)) candidates.set(known.id, known);
      }
      const committed = fireteamStates.get(plan.id)?.bound?.targetId;
      const shared = [...candidates.values()].map(target => ({ target, witnesses: members.filter(actor => npcSees(actor, target, time)) }))
        .filter(item => item.witnesses.length >= 2)
        .sort((a, b) => Number(b.target.id === committed) - Number(a.target.id === committed)
          || b.witnesses.length - a.witnesses.length || a.witnesses.reduce((sum, actor) => sum + distance(actor, a.target), 0)
          - b.witnesses.reduce((sum, actor) => sum + distance(actor, b.target), 0) || a.target.id.localeCompare(b.target.id))[0]?.target;
      const actors: LiveFireteamActor[] = members.map(actor => {
        const contact = combatCover.get(actor.id), visible = shared && npcSees(actor, shared, time) ? shared
          : [...candidates.values()].filter(target => npcSees(actor, target, time)).sort((a, b) => distance(actor, a) - distance(actor, b))[0];
        if (visible) fireteamTargets.set(actor.id, visible.id);
        const observed = visible ? { targetId: visible.id, point: { x: visible.x, y: visible.y }, seenAt: time, visible: true }
          : contact && time - contact.seenAt <= LIVE_COVER_CONTACT_MS
            ? { targetId: contact.targetId, point: { ...contact.observed }, seenAt: contact.seenAt, visible: false } : undefined;
        const weapon = actor.visualLoadout.weaponId, category = weapon ? WEAPON_BY_ID[weapon]?.category : 'pistol';
        const magazine = category === 'pistol' ? 8 : category === 'sniper' || category === 'shotgun' ? 5 : 24;
        return { id: actor.id, point: { x: actor.x, y: actor.y }, health: actor.health, range: rangeOf(actor),
          suppression: contact?.fight.suppression ?? 0, moving: contact ? time - contact.movedAt < 300 : actor.action === 'moving',
          ready: contact?.fight.phase !== 'reloading' && contact?.fight.phase !== 'suppressed'
            && (contact?.fight.roundsSinceReload ?? 0) < magazine && (contact?.fight.suppression ?? 0) < .65
            && Boolean((visible || contact) && clearSquadFireLane(actor, visible ?? contact!.observed)),
          ...(observed ? { contact: observed } : {}), ...(combatShots.has(actor.id) ? { lastShot: combatShots.get(actor.id)! } : {}),
          ...(contact?.plan ? { cover: contact.plan.covered } : {}) };
      });
      const state = fireteamStates.get(plan.id) ?? createLiveFireteamState(); fireteamStates.set(plan.id, state);
      const orders = stepLiveFireteam(state, actors, time, {
        clear: (point, actorId) => clear(DEFAULT_MAP, point, actorId), hasLineOfSight: navigation.get(DEFAULT_MAP)!.hasLineOfSight,
        permitted: (point, actorId) => { const actor = scavs.get(actorId); return Boolean(actor && insidePursuit(actor, point)); },
      });
      for (const [id, order] of orders) fireteamOrders.set(id, order);
      if (!state.bound && !state.withdrawals.size && !state.stations.size && !actors.some(actor => actor.contact && time - actor.contact.seenAt <= LIVE_COVER_CONTACT_MS)) fireteamStates.delete(plan.id);
    }
  };
  const takeFireteamOrder = (actor: Scav, visibleTarget: Participant | Scav | undefined, time: number): boolean => {
    let order = fireteamOrders.get(actor.id);
    if (!order || order.role === 'covering') return false;
    if (order.role === 'flanking') {
      const supporter = order.supporterId ? scavs.get(order.supporterId) : undefined, threat = order.targetId ? findTarget(order.targetId) : undefined;
      const support = supporter && combatCover.get(supporter.id), receipt = supporter && combatShots.get(supporter.id);
      // Earlier members may have been hit, moved or killed since the shared
      // observation snapshot. Such a lane cannot cover this later step.
      if (!supporter || supporter.health <= 0 || !threat || !support || support.targetId !== threat.id
        || time - support.seenAt > LIVE_FIRETEAM_SUPPORT_MS || !lineOfSight(supporter.mapId, supporter, support.observed) || !clearSquadFireLane(supporter, support.observed)
        || !receipt || receipt.targetId !== threat.id || time - receipt.at > LIVE_FIRETEAM_SUPPORT_MS
        || time - support.movedAt < 300 || support.fight.phase === 'reloading' || support.fight.phase === 'suppressed' || support.fight.suppression >= .52) {
        order = { ...order, role: 'regrouping', destination: undefined }; fireteamOrders.set(actor.id, order);
      }
    }
    let contact = combatCover.get(actor.id);
    if (visibleTarget && (!contact || contact.targetId !== visibleTarget.id)) {
      contact = createCombatContact(actor, visibleTarget, time, contact); combatCover.set(actor.id, contact);
    }
    actor.aim = null; actor.action = 'combat';
    if (contact) {
      if (visibleTarget) { contact.observed = { x: visibleTarget.x, y: visibleTarget.y }; contact.seenAt = time; }
      // Pressure and reload clocks keep advancing during a retreat. The move
      // order itself never authorizes a shot or silently refills a magazine.
      const weapon = actor.visualLoadout.weaponId;
      stepLiveFirefight(contact.fight, { now: time, visible: false, canFire: false, hasCover: false, inCover: false, atPeek: false,
        weaponCategory: weapon ? WEAPON_BY_ID[weapon]?.category : 'pistol' });
      contact.behavior = order.role === 'regrouping' ? contact.fight.suppression >= .45 ? 'suppressed' : 'recovering' : 'relocating';
      contact.stance = contact.plan && distance(actor, contact.plan.covered) === 0 ? 'covered' : 'seeking-cover';
    }
    const destination = order.destination;
    if (!destination || actor.nextMove > time) return true;
    // Recheck occupancy and the leash after earlier actors acted. A cached
    // tactical order grants exactly one adjacent step, never a teleport/path.
    if (Math.abs(actor.x - destination.x) + Math.abs(actor.y - destination.y) !== 1
      || !clear(actor.mapId, destination, actor.id) || !insidePursuit(actor, destination)) return true;
    actor.x = destination.x; actor.y = destination.y; actor.action = 'moving'; Object.assign(actor, freshPath());
    actor.nextMove = time + liveMovementInterval('scav', injuryEffects(actor.body, time).movement);
    if (contact) {
      contact.movedAt = time; contact.plan = null; contact.rethinkAt = time + 350;
      if (!['reloading', 'suppressed', 'recovering'].includes(contact.fight.phase)) contact.fight.phase = 'seeking';
      contact.fight.settledSince = 0;
    }
    return true;
  };
  const targetFor = (player: Participant, id: string): Participant | Scav => {
    const target = [...players.values(), ...scavs.values()].find(entity => entity.id === id && entity.mapId === player.mapId && entity.health > 0 && (!isParticipant(entity) || exposed(entity)));
    if (!target || target.id === player.id) throw new LiveError(409, "target_unavailable");
    return target;
  };
  const advanceSquads = (time: number): void => {
    if (nextSquadThinkAt > time) return;
    nextSquadThinkAt = time + NPC_THINK_MS;
    // NPC invasions require a living local witness. Player proximity alone
    // never summons help; their attack must pass the normal shot validation.
    const living = [...scavs.values()].filter(scav => !scav.bossId && scav.health > 0 && scav.mapId === DEFAULT_MAP);
    const caches = new Map([...drops.values()].filter(drop => drop.source === 'base' && drop.npcBase).map(drop => [drop.npcBase!.id, drop]));
    const actors = new Map([...scavs.values()].filter(scav => squadOf(scav)).map(scav => {
      const inventory = scav.npcInventory ??= { items: [], money: 0 }, home = homeBaseOf(scav), cache = home ? caches.get(home.baseId) : undefined;
      return [scav.id, { id: scav.id, x: scav.x, y: scav.y, health: scav.health, lifeCycle: scav.npcGeneration ?? 0,
        inCombat: Boolean(scav.aim || scav.alife?.targetId), carried: Boolean(inventory.items.length || inventory.money),
        canForage: !inventory.items.length && !inventory.money && (!cache || (cache.items?.length ?? 0) < 32 && (cache.items ?? []).reduce((sum, item) => sum + getLiveLootWeight(item), 0) < 12 && cache.amount < 500) }] as const;
    }));
    operationalPlans = advanceNpcCampaign(campaignGeometry, npcCampaign, squadGeometry.squads, squadStates, actors, territoryOwners, npcFactionAlerts, time, (from, to) => lineOfSight(DEFAULT_MAP, from, to));
    advanceGarrisons(time);
    for (const base of campaignGeometry.bases) {
      const faction = territoryOwners.get(base.id);
      const witnesses = living.filter(scav => scav.faction === faction && distance(scav, base.point) <= 14
        && (homeBaseOf(scav)?.baseId === base.id || defendedBaseOf(scav)?.baseId === base.id));
      if (faction && witnesses.some(witness => living.some(enemy => enemy.faction !== faction && distance(enemy, base.point) <= 14
        && distance(witness, enemy) <= 14 && lineOfSight(DEFAULT_MAP, witness, enemy)))) recordNpcBaseContact(npcFactionAlerts, base.id, faction, time);
    }
    squadOrders.clear(); baseDefenseOrders.clear(); contestedSites.clear();
    for (const scav of living) {
      if (squadOf(scav)) continue;
      const base = homeBaseOf(scav);
      if (base && npcFactionAlerts.alarms.some(alarm => alarm.baseId === base.baseId && time - alarm.lastContactAt < NPC_BASE_ALARM_QUIET_MS)) baseDefenseOrders.set(scav.id, base);
    }
    for (const [id, until] of npcForageCooldowns) if (until <= time) npcForageCooldowns.delete(id);
    const decisions = advanceNpcSquads(operationalPlans, squadStates, actors, territoryOwners, time, npcFactionAlerts, (from, to) => lineOfSight(DEFAULT_MAP, from, to));
    const siteContested = (point: LivePoint, faction: Scav['faction']): boolean =>
      [...scavs.values()].some(other => !other.bossId && other.health > 0 && other.faction !== faction && distance(other, point) <= 8 && lineOfSight(DEFAULT_MAP, other, point))
      || [...players.values()].some(player => exposed(player) && player.health > 0 && distance(player, point) <= 8 && lineOfSight(DEFAULT_MAP, player, point));
    for (const base of campaignGeometry.bases) if (siteContested(base.point, territoryOwners.get(base.id)!)) contestedSites.add(base.id);
    // Any surviving resident can deliver its existing parcel to its real allied
    // refuge. Capacity and ownership never create or split a parcel.
    for (const carrier of living) {
      const home = homeBaseOf(carrier), inventory = carrier.npcInventory;
      if (!home || !inventory || !inventory.items.length && !inventory.money || distance(carrier, home.base) > 2.5
        || !lineOfSight(DEFAULT_MAP, carrier, home.base) || carrier.aim || siteContested(home.base, carrier.faction)) continue;
      const existing = caches.get(home.baseId), cache = { items: existing?.items ?? [], money: existing?.amount ?? 0 };
      if (!depositNpcLoot(inventory, cache)) continue;
      const drop: Drop = existing ?? { id: randomUUID(), mapId: DEFAULT_MAP, ...home.base, amount: 0, items: [], source: 'base',
        npcBase: { id: home.baseId, faction: carrier.faction }, expiresAt: Number.MAX_SAFE_INTEGER };
      drop.items = cache.items; drop.amount = cache.money; drops.set(drop.id, drop); caches.set(home.baseId, drop);
      event(DEFAULT_MAP, 'loot', `${carrier.name} доставил добычу на базу.`, carrier.id);
    }
    let baseChanged = false;
    for (const decision of decisions) {
      const plan = operationalPlans.find(candidate => candidate.id === decision.squadId)!;
      for (const directive of decision.directives) squadOrders.set(directive.actorId, { plan, decision, directive });
      if (plan.operational === false || territoryOwners.get(plan.baseId) !== plan.faction) { squadWork.delete(plan.id); continue; }
      const target = decision.targetId ? territoryById.get(decision.targetId) : undefined;
      if (decision.phase !== 'objective' || !target || decision.retreating) { squadWork.delete(plan.id); continue; }
      if (decision.missionKind === 'defend') { squadWork.delete(plan.id); continue; }
      let work = squadWork.get(plan.id);
      if (!work || work.targetId !== target.id) { work = { targetId: target.id, lastAt: time, captureMs: 0, attempted: [] }; squadWork.set(plan.id, work); }
      const elapsed = Math.max(0, Math.min(1000, time - work.lastAt)); work.lastAt = time;
      const crew = decision.memberIds.map(id => scavs.get(id)).filter((scav): scav is Scav => Boolean(scav && scav.health > 0 && squadOf(scav)));
      const contested = siteContested(target.point, plan.faction);
      if (contested) contestedSites.add(target.id);
      const present = crew.filter(scav => distance(scav, target.point) <= 6 && lineOfSight(DEFAULT_MAP, scav, target.point));
      if (decision.missionKind === 'capture' || decision.missionKind === 'retake' || decision.missionKind === 'assault') {
        if (territoryOwners.get(target.id) === plan.faction) { completeObjective(squadStates.get(plan.id)!, time); continue; }
        if (contested || present.length < 2 || present.some(scav => scav.aim || nearestTarget(scav))) { work.captureMs = 0; continue; }
        work.captureMs += elapsed;
        if (work.captureMs >= (baseIds.has(target.id) ? 30_000 : 20_000)) {
          recordNpcTerritoryLoss(npcFactionAlerts, target.id, territoryOwners.get(target.id) ?? null, plan.faction, time, baseIds.has(target.id) ? 'base' : 'control');
          territoryOwners.set(target.id, plan.faction);
          if (baseIds.has(target.id)) {
            // A conquered cache stays where it was, with exactly the same
            // parcel and identity. Only its faction marker changes hands.
            for (const drop of drops.values()) if (drop.source === 'base' && drop.npcBase?.id === target.id) drop.npcBase.faction = plan.faction;
            occupyNpcBase(npcCampaign, plan.id, target.id, time); baseChanged = true;
          }
          const name = maps.get(DEFAULT_MAP)!.pois.find(poi => poi.id === target.poiId)!.name;
          event(DEFAULT_MAP, 'travel', `${plan.faction === 'scavs' ? 'Отряд диких' : 'Отряд рейдеров'} ${decision.missionKind === 'retake' ? 'отбил' : baseIds.has(target.id) ? 'захватил базу' : 'взял под контроль'} ${name}.`, present[0]!.id);
          completeObjective(squadStates.get(plan.id)!, time); squadWork.delete(plan.id);
        }
        continue;
      }
      if (territoryOwners.get(target.id) !== plan.faction || (npcForageCooldowns.get(target.id) ?? 0) > time) { completeObjective(squadStates.get(plan.id)!, time); continue; }
      if (contested) { delete work.readyAt; continue; }
      let carrier = crew.find(scav => scav.id === work.carrierId);
      if (!carrier) { carrier = crew.find(scav => actors.get(scav.id)?.canForage); if (carrier) work.carrierId = carrier.id; }
      if (!carrier) { completeObjective(squadStates.get(plan.id)!, time); continue; }
      // Guards hold the point while the carrier walks to an authored container.
      // Requiring the carrier to stay inside the capture circle would make it
      // oscillate at that circle's boundary whenever the container is farther away.
      if (!present.some(scav => scav.id !== carrier!.id) || carrier.aim || nearestTarget(carrier)) { delete work.readyAt; continue; }
      const anchors = maps.get(DEFAULT_MAP)!.containers;
      let anchor = work.containerId ? anchors.find(candidate => candidate.id === work!.containerId && candidate.poiId === target.poiId) : undefined;
      if (!anchor) {
        delete work.readyAt; delete work.dropId; delete work.containerId;
        if (work.attempted.length < 4) anchor = anchors.filter(candidate => candidate.poiId === target.poiId && !work!.attempted.includes(candidate.id) && distance(candidate, target.point) <= 20)
          .sort((a, b) => distance(carrier!, a) - distance(carrier!, b) || a.id.localeCompare(b.id))
          .find(candidate => (navigation.get(DEFAULT_MAP)!.findPath(carrier!, candidate)?.length ?? Infinity) <= 32);
        if (!anchor) { completeObjective(squadStates.get(plan.id)!, time); continue; }
        work.containerId = anchor.id; work.attempted.push(anchor.id);
      }
      const order = squadOrders.get(carrier.id)!;
      order.directive = { ...order.directive, destination: { x: anchor.x, y: anchor.y }, activity: 'forage' };
      if (distance(carrier, anchor) > 1.5 || !lineOfSight(DEFAULT_MAP, carrier, anchor)) { delete work.readyAt; continue; }
      order.directive.destination = null;
      // Only arrival reveals whether that known container still has a parcel.
      const drop = [...drops.values()].find(candidate => candidate.source === 'supply' && candidate.containerId === anchor!.id && !candidate.bossId && !candidate.npcBase);
      if (!drop) { delete work.containerId; delete work.dropId; delete work.readyAt; continue; }
      if (work.dropId !== drop.id) { work.dropId = drop.id; delete work.readyAt; }
      work.readyAt ??= time + anchor.searchMs;
      if (work.readyAt > time) continue;
      const inventory = carrier.npcInventory ??= { items: [], money: 0 };
      if (!canNpcCarry(inventory, drop.items ?? [], drop.amount) || !takeNpcLoot(inventory, { items: drop.items ?? [], money: drop.amount })) {
        delete work.containerId; delete work.dropId; delete work.readyAt; continue;
      }
      drops.delete(drop.id); lootCooldowns.set(lootKey(DEFAULT_MAP, drop, drop.containerId), time + 30_000);
      npcForageCooldowns.set(target.id, time + 180_000);
      event(DEFAULT_MAP, 'loot', `${carrier.name} забрал припасы и возвращается с отрядом.`, carrier.id);
      completeObjective(squadStates.get(plan.id)!, time); squadWork.delete(plan.id);
    }
    if (baseChanged) {
      operationalPlans = advanceNpcCampaign(campaignGeometry, npcCampaign, squadGeometry.squads, squadStates, actors, territoryOwners, npcFactionAlerts, time, (from, to) => lineOfSight(DEFAULT_MAP, from, to));
      advanceGarrisons(time); squadOrders.clear();
      for (const decision of advanceNpcSquads(operationalPlans, squadStates, actors, territoryOwners, time, npcFactionAlerts, (from, to) => lineOfSight(DEFAULT_MAP, from, to))) {
        const plan = operationalPlans.find(plan => plan.id === decision.squadId)!;
        for (const directive of decision.directives) squadOrders.set(directive.actorId, { plan, decision, directive });
      }
    }
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
      if (entity.aim && !entity.aim.reactive && entity.aim.endsAt <= now()) {
        const aim = entity.aim; entity.aim = null; const target = findTarget(aim.targetId);
        if (target && (isParticipant(entity) || entity.bossId || insidePursuit(entity, target))) {
          try { shot(entity, target, aim.part, aim.part === "head"); }
          catch (error) { if (!(error instanceof LiveError)) throw error; event(entity.mapId, "combat", `${entity.name} потерял линию огня.`, entity.id, aim.targetId); }
        }
      }
    }
    expire();
    for (const drop of drops.values()) if (drop.expiresAt <= now()) drops.delete(drop.id);
    for (const [key, ready] of lootCooldowns) if (ready <= now()) lootCooldowns.delete(key);
    for (const [site, ready] of npcReplenishments) if (ready <= now()) npcReplenishments.delete(site);
    for (let index = noiseIncidents.length - 1; index >= 0; index--) if (noiseIncidents[index]!.until <= now()) noiseIncidents.splice(index, 1);
    const occupiedContainers = new Set<string>();
    for (const drop of drops.values()) if (drop.containerId) occupiedContainers.add(drop.containerId);
    for (const map of LIVE_MAPS) for (const anchor of map.containers) if ((lootCooldowns.get(lootKey(map.id, anchor, anchor.id)) ?? 0) <= now() && !occupiedContainers.has(anchor.id)) {
      addDrop(map.id, anchor, 10 + Math.floor(random() * 21), "supply");
      occupiedContainers.add(anchor.id);
    }
    advanceSquads(now());
    advanceFireteams(now());
    for (const scav of scavs.values()) {
      if (scav.health <= 0) {
        if ((scav.nextRespawnCheckAt ?? 0) > now()) continue;
        scav.nextRespawnCheckAt = scav.respawnAt > now() ? Math.min(now() + NPC_RESPAWN_CHECK_MS, scav.respawnAt) : now() + NPC_RESPAWN_CHECK_MS;
        const originalBase = scav.bossId ? undefined : authoredBaseOf(scav);
        if (originalBase && territoryOwners.get(originalBase.baseId) !== scav.faction) { scav.respawnQuietSince = null; continue; }
        const authored = scav.bossId ? null : maps.get(scav.mapId)!.npcSpawns[scav.spawnIndex % maps.get(scav.mapId)!.npcSpawns.length]!;
        const occupiedArea = spawnAreaOccupied(scav.mapId, [scav, scav.home, ...scav.route, ...(authored ? [authored.point, ...authored.route] : [])]);
        if (occupiedArea) { scav.respawnQuietSince = null; continue; }
        scav.respawnQuietSince ??= now();
        if (scav.respawnAt > now() || !scav.bossId && now() - scav.respawnQuietSince < NPC_RESPAWN_QUIET_MS) continue;
        const siteKey = scav.bossId ? null : `${scav.mapId}:${planOf(scav).siteId}`;
        if (siteKey && (npcReplenishments.get(siteKey) ?? 0) > now()) continue;
        let fresh: Scav;
        if (scav.bossId) {
          try { fresh = spawnBoss(scav.bossId, scav.bossCycle! + 1, true); }
          catch (error) { if (error instanceof BossSpawnBlockedError) continue; throw error; }
          delete scav.bossLastHit;
        } else {
          fresh = spawnScav(scav.mapId, scav.spawnIndex, scav.id, true);
          if (fresh.health <= 0) { scav.respawnQuietSince = null; continue; }
          fresh.npcGeneration = (scav.npcGeneration ?? 0) + 1; fresh.npcInventory = { items: [], money: 0 };
          delete scav.npcGarrison; garrisonRefugeChecks.delete(scav.id);
        }
        Object.assign(scav, fresh);
        combatShots.delete(scav.id); fireteamOrders.delete(scav.id); fireteamTargets.delete(scav.id);
        const squad = squadOf(scav); if (squad) fireteamStates.delete(squad.id);
        if (siteKey) npcReplenishments.set(siteKey, now() + NPC_SITE_REPLENISH_MS);
        event(scav.mapId, "respawn", `${scav.name} появился в районе.`, scav.id);
        continue;
      }
      if (!scav.bossId) {
        const state = scav.alife ??= createNpcLife(scav, now()), time = now();
        const badlyHurt = scav.health < 28 || injuryEffects(scav.body, time).movement < .35;
        const order = squadOrders.get(scav.id), garrison = garrisonOrders.get(scav.id), withdrawing = npcWithdrawing(scav, time);
        if (withdrawing) { scav.aim = null; combatCover.delete(scav.id); }
        let target: Participant | Scav | undefined;
        if (state.nextThinkAt <= time) {
          state.nextThinkAt = time + NPC_THINK_MS;
          target = nearestTarget(scav);
          if (target) rememberNpcContact(state, target, time);
          else state.targetId = null;
        } else if (state.targetId) {
          const known = findTarget(state.targetId);
          // Perception can lose a contact immediately between thoughts. Its
          // hidden coordinates must never become a movement destination.
          if (known && known.health > 0 && known.mapId === scav.mapId && known.safeUntil <= time && (!isParticipant(known) || exposed(known))
            && distance(scav, known) <= perceptionOf(scav)
            && insidePursuit(scav, known) && lineOfSight(scav.mapId, scav, known)) target = known;
          else state.targetId = null;
        }
        const coordinated = fireteamTargets.get(scav.id), coordinatedTarget = coordinated ? findTarget(coordinated) : undefined;
        if (!withdrawing && coordinatedTarget && npcSees(scav, coordinatedTarget, time)) {
          target = coordinatedTarget; rememberNpcContact(state, target, time);
        }
        scav.action = scav.aim ? 'combat' : 'idle';
        if (!withdrawing && takeFireteamOrder(scav, target, time)) continue;
        if (!withdrawing && takeCombatCover(scav, target)) continue;
        if (!withdrawing && target && distance(scav, target) <= rangeOf(scav) && lineOfSight(scav.mapId, scav, target)) {
          if (scav.nextAttack <= time && !scav.aim) attack(scav, target);
          scav.action = 'combat';
        } else {
          // Squad orders keep a shared route. Only a personally observed target may interrupt it.
          const defense = baseDefenseOrders.get(scav.id);
          const previousPhase = state.phase, destination = badlyHurt ? scav.home : target && !withdrawing ? { x: target.x, y: target.y } : order ? order.directive.destination
            : garrison ? garrison.destination : defense ? distance(scav, defense.base) > 2 ? defense.base : null : advanceNpcRoutine(scav, state, planOf(scav), time);
          // Static visit validation happens once when a trip starts. An excessive
          // detour is abandoned; dynamic movement still uses occupied cells.
          if (!order && !garrison && !defense && !target && state.phase === 'travel' && previousPhase !== 'travel' && destination) {
            const route = navigation.get(scav.mapId)!.findPath(scav, destination);
            if (!route || route.length > 160) { state.phase = 'return'; state.destination = { ...scav.home }; state.until = time + 90_000; Object.assign(scav, freshPath()); continue; }
          }
          if (destination && scav.nextMove <= time) {
            const approach = target && !withdrawing || occupied(scav.mapId, destination, scav.id);
            const goal = approach ? [{ x: destination.x + 1, y: destination.y }, { x: destination.x - 1, y: destination.y }, { x: destination.x, y: destination.y + 1 }, { x: destination.x, y: destination.y - 1 }]
              .filter(point => clear(scav.mapId, point, scav.id) && (!target || insidePursuit(scav, point))
                && (!order || !['haul', 'forage'].includes(order.directive.activity) || lineOfSight(scav.mapId, point, destination))).sort((a, b) => distance(scav, a) - distance(scav, b))[0] : destination;
            const step = goal ? pathStep(scav, goal) : null;
            if (step) { scav.x = step.x; scav.y = step.y; scav.action = 'moving'; }
            scav.aim = null; scav.nextMove = time + liveMovementInterval('scav', injuryEffects(scav.body, time).movement);
          }
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
        scav.aim = null; scav.nextMove = now() + liveMovementInterval('scav', injuryEffects(scav.body, now()).movement);
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
        player.nextMove = now() + liveMovementInterval('player', injuryEffects(player.body, now()).movement);
      }
    }
  };
  const tick = (): void => {
    if (closed || failed) return;
    try {
      const tickStartedAt = now();
      if (tickStartedAt - lastTick >= LIVE_TICK_MS) { lastTick = tickStartedAt; simulate(); }
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
      // A full server may share one household, office or carrier NAT; each fighter retains its own quota below.
      limit(`api:${ipKey}`, LIVE_CAPACITY * 600);
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
        combatCover.delete(player.id);
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
  const timer = options.automaticTicks === false ? undefined : setInterval(tick, LIVE_TICK_MS);
  timer?.unref();
  return { fetch: fetchApi, tick, healthy: () => { try { return !closed && !failed && Boolean(db.query("SELECT 1 AS ready").get()); } catch { return false; } }, close: () => {
    if (closed) return;
    if (timer) clearInterval(timer);
    try { if (!failed) persist(); } finally { closed = true; db.close(); }
  } };
}
