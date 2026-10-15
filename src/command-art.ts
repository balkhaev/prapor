import type { ShelterRoomType } from "./game/shelter";
import { pixelRoomArt } from './pixel-room-art';

// Pass a different prefix when the same illustration appears twice on a page.
// All artwork is local, scales with its card and shares the shelter's palette.
function prefix(value: string): string {
	return `prapor-art-${value.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function frame(id: string, label: string, body: string, sky = "#333e3b"): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120" role="img" aria-label="${label}" preserveAspectRatio="xMidYMid slice">
		<defs>
			<linearGradient id="${id}-sky" x2="0" y2="1"><stop stop-color="${sky}"/><stop offset="1" stop-color="#111c1b"/></linearGradient>
			<linearGradient id="${id}-metal" x2="0.2" y2="1"><stop stop-color="#737970"/><stop offset=".48" stop-color="#404942"/><stop offset="1" stop-color="#242c27"/></linearGradient>
			<linearGradient id="${id}-rust" x2="0" y2="1"><stop stop-color="#a17655"/><stop offset="1" stop-color="#4b3b2e"/></linearGradient>
			<linearGradient id="${id}-wall" x2="0" y2="1"><stop stop-color="#586052"/><stop offset="1" stop-color="#30392f"/></linearGradient>
			<radialGradient id="${id}-light"><stop stop-color="#f5d58f" stop-opacity=".42"/><stop offset="1" stop-color="#f5d58f" stop-opacity="0"/></radialGradient>
			<radialGradient id="${id}-blue"><stop stop-color="#9ec3bf" stop-opacity=".32"/><stop offset="1" stop-color="#9ec3bf" stop-opacity="0"/></radialGradient>
			<pattern id="${id}-grain" width="31" height="23" patternUnits="userSpaceOnUse"><path d="M2 5h3M18 17h5M29 3h2" stroke="#d4c8a2" stroke-opacity=".09"/><path d="M7 21h6M21 8h4" stroke="#081310" stroke-opacity=".16"/></pattern>
			<pattern id="${id}-brick" width="22" height="12" patternUnits="userSpaceOnUse"><path d="M0 0h22M0 6h22M0 12h22M11 0v6M3 6v6" fill="none" stroke="#101917" stroke-opacity=".28" stroke-width=".8"/></pattern>
			<pattern id="${id}-stripes" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-40)"><rect width="4" height="9" fill="#cab478"/><rect x="4" width="5" height="9" fill="#2a3027"/></pattern>
			<clipPath id="${id}-clip"><rect width="240" height="120"/></clipPath>
		</defs>
		<g clip-path="url(#${id}-clip)"><rect width="240" height="120" fill="url(#${id}-sky)"/>${body}<rect width="240" height="120" fill="url(#${id}-grain)" pointer-events="none"/></g>
	</svg>`;
}

function windows(x: number, y: number, columns: number, rows: number, gapX = 13, gapY = 15): string {
	return Array.from({ length: columns * rows }, (_, i) => {
		const px = x + (i % columns) * gapX;
		const py = y + Math.floor(i / columns) * gapY;
		const lit = i % 7 === 2 || i % 11 === 8;
		return `<rect x="${px}" y="${py}" width="6" height="9" fill="${lit ? "#b19b65" : "#222e2a"}"/><path d="M${px + 3} ${py}v9M${px} ${py + 5}h6" stroke="#101c17" stroke-width=".7"/>`;
	}).join("");
}

function crate(x: number, y: number, width = 22, height = 16, color = "#69725a"): string {
	return `<path d="M${x} ${y}l5-4h${width}l-5 4z" fill="#939276"/><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="1" fill="${color}"/><path d="M${x + 5} ${y}v${height}M${x + width - 5} ${y}v${height}M${x} ${y + 4}h${width}M${x} ${y + height - 4}h${width}" stroke="#27342b" stroke-width="1.5"/><path d="M${x + width} ${y}l5-4v${height}l-5 4" fill="#374537"/>`;
}

function pine(x: number, y: number, height: number, color: string): string {
	return `<path d="M${x} ${y}l${-height * .15} ${height * .28}h${height * .075}l${-height * .19} ${height * .28}h${height * .10}l${-height * .22} ${height * .32}h${height * .77}l${-height * .22} ${-height * .32}h${height * .10}l${-height * .19} ${-height * .28}h${height * .075}z" fill="${color}"/><path d="M${x} ${y + height * .73}v${height * .27}" stroke="#303b2d" stroke-width="3"/>`;
}

function route(path: string, x: number, y: number): string {
	return `<path d="${path}" fill="none" stroke="#e3bd79" stroke-width="1.2" stroke-dasharray="3 4" opacity=".74"/><circle cx="${x}" cy="${y}" r="3" fill="#efcb8b"/><circle cx="${x}" cy="${y}" r="5.5" fill="none" stroke="#efcb8b" stroke-opacity=".35"/>`;
}

const SECTOR_LABELS: Record<string, string> = {
	courtyard: "Дворы: панельные дома, гаражи и освещённый тайник",
	depot: "Депо: товарные вагоны и ржавые железнодорожные пути",
	forest: "Лесополоса: хвойный лес, охотничий домик и тропа",
	factory: "Завод: кирпичный цех, трубы и промышленные переходы",
	reserve: "Резерв: военный ангар, сторожевая вышка и ящики",
	bunker: "Бункер-7: бетонный вход с тяжёлой гермодверью",
};

function courtyard(id: string): string {
	return `<circle cx="186" cy="17" r="10" fill="#a7b09a" opacity=".2"/>
		<path d="M0 54V25h23v-8h57v38h8V29h48v24h13V9h48v44h19V31h24v49H0" fill="#26332d"/>
		<rect x="8" y="23" width="67" height="59" fill="#5b6452"/><path d="M8 23l7-5h63l-3 5" fill="#85866a"/>${windows(16, 32, 4, 3)}
		<rect x="119" y="12" width="78" height="74" fill="#485447"/>${windows(128, 21, 5, 4)}<path d="M157 12v74M119 60h78" stroke="#1c2a22" stroke-opacity=".4"/>
		<path d="M0 81l240-5v44H0z" fill="#364138"/><path d="M76 79l35-2 109 43h-76z" fill="#62634f"/><path d="M84 84l112 36" stroke="#9c9a73" stroke-width="1" opacity=".5"/>
		<path d="M17 64l8-8h76l6 8z" fill="#7e7660"/><rect x="18" y="64" width="87" height="29" fill="url(#${id}-rust)"/><rect x="25" y="68" width="34" height="23" fill="#3b443a"/><rect x="66" y="68" width="32" height="23" fill="#444b3c"/><path d="M25 75h34M25 83h34M66 75h32M66 83h32" stroke="#171f18" stroke-opacity=".6"/><path d="M58 68v23M67 68v23" stroke="#80765b"/>
		<ellipse cx="159" cy="93" rx="38" ry="6" fill="#141f18" opacity=".5"/><path d="M127 87l8-8h26l10 8h10v10h-57V88z" fill="#687160"/><path d="M140 80h19l8 7h-32z" fill="#202f2b"/><path d="M128 91h49" stroke="#b3b398" stroke-opacity=".45"/><circle cx="135" cy="97" r="5" fill="#17231d"/><circle cx="170" cy="97" r="5" fill="#17231d"/>
		<path d="M211 91V43h-18" stroke="#17251d" stroke-width="3"/><path d="M192 42h9v4h-9" fill="#d0b571"/><ellipse cx="197" cy="77" rx="29" ry="33" fill="url(#${id}-light)"/>${crate(199, 87, 23, 16)}
		<path d="M3 118l11-14M224 111l8-5M35 98h7" stroke="#a0a286" stroke-opacity=".5"/>
		${route("M20 110Q51 102 75 104T115 107Q152 108 193 100", 20, 110)}`;
}

function depot(id: string): string {
	return `<path d="M0 68V37l27-9 44 9v31M151 70V28h67l22 12v30" fill="#2c3932"/>
		<path d="M154 30h62l17 9h-79z" fill="#646756"/><rect x="156" y="39" width="77" height="34" fill="#454e40"/><path d="M158 47h73M158 55h73M158 63h73" stroke="#78806a" stroke-opacity=".3"/>
		<path d="M28 72V18h101v53M31 26h97M40 19v10M117 19v10" fill="none" stroke="#6c7463" stroke-width="4"/><path d="M35 68l89-45M35 23l89 45" stroke="#39483b" stroke-width="2"/>
		<path d="M0 83l240-11v48H0z" fill="#465044"/><path d="M0 109l240-21M0 118l240-21M0 97l240-21" stroke="#938d71" stroke-width="2"/><path d="M12 102l7 11M30 100l7 11M48 99l7 11M68 97l7 11M91 95l7 11M116 93l7 11M142 91l7 11M170 88l7 11M203 85l7 11M227 83l7 11" stroke="#262e25" stroke-width="4"/>
		<ellipse cx="117" cy="88" rx="94" ry="6" fill="#1d271f" opacity=".7"/>
		<path d="M40 45l8-5h121l8 5v37H40z" fill="url(#${id}-rust)"/><path d="M42 46h134" stroke="#d3a071" stroke-opacity=".6"/><path d="M49 48v30M64 48v30M80 48v30M139 48v30M157 48v30M173 48v30" stroke="#332f23" stroke-width="2"/><rect x="91" y="48" width="36" height="31" fill="#625139"/><path d="M94 49v28M100 49v28M106 49v28M112 49v28M118 49v28M124 49v28" stroke="#94785a" stroke-opacity=".5"/>
		<path d="M42 79h134v5H42" fill="#333e31"/><circle cx="61" cy="86" r="5" fill="#15201a"/><circle cx="77" cy="86" r="5" fill="#15201a"/><circle cx="144" cy="86" r="5" fill="#15201a"/><circle cx="159" cy="86" r="5" fill="#15201a"/><path d="M177 80h12" stroke="#57644e" stroke-width="3"/>
		<path d="M201 86V16M197 22h24M0 36l240-17" stroke="#1b2a20" stroke-width="1.4"/>
		${crate(187, 75, 26, 18)}${crate(212, 88, 19, 14, "#766d4b")}
		<ellipse cx="105" cy="67" rx="40" ry="28" fill="url(#${id}-light)"/>
		${route("M13 115L88 107Q133 104 181 99L217 107", 13, 115)}`;
}

function forest(id: string): string {
	return `<path d="M0 54q36-13 75-5t84-7 81 10v68H0" fill="#354b3b"/>
		${[8, 34, 66, 99, 132, 167, 198, 225].map((x, i) => pine(x, 15 + i % 3 * 6, 62 + i % 2 * 9, "#2f4336")).join("")}
		<path d="M0 78q46-10 77-3t77-7 86 9v43H0" fill="#4f5b44"/><path d="M110 74q27 11 15 21t-32 25h61q-1-16 17-27t-27-23z" fill="#9a8c64"/><path d="M122 78q34 13 12 24" stroke="#b5aa7b" fill="none" opacity=".4"/>
		<path d="M135 58l21-21 30 19z" fill="#393c2e"/><path d="M138 57h42v28h-42" fill="#6c6350"/><path d="M138 62h42M138 67h42M138 72h42M138 77h42M138 82h42" stroke="#394332"/><rect x="163" y="61" width="11" height="15" fill="#ceb37a"/><path d="M169 61v15M163 69h11" stroke="#695638"/><rect x="145" y="64" width="10" height="21" fill="#28372c"/><ellipse cx="171" cy="71" rx="27" ry="21" fill="url(#${id}-light)"/>
		${pine(30, 12, 102, "#1f3529")}${pine(70, 35, 76, "#293e2b")}${pine(217, 9, 111, "#1c3326")}
		<path d="M19 119L28 38M28 52l-9-9M26 68l13-14M23 95l-10-11" stroke="#b3b599" stroke-width="5"/><path d="M22 110h5M24 92h4M26 76h5M27 59h4" stroke="#445645" stroke-width="2"/>
		<path d="M175 103l12-19 13 20z" fill="#6f7754"/><path d="M187 84v20h-10" fill="#303f30"/>${crate(158, 99, 16, 12, "#797254")}
		<path d="M87 91l8 7M98 83l7 4M58 117l11-3M180 117l15-4" stroke="#abb08a" stroke-opacity=".4" stroke-width="2"/>
		${route("M117 112Q148 101 135 86L155 84", 117, 112)}`;
}

function factory(id: string): string {
	return `<path d="M0 58h240v62H0" fill="#34403a"/>
		<path d="M29 49V14h12v35M51 52V8h11v44M208 54V18h10v36" fill="#435047"/><path d="M27 14h16M49 8h15M206 18h14" stroke="#778172" stroke-width="3"/><path d="M56 7q-9-10 5-15M35 14q-11-14 3-25" fill="none" stroke="#7d8470" stroke-opacity=".22" stroke-width="8"/>
		<path d="M6 54V40l59-16h71v58H6" fill="#796550"/><path d="M6 54V40l59-16h71v58H6" fill="url(#${id}-brick)"/>
		<path d="M5 39l59-17h74v5H65L5 44" fill="#a18e6f"/><rect x="72" y="36" width="53" height="23" fill="#b99f70"/><path d="M72 47h53M84 36v23M98 36v23M112 36v23" stroke="#3f493a" stroke-width="2"/>
		<rect x="17" y="56" width="37" height="25" fill="#27382e"/><path d="M17 56h37v5H17" fill="url(#${id}-stripes)"/>
		<path d="M134 76V38h51l23 14v30h-74" fill="#526051"/><path d="M137 40h46l18 11h-64" fill="#8a8a6e"/><path d="M144 54v27M153 54v27M162 54v27M171 54v27M180 54v27M189 54v27M198 54v27" stroke="#20332a" stroke-opacity=".65"/>
		<path d="M12 90h216v30H12" fill="#455044"/><path d="M20 83h199v4H20" fill="#8b8866"/><path d="M25 75v10M59 75v10M93 75v10M127 75v10M161 75v10M195 75v10M25 76h170" stroke="#879075" stroke-width="1.5"/>
		<path d="M106 81V66q0-6 6-6h57q6 0 6-6V20" fill="none" stroke="#28382c" stroke-width="7"/><path d="M106 80V66q0-6 6-6h57q6 0 6-6V20" fill="none" stroke="#7d8170" stroke-width="4"/><path d="M175 28h8M143 56v8M122 56v8" stroke="#b4af8a" stroke-width="2"/>
		<ellipse cx="96" cy="57" rx="38" ry="30" fill="url(#${id}-light)"/>${crate(181, 89, 25, 18, "#747753")}${crate(167, 102, 18, 12, "#625e43")}
		<path d="M224 72v34M216 79h15" stroke="#9c946a" stroke-width="2"/><circle cx="224" cy="71" r="3" fill="#d0b36f"/>
		${route("M20 112L94 101L147 109L171 95", 20, 112)}`;
}

function reserve(id: string): string {
	return `<path d="M0 49q45-10 79-4t78-9 83 8v76H0" fill="#35443b"/>
		<path d="M32 79V46q0-23 51-23t51 23v33" fill="#566356"/><path d="M32 46q0-23 51-23t51 23" fill="none" stroke="#829080" stroke-width="3"/><path d="M42 39v39M56 29v49M72 24v54M88 24v54M104 27v51M120 34v44" stroke="#263d30" stroke-opacity=".5" stroke-width="2"/>
		<rect x="58" y="49" width="54" height="30" fill="#25392f"/><path d="M62 51v27M106 51v27M62 57h44" stroke="#5b715b" stroke-width="1.4"/>
		<path d="M161 94l9-62h22l10 62M169 34l28 40M192 34l-25 40M166 74h32" fill="none" stroke="#72806b" stroke-width="3"/>
		<path d="M159 18l13-7h20l14 7v4h-47z" fill="#79836e"/><rect x="162" y="22" width="39" height="18" fill="#4f6051"/><rect x="168" y="25" width="26" height="10" fill="#b6b38a"/><path d="M181 25v10" stroke="#405641" stroke-width="2"/><path d="M159 40h45v4h-45" fill="#293c30"/>
		<path d="M0 82l240-9v47H0" fill="#4e5946"/><path d="M0 95l240-15" stroke="#202f24" stroke-width="2"/><path d="M10 95V69M36 93V68M143 86V64M216 82V60M5 70l220-11M5 80l220-11" stroke="#8b9273" stroke-width="1"/><path d="M7 70l5-4 6 7 5-8 7 6 5-8 7 6 5-8M147 62l6-6 7 7 6-8 7 6 6-8 7 6 6-8 7 6 6-8" fill="none" stroke="#9ba387" stroke-width=".9"/>
		<path d="M167 32l-57 41 109-1-27-40" fill="url(#${id}-light)" opacity=".7"/>
		${crate(63, 86, 25, 18, "#667454")}${crate(91, 85, 22, 17, "#748061")}${crate(76, 73, 23, 16, "#7e8564")}
		<path d="M150 105q-5-7 5-7h19q8 0 7 7M171 111q-3-6 5-6h18q8 0 6 6M143 112q-4-7 6-7h17q8 0 7 7" fill="#8f8964" stroke="#494f38"/>
		${route("M20 113L45 105L126 112L144 92", 20, 113)}`;
}

function bunker(id: string): string {
	return `<path d="M0 53l23-20 31 7 27-27 30 14 34-11 20 20 37-15 38 35v64H0" fill="#3f4b42"/><path d="M0 62l42-17 23 20 40-32 20 31 28-32 35 31 52-12v69H0" fill="#58604d"/>
		<path d="M48 88V46l20-21h113l20 21v42" fill="#8a8b70"/><path d="M48 46l20-21h113l20 21H48" fill="#a1a08a"/><path d="M53 48h143v40H53" fill="#4b5a4d"/>
		<path d="M65 47l12-12h88l14 12v41H65z" fill="#293e32"/><path d="M74 47l9-7h74l10 7v41H74z" fill="#111f18"/>
		<path d="M94 46h60v42H94" fill="url(#${id}-metal)"/><path d="M95 46h8v42h-8" fill="url(#${id}-stripes)"/><path d="M149 46h5v42h-5" fill="#a7ac91"/><path d="M108 51h35v31h-35z" fill="#3a4b3e" stroke="#7c8b72"/><circle cx="125" cy="66" r="9" fill="#65745e" stroke="#b0af8b" stroke-width="2"/><path d="M125 58v16M117 66h16" stroke="#2d4031" stroke-width="2.5"/>
		<path d="M0 94l240-8v34H0" fill="#414e40"/><path d="M77 88h88l31 32H43z" fill="#7b7c5b"/><path d="M77 88L43 120M165 88l31 32M69 95h103M60 105h122" stroke="#363f2d" stroke-width="1.4"/>
		<path d="M41 113V78h25M192 111V75h-19" fill="none" stroke="#adb190" stroke-width="2"/><path d="M41 86h24M192 83h-19" stroke="#67785d" stroke-width="1.2"/>
		<path d="M53 72V54h10M182 69V49h10" fill="none" stroke="#303e2e" stroke-width="5"/><path d="M53 72V54h10M182 69V49h10" fill="none" stroke="#87917a" stroke-width="2.5"/>
		<rect x="78" y="44" width="11" height="3" fill="#dac584"/><ellipse cx="88" cy="71" rx="30" ry="32" fill="url(#${id}-light)"/><rect x="162" y="51" width="3" height="10" fill="#a8c0af"/><ellipse cx="162" cy="67" rx="22" ry="29" fill="url(#${id}-blue)"/>
		<path d="M5 109l18-10 12 9-6 12H0M211 114l8-16 17 2 7 20h-33" fill="#273a2b"/>
		${route("M111 115L120 99L119 88", 111, 115)}`;
}

const SECTOR_BODIES: Record<string, (id: string) => string> = { courtyard, depot, forest, factory, reserve, bunker };

export function sectorArt(mapId: string, idPrefix = `sector-${mapId}`): string {
	const map = Object.hasOwn(SECTOR_BODIES, mapId) ? mapId : "courtyard";
	const id = prefix(idPrefix);
	return frame(id, SECTOR_LABELS[map]!, SECTOR_BODIES[map]!(id), map === "forest" ? "#485b43" : map === "bunker" ? "#40493e" : "#3b4841");
}

export function roomMiniArt(type: ShelterRoomType, _idPrefix = `room-${type}`): string {
	return pixelRoomArt(type);
}
