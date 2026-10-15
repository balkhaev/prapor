import type { LiveEntity, LivePlayer } from './game/live';
import { getBoss } from './game/bosses';
import type { PixelActorGear } from './pixel-actors';
import { pixelWeaponId, type PixelWeaponInput } from './pixel-weapons';
import { MODULE_SLOTS } from './game/modules';

/** Visible equipment is server-authored. Legacy packets may only identify our
 * own paid kit or a public boss; another fighter's inventory is never guessed. */
export function pixelActorLoadout(entity: LiveEntity, self: Pick<LivePlayer, 'id' | 'loadout'>): { weapon: PixelWeaponInput; gear?: PixelActorGear } {
  const visible = entity.visualLoadout;
  if (visible) return {
    weapon: visible.modules !== undefined && pixelWeaponId(visible.weaponId) !== 'unknown' ? {
      weaponId: visible.weaponId!, durability: 100,
      modules: Object.fromEntries(MODULE_SLOTS.flatMap(slot => visible.modules![slot] ? [[slot, { id: `visible-${slot}`, modelId: visible.modules![slot]!, durability: 100, foundAt: 0 }]] : [])),
    } : pixelWeaponId(visible.weaponId),
    gear: { profile: visible.profile, helmet: visible.helmet, armor: visible.armor, backpack: visible.backpack },
  };
  if (entity.id === self.id && self.loadout) {
    const kit = self.loadout;
    return { weapon: pixelWeaponId(kit.weaponId), gear: { profile: kit.kitId === 'scav' ? 'light' : kit.kitId, helmet: kit.helmetProtection > 0, armor: kit.armorProtection > 0, backpack: false } };
  }
  return { weapon: pixelWeaponId(entity.bossId ? getBoss(entity.bossId)?.weaponId : undefined) };
}
