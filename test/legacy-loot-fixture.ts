/** Derive a pre-loot save without silently inventing v15 fields in old fixtures. */
export function withoutLoot<T>(value: T): T {
	const state = value as {
		lootItems?: unknown;
		raids?: { lootVersion?: unknown; expedition?: { cargo?: { lootItems?: unknown } } | null }[];
		history?: { lootItems?: unknown; lootAutoSold?: unknown; lostCargo?: { lootItems?: unknown } | null }[];
	};
	delete state.lootItems;
	for (const raid of state.raids ?? []) {
		delete raid.lootVersion;
		if (raid.expedition?.cargo) delete raid.expedition.cargo.lootItems;
	}
	for (const report of state.history ?? []) {
		delete report.lootItems;
		delete report.lootAutoSold;
		if (report.lostCargo) delete report.lostCargo.lootItems;
	}
	return value;
}
