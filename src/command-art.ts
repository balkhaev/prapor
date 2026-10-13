import type { ShelterRoomType } from "./game/shelter";

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

function roomShell(id: string, content: string, tint: string): string {
	return `<rect x="9" y="10" width="222" height="104" rx="3" fill="#101d18"/>
		<path d="M14 15h212v73H14" fill="url(#${id}-wall)"/><rect x="14" y="15" width="212" height="73" fill="${tint}" opacity=".17"/>
		<path d="M14 17h212v7H14" fill="#1b2b23"/><path d="M14 30h212M14 59h212M55 24v64M107 24v64M160 24v64M212 24v64" stroke="#7c836a" stroke-opacity=".2" stroke-width=".8"/>
		<path d="M14 88h212l5 20H9z" fill="#505c48"/><path d="M20 92h200M17 101h206M65 88l-5 20M120 88v20M175 88l5 20" stroke="#25382b" stroke-width="1"/>
		<path d="M15 20h211M20 24v20h11" fill="none" stroke="#727e68" stroke-width="2"/><path d="M37 23h23v3H37M183 23h23v3h-23" fill="#dfc58b"/><ellipse cx="50" cy="58" rx="39" ry="39" fill="url(#${id}-light)"/><ellipse cx="194" cy="58" rx="39" ry="39" fill="url(#${id}-light)"/>
		${content}<path d="M11 10v102M229 10v102M11 112h218" fill="none" stroke="#83907a" stroke-width="3"/><path d="M11 11h218" stroke="#b1b49a" stroke-width="3"/>`;
}

function roomContent(type: ShelterRoomType, id: string): string {
	switch (type) {
		case "workshop":
			return `<rect x="43" y="36" width="101" height="32" rx="2" fill="#273b2d" stroke="#879579"/><path d="M48 44h88M48 51h88M48 59h88" stroke="#4c5d43" stroke-dasharray="2 5"/><path d="M54 41v17l5 3M77 40v18M77 40h7M99 41l-6 10M116 40v18l6 4" fill="none" stroke="#b4b194" stroke-width="2"/>
				<path d="M31 75h150v7H31" fill="#b29b6a"/><path d="M34 81h144v7H34" fill="#354931"/><path d="M38 81v18M174 81v18" stroke="#263d2a" stroke-width="5"/>
				<path d="M61 70h46v-3h32v5h-25l-7 7H91l-2-6H71l-10 5z" fill="#24382a"/><path d="M78 68h17v5H78" fill="#8e7550"/><rect x="146" y="65" width="19" height="10" fill="#4c6150" stroke="#a8b495"/><path d="M153 62v8M160 62v8" stroke="#9fa88b" stroke-width="2"/>
				<rect x="189" y="45" width="25" height="42" fill="url(#${id}-metal)"/><path d="M195 52h13v5h-13M195 64h13v5h-13M195 76h13v5h-13" fill="#172c20"/><circle cx="200" cy="53" r="1.7" fill="#d1b878"/>`;
		case "ammo":
			return `<path d="M38 80h131v7H38M43 87v13M165 87v13" fill="none" stroke="#929274" stroke-width="5"/>
				<path d="M61 39h24v7H61M69 44v29h8V44M59 73h28v7H59" fill="#7e8f72" stroke="#273e2d" stroke-width="1.5"/><path d="M78 47l18-14M94 30l6 8" stroke="#c6b182" stroke-width="3"/><path d="M105 39h24v7h-24M113 44v29h8V44M103 73h28v7h-28" fill="#7e8f72" stroke="#273e2d" stroke-width="1.5"/><path d="M122 47l18-14M138 30l6 8" stroke="#c6b182" stroke-width="3"/>
				<path d="M46 71v8M52 71v8M58 71v8M138 71v8M144 71v8M150 71v8" stroke="#d0af67" stroke-width="3"/>
				${crate(177, 73, 29, 19, "#8a8157")}${crate(181, 56, 24, 17, "#807951")}<path d="M188 61h11M188 65h11" stroke="#b5a96f"/><path d="M158 43h-16v8h16z" fill="#455e42" stroke="#a3ac87"/>`;
		case "recycler":
			return `<path d="M44 39h65l-12 18v29H57V57z" fill="url(#${id}-metal)" stroke="#9ca68b"/><path d="M54 48h44l-8 10H64z" fill="#243c29"/><rect x="58" y="69" width="40" height="7" fill="url(#${id}-stripes)"/><circle cx="75" cy="63" r="4" fill="#9ca583"/><path d="M57 86v12M97 86v12" stroke="#223c29" stroke-width="5"/>
				<path d="M99 79h51l21-15h28v8h-24l-22 15H99" fill="#364f36" stroke="#7b8f6c" stroke-width="2"/><path d="M108 81h7M124 81h7M143 81h7M161 75l6-4M181 68h7" stroke="#a1aa82" stroke-width="2"/>
				<path d="M151 37h39v21h-39" fill="#2c4230" stroke="#7e8f70"/><circle cx="162" cy="48" r="4" fill="#a8b477"/><circle cx="178" cy="48" r="4" fill="#b49a6d"/>
				<path d="M44 99l-9-11 6-6 12 6M24 87l6-13 12 5M178 97l10-13 10 8 7-7 8 15" fill="#737961" stroke="#a0a589"/>`;
		case "medbay":
			return `<rect x="39" y="34" width="31" height="42" rx="2" fill="#a5b3a1" stroke="#546b54"/><rect x="45" y="40" width="18" height="24" fill="#526d58"/><path d="M49 45h10M49 52h10M49 59h10" stroke="#a1b09a"/><path d="M51 68h7M45 76v13M65 76v13" stroke="#758b70" stroke-width="2"/>
				<path d="M83 75h105v11H83" fill="#c1c2a5"/><path d="M83 78h30v8H83" fill="#ddd5b5"/><path d="M113 77h69v10h-69" fill="#74947d"/><path d="M85 68v28M187 68v28M85 91h102" stroke="#9eaf94" stroke-width="3"/>
				<rect x="154" y="32" width="40" height="27" rx="2" fill="#49634b" stroke="#849f7c"/><path d="M174 37v17M166 45h17" stroke="#c0c8ab" stroke-width="5"/>
				<path d="M205 44v53M200 44h10M203 49h5v12h-5" stroke="#bec6ad" stroke-width="2" fill="#89a18e"/><path d="M206 61q-13 10-18 20" fill="none" stroke="#7ea390" stroke-width="1"/>`;
		case "radio":
			return `<path d="M37 79h173v7H37M42 86v13M205 86v13" stroke="#8c9e87" stroke-width="4" fill="#465f47"/>
				<rect x="48" y="42" width="48" height="34" rx="3" fill="#2a4436" stroke="#819d85"/><rect x="54" y="47" width="34" height="22" rx="2" fill="#829f84"/><path d="M57 59h7l4-8 5 14 4-9 5 3h4" fill="none" stroke="#d0d6aa" stroke-width="1.4"/><rect x="104" y="44" width="28" height="31" fill="url(#${id}-metal)"/><path d="M109 51h17M109 55h17M109 59h17" stroke="#1b3727"/><circle cx="113" cy="67" r="3" fill="#b4c0a2"/><circle cx="125" cy="67" r="3" fill="#b4c0a2"/>
				<rect x="153" y="35" width="48" height="32" fill="#3f5e47" stroke="#8ea38b"/><path d="M159 59l8-16 12 13 7-12 9 14M157 45h36M174 39v24" fill="none" stroke="#a8b790" stroke-width=".8"/><path d="M149 74h33" stroke="#c2c5a7" stroke-width="3"/>
				<path d="M71 40V28h72v12M138 39h11" fill="none" stroke="#78907b" stroke-width="1.5"/><ellipse cx="70" cy="57" rx="31" ry="25" fill="url(#${id}-blue)"/><path d="M116 82v11h16v-11M120 93v10M128 93v10" fill="#283f30" stroke="#809374" stroke-width="2"/>`;
		case "storage":
			return `<path d="M35 35v64M95 35v64M143 35v64M204 35v64M35 39h60M35 64h60M35 90h60M143 39h61M143 64h61M143 90h61" stroke="#8d9d80" stroke-width="3"/>
				${crate(40, 48, 21, 13, "#8a865c")}${crate(66, 47, 22, 14, "#667b59")}${crate(41, 72, 43, 15, "#7b7855")}${crate(149, 47, 20, 14, "#789165")}${crate(175, 47, 22, 14, "#888360")}${crate(149, 72, 43, 15, "#6c825d")}
				<path d="M111 45v47M107 49h8M107 56h8M107 63h8M107 70h8M107 77h8M107 84h8" stroke="#9b9f7c" stroke-width="2"/>${crate(107, 93, 25, 13, "#8c835c")}`;
		case "dormitory":
			return `<path d="M33 38v61M92 38v61M33 47h59M33 81h59" stroke="#8f9b80" stroke-width="3"/><path d="M36 40h53v7H36M36 74h53v7H36" fill="#aaa88a"/><path d="M48 41h41v7H48M48 75h41v7H48" fill="#697d66"/><path d="M97 40v57M108 40v57M97 49h11M97 61h11M97 73h11M97 85h11" stroke="#8d9a7c" stroke-width="2"/>
				<path d="M156 39v60M215 39v60M156 47h59M156 81h59" stroke="#8f9b80" stroke-width="3"/><path d="M159 40h53v7h-53M159 74h53v7h-53" fill="#aaa88a"/><path d="M172 41h40v7h-40M172 75h40v7h-40" fill="#75826a"/>
				<rect x="119" y="59" width="25" height="34" fill="#5b7054" stroke="#9aaa87"/><path d="M131 62v29" stroke="#314e35"/><circle cx="128" cy="77" r="1.3" fill="#c7c8a4"/><circle cx="135" cy="77" r="1.3" fill="#c7c8a4"/><path d="M126 50h12v8h-12" fill="#c3b37a"/><ellipse cx="132" cy="48" rx="22" ry="17" fill="url(#${id}-light)"/>`;
		case "hangar":
			return `<path d="M25 95V48q0-26 95-26t95 26v47" fill="#2c403b" stroke="#8b9d98" stroke-width="3"/><path d="M32 47q0-18 88-18t88 18M52 36v54M88 30v60M125 29v61M162 32v58M198 39v51" fill="none" stroke="#667f77" stroke-width="2"/>
				<path d="M37 49v42M93 49v42M37 52h56M37 71h56M37 91h56M153 49v42M208 49v42M153 52h55M153 71h55M153 91h55" stroke="#9aab91" stroke-width="3"/>
				${crate(42, 56, 20, 12)}${crate(67, 56, 20, 12, "#8b8060")}${crate(42, 76, 44, 12)}${crate(158, 56, 20, 12, "#8b8060")}${crate(183, 56, 19, 12)}${crate(158, 76, 43, 12, "#74765b")}
				<path d="M101 89h34v12h-34zM130 77h5v25h-5M134 99h16v3h-16" fill="#b5a16b" stroke="#3d4c3e"/><path d="M104 87V72h18v17M104 73h18" fill="none" stroke="#7e9484" stroke-width="2"/><circle cx="107" cy="101" r="4" fill="#17281f"/><circle cx="130" cy="101" r="4" fill="#17281f"/><path d="M100 108h51" stroke="#d5bd7e" stroke-width="2" stroke-dasharray="6 4"/>`;
	}
}

const ROOM_ART: Record<ShelterRoomType, { label: string; tint: string }> = {
	workshop: { label: "Оружейная мастерская: верстак, инструменты и станок", tint: "#bba26c" },
	ammo: { label: "Патронный цех: снаряжательные прессы и коробки патронов", tint: "#b1b881" },
	recycler: { label: "Разборочная: дробилка, конвейер и сортировка деталей", tint: "#9c9970" },
	medbay: { label: "Медблок: лечебная койка и медицинское оборудование", tint: "#94b7a1" },
	radio: { label: "Радиорубка: радиостанция, зелёный монитор и карта", tint: "#82aaa4" },
	storage: { label: "Склад: металлические стеллажи и ящики с припасами", tint: "#9ca678" },
	dormitory: { label: "Жилой блок: двухъярусные кровати и шкафчики", tint: "#b4a88b" },
	hangar: { label: "Ангар: просторные складские ряды и погрузчик", tint: "#87a0ad" },
};

export function roomMiniArt(type: ShelterRoomType, idPrefix = `room-${type}`): string {
	const id = prefix(idPrefix);
	const room = ROOM_ART[type];
	return frame(id, room.label, roomShell(id, roomContent(type, id), room.tint), "#263c2d");
}
