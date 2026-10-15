import { expect, test } from 'bun:test';
import { WEAPONS } from '../src/game/data';
import { getWeaponBuildIssues } from '../src/game/engine';
import { MODULE_SLOTS } from '../src/game/modules';
import { MODULE_DISPLAY_SLOTS } from '../src/module-catalog';
import { changePixelPreviewModule, copyPixelPreviewBuild, pixelPreviewModuleOptions } from '../src/pixel-model-builds';
import { createWeaponShowcaseBuild } from '../src/weapon-showcase';

test('the model workshop can inspect every catalog platform and both authored build presets', () => {
  expect(WEAPONS).toHaveLength(39);
  for (const definition of WEAPONS) for (const preset of ['factory', 'field'] as const) {
    const weapon = createWeaponShowcaseBuild(definition.id, preset);
    expect(getWeaponBuildIssues(weapon)).toEqual([]);
    for (const slot of MODULE_SLOTS) {
      const part = weapon.modules[slot];
      if (part) expect(pixelPreviewModuleOptions(weapon, slot).some(option => option.model.id === part.modelId && !option.reason)).toBe(true);
    }
  }
});

test('preview copies keep imported arsenal parts and wear independent', () => {
  const original = createWeaponShowcaseBuild('m4a1'); original.durability = 22; original.modules.receiver!.durability = 22; original.modules.barrel!.durability = 37;
  const copy = copyPixelPreviewBuild(original); copy.modules.barrel!.durability = 99;
  expect(original.modules.barrel!.durability).toBe(37);
  const changed = changePixelPreviewModule(original, 'barrel', '');
  expect(changed.weapon.modules.barrel).toBeUndefined(); expect(original.modules.barrel).toBeDefined();
  expect(getWeaponBuildIssues(changed.weapon).some(issue => issue.includes('ствол'))).toBe(true);
  const receiver = changePixelPreviewModule(original, 'receiver', original.modules.receiver!.modelId);
  expect(receiver.weapon.durability).toBe(100); expect(receiver.weapon.modules.receiver!.durability).toBe(100);
  expect(original.durability).toBe(22); expect(original.modules.receiver!.durability).toBe(22);
  expect(changePixelPreviewModule(original, 'receiver', '').weapon.durability).toBe(22);
});

test('all eleven preview slots can be cleared and only compatible parts can be installed', () => {
  let full = createWeaponShowcaseBuild('m4a1', 'field');
  for (const slot of MODULE_DISPLAY_SLOTS) if (!full.modules[slot]) {
    const option = pixelPreviewModuleOptions(full, slot).find(candidate => !candidate.reason)!;
    expect(option).toBeDefined(); full = changePixelPreviewModule(full, slot, option.model.id).weapon;
  }
  expect(Object.keys(full.modules)).toHaveLength(11); expect(getWeaponBuildIssues(full)).toEqual([]);
  const before = JSON.stringify(full);
  for (const slot of MODULE_SLOTS) {
    const result = changePixelPreviewModule(full, slot, '');
    expect(result.error).toBeNull(); expect(result.weapon.modules[slot]).toBeUndefined();
    expect(JSON.stringify(full)).toBe(before);
  }
  const original = createWeaponShowcaseBuild('pm');
  expect(changePixelPreviewModule(original, 'receiver', 'receiver-akm').error).toBeTruthy();
  expect(changePixelPreviewModule(original, 'optic', 'optic-reflex').error).toContain('крепление');
});

test('removing an attachment support visibly cascades only unsupported parts', () => {
  let weapon = createWeaponShowcaseBuild('akm');
  const rail = pixelPreviewModuleOptions(weapon, 'handguard').find(option => option.model.appearance === 'rail')!.model;
  weapon = changePixelPreviewModule(weapon, 'handguard', rail.id).weapon;
  weapon = changePixelPreviewModule(weapon, 'optic', 'optic-reflex').weapon;
  expect(weapon.modules.optic).toBeDefined();
  const result = changePixelPreviewModule(weapon, 'handguard', '');
  expect(result.removed).toContain('Коллиматор «Точка»'); expect(result.weapon.modules.optic).toBeUndefined();
  expect(weapon.modules.optic).toBeDefined();
});
