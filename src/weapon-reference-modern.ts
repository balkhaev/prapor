import type { ReferenceGeometry, ReferenceLayout, ReferencePaint, ReferenceProfile, ReferenceRenderer, ReferenceTools } from "./weapon-reference-types";

/** Exterior references are manufacturer photos, rather than a shared AK chassis.
 * Colt MLE 2024 p24; HK catalogue 2014 p24–29; SIG MCX-SPEAR LT p26;
 * Sako TRG manual p6–10; Steyr AUG Z A3 Fig1; FN SCAR-H STD studio photo.
 * Factory magazine/stock identities remain owned by the supplying weapon. */
const families = new Set(["m4a1", "hk416", "mcx", "scarh", "trg42", "g36", "aug", "fal", "sr25", "ash12", "awm"]);
const boltRifles = new Set(["trg42", "awm"]);
const bullpups = new Set(["aug", "ash12"]);
type Stations = { start: number; front: number; top: number; bottom: number; railTop: number };
const stations: Record<string, Stations> = {
	m4a1: { start: 514, front: 658, top: 117, bottom: 164, railTop: 108 },
	hk416: { start: 514, front: 658, top: 116, bottom: 164, railTop: 108 },
	mcx: { start: 512, front: 648, top: 116, bottom: 164, railTop: 108 },
	scarh: { start: 506, front: 589, top: 116, bottom: 164, railTop: 108 },
	g36: { start: 509, front: 658, top: 133, bottom: 174, railTop: 87 },
	fal: { start: 473, front: 631, top: 117, bottom: 157, railTop: 108 },
	sr25: { start: 532, front: 696, top: 116, bottom: 165, railTop: 108 },
	trg42: { start: 490, front: 681, top: 145, bottom: 178, railTop: 108 },
	awm: { start: 489, front: 676, top: 146, bottom: 180, railTop: 108 },
	aug: { start: 552, front: 594, top: 127, bottom: 172, railTop: 108 },
	ash12: { start: 546, front: 644, top: 129, bottom: 174, railTop: 87 },
};

export function modernReferenceLayout(gun: ReferenceProfile): ReferenceLayout | undefined {
	const s = stations[gun.id]; if (!s) return undefined;
	return {
		foreEnd: s.front, sideRailEnd: s.front - 8,
		laserCenter: (s.start + s.front) / 2,
		// The widest lower adaptor ends at its native x691. Its entire shoe
		// belongs on the short physical fore-end, including the SCAR/AUG.
		genericMountShift: gun.id === "aug" ? -77 : s.front - 691,
		topMountShift: gun.id === "g36" ? -145 : gun.id === "ash12" ? -119 : s.front - 651,
		factoryTopMountShift: boltRifles.has(gun.id) ? -145 : gun.id === "scarh" ? -138 : gun.id === "aug" ? -95 : undefined,
		receiverTopMountShift: gun.id === "g36" ? -145 : gun.id === "ash12" ? -119 : gun.id === "scarh" ? -138 : gun.id === "sr25" ? -112 : gun.id === "fal" ? -177 : boltRifles.has(gun.id) ? -145 : -136,
		topMountLift: ["g36", "ash12"].includes(gun.id) ? -22 : -1,
		opticShift: [gun.id === "scarh" ? -24 : 0, s.railTop - 108],
		foregripShift: [gun.id === "scarh" ? -24 : gun.id === "aug" ? 9 : 0, s.bottom - 164],
	};
}

const path = (d: string, fill: string, extra = "") => `<path d="${d}" fill="${fill}"${extra}/>`;
const marker = (name: string) => `<metadata data-reference-mechanism="${name}"/>`;
const geometry = (outline: string, detail: string, material: ReferenceGeometry["material"], bounds: ReferenceGeometry["bounds"], holes = false): ReferenceGeometry => ({ outline, detail, material, bounds, fillRule: holes ? "evenodd" : "nonzero" });
function gripDetail(x: number, paint: ReferencePaint, t: ReferenceTools) {
	return `${path(`M${x + 7} 180h18l-14 45h-20z`, paint.rubber)}${t.checkering(x + 2, 187, 18, 26)}${t.fastener(x + 15, 174, 2.3)}`;
}

function receiver(gun: ReferenceProfile, p: ReferencePaint, t: ReferenceTools): ReferenceGeometry {
	if (gun.id === "aug") {
		const shell = "M250 126q0-8 10-8h107l19-9h117l60 18 28 19v65l-31 17h-48l-11 21h-34l12-61h-32l-30 20h-63l-25-20h-67l-14-9zM509 169h58l8 13v23l-24 13h-40l-4-11z";
		return geometry(shell, `${marker("aug-integrated-stock-grip-window")}${t.rail(366, 108, 190)}${t.port(334, 139, 72, 15)}${t.seam("M260 123h100l25-9h113l54 18M259 171h77l24 25h53l32-25", true)}${path("M477 182h24l-9 47h-24z", p.rubber)}${t.checkering(480, 188, 17, 28)}<path data-mechanism="trigger-guard" d="M510 172h55l8 13v19l-23 12h-38" fill="none" stroke="#606958" stroke-width="1.1"/><path data-mechanism="trigger" d="M514 176q-5 11 0 18l5-2q-5-7 0-16z" fill="${p.dark}"/>${path("M534 136l19-10h15v8l-24 16z", p.dark)}${t.selector(464, 155, 19)}${t.fastener(267, 151, 3)}${t.fastener(441, 155, 3)}${t.fastener(529, 157, 3)}${t.seam("M316 153h13v18M373 178h37")}`, "polymer", [242, 103, 355, 152], true);
	}
	if (gun.id === "ash12") {
		const shell = "M250 120h352l18 8 25 17v30h-110l-27 60h-37l14-60h-40l-25 8h-74l-27 26h-59l-10-12zM380 117V88h151v29zM394 97h122v16H394z";
		return geometry(shell, `${marker("ash12-rear-feed-long-sheet-action")}${t.rail(346, 113, 296)}${t.rail(383, 87, 149)}${t.seam("M257 125h341l18 8 20 16M256 166h76l28 10h56l25-9h195", true)}${t.port(335, 139, 78, 22)}${path("M474 181h29l-11 44h-24z", p.rubber)}${t.checkering(480, 189, 17, 27)}${t.triggerGuard(510, 174, 41, 32)}${t.selector(450, 156, 20)}${t.vents(562, 139, 4, 9, 7, 17)}${t.fastener(269, 145, 3.5)}${t.fastener(453, 148, 3)}${t.fastener(629, 158, 3)}${t.seam("M387 91v24M525 91v24", true)}`, "dark", [243, 81, 407, 160], true);
	}
	if (boltRifles.has(gun.id)) {
		const aw = gun.id === "awm";
		const shell = aw ? "M323 142h27v-20q0-9 11-9h119l22 14v28H323z" : "M327 146h21v-21q0-13 14-13h113q15 0 26 15v27H327z";
		return geometry(shell, `${marker(aw ? "awm-round-bolt-action" : "trg-cylindrical-bolt-action")}${t.rail(335, 108, 171)}${t.port(380, 124, 84, 16)}${t.seam(aw ? "M356 118h120l19 13M331 150h164" : "M359 117h114q10 0 21 13M331 150h163", true)}${path("M368 141h26l-10 28 13 13-8 6-18-18 10-25h-13z", p.dark)}<circle cx="394" cy="183" r="7.5" fill="${p.rubber}"/>${t.fastener(353, 142, 2.8)}${t.fastener(481, 143, 2.6)}${t.triggerGuard(369, 170, 51, 29)}${path("M320 153h182v18H320z", p.polymer)}${t.seam("M326 155h165", true)}`, "dark", [316, 103, 194, 105]);
	}
	if (gun.id === "scarh") {
		const shell = `M263 113h241l15 17v34h-32v18h-59v-13h-93l-12 67h-36l13-67h-37z`;
		return geometry(shell, `${marker("scar-monolithic-upper-polymer-lower")}${t.rail(268, 108, 245)}${t.port(400, 124, 76, 18)}${path("M267 150h153v20h-82l-13 65h-34l12-65h-36z", p.polymer)}${t.seam("M269 119h231l11 13M269 145h236", true)}${path("M349 130h42v7h-42z", p.dark)}${path("M365 131h19v13h-19z", p.steel)}${t.triggerGuard(335, 172, 58, 31)}${gripDetail(301, p, t)}${t.selector(307, 155, 22)}${t.fastener(271, 149, 3)}${t.fastener(413, 156, 3)}${t.fastener(498, 149, 3)}${t.seam("M431 168h50v9h-50")}`, "dark", [257, 103, 267, 140]);
	}
	if (gun.id === "g36") {
		const shell = `M317 129h179l19 15v31h-119l-28 59h-40l16-59h-27zM337 130V93l19-13h151v50zM350 118V99l12-9h129v28z`;
		return geometry(shell, `${marker("g36-open-carry-handle-polymer-action")}${t.rail(355, 87, 151)}${t.port(400, 141, 76, 21)}${t.seam("M325 135h166l17 12M324 169h65M339 127V96l20-13h137", true)}${path("M369 123h67v8h-67z", p.dark)}${path("M414 122h22v12h-22z", p.steel)}${t.triggerGuard(378, 176, 52, 29)}${gripDetail(341, p, t)}${t.selector(349, 158, 24)}${t.fastener(324, 151, 3.5)}${t.fastener(493, 160, 3)}${t.fastener(342, 117, 2.5)}${t.fastener(498, 117, 2.5)}`, "polymer", [310, 75, 213, 166], true);
	}
	if (gun.id === "fal") {
		const shell = `M282 117h168l24 14v31h-28v15h-61v-8h-45l-14 65h-39l14-65h-19z`;
		return geometry(shell, `${marker("fal-separate-lower-long-upper")}${t.port(367, 129, 83, 17)}${t.seam("M290 122h151l26 13M289 157h175M338 160l31 9h75", true)}${path("M287 151h51v17h-28l-16 52h-8l15-52h-14z", p.polymer)}${path("M298 135h31v10h-31z", p.steel)}${t.fastener(309, 139, 3.4)}${t.selector(308, 158, 23)}${t.triggerGuard(339, 173, 54, 29)}${gripDetail(299, p, t)}${t.fastener(450, 160, 3)}${path("M456 129h7v28h-69v-8h62z", p.dark)}${t.seam("M398 152h53", true)}`, "dark", [275, 111, 207, 131]);
	}
	const hk = gun.id === "hk416", mcx = gun.id === "mcx", sr = gun.id === "sr25";
	const shell = mcx ? `M315 112h191l13 18v35h-26v15h-63v-11h-47l-21 67h-39l17-67h-25z`
		: hk ? `M317 116l17-7h169l15 18v39h-28v16h-62v-13h-45l-20 67h-39l17-67h-24z`
		: sr ? `M317 116h204l18 16v36h-25v20h-88v-18h-45l-18 66h-40l17-66h-23z`
		: `M319 121l18-7h162l16 15v36h-25v15h-63v-13h-47l-18 69h-39l17-69h-21z`;
	return geometry(shell, `${marker(mcx ? "mcx-tall-upper-folding-interface" : hk ? "hk416-raised-piston-upper" : sr ? "sr25-large-frame-ar10-action" : "m4-forged-upper-forward-assist")}${t.rail(333, 108, sr ? 206 : 182)}${t.port(sr ? 389 : 400, mcx || hk ? 127 : 130, sr ? 116 : 80, sr ? 20 : 17)}${t.seam(mcx ? "M322 117h180l10 16M323 159h182" : hk ? "M337 114h164l10 16M324 161h181" : sr ? "M324 121h191l17 15M325 162h206" : "M339 120h158l11 13M325 161h181", true)}${t.triggerGuard(381, 171, 49, 31)}${gripDetail(337, p, t)}${t.selector(349, 156, 22)}${t.fastener(325, 153, 3)}${t.fastener(sr ? 515 : 493, 155, 3)}${path("M376 121l-10-8h-15v7l15 10z", p.dark)}${t.fastener(369, 122, 3.2)}${path(mcx ? "M312 118h9v41h-9z" : "M311 120h12v31h-12z", p.dark)}${t.seam(sr ? "M431 175h76v7h-76" : "M432 170h51v6h-51", true)}${path("M435 159h28v7h-28z", p.dark)}${t.fastener(447, 162, 1.8)}`, "dark", [306, 102, sr ? 239 : 219, 141]);
}

function stock(gun: ReferenceProfile, a: string, p: ReferencePaint, t: ReferenceTools): ReferenceGeometry {
	if (bullpups.has(gun.id)) {
		const ash = gun.id === "ash12", w = a === "precision" ? 35 : a === "padded" ? 31 : a === "skeleton" ? 14 : a === "tactical" ? 27 : 20;
		const bottom = ash ? 209 : 176, top = ash ? 119 : 121;
		const body = `M${251 - w} ${top}h${w}v${bottom - top}h-${w}q-6 0-6-8v-${bottom - top - 16}q0-8 6-8z`;
		return geometry(body, `${marker(ash ? "ash12-deep-rear-pad" : "aug-integrated-stock-butt-plate")}${path(`M${249 - w} ${top + 6}h${w - 4}v${bottom - top - 12}h-${w - 4}z`, p.rubber)}${t.ribs(250 - w, top + 12, Math.max(1, Math.floor((w - 6) / 6)), bottom - top - 24, 6)}${t.fastener(248, top + 21, 2.5)}${a === "precision" ? path(`M${239 - w} ${bottom - 6}h18v15h-18z`, p.dark) : ""}${a === "skeleton" ? t.vents(240, top + 18, 1, 4, bottom - top - 37, 5) : ""}`, "rubber", [239 - w, top - 5, w + 19, bottom - top + (a === "precision" ? 27 : 13)]);
	}
	const scar = gun.id === "scarh", g36 = gun.id === "g36", mcx = gun.id === "mcx", bolt = boltRifles.has(gun.id), aw = gun.id === "awm", fal = gun.id === "fal";
	const right = scar ? 271 : fal ? 291 : 325;
	const stem = scar ? "M254 119h17v50h-17z" : fal ? "M270 130h21v33h-21z" : g36 || mcx || bolt ? "M302 125h23v34h-23z" : "M251 124h74v20h-74z";
	const stemDetail = `${marker(scar ? "scar-stock-hinge" : mcx ? "mcx-stock-folding-hinge-no-buffer" : g36 ? "g36-folding-stock-hinge" : fal ? "fal-stock-tang" : bolt ? "bolt-rifle-stock-chassis" : "ar-buffer-tube-castle-nut")}${path(stem, p.dark)}${t.fastener(right - 12, 139, 3)}${!scar && !g36 && !mcx && !bolt && !fal ? `${path("M307 119h9v29h-9z", p.dark)}${t.ribs(309, 122, 2, 23, 4)}${t.seam("M257 127h47", true)}` : ""}`;
	let body: string, cut = "", material: ReferenceGeometry["material"] = "polymer";
	const factory = a === "factory" || a === "padded";
	if (factory) {
		body = scar ? "M110 125h91q15-8 33-5l28 9v29l-54 15-19 24-37 8-42 26z"
			: g36 ? "M108 139h142l38-13h24v27l-51 11-126 39-22 26h-13z"
			: mcx ? "M126 123h151l35 9v16l-87 10-82 59h-24z"
			: aw ? "M106 144q0-7 9-7h68v-11h85v19h54q21 0 34 21l-12 69h-35l-17-31-85 27h-101z"
			: gun.id === "trg42" ? "M111 137h153v-11h49v26q-22 5-25 23l-15 24 51 26 22-63h20l-17 73h-27l-48-19-136 14h-27z"
			: fal ? "M105 145q47-21 107-7l66-4v30l-53 5-14 19-84 45h-22z"
			: gun.id === "hk416" ? "M111 122h169l30 9v22h-43l-21 28-91 46h-44z"
			: gun.id === "sr25" ? "M111 128h126l39-9h35v40l-53 9-14 31-107 32h-26z"
			: "M114 127h161v27l-34 6-24 25-90 48h-13z";
		cut = g36 ? "M128 150h105v14l-97 30h-8zM255 140h40v12l-40 12z"
			: mcx ? "M139 136h131l-52 15-79 50z"
			: aw ? "M284 165q0-8 10-8h17q19 0 22 19l-8 25q-2 8-12 8h-10l-19-27z"
			: !bolt && !fal && !scar ? "M130 165h82l-71 44h-11z" : "";
	} else if (a === "folding") {
		body = `M113 137h${right - 139}l24-8v27l-58 9-91 60h-${right - 264}z`;
		cut = `M131 149h${right - 178}l-94 54H131z`;
		material = "dark";
	} else if (a === "skeleton") {
		body = `M119 134h${right - 149}l30-6v30l-48 12-94 57h-${right - 261}z`;
		cut = `M137 146h${right - 216}v10l-49 17h-24zM137 184l63-20h22l-85 48z`;
		material = "dark";
	} else if (a === "precision") {
		body = `M109 142h69v-18h86v16h${right - 264}v27h-${right - 264}l-21 67h-134z`;
		cut = "M136 158h82l-17 52h-65z";
	} else if (a === "light") {
		body = `M128 139h${right - 165}l37-9v28l-65 8-55 47h-38z`;
		cut = `M145 153h${right - 208}l-52 45h-26z`;
	} else {
		body = `M112 137h91l29-11h${right - 232}v34h-${right - 255}l-49 69h-72z`;
		cut = "M134 157h80l-37 50h-43z";
	}
	// Bolt-action furniture owns its grip, including open chassis upgrades.
	const boltGrip = bolt && !factory ? `M331 162h29l-14 73h-33l13-58z` : "";
	return geometry(`${body}${cut}${boltGrip}`, `${stemDetail}${marker(`${gun.id}-physical-${a}-stock`)}${bolt ? path("M299 149h62v17h-62z", p.dark) : ""}${t.seam(scar ? "M117 130h81q13-8 35-4l20 7" : "M120 143h74l35-10h59", true)}${path(`M${mcx ? 122 : 105} ${factory && fal ? 154 : 139}h11v${scar ? 87 : 90}h-11z`, p.rubber)}${t.fastener(scar ? 227 : 279, 154, 2.4)}${bolt ? `${path("M331 181h19l-9 45h-18z", p.rubber)}${t.checkering(334, 188, 14, 26)}` : ""}${a === "padded" || a === "precision" ? `${path(scar ? "M126 118h79q18-9 32-6v16H126z" : "M144 121h123v17H144z", p.rubber)}${t.ribs(108, 151, 2, 65, 4)}` : factory && gun.id === "hk416" ? t.ribs(117, 142, 8, 13, 15) : factory && gun.id === "m4a1" ? t.vents(132, 136, 4, 22, 5, 30) : ""}${a === "precision" ? `${t.fastener(218, 224, 3)}${t.seam("M143 219h55", true)}` : ""}`, material, [94, a === "padded" || a === "precision" ? 108 : 115, bolt ? 280 : right - 83, 132], !!cut);
}

function magazine(gun: ReferenceProfile, a: string, p: ReferencePaint, t: ReferenceTools): ReferenceGeometry {
	const rear = bullpups.has(gun.id), bolt = boltRifles.has(gun.id), large = ["sr25", "scarh", "fal", "ash12"].includes(gun.id);
	const x = gun.id === "scarh" ? 396 : gun.id === "fal" ? 395 : rear ? gun.id === "aug" ? 355 : 345 : bolt ? 419 : 431;
	const y = rear ? 177 : 171, width = gun.id === "ash12" ? 65 : large ? 59 : bolt ? 55 : 47;
	const depth = a === "compact" ? bolt ? 24 : 39 : a === "extended" ? bolt ? 71 : 124 : bolt ? 40 : gun.id === "scarh" || gun.id === "fal" || gun.id === "sr25" ? 79 : gun.id === "ash12" ? 105 : 103;
	const curve = !bolt && !["scarh", "fal", "sr25", "ash12"].includes(gun.id), drift = curve ? depth * .22 : depth * .06;
	if (a === "drum") {
		const shell = `M${x} ${y}h${width}l4 32h-${width}zM${x - 4} ${y + 29}h${width + 8}q10 0 10 12v64q0 10-10 10h-${width + 8}q-10 0-10-10v-64q0-12 10-12z`;
		return geometry(shell, `${marker(`${gun.id}-drum-feed-neck`)}${path(`M${x + 5} ${y + 39}h${width - 2}v66h-${width - 2}z`, p.polymer)}${t.ribs(x + 12, y + 43, Math.floor(width / 8), 55, 8)}${t.fastener(x + width + 6, y + 42, 2.7)}`, "dark", [x - 18, y - 5, width + 35, 126]);
	}
	const shell = curve ? `M${x} ${y}h${width}q-3 ${depth * .53} ${drift} ${depth - 7}l-${width} 12q-${drift + 10}-${depth * .38}-${drift + 10}-${depth + 5}z` : `M${x} ${y}h${width}l${drift} ${depth}l-${width} 3z`;
	const transparent = a === "factory" && ["g36", "aug"].includes(gun.id), window = a === "window" || transparent;
	const ribs = Array.from({ length: Math.max(2, Math.floor((depth - 20) / 15)) }, (_, i) => t.seam(`M${x + 7 + drift * i / 8} ${y + 18 + i * 15}h${width - 16}`, true)).join("");
	const flute = Array.from({ length: 3 }, (_, i) => `<path d="M${x + 11 + i * 10} ${y + 12}q-2 ${depth * .45} ${drift} ${depth - 26}" fill="none" stroke="#777f7a" stroke-width="2" opacity=".52"/>`).join("");
	return geometry(shell, `${marker(`${gun.id}-${rear ? "rear" : "front"}-magazine-well`)}${transparent ? path(shell, "#a0956f", ' opacity=".38"') : ""}${t.seam(`M${x + 4} ${y + 8}h${width - 8}`, true)}${window ? `${path(`M${x + width / 2 - 6} ${y + 17}h13l${drift * .72} ${depth - 31}-13 3z`, "#172b29", ' stroke="#86968f" stroke-width=".6"')}${Array.from({ length: Math.max(2, Math.floor((depth - 30) / 10)) }, (_, i) => path(`M${x + width / 2 - 4 + drift * i / 11} ${y + 24 + i * 10}h9v2h-9z`, "#b39f69")).join("")}` : curve && !transparent ? flute : ribs}${path(`M${x + drift - 2} ${y + depth - 3}l${width + 5}-3v7l-${width + 5} 3z`, p.rubber)}${a === "quick" ? `<path d="M${x + drift + width / 2 - 10} ${y + depth + 4}v10h20v-12" fill="none" stroke="#8b9490" stroke-width="4"/>` : ""}`, curve || transparent ? "polymer" : "dark", [x - 12, y - 5, width + drift + 28, depth + (a === "quick" ? 29 : 15)]);
}

function handguard(gun: ReferenceProfile, a: string, p: ReferencePaint, t: ReferenceTools): ReferenceGeometry {
	const s = stations[gun.id]!, { start: x, front: end, top, bottom } = s, w = end - x;
	const railed = a === "rail" || a === "carbon", hasBottom = railed || a === "vented" || a === "factory";
	const wood = a === "wood", light = a === "light", factory = a === "factory", bolt = boltRifles.has(gun.id), aug = gun.id === "aug";
	let shell = light ? `M${x + 3} ${top + 5}h${w - 15}l9 7v${bottom - top - 20}l-8 8h-${w - 17}z`
		: wood ? `M${x} ${top + 4}h${w - 10}q10 0 10 10v${bottom - top - 18}q0 8-10 8H${x}z`
		: a === "carbon" ? `M${x} ${top + 3}q0-5 8-5h${w - 19}q11 0 11 12v${bottom - top - 18}q0 10-11 10h-${w - 19}q-8 0-8-8z`
		: `M${x} ${top}h${w - 10}l10 8v${bottom - top - 8}H${x}z`;
	if (factory && gun.id === "fal") shell = `M${x} ${top + 1}h${w - 12}q12 0 12 9v${bottom - top - 15}q0 7-12 7H${x}z`;
	if (factory && bolt) shell = `M${x} ${top}h${w - 22}l22 12v${bottom - top - 12}H${x}z`;
	if (factory && gun.id === "awm") shell += "M621 155h25v12h-25z";
	if (factory && gun.id === "sr25") shell += Array.from({ length: 5 }, (_, i) => `M${x + 11 + i * 30} ${top + 17}h20v9h-20z`).join("");
	if (factory && aug) shell = "M552 128h32l10 10v28l-12 7h-30z";
	if (railed || a === "vented") {
		const count = Math.max(1, Math.floor((w - 15) / 30));
		shell += Array.from({ length: count }, (_, i) => `M${x + 10 + i * 30} ${top + 15}h17v${Math.max(7, bottom - top - 25)}h-17z`).join("");
	}
	const railLeft = Math.min(x, gun.id === "scarh" ? 479 : aug ? 509 : x - 14), railRight = Math.max(end, aug ? 614 : end), receiverLeft = gun.id === "scarh" ? 267 : gun.id === "ash12" ? 346 : 333;
	const raised = ["g36", "ash12"].includes(gun.id);
	const bridge = railed ? raised ? `${t.rail(x, top - 8, w)}${path(`M${x} ${top - 3}h${w}v7h-${w}z`, p.dark)}` : `${t.rail(receiverLeft, s.railTop, end - receiverLeft)}${path(`M${x + 3} ${s.railTop + 5}h10v${top - s.railTop + 3}h-10zM${end - 13} ${s.railTop + 5}h10v${top - s.railTop + 3}h-10z`, p.dark)}` : "";
	const factoryTop = factory && ["m4a1", "hk416", "mcx", "scarh", "sr25"].includes(gun.id) ? `${t.rail(x - 2, 108, w + 2)}${path(`M${x - 2} 113h${w + 2}v7h-${w + 2}z`, p.dark)}` : "";
	const bottomRail = hasBottom ? `${t.rail(railLeft, bottom + 10, railRight - railLeft)}${path(`M${x + 4} ${bottom - 1}h9v13h-9zM${end - 12} ${bottom - 1}h9v13h-9z`, p.dark)}` : "";
	const sideRail = railed || factory && !bolt ? t.rail(x + 4, 145, w - 9) : "";
	const factorySlots = factory && ["g36", "ash12", "mcx"].includes(gun.id) ? t.vents(x + 12, top + 13, Math.max(1, Math.floor((w - 21) / 25)), 13, 7, 25)
		: factory && ["m4a1", "hk416"].includes(gun.id) ? t.ribs(x + 11, top + 15, Math.max(1, Math.floor((w - 23) / 9)), bottom - top - 23, 9)
		: factory && gun.id === "fal" ? t.vents(x + 20, top + 12, 3, 13, 7, (w - 45) / 3) : "";
	const upperBound = factoryTop ? 103 : railed ? Math.min(s.railTop - 5, top - 13) : top - 5;
	return geometry(shell, `${marker(`${gun.id}-${a}-fore-end`)}${bridge}${factoryTop}${bottomRail}${sideRail}${factory && gun.id === "scarh" ? path("M513 132h68v29h-68z", p.polymer) : ""}${factorySlots}${t.seam(`M${x + 4} ${top + 4}h${w - 17}`, true)}${t.fastener(x + 8, bottom - 7, 2.6)}${t.fastener(end - 8, bottom - 7, 2.6)}${wood ? t.grain(x + 10, top + 12, w - 23, 14) : ""}${factory && bolt ? `${t.seam(`M${x + 8} ${bottom - 4}h${w - 18}`, true)}${t.vents(end - 60, bottom - 11, 2, 12, 4, 22)}` : ""}${factory && aug ? `${path("M563 166h17l8 14h-35z", p.dark)}${t.fastener(571, 168, 3.7)}` : ""}`, wood ? "wood" : a === "carbon" ? "carbon" : a === "vented" || factory && gun.id === "scarh" ? "dark" : "polymer", [railed ? receiverLeft - 5 : hasBottom ? railLeft - 5 : x - 6, upperBound, railRight - (railed ? receiverLeft - 5 : hasBottom ? railLeft - 5 : x - 6) + 8, bottom + 21 - upperBound], railed || a === "vented" || factory && ["awm", "sr25"].includes(gun.id));
}

function barrel(gun: ReferenceProfile, a: string, p: ReferencePaint, t: ReferenceTools): ReferenceGeometry {
	const s = stations[gun.id]!, end = gun.barrelEnd, bolt = boltRifles.has(gun.id), thick = a === "heavy" ? 19 : bolt ? 15 : a === "fluted" ? 15 : gun.id === "ash12" ? 22 : 11;
	const start = bolt ? 479 : s.start - 9, y = 139, top = y - thick / 2;
	const shell = `M${start} ${top - 2}h34l12 2h${end - start - 46}v${thick}h-${end - start - 46}l-12 2h-34z`;
	const gasX = gun.id === "m4a1" ? 664 : gun.id === "hk416" ? 654 : gun.id === "scarh" ? 615 : gun.id === "fal" ? 657 : gun.id === "aug" ? 608 : s.front - 15;
	const gas = bolt ? "" : gun.id === "m4a1" && a === "factory" ? `M${gasX - 12} 142v-16l17-33h8l11 33v16zM${gasX - 1} 123l11-21 7 21z`
		: `M${gasX - 6} 125h20v22h-20z`;
	const gasDetail = gas ? `${path(gas, p.dark, ' fill-rule="evenodd"')}${t.fastener(gasX + 4, 139, 2.2)}${gun.id === "fal" ? path(`M${start + 9} 120h${gasX - start - 8}v6h-${gasX - start - 8}z`, p.dark) : ""}` : "";
	const shoulder = Math.max(start + 49, end - (bolt ? 53 : 59));
	const detail = `${marker(`${gun.id}-${bolt ? "free-float-bolt-barrel" : "gas-block-barrel"}`)}${t.seam(`M${start + 8} ${top + 2}h${end - start - 13}`, true)}${t.seam(`M${shoulder} ${top}v${thick}M${end - 12} ${top}v${thick}`)}${t.ribs(end - 9, top + 1, 2, thick - 2, 4)}${gasDetail}${a === "fluted" ? Array.from({ length: 3 }, (_, i) => t.seam(`M${start + 57} ${top + 3 + i * 4}h${end - start - 77}`, i === 0)).join("") : ""}${a === "heavy" ? `${t.seam(`M${start + 50} ${top + thick - 2}h${end - start - 66}`)}${t.seam(`M${start + 45} ${top}v${thick}`, true)}` : ""}`;
	return { ...geometry(shell, detail, "dark", [start - 5, gas && gun.id === "m4a1" && a === "factory" ? 88 : 115, end - start + 10, gas && gun.id === "m4a1" && a === "factory" ? 72 : 43]), muzzle: { x: end, y } };
}

export const modernReferenceGeometry: ReferenceRenderer = (slot, appearance, gun, paint, tools) => {
	if (!families.has(gun.id)) return undefined;
	switch (slot) {
		case "receiver": return receiver(gun, paint, tools);
		case "stock": return stock(gun, appearance, paint, tools);
		case "magazine": return magazine(gun, appearance, paint, tools);
		case "handguard": return handguard(gun, appearance, paint, tools);
		case "barrel": return barrel(gun, appearance, paint, tools);
		default: return undefined;
	}
};

