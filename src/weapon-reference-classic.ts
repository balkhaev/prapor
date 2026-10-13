import type { ReferenceGeometry as Geometry, ReferenceLayout, ReferencePaint as Paint, ReferenceProfile as Profile, ReferenceRenderer, ReferenceTools as Tools } from "./weapon-reference-types";

// Side silhouettes were checked against original photographs, not game renders:
// AKM: Swedish Army Museum / https://digitaltmuseum.se/011024370718
// SVD: Hokos / https://commons.wikimedia.org/wiki/File:SVD_Dragunov.jpg
// PKP and SVDK: Vitaly Kuzmin's original photographs at TsNII and 51st Regiment.
// MP-133: manufacturer passport, external-view figure reproduced by Huntstime.
const owned = new Set(["toz", "mp133", "sks", "ak74", "saiga", "vityaz", "mosin", "akm", "rpk", "svd", "pkp", "vpo209", "svdk", "m870"]);
const ak = new Set(["ak74", "akm", "rpk", "vpo209", "saiga", "vityaz"]);
const wrist = new Set(["sks", "mosin", "mp133", "m870"]);
const pump = (gun: Profile) => gun.id === "mp133" || gun.id === "m870";
const front = (gun: Profile) => ({ toz: 590, mp133: 561, sks: 612, ak74: 594, saiga: 616, vityaz: 614, mosin: 702, akm: 594, rpk: 594, svd: 620, pkp: 648, vpo209: 594, svdk: 657, m870: 591 } as Record<string, number>)[gun.id]!;
const rear = (gun: Profile) => gun.id === "svd" ? 245 : gun.id === "sks" ? 310 : gun.id === "mosin" ? 299 : gun.id === "mp133" ? 282 : gun.id === "m870" ? 300 : gun.id === "toz" || gun.id === "vityaz" ? 310 : 277;
const foreStart = (gun: Profile) => gun.id === "svd" ? 445 : gun.id === "vityaz" ? 502 : gun.id === "toz" ? 448 : gun.id === "mp133" ? 436 : gun.id === "m870" ? 451 : gun.id === "mosin" ? 454 : gun.id === "sks" ? 475 : 466;
const gripPath = (x: number, top = 164, depth = 65) => `M${x - 11} ${top}h34l8 14-14 ${depth - 14}h-32l12-${depth - 13}-8-13z`;
const gripDetail = (x: number, paint: Paint, tools: Tools, wood = false) => `<path data-hardware="classic-front-grip" d="${gripPath(x)}" fill="${wood ? paint.wood : paint.dark}"/>${tools.checkering(x - 8, 184, 19, 28)}${tools.fastener(x + 7, 175, 2.2)}`;
const grainBand = (x: number, y: number, width: number) => `<path d="M${x} ${y}q${width * .25}-2 ${width * .5} 0t${width * .5} 0" fill="none" stroke="#c9a270" stroke-width=".85" opacity=".36"/>`;

export function classicReferenceLayout(gun: Profile): ReferenceLayout | undefined {
	if (!owned.has(gun.id)) return undefined;
	const end = front(gun), start = foreStart(gun), sideEnd = end - 8;
	return { foreEnd: end, sideRailEnd: sideEnd, laserCenter: (start + 10 + sideEnd) / 2, genericMountShift: end - 691, topMountShift: end - 659, factoryTopMountShift: gun.id === "m870" ? -213 : end - 659, receiverTopMountShift: gun.id === "m870" ? -213 : end - 659,
		dovetailShift: gun.id === "svd" ? -50 : gun.id === "ak74" || gun.id === "akm" || gun.id === "rpk" || gun.id === "vpo209" || gun.id === "saiga" || gun.id === "svdk" ? -25 : 0,
		opticShift: gun.id === "svd" ? [-50, 0] : gun.id === "svdk" ? [-25, 0] : gun.id === "m870" ? [-45, 0] : [0, 0],
		foregripShift: gun.id === "toz" ? [-18, 0] : gun.id === "mp133" ? [-45, 8] : gun.id === "m870" ? [-15, 8] : [0, 0] };
}

function receiver(gun: Profile, paint: Paint, t: Tools): Geometry {
	const id = gun.id, start = rear(gun), end = id === "svd" ? 445 : id === "vityaz" ? 503 : id === "mp133" ? 424 : id === "m870" ? 437 : 470;
	if (ak.has(id)) {
		const smg = id === "vityaz", shotgun = id === "saiga", reinforced = id === "rpk";
		const grip = smg ? 325 : 300, roof = id === "akm" ? 116 : id === "vpo209" ? 118 : id === "rpk" ? 113 : shotgun ? 120 : smg ? 115 : 114;
		const guard = grip + 35, feed = smg ? 422 : 392;
		return { material: "dark", fillRule: "nonzero", bounds: [start - 6, roof - 9, end - start + 15, 245 - roof], outline: `M${start} ${roof + 15}l15-15h${end - start - 36}l21 17v${shotgun ? 40 : 33}h-${end - feed}v10h-${feed - start}z${gripPath(grip)}`,
			detail: `<path data-mechanism="${reinforced ? "reinforced-trunnion" : shotgun ? "saiga-deep-action" : smg ? "vityaz-blowback-action" : id === "vpo209" ? "tkm-semi-auto-receiver" : "stamped-ak-action"}" d="M${start + 8} ${roof + 15}h${end - start - 15}" fill="none" stroke="#718189" stroke-width=".9"/>${t.port(end - (smg ? 72 : 84), roof + 18, smg ? 62 : 73, shotgun ? 21 : 17)}${t.seam(`M${start + 16} ${roof + 4}h${end - start - 42}l18 14`, true)}${t.selector(end - 89, 153, 62, true)}<path data-mechanism="charging-handle" d="M${end - 57} 142h48v6h-25l-9 8h-14z" fill="#46545b"/>${t.triggerGuard(guard, 174, shotgun ? 52 : 49, 27)}${gripDetail(grip, paint, t, id === "akm")}${t.fastener(start + 12, 142, 2.5)}${t.fastener(start + 34, 158, 2.2)}${t.fastener(end - 13, 156, reinforced ? 3.3 : 2.5)}<path data-mechanism="magazine-well" d="M${feed} 165h${shotgun ? 56 : smg ? 37 : 44}v13h-${shotgun ? 56 : smg ? 37 : 44}z" fill="${paint.dark}"/>${t.seam(`M${start + 53} 145h23v7h-23z`)}<path data-mechanism="rear-sight" d="M${end - 5} ${roof + 4}v-12h26l6 8v4z" fill="${paint.dark}"/>` };
	}
	if (id === "pkp") return { material: "dark", fillRule: "nonzero", bounds: [270, 96, 238, 138], outline: `M277 124h17v-20h175l30 18v50H277z${gripPath(300)}`, detail: `<path data-mechanism="feed-cover" d="M294 106h172l25 16v12H294z" fill="${paint.dark}"/>${t.seam("M301 110h160l24 13", true)}${t.port(422, 128, 69, 18)}<path data-mechanism="feed-tray" d="M397 155h99v14h-99z" fill="${paint.steel}"/>${t.selector(311, 150, 31)}${t.triggerGuard(336, 174, 46, 27)}${gripDetail(300, paint, t)}${t.ribs(301, 134, 7, 9, 13)}<path data-mechanism="charging-handle" d="M330 149h78v7h-78z" fill="#44565f"/>${t.fastener(284, 143, 3)}${t.fastener(483, 154, 3)}` };
	if (id === "svd" || id === "svdk") {
		const large = id === "svdk", guard = large ? 335 : 280, feed = large ? 392 : 337;
		return { material: "dark", bounds: [start - 5, 107, end - start + 12, 101], outline: `M${start} 131l17-${large ? 18 : 15}h${end - start - 35}l18 17v36h-${end - feed}v11H${feed}l-9-11H${start}z`, detail: `<path data-mechanism="${large ? "svdk-enlarged-action" : "svd-milled-action"}" d="M${start + 8} 138h${end - start - 17}" fill="none" stroke="#677880" stroke-width=".8"/>${t.port(end - 92, 133, 83, large ? 22 : 18)}<path data-mechanism="charging-handle" d="M${end - 50} 141h43v7h-21l-9 9h-13z" fill="#465760"/>${t.selector(end - 77, 156, 56, true)}${t.triggerGuard(guard, 174, 47, 27)}${t.fastener(start + 12, 143, 2.4)}${t.fastener(end - 12, 160, 2.4)}<path data-mechanism="side-mount" d="M${start + 8} 150h65v6h-65z" fill="${paint.steel}"/>${t.seam(`M${start + 19} 122h${end - start - 43}l18 11`, true)}` };
	}
	if (pump(gun)) return { material: "dark", bounds: [start - 6, id === "m870" ? 102 : 113, end - start + 14, id === "m870" ? 107 : 96], outline: `M${start} ${id === "m870" ? 128 : 131}q0-12 14-12h${end - start - 39}l25 14v39H${start + 8}l-8-12z`, detail: `${id === "m870" ? `${t.rail(333, 108, 105)}<path data-hardware="m870-receiver-rail-carrier" d="M338 114h9v10h-9zM422 114h9v15h-9z" fill="${paint.dark}"/>` : ""}${t.port(end - 76, 133, 65, 18)}${t.triggerGuard(start + 21, 174, 47, 27)}<path data-mechanism="pump-action-bars" d="M${end - 15} 160h60v5h-60z" fill="${paint.steel}"/><path data-mechanism="${id === "m870" ? "m870-loading-port" : "mp133-loading-port"}" d="M${end - 69} 169h51v6h-51z" fill="${paint.dark}"/>${t.seam(`M${start + 16} 123h${end - start - 44}l20 13M${start + 13} 167h53`, true)}${t.fastener(start + 15, 150, 2.3)}${t.fastener(start + 57, 155, 2.3)}${t.fastener(end - 11, 161, 2.3)}<path data-mechanism="pump-release" d="M${start + 16} 172h10v13h-14v-6h4z" fill="${paint.steel}"/>` };
	if (id === "toz") return { material: "dark", fillRule: "nonzero", bounds: [304, 105, 171, 128], outline: `M310 128l16-15h119l23 18v37H310z${gripPath(330, 164, 63)}`, detail: `${t.port(376, 129, 72, 21)}<path data-mechanism="bolt-handle" d="M370 132h21l-8 30 5 13-7 3-10-19 10-22h-11z" fill="${paint.steel}"/><circle cx="384" cy="178" r="5" fill="${paint.rubber}"/>${t.triggerGuard(363, 173, 37, 24)}${gripDetail(330, paint, t, true)}${t.seam("M330 118h113l17 17", true)}${t.fastener(320, 147, 2.4)}<path data-mechanism="toz-bolt-shotgun" d="M410 159h48v12h-48z" fill="${paint.dark}"/>` };
	const mosin = id === "mosin";
	return { material: "dark", bounds: [start - 6, 105, mosin ? 162 : 145, 99], outline: mosin ? "M299 129h17v-15h115l23 13v34H299z" : "M310 125l16-13h129l20 17v33H310z", detail: `${t.port(mosin ? 326 : 391, 127, mosin ? 103 : 72, 19)}${t.triggerGuard(mosin ? 306 : 336, 176, mosin ? 47 : 43, 25)}<path data-mechanism="${mosin ? "bolt-handle" : "charging-handle"}" d="${mosin ? "M378 137h22l-10 31 10 14-6 5-17-22 10-23h-9z" : "M431 131h35v7h-19l-9 10h-12z"}" fill="${paint.steel}"/>${mosin ? `<circle cx="398" cy="185" r="6" fill="${paint.rubber}"/>` : ""}${t.seam(mosin ? "M317 117h109M305 158h96" : "M328 117h119M316 158h129", true)}${t.fastener(start + 6, 146, 2.3)}${t.fastener(mosin ? 440 : 462, 154, 2.3)}<path data-mechanism="${mosin ? "manual-bolt-action" : "sks-gas-action"}" d="M${start + 20} 145h15v5h-15z" fill="${paint.steel}"/>` };
}

function stock(gun: Profile, appearance: string, paint: Paint, t: Tools): Geometry {
	const id = gun.id, start = rear(gun), padded = appearance === "padded", native = appearance === "factory" || padded;
	const left = padded ? 93 : 103, stockGrip = wrist.has(id) || id === "svd" || id === "svdk";
	if (native && wrist.has(id)) {
		const longWood = id === "sks" || id === "mosin", point = id === "mosin" ? 285 : id === "mp133" ? 275 : id === "m870" ? 294 : 315;
		const connection = id === "sks" ? 484 : id === "mosin" ? 464 : start + 13;
		return { material: "wood", bounds: [left - 14, padded ? 127 : 132, connection - left + 18, 108], outline: `M${left} 148l${180 - left}-10h${point - 210}l30 15h${connection - point}v18H${point + 21}l-45 18-${point - 154} 42h-${130 - left}z`, detail: `<path data-mechanism="${longWood ? "rifle-integral-furniture" : "hunting-stock-wrist"}" d="M${left + 13} 153l65-10h${point - left - 109}l30 12" fill="none" stroke="#c6a06d" stroke-width="1" opacity=".5"/>${grainBand(left + 18, 160, Math.min(130, point - left - 28))}${grainBand(left + 24, 180, 93)}${t.fastener(point - 10, 158, 2.3)}<path d="M${left - 3} 151h11v81h-11z" fill="${paint.rubber}"/>${padded ? `<path d="M${left - 7} 149h18v87h-18zM139 130h96v18h-96z" fill="${paint.rubber}"/>` : ""}${longWood ? grainBand(point + 27, 165, connection - point - 39) : ""}` };
	}
	if (native && id === "svd") return { material: "wood", fillRule: "evenodd", bounds: [left - 13, padded ? 120 : 129, 204, 117], outline: `M${left} 142h${196 - left}l35 9h23l20 15-8 59h-33l-20-21-95 23h-${118 - left}zM129 157h66l24 13 8 29-33-10-65 22z`, detail: `<path data-mechanism="svd-forward-thumbhole-grip" d="M246 173l-5 37" fill="none" stroke="#c8a779" stroke-width="1" opacity=".5"/>${grainBand(128, 149, 91)}${grainBand(130, 219, 53)}<path d="M${left - 4} 145h11v85h-11zM147 131h80v16h-80z" fill="${paint.rubber}"/>${t.fastener(254, 167, 2.3)}${padded ? `<path d="M142 122h91v20h-91z" fill="${paint.rubber}"/>` : ""}` };
	if (native && id === "toz") return { material: "dark", bounds: [left - 13, 140, 228, 99], outline: `M${left} 150l${315 - left}-5v7l-${315 - left} 5zM${left + 5} 160l${310 - left}-5v6l-${310 - left} 5zM${left - 4} 147h11l-2 78h-11z`, detail: `<path data-mechanism="toz-wire-folding-stock" d="M${left + 10} 153l${293 - left}-5M${left + 13} 162l${289 - left}-5" fill="none" stroke="#74878f" stroke-width="1.2" opacity=".5"/><path d="M${left - 5} 149h10l-2 79h-10z" fill="${paint.rubber}"/>${t.fastener(309, 153, 3)}${padded ? `<path d="M${left - 8} 144h17l-3 86h-17z" fill="${paint.rubber}"/>` : ""}` };
	if (native && (id === "svdk" || id === "vityaz")) {
		const end = id === "vityaz" ? 315 : 282, tip = id === "svdk" ? 300 : 0;
		const outline = `M${left} 147h${end - left}v16l-${end - left - 19} 63h-19zM${left + 10} 161v50l${end - left - 32}-${end - left > 190 ? 56 : 50}z`;
		return { material: "dark", fillRule: "evenodd", bounds: [left - 13, padded ? 119 : 128, end - left + (tip ? 76 : 19), 110], outline: outline + (tip ? gripPath(tip) : ""), detail: `<path data-mechanism="${id === "svdk" ? "svdk-tubular-folding-stock" : id === "vityaz" ? "vityaz-triangle-folding-stock" : "toz-wire-folding-stock"}" d="M${left + 12} 152h${end - left - 20}M${left + 14} 218l${end - left - 27}-58" fill="none" stroke="#70848d" stroke-width="1.3" opacity=".5"/><path d="M${left - 4} 148h12v80h-12z" fill="${paint.rubber}"/>${t.fastener(end - 9, 154, 3)}${tip ? gripDetail(tip, paint, t) : ""}${id === "svdk" || padded ? `<path d="M155 ${padded ? 134 : 131}h90v17h-90z" fill="${paint.rubber}"/>` : ""}` };
	}
	if (native && id === "pkp") return { material: "dark", fillRule: "evenodd", bounds: [left - 13, 128, 296 - left, 118], outline: `M${left} 145h${224 - left}l53-9v28l-38 13-18 57h-33l-17-20-52 19h-${119 - left}zM131 159h80l20 12-13 22-32 2-55 18z`, detail: `<path data-mechanism="pkp-skeleton-butt" d="M120 149h103l47-8" fill="none" stroke="#78898e" stroke-width="1"/>${t.fastener(269, 152, 3)}${t.fastener(114, 220, 3)}<path d="M${left - 4} 149h10v86h-10z" fill="${paint.rubber}"/>${padded ? `<path d="M143 128h83v16h-83z" fill="${paint.rubber}"/>` : ""}` };
	if (native) {
		const club = id === "rpk", polymer = id === "saiga";
		return { material: polymer ? "polymer" : "wood", bounds: [left - 13, 129, start - left + 19, 112], outline: club ? `M${left} 148l${175 - left}-13h45l59 14v21h-42l-27 21-4 40h-38l-8-27-36 25h-${121 - left}z` : `M${left} 147h${195 - left}l40-13 46 14v23l-41 7-118 47h-${122 - left}z`, detail: `<path data-mechanism="${club ? "rpk-club-stock" : polymer ? "saiga-polymer-butt" : "fixed-ak-butt"}" d="M${left + 14} 151h70l49-13 40 14" fill="none" stroke="#89908c" stroke-width="1" opacity=".5"/>${polymer ? t.seam("M132 156h56l22-7 38 8-94 41z", true) : `${grainBand(left + 20, 159, 114)}${grainBand(left + 20, 176, 75)}`}<path d="M${left - 4} 150h11v80h-11z" fill="${paint.rubber}"/>${t.fastener(258, 157, 2.4)}${padded ? `<path d="M${left - 7} 147h18v85h-18zM139 130h83v17h-83z" fill="${paint.rubber}"/>` : ""}` };
	}
	const point = id === "svd" ? 260 : id === "svdk" ? 300 : id === "mp133" ? 295 : id === "m870" || id === "mosin" ? 310 : id === "sks" ? 325 : 335;
	const hinge = stockGrip ? start + 2 : start + 4, precision = appearance === "precision", skeleton = appearance === "skeleton", folding = appearance === "folding", light = appearance === "light";
	const end = hinge + 10;
	const body = precision ? `M100 145h72v-17h82v17h${end - 254}v22h-${end - 220}l-23 62h-80l-17-19zM130 164h59l-15 43h-44z`
		: folding ? `M112 145h${end - 112}v20l-${end - 128} 58h-16zM123 159v50l${end - 148}-50z`
		: skeleton ? `M108 146h71l21-10h${end - 200}v27h-${end - 216}l-25 65h-74zM129 165h65l-20 42h-45z`
		: light ? `M127 150h69l17-11h${end - 213}v22h-${end - 218}l-32 49h-52zM145 164h44l-15 29h-29z`
		: `M110 149h73l26-10h${end - 209}v25h-${end - 223}l-26 59h-78zM137 165h59l-18 38h-41z`;
	return { material: folding || skeleton ? "dark" : "polymer", fillRule: "evenodd", bounds: [94, precision ? 120 : 128, Math.max(end + 6, stockGrip ? point + 38 : end + 6) - 94, 120], outline: body + (stockGrip ? gripPath(point, 164, 71) : ""), detail: `<path data-hardware="classic-stock-interface" d="M${hinge - 15} 145h25v19h-25z" fill="${paint.dark}"/>${t.fastener(hinge + 1, 153, 3)}${t.seam(`M131 152h46l25-10h${Math.max(3, end - 212)}`, true)}${stockGrip ? gripDetail(point, paint, t) : ""}<path d="M${light ? 129 : 105} 152h10v${light ? 61 : 78}h-10z" fill="${paint.rubber}"/>${precision ? `<path d="M169 123h90v19h-90z" fill="${paint.rubber}"/>${t.fastener(187, 218, 3)}` : ""}` };
}

function barrel(gun: Profile, appearance: string, paint: Paint, t: Tools): Geometry {
	const end = gun.barrelEnd, start = foreStart(gun) - 12, upper = appearance === "heavy" ? 132 : 136, lower = appearance === "heavy" ? 151 : 147;
	const gas = !pump(gun) && gun.id !== "mosin" && gun.id !== "toz" && gun.id !== "vityaz", jacket = gun.id === "pkp";
	const gasEnd = Math.min(end - 65, front(gun) + (gun.id === "svd" || gun.id === "svdk" ? 20 : 51));
	const outline = jacket ? `M488 132h${end - 523}l35 5v14H488z` : `M${start} ${upper}h${end - start}v${lower - upper}H${start}z`;
	const rib = pump(gun) ? `<path data-mechanism="ventilated-shotgun-rib" d="M477 125h${end - 478}v3H477z" fill="${paint.dark}"/>${Array.from({ length: Math.floor((end - 489) / 42) }, (_, i) => `<path d="M${489 + i * 42} 128v8" stroke="#4a5d66" stroke-width="2.8"/>`).join("")}` : "";
	const sight = pump(gun) ? `<circle data-mechanism="front-sight" cx="${end - 8}" cy="124" r="1.8" fill="#9ca8a5"/>` : `<path data-mechanism="front-sight" d="M${end - 31} 137v-23h9l7 10v13zM${end - 27} 114v-5h5v5" fill="${paint.dark}"/>`;
	return { material: "dark", bounds: [start - 5, jacket ? 95 : 102, end - start + 11, jacket || gun.id === "rpk" ? 110 : 72], outline, muzzle: { x: end, y: (upper + lower) / 2 }, detail: `${t.seam(`M${start + 9} ${upper + 2}h${end - start - 15}`, true)}${sight}${rib}${gas ? jacket ? `<path data-mechanism="gas-system" d="M502 154h${gasEnd - 502}l17-8h-15l-10 5H502z" fill="${paint.dark}"/>${t.seam(`M508 156h${gasEnd - 514}`, true)}` : `<path data-mechanism="gas-system" d="M${start + 6} 122h${gasEnd - start - 6}l17 15h-15l-10-6H${start + 6}z" fill="${paint.dark}"/>${t.seam(`M${start + 9} 125h${gasEnd - start - 19}`, true)}` : ""}${jacket ? `<path data-mechanism="pkp-cooling-jacket" d="M506 134h${end - 540}" fill="none" stroke="#536570" stroke-width="1.4"/>${t.vents(512, 137, Math.max(1, Math.floor((end - 556) / 20)), 10, 6, 20)}<path data-mechanism="pkp-carry-handle" d="M502 129v-21h119l21 15v6h-10l-17-14H512v14z" fill="${paint.dark}"/>` : ""}${gun.id === "rpk" || jacket ? `<path data-mechanism="integrated-folded-bipod" d="M${end - 39} 150l-75 34h-54v-6h50l73-34z" fill="${paint.dark}"/>${t.fastener(end - 32, 148, 3.3)}` : ""}${appearance === "fluted" ? `${t.seam(`M${front(gun) + 4} 140h${end - front(gun) - 21}`)}<path d="M${start + 10} ${upper}h17v${lower - upper}h-17z" fill="${paint.steel}"/>` : appearance === "heavy" ? `<path d="M${start + 8} 132h19v19h-19z" fill="${paint.steel}"/>` : ""}` };
}

function handguard(gun: Profile, appearance: string, paint: Paint, t: Tools): Geometry {
	const start = foreStart(gun), end = front(gun), width = end - start, pumping = pump(gun);
	const wood = appearance === "wood" || appearance === "factory" && !["saiga", "vityaz", "pkp", "svdk"].includes(gun.id);
	const railed = appearance === "rail" || appearance === "carbon", factoryCarrier = appearance === "factory" && ["vpo209", "svdk", "m870"].includes(gun.id), bottom = railed || appearance === "vented" || factoryCarrier, y = pumping ? 148 : 132;
	const nativeOutline = pumping ? `M${start} 148h${width - 12}q12 0 12 9v18q0 9-12 9H${start}z`
		: gun.id === "pkp" ? "M491 142h42v21h-42z"
		: gun.id === "mosin" ? `M${start} 143h${width - 8}l8 6v16l-${width} 9z`
		: gun.id === "toz" ? `M${start} 139h${width - 15}l15 8v18l-${width} 14z`
		: `M${start} 136h${width - 10}q10 0 10 9v22l-${width - 20} 8-20-7zM${start + 11} 120h${width - 22}v12H${start + 11}z`;
	const outline = appearance === "light" ? `M${start + 5} ${y + 3}h${width - 17}l12 10v19l-${width - 5} 11z`
		: appearance === "wood" ? `M${start + 2} ${y + 1}h${width - 14}q10 0 10 11v19q0 8-9 8H${start + 2}z`
		: appearance === "vented" ? `M${start} ${y - 3}h${width}v43H${start}zM${start + 12} ${y + 9}h19v20h-19zM${start + 47} ${y + 7}h20v20h-20z`
		: appearance === "carbon" ? `M${start} ${y}q0-8 12-8h${width - 25}q13 0 13 12v24q0 12-12 12H${start}z`
		: appearance === "rail" ? `M${start} ${y - 8}h${width - 12}l12 12v39H${start}zM${start + 13} ${y + 6}h18v19h-18z`
		: nativeOutline;
	const topStart = gun.id === "svd" ? 297 : 335, railY = pumping ? 184 : 176;
	return { material: ["pkp", "svdk"].includes(gun.id) && appearance === "factory" ? "dark" : wood ? "wood" : appearance === "carbon" ? "carbon" : appearance === "vented" ? "steel" : "polymer", fillRule: "evenodd", bounds: [railed ? topStart - 4 : start - 5, railed ? 102 : pumping ? 143 : 115, end + 6 - (railed ? topStart - 4 : start - 5), pumping ? railed ? 99 : 49 : railed ? 88 : 79], outline,
		detail: `<path data-mechanism="${pumping ? "sliding-pump-fore-end" : gun.id === "mosin" ? "mosin-full-length-forewood" : gun.id === "toz" ? "toz-short-forewood" : "classic-fore-end"}" d="M${start + 5} ${y + 6}h${width - 15}" fill="none" stroke="#8b9898" stroke-width=".8" opacity=".5"/>${wood ? `${grainBand(start + 12, y + 12, width - 27)}${grainBand(start + 12, y + 27, width - 31)}` : !railed && appearance !== "vented" && !(["pkp", "svdk"].includes(gun.id) && appearance === "factory") ? t.checkering(start + 12, y + 8, width - 28, 19) : ""}${pumping ? t.ribs(start + 11, 153, Math.floor((width - 15) / 8), 24, 8) : gun.id === "svd" || gun.id === "svdk" ? `${t.vents(start + 14, 137, Math.floor((width - 26) / 28), 14, 6, 28)}${t.vents(start + 24, 152, Math.floor((width - 38) / 28), 14, 6, 28)}` : gun.id === "mosin" ? `<path d="M${start + 8} 135v39M${end - 9} 135v39" stroke="#25333a" stroke-width="5"/>` : ""}${railed ? `${t.rail(topStart, 108, end - topStart - 8)}<path data-hardware="classic-top-bridge-support" d="M${start + 6} 114h11v${y - 107}h-11zM${end - 19} 114h10v${y - 107}h-10z" fill="${paint.dark}"/>${t.rail(start + 10, 145, width - 18)}` : factoryCarrier ? `${t.rail(start + 10, 145, width - 18)}<path data-hardware="factory-accessory-rail-carrier" d="M${start + 8} 149h6v${y + 24 - 149}h-6zM${end - 20} 149h6v${y + 24 - 149}h-6z" fill="${paint.dark}"/>` : ""}${bottom ? `<path data-hardware="classic-bottom-bridge-support" d="M${start + 13} ${y + 28}h9v${railY - y - 22}h-9zM${end - 21} ${y + 26}h9v${railY - y - 20}h-9z" fill="${paint.dark}"/>${t.rail(gun.id === "toz" ? 478 : pumping ? Math.min(491, end - 107) : Math.min(491, end - 105), railY, end - (gun.id === "toz" ? 478 : pumping ? Math.min(491, end - 107) : Math.min(491, end - 105)))}` : ""}${t.fastener(start + 7, y + 28, 2.3)}${t.fastener(end - 8, y + 24, 2.3)}` };
}

function magazine(gun: Profile, appearance: string, paint: Paint, t: Tools): Geometry {
	const id = gun.id, extended = appearance === "extended", compact = appearance === "compact", quick = appearance === "quick", window = appearance === "window";
	if (pump(gun)) {
		const start = gun.id === "m870" ? 433 : 421, length = extended ? 238 : compact ? 137 : quick ? 178 : window ? 218 : gun.id === "m870" ? 165 : 155;
		return { material: "dark", bounds: [start - 5, 150, length + 9, 23], outline: `M${start} 154h${length}v13H${start}z`, detail: `<path data-mechanism="underbarrel-feed-tube" d="M${start + 6} 158h${length - 11}" fill="none" stroke="#71818a" stroke-width="1"/><path d="M${length + start - 8} 153h8v15h-8z" fill="${paint.dark}"/>${window ? Array.from({ length: 5 }, (_, i) => `<path d="M${start + 28 + i * 36} 158h22v5h-22z" fill="#a39670"/>`).join("") : ""}${quick ? `<path d="M${length + start - 13} 151h13v18h-13z" fill="${paint.steel}"/>` : ""}` };
	}
	if (id === "pkp") {
		const drum = appearance === "drum", width = drum ? 64 : 91, depth = extended ? 116 : drum ? 124 : compact ? 55 : quick ? 76 : window ? 95 : 88;
		return { material: "polymer", bounds: [391, 164, width + 16, depth + 22], outline: `M397 169h${width}v${depth}h-${width}z`, detail: `<path data-mechanism="belt-feed-box" d="M399 173h${width - 4}v13h-${width - 4}z" fill="#546354"/><path data-hardware="belt-box-carry-latch" d="M419 170h${Math.min(45, width - 26)}v8h-${Math.min(45, width - 26)}z" fill="${paint.steel}"/>${t.ribs(411, 191, Math.floor((width - 22) / 10), depth - 29, 10)}${t.fastener(408, 179, 2.2)}${t.fastener(397 + width - 11, 179, 2.2)}${window ? `<path d="M419 193h48v${depth - 30}h-48z" fill="#162627" stroke="#899486"/>` : ""}${t.seam(`M403 ${164 + depth}h${width - 12}`, true)}${quick ? `<path d="M408 179h70v8h-70z" fill="${paint.rubber}"/>` : ""}` };
	}
	const smg = id === "vityaz", box = ["svd", "svdk", "toz", "mosin", "sks", "saiga"].includes(id);
	const x = id === "svd" ? 337 : id === "toz" ? 410 : id === "mosin" ? 365 : id === "sks" ? 392 : smg ? 422 : 392;
	const width = smg ? 36 : id === "toz" ? 40 : id === "saiga" ? 54 : id === "svdk" ? 51 : id === "svd" ? 47 : box ? 48 : 45;
	const baseDepth = id === "toz" ? 26 : id === "mosin" ? 28 : id === "sks" ? 38 : id === "svd" ? 55 : id === "svdk" ? 63 : id === "saiga" ? 85 : smg ? 111 : id === "ak74" ? 112 : id === "rpk" ? 136 : 118;
	const depth = compact ? Math.round(baseDepth * .61) : extended ? baseDepth + (box ? 25 : 31) : window ? baseDepth - 3 : quick ? baseDepth + 1 : baseDepth;
	if (appearance === "drum") return { material: "dark", fillRule: "nonzero", bounds: [x - 7, 165, 74, 132], outline: `M${x} 169h${width}v31h-${width}zM${x - 3} 197h55q10 0 10 10v72q0 10-10 10h-45q-10 0-10-10z`, detail: `<path data-mechanism="side-projected-drum-feed" d="M${x + 5} 204h48v73h-48z" fill="${paint.dark}"/>${t.ribs(x + 8, 213, 5, 54, 9)}${t.fastener(x + 53, 214, 2.4)}${t.seam(`M${x + 5} 284h46`, true)}` };
	const curve = id === "ak74" ? .35 : .55, sideways = Math.round(depth * (smg ? .16 : curve));
	const outline = box ? `M${x} 169h${width}l${id === "saiga" ? 11 : id === "svdk" ? 8 : 4} ${depth}h-${width - 3}l-${id === "saiga" ? 14 : id === "svdk" ? 11 : 7}-${depth}z`
		: `M${x} 169h${width}q0 ${depth * .55} ${sideways} ${depth - 7}l-${width - 8} 19q-${sideways + 15}-${depth * .36} -${sideways + 8}-${depth + 12}z`;
	const bottom = 169 + depth, quickLoop = quick ? `M${x + (box ? 11 : sideways - 11)} ${bottom + 9}h24v13h-24zM${x + (box ? 16 : sideways - 6)} ${bottom + 13}h14v5h-14z` : "";
	return { material: id === "ak74" && appearance === "factory" ? "polymer" : "dark", fillRule: "evenodd", bounds: [x - 6, 165, box ? width + 24 : sideways + width + 12, depth + (quick ? 37 : box ? 16 : 25)], outline: outline + quickLoop, detail: `<path data-mechanism="${id === "saiga" ? "saiga-shotgun-box-feed" : id === "toz" ? "toz-straight-box-feed" : id === "svd" || id === "svdk" ? "sniper-short-box-feed" : id === "mosin" || id === "sks" ? "integral-rifle-box-feed" : smg ? "vityaz-gently-curved-feed" : "curved-ak-rifle-feed"}" d="M${x + 4} 174h${width - 8}" fill="none" stroke="#7e8d94" stroke-width="1"/>${box ? t.ribs(x + 10, 180, Math.max(2, Math.floor((width - 13) / 9)), Math.max(6, depth - 21), 9) : Array.from({ length: 3 }, (_, i) => `<path d="M${x + 10 + i * 9} 179q0 ${depth * .5} ${sideways - 9} ${depth - 15}" fill="none" stroke="#63767e" stroke-width="1.2"/>`).join("")}${window ? `<path d="M${x + 16} 184h14l${box ? 4 : Math.max(4, sideways - 21)} ${Math.max(6, depth - 30)}-14 4z" fill="#12272c" stroke="#8b9e9c" stroke-width=".8"/>` : ""}<path d="M${x + (box ? 2 : sideways - 3)} ${bottom - (box ? 3 : 7)}h${width + (box ? 7 : -4)}v7h-${width + (box ? 7 : -4)}z" fill="${paint.rubber}"/>${quick ? `<path d="M${x + (box ? 14 : sideways - 8)} ${bottom + 12}h18v7h-18z" fill="${paint.steel}"/>` : ""}` };
}

export const classicReferenceGeometry: ReferenceRenderer = (slot, appearance, gun, paint, tools) => {
	if (!owned.has(gun.id)) return undefined;
	const shape = slot === "receiver" ? receiver(gun, paint, tools) : slot === "stock" ? stock(gun, appearance, paint, tools)
		: slot === "barrel" ? barrel(gun, appearance, paint, tools) : slot === "handguard" ? handguard(gun, appearance, paint, tools)
		: slot === "magazine" ? magazine(gun, appearance, paint, tools) : undefined;
	if (!shape) return undefined;
	// Internal wood marks follow the furniture surface, including open stock
	// windows. Pads, bolts and moving hardware remain separate visible pieces.
	if (shape.detail.includes('stroke="#c9a270"')) {
		const clip = `${paint.prefix}-${gun.id}-${slot}-${appearance}-reference-wood`;
		shape.detail = `<defs><clipPath id="${clip}"><path d="${shape.outline}" fill-rule="${shape.fillRule ?? "evenodd"}" clip-rule="${shape.fillRule ?? "evenodd"}"/></clipPath></defs>` + shape.detail.replace(/<path d="[^"]+" fill="none" stroke="#c9a270"[^>]*\/>/g, (mark) => `<g clip-path="url(#${clip})">${mark}</g>`);
	}
	return shape;
};
