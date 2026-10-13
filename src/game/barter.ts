import type { GameState } from "./engine";
import { GEAR_MODEL_BY_ID } from "./systems";
import { LOOT_MODEL_BY_ID } from "./loot";

export interface BarterOffer {
	id: string;
	label: string;
	gearModelId: string;
	requirements: { modelId: string; quantity: number }[];
	description: string;
}
export interface BarterQuote {
	offer: BarterOffer | null;
	requirements: { modelId: string; required: number; owned: number }[];
	itemIds: string[];
	reason: string | null;
	guideInputValue: number;
}
const offer = (gearModelId: string, inputs: [string, number][], suffix = ""): BarterOffer => ({
	id: `barter-${gearModelId}${suffix}`, gearModelId,
	label: GEAR_MODEL_BY_ID[gearModelId]!.label,
	description: "Обмен целых трофеев на исправное снаряжение. Деньги, детали и чертёж не нужны; предмет можно выдать своему дикому.",
	requirements: inputs.map(([modelId, quantity]) => ({ modelId, quantity })),
});
/** Each named trophy has a use beyond its cash price. The cost is the entire physical bundle. */
export const BARTER_OFFERS: readonly BarterOffer[] = [
	offer("canvas_pack", [["duct-tape", 2], ["coffee", 1]]),
	offer("padded_vest", [["old-watch", 1], ["duct-tape", 2]]),
	offer("steel_helmet", [["pliers", 1], ["copper-wire", 2]]),
	offer("scout_pack", [["local-map", 2], ["ration", 3]]),
	offer("light_vest", [["bandage-roll", 2], ["antiseptic", 2]]),
	offer("patrol_armor", [["tool-case", 1], ["battery", 2]]),
	offer("kevlar_helmet", [["patrol-log", 1], ["silver-chain", 1]]),
	offer("patrol_pack", [["water-filter", 1], ["ration", 3], ["coffee", 2]]),
	offer("assault_armor", [["surgical-kit", 1], ["circuit-board", 1], ["duct-tape", 2]]),
	offer("tactical_helmet", [["depot-manifest", 1], ["patrol-log", 1], ["antiseptic", 1]]),
	offer("plate_armor", [["precision-tools", 1], ["circuit-board", 1], ["pliers", 1]]),
	offer("cargo_pack", [["tool-case", 2], ["battery", 2], ["duct-tape", 2]]),
	offer("expedition_pack", [["officer-rations", 1], ["water-filter", 1], ["ration", 2]]),
	offer("visor_helmet", [["lab-reagents", 1], ["silver-chain", 1]]),
	offer("heavy_armor", [["secure-drive", 1], ["coffee", 1]]),
	offer("frame_pack", [["thermal-sensor", 1]]),
	offer("tactical_helmet", [["gold-ring", 1], ["bandage-roll", 1]], "-ring"),
	offer("plate_armor", [["cipher-book", 1], ["duct-tape", 1]], "-cipher"),
	offer("heavy_armor", [["military-cpu", 1]], "-processor"),
	offer("frame_pack", [["prototype-optics", 1]], "-prototype"),
	offer("tactical_helmet", [["luxury-watch", 1], ["perfume", 1]], "-luxury"),
	offer("assault_armor", [["gemstone", 1], ["bronze-statuette", 1]], "-collectors"),
	offer("patrol_armor", [["suture-kit", 1], ["antibiotics", 1], ["silver-chain", 1]], "-medical"),
	offer("padded_vest", [["hemostatic", 1], ["painkillers", 1]], "-supplies"),
	offer("padded_vest", [["screws", 2], ["sewing-kit", 1]], "-textiles"),
	offer("steel_helmet", [["gunpowder", 2], ["primer", 1]], "-ammunition"),
	offer('patrol_armor', [['boss-bugor-sign', 1]], '-boss-bugor'),
	offer('expedition_pack', [['boss-lesnik-compass', 1]], '-boss-lesnik'),
	offer('plate_armor', [['boss-liteyshchik-key', 1]], '-boss-liteyshchik'),
	offer('heavy_armor', [['boss-komendant-seal', 1]], '-boss-komendant'),
];
export const getBarterOffers = (): readonly BarterOffer[] => BARTER_OFFERS;
export function getBarterQuote(state: GameState, offerId: string): BarterQuote {
	const offer = BARTER_OFFERS.find(value => value.id === offerId) ?? null;
	if (!offer) return { offer: null, requirements: [], itemIds: [], reason: "Обмен не найден.", guideInputValue: 0 };
	const itemIds: string[] = [], selected = new Set<string>();
	const requirements = offer.requirements.map(({ modelId, quantity }) => {
		const owned = (state.lootItems ?? []).filter(item => item.modelId === modelId);
		for (const item of owned.filter(item => !selected.has(item.id)).slice(0, quantity)) { itemIds.push(item.id); selected.add(item.id); }
		return { modelId, required: quantity, owned: owned.length };
	});
	const missing = requirements.filter(value => value.owned < value.required);
	return { offer, requirements, itemIds,
		reason: state.gearItems.length >= 28 ? "Стойка снаряжения полна (28 предметов). Освободи место перед обменом."
			: missing.length ? `Не хватает трофеев: ${missing.map(value => `${LOOT_MODEL_BY_ID[value.modelId]!.label} ×${value.required - value.owned}`).join(", ")}.` : null,
		guideInputValue: offer.requirements.reduce((sum, value) => sum + LOOT_MODEL_BY_ID[value.modelId]!.guidePrice * value.quantity, 0) };
}
