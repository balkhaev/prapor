import type Phaser from "phaser";
import type { ModuleSlot } from "./game/modules";
import { ROOM_DEFINITIONS, type RoomInstance } from "./game/shelter";
import { projectShelterPoint, shelterRoomPosition } from "./shelter-isometric";
import type { ProductionPresentation } from "./shelter-production";

type Point = { x: number; y: number };
type Vertex = readonly [number, number, number?];
type Material = readonly [number, number, number];
const C = {
	ink: 0x142720, seam: 0x243c30, concrete: 0x52624a, floor: 0x40573e,
	steel: 0x879c82, pale: 0xc7cfad, amber: 0xdfb674, cyan: 0x85bdac,
	green: 0xafca7b, wood: 0x9b8055, dark: 0x2e4536,
};
const STEEL: Material = [0x82927a, 0x516550, 0x364b39];
const OLIVE: Material = [0x6a7d58, 0x475e41, 0x314936];
const WOOD: Material = [0x9b8055, 0x715a39, 0x58472e];
const PALE: Material = [0xc0c6a8, 0x8d9d83, 0x5e7560];
const BLACK: Material = [0x344d3a, 0x233c2c, 0x193224];

/** Equipment remains upright: the affine projection applies only to the floor. */
class RoomPainter {
	private readonly origin: Point;
	constructor(readonly g: Phaser.GameObjects.Graphics, column: number, row: number) {
		this.origin = shelterRoomPosition(column, row);
	}
	p(x: number, y: number, z = 0): Point {
		const point = projectShelterPoint({ x: this.origin.x + x, y: this.origin.y + y });
		return { x: point.x, y: point.y - z };
	}
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
		this.face([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]], material[2]);
		this.face([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]], material[1]);
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

function foundation(a: RoomPainter, occupied: boolean): void {
	a.box(0, 0, 172, 100, 5, [C.floor, 0x293d2d, 0x203528], -5);
	for (let x = 4; x < 168; x += 24) for (let y = 4; y < 97; y += 23) {
		const w = Math.min(23.4, 168 - x), d = Math.min(22.4, 97 - y);
		a.plane(x, y, w, d, .15, (Math.floor(x / 24) + Math.floor(y / 23)) % 2 ? 0x40583e : 0x465d43, occupied ? 1 : .58);
	}
	a.line([0, 100, .3], [172, 100, .3], 0x8d9b71, 1.2, .6);
	a.line([172, 0, .3], [172, 100, .3], 0x71825e, 1.2, .6);
	for (const [x, y] of [[7, 92], [164, 92], [164, 7]]) {
		a.dot(x!, y!, .5, 1.5, C.ink);
		a.line([x! - 1, y!, .5], [x! + 1, y!, .5], C.steel, .6, .7);
	}
}

function walls(a: RoomPainter, accent: number): void {
	// Rear walls are deliberately cut low so every neighbouring room stays readable.
	a.box(0, 0, 172, 4, 22, [0x839272, 0x52684c, 0x3c533b]);
	a.box(0, 4, 4, 96, 22, [0x839272, 0x4c6044, 0x42583e]);
	for (const height of [6, 14]) {
		a.line([4, 4.2, height], [171, 4.2, height], 0x344c36, .65, .65);
		a.line([4.2, 4, height], [4.2, 99, height], 0x344c36, .65, .65);
	}
	for (let x = 23; x < 171; x += 29) a.line([x, 4.2, 6], [x, 4.2, 14], 0x344c36, .6, .45);
	for (let y = 20; y < 98; y += 27) a.line([4.2, y, 6], [4.2, y, 14], 0x344c36, .6, .45);
	a.line([9, 5, 18], [164, 5, 18], accent, 1.4, .5);
	a.line([5, 9, 18], [5, 91, 18], accent, 1.3, .35);
	for (const x of [29, 119]) {
		a.line([x, 5, 20], [x + 20, 5, 20], C.ink, 3);
		a.line([x + 2, 5, 20], [x + 18, 5, 20], C.pale, 1.7, .95);
	}
	a.box(8, 8, 8, 8, 12, BLACK);
	a.line([10, 16, 8], [14, 16, 8], accent, 1.2, .75);
}

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
	for (const x of [18, 148]) for (const y of [19, 75]) {
		a.line([x, y, 0], [x, y, 28], C.steel, 1.4);
		a.box(x - 2, y - 2, 4, 4, 1.2, STEEL);
	}
	for (const z of [12, 27]) {
		a.line([18, 19, z], [148, 19, z], C.steel, 1.1);
		a.line([18, 19, z], [18, 75, z], C.steel, 1.1);
	}
	a.line([18, 19, 2], [72, 19, 27], C.steel, .8);
	a.line([72, 19, 27], [148, 19, 2], C.steel, .8);
	a.plane(21, 15, 125, 10, 12, C.wood);
	for (let i = 0; i < 3; i++) a.box(48 + i * 4, 59 + i * 4, 60, 7, 2, WOOD, i * 2);
	a.crate(119, 47, 22, 19, 10);
	a.box(30, 48, 20, 16, 9, [0x7c8770, 0x596d50, 0x405440]);
	a.line([25, 85, 3], [145, 85, 3], C.amber, 2.5);
	for (let x = 28; x < 142; x += 11) a.line([x, 85, 2], [x + 5, 85, 4], C.ink, 1.3);
}

/** Draw one cutaway bunker cell; all output is in the shared projected world space. */
export function paintIsometricRoom(g: Phaser.GameObjects.Graphics, column: number, row: number, room: RoomInstance | null): void {
	const a = new RoomPainter(g, column, row);
	foundation(a, Boolean(room));
	if (!room) {
		for (const x of [23, 147]) for (const y of [22, 77]) a.line([x, y, .8], [x + 7, y, .8], C.steel, .8, .35);
		return;
	}
	walls(a, Number.parseInt(ROOM_DEFINITIONS[room.type].color.slice(1), 16));
	if (room.status === "building") { construction(a); return; }
	switch (room.type) {
		case "workshop": workshop(a); break;
		case "ammo": ammo(a); break;
		case "recycler": recycler(a); break;
		case "medbay": medbay(a); break;
		case "radio": radio(a); break;
		case "storage": storage(a); break;
		case "dormitory": dormitory(a); break;
	}
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
export function paintIsometricProduction(g: Phaser.GameObjects.Graphics, column: number, row: number, room: RoomInstance, presentation: ProductionPresentation | null, time: number, reducedMotion: boolean): void {
	if (room.status !== "ready" || !presentation?.jobId) return;
	const a = new RoomPainter(g, column, row), p = presentation;
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
