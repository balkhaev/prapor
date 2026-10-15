import type { LiveEntity, LivePlayer } from './game/live';
import { getBoss } from './game/bosses';
import type { PixelActorGear } from './pixel-actors';
import { pixelWeaponId, type PixelWeaponId } from './pixel-weapons';

/** Visible equipment is server-authored. Legacy packets may only identify our
 * own paid kit or a public boss; another fighter's inventory is never guessed. */
export function pixelActorLoadout(entity: LiveEntity, self: Pick<LivePlayer, 'id' | 'loadout'>): { weapon: PixelWeaponId; gear?: PixelActorGear } {
  const visible = entity.visualLoadout;
  if (visible) return {
    weapon: pixelWeaponId(visible.weaponId),
    gear: { profile: visible.profile, helmet: visible.helmet, armor: visible.armor, backpack: visible.backpack },
  };
  if (entity.id === self.id && self.loadout) {
    const kit = self.loadout;
    return { weapon: pixelWeaponId(kit.weaponId), gear: { profile: kit.kitId === 'scav' ? 'light' : kit.kitId, helmet: kit.helmetProtection > 0, armor: kit.armorProtection > 0, backpack: false } };
  }
  return { weapon: pixelWeaponId(entity.bossId ? getBoss(entity.bossId)?.weaponId : undefined) };
}
