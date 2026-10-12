import type { GameState, WeaponInstance } from "../src/game/engine";
import { FACTORY_KITS, type ModuleInstance } from "../src/game/modules";

/** Test inventory copies represent different physical guns and different parts. */
export function copyWeaponFixture(state: GameState, source: WeaponInstance): WeaponInstance {
	const weapon = structuredClone(source);
	weapon.id = `gun-${state.nextId++}`;
	for (const part of Object.values(weapon.modules)) part.id = `module-${state.nextId++}`;
	return weapon;
}

/** Change a scenario's gun class together with its matching factory components. */
export function useWeaponPlatformFixture(state: GameState, weapon: WeaponInstance, weaponId: string) {
	weapon.weaponId = weaponId;
	weapon.modules = Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId]) => {
		const part: ModuleInstance = { id: `module-${state.nextId++}`, modelId, durability: slot === "receiver" ? weapon.durability : 100, foundAt: weapon.foundAt };
		return [slot, part];
	}));
	if (!state.discoveredWeapons.includes(weaponId)) state.discoveredWeapons.push(weaponId);
}
