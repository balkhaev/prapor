import { CATEGORY_LABELS, type WeaponCategory } from "./game/data";
import { scavAppearance } from "./scav-isometric";
import { pixelPortraitUrl } from './pixel-portrait';

const escapeAttribute = (value: string) =>
	value.replace(/[&<>"']/g, (character) => ({
		"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
	})[character]!);

const screw = (x: number, y: number, radius = 1.7) =>
	`<circle cx="${x}" cy="${y}" r="${radius}" fill="#abb2a4" stroke="#212923" stroke-width=".8"/><path d="m${x - radius * .5} ${y + radius * .5} ${radius} -${radius}" stroke="#38423a" stroke-width=".7"/>`;

const slots = (x: number, y: number, count: number, spacing = 7, height = 6) =>
	Array.from({ length: count }, (_, index) => `<rect x="${x + index * spacing}" y="${y}" width="3" height="${height}" rx="1" fill="#17211b"/>`).join("");

const woodGrain = (x: number, y: number, width: number) =>
	`<path d="M${x} ${y}q${width * .25} -2 ${width * .5} 0t${width * .5} 0m-${width} 4q${width * .3} 3 ${width * .65} 0t${width * .35} 0" fill="none" stroke="#d0a576" stroke-width=".8" opacity=".35"/>`;

/** Inventory illustrations share a material palette, with a distinct profile for each class. */
export function gunArt(category: WeaponCategory, color: string): string {
	const accent = escapeAttribute(color);
	let illustration: string;
	switch (category) {
		case "pistol":
			illustration = `<g transform="translate(65 -2)">
				<path d="M32 46h112l11 5v8H37l-7-5z" fill="#69766c"/>
				<path d="M34 45h104l11 4H36z" fill="#a9b3a7"/>
				<path d="M139 49h22v8h-22" fill="#303b33"/><path d="M158 51h5v4h-5" fill="#111a15"/>
				<path d="M35 59h97l-11 11H90l-5 29H58l5-30H44z" fill="#303c33"/>
				<path d="m67 65 23 2-7 28H60z" fill="#7b6450"/>
				<path d="m68 68 18 1-6 23H64z" fill="#9f8060"/>
				<path d="m67 72 16 1m-17 3 16 1m-17 3 16 1m-17 3 16 1m-17 3 16 1" stroke="#604c3b" stroke-width="1.2"/>
				<path d="M93 67h23q5 0 3 7l-4 9H88l1-6h21l3-6H92z" fill="#667268"/>
				<path d="m97 68-2 8h6l2-8" fill="#acb3a2"/>
				<path d="M40 48h17v7H40z" fill="#414e43"/>${slots(43, 49, 4, 4, 5)}
				<path d="M66 48h63v2H66z" fill="${accent}" opacity=".5"/>
				<path d="M42 41h8v5h-8m88-4h5v4h-5" fill="#727e6d"/>
				<path d="M66 98h20v3H64z" fill="#151e18"/>
				${screw(72, 75)}${screw(70, 88)}
			</g>`;
			break;
		case "smg":
			illustration = `<g>
				<path d="M18 45h63v5H23v34h-5z" fill="#708074"/>
				<path d="M20 50 83 58v4L20 78" fill="none" stroke="#4d5f50" stroke-width="4"/>
				<path d="M77 40h108l8 8v16H80z" fill="#59675b"/>
				<path d="M80 40h102l7 7H80z" fill="#89968a"/>
				<path d="M188 49h63v8h-63z" fill="#59695c"/>
				<path d="M244 45h29v16h-29z" fill="#38483b"/>
				<path d="M248 46h20v2h-20m-80-6h71v2h-71" fill="#a8b2a3" opacity=".65"/>
				<path d="M258 42h5v7h-5M93 34h8v7h-8" fill="#84927f"/>
				<path d="M84 64h31l-7 34H87z" fill="#27372b"/>
				<path d="m89 67 20 1-5 25H90z" fill="#465640"/>
				<path d="M119 64h14v13h-20v-5h13v-8" fill="#8e9a84"/>
				<path d="m148 63 20 1 4 39-19 1z" fill="#536151"/>
				<path d="m153 66 12 1 3 32h-11z" fill="#737f69"/>
				<path d="m158 71 2 23m4-23 2 23" stroke="#303e30" stroke-width="1.5"/>
				<path d="M168 101h8v5h-25v-5z" fill="#273728"/>
				<path d="M139 45h36v12h-36z" fill="#29392f"/>
				<path d="M138 51h16l8-4h16v3h-15l-8 4h-17z" fill="#a0ac98"/>
				<path d="M85 59h26v2H85" fill="${accent}" opacity=".75"/>
				${slots(185, 49, 7, 7, 5)}${screw(89, 47)}${screw(120, 59)}${screw(181, 59)}
			</g>`;
			break;
		case "shotgun":
			illustration = `<g>
				<path d="m17 62 66-15h22v15H81L31 88H15z" fill="#99744b"/>
				<path d="m20 63 64-13h15v4H81L23 76z" fill="#c29765"/>
				<path d="M14 67h5l2 21h-7z" fill="#25352a"/>
				${woodGrain(34, 65, 40)}
				<path d="M90 42h75v20H91z" fill="#5a685c"/>
				<path d="M93 42h68v4H93z" fill="#a2ae9c"/>
				<path d="M162 44h111v6H162z" fill="#697b69"/>
				<path d="M163 52h94v5h-94z" fill="#344737"/>
				<path d="M270 41h5v10h-5m-2-2h8v2h-8" fill="#a2ad91"/>
				<path d="M172 50h49v15h-49z" fill="#997147"/>
				<path d="M173 51h47v3h-47z" fill="#c19a65"/>
				${slots(178, 55, 6, 7, 9)}
				<path d="m99 62 23-1-5 10h-12L95 86H82z" fill="#8a6543"/>
				<path d="M119 62h30q3 0 2 5l-2 10h-29l-2-5h24l2-6h-25z" fill="#7a8873"/>
				<path d="M125 62v8h4l2-8" fill="#bcc4aa"/>
				<path d="M131 46h25v11h-25z" fill="#263c2d"/>
				<path d="m137 49 17-1v4l-17 1" fill="#9da98c"/>
				<path d="M98 37h7v6h-7M110 57h9v2h-9" fill="${accent}" opacity=".7"/>
				${screw(100, 48)}${screw(159, 59)}
			</g>`;
			break;
		case "rifle":
			illustration = `<g>
				<path d="m18 57 48-12h27v14H70L28 80H15z" fill="#967246"/>
				<path d="m19 57 47-9h24v5H69L21 70z" fill="#be935e"/>
				<path d="M14 60h5l2 21h-7z" fill="#29392c"/>
				${woodGrain(30, 59, 35)}
				<path d="M86 39h97v24H86z" fill="#4f6251"/>
				<path d="M91 36h79l12 4H88z" fill="#81917a"/>
				<path d="M183 45h91v7h-91z" fill="#647860"/>
				<path d="M252 42h26v12h-26z" fill="#364c38"/>
				<path d="M190 34h52v6h-52z" fill="#637357"/>
				<path d="M236 34h8v11h-8M170 34h15v7h-15" fill="#455b41"/>
				<path d="M177 46h56v17h-56z" fill="#9f7544"/>
				<path d="M181 44h42l9 5h-51z" fill="#c3965e"/>
				${woodGrain(182, 55, 46)}${slots(184, 46, 6, 7, 4)}
				<path d="m102 64 19-1-6 31H96z" fill="#674f36"/>
				<path d="m103 67 13-1-5 24H99z" fill="#9d764a"/>
				<path d="M124 63h18v11h-21l1-4h15v-7" fill="#8fa084"/>
				<path d="m145 62 23 1q1 21 14 31l-16 12q-23-13-21-44" fill="#354e35"/>
				<path d="m151 65 12 1q1 19 11 27l-8 6q-13-11-15-34" fill="#708162"/>
				<path d="m155 73 3 14 7 10m-1-23 2 10 5 8" fill="none" stroke="#293e2c" stroke-width="1.7"/>
				<path d="M114 43h49v12h-49z" fill="#273e2d"/>
				<path d="M150 49h16v4h-16l-5 4h-5l7-8" fill="#a8b497"/>
				<path d="M94 57h17v2H94" fill="${accent}" opacity=".8"/>
				<path d="M99 32h6v7h-6M260 34h5v9h-5" fill="#819674"/>
				${screw(97, 45)}${screw(170, 58)}
			</g>`;
			break;
		case "sniper":
			illustration = `<g>
				<path d="m15 60 72-8h83l52 6-1 10h-82l-14-5H89L25 89H13z" fill="#6e7a53"/>
				<path d="m18 60 69-5h78l45 6v3h-73l-13-5H88L18 78z" fill="#a1a87b"/>
				<path d="M12 66h6l1 24h-7z" fill="#263d2d"/>
				<path d="m36 67 38-7-26 17-12 2z" fill="#314733"/>
				<path d="M89 43h87v13H89z" fill="#465f47"/>
				<path d="M93 43h79v3H93z" fill="#9bad8f"/>
				<path d="M173 45h97v5h-97z" fill="#7c8c6b"/>
				<path d="M264 41h23v12h-23z" fill="#38523a"/>
				<path d="M268 42h18v2h-18z" fill="#99a585"/>
				${slots(271, 46, 3, 5, 4)}
				<path d="M108 32h67v8h-67z" fill="#617556"/>
				<path d="M103 29h13v13h-13m54-15h23v17h-23" fill="#314d35"/>
				<path d="M108 29h7v3h-7m52-5h17v3h-17m-52 4h30v2h-30" fill="#a2b48c" opacity=".7"/>
				<path d="M125 39h5v7h-5m27-7h5v7h-5" fill="#acb596"/>
				<path d="M140 26h9v8h-9m1-9h7v2h-7" fill="#799366"/>
				<path d="m109 63 18 1-5 28h-14z" fill="#506144"/>
				<path d="M132 63h26v13h-29l1-5h22v-8" fill="#8e9e79"/>
				<path d="m162 67 22 1v20h-20z" fill="#405f3e"/>
				<path d="M166 71h14v13h-14z" fill="#718466"/>
				<path d="m225 58-3 22-14 20m14-20 12 20" fill="none" stroke="#6b8061" stroke-width="3"/>
				<path d="M205 100h7m20 0h7" stroke="#a5b694" stroke-width="2"/>
				<path d="M147 48h19v3h-19l-5 9h-5l7-12" fill="#b8c2a1"/>
				<path d="M91 57h17v2H91" fill="${accent}" opacity=".75"/>
				${screw(97, 49)}${screw(193, 64)}
			</g>`;
			break;
	}
	return `<svg class="gun-art" viewBox="0 0 300 116" role="img" aria-label="${CATEGORY_LABELS[category]} · боковой вид"><ellipse cx="150" cy="103" rx="115" ry="5" fill="#0a130b" opacity=".4"/><g stroke="#142319" stroke-width="1.2" stroke-linejoin="round">${illustration}</g></svg>`;
}

/** Roster portraits use the same character's native head and shoulder crop. */
export function scavPortrait(personality: string, name: string, appearance?: number): string {
	const identity = scavAppearance(personality, 0, appearance);
	const label = escapeAttribute(name);
	return `<span class="scav-portrait" data-appearance="${identity}" role="img" aria-label="Портрет дикого ${label}" style="display:block;width:100%;height:100%;border-radius:inherit;background-image:url(&quot;${escapeAttribute(pixelPortraitUrl(identity))}&quot;);background-size:cover;background-position:center;image-rendering:pixelated"></span>`;
}
