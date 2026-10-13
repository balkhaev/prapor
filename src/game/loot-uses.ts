import type { GameState } from "./engine";
import { LOOT_MODEL_BY_ID } from "./loot";
import { BARTER_OFFERS } from "./barter";
import { RESOURCE_RECIPES, ROOM_DEFINITIONS } from "./shelter";

export interface LootRequirement { modelId: string; quantity: number }
export interface LootRequirementProgress { modelId: string; required: number; owned: number }
export function getLootRequirementQuote(state: GameState, requirements: readonly LootRequirement[] = []) {
	const itemIds: string[] = [], selected = new Set<string>();
	const progress = requirements.map(value => {
		const available = (state.lootItems ?? []).filter(item => item.modelId === value.modelId && !selected.has(item.id));
		for (const item of available.slice(0, value.quantity)) { selected.add(item.id); itemIds.push(item.id); }
		return { modelId: value.modelId, required: value.quantity, owned: available.length };
	});
	const missing = progress.filter(value => value.owned < value.required);
	return { requirements: progress, itemIds, reason: missing.length ? `Нужны целые трофеи со склада: ${missing.map(value => `${LOOT_MODEL_BY_ID[value.modelId]!.label} ×${value.required - value.owned}`).join(", ")}.` : null };
}
export interface LootUse { kind: "barter" | "construction" | "production"; id: string; label: string; quantity: number }
/** Catalogue-only lookup: no game mutation or invented monetary value. */
export function getLootUses(modelId: string): LootUse[] {
	return [
		...BARTER_OFFERS.flatMap(offer => offer.requirements.filter(value => value.modelId === modelId).map(value => ({ kind: "barter" as const, id: offer.id, label: offer.label, quantity: value.quantity }))),
		...Object.entries(ROOM_DEFINITIONS).flatMap(([id, room]) => (room.lootRequirements ?? []).filter(value => value.modelId === modelId).map(value => ({ kind: "construction" as const, id, label: room.label, quantity: value.quantity }))),
		...RESOURCE_RECIPES.flatMap(recipe => (recipe.lootRequirements ?? []).filter(value => value.modelId === modelId).map(value => ({ kind: "production" as const, id: recipe.id, label: recipe.label, quantity: value.quantity }))),
	];
}
