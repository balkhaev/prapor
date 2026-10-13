import { MODULE_MODELS } from "./modules";

/** v1–v15 used these platforms and the first 411 module models, in stable order. */
export const ARSENAL_SAVE_VERSION = 17;
const legacyWeapons = new Set(["pm", "tt", "toz", "mp133", "pp91", "sks", "ak74", "saiga", "vityaz", "mosin", "akm", "vss", "rpk", "svd", "asval", "pkp"]);
const legacyModules = new Set(MODULE_MODELS.slice(0, 411).map((model) => model.id));
export const weaponAvailableInSave = (id: string, version: number): boolean => version >= ARSENAL_SAVE_VERSION || legacyWeapons.has(id);
export const moduleAvailableInSave = (id: string, version: number): boolean => version >= ARSENAL_SAVE_VERSION || legacyModules.has(id);
