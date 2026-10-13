/** Derive an authentic pre-v18 shape while retaining loot, arsenal, paid scalar health and raid clocks. */
export function withoutMedical<T>(value: T): T {
	const state = value as {
		scavs?: { health: number; status: string; body?: unknown; medicalTreatment?: unknown }[];
		raids?: { expedition?: { medical?: unknown; trail: { label: string }[] } | null; squad?: { members: { medical?: unknown; medicalAt?: unknown }[] } }[];
		history?: { medical?: unknown; events: { label: string }[]; squad?: { members: { medical?: unknown; medicalAt?: unknown }[] } }[];
	};
	const originalEvent = (event: { label: string }) => !event.label.startsWith('Ранения · этап') && event.label !== 'Медицинский приказ';
	for (const scav of state.scavs ?? []) {
		delete scav.body; delete scav.medicalTreatment;
		if (scav.status !== 'raiding') scav.status = scav.health >= 25 ? 'ready' : 'wounded';
	}
	for (const raid of state.raids ?? []) if (raid.expedition) {
		delete raid.expedition.medical;
		raid.expedition.trail = raid.expedition.trail.filter(originalEvent);
	}
	for (const report of state.history ?? []) {
		delete report.medical;
		report.events = report.events.filter(originalEvent);
	}
	for (const item of [...(state.raids ?? []), ...(state.history ?? [])]) for (const member of item.squad?.members ?? []) {
		delete member.medical; delete member.medicalAt;
	}
	return value;
}
