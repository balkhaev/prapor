import type { ScavDirection } from "./scav-isometric";
import { SCAV_GEAR_CROPS } from "./scav-gear-crops";

/** Each native atlas keeps its original pixels; model IDs choose their own sheet. */
export const SCAV_EQUIPMENT_ATLASES = [
	{ key: "scav-equipment", basename: "scav-equipment", models: ["light_vest", "plate_armor", "scout_pack", "cargo_pack"] },
	{ key: "scav-armor-expanded", basename: "scav-armor-expanded", models: ["padded_vest", "patrol_armor", "assault_armor", "heavy_armor"] },
	{ key: "scav-helmets", basename: "scav-helmets", models: ["steel_helmet", "kevlar_helmet", "tactical_helmet", "visor_helmet"] },
	{ key: "scav-packs-expanded", basename: "scav-packs-expanded", models: ["canvas_pack", "patrol_pack", "expedition_pack", "frame_pack"] },
] as const;

const gearHeights: Readonly<Record<string, number>> = {
	light_vest: 16, plate_armor: 18, padded_vest: 16, patrol_armor: 17, assault_armor: 19, heavy_armor: 23,
	steel_helmet: 9, kevlar_helmet: 11, tactical_helmet: 10, visor_helmet: 14,
	scout_pack: 21, cargo_pack: 28, canvas_pack: 18, patrol_pack: 23, expedition_pack: 26, frame_pack: 31,
};

export function scavGearTexture(modelId: string): string | undefined {
	return SCAV_EQUIPMENT_ATLASES.find((atlas) => (atlas.models as readonly string[]).includes(modelId))?.key;
}

export function scavGearHeight(modelId: string, direction: ScavDirection): number {
	const height = Object.hasOwn(gearHeights, modelId) ? gearHeights[modelId]! : 18;
	return direction[0] === "s" && ["cargo_pack", "expedition_pack", "frame_pack"].includes(modelId) ? height * .82 : height;
}

/** Inventory cards crop the same native equipment art used on the character. */
export function scavGearIllustration(modelId: string, label: string): string {
	const crop = SCAV_GEAR_CROPS[modelId];
	if (!crop) return "";
	const title = label.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
	return `<svg class="gear-illustration" viewBox="${crop.x} ${crop.y} ${crop.w} ${crop.h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title}"><title>${title}</title><image href="${crop.image}" width="${crop.sheetWidth}" height="${crop.sheetHeight}"/></svg>`;
}
