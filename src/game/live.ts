/** Shared wire contract. The server owns every live position, clock and reward. */
import type { BodyPart, HealthState, MedicalInventory, TreatmentType } from './health';
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
export type LivePurpose = "pvp" | "pve" | "loot" | "quests";
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
export interface LiveEntity extends LivePoint {
  id: string;
  kind: "player" | "scav";
  name: string;
  appearance: number;
  health: number;
  action: "idle" | "moving" | "combat" | "downed";
  safeUntil: number;
  /** Visible signs only; another player's body and medicines stay private. */
  bleeding?: boolean;
  limping?: boolean;
  aimUntil?: number;
  aimTargetId?: string;
  faction?: "scavs" | "raiders";
  role?: "patrol" | "guard" | "marksman";
}
export interface LiveTreatment { type: TreatmentType; part: BodyPart; startedAt: number; endsAt: number }
export interface LivePlayer {
  id: string;
  ammo: number;
  medkits: number;
  cargo: number;
  stash: number;
  kills: number;
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
export interface LiveStatus {
  id: string;
  name: string;
  online: number;
  capacity: number;
  startedAt: number;
  maps: LiveMapSummary[];
  districts: Array<LiveDistrict & { online: number; npcs: number }>;
  routes?: LiveRouteSummary[];
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
  | { type: "respawn"; districtId?: LiveDistrictId; purpose?: LivePurpose }
  | { type: "resupply" }
  | { type: "patrol"; enabled: boolean };
