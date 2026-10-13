import { type AmmoModel, type AmmoType } from "./game/ammunition";

/** Generated pack atlases use this fixed order; save IDs and model order are independent. */
export const AMMUNITION_ART_TYPES = ["standard", "piercing", "expanding", "precision", "subsonic", "tracer", "highpressure", "surplus"] as const;
export const AMMUNITION_ART_CALIBERS = ["9x18", "7.62x25", "9x19", "5.45x39", "7.62x39", "7.62x54", "9x39", "12g", "20g"] as const;

const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export interface AmmunitionArtwork { url: string; column: number; row: number; position: string }

/** A cartridge's own caliber determines its pack, including a frozen raid snapshot. */
export function getAmmunitionArtwork(model: Pick<AmmoModel, "caliber" | "type">): AmmunitionArtwork | null {
	const index = (AMMUNITION_ART_TYPES as readonly string[]).indexOf(model.type);
	if (index < 0 || !(AMMUNITION_ART_CALIBERS as readonly string[]).includes(model.caliber)) return null;
	const column = index % 4, row = Math.floor(index / 4);
	return { url: `/art/ammo/ammo-${model.caliber}.png`, column, row, position: `${column / 3 * 100}% ${row * 100}%` };
}

export function ammunitionArt(model: AmmoModel, decorative = false): string {
	const artwork = getAmmunitionArtwork(model);
	if (!artwork) return "";
	return `<span class="ammunition-pack-art" data-ammo-art="${escape(model.id)}" ${decorative ? 'aria-hidden="true"' : `role="img" aria-label="Пачка: ${escape(model.label)} · ${model.packRounds} патронов"`} style="background-image:url('${artwork.url}');background-position:${artwork.position}"></span>`;
}

/** Short tactical niches identify the tradeoff; numeric effects are calculated by the engine. */
export function ammunitionNiche(type: AmmoType): string {
	return ({ standard: "Доступный универсальный заряд", piercing: "Против бронезащиты", expanding: "Высокий урон лёгким целям", precision: "Прицельная стрельба вдаль", subsonic: "Тихий выход с глушителем", tracer: "Контроль огня ценой скрытности", highpressure: "Больше напора и износа", surplus: "Экономия припасов, слабее заряд" } as Record<AmmoType, string>)[type];
}
