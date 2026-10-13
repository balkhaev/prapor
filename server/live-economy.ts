/** Private, in-process bridge. HTTP clients never submit parcels, owner keys or rewards. */
export interface LiveEconomyIdentity { key: string; gameId: string; name: string }
export interface EconomyLoot { id: string; modelId: string; foundAt: number }
export interface LiveDelivery {
  id: string; owner: string; gameId: string; createdAt: number; money: number; items: EconomyLoot[];
}
export interface LiveSupplyRequest {
  id: string; owner: string; gameId: string; createdAt: number; ammo: number; medkits: number;
}
export interface LiveSupplyReceipt { ammo: number; medkits: number; message: string }
export interface LiveEconomy {
  resolve(request: Request): LiveEconomyIdentity;
  deliver(parcel: LiveDelivery): { ok: boolean; message: string };
  supply(request: LiveSupplyRequest): LiveSupplyReceipt;
}
export class LiveEconomyError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
