/** Shared wire contract. The server owns every live position, clock and reward. */
export const LIVE_SERVER_ID = "perimeter-1";
export const LIVE_SERVER_NAME = "Периметр 01";
export const LIVE_CAPACITY = 32;
export type LivePoint = { x: number; y: number };
export interface LiveObstacle extends LivePoint { width: number; height: number }
export interface LiveWorld {
  width: number;
  height: number;
  obstacles: LiveObstacle[];
  extracts: LivePoint[];
}
export interface LiveEntity extends LivePoint {
  id: string;
  kind: "player" | "scav";
  name: string;
  appearance: number;
  health: number;
  action: "idle" | "moving" | "combat" | "downed";
  safeUntil: number;
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
}
export interface LiveDrop extends LivePoint { id: string; amount: number }
export interface LiveEvent {
  id: string;
  at: number;
  kind: "join" | "leave" | "combat" | "loot" | "extract" | "respawn";
  text: string;
  actorId?: string;
  targetId?: string;
}
export interface LiveStatus {
  id: string;
  name: string;
  online: number;
  capacity: number;
  startedAt: number;
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
  | { type: "loot"; id: string }
  | { type: "heal" }
  | { type: "extract" }
  | { type: "respawn" }
  | { type: "patrol"; enabled: boolean };
