import { describe, expect, test } from "bun:test";
import { ARMORY_SLOT_ORDER, moduleArt, weaponActorArt, weaponBuildArt } from "../src/armory-art";
import { WEAPONS } from "../src/game/data";
import { getWeaponBuildIssues, type WeaponInstance } from "../src/game/engine";
import { FACTORY_KITS, getResolvedModuleMounts, MODULE_BY_ID, MODULE_MODELS, MODULE_SLOTS, RECEIVER_INFO, type ModuleModel, type ModuleSlot } from "../src/game/modules";

const factory = (weaponId: string): WeaponInstance => ({ id: "profile-audit", weaponId, durability: 100, foundAt: 0, attachments: { optic: 0, magazine: 0, stock: 0 }, modules: Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId]) => [slot, { id: slot, modelId, durability: 100, foundAt: 0 }])) });
const install = (gun: WeaponInstance, id: string) => { const model = MODULE_BY_ID[id]!; gun.modules[model.slot] = { id: model.slot, modelId: id, durability: 100, foundAt: 0 }; };
const part = (svg: string, slot: ModuleSlot) => {
	const opening = svg.indexOf(`<g data-module-slot="${slot}"`);
	if (opening < 0) return undefined;
	const tags = /<g\b[^>]*>|<\/g>/g;
	tags.lastIndex = opening;
	let depth = 0;
	for (let tag = tags.exec(svg); tag; tag = tags.exec(svg)) {
		depth += tag[0].startsWith("</") ? -1 : 1;
		if (depth === 0) return svg.slice(opening, tags.lastIndex);
	}
	throw new Error(`Unclosed part group: ${slot}`);
};
const viewport = (svg: string) => svg.match(/viewBox="([^"]+)"/)![1]!.split(" ").map(Number);
const offset = (group: string) => group.match(/transform="translate\((-?[\d.]+) (-?[\d.]+)\)"/)?.slice(1).map(Number) ?? [0, 0];
const outline = (svg: string) => svg.match(/<path d="([^"]+)"/)![1]!;

function gunFor(model: ModuleModel) {
	const definition = model.weaponId ? WEAPONS.find((item) => item.id === model.weaponId)! : WEAPONS.find((item) => {
		const info = RECEIVER_INFO[item.id]!;
		return item.category !== "pistol" && (model.platforms.includes("*") || model.platforms.includes(info.platform)) && (model.calibers.includes("*") || model.calibers.includes(info.caliber)) && (model.requiresMount !== "dovetail" || MODULE_BY_ID[FACTORY_KITS[item.id]!.receiver!]!.providesMounts.includes("dovetail")) && (!model.requiresMount?.startsWith("barrel-clamp") || MODULE_BY_ID[FACTORY_KITS[item.id]!.barrel!]!.providesMounts.includes(model.requiresMount));
	}) ?? WEAPONS.find((item) => (model.platforms.includes("*") || model.platforms.includes(RECEIVER_INFO[item.id]!.platform)) && (model.calibers.includes("*") || model.calibers.includes(RECEIVER_INFO[item.id]!.caliber)))!;
	const gun = factory(definition.id), info = RECEIVER_INFO[definition.id]!;
	if (model.requiresMount?.startsWith("rail-")) install(gun, `handguard-${info.platform}-carbon`);
	if (model.requiresMount?.startsWith("thread:") && !MODULE_BY_ID[gun.modules.barrel!.modelId]!.providesMounts.includes(model.requiresMount)) install(gun, `barrel-${info.platform}-${info.caliber}-long`);
	install(gun, model.id);
	expect(getWeaponBuildIssues(gun)).toEqual([]);
	return gun;
}

// Measure the paths actually emitted, rather than trusting the renderer's own
// declared bounds. Curves are sampled; primitive circles/rectangles are exact.
function pointsForPath(path: string): [number, number][] {
	const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g)!;
	const points: [number, number][] = [];
	let i = 0, x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, command = "", previous = "";
	const number = () => Number(tokens[i++]!);
	const add = (nx: number, ny: number) => { x = nx; y = ny; points.push([x, y]); };
	while (i < tokens.length) {
		if (/^[a-zA-Z]$/.test(tokens[i]!)) command = tokens[i++]!;
		const relative = command === command.toLowerCase(), cmd = command.toUpperCase(), ox = x, oy = y;
		const pair = (): [number, number] => [number() + (relative ? ox : 0), number() + (relative ? oy : 0)];
		if (cmd === "Z") { add(sx, sy); command = ""; previous = cmd; continue; }
		if (cmd === "M" || cmd === "L") { const [nx, ny] = pair(); add(nx, ny); if (cmd === "M") { sx = x; sy = y; command = relative ? "l" : "L"; } }
		else if (cmd === "H") add(number() + (relative ? ox : 0), y);
		else if (cmd === "V") add(x, number() + (relative ? oy : 0));
		else if (cmd === "Q" || cmd === "T") {
			const control: [number, number] = cmd === "Q" ? pair() : [previous === "Q" || previous === "T" ? 2 * ox - cx : ox, previous === "Q" || previous === "T" ? 2 * oy - cy : oy];
			const [nx, ny] = pair(); [cx, cy] = control;
			for (let sample = 1; sample <= 20; sample++) { const t = sample / 20, u = 1 - t; points.push([u * u * ox + 2 * u * t * cx + t * t * nx, u * u * oy + 2 * u * t * cy + t * t * ny]); }
			x = nx; y = ny;
		} else if (cmd === "C" || cmd === "S") {
			const control1: [number, number] = cmd === "C" ? pair() : [previous === "C" || previous === "S" ? 2 * ox - cx : ox, previous === "C" || previous === "S" ? 2 * oy - cy : oy];
			const control2 = pair(), [nx, ny] = pair(); [cx, cy] = control2;
			for (let sample = 1; sample <= 30; sample++) {
				const t = sample / 30, u = 1 - t;
				points.push([u ** 3 * ox + 3 * u * u * t * control1[0] + 3 * u * t * t * cx + t ** 3 * nx, u ** 3 * oy + 3 * u * u * t * control1[1] + 3 * u * t * t * cy + t ** 3 * ny]);
			}
			x = nx; y = ny;
		} else throw new Error(`Unexpected SVG path command ${command} in ${path}`);
		previous = cmd;
	}
	return points;
}

function geometryBounds(group: string) {
	const points = [...group.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].flatMap((match) => pointsForPath(match[1]!));
	for (const match of group.matchAll(/<(circle|rect)\b([^>]+)>/g)) {
		const attributes = Object.fromEntries([...match[2]!.matchAll(/([a-z]+)="(-?[\d.]+)"/g)].map((attribute) => [attribute[1]!, Number(attribute[2]!)]));
		if (match[1] === "circle") { const { cx = 0, cy = 0, r = 0 } = attributes; points.push([cx - r, cy - r], [cx + r, cy + r]); }
		else { const { x = 0, y = 0, width = 0, height = 0 } = attributes; points.push([x, y], [x + width, y + height]); }
	}
	const [dx = 0, dy = 0] = offset(group);
	return [Math.min(...points.map(([x]) => x)) + dx, Math.min(...points.map(([, y]) => y)) + dy, Math.max(...points.map(([x]) => x)) + dx, Math.max(...points.map(([, y]) => y)) + dy];
}

function expectInside(svg: string, label: string) {
	const [left = 0, top = 0, width = 0, height = 0] = viewport(svg);
	for (const slot of MODULE_SLOTS) {
		const group = part(svg, slot); if (!group) continue;
		const [x = 0, y = 0, right = 0, bottom = 0] = geometryBounds(group);
		expect([x, y, right, bottom].every(Number.isFinite), `${label}/${slot} finite coordinates`).toBe(true);
		expect(x, `${label}/${slot} left`).toBeGreaterThanOrEqual(left + 1);
		expect(y, `${label}/${slot} top`).toBeGreaterThanOrEqual(top + 1);
		expect(right, `${label}/${slot} right`).toBeLessThanOrEqual(left + width - 1);
		expect(bottom, `${label}/${slot} bottom`).toBeLessThanOrEqual(top + height - 1);
	}
}

describe("complete weapon side-profile audit", () => {
	test("every factory, compact and long barrel clears its actual slide or fore-end", () => {
		for (const definition of WEAPONS) for (const appearance of ["factory", "short", "long"]) {
			const gun = factory(definition.id), info = RECEIVER_INFO[definition.id]!;
			const barrel = appearance === "factory" ? MODULE_BY_ID[gun.modules.barrel!.modelId]! : MODULE_MODELS.find((model) => model.slot === "barrel" && model.appearance === appearance && model.platforms.includes(info.platform) && model.calibers.includes(info.caliber))!;
			install(gun, barrel.id);
			const actor = weaponActorArt(gun), end = geometryBounds(part(actor.svg, "barrel")!)[2]!;
			// A cantilever optic bridge may project beyond the fore-end. Measure
			// its solid housing, which must never hide the actual barrel crown.
			const covering = Math.max(...pointsForPath(outline(part(actor.svg, definition.category === "pistol" ? "receiver" : "handguard")!)).map(([x]) => x));
			expect(getWeaponBuildIssues(gun), definition.id).toEqual([]);
			expect(end, `${definition.id}/${appearance} muzzle exits body`).toBeGreaterThan(covering + 2);
		}
	});

	test("workbench framing centers and pads the actual pistol or rifle assembly", () => {
		for (const id of ["pm", "p90", "ak74", "ash12", "awm"]) {
			const gun = factory(id), actor = weaponActorArt(gun), bench = weaponBuildArt(gun);
			const [left = 0, , width = 0] = viewport(bench), shadow = Number(bench.match(/<ellipse cx="([\d.]+)"/)![1]);
			expectInside(bench, id);
			expect(width).toBeGreaterThan(actor.width);
			expect(width).toBeLessThan(actor.width + 65);
			expect(shadow).toBeCloseTo(left + width / 2, 5);
		}
		expect(viewport(weaponBuildArt(factory("pm")))[2]!).toBeLessThan(viewport(weaponBuildArt(factory("ak74")))[2]! * .6);
	});

	test("VSS and VAL retain the reference furniture, short fore-end and distinct horizontal-rib box feeds", () => {
		const stocks = MODULE_MODELS.filter((model) => model.slot === "stock" && model.platforms.includes("val"));
		const magazines = MODULE_MODELS.filter((model) => model.slot === "magazine" && model.platforms.includes("val"));
		let cases = 0;
		for (const id of ["vss", "asval"]) for (const stock of stocks) for (const magazine of magazines) {
			const gun = factory(id); install(gun, stock.id); install(gun, magazine.id);
			const actor = weaponActorArt(gun), bench = weaponBuildArt(gun);
			expect(getWeaponBuildIssues(gun)).toEqual([]);
			for (const model of [stock, magazine]) {
				expect(outline(part(actor.svg, model.slot)!)).toBe(outline(part(moduleArt(model), model.slot)!));
				expect(part(actor.svg, model.slot)).toBe(part(bench, model.slot));
			}
			const receiver = part(actor.svg, "receiver")!, guard = receiver.match(/data-mechanism="trigger-guard" d="([^"]+)"/)![1]!;
			const receiverEnd = Math.max(...pointsForPath(outline(receiver)).map(([x]) => x));
			const feedStart = pointsForPath(outline(part(actor.svg, "magazine")!))[0]!;
			const guardEnd = Math.max(...pointsForPath(guard).map(([x]) => x));
			expect(receiver).not.toContain('data-hardware="val-family-grip"');
			expect(feedStart[0]).toBeGreaterThan(guardEnd);
			expect(feedStart[0] - guardEnd).toBeLessThan(12);
			expect(receiverEnd).toBeLessThan(450);
			expect(part(actor.svg, "handguard")).toContain('data-mechanism="val-short-fore-end"');
			const handguardEnd = Math.max(...pointsForPath(outline(part(actor.svg, "handguard")!)).map(([x]) => x));
			const barrelEnd = Math.max(...pointsForPath(outline(part(actor.svg, "barrel")!)).map(([x]) => x));
			expect(barrelEnd - handguardEnd).toBeGreaterThan(215);
			if (magazine.appearance !== "drum") expect(part(actor.svg, "magazine")).toContain('data-hardware="val-horizontal-magazine-rib"');
			expectInside(actor.svg, `${id}/${stock.id}/${magazine.id}`); expectInside(bench, `${id}/${stock.id}/${magazine.id}/bench`);
			cases++;
		}
		expect(cases).toBe(98);
		const vss = weaponActorArt(factory("vss")), val = weaponActorArt(factory("asval"));
		expect(outline(part(vss.svg, "stock")!).split(/(?=M)/)).toHaveLength(3); // Two open wooden windows.
		expect(part(val.svg, "stock")).toContain('data-mechanism="val-tubular-folding-frame"');
		expect(geometryBounds(part(vss.svg, "magazine")!)[3]!).toBeLessThan(geometryBounds(part(vss.svg, "stock")!)[3]! - 5);
		expect(geometryBounds(part(val.svg, "magazine")!)[3]!).toBeGreaterThan(geometryBounds(part(vss.svg, "magazine")!)[3]! + 35);
	});

	test("direct dovetail scope keeps its slim stepped tube and integrated receiver shoe without a rail or generic rings", () => {
		for (const id of ["vss", "asval", "ak74", "svd"]) {
			const gun = factory(id); install(gun, "optic-dovetail");
			const actor = weaponActorArt(gun), scope = part(actor.svg, "optic")!, bounds = geometryBounds(scope);
			expect(getWeaponBuildIssues(gun)).toEqual([]);
			expect(scope).toContain('data-mechanism="slim-dovetail-scope"');
			expect(scope).toContain('data-hardware="pso-side-shoe"');
			expect(scope).toContain('data-hardware="corrugated-eyecup"');
			expect(scope).not.toContain('data-hardware="scope-ring"');
			expect(scope).not.toMatch(/h[\d.]+v6H/);
			expect(bounds[2]! - bounds[0]!).toBeGreaterThan(240);
			expect(bounds[2]! - bounds[0]!).toBeLessThan(250);
			expect(outline(scope)).toBe(outline(part(moduleArt(MODULE_BY_ID["optic-dovetail"]!), "optic")!));
			expect(scope).toBe(part(weaponBuildArt(gun), "optic")!);
			expectInside(actor.svg, `${id}/direct-dovetail`);
		}
	});

	test("every VAL foregrip and rail optic contacts its shortened fore-end's real attachment bridge", () => {
		for (const id of ["vss", "asval"]) for (const model of MODULE_MODELS.filter((item) => item.slot === "foregrip" || item.slot === "optic" && item.requiresMount === "rail-top")) {
			const gun = factory(id); install(gun, "handguard-val-carbon"); install(gun, model.id);
			const actor = weaponActorArt(gun), foundation = part(actor.svg, "handguard")!, group = part(actor.svg, model.slot)!;
			const rails = [...foundation.matchAll(/<path d="M(-?[\d.]+) (-?[\d.]+)h([\d.]+)v6H[-\d.]+z"/g)].map((match) => [Number(match[1]), Number(match[2]), Number(match[1]) + Number(match[3]), Number(match[2]) + 6]);
			const [dx = 0, dy = 0] = offset(group), paths = outline(group).split(/(?=M)/);
			const feet = model.slot === "foregrip" ? [pointsForPath(paths[0]!).slice(0, 3)] : (["scope", "longscope", "scout", "prism"].includes(model.appearance) ? paths.slice(-2) : paths.slice(0, 1)).map(pointsForPath);
			for (const points of feet) {
				const left = Math.min(...points.map(([x]) => x)) + dx, right = Math.max(...points.map(([x]) => x)) + dx;
				const top = Math.min(...points.map(([, y]) => y)) + dy, bottom = Math.max(...points.map(([, y]) => y)) + dy;
				expect(rails.some(([x = 0, y = 0, end = 0, lower = 0]) => left >= x - .01 && right <= end + .01 && bottom >= y && top <= lower), `${id}/${model.id} true fore-end contact`).toBe(true);
			}
			expect(getWeaponBuildIssues(gun)).toEqual([]); expectInside(actor.svg, `${id}/${model.id}`);
		}
	});

	test("TOZ box upgrades keep a straight feed profile rather than an assault-rifle curve", () => {
		for (const appearance of ["extended", "quick", "window", "compact"]) {
			const gun = factory("toz"); install(gun, `magazine-toz-20g-${appearance}`);
			const actor = weaponActorArt(gun), magazine = part(actor.svg, "magazine")!;
			expect(getWeaponBuildIssues(gun)).toEqual([]);
			expect(outline(magazine)).not.toMatch(/[qQcCsS]/);
			const [left = 0, , right = 0] = geometryBounds(magazine);
			expect(right - left).toBeLessThan(75);
			expect(magazine).toContain('data-mechanism="toz-straight-box-feed"');
			expect(magazine).toBe(part(weaponBuildArt(gun), "magazine")!);
		}
	});

	test("TT magazine upgrades retain their own feed and floorplate rather than adopting the PM profile", () => {
		const variants = MODULE_MODELS.filter((model) => model.slot === "magazine" && !model.weaponId && model.platforms.includes("tt"));
		expect(variants.length).toBeGreaterThanOrEqual(4);
		for (const model of variants) {
			const pm = MODULE_MODELS.find((item) => item.slot === "magazine" && !item.weaponId && item.platforms.includes("pm") && item.appearance === model.appearance)!;
			const loose = part(moduleArt(model), "magazine")!, gun = factory("tt"); install(gun, model.id);
			expect(getWeaponBuildIssues(gun)).toEqual([]);
			expect(outline(loose), model.id).not.toBe(outline(part(moduleArt(pm), "magazine")!));
			expect(outline(part(weaponActorArt(gun).svg, "magazine")!)).toBe(outline(loose));
		}
	});

	test("SVD and Saiga upgrades retain their tapered rifle and straight shotgun box feeds", () => {
		for (const id of ["svd", "saiga"]) for (const appearance of ["extended", "quick", "window", "compact"]) {
			const gun = factory(id), info = RECEIVER_INFO[id]!;
			install(gun, `magazine-${info.platform}-${info.caliber}-${appearance}`);
			const magazine = part(weaponActorArt(gun).svg, "magazine")!;
			expect(getWeaponBuildIssues(gun)).toEqual([]);
			expect(outline(magazine)).not.toMatch(/[qQ]/);
			expect(magazine).toContain(`data-mechanism="${id === "svd" ? "sniper-short-box-feed" : "saiga-shotgun-box-feed"}"`);
			expect(magazine).toBe(part(weaponBuildArt(gun), "magazine")!);
		}
	});

	test("every model keeps its physical paths, valid numbers and unclipped installed geometry on the bench and actor", () => {
		expect(MODULE_MODELS).toHaveLength(934);
		expect(ARMORY_SLOT_ORDER).toEqual(MODULE_SLOTS);
		for (const model of MODULE_MODELS) {
			const gun = gunFor(model), saved = JSON.stringify(gun), actor = weaponActorArt(gun), bench = weaponBuildArt(gun), loose = moduleArt(model);
			expect(part(actor.svg, model.slot), model.id).toBe(part(bench, model.slot));
			const normalize = (path: string) => model.slot === "muzzle" ? path.replace(/^M-?[\d.]+ /, "M0 ") : path;
			expect(normalize(outline(part(actor.svg, model.slot)!)), model.id).toBe(normalize(outline(part(loose, model.slot)!)));
			for (const svg of [loose, bench, actor.svg]) { expect(svg).not.toMatch(/undefined|NaN|Infinity|h--|v--/); }
			expectInside(actor.svg, model.id); expectInside(bench, model.id);
			expect(JSON.stringify(gun)).toBe(saved);
		}
	}, 15_000);

	test("every mount and every light/laser combination coexists with optics, drum, suppressor and grip in all 11 slots", () => {
		const mounts = MODULE_MODELS.filter((model) => model.slot === "mount" && model.platforms.includes("*")), lights = MODULE_MODELS.filter((model) => model.slot === "flashlight"), lasers = MODULE_MODELS.filter((model) => model.slot === "laser"), optics = MODULE_MODELS.filter((model) => model.slot === "optic");
		for (const mount of mounts) for (const [lightIndex, light] of lights.entries()) for (const [laserIndex, laser] of lasers.entries()) {
			const gun = factory("ak74");
			for (const id of ["handguard-ak-carbon", "magazine-ak-5.45x39-drum", "foregrip-bipod", "muzzle-5.45x39-suppressor", mount.id, light.id, laser.id, optics[(lightIndex + laserIndex) % optics.length]!.id]) install(gun, id);
			expect(getWeaponBuildIssues(gun)).toEqual([]);
			const actor = weaponActorArt(gun), bench = weaponBuildArt(gun);
			expect((actor.svg.match(/data-module-slot=/g) ?? [])).toHaveLength(11);
			for (const slot of MODULE_SLOTS) expect(part(actor.svg, slot)).toBe(part(bench, slot));
			expect(actor.referenceWidth).toBe(weaponActorArt(factory("ak74")).referenceWidth);
			expectInside(actor.svg, `${mount.id}/${light.id}/${laser.id}`);
		}
	}, 15_000);

	test("the nine sights have strict side silhouettes, and drums/bipods never show front covers or front-facing V legs", () => {
		for (const model of MODULE_MODELS.filter((item) => item.slot === "optic")) {
			const group = part(moduleArt(model), "optic")!;
			expect(group).not.toContain("<ellipse");
			expect(group).not.toContain("-glass)"); // A front-facing sight window is invisible from the side.
			// Side fasteners and adjustment caps remain small; a lens or reticle
			// painted across the sight's side would exceed their physical radius.
			for (const circle of group.matchAll(/<circle[^>]+r="([\d.]+)"[^>]*>/g)) expect(Number(circle[1])).toBeLessThanOrEqual(12);
		}
		for (const model of MODULE_MODELS.filter((item) => item.appearance === "drum")) {
			const group = part(moduleArt(model), "magazine")!, [left = 0, , right = 0] = geometryBounds(group);
			expect(right - left, model.id).toBeLessThan(75);
			expect(group).not.toMatch(/<circle[^>]+r="(?:11|[3-9]\d)"/);
		}
		const legs = outline(part(moduleArt(MODULE_BY_ID["foregrip-bipod"]!), "foregrip")!);
		expect(legs).not.toContain("-33 71");
		expect(legs).toContain("24 70");
	});

	test("every device foot lands on an actual drawn side rail for every supported gun and attachment foundation", () => {
		const mounts = MODULE_MODELS.filter((model) => model.slot === "mount"), lights = MODULE_MODELS.filter((model) => model.slot === "flashlight"), lasers = MODULE_MODELS.filter((model) => model.slot === "laser");
		for (const definition of WEAPONS.filter((item) => item.category !== "pistol")) for (const barrelType of ["factory", "long"] as const) for (const mount of [undefined, ...mounts]) {
			const gun = factory(definition.id), info = RECEIVER_INFO[definition.id]!;
			install(gun, `handguard-${info.platform}-carbon`);
			if (barrelType !== "factory") install(gun, `barrel-${info.platform}-${info.caliber}-${barrelType}`);
			if (mount) { if (!getResolvedModuleMounts(gun.modules).includes(mount.requiresMount!)) continue; install(gun, mount.id); }
			for (const [index, light] of lights.entries()) {
				install(gun, light.id); install(gun, lasers[index]!.id);
				expect(getWeaponBuildIssues(gun)).toEqual([]);
				const art = weaponActorArt(gun), foundation = part(art.svg, mount ? "mount" : "handguard")!;
				const [dx = 0, dy = 0] = offset(foundation);
				const rails = [...foundation.matchAll(/<path d="M(-?[\d.]+) (-?[\d.]+)h([\d.]+)v6H[-\d.]+z"/g)].map((match) => [Number(match[1]) + dx, Number(match[2]) + dy, Number(match[1]) + Number(match[3]) + dx, Number(match[2]) + 6 + dy]);
				for (const slot of ["flashlight", "laser"] as const) {
					const group = part(art.svg, slot)!, foot = outline(group).split(/(?=M)/).at(-1)!;
					const opening = group.slice(0, group.indexOf(">") + 1), [left = 0, top = 0, right = 0, bottom = 0] = geometryBounds(`${opening}<path d="${foot}"/></g>`);
					expect(rails.some(([x = 0, y = 0, end = 0, lower = 0]) => left >= x - .01 && right <= end + .01 && bottom >= y && top <= lower), `${definition.id}/${barrelType}/${mount?.id ?? "direct-side-rail"}/${slot} attached foot`).toBe(true);
				}
				if (mount?.appearance.startsWith("barrel-")) {
					const group = part(art.svg, "mount")!, foundationPath = outline(group).split(/(?=M)/)[0]!, opening = group.slice(0, group.indexOf(">") + 1);
					const [left = 0, , right = 0] = geometryBounds(`${opening}<path d="${foundationPath}"/></g>`), [barrelDx = 0] = offset(part(art.svg, "barrel")!);
					const barrelEnd = Math.max(...pointsForPath(outline(part(art.svg, "barrel")!)).map(([x]) => x)) + barrelDx;
					const front = Math.max(...pointsForPath(outline(part(art.svg, "handguard")!)).map(([x]) => x));
					expect(left, `${definition.id}/${mount.id} exposed barrel start`).toBeGreaterThanOrEqual(front);
					expect(right, `${definition.id}/${mount.id} exposed barrel end`).toBeLessThanOrEqual(barrelEnd);
				}
				expectInside(art.svg, `${definition.id}/${barrelType}/${mount?.id ?? "direct-side-rail"}`);
			}
		}
	}, 15_000);

	test("riser height and barrel clamps move the fitted part while retaining the same loose physical geometry", () => {
		const gun = factory("ak74"); install(gun, "mount-dovetail-low"); install(gun, "optic-longscope");
		const low = weaponActorArt(gun), lowSight = part(low.svg, "optic")!;
		install(gun, "mount-dovetail-high");
		const high = weaponActorArt(gun), highSight = part(high.svg, "optic")!;
		expect(offset(highSight)[1]!).toBeLessThan(offset(lowSight)[1]!);
		expect(outline(highSight)).toBe(outline(lowSight));
		expectInside(high.svg, "high mount"); expectInside(weaponBuildArt(gun), "high mount bench");
		install(gun, "handguard-ak-carbon"); install(gun, "mount-barrel-ring"); install(gun, "flashlight-long"); install(gun, "laser-precision");
		const shortBarrel = weaponActorArt(gun); install(gun, "barrel-ak-5.45x39-long"); const longer = weaponActorArt(gun);
		for (const slot of ["mount", "flashlight", "laser"] as const) { expect(offset(part(longer.svg, slot)!)[0]! - offset(part(shortBarrel.svg, slot)!)[0]!).toBe(20); expect(outline(part(longer.svg, slot)!)).toBe(outline(part(shortBarrel.svg, slot)!)); }
	});

	test("top and bottom adapter shoes rest on physical host rails across the reference families", () => {
		let cases = 0;
		const unsupported: string[] = [];
		const adapters = MODULE_MODELS.filter((model) => model.slot === "mount" && model.requiresMount !== "receiver-bridge" && /^(top|bottom)-/.test(model.appearance));
		for (const definition of WEAPONS.filter((item) => item.category !== "pistol" && !["vss", "asval"].includes(item.id))) {
			const info = RECEIVER_INFO[definition.id]!;
			const guards = MODULE_MODELS.filter((model) => model.slot === "handguard" && (model.id === FACTORY_KITS[definition.id]!.handguard || !model.weaponId && model.platforms.includes(info.platform) && model.calibers.includes(info.caliber)));
			for (const guard of guards) for (const adapter of adapters) {
				const gun = factory(definition.id); install(gun, guard.id); install(gun, adapter.id);
				if (getWeaponBuildIssues(gun).length) continue;
				cases++;
				const art = weaponActorArt(gun), mounted = part(art.svg, "mount")!;
				const opening = mounted.slice(0, mounted.indexOf(">") + 1), shoe = outline(mounted).split(/(?=M)/)[0]!;
				const [left = 0, top = 0, right = 0, bottom = 0] = geometryBounds(`${opening}<path d="${shoe}"/></g>`);
				const rails = ["receiver", "handguard"].flatMap((slot) => {
					const host = part(art.svg, slot as ModuleSlot)!, [dx = 0, dy = 0] = offset(host);
					return [...host.matchAll(/<path d="M(-?[\d.]+) (-?[\d.]+)h([\d.]+)v6H[-\d.]+z"/g)].map((match) => [Number(match[1]) + dx, Number(match[2]) + dy, Number(match[1]) + Number(match[3]) + dx, Number(match[2]) + 6 + dy]);
				});
				if (!rails.some(([x = 0, y = 0, end = 0, lower = 0]) => left >= x - .01 && right <= end + .01 && bottom >= y && top <= lower)) unsupported.push(`${definition.id}/${guard.id}/${adapter.id}: shoe ${[left, top, right, bottom]}, rails ${JSON.stringify(rails)}`);
			}
		}
		expect(cases).toBeGreaterThan(300);
		expect(unsupported).toEqual([]);
	});

	test("the FAL cover clamps onto the action and supports both long-scope rings", () => {
		const gun = factory("fal"); install(gun, "mount-fal-bridge"); install(gun, "optic-longscope");
		expect(getWeaponBuildIssues(gun)).toEqual([]);
		const actor = weaponActorArt(gun), mount = part(actor.svg, "mount")!, receiver = part(actor.svg, "receiver")!;
		expect(offset(mount)).toEqual([0, 0]);
		expect(outline(mount)).toBe(outline(part(moduleArt(MODULE_BY_ID["mount-fal-bridge"]!), "mount")!));
		const action = pointsForPath(outline(receiver).split(/(?=M)/)[0]!);
		const insideAction = (x: number, y: number) => {
			let inside = false;
			for (let i = 0, j = action.length - 1; i < action.length; j = i++) {
				const [xi, yi] = action[i]!, [xj, yj] = action[j]!;
				if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
			}
			return inside;
		};
		for (const shoe of outline(mount).split(/(?=M)/).slice(1, 3)) {
			const [left = 0, , right = 0, bottom = 0] = geometryBounds(`<path d="${shoe}"/>`);
			expect(insideAction(left + 1, bottom - 1)).toBe(true);
			expect(insideAction(right - 1, bottom - 1)).toBe(true);
		}
		const sight = part(actor.svg, "optic")!;
		for (const ring of outline(sight).split(/(?=M)/).slice(-2)) {
			const [left = 0, , right = 0, bottom = 0] = geometryBounds(`<path d="${ring}"/>`);
			expect(left).toBeGreaterThanOrEqual(282); expect(right).toBeLessThanOrEqual(481);
			expect(bottom).toBeGreaterThanOrEqual(108); expect(bottom).toBeLessThanOrEqual(114);
		}
	});

	test("modern lower rails have a continuous visible bearing under the fore-end", () => {
		const families = ["m4a1", "hk416", "mcx", "scarh", "trg42", "g36", "aug", "fal", "sr25", "ash12", "awm"];
		const gaps: string[] = []; let cases = 0;
		const contains = (points: [number, number][], x: number, y: number) => {
			let inside = false;
			for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
				const [xi, yi] = points[i]!, [xj, yj] = points[j]!;
				if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
			}
			return inside;
		};
		for (const id of families) {
			const info = RECEIVER_INFO[id]!;
			const guards = MODULE_MODELS.filter((model) => model.slot === "handguard" && model.providesMounts.includes("rail-bottom") && (model.id === FACTORY_KITS[id]!.handguard || !model.weaponId && model.platforms.includes(info.platform) && model.calibers.includes(info.caliber)));
			for (const guard of guards) {
				cases++;
				const gun = factory(id); install(gun, guard.id);
				const group = part(weaponActorArt(gun).svg, "handguard")!;
				const body = pointsForPath(outline(group).split(/(?=M)/)[0]!);
				const rails = [...group.matchAll(/<path d="M(-?[\d.]+) (-?[\d.]+)h([\d.]+)v6H[-\d.]+z"/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]), width: Number(match[3]) }));
				const lower = rails.sort((a, b) => b.y - a.y)[0]!;
				const solids = [...group.matchAll(/<path\b[^>]*>/g)].filter(([tag]) => /\bfill="/.test(tag) && !/\bfill="none"/.test(tag)).map(([tag]) => tag.match(/\bd="([^"]+)"/)![1]!.split(/(?=M)/).map(pointsForPath));
				const left = Math.min(...body.map(([x]) => x)), right = Math.max(...body.map(([x]) => x));
				for (const fraction of [.25, .5, .75]) {
					const x = left + (right - left) * fraction;
					const intersections = body.flatMap(([x1, y1], i) => {
						const [x2, y2] = body[(i + 1) % body.length]!;
						return x1 !== x2 && x >= Math.min(x1, x2) && x <= Math.max(x1, x2) ? [y1 + (x - x1) * (y2 - y1) / (x2 - x1)] : [];
					});
					const underside = Math.max(...intersections);
					for (let y = underside + .25; y < lower.y + .1; y += .5) {
						if (!solids.some((contours) => contours.filter((contour) => contains(contour, x, y)).length % 2 === 1)) { gaps.push(`${id}/${guard.id}: air below fore-end at ${x.toFixed(1)},${y.toFixed(1)}`); break; }
					}
				}
			}
		}
		expect(cases).toBeGreaterThanOrEqual(40);
		expect(gaps).toEqual([]);
	});

	test("all supported sights place their optical feet on the actual four dovetail adapter rails", () => {
		let cases = 0, railCases = 0;
		for (const definition of WEAPONS) {
			if (!getResolvedModuleMounts(factory(definition.id).modules).includes("dovetail")) continue;
			for (const mount of MODULE_MODELS.filter((model) => model.slot === "mount" && model.appearance.startsWith("dovetail-"))) {
				for (const optic of MODULE_MODELS.filter((model) => model.slot === "optic")) {
					const gun = factory(definition.id); install(gun, mount.id); install(gun, optic.id);
					if (getWeaponBuildIssues(gun).length) continue;
					cases++;
					const actor = weaponActorArt(gun), group = part(actor.svg, "optic")!, bench = weaponBuildArt(gun);
					expect(group).toBe(part(bench, "optic")!); expect(outline(group)).toBe(outline(part(moduleArt(optic), "optic")!));
					expectInside(actor.svg, `${definition.id}/${mount.id}/${optic.id}`); expectInside(bench, `${definition.id}/${mount.id}/${optic.id}/bench`);
					// Direct dovetail sights retain their own side clamp. Rail sights
					// must rest on the adapter deck rather than the former receiver rail.
					if (optic.requiresMount !== "rail-top") continue;
					railCases++;
					const mountGroup = part(actor.svg, "mount")!, [mountX = 0, mountY = 0] = offset(mountGroup);
					const rails = [...mountGroup.matchAll(/<path d="M(-?[\d.]+) (-?[\d.]+)h([\d.]+)v6H[-\d.]+z"/g)].map((match) => [Number(match[1]) + mountX, Number(match[2]) + mountY, Number(match[1]) + Number(match[3]) + mountX, Number(match[2]) + 6 + mountY]);
					const subpaths = outline(group).split(/(?=M)/), opening = group.slice(0, group.indexOf(">") + 1);
					const feet = ["scope", "longscope", "scout", "prism"].includes(optic.appearance) ? subpaths.slice(-2) : subpaths.slice(0, 1);
					for (const foot of feet) {
						const [left = 0, top = 0, right = 0, bottom = 0] = geometryBounds(`${opening}<path d="${foot}"/></g>`);
						expect(rails.some(([x = 0, y = 0, end = 0, lower = 0]) => left >= x - .01 && right <= end + .01 && bottom >= y && top <= lower), `${definition.id}/${mount.id}/${optic.id} optical foot supported`).toBe(true);
					}
				}
			}
		}
		expect(cases).toBe(324); expect(railCases).toBe(252);
	});
});
