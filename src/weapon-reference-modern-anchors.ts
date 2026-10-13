import type { ReferenceGrip } from "./weapon-reference-types";
/** Gripping surfaces in the same side projection used by the physical parts. */
export const MODERN_REFERENCE_GRIPS: Record<string, ReferenceGrip> = {
	m4a1: { factory: [346, 198] },
	hk416: { factory: [347, 197] },
	mcx: { factory: [346, 197] },
	scarh: { factory: [306, 198] },
	sr25: { factory: [349, 198] },
	g36: { factory: [349, 198] },
	fal: { factory: [310, 201] },
	trg42: { factory: [350, 199], upgrade: [350, 199], padded: [350, 199] },
	awm: { factory: [344, 199], upgrade: [344, 199], padded: [344, 199] },
	aug: { factory: [494, 197] },
	ash12: { factory: [492, 198] },
};
