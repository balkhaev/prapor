import { WEAPON_BY_ID, type WeaponCategory } from "./game/data";
import type { WeaponInstance } from "./game/engine";
import { MODULE_BY_ID, RECEIVER_INFO, type ModuleModel, type ModuleSlot } from "./game/modules";

type Material = "steel" | "dark" | "wood" | "polymer" | "rubber" | "glass";
type Bounds = readonly [number, number, number, number];
type Geometry = { outline: string; detail: string; material: Material; bounds: Bounds };
type Profile = {
	id: string; category: WeaponCategory; wood: boolean; bolt: boolean;
	integral: boolean; pump: boolean; compact: boolean; barrelEnd: number;
};
type Paint = Record<Material, string> & { prefix: string };

const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({
	"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);
const paintId = (value: string) => `armory-${value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100)}`;
const slots: ModuleSlot[] = ["receiver", "barrel", "handguard", "stock", "magazine", "optic", "muzzle", "foregrip"];
const labels: Record<ModuleSlot, string> = {
	receiver: "Ствольная коробка", barrel: "Ствол", handguard: "Цевьё", stock: "Приклад",
	magazine: "Магазин", optic: "Прицел", muzzle: "Дульное устройство", foregrip: "Рукоятка",
};

function profile(weaponId: string): Profile {
	const category = WEAPON_BY_ID[weaponId]?.category ?? "rifle";
	return {
		id: weaponId, category, wood: ["sks", "ak74", "akm", "rpk", "mosin", "svd", "vss", "mp133", "toz"].includes(weaponId),
		bolt: weaponId === "mosin" || weaponId === "toz", integral: weaponId === "vss" || weaponId === "asval",
		pump: weaponId === "mp133", compact: weaponId === "toz" || weaponId === "pp91" || category === "pistol",
		barrelEnd: weaponId === "mosin" || weaponId === "svd" || weaponId === "rpk" || weaponId === "pkp" ? 794 : weaponId === "toz" ? 668 : weaponId === "pp91" ? 650 : category === "pistol" ? 603 : 738,
	};
}

function palette(prefix: string): { paint: Paint; defs: string } {
	const paint = Object.fromEntries(["steel", "dark", "wood", "polymer", "rubber", "glass"].map((name) => [name, `url(#${prefix}-${name})`])) as Omit<Paint, "prefix">;
	return { paint: { ...paint, prefix }, defs: `<defs>
		<linearGradient id="${prefix}-steel" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#7b827d"/><stop offset=".13" stop-color="#acb1a7"/><stop offset=".21" stop-color="#515951"/><stop offset=".58" stop-color="#414a43"/><stop offset=".82" stop-color="#28332c"/><stop offset="1" stop-color="#171f1a"/></linearGradient>
		<linearGradient id="${prefix}-dark" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#656d62"/><stop offset=".2" stop-color="#3b443c"/><stop offset=".65" stop-color="#253129"/><stop offset="1" stop-color="#141d17"/></linearGradient>
		<linearGradient id="${prefix}-wood" x1="0" y1="0" x2=".1" y2="1"><stop stop-color="#b28858"/><stop offset=".2" stop-color="#977047"/><stop offset=".55" stop-color="#765135"/><stop offset="1" stop-color="#412c21"/></linearGradient>
		<linearGradient id="${prefix}-polymer" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#6e7355"/><stop offset=".15" stop-color="#59634b"/><stop offset=".65" stop-color="#374735"/><stop offset="1" stop-color="#1d2b21"/></linearGradient>
		<linearGradient id="${prefix}-rubber" x1="0" y1="0" x2="1" y2=".25"><stop stop-color="#1c2420"/><stop offset=".5" stop-color="#3d443b"/><stop offset="1" stop-color="#101813"/></linearGradient>
		<linearGradient id="${prefix}-glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#bbcab3"/><stop offset=".25" stop-color="#639081"/><stop offset=".55" stop-color="#2d514b"/><stop offset="1" stop-color="#183630"/></linearGradient>
		<pattern id="${prefix}-wear" width="74" height="47" patternUnits="userSpaceOnUse"><path d="m6 13 14-2m24 27 8-3m-18-19 5-1m20 7 8-1" fill="none" stroke="#d4d8c5" stroke-width=".8"/><path d="m19 32 9-1m27-25 6 1" fill="none" stroke="#101911" stroke-width="1.1"/></pattern>
		<filter id="${prefix}-glow" x="-20%" y="-30%" width="140%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#e2b36c" flood-opacity=".5"/></filter>
	</defs>` };
}

const fastener = (x: number, y: number, radius = 2.5) => `<circle cx="${x}" cy="${y}" r="${radius}" fill="#989d8c" stroke="#17241b" stroke-width="1.2"/><path d="m${x - radius * .6} ${y + radius * .5} ${radius * 1.2} -${radius}" stroke="#384337" stroke-width="1"/>`;
const vents = (x: number, y: number, count: number, width = 8, height = 11, spacing = 17) => Array.from({ length: count }, (_, index) => `<rect x="${x + index * spacing}" y="${y}" width="${width}" height="${height}" rx="2" fill="#152219" stroke="#76816a" stroke-opacity=".4" stroke-width=".7"/>`).join("");
const ribs = (x: number, y: number, count: number, height: number, spacing = 7) => Array.from({ length: count }, (_, index) => `<path d="M${x + index * spacing} ${y}v${height}" stroke="#16231b" stroke-width="2"/><path d="M${x + index * spacing + 2} ${y + 1}v${height - 2}" stroke="#a0a68b" stroke-opacity=".2" stroke-width="1"/>`).join("");
const grain = (x: number, y: number, width: number, height = 25) => `<path d="M${x} ${y}q${width * .25} -4 ${width * .5} 0t${width * .5} 0m-${width} 8q${width * .3} 5 ${width * .6} 0t${width * .4} 0m-${width} ${height * .4}q${width * .2} -3 ${width * .4} 0t${width * .6} 0" fill="none" stroke="#d0a36b" stroke-width="1.1" opacity=".35"/>`;
const rail = (x: number, y: number, width: number) => `<path d="M${x} ${y}h${width}v6H${x}z" fill="#5f6a59" stroke="#152219" stroke-width="1.3"/>${Array.from({ length: Math.floor(width / 9) }, (_, index) => `<path d="M${x + 4 + index * 9} ${y}v5" stroke="#1a291d" stroke-width="3"/>`).join("")}`;

function geometry(slot: ModuleSlot, appearance: string, gun: Profile, paint: Paint): Geometry {
	const pistol = gun.category === "pistol";
	const wood = gun.wood && appearance === "factory";
	const material: Material = wood ? "wood" : "polymer";
	const end = gun.barrelEnd + (appearance === "long" ? 40 : appearance === "short" ? -55 : 0);
	switch (slot) {
		case "receiver": {
			if (pistol) return { material: "steel", bounds: [300, 96, 283, 134], outline: "M314 105h241l20 13v27H403l-13 81h-53l13-69h-31l-15-20z", detail: `<path d="M318 108h234l17 12H317z" fill="#afb4a6" opacity=".34"/><path d="M322 127h245M400 145h155" stroke="#111e16" stroke-width="3"/><path d="M356 158h39l-12 61h-39z" fill="${paint.wood}"/>${ribs(355, 169, 5, 37, 6)}<path d="M407 151h52q7 0 3 14l-9 24h-54l2-8h43l8-24h-42z" fill="${paint.dark}"/><path d="M414 149v20h6l5-20" fill="#a5aa99"/>${ribs(325, 114, 8, 19, 5)}${fastener(374, 167)}${fastener(365, 206)}<path d="M329 99h10v7h-10m194-9h7v10h-7" fill="${paint.dark}"/><path d="M462 118h69v4h-69" fill="#152219"/>` };
			if (gun.bolt) return { material: "steel", bounds: [313, 111, 166, 103], outline: "M329 119h137l10 8v22H330l-14-8z", detail: `<path d="M335 123h124v5H335" fill="#b3b6a5" opacity=".65"/><path d="M364 120v27m54-27v27" stroke="#162319" stroke-width="2"/><path d="M424 133h40v7h-40" fill="#17271b"/><path d="m420 128-18 26 11 11" fill="none" stroke="#9da690" stroke-width="7"/><circle cx="415" cy="166" r="8" fill="${paint.dark}"/><path d="M334 150h-3l-15 45h16l19-45m15 0h41q3 0 2 7l-8 23h-44l-2-7h38l7-19h-33" fill="${paint.dark}"/>${fastener(343, 138)}${fastener(453, 142)}<path d="M369 129h39v9h-39" fill="#14251b"/>` };
			if (gun.pump) return { material: "steel", bounds: [323, 112, 166, 111], outline: "M330 116h136l14 13v36H331z", detail: `<path d="M334 119h125l13 11H334z" fill="#b0b5a5" opacity=".35"/><path d="M387 135h72v18h-72" fill="#14251b"/><path d="M396 139h55v5h-55" fill="#b0b5a4" opacity=".45"/><path d="M343 165h29l-14 53h-29z" fill="${paint.wood}"/>${grain(337, 184, 24, 24)}<path d="M374 165h61v23h-69l3-8h58v-11h-53" fill="${paint.dark}"/>${fastener(344, 142)}${fastener(466, 159)}<path d="M341 109h12v8h-12" fill="${paint.dark}"/>` };
			const kedr = gun.id === "pp91";
			return { material: "dark", bounds: [319, 101, 184, 119], outline: kedr ? "M326 107h150l15 15v44H329z" : "M323 119h168v47H322z", detail: `<path d="M328 ${kedr ? 109 : 108}h140l22 13H325z" fill="${paint.steel}"/><path d="M328 122h157v5H328" stroke="#c2c6b1" stroke-opacity=".28"/><path d="M377 131h90v18h-90" fill="#15271b"/><path d="M433 137h50v5h-42l-7 9h-10z" fill="#9fa992"/><path d="m337 166 38-1-12 55h-36z" fill="${gun.id === "akm" ? paint.wood : paint.rubber}"/>${ribs(338, 180, 4, 25, 6)}<path d="M379 165h43v25h-49l3-7h37v-15h-34z" fill="${paint.steel}"/><path d="m389 166-3 12h6l3-12" fill="#b7baa4"/><path d="M330 156h73v4h-73" fill="#0f2014"/><path d="M435 153h44v6h-44l-2-8" stroke="#9ea789" stroke-width="1.2" fill="none"/>${fastener(337, 136)}${fastener(350, 156)}${fastener(473, 158)}<path d="M350 130h12v7h-12" fill="#adaf96" opacity=".48"/>${gun.id === "pkp" ? `<path d="M357 109v-23h74v23m-71-20h68" fill="none" stroke="#5d6b55" stroke-width="9"/>` : ""}` };
		}
		case "stock": {
			if (pistol) return { outline: "M144 149h173v17H177l-25 41h-17z", detail: "", material: "steel", bounds: [132, 145, 186, 67] };
			if (appearance === "folding" || gun.id === "toz" || gun.id === "pp91" || gun.id === "asval") return { outline: "M116 147h196l15 10v14H139v48h-22z", material: "steel", bounds: [109, 142, 219, 80], detail: `<path d="M142 167h149l-145 34" fill="none" stroke="#7a856e" stroke-width="8"/><path d="M125 149v65" stroke="#acb49b" stroke-width="2"/><path d="M111 191h14v31h-14z" fill="${paint.rubber}"/>${fastener(309, 156, 4)}<path d="M287 160h18v8h-18" fill="#0d2113"/>` };
			if (appearance === "tactical" || appearance === "light") return { outline: "M111 150h177l34-5v24h-45l-14 50H112z", material: "polymer", bounds: [105, 136, 222, 87], detail: `<path d="M193 140h125v12H193z" fill="${paint.steel}"/><path d="M130 164h88v23h-84z" fill="#17271a"/><path d="M238 159h33l-12 50h-30z" fill="${paint.rubber}"/><path d="M113 151h12v70h-12z" fill="${paint.rubber}"/>${ribs(132, 197, 12, 13, 7)}${fastener(259, 173, 4)}<path d="M142 155h66" stroke="#a2a783" stroke-width="2" opacity=".65"/>` };
			if (gun.id === "vss" || gun.id === "svd") return { outline: "M104 148q28-9 70-3l88 2 57-8v25l-38 17-15 44h-46l-28-32-74 29h-16z M148 161l50 1 31 38h23l16-30-15-10-45-1-54 17z", material: "wood", bounds: [98, 140, 221, 89], detail: `${grain(123, 153, 127, 20)}<path d="M103 173h12v52h-12z" fill="${paint.rubber}"/>${fastener(242, 211, 3)}${fastener(301, 153, 3)}<path d="M153 148h99" stroke="#dbb279" stroke-width="2" opacity=".4"/>` };
			return { outline: "M106 148 211 134h52l61 12v23h-52l-38 15-108 39h-24z", material, bounds: [97, 131, 229, 96], detail: `<path d="M109 151 213 138h46l58 12v5h-59l-39-4-109 19z" fill="#d9b584" opacity="${wood ? ".28" : ".16"}"/>${wood ? grain(128, 159, 127, 37) : ribs(163, 154, 10, 32)}<path d="M100 169h13l9 55h-18z" fill="${paint.rubber}"/><path d="m207 168 26-2-28 14-65 25" stroke="#302d23" stroke-width="2" fill="none" opacity=".4"/>${fastener(281, 155, 3)}<path d="M132 193h16v5h-16" fill="#4c5842"/>` };
		}
		case "barrel": {
			if (pistol) return { outline: `M550 128h${end - 550}v13h-${end - 550}z`, detail: `<path d="M553 130h${end - 555}" stroke="#c1c5b4" stroke-width="2" opacity=".7"/><path d="M${end - 7} 127v15" stroke="#142218" stroke-width="2"/>`, material: "steel", bounds: [548, 126, end - 546, 18] };
			if (gun.integral) return { outline: `M486 128h${end - 486}q8 0 8 8v14q0 8-8 8H486z`, detail: `<path d="M491 132h${end - 491}" stroke="#b6c0aa" stroke-opacity=".42" stroke-width="2"/><path d="M${end - 18} 129v28m-5-28v28m-157-28v28" stroke="#1b2a20" stroke-width="3"/>${vents(586, 141, 7, 4, 4, 12)}<path d="M${end - 12} 153h14" stroke="#536650" stroke-width="2"/>`, material: "dark", bounds: [483, 126, end - 474, 35] };
			const thick = gun.id === "pkp" || gun.category === "shotgun";
			return { outline: `M472 133h${end - 472}v${thick ? 14 : 9}H472z`, detail: `<path d="M481 135h${end - 485}" stroke="#b6bfa7" stroke-width="2" opacity=".56"/><path d="M${end - 23} 130v20m-4-20v20" stroke="#293f2c" stroke-width="3"/><path d="M${end - 34} 118h11v17h-11m2-16h7v-6h-7" fill="${paint.dark}"/>${gun.bolt ? "" : `<path d="M507 113h130v8H507zM629 114h10v22h-10" fill="${paint.steel}"/><path d="M511 114h116" stroke="#bbc3a9" stroke-opacity=".42" stroke-width="1.5"/>`}${gun.id === "pkp" ? `${ribs(626, 138, 14, 10, 10)}<path d="m667 150-15 79m17-79 23 80m-45 0h10m31 0h11" fill="none" stroke="#576f51" stroke-width="5"/>` : ""}`, material: "steel", bounds: [470, 110, end - 467, gun.id === "pkp" ? 123 : 42] };
		}
		case "handguard": {
			if (pistol) return { outline: "M475 145h77v10h-77z", detail: rail(478, 149, 71), material: "dark", bounds: [473, 143, 82, 19] };
			const right = gun.compact ? 601 : gun.integral ? 578 : 636;
			const light = appearance === "light";
			return { outline: `M483 132h${right - 498}l15 9v32H487l-8-12z`, material: appearance === "rail" ? "dark" : material, bounds: [475, 119, right - 470, 60], detail: `<path d="M487 135h${right - 502}l10 6H486z" fill="#d2c099" opacity="${wood ? ".32" : ".18"}"/>${appearance === "rail" ? `${rail(486, 125, right - 490)}${rail(493, 172, right - 501)}${vents(492, 143, Math.floor((right - 505) / 17), 10, 12)}` : wood ? `${grain(492, 153, right - 504, 19)}${vents(494, 136, Math.floor((right - 510) / 20), 9, 6, 20)}` : `${vents(492, 143, Math.floor((right - 508) / (light ? 24 : 16)), light ? 16 : 8, 12, light ? 24 : 16)}${ribs(491, 163, Math.floor((right - 505) / 8), 9, 8)}`}${gun.pump ? `<path d="M485 169h${right - 490}v10H485z" fill="${paint.steel}"/>${ribs(486, 138, 15, 34, 9)}` : ""}${fastener(488, 163, 2.6)}${fastener(right - 10, 162, 2.6)}` };
		}
		case "magazine": {
			const extended = appearance === "extended";
			const quick = appearance === "quick";
			if (pistol) return { outline: `M346 194h43l-${extended ? 13 : 6} ${extended ? 58 : 34}h-44z`, detail: `<path d="m349 208 30 1m-33 9 30 1" stroke="#65725e" stroke-width="2"/>${extended ? ribs(342, 226, 5, 20, 6) : ""}<path d="M${extended ? 330 : 335} ${extended ? 246 : 225}h48v7h-48z" fill="${paint.rubber}"/>`, material: "dark", bounds: [327, 192, 65, extended ? 64 : 44] };
			if (gun.pump) return { outline: `M468 154h${extended ? 273 : 228}v10H468z`, material: "steel", bounds: [465, 152, extended ? 279 : 234, 17], detail: `<path d="M477 156h${extended ? 252 : 207}" stroke="#929e88" stroke-width="1.5"/><path d="M${extended ? 733 : 688} 153v12" stroke="#14281a" stroke-width="3"/>` };
			if (gun.id === "mosin" || (gun.id === "sks" && !extended)) return { outline: "M407 165h58l-7 36h-37l-14-13z", material: "dark", bounds: [404, 162, 64, 43], detail: `<path d="M416 174h42l-5 21h-29z" fill="#58654c"/><path d="M421 182h29m-29 6h27" stroke="#273e29" stroke-width="2"/>${fastener(439, 194, 2)}` };
			if (gun.id === "pkp") return { outline: "M408 167h105v72H408z", material: "polymer", bounds: [405, 164, 111, 80], detail: `<path d="M410 173h102v9H410" fill="#889279" opacity=".3"/>${ribs(421, 187, 9, 43, 10)}<path d="M408 239h109v5H408" fill="${paint.dark}"/>${fastener(420, 177)}${fastener(504, 177)}` };
			if (gun.id === "pp91" || gun.category === "smg") return { outline: `M420 166h41l${extended ? 5 : 3} ${extended ? 85 : 63}h-43z`, material: "dark", bounds: [416, 163, 57, extended ? 96 : 74], detail: `<path d="m430 174 2 ${extended ? 66 : 46}m15-${extended ? 66 : 46} 2 ${extended ? 66 : 46}" stroke="#78856b" stroke-width="2"/><path d="M419 ${extended ? 248 : 226}h49v8h-49" fill="${paint.rubber}"/>${quick ? `<path d="M433 230v16h21v-16" stroke="#7d886b" stroke-width="6" fill="none"/>` : ""}` };
			const depth = extended ? 94 : 73;
			return { outline: `M419 166h48q-2 ${depth * .52} 31 ${depth - 10}l-32 20q-43-32-47-${depth + 10}z`, material: gun.id === "akm" && appearance === "factory" ? "wood" : "polymer", bounds: [415, 163, 89, depth + 30], detail: `<path d="M429 173h27q0 ${depth * .55} 29 ${depth - 11}l-15 9q-35-29-41-${depth - 2}z" fill="#a0a584" opacity=".28"/><path d="m434 186q4 ${depth * .57} 31 ${depth - 18}m-19-${depth - 19}q4 ${depth * .48} 23 ${depth - 23}" fill="none" stroke="#263d29" stroke-width="3"/><path d="m464 ${depth + 172} 37-22 5 7-37 23z" fill="${paint.rubber}"/>${quick ? `<path d="m474 ${depth + 174} 11 11 25-16-9-13" stroke="#9da080" stroke-width="6" fill="none"/>` : ""}${fastener(444, 180, 2)}` };
		}
		case "optic": {
			if (appearance === "reflex") return { outline: "M386 96h77v12h-77zM397 91V63q0-6 7-6h39q7 0 7 7v27z", material: "dark", bounds: [382, 52, 85, 59], detail: `<path d="M406 63h31q6 0 6 6v18h-37z" fill="${paint.glass}" stroke="#8c9e83" stroke-width="2"/><path d="m409 65 27 18" stroke="#c9d3b8" stroke-width="2" opacity=".42"/><circle cx="429" cy="75" r="2.5" fill="#e6b95c"/><path d="M391 99h65v5h-65" fill="#727c67"/>${fastener(449, 95, 3)}` };
			return { outline: "M366 69h113v21H366zM349 64h23v31h-23zM475 59h39v41h-39zM385 90h10v21h-10zM456 90h10v21h-10z", material: "dark", bounds: [342, 46, 179, 68], detail: `<path d="M365 72h112" stroke="#a4b294" stroke-width="2" opacity=".5"/><path d="M477 62h33v6h-33" fill="#76876c"/><ellipse cx="512" cy="80" rx="5" ry="17" fill="${paint.glass}" stroke="#172c1e" stroke-width="2"/><path d="M349 65v29m5-29v29m130-31v34m6-34v34" stroke="#17281b" stroke-width="2"/><path d="M417 68V53h18v15m-23-14h28v5h-28" fill="${paint.steel}"/>${ribs(417, 50, 4, 10, 4)}<path d="M409 82h15v13h-15" fill="${paint.steel}"/>${fastener(417, 88, 4)}${fastener(390, 103, 3)}${fastener(461, 103, 3)}${appearance === "dovetail" ? `<path d="M386 109v14h76v-14" fill="none" stroke="#5b6d53" stroke-width="6"/>` : rail(375, 106, 104)}` };
		}
		case "muzzle": {
			const x = gun.barrelEnd;
			if (appearance === "suppressor") return { outline: `M${x - 11} 122h86q6 0 6 6v21q0 6-6 6h-86z`, material: "dark", bounds: [x - 15, 119, 112, 40], detail: `<path d="M${x - 8} 125h86" stroke="#9fac95" stroke-opacity=".5" stroke-width="2"/><path d="M${x + 72} 123v31m-5-31v31M${x - 3} 123v31m5-31v31" stroke="#162c1b" stroke-width="2"/>${ribs(x + 5, 134, 9, 11, 7)}<path d="M${x + 80} 124h4v28h-4" fill="#15291a"/>` };
			return { outline: `M${x - 12} 129h47v21h-47z`, material: "steel", bounds: [x - 15, 126, 54, 29], detail: `<path d="M${x - 8} 131h36" stroke="#c2c7af" stroke-width="1.4" opacity=".75"/>${vents(x + 1, 134, 3, 4, 12, 10)}<path d="M${x + 28} 129v21" stroke="#172c1c" stroke-width="3"/>` };
		}
		case "foregrip": {
			if (appearance === "light") return { outline: "M538 175h62v10h-14l-20 31h-24l-9-9 15-24h-10z", material: "polymer", bounds: [529, 172, 75, 49], detail: `<path d="m549 185-11 20 7 6h14l17-26z" fill="#182c1e"/><path d="m546 211 15-25" stroke="#8a956e" stroke-width="2" opacity=".6"/>${fastener(550, 179)}${fastener(590, 179)}` };
			return { outline: "M550 176h47v11h-9l-3 53h-28l-4-53h-3z", material: "rubber", bounds: [546, 173, 55, 71], detail: `<path d="M558 184h26v50h-25z" fill="#556446"/>${ribs(561, 194, 3, 34, 7)}<path d="M555 235h32v8h-32" fill="#17291b"/>${fastener(556, 181, 2)}${fastener(591, 181, 2)}` };
		}
	}
}

function renderPart(shape: Geometry, paint: Paint, slot: ModuleSlot, installed: boolean, selected: boolean, durability = 100): string {
	if (!installed) return `<g data-module-slot="${slot}" class="weapon-part weapon-part--missing"><path d="${shape.outline}" fill="#596751" fill-opacity=".06" stroke="${selected ? "#e5b970" : "#77806b"}" stroke-opacity="${selected ? ".9" : ".38"}" stroke-width="${selected ? "2" : "1.2"}" stroke-dasharray="6 5" fill-rule="evenodd"/></g>`;
	const wear = Math.max(.03, Math.min(.65, (100 - durability) / 140));
	return `<g data-module-slot="${slot}" class="weapon-part${selected ? " weapon-part--selected" : ""}"><path d="${shape.outline}" fill="${paint[shape.material]}" stroke="#0c1b10" stroke-width="2" fill-rule="evenodd"/>${shape.detail}<path d="${shape.outline}" fill="url(#${paint.prefix}-wear)" opacity="${wear.toFixed(2)}" fill-rule="evenodd"/>${selected ? `<path d="${shape.outline}" fill="none" stroke="#e5bb77" stroke-width="2.5" stroke-opacity=".9" fill-rule="evenodd" filter="url(#${paint.prefix}-glow)"/>` : ""}</g>`;
}

/** The silhouette is assembled from the actual installed parts; it is never a weapon thumbnail. */
export function weaponBuildArt(weapon: WeaponInstance, selectedSlot?: ModuleSlot): string {
	const baseGun = profile(weapon.weaponId);
	const { paint, defs } = palette(paintId(weapon.id));
	const installed = weapon.modules;
	const barrelAppearance = installed.barrel ? MODULE_BY_ID[installed.barrel.modelId]?.appearance : undefined;
	const gun = { ...baseGun, barrelEnd: baseGun.barrelEnd + (barrelAppearance === "long" ? 40 : barrelAppearance === "short" ? -55 : 0) };
	const required = RECEIVER_INFO[weapon.weaponId]?.requiredSlots ?? ["receiver", "barrel", "magazine"];
	const drawOrder: ModuleSlot[] = ["stock", "barrel", "magazine", "receiver", "handguard", "foregrip", "muzzle", "optic"];
	const partArt = drawOrder.map((slot) => {
		const instance = installed[slot];
		const model = instance ? MODULE_BY_ID[instance.modelId] : undefined;
		if (!model && !required.includes(slot) && selectedSlot !== slot) return "";
		const shape = geometry(slot, slot === "barrel" ? "factory" : model?.appearance ?? "factory", gun, paint);
		return renderPart(shape, paint, slot, Boolean(model), selectedSlot === slot, instance?.durability);
	}).join("");
	const title = WEAPON_BY_ID[weapon.weaponId]?.name ?? "Оружие";
	const missing = required.filter((slot) => !installed[slot]);
	const accessible = `${title}. ${missing.length ? `Не хватает: ${missing.map((slot) => labels[slot]).join(", ")}.` : "Собранное оружие."}${selectedSlot ? ` Выбран модуль: ${labels[selectedSlot]}.` : ""}`;
	return `<svg class="weapon-build-art" viewBox="0 0 900 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escape(accessible)}"><title>${escape(accessible)}</title>${defs}<ellipse cx="450" cy="259" rx="322" ry="10" fill="#061009" opacity=".34"/><g stroke-linejoin="round" stroke-linecap="round">${partArt}</g></svg>`;
}

/** The carried weapon uses the very same installed-part geometry as the workbench. */
export function weaponActorArt(weapon: WeaponInstance): { svg: string; width: number; height: number; grip: { x: number; y: number }; muzzle: { x: number; y: number } } {
	const base = profile(weapon.weaponId), installed = weapon.modules;
	const barrel = installed.barrel ? MODULE_BY_ID[installed.barrel.modelId]?.appearance : undefined;
	const gun = { ...base, barrelEnd: base.barrelEnd + (barrel === "long" ? 40 : barrel === "short" ? -55 : 0) };
	const { paint, defs } = palette(paintId(weapon.id));
	const parts = (["stock", "barrel", "magazine", "receiver", "handguard", "foregrip", "muzzle", "optic"] as ModuleSlot[]).flatMap((slot) => {
		const instance = installed[slot], model = instance ? MODULE_BY_ID[instance.modelId] : undefined;
		return model ? [{ shape: geometry(slot, slot === "barrel" ? "factory" : model.appearance, gun, paint), slot, instance }] : [];
	});
	const left = Math.min(370, ...parts.map(({ shape }) => shape.bounds[0])) - 4;
	const top = Math.min(120, ...parts.map(({ shape }) => shape.bounds[1])) - 4;
	const right = Math.max(gun.barrelEnd, ...parts.map(({ shape }) => shape.bounds[0] + shape.bounds[2])) + 4;
	const bottom = Math.max(210, ...parts.map(({ shape }) => shape.bounds[1] + shape.bounds[3])) + 4;
	const width = right - left, height = bottom - top;
	const muzzlePart = parts.find(({ slot }) => slot === "muzzle");
	const muzzleX = muzzlePart ? muzzlePart.shape.bounds[0] + muzzlePart.shape.bounds[2] - 10 : gun.barrelEnd;
	return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}">${defs}<g stroke-linejoin="round" stroke-linecap="round">${parts.map(({ shape, slot, instance }) => renderPart(shape, paint, slot, true, false, instance?.durability)).join("")}</g></svg>`, width, height,
		grip: { x: 410 - left, y: 175 - top }, muzzle: { x: muzzleX - left, y: 138 - top } };
}

function moduleProfile(model: ModuleModel): Profile {
	if (model.weaponId) return profile(model.weaponId);
	const platform = model.platforms.join(" ").toLowerCase();
	const caliber = model.calibers.join(" ").toLowerCase();
	if (platform.includes("pp91") || platform.includes("kedr")) return profile("pp91");
	if (platform.includes("pistol") || platform.includes("pm") || platform.includes("tt")) return profile("pm");
	if (platform.includes("mosin") || platform.includes("bolt")) return profile("mosin");
	if (platform.includes("sks")) return profile("sks");
	if (platform.includes("mp133") || platform.includes("pump")) return profile("mp133");
	if (platform.includes("toz")) return profile("toz");
	if (platform.includes("vss") || platform.includes("val") || caliber.includes("9x39")) return profile("vss");
	if (platform.includes("smg") || platform.includes("vityaz") || caliber.includes("9x19")) return profile("vityaz");
	if (platform.includes("svd")) return profile("svd");
	if (platform.includes("pkp")) return profile("pkp");
	if (platform.includes("saiga") || caliber.includes("12")) return profile("saiga");
	if (platform.includes("rpk")) return profile("rpk");
	if (caliber.includes("9x18") || caliber.includes("7.62x25")) return profile("pm");
	return profile("ak74");
}

/** Shared material treatment keeps loose loot recognizable beside the corresponding assembled part. */
export function moduleArt(model: ModuleModel): string {
	const { paint, defs } = palette(paintId(model.id));
	const shape = geometry(model.slot, model.appearance, moduleProfile(model), paint);
	const [x, y, width, height] = shape.bounds;
	const scale = Math.min(214 / width, 91 / height);
	const translateX = 120 - (x + width / 2) * scale;
	const translateY = 55 - (y + height / 2) * scale;
	return `<svg class="module-art" viewBox="0 0 240 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escape(model.label)}"><title>${escape(model.label)}</title>${defs}<ellipse cx="120" cy="107" rx="${Math.min(97, width * scale * .42).toFixed(1)}" ry="4" fill="#06100a" opacity=".35"/><g transform="translate(${translateX.toFixed(2)} ${translateY.toFixed(2)}) scale(${scale.toFixed(4)})" stroke-linejoin="round" stroke-linecap="round">${renderPart(shape, paint, model.slot, true, false)}</g></svg>`;
}

export const ARMORY_SLOT_ORDER: readonly ModuleSlot[] = slots;
