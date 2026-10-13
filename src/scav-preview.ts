import Phaser from "phaser";
import { PERSONALITY_BY_ID, WEAPONS } from "./game/data";
import type { WeaponInstance } from "./game/engine";
import { FACTORY_KITS, MODULE_BY_ID, MODULE_MODELS, MODULE_SLOTS, MODULE_SLOT_LABELS, RECEIVER_INFO, getResolvedModuleMounts, type ModuleInstance, type ModuleModel, type ModuleSlot } from "./game/modules";
import { moduleArt, weaponBuildArt } from "./armory-art";
import { MODULE_DISPLAY_SLOTS, moduleFitsWeaponFamily, moduleModelMatches, moduleMountLabel } from "./module-catalog";
import { GEAR_MODELS } from "./game/systems";
import { SCAV_EQUIPMENT_ATLASES } from "./scav-gear-art";
import { SCAV_APPEARANCES } from "./game/scav-appearances";
import { ScavEquipment } from "./scav-equipment";
import type { ScavVisualLoadout } from "./scav-loadout";
import { SCAV_ORIGIN, SCAV_POSES, SCAV_REFERENCE_HEIGHT, scavFrame, scavTexture, scavTorsoAnchor, scavHeadAnchor, type ScavDirection } from "./scav-isometric";

const gallery = document.querySelector<HTMLElement>("#gallery")!;
const status = document.querySelector<HTMLElement>("#load-status")!;
const select = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)!;
const controls = { direction: select("direction"), pose: select("pose"), armor: select("armor"), helmet: select("helmet"), pack: select("pack"), carry: select("carry"), weapon: select("weapon") };
const buildControls = document.querySelector<HTMLFormElement>("#build-controls")!;
for (const slot of MODULE_DISPLAY_SLOTS) {
	const label = document.createElement("label"), input = document.createElement("select");
	label.append(MODULE_SLOT_LABELS[slot]); input.id = slot; label.append(input); buildControls.append(label);
}
const moduleControls = Object.fromEntries(MODULE_SLOTS.map((slot) => [slot, select(slot)])) as Record<ModuleSlot, HTMLSelectElement>;
const resetWeapon = document.querySelector<HTMLButtonElement>("#reset-weapon")!;
const weaponSummary = document.querySelector<HTMLElement>("#weapon-summary")!;
const fitStatus = document.querySelector<HTMLElement>("#fit-status")!;
const closeup = document.querySelector<HTMLElement>("#weapon-closeup")!;
const buildParts = document.querySelector<HTMLElement>("#build-parts")!;
const library = document.querySelector<HTMLDetailsElement>("#module-library")!;
const librarySlot = select("library-slot"), librarySearch = document.querySelector<HTMLInputElement>("#library-search")!;
const libraryCompatible = document.querySelector<HTMLInputElement>("#library-compatible")!;
const libraryCount = document.querySelector<HTMLElement>("#library-count")!, moduleCards = document.querySelector<HTMLElement>("#module-cards")!;
const libraryMore = document.querySelector<HTMLButtonElement>("#library-more")!;
let libraryLimit = 24, inspectedSlot: ModuleSlot | undefined;
const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
type Point = { x: number; y: number };
type Model = { id: number; root: Phaser.GameObjects.Container; body: Phaser.GameObjects.Container; poses: Phaser.GameObjects.Image[]; equipment: ScavEquipment; name: Phaser.GameObjects.Text; personality: Phaser.GameObjects.Text; badge: Phaser.GameObjects.Text };
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const part = (modelId: string, slot: ModuleSlot): ModuleInstance => ({ id: `preview-${modelId}-${slot}`, modelId, durability: 100, foundAt: 0 });
const weaponBuilds = new Map<string, WeaponInstance>();

/** This page owns only demonstration props; it never creates or loads game state. */
function factoryWeapon(weaponId: string): WeaponInstance {
	const modules: WeaponInstance["modules"] = {};
	for (const slot of MODULE_SLOTS) {
		const modelId = FACTORY_KITS[weaponId]?.[slot];
		if (modelId) modules[slot] = part(modelId, slot);
	}
	return { id: `preview-${weaponId}`, weaponId, durability: 100, attachments: { optic: 0, magazine: 0, stock: 0 }, foundAt: 0, modules };
}

function compatibleOptions(slot: ModuleSlot, weapon: WeaponInstance) {
	const mounts = getResolvedModuleMounts(weapon.modules, slot);
	return MODULE_MODELS.filter((model) => model.slot === slot && moduleFitsWeaponFamily(model, weapon.weaponId)
		&& (!model.requiresMount || mounts.includes(model.requiresMount)));
}

function fittingReason(model: ModuleModel, weapon: WeaponInstance | null): string | null {
	if (!weapon) return "Выбери основу оружия";
	if (!moduleFitsWeaponFamily(model, weapon.weaponId)) return "Другая платформа или калибр";
	const mounts = getResolvedModuleMounts(weapon.modules, model.slot);
	return model.requiresMount && !mounts.includes(model.requiresMount) ? `Нужно крепление: ${moduleMountLabel(model.requiresMount).toLowerCase()}` : null;
}

function renderLibrary(weapon: WeaponInstance | null): void {
	if (!library.open) return;
	const models = MODULE_MODELS.filter((model) => moduleModelMatches(model, { slot: librarySlot.value as ModuleSlot | "all", rarity: "all", platform: "all", search: librarySearch.value })
		&& (!libraryCompatible.checked || !weapon || moduleFitsWeaponFamily(model, weapon.weaponId)));
	libraryCount.textContent = `${models.length} моделей по фильтру · показано ${Math.min(libraryLimit, models.length)} · всего ${MODULE_MODELS.length}`;
	moduleCards.innerHTML = models.slice(0, libraryLimit).map((model) => {
		const installed = weapon?.modules[model.slot]?.modelId === model.id, reason = fittingReason(model, weapon);
		const stat = (label: string, value: number) => value ? `${label} ${value > 0 ? "+" : ""}${value}` : "";
		const metrics = [`Вес ${model.stats.weight.toFixed(2)} кг`, stat("Урон", model.stats.damage), stat("Удобство", model.stats.ergonomics), stat("Отдача", model.stats.recoil)].filter(Boolean).join(" · ");
		return `<article class="module-card ${installed ? "installed" : ""}">${moduleArt(model)}<h3>${escape(model.label)}</h3><p>${escape(model.description)}</p><p class="module-metrics">${escape(metrics)}</p><button type="button" data-try-module="${model.id}" ${reason || installed ? "disabled" : ""}>${installed ? "Установлено" : "Примерить"}</button>${reason ? `<small>${escape(reason)}</small>` : ""}</article>`;
	}).join("") || '<p class="library-help">Под этот фильтр деталей нет. Измени поиск или тип детали.</p>';
	libraryMore.hidden = models.length <= libraryLimit;
}

document.querySelector<HTMLElement>("#library-total")!.textContent = String(MODULE_MODELS.length);
for (const slot of MODULE_DISPLAY_SLOTS) librarySlot.add(new Option(MODULE_SLOT_LABELS[slot], slot));
library.addEventListener("toggle", () => renderLibrary(selectedWeapon()));
for (const input of [librarySlot, librarySearch, libraryCompatible]) input.addEventListener(input === librarySearch ? "input" : "change", () => { libraryLimit = 24; renderLibrary(selectedWeapon()); });
libraryMore.addEventListener("click", () => { libraryLimit += 24; renderLibrary(selectedWeapon()); });
moduleCards.addEventListener("click", (event) => {
	const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[data-try-module]");
	const model = button?.dataset.tryModule ? MODULE_BY_ID[button.dataset.tryModule] : undefined, weapon = selectedWeapon();
	if (!model || !weapon || fittingReason(model, weapon)) return;
	weapon.modules[model.slot] = part(model.id, model.slot); inspectedSlot = model.slot;
	updateSelections(true);
});

for (const [input, slot] of [[controls.armor, "armor"], [controls.helmet, "helmet"], [controls.pack, "backpack"]] as const) {
	for (const model of GEAR_MODELS.filter((model) => model.slot === slot)) input.add(new Option(model.label, model.id));
}
for (const weapon of WEAPONS) controls.weapon.add(new Option(weapon.name, weapon.id));
controls.weapon.value = "ak74";
const roster = document.querySelector<HTMLOListElement>("#accessible-roster")!;
for (const look of SCAV_APPEARANCES) {
	const item = document.createElement("li");
	item.textContent = `${look.name} · ${PERSONALITY_BY_ID[look.personality]?.name ?? look.personality}`;
	roster.append(item);
}

let selectedLoadout: ScavVisualLoadout = { armorModelId: null, helmetModelId: null, packModelId: null, weapon: null };
function selectedWeapon(): WeaponInstance | null {
	const weaponId = controls.weapon.value;
	if (!weaponId) return null;
	if (!weaponBuilds.has(weaponId)) weaponBuilds.set(weaponId, factoryWeapon(weaponId));
	return weaponBuilds.get(weaponId)!;
}
function refreshModuleControls(weapon: WeaponInstance | null): string[] {
	const removed: string[] = [];
	if (weapon) {
		// The demonstration removes dependent props when their real support is
		// replaced. Resolve to a fixed point even when an adapter comes after a sight.
		let changed: boolean;
		do {
			changed = false;
			for (const slot of MODULE_SLOTS) {
				const installed = weapon.modules[slot];
				if (installed && !compatibleOptions(slot, weapon).some((model) => model.id === installed.modelId)) {
					removed.push(MODULE_BY_ID[installed.modelId]?.label ?? MODULE_SLOT_LABELS[slot]);
					delete weapon.modules[slot]; changed = true;
				}
			}
		} while (changed);
	}
	for (const slot of MODULE_SLOTS) {
		const input = moduleControls[slot];
		input.replaceChildren(new Option("Не установлено", ""));
		if (weapon) for (const model of compatibleOptions(slot, weapon)) input.add(new Option(model.label, model.id));
		input.value = weapon?.modules[slot]?.modelId ?? "";
		input.disabled = !weapon || input.options.length < 2;
	}
	resetWeapon.disabled = !weapon;
	return removed;
}
function updateSelections(rebuildOptions = false): void {
	const weapon = selectedWeapon();
	if (rebuildOptions) {
		const removed = refreshModuleControls(weapon);
		fitStatus.hidden = removed.length === 0;
		fitStatus.textContent = removed.length ? `Сняты в примерке после замены крепления: ${removed.join(" · ")}.` : "";
	}
	selectedLoadout = { armorModelId: controls.armor.value || null, helmetModelId: controls.helmet.value || null, packModelId: controls.pack.value || null, weapon };
	const missing = weapon ? RECEIVER_INFO[weapon.weaponId]!.requiredSlots.filter((slot) => !weapon.modules[slot]) : [];
	const count = weapon ? Object.keys(weapon.modules).length : 0;
	weaponSummary.textContent = !weapon ? "Без оружия" : missing.length ? `Неполная сборка · установлено ${count} / ${MODULE_SLOTS.length} деталей` : `Текущая сборка · установлено ${count} / ${MODULE_SLOTS.length} деталей`;
	const labels = [controls.direction, controls.pose, controls.armor, controls.helmet, controls.pack, controls.weapon].map((input) => input.selectedOptions[0]!.textContent);
	gallery.setAttribute("aria-label", `32 диких. ${labels.join(". ")}. ${weaponSummary.textContent}.`);
	closeup.innerHTML = weapon ? weaponBuildArt(weapon, inspectedSlot) : '<p class="library-help">Выбери основу оружия, чтобы рассмотреть сборку.</p>';
	buildParts.innerHTML = weapon ? MODULE_DISPLAY_SLOTS.flatMap((slot) => {
		const modelId = weapon.modules[slot]?.modelId, model = modelId ? MODULE_BY_ID[modelId] : undefined;
		return model ? [`<li>${escape(model.label)}</li>`] : [];
	}).join("") : "";
	renderLibrary(weapon);
}
updateSelections(true);
for (const [name, input] of Object.entries(controls)) input.addEventListener("change", () => updateSelections(name === "weapon"));
for (const slot of MODULE_SLOTS) moduleControls[slot].addEventListener("change", () => {
	const weapon = selectedWeapon();
	if (!weapon) return;
	const modelId = moduleControls[slot].value;
	if (modelId && compatibleOptions(slot, weapon).some((model) => model.id === modelId)) weapon.modules[slot] = part(modelId, slot);
	else delete weapon.modules[slot];
	inspectedSlot = slot;
	updateSelections(true);
});
resetWeapon.addEventListener("click", () => {
	if (controls.weapon.value) weaponBuilds.set(controls.weapon.value, factoryWeapon(controls.weapon.value));
	updateSelections(true);
});

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
		for (const atlas of SCAV_EQUIPMENT_ATLASES) this.load.atlas(atlas.key, `/art/${atlas.basename}.png`, `/art/${atlas.basename}.json`);
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
			const head = scavHeadAnchor(model.poses.map((image) => ({ weight: image.visible ? image.alpha : 0, head: (image.frame.customData as { custom?: { head?: Point } }).custom?.head })));
			model.equipment.update(model.poses.length ? selectedLoadout : { armorModelId: null, helmetModelId: null, packModelId: null, weapon: null }, direction, { working: pose === "work", mode: controls.carry.value as "held" | "slung" | "none", torso, head });
		}
	}
}

await document.fonts.ready;
new Phaser.Game({ type: Phaser.AUTO, parent: gallery, width: gallery.clientWidth, height: 750, backgroundColor: "#17221b", transparent: true, antialias: true, pixelArt: false, scene: ScavPreview, banner: false, audio: { noAudio: true }, scale: { mode: Phaser.Scale.NONE } });
