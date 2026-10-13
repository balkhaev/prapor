import type { ReferenceGrip } from "./weapon-reference-types";

/** Exterior gripping surfaces, shared by native cards, bench and carried art. */
export const COMPACT_REFERENCE_GRIPS: Record<string, ReferenceGrip> = {
	pm: { factory: [351, 230] }, tt: { factory: [344, 227] },
	m1911: { factory: [353, 223] }, fiveseven: { factory: [356, 229] },
	sr1: { factory: [357, 231] }, glock20: { factory: [354, 231] },
	pp91: { factory: [360, 215] }, mp7: { factory: [368, 212] },
	ump45: { factory: [359, 213] }, sr2: { factory: [369, 215] },
	vector: { factory: [344, 215] }, p90: { factory: [481, 218] },
};
