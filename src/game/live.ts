/** Shared wire contract. The server owns every live position, clock and reward. */
import type { BodyPart, HealthState, MedicalInventory, TreatmentType } from './health';
import type { BossId } from './bosses';
import type { LiveKitId, LiveLoadout } from './live-entry';
import type { ModuleSlot } from './modules';
export type { LiveKitId, LiveLoadout, LiveKitQuote, LiveEntry, LiveEntryFighter, LiveEntryStock } from './live-entry';
export type { EconomyLoot } from "../../server/live-economy";
import type { EconomyLoot } from "../../server/live-economy";
export { getLiveLootDefinition, getLiveLootWeight, readEconomyLoot, readEconomyLootItems, type LiveLootDefinition } from './live-loot';
/** One headquarters medicine funds one bundle: 40 HP and one use of each field aid. */
export const LIVE_MEDICAL_CAPACITY = { medkit: 80, bandage: 2, tourniquet: 1, splint: 1, painkiller: 1, surgery: 1 } as const;
export function liveMedicalSupplyNeeded(medicine: MedicalInventory): number {
  return Math.min(2, Math.max(0, Math.ceil((LIVE_MEDICAL_CAPACITY.medkit - medicine.medkit) / 40), ...(['bandage', 'tourniquet', 'splint', 'painkiller', 'surgery'] as const).map(type => LIVE_MEDICAL_CAPACITY[type] - medicine[type])));
}
export const LIVE_SERVER_ID = "perimeter-1";
export const LIVE_SERVER_NAME = "Периметр 01";
export const LIVE_CAPACITY = 32;
export const LIVE_LOOT_WEIGHT = 12;
export const LIVE_LOOT_CAPACITY = 32;
export const LIVE_PENDING_CAPACITY = 32;
export type LivePoint = { x: number; y: number };
export type LiveMapId = "perimeter";
export type LiveDistrictId = "customs" | "sawmill" | "depot" | "village";
export type LivePurpose = "pvp" | "pve" | "loot" | "quests" | "boss";
export type LiveContainerKind = "duffel" | "jacket" | "toolbox" | "medbag" | "cabinet" | "crate";
export type LiveTerrain = "road" | "concrete" | "forest" | "water" | "yard" | "grass" | "path" | "rail" | "sand";
/** Static geometry only. Row codes keep the ground layer compact on first join. */
export const LIVE_TERRAIN_CODES = { r: "road", c: "concrete", f: "forest", w: "water", y: "yard", g: "grass", p: "path", t: "rail", s: "sand" } as const satisfies Record<string, LiveTerrain>;
export interface LiveLandscapePath {
  id: string; name: string; kind: "road" | "trail" | "rail" | "river";
  width: number; points: LivePoint[];
}
export interface LiveCityRegion extends LivePoint {
  name: string; width: number; height: number;
  quarters: Array<LivePoint & { id: string; name: string; width: number; height: number }>;
}
export interface LiveCityBuilding extends LivePoint {
  id: string; name: string; width: number; height: number;
  kind: 'apartment' | 'shop' | 'workshop' | 'garage' | 'service';
  /** Authored gaps in collision walls, not a client movement permission. */
  entrances: LivePoint[];
  floors?: 1 | 2 | 3 | 4;
  roof?: 'gable' | 'flat' | 'sawtooth';
  roofAxis?: 'x' | 'y';
  facade?: 'brick' | 'plaster' | 'panel' | 'metal';
}
export const LIVE_PROP_KINDS = ['car', 'van', 'truck', 'bus', 'lamp', 'dumpster', 'pallet', 'crate', 'barrel', 'bench', 'planter', 'shed', 'sign', 'fence', 'shrub', 'tree', 'logs', 'railcar', 'transformer', 'playground', 'garden', 'kiosk', 'market-stall', 'workbench', 'hydrant', 'power-pole', 'bollard', 'bus-stop'] as const;
/** Public set dressing; blocking footprints have a matching authoritative obstacle. */
export interface LiveWorldProp extends LivePoint {
  id: string; kind: typeof LIVE_PROP_KINDS[number]; width: number; height: number;
  orientation: 'x' | 'y'; variant: number; blocking: boolean;
}
/** Public architecture only. Loot contents and nearby actors remain server-owned. */
export interface LiveCitySite extends LivePoint {
  id: string; poiId: string; quarterId: string; name: string; width: number; height: number;
  kind: 'courtyard' | 'arcade' | 'workyard' | 'service-yard';
  courtyard: LivePoint & { width: number; height: number };
  buildings: LiveCityBuilding[];
  passages: LivePoint[][];
}
/** Suggested exploration stops; these are guidance, not rewarded quest assignments. */
export interface LiveWorldRoute {
  id: string; name: string; description: string;
  districtId: LiveDistrictId; purpose: LivePurpose; poiIds: string[];
}
export interface LiveRouteSummary {
  id: string; name: string; description: string;
  districtId: LiveDistrictId; purpose: LivePurpose; stops: string[];
}
export interface LiveObstacle extends LivePoint {
  width: number; height: number;
  kind?: "building" | "wall" | "container" | "barricade" | "tree" | "water";
  label?: string;
  propId?: string;
}
export interface LiveZone extends LivePoint {
  width: number; height: number; name: string; terrain: LiveTerrain; danger: 1 | 2 | 3;
}
export interface LiveMapSummary {
  id: LiveMapId; name: string; description: string;
  theme: "industrial" | "forest" | "urban" | "mixed";
  width: number; height: number; online: number; npcs: number;
  city?: LiveCityRegion;
}
export interface LiveWorld {
  id: LiveMapId;
  name: string;
  description: string;
  theme: LiveMapSummary["theme"];
  width: number;
  height: number;
  obstacles: LiveObstacle[];
  extracts: LivePoint[];
  zones: LiveZone[];
  version: string;
  seed: string;
  generatorVersion: number;
  chunkSize: number;
  districts: LiveDistrict[];
  pois: LivePoi[];
  containers: LiveContainerAnchor[];
  /** Older world/fixture contracts can omit these; generated V2 and later worlds provide both. */
  terrainRows?: string[];
  paths?: LiveLandscapePath[];
  routes?: LiveWorldRoute[];
  city?: LiveCityRegion;
  /** Available from V5; reused with the immutable world, never repeated in status. */
  citySites?: LiveCitySite[];
  props?: LiveWorldProp[];
}
export interface LiveDistrict extends LivePoint {
  id: LiveDistrictId; name: string; description: string;
  width: number; height: number; theme: "industrial" | "forest" | "urban";
  spawns: LivePoint[];
  labelPoint?: LivePoint;
}
export interface LivePoi extends LivePoint {
  id: string; templateId: string; name: string; districtId: LiveDistrictId;
  width: number; height: number; danger: 1 | 2 | 3;
  tags: string[];
  entrances: LivePoint[];
}
export interface LiveContainerAnchor extends LivePoint {
  id: string; poiId: string; kind: LiveContainerKind;
  lootTable: "mixed" | "tools" | "medical" | "intel" | "valuables" | "provisions";
  searchMs: number;
}
/** Public silhouettes only: no weapon stats, protection values or private inventory. */
export interface LiveVisualLoadout {
  profile: 'light' | 'assault' | 'scout';
  /** Older fighters can lack an authored model. Never infer it from their name or skin. */
  weaponId?: string;
  /** Model IDs only. An explicit empty assembly must not grow factory parts. */
  modules?: Partial<Record<ModuleSlot, string>>;
  helmet: boolean;
  armor: boolean;
  backpack: boolean;
}
export interface LiveEntity extends LivePoint {
  id: string;
  kind: "player" | "scav";
  name: string;
  appearance: number;
  health: number;
  action: "idle" | "moving" | "combat" | "downed";
  safeUntil: number;
  /** Observed walking pace only; never exposes a destination or unobserved path. */
  moveIntervalMs?: number;
  /** Optional for older snapshots; visible equipment is projected after visibility filtering. */
  visualLoadout?: LiveVisualLoadout;
  /** Visible signs only; another player's body and medicines stay private. */
  bleeding?: boolean;
  limping?: boolean;
  aimUntil?: number;
  aimTargetId?: string;
  faction?: "scavs" | "raiders";
  role?: "patrol" | "guard" | "marksman";
  bossId?: BossId;
}
export interface LiveTreatment { type: TreatmentType; part: BodyPart; startedAt: number; endsAt: number }
/** Private sortie orders and observed targets, decided by the authoritative server. */
export interface LiveAutomation {
  enabled: boolean;
  stage: 'route' | 'combat' | 'search' | 'loot' | 'treat' | 'extract' | 'paused' | 'complete' | 'downed';
  goal: string;
  targetId: string | null;
  target: LivePoint | null;
  routeId: string | null;
  routeName: string | null;
  stopIndex: number;
  stopCount: number;
  reason: string | null;
  startedAt: number;
  completedAt: number;
}
export interface LivePlayer {
  id: string;
  ammo: number;
  /** Absent on older fighters, whose paid/persistent combat rules remain unchanged. */
  loadout?: LiveLoadout;
  launchPending?: boolean;
  /** Older manual fighters and snapshots can omit automatic sortie orders. */
  automation?: LiveAutomation;
  medkits: number;
  cargo: number;
  stash: number;
  kills: number;
  bossKills?: number;
  respawnAt: number;
  patrol: boolean;
  body: HealthState;
  medicine: MedicalInventory;
  treatment: LiveTreatment | null;
  leaveAt: number;
  targetId: string | null;
  travelReadyAt: number;
  districtId: LiveDistrictId;
  purpose: LivePurpose;
  searching: { id: string; readyAt: number } | null;
  /** Only the current player's private inventory is included in a snapshot. */
  gameId?: string;
  lootItems?: EconomyLoot[];
  pendingDelivery?: { items: EconomyLoot[]; money: number; message: string }[];
  economyMessage?: string;
}
export interface LiveDrop extends LivePoint {
  id: string; amount: number; items?: EconomyLoot[];
  bossId?: BossId;
  containerId?: string; containerKind?: LiveContainerKind;
  searched?: boolean;
}
export interface LiveEvent {
  id: string;
  at: number;
  kind: "join" | "leave" | "combat" | "loot" | "extract" | "respawn" | "travel";
  text: string;
  actorId?: string;
  targetId?: string;
  from?: LivePoint;
  to?: LivePoint;
  damage?: number;
}
export interface LiveBossStatus {
  bossId: BossId; name: string; districtId: LiveDistrictId; poiId: string;
  /** Authored arena only; the invisible NPC's current position remains private. */
  area: LivePoint & { width: number; height: number };
  state: 'alive' | 'defeated'; respawnAt: number;
}
export interface LiveStatus {
  id: string;
  name: string;
  online: number;
  capacity: number;
  startedAt: number;
  maps: LiveMapSummary[];
  districts: Array<LiveDistrict & { online: number; npcs: number }>;
  routes?: LiveRouteSummary[];
  bosses?: LiveBossStatus[];
}
export interface LiveSnapshot {
  server: LiveStatus;
  now: number;
  world: LiveWorld;
  selfId: string;
  self: LivePlayer;
  entities: LiveEntity[];
  drops: LiveDrop[];
  events: LiveEvent[];
  worldVersion: string;
  visibleChunks: LivePoint[];
}
export type LiveCommand =
  | { type: "move"; x: number; y: number }
  | { type: "attack"; targetId: string; aimed?: boolean }
  | { type: "engage"; targetId: string | null }
  | { type: "travel"; mapId: LiveMapId }
  | { type: "loot"; id: string }
  | { type: "search"; id: string }
  | { type: "heal" }
  | { type: "treat"; medicine: TreatmentType; part: BodyPart }
  | { type: "cancelTreatment" }
  | { type: "extract" }
  | { type: "respawn"; districtId?: LiveDistrictId; purpose?: LivePurpose; kitId?: LiveKitId }
  | { type: "resupply" }
  | { type: "automation"; enabled: boolean; routeId?: string }
  | { type: "recall" }
  | { type: "patrol"; enabled: boolean };
