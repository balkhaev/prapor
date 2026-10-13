import { describe, expect, test } from "bun:test";
import { weaponActorArt } from "../src/armory-art";
import { WEAPONS } from "../src/game/data";
import type { WeaponInstance } from "../src/game/engine";
import { FACTORY_KITS, MODULE_BY_ID, MODULE_MODELS, RECEIVER_INFO, type ModuleSlot } from "../src/game/modules";
import { SCAV_DIRECTIONS, scavAttachment } from "../src/scav-isometric";
import { weaponCarryTransform, weaponGripAnchor, type WeaponAttachmentPoint } from "../src/weapon-attachment";

const factory = (weaponId: string): WeaponInstance => ({ id: "held-fit", weaponId, durability: 100, foundAt: 0, attachments: { optic: 0, magazine: 0, stock: 0 }, modules: Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId]) => [slot, { id: slot, modelId, durability: 100, foundAt: 0 }])) });
const install = (gun: WeaponInstance, modelId: string) => { const model = MODULE_BY_ID[modelId]!; gun.modules[model.slot] = { id: modelId, modelId, durability: 100, foundAt: 0 }; };

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
		expect(weaponGripAnchor("toString")).toEqual({ x: 351, y: 188 });
	});
});
