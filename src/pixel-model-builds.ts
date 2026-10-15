import type { WeaponInstance } from './game/engine';
import { getResolvedModuleMounts, MODULE_BY_ID, MODULE_MODELS, MODULE_SLOTS, type ModuleModel, type ModuleSlot } from './game/modules';
import { moduleFitsWeaponFamily, moduleMountLabel } from './module-catalog';

/** A preview owns its copy. Neither imported arsenal builds nor game inventory are edited. */
export function copyPixelPreviewBuild(weapon: Pick<WeaponInstance, 'weaponId' | 'modules' | 'durability'>): WeaponInstance {
  return { id: 'model-preview', weaponId: weapon.weaponId, durability: weapon.durability, attachments: { optic: 0, magazine: 0, stock: 0 }, foundAt: 0, modules: structuredClone(weapon.modules) };
}

export function pixelPreviewModuleReason(weapon: WeaponInstance, model: ModuleModel): string | null {
  if (!moduleFitsWeaponFamily(model, weapon.weaponId)) return 'Другая платформа или калибр';
  return model.requiresMount && !getResolvedModuleMounts(weapon.modules, model.slot).includes(model.requiresMount)
    ? `Нужно крепление: ${moduleMountLabel(model.requiresMount).toLowerCase()}` : null;
}

export function pixelPreviewModuleOptions(weapon: WeaponInstance, slot: ModuleSlot): { model: ModuleModel; reason: string | null }[] {
  return MODULE_MODELS.filter(model => model.slot === slot && moduleFitsWeaponFamily(model, weapon.weaponId)).map(model => ({ model, reason: pixelPreviewModuleReason(weapon, model) }));
}

/** Removing a provider also removes its unsupported props, exactly as advertised in the UI. */
export function changePixelPreviewModule(weapon: WeaponInstance, slot: ModuleSlot, modelId: string): { weapon: WeaponInstance; removed: string[]; error: string | null } {
  const copy = copyPixelPreviewBuild(weapon), model = modelId ? MODULE_BY_ID[modelId] : undefined;
  if (modelId && (!model || model.slot !== slot)) return { weapon: copy, removed: [], error: 'Неизвестная деталь для этого места' };
  const reason = model ? pixelPreviewModuleReason(copy, model) : null;
  if (reason) return { weapon: copy, removed: [], error: reason };
  if (model) {
    copy.modules[slot] = { id: `model-preview-${model.id}`, modelId: model.id, durability: 100, foundAt: 0 };
    if (slot === 'receiver') copy.durability = 100;
  }
  else delete copy.modules[slot];
  const removed: string[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const checkSlot of MODULE_SLOTS) {
      const part = copy.modules[checkSlot]; if (!part) continue;
      const definition = MODULE_BY_ID[part.modelId];
      if (!definition || pixelPreviewModuleReason(copy, definition)) { removed.push(definition?.label ?? checkSlot); delete copy.modules[checkSlot]; changed = true; }
    }
  }
  return { weapon: copy, removed, error: null };
}
