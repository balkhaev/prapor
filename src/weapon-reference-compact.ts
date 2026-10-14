import type { ReferenceRenderer, ReferenceLayout, ReferenceProfile, ReferenceGeometry, ReferencePaint, ReferenceTools } from "./weapon-reference-types";

// Drawn from the manufacturers' exterior photographs (FN, HK, Colt, Glock,
// KRISS and Zlatmash) and original museum/OMON photographs. These are native
// modular profiles, not photographs embedded or traced into game assets.
const pistols = new Set(["pm", "tt", "m1911", "fiveseven", "sr1", "glock20"]);
const compactIds = new Set([...pistols, "pp91", "p90", "mp7", "ump45", "vector", "sr2"]);
const nativeEnds: Record<string, number> = { pm: 603, tt: 603, m1911: 615, fiveseven: 622, sr1: 610, glock20: 619, pp91: 650, p90: 675, mp7: 654, ump45: 676, vector: 658, sr2: 649 };

const path = (d: string, fill: string, name?: string) => `<path${name ? ` data-mechanism="${name}"` : ""} d="${d}" fill="${fill}"/>`;
const serrations = (x: number, y: number, count: number, height: number, tools: ReferenceTools, lean = 0, spacing = 6) => Array.from({ length: count }, (_, i) => `${tools.seam(`M${x + i * spacing} ${y}l${lean} ${height}`)}${tools.seam(`M${x + i * spacing + 2} ${y + 1}l${lean} ${height - 2}`, true)}`).join("");
const dots = (x: number, y: number, columns: number, rows: number, spacing = 5) => `<g opacity=".42">${Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => `<circle cx="${x + column * spacing - row * .9}" cy="${y + row * spacing}" r=".8" fill="#a3aaa0"/>`).join("")).join("")}</g>`;
const sight = (x: number, y: number, front: boolean, paint: ReferencePaint) => path(front ? `M${x} ${y}h7l3 10h-12z` : `M${x} ${y}h17l4 10h-24z`, paint.dark, front ? "front-blade" : "rear-notch");

function pistolReceiver(id: string, paint: ReferencePaint, t: ReferenceTools): ReferenceGeometry {
	const end = nativeEnds[id]! - 15;
	if (id === "pm") return {
		material: "dark", bounds: [302, 100, end - 299, 218],
		outline: `M325 112h${end - 325}v49H469q-10 0-15 9l-8 12v30q0 19-22 19h-27l-4 69q0 14-14 14h-63q-12 0-11-13l12-84-4-39-8-10v-31q0-18 20-25zM400 176h29q10 0 10 12v22q0 12-14 12h-31l-6-12 1-23q1-11 11-11z`,
		detail: `${path(`M326 114h${end - 326}v35H310v-18q0-15 16-17z`, paint.dark, "pm-rounded-slide")}${t.seam(`M329 119h${end - 338}M314 150h${end - 319}`, true)}${serrations(331, 127, 11, 21, t, 5, 5)}${t.port(456, 127, 44, 19)}${path("M317 177q7-7 22-7h23q13 0 21 14l5 15-11 102h-59q-7 0-5-10l13-78z", paint.wood, "pm-bakelite-panel")}${t.checkering(331, 221, 35, 64)}<circle cx="350" cy="277" r="8" fill="none" stroke="#7e715d" stroke-width="1.3"/>${path("M350 271l2 4h4l-3 3 1 4-4-2-4 2 1-4-3-3h4z", "#948671")}${path("M404 178q-5 15 2 28l6-2q-6-9-1-26z", paint.steel, "trigger")}${path("M324 153h55v6h-55z", paint.steel, "slide-stop")}${path("M315 122h16l5 5-11 9h-14z", paint.steel, "pm-slide-safety")}${t.fastener(320, 126, 2.1)}${sight(329, 102, false, paint)}${sight(end - 23, 102, true, paint)}${path("M305 112l-3-8 12-2 7 10z", paint.dark, "exposed-hammer")}${t.seam("M315 308h64", true)}`,
	};
	if (id === "tt") return {
		material: "dark", bounds: [291, 99, end - 288, 210],
		outline: `M313 110h${end - 313}v46H451l-7 13v30q0 16-18 19h-44l-9 85h-69l10-100-3-30-15-9v-20l-3-20 11-5zM386 172h37q14 0 14 13v13q0 12-15 12h-35l-8-11 1-19q1-8 6-8z`,
		detail: `${path(`M317 112h${end - 317}v40H306v-30z`, paint.dark, "tt-long-slide")}${t.seam(`M319 117h${end - 328}M309 151h${end - 314}`, true)}${serrations(315, 126, 10, 23, t, 0, 5)}${t.port(453, 125, 48, 19)}${path("M321 173h51l-12 125h-48l13-100z", paint.rubber, "tt-vertical-grip")}${serrations(325, 184, 7, 97, t, -9, 6)}${t.fastener(343, 198, 3)}${t.fastener(335, 274, 3)}${path("M396 175q-8 12-1 27l6-2q-5-11 0-25z", paint.steel, "trigger")}${path("M359 157h54v5h-54z", paint.steel, "slide-stop")}${t.fastener(370, 158, 3)}${sight(318, 101, false, paint)}${sight(end - 22, 101, true, paint)}${path("M304 112l-13-9 4-4 13 5 6 8z", paint.dark, "tt-exposed-hammer")}${path("M304 302h13v5h-13z", paint.steel, "tt-lanyard-heel")}`,
	};
	if (id === "m1911") return {
		material: "dark", bounds: [287, 99, end - 284, 213],
		outline: `M321 111h${end - 321}v47h-53v11h-93l-6 10v28q0 18-20 19h-49l-18 82h-67l24-110-6-27-24-10v-9h13v-27zM399 176h30q13 0 13 14v14q0 12-14 12h-43l6-29q2-11 8-11z`,
		detail: `${path(`M322 113h${end - 322}v39H312v-27z`, paint.dark, "1911-rounded-slide")}${t.seam(`M326 117h${end - 338}M314 152h${end - 320}`, true)}${serrations(324, 126, 10, 24, t, -5, 5)}${t.port(466, 125, 54, 23)}${path("M333 179h48l-23 122h-48z", paint.wood, "1911-two-screw-panels")}${t.checkering(338, 200, 30, 74)}${t.fastener(355, 190, 3.8)}${t.fastener(338, 285, 3.8)}${t.seam("M307 301l22-96M374 174l-10 54", true)}${path("M399 181q-8 11-2 26h7v-25z", paint.steel, "1911-short-trigger")}${path("M354 157h59v6h-59z", paint.steel, "slide-stop")}${path("M318 166h35v6h-35z", paint.steel, "1911-thumb-safety")}${path("M304 112l-13-4-4 4 18 12h9z", paint.dark, "1911-hammer")}${path("M314 156l-22-7-5 4 20 15h13z", paint.dark, "1911-beavertail")}${sight(325, 101, false, paint)}${sight(end - 22, 101, true, paint)}${path("M518 168h26v4h-26z", paint.dark, "1911-dustcover-rail")}`,
	};
	if (id === "fiveseven") return {
		material: "polymer", bounds: [287, 99, end - 284, 220],
		outline: `M326 111h${end - 335}l9 13v39h-88l-10 9h-57l13 11v30q0 15-17 18h-73l-15 82h-69l14-95 1-37 5-17v-23q0-22 22-30zM416 180h27q13 0 13 15v14q0 14-15 14h-43l6-29q3-14 12-14z`,
		detail: `${path(`M327 113h${end - 338}l11 14v30H313v-20q0-19 14-24z`, paint.dark, "five-seven-covered-slide")}${t.seam(`M334 119h${end - 350}M316 155h${end - 323}`, true)}${serrations(326, 125, 12, 27, t, 6, 5)}${serrations(end - 59, 125, 8, 27, t, 3, 5)}${t.port(456, 128, 52, 22)}${path("M334 184h43l12 26-17 93h-49l15-92z", paint.rubber, "five-seven-tall-grip")}${dots(340, 218, 7, 16)}${t.fastener(373, 190, 2.1)}${path("M421 181q-7 15-1 30l7-2q-5-12 1-28z", paint.steel, "trigger")}${path("M382 167h36v6h-36z", paint.steel, "five-seven-slide-stop")}${path("M382 181h16l7 4-5 6h-18z", paint.dark, "five-seven-frame-safety")}${path("M511 163h86v8h-86z", paint.dark, "five-seven-accessory-rail")}${t.ribs(525, 164, 6, 5, 11)}${sight(325, 101, false, paint)}${sight(end - 24, 101, true, paint)}${t.seam("M332 302h44", true)}`,
	};
	if (id === "sr1") return {
		material: "polymer", bounds: [279, 99, end - 276, 223],
		outline: `M323 111h${end - 330}l7 11v43h-91l-22 5h-48l31 14v28q0 17-19 20h-81l-13 83h-69l12-94 2-42 12-15v-29q0-17 23-24zM411 182h25q16 0 16 17v12q0 12-14 12h-40l4-27q1-14 9-14z`,
		detail: `${path(`M324 113h${end - 335}l11 13v33H311v-31z`, paint.dark, "sr1-angular-slide")}${t.seam(`M328 117h${end - 343}M315 158h${end - 320}`, true)}${serrations(327, 125, 14, 29, t, 1, 5)}${t.port(462, 128, 46, 22)}${path("M330 184h47l11 24-17 100h-49l14-96z", paint.rubber, "sr1-integrated-polymer-grip")}${t.ribs(340, 220, 6, 62, 5)}${path("M321 188l8 1-13 108-7-2z", paint.dark, "sr1-backstrap-safety")}${t.seam("M336 302h34", true)}${path("M418 183q-7 14-2 29l7-3q-4-9 1-26z", paint.steel, "trigger")}${path("M385 166h39v6h-39z", paint.steel, "sr1-slide-stop")}${t.fastener(390, 173, 2.5)}${path("M407 175h12v5h-12z", paint.steel, "sr1-guard-safety")}${path("M528 166h58v8h-58z", paint.dark, "sr1-accessory-interface")}${t.ribs(538, 167, 4, 5, 11)}${sight(329, 101, false, paint)}${sight(end - 25, 101, true, paint)}${path("M302 116l-3-12 7-5 12 12z", paint.dark, "sr1-exposed-hammer")}`,
	};
	return {
		material: "polymer", bounds: [295, 99, end - 292, 222],
		outline: `M316 111h${end - 316}v47l-21 4h-71l-6 12h-41l-5 10v34q0 17-19 18h-45l-2 13-7 4 3 13-8 4 3 13-7 4-5 29h-67l15-101 4-39-26-17v-34q0-13 5-13zM414 184h23q14 0 14 15v14q0 14-15 14h-45l8-31q3-12 15-12z`,
		detail: `${path(`M317 113h${end - 317}v40H310v-30z`, paint.dark, "glock20-square-slide")}${t.seam(`M320 117h${end - 328}M312 153h${end - 317}`, true)}${serrations(327, 125, 10, 25, t, 0, 5)}${t.port(457, 122, 59, 28)}${path("M331 189h43l14 26-15 91h-50l16-101z", paint.rubber, "glock20-large-frame")}${dots(340, 220, 7, 15)}${path("M383 191h15v15h-15z", paint.dark, "glock-magazine-release")}${serrations(385, 193, 3, 10, t, 0, 4)}${path("M414 185q-9 13-3 28l8-2q-5-9 2-26z", paint.steel, "trigger")}${path("M421 189v19h4v-19z", paint.dark, "glock-trigger-safety")}${path("M382 165h30v6h-30z", paint.dark, "glock-slide-stop")}${path("M452 165h11v8h-11z", paint.steel, "glock-slide-lock")}${path("M513 163h70v10h-70z", paint.dark, "glock-accessory-rail")}${t.seam("M543 164v7M560 164v7")}${sight(326, 101, false, paint)}${sight(end - 25, 101, true, paint)}`,
	};
}

function pdwReceiver(id: string, paint: ReferencePaint, t: ReferenceTools): ReferenceGeometry {
	if (id === "pp91") return {
		material: "dark", bounds: [313, 99, 238, 171],
		outline: "M320 111h208l19 15v47h-76v15h-58v-8h-26l-13 79q-1 8-12 8h-39l16-88h-19zM391 181h21v28q0 10-12 10h-13z",
		detail: `${path("M324 113h194l16 14v26H324z", paint.dark, "kedr-stamped-box")}${t.seam("M326 119h189l15 12M325 169h66M419 169h52", true)}${t.port(473, 126, 55, 24)}${path("M468 132h62v7h-25l-11 12h-19z", paint.steel, "kedr-side-charging-handle")}${path("M344 185h29l-12 67h-25z", paint.rubber, "kedr-raked-grip")}${t.ribs(347, 196, 4, 42, 6)}${t.triggerGuard(388, 181, 41, 32)}${t.selector(349, 160, 26, true)}${t.fastener(329, 157, 3)}${t.fastener(511, 162, 3)}${path("M338 101h21v11h-21z", paint.dark, "kedr-rear-sight")}${path("M527 102h14v24h-14z", paint.dark, "kedr-front-sight")}`,
	};
	if (id === "mp7") return {
		material: "dark", bounds: [307, 97, 297, 170],
		outline: "M314 115h274l12 13v40h-73v12h-95v22q0 15-14 15h-19l-12 47h-51l11-91h-33zM399 181h20v20q0 8-10 8h-14z",
		detail: `${t.rail(320, 108, 279)}${t.seam("M319 119h267l8 13M319 163h212", true)}${t.port(408, 132, 62, 23)}${path("M350 179h38l-11 77h-34z", paint.rubber, "mp7-in-grip-feed")}${t.checkering(353, 194, 29, 47)}${t.triggerGuard(395, 176, 48, 35)}${t.selector(361, 159, 25)}${t.fastener(327, 144, 3)}${t.fastener(587, 157, 3)}${path("M308 116h16v10h-16z", paint.steel, "mp7-rear-charging-handle")}${path("M336 99h23l3 8h-29zM566 99h19v9h-19z", paint.dark, "mp7-folding-sights")}${path("M322 152h27v4h-27z", paint.steel, "mp7-stock-lock")}${path("M385 248h8v13h-8z", paint.steel, "mp7-magazine-catch")}`,
	};
	if (id === "ump45") return {
		material: "polymer", bounds: [306, 92, 303, 171],
		outline: "M314 119l18-16h32l17 12h213l11 17v38h-75v21h-52v-10h-46v28q0 11-14 11h-23l-20 40h-46l26-79-8-8h-23zM398 187h26v19q0 8-10 8h-24z",
		detail: `${t.rail(375, 108, 138)}${t.seam("M319 124h273l8 14M321 171h102", true)}${t.port(428, 132, 64, 26)}${path("M320 128h102v8H320z", "#17211f", "ump-long-cocking-slot")}${path("M405 125h15v17h-15z", paint.steel, "ump-forward-cocking-lever")}${path("M350 187h35l-19 67h-32z", paint.rubber, "ump-raked-grip")}${dots(353, 202, 5, 9)}${t.triggerGuard(392, 183, 54, 33)}${t.selector(362, 170, 22)}${t.fastener(317, 160, 3.5)}${t.fastener(579, 162, 3)}${path("M333 96h19l10 12h-39zM581 94h12l6 24h-24z", paint.dark, "ump-raised-sight-ears")}${path("M479 174h41v15h-41z", paint.dark, "ump-straight-magwell")}${t.seam("M483 177h33v10", true)}`,
	};
	if (id === "vector") return {
		material: "dark", bounds: [300, 96, 291, 177],
		outline: "M313 115h274v40h-50l-10 105q0 10-12 10h-89l-25-13h-89q-9 0-7-9l28-79h-20zM374 163h36l-13 55q-3 12-20 22h-42l18-60q6-17 21-17z",
		detail: `${t.rail(312, 108, 274)}${t.seam("M319 119h258M319 151h219M425 263h88", true)}${path("M429 158h94l-6 91h-86l-13-15z", paint.dark, "vector-tall-bolt-housing")}${path("M339 175h29l-22 72h-31z", paint.rubber, "vector-offset-grip")}${t.checkering(339, 186, 20, 42)}${path("M425 183l22 53h22l-3-62z", "#273331", "vector-recoil-housing-panel")}${t.seam("M440 181l14 48h5M509 168l-8 74", true)}${t.port(470, 129, 60, 19)}${path("M464 152h72v15h-72z", paint.steel, "vector-rectangular-side-cocking-lever")}${t.fastener(477, 158, 3)}${t.fastener(502, 158, 3)}${t.selector(360, 129, 22)}${t.fastener(320, 139, 3)}${t.fastener(421, 136, 4)}${t.fastener(432, 251, 4)}${t.fastener(503, 252, 4)}${path("M384 165q-6 9-1 25l6-2q-4-9 0-23z", paint.steel, "vector-trigger")}${path("M317 99h21l4 8h-28zM546 99h19l4 8h-26z", paint.dark, "vector-folding-sights")}`,
	};
	if (id === "sr2") return {
		material: "dark", bounds: [308, 98, 290, 168],
		outline: "M315 114h236l43 18v43h-72v5h-85v23q0 14-15 14h-21l-14 44h-50l13-86h-35zM400 181h25v21q0 8-10 8h-17z",
		detail: `${t.seam("M322 118h226l38 18M320 168h221", true)}${t.rail(333, 108, 229)}${t.port(433, 128, 70, 25)}${path("M439 134h69v8h-26l-14 10h-29z", paint.steel, "sr2-side-cocking-lever")}${path("M356 184h30l-11 68h-32z", paint.rubber, "sr2-in-grip-feed")}${t.ribs(358, 195, 4, 48, 6)}${t.triggerGuard(398, 176, 51, 35)}${t.selector(357, 155, 32, true)}${t.fastener(323, 147, 3)}${t.fastener(529, 163, 3)}${path("M337 99h21v13h-21zM568 101h14v20h-14z", paint.dark, "sr2-protected-iron-sights")}${path("M385 247h9v14h-9z", paint.steel, "sr2-grip-magazine-latch")}`,
	};
	return {
		material: "polymer", bounds: [225, 99, 395, 177],
		outline: "M233 134h272l12-25h91v59l-2 58h-15v-12q0-22-23-22-22 0-24 21l-5 27q-8 30-52 30h-31l7-37-22 5q-28 39-86 34l-113-25h-11v-101q0-11 2-12zM400 178h26q26 0 26 19 0 15-15 20l-40 15q-20 6-20-19 0-25 23-35zM523 177q-23 0-23 21 0 22 24 24 24 0 24-22 0-21-25-23zM522 121h57v8h-57z",
		detail: `${t.rail(478, 108, 138)}${path("M478 114h138v4H478zM478 124l22-15h15l-12 50h-24zM589 113h16v57h-16z", paint.dark, "p90-optic-bridge")}${path("M267 131h319v7H267z", paint.dark, "horizontal-top-feed")}${t.seam("M239 139h232M237 247h16l107 22M465 171h28M577 168h27", true)}${path("M468 199l24 1-5 46h-26z", paint.rubber, "p90-firing-grip-strap")}${t.seam("M465 248h22", true)}${path("M503 200h17v6h-17z", paint.dark, "p90-trigger-crossbar")}${path("M533 146h37v8h-37z", paint.steel, "p90-ambidextrous-cocking-handle")}${t.fastener(243, 162, 3)}${t.fastener(340, 251, 3)}${t.fastener(463, 162, 3)}${t.fastener(574, 180, 3)}${t.fastener(587, 151, 4)}${path("M253 216h49v7h-49z", "#19241f", "p90-bottom-ejection-port")}${t.seam("M376 213q0-32 24-35h26q26 0 26 19", true)}${path("M237 235h26v8h-26z", paint.dark, "p90-sling-heel")}`,
	};
}

function compactStock(id: string, appearance: string, paint: ReferencePaint, t: ReferenceTools): ReferenceGeometry {
	if (id === "p90") {
		const depth = appearance === "tactical" ? 33 : appearance === "precision" ? 40 : appearance === "padded" ? 27 : appearance === "skeleton" ? 17 : 20;
		const x = 232 - depth, cheek = appearance === "precision" ? 12 : appearance === "padded" ? 7 : 0;
		return { material: appearance === "skeleton" ? "dark" : "rubber", bounds: [x - 2, 130 - cheek, depth + 4, 134 + cheek], outline: `M${x + 4} ${135 - cheek}q10-5 ${depth - 4}-2v126q-${depth - 4} 3-${depth - 4}-4z${appearance === "skeleton" ? `M${x + 6} 167h5v58h-5z` : ""}`, detail: `${path(`M${x + 2} 140h7v114h-7z`, paint.rubber, "p90-rear-butt-interface")}${t.ribs(x + 3, 147, 2, 100, 3)}${t.fastener(226, 148, 2)}${t.fastener(226, 246, 2)}${cheek ? path(`M${x + 10} ${134 - cheek}h${depth - 11}v14h-${depth - 11}z`, paint.rubber, "p90-cheek-pad") : ""}` };
	}
	const rear = id === "pp91" ? 320 : id === "vector" ? 316 : id === "sr2" ? 317 : 316;
	if (appearance === "factory" && id === "pp91" || appearance === "folding" && id === "pp91") {
		const left = appearance === "folding" ? 127 : 107;
		return { material: "steel", bounds: [left - 4, 137, rear - left + 8, 113], outline: `M${left} 148h13v81l${rear - left - 31}-63 18-13v13l-20 12-${rear - left - 22} 63h-2zM${left + 19} 151h${rear - left - 20}v7h-${rear - left - 20}z`, detail: `${path(`M${left - 2} 149h8v95h-8z`, paint.rubber, "kedr-thin-wire-butt")}${t.seam(`M${left + 9} 153v75l${rear - left - 34}-60`, true)}${t.fastener(rear - 4, 157, 4.5)}${path(`M${rear - 19} 146h14v19h-14z`, paint.dark, "kedr-stock-hinge")}` };
	}
	if (appearance === "factory" && id === "mp7") return { material: "dark", bounds: [101, 133, 219, 104], outline: "M106 139h15v21h194v9H121v60h-14zM118 140h196v8H118z", detail: `${path("M102 146h10v85h-10z", paint.rubber, "mp7-telescopic-butt")}${t.seam("M124 141h184M126 164h181", true)}${path("M279 137h37v13h-37z", paint.dark, "mp7-dual-telescopic-rails")}${t.fastener(110, 219, 2.5)}${t.fastener(297, 144, 2.5)}${t.ribs(107, 175, 2, 41, 4)}` };
	if (appearance === "factory" && id === "sr2") return { material: "steel", bounds: [99, 102, 222, 141], outline: "M106 118h211v10H122v90l169-73h26v12l-201 81h-12zM131 105h186v7H131z", detail: `${path("M100 142h14v96h-14z", paint.rubber, "sr2-top-folding-frame")}${t.seam("M109 124v98l186-74M136 107h173", true)}${t.fastener(310, 121, 4)}${path("M290 113h26v18h-26z", paint.dark, "sr2-stock-upper-hinge")}${t.ribs(103, 161, 2, 61, 4)}` };
	if (appearance === "factory" && id === "vector") return { material: "polymer", bounds: [102, 128, 218, 114], outline: "M108 136h117l16 5h75v17h-60l-9 79h-67l-10-31h-62zM133 156h71v29h-71z", detail: `${path("M232 140h84v11h-84z", paint.steel, "vector-m4-stock-tube")}${path("M105 143h11v92h-11z", paint.rubber, "vector-adjustable-butt-pad")}${t.ribs(108, 161, 2, 60, 4)}${t.seam("M120 141h104l19 5M129 194h39l13 35h54", true)}${path("M206 181h36v18h-36z", paint.dark, "vector-stock-adjustment-lever")}${t.fastener(229, 192, 4)}${t.fastener(307, 146, 3)}${t.fastener(146, 201, 2.5)}` };
	if (appearance === "factory" && id === "ump45" || appearance === "folding") {
		const left = appearance === "folding" ? 119 : 103;
		const square = id === "ump45";
		return { material: square ? "polymer" : "dark", bounds: [left - 5, 131, rear - left + 10, 111], outline: `M${left} 142h138l${rear - left - 138}-10v27l-${rear - left - 93} 51-90 26h-3zM${left + 15} 155v62l91-29 8-33zM${left + 125} 154h23l30-11v12l-38 20h-18z`, detail: `${path(`M${left - 2} 146h11v87h-11z`, paint.rubber, square ? "ump-two-window-butt-frame" : "compact-folding-frame")}${t.seam(`M${left + 17} 149h117l${rear - left - 145}-12M${left + 19} 222l139-48`, true)}${t.fastener(rear - 7, 149, 4)}${t.fastener(left + 18, 218, 2.5)}${t.ribs(left + 1, 162, 2, 57, 4)}` };
	}
	const skeleton = appearance === "skeleton", precision = appearance === "precision", padded = appearance === "padded";
	const left = precision ? 93 : skeleton ? 112 : padded ? 98 : 106;
	const cheek = precision ? 121 : padded ? 130 : 138;
	const outline = skeleton ? `M${left} 144h87l25-10h${rear - left - 112}v26h-${rear - left - 89}l-18 73h-71zM${left + 17} 159v54h41l16-54zM${left + 94} 143h${rear - left - 105}v8h-${rear - left - 105}z`
		: precision ? `M${left} 146h103v-25h71v25h${rear - left - 174}v23h-${rear - left - 145}l-23 68h-49l-12-41-49 38h-12zM${left + 137} 167h28l-18 52h-11l-9-29z`
		: padded ? `M${left} 145q41-5 98-3l${rear - left - 98}-10v34h-53l-31 41-112 29h-5z`
		: `M${left} 145h98l${rear - left - 98}-10v28h-62l-12 67h-81v-33h-41zM${left + 27} 160h64v21h-64z`;
	return { material: skeleton ? "dark" : "polymer", bounds: [left - 5, cheek - 4, rear - left + 9, 121 + (138 - cheek)], outline, detail: `${path(`M${left - 2} 149h12v87h-12z`, paint.rubber, `${id}-${appearance}-butt`) }${t.ribs(left + 1, 161, 2, 65, 4)}${path(`M${rear - 69} 140h65v10h-65z`, paint.steel, "compact-stock-interface")}${t.fastener(rear - 8, 150, 4)}${t.fastener(left + 95, 183, 3)}${precision || padded ? path(`M${left + 103} ${cheek}h${precision ? 71 : 87}v17h-${precision ? 71 : 87}z`, paint.rubber, "compact-adjustable-cheek") : t.seam(`M${left + 17} 149h75`, true)}${skeleton ? t.seam(`M${left + 21} 218h40l18-62`, true) : t.vents(left + 23, 201, 5, 9, 9, 13)}` };
}

const frontEnds: Record<string, number> = { pp91: 594, mp7: 603, ump45: 609, vector: 588, sr2: 595, p90: 610 };
const foreStarts: Record<string, number> = { pp91: 524, mp7: 468, ump45: 518, vector: 532, sr2: 512, p90: 558 };

function compactHandguard(id: string, appearance: string, paint: ReferencePaint, t: ReferenceTools): ReferenceGeometry {
	const left = foreStarts[id]!, right = frontEnds[id]!, width = right - left;
	const rail = appearance === "rail", carbon = appearance === "carbon", light = appearance === "light", vented = appearance === "vented", wood = appearance === "wood";
	if (id === "p90") {
		const lower = wood ? 261 : rail || carbon ? 279 : light ? 251 : vented ? 266 : 270;
		return { material: wood ? "wood" : carbon ? "carbon" : "polymer", bounds: [503, 135, 111, Math.max(286, lower) - 131], outline: `M${left} 161h${width}v60h-11v-10q0-21-23-21-18 0-23 23l-4 28q-4 ${lower - 237}-35 ${lower - 237}h-7l9-33 5-18q4-29 21-29z${rail || carbon || appearance === "factory" ? "M552 139h56v19h-56z" : ""}${rail || carbon || vented ? "M506 264h102v15H506z" : ""}${light ? "M566 168h32v7h-32z" : vented ? "M582 168h16v7h-16z" : ""}`, detail: `${path("M578 167h25v17h-25z", paint.dark, "p90-rounded-front-furniture")}${t.fastener(591, 175, 3)}${t.seam(`M555 254q24-1 31-25M604 185v20`, true)}${rail || carbon || vented ? t.rail(505, 271, 105) : t.ribs(558, 250, 4, 6, 6)}${rail || carbon || appearance === "factory" ? t.rail(553, 145, 54) : ""}${carbon ? t.vents(581, 167, 2, 6, 7, 11) : ""}${wood ? t.grain(576, 176, 24, 8) : ""}` };
	}
	const top = id === "pp91" ? 133 : id === "vector" ? 143 : 130;
	const lower = id === "vector" ? 173 : id === "sr2" ? 190 : id === "mp7" ? 190 : 182;
	const bottom = light ? lower - 7 : wood ? lower + 2 : vented ? lower - 2 : lower;
	const bevel = rail ? 3 : light ? 14 : carbon ? 9 : vented ? 6 : wood ? 12 : 8;
	const holes = light ? `M${left + 13} ${top + 9}h${width - 28}v9h-${width - 28}z` : vented ? `M${left + 15} ${top + 10}h${width - 31}v7h-${width - 31}z` : "";
	const bottomRail = rail || carbon || vented || appearance === "factory";
	const railLeft = ({ pp91: 488, mp7: 474, ump45: 499, vector: 483, sr2: 490 } as Record<string, number>)[id]!;
	const boundLeft = Math.min(left, bottomRail ? railLeft : left, rail || carbon ? 356 : left) - 4;
	const boundTop = rail || carbon ? 104 : Math.min(top - 5, 140);
	return { material: wood ? "wood" : carbon ? "carbon" : "polymer", bounds: [boundLeft, boundTop, right - boundLeft + 4, bottom - boundTop + 14], outline: `M${left} ${top}h${width - bevel}l${bevel} 8v${bottom - top - 15}l-${bevel} 7H${bottomRail ? railLeft + 2 : left}v-10H${left}z${holes}${rail || carbon ? `M360 108h${right - 360}v6H360zM375 113h9v14h-9zM${left + 12} 113h9v${top - 112}h-9z` : ""}`, detail: `${t.seam(`M${left + 5} ${top + 4}h${width - 13}M${left + 6} ${bottom - 5}h${width - 16}`, true)}${t.fastener(left + 7, bottom - 11, 2.5)}${t.fastener(right - 8, bottom - 11, 2.5)}${path(`M${left + 5} ${bottom - 11}h${width - 12}v7h-${width - 12}z`, paint.dark, `${id}-short-fore-end`)}${rail || carbon ? `${t.rail(360, 108, right - 360)}${t.ribs(left + 18, top + 20, Math.max(3, Math.floor((width - 34) / 8)), 15, 8)}` : wood ? t.grain(left + 14, top + 20, width - 31, 20) : t.vents(left + 15, top + 20, Math.max(2, Math.floor((width - 27) / 17)), 9, 9, 16)}${bottomRail ? t.rail(railLeft, bottom, right - railLeft) : ""}${rail || carbon || appearance === "factory" ? t.rail(left + 5, 145, width - 16) : ""}${appearance === "factory" && id === "mp7" ? `${path(`M${left + 15} ${bottom - 2}h${width - 30}v7h-${width - 30}z`, paint.rubber, "mp7-folded-front-grip")}${t.seam(`M${left + 20} ${bottom + 2}h${width - 43}`, true)}` : appearance === "factory" && id === "sr2" ? path(`M${left + 8} ${bottom - 2}h${width - 17}v7h-${width - 17}z`, paint.rubber, "sr2-folded-foregrip") : ""}` };
}

function compactBarrel(id: string, appearance: string, gun: ReferenceProfile, paint: ReferencePaint, t: ReferenceTools): ReferenceGeometry {
	const pistol = pistols.has(id), originalEnd = nativeEnds[id]!;
	// The caller supplies the fitted end for installed parts; loose parts use
	// that same barrelProfile. Furniture stays fixed to the original action.
	const end = gun.barrelEnd;
	const start = pistol ? originalEnd - 174 : foreStarts[id]! - 8;
	const thick = appearance === "heavy" ? 18 : appearance === "fluted" ? 15 : pistol ? 12 : 13;
	const y = 139 - thick / 2;
	const collar = appearance === "long" ? 27 : appearance === "short" ? 14 : appearance === "heavy" ? 32 : appearance === "fluted" ? 22 : 19;
	return { material: "steel", bounds: [start - 3, y - 4, end - start + 7, thick + 8], muzzle: { x: end, y: 139 }, outline: `M${start} ${y}h${end - start - collar}v-2h${collar}v${thick + 4}h-${collar}v-2H${start}z`, detail: `${t.seam(`M${start + 4} ${y + 2}h${end - start - 10}`, true)}${path(`M${start + 4} ${y - 2}h20v${thick + 4}h-20z`, paint.dark, pistol ? "pistol-barrel-chamber" : `${id}-barrel-shoulder`)}${t.seam(`M${end - collar} ${y - 2}v${thick + 4}M${end - 5} ${y}v${thick}`)}${appearance === "fluted" ? `${t.seam(`M${start + 28} ${y + 4}h${end - start - 39}`)}${t.seam(`M${start + 28} ${y + thick - 4}h${end - start - 39}`, true)}` : appearance === "heavy" ? t.ribs(end - 25, y + 2, 4, thick - 4, 5) : ""}` };
}

/** The Vector's tall bolt housing and UMP's raked magazine leave a short,
 * forward gripping surface. A full-length rifle handstop would cut into them. */
function compactForegrip(id: string, appearance: string, paint: ReferencePaint, t: ReferenceTools): ReferenceGeometry {
	// Keep the family placement datum: installedGeometry applies the same
	// foregrip offset to this shoe and to any bottom-rail adapters.
	const x = id === "vector" ? 551 : 530, y = 176;
	const shoe = `M${x} ${y}h52v8h-52z`;
	const screws = `${t.fastener(x + 5, y + 4, 2)}${t.fastener(x + 47, y + 4, 2)}`;
	const marker = path(shoe, paint.steel, `${id}-compact-foregrip-shoe`);
	if (appearance === "angled") return { material: "polymer", bounds: [x - 4, y - 4, 60, 50], outline: `${shoe}M${x} ${y + 8}h44l-24 34h-13l-5-9 18-25zM${x + 11} ${y + 29}l15-21h11l-21 29h-5z`, detail: `${marker}${screws}${t.seam(`M${x + 7} ${y + 36}l4 4h8l24-32`, true)}${path(`M${x + 22} ${y + 33}l12-11 3 3-12 11z`, paint.rubber, "compact-angled-finger-stop")}` };
	if (appearance === "light") return { material: "polymer", bounds: [x - 4, y - 4, 60, 44], outline: `${shoe}M${x + 2} ${y + 8}h39l-16 27h-16l-5-7 12-20z`, detail: `${marker}${screws}${path(`M${x + 17} ${y + 11}h15l-13 21h-9l-3-4z`, paint.dark, "compact-light-grip-recess")}${t.seam(`M${x + 11} ${y + 30}l12-19`, true)}` };
	if (appearance === "stubby") return { material: "rubber", bounds: [x - 4, y - 4, 60, 45], outline: `${shoe}M${x + 13} ${y + 8}h31v28h-31z`, detail: `${marker}${screws}${path(`M${x + 17} ${y + 12}h23v19h-23z`, paint.polymer, "compact-stubby-grip")}${t.ribs(x + 20, y + 15, 3, 14, 6)}${path(`M${x + 10} ${y + 33}h37v5h-37z`, paint.rubber)}` };
	if (appearance === "folding") return { material: "polymer", bounds: [x - 4, y - 4, 75, 64], outline: `${shoe}M${x + 19} ${y + 8}h14v10l29 36-12 9-31-38z`, detail: `${marker}${screws}${t.fastener(x + 26, y + 16, 6)}${t.seam(`M${x + 32} ${y + 29}l25 29`, true)}${path(`M${x + 49} ${y + 55}l12-9 4 5-12 9z`, paint.rubber, "compact-folding-grip-foot")}` };
	if (appearance === "bipod") return { material: "steel", bounds: [x - 4, y - 4, 75, 114], outline: `${shoe}M${x + 25} ${y + 8}h13v17l23 67h-12l-24-67z`, detail: `${marker}${screws}${t.fastener(x + 31, y + 23, 5)}${t.seam(`M${x + 37} ${y + 35}l20 54`, true)}${path(`M${x + 46} ${y + 91}h21v7h-21z`, paint.rubber, "compact-bipod-foot")}${path(`M${x + 43} ${y + 57}h12v5h-12z`, paint.dark)}` };
	return { material: "rubber", bounds: [x - 4, y - 4, 60, 75], outline: `${shoe}M${x + 12} ${y + 8}h30l-2 50h-25z`, detail: `${marker}${screws}${path(`M${x + 17} ${y + 13}h21l-2 40h-18z`, paint.polymer, "compact-vertical-grip")}${t.ribs(x + 20, y + 21, 3, 29, 6)}${path(`M${x + 13} ${y + 54}h29v6h-29z`, paint.rubber)}` };
}

type Feed = { topX: number; topY: number; width: number; depth: number; rake: number };
const feeds: Record<string, Feed> = {
	pm: { topX: 338, topY: 186, width: 39, depth: 129, rake: -17 },
	tt: { topX: 324, topY: 169, width: 43, depth: 141, rake: -13 },
	m1911: { topX: 340, topY: 176, width: 42, depth: 137, rake: -27 },
	fiveseven: { topX: 340, topY: 183, width: 39, depth: 137, rake: -12 },
	sr1: { topX: 342, topY: 185, width: 40, depth: 137, rake: -14 },
	glock20: { topX: 342, topY: 185, width: 40, depth: 138, rake: -13 },
	pp91: { topX: 433, topY: 170, width: 36, depth: 139, rake: 5 },
	mp7: { topX: 358, topY: 185, width: 37, depth: 135, rake: -16 },
	ump45: { topX: 481, topY: 177, width: 44, depth: 159, rake: 27 },
	vector: { topX: 475, topY: 241, width: 42, depth: 116, rake: -28 },
	sr2: { topX: 357, topY: 187, width: 38, depth: 139, rake: -13 },
};

function compactMagazine(id: string, appearance: string, paint: ReferencePaint, t: ReferenceTools): ReferenceGeometry {
	if (id === "p90") {
		const left = appearance === "compact" ? 305 : appearance === "extended" ? 256 : 267;
		const top = appearance === "extended" ? 95 : appearance === "window" ? 102 : appearance === "compact" ? 112 : appearance === "quick" ? 101 : 106;
		const right = 586, height = 131 - top;
		return { material: "polymer", bounds: [left - 3, top - 3, right - left + 7, height + 7], outline: `M${left + 7} ${top}h${right - left - 19}l12 7v${height - 9}l-7 2H${left}v-${height - 6}zM${left + 24} ${top + 5}h${right - left - 61}v${height - 10}h-${right - left - 61}z`, detail: `${path(`M${left + 25} ${top + 6}h${right - left - 64}v${height - 12}h-${right - left - 64}z`, "#a89562", "p90-transverse-cassette")}${path(`M${left + 26} ${top + 6}h${right - left - 66}v${height - 12}h-${right - left - 66}z`, paint.glass)}<g opacity=".8">${Array.from({ length: Math.floor((right - left - 69) / 13) }, (_, i) => `<circle cx="${left + 35 + i * 13}" cy="${top + height / 2}" r="${Math.min(4, height / 2 - 4)}" fill="#b7a36f" stroke="#776e50" stroke-width=".7"/>`).join("")}</g>${path(`M${right - 16} ${top + 5}h12v${height - 8}h-12z`, paint.dark, "p90-turning-feed-head")}${t.seam(`M${left + 13} ${top + 3}h${right - left - 33}`, true)}${appearance === "quick" ? path(`M${left + 6} ${top - 2}h12v${height + 4}h-12z`, paint.rubber, "p90-cassette-pull-tab") : ""}${t.fastener(right - 8, 121, 2)}` };
	}
	const f = feeds[id]!, pistol = pistols.has(id), drum = appearance === "drum";
	// A shorter magazine remains flush with a full-height pistol grip. The
	// capacity is represented by its body/floorplate, not a cut-off frame.
	const depth = f.depth + (appearance === "extended" ? pistol ? 48 : 43 : appearance === "compact" ? pistol ? -3 : -43 : appearance === "quick" ? pistol ? 5 : -8 : appearance === "window" ? 4 : 0);
	const bottom = f.topY + depth, rake = f.rake * depth / f.depth;
	const x = f.topX, width = f.width;
	if (drum) return { material: "dark", bounds: [x - 21, f.topY - 3, width + 38, 151], outline: `M${x} ${f.topY}h${width}v72h8l7 10v55l-7 7h-${width + 18}l-9-9v-51l8-12h9z`, detail: `${path(`M${x - 5} ${f.topY + 85}h${width + 10}v49h-${width + 10}z`, paint.rubber, `${id}-side-drum-feed`) }${t.seam(`M${x - 9} ${f.topY + 82}h${width + 16}M${x - 9} ${f.topY + 139}h${width + 16}`, true)}${t.ribs(x + 1, f.topY + 89, 5, 37, 7)}${t.fastener(x + width / 2, f.topY + 100, 3)}${path(`M${x + width / 2 - 8} ${f.topY + 137}h16v7h-16z`, paint.steel, "drum-side-latch")}` };
	const pull = appearance === "quick" ? 15 : 0, lip = appearance === "extended" ? 5 : appearance === "compact" ? 1 : appearance === "window" ? 3 : 2;
	return { material: ["mp7", "ump45", "vector", "fiveseven", "glock20"].includes(id) ? "polymer" : "dark", bounds: [Math.min(x, x + rake) - 5, f.topY - 3, width + Math.abs(rake) + 12, depth + 9 + pull], outline: `M${x} ${f.topY}h${width}l${rake} ${depth - 7}l-${lip} 7h-${width + 2}l-${lip}-7zM${x + rake - 3} ${bottom - 6}h${width + 8}v${7 + lip}h-${width + 8}z${appearance === "window" ? `M${x + 13 + rake * .25} ${f.topY + 35}h${width - 22}l${rake * .6} ${depth - 59}h-${width - 22}z` : ""}${pull ? `M${x + rake + 8} ${bottom + 3}h${width - 13}v${pull}h-${width - 13}zM${x + rake + 12} ${bottom + 7}h${width - 21}v7h-${width - 21}z` : ""}`, detail: `${t.seam(`M${x + 5} ${f.topY + 5}h${width - 10}M${x + rake + 2} ${bottom - 4}h${width + 1}`, true)}${path(`M${x + 2} ${f.topY + 2}h${width - 4}v9h-${width - 4}z`, paint.steel, `${pistol ? "pistol" : id}-feed-lips`)}${appearance === "window" ? `${path(`M${x + 13 + rake * .25} ${f.topY + 35}h${width - 22}l${rake * .6} ${depth - 59}h-${width - 22}z`, "#142320", "magazine-witness-window")}${Array.from({ length: Math.max(3, Math.floor((depth - 59) / 11)) }, (_, i) => path(`M${x + 13 + rake * (.25 + i * 11 / depth)} ${f.topY + 40 + i * 11}h${width - 22}v3h-${width - 22}z`, "#ae9c70")).join("")}` : `${t.seam(`M${x + 9} ${f.topY + 21}l${rake * .7} ${depth - 36}`)}${t.seam(`M${x + width - 8} ${f.topY + 21}l${rake * .7} ${depth - 36}`, true)}`}${t.fastener(x + width / 2 + rake * .2, f.topY + 26, 1.7)}${pull ? path(`M${x + rake + 8} ${bottom + 3}h${width - 13}v${pull}h-${width - 13}zM${x + rake + 12} ${bottom + 7}h${width - 21}v7h-${width - 21}z`, paint.rubber, "magazine-pull-loop") : ""}` };
}

export const compactReferenceGeometry: ReferenceRenderer = (slot, appearance, gun, paint, tools) => {
	if (!compactIds.has(gun.id)) return undefined;
	switch (slot) {
		case "receiver": {
			if (!pistols.has(gun.id)) {
				const shape = pdwReceiver(gun.id, paint, tools);
			if (gun.id === "vector") return { ...shape, detail: `${shape.detail}<path data-mechanism="trigger-guard" d="M374 163h36l-13 55q-3 12-20 22h-42l18-60q6-17 21-17z" fill="none" stroke="#626d64" stroke-width="1.2"/>` };
			return gun.id === "p90" ? { ...shape, detail: `${shape.detail}<path data-mechanism="trigger-guard" d="M523 177q-23 0-23 21 0 22 24 24 24 0 24-22 0-21-25-23z" fill="none" stroke="#626d64" stroke-width="1.2"/><path data-mechanism="trigger" data-hardware="p90-horizontal-trigger-bar" d="M503 200h17v6h-17z" fill="${paint.dark}"/>` } : shape;
			}
			const shape = pistolReceiver(gun.id, paint, tools);
			const guards: Record<string, string> = {
				pm: "M400 176h29q10 0 10 12v22q0 12-14 12h-31l-6-12 1-23q1-11 11-11z",
				tt: "M386 172h37q14 0 14 13v13q0 12-15 12h-35l-8-11 1-19q1-8 6-8z",
				m1911: "M399 176h30q13 0 13 14v14q0 12-14 12h-43l6-29q2-11 8-11z",
				fiveseven: "M416 180h27q13 0 13 15v14q0 14-15 14h-43l6-29q3-14 12-14z",
				sr1: "M411 182h25q16 0 16 17v12q0 12-14 12h-40l4-27q1-14 9-14z",
				glock20: "M414 184h23q14 0 14 15v14q0 14-15 14h-45l8-31q3-12 15-12z",
			};
			return { ...shape, detail: `<path data-mechanism="trigger-guard" d="${guards[gun.id]}" fill="none" stroke="#626d64" stroke-width="1.2"/>${shape.detail.replace('data-mechanism="1911-short-trigger"', 'data-mechanism="trigger" data-hardware="1911-short-trigger"')}${gun.id === "m1911" ? path(`M${nativeEnds.m1911! - 19} 122h4v31h-4z`, paint.steel, "1911-bushing") : ""}` };
		}
		case "barrel": return compactBarrel(gun.id, appearance, gun, paint, tools);
		case "magazine": return compactMagazine(gun.id, appearance, paint, tools);
		case "stock": return pistols.has(gun.id) ? undefined : compactStock(gun.id, appearance, paint, tools);
		case "handguard": return pistols.has(gun.id) ? undefined : compactHandguard(gun.id, appearance, paint, tools);
		case "foregrip": return gun.id === "vector" || gun.id === "ump45" ? compactForegrip(gun.id, appearance, paint, tools) : undefined;
		default: return undefined;
	}
};

export function compactReferenceLayout(gun: ReferenceProfile): ReferenceLayout | undefined {
	if (!compactIds.has(gun.id)) return undefined;
	if (pistols.has(gun.id)) return { foreEnd: nativeEnds[gun.id]! - 15, sideRailEnd: 581, laserCenter: 546, genericMountShift: -12, opticShift: [0, 0] };
	return ({
		pp91: { foreEnd: 594, sideRailEnd: 583, laserCenter: 558, genericMountShift: -97, topMountShift: -57, receiverTopMountShift: -57, dovetailShift: 0, foregripShift: [-11, 6] },
		mp7: { foreEnd: 603, sideRailEnd: 592, laserCenter: 546, genericMountShift: -88, topMountShift: -52, receiverTopMountShift: -52, opticShift: [0, 0], foregripShift: [-2, 14] },
		ump45: { foreEnd: 609, sideRailEnd: 598, laserCenter: 563, genericMountShift: -82, topMountShift: -138, receiverTopMountShift: -138, opticShift: [0, 0], foregripShift: [4, 6] },
		vector: { foreEnd: 588, sideRailEnd: 577, laserCenter: 560, genericMountShift: -103, topMountShift: -65, receiverTopMountShift: -65, opticShift: [0, 0], foregripShift: [-17, -3] },
		sr2: { foreEnd: 595, sideRailEnd: 584, laserCenter: 558, genericMountShift: -96, topMountShift: -89, receiverTopMountShift: -89, opticShift: [0, 0], foregripShift: [-10, 14] },
		p90: { foreEnd: 610, sideRailEnd: 607, laserCenter: 580, genericMountShift: -81, topMountShift: -35, receiverTopMountShift: -35, opticShift: [125, 0], foregripShift: [5, 95] },
	} as Record<string, ReferenceLayout>)[gun.id];
}
