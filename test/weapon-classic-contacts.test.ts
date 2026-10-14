import { describe, expect, test } from "bun:test";
import { weaponActorArt, weaponBuildArt } from "../src/armory-art";
import { getWeaponBuildIssues, type WeaponInstance } from "../src/game/engine";
import { FACTORY_KITS, MODULE_MODELS, RECEIVER_INFO, type ModuleSlot } from "../src/game/modules";
import { CLASSIC_REFERENCE_GRIPS } from "../src/weapon-reference-classic-anchors";
import { weaponGripAnchor } from "../src/weapon-attachment";

const factory = (weaponId: string): WeaponInstance => ({ id: "classic-contact", weaponId, durability: 100, foundAt: 0, attachments: { optic: 0, magazine: 0, stock: 0 }, modules: Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId]) => [slot, { id: slot, modelId, durability: 100, foundAt: 0 }])) });
function part(svg: string, slot: ModuleSlot) {
 const start = svg.indexOf(`<g data-module-slot="${slot}"`), tags = /<g\b[^>]*>|<\/g>/g;
 if (start < 0) throw new Error(`Missing ${slot}`);
 tags.lastIndex = start; let depth = 0;
 for (let tag = tags.exec(svg); tag; tag = tags.exec(svg)) { depth += tag[0].startsWith("</") ? -1 : 1; if (!depth) return svg.slice(start, tags.lastIndex); }
 throw new Error(`Unclosed ${slot}`);
}
const outline = (svg: string) => svg.match(/<path d="([^"]+)"/)![1]!;
const contains = (points: [number, number][], x: number, y: number) => {
 let inside = false;
 for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
  const [xi, yi] = points[i]!, [xj, yj] = points[j]!;
  if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
 }
 return inside;
};
const horizontalIntersections = (points: [number, number][], y: number) => points.flatMap(([x1, y1], i) => {
 const [x2, y2] = points[(i + 1) % points.length]!;
 return y1 !== y2 && y >= Math.min(y1, y2) && y <= Math.max(y1, y2) ? [x1 + (y - y1) * (x2 - x1) / (y2 - y1)] : [];
});
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

describe("classic furniture contacts in the emitted assembly", () => {
 test("shortened SVD rear furniture seats against the action beneath the barrel", () => {
  for (const appearance of ["light", "wood"]) {
   const gun = factory("svd");
   const guard = MODULE_MODELS.find((model) => model.slot === "handguard" && model.appearance === appearance && model.platforms.includes("svd"))!;
   gun.modules.handguard = { id: "guard", modelId: guard.id, durability: 100, foundAt: 0 };
   const svg = weaponActorArt(gun).svg;
   const action = pointsForPath(outline(part(svg, "receiver")).split(/(?=M)/)[0]!);
   const front = Math.max(...horizontalIntersections(action, 155));
   const host = part(svg, "handguard");
   const solids = [...host.matchAll(/<path\b[^>]*>/g)].filter(([tag]) => /\bfill="/.test(tag) && !/\bfill="none"/.test(tag)).map(([tag]) => tag.match(/\bd="([^"]+)"/)![1]!.split(/(?=M)/).map(pointsForPath));
   for (let x = front + .25; x < front + 6; x += .5) expect(solids.some((contours) => contours.filter((contour) => contains(contour, x, 155)).length % 2 === 1), `${appearance}: retainer closes fore-end seam at x=${x}`).toBe(true);
   expect(part(weaponBuildArt(gun), "handguard")).toBe(host);
  }
 });

 test("each trigger bow opens below its action, including the deeper Saiga housing", () => {
  for (const id of Object.keys(CLASSIC_REFERENCE_GRIPS)) {
   const receiver = part(weaponActorArt(factory(id)).svg, "receiver");
   const action = pointsForPath(outline(receiver).split(/(?=M)/)[0]!);
   const bow = pointsForPath(receiver.match(/data-mechanism="trigger-guard" d="([^"]+)"/)![1]!);
   const x = (Math.min(...bow.map(([x]) => x)) + Math.max(...bow.map(([x]) => x))) / 2;
   const top = Math.min(...bow.map(([, y]) => y));
   expect(contains(action, x, top + 4), `${id}: trigger opening clear of action`).toBe(false);
  }
 });

 test("quick-pull loops connect to their box or curved feed rather than floating below it", () => {
  let cases = 0;
  for (const id of Object.keys(CLASSIC_REFERENCE_GRIPS).filter((id) => !["pkp", "mp133", "m870"].includes(id))) {
   const info = RECEIVER_INFO[id]!;
   const model = MODULE_MODELS.find((model) => model.slot === "magazine" && model.appearance === "quick" && model.platforms.includes(info.platform) && model.calibers.includes(info.caliber))!;
   const gun = factory(id); gun.modules.magazine = { id: "magazine", modelId: model.id, durability: 100, foundAt: 0 };
   const group = part(weaponActorArt(gun).svg, "magazine");
   const contours = outline(group).split(/(?=M)/).map(pointsForPath);
   const strap = pointsForPath(group.match(/data-hardware="magazine-pull-strap" d="([^"]+)"/)![1]!);
   const x = (Math.min(...strap.map(([x]) => x)) + Math.max(...strap.map(([x]) => x))) / 2;
   const top = Math.min(...strap.map(([, y]) => y)), bottom = Math.max(...strap.map(([, y]) => y));
   expect(contains(contours[0]!, x, top + .5), `${id}: pull strap seats inside feed`).toBe(true);
   expect(contours.slice(1).filter((contour) => contains(contour, x, bottom - .5)).length % 2, `${id}: pull strap joins solid loop`).toBe(1);
   expect(part(weaponBuildArt(gun), "magazine")).toBe(group);
   cases++;
  }
  expect(cases).toBe(11);
 });

 test("upgrade grips clear the trigger bow and keep the held hand on the grip", () => {
  let cases = 0;
  const collisions: string[] = [];
  for (const id of ["svd", "svdk", "sks", "mosin", "mp133", "m870"]) {
   const info = RECEIVER_INFO[id]!;
   for (const stock of MODULE_MODELS.filter((model) => model.slot === "stock" && !model.weaponId && !["factory", "padded"].includes(model.appearance) && model.platforms.includes(info.platform) && (model.calibers.includes("*") || model.calibers.includes(info.caliber)))) {
    const gun = factory(id); gun.modules.stock = { id: "stock", modelId: stock.id, durability: 100, foundAt: 0 };
    expect(getWeaponBuildIssues(gun)).toEqual([]);
    const actor = weaponActorArt(gun), stockGroup = part(actor.svg, "stock"), receiver = part(actor.svg, "receiver");
    const grip = pointsForPath(outline(stockGroup).split(/(?=M)/).at(-1)!);
    const bow = pointsForPath(receiver.match(/data-mechanism="trigger-guard" d="([^"]+)"/)![1]!);
    const top = Math.min(...bow.map(([, y]) => y)), bottom = Math.max(...bow.map(([, y]) => y));
    // Include the bow's 3.3 px stroke. A seated grip may overlap its own
    // chassis, but must leave the trigger opening and metal bow clear.
    for (let y = top + .5; y < bottom - .5; y += .5) {
     const front = Math.max(...horizontalIntersections(grip, y));
     const back = Math.min(...horizontalIntersections(bow, y));
     if (back - front < 1.65) { collisions.push(`${id}/${stock.id}: grip enters trigger bow at y=${y}`); break; }
    }
    const anchor = weaponGripAnchor(id, stock.appearance, stock.weaponId);
    expect(contains(grip, anchor.x, anchor.y), `${id}/${stock.id} held palm on actual grip`).toBe(true);
    expect(part(weaponBuildArt(gun), "stock")).toBe(stockGroup);
    cases++;
   }
  }
  expect(cases).toBeGreaterThanOrEqual(24);
  expect(collisions).toEqual([]);
 });

 test("bottom rails bear continuously on the actual factory, rail and vented fore-end", () => {
  let cases = 0;
  const gaps: string[] = [];
  for (const id of Object.keys(CLASSIC_REFERENCE_GRIPS)) {
   const info = RECEIVER_INFO[id]!;
   for (const guard of MODULE_MODELS.filter((model) => model.slot === "handguard" && model.providesMounts.includes("rail-bottom") && (model.id === FACTORY_KITS[id]!.handguard || !model.weaponId && model.platforms.includes(info.platform) && (model.calibers.includes("*") || model.calibers.includes(info.caliber))))) {
    const gun = factory(id); gun.modules.handguard = { id: "guard", modelId: guard.id, durability: 100, foundAt: 0 };
    expect(getWeaponBuildIssues(gun)).toEqual([]);
    const group = part(weaponActorArt(gun).svg, "handguard");
    const body = pointsForPath(outline(group).split(/(?=M)/)[0]!);
    const rails = [...group.matchAll(/<path d="M(-?[\d.]+) (-?[\d.]+)h([\d.]+)v6H[-\d.]+z"/g)].map((match) => ({x: Number(match[1]), y: Number(match[2]), width: Number(match[3])}));
    const lower = rails.sort((a, b) => b.y - a.y)[0]!;
    const solids = [...group.matchAll(/<path\b[^>]*>/g)].filter(([tag]) => /\bfill="/.test(tag) && !/\bfill="none"/.test(tag)).map(([tag]) => tag.match(/\bd="([^"]+)"/)![1]!.split(/(?=M)/).map(pointsForPath));
    // Sample the actual housing underside above each rail station. This
    // catches a visible air strip between sparse support posts, rather
    // than merely comparing declared bounds or checking for a marker.
    for (const fraction of [.2, .5, .8]) {
     const x = lower.x + lower.width * fraction;
     const underside = Math.max(...body.flatMap(([x1, y1], i) => {
      const [x2, y2] = body[(i + 1) % body.length]!;
      return x1 !== x2 && x >= Math.min(x1, x2) && x <= Math.max(x1, x2) ? [y1 + (x - x1) * (y2 - y1) / (x2 - x1)] : [];
     }));
     expect(Number.isFinite(underside)).toBe(true);
     for (let y = underside + .25; y < lower.y + .1; y += .5) {
      if (!solids.some((contours) => contours.filter((contour) => contains(contour, x, y)).length % 2 === 1)) { gaps.push(`${id}/${guard.id}: air below fore-end at ${x.toFixed(1)},${y.toFixed(1)}`); break; }
     }
    }
    expect(part(weaponBuildArt(gun), "handguard")).toBe(group);
    cases++;
   }
  }
  expect(cases).toBeGreaterThanOrEqual(40);
  expect(gaps).toEqual([]);
 });
});
