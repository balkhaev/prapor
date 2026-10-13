import type { WeaponCategory } from "./game/data";
import { scavAttachment, type ScavDirection } from "./scav-isometric";

export type WeaponAttachmentPoint = { x: number; y: number };

/** Native side-profile coordinates, measured at each receiver's gripping surface. */
const gripAnchors: Record<string, readonly [number, number]> = {
	pm: [367, 185], tt: [367, 185], toz: [336, 177], mp133: [348, 188], pp91: [349, 188],
	sks: [305, 163], ak74: [351, 188], saiga: [351, 188], vityaz: [351, 188], mosin: [305, 163],
	akm: [351, 188], vss: [325, 192], rpk: [351, 188], svd: [261, 191], asval: [325, 192], pkp: [351, 188],
	m4a1: [349, 189], hk416: [349, 189], p90: [376, 190], mp7: [356, 187], ump45: [349, 189],
	m1911: [369, 190], mcx: [349, 189], scarh: [349, 189], trg42: [349, 188],
	g36: [350, 188], aug: [442, 213], fal: [350, 189], sr25: [350, 190], vector: [349, 190],
	fiveseven: [371, 188], sr2: [360, 189], sr1: [374, 190], glock20: [367, 187], ash12: [469, 211],
	vpo209: [352, 190], svdk: [353, 189], awm: [350, 190], m870: [306, 161],
};

/** VAL-family furniture shares one front grip interface, including borrowed factory stocks. */
export function weaponGripAnchor(weaponId: string, stockAppearance = "factory", _stockWeaponId?: string): WeaponAttachmentPoint {
	if (["sks", "mosin", "svd", "m870"].includes(weaponId)) {
		if (["tactical", "light", "precision", "skeleton", "folding"].includes(stockAppearance)) return { x: 335, y: 194 };
		if (stockAppearance === "padded") return { x: 305, y: 163 };
	}
	const [x, y] = Object.hasOwn(gripAnchors, weaponId) ? gripAnchors[weaponId]! : [351, 188];
	return { x, y };
}

export interface WeaponAttachmentArt {
	width: number;
	height: number;
	referenceWidth: number;
	grip: WeaponAttachmentPoint;
	muzzle: WeaponAttachmentPoint;
}

export interface WeaponCarryOptions {
	working?: boolean;
	mode?: "held" | "slung" | "none";
	aim?: number | null;
	bodyAngle?: number;
	bodyScale?: WeaponAttachmentPoint;
	torso?: WeaponAttachmentPoint;
}

/** Phaser's origin, mirrored scale and angle all use the same calibrated hand pivot. */
export function weaponCarryTransform(art: WeaponAttachmentArt, category: WeaponCategory, direction: ScavDirection, options: WeaponCarryOptions = {}) {
	const torso = options.torso && Number.isFinite(options.torso.x) && Number.isFinite(options.torso.y) ? options.torso : { x: 0, y: -28 };
	const hand = scavAttachment(direction, Boolean(options.working)), right = direction[1] === "e", slung = options.mode === "slung";
	const length = category === "pistol" ? 15 : category === "smg" ? 26 : category === "sniper" ? 39 : category === "shotgun" ? 35 : 34;
	// Keep the factory scale while longer barrels and suppressors grow outwards.
	const scale = length / art.referenceWidth;
	const muzzle = { x: art.muzzle.x - art.grip.x, y: art.muzzle.y - art.grip.y };
	const localAngle = Math.atan2(muzzle.y * .75, muzzle.x * (right ? 1 : -1)) * 180 / Math.PI;
	const bearing = slung ? right ? -80 : -100 : Number.isFinite(options.aim) ? options.aim! : hand.angle;
	const bodyAngle = Number.isFinite(options.bodyAngle) ? options.bodyAngle! : 0;
	const bodyScale = (value: number | undefined) => Number.isFinite(value) && Math.abs(value!) > 1e-6 ? value! : 1;
	// The animated body can be compressed or mirrored. Transform the intended
	// world-space bearing through its inverse rotation and scale before aiming.
	const target = (bearing - bodyAngle) * Math.PI / 180;
	const parentBearing = Math.atan2(Math.sin(target) / bodyScale(options.bodyScale?.y), Math.cos(target) / bodyScale(options.bodyScale?.x)) * 180 / Math.PI;
	return {
		origin: { x: art.grip.x / art.width, y: art.grip.y / art.height },
		position: { x: slung ? torso.x + (right ? -1.5 : 1.5) : hand.x + torso.x, y: slung ? torso.y + 1 : hand.y + torso.y + 28 },
		scale: { x: scale * (right ? 1 : -1), y: scale * .75 },
		angle: parentBearing - localAngle,
		muzzle,
		behind: !slung && hand.behind,
	};
}
