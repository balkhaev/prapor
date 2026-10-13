import type { GameState } from "./engine";
import type { ShelterCost } from "./shelter";

export type FieldKit = "maintenance" | "trauma";
export type FieldKitSelection = FieldKit | "none";
export interface ShelterLogistics {
	reserve: ShelterCost;
	kits: Record<FieldKit, number>;
}
export const FIELD_KIT_CAPACITY = 8;
export const FIELD_KITS: Record<FieldKit, { label: string; description: string; recipeId: string; wearMultiplier: number; injuryMultiplier: number; capacity: number }> = {
	maintenance: { label: "Ремкомплект", description: "На весь выход: на 40% меньше износ оружия и его деталей. Занимает единственное место поддержки.", recipeId: "maintenance-kit", wearMultiplier: .6, injuryMultiplier: 1, capacity: FIELD_KIT_CAPACITY },
	trauma: { label: "Травмокомплект", description: "На весь выход: на 35% легче ранения. Занимает единственное место поддержки; не заменяет аптечку для спасения товарища.", recipeId: "trauma-kit", wearMultiplier: 1, injuryMultiplier: .65, capacity: FIELD_KIT_CAPACITY },
};
export function getProductionReserve(state: Pick<GameState, "shelter">): ShelterCost {
	const reserve = state.shelter.logistics?.reserve;
	return { money: reserve?.money ?? 0, supplies: { ammo: reserve?.supplies.ammo ?? 0, medicine: reserve?.supplies.medicine ?? 0, scrap: reserve?.supplies.scrap ?? 0, intel: reserve?.supplies.intel ?? 0 } };
}
export function getFieldKitStock(state: Pick<GameState, "shelter">): Record<FieldKit, number> {
	return { maintenance: state.shelter.logistics?.kits.maintenance ?? 0, trauma: state.shelter.logistics?.kits.trauma ?? 0 };
}
export function ensureShelterLogistics(state: Pick<GameState, "shelter">): ShelterLogistics {
	return state.shelter.logistics ??= { reserve: getProductionReserve(state), kits: getFieldKitStock(state) };
}
export function getFieldKitEffects(kit?: FieldKit): { wearMultiplier: number; injuryMultiplier: number } {
	return kit ? FIELD_KITS[kit] : { wearMultiplier: 1, injuryMultiplier: 1 };
}
