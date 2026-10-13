import Phaser from "phaser";
import { weaponActorArt } from "./armory-art";
import { modularWeaponArtRevision } from "./modular-weapon-art";
import { WEAPON_BY_ID } from "./game/data";
import type { WeaponInstance } from "./game/engine";
import { scavAttachment, type ScavDirection } from "./scav-isometric";
import { getHostileVisualLoadout, weaponVisualSignature, type ScavVisualLoadout } from "./scav-loadout";
import { scavGearHeight, scavGearTexture } from "./scav-gear-art";

type Point = { x: number; y: number };
type WeaponArt = ReturnType<typeof weaponActorArt>;
type WeaponTextures = { pending: Set<string>; retry: Map<string, number>; art: Map<string, WeaponArt> };
const weaponTextures = new WeakMap<Phaser.Textures.TextureManager, WeaponTextures>();
const hash = (value: string) => { let n = 2166136261; for (const c of value) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return (n >>> 0).toString(36); };

function ensureWeaponTexture(scene: Phaser.Scene, weapon: WeaponInstance): { key: string; art: WeaponArt } | null {
	let cache = weaponTextures.get(scene.textures);
	if (!cache) { cache = { pending: new Set(), retry: new Map(), art: new Map() }; weaponTextures.set(scene.textures, cache); }
	const signature = `${weaponVisualSignature(weapon)}:${modularWeaponArtRevision(weapon)}`, key = `scav-weapon-${hash(signature)}`;
	let art = cache.art.get(key);
	if (!art) { art = weaponActorArt(weapon); cache.art.set(key, art); }
	if (scene.textures.exists(key)) return { key, art };
	if (!cache.pending.has(key) && Date.now() >= (cache.retry.get(key) ?? 0)) {
		cache.pending.add(key);
		const textures = scene.textures, tracking = cache;
		const detach = () => { textures.off(Phaser.Textures.Events.ADD, loaded); textures.off(Phaser.Textures.Events.ERROR, failed); };
		const loaded = (loadedKey: string) => { if (loadedKey !== key) return; tracking.pending.delete(key); tracking.retry.delete(key); detach(); };
		const failed = (failedKey: string) => { if (failedKey !== key) return; tracking.pending.delete(key); tracking.retry.set(key, Date.now() + 5000); detach(); };
		textures.on(Phaser.Textures.Events.ADD, loaded); textures.on(Phaser.Textures.Events.ERROR, failed);
		textures.addBase64(key, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(art.svg)}`);
	}
	return null;
}

export interface ScavEquipmentOptions {
	working?: boolean;
	mode?: "held" | "slung" | "none";
	aim?: number | null;
	bodyAngle?: number;
	hostile?: boolean;
	torso?: Point;
	head?: Point;
}

/** Clothes, armor, backpack and the assembled weapon remain independently replaceable. */
export class ScavEquipment {
	readonly weapon: Phaser.GameObjects.Image;
	private armor: Phaser.GameObjects.Image;
	private pack: Phaser.GameObjects.Image;
	private helmet: Phaser.GameObjects.Image;
	private muzzle: Point = { x: 0, y: 0 };
	private hostileLoadout: ScavVisualLoadout | null = null;
	private hostileAppearance = -1;

	constructor(private scene: Phaser.Scene, private body: Phaser.GameObjects.Container) {
		this.armor = scene.add.image(0, 0, "__WHITE").setVisible(false);
		this.pack = scene.add.image(0, 0, "__WHITE").setVisible(false);
		this.helmet = scene.add.image(0, 0, "__WHITE").setVisible(false);
		this.weapon = scene.add.image(0, 0, "__WHITE").setVisible(false);
		body.add([this.pack, this.armor, this.helmet, this.weapon]);
	}

	private paintGear(image: Phaser.GameObjects.Image, model: string | null, direction: ScavDirection, torso: Point): void {
		const key = model ? scavGearTexture(model) : undefined, frame = model ? `${model}-${direction}` : null;
		if (!model || !key || !frame || !this.scene.textures.exists(key) || !this.scene.textures.get(key).has(frame)) { image.setVisible(false); return; }
		image.setTexture(key, frame).setOrigin(.5, .5);
		const metadata = this.scene.textures.get(key).customData as { meta?: { equipmentHeightByModel?: Record<string, number> } };
		const reference = metadata.meta?.equipmentHeightByModel?.[model] ?? image.frame.cutHeight;
		const frontCargo = ["cargo_pack", "expedition_pack", "frame_pack"].includes(model) && direction[0] === "s";
		const height = scavGearHeight(model, direction);
		const x = torso.x + (frontCargo ? direction[1] === "e" ? -2 : 2 : 0);
		const y = torso.y + (["cargo_pack", "expedition_pack", "frame_pack"].includes(model) ? frontCargo ? 1 : -1 : 0);
		image.setScale(height / reference).setPosition(x, y).setVisible(true);
	}

	update(loadout: ScavVisualLoadout, direction: ScavDirection, options: ScavEquipmentOptions = {}): void {
		if (options.hostile && !loadout.weapon) {
			const appearance = Number(this.body.getData("appearance")) || 0;
			if (!this.hostileLoadout || appearance !== this.hostileAppearance) { this.hostileAppearance = appearance; this.hostileLoadout = getHostileVisualLoadout(appearance); }
			loadout = this.hostileLoadout;
		}
		const torso = options.torso && Number.isFinite(options.torso.x) && Number.isFinite(options.torso.y) ? options.torso : { x: 0, y: -28 };
		const rear = direction[0] === "n", right = direction[1] === "e";
		this.paintGear(this.armor, loadout.armorModelId, direction, torso);
		this.paintGear(this.pack, loadout.packModelId, direction, torso);
		const head = options.head && [options.head.x, options.head.y].every(Number.isFinite) ? options.head : { x: torso.x, y: torso.y - 16 };
		this.paintGear(this.helmet, loadout.helmetModelId ?? null, direction, head);
		// The front silhouette occludes its backpack; rear bags cover the back plate.
		if (rear) { this.body.bringToTop(this.armor); this.body.bringToTop(this.pack); }
		else { this.body.sendToBack(this.pack); this.body.bringToTop(this.armor); }
		this.body.bringToTop(this.helmet);
		const mode = options.mode ?? "held";
		if (!loadout.weapon || mode === "none") { this.weapon.setVisible(false); return; }
		const texture = ensureWeaponTexture(this.scene, loadout.weapon);
		if (!texture) { this.weapon.setVisible(false); return; }
		const { art, key } = texture, category = WEAPON_BY_ID[loadout.weapon.weaponId]?.category ?? "rifle";
		const length = category === "pistol" ? 15 : category === "smg" ? 26 : category === "sniper" ? 39 : category === "shotgun" ? 35 : 34;
		const scale = length / art.referenceWidth, hand = scavAttachment(direction, Boolean(options.working));
		const slung = mode === "slung";
		const x = slung ? torso.x + (right ? -1.5 : 1.5) : hand.x + torso.x;
		const y = slung ? torso.y + 1 : hand.y + torso.y + 28;
		const bearing = slung ? right ? -80 : -100 : options.aim ?? hand.angle;
		const localAngle = Math.atan2((art.muzzle.y - art.grip.y) * .75, (art.muzzle.x - art.grip.x) * (right ? 1 : -1)) * 180 / Math.PI;
		this.weapon.setTexture(key).setOrigin(art.grip.x / art.width, art.grip.y / art.height).setPosition(x, y)
			.setScale(scale * (right ? 1 : -1), scale * .75).setAngle(bearing - localAngle - (options.bodyAngle ?? 0)).setTint(options.hostile ? 0xb9ad99 : 0xffffff).setVisible(true);
		this.muzzle = { x: art.muzzle.x - art.grip.x, y: art.muzzle.y - art.grip.y };
		this.body.bringToTop(this.weapon);
	}

	/** World coordinates include the view container so raid effects can undo its camera transform. */
	muzzlePoint(): Point {
		const point = this.weapon.getWorldTransformMatrix().transformPoint(this.muzzle.x, this.muzzle.y);
		return { x: point.x, y: point.y };
	}

	destroy(): void { this.armor.destroy(); this.pack.destroy(); this.helmet.destroy(); this.weapon.destroy(); }
}
