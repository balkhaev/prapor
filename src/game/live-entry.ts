import type { HealthState, MedicalInventory } from './health';
import type { LiveDistrictId, LivePurpose, LiveStatus } from './live';

export type LiveKitId = 'scav' | 'assault' | 'scout';
/** A non-tradable field kit. It never copies an item from the headquarters arsenal. */
export interface LiveLoadout {
  kitId: LiveKitId; label: string; weaponId: string; weaponName: string;
  damage: number; range: number; attackMs: number;
  armorProtection: number; helmetProtection: number; maxAmmo: number;
}
export interface LiveEntryStock { money: number; ammo: number; medicine: number }
export interface LiveKitQuote extends LiveLoadout {
  ammo: number; medkits: number;
  cost: { money: number; ammo: number; medicine: number };
  reason: string | null;
}
export interface LiveEntryFighter {
  id: string; name: string; x: number; y: number; health: number;
  body: HealthState; medicine: MedicalInventory; ammo: number;
  districtId: LiveDistrictId; purpose: LivePurpose; cargo: number; lootCount: number;
  respawnAt: number; online: boolean; launchPending?: boolean; loadout?: LiveLoadout;
}
export interface LiveEntry {
  server: LiveStatus; now: number; mode: 'new' | 'continue' | 'downed';
  fighter: LiveEntryFighter | null; stock: LiveEntryStock | null; kits: LiveKitQuote[];
}
export const LIVE_FIELD_KITS: Readonly<Record<LiveKitId, LiveLoadout & { money: number }>> = {
  scav: { kitId: 'scav', label: 'Лёгкий комплект', weaponId: 'pm', weaponName: 'ПМ', damage: 34, range: 5, attackMs: 1500, armorProtection: .12, helmetProtection: .08, maxAmmo: 24, money: 0 },
  assault: { kitId: 'assault', label: 'Штурмовой комплект', weaponId: 'pp91', weaponName: 'ПП-91 «Кедр»', damage: 36, range: 6, attackMs: 900, armorProtection: .3, helmetProtection: .2, maxAmmo: 60, money: 180 },
  scout: { kitId: 'scout', label: 'Комплект разведчика', weaponId: 'sks', weaponName: 'СКС', damage: 42, range: 9, attackMs: 2000, armorProtection: .16, helmetProtection: .1, maxAmmo: 40, money: 140 },
};
export function isLiveKitId(value: unknown): value is LiveKitId { return typeof value === 'string' && Object.hasOwn(LIVE_FIELD_KITS, value); }
export function getLiveLoadout(kitId: LiveKitId): LiveLoadout {
  const { money: _money, ...loadout } = LIVE_FIELD_KITS[kitId]; return { ...loadout };
}
export function quoteLiveKits(stock: LiveEntryStock): LiveKitQuote[] {
  return (Object.keys(LIVE_FIELD_KITS) as LiveKitId[]).map(kitId => {
    const kit = LIVE_FIELD_KITS[kitId], ammo = Math.min(kit.maxAmmo, Math.max(0, Math.floor(stock.ammo))), medkits = Math.min(2, Math.max(0, Math.floor(stock.medicine)));
    return { ...getLiveLoadout(kitId), ammo, medkits, cost: { money: kit.money, ammo, medicine: medkits },
      reason: stock.money < kit.money ? `Нужно ${kit.money} ₽ на полевой комплект.` : ammo < 1 ? 'На складе нет патронов. Пополните припасы в убежище.' : null };
  });
}
