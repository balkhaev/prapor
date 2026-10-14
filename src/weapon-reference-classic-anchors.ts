import type { ReferenceGrip } from "./weapon-reference-types";

export const CLASSIC_REFERENCE_GRIPS: Record<string, ReferenceGrip> = {
	ak74: { factory: [300, 188] }, akm: { factory: [300, 188] }, rpk: { factory: [300, 188] },
	vpo209: { factory: [300, 188] }, saiga: { factory: [300, 190] }, vityaz: { factory: [325, 190] },
	toz: { factory: [330, 192] }, pkp: { factory: [300, 190] },
	svd: { factory: [260, 190], padded: [260, 190], upgrade: [245, 194] },
	svdk: { factory: [300, 192], padded: [300, 192], upgrade: [300, 194] },
	sks: { factory: [315, 164], padded: [315, 164], upgrade: [295, 194] },
	mosin: { factory: [285, 164], padded: [285, 164], upgrade: [270, 194] },
	mp133: { factory: [275, 164], padded: [275, 164], upgrade: [265, 194] },
	m870: { factory: [294, 164], padded: [294, 164], upgrade: [280, 194] },
};
