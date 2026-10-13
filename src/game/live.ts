/** Shared wire contract. The server owns every live position, clock and reward. */
export type { EconomyLoot } from "../../server/live-economy";
import type { EconomyLoot } from "../../server/live-economy";
export const LIVE_SERVER_ID = "perimeter-1";
export const LIVE_SERVER_NAME = "Периметр 01";
export const LIVE_CAPACITY = 32;
export const LIVE_LOOT_WEIGHT = 12;
export const LIVE_LOOT_CAPACITY = 32;
export const LIVE_PENDING_CAPACITY = 32;
export type LivePoint = { x: number; y: number };
export type LiveMapId = "customs" | "sawmill" | "depot";
export type LiveTerrain = "road" | "concrete" | "forest" | "water" | "yard";
export interface LiveObstacle extends LivePoint {
  width: number; height: number;
  kind?: "building" | "wall" | "container" | "barricade" | "tree";
  label?: string;
}
export interface LiveZone extends LivePoint {
  width: number; height: number; name: string; terrain: LiveTerrain; danger: 1 | 2 | 3;
}
export interface LiveMapSummary {
  id: LiveMapId; name: string; description: string;
  theme: "industrial" | "forest" | "urban";
  width: number; height: number; online: number; npcs: number;
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
}
export interface LiveEntity extends LivePoint {
  id: string;
  kind: "player" | "scav";
  name: string;
  appearance: number;
  health: number;
  action: "idle" | "moving" | "combat" | "downed";
  safeUntil: number;
  faction?: "scavs" | "raiders";
  role?: "patrol" | "guard" | "marksman";
}
export interface LivePlayer {
  id: string;
  ammo: number;
  medkits: number;
  cargo: number;
  stash: number;
  kills: number;
  respawnAt: number;
  patrol: boolean;
  targetId: string | null;
  travelReadyAt: number;
  /** Only the current player's private inventory is included in a snapshot. */
  gameId?: string;
  lootItems?: EconomyLoot[];
  pendingDelivery?: { items: EconomyLoot[]; money: number; message: string }[];
  economyMessage?: string;
}
export interface LiveDrop extends LivePoint { id: string; amount: number; items?: EconomyLoot[] }
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
}
export type LiveCommand =
  | { type: "move"; x: number; y: number }
  | { type: "attack"; targetId: string }
  | { type: "engage"; targetId: string | null }
  | { type: "travel"; mapId: LiveMapId }
  | { type: "loot"; id: string }
  | { type: "heal" }
  | { type: "extract" }
  | { type: "respawn" }
  | { type: "resupply" }
  | { type: "patrol"; enabled: boolean };
