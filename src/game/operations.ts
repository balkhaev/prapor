export type RaidTactic = "cautious" | "balanced" | "bold";
export type GearSlot = "armor" | "backpack";
/** Physical items have independent slots; legacy permanent upgrades stay armor/backpack. */
export type GearEquipmentSlot = GearSlot | "helmet";

export const MAX_GEAR_LEVEL = 3;
export const GEAR_LABELS: Record<GearSlot, string> = { armor: "Броня", backpack: "Рюкзак" };
export const GEAR_EQUIPMENT_LABELS: Record<GearEquipmentSlot, string> = { armor: "Броня", helmet: "Шлем", backpack: "Рюкзак" };
export const TACTICS: Record<RaidTactic, {
	label: string; description: string; durationMultiplier: number;
	chanceBonus: number; lootBonus: number; ammoMultiplier: number;
	injuryMultiplier: number; fatalityMultiplier: number;
}> = {
	cautious: {
		label: "Осторожно", description: "Дольше в пути, меньше добычи и патронов; выше шанс возвращения.",
		durationMultiplier: 1.22, chanceBonus: 0.06, lootBonus: -0.12, ammoMultiplier: 0.8,
		injuryMultiplier: 0.7, fatalityMultiplier: 0.7,
	},
	balanced: {
		label: "Сбалансированно", description: "Обычный маршрут, расход и риск.",
		durationMultiplier: 1, chanceBonus: 0, lootBonus: 0, ammoMultiplier: 1,
		injuryMultiplier: 1, fatalityMultiplier: 1,
	},
	bold: {
		label: "Напористо", description: "Быстрее и богаче, но больше риск, ранения и расход патронов.",
		durationMultiplier: 0.83, chanceBonus: -0.07, lootBonus: 0.22, ammoMultiplier: 1.4,
		injuryMultiplier: 1.2, fatalityMultiplier: 1.3,
	},
};
