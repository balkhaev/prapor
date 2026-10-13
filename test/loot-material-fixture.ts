import type { GameState, LootRequirement } from "../src/game/engine";
import { ROOM_DEFINITIONS } from "../src/game/shelter";

/** Existing construction tests fund all costs, including the physical components added in v21. */
export function fundConstructionLoot<T extends GameState>(state: T): T {
	const totals = new Map<string, number>();
	for (const room of Object.values(ROOM_DEFINITIONS)) for (const value of room.lootRequirements ?? []) totals.set(value.modelId, (totals.get(value.modelId) ?? 0) + value.quantity);
	addLootInputs(state, [...totals].map(([modelId, quantity]) => ({ modelId, quantity })));
	return state;
}
export function addLootInputs(state: GameState, requirements: readonly LootRequirement[] = []) {
	for (const value of requirements) {
		const owned = (state.lootItems ?? []).filter(item => item.modelId === value.modelId).length;
		for (let index = owned; index < value.quantity; index++) (state.lootItems ??= []).push({ id: `loot-${state.nextId++}`, modelId: value.modelId, foundAt: state.lastUpdated });
	}
}
/** Derive a released save without adding future physical payment receipts to historical work. */
export function withoutLootMaterials<T>(state: T): T {
	const value = state as { shelter?: { rooms?: { construction?: { paidLoot?: unknown } | null; queue?: { paidLoot?: unknown }[] }[] } };
	for (const room of value.shelter?.rooms ?? []) { if (room.construction) delete room.construction.paidLoot; for (const job of room.queue ?? []) delete job.paidLoot; }
	return state;
}
