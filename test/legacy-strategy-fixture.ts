import { withoutMedical } from './legacy-health-fixture';
/** Remove fields unavailable in v1–11 when deriving an authentic old fixture. */
export function withoutRaidStrategy<T>(value: T): T {
	withoutMedical(value);
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
	return value;
}
