import { describe, expect, test } from "bun:test";
import { weaponActorArt, weaponBuildArt } from "../src/armory-art";
import { WEAPONS } from "../src/game/data";
import { getWeaponBuildIssues, type WeaponInstance } from "../src/game/engine";
import { FACTORY_KITS, MODULE_BY_ID, MODULE_MODELS, RECEIVER_INFO, getResolvedModuleMounts, type ModuleModel, type ModuleSlot } from "../src/game/modules";
import { moduleFitsWeaponFamily } from "../src/module-catalog";
import { SCAV_DIRECTIONS, scavAttachment } from "../src/scav-isometric";
import { weaponCarryTransform, weaponGripAnchor, type WeaponAttachmentPoint } from "../src/weapon-attachment";
import { createWeaponShowcaseBuild } from "../src/weapon-showcase";
import type Phaser from "phaser";

const TransformMatrix = require("phaser/src/gameobjects/components/TransformMatrix.js") as new () => Phaser.GameObjects.Components.TransformMatrix;

const factory = (weaponId: string): WeaponInstance => ({ id: "held-fit", weaponId, durability: 100, foundAt: 0, attachments: { optic: 0, magazine: 0, stock: 0 }, modules: Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId]) => [slot, { id: slot, modelId, durability: 100, foundAt: 0 }])) });
const install = (gun: WeaponInstance, modelId: string) => { const model = MODULE_BY_ID[modelId]!; gun.modules[model.slot] = { id: modelId, modelId, durability: 100, foundAt: 0 }; };

function compatibleBuild(weaponId: string, model: ModuleModel): { gun?: WeaponInstance; supported: boolean } {
	const info = RECEIVER_INFO[weaponId]!;
	let supported = false;
	for (const source of [factory(weaponId), createWeaponShowcaseBuild(weaponId, "field")]) {
		for (const prepared of [false, true]) {
			const gun = structuredClone(source);
			// A new bracket can replace the former attachment provider. Inspect it
			// without orphaning the old provider's light, sight or foregrip.
			for (const slot of ["optic", "foregrip", "flashlight", "laser", "mount"] as const) delete gun.modules[slot];
			if (prepared) {
				const handguard = MODULE_BY_ID[`handguard-${info.platform}-carbon`];
				const barrel = MODULE_BY_ID[`barrel-${info.platform}-${info.caliber}-long`];
				if (handguard) install(gun, handguard.id);
				if (barrel) install(gun, barrel.id);
			}
			if (model.requiresMount && !getResolvedModuleMounts(gun.modules, model.slot).includes(model.requiresMount)) continue;
			supported = true;
			install(gun, model.id);
			if (!getWeaponBuildIssues(gun).length) return { gun, supported };
		}
	}
	return { supported };
}

function part(svg: string, slot: ModuleSlot) {
	const start = svg.indexOf(`<g data-module-slot="${slot}"`), tags = /<g\b[^>]*>|<\/g>/g;
	if (start < 0) return "";
	tags.lastIndex = start; let depth = 0;
	for (let tag = tags.exec(svg); tag; tag = tags.exec(svg)) {
		depth += tag[0].startsWith("</") ? -1 : 1;
		if (!depth) return svg.slice(start, tags.lastIndex);
	}
	throw new Error(`Unclosed ${slot}`);
}

/** Flatten the shipped native outlines to test contact with filled geometry, including holes. */
function polygons(path: string) {
	const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/g) ?? [];
	const contours: WeaponAttachmentPoint[][] = [];
	let x = 0, y = 0, startX = 0, startY = 0, command = "", index = 0;
	const read = () => Number(tokens[index++]!);
	const append = (px: number, py: number) => { x = px; y = py; contours.at(-1)!.push({ x, y }); };
	while (index < tokens.length) {
		if (/^[a-z]$/i.test(tokens[index]!)) command = tokens[index++]!;
		const relative = command === command.toLowerCase(), operation = command.toUpperCase(), oldX = x, oldY = y;
		if (operation === "Z") { append(startX, startY); command = ""; continue; }
		if (operation === "M" || operation === "L") {
			const nx = read() + (relative ? oldX : 0), ny = read() + (relative ? oldY : 0);
			if (operation === "M") { contours.push([]); startX = nx; startY = ny; command = relative ? "l" : "L"; }
			append(nx, ny);
		} else if (operation === "H") append(read() + (relative ? oldX : 0), oldY);
		else if (operation === "V") append(oldX, read() + (relative ? oldY : 0));
		else if (operation === "Q") {
			const cx = read() + (relative ? oldX : 0), cy = read() + (relative ? oldY : 0), nx = read() + (relative ? oldX : 0), ny = read() + (relative ? oldY : 0);
			for (let step = 1; step <= 12; step++) { const t = step / 12; append((1 - t) ** 2 * oldX + 2 * (1 - t) * t * cx + t ** 2 * nx, (1 - t) ** 2 * oldY + 2 * (1 - t) * t * cy + t ** 2 * ny); }
		} else throw new Error(`Unsupported outline command ${command}`);
	}
	return contours;
}

function onFilledSurface(svg: string, point: WeaponAttachmentPoint) {
	return [...svg.matchAll(/<path\b([^>]*)>/g)].some(([, attributes]) => {
		const fill = attributes!.match(/\bfill="([^"]*)"/)?.[1], path = attributes!.match(/\bd="([^"]*)"/)?.[1];
		if (!path || !fill || fill === "none") return false;
		let winding = 0;
		for (const contour of polygons(path)) for (let i = 0; i < contour.length; i++) {
			const a = contour[i]!, b = contour[(i + 1) % contour.length]!;
			const cross = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
			if (a.y <= point.y && b.y > point.y && cross > 0) winding++;
			if (a.y > point.y && b.y <= point.y && cross < 0) winding--;
		}
		return attributes!.includes('fill-rule="evenodd"') ? Math.abs(winding) % 2 === 1 : winding !== 0;
	});
}

function projectedMuzzle(placement: ReturnType<typeof weaponCarryTransform>, bodyAngle = 0) {
	const angle = (placement.angle + bodyAngle) * Math.PI / 180, x = placement.muzzle.x * placement.scale.x, y = placement.muzzle.y * placement.scale.y;
	return { x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) };
}

describe("weapon grip calibration and carried assembly", () => {
	test("every gun and compatible contact part retains the complete bench geometry when carried", () => {
		const uncovered: string[] = [];
		for (const definition of WEAPONS) {
			const builds = [factory(definition.id), createWeaponShowcaseBuild(definition.id, "field")];
			for (const model of MODULE_MODELS.filter(model => ["stock", "magazine", "handguard", "mount"].includes(model.slot) && moduleFitsWeaponFamily(model, definition.id))) {
				const { gun, supported } = compatibleBuild(definition.id, model);
				if (supported && !gun) uncovered.push(`${definition.id}/${model.id}`);
				if (gun) builds.push(gun);
			}
			const reference = weaponActorArt(factory(definition.id));
			for (const gun of builds) {
				const actor = weaponActorArt(gun), bench = weaponBuildArt(gun);
				const [left, top] = actor.svg.match(/viewBox="([^"]+)"/)![1]!.split(" ").map(Number);
				// Compare complete nested groups, including offsets, fasteners and
				// rail beds; a first-path comparison misses the actual contact detail.
				for (const slot of Object.keys(gun.modules) as ModuleSlot[]) {
					const group = part(actor.svg, slot);
					expect(group, `${definition.id}/${gun.modules[slot]!.modelId}`).not.toBe("");
					expect(group, `${definition.id}/${gun.modules[slot]!.modelId}`).toBe(part(bench, slot));
				}
				expect(actor.referenceWidth, definition.id).toBe(reference.referenceWidth);
				const stock = gun.modules.stock ? MODULE_BY_ID[gun.modules.stock.modelId] : undefined;
				const grip = weaponGripAnchor(definition.id, stock?.appearance, stock?.weaponId);
				expect({ x: actor.grip.x + left!, y: actor.grip.y + top! }, definition.id).toEqual(grip);
				for (const direction of SCAV_DIRECTIONS) {
					const hand = scavAttachment(direction, true), placement = weaponCarryTransform(actor, definition.category, direction, { working: true });
					const transform = new TransformMatrix().applyITRS(placement.position.x, placement.position.y, placement.angle * Math.PI / 180, placement.scale.x, placement.scale.y);
					const placedHand = transform.transformPoint(0, 0);
					expect(placedHand.x, definition.id).toBeCloseTo(hand.x, 8);
					expect(placedHand.y, definition.id).toBeCloseTo(hand.y, 8);
				}
			}
		}
		expect(uncovered).toEqual([]);
	});

	test("all factory hand anchors contact actual filled receiver or stock geometry", () => {
		const outside: string[] = [];
		for (const definition of WEAPONS) {
			const gun = factory(definition.id), art = weaponActorArt(gun), point = weaponGripAnchor(definition.id);
			if (!onFilledSurface(part(art.svg, "receiver") + part(art.svg, "stock"), point)) outside.push(definition.id);
			const [left, top] = art.svg.match(/viewBox="([^"]+)"/)![1]!.split(" ").map(Number);
			expect(art.grip.x + left!, definition.id).toBeCloseTo(point.x, 8);
			expect(art.grip.y + top!, definition.id).toBeCloseTo(point.y, 8);
		}
		expect(outside).toEqual([]);
	});

	test("incomplete assemblies keep their hand and muzzle inside the texture without ghost parts", () => {
		for (const definition of WEAPONS) {
			const source = factory(definition.id);
			for (const missing of [...Object.keys(source.modules), "all"]) {
				const gun = structuredClone(source);
				if (missing === "all") gun.modules = {};
				else delete gun.modules[missing as ModuleSlot];
				const art = weaponActorArt(gun);
				for (const point of [art.grip, art.muzzle]) {
					expect(point.x, `${definition.id}/${missing}`).toBeGreaterThanOrEqual(0); expect(point.x).toBeLessThanOrEqual(art.width);
					expect(point.y).toBeGreaterThanOrEqual(0); expect(point.y).toBeLessThanOrEqual(art.height);
				}
				if (missing === "all") expect(art.svg).not.toContain('data-module-slot="');
				else expect(art.svg).not.toContain(`data-module-slot="${missing}"`);
			}
		}
	});

	test("every compatible stock leaves a physical grasping surface under the hand", () => {
		const outside: string[] = [];
		for (const definition of WEAPONS.filter((gun) => gun.category !== "pistol")) {
			const info = RECEIVER_INFO[definition.id]!;
			const stocks = MODULE_MODELS.filter((model) => model.slot === "stock" && (model.platforms.includes("*") || model.platforms.includes(info.platform)) && (model.calibers.includes("*") || model.calibers.includes(info.caliber)));
			for (const stock of stocks) {
				const gun = factory(definition.id); install(gun, stock.id);
				const art = weaponActorArt(gun), [left, top] = art.svg.match(/viewBox="([^"]+)"/)![1]!.split(" ").map(Number);
				if (!onFilledSurface(part(art.svg, "receiver") + part(art.svg, "stock"), { x: art.grip.x + left!, y: art.grip.y + top! })) outside.push(`${definition.id}/${stock.id}`);
			}
		}
		expect(outside).toEqual([]);
	});

	test("VSS and VAL hold the stock furniture's shared front grip across every factory donor and upgrade", () => {
		const stocks = MODULE_MODELS.filter(model => model.slot === "stock" && model.platforms.includes("val") && (model.calibers.includes("*") || model.calibers.includes("9x39")));
		expect(stocks.some(model => model.id === "factory-vss-stock")).toBe(true);
		expect(stocks.some(model => model.id === "factory-asval-stock")).toBe(true);
		for (const weaponId of ["vss", "asval"]) for (const stock of stocks) {
			const reference = weaponActorArt(factory(weaponId));
			const gun = factory(weaponId); install(gun, stock.id);
			expect(getWeaponBuildIssues(gun), `${weaponId}/${stock.id}`).toEqual([]);
			const art = weaponActorArt(gun), [left, top] = art.svg.match(/viewBox="([^"]+)"/)![1]!.split(" ").map(Number);
			const grip = { x: art.grip.x + left!, y: art.grip.y + top! };
			expect(grip, `${weaponId}/${stock.id}`).toEqual({ x: 325, y: 192 });
			// The receiver carries no substitute grip. The hand contacts the real
			// fitted furniture, ahead of the buttstock's openings and behind the guard.
			expect(onFilledSurface(part(art.svg, "stock"), grip), `${weaponId}/${stock.id}`).toBe(true);
			expect(art.muzzle.x - art.grip.x).toBeGreaterThan(0);
			// A longer butt or another donor stock grows behind the hand; it must
			// neither shrink the receiver nor displace the fitted suppressor.
			expect(art.referenceWidth).toBe(reference.referenceWidth);
			expect({ x: art.muzzle.x - art.grip.x, y: art.muzzle.y - art.grip.y }).toEqual({ x: reference.muzzle.x - reference.grip.x, y: reference.muzzle.y - reference.grip.y });
		}
	});

	test("hands, mirrored barrels and aim bearings stay aligned in every facing and pose", () => {
		for (const definition of WEAPONS) for (const direction of SCAV_DIRECTIONS) for (const working of [false, true]) {
			const art = weaponActorArt(factory(definition.id)), hand = scavAttachment(direction, working), torso = { x: 3, y: -26 };
			const placement = weaponCarryTransform(art, definition.category, direction, { working, torso, bodyAngle: 17 });
			expect(placement.position).toEqual({ x: hand.x + torso.x, y: hand.y + torso.y + 28 });
			expect(placement.behind).toBe(direction[0] === "n");
			const muzzle = projectedMuzzle(placement, 17), bearing = Math.atan2(muzzle.y, muzzle.x) * 180 / Math.PI;
			expect(bearing).toBeCloseTo(hand.angle, 8);
			expect(Math.sign(placement.scale.x)).toBe(direction[1] === "e" ? 1 : -1);
			expect(placement.origin.x).toBeGreaterThan(0); expect(placement.origin.x).toBeLessThan(1);
			expect(placement.origin.y).toBeGreaterThan(0); expect(placement.origin.y).toBeLessThan(1);
			const aimed = weaponCarryTransform(art, definition.category, direction, { aim: 63, bodyAngle: -21 });
			const aimMuzzle = projectedMuzzle(aimed, -21);
			expect(Math.atan2(aimMuzzle.y, aimMuzzle.x) * 180 / Math.PI).toBeCloseTo(63, 8);
		}
	});

	test("a slung assembly stays on top of worn gear and follows the torso", () => {
		for (const direction of SCAV_DIRECTIONS) {
			const placement = weaponCarryTransform(weaponActorArt(factory("aug")), "rifle", direction, { mode: "slung", torso: { x: 4, y: -30 } });
			expect(placement.behind).toBe(false);
			expect(placement.position).toEqual({ x: direction[1] === "e" ? 2.5 : 5.5, y: -29 });
			const muzzle = projectedMuzzle(placement);
			expect(Math.atan2(muzzle.y, muzzle.x) * 180 / Math.PI).toBeCloseTo(direction[1] === "e" ? -80 : -100, 8);
		}
	});

	test("real Phaser parent matrices preserve aim while actors crouch, lean, stretch or mirror", () => {
		for (const definition of WEAPONS) for (const direction of SCAV_DIRECTIONS) {
			const art = weaponActorArt(factory(definition.id));
			for (const bodyAngle of [-9, -.55, 0, .55, 17]) for (const bodyScale of [{ x: 1, y: .94 }, { x: 1, y: .991 }, { x: 1.2, y: .83 }, { x: -1, y: .94 }]) {
				for (const aim of [-135, -63, -45, 0, 45, 63, 135, 180]) {
					const placement = weaponCarryTransform(art, definition.category, direction, { working: true, aim, bodyAngle, bodyScale });
					const child = new TransformMatrix().applyITRS(placement.position.x, placement.position.y, placement.angle * Math.PI / 180, placement.scale.x, placement.scale.y);
					const parent = new TransformMatrix().applyITRS(7, -3, bodyAngle * Math.PI / 180, bodyScale.x, bodyScale.y), world = new TransformMatrix();
					parent.multiply(child, world);
					const hand = world.transformPoint(0, 0), muzzle = world.transformPoint(placement.muzzle.x, placement.muzzle.y);
					const desired = aim * Math.PI / 180, dx = muzzle.x - hand.x, dy = muzzle.y - hand.y;
					expect(dx * Math.cos(desired) + dy * Math.sin(desired)).toBeGreaterThan(0);
					expect((dx * Math.sin(desired) - dy * Math.cos(desired)) / Math.hypot(dx, dy), `${definition.id}/${direction}`).toBeCloseTo(0, 5);
					const bodyHand = parent.transformPoint(placement.position.x, placement.position.y);
					expect(hand.x).toBeCloseTo(bodyHand.x, 4); expect(hand.y).toBeCloseTo(bodyHand.y, 4);
				}
			}
		}
	});

	test("long barrels and suppressors extend away from the same hand without shrinking modules", () => {
		for (const id of ["pm", "ak74", "m4a1", "p90", "mp7", "aug", "m870", "awm"]) {
			const gun = factory(id), definition = WEAPONS.find((item) => item.id === id)!, info = RECEIVER_INFO[id]!;
			const before = weaponActorArt(gun), plain = weaponCarryTransform(before, definition.category, "se");
			install(gun, `barrel-${info.platform}-${info.caliber}-long`);
			install(gun, `muzzle-${info.caliber}-suppressor`);
			const after = weaponActorArt(gun), longer = weaponCarryTransform(after, definition.category, "se");
			expect(after.referenceWidth, id).toBe(before.referenceWidth);
			expect(longer.position).toEqual(plain.position); expect(longer.scale).toEqual(plain.scale);
			expect(Math.hypot(projectedMuzzle(longer).x, projectedMuzzle(longer).y), id).toBeGreaterThan(Math.hypot(projectedMuzzle(plain).x, projectedMuzzle(plain).y));
			expect(after.muzzle.x).toBeLessThan(after.width); expect(after.grip.x).toBeLessThan(after.width);
		}
	});

	test("invalid animation measurements retain a finite resting carry", () => {
		const art = weaponActorArt(factory("mp7"));
		expect(weaponCarryTransform(art, "smg", "ne", { aim: NaN, bodyAngle: Infinity, torso: { x: NaN, y: 0 } })).toEqual(weaponCarryTransform(art, "smg", "ne"));
		expect(weaponCarryTransform(art, "smg", "ne", { bodyScale: { x: 0, y: NaN } })).toEqual(weaponCarryTransform(art, "smg", "ne"));
		expect(weaponGripAnchor("toString")).toEqual({ x: 351, y: 188 });
	});
});
