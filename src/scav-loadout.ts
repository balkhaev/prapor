import type { Raid, WeaponInstance } from "./game/engine";
import { WEAPON_BY_ID } from "./game/data";
import { FACTORY_KITS, MODULE_SLOTS, type ModuleInstance } from "./game/modules";
import { GEAR_MODEL_BY_ID, type GearItem, type Loadout } from "./game/systems";
import type { GearEquipmentSlot } from "./game/operations";
import { isScavAppearance } from "./game/scav-appearances";

export interface ScavVisualLoadout {
	armorModelId: string | null;
	helmetModelId?: string | null;
	packModelId: string | null;
	weapon: WeaponInstance | null;
}

function gearModel(modelId: string | null | undefined, slot: GearEquipmentSlot): string | null {
	return modelId && Object.hasOwn(GEAR_MODEL_BY_ID, modelId) && GEAR_MODEL_BY_ID[modelId]!.slot === slot ? modelId : null;
}

function knownWeapon(weapon: WeaponInstance | null | undefined): WeaponInstance | null {
	return weapon && Object.hasOwn(WEAPON_BY_ID, weapon.weaponId) ? weapon : null;
}

/** Player silhouettes use their physical inventory, including an empty slot. */
export function getScavVisualLoadout(
	scav: { gear?: { armor: number; backpack: number }; loadout?: Loadout; weaponInstanceId?: string | null },
	gearItems: readonly GearItem[] = [],
	weapons: readonly WeaponInstance[] = []
): ScavVisualLoadout {
	const armor = scav.loadout?.armorItemId ? gearItems.find((item) => item.id === scav.loadout!.armorItemId) : undefined;
	const helmet = scav.loadout?.helmetItemId ? gearItems.find((item) => item.id === scav.loadout!.helmetItemId) : undefined;
	const pack = scav.loadout?.backpackItemId ? gearItems.find((item) => item.id === scav.loadout!.backpackItemId) : undefined;
	return {
		armorModelId: gearModel(armor?.modelId, "armor"),
		helmetModelId: gearModel(helmet?.modelId, "helmet"),
		packModelId: gearModel(pack?.modelId, "backpack"),
		weapon: scav.weaponInstanceId ? knownWeapon(weapons.find((item) => item.id === scav.weaponInstanceId)) : null,
	};
}

/** The paid departure snapshot owns a sortie's gear, even after later roster edits. */
export function getRaidVisualLoadout(raid: Raid, weapon: WeaponInstance | null): ScavVisualLoadout {
	const loadout = raid.expedition?.loadout;
	return {
		armorModelId: loadout ? gearModel(loadout.armorModelId, "armor")
			: Number.isInteger(raid.armorLevel) && raid.armorLevel > 0 ? raid.armorLevel === 1 ? "light_vest" : "plate_armor" : null,
		helmetModelId: gearModel(loadout?.helmetModelId, "helmet"),
		packModelId: loadout ? gearModel(loadout.packModelId, "backpack")
			: Number.isInteger(raid.backpackLevel) && raid.backpackLevel > 0 ? raid.backpackLevel === 1 ? "scout_pack" : "cargo_pack" : null,
		weapon: weapon?.id === raid.weaponInstanceId ? knownWeapon(weapon) : null,
	};
}

const HOSTILE_WEAPONS = ["pm", "pp91", "sks", "mp133", "ak74", "mosin"] as const;
const HOSTILE_ARMOR = [null, "padded_vest", "light_vest", "patrol_armor", "plate_armor", "assault_armor", "heavy_armor"] as const;
const HOSTILE_HELMETS = [null, "steel_helmet", "kevlar_helmet", "tactical_helmet", "visor_helmet"] as const;
const HOSTILE_PACKS = [null, "canvas_pack", "scout_pack", "patrol_pack", "cargo_pack", "expedition_pack", "frame_pack"] as const;

/** Ambient enemies receive independent visual props, never inventory or gameplay IDs. */
export function getHostileVisualLoadout(appearance: number): ScavVisualLoadout {
	const visualId = isScavAppearance(appearance) ? appearance : 0;
	const weaponId = HOSTILE_WEAPONS[visualId % HOSTILE_WEAPONS.length]!;
	const modules: WeaponInstance["modules"] = {};
	for (const slot of MODULE_SLOTS) {
		const modelId = FACTORY_KITS[weaponId]![slot];
		if (modelId) {
			const part: ModuleInstance = { id: `visual-hostile-${visualId}-${slot}`, modelId, durability: 100, foundAt: 0 };
			modules[slot] = part;
		}
	}
	return {
		armorModelId: HOSTILE_ARMOR[visualId % HOSTILE_ARMOR.length]!,
		helmetModelId: HOSTILE_HELMETS[Math.floor(visualId / 2) % HOSTILE_HELMETS.length]!,
		packModelId: HOSTILE_PACKS[Math.floor(visualId / 3) % HOSTILE_PACKS.length]!,
		weapon: { id: `visual-hostile-${visualId}-${weaponId}`, weaponId, durability: 100,
			attachments: { optic: 0, magazine: 0, stock: 0 }, foundAt: 0, modules },
	};
}

const conditionBucket = (durability: number) => Number.isFinite(durability) ? Math.floor(Math.max(0, Math.min(100, durability)) / 20) * 20 : 0;

/** Rebuild held weapon art when a part is installed, removed or visibly worn. */
export function weaponVisualSignature(weapon: WeaponInstance): string {
	return [weapon.weaponId, conditionBucket(weapon.durability), ...MODULE_SLOTS.map((slot) => {
		const part = weapon.modules[slot];
		return `${slot}:${part ? `${part.modelId}:${conditionBucket(part.durability)}` : "none"}`;
	})].join("|");
}
