import { WEAPON_BY_ID, type WeaponCategory } from "./game/data";
import type { WeaponInstance } from "./game/engine";
import { FACTORY_KITS, MODULE_BY_ID, RECEIVER_INFO, type ModuleModel, type ModuleSlot } from "./game/modules";

import { createArmorySurface, surfaceDetail, type ArmoryMaterial as Material, type ArmoryPaint as Paint } from "./armory-surface";
import { modularWeaponRasterDefs, modularWeaponRasterPart } from "./modular-weapon-art";
import { weaponGripAnchor } from "./weapon-attachment";
type Bounds = readonly [number, number, number, number];
type Geometry = { outline: string; detail: string; material: Material; bounds: Bounds; fillRule?: "evenodd" | "nonzero"; muzzle?: { x: number; y: number }; offset?: { x: number; y: number } };
type Profile = {
	id: string; category: WeaponCategory; wood: boolean; bolt: boolean;
	integral: boolean; pump: boolean; compact: boolean; barrelEnd: number;
};

const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({
	"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);
const paintId = (value: string) => `armory-${value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100)}`;
const slots: ModuleSlot[] = ["receiver", "barrel", "handguard", "stock", "magazine", "optic", "muzzle", "foregrip", "mount", "flashlight", "laser"];
const drawOrder: readonly ModuleSlot[] = ["stock", "barrel", "magazine", "receiver", "handguard", "foregrip", "muzzle", "mount", "flashlight", "laser", "optic"];
const labels: Record<ModuleSlot, string> = {
	receiver: "Ствольная коробка", barrel: "Ствол", handguard: "Цевьё", stock: "Приклад",
	magazine: "Магазин", optic: "Прицел", muzzle: "Дульное устройство", foregrip: "Рукоятка", mount: "Крепление", flashlight: "Фонарь", laser: "Лазер",
};

function profile(weaponId: string): Profile {
	const category = WEAPON_BY_ID[weaponId]?.category ?? "rifle";
	return {
		id: weaponId, category, wood: ["sks", "ak74", "akm", "rpk", "mosin", "svd", "vss", "mp133", "toz", "vpo209", "svdk", "m870"].includes(weaponId),
		bolt: ["mosin", "toz", "trg42", "awm"].includes(weaponId), integral: weaponId === "vss" || weaponId === "asval",
		pump: weaponId === "mp133" || weaponId === "m870", compact: ["toz", "pp91", "p90", "mp7", "ump45", "aug", "vector", "sr2", "ash12"].includes(weaponId) || category === "pistol",
		barrelEnd: ({ m4a1: 760, hk416: 748, p90: 675, mp7: 654, ump45: 676, m1911: 615, mcx: 716, scarh: 776, trg42: 874, g36: 768, aug: 712, fal: 827, sr25: 854, vector: 658, fiveseven: 622, sr2: 649, sr1: 610, glock20: 619, ash12: 736, vpo209: 751, svdk: 850, awm: 900, m870: 838 } as Record<string, number>)[weaponId]
			?? (weaponId === "mosin" || weaponId === "svd" || weaponId === "rpk" || weaponId === "pkp" ? 794 : weaponId === "toz" ? 668 : weaponId === "pp91" ? 650 : category === "pistol" ? 603 : 738),
	};
}

// One adjusted profile anchors every installed front-end part to the current
// barrel. Loose barrels use this same calculation before being fitted to a card.
function barrelProfile(gun: Profile, appearance = "factory"): Profile {
	// A compact pistol barrel still exits its own slide; a PDW barrel still
	// clears its fixed fore-end. Their actual muzzle cannot retract into it.
	const short = gun.category === "pistol" ? -8 : ["mp7", "pp91", "sr2"].includes(gun.id) ? -40 : -55;
	const extension: Record<string, number> = { long: 40, short, heavy: 20, fluted: 30 };
	return { ...gun, barrelEnd: gun.barrelEnd + (extension[appearance] ?? 0) };
}

function installedBarrelProfile(base: Profile, modules: WeaponInstance["modules"]): Profile {
	const model = modules.barrel ? MODULE_BY_ID[modules.barrel.modelId] : undefined;
	const physical = model ? moduleProfile(model) : base;
	return { ...base, barrelEnd: barrelProfile(physical, model?.appearance).barrelEnd };
}

const palette = createArmorySurface;

const fastener = (x: number, y: number, radius = 2.5) => `<circle cx="${x}" cy="${y}" r="${radius}" fill="#737c80" stroke="#1b1e20" stroke-width=".9"/><path d="m${x - radius * .62} ${y + radius * .43} ${radius * 1.24} -${radius * .86}" stroke="#1f292f" stroke-width=".9"/><path d="m${x - radius * .4} ${y - radius * .66} ${radius * .67} -.1" stroke="#a6adae" stroke-width=".55" opacity=".65"/>`;
const vents = (x: number, y: number, count: number, width = 8, height = 11, spacing = 17) => Array.from({ length: count }, (_, index) => `<rect x="${x + index * spacing}" y="${y}" width="${width}" height="${height}" rx="2" fill="#191c1e" stroke="#747779" stroke-opacity=".4" stroke-width=".7"/>`).join("");
const ribs = (x: number, y: number, count: number, height: number, spacing = 7) => Array.from({ length: count }, (_, index) => `<path d="M${x + index * spacing} ${y}v${height}" stroke="#1a1d1f" stroke-width="2"/><path d="M${x + index * spacing + 2} ${y + 1}v${height - 2}" stroke="#999c9e" stroke-opacity=".2" stroke-width="1"/>`).join("");
const grain = (x: number, y: number, width: number, height = 25) => `<path d="M${x} ${y}q${width * .25} -4 ${width * .5} 0t${width * .5} 0m-${width} 8q${width * .3} 5 ${width * .6} 0t${width * .4} 0m-${width} ${height * .4}q${width * .2} -3 ${width * .4} 0t${width * .6} 0" fill="none" stroke="#d0a36b" stroke-width="1.1" opacity=".35"/>`;
const rail = (x: number, y: number, width: number) => `<path d="M${x} ${y}h${width}v6H${x}z" fill="#535b60" stroke="#191c1e" stroke-width="1"/>${Array.from({ length: Math.floor(width / 9) }, (_, index) => `<path d="M${x + 4 + index * 9} ${y + .5}v4.5" stroke="#1e2123" stroke-width="2.6"/>`).join("")}<path d="M${x + 1} ${y + 1}h${width - 2}" stroke="#a1a7a7" stroke-width=".55" opacity=".55"/>`;
// A railed fore-end includes a receiver-spanning bridge: the optic sits on a
// physical rail even when this is the only part providing a top attachment.
const topBridge = (right: number) => `${rail(375, 108, right - 386)}<path d="M481 113h14v20h-14z" fill="#3a3d3f" stroke="#1a1d1f" stroke-width="1.4"/>`;

const seam = (path: string, bright = false) => `<path d="${path}" fill="none" stroke="${bright ? "#9c9fa1" : "#111619"}" stroke-width="${bright ? ".8" : "1.3"}" opacity="${bright ? ".52" : ".85"}"/>`;
const checkering = (x: number, y: number, width: number, height: number) => `${Array.from({ length: Math.floor(height / 5) }, (_, i) => seam(`M${x} ${y + i * 5}l${width} 4`)).join("")}${Array.from({ length: Math.floor(width / 5) }, (_, i) => seam(`M${x + i * 5} ${y}l-3 ${height}`)).join("")}`;
const triggerGuard = (x: number, y: number, width = 44, height = 24) => `<path data-mechanism="trigger-guard" d="M${x} ${y}h${width}v${height - 7}q0 7-8 7h-${width - 9}q-7 0-5-8l4-${height - 8}" fill="none" stroke="#667177" stroke-width="3.3"/>${seam(`M${x + 2} ${y + 2}h${width - 5}v${height - 9}q0 5-6 5h-${width - 15}`, true)}<path data-mechanism="trigger" d="M${x + 15} ${y + 2}q-4 9 1 15l5-2q-4-5 0-13z" fill="#797d7d" stroke="#13191c" stroke-width=".9"/>`;
const port = (x: number, y: number, width: number, height = 16) => `<path data-mechanism="ejection-port" d="M${x} ${y}h${width}v${height}h-${width}z" fill="#11171a" stroke="#626c70" stroke-width=".65"/><path d="M${x + 1} ${y + 1}h${width - 2}v3h-${width - 2}z" fill="#080f13"/><path data-mechanism="bolt" d="M${x + width * .35} ${y + height * .55}h${width * .57}v${height * .3}h-${width * .57}z" fill="#525d63"/>${seam(`M${x + width * .38} ${y + height * .56}h${width * .5}`, true)}${seam(`M${x + width - 13} ${y + 3}v${height - 5}`)}`;
const selector = (x: number, y: number, length: number, stamped = false) => `<path data-mechanism="selector" d="M${x} ${y}h${length}l5 5h-${length + 4}z" fill="#5a6062" stroke="#161d21" stroke-width=".9"/>${fastener(x + 4, y + 3, 2.6)}${seam(`M${x + 10} ${y + 1}h${length - 10}`, true)}${stamped ? seam(`M${x + 21} ${y - 4}h7m-7 12h7`) : ""}`;

const newProfiles = new Set(["m4a1", "hk416", "p90", "mp7", "ump45", "m1911", "mcx", "scarh", "trg42"]);
const waveProfiles = new Set(["g36", "aug", "fal", "sr25", "vector", "fiveseven", "sr2", "sr1", "glock20", "ash12", "vpo209", "svdk", "awm", "m870"]);
const bullpups = new Set(["aug", "ash12"]);
const waveFront = (gun: Profile) => gun.id === "vector" ? 585 : gun.compact ? 601 : gun.id === "awm" || gun.id === "svdk" ? 701 : 636;

/** Additional silhouettes remain code-native; generated assets only supply paint. */
function waveReceiverGeometry(gun: Profile, paint: Paint): Geometry | undefined {
	if (!waveProfiles.has(gun.id)) return undefined;
	if (gun.category === "pistol") {
		const glock = gun.id === "glock20", five = gun.id === "fiveseven";
		const outline = glock ? "M310 104h277v40H411l-23 84h-59l18-74h-26l-11-12z" : five ? "M307 110l19-12h233l31 15v32h-37v12H416l-21 77h-61l15-76h-30z" : "M313 108h254l23 18v28H419l-16 80h-65l13-71h-30l-8-16z";
		return { material: glock || five ? "polymer" : "steel", bounds: [301, 91, 297, 151], outline, detail: `${seam(glock ? "M314 108h269v31H316" : five ? "M328 102h230l26 15M311 142h273" : "M316 112h247l20 17M318 149h265", true)}${port(five ? 466 : 477, 116, five ? 66 : 56, glock ? 15 : 18)}${Array.from({ length: glock ? 8 : 10 }, (_, i) => seam(`M${321 + i * 4.8} 115l-3 18`)).join("")}${triggerGuard(406, 157, glock ? 59 : 53, 33)}<path data-mechanism="${glock ? "glock-polymer-frame" : five ? "five-seven-polymer-frame" : "sr1-wide-slide"}" d="M356 171h34l-11 52h-36z" fill="${paint.rubber}"/>${checkering(351, 178, 31, 34)}${fastener(394, 152, 2.4)}${seam("M385 146h42v5h-42z")}${selector(340, 149, 22)}<path data-mechanism="iron-sights" d="M330 96h12v8h-12M564 98h9v7h-9z" fill="${paint.dark}"/>${glock ? seam("M365 186l17 3m-19 8 17 3") : `<path d="M311 107l-9-10h10l11 15v8h-10z" fill="${paint.dark}"/>`}` };
	}
	if (bullpups.has(gun.id)) {
		const ash = gun.id === "ash12";
		return { material: ash ? "steel" : "polymer", fillRule: "evenodd", bounds: [244, 104, 364, 128], outline: ash ? "M248 128l15-9h253l28 7 34 19v27l-13 6h-54l-20 48h-43l13-50H268l-20-15z" : "M248 145q0-13 14-17l45-12h172q16 0 25 8l34 22v28l-12 7h-51l-20 46h-39l11-51h-35l-32 23h-86q-26 0-26-25zM431 172h30l-9 30h-27z", detail: `${rail(351, 108, 231)}${seam(ash ? "M263 124h251l28 7 28 18M266 166h180" : "M259 142q0-8 14-12l37-8h166q13 0 24 10l27 17M269 189h80l31-21", true)}${port(307, ash ? 136 : 143, ash ? 83 : 69, 18)}${triggerGuard(ash ? 452 : 428, 171, ash ? 49 : 43, 27)}${selector(447, 156, 21)}<path data-mechanism="bullpup-rear-box-feed" d="M309 164h60v15h-60z" fill="${paint.dark}"/>${fastener(268, 152, 3)}${fastener(404, 150, 3)}${fastener(528, 164, 3)}${ribs(269, 154, 5, 24, 8)}${ash ? `<path data-mechanism="ash12-carry-bridge" d="M353 108v-20h147v20m-139-3V96h131v9" fill="none" stroke="#3a444a" stroke-width="6"/>${seam("M368 90h116", true)}<path data-hardware="ash12-upper-reinforcement" d="M271 130h243v5H271z" fill="${paint.dark}" opacity=".45"/>${seam("M402 142h34v12h-34")}` : `<path data-mechanism="aug-angled-charging-handle" d="M497 137l20-11h15v10l-26 13z" fill="${paint.steel}"/><path data-hardware="aug-cheek-panel" d="M270 130l43-8h93v13H278z" fill="${paint.polymer}" opacity=".45"/>${seam("M381 157h29M281 181h69")}`}` };
	}
	if (gun.id === "vector") return { material: "polymer", bounds: [304, 104, 268, 147], outline: "M314 115h203l30 20v33h-61v72h-69v-66h-40l-14 56h-42l11-62h-18z", detail: `${rail(325, 108, 222)}${port(434, 131, 65, 18)}${seam("M320 121h189l30 19M420 171h59v60", true)}<path data-mechanism="vector-offset-lower-housing" d="M429 176h43v51h-43z" fill="${paint.dark}"/>${vents(436, 183, 3, 6, 32, 10)}<path data-mechanism="vector-grip-feed" d="M337 174h32l-8 47h-30z" fill="${paint.rubber}"/>${checkering(338, 183, 22, 30)}${triggerGuard(379, 175, 34, 31)}${selector(351, 157, 18)}${fastener(322, 151, 3)}${fastener(475, 163, 3)}${fastener(459, 229, 3)}` };
	if (gun.id === "sr2") return { material: "steel", bounds: [307, 105, 208, 131], outline: "M315 116h159l30 18v36H397l-16 59h-48l10-59h-28z", detail: `${rail(334, 108, 180)}${port(408, 133, 71, 20)}${seam("M320 121h149l27 17M319 164h177", true)}${triggerGuard(393, 172, 43, 28)}<path data-mechanism="sr2-grip-feed" d="M348 174h32l-10 49h-28z" fill="${paint.rubber}"/>${ribs(349, 179, 4, 33, 7)}${selector(349, 155, 28)}<path data-mechanism="sr2-charging-handle" d="M441 135h54v7h-29l-11 9h-14z" fill="${paint.steel}"/>${fastener(325, 140, 3)}${fastener(480, 160, 3)}` };
	if (gun.id === "awm") return { material: "steel", bounds: [305, 105, 212, 124], outline: "M314 123h31l15-11h121l24 13v36H380l-17 62h-40l13-62h-22z", detail: `${rail(338, 108, 186)}${port(370, 129, 91, 20)}${seam("M364 117h110l23 12M319 156h178", true)}<path data-mechanism="awm-bolt-handle" d="M444 138h29l-15 29 12 17-7 6-23-26 14-20h-10z" fill="${paint.steel}"/><circle cx="468" cy="188" r="8" fill="${paint.rubber}"/>${triggerGuard(382, 168, 48, 31)}<path data-mechanism="awm-chassis-grip" d="M337 175h30l-11 43h-26z" fill="${paint.rubber}"/>${checkering(339, 182, 23, 29)}${fastener(326, 140, 3)}${fastener(489, 151, 3)}${selector(471, 120, 19)}` };
	if (gun.id === "m870") return { material: "steel", bounds: [312, 106, 191, 113], outline: "M319 116h139l33 15v36H330l-11-12z", detail: `${port(395, 133, 79, 24)}${seam("M326 121h128l30 14M333 162h151", true)}${triggerGuard(371, 169, 64, 27)}<path data-mechanism="m870-pump-release" d="M363 169h8v14h-14v-5h6z" fill="${paint.steel}"/><path data-mechanism="m870-loading-port" d="M443 161h38v7h-38z" fill="${paint.dark}"/>${rail(345, 108, 146)}${fastener(335, 143, 3)}${fastener(367, 151, 2.6)}${fastener(478, 158, 3)}<path d="M421 173h7v5h-7z" fill="${paint.steel}"/>` };
	if (gun.id === "g36") return { material: "polymer", bounds: [305, 102, 210, 128], outline: "M317 123l29-13h134l23 25v36h-115l-18 53h-47l15-53h-21z", detail: `${rail(333, 108, 180)}${port(397, 132, 79, 22)}${seam("M348 115h128l20 24M322 164h69", true)}${triggerGuard(393, 173, 44, 29)}${checkering(340, 183, 24, 28)}<path data-mechanism="g36-polymer-upper" d="M323 126h61v9h-61z" fill="${paint.dark}"/>${selector(351, 157, 24)}${fastener(330, 150, 3)}${fastener(477, 162, 3)}<path data-mechanism="g36-charging-slot" d="M351 118h80v7h-80z" fill="#1b252a"/>` };
	if (gun.id === "fal") return { material: "steel", bounds: [307, 104, 208, 127], outline: "M316 117h162l25 14v31h-16v15h-53v-12h-54l-15 60h-43l13-60h-19z", detail: `${rail(338, 108, 173)}${port(386, 129, 89, 21)}${seam("M322 121h148l25 14M321 157h156", true)}${triggerGuard(381, 171, 49, 28)}<path data-mechanism="fal-charging-handle" d="M331 130h32v13h-32z" fill="${paint.steel}"/>${fastener(345, 136, 4)}${selector(352, 155, 22)}${checkering(340, 184, 25, 29)}${fastener(479, 157, 3)}<path data-mechanism="fal-break-seam" d="M374 152v13h56" fill="none" stroke="#17242c" stroke-width="2"/>` };
	if (gun.id === "sr25") return { material: "dark", bounds: [307, 103, 209, 127], outline: "M319 126l27-16h129l27 24v35h-17v18h-54v-18h-51l-16 57h-44l13-57h-14z", detail: `${rail(332, 108, 185)}${port(396, 131, 78, 22)}${seam("M348 115h122l26 22M325 160h94M434 177h48", true)}${triggerGuard(384, 176, 42, 24)}<path data-mechanism="ar10-large-upper" d="M327 129h58v8h-58z" fill="${paint.steel}"/>${selector(351, 156, 24)}${checkering(341, 185, 23, 29)}${fastener(329, 157, 3)}${fastener(486, 160, 3)}<path d="M477 122l13 7v16h-9z" fill="${paint.dark}"/>` };
	const svdk = gun.id === "svdk";
	return { material: "dark", bounds: [310, 103, 207, 128], outline: svdk ? "M318 124l29-15h125l33 21v38H386l-16 56h-43l13-56h-22z" : "M320 123l22-14h129l25 23v34H382l-15 58h-42l13-58h-18z", detail: `${rail(333, 108, 176)}${port(svdk ? 389 : 388, 133, svdk ? 87 : 81, svdk ? 21 : 18)}${seam(svdk ? "M350 114h119l29 20M324 162h168" : "M346 114h119l25 20M324 160h159", true)}${triggerGuard(386, 171, 45, 27)}${selector(435, 156, svdk ? 52 : 41, true)}<path data-mechanism="${svdk ? "svdk-enlarged-action" : "tkm-semi-auto-receiver"}" d="M338 140h28v7h-28z" fill="${paint.steel}"/>${checkering(342, 185, 24, 29)}${fastener(332, 143, 3)}${fastener(352, 160, 3)}${fastener(483, 158, 3)}<path data-mechanism="charging-handle" d="M444 138h51v7h-27l-10 9h-14z" fill="${paint.steel}"/>${svdk ? `<path data-mechanism="svdk-side-mount" d="M325 147h64v7h-64z" fill="${paint.steel}"/>` : ""}` };
}

function waveStockGeometry(gun: Profile, appearance: string, paint: Paint): Geometry | undefined {
	if (!waveProfiles.has(gun.id) || gun.category === "pistol") return undefined;
	if (bullpups.has(gun.id)) {
		const width = ({ factory: 20, padded: 34, precision: 38, tactical: 29, skeleton: 13 } as Record<string, number>)[appearance] ?? 23;
		return { material: ["padded", "tactical", "precision"].includes(appearance) ? "rubber" : "polymer", bounds: [247 - width, 116, width + 17, 94], outline: `M${252 - width} 123h${width - 7}l13 8v61l-13 11h-${width - 7}q-5 0-5-8v-63q0-9 5-9z`, detail: `<path data-mechanism="bullpup-buttpad" d="M${254 - width} 130h${width - 9}v65h-${width - 9}z" fill="${paint.rubber}"/>${ribs(256 - width, 136, Math.max(1, Math.floor((width - 5) / 6)), 52, 6)}${fastener(251, 142, 2.4)}${fastener(251, 188, 2.4)}${seam(`M${255 - width} 126h${width - 10}l9 7v58l-9 9`, true)}` };
	}
	if (gun.id === "sr2") {
		const left = ({ factory: 171, precision: 112, padded: 136, tactical: 125, skeleton: 203, folding: 185 } as Record<string, number>)[appearance] ?? 160;
		return { material: "steel", bounds: [left - 8, 123, 328 - left, 90], outline: `M${left} 130h${315 - left}v10H${left + 12}v63h-12zM${left + 12} 155h${303 - left}v6H${left + 12}z`, detail: `<path data-mechanism="sr2-wire-support" d="M${left - 3} 174h14v34h-14z" fill="${paint.rubber}"/>${seam(`M${left + 17} 132h${282 - left}`, true)}${fastener(307, 137, 3)}` };
	}
	if (appearance !== "factory") return undefined;
	const detail = `${fastener(299, 152, 3)}${seam("M120 150h80l71-9h41", true)}<path d="M106 151h14v75h-14z" fill="${paint.rubber}"/>`;
	if (gun.id === "m870" || gun.id === "vpo209") return { material: "wood", bounds: [97, 132, 242, 102], outline: gun.id === "m870" ? "M105 145l111-10h51l61 15v20l-64-6-42 29-102 37h-16zM277 160l48 2 7 47h-20z" : "M107 150l104-13h58l55 12v20h-52l-39 21-111 39h-17z", detail: `${detail}${grain(130, 156, 136, 39)}${gun.id === "m870" ? grain(307, 174, 18, 25) : ""}${fastener(279, 156, 3)}` };
	if (gun.id === "awm" || gun.id === "svdk") return { material: gun.id === "awm" ? "polymer" : "steel", fillRule: "evenodd", bounds: [97, 113, 223, 128], outline: gun.id === "awm" ? "M104 139h88v-21h91v22h30v28h-46l-24 64h-39l-20-36-63 36h-17zM204 173h31l-14 42h-11l-17-26z" : "M105 141h104l34-10h71v33h-55l-34 64h-109zM134 160h62l20 17-27 29h-55z", detail: `${detail}<path data-mechanism="${gun.id === "awm" ? "awm-cheek-rest" : "svdk-cheek-rest"}" d="M159 118h112v23H159z" fill="${paint.rubber}"/>${fastener(225, 226, 4)}${ribs(127, 157, 7, 24, 9)}` };
	if (gun.id === "sr25") return { material: "polymer", bounds: [105, 121, 221, 116], outline: "M113 145h84v-18h75v15h47v25h-64l-23 66h-111z", detail: `${detail}<path data-mechanism="ar10-fixed-buffer-stock" d="M198 123h121v14H198z" fill="${paint.steel}"/>${vents(130, 159, 4, 12, 24, 18)}${ribs(130, 204, 9, 17, 9)}` };
	if (gun.id === "fal") return { material: "polymer", bounds: [97, 133, 220, 97], outline: "M105 148l103-11h45l59 13v19h-50l-29 15-111 42h-17z", detail: `${detail}${ribs(140, 159, 9, 30, 9)}<path data-mechanism="fal-stock-tang" d="M287 144h27v18h-27z" fill="${paint.steel}"/>` };
	const vector = gun.id === "vector";
	return { material: "polymer", fillRule: "evenodd", bounds: [101, 125, 222, 108], outline: vector ? "M118 141h87l26-10h85v34h-85l-33 63h-78zM145 159h61l-24 43h-37z" : "M119 142h74l47-13h73v35h-85l-42 64h-64zM147 159h54l-30 45h-24z", detail: `${detail}<path data-mechanism="${vector ? "vector-hinged-stock" : "g36-skeleton-stock"}" d="M303 132h14v40h-14z" fill="${paint.steel}"/>${fastener(310, 153, 4)}${seam("M148 213h31l42-52", true)}` };
}

function waveMagazineGeometry(gun: Profile, appearance: string, paint: Paint): Geometry | undefined {
	if (!waveProfiles.has(gun.id)) return undefined;
	const extended = appearance === "extended", compact = appearance === "compact", window = appearance === "window", quick = appearance === "quick";
	if (gun.id === "m870") {
		const length = extended ? 321 : compact ? 166 : quick ? 236 : window ? 252 : 279;
		return { material: "steel", bounds: [470, 149, length + 9, 24], outline: `M475 154h${length}v13H475z`, detail: `<path data-mechanism="m870-tube-feed" d="M480 157h${length - 12}" stroke="#848c8f" stroke-width="2"/>${ribs(475 + length - 14, 155, 3, 10, 4)}${window ? Array.from({ length: 5 }, (_, i) => `<rect x="${491 + i * 44}" y="157" width="25" height="7" rx="2" fill="#a28e61" stroke="#141c20"/>`).join("") : ""}${quick ? `<path d="M486 167h19v5h-19z" fill="${paint.rubber}"/>` : ""}` };
	}
	const vector = gun.id === "vector", grip = gun.category === "pistol" || gun.id === "sr2", rear = bullpups.has(gun.id), curved = gun.id === "vpo209" || gun.id === "g36" || gun.id === "aug";
	const left = grip ? gun.id === "sr2" ? 341 : 337 : rear ? 309 : 430;
	const top = vector ? 226 : grip ? 198 : 173, width = vector ? 42 : grip ? gun.id === "fiveseven" ? 47 : 42 : gun.id === "ash12" || gun.id === "svdk" || gun.id === "awm" ? 62 : 50;
	const depth = compact ? grip ? 30 : 35 : extended ? grip ? 77 : 102 : grip ? gun.category === "pistol" ? 44 : 65 : gun.id === "awm" ? 45 : 75;
	if (appearance === "drum") return { material: "dark", bounds: [left - 5, top - 4, width + 24, 128], outline: `M${left} ${top}h${width}v32h-${width}zM${left - 2} ${top + 30}h${width + 10}q12 0 12 12v67q0 11-12 11h-${width + 10}z`, detail: `<path data-mechanism="side-projection-drum" d="M${left + 10} ${top + 44}h${width}v65h-${width}z" fill="${paint.polymer}"/>${ribs(left + 18, top + 48, Math.floor(width / 9), 58, 9)}${fastener(left + 12, top + 41, 3)}${fastener(left + width, top + 104, 3)}` };
	const drift = grip || vector ? -9 : curved ? 21 : 1;
	const outline = curved ? `M${left} ${top}h${width}q-2 ${depth * .52} ${drift} ${depth - 8}l-${width - 5} 12q-27-31-${drift + 5}-${depth + 4}z` : `M${left} ${top}h${width}l${drift} ${depth}h-${width}z`;
	return { material: gun.id === "g36" || rear ? "polymer" : "steel", bounds: [left - 16, top - 4, width + 44, depth + (quick ? 24 : 16)], outline, detail: `<path data-mechanism="${rear ? "rear-box-magazine" : grip ? "grip-fed-magazine" : "front-box-magazine"}" d="M${left + 5} ${top + 4}h${width - 10}" stroke="#a0aaa9" stroke-width="1"/>${window ? `<path d="M${left + 9} ${top + 12}h${width - 20}l${drift * .65} ${depth - 23}h-${width - 20}z" fill="#18252a" stroke="#80918d"/>${Array.from({ length: Math.max(2, Math.floor((depth - 22) / 8)) }, (_, i) => `<path d="M${left + 11 + drift * i / 11} ${top + 17 + i * 8}h${width - 24}" stroke="#bba674" stroke-width="2"/>`).join("")}` : ribs(left + 8, top + 13, Math.max(2, Math.floor((width - 14) / 9)), Math.max(10, depth - 25), 9)}<path d="M${left - 3 + drift} ${top + depth - 3}h${width + 8}v8h-${width + 8}z" fill="${paint.rubber}"/>${quick ? `<path d="M${left + drift + 9} ${top + depth + 4}v10h21v-10" fill="none" stroke="#828c8d" stroke-width="4"/>` : ""}${fastener(left + width / 2, top + 8, 2)}` };
}

function waveHandguardGeometry(gun: Profile, appearance: string, paint: Paint): Geometry | undefined {
	if (!waveProfiles.has(gun.id) || gun.category === "pistol") return undefined;
	const pump = gun.id === "m870", aug = gun.id === "aug", ash = gun.id === "ash12", vector = gun.id === "vector";
	const start = aug || ash ? 533 : vector ? 534 : pump ? 527 : 487, right = waveFront(gun), length = right - start;
	const top = pump ? 149 : 130, depth = pump ? 33 : ash ? 48 : 42;
	const shell: Record<string, string> = {
		factory: `M${start} ${top}h${length - 13}l13 10v${depth - 10}H${start}z`,
		rail: `M${start} ${top - 2}h${length - 16}l16 12v${depth - 7}H${start}zM${start + 11} ${top + 12}h18v16h-18z`,
		light: `M${start + 4} ${top + 4}h${length - 17}l9 8v${depth - 20}l-8 8H${start + 4}z`,
		wood: `M${start + 2} ${top + 3}h${length - 19}q15 0 15 12v${depth - 20}q0 11-15 11H${start + 5}q-6 0-6-9z`,
		vented: `M${start} ${top}h${length - 12}l12 10v${depth - 10}H${start}zM${start + 11} ${top + 10}h17v20h-17zM${start + 37} ${top + 10}h17v20h-17z`,
		carbon: `M${start + 2} ${top + 3}q4-7 14-7h${length - 30}q12 0 12 14v${depth - 22}q0 12-13 12H${start + 13}q-12 0-12-12z`,
	};
	const serviceShells: Record<string, string> = {
		g36: "M487 130h130l19 12v26l-15 10H498l-11-12z",
		aug: "M533 133h46q11 0 22 14v24l-13 9h-46l-9-12z",
		fal: "M489 134h125q20 0 22 13v17q0 15-22 15H492q-5 0-5-12v-23z",
		sr25: "M487 129h132l17 14v28l-11 7H496l-9-11z",
		vector: "M534 133h35l16 10v25l-9 10h-33l-9-12z",
		ash12: "M533 130h44l24 14v24l-12 10h-56z",
		svdk: "M487 134h193q21 0 21 13v15q0 16-21 16H491l-4-12z",
		awm: "M487 133h194l20 12v24l-13 9H498l-11-11z",
	};
	if (serviceShells[gun.id]) shell.factory = serviceShells[gun.id]!;
	const railed = ["rail", "carbon"].includes(appearance), bottom = railed || appearance === "vented" || (appearance === "factory" && !pump && !aug);
	const factoryWood = appearance === "wood" || appearance === "factory" && gun.wood;
	const hasBottom = bottom || appearance === "factory", bridge = railed ? `${rail(333, 108, right - 340)}<path data-mechanism="handguard-optic-bridge" d="M${start + 4} 113h12v${top - 113 + 4}h-12z" fill="${paint.steel}"/>` : "";
	const leftBound = railed ? 329 : start - 5, topBound = railed ? 103 : Math.min(141, top - 9);
	return { material: factoryWood ? "wood" : appearance === "carbon" ? "carbon" : appearance === "vented" ? "steel" : "polymer", fillRule: "evenodd", bounds: [leftBound, topBound, right - leftBound + 6, top + depth + (hasBottom ? 16 : 8) - topBound], outline: shell[appearance] ?? shell.factory!, detail: `${bridge}${railed ? rail(start + 4, top - 7, length - 10) : ""}${hasBottom ? rail(start + 7, top + depth + 4, length - 16) : ""}${railed || appearance === "factory" ? rail(start + 12, 145, length - 22) : ""}${factoryWood ? grain(start + 10, top + 11, length - 23, 18) : vents(start + 12, top + 11, Math.max(1, Math.floor((length - 20) / 24)), 12, pump ? 8 : 18, 24)}${ribs(start + 10, top + (pump ? 4 : 31), Math.max(1, Math.floor((length - 18) / (pump ? 9 : 11))), pump ? 24 : 8, pump ? 9 : 11)}${seam(`M${start + 4} ${top + 3}h${length - 20}`, true)}${fastener(start + 7, top + depth - 7, 3)}${fastener(right - 7, top + depth - 7, 3)}${pump ? `<path data-mechanism="m870-pump-fore-end" d="M${start + 1} ${top + depth}h${length - 3}v6h-${length - 3}z" fill="${paint.steel}"/>` : ""}` };
}

function modernReceiverGeometry(gun: Profile, paint: Paint): Geometry | undefined {
	if (!newProfiles.has(gun.id)) return undefined;
	if (gun.id === "m1911") return { material: "steel", bounds: [297, 93, 304, 146], outline: "M306 105h270l17 13v27h-31v10H411l-18 78h-58l14-76h-30l-19-19z", detail:
		`${seam("M311 108h262l14 13M306 141h278", true)}${port(468, 116, 65, 16)}<path data-mechanism="1911-bushing" d="M578 113h11v31h-11z" fill="${paint.dark}"/>${seam("M579 116v24", true)}
		${Array.from({ length: 10 }, (_, i) => seam(`M${317 + i * 4.5} 117l-4 18`)).join("")}${triggerGuard(401, 158, 57, 34)}<path data-mechanism="1911-grip-panel" d="M359 167h35l-13 57h-34z" fill="${paint.wood}" stroke="#1a2328"/>${checkering(355, 176, 29, 35)}${fastener(375, 176, 3)}${fastener(365, 213, 3)}
		<path data-mechanism="1911-grip-safety" d="M332 154h15l-9 35h-10z" fill="${paint.dark}"/><path data-mechanism="hammer" d="M304 103l-10-11h8l14 15v11h-9z" fill="${paint.dark}"/><path data-mechanism="slide-stop" d="M387 149h41v5h-41z" fill="#69777e"/>${fastener(395, 151, 2.5)}${selector(331, 144, 20)}<path data-mechanism="iron-sights" d="M327 98h13v7h-13M562 99h9v7h-9z" fill="#1e282c"/>` };
	if (gun.id === "p90") return { material: "polymer", bounds: [250, 103, 389, 126], fillRule: "evenodd", outline: "M262 132h245l39 23v41l-24 21h-50l-26-14-11-25h-48l-24 43H266l-10-16v-58zM390 168h40l9 27h-56zM480 164h40v30h-23l-17-17z", detail:
		`${seam("M268 137h229l38 23M268 208h84l27-46h53", true)}${rail(498, 108, 136)}<path data-mechanism="p90-optic-bridge" d="M498 114h14v39h-14zM615 114h14v44h-14z" fill="${paint.dark}"/>${fastener(505, 147, 2)}${fastener(622, 151, 2)}<path data-mechanism="bullpup-bottom-ejection" d="M289 177h54v11h-54z" fill="#131b20" stroke="#57656b"/>${ribs(271, 147, 7, 47, 9)}${triggerGuard(390, 164, 42, 28)}<path data-mechanism="bullpup-horizontal-feed" d="M279 124h220v12H279z" fill="${paint.dark}"/>${fastener(272, 149, 3)}${fastener(361, 148, 3)}${fastener(466, 150, 3)}${fastener(530, 191, 3)}<path data-mechanism="ambidextrous-charging-handle" d="M498 137h31v8h-31z" fill="${paint.steel}"/>${seam("M481 156h36v6h-36")}` };
	if (gun.id === "mp7") return { material: "polymer", bounds: [315, 101, 185, 135], outline: "M323 114h153l15 12v39h-99l-13 62h-46l9-62h-19z", detail:
		`${rail(331, 108, 168)}${port(407, 131, 62, 18)}${seam("M329 119h142l14 11M326 160h155", true)}<path data-mechanism="grip-feed-well" d="M343 170h33l-9 52h-31z" fill="${paint.rubber}"/>${checkering(342, 179, 24, 32)}${triggerGuard(385, 168, 45, 27)}${selector(350, 152, 20)}<path data-mechanism="mp7-charging-handle" d="M317 117h21v7h-21z" fill="${paint.steel}"/>${fastener(331, 145, 3)}${fastener(471, 151, 3)}<path d="M475 110h11v12h-11z" fill="${paint.dark}"/>` };
	if (gun.id === "ump45") return { material: "polymer", bounds: [312, 103, 195, 126], outline: "M319 116h159l17 18v33h-117l-13 57h-39l11-57h-18z", detail:
		`${rail(333, 108, 168)}${port(392, 133, 73, 23)}${seam("M324 121h148l16 15M323 161h166", true)}<path data-mechanism="ump-charging-slot" d="M334 124h47v7h-47z" fill="#142027"/><path data-mechanism="charging-handle" d="M347 125h17v9h-17z" fill="${paint.steel}"/>${triggerGuard(382, 171, 46, 26)}${selector(348, 158, 24)}${checkering(339, 182, 23, 30)}${fastener(325, 146, 3)}${fastener(475, 158, 3)}${seam("M415 162h59v9h-59")}` };
	if (gun.id === "trg42") return { material: "steel", bounds: [312, 106, 188, 121], outline: "M323 123h22l10-10h96l32 12v32H372l-17 62h-34l12-62h-14z", detail:
		`${port(368, 126, 83, 21)}${rail(340, 108, 162)}${seam("M355 117h90l31 12M324 152h150", true)}<path data-mechanism="trg-bolt-handle" d="M433 135h26l-14 27 12 13-6 7-20-21 13-20h-11z" fill="${paint.steel}" stroke="#182329"/><circle cx="454" cy="178" r="8" fill="${paint.rubber}"/>${triggerGuard(370, 167, 49, 29)}<path data-mechanism="trg-chassis-grip" d="M336 174h30l-13 41h-23z" fill="${paint.rubber}"/>${ribs(338, 182, 4, 22, 6)}${fastener(328, 138, 3)}${fastener(473, 150, 3)}${selector(461, 120, 15)}` };
	const scar = gun.id === "scarh", hk = gun.id === "hk416", mcx = gun.id === "mcx";
	const upper = scar ? 106 : hk ? 109 : mcx ? 111 : 115;
	return { material: scar ? "polymer" : "dark", bounds: [310, upper - 8, 200, 230 - upper], outline: scar
		? "M318 113h154l29 23v32h-18v15h-50v-16h-58l-15 57h-40l12-57h-14z"
		: mcx ? "M318 124l16-11h130l35 18v36h-22v17h-46v-17h-57l-15 57h-39l12-57h-14z"
		: hk ? "M322 126l16-15h124l33 21v35h-20v15h-45v-15h-55l-15 55h-39l11-55h-16z"
		: "M324 128l16-12h122l30 17v34h-18v17h-45v-17h-53l-17 54h-40l13-54h-14z",
		detail: `${rail(333, 108, 169)}${port(scar ? 397 : 396, scar ? 130 : 131, scar ? 70 : 64, scar ? 24 : 18)}${seam(`M339 ${upper + 4}h117l31 20`, true)}${seam("M327 157h89M421 164h63")}
		<path data-mechanism="${scar ? "scar-upper" : mcx ? "mcx-short-stroke-upper" : hk ? "hk-piston-upper" : "ar-upper"}" d="M334 ${upper + 3}h121l28 18H328z" fill="${paint.steel}" opacity=".25"/>
		<path data-mechanism="${scar ? "scar-box-magwell" : "ar-lower-magwell"}" d="M428 158h51v23h-51z" fill="${paint.dark}" stroke="#626e75" stroke-width=".8"/>${seam("M433 162h40v14h-40", true)}${triggerGuard(380, 169, 46, 26)}${selector(349, 155, 22)}
		<path d="M339 175h29l-13 42h-24z" fill="${paint.rubber}"/>${checkering(338, 183, 22, 27)}${fastener(329, 142, 3)}${fastener(410, 161, 2.8)}${fastener(479, 155, 3)}${fastener(365, 165, 2)}
		${scar ? `<path data-mechanism="scar-charging-handle" d="M410 124h41l10 7h-51z" fill="#7c8588"/>${vents(343, 127, 3, 10, 6, 15)}` : mcx ? `<path data-mechanism="mcx-folding-hinge" d="M311 125h13v37h-13z" fill="${paint.steel}"/>${fastener(316, 146, 3)}` : `<path data-mechanism="ar-charging-handle" d="M315 119h28v8h-28z" fill="${paint.steel}"/><path data-mechanism="forward-assist" d="M349 130h16v10h-16z" fill="${paint.dark}"/>${fastener(355, 135, 3)}`}` };
}

function modernStockGeometry(gun: Profile, appearance: string, paint: Paint): Geometry | undefined {
	if (!newProfiles.has(gun.id) || gun.category === "pistol") return undefined;
	if (gun.id === "p90") {
		const padded = ["padded", "precision", "tactical"].includes(appearance), width = ({ padded: 30, precision: 34, tactical: 26, skeleton: 13 } as Record<string, number>)[appearance] ?? 21;
		return { material: padded ? "rubber" : "polymer", bounds: [248 - width, 122, width + 22, 105], outline: `M${254 - width} 128h${width - 6}l14 12v63l-14 15h-${width - 6}q-6 0-6-10v-70q0-10 6-10z`, detail: `${ribs(258 - width, 139, Math.max(1, Math.floor((width - 4) / 6)), 66, 6)}${fastener(257, 147, 2.5)}${fastener(257, 202, 2.5)}${seam(`M${258 - width} 133h${width - 9}l9 10v58l-9 11`, true)}` };
	}
	if (gun.id === "mp7") {
		const left = ({ precision: 113, tactical: 129, padded: 143, skeleton: 195, folding: 183 } as Record<string, number>)[appearance] ?? 164;
		return { material: "steel", bounds: [left - 9, 121, 333 - left, 98], outline: `M${left} 129h${318 - left}v10H${left + 15}v63h-15zM${left + 12} 153h${306 - left}v7H${left + 12}z`, detail: `<path d="M${left - 3} 171h17v41h-17z" fill="${paint.rubber}"/>${seam(`M${left + 17} 131h${291 - left}`, true)}${fastener(304, 136, 3)}${ribs(left + 1, 179, 2, 22, 5)}` };
	}
	if (appearance !== "factory") return undefined;
	if (gun.id === "trg42") return { material: "polymer", bounds: [97, 113, 231, 124], fillRule: "evenodd", outline: "M104 139h102v-19h73v20h43v27h-66l-18 62h-39l-13-32-65 32h-17zM208 173h27l-11 38h-12l-12-25z", detail: `<path data-mechanism="trg-adjustable-cheek" d="M194 116h87v20h-87z" fill="${paint.rubber}"/>${seam("M118 146h77M262 146h56", true)}<path d="M101 146h14v86h-14z" fill="${paint.rubber}"/>${fastener(225, 225, 5)}${fastener(274, 153, 4)}${ribs(122, 157, 8, 21, 8)}<path data-mechanism="trg-butt-adjustment" d="M127 231h40v5h-40z" fill="${paint.steel}"/>` };
	if (gun.id === "scarh") return { material: "polymer", bounds: [106, 119, 218, 113], outline: "M114 133h108l38-9h51v37h-42l-29 64h-119z", detail: `<path data-mechanism="scar-cheek-rest" d="M126 125h94v21h-94z" fill="${paint.rubber}"/><path d="M114 141h15v85h-15z" fill="${paint.rubber}"/><path d="M143 159h81l-10 37h-71z" fill="${paint.dark}"/>${seam("M131 138h84l45-8h45", true)}${fastener(237, 153, 5)}${fastener(303, 151, 4)}${ribs(142, 205, 8, 14, 10)}` };
	if (gun.id === "ump45" || gun.id === "mcx") return { material: "polymer", fillRule: "evenodd", bounds: [114, 130, 214, 103], outline: "M121 143h72l35-9h95v32H228l-35 61h-70zM145 161v43h36l25-43z", detail: `${seam("M128 148h63l38-8h84", true)}<path d="M118 150h16v78h-16z" fill="${paint.rubber}"/>${fastener(310, 154, 5)}${seam("M143 211h43l33-53", true)}${gun.id === "mcx" ? `<path data-mechanism="mcx-stock-hinge" d="M308 137h15v35h-15z" fill="${paint.steel}"/>` : ""}` };
	return { material: "polymer", fillRule: "evenodd", bounds: [112, 117, 214, 113], outline: "M122 140h101v-10h94v18h-44l-36 74H123zM145 157h63l-24 41h-38z", detail: `<path data-mechanism="ar-buffer-tube" d="M209 123h111v13H209z" fill="${paint.steel}"/>${ribs(212, 125, 11, 8, 8)}<path d="M118 146h14v79h-14z" fill="${paint.rubber}"/>${fastener(232, 150, 4)}${seam("M138 147h71M140 214h81", true)}<path data-mechanism="stock-adjustment-lever" d="M198 188h35v7h-35z" fill="${paint.dark}"/>` };
}

function modernMagazineGeometry(gun: Profile, appearance: string, paint: Paint): Geometry | undefined {
	if (!newProfiles.has(gun.id)) return undefined;
	const extended = appearance === "extended", quick = appearance === "quick", window = appearance === "window", compact = appearance === "compact";
	if (gun.id === "p90") {
		const length = compact ? 173 : extended ? 249 : 218, left = 501 - length;
		return { material: "polymer", bounds: [left - 4, 102, length + 9, 31], outline: `M${left} 109h${length - 14}l14 6v12H${left}z`, detail: `<path data-mechanism="p90-horizontal-feed" d="M${left + 8} 113h${length - 25}v10h-${length - 25}z" fill="#797663" opacity=".7"/>${Array.from({ length: Math.floor((length - 35) / 13) }, (_, i) => `<path d="M${left + 17 + i * 13} 113v9" stroke="#ccb36d" stroke-width="4"/>`).join("")}${seam(`M${left + 6} 111h${length - 23}`, true)}<path data-mechanism="p90-rotating-feed-ramp" d="M483 112h14v12h-14z" fill="${paint.dark}"/>${fastener(489, 118, 2)}${quick ? `<path d="M${left + 8} 106h26v6h-26z" fill="${paint.rubber}"/>` : ""}` };
	}
	if (appearance === "drum") return undefined;
	if (gun.id === "mp7" || gun.id === "m1911") {
		const pistol = gun.id === "m1911", left = pistol ? 342 : 335, width = pistol ? 44 : 38;
		const depth = extended ? 69 : compact ? 27 : pistol ? 41 : 54;
		return { material: "steel", bounds: [left - 8, 189, width + 13, depth + (quick ? 17 : 11)], outline: `M${left} 194h${width}l-8 ${depth}h-${width}z`, detail: `${window ? `<path d="M${left + 7} 202h${width - 15}l-4 ${depth - 15}h-${width - 15}z" fill="#20292c" stroke="#939c98"/>${Array.from({ length: Math.floor((depth - 14) / 7) }, (_, i) => `<path d="M${left + 8 - i * .7} ${207 + i * 7}h${width - 17}" stroke="#b9a069" stroke-width="2"/>`).join("")}` : ribs(left + 8, 202, 3, Math.max(9, depth - 14), 8)}<path d="M${left - 8} ${190 + depth}h${width + 10}v8h-${width + 10}z" fill="${paint.rubber}"/>${quick ? `<path d="M${left + 2} ${depth + 199}v8h20v-8" fill="none" stroke="#777f7f" stroke-width="4"/>` : ""}${seam(`M${left + 3} 198h${width - 6}`, true)}` };
	}
	const trg = gun.id === "trg42", ump = gun.id === "ump45", scar = gun.id === "scarh";
	const depth = compact ? 38 : extended ? trg ? 73 : 102 : trg ? 42 : ump ? 78 : scar ? 84 : 79;
	const left = trg ? 421 : 431, width = trg ? 58 : ump ? 36 : scar ? 54 : 46, drift = ump ? 5 : trg || scar ? 0 : 11;
	return { material: ump || scar ? "polymer" : "steel", bounds: [left - 6, 166, width + drift + 14, depth + (quick ? 23 : 13)], outline: `M${left} 173h${width}l${drift} ${depth}h-${width}z`, detail: `${window ? `<path d="M${left + 8} 184h${width - 17}l${drift * .65} ${depth - 24}h-${width - 17}z" fill="#192329" stroke="#919a99"/>${Array.from({ length: Math.floor((depth - 25) / 7) }, (_, i) => `<path d="M${left + 10 + i * drift / 11} ${190 + i * 7}h${width - 21}" stroke="#bda570" stroke-width="2"/>`).join("")}` : ribs(left + 9, 183, Math.max(2, Math.floor((width - 12) / 10)), depth - 18, 10)}<path d="M${left - 2 + drift} ${169 + depth}h${width + 6}v8h-${width + 6}z" fill="${paint.rubber}"/>${seam(`M${left + 4} 176h${width - 8}`, true)}${quick ? `<path d="M${left + drift + 10} ${depth + 180}v9h24v-9" fill="none" stroke="#828b88" stroke-width="5"/>` : ""}${fastener(left + width / 2, 180, 2)}` };
}

/** Traditional wrists and thumbholes need a real lower chassis when replaced. */
function classicUpgradeStockGeometry(gun: Profile, appearance: string, paint: Paint): Geometry | undefined {
	if (!["sks", "mosin", "svd", "vss", "m870"].includes(gun.id) || !["tactical", "light", "precision", "skeleton", "folding"].includes(appearance)) return undefined;
	const precision = appearance === "precision", wire = appearance === "folding", skeleton = appearance === "skeleton";
	const outline = wire ? "M116 147h196l15 10v14H139v48h-22zM139 166h169l-164 32v-7l144-26H139z"
		: skeleton ? "M108 143h83l26-8h103v32H216l-25 58h-77zM133 161v43h40l21-43z"
		: precision ? "M102 143h96v-17h76v18h50v27h-65l-23 61h-39l-12-35-67 34h-16zM209 174h27l-16 40h-7l-13-26z"
		: "M117 145h90l18-9h92v32h-68l-22 57H119zM143 162h61l-17 38h-41z";
	return { material: wire || skeleton ? "steel" : "polymer", fillRule: "evenodd", bounds: [96, precision ? 120 : 130, 281, 111], outline: `${outline}M307 150h62v20h-13l-14 56h-30l13-56h-18z`, detail: `<path data-hardware="traditional-stock-chassis" d="M309 152h58v14h-58z" fill="${paint.steel}"/>${seam("M314 155h47", true)}${fastener(319, 161, 3)}${fastener(360, 160, 3)}<path data-hardware="chassis-pistol-grip" d="M329 174h20l-11 44h-20z" fill="${paint.rubber}"/>${checkering(327, 182, 16, 28)}${precision ? `<path d="M192 123h86v18h-86z" fill="${paint.rubber}"/>${fastener(229, 224, 4)}${seam("M116 151h72M266 149h35", true)}` : `${seam("M126 151h63l36-10h75", true)}${fastener(304, 154, 4)}`}<path d="M108 150h12v77h-12z" fill="${paint.rubber}"/>${wire ? seam("M142 169l138 1-136 25", true) : ribs(128, 205, 8, 15, 8)}` };
}

/** Separate mechanical cores retain a true side projection at every presentation size. */
function receiverGeometry(gun: Profile, paint: Paint): Geometry {
	const wave = waveReceiverGeometry(gun, paint);
	if (wave) {
		if (gun.id === "ash12") {
			wave.bounds = [244, 80, 364, 152];
			wave.detail = wave.detail.replace(rail(351, 108, 231), rail(351, 83, 149));
		}
		if (gun.id === "aug") wave.detail += `<path data-hardware="aug-top-rail-feet" d="M363 113h11v9h-11zM568 113h11v22h-11z" fill="${paint.steel}"/>${fastener(568, 133, 2)}`;
		// A FAL bridge or an AK/SVD side mount supplies the optic rail; a
		// receiver that only supports those adapters must not draw a fake rail.
		if (["fal", "vpo209", "svdk"].includes(gun.id)) wave.detail = wave.detail.replace(gun.id === "fal" ? rail(338, 108, 173) : rail(333, 108, 176), "");
		return wave;
	}
	const modern = modernReceiverGeometry(gun, paint); if (modern) return modern;
	if (gun.category === "pistol") {
		const tt = gun.id === "tt";
		return { material: "dark", bounds: [300, 96, 283, 134], outline: tt
			? "M313 106h253l11 8v28h-12v8H402l-13 76h-51l11-68h-24l-20-24z"
			: "M326 105h226q21 0 23 19v20H402l-12 82h-52l13-71h-24q-19-6-20-25v-12q0-13 19-13z",
			detail: `${seam(tt ? "M316 110h247l8 6" : "M326 109h226q16 0 18 14", true)}${seam("M319 139h249M400 145h156")}
			${port(tt ? 465 : 468, 118, tt ? 64 : 48, 13)}<path data-mechanism="extractor" d="M${tt ? 518 : 508} 117h22v4h-22z" fill="#3d464a"/>
			${Array.from({ length: tt ? 9 : 6 }, (_, i) => seam(`M${327 + i * (tt ? 4.5 : 5.5)} 116l${tt ? -3 : -2} 18`)).join("")}
			<path d="M354 160h37l-9 58h-38z" fill="${tt ? paint.rubber : paint.wood}" stroke="#242a2b" stroke-width="1"/>${checkering(352, 172, 30, 30)}${fastener(374, 166, 3)}${fastener(365, 210, 3)}
			${triggerGuard(401, 151, tt ? 55 : 50, 35)}<path data-mechanism="slide-stop" d="M384 145h31v4h-31z" fill="#676e71"/>${fastener(394, 149, 2)}
			<path data-mechanism="hammer" d="M309 108l-5-6h7l10 8v7h-7z" fill="${paint.dark}"/>
			<path data-mechanism="iron-sights" d="M330 99h10v7h-10M${tt ? 548 : 538} 100h8v6h-8z" fill="#222a2e"/>
			${tt ? `<path d="M565 113h10v22h-10" fill="${paint.dark}"/>${seam("M559 114v22", true)}${fastener(367, 146, 2.5)}` : `<path data-mechanism="safety" d="M341 109h18l4 5h-16z" fill="#3e464b"/>${fastener(344, 113, 3)}${seam("M353 217h25", true)}`}` };
	}
	if (gun.bolt) {
		const toz = gun.id === "toz";
		return { material: "steel", bounds: [313, 106, 176, 108], outline: toz
			? "M327 117h142l10 11v22H329l-11-12z"
			: "M327 121h24l7-6h80l7 6h26v26H330l-14-10z",
			detail: `${port(toz ? 374 : 368, 124, toz ? 63 : 72, 15)}${seam("M331 119h130", true)}
			<path data-mechanism="bolt-handle" d="M${toz ? 433 : 441} 129h17l-17 27 8 7-5 5-15-12 14-23h-2z" fill="${paint.steel}" stroke="#151e22" stroke-width="1"/><circle cx="${toz ? 438 : 446}" cy="167" r="7" fill="${paint.dark}"/>
			${triggerGuard(353, 153, 52, 31)}${fastener(344, 138, 2.4)}${fastener(466, 139, 2.7)}${selector(334, 148, 16)}
			${toz ? `<path d="M331 148h26l-15 61h-25z" fill="${paint.wood}"/>${grain(326, 166, 18, 24)}${fastener(337, 160, 2)}` : `<path data-mechanism="bolt-safety" d="M323 122h15v19h-15z" fill="${paint.dark}"/>${ribs(324, 125, 3, 12, 4)}${seam("M353 117v29M446 122v23")}`}` };
	}
	if (gun.pump) return { material: "steel", bounds: [323, 108, 170, 115], outline: "M333 117h119q17 0 25 13v33l-7 4H334l-5-10v-31z",
		detail: `${seam("M337 120h114q14 0 22 13", true)}${port(391, 132, 70, 23)}${seam("M336 162h135")}${triggerGuard(373, 168, 60, 24)}
		<path d="M340 167h29l-13 50h-26z" fill="${paint.wood}"/>${grain(337, 181, 21, 25)}${fastener(345, 144, 2.5)}${fastener(367, 151, 2.2)}${fastener(470, 158, 2.8)}
		<path data-mechanism="action-release" d="M368 169v17h-9v-5h5v-12z" fill="#666d6f"/><path data-mechanism="safety" d="M414 172h7v4h-7z" fill="#5f666b"/><path d="M340 109h12v7h-12z" fill="${paint.dark}"/>` };
	if (gun.id === "sks") return { material: "steel", bounds: [313, 106, 187, 100], outline: "M324 125h25v-12h94l12 9h38v29H331l-10-10z",
		detail: `${port(375, 124, 82, 17)}<path data-mechanism="bolt-carrier" d="M350 114h90l12 8H351z" fill="${paint.steel}"/>${seam("M355 115h82", true)}
		<path data-mechanism="charging-handle" d="M433 127h34l17 6v6h-40z" fill="#767d7e"/>${seam("M449 131h27", true)}${triggerGuard(351, 159, 52, 30)}
		<path data-mechanism="rear-sight" d="M459 115h28v8h-28zM464 111h17v5h-17z" fill="${paint.dark}"/>${ribs(465, 112, 4, 4, 4)}
		${selector(356, 153, 19)}${fastener(339, 140, 2.4)}${fastener(481, 141, 2.6)}${seam("M327 147h164", true)}` };
	if (gun.id === "pp91") return { material: "dark", bounds: [318, 100, 187, 124], outline: "M325 106h152l14 13v45h-35v7h-82l-12 50h-35l10-57h-12z",
		detail: `${seam("M330 109h142l13 13", true)}${port(402, 127, 68, 20)}${seam("M329 121h153M329 159h151")}
		<path data-mechanism="charging-handle" d="M334 111h22v7h-22z" fill="#777e81"/>${fastener(343, 114, 2.1)}${triggerGuard(375, 168, 37, 24)}
		<path d="M341 172h22l-8 43h-22z" fill="${paint.rubber}"/>${checkering(340, 181, 18, 26)}${selector(335, 148, 23)}${fastener(477, 157, 3)}
		<path data-mechanism="rear-sight" d="M331 101h14v7h-14z" fill="#20272b"/>${seam("M383 153h17v8h-17")}${fastener(349, 163, 2)}` };
	if (gun.integral) {
		const val = gun.id === "asval";
		return { material: "dark", bounds: [317, 103, 183, 119], outline: val
			? "M323 124q10-15 25-15h109l34 16v39h-113l-14 54h-37l12-54h-16z"
			: "M322 124q10-17 29-17h102l38 18v37H337l-15-14z",
			detail: `${seam("M348 111h106l33 17", true)}${port(402, 128, 63, 19)}<path data-mechanism="charging-handle" d="M448 136h41v7h-21l-9 6h-10z" fill="#70797d"/>
			${seam("M328 150h73M330 158h158")}${triggerGuard(374, 166, 43, 23)}${selector(347, 149, 35)}${fastener(331, 135, 2.5)}${fastener(476, 154, 2.6)}
			${val ? `<path d="M341 171h29l-11 42h-26z" fill="${paint.rubber}"/>${checkering(341, 181, 23, 25)}<path d="M319 130h10v24h-10z" fill="${paint.steel}"/>${fastener(324, 137, 3)}` : `<path data-mechanism="stock-tang" d="M324 151h30v9h-30z" fill="${paint.steel}"/>${fastener(343, 155, 2.4)}${seam("M335 112v36")}`}
			<path data-mechanism="rear-sight" d="M477 114h15v10h-15z" fill="#252c31"/>` };
	}
	if (gun.id === "svd") return { material: "dark", bounds: [316, 104, 185, 112], outline: "M323 121l23-12h114l31 17v35H324z",
		detail: `<path data-mechanism="dust-cover" d="M346 112h111l24 13H333z" fill="${paint.steel}"/>${seam("M350 115h104l21 8", true)}${port(390, 129, 77, 18)}
		<path data-mechanism="charging-handle" d="M441 134h46v6h-27l-9 9h-12z" fill="#747c7e"/>${selector(428, 153, 44, true)}${triggerGuard(369, 163, 45, 24)}
		${fastener(338, 133, 3)}${fastener(352, 156, 2.5)}${fastener(479, 158, 2.5)}${seam("M325 156h91", true)}<path data-mechanism="side-mount" d="M329 145h61v5h-61z" fill="#4b5358"/>` };
	if (gun.id === "pkp") return { material: "dark", bounds: [316, 94, 195, 130], outline: "M320 115h22v-16h117l34 13v51h-115l-13 57h-35l10-57h-20z",
		detail: `<path data-mechanism="feed-cover" d="M342 101h115l31 12v12H343z" fill="${paint.steel}"/>${seam("M347 104h107l28 10", true)}${seam("M345 122h142")}
		${port(399, 135, 70, 17)}<path data-mechanism="charging-handle" d="M421 147h73v6h-73z" fill="#626d72"/>
		<path data-mechanism="feed-tray" d="M365 128h61v6h-61z" fill="#535d63"/>${ribs(369, 129, 7, 4, 7)}${triggerGuard(376, 166, 41, 24)}
		<path d="M342 171h26l-11 44h-22z" fill="${paint.rubber}"/>${checkering(341, 182, 22, 24)}${selector(341, 150, 24)}${fastener(335, 133, 3)}${fastener(355, 155, 3)}${fastener(477, 158, 3)}
		<path data-mechanism="feed-cover-latch" d="M334 100h13v15h-13z" fill="#3b464b"/>${seam("M336 102v10", true)}` };
	// AK stamped receivers, the strengthened RPK trunnion, Saiga's deeper
	// shotgun action and the short Vityaz blowback frame have distinct cores.
	const rpk = gun.id === "rpk", saiga = gun.id === "saiga", vityaz = gun.id === "vityaz", akm = gun.id === "akm";
	const rear = saiga ? 317 : vityaz ? 326 : 323, cover = rpk ? 106 : saiga ? 112 : vityaz ? 111 : akm ? 108 : 109;
	return { material: "dark", bounds: [312, 101, 194, 123], outline: saiga
		? "M317 121h163l14 9v37h-116l-13 54h-38l13-54h-23z"
		: vityaz ? "M326 121h137l28 13v30h-114l-13 56h-37l13-56h-14z"
		: rpk ? "M323 119h148l23 9v37h-116l-15 55h-36l12-55h-16zM461 131h35v31h-35z"
		: akm ? "M323 120h143l25 9v36h-114l-14 55h-36l12-55h-16z"
		: "M323 119h149l19 9v37h-115l-13 55h-36l12-55h-16z",
		fillRule: "nonzero", detail: `<path data-mechanism="dust-cover" d="M${rear + 6} 119l13-${119 - cover}h119l28 16h-160z" fill="${paint.steel}"/>${seam(`M${rear + 15} ${cover + 3}h113l21 11`, true)}
		${port(vityaz ? 403 : saiga ? 383 : 384, 132, vityaz ? 61 : saiga ? 82 : 82, saiga ? 21 : 17)}
		<path data-mechanism="charging-handle" d="M437 138h49v6h-26l-10 8h-13z" fill="#798184"/>${seam("M448 139h32", true)}${selector(435, 155, 42, true)}
		<path d="M340 172h31l-11 43h-25z" fill="${akm ? paint.wood : paint.rubber}" stroke="#161e22" stroke-width=".8"/>${akm ? grain(341, 181, 23, 24) : checkering(341, 181, 24, 27)}${triggerGuard(377, 166, 43, 24)}
		${fastener(335, 136, 2.5)}${fastener(352, 157, 2.5)}${fastener(475, 158, rpk ? 3.4 : 2.5)}${fastener(466, 130, 2.1)}${seam("M328 159h81", true)}
		${rpk ? `<path data-mechanism="reinforced-trunnion" d="M462 135h26v20h-26z" fill="#464f54"/>${fastener(468, 139, 2.5)}${fastener(482, 152, 2.5)}${seam("M464 134h23", true)}` : akm ? `<path data-mechanism="receiver-stamping" d="M350 138h19l-2 10h-16z" fill="#364045" stroke="#687277" stroke-width=".7"/>` : saiga ? `<path data-mechanism="magazine-well" d="M413 158h54v12h-54z" fill="#30393e"/>${fastener(462, 163, 2)}` : vityaz ? `<path data-mechanism="magazine-well" d="M416 158h47v12h-47z" fill="#354046"/>${seam("M419 161h40", true)}` : `<path data-mechanism="receiver-stamping" d="M349 140h23v6h-23z" fill="#2e393f" stroke="#687277" stroke-width=".7"/>`}
		<path data-mechanism="rear-sight" d="M478 111h14v13h-14zM480 109h10v4h-10z" fill="#222a2e"/>` };
}

function factoryStockGeometry(gun: Profile, paint: Paint): Geometry | undefined {
	const butt = `<path d="M101 160h10v61h-10z" fill="${paint.rubber}"/>${seam("M105 164v51", true)}`;
	const sling = `<path d="M139 201h15v5h-15z" fill="#3c4447"/>${fastener(143, 203, 1.6)}`;
	if (gun.id === "sks" || gun.id === "mosin") {
		const mosin = gun.id === "mosin";
		return { material: "wood", bounds: [96, 128, 399, 102], outline: mosin
			? "M104 151l107-15h55l56 13h17l18-7h119v15h-97l-22 9h-32l-81 22-115 38h-25z"
			: "M105 151l104-12h48l62 11h44l15-8h109v23h-90l-30 10h-38l-96 20-104 31h-24z",
			detail: `${grain(128, 154, 132, 35)}${grain(331, 154, 116, 14)}${butt}${sling}${seam(mosin ? "M119 154l97-13h47l61 13" : "M121 154l92-11h40l65 12", true)}
			${seam("M277 162l45-3m12 3h30")}${fastener(282, 160, 2.7)}${fastener(465, 154, 2.3)}${mosin ? `<path d="M195 185h16v6h-16z" fill="#393d3c"/>` : `<path d="M331 166h31v5h-31z" fill="${paint.steel}"/>`}` };
	}
	if (gun.id === "svd" || gun.id === "vss") {
		const svd = gun.id === "svd";
		return { material: "wood", bounds: [95, 128, 233, 103], outline: svd
			? "M102 146h104l56-9 62 7v22l-51 17-13 43h-43l-37-36-71 36h-9zM133 159v44l39-23 36 30h35l12-34-17-18z"
			: "M105 150q39-11 83-3h67l67-8v25l-49 23-14 39h-39l-31-36-71 34h-16zM138 162v39l36-21 40 33h29l15-37-22-16z",
			detail: `${grain(126, 151, 128, 17)}${butt}${sling}${fastener(243, 217, 2.6)}${fastener(303, 153, 3)}${seam("M131 150h62l62-9", true)}
			${svd ? `<path d="M145 131h70v16h-70z" fill="${paint.rubber}"/>${seam("M150 134h60", true)}<path d="M239 199h17v5h-17z" fill="#4c514e"/>` : `${seam("M190 154h58")}${fastener(221, 155, 2)}`}` };
	}
	if (gun.id === "rpk") return { material: "wood", bounds: [96, 129, 232, 103], outline: "M104 146l102-11h53l65 12v21h-52l-24 29-12 29h-39l-6-27-65 26h-24z", detail: `${grain(127, 153, 128, 31)}${butt}${sling}${seam("M118 149l91-9h47l58 12", true)}${fastener(281, 155, 3)}<path d="M204 204h27v18h-23z" fill="#735540"/>${seam("M209 209h17")}` };
	if (gun.id === "akm" || gun.id === "ak74") {
		const akm = gun.id === "akm";
		return { material: "wood", bounds: [97, 130, 231, 98], outline: akm
			? "M104 146l110-12h49l61 14v20h-54l-34 15-111 41h-22z"
			: "M108 149l100-14h57l59 13v19h-51l-39 18-110 39h-22z",
			detail: `${grain(128, 154, 127, 32)}${butt}${sling}${seam("M119 151l95-12h45l53 13", true)}${fastener(281, 155, 2.8)}${seam("M259 151l8 10h46")}${akm ? `<path d="M129 194h16v7h-16z" fill="#424945"/>` : `<path d="M252 137h20v7h-20z" fill="${paint.steel}"/>`}` };
	}
	if (gun.id === "pkp") return { material: "polymer", bounds: [97, 130, 232, 100], outline: "M105 147l102-12h57l62 13v18h-56l-29 22-111 37h-27z", detail: `${butt}${sling}<path d="M134 153h97l-6 22-89 33z" fill="#3c4442"/>${ribs(142, 164, 10, 21, 7)}${seam("M120 151l88-12h50l55 12", true)}${fastener(281, 156, 3)}` };
	return undefined;
}

function machinedBarrelGeometry(gun: Profile, appearance: string): Geometry {
	const pistol = gun.category === "pistol", fluted = appearance === "fluted";
	const start = pistol ? 550 : gun.integral ? 486 : 472, end = gun.barrelEnd;
	const upper = gun.integral ? 123 : pistol ? 124 : 128;
	const depth = gun.integral ? 40 : pistol ? 22 : fluted ? 19 : 24;
	const shoulder = Math.min(49, (end - start) * .45), inset = gun.integral ? 0 : pistol ? 3 : 2;
	return { outline: `M${start} ${upper}h${shoulder - 12}l12 ${inset}h${end - start - shoulder}v${depth - inset * 2}h-${end - start - shoulder}l-12 ${inset}H${start}z`, material: gun.integral ? "dark" : "steel", bounds: [start - 3, upper - 3, end - start + 6, depth + 6], muzzle: { x: end, y: upper + depth / 2 },
		detail: `${seam(`M${start + 3} ${upper + 2}h${shoulder - 17}l12 ${inset}h${end - start - shoulder - 3}`, true)}${seam(`M${start + shoulder - 9} ${upper + 1}v${depth - 2}`)}
		${fluted ? [5, 10, 15].filter((offset) => offset < depth - inset - 2).map((offset) => `<path d="M${start + shoulder + 4} ${upper + offset}h${end - start - shoulder - 24}" stroke="#1b1e20" stroke-width="1.6"/><path d="M${start + shoulder + 5} ${upper + offset + 1}h${end - start - shoulder - 26}" stroke="#8f9294" stroke-width=".55" opacity=".7"/>`).join("") : `${seam(`M${start + 23} ${upper + 1}v${depth - 2}M${end - 21} ${upper + inset}v${depth - inset * 2}`)}${ribs(end - 17, upper + inset + 1, 3, depth - inset * 2 - 2, 4)}`}
		<path data-mechanism="muzzle-crown" d="M${end - 3} ${upper + inset}v${depth - inset * 2}" stroke="#141719" stroke-width="2"/>` };
}

function serviceBarrelGeometry(gun: Profile, paint: Paint): Geometry {
	if (waveProfiles.has(gun.id)) {
		const start = bullpups.has(gun.id) ? 547 : gun.id === "vector" ? 544 : 480, end = gun.barrelEnd;
		const depth = gun.id === "ash12" || gun.bolt ? 16 : gun.pump ? 14 : 11;
		return { material: "steel", bounds: [start - 4, 120, end - start + 8, 34], outline: `M${start} 132h${end - start}v${depth}h-${end - start}z`, muzzle: { x: end, y: 132 + depth / 2 }, detail: `${seam(`M${start + 4} 134h${end - start - 8}`, true)}<path data-mechanism="barrel-shoulder" d="M${start + 8} 129h25v${depth + 6}h-25z" fill="${paint.dark}"/>${ribs(end - 14, 134, 3, depth - 4, 4)}${gun.bolt ? `<path data-mechanism="bolt-barrel-collar" d="M${start + 25} 130h9v${depth + 4}h-9z" fill="${paint.steel}"/>` : gun.pump ? `<path data-mechanism="m870-front-bead" d="M${end - 18} 127h5v5h-5z" fill="#b4a281"/>` : gun.category === "rifle" ? `<path data-mechanism="gas-block" d="M${Math.min(end - 36, 702)} 122h19v25h-19z" fill="${paint.dark}"/>` : ""}` };
	}
	if (newProfiles.has(gun.id)) {
		const start = gun.id === "p90" ? 542 : gun.id === "mp7" ? 479 : 472, end = gun.barrelEnd;
		const depth = gun.id === "trg42" ? 15 : 11;
		return { material: "steel", bounds: [start - 4, 119, end - start + 8, 32], outline: `M${start} 132h${end - start}v${depth}h-${end - start}z`, muzzle: { x: end, y: 132 + depth / 2 }, detail:
			`${seam(`M${start + 4} 134h${end - start - 8}`, true)}<path data-mechanism="modern-barrel-shoulder" d="M${start + 11} 128h23v${depth + 8}h-23z" fill="${paint.dark}"/>${seam(`M${end - 12} 132v${depth}M${end - 8} 132v${depth}`)}${gun.category === "rifle" ? `<path data-mechanism="modern-gas-block" d="M${Math.min(end - 36, 648)} 122h18v23h-18z" fill="${paint.dark}"/>${seam(`M${Math.min(end - 34, 650)} 125h13`, true)}` : ""}` };
	}
	const end = gun.barrelEnd, thick = gun.id === "pkp" || gun.category === "shotgun";
	const center = thick ? 140 : 137.5;
	const gas = !gun.bolt && !gun.pump && gun.category !== "smg";
	const gasStart = Math.min(507, end - 112), gasEnd = Math.min(637, end - 38);
	const front = end - (gun.id === "sks" ? 35 : 28), sight = gun.pump ? 124 : 113;
	return { outline: `M472 133h${end - 472}v${thick ? 14 : 9}H472z`, material: "dark", muzzle: { x: end, y: center }, bounds: [470, gun.id === "pkp" ? 81 : 108, end - 467, gun.id === "pkp" ? 155 : 45],
		detail: `${seam(`M481 135h${end - 485}`, true)}<path data-mechanism="barrel-shoulder" d="M${end - 24} 131h11v${thick ? 18 : 13}h-11z" fill="${paint.dark}" stroke="#172024" stroke-width=".8"/>${seam(`M${end - 22} 133v${thick ? 14 : 9}`, true)}
		${gun.pump ? `<path data-mechanism="front-bead" d="M${end - 16} 128h4v5h-4z" fill="#968b77"/>` : `<path data-mechanism="front-sight-block" d="M${front} 132v-${132 - sight}h7l5 8v${124 - sight}h5v11h-17z" fill="${paint.dark}" stroke="#171f24" stroke-width=".8"/>${seam(`M${front + 2} ${sight + 2}v${127 - sight}`, true)}${fastener(front + 9, 132, 1.5)}`}
		${gas ? gun.id === "pkp" ? `<path data-mechanism="gas-system" d="M505 151h147v12H505zM645 141h15v22h-15z" fill="${paint.dark}"/>${seam("M510 153h137", true)}${ribs(632, 154, 4, 7, 5)}` : `<path data-mechanism="gas-system" d="M${gasStart} 114h${gasEnd - gasStart - 13}l8 4h7v18h-12v-14H${gasStart}z" fill="${paint.dark}"/>${seam(`M${gasStart + 4} 116h${gasEnd - gasStart - 20}`, true)}${fastener(gasEnd - 5, 130, 1.9)}${gun.id === "svd" ? ribs(gasEnd - 16, 123, 3, 10, 4) : ""}` : ""}
		${gun.id === "pkp" ? `<path data-mechanism="carry-handle" d="M653 111V86h60v25m-57-22h54" fill="none" stroke="#465157" stroke-width="7"/>${seam("M657 87h51", true)}${ribs(626, 138, Math.min(14, Math.floor((end - 626) / 10)), 10, 10)}<path data-mechanism="factory-bipod" d="m667 150 16 77m-12-74 16 75m-8 2h18" fill="none" stroke="#4e5b62" stroke-width="4"/>${fastener(670, 151, 2.7)}` : ""}
		${seam(`M${end - 9} 134v${thick ? 12 : 7}M${end - 6} 134v${thick ? 12 : 7}`)}` };
}

function factoryMagazineGeometry(gun: Profile, paint: Paint): Geometry | undefined {
	if (!["saiga", "svd", "vss", "asval", "vityaz", "toz"].includes(gun.id)) return undefined;
	const toz = gun.id === "toz", val = gun.integral, vityaz = gun.id === "vityaz", svd = gun.id === "svd";
	const depth = toz ? 30 : val ? 49 : svd ? 55 : vityaz ? 68 : 84;
	const outline = toz ? `M418 166h46v${depth}h-43l-3-8z`
		: val ? `M420 166h44l-2 21 10 ${depth - 25}-34 9-17-${depth - 7}z`
		: svd ? `M419 166h46l-2 ${depth - 11}-7 11h-36l-7-11z`
		: vityaz ? `M420 166h38q0 45 17 ${depth - 7}l-26 14q-24-30-29-${depth + 7}z`
		: `M419 166h47l6 ${depth - 7}-5 7h-43l-5-9z`;
	return { outline, material: toz || svd || val ? "dark" : "polymer", bounds: [414, 163, 68, depth + 20],
		detail: `${seam(`M423 171h${vityaz ? 31 : 36}`, true)}${seam(`M427 181l${vityaz ? 5 : 0} ${depth - 23}m11-${depth - 23}l${vityaz ? 9 : 0} ${depth - 25}`)}${fastener(445, 176, 1.8)}
		${vityaz ? seam(`M451 178q0 36 14 ${depth - 21}`, true) : `<path d="M424 ${166 + depth - 5}h${val ? 36 : 40}v5h-${val ? 36 : 40}z" fill="${paint.dark}"/>`}
		${toz ? seam("M423 183h35", true) : svd ? `${ribs(427, 183, 4, 23, 8)}` : val ? `${ribs(429, 182, 3, 24, 9)}` : vityaz ? "" : `${ribs(429, 183, 5, 44, 7)}`}` };
}

function mountGeometry(appearance: string, paint: Paint): Geometry {
	if (appearance === "pistol-bridge") return { material: "steel", bounds: [406, 103, 231, 68], outline: "M424 114h18v41h79v-11h18v25H424z", detail: `${rail(410, 108, 157)}${rail(518, 145, 113)}${fastener(430, 157, 3)}${fastener(530, 158, 3)}${seam("M429 119v37h86", true)}<path data-hardware="pistol-bridge-frame-shoe" d="M431 152h29v9h-29z" fill="${paint.dark}"/>` };
	if (appearance.startsWith("dovetail-")) {
		const high = appearance === "dovetail-high", bridge = appearance === "dovetail-bridge", qd = appearance === "dovetail-qd";
		const top = high ? 79 : bridge ? 87 : qd ? 93 : 97, width = bridge ? 147 : high ? 105 : qd ? 124 : 113;
		return { outline: `M387 132h27V${top}h${width}v10H425v30h-38zM420 139h215v7H420z`, material: "steel", bounds: [383, top - 4, 257, 155 - top], detail: `${rail(412, top - 2, width)}${rail(518, 145, 113)}<path d="M393 136h27v6h-27" fill="${paint.dark}"/>${fastener(403, 136, 4)}${fastener(438, top + 4, 3)}${high ? `<path d="M417 99h20v14h-20" fill="${paint.dark}"/>` : ""}${bridge ? `<path d="M533 97v26h-20v-16" fill="none" stroke="#2f3234" stroke-width="8"/>${fastener(526, 119, 3)}` : ""}${qd ? `<path d="M418 137h30l10 6-11 4h-30z" fill="${paint.rubber}"/>${fastener(444, 142, 3)}` : ""}` };
	}
	if (appearance.startsWith("barrel-")) {
		const dual = appearance === "barrel-dual", long = appearance === "barrel-long", offset = appearance === "barrel-offset";
		const x = long ? 579 : dual ? 589 : 599, width = long ? 67 : dual ? 55 : offset ? 45 : 31;
		return { outline: `M${x} 125h${width}v31h-${width}zM${x + 4} 121h${width - 8}v8h-${width - 8}zM${x + 8} 153h${width - 16}v${offset ? 21 : 13}h-${width - 16}zM${x + width / 2 - 12} 115h24v12h-24z`, material: "steel", bounds: [x - (offset ? 17 : 4), 110, Math.max(width + (offset ? 37 : 8), 56), offset ? 74 : 66], detail: `${rail(x + width / 2 - 15, 115, 30)}${rail(x, 143, Math.max(width, 44))}<path d="M${x + 4} 132h${width - 8}v17h-${width - 8}z" fill="${paint.dark}"/>${rail(x - (offset ? 13 : 0), offset ? 174 : 165, width + (offset ? 25 : 0))}${fastener(x + 8, 132, 3)}${fastener(x + width - 8, 149, 3)}${dual ? `<path d="M${x + 19} 125v31M${x + 37} 125v31" stroke="#adb0b2" stroke-width="2"/>` : ""}${long ? vents(x + 12, 136, 4, 7, 8, 13) : ""}` };
	}
	if (appearance.startsWith("bottom-")) {
		const wide = appearance === "bottom-wide", offset = appearance === "bottom-offset", width = wide ? 105 : offset ? 73 : 52;
		return { outline: `M586 180h${width}v10h-${width}zM${offset ? 616 : 593} 149h${offset ? 44 : width - 14}v31h-${offset ? 44 : width - 14}zM520 145h113v6H520z`, material: "dark", bounds: [516, 141, width + 77, 53], detail: `${rail(518, 143, 113)}${fastener(597, 185, 3)}${fastener(577 + width, 185, 3)}${wide ? vents(601, 168, 5, 10, 6, 16) : `<path d="M601 166h25" stroke="#9fa2a4" stroke-width="2"/>`}${offset ? `<path d="m596 179 19-15" stroke="#696c6e" stroke-width="5"/>` : ""}` };
	}
	const triple = appearance === "top-triple", light = appearance === "top-light", width = triple ? 94 : light ? 56 : 69;
	return { outline: `M557 115h${width}v11h-${width}zM${light ? 566 : 585} 125h${light ? 36 : width - 36}v30h-${light ? 36 : width - 36}z`, material: light ? "steel" : "dark", bounds: [514, 110, Math.max(width + 47, 121), 51], detail: `${rail(518, 145, 113)}${rail(557, 114, width)}${rail(light ? 565 : 583, 151, light ? 40 : width - 31)}${fastener(570, 120, 3)}${fastener(548 + width, 120, 3)}${triple ? `<path d="M616 127h24v14h-24" fill="${paint.steel}"/>${vents(560, 128, 3, 7, 11, 9)}` : light ? `<path d="M572 130h21v14h-21" fill="#1e2123"/>` : `<path d="m588 128 25 15" stroke="#929597" stroke-width="2"/>`}` };
}

function flashlightGeometry(appearance: string, paint: Paint): Geometry {
	const sizes: Record<string, [number, number]> = { mini: [54, 16], long: [114, 18], armored: [80, 27], wide: [75, 33], angled: [77, 20], taped: [88, 21], focus: [101, 26], scout: [70, 18] };
	const [length, depth] = sizes[appearance] ?? sizes.mini!;
	const x = 601, y = 122 - depth / 2, head = appearance === "wide" ? 27 : appearance === "focus" ? 29 : 17;
	const angled = appearance === "angled", tapered = appearance === "scout";
	return { outline: `M${x} ${y + 3}h${length - head}l${angled ? 9 : 4}-${angled ? 8 : 3}h${head - (angled ? 9 : 4)}v${depth}h-${head - 4}l-4-3H${x}zM${x + 15} ${y + depth - 3}h21v${145 - (y + depth - 3)}h-21z`, material: appearance === "armored" ? "polymer" : "dark", bounds: [x - 5, y - (angled ? 9 : 5), length + 10, 149 - y + (angled ? 9 : 5)], detail: `<path d="M${x + length - 2} ${y + 3}v${depth - 6}" stroke="#e4d9a8" stroke-width="2.5"/><path d="M${x + 4} ${y + 6}h${length - head - 9}" stroke="#9ea1a3" stroke-width="1.5" opacity=".5"/>${ribs(x + 6, y + 8, Math.max(2, Math.floor((length - head - 10) / 7)), Math.max(5, depth - 12), 7)}${fastener(x + 25, 141, 3)}${appearance === "armored" ? `<path d="M${x + 9} ${y - 2}h42v5h-42M${x + 8} ${y + depth - 2}h43v6h-43" fill="${paint.rubber}"/>` : ""}${appearance === "taped" ? `<path d="M${x + 15} ${y + 1}h10v${depth}h-10M${x + 42} ${y + 1}h9v${depth}h-9" fill="#838688"/>` : ""}${appearance === "focus" ? `${ribs(x + length - 25, y + 2, 3, depth - 4, 7)}<path d="M${x + length - 35} ${y + 1}v${depth - 2}" stroke="#76797b" stroke-width="3"/>` : ""}${tapered ? `<path d="M${x + 4} ${y + 5}h35l9 4h-44z" fill="#7d8082" opacity=".4"/>` : ""}<path d="M${x - 5} 119h5v7h-5z" fill="${paint.rubber}"/>` };
}

function laserGeometry(appearance: string, paint: Paint): Geometry {
	const sizes: Record<string, [number, number]> = { micro: [39, 14], box: [62, 23], tube: [80, 13], dual: [73, 24], range: [88, 28], armored: [70, 25], offset: [55, 17], precision: [98, 20] };
	const [length, depth] = sizes[appearance] ?? sizes.micro!;
	const x = 518, y = 172 - depth;
	const tube = appearance === "tube", dual = appearance === "dual", offset = appearance === "offset";
	return { outline: tube ? `M${x} ${y + 1}h${length}v${depth - 2}h-${length}zM${x + 19} 139h23v${y - 138}h-23z` : `M${x} ${y + 4}l8-4h${length - 15}l7 6v${depth - 6}h-${length}zM${x + 13} ${offset ? 129 : 139}h25v${y + 5 - (offset ? 129 : 139)}h-25z`, material: appearance === "armored" ? "polymer" : "dark", bounds: [x - 5, offset ? 125 : 135, length + 10, offset ? 52 : 42], detail: `<path d="M${x + length - 2} ${y + 6}v${Math.max(3, depth - 11)}" stroke="${dual || ["range", "box"].includes(appearance) ? "#79c383" : "#d67065"}" stroke-width="2.5"/>${dual ? `<path d="M${x + length - 4} ${y + 3}v4" stroke="#d97463" stroke-width="2"/>` : ""}${fastener(x + 15, y + 8, 3)}${fastener(x + Math.min(length - 12, 44), y + depth - 5, 3)}<path d="M${x + 8} ${y + depth - 6}h${length - 17}" stroke="#75787a" stroke-width="1.3"/>${appearance === "range" ? `<path d="M${x + 23} ${y + 5}h28v11h-28z" fill="#2a2d2f" stroke="#a1a4a6" stroke-width="1.2"/><path d="M${x + 26} ${y + 9}h16" stroke="#aaadaf" stroke-width="2"/>` : ""}${appearance === "precision" ? `${ribs(x + 40, y + 4, 5, depth - 9, 7)}<path d="M${x + 27} ${y - 2}v${depth + 2}" stroke="#9fa2a4" stroke-width="3"/>` : ""}${appearance === "armored" ? `<path d="M${x + 5} ${y + 1}h${length - 13}v5h-${length - 13}" fill="${paint.rubber}"/>` : ""}${offset ? `<path d="M${x + 18} ${y - 10}h13v7h-13" fill="#9c9fa1"/>` : ""}${tube ? ribs(x + 7, y + 3, 3, depth - 6, 6) : ""}` };
}

function baseGeometry(slot: ModuleSlot, appearance: string, gun: Profile, paint: Paint): Geometry {
	const pistol = gun.category === "pistol";
	const wood = gun.wood && appearance === "factory";
	const material: Material = wood ? "wood" : "polymer";
	const end = gun.barrelEnd;
	switch (slot) {
		case "mount": return mountGeometry(appearance, paint);
		case "flashlight": return flashlightGeometry(appearance, paint);
		case "laser": return laserGeometry(appearance, paint);
		case "receiver": return receiverGeometry(gun, paint);
		case "stock": {
			const wave = waveStockGeometry(gun, appearance, paint); if (wave) return wave;
			const modern = modernStockGeometry(gun, appearance, paint); if (modern) return modern;
			const chassis = classicUpgradeStockGeometry(gun, appearance, paint); if (chassis) return chassis;
			if (pistol) return { outline: "M144 149h173v17H177l-25 41h-17z", detail: "", material: "steel", bounds: [132, 145, 186, 67] };
			if (appearance === "factory") { const factory = factoryStockGeometry(gun, paint); if (factory) return factory; }
			if (appearance === "skeleton") return { outline: "M106 145h80l24-9h114v30H213l-18 62h-83zM127 164v43h45l13-43zM207 148h88v8h-88z", material: "steel", bounds: [103, 133, 224, 98], detail: `<path d="M109 147h12v79h-12z" fill="${paint.rubber}"/><path d="m179 215 27-59m-74 60h42" fill="none" stroke="#a0a3a5" stroke-width="3"/>${fastener(207, 152, 3)}${fastener(306, 152, 4)}<path d="M224 140h57v5h-57" fill="#b1b4b6" opacity=".55"/>` };
			if (appearance === "precision") return { outline: "M98 144h98v-16h79v16h50v26h-65l-18 58h-39l-15-31-70 37H98zM207 166h33l-10 44h-16l-9-22z", material: "polymer", bounds: [91, 124, 237, 121], detail: `<path d="M96 144h15v95H95z" fill="${paint.rubber}"/><path d="M117 157h69v27l-67 37z" fill="#2d3032"/><path d="M196 124h82v18h-82z" fill="${paint.rubber}"/><path d="M264 147h57v7h-57" fill="${paint.steel}"/>${fastener(151, 173, 5)}${fastener(230, 224, 4)}<path d="M115 232h59v9h-59M221 233v10h16v-10" fill="${paint.steel}"/>${ribs(123, 163, 8, 14, 7)}` };
			if (appearance === "padded") return { outline: "M93 146q42-7 105-3l61-2 65 11v18h-60l-34 25-111 38H96z", material: gun.wood ? "wood" : "polymer", bounds: [88, 140, 239, 104], detail: `<path d="M95 143h22v96H92q-8-46 3-96z" fill="${paint.rubber}"/>${ribs(94, 155, 3, 68, 5)}<path d="M128 145h80q12 0 12 11v10h-91z" fill="${paint.rubber}"/>${gun.wood ? grain(129, 176, 111, 31) : vents(150, 177, 4, 12, 11, 20)}<path d="M124 222l102-34" stroke="#c2b290" stroke-width="2" opacity=".45"/>${fastener(276, 158, 3)}` };
			if (appearance === "folding" || (appearance === "factory" && ["toz", "pp91", "asval"].includes(gun.id))) return { outline: "M116 147h196l15 10v14H139v48h-22z", material: "steel", bounds: [109, 142, 219, 80], detail: `<path d="M142 167h149l-145 34" fill="none" stroke="#787b7d" stroke-width="8"/><path d="M125 149v65" stroke="#a7aaac" stroke-width="2"/><path d="M111 191h14v31h-14z" fill="${paint.rubber}"/>${fastener(309, 156, 4)}<path d="M287 160h18v8h-18" fill="#141719"/>` };
			if (appearance === "tactical" || appearance === "light") return { outline: "M111 150h177l34-5v24h-45l-14 50H112z", material: "polymer", bounds: [105, 136, 222, 87], detail: `<path d="M193 140h125v12H193z" fill="${paint.steel}"/><path d="M130 164h88v23h-84z" fill="#1b1e20"/><path d="M238 159h33l-12 50h-30z" fill="${paint.rubber}"/><path d="M113 151h12v70h-12z" fill="${paint.rubber}"/>${ribs(132, 197, 12, 13, 7)}${fastener(259, 173, 4)}<path d="M142 155h66" stroke="#979a9c" stroke-width="2" opacity=".65"/>` };
			if (gun.id === "vss" || gun.id === "svd") return { outline: "M104 148q28-9 70-3l88 2 57-8v25l-38 17-15 44h-46l-28-32-74 29h-16z M148 161l50 1 31 38h23l16-30-15-10-45-1-54 17z", material: "wood", bounds: [98, 140, 221, 89], detail: `${grain(123, 153, 127, 20)}<path d="M103 173h12v52h-12z" fill="${paint.rubber}"/>${fastener(242, 211, 3)}${fastener(301, 153, 3)}<path d="M153 148h99" stroke="#dbb279" stroke-width="2" opacity=".4"/>` };
			return { outline: "M106 148 211 134h52l61 12v23h-52l-38 15-108 39h-24z", material, bounds: [97, 131, 229, 96], detail: `<path d="M109 151 213 138h46l58 12v5h-59l-39-4-109 19z" fill="#d9b584" opacity="${wood ? ".28" : ".16"}"/>${wood ? grain(128, 159, 127, 37) : ribs(163, 154, 10, 32)}<path d="M100 169h13l9 55h-18z" fill="${paint.rubber}"/><path d="m207 168 26-2-28 14-65 25" stroke="#302d23" stroke-width="2" fill="none" opacity=".4"/>${fastener(281, 155, 3)}<path d="M132 193h16v5h-16" fill="#4b4e50"/>` };
		}
		case "barrel": {
			if (appearance === "heavy" || appearance === "fluted") return machinedBarrelGeometry(gun, appearance);
			if (pistol) {
				const start = Math.min(550, end - 18);
				return { outline: `M${start} 128h${end - start}v13h-${end - start}z`, detail: `<path d="M${start + 3} 130h${end - start - 5}" stroke="#bcbfc1" stroke-width="2" opacity=".7"/><path d="M${end - 7} 127v15" stroke="#181b1d" stroke-width="2"/>`, material: "dark", muzzle: { x: end, y: 134.5 }, bounds: [start - 2, 125, end - start + 5, 20] };
			}
			if (gun.integral) return { outline: `M486 128h${end - 486}q8 0 8 8v14q0 8-8 8H486z`, detail: `<path d="M491 132h${end - 491}" stroke="#b3b6b8" stroke-opacity=".42" stroke-width="2"/><path d="M${end - 18} 129v28m-5-28v28m-157-28v28" stroke="#202325" stroke-width="3"/>${vents(586, 141, 7, 4, 4, 12)}<path d="M${end - 12} 153h14" stroke="#56595b" stroke-width="2"/>`, material: "dark", muzzle: { x: end, y: 143 }, bounds: [483, 126, end - 474, 35] };
			return serviceBarrelGeometry(gun, paint);
		}
		case "handguard": {
			const wave = waveHandguardGeometry(gun, appearance, paint); if (wave) return wave;
			if (pistol) return { outline: "M475 145h77v10h-77z", detail: rail(478, 149, 71), material: "dark", bounds: [473, 143, 82, 19] };
			const right = gun.compact ? 601 : gun.integral ? 578 : 636;
			if (newProfiles.has(gun.id)) {
				const p90 = gun.id === "p90", start = p90 ? 518 : 482;
				const railed = ["rail", "carbon", "factory"].includes(appearance), bottom = appearance !== "light" && appearance !== "wood" && (!p90 || appearance !== "factory");
				const upperRail = p90 ? rail(498, 108, 136) : rail(375, 108, right - 383);
				const leftBound = railed ? 371 : p90 && bottom ? 497 : start - 5;
				const shells: Record<string, string> = p90 ? {
					factory: "M524 143h66l15 12v39l-12 17h-36l-34-32zM549 162h32v29h-16l-16-18z",
					rail: "M522 140h67l16 15v44l-12 17h-38l-33-35zM550 161h31v31h-17l-14-18z",
					light: "M527 146h58l14 11v37l-10 13h-29l-33-31zM549 163h29v28h-15l-14-16z",
					vented: "M523 143h64l18 13v41l-13 17h-36l-33-34zM548 162h33v29h-16l-17-17zM534 148h12v9h-12zM552 148h12v9h-12zM570 148h12v9h-12z",
					carbon: "M524 146q4-7 13-7h45q17 0 20 17v39q0 13-13 17h-31l-34-32zM550 163h29v27h-14l-15-16z",
				} : {
					factory: `M${start} 114h${right - start - 15}l15 18v41H${start}z`,
					rail: `M${start} 113h${right - start - 16}l16 25v37H${start}zM${start + 7} 143h19v18h-19z`,
					light: `M${start + 3} 132h${right - start - 20}l12 10v25l-9 5H${start + 3}z`,
					wood: `M${start + 2} 133h${right - start - 21}q15 0 15 12v19q0 12-15 12H${start + 8}q-9 0-9-10v-20z`,
					vented: `M${start} 127h${right - start - 17}l17 12v36H${start}zM${start + 13} 139h19v22h-19zM${start + 44} 139h19v22h-19z`,
					carbon: `M${start + 2} 118q5-5 16-5h${right - start - 33}q14 0 14 26v24q0 15-15 15H${start + 15}q-16 0-16-15z`,
				};
				return { material: appearance === "carbon" ? "carbon" : appearance === "wood" ? "wood" : appearance === "vented" ? "steel" : "polymer", bounds: [leftBound, railed ? 103 : 123, (p90 && railed ? 638 : right + 5) - leftBound, p90 ? railed ? 121 : 101 : 92], outline: shells[appearance] ?? shells.factory!, detail:
					`${railed ? upperRail : ""}${railed && !p90 ? `<path data-hardware="integrated-fore-end-spine" d="M${start + 5} 117h${right - start - 24}v9H${start + 5}z" fill="${paint.steel}" opacity=".45"/>${seam(`M${start + 9} 118h${right - start - 32}`, true)}` : ""}${railed ? rail(518, 145, right - 526) : ""}${railed && !p90 ? rail(486, 125, right - 491) : ""}${bottom ? p90 ? rail(501, 212, 108) : rail(491, 178, right - 500) : ""}${vents(start + 14, p90 ? 153 : 139, Math.max(2, Math.floor((right - start - 21) / 25)), appearance === "light" ? 15 : 12, p90 ? 8 : 19, 25)}${seam(`M${start + 5} 130h${right - start - 22}`, true)}${fastener(start + 9, p90 ? 188 : 162, 3)}${fastener(right - 9, 163, 3)}${appearance === "wood" ? grain(start + 11, 154, right - start - 23, 17) : ribs(start + 11, p90 ? 197 : 166, Math.max(2, Math.floor((right - start - 22) / 10)), p90 ? 7 : 8, 10)}` };
			}
			if (appearance === "wood") return { outline: `M482 132h${right - 497}q12 0 12 13v19q0 12-12 12H491q-12 0-12-13v-19z`, material: "wood", bounds: [475, 129, right - 470, 51], detail: `${grain(492, 147, right - 510, 29)}<path d="M490 133v42M${right - 10} 133v42" stroke="#2e3133" stroke-width="6"/><path d="M499 135h${right - 518}" stroke="#e5c396" stroke-width="2" opacity=".45"/>${vents(503, 138, Math.max(2, Math.floor((right - 520) / 25)), 14, 6, 25)}${gun.pump ? ribs(503, 151, Math.floor((right - 516) / 11), 23, 11) : ""}${fastener(487, 162, 3)}${fastener(right - 9, 162, 3)}` };
			if (appearance === "vented") return { outline: `M482 126h${right - 494}l12 11v32l-10 10H490l-11-11v-29z`, material: "steel", bounds: [475, 118, right - 470, 67], detail: `${rail(491, 178, right - 499)}${vents(494, 139, Math.floor((right - 509) / 29), 21, 23, 29)}<path d="M487 130h${right - 498}M490 174h${right - 504}" stroke="#cdd0d2" stroke-opacity=".45" stroke-width="1.6"/>${fastener(485, 160, 3)}${fastener(right - 10, 163, 3)}${gun.pump ? `<path d="M488 166h${right - 501}v5H488" fill="${paint.rubber}"/>` : ""}` };
			if (appearance === "carbon") return { outline: `M483 131q6-8 18-8h${right - 516}q16 0 16 15v26q0 14-17 14H498q-19 0-19-15v-17z`, material: "carbon", bounds: [371, 103, right - 366, 83], detail: `${topBridge(right)}${rail(518, 145, right - 526)}<path d="M487 126h12v50h-12M${right - 16} 126h10v50h-10" fill="${paint.dark}"/>${rail(491, 121, right - 510)}${rail(491, 178, right - 510)}<path d="M502 129h${right - 530}" stroke="#a0a3a5" stroke-opacity=".45" stroke-width="2"/>${vents(505, 141, Math.floor((right - 531) / 26), 15, 16, 26)}${fastener(492, 155, 3)}${fastener(right - 11, 155, 3)}` };
			const light = appearance === "light";
			return { outline: `M483 132h${right - 498}l15 9v32H487l-8-12z`, material: appearance === "rail" ? "dark" : material, bounds: [appearance === "rail" ? 371 : 475, appearance === "rail" ? 103 : 119, right - (appearance === "rail" ? 366 : 470), appearance === "rail" ? 80 : 60], detail: `${appearance === "rail" ? `${topBridge(right)}${rail(518, 145, right - 526)}` : ""}<path d="M487 135h${right - 502}l10 6H486z" fill="#d2c099" opacity="${wood ? ".32" : ".18"}"/>${appearance === "rail" ? `${rail(486, 125, right - 490)}${rail(493, 172, right - 501)}${vents(492, 143, Math.floor((right - 505) / 17), 10, 12)}` : wood ? `${grain(492, 153, right - 504, 19)}${vents(494, 136, Math.floor((right - 510) / 20), 9, 6, 20)}` : `${vents(492, 143, Math.floor((right - 508) / (light ? 24 : 16)), light ? 16 : 8, 12, light ? 24 : 16)}${ribs(491, 163, Math.floor((right - 505) / 8), 9, 8)}`}${gun.pump ? `<path d="M485 169h${right - 490}v10H485z" fill="${paint.steel}"/>${ribs(486, 138, 15, 34, 9)}` : ""}${fastener(488, 163, 2.6)}${fastener(right - 10, 162, 2.6)}` };
		}
		case "magazine": {
			const wave = waveMagazineGeometry(gun, appearance, paint); if (wave) return wave;
			const modern = modernMagazineGeometry(gun, appearance, paint);
			if (modern) {
				if (gun.id === "p90" && appearance === "window") {
					modern.outline += "M292 113h178v10H292z";
					modern.detail = modern.detail.replace('opacity=".7"', 'opacity=".35"');
				}
				return modern;
			}
			if (gun.id === "toz" && ["extended", "quick", "window", "compact"].includes(appearance)) {
				const depth = appearance === "extended" ? 56 : appearance === "window" ? 42 : appearance === "compact" ? 21 : 34;
				return { material: "steel", bounds: [413, 162, 58, depth + (appearance === "quick" ? 23 : 10)], outline: `M418 166h46v${depth}h-43l-3-8z`, detail: `<path data-mechanism="toz-straight-box-feed" d="M422 171h38v${depth - 10}h-38z" fill="${paint.dark}"/>${appearance === "window" ? `<path d="M429 177h24v22h-24z" fill="#19252a" stroke="#889493"/>${Array.from({ length: 4 }, (_, i) => `<path d="M431 ${181 + i * 5}h20" stroke="#b4a170" stroke-width="2"/>`).join("")}` : ribs(430, 177, 3, Math.max(5, depth - 19), 9)}${seam("M423 170h35", true)}<path d="M417 ${162 + depth}h50v8h-50z" fill="${paint.rubber}"/>${appearance === "quick" ? `<path d="M429 ${depth + 170}v9h20v-9" fill="none" stroke="#828d8f" stroke-width="4"/>` : ""}${fastener(439, 174, 1.8)}` };
			}
			if (["svd", "saiga"].includes(gun.id) && ["extended", "quick", "window", "compact"].includes(appearance)) {
				const svd = gun.id === "svd", window = appearance === "window", quick = appearance === "quick";
				const depth = svd ? appearance === "compact" ? 32 : appearance === "extended" ? 76 : 55 : appearance === "compact" ? 48 : appearance === "extended" ? 108 : 84;
				const box = svd ? `M419 166h46l-2 ${depth - 11}-7 11h-36l-7-11z` : `M419 166h47l6 ${depth - 7}-5 7h-43l-5-9z`;
				const added = window ? `M431 179h21v${depth - 22}h-21z` : quick ? `M427 ${depth + 169}h26v16h-26zM431 ${depth + 173}h18v8h-18z` : "";
				return { material: svd ? "steel" : "polymer", bounds: [409, 161, 69, depth + (quick ? 25 : 14)], outline: box + added, detail: `<path data-mechanism="${svd ? "svd-tapered-box-feed" : "saiga-shotgun-box-feed"}" d="M425 173h34" fill="none" stroke="#889495" stroke-width="1"/>${window ? `<path d="M431 179h21v${depth - 22}h-21z" fill="#19252a" stroke="#889493"/>${Array.from({ length: Math.max(2, Math.floor((depth - 22) / 9)) }, (_, i) => `<path d="M433 ${184 + i * 9}h17" stroke="#b4a170" stroke-width="2"/>`).join("")}` : ribs(428, 181, 4, Math.max(10, depth - 26), 8)}<path d="M419 ${163 + depth}h${svd ? 38 : 52}v7h-${svd ? 38 : 52}z" fill="${paint.rubber}"/>${quick ? `<path d="M430 ${depth + 174}v9h20v-9" fill="none" stroke="#828d8f" stroke-width="4"/>` : ""}${fastener(445, 175, 1.8)}` };
			}
			const extended = appearance === "extended";
			const quick = appearance === "quick";
			if (appearance === "factory") { const factory = factoryMagazineGeometry(gun, paint); if (factory) return factory; }
			if (appearance === "drum") {
				// The drum axis runs along the gun. A side projection shows its rim
				// and housing, never the circular front cover or radial spokes.
				const smg = gun.category === "smg", width = smg ? 47 : gun.category === "shotgun" ? 70 : 60;
				const bottom = smg ? 264 : gun.category === "shotgun" ? 286 : 276;
				return { outline: `M421 166h43v39h-43zM414 207q0-10 10-10h${width - 20}q10 0 10 10v${bottom - 217}q0 10-10 10h-${width - 20}q-10 0-10-10z`, material: "dark", fillRule: "nonzero", bounds: [410, 163, width + 8, bottom - 159], detail: `<path d="M429 207h${width - 15}v${bottom - 220}h-${width - 15}z" fill="${paint.polymer}" stroke="#8e9193" stroke-width="1.6"/><path d="M${421 + width - 10} 204v${bottom - 210}" stroke="#1d2022" stroke-width="5"/>${ribs(434, 214, Math.floor((width - 18) / 9), bottom - 233, 9)}<path d="M425 ${bottom - 6}h${width - 8}" stroke="#888b8d" stroke-width="2"/><path d="M427 171h30v27h-30" fill="#696c6e" opacity=".4"/>${fastener(436, 208)}${fastener(420 + width - 12, bottom - 14)}` };
			}
			if (appearance === "window" || appearance === "compact") {
				const window = appearance === "window", depth = window ? 73 : 43;
				if (pistol) return { outline: `M346 194h43l-7 ${window ? 39 : 28}h-43z`, material: "dark", bounds: [333, 191, 61, window ? 50 : 39], detail: `${window ? `<path d="m355 202 22 1-4 23h-23z" fill="#1a1d1f" stroke="#8b8e90" stroke-width="1.5"/>${Array.from({ length: 4 }, (_, index) => `<path d="m354 ${206 + index * 5} 18 1" stroke="#b5a070" stroke-width="2"/>`).join("")}` : `<path d="m349 207 29 1" stroke="#939698" stroke-width="3"/>`}<path d="M335 ${window ? 232 : 221}h49v6h-49" fill="${paint.rubber}"/>` };
				if (gun.pump) { const length = window ? 241 : 161; return { outline: `M468 154h${length}v11H468z`, material: "steel", bounds: [465, 151, length + 7, 20], detail: `<path d="M476 156h${length - 13}" stroke="#bfc2c4" stroke-width="1.5"/>${window ? Array.from({ length: 4 }, (_, index) => `<rect x="${506 + index * 42}" y="157" width="24" height="5" rx="2" fill="#a49865" stroke="#1d2022" stroke-width="1"/>`).join("") : `<path d="M618 153v13" stroke="#1a1d1f" stroke-width="4"/>`}` }; }
				if (gun.id === "pkp") return { outline: `M408 167h105v${depth + 2}H408z`, material: "polymer", bounds: [405, 164, 113, depth + 10], detail: `${window ? `<path d="M432 181h57v48h-57z" fill="#222527" stroke="#9b9ea0" stroke-width="2"/>${Array.from({ length: 6 }, (_, index) => `<path d="M438 ${187 + index * 7}h44" stroke="#b4a16e" stroke-width="3"/>`).join("")}` : ribs(421, 178, 8, 23, 11)}<path d="M408 ${169 + depth}h109v5H408" fill="${paint.dark}"/>${fastener(420, 177)}${fastener(504, 177)}` };
				if (gun.id === "mosin" || gun.id === "sks") { const boxDepth = window ? 40 : 24; return { outline: `M408 165h58l-7 ${boxDepth}h-39l-12-11z`, material: "dark", bounds: [405, 162, 65, boxDepth + 8], detail: `${window ? `<path d="M419 174h36l-3 22h-28z" fill="#1d2022" stroke="#949799" stroke-width="1.5"/>${Array.from({ length: 4 }, (_, index) => `<path d="M425 ${180 + index * 5}h23" stroke="#b8a36f" stroke-width="2"/>`).join("")}` : `<path d="M421 174h32" stroke="#8c8f91" stroke-width="2"/>`}<path d="M422 ${161 + boxDepth}h33v6h-33" fill="${paint.rubber}"/>` }; }
				if (gun.category === "smg") return { outline: `M420 166h41l3 ${depth + 2}h-43z`, material: "polymer", bounds: [417, 163, 51, depth + 12], detail: `${window ? `<path d="M432 179h17v47h-17z" fill="#1e2123" stroke="#95989a" stroke-width="1.5"/>${Array.from({ length: 7 }, (_, index) => `<path d="M433 ${183 + index * 6}h15" stroke="#bba674" stroke-width="2"/>`).join("")}` : ribs(430, 175, 3, 27, 8)}<path d="M419 ${168 + depth}h48v7h-48z" fill="${paint.rubber}"/>` };
				return { outline: `M419 166h48q-2 ${depth * .55} 28 ${depth - 5}l-33 20q-40-28-45-${depth + 15}z`, material: "polymer", bounds: [415, 163, 85, depth + 30], detail: `${window ? `<path d="M433 184h20q4 30 20 47l-13 8q-24-21-27-55z" fill="#202325" stroke="#979a9c" stroke-width="2"/>${Array.from({ length: 7 }, (_, index) => `<path d="m${435 + index * 1.8} ${190 + index * 6} 16 -3" stroke="#b9a574" stroke-width="2"/>`).join("")}` : `<path d="M429 172h29q1 19 17 33l-17 10q-26-18-29-43z" fill="#696c6e" opacity=".5"/>`}<path d="m${447 + depth * .17} ${181 + depth} 33-19 4 6-33 20z" fill="${paint.rubber}"/>${fastener(443, 176, 2)}` };
			}
			if (pistol) return { outline: `M346 194h43l-${extended ? 13 : 6} ${extended ? 58 : 34}h-44z`, detail: `<path d="m349 208 30 1m-33 9 30 1" stroke="#65686a" stroke-width="2"/>${extended ? ribs(342, 226, 5, 20, 6) : ""}<path d="M${extended ? 330 : 335} ${extended ? 246 : 225}h48v7h-48z" fill="${paint.rubber}"/>${quick ? `<path d="M347 229v17h21v-17" fill="none" stroke="#8a8d8f" stroke-width="6"/>` : ""}`, material: "dark", bounds: [327, 192, 65, extended ? 64 : quick ? 57 : 44] };
			if (gun.pump) { const length = extended ? 273 : quick ? 202 : 228; return { outline: `M468 154h${length}v10H468z`, material: "steel", bounds: [465, 152, length + 6, 17], detail: `<path d="M477 156h${length - 21}" stroke="#919496" stroke-width="1.5"/><path d="M${length + 460} 153v12" stroke="#1b1e20" stroke-width="3"/>` }; }
			if (gun.id === "mosin" || (gun.id === "sks" && !extended)) { const depth = extended ? 58 : 36; return { outline: `M407 165h58l-7 ${depth}h-37l-14-13z`, material: "dark", bounds: [404, 162, 64, depth + (quick ? 22 : 7)], detail: `<path d="M416 174h42l-5 ${depth - 15}h-29z" fill="#56595b"/><path d="M421 182h29m-29 6h27" stroke="#2d3032" stroke-width="2"/>${fastener(439, 165 + depth - 7, 2)}${quick ? `<path d="M425 199v15h21v-15" fill="none" stroke="#8a8d8f" stroke-width="6"/>` : ""}` }; }
			if (gun.id === "pkp") { const depth = extended ? 93 : quick ? 54 : 72; return { outline: `M408 167h105v${depth}H408z`, material: "polymer", bounds: [405, 164, 111, depth + 8], detail: `<path d="M410 173h102v9H410" fill="#848789" opacity=".3"/>${ribs(421, 187, 9, depth - 29, 10)}<path d="M408 ${167 + depth}h109v5H408" fill="${paint.dark}"/>${fastener(420, 177)}${fastener(504, 177)}${quick ? `<path d="M417 181h86v11h-86z" fill="#9e9471"/>` : ""}` }; }
			if (gun.id === "pp91" || gun.category === "smg") return { outline: `M420 166h41l${extended ? 5 : 3} ${extended ? 85 : 63}h-43z`, material: "dark", bounds: [416, 163, 57, extended ? 96 : quick ? 90 : 74], detail: `<path d="m430 174 2 ${extended ? 66 : 46}m15-${extended ? 66 : 46} 2 ${extended ? 66 : 46}" stroke="#76797b" stroke-width="2"/><path d="M419 ${extended ? 248 : 226}h49v8h-49" fill="${paint.rubber}"/>${quick ? `<path d="M433 230v16h21v-16" stroke="#797c7e" stroke-width="6" fill="none"/>` : ""}` };
			const depth = extended ? 94 : 73;
			return { outline: `M419 166h48q-2 ${depth * .52} 31 ${depth - 10}l-32 20q-43-32-47-${depth + 10}z`, material: gun.id === "akm" && appearance === "factory" ? "dark" : "polymer", bounds: [415, 163, quick ? 101 : 95, depth + 30], detail: `<path d="M429 173h27q0 ${depth * .55} 29 ${depth - 11}l-15 9q-35-29-41-${depth - 2}z" fill="#96999b" opacity=".28"/><path d="m434 186q4 ${depth * .57} 31 ${depth - 18}m-19-${depth - 19}q4 ${depth * .48} 23 ${depth - 23}" fill="none" stroke="#2d3032" stroke-width="3"/><path d="m464 ${depth + 172} 37-22 5 7-37 23z" fill="${paint.rubber}"/>${quick ? `<path d="m474 ${depth + 174} 11 11 25-16-9-13" stroke="#929597" stroke-width="6" fill="none"/>` : ""}${fastener(444, 180, 2)}` };
		}
		case "optic": {
			// All optics are right-facing orthographic side views. Lens surfaces
			// are edge strips; sight windows and reticles are not visible side-on.
			if (appearance === "micro") return { outline: "M397 100h65v10h-65zM409 79h34l12 9v12h-47z", material: "dark", bounds: [393, 74, 73, 40], detail: `<path d="M414 81h27l9 8v6h-36z" fill="${paint.polymer}"/><path d="M451 87v12" stroke="#919496" stroke-width="2"/>${fastener(429, 87, 4)}${fastener(453, 104, 2.5)}<path d="M412 76h12v6h-12" fill="${paint.steel}"/>` };
			if (appearance === "holo") return { outline: "M383 96h111v14H383zM391 95V60l8-10h46l12 15v30zM457 78h31v18h-31z", material: "dark", bounds: [379, 46, 120, 68], detail: `<path d="M399 58h41l9 11v20h-50z" fill="${paint.polymer}" stroke="#808385" stroke-width="1.4"/><path d="M450 64v28" stroke="#8c8f91" stroke-width="2"/><path d="M463 81h18v12h-18" fill="${paint.rubber}"/>${ribs(465, 83, 3, 8, 5)}<path d="M403 75h30v9h-30" fill="#c3ba8e" opacity=".65"/>${fastener(418, 65, 3)}${fastener(480, 104, 3)}<path d="M390 101h14v5h-14" fill="${paint.steel}"/>` };
			if (appearance === "prism") return { outline: "M380 70h76l18-14h28v42h-26l-20-9h-76zM393 89h12v21h-12zM450 89h12v21h-12z", material: "dark", bounds: [376, 51, 131, 64], detail: `<path d="M381 74h73l19-14h25" fill="none" stroke="#a2a5a7" stroke-width="2" opacity=".5"/><path d="M420 70V55h19v15" fill="${paint.steel}"/>${ribs(419, 54, 4, 9, 5)}<path d="M501 61v32" stroke="#888b8d" stroke-width="2"/><path d="M376 70v19M385 70v19" stroke="#16191b" stroke-width="3"/>${rail(388, 106, 82)}${fastener(398, 101, 3)}${fastener(456, 101, 3)}` };
			if (appearance === "scout") return { outline: "M405 76h82v15h-82zM391 72h20v24h-20zM482 67h27v34h-27zM418 92h10v18h-10zM473 92h10v18h-10z", material: "dark", bounds: [387, 60, 126, 55], detail: `<path d="M412 78h66" stroke="#a3a6a8" stroke-width="2" opacity=".65"/><path d="M446 76V64h15v12" fill="${paint.steel}"/>${ribs(445, 64, 3, 8, 5)}<path d="M507 71v25" stroke="#878a8c" stroke-width="2"/><path d="M394 74v20M403 74v20M490 69v31" stroke="#1f2224" stroke-width="2"/>${rail(413, 106, 76)}${fastener(423, 102, 2.5)}${fastener(479, 102, 2.5)}` };
			if (appearance === "longscope") return { outline: "M340 66h156l26-19h46v54h-46l-26-17H340zM314 61h32v30h-32zM369 85h13v25h-13zM479 85h13v25h-13z", material: "dark", bounds: [309, 27, 264, 88], detail: `<path d="M344 68h149l26-18h42" fill="none" stroke="#a9acae" stroke-width="2" opacity=".6"/><path d="M423 67V33h23v34M416 32h37v9h-37z" fill="${paint.steel}"/>${ribs(418, 31, 6, 9, 6)}<path d="M419 73h27v25h-27z" fill="${paint.steel}"/>${fastener(432, 87, 8)}<path d="M566 52v44" stroke="#898c8e" stroke-width="2"/><path d="M319 63v26m7-26v26m213-39v49m9-49v49" stroke="#1c1f21" stroke-width="3"/>${rail(360, 106, 144)}${fastener(375, 102, 3)}${fastener(485, 102, 3)}` };
			if (appearance === "dovetail-reflex") return { outline: "M390 98h88v13h-88zM401 96V75h31l14 18h23v5zM394 109h10v16h52v-16h10v26h-72z", material: "steel", bounds: [386, 70, 96, 70], detail: `<path d="M406 80h22l9 13h-31z" fill="${paint.polymer}"/><path d="m433 80 10 14" stroke="#949799" stroke-width="2"/>${fastener(416, 86, 4)}<path d="M400 126h63v8h-63" fill="${paint.dark}"/>${fastener(451, 130, 4)}${fastener(465, 105, 3)}` };
			if (appearance === "reflex") return { outline: "M386 96h82v12h-82zM397 93V67h32l18 26z", material: "dark", bounds: [382, 62, 90, 50], detail: `<path d="M402 72h23l14 19h-37z" fill="${paint.polymer}" stroke="#7c7f81" stroke-width="1.3"/><path d="m430 69 14 23" stroke="#999c9e" stroke-width="2"/>${fastener(413, 82, 4)}<path d="M391 100h65v5h-65" fill="#707375"/>${fastener(452, 99, 3)}` };
			return { outline: "M366 69h113v21H366zM349 64h23v31h-23zM475 59h39v41h-39zM385 90h10v21h-10zM456 90h10v21h-10z", material: "dark", bounds: [342, 46, 176, appearance === "dovetail" ? 82 : 70], detail: `<path d="M365 72h112" stroke="#a1a4a6" stroke-width="2" opacity=".5"/><path d="M477 62h33v6h-33" fill="#76797b"/><path d="M512 64v32" stroke="#86898b" stroke-width="2"/><path d="M349 65v29m5-29v29m130-31v34m6-34v34" stroke="#1c1f21" stroke-width="2"/><path d="M417 68V53h18v15m-23-14h28v5h-28" fill="${paint.steel}"/>${ribs(417, 50, 4, 10, 4)}<path d="M409 82h15v13h-15" fill="${paint.steel}"/>${fastener(417, 88, 4)}${fastener(390, 103, 3)}${fastener(461, 103, 3)}${appearance === "dovetail" ? `<path d="M386 109v14h76v-14" fill="none" stroke="#5c5f61" stroke-width="6"/>` : rail(375, 106, 104)}` };
		}
		case "muzzle": {
			const x = gun.barrelEnd;
			if (appearance === "flash") return { outline: `M${x - 12} 129h20v-4h45v7h-29v4h29v7h-29v4h29v7h-45v-4h-20z`, material: "steel", bounds: [x - 16, 122, 74, 36], muzzle: { x: x + 53, y: 139 }, detail: `<path d="M${x - 9} 131h17v16h-17" fill="${paint.dark}"/><path d="M${x + 11} 127h39M${x + 11} 152h39" stroke="#babdbf" stroke-opacity=".5" stroke-width="1.5"/><path d="M${x + 11} 127v25" stroke="#222527" stroke-width="3"/>` };
			if (appearance === "compact-suppressor") return { outline: `M${x - 8} 125h58q5 0 5 5v18q0 5-5 5h-58z`, material: "dark", bounds: [x - 12, 121, 72, 36], muzzle: { x: x + 55, y: 139 }, detail: `<path d="M${x - 5} 128h51" stroke="#aeb1b3" stroke-width="1.5" opacity=".6"/><path d="M${x + 43} 126v26M${x - 2} 126v26" stroke="#1a1d1f" stroke-width="3"/>${ribs(x + 6, 134, 5, 10, 6)}<path d="M${x + 52} 129v20" stroke="#16191b" stroke-width="3"/>` };
			if (appearance === "ported") return { outline: `M${x - 12} 128h21v-4h44l7 6v19l-7 6h-44v-5h-21z`, material: "steel", bounds: [x - 16, 120, 80, 39], muzzle: { x: x + 60, y: 139 }, detail: `<path d="M${x + 13} 127h34" stroke="#c4c7c9" stroke-width="2" opacity=".65"/>${vents(x + 13, 132, 3, 9, 12, 13)}<path d="M${x + 56} 130v18M${x - 3} 129v20" stroke="#1f2224" stroke-width="3"/>` };
			if (appearance === "suppressor") return { outline: `M${x - 11} 122h86q6 0 6 6v21q0 6-6 6h-86z`, material: "dark", muzzle: { x: x + 81, y: 139 }, bounds: [x - 15, 119, 112, 40], detail: `<path d="M${x - 8} 125h86" stroke="#9ea1a3" stroke-opacity=".5" stroke-width="2"/><path d="M${x + 72} 123v31m-5-31v31M${x - 3} 123v31m5-31v31" stroke="#1d2022" stroke-width="2"/>${ribs(x + 5, 134, 9, 11, 7)}<path d="M${x + 80} 124h4v28h-4" fill="#1b1e20"/>` };
			return { outline: `M${x - 12} 129h47v21h-47z`, material: "steel", muzzle: { x: x + 35, y: 139 }, bounds: [x - 15, 126, 54, 29], detail: `<path d="M${x - 8} 131h36" stroke="#bbbec0" stroke-width="1.4" opacity=".75"/>${vents(x + 1, 134, 3, 4, 12, 10)}<path d="M${x + 28} 129v21" stroke="#1e2123" stroke-width="3"/>` };
		}
		case "foregrip": {
			if (appearance === "stubby") return { outline: "M546 176h49v10h-8v28h-31v-28h-10z", material: "rubber", bounds: [542, 172, 57, 47], detail: `<path d="M561 188h19v20h-19z" fill="${paint.polymer}"/>${ribs(563, 191, 3, 14, 6)}<path d="M553 211h37v5h-37" fill="#1b1e20"/>${fastener(552, 181, 2.5)}${fastener(589, 181, 2.5)}` };
			if (appearance === "angled") return { outline: "M501 176h99v10h-15l-45 38h-26l-9-13 35-25h-39zM528 204l23-18h20l-33 27h-10z", material: "polymer", bounds: [497, 172, 107, 56], detail: `<path d="m512 211 10 9h15l46-38" fill="none" stroke="#9a9d9f" stroke-width="2.5" opacity=".6"/>${fastener(508, 181, 2.5)}${fastener(592, 181, 2.5)}<path d="m549 215 18-15" stroke="#212426" stroke-width="5"/>` };
			if (appearance === "bipod") return { outline: "M550 176h55v12h-18v18l24 70h-15l-26-70v-18h-20z", material: "steel", bounds: [546, 172, 70, 112], detail: `<path d="m580 209 23 64" stroke="#16191b" stroke-width="10"/><path d="m577 211 21 61" stroke="#b8bbbd" stroke-width="2"/><path d="M589 275h27v7h-27" fill="${paint.rubber}"/><path d="M587 237h12" stroke="#2a2d2f" stroke-width="5"/>${fastener(579, 198, 7)}${fastener(557, 182, 2.5)}${fastener(598, 182, 2.5)}` };
			if (appearance === "folding") return { outline: "M541 176h57v12h-23l35 43-17 13-39-49v-7h-13z", material: "polymer", bounds: [537, 172, 77, 76], detail: `<circle cx="565" cy="189" r="10" fill="${paint.steel}"/>${fastener(565, 189, 4)}<path d="m574 205 25 30" stroke="#1e2123" stroke-width="6"/><path d="m579 202 26 32" stroke="#96999b" stroke-width="2" opacity=".6"/><path d="m591 236 16-13 5 7-16 14z" fill="${paint.rubber}"/>${fastener(549, 181, 2.5)}${fastener(591, 181, 2.5)}` };
			if (appearance === "light") return { outline: "M538 175h62v10h-14l-20 31h-24l-9-9 15-24h-10z", material: "polymer", bounds: [529, 172, 75, 49], detail: `<path d="m549 185-11 20 7 6h14l17-26z" fill="#1f2224"/><path d="m546 211 15-25" stroke="#828587" stroke-width="2" opacity=".6"/>${fastener(550, 179)}${fastener(590, 179)}` };
			return { outline: "M550 176h47v11h-9l-3 53h-28l-4-53h-3z", material: "rubber", bounds: [546, 173, 55, 71], detail: `<path d="M558 184h26v50h-25z" fill="#535658"/>${ribs(561, 194, 3, 34, 7)}<path d="M555 235h32v8h-32" fill="#1c1f21"/>${fastener(556, 181, 2)}${fastener(591, 181, 2)}` };
		}
	}
}

function fittedHardware(slot: ModuleSlot, appearance: string, gun: Profile, paint: Paint): string {
	if (slot === "optic") {
		if (["scope", "dovetail", "scout", "longscope"].includes(appearance)) {
			const rings = appearance === "longscope" ? [369, 479, 66, 19, 13] : appearance === "scout" ? [418, 473, 76, 16, 10] : [385, 456, 69, 22, 10];
			const [rear = 385, front = 456, y = 69, depth = 22, width = 10] = rings;
			return `${[rear, front].map((x) => `<path data-hardware="scope-ring" d="M${x} ${y}h${width}v${depth}h-${width}z" fill="${paint.steel}" stroke="#161f23" stroke-width=".7"/>${seam(`M${x + 1} ${y + 2}v${depth - 4}`, true)}${fastener(x + width / 2, y + depth - 3, 1.6)}`).join("")}${seam(appearance === "longscope" ? "M351 75h67m33 0h38" : appearance === "scout" ? "M432 84h10m20 0h8" : "M400 79h13m29 0h11", true)}`;
		}
		if (appearance === "holo") return `${seam("M395 92V62l7-9h39l11 14v25", true)}${fastener(395, 88, 1.9)}${fastener(452, 88, 1.9)}<path data-hardware="battery-latch" d="M465 78h11v4h-11z" fill="#70787c"/>${seam("M386 107h93")}`;
		if (appearance === "micro") return `<circle cx="429" cy="87" r="6" fill="none" stroke="#777f82" stroke-width=".7"/>${seam("M416 99h24", true)}${seam("M412 104h15m12 0h11")}${fastener(410, 105, 1.6)}`;
		if (appearance === "prism") return `${seam("M398 89v16M455 89v16", true)}${fastener(430, 76, 2)}${seam("M473 60v35M495 62v30")}<path data-hardware="clamp-lever" d="M435 105h12l5 3h-17z" fill="${paint.steel}"/>`;
		return `${seam(appearance === "dovetail-reflex" ? "M403 78h25l14 15" : "M400 71h25l16 21", true)}${fastener(appearance === "dovetail-reflex" ? 407 : 399, appearance === "dovetail-reflex" ? 93 : 89, 1.6)}<path data-hardware="clamp-lever" d="M417 102h19l5 4h-24z" fill="${paint.steel}"/>${seam("M420 103h15", true)}`;
	}
	if (slot === "muzzle") return `${seam(`M${gun.barrelEnd - 5} 131v16M${gun.barrelEnd + 3} 131v16`, true)}${seam(`M${gun.barrelEnd - 1} 130v18`)}${appearance.includes("suppressor") ? `${seam(`M${gun.barrelEnd + 13} 128h22`, true)}<path data-hardware="locking-collar" d="M${gun.barrelEnd - 6} 133h8v12h-8z" fill="${paint.steel}" stroke="#172026" stroke-width=".8"/>${ribs(gun.barrelEnd - 4, 135, 2, 8, 3)}` : ""}`;
	if (slot === "flashlight") {
		const lengths: Record<string, number> = { mini: 54, long: 114, armored: 80, wide: 75, angled: 77, taped: 88, focus: 101, scout: 70 };
		const end = 601 + (lengths[appearance] ?? 54);
		return `${seam(`M${end - 17} 116v12M${end - 14} 116v12`)}<path data-hardware="pressure-switch" d="M606 117h12v5h-12z" fill="${paint.rubber}"/>${seam("M622 137h14v4h-14", true)}${fastener(630, 141, 1.4)}`;
	}
	if (slot === "laser") {
		const depths: Record<string, number> = { micro: 14, box: 23, tube: 13, dual: 24, range: 28, armored: 25, offset: 17, precision: 20 };
		const y = 172 - (depths[appearance] ?? 14);
		return `<path data-hardware="adjustment-cap" d="M${appearance === "tube" ? 543 : 537} 143h8v5h-8z" fill="${paint.steel}"/>${seam("M528 166h14", true)}${seam(`M522 ${y + 6}h7v5h-7`)}${appearance === "tube" ? "" : `<path data-hardware="warning-plate" d="M544 ${y + 6}h8v4h-8z" fill="#b1a27c" opacity=".5"/>`}`;
	}
	if (slot === "mount") {
		if (appearance.startsWith("dovetail-")) return `${seam("M390 133h18v10h-18", true)}<path data-hardware="locking-shoe" d="M421 138h24v6h-24z" fill="${paint.dark}"/>${fastener(433, 141, 1.7)}${seam("M445 140h55", true)}`;
		if (appearance.startsWith("barrel-")) {
			const x = appearance === "barrel-long" ? 579 : appearance === "barrel-dual" ? 589 : 599, width = appearance === "barrel-long" ? 67 : appearance === "barrel-dual" ? 55 : appearance === "barrel-offset" ? 45 : 31;
			return `${seam(`M${x + 2} 140h${width - 4}`)}${seam(`M${x + 4} 126h${width - 8}`, true)}${fastener(x + width / 2, 129, 1.7)}<path data-hardware="clamp-gap" d="M${x + 2} 150h${width - 4}v2h-${width - 4}z" fill="#131c21"/>`;
		}
		return `${seam("M521 146h22m12 0h15", true)}${fastener(526, 149, 1.5)}${fastener(627, 149, 1.5)}`;
	}
	return "";
}

// Accessory proportions are physical, not dependent on the host gun or card.
// Bake the scale into coordinates so loose/held/bench paths remain identical.
function fittedOpticProportions(shape: Geometry, appearance: string): Geometry {
	const scale = appearance === "micro" ? .92 : appearance === "reflex" || appearance === "dovetail-reflex" ? .86 : .82;
	const coordinate = (value: number, axis: "x" | "y", relative = false) => Number(((relative ? value : value - (axis === "x" ? 430 : 110)) * scale + (relative ? 0 : axis === "x" ? 430 : 110)).toFixed(3));
	const path = (source: string) => source.replace(/([MLHVQTCSmlhvqtcs])([^MLHVQTCSZmlhvqtcsz]*)/g, (_, command: string, args: string, position: number) => {
		let index = 0;
		return command + args.replace(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g, (value) => {
			const current = index++, axis = command.toUpperCase() === "H" ? "x" : command.toUpperCase() === "V" ? "y" : current % 2 === 0 ? "x" : "y";
			// An initial lowercase move is measured from the SVG origin; only
			// its subsequent coordinate pairs are relative to that first move.
			return String(coordinate(Number(value), axis, command === command.toLowerCase() && !(position === 0 && command === "m" && current < 2)));
		});
	});
	const detail = shape.detail.replace(/\bd="([^"]+)"/g, (_, source: string) => `d="${path(source)}"`).replace(/\b(x|y|cx|cy|width|height|r|stroke-width)="(-?[\d.]+)"/g, (_, attribute: string, value: string) => `${attribute}="${["x", "cx"].includes(attribute) ? coordinate(Number(value), "x") : ["y", "cy"].includes(attribute) ? coordinate(Number(value), "y") : Number((Number(value) * scale).toFixed(3))}"`);
	const [x, y, width, height] = shape.bounds;
	return { ...shape, outline: path(shape.outline), detail, bounds: [coordinate(x, "x"), coordinate(y, "y"), width * scale, height * scale] };
}

function geometry(slot: ModuleSlot, appearance: string, gun: Profile, paint: Paint): Geometry {
	const shape = baseGeometry(slot, appearance, gun, paint);
	// The folding VAL furniture includes its grip chassis. Keep that real part
	// when transferred to the compatible VSS action, whose wooden grip is absent.
	if (slot === "stock" && gun.id === "asval" && appearance === "factory") {
		shape.outline += "M339 164h39l-14 54h-37l12-54z";
		shape.bounds = [109, 142, 273, 85];
		shape.detail += `<path data-hardware="val-folding-stock-grip" d="M341 171h29l-11 42h-26z" fill="${paint.rubber}"/>${checkering(341, 181, 23, 25)}`;
	}
	const detailed = { ...shape, detail: shape.detail + fittedHardware(slot, appearance, gun, paint) };
	return slot === "optic" ? fittedOpticProportions(detailed, appearance) : detailed;
}

function renderPart(shape: Geometry, paint: Paint, slot: ModuleSlot, installed: boolean, selected: boolean, durability = 100, seed?: string): string {
	const fillRule = shape.fillRule ?? "evenodd";
	const placement = shape.offset ? ` transform="translate(${shape.offset.x} ${shape.offset.y})"` : "";
	if (!installed) return `<g data-module-slot="${slot}" class="weapon-part weapon-part--missing"${placement}><path d="${shape.outline}" fill="#595c5e" fill-opacity=".06" stroke="${selected ? "#e5b970" : "#747779"}" stroke-opacity="${selected ? ".9" : ".38"}" stroke-width="${selected ? "2" : "1.2"}" stroke-dasharray="6 5" fill-rule="${fillRule}"/></g>`;
	const localBounds: Bounds = [shape.bounds[0] - (shape.offset?.x ?? 0), shape.bounds[1] - (shape.offset?.y ?? 0), shape.bounds[2], shape.bounds[3]];
	const finish = surfaceDetail({ prefix: paint.prefix, slot, material: shape.material, outline: shape.outline, bounds: localBounds, fillRule, durability, seed });
	const raster = modularWeaponRasterPart(paint.prefix, seed, slot, shape.outline, localBounds, fillRule);
	return `<g data-module-slot="${slot}" class="weapon-part${selected ? " weapon-part--selected" : ""}"${placement}><path d="${shape.outline}" fill="${paint[shape.material]}" stroke="#10171b" stroke-width="1.3" fill-rule="${fillRule}"/>${raster}${shape.detail}${finish}${selected ? `<path d="${shape.outline}" fill="none" stroke="#c8a974" stroke-width="1.4" stroke-opacity=".88" fill-rule="${fillRule}"/>` : ""}</g>`;
}

const visibleCondition = (durability: number) => Number.isFinite(durability) ? Math.floor(Math.max(0, Math.min(100, durability)) / 20) * 20 : 0;
const installedCondition = (weapon: WeaponInstance, partCondition = 100) => Math.min(visibleCondition(weapon.durability), visibleCondition(partCondition));

function positioned(shape: Geometry, x: number, y: number): Geometry {
	if (!x && !y) return shape;
	return { ...shape, offset: { x, y }, bounds: [shape.bounds[0] + x, shape.bounds[1] + y, shape.bounds[2], shape.bounds[3]], ...(shape.muzzle ? { muzzle: { x: shape.muzzle.x + x, y: shape.muzzle.y + y } } : {}) };
}

function installedGeometry(slot: ModuleSlot, model: ModuleModel | undefined, gun: Profile, paint: Paint, installed: WeaponInstance["modules"] = {}): Geometry {
	// Factory parts remain the physical part that was installed. VSS and VAL
	// share a family, but swapping their stocks must swap wood and folding steel.
	const physical = model ? { ...moduleProfile(model), barrelEnd: gun.barrelEnd } : gun;
	let shape = geometry(slot, model?.appearance ?? "factory", physical, paint);
	if (slot === "mount" && model?.id === "mount-fal-bridge") shape = { ...shape, bounds: [329, 103, 328, 61], detail: `${rail(333, 108, 303)}<path data-mechanism="fal-receiver-optic-bridge" d="M334 113h12v22h-12zM481 113h13v21h-13z" fill="${paint.steel}"/>${fastener(340, 129, 3)}${fastener(487, 129, 3)}${shape.detail}` };
	const mount = installed.mount ? MODULE_BY_ID[installed.mount.modelId] : undefined;
	const handguard = installed.handguard ? MODULE_BY_ID[installed.handguard.modelId] : undefined;
	const mountLift = gun.id === "p90" && mount?.appearance.startsWith("bottom-") ? 36
		: newProfiles.has(gun.id) && mount?.appearance.startsWith("top-") && (gun.id === "p90" || !["factory", "rail", "carbon"].includes(handguard?.appearance ?? "")) ? -17 : 0;
	const compactShift = gun.compact ? -35 : gun.integral ? -58 : 0;
	const front = waveProfiles.has(gun.id) && gun.category !== "pistol" ? waveFront(gun) : gun.compact ? 601 : gun.integral ? 578 : 636;
	const barrelCenter = (front + gun.barrelEnd) / 2;
	const sideEnd = mount ? 631 + (mount.appearance.startsWith("dovetail-") ? 0 : compactShift) : front - 8;
	const directLaserCenter = waveProfiles.has(gun.id) && gun.category !== "pistol" ? (front + (bullpups.has(gun.id) ? 533 : gun.id === "vector" ? 534 : gun.id === "m870" ? 527 : 487) + 2) / 2 : 538;
	if (slot === "muzzle") {
		const barrel = installed.barrel ? MODULE_BY_ID[installed.barrel.modelId] : undefined;
		const barrelShape = geometry("barrel", barrel?.appearance ?? "factory", barrel ? { ...moduleProfile(barrel), barrelEnd: gun.barrelEnd } : gun, paint);
		return positioned(shape, 0, (barrelShape.muzzle?.y ?? 139) - 139);
	}
	if (slot === "mount") {
		const centers: Record<string, number> = { "barrel-ring": 614.5, "barrel-dual": 616.5, "barrel-long": 612.5, "barrel-offset": 621.5 };
		return positioned(shape, model?.appearance.startsWith("barrel-") ? barrelCenter - (centers[model.appearance] ?? 614.5) : model?.appearance.startsWith("dovetail-") ? 0 : compactShift, mountLift);
	}
	if (slot === "optic" && model?.requiresMount === "rail-top" && mount?.appearance.startsWith("dovetail-")) {
		const top: Record<string, number> = { "dovetail-low": 95, "dovetail-high": 77, "dovetail-qd": 91, "dovetail-bridge": 85 };
		return positioned(shape, mount.appearance === "dovetail-bridge" ? 35 : 0, (top[mount.appearance] ?? 108) - 110);
	}
	if (slot === "optic" && gun.id === "p90") return positioned(shape, 130, 0);
	if (slot === "optic" && gun.id === "ash12") return positioned(shape, 0, -25);
	if (slot === "foregrip" && gun.id === "p90") return positioned(shape, 0, 36);
	if (slot === "foregrip" && waveProfiles.has(gun.id)) return positioned(shape, 0, gun.id === "m870" ? 10 : gun.id === "ash12" ? 6 : 0);
	if (slot === "flashlight") return positioned(shape, (mount?.appearance.startsWith("barrel-") ? barrelCenter : sideEnd - 17) - 626.5, mount?.appearance.startsWith("barrel-") ? -27 : mountLift);
	if (slot === "laser") return positioned(shape, (mount?.appearance.startsWith("barrel-") ? barrelCenter : mount ? 538 : directLaserCenter) - (model?.appearance === "tube" ? 548.5 : 543.5), mount?.appearance === "barrel-offset" ? 25 : mount?.appearance.startsWith("barrel-") ? 18 : mountLift);
	return shape;
}

/** The silhouette is assembled from the actual installed parts; it is never a weapon thumbnail. */
export function weaponBuildArt(weapon: WeaponInstance, selectedSlot?: ModuleSlot): string {
	const baseGun = profile(weapon.weaponId);
	const { paint, defs } = palette(paintId(weapon.id));
	const installed = weapon.modules;
	const gun = installedBarrelProfile(baseGun, installed);
	const required = RECEIVER_INFO[weapon.weaponId]?.requiredSlots ?? ["receiver", "barrel", "magazine"];
	const visibleBounds: Bounds[] = [];
	const partArt = drawOrder.map((slot) => {
		const instance = installed[slot];
		const model = instance ? MODULE_BY_ID[instance.modelId] : undefined;
		if (!model && !required.includes(slot) && selectedSlot !== slot) return "";
		const shape = installedGeometry(slot, model, gun, paint, installed);
		visibleBounds.push(shape.bounds);
		return renderPart(shape, paint, slot, Boolean(model), selectedSlot === slot, installedCondition(weapon, instance?.durability), model?.id);
	}).join("");
	const title = WEAPON_BY_ID[weapon.weaponId]?.name ?? "Оружие";
	const missing = required.filter((slot) => !installed[slot]);
	const accessible = `${title}. ${missing.length ? `Не хватает: ${missing.map((slot) => labels[slot]).join(", ")}.` : "Собранное оружие."}${selectedSlot ? ` Выбран модуль: ${labels[selectedSlot]}.` : ""}`;
	// Frame the actual assembly: a pistol receives the same useful inspection
	// space as a rifle, and a long barrel/suppressor remains safely inside it.
	const left = Math.min(...visibleBounds.map(([x]) => x)) - 25, top = Math.min(...visibleBounds.map(([, y]) => y)) - 22;
	const right = Math.max(...visibleBounds.map(([x, , width]) => x + width)), bottom = Math.max(...visibleBounds.map(([, y, , height]) => y + height));
	const width = right - left + 25, height = bottom - top + 34;
	const shadowCenter = (left + 25 + right) / 2, shadowRadius = Math.max(70, (right - left - 25) * .43);
	return `<svg class="weapon-build-art" data-weapon-model="${escape(weapon.weaponId)}" viewBox="${left} ${top} ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escape(accessible)}"><title>${escape(accessible)}</title>${defs}${modularWeaponRasterDefs(paint.prefix, Object.values(installed).map((instance) => instance?.modelId), false)}<ellipse cx="${shadowCenter}" cy="${bottom + 18}" rx="${shadowRadius}" ry="7" fill="#080b0d" opacity=".28"/><g stroke-linejoin="round" stroke-linecap="round">${partArt}</g></svg>`;
}

/** The carried weapon uses the very same installed-part geometry as the workbench. */
export function weaponActorArt(weapon: WeaponInstance): { svg: string; width: number; height: number; referenceWidth: number; grip: { x: number; y: number }; muzzle: { x: number; y: number } } {
	const base = profile(weapon.weaponId), installed = weapon.modules;
	const gun = installedBarrelProfile(base, installed);
	const stock = installed.stock ? MODULE_BY_ID[installed.stock.modelId] : undefined;
	const { x: gripX, y: gripY } = weaponGripAnchor(gun.id, stock?.appearance, stock?.weaponId);
	const { paint, defs } = palette(paintId(weapon.id));
	const parts = drawOrder.flatMap((slot) => {
		const instance = installed[slot], model = instance ? MODULE_BY_ID[instance.modelId] : undefined;
		return model ? [{ shape: installedGeometry(slot, model, gun, paint, installed), slot, instance }] : [];
	});
	const left = Math.min(370, gripX, ...parts.map(({ shape }) => shape.bounds[0])) - 4;
	const top = Math.min(120, gripY, ...parts.map(({ shape }) => shape.bounds[1])) - 4;
	const right = Math.max(gun.barrelEnd, ...parts.map(({ shape }) => shape.bounds[0] + shape.bounds[2])) + 4;
	const bottom = Math.max(210, ...parts.map(({ shape }) => shape.bounds[1] + shape.bounds[3])) + 4;
	const width = right - left, height = bottom - top;
	// Actor scale follows the factory gun, so adding a suppressor extends the barrel
	// instead of shrinking the receiver, stock and every other installed part.
	const factoryBounds = drawOrder.flatMap((slot) => {
		const modelId = FACTORY_KITS[weapon.weaponId]?.[slot], model = modelId ? MODULE_BY_ID[modelId] : undefined;
		return model ? [geometry(slot, model.appearance, base, paint).bounds] : [];
	});
	const referenceWidth = Math.max(base.barrelEnd, ...factoryBounds.map((bounds) => bounds[0] + bounds[2])) - Math.min(370, ...factoryBounds.map((bounds) => bounds[0])) + 8;
	const muzzlePart = parts.find(({ slot }) => slot === "muzzle");
	const barrelPart = parts.find(({ slot }) => slot === "barrel");
	const muzzle = muzzlePart?.shape.muzzle ?? (muzzlePart ? { x: muzzlePart.shape.bounds[0] + muzzlePart.shape.bounds[2] - 10, y: 138 } : barrelPart?.shape.muzzle ?? { x: gun.barrelEnd, y: 138 });
	return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}">${defs}${modularWeaponRasterDefs(paint.prefix, parts.map(({ instance }) => instance?.modelId))}<g stroke-linejoin="round" stroke-linecap="round">${parts.map(({ shape, slot, instance }) => renderPart(shape, paint, slot, true, false, installedCondition(weapon, instance?.durability), instance?.modelId)).join("")}</g></svg>`, width, height, referenceWidth,
		grip: { x: gripX - left, y: gripY - top }, muzzle: { x: muzzle.x - left, y: muzzle.y - top } };
}

function moduleProfile(model: ModuleModel): Profile {
	if (model.weaponId) return profile(model.weaponId);
	const platform = model.platforms.join(" ").toLowerCase();
	const caliber = model.calibers.join(" ").toLowerCase();
	const modernFamilies: Record<string, string> = { ar: "m4a1", p90: "p90", mp7: "mp7", ump: "ump45", "1911": "m1911", mcx: "mcx", scar: "scarh", trg: "trg42", g36: "g36", aug: "aug", fal: "fal", ar10: "sr25", vector: "vector", fiveseven: "fiveseven", sr2: "sr2", sr1: "sr1", glock: "glock20", ash12: "ash12", tkm: "vpo209", svdk: "svdk", awm: "awm", m870: "m870" };
	const modern = model.platforms.map((id) => modernFamilies[id]).find(Boolean); if (modern) return profile(modern);
	const modernCalibers: Record<string, string> = { "5.56x45": "m4a1", "5.7x28": "p90", "4.6x30": "mp7", ".45acp": "ump45", ".300blk": "mcx", "7.62x51": "scarh", ".338lapua": "trg42", "9x21": "sr2", "10mm": "glock20", "12.7x55": "ash12", ".366tkm": "vpo209", "9.3x64": "svdk", ".300winmag": "awm" };
	const modernCaliber = model.calibers.map((id) => modernCalibers[id]).find(Boolean); if (modernCaliber) return profile(modernCaliber);
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
	const physical = moduleProfile(model);
	const shape = geometry(model.slot, model.appearance, model.slot === "barrel" ? barrelProfile(physical, model.appearance) : physical, paint);
	const [x, y, width, height] = shape.bounds;
	const scale = Math.min(214 / width, 91 / height);
	const translateX = 120 - (x + width / 2) * scale;
	const translateY = 55 - (y + height / 2) * scale;
	return `<svg class="module-art" data-model-id="${escape(model.id)}" viewBox="0 0 240 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escape(model.label)}"><title>${escape(model.label)}</title>${defs}${modularWeaponRasterDefs(paint.prefix, [model.id], false)}<ellipse cx="120" cy="107" rx="${Math.min(97, width * scale * .42).toFixed(1)}" ry="4" fill="#090c0e" opacity=".35"/><g transform="translate(${translateX.toFixed(2)} ${translateY.toFixed(2)}) scale(${scale.toFixed(4)})" stroke-linejoin="round" stroke-linecap="round">${renderPart(shape, paint, model.slot, true, false, 100, model.id)}</g></svg>`;
}

export const ARMORY_SLOT_ORDER: readonly ModuleSlot[] = slots;
