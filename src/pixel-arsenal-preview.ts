import type { WeaponInstance } from './game/engine';
import { WEAPON_BY_ID } from './game/data';
import { MODULE_BY_ID, MODULE_SLOTS, type ModuleSlot } from './game/modules';

type RenderWeapon = Pick<WeaponInstance, 'weaponId' | 'modules' | 'durability'>;
type Preview = { weapon: RenderWeapon; appearance: number };
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const condition = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));

/** Share a visual assembly, never an inventory ID, account or game state. */
export function pixelArsenalPreviewUrl(weapon: RenderWeapon, appearance = 0): string {
  const modules = Object.fromEntries(MODULE_SLOTS.flatMap(slot => {
    const item = weapon.modules[slot];
    return item ? [[slot, { modelId: item.modelId, durability: item.durability }]] : [];
  }));
  return `/models.html#build=${encodeURIComponent(JSON.stringify({ weaponId: weapon.weaponId, durability: weapon.durability, modules, appearance }))}`;
}

/** Untrusted URL input is bounded and checked before it reaches any geometry. */
export function readPixelArsenalPreview(hash: string): Preview | null {
  if (!hash.startsWith('#build=') || hash.length > 8_000) return null;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(hash.slice(7)));
    if (!record(value) || !keys(value, ['weaponId', 'durability', 'modules', 'appearance'])
      || typeof value.weaponId !== 'string' || !Object.hasOwn(WEAPON_BY_ID, value.weaponId) || !condition(value.durability)
      || !Number.isInteger(value.appearance) || (value.appearance as number) < 0 || (value.appearance as number) > 31
      || !record(value.modules) || !keys(value.modules, MODULE_SLOTS)) return null;
    const modules: RenderWeapon['modules'] = {};
    for (const slot of MODULE_SLOTS) {
      const item = value.modules[slot];
      if (item === undefined) continue;
      if (!record(item) || !keys(item, ['modelId', 'durability']) || typeof item.modelId !== 'string'
        || !Object.hasOwn(MODULE_BY_ID, item.modelId) || MODULE_BY_ID[item.modelId]!.slot !== slot || !condition(item.durability)) return null;
      modules[slot as ModuleSlot] = { id: `preview-${slot}`, modelId: item.modelId, durability: item.durability, foundAt: 0 };
    }
    return { weapon: { weaponId: value.weaponId, durability: value.durability, modules }, appearance: value.appearance as number };
  } catch { return null; }
}
