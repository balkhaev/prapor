/** Private, in-process bridge. HTTP clients never submit parcels, owner keys or rewards. */
import type { LiveEntryStock, LiveKitId, LiveLoadout } from '../src/game/live-entry';
export interface LiveEconomyIdentity { key: string; gameId: string; name: string }
export type EconomyLoot =
  | { id: string; modelId: string; foundAt: number; kind?: 'loot' }
  | { id: string; modelId: string; foundAt: number; kind: 'gear' | 'module'; durability: number };
export interface LiveDelivery {
  id: string; owner: string; gameId: string; createdAt: number; money: number; items: EconomyLoot[];
}
export interface LiveSupplyRequest {
  id: string; owner: string; gameId: string; createdAt: number; ammo: number; medkits: number;
  /** Authored kit identity only; price, weapon and protection are resolved by headquarters. */
  kitId?: LiveKitId;
}
export interface LiveSupplyReceipt { ammo: number; medkits: number; message: string; loadout?: LiveLoadout; money?: number }
export interface LiveEconomy {
  resolve(request: Request): LiveEconomyIdentity;
  entry?(identity: LiveEconomyIdentity): LiveEntryStock;
  deliver(parcel: LiveDelivery): { ok: boolean; message: string };
  supply(request: LiveSupplyRequest): LiveSupplyReceipt;
}
export class LiveEconomyError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
