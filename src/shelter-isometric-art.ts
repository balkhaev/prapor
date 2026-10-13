import type Phaser from "phaser";
import type { ModuleSlot } from "./game/modules";
import { ROOM_DEFINITIONS, getRoomLocalPoint, getRoomLocalSize, type RoomInstance } from "./game/shelter";
import { projectShelterPoint } from "./shelter-isometric";
import type { ProductionPresentation } from "./shelter-production";

type Point = { x: number; y: number };
type Vertex = readonly [number, number, number?];
type Material = readonly [number, number, number];
type WallSide = "north" | "east" | "south" | "west";
const C = {
	ink: 0x26302b, seam: 0x4b5145, concrete: 0x929482, floor: 0x8c795a,
	steel: 0xa2aba0, pale: 0xe2d9bc, amber: 0xf2c27d, cyan: 0x9cc8be,
	green: 0xafca7b, wood: 0xac8655, dark: 0x465247,
};
const STEEL: Material = [0xa2a99a, 0x7a887d, 0x576b61];
const OLIVE: Material = [0x6a7d58, 0x475e41, 0x314936];
const WOOD: Material = [0xb49768, 0x8e704b, 0x6e553b];
const PALE: Material = [0xdfddc6, 0xb7bca7, 0x8f9e8d];
const BLACK: Material = [0x344d3a, 0x233c2c, 0x193224];
const STONE: Material = [0x9a9987, 0x747566, 0x5b6256];

function mixColor(color: number, target: number, amount: number): number {
	const channel = (shift: number) => Math.round(((color >> shift) & 255) * (1 - amount) + ((target >> shift) & 255) * amount);
	return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

interface BuildingFinish { wall: Material; roof: Material; accent: number; timber: boolean }
function buildingFinish(type: RoomInstance["type"]): BuildingFinish {
	const accent = Number.parseInt(ROOM_DEFINITIONS[type].color.slice(1), 16);
	const facade = {
		workshop: 0xbb9866, ammo: 0x9b9d77, recycler: 0xac8266, medbay: 0xd1d4ba,
		radio: 0x9fbbc0, storage: 0xaaad96, dormitory: 0xc9ae8e, hangar: 0x9aaeb3,
	}[type];
	const roofColor = type === "dormitory" ? 0x856e58 : type === "medbay" ? 0x82978e : type === "workshop" ? 0x7d8273 : 0x718a87;
	return {
		wall: [mixColor(facade, 0xf3e6c9, .25), facade, mixColor(facade, 0x34483e, .35)],
		roof: [mixColor(roofColor, 0xb5c3b5, .22), roofColor, mixColor(roofColor, 0x354c44, .25)],
		accent,
		timber: type === "workshop" || type === "dormitory" || type === "storage",
	};
}

/** Equipment remains upright: the affine projection applies only to the floor. */
class RoomPainter {
	readonly width: number;
	readonly height: number;
	constructor(readonly g: Phaser.GameObjects.Graphics, readonly room: RoomInstance) {
		const size = getRoomLocalSize(room);
		this.width = size.width; this.height = size.height;
	}
	p(x: number, y: number, z = 0): Point {
		const point = projectShelterPoint(getRoomLocalPoint(this.room, x, y));
		return { x: point.x, y: point.y - z };
	}
	worldSide(side: WallSide): WallSide {
		const sides: WallSide[] = ["north", "east", "south", "west"];
		return sides[(sides.indexOf(side) + (this.room.facing ?? 0)) % 4]!;
	}
	farWall(side: WallSide): boolean { const world = this.worldSide(side); return world === "north" || world === "west"; }
	face(vertices: readonly Vertex[], color: number, alpha = 1, outline = C.ink): void {
		const points = vertices.map(([x, y, z = 0]) => this.p(x, y, z));
		this.g.fillStyle(color, alpha).fillPoints(points, true);
		this.g.lineStyle(.6, outline, alpha * .85).strokePoints(points, true);
	}
	line(a: Vertex, b: Vertex, color = C.steel, width = .7, alpha = 1): void {
		const from = this.p(a[0], a[1], a[2] ?? 0), to = this.p(b[0], b[1], b[2] ?? 0);
		this.g.lineStyle(width, color, alpha).lineBetween(from.x, from.y, to.x, to.y);
	}
	dot(x: number, y: number, z: number, radius: number, color: number, alpha = 1): void {
		const point = this.p(x, y, z);
		this.g.fillStyle(color, alpha).fillCircle(point.x, point.y, radius);
	}
	plane(x: number, y: number, w: number, d: number, z: number, color: number, alpha = 1): void {
		this.face([[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z]], color, alpha);
	}
	box(x: number, y: number, w: number, d: number, h: number, material: Material = OLIVE, z = 0): void {
		// The camera keeps its light direction when a building turns. Only the two
		// world-facing sides are visible; equipment must never look inside-out.
		const faces: [WallSide, Vertex[]][] = [
			["north", [[x, y, z], [x + w, y, z], [x + w, y, z + h], [x, y, z + h]]],
			["east", [[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]]],
			["south", [[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]]],
			["west", [[x, y, z], [x, y + d, z], [x, y + d, z + h], [x, y, z + h]]],
		];
		for (const [side, vertices] of faces) {
			const world = this.worldSide(side);
			if (world === "east" || world === "south") this.face(vertices, material[world === "east" ? 2 : 1]);
		}
		this.plane(x, y, w, d, z + h, material[0]);
	}
	shadow(x: number, y: number, w: number, d: number): void {
		this.plane(x + 4, y + 4, w + 2, d + 2, .1, C.ink, .25);
	}
	table(x: number, y: number, w: number, d: number, h = 14, material: Material = STEEL): void {
		this.shadow(x, y, w, d);
		for (const [dx, dy] of [[2, 2], [w - 5, 2], [2, d - 5], [w - 5, d - 5]]) this.box(x + dx!, y + dy!, 3, 3, h - 2, BLACK);
		this.box(x, y, w, d, 2, material, h - 2);
		this.line([x + 3, y + d, 4], [x + w - 3, y + d, 4], C.steel);
	}
	crate(x: number, y: number, w = 24, d = 19, h = 12, z = 0): void {
		this.box(x, y, w, d, h, WOOD, z);
		for (const offset of [4, w - 5]) {
			this.line([x + offset, y, z + h], [x + offset, y + d, z + h], C.pale, 1.1, .6);
			this.line([x + offset, y + d, z], [x + offset, y + d, z + h], C.pale, 1.1, .6);
		}
		this.line([x + 2, y + d, z + h * .5], [x + w - 2, y + d, z + h * .5], 0x4c452d, .65);
		this.dot(x + w * .5, y + d, z + h * .55, .8, C.amber);
	}
	monitor(x: number, y: number, w = 25, h = 13, z = 16): void {
		this.box(x, y, w, 5, h, BLACK, z);
		this.face([[x + 2, y + 5.15, z + 2], [x + w - 2, y + 5.15, z + 2], [x + w - 2, y + 5.15, z + h - 2], [x + 2, y + 5.15, z + h - 2]], 0x163c32);
		this.line([x + 4, y + 5.3, z + h - 4], [x + w - 4, y + 5.3, z + h - 4], C.cyan, .5, .6);
		this.dot(x + w - 3, y + 5.3, z + 1, .55, C.green);
	}
}

function foundation(a: RoomPainter, finish: BuildingFinish): void {
	// A single raised floor belongs to the building. It never draws a tile on the yard.
	a.shadow(2, 1, a.width - 5, a.height - 3);
	a.box(1, 1, a.width - 2, a.height - 2, 5, STONE, -5);
	a.plane(5, 5, a.width - 10, a.height - 10, .1, finish.timber ? 0xa18a65 : 0x939784);
	if (finish.timber) {
		for (let y = 12; y < a.height - 8; y += 11) {
			a.line([5, y, .3], [a.width - 5, y, .3], 0x5c513b, .55, .48);
			for (let x = y % 22 + 24; x < a.width - 7; x += 57) a.line([x, y, .35], [x, y + 10, .35], 0x66533c, .4, .35);
		}
	} else {
		// Scuffed concrete has fine irregular marks rather than another square grid.
		for (let i = 0; i < Math.floor(a.width / 12); i++) {
			const x = 15 + i * 29 % Math.max(1, a.width - 30), y = 19 + i * 17 % Math.max(1, a.height - 34);
			a.line([x, y, .3], [x + 7, y + 1.5, .3], 0xc5c3a6, .6, .35);
		}
	}
	a.line([1, a.height - 1, .3], [a.width - 1, a.height - 1, .3], 0xc4b997, 1.1, .85);
	a.line([a.width - 1, 1, .3], [a.width - 1, a.height - 1, .3], 0x566455, .8, .7);
	for (let x = 13; x < a.width - 5; x += 23) a.line([x, a.height - 1, -4], [x, a.height - 1, -.5], 0x4b5548, .6, .55);
}

function cabinWindow(a: RoomPainter, x: number, y: number, side: "rear" | "left", width = 24): void {
	const pane = side === "rear"
		? (offset: number, z: number): Vertex => [x + offset, y, z]
		: (offset: number, z: number): Vertex => [x, y + offset, z];
	a.face([pane(0, 10), pane(width, 10), pane(width, 28), pane(0, 28)], 0x5e5c49);
	a.face([pane(2, 12), pane(width - 2, 12), pane(width - 2, 26), pane(2, 26)], 0xe4b977, .98, 0x6d7e69);
	a.face([pane(3, 19), pane(width - 3, 19), pane(width - 3, 25), pane(3, 25)], 0xffdf9c, .7, 0xbbae86);
	a.line(pane(width / 2, 11), pane(width / 2, 27), 0xe4d6b4, 1.1);
	a.line(pane(1, 18), pane(width - 1, 18), 0xe4d6b4, 1);
	a.line(pane(-2, 10), pane(width + 2, 10), 0xe4d6b4, 2);
	a.line(pane(-1, 29), pane(width + 1, 29), 0xe4d6b4, 1.3);
}

function chimneyLocal(room: RoomInstance): Point | null {
	const { width, height } = getRoomLocalSize(room);
	if (width >= 200) return null;
	const facing = room.facing ?? 0, length = facing % 2 ? height : width;
	const vertex = (along: number, across: number): Point => facing === 0 ? { x: along, y: across } : facing === 1 ? { x: across, y: height - along } : facing === 2 ? { x: width - along, y: height - across } : { x: width - across, y: along };
	const base = vertex(length - 28, 0), end = vertex(length - 16, 10);
	return { x: Math.min(base.x, end.x), y: Math.min(base.y, end.y) };
}
/** Smoke starts at the same open chimney cap that is drawn on the turned roof. */
export function getShelterChimney(room: RoomInstance): { point: Point; height: number } | null {
	const local = chimneyLocal(room);
	return local ? { point: getRoomLocalPoint(room, local.x + 6, local.y + 5), height: 48.1 } : null;
}
export function getShelterPorchLamp(room: RoomInstance): { point: Point; height: number } {
	const { width, height } = getRoomLocalSize(room);
	return { point: getRoomLocalPoint(room, width / 2 + 25, height), height: 12 };
}

function roof(a: RoomPainter, finish: BuildingFinish): void {
	// The removed roof always faces the camera. Rotating the cabin reveals its
	// other interior walls instead of placing an opaque roof in front of work.
	const side = (["north", "east", "south", "west"] as const).find((candidate) => a.worldSide(candidate) === "north")!;
	const horizontal = side === "north" || side === "south", length = horizontal ? a.width : a.height;
	const depth = Math.min(20, (horizontal ? a.height : a.width) * .15);
	const vertex = (along: number, across: number, z: number): Vertex => {
		if (side === "north") return [along, across, z];
		if (side === "south") return [a.width - along, a.height - across, z];
		if (side === "west") return [across, a.height - along, z];
		return [a.width - across, along, z];
	};
	a.face([vertex(-4, -5, 33), vertex(length + 4, -5, 33), vertex(length + 4, 4, 41), vertex(-4, 4, 41)], finish.roof[2]);
	a.face([vertex(-4, 4, 41), vertex(length + 4, 4, 41), vertex(length + 4, depth, 32), vertex(-4, depth, 32)], finish.roof[0]);
	for (let along = 1; along < length + 3; along += 8) {
		a.line(vertex(along, -5, 33), vertex(along, 4, 41), finish.roof[0], .65, .65);
		a.line(vertex(along, 4, 41), vertex(along, depth, 32), finish.roof[2], .75, .7);
	}
	a.line(vertex(-4, 4, 41), vertex(length + 4, 4, 41), 0xc9cbb3, 1.4, .85);
	a.line(vertex(-4, depth, 32), vertex(length + 4, depth, 32), 0xd2ceb2, 1.6);
	a.face([vertex(-4, -5, 32), vertex(-4, 4, 40), vertex(-4, depth, 31)], finish.wall[2]);
	a.line(vertex(length + 2, depth, 31), vertex(length + 2, depth, 3), 0x6c7d6d, 1.5);
	a.line(vertex(length + 2, depth, 3), vertex(length - 2, depth + 5, 1), 0x6c7d6d, 1.3);
	const chimney = chimneyLocal(a.room);
	if (chimney) {
		const { x, y } = chimney;
		a.box(x + 2, y + 2, 8, 6, 11, STONE, 35);
		a.box(x, y, 12, 10, 2, STEEL, 46);
		a.plane(x + 3, y + 3, 6, 4, 48.1, C.ink);
	}
}

function walls(a: RoomPainter, finish: BuildingFinish): void {
	const entrance = a.width / 2;
	for (const side of ["north", "west", "east", "south"] as const) {
		const tall = a.farWall(side), h = tall ? 31 : 5;
		const horizontal = side === "north" || side === "south";
		const x = side === "east" ? a.width - 5 : 0, y = side === "south" ? a.height - 5 : 0;
		const length = horizontal ? a.width : a.height;
		if (side === "south") {
			a.box(0, y, entrance - 17, 5, h, finish.wall);
			a.box(entrance + 17, y, a.width - entrance - 17, 5, h, finish.wall);
		} else a.box(x, y, horizontal ? a.width : 5, horizontal ? 5 : a.height, h, finish.wall);
		const inside = (along: number, z: number): Vertex => horizontal
			? [along, side === "north" ? 5.3 : a.height - 5.3, z]
			: [side === "west" ? 5.3 : a.width - 5.3, along, z];
		a.line(inside(6, 3), inside(length - 6, 3), 0xe0cfab, 1.2, .85);
		if (!tall) continue;
		a.line(inside(6, 30), inside(length - 6, 30), 0xe0cfab, 1.2);
		if (finish.timber) {
			for (const z of [8, 14, 20, 26]) a.line(inside(6, z), inside(length - 6, z), 0x735c40, .6, .45);
		} else {
			for (let along = 14; along < length - 7; along += 10) {
				if (side !== "south" || Math.abs(along - entrance) > 19) a.line(inside(along, 4), inside(along, 28), finish.wall[2], .5, .38);
			}
		}
		const windowAlong = side === "south" ? 25 : Math.max(20, length * .25);
		const pane = inside(windowAlong, 0);
		cabinWindow(a, pane[0], pane[1], horizontal ? "rear" : "left", Math.min(28, length * .25));
		if (horizontal && side !== "south" && length > 150) {
			const other = inside(length - 60, 0); cabinWindow(a, other[0], other[1], "rear", 27);
		}
	}
	for (const [x, y, vertical, horizontal] of [
		[0, 0, "west", "north"], [a.width - 7, 0, "east", "north"],
		[0, a.height - 7, "west", "south"], [a.width - 7, a.height - 7, "east", "south"],
	] as const) a.box(x, y, 7, 7, a.farWall(vertical) && a.farWall(horizontal) ? 34 : 6, WOOD);
}

function roomEmblem(a: RoomPainter, type: RoomInstance["type"], x: number, y: number, z: number): void {
	const line = (x1: number, z1: number, x2: number, z2: number, width = 1.6) => a.line([x + x1, y, z + z1], [x + x2, y, z + z2], C.pale, width);
	switch (type) {
		case "medbay": line(0, -5, 0, 5, 2.5); line(-7, 0, 7, 0, 2.5); break;
		case "radio":
			line(0, -5, 0, 5); line(-6, 2, 6, 2); line(-9, 5, 9, 5); a.dot(x, y, z + 6, 1.6, C.amber); break;
		case "storage": case "hangar":
			line(-7, -4, 7, -4); line(-7, 4, 7, 4); line(-7, -4, -7, 4); line(7, -4, 7, 4); line(0, -4, 0, 4, .8); break;
		case "dormitory":
			line(-7, -3, 7, -3); line(-7, -5, -7, 4); line(7, -5, 7, 1); line(-7, 1, 5, 1, 2.3); break;
		case "ammo": for (const offset of [-5, 1, 7]) { line(offset, -4, offset, 4, 2.2); a.dot(x + offset, y, z + 5, 1, C.amber); } break;
		case "recycler": line(-6, -2, 0, 5); line(0, 5, 7, -2); line(7, -2, -6, -2); break;
		case "workshop": line(-6, -5, 5, 5, 2.5); line(5, 5, 9, 4); line(5, 5, 4, 8); break;
	}
}

function frontDetails(a: RoomPainter, finish: BuildingFinish, type: RoomInstance["type"]): void {
	const entrance = a.width / 2;
	// This is an actual doorway rather than a gap in a square outline. The
	// threshold, hinged leaf and shallow canopy turn with the entrance route.
	for (const x of [entrance - 19, entrance + 16]) a.box(x, a.height - 5, 3, 5, 28, WOOD);
	a.box(entrance - 19, a.height - 5, 38, 5, 3, WOOD, 27);
	a.face([[entrance - 15, a.height - 3, .3], [entrance + 15, a.height - 3, .3], [entrance + 15, a.height - 3, 26], [entrance - 15, a.height - 3, 26]], C.ink, .52);
	a.face([[entrance - 15, a.height - 3.1, 1], [entrance - 7, a.height - 19, 1], [entrance - 7, a.height - 19, 25], [entrance - 15, a.height - 3.1, 25]], finish.wall[1]);
	a.line([entrance - 14, a.height - 4, 23], [entrance - 8, a.height - 17, 23], C.pale, .8);
	a.dot(entrance - 8, a.height - 17, 12, .8, C.amber);
	a.box(entrance - 21, a.height - 1, 42, 6, 3.2, STONE, -3.2);
	a.box(entrance - 18, a.height + 5, 36, 4, 2, STONE, -4.6);
	a.line([entrance - 20, a.height + 5, .1], [entrance + 20, a.height + 5, .1], C.pale, .85, .7);
	a.face([[entrance - 23, a.height - 5, 31], [entrance + 23, a.height - 5, 31], [entrance + 23, a.height + 7, 27], [entrance - 23, a.height + 7, 27]], finish.roof[0]);
	a.line([entrance - 23, a.height + 7, 27], [entrance + 23, a.height + 7, 27], C.pale, 1.2);
	for (const x of [entrance - 20, entrance + 20]) a.line([x, a.height - 2, 20], [x, a.height + 5, 27], C.dark, 1.1);
	// A mounted enamel emblem is legible even when room labels are hidden.
	const signX = 35, signY = a.height - 1;
	a.box(signX - 14, signY - 1, 28, 3, 17, WOOD, 7);
	a.face([[signX - 12, signY + 2.2, 9], [signX + 12, signY + 2.2, 9], [signX + 12, signY + 2.2, 22], [signX - 12, signY + 2.2, 22]], mixColor(finish.accent, C.ink, .45));
	roomEmblem(a, type, signX, signY + 2.5, 15.5);
	for (const x of [signX - 10, signX + 10]) a.dot(x, signY + 2.6, 20.5, .55, C.pale);
	// A porch light, planter and rain barrel soften the utilitarian structures.
	a.box(entrance + 23, a.height - 4, 4, 4, 3, BLACK, 10);
	a.dot(entrance + 25, a.height, 12, 2.1, C.amber, .85);
	a.dot(entrance + 25, a.height, 12, 4.6, C.amber, .1);
	a.box(a.width - 22, a.height - 7, 12, 7, 6, [0xb39362, 0x8e6947, 0x715440]);
	for (let i = 0; i < 5; i++) {
		const x = a.width - 20 + i * 2;
		a.line([x, a.height - 4, 5], [x - 1, a.height - 4, 11 + i % 3], 0x6d8951, .9);
		a.dot(x - 1, a.height - 4, 11 + i % 3, 1.7, i % 2 ? 0xacc17a : 0x7e9b59);
	}
	if (type === "workshop" || type === "recycler" || type === "hangar") {
		a.box(a.width - 15, 20, 10, 11, 13, finish.roof);
		a.line([a.width - 15, 31, 3], [a.width - 5, 31, 3], C.pale, .8, .5);
		a.line([a.width - 15, 31, 10], [a.width - 5, 31, 10], C.pale, .8, .5);
	}
}

function hangar(a: RoomPainter): void {
	const cx = a.width / 2, cy = a.height * .52;
	for (let x = 68; x < a.width - 40; x += 80) {
		a.box(x, 6, 5, 5, 29, STEEL);
		a.line([x, 11, 23], [x + 27, 11, 32], C.pale, .9, .65);
	}
	for (let x = 28; x < a.width - 40; x += 48) {
		a.box(x, 18, 38, 20, 12, STEEL);
		a.crate(x + 4, 22, 25, 15, 12, 12);
	}
	// A wheeled transport under a gantry: large equipment has a real large footprint.
	a.shadow(cx - 56, cy - 24, 112, 52);
	for (const x of [cx - 48, cx + 30]) for (const y of [cy - 27, cy + 20]) a.box(x, y, 20, 9, 11, BLACK);
	a.box(cx - 58, cy - 22, 111, 43, 14, OLIVE, 6);
	a.box(cx - 49, cy - 18, 31, 35, 14, STEEL, 20);
	a.plane(cx - 45, cy - 14, 23, 25, 34.2, 0x91b0a6);
	a.face([[cx - 47, cy + 17.2, 24], [cx - 22, cy + 17.2, 24], [cx - 22, cy + 17.2, 32], [cx - 47, cy + 17.2, 32]], 0xa8c8c1);
	a.line([cx - 33, cy + 17.5, 24], [cx - 33, cy + 17.5, 32], C.pale, .8);
	a.line([cx - 43, cy + 17.5, 23], [cx - 37, cy + 17.5, 23], C.ink, .8);
	a.box(cx - 10, cy - 17, 55, 32, 4, WOOD, 20);
	for (const y of [cy - 18, cy + 12]) a.line([cx - 8, y, 27], [cx + 44, y, 27], C.wood, 1.4);
	for (let x = cx - 6; x < cx + 45; x += 12) a.line([x, cy + 12, 20], [x, cy + 12, 27], C.wood, 1.4);
	for (const x of [cx - 48, cx + 31]) {
		const wheel = a.p(x + 10, cy + 27, 10);
		a.g.fillStyle(C.ink).fillEllipse(wheel.x, wheel.y, 11, 12);
		a.g.fillStyle(C.steel).fillEllipse(wheel.x, wheel.y, 5, 6);
		a.g.fillStyle(C.ink).fillCircle(wheel.x, wheel.y, 1.2);
	}
	for (const x of [cx - 49, cx - 27]) a.dot(x, cy + 21.2, 17, 1.7, C.amber);
	for (const x of [cx - 75, cx + 69]) { a.box(x, cy - 37, 7, 76, 35, STEEL); a.box(x - 8, cy + 32, 22, 10, 5, BLACK); }
	a.box(cx - 75, cy - 37, 151, 7, 6, STEEL, 35);
	for (let x = cx - 70; x < cx + 66; x += 17) a.line([x, cy - 30, 36], [x + 9, cy - 30, 40], C.amber, 2, .7);
	a.box(cx - 7, cy - 34, 14, 10, 8, BLACK, 31);
	a.line([cx, cy - 34, 39], [cx, cy - 34, 18], C.amber, 1.4);
	a.line([cx, cy - 34, 18], [cx + 5, cy - 34, 15], C.amber, 1.3);
	a.line([cx + 5, cy - 34, 15], [cx + 8, cy - 34, 18], C.amber, 1.3);
	for (let x = 16; x < a.width - 12; x += 18) a.line([x, a.height - 23, .8], [x + 9, a.height - 23, .8], C.amber, 2, .6);
	a.table(a.width - 64, a.height - 70, 43, 24, 14, WOOD);
}

/** Empty lots share the continuous landscape; they have no visible tile of their own. */
export function paintIsometricLand(_g: Phaser.GameObjects.Graphics, _column: number, _row: number, _owned: boolean): void {}

function workshop(a: RoomPainter): void {
	a.table(20, 24, 64, 25, 14, WOOD);
	a.box(23, 26, 12, 11, 7, STEEL, 14);
	a.box(33, 28, 3, 8, 4, BLACK, 19);
	a.line([30, 38, 17], [30, 45, 17], C.steel, 1.1);
	a.box(101, 24, 48, 24, 12, OLIVE);
	a.box(104, 27, 7, 17, 11, STEEL, 12);
	a.box(143, 27, 5, 17, 9, STEEL, 12);
	a.box(113, 32, 30, 7, 3, BLACK, 14);
	a.line([112, 35, 19], [145, 35, 19], C.steel, 2.4);
	a.dot(149, 37, 9, 3, C.ink);
	a.dot(149, 37, 9, 2, C.steel);
	for (let i = 0; i < 4; i++) a.line([112 + i * 8, 48, 4], [112 + i * 8, 48, 9], C.ink, 1.1);
	a.crate(22, 69, 30, 17, 9);
	a.box(117, 66, 31, 17, 14, STEEL);
	for (const h of [4, 8, 12]) { a.line([119, 83, h], [146, 83, h], C.ink); a.line([129, 83.2, h - 1], [136, 83.2, h - 1], C.pale); }
	a.line([49, 32, 14.6], [66, 32, 14.6], C.pale, 1);
	a.line([60, 29, 14.6], [64, 37, 14.6], C.amber, 1.2);
}

function ammo(a: RoomPainter): void {
	a.table(20, 27, 28, 28);
	a.box(23, 31, 20, 17, 3, BLACK, 14);
	a.box(25, 32, 4, 14, 15, STEEL, 17);
	a.box(25, 32, 17, 5, 3, STEEL, 29);
	a.line([39, 37, 30], [48, 38, 22], C.amber, 1.6);
	a.table(62, 30, 87, 19);
	a.box(64, 32, 82, 14, 2, BLACK, 14);
	for (let x = 68; x < 145; x += 8) a.line([x, 32, 16.1], [x, 46, 16.1], C.steel, .7, .45);
	a.box(116, 65, 30, 18, 7, WOOD);
	a.plane(119, 68, 24, 12, 7.2, C.ink);
	a.crate(22, 73, 31, 16, 11);
	for (let x = 26; x < 47; x += 7) a.dot(x, 77, 11.2, 1.2, C.amber);
}

function recycler(a: RoomPainter): void {
	a.shadow(20, 21, 35, 33);
	a.box(20, 21, 35, 33, 21, OLIVE);
	a.box(23, 24, 29, 22, 3, STEEL, 21);
	a.plane(26, 26, 23, 17, 24.1, C.ink);
	for (let x = 28; x < 48; x += 5) a.line([x, 28, 24.4], [x + 5, 40, 24.4], C.steel, 1.1);
	a.table(57, 32, 86, 22, 12);
	a.box(57, 34, 84, 16, 2, BLACK, 12);
	for (let x = 61; x < 139; x += 9) a.line([x, 34, 14.1], [x, 50, 14.1], C.steel, 1.2, .5);
	a.crate(111, 68, 34, 18, 11);
	a.plane(115, 72, 26, 10, 11.2, C.ink);
	for (const [x, y, h] of [[23, 70, 7], [38, 79, 5], [51, 68, 10]]) {
		a.box(x!, y!, 13, 11, h!, STEEL);
		a.line([x! + 2, y! + 2, h! + .2], [x! + 10, y! + 8, h! + .2], C.ink, 1.1);
	}
}

function medbay(a: RoomPainter): void {
	a.table(20, 30, 67, 29, 11, PALE);
	a.box(23, 33, 61, 23, 3, [0x9cb89a, 0x738f77, 0x58745e], 11);
	a.box(26, 34, 14, 20, 2, PALE, 14);
	for (const x of [20, 87]) { a.line([x, 30, 10], [x, 30, 19], C.pale, 1.4); a.line([x, 30, 19], [x, 58, 19], C.steel, 1.3); }
	a.box(102, 20, 22, 21, 19, PALE);
	a.monitor(104, 24, 18, 10, 19);
	a.line([109, 41.2, 8], [118, 41.2, 8], C.pale, 1.6);
	a.line([113.5, 41.2, 4], [113.5, 41.2, 12], C.pale, 1.6);
	a.table(107, 60, 39, 20, 15, PALE);
	a.box(22, 76, 21, 13, 8, PALE);
	a.line([27, 89.1, 4], [37, 89.1, 4], 0x6c9c7d, 1.6);
	a.line([32, 89.1, 1], [32, 89.1, 7], 0x6c9c7d, 1.6);
	a.line([94, 53, 0], [94, 53, 28], C.steel, 1.1);
	a.line([94, 53, 28], [99, 53, 28], C.steel, .9);
	a.box(97, 52, 4, 4, 7, [0xb4cab1, 0x8aa68e, 0x688e74], 17);
}

function radio(a: RoomPainter): void {
	a.table(20, 27, 86, 29, 15, WOOD);
	a.monitor(28, 31, 32, 15, 15);
	a.box(69, 32, 29, 13, 9, OLIVE, 15);
	for (let x = 72; x < 94; x += 4) a.line([x, 45.2, 17], [x, 45.2, 21], C.ink, .8);
	a.dot(91, 45.4, 22, 1.8, C.steel);
	a.plane(36, 46, 24, 7, 15.2, C.dark);
	for (let i = 0; i < 4; i++) a.line([38, 47 + i * 1.4, 15.4], [57, 47 + i * 1.4, 15.4], C.steel, .5, .65);
	a.box(123, 23, 24, 25, 27, STEEL);
	for (const z of [5, 12, 19, 25]) {
		a.line([126, 48.2, z], [143, 48.2, z], C.ink, 1.3);
		a.dot(144, 48.3, z, .65, C.cyan);
	}
	a.table(42, 72, 23, 18, 7, OLIVE);
	a.line([44, 73, 7], [44, 73, 18], C.steel, 1.4);
	a.line([44, 73, 18], [65, 73, 18], C.steel, 1.2);
	a.box(121, 70, 26, 14, 6, OLIVE);
	a.line([134, 77, 6], [134, 77, 34], C.steel, 1.2);
	a.line([121, 77, 29], [147, 77, 29], C.steel, .9);
	a.line([126, 77, 32], [143, 77, 32], C.steel, .8);
}

function storage(a: RoomPainter): void {
	a.shadow(20, 19, 89, 24);
	for (const z of [2, 15, 28]) a.box(20, 19, 89, 22, 1.8, STEEL, z);
	for (const x of [20, 63, 106]) for (const y of [19, 39]) a.box(x, y, 2, 2, 30, BLACK);
	a.crate(24, 21, 28, 16, 10, 3.8);
	a.crate(70, 22, 29, 15, 10, 3.8);
	a.crate(25, 22, 25, 15, 10, 16.8);
	a.box(71, 23, 24, 13, 9, OLIVE, 16.8);
	a.line([72, 29, 26], [94, 29, 26], C.pale, 1.3);
	a.crate(120, 30, 25, 23, 13);
	a.crate(122, 32, 21, 19, 11, 13);
	a.crate(24, 67, 35, 20, 13);
	a.box(80, 67, 27, 20, 10, OLIVE);
	a.line([86, 67, 10.2], [86, 87, 10.2], C.steel, 1.5);
	a.line([99, 67, 10.2], [99, 87, 10.2], C.steel, 1.5);
	a.box(125, 71, 19, 15, 8, PALE);
}

function dormitory(a: RoomPainter): void {
	for (const [x, y] of [[21, 24], [92, 58]]) {
		a.table(x!, y!, 59, 26, 9, STEEL);
		a.box(x! + 2, y! + 2, 55, 22, 3, [0x8d9f76, 0x657958, 0x4a6347], 9);
		a.box(x! + 4, y! + 3, 12, 20, 2, PALE, 12);
		a.plane(x! + 22, y! + 2, 30, 22, 12.2, 0x617954);
		for (const dx of [0, 59]) { a.line([x! + dx, y!, 8], [x! + dx, y!, 17], C.steel, 1.2); a.line([x! + dx, y!, 17], [x! + dx, y! + 26, 17], C.steel, 1.2); }
	}
	a.box(122, 19, 26, 21, 28, OLIVE);
	a.line([135, 40.2, 2], [135, 40.2, 27], C.ink, .8);
	for (const x of [128, 140]) {
		a.line([x, 40.3, 13], [x, 40.3, 17], C.pale, 1);
		a.line([x - 3, 40.3, 24], [x + 3, 40.3, 24], C.ink, .9);
	}
	a.table(34, 75, 21, 15, 9, WOOD);
	a.box(39, 78, 9, 7, 1, PALE, 9);
	a.dot(49, 82, 10.5, 1.8, C.pale);
}

function construction(a: RoomPainter): void {
	const right = a.width - 24, front = a.height - 25;
	for (const x of [18, right]) for (const y of [19, front]) {
		a.line([x, y, 0], [x, y, 28], C.steel, 1.4);
		a.box(x - 2, y - 2, 4, 4, 1.2, STEEL);
	}
	for (const z of [12, 27]) {
		a.line([18, 19, z], [right, 19, z], C.steel, 1.1);
		a.line([18, 19, z], [18, front, z], C.steel, 1.1);
	}
	for (let x = 18; x < right; x += 60) {
		a.line([x, 19, 2], [Math.min(x + 30, right), 19, 27], C.steel, .8);
		a.line([Math.min(x + 30, right), 19, 27], [Math.min(x + 60, right), 19, 2], C.steel, .8);
	}
	a.plane(21, 15, Math.max(1, right - 23), 10, 12, C.wood);
	for (let i = 0; i < 3; i++) a.box(48 + i * 4, 59 + i * 4, 60, 7, 2, WOOD, i * 2);
	a.crate(119, 47, 22, 19, 10);
	a.box(30, 48, 20, 16, 9, [0x7c8770, 0x596d50, 0x405440]);
	a.line([25, a.height - 15, 3], [right - 3, a.height - 15, 3], C.amber, 2.5);
	for (let x = 28; x < right - 6; x += 11) a.line([x, a.height - 15, 2], [x + 5, a.height - 15, 4], C.ink, 1.3);
}

/** Draw a small cutaway building in the shared projected world space. */
export function paintIsometricRoom(g: Phaser.GameObjects.Graphics, column: number, row: number, room: RoomInstance | null): void {
	if (!room) { paintIsometricLand(g, column, row, true); return; }
	const a = new RoomPainter(g, room);
	const finish = buildingFinish(room.type);
	foundation(a, finish);
	if (room.status === "building") { construction(a); return; }
	walls(a, finish);
	if (a.farWall("south")) frontDetails(a, finish, room.type);
	switch (room.type) {
		case "workshop": workshop(a); break;
		case "ammo": ammo(a); break;
		case "recycler": recycler(a); break;
		case "medbay": medbay(a); break;
		case "radio": radio(a); break;
		case "storage": storage(a); break;
		case "dormitory": dormitory(a); break;
		case "hangar": hangar(a); break;
	}
	roof(a, finish);
	if (!a.farWall("south")) frontDetails(a, finish, room.type);
	if (room.status === "upgrading") construction(a);
}

function moduleProduct(a: RoomPainter, x: number, y: number, z: number, slot: ModuleSlot | null): void {
	if (slot === "barrel" || slot === "muzzle") {
		const length = slot === "barrel" ? 36 : 17;
		a.box(x, y, length, 4, 3, STEEL, z);
		a.box(x + length - 5, y - 1, 5, 6, 4, BLACK, z);
		a.line([x + 2, y + 1, z + 3.2], [x + length - 6, y + 1, z + 3.2], C.pale, .8);
	} else if (slot === "optic") {
		a.box(x + 5, y, 24, 8, 4, BLACK, z);
		a.box(x + 9, y + 2, 16, 4, 7, STEEL, z + 4);
		a.dot(x + 25, y + 4, z + 8, 1.8, C.cyan);
	} else if (slot === "magazine" || slot === "foregrip") {
		a.box(x + 9, y, 14, 11, 4, BLACK, z);
		for (let dx = 12; dx < 22; dx += 3) a.line([x + dx, y + 1, z + 4.2], [x + dx, y + 10, z + 4.2], C.steel, .7);
	} else if (slot === "stock") {
		a.face([[x, y, z + 3], [x + 27, y, z + 3], [x + 35, y + 7, z + 3], [x + 6, y + 12, z + 3]], C.wood);
		a.line([x + 7, y + 4, z + 3.3], [x + 26, y + 3, z + 3.3], C.pale, .7);
	} else {
		a.box(x, y, 35, 9, 4, slot === "handguard" ? WOOD : STEEL, z);
		a.box(x + 29, y + 2, 10, 5, 3, BLACK, z + 1);
		for (let dx = 5; dx < 29; dx += 5) a.line([x + dx, y + 2, z + 4.2], [x + dx, y + 6, z + 4.2], C.ink, .8);
		a.line([x + 2, y + 1, z + 4.2], [x + 32, y + 1, z + 4.2], C.pale, .75);
	}
}

function sparks(a: RoomPainter, x: number, y: number, z: number, time: number): void {
	for (let i = 0; i < 5; i++) {
		const phase = (time / 390 + i * .21) % 1;
		const direction = i % 2 ? 1 : -1;
		a.line([x + direction * phase * (8 + i), y + phase * 8, z - phase * 6], [x + direction * phase * (8 + i) + direction * 2, y + phase * 8, z - phase * 6 - 1.3], i % 2 ? C.amber : C.pale, .75, 1 - phase);
	}
}

function productionIndicator(a: RoomPainter, p: ProductionPresentation, time: number, animate: boolean): void {
	const color = p.completed ? C.green : p.paused ? C.amber : C.cyan;
	a.dot(155, 57, 17, 2.6, C.ink);
	a.dot(155, 57, 17, 1.5, color, .95);
	if (animate) a.dot(155, 57, 17, 4.5, color, .08 + (Math.sin(time / 300) + 1) * .04);
	if (p.completed) {
		a.line([151, 61, 23], [154, 61, 20], C.green, 1.3);
		a.line([154, 61, 20], [161, 61, 27], C.green, 1.3);
	}
}

/** Visual progress comes from the engine; a paused station has no moving parts. */
export function paintIsometricProduction(g: Phaser.GameObjects.Graphics, _column: number, _row: number, room: RoomInstance, presentation: ProductionPresentation | null, time: number, reducedMotion: boolean): void {
	if (room.status !== "ready" || !presentation?.jobId) return;
	const a = new RoomPainter(g, room), p = presentation;
	const animate = p.active && !reducedMotion;
	const clock = reducedMotion ? 0 : Math.max(0, time);
	switch (room.type) {
		case "workshop": {
			const assembly = p.stage === "assembly", x = assembly ? 113 : 42, y = assembly ? 33 : 31, z = assembly ? 18 : 14.2;
			moduleProduct(a, x, y, z, p.moduleSlot);
			if (assembly) {
				a.box(111, 30, 4, 13, 6, BLACK, 17);
				a.box(145, 30, 4, 13, 6, STEEL, 17);
				const feed = Math.sin(clock / 330) * 2;
				a.line([122 + feed, 29, 26], [122 + feed, 33, 22], C.pale, 1.3);
				if (animate && clock % 1300 < 780) sparks(a, 122 + feed, 33, 23, clock);
			} else if (p.stage === "inspection") {
				const scan = 43 + (clock / 90) % 35;
				a.line([scan, 28, 20], [scan, 43, 20], C.cyan, .9, .7);
			}
			break;
		}
		case "ammo": {
			const press = animate ? (1 - Math.cos(clock / 190)) * 3 : 0;
			a.box(31, 37, 7, 7, 5, STEEL, 19 - press);
			if (p.stage !== "preparation") for (let i = 0; i < 7; i++) {
				const x = 68 + (clock / 95 + i * 10) % 73;
				a.box(x, 38, 2.2, 2.2, 5, [C.amber, 0xa58651, 0x77623b], 16);
				a.dot(x + 1, 39, 21.7, .8, C.pale);
			}
			for (let i = 0; i < Math.floor(p.progress * Math.min(12, p.quantity)); i++) a.box(120 + i % 6 * 3.5, 69 + Math.floor(i / 6) * 5, 2, 2, 4, [C.amber, 0xa58651, 0x77623b], 7.4);
			break;
		}
		case "recycler": {
			for (let i = 0; i < 5; i++) {
				const travel = (clock / 2900 + i * .21) % 1;
				a.box(63 + travel * 70, 38 + i % 2 * 4, 5, 4, 2.5, i % 2 ? STEEL : BLACK, 14.2);
			}
			if (animate && p.stage === "assembly") sparks(a, 42, 37, 24, clock);
			for (let i = 0; i < Math.floor(p.progress * Math.min(6, p.quantity)); i++) a.box(116 + i % 3 * 7, 73 + Math.floor(i / 3) * 5, 5, 3, 2, STEEL, 11.4);
			break;
		}
		case "medbay": {
			const trace: Vertex[] = [[106, 29.3, 24], [109, 29.3, 24], [111, 29.3, 26.5], [113, 29.3, 22], [115, 29.3, 25], [118, 29.3, 24]];
			for (let i = 1; i < trace.length; i++) a.line(trace[i - 1]!, trace[i]!, C.green, .65);
			const count = p.stage === "preparation" ? 1 : p.stage === "assembly" ? 2 : 3;
			for (let i = 0; i < count; i++) {
				a.box(113 + i * 9, 66, 5, 5, 7, [0xb0ccac, 0x80ae8d, 0x5f9079], 15);
				a.box(114 + i * 9, 67, 3, 3, 1.5, PALE, 22);
			}
			if (animate && p.stage === "assembly") a.dot(117, 69, 27 - clock / 370 % 1 * 4, .85, C.cyan);
			break;
		}
		case "radio": {
			const center = a.p(44, 36.2, 24);
			a.g.lineStyle(.5, C.green, .6).strokeEllipse(center.x, center.y, 12, 8);
			const angle = clock / 900;
			a.g.lineStyle(.8, C.green, .9).lineBetween(center.x, center.y, center.x + Math.cos(angle) * 5.5, center.y + Math.sin(angle) * 3.5);
			for (let i = 0; i < 3; i++) a.dot(127 + i * 6, 48.3, 25, .65, C.cyan, animate ? .4 + (Math.sin(clock / 230 + i) + 1) * .3 : .6);
			a.plane(77, 45, 19, 9, 15.3, C.pale);
			for (let i = 0; i < Math.max(1, Math.floor(p.progress * 4)); i++) a.line([79, 47 + i * 1.5, 15.5], [93 - i % 2 * 3, 47 + i * 1.5, 15.5], C.dark, .5);
			break;
		}
		case "storage": case "dormitory": break;
	}
	productionIndicator(a, p, clock, animate);
}
