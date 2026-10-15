import { describe, expect, test } from 'bun:test';
import { pixelActorLoadout } from '../src/pixel-loadout';
import { getLiveLoadout } from '../src/game/live-entry';
import type { LiveEntity } from '../src/game/live';
import { FACTORY_KITS, MODULE_SLOTS } from '../src/game/modules';
import { WEAPONS } from '../src/game/data';

const entity: LiveEntity = { id: 'other', kind: 'player', name: 'Другой', x: 2, y: 3, appearance: 27, health: 100, action: 'idle', safeUntil: 0 };
const self = { id: 'self', loadout: getLiveLoadout('assault') };

describe('visible field equipment in the raid renderer', () => {
  test('every weapon uses its explicit installed assembly and keeps removed slots empty', () => {
    for (const definition of WEAPONS) {
      const modules = { ...FACTORY_KITS[definition.id] };
      const visible = { profile: 'assault' as const, weaponId: definition.id, modules, helmet: true, armor: true, backpack: false };
      const weapon = pixelActorLoadout({ ...entity, visualLoadout: visible }, self).weapon;
      expect(typeof weapon).toBe('object'); if (typeof weapon === 'string') throw new Error('Lost arsenal build');
      expect(weapon.weaponId).toBe(definition.id);
      for (const slot of MODULE_SLOTS) expect(weapon.modules[slot]?.modelId).toBe(modules[slot]);
      expect(weapon.modules).not.toBe(modules);
      const stripped = pixelActorLoadout({ ...entity, visualLoadout: { ...visible, modules: {} } }, self).weapon;
      expect(typeof stripped === 'object' && stripped.modules).toEqual({});
    }
  });
  test('the public descriptor controls exact model and explicitly absent gear for every fighter', () => {
    const visualLoadout = { profile: 'light' as const, weaponId: 'pm', helmet: false, armor: false, backpack: false };
    for (const id of ['self', 'other']) {
      expect(pixelActorLoadout({ ...entity, id, faction: 'raiders', visualLoadout }, self)).toEqual({ weapon: 'pm', gear: { profile: 'light', helmet: false, armor: false, backpack: false } });
    }
    const changed = { ...visualLoadout, weaponId: 'svd', profile: 'scout' as const, helmet: true };
    expect(pixelActorLoadout({ ...entity, visualLoadout: changed }, self)).toEqual({ weapon: 'svd', gear: { profile: 'scout', helmet: true, armor: false, backpack: false } });
    expect(visualLoadout.weaponId).toBe('pm');
  });

  test('older packets can resolve our paid kit and public bosses without guessing another player loadout', () => {
    expect(pixelActorLoadout(entity, self)).toEqual({ weapon: 'unknown' });
    expect(pixelActorLoadout({ ...entity, id: self.id }, self)).toEqual({ weapon: 'pp91', gear: { profile: 'assault', helmet: true, armor: true, backpack: false } });
    expect(pixelActorLoadout({ ...entity, bossId: 'komendant' }, self).weapon).toBe('svd');
    expect(pixelActorLoadout({ ...entity, id: self.id }, { id: self.id }).weapon).toBe('unknown');
    for (const kitId of ['scav', 'assault', 'scout'] as const) {
      const resolved = pixelActorLoadout({ ...entity, id: self.id }, { id: self.id, loadout: getLiveLoadout(kitId) });
      expect(resolved.gear).toMatchObject({ helmet: true, armor: true, backpack: false });
    }
  });

  test('a future unsupported public model keeps its known equipment and uses the neutral silhouette', () => {
    const visualLoadout = { profile: 'scout' as const, weaponId: 'future-model', helmet: false, armor: true, backpack: false };
    expect(pixelActorLoadout({ ...entity, visualLoadout }, self)).toEqual({ weapon: 'unknown', gear: { profile: 'scout', helmet: false, armor: true, backpack: false } });
  });
});
