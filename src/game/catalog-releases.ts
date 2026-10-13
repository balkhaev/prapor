import { MODULE_MODELS } from "./modules";

/** Released catalogues keep their stable order for paid, seeded expeditions. */
export const ARSENAL_SAVE_VERSION = 17;
export const ARSENAL_WAVE_TWO_SAVE_VERSION = 19;
const legacyWeapons = new Set(["pm", "tt", "toz", "mp133", "pp91", "sks", "ak74", "saiga", "vityaz", "mosin", "akm", "vss", "rpk", "svd", "asval", "pkp"]);
const legacyModules = new Set(MODULE_MODELS.slice(0, 411).map((model) => model.id));
const firstWaveWeapons = new Set([...legacyWeapons, "m4a1", "hk416", "p90", "mp7", "ump45", "m1911", "mcx", "scarh", "trg42"]);
const firstWaveModules = new Set(MODULE_MODELS.slice(0, 621).map((model) => model.id));
export const weaponAvailableInSave = (id: string, version: number): boolean => version >= ARSENAL_WAVE_TWO_SAVE_VERSION || (version >= ARSENAL_SAVE_VERSION ? firstWaveWeapons : legacyWeapons).has(id);
export const moduleAvailableInSave = (id: string, version: number): boolean => version >= ARSENAL_WAVE_TWO_SAVE_VERSION || (version >= ARSENAL_SAVE_VERSION ? firstWaveModules : legacyModules).has(id);
