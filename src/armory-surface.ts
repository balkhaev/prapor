/** Shared physical finishes for loose parts, the workbench and carried weapons. */
export type ArmoryMaterial = "steel" | "dark" | "wood" | "polymer" | "rubber" | "glass" | "carbon";
export type ArmoryPaint = Record<ArmoryMaterial, string> & { prefix: string };

const materials: readonly ArmoryMaterial[] = ["steel", "dark", "wood", "polymer", "rubber", "glass", "carbon"];
const safeId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120) || "armory";
const xml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const number = (value: number) => Number(value.toFixed(2));

/** Muted, directional finishes: machined steel, phosphate, moulded polymer and oiled wood. */
export function createArmorySurface(prefix: string): { paint: ArmoryPaint; defs: string } {
	prefix = safeId(prefix);
	const paint = Object.fromEntries(materials.map((material) => [material, `url(#${prefix}-${material})`])) as Omit<ArmoryPaint, "prefix">;
	return { paint: { ...paint, prefix }, defs: `<defs>
		<linearGradient id="${prefix}-steel" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#888d8b"/><stop offset=".1" stop-color="#b2b4ad"/><stop offset=".23" stop-color="#646b69"/><stop offset=".6" stop-color="#464e4d"/><stop offset=".88" stop-color="#303736"/><stop offset="1" stop-color="#232a29"/></linearGradient>
		<linearGradient id="${prefix}-dark" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#525754"/><stop offset=".18" stop-color="#3c4240"/><stop offset=".66" stop-color="#2c3331"/><stop offset="1" stop-color="#1b2220"/></linearGradient>
		<linearGradient id="${prefix}-wood" x1="0" y1="0" x2=".08" y2="1"><stop stop-color="#987551"/><stop offset=".2" stop-color="#876749"/><stop offset=".6" stop-color="#6b4f39"/><stop offset="1" stop-color="#48342a"/></linearGradient>
		<linearGradient id="${prefix}-polymer" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#606056"/><stop offset=".18" stop-color="#4c5148"/><stop offset=".7" stop-color="#353d34"/><stop offset="1" stop-color="#252d26"/></linearGradient>
		<linearGradient id="${prefix}-rubber" x1="0" y1="0" x2=".12" y2="1"><stop stop-color="#41453f"/><stop offset=".35" stop-color="#30352f"/><stop offset="1" stop-color="#1c231d"/></linearGradient>
		<linearGradient id="${prefix}-glass" x1="0" y1="0" x2="1" y2=".3"><stop stop-color="#a6b8b3"/><stop offset=".18" stop-color="#6d8980"/><stop offset=".56" stop-color="#3e5d55"/><stop offset="1" stop-color="#263d35"/></linearGradient>
		<pattern id="${prefix}-carbon" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(32)"><rect width="7" height="7" fill="#292f2e"/><path d="M0 .6h7M0 4.1h7" stroke="#444b48" stroke-width="1.4"/><path d="M0 1.8h7M0 5.3h7" stroke="#1f2625" stroke-width=".7"/><path d="M1 0v3M4.5 3.5V7" stroke="#65706a" stroke-width=".5" opacity=".4"/></pattern>
		<pattern id="${prefix}-steel-surface" width="67" height="29" patternUnits="userSpaceOnUse"><path d="M2 4h24M33 18h18M12 26h35" stroke="#c0c7c2" stroke-width=".35"/><path d="M3 5h23M37 19h18" stroke="#141d1a" stroke-width=".3"/></pattern>
		<pattern id="${prefix}-dark-surface" width="39" height="31" patternUnits="userSpaceOnUse"><path d="M6 7h1M27 23h1M33 9h1M13 28h1" stroke="#a1aaa2" stroke-width=".65"/><path d="M16 13h1M4 25h1" stroke="#101715" stroke-width=".65"/></pattern>
		<pattern id="${prefix}-polymer-surface" width="23" height="19" patternUnits="userSpaceOnUse"><path d="M4 5h1M15 13h1M20 3h1" stroke="#a8aa9b" stroke-width=".6"/><path d="M8 14h1M17 6h1" stroke="#182019" stroke-width=".6"/></pattern>
		<pattern id="${prefix}-rubber-surface" width="19" height="17" patternUnits="userSpaceOnUse"><path d="M3 3h1M12 11h1" stroke="#83907e" stroke-width=".7"/><path d="M7 13h1M16 5h1" stroke="#101910" stroke-width=".7"/></pattern>
		<pattern id="${prefix}-wood-surface" width="143" height="37" patternUnits="userSpaceOnUse"><path d="M-3 7q27-3 53 0t53 0t53 0M-9 23q39 4 71 0t71 0" fill="none" stroke="#b19673" stroke-width=".55"/><path d="M-4 10q30-3 55 0t55 0t55 0M6 31q28-3 56 0t56 0" fill="none" stroke="#39281f" stroke-width=".55"/></pattern>
		<linearGradient id="${prefix}-surface-light" x1="0" y1="0" x2=".12" y2="1"><stop stop-color="#dce7e1" stop-opacity=".16"/><stop offset=".2" stop-color="#dce7e1" stop-opacity=".025"/><stop offset=".44" stop-color="#091113" stop-opacity="0"/><stop offset=".76" stop-color="#091113" stop-opacity=".08"/><stop offset="1" stop-color="#091113" stop-opacity=".3"/></linearGradient>
	</defs>` };
}

export type ArmorySurfaceOptions = {
	prefix: string;
	slot: string;
	material: ArmoryMaterial;
	outline: string;
	/** Local, untransformed geometry bounds. Placement belongs to the calling renderer. */
	bounds: readonly [number, number, number, number];
	fillRule?: "evenodd" | "nonzero";
	durability?: number;
	/** Physical part identity, rather than its inventory instance or render location. */
	seed?: string;
};

// The marks are repeatable across frames. Nothing samples a clock or random source.
function hash(value: string): number {
	let result = 2166136261;
	for (let index = 0; index < value.length; index++) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
	return result >>> 0;
}

/** Fine finish and condition wear clipped to the solid shape, preserving cut-outs. */
export function surfaceDetail({ prefix, slot, material, outline, bounds, fillRule = "evenodd", durability = 100, seed }: ArmorySurfaceOptions): string {
	const [x, y, width, height] = bounds;
	if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || !outline) return "";
	prefix = safeId(prefix);
	// A current gun and its candidate preview can share an inventory ID in one
	// document. Only identical local outlines may safely share a clipping mask.
	const clip = `${prefix}-${safeId(slot)}-surface-clip-${hash(`${fillRule}/${outline}`).toString(36)}`;
	const condition = Number.isFinite(durability) ? Math.max(0, Math.min(100, durability)) : 0;
	const wear = (100 - condition) / 100;
	const metallic = material === "steel" || material === "dark";
	const initial = hash(seed ?? `${slot}/${material}/${width}/${height}`);
	const marks = Array.from({ length: wear > .4 ? 5 : 3 }, (_, index) => {
		const bits = hash(`${initial}/${index}`);
		const px = x + width * (.12 + (bits % 71) / 100);
		const py = y + height * (.12 + ((bits >>> 8) % 71) / 100);
		const length = Math.min(width * .11, 5 + ((bits >>> 16) % 11));
		return `M${number(px)} ${number(py)}l${number(length)} ${number(-Math.min(1.8, height * .03))}`;
	}).join("");
	const clipping = `clip-path="url(#${clip})"`;
	const texture = material === "carbon" || material === "glass" ? "" : `<path d="${xml(outline)}" fill="url(#${prefix}-${material}-surface)" opacity="${material === "wood" ? ".33" : ".18"}" fill-rule="${fillRule}"/>`;
	const scuffOpacity = metallic ? .045 + wear * .34 : .025 + wear * .2;
	const edgeOpacity = metallic ? .14 + wear * .25 : .07 + wear * .13;
	// The same soft light shapes bitmap paint and native materials without
	// brightening openings or blurring the installed mechanical detail.
	const lighting = material === "glass" ? "" : `<path data-surface-light="${xml(material)}" d="${xml(outline)}" fill="url(#${prefix}-surface-light)" opacity="${material === "rubber" ? ".5" : ".85"}" fill-rule="${fillRule}"/>`;
	const dust = wear > .1 ? `<path d="M${number(x + width * .1)} ${number(y + height * .88)}q${number(width * .2)} ${number(height * .04)} ${number(width * .42)} 0t${number(width * .4)} 0" ${clipping} fill="none" stroke="#988b72" stroke-width="${number(Math.min(2, height * .045))}" opacity="${(wear * .12).toFixed(2)}"/>` : "";
	return `<defs><clipPath id="${clip}"><path d="${xml(outline)}" fill-rule="${fillRule}" clip-rule="${fillRule}"/></clipPath></defs>${lighting}${texture}<path d="${xml(outline)}" ${clipping} fill="none" stroke="${metallic ? "#b3b9b2" : "#a69f88"}" stroke-width=".8" opacity="${edgeOpacity.toFixed(2)}"/><path d="${marks}" ${clipping} fill="none" stroke="${metallic ? "#bdc2b7" : "#b4ab94"}" stroke-width="${metallic ? ".65" : ".55"}" opacity="${scuffOpacity.toFixed(2)}"/>${dust}`;
}
