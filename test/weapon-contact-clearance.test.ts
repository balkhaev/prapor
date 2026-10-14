import { describe, expect, test } from "bun:test";
import { weaponActorArt, weaponBuildArt } from "../src/armory-art";
import { getWeaponBuildIssues, type WeaponInstance } from "../src/game/engine";
import { FACTORY_KITS, MODULE_MODELS, RECEIVER_INFO, type ModuleModel, type ModuleSlot } from "../src/game/modules";

const factory = (weaponId: string): WeaponInstance => ({ id: "compact-contact", weaponId, durability: 100, foundAt: 0, attachments: { optic: 0, magazine: 0, stock: 0 }, modules: Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId]) => [slot, { id: slot, modelId, durability: 100, foundAt: 0 }])) });
const install = (weapon: WeaponInstance, model: ModuleModel) => { weapon.modules[model.slot] = { id: model.slot, modelId: model.id, durability: 100, foundAt: 0 }; };
function part(svg: string, slot: ModuleSlot) {
	const start = svg.indexOf(`<g data-module-slot="${slot}"`), tags = /<g\b[^>]*>|<\/g>/g;
	if (start < 0) throw new Error(`Missing ${slot}`);
	tags.lastIndex = start; let depth = 0;
	for (let tag = tags.exec(svg); tag; tag = tags.exec(svg)) {
		depth += tag[0].startsWith("</") ? -1 : 1;
		if (!depth) return svg.slice(start, tags.lastIndex);
	}
	throw new Error(`Unclosed ${slot}`);
}

type Point = [number, number];
// Sample emitted curves and follow actual relative coordinates. Declared
// renderer bounds cannot reveal a handle that cuts into the action or feed.
function contours(path: string): Point[][] {
	const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g)!;
	const result: Point[][] = []; let points: Point[] = [];
	let index = 0, x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, command = "", previous = "";
	const next = () => Number(tokens[index++]!);
	const add = (nx: number, ny: number) => { x = nx; y = ny; points.push([x, y]); };
	while (index < tokens.length) {
		if (/^[a-zA-Z]$/.test(tokens[index]!)) command = tokens[index++]!;
		const relative = command === command.toLowerCase(), cmd = command.toUpperCase(), ox = x, oy = y;
		const pair = (): Point => [next() + (relative ? ox : 0), next() + (relative ? oy : 0)];
		if (cmd === "Z") { add(sx, sy); result.push(points); points = []; command = ""; previous = cmd; continue; }
		if (cmd === "M" || cmd === "L") {
			const [nx, ny] = pair();
			if (cmd === "M") { if (points.length) result.push(points); points = []; sx = nx; sy = ny; command = relative ? "l" : "L"; }
			add(nx, ny);
		} else if (cmd === "H") add(next() + (relative ? ox : 0), y);
		else if (cmd === "V") add(x, next() + (relative ? oy : 0));
		else if (cmd === "Q" || cmd === "T") {
			const control: Point = cmd === "Q" ? pair() : [previous === "Q" || previous === "T" ? 2 * ox - cx : ox, previous === "Q" || previous === "T" ? 2 * oy - cy : oy];
			const [nx, ny] = pair(); [cx, cy] = control;
			for (let sample = 1; sample <= 24; sample++) { const t = sample / 24, u = 1 - t; points.push([u * u * ox + 2 * u * t * cx + t * t * nx, u * u * oy + 2 * u * t * cy + t * t * ny]); }
			x = nx; y = ny;
		} else throw new Error(`Unexpected compact outline command ${command}`);
		previous = cmd;
	}
	if (points.length) result.push(points);
	return result;
}
function contains(polygon: Point[], x: number, y: number) {
	let inside = false;
	for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
		const [xi, yi] = polygon[index]!, [xj, yj] = polygon[previous]!;
		if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}
function outline(group: string) {
	const [dx = 0, dy = 0] = group.match(/transform="translate\((-?[\d.]+) (-?[\d.]+)\)"/)?.slice(1).map(Number) ?? [0, 0];
	return contours(group.match(/<path d="([^"]+)"/)![1]!).map((polygon) => polygon.map(([x, y]) => [x + dx, y + dy] as Point));
}
const filled = (polygons: Point[][], x: number, y: number) => polygons.filter((polygon) => contains(polygon, x, y)).length % 2 === 1;
const variants = (id: string, slot: ModuleSlot) => MODULE_MODELS.filter((model) => model.slot === slot && (model.id === FACTORY_KITS[id]![slot] || !model.weaponId && model.platforms.includes(RECEIVER_INFO[id]!.platform) && model.calibers.includes(RECEIVER_INFO[id]!.caliber)));

describe("physical weapon contacts and clearances", () => {
	test("TRG and AWM bolt knobs clear the trigger opening, and window ticks stay inside their glass", () => {
		for(const id of ["trg42","awm"]) {
			const art=weaponActorArt(factory(id)), receiver=part(art.svg,"receiver");
			const bow=contours(receiver.match(/data-mechanism="trigger-guard" d="([^"]+)"/)![1]!).flat(), knob=receiver.match(/data-mechanism="bolt-handle-knob" cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/)!;
			expect(Number(knob[2])+Number(knob[3]),`${id} bolt knob above trigger bow`).toBeLessThan(Math.min(...bow.map(([,y])=>y))-1);
			const gun=factory(id), model=variants(id,"magazine").find(feed=>feed.appearance==="window")!; install(gun,model);
			const feed=part(weaponActorArt(gun).svg,"magazine"), window=contours(feed.match(/<path d="([^"]+)" fill="#172b29"/)![1]!);
			for(const match of feed.matchAll(/<path d="([^"]+)" fill="#b39f69"/g)) for(const [x,y] of contours(match[1]!)[0]!) expect(filled(window,x,y),`${id} visible cartridge inside window`).toBe(true);
		}
	});
	test("G36 and ASH12 grip shells leave the trigger window open", () => {
		for (const id of ["g36","ash12"]) {
			const art = weaponActorArt(factory(id)), group = part(art.svg,"receiver"), body = outline(group);
			const bow = contours(group.match(/data-mechanism="trigger-guard" d="([^"]+)"/)![1]!).flat();
			const left = Math.min(...bow.map(([x])=>x)), right = Math.max(...bow.map(([x])=>x)), top = Math.min(...bow.map(([,y])=>y)), bottom = Math.max(...bow.map(([,y])=>y));
			for(let y=top+4;y<bottom-3;y+=1) for(let x=left+3;x<right-3;x+=1) if(filled([bow],x,y)) expect(filled(body,x,y),`${id} open trigger window ${x},${y}`).toBe(false);
		}
	});
	test("AR and G36 curved feeds stay outside the open trigger bow", () => {
		for (const id of ["m4a1", "hk416", "mcx", "g36"]) for (const feed of variants(id, "magazine").filter(model => model.appearance !== "drum")) {
			const gun = factory(id); install(gun,feed);
			const art = weaponActorArt(gun), receiver = part(art.svg,"receiver"), magazine = outline(part(art.svg,"magazine"));
			const bow = contours(receiver.match(/data-mechanism="trigger-guard" d="([^"]+)"/)![1]!).flat();
			const left = Math.min(...bow.map(([x])=>x)), right = Math.max(...bow.map(([x])=>x)), top = Math.min(...bow.map(([,y])=>y)), bottom = Math.max(...bow.map(([,y])=>y));
			for (let y=top+2;y<bottom-1;y+=1) for(let x=right-11;x<right+.3;x+=.5) expect(filled(magazine,x,y),`${id}/${feed.id} trigger opening ${x},${y}`).toBe(false);
			expect(left).toBeLessThan(right);
		}
	});
	test("every modern buttpad follows and contacts its actual stock heel", () => {
		for (const id of ["m4a1", "hk416", "mcx", "scarh", "trg42", "g36", "fal", "sr25", "awm"]) for (const stock of variants(id, "stock")) {
			const gun = factory(id); install(gun, stock);
			const group = part(weaponActorArt(gun).svg, "stock"), body = outline(group);
			const pad = contours(group.match(/data-hardware="stock-buttpad" d="([^"]+)"/)![1]!)[0]!;
			const [topX, topY] = pad[1]!, [bottomX, bottomY] = pad[2]!;
			for (const t of [.15, .35, .55, .75, .9]) expect(filled(body, topX + (bottomX - topX) * t - 1, topY + (bottomY - topY) * t), `${id}/${stock.id} heel contact at ${t}`).toBe(true);
		}
	});
	test("SCAR magazine mouth is seated across its full drawn receiver socket", () => {
		for (const feed of variants("scarh", "magazine")) {
			const gun = factory("scarh"); install(gun, feed);
			const art = weaponActorArt(gun), receiver = outline(part(art.svg, "receiver")), neck = outline(part(art.svg, "magazine"))[0]!;
			const [left, top] = neck[0]!, [right] = neck[1]!;
			for (let x = left + 2; x < right - 2; x += 2) expect(filled(receiver, x, top + 2), `${feed.id} feed mouth ${x}`).toBe(true);
		}
	});
	test("light AR, FAL and VAL fore-ends have opaque ferrules across the gap beside the action", () => {
		for (const id of ["m4a1", "hk416", "fal", "sr25", "vss", "asval"]) {
			const gun = factory(id), guard = variants(id, "handguard").find(model => model.appearance === "light")!; install(gun, guard);
			const art = weaponActorArt(gun), receiver = outline(part(art.svg, "receiver"))[0]!, group = part(art.svg, "handguard"), foreEnd = outline(group)[0]!;
			const solid = [...group.matchAll(/<path\b([^>]*)>/g)].flatMap(([, attributes]) => /\bfill="/.test(attributes!) && !/\bfill="none"/.test(attributes!) ? [contours(attributes!.match(/\bd="([^"]+)"/)![1]!)] : []);
			const intersections = (polygon: Point[], y: number) => polygon.flatMap(([x1,y1], index) => { const [x2,y2] = polygon[(index + 1) % polygon.length]!; return y1 !== y2 && y > Math.min(y1,y2) && y < Math.max(y1,y2) ? [x1 + (y-y1) * (x2-x1) / (y2-y1)] : []; });
			for (let y = 125.25; y < 171; y += 2) {
				const action = intersections(receiver,y), guardEdge = intersections(foreEnd,y); if (!action.length || !guardEdge.length) continue;
				const actionEnd = Math.max(...action), guardStart = Math.min(...guardEdge);
				for (let x = actionEnd + .2; x < guardStart; x += .5) expect(solid.some(polygons => filled(polygons,x,y)), `${id} rear fore-end seam ${x},${y}`).toBe(true);
			}
		}
	});
	test("modern quick-pull loops have both ends seated in the drawn floorplate", () => {
		for (const id of ["m4a1", "hk416", "mcx", "scarh", "trg42", "g36", "aug", "fal", "sr25", "ash12", "awm"]) {
			const gun = factory(id), feed = variants(id, "magazine").find(model => model.appearance === "quick")!;
			install(gun, feed);
			const magazine = part(weaponActorArt(gun).svg, "magazine");
			const paths = [...magazine.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(match => match[1]!);
			const plate = contours(paths.find(path => /v7l-[-\d.]+ 3z$/.test(path))!), loop = contours(paths.find(path => /v13h20v-13$/.test(path))!)[0]!;
			for (const [x, y] of [loop[0]!, loop.at(-1)!]) expect(filled(plate, x, y), `${id}/${feed.id} pull strap attachment`).toBe(true);
		}
	});
	test("Vector, UMP, AUG and ASH12 handles clear the action, trigger window and every magazine while their shoes remain supported", () => {
		const collisions: string[] = []; let cases = 0;
		for (const id of ["vector", "ump45", "aug", "ash12"]) {
			for (const guard of variants(id, "handguard").filter((model) => model.providesMounts.includes("rail-bottom"))) {
				for (const feed of variants(id, "magazine")) for (const grip of MODULE_MODELS.filter((model) => model.slot === "foregrip")) {
					const gun = factory(id); install(gun, guard); install(gun, feed); install(gun, grip);
					expect(getWeaponBuildIssues(gun), `${id}/${guard.id}/${feed.id}/${grip.id}`).toEqual([]);
					const actor = weaponActorArt(gun), group = part(actor.svg, "foregrip"), bench = weaponBuildArt(gun);
						expect(group).toContain(["aug", "ash12"].includes(id) ? `data-reference-mechanism="${id}-forward-support-grip"` : `data-mechanism="${id}-compact-foregrip-shoe"`);
					expect(group).toBe(part(bench, "foregrip"));
					const handle = outline(group), receiver = outline(part(actor.svg, "receiver")), magazine = outline(part(actor.svg, "magazine"));
					const shoe = handle[0]!, left = Math.min(...shoe.map(([x]) => x)), right = Math.max(...shoe.map(([x]) => x));
					const top = Math.min(...shoe.map(([, y]) => y)), bottom = Math.max(...shoe.map(([, y]) => y));
					const rails = [...part(actor.svg, "handguard").matchAll(/<path d="M(-?[\d.]+) (-?[\d.]+)h([\d.]+)v6H[-\d.]+z"/g)].map((match) => [Number(match[1]), Number(match[2]), Number(match[1]) + Number(match[3]), Number(match[2]) + 6]);
					expect(rails.some(([x = 0, y = 0, end = 0, lower = 0]) => left >= x && right <= end && bottom >= y && top <= lower)).toBe(true);
					const points = handle.flat(), maxX = Math.max(...points.map(([x]) => x)), maxY = Math.max(...points.map(([, y]) => y));
					let collision: Point | undefined;
					for (let y = bottom + .4; y < maxY && !collision; y += .8) for (let x = left + .4; x < maxX && !collision; x += .8) {
						if (filled(handle, x, y) && (filled(receiver, x, y) || filled(magazine, x, y))) collision = [x, y];
					}
					if (collision) collisions.push(`${id}/${guard.id}/${feed.id}/${grip.id} intersects action/feed at ${collision.map((value) => value.toFixed(1)).join(",")}`);
					cases++;
				}
			}
		}
		expect(cases).toBeGreaterThanOrEqual(240);
		expect(collisions).toEqual([]);
	});
});
