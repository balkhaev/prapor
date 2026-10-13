/** Preserve named loot when deriving an authentic save from before pending parcels. */
export function withoutBarters<T>(value: T): T {
	const state = value as { pendingLoot?: unknown; history?: { lootPending?: unknown }[] };
	delete state.pendingLoot;
	for (const report of state.history ?? []) delete report.lootPending;
	return value;
}

/** Derive a pre-loot save without silently inventing v16 fields in old fixtures. */
export function withoutLoot<T>(value: T): T {
	const state = value as {
		lootItems?: unknown;
		pendingLoot?: unknown;
		raids?: { lootVersion?: unknown; expedition?: { cargo?: { lootItems?: unknown } } | null }[];
		history?: { lootItems?: unknown; lootAutoSold?: unknown; lootPending?: unknown; lostCargo?: { lootItems?: unknown } | null }[];
	};
	delete state.lootItems;
	delete state.pendingLoot;
	for (const raid of state.raids ?? []) {
		delete raid.lootVersion;
		if (raid.expedition?.cargo) delete raid.expedition.cargo.lootItems;
	}
	for (const report of state.history ?? []) {
		delete report.lootItems;
		delete report.lootAutoSold;
		delete report.lootPending;
		if (report.lostCargo) delete report.lostCargo.lootItems;
	}
	return value;
}
