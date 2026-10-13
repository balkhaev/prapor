import Phaser from "phaser";
import { PERSONALITY_BY_ID, WEAPONS } from "./game/data";
import type { WeaponInstance } from "./game/engine";
import { FACTORY_KITS, MODULE_BY_ID, MODULE_MODELS, MODULE_SLOTS, RECEIVER_INFO, type ModuleInstance, type ModuleSlot } from "./game/modules";
import { SCAV_APPEARANCES } from "./game/scav-appearances";
import { ScavEquipment } from "./scav-equipment";
import type { ScavVisualLoadout } from "./scav-loadout";
import { SCAV_ORIGIN, SCAV_POSES, SCAV_REFERENCE_HEIGHT, scavFrame, scavTexture, scavTorsoAnchor, type ScavDirection } from "./scav-isometric";

const gallery = document.querySelector<HTMLElement>("#gallery")!;
const status = document.querySelector<HTMLElement>("#load-status")!;
const select = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)!;
const controls = { direction: select("direction"), pose: select("pose"), armor: select("armor"), pack: select("pack"), carry: select("carry"), weapon: select("weapon"), optic: select("optic"), muzzle: select("muzzle") };
type Point = { x: number; y: number };
type Model = { id: number; root: Phaser.GameObjects.Container; body: Phaser.GameObjects.Container; poses: Phaser.GameObjects.Image[]; equipment: ScavEquipment; name: Phaser.GameObjects.Text; personality: Phaser.GameObjects.Text; badge: Phaser.GameObjects.Text };
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const part = (modelId: string, slot: ModuleSlot): ModuleInstance => ({ id: `preview-${modelId}-${slot}`, modelId, durability: 100, foundAt: 0 });

/** This page owns only demonstration props; it never creates or loads game state. */
function factoryWeapon(weaponId: string): WeaponInstance {
	const modules: WeaponInstance["modules"] = {};
	for (const slot of MODULE_SLOTS) {
		const modelId = FACTORY_KITS[weaponId]?.[slot];
		if (modelId) modules[slot] = part(modelId, slot);
	}
	return { id: `preview-${weaponId}`, weaponId, durability: 100, attachments: { optic: 0, magazine: 0, stock: 0 }, foundAt: 0, modules };
}

function compatibleOptions(slot: "optic" | "muzzle", weapon: WeaponInstance) {
	const info = RECEIVER_INFO[weapon.weaponId]!;
	const mounts = Object.values(weapon.modules).flatMap((item) => MODULE_BY_ID[item.modelId]?.providesMounts ?? []);
	return MODULE_MODELS.filter((model) => model.slot === slot && (!model.weaponId || model.weaponId === weapon.weaponId)
		&& (model.platforms.includes("*") || model.platforms.includes(info.platform))
		&& (model.calibers.includes("*") || model.calibers.includes(info.caliber))
		&& (!model.requiresMount || mounts.includes(model.requiresMount))).slice(0, 4);
}

for (const weapon of WEAPONS) controls.weapon.add(new Option(weapon.name, weapon.id));
controls.weapon.value = "ak74";
const roster = document.querySelector<HTMLOListElement>("#accessible-roster")!;
for (const look of SCAV_APPEARANCES) {
	const item = document.createElement("li");
	item.textContent = `${look.name} · ${PERSONALITY_BY_ID[look.personality]?.name ?? look.personality}`;
	roster.append(item);
}

let selectedLoadout: ScavVisualLoadout = { armorModelId: null, packModelId: null, weapon: null };
function updateSelections(rebuildOptions = false): void {
	const weapon = controls.weapon.value ? factoryWeapon(controls.weapon.value) : null;
	if (rebuildOptions) for (const slot of ["optic", "muzzle"] as const) {
		const input = controls[slot], previous = input.value;
		input.replaceChildren(new Option(slot === "optic" ? "Без прицела" : "Без насадки", ""));
		if (weapon) for (const model of compatibleOptions(slot, weapon)) input.add(new Option(model.label, model.id));
		input.value = [...input.options].some((option) => option.value === previous) ? previous : "";
		input.disabled = !weapon || input.options.length < 2;
	}
	if (weapon) for (const slot of ["optic", "muzzle"] as const) {
		const modelId = controls[slot].value;
		if (modelId && compatibleOptions(slot, weapon).some((model) => model.id === modelId)) weapon.modules[slot] = part(modelId, slot);
	}
	selectedLoadout = { armorModelId: controls.armor.value || null, packModelId: controls.pack.value || null, weapon };
	const direction = controls.direction.selectedOptions[0]!.textContent;
	gallery.setAttribute("aria-label", `32 диких. ${direction}. ${controls.pose.selectedOptions[0]!.textContent}. ${controls.armor.selectedOptions[0]!.textContent}. ${controls.pack.selectedOptions[0]!.textContent}. ${controls.weapon.selectedOptions[0]!.textContent}.`);
}
updateSelections(true);
for (const [name, input] of Object.entries(controls)) input.addEventListener("change", () => updateSelections(name === "weapon"));

class ScavPreview extends Phaser.Scene {
	private models: Model[] = [];
	private panels!: Phaser.GameObjects.Graphics;
	private observer: ResizeObserver | null = null;
	private columns = 8;
	private cellWidth = 160;
	private readonly cellHeight = 185;

	constructor() { super("ScavPreview"); }
	preload(): void {
		for (const look of SCAV_APPEARANCES) this.load.atlas(scavTexture(look.id), `/art/scav-isometric-${look.id}.png`, `/art/scav-isometric-${look.id}.json`);
		this.load.atlas("scav-equipment", "/art/scav-equipment.png", "/art/scav-equipment.json");
		this.load.on(Phaser.Loader.Events.PROGRESS, (progress: number) => { status.textContent = `Загружаем модели · ${Math.round(progress * 100)}%`; });
	}
	create(): void {
		this.panels = this.add.graphics();
		for (const look of SCAV_APPEARANCES) {
			const body = this.add.container(0, 0).setData("appearance", look.id), shadow = this.add.ellipse(0, 2, 25, 10, 0x0d170f, .7);
			const texture = scavTexture(look.id), available = this.textures.exists(texture);
			const data = this.textures.get(texture).customData as { meta?: { characterHeight?: number } };
			const height = Number(data.meta?.characterHeight) || SCAV_REFERENCE_HEIGHT;
			const poses = available ? SCAV_POSES.map((pose) => this.add.image(0, 0, texture, scavFrame(pose, "se")).setOrigin(SCAV_ORIGIN.x, SCAV_ORIGIN.y).setScale(48 / height).setVisible(false)) : [];
			body.add(poses);
			const equipment = new ScavEquipment(this, body), root = this.add.container(0, 0, [shadow, body]);
			if (!available) body.add(this.add.text(0, -28, "Модель готовится", { fontFamily: "Manrope, sans-serif", fontSize: "9px", color: "#89947b" }).setOrigin(.5));
			const name = this.label(look.name, 14, "#ebe0c4"), personality = this.label(PERSONALITY_BY_ID[look.personality]?.name ?? look.personality, 10, "#97a387");
			const badge = this.label(String(look.id + 1).padStart(2, "0"), 9, "#64745c").setOrigin(0).setFontFamily('"IBM Plex Mono", monospace');
			this.models.push({ id: look.id, root, body, poses, equipment, name, personality, badge });
		}
		const loaded = this.models.filter((model) => model.poses.length > 0).length;
		status.textContent = loaded === SCAV_APPEARANCES.length ? "Все модели готовы" : `Готово ${loaded} из ${SCAV_APPEARANCES.length}`;
		this.layout();
		this.observer = new ResizeObserver(() => this.layout()); this.observer.observe(gallery);
		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.observer?.disconnect());
	}
	private label(value: string, size: number, color: string): Phaser.GameObjects.Text {
		return this.add.text(0, 0, value, { fontFamily: "Manrope, sans-serif", fontSize: `${size}px`, color, resolution: Math.min(window.devicePixelRatio || 1, 2) }).setOrigin(.5).setFontStyle("bold");
	}
	private layout(): void {
		const width = Math.max(280, Math.floor(gallery.clientWidth));
		this.columns = width >= 1080 ? 8 : width >= 570 ? 4 : 2;
		this.cellWidth = width / this.columns;
		const rows = Math.ceil(this.models.length / this.columns), height = rows * this.cellHeight;
		if (this.scale.width !== width || this.scale.height !== height) this.scale.resize(width, height);
		gallery.style.height = `${height}px`;
		this.panels.clear();
		this.models.forEach((model, index) => {
			const x = index % this.columns * this.cellWidth, y = Math.floor(index / this.columns) * this.cellHeight;
			this.panels.fillStyle(0x202c20, .8).fillRoundedRect(x + 3, y + 3, this.cellWidth - 6, this.cellHeight - 8, 8).lineStyle(1, 0x536045, .38).strokeRoundedRect(x + 3, y + 3, this.cellWidth - 6, this.cellHeight - 8, 8);
			const scale = Math.min(2.1, (this.cellWidth - 8) / 80);
			model.root.setPosition(x + this.cellWidth / 2 - 7, y + 139).setScale(scale);
			model.name.setPosition(x + this.cellWidth / 2, y + 154); model.personality.setPosition(x + this.cellWidth / 2, y + 171); model.badge.setPosition(x + 13, y + 12);
		});
	}
	update(time: number): void {
		const direction = controls.direction.value as ScavDirection, pose = controls.pose.value;
		const stride = reducedMotion ? 0 : (Math.sin(time / 150) + 1) / 2;
		const weights = pose === "work" ? [0, 0, 0, 1] : pose === "walk" ? [0, 1 - stride, stride, 0] : [1, 0, 0, 0];
		for (const model of this.models) {
			model.poses.forEach((image, index) => image.setFrame(scavFrame(SCAV_POSES[index]!, direction)).setVisible(weights[index]! > .001).setAlpha(weights[index]!));
			const torso = scavTorsoAnchor(model.poses.map((image) => ({ weight: image.visible ? image.alpha : 0, torso: (image.frame.customData as { custom?: { torso?: Point } }).custom?.torso })));
			model.equipment.update(model.poses.length ? selectedLoadout : { armorModelId: null, packModelId: null, weapon: null }, direction, { working: pose === "work", mode: controls.carry.value as "held" | "slung" | "none", torso });
		}
	}
}

await document.fonts.ready;
new Phaser.Game({ type: Phaser.AUTO, parent: gallery, width: gallery.clientWidth, height: 750, backgroundColor: "#17221b", transparent: true, antialias: true, pixelArt: false, scene: ScavPreview, banner: false, audio: { noAudio: true }, scale: { mode: Phaser.Scale.NONE } });
