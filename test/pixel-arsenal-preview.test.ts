import { expect, test } from 'bun:test';
import { pixelArsenalPreviewUrl, readPixelArsenalPreview } from '../src/pixel-arsenal-preview';
import { createWeaponShowcaseBuild } from '../src/weapon-showcase';
import { MODULE_SLOTS } from '../src/game/modules';
import { WEAPONS } from '../src/game/data';

test('every arsenal assembly travels to the actor preview with exact models and conditions only', () => {
  for (const definition of WEAPONS) for (const preset of ['factory', 'field'] as const) {
    const weapon = createWeaponShowcaseBuild(definition.id, preset);
    weapon.durability = 67.25;
    for (const item of Object.values(weapon.modules)) item.durability = 43.5;
    const url = pixelArsenalPreviewUrl(weapon, 27), read = readPixelArsenalPreview(url.slice(url.indexOf('#')))!;
    expect(read.appearance).toBe(27); expect(read.weapon.weaponId).toBe(definition.id); expect(read.weapon.durability).toBe(67.25);
    for (const slot of MODULE_SLOTS) {
      expect(read.weapon.modules[slot]?.modelId).toBe(weapon.modules[slot]?.modelId);
      expect(read.weapon.modules[slot]?.durability).toBe(weapon.modules[slot]?.durability);
      if (weapon.modules[slot]) expect(url).not.toContain(encodeURIComponent(weapon.modules[slot]!.id));
    }
    expect(read.weapon).not.toHaveProperty('id'); expect(read.weapon).not.toHaveProperty('attachments');
  }
});

test('missing parts remain missing, and malformed or private URL payloads are rejected', () => {
  const weapon = createWeaponShowcaseBuild('ak74', 'factory'); weapon.modules = {};
  const hash = pixelArsenalPreviewUrl(weapon).split('#')[1]!;
  expect(readPixelArsenalPreview(`#${hash}`)?.weapon.modules).toEqual({});
  const raw = { weaponId: 'ak74', durability: 100, modules: {}, appearance: 0 };
  for (const value of [null, [], { ...raw, weaponId: '__proto__' }, { ...raw, appearance: 32 }, { ...raw, durability: -1 },
    { ...raw, id: 'private-id' }, { ...raw, modules: { optic: { modelId: 'receiver-ak74', durability: 100 } } },
    { ...raw, modules: { bogus: 'module' } }, { ...raw, modules: { receiver: { modelId: weapon.weaponId, durability: 100, id: 'private' } } }]) {
    expect(readPixelArsenalPreview(`#build=${encodeURIComponent(JSON.stringify(value))}`)).toBeNull();
  }
  for (const hash of ['', '#build=%invalid', '#build={', `#build=${'a'.repeat(8_000)}`]) expect(readPixelArsenalPreview(hash)).toBeNull();
});
