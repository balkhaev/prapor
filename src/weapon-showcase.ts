import { WEAPON_BY_ID } from "./game/data";
import { getWeaponBuildIssues, type WeaponInstance } from "./game/engine";
import { FACTORY_KITS, MODULE_BY_ID, MODULE_MODELS, MODULE_SLOTS, RECEIVER_INFO, type ModuleModel, type ModuleSlot } from "./game/modules";
import { moduleFitsWeaponFamily } from "./module-catalog";
import { weaponBuildArt } from "./armory-art";

export type WeaponShowcasePreset = "factory" | "field";
export function createWeaponShowcaseBuild(weaponId: string, preset: WeaponShowcasePreset = "factory"): WeaponInstance {
	const definition = Object.hasOwn(WEAPON_BY_ID,weaponId) ? WEAPON_BY_ID[weaponId] : undefined;
	if (!definition) throw new Error("Неизвестное оружие для примерки");
	const weapon: WeaponInstance = { id: `showcase-${weaponId}-${preset}`, weaponId, durability:100, foundAt:0, attachments:{ optic:0, magazine:0, stock:0 }, modules:{} };
	const put = (model: ModuleModel) => { weapon.modules[model.slot] = { id:`showcase-${model.id}`, modelId:model.id, durability:100, foundAt:0 }; };
	for (const slot of MODULE_SLOTS) {
		const id = FACTORY_KITS[weaponId]?.[slot]; if (id) put(MODULE_BY_ID[id]!);
	}
	if (preset === "factory") return weapon;
	const tryPart = (slot: ModuleSlot, styles: string[]) => {
		for (const appearance of styles) {
			for (const candidate of MODULE_MODELS.filter(model => model.slot === slot && model.appearance === appearance && moduleFitsWeaponFamily(model,weaponId))) {
				const previous = weapon.modules[slot]; put(candidate);
				if (getWeaponBuildIssues(weapon).length === 0) return true;
				if (previous) weapon.modules[slot] = previous; else delete weapon.modules[slot];
			}
		}
		return false;
	};
	const sniper = definition.category === "sniper", pistol = definition.category === "pistol", smg = definition.category === "smg", shotgun = definition.category === "shotgun";
	// Their compact factory furniture and integral suppressor define the
	// classic VAL/VSS profile. Show the direct side-mounted sight as a useful
	// field example without replacing every recognizable part at once.
	if (["vss","asval"].includes(weaponId)) {
		tryPart("optic",["dovetail"]);
		return weapon;
	}
	tryPart("barrel",sniper ? ["long","fluted"] : pistol || smg ? ["fluted","short"] : ["fluted","heavy"]);
	if (!pistol) {
		tryPart("handguard",["carbon","rail"]);
		tryPart("stock",sniper ? ["precision","tactical"] : ["padded","tactical"]);
	}
	tryPart("magazine",["window","quick"]);
	const opticStyles = sniper ? ["longscope","scope","dovetail"] : pistol || smg || shotgun ? ["micro","reflex"] : ["prism","reflex","dovetail-reflex"];
	if (!tryPart("optic",opticStyles)) {
		const info = RECEIVER_INFO[weaponId]!;
		const bridges = MODULE_MODELS.filter(model => model.slot === "mount" && moduleFitsWeaponFamily(model,weaponId) && (pistol ? model.providesMounts.includes("rail-top") : info.platform === "fal" ? model.id === "mount-fal-bridge" : model.appearance === "dovetail-low"));
		for (const bridge of bridges) {
			const previous = weapon.modules.mount; put(bridge);
			if (!getWeaponBuildIssues(weapon).length && tryPart("optic",opticStyles)) break;
			if (previous) weapon.modules.mount = previous; else delete weapon.modules.mount;
		}
	}
	tryPart("muzzle",sniper || smg || pistol ? ["compact-suppressor","suppressor"] : ["ported","brake"]);
	if (sniper || ["rpk","pkp"].includes(weaponId)) tryPart("foregrip",["bipod"]);
	else if (!pistol && !shotgun) tryPart("foregrip",["angled","stubby","light"]);
	// One compact device is enough to show the mounting point without hiding
	// the receiver in a pile of brackets, lights and long-range optics.
	if (shotgun) tryPart("flashlight",["mini"]);
	else if (smg) tryPart("laser",["micro"]);
	return weapon;
}

/** A preset switch keeps the receiver at the same scale and position. */
export function weaponShowcasePairArt(weaponId: string): Record<WeaponShowcasePreset,string> {
	const factory = weaponBuildArt(createWeaponShowcaseBuild(weaponId,"factory")), field = weaponBuildArt(createWeaponShowcaseBuild(weaponId,"field"));
	const boxes = [factory,field].map(svg => svg.match(/\bviewBox="([^"]+)"/)![1]!.split(/\s+/).map(Number));
	const left = Math.min(...boxes.map(box => box[0]!)), top = Math.min(...boxes.map(box => box[1]!));
	const right = Math.max(...boxes.map(box => box[0]! + box[2]!)), bottom = Math.max(...boxes.map(box => box[1]! + box[3]!));
	const frame = `viewBox="${left} ${top} ${right-left} ${bottom-top}"`;
	return { factory:factory.replace(/\bviewBox="[^"]+"/,frame), field:field.replace(/\bviewBox="[^"]+"/,frame) };
}
