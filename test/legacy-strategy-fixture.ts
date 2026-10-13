import { withoutLoot } from "./legacy-loot-fixture";

/** A paid pre-arsenal sortie keeps the loot catalogue that existed on departure. */
export function withoutArsenalLoot<T>(value: T): T {
	const state = value as { raids?: { expedition?: { lootCatalogVersion?: unknown } | null }[] };
	for (const raid of state.raids ?? []) if (raid.expedition) delete raid.expedition.lootCatalogVersion;
	return value;
}

/** Remove fields unavailable in v1–11 when deriving an authentic old fixture. */
export function withoutRaidStrategy<T>(value: T): T {
	const state = value as {
		sectorIntel?: unknown;
		scavs?: { raidPlan?: unknown }[];
		raids?: { strategy?: unknown; expedition?: { reconCompleted?: unknown; ammunition?: unknown } | null }[];
		history?: { strategy?: unknown; sectorOutcome?: unknown; reconCompleted?: unknown }[];
	};
	delete state.sectorIntel;
	for (const scav of state.scavs ?? []) delete scav.raidPlan;
	for (const raid of state.raids ?? []) {
		delete raid.strategy;
		if (raid.expedition) { delete raid.expedition.reconCompleted; delete raid.expedition.ammunition; }
	}
	for (const report of state.history ?? []) {
		delete report.strategy;
		delete report.sectorOutcome;
		delete report.reconCompleted;
	}
	return withoutLoot(withoutArsenalLoot(value));
}
