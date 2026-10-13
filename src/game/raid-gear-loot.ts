import { MAP_BY_ID } from "./data";
import { GEAR_MODELS, GEAR_MODEL_BY_ID, type ExpeditionBranch, type GearItem, type GearModel } from "./systems";

const gates: Record<string, { depth: number; level: number }> = {
	canvas_pack: { depth: 1, level: 1 }, padded_vest: { depth: 1, level: 1 }, steel_helmet: { depth: 1, level: 1 },
	scout_pack: { depth: 1, level: 1 }, light_vest: { depth: 1, level: 1 }, patrol_pack: { depth: 1, level: 2 },
	patrol_armor: { depth: 2, level: 2 }, kevlar_helmet: { depth: 2, level: 2 }, cargo_pack: { depth: 2, level: 3 },
	assault_armor: { depth: 2, level: 3 }, tactical_helmet: { depth: 2, level: 3 }, expedition_pack: { depth: 2, level: 3 },
	plate_armor: { depth: 2, level: 5 }, heavy_armor: { depth: 3, level: 7 }, visor_helmet: { depth: 3, level: 7 }, frame_pack: { depth: 3, level: 7 },
};
export function getRaidGearLootPool(mapId: string, branch: ExpeditionBranch, depth: number, catalogVersion = 23): { model: GearModel; weight: number }[] {
	if (catalogVersion < 23 || !Object.hasOwn(MAP_BY_ID, mapId) || !["scavenge", "combat", "recon"].includes(branch) || !Number.isInteger(depth) || depth < 1 || depth > 3) return [];
	const level = MAP_BY_ID[mapId]!.level;
	return GEAR_MODELS.filter(model => gates[model.id]!.depth <= depth && gates[model.id]!.level <= level).map(model => ({ model,
		weight: (model.money <= 145 ? 7 : model.money <= 295 ? 4 : model.money <= 440 ? 2 : .65)
			* (branch === "combat" ? model.slot === "backpack" ? .7 : 2 : branch === "scavenge" ? model.slot === "backpack" ? 2 : 1 : model.weight <= 2.4 ? 1.8 : .6)
			* ((mapId === "factory" || mapId === "bunker") && model.slot !== "backpack" ? 1.5 : mapId === "forest" && model.slot === "backpack" ? 1.5 : 1),
	}));
}
/** Independent random stream: one worn, usable physical item at most per checkpoint. */
export function rollRaidGearLoot(mapId: string, branch: ExpeditionBranch, depth: number, random: () => number, catalogVersion = 23): { model: GearModel; durability: number }[] {
	const pool = getRaidGearLootPool(mapId, branch, depth, catalogVersion); if (!pool.length) return [];
	if (random() >= .2 + (depth - 1) * .075 + (branch === "combat" ? .08 : 0)) return [];
	let value = random() * pool.reduce((sum, entry) => sum + entry.weight, 0);
	const model = (pool.find(entry => (value -= entry.weight) < 0) ?? pool.at(-1)!).model;
	return [{ model, durability: 50 + Math.min(50, Math.floor(random() * 51)) }];
}
export function getRaidGearValue(item: GearItem): number { return Math.round(GEAR_MODEL_BY_ID[item.modelId]!.money * (.4 + item.durability * .006)); }
