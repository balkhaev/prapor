import { describe, expect, test } from "bun:test";
import { ARMORY_SLOT_ORDER, moduleArt, weaponActorArt, weaponBuildArt } from "../src/armory-art";
import { WEAPONS } from "../src/game/data";
import { getWeaponBuildIssues, type WeaponInstance } from "../src/game/engine";
import { FACTORY_KITS, getResolvedModuleMounts, MODULE_BY_ID, MODULE_MODELS, MODULE_SLOTS, RECEIVER_INFO, type ModuleModel, type ModuleSlot } from "../src/game/modules";

const factory = (weaponId: string): WeaponInstance => ({ id: "profile-audit", weaponId, durability: 100, foundAt: 0, attachments: { optic: 0, magazine: 0, stock: 0 }, modules: Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId]) => [slot, { id: slot, modelId, durability: 100, foundAt: 0 }])) });
const install = (gun: WeaponInstance, id: string) => { const model = MODULE_BY_ID[id]!; gun.modules[model.slot] = { id: model.slot, modelId: id, durability: 100, foundAt: 0 }; };
const part = (svg: string, slot: ModuleSlot) => svg.match(new RegExp(`<g data-module-slot="${slot}"[^>]*>[\\s\\S]*?</g>`))?.[0];
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
	test("all 411 models keep their physical paths, valid numbers and unclipped installed geometry on the bench and actor", () => {
		expect(MODULE_MODELS).toHaveLength(411);
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
	});

	test("every mount and every light/laser combination coexists with optics, drum, suppressor and grip in all 11 slots", () => {
		const mounts = MODULE_MODELS.filter((model) => model.slot === "mount"), lights = MODULE_MODELS.filter((model) => model.slot === "flashlight"), lasers = MODULE_MODELS.filter((model) => model.slot === "laser"), optics = MODULE_MODELS.filter((model) => model.slot === "optic");
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
	});

	test("the nine sights have strict side silhouettes, and drums/bipods never show front covers or front-facing V legs", () => {
		for (const model of MODULE_MODELS.filter((item) => item.slot === "optic")) {
			const group = part(moduleArt(model), "optic")!;
			expect(group).not.toContain("<ellipse");
			expect(group).not.toContain("-glass)"); // A front-facing sight window is invisible from the side.
			for (const circle of group.matchAll(/<circle[^>]+>/g)) expect(circle[0]).toContain('fill="#989d8c"'); // Side adjustment screws remain visible, reticles do not.
		}
		for (const model of MODULE_MODELS.filter((item) => item.appearance === "drum")) {
			const group = part(moduleArt(model), "magazine")!, [left = 0, , right = 0] = geometryBounds(group);
			expect(right - left).toBeLessThan(75);
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
					const front = ["pp91", "toz"].includes(definition.id) ? 601 : 636;
					expect(left, `${definition.id}/${mount.id} exposed barrel start`).toBeGreaterThanOrEqual(front);
					expect(right, `${definition.id}/${mount.id} exposed barrel end`).toBeLessThanOrEqual(barrelEnd);
				}
				expectInside(art.svg, `${definition.id}/${barrelType}/${mount?.id ?? "direct-side-rail"}`);
			}
		}
	});

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
});
