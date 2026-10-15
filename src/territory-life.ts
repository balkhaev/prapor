import { isScavAppearance } from "./game/scav-appearances";
import { SCAV_DIRECTIONS, scavAttachment, scavFrame, type ScavDirection, type ScavPose } from "./scav-isometric";
import { projectShelterPoint } from "./shelter-isometric";
import type { ShelterPoint } from "./shelter-motion";
import { getShelterActivityPose } from "./shelter-activity";
import type { ShelterRoutineActivity, ShelterRoutineCargo } from "./shelter-routines";
import type { ScavVisualLoadout } from './scav-loadout';
import { PixelActorArt } from './pixel-actors';
import { PIXEL_ACTOR_FRAMES, pixelActorTimedFrame } from './pixel-actor-config';
import type { PixelActorFrame } from './pixel-animation';
import { pixelWeaponSignature, type PixelWeaponInput } from './pixel-weapons';

/** A view of the existing shelter actor, never a second roster or route simulation. */
export interface ShelterPersonView {
	id: string;
	name: string;
	point: ShelterPoint;
	direction: ScavDirection;
	walking: boolean;
	working: boolean;
	walkPhase: number;
	activity: string;
	label: string;
	role: string;
	appearance?: number;
	health?: number;
	cargo?: ShelterRoutineCargo;
	elapsedMs?: number;
	activityPhase?: number;
	visualLoadout?: ScavVisualLoadout;
	pixelFrame?: PixelActorFrame;
}
export interface TerritoryLifeBounds { x: number; y: number; width: number; height: number }
export interface TerritoryLifeOptions {
	getHost: () => HTMLElement | null;
	getPeople: () => readonly ShelterPersonView[];
	reducedMotion?: boolean;
}
export interface TerritoryLifeController { refresh(): void; destroy(): void }
interface AtlasFrame {
	frame: { x: number; y: number; w: number; h: number };
	spriteSourceSize: { x: number; y: number; w: number; h: number };
}
export interface TerritoryPersonAtlas {
	frames: Record<string, AtlasFrame>;
	meta: { size: { w: number; h: number }; characterHeight?: number; feet?: { x: number; y: number } };
}
interface PersonNode {
	button: HTMLButtonElement;
	body: HTMLSpanElement;
	sprite: HTMLCanvasElement;
	prop: HTMLSpanElement;
	label: HTMLSpanElement;
	spriteKey: string;
	propKey: string;
}
const FRAME_INTERVAL = 1000 / 12;
const FIGURE_SCALE = .78;
const BODY_HEIGHT = 48 * FIGURE_SCALE;
const svg = (content: string) => `<svg viewBox="-24 -52 48 60" aria-hidden="true">${content}</svg>`;
const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;

/** The same projected feet and painter depth as the live scene, including free fractional positions. */
export function getTerritoryPersonPlacement(point: ShelterPoint, bounds: TerritoryLifeBounds, buildingDepths: readonly number[]) {
	if (![point.x, point.y, bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return null;
	const projected = projectShelterPoint(point);
	return {
		left: (projected.x - bounds.x) / bounds.width * 100,
		top: (projected.y - bounds.y) / bounds.height * 100,
		depth: projected.y,
		zIndex: 15 + buildingDepths.filter(depth => Number.isFinite(depth) && depth <= projected.y).length * 10,
	};
}

/** Atlas trimming is removed against its shared feet anchor; changing poses cannot move the person. */
export function getTerritoryPersonSprite(atlas: TerritoryPersonAtlas, pose: ScavPose, direction: ScavDirection, height = BODY_HEIGHT) {
	const frame = atlas.frames[scavFrame(pose, direction)], sheet = atlas.meta.size;
	if (!frame || !Number.isFinite(height) || height <= 0) return null;
	const { frame: crop, spriteSourceSize: source } = frame;
	const feet = atlas.meta.feet ?? { x: 256, y: 480 }, characterHeight = atlas.meta.characterHeight ?? 360;
	if (![crop.x, crop.y, crop.w, crop.h, source.x, source.y, sheet.w, sheet.h, feet.x, feet.y, characterHeight].every(Number.isFinite)
		|| crop.w <= 0 || crop.h <= 0 || sheet.w <= 0 || sheet.h <= 0 || characterHeight <= 0
		|| crop.x < 0 || crop.y < 0 || crop.x + crop.w > sheet.w || crop.y + crop.h > sheet.h) return null;
	const scale = height / characterHeight;
	return {
		x: (source.x - feet.x) * scale, y: (source.y - feet.y) * scale,
		width: crop.w * scale, height: crop.h * scale,
		sheetWidth: sheet.w * scale, sheetHeight: sheet.h * scale,
		cropX: -crop.x * scale, cropY: -crop.y * scale,
	};
}

/** Actual distance-driven stride chooses a pose; stationary work takes precedence over a stale walk flag. */
export function getTerritoryPersonPose(person: Pick<ShelterPersonView, "walking" | "working" | "walkPhase"> & { activity?: string }, reducedMotion = false): ScavPose {
	if (!person.walking && (person.working || ["carry", "sweep", "maintain"].includes(person.activity ?? ""))) return "work";
	if (!person.walking || reducedMotion) return "idle";
	return Math.sin(finite(person.walkPhase) * Math.PI * 2) >= 0 ? "walk-b" : "walk-a";
}

function activityProp(person: ShelterPersonView): string {
	const attachment = scavAttachment(person.direction, person.working), right = person.direction.endsWith("e") ? 1 : -1;
	const prop = person.working ? person.role : person.walking ? /carry|suppl|haul/.test(person.activity) ? "carry" : "" : person.activity;
	let content = "";
	if (prop === "warm" || prop === "rest" || prop === "chat") content = '<path d="M-3-4h6v6h-6Z" fill="#c3c2a7" stroke="#e3d5b5" stroke-width=".8"/><path d="M3-3h2v3H3" fill="none" stroke="#c3c2a7" stroke-width="1.2"/>';
	else if (prop === "lookout") content = '<rect x="-4" y="-9" width="8" height="5" rx="1" fill="#25382b" stroke="#a0ab89" stroke-width=".8"/><path d="M-2-10v6m4-6v6" stroke="#c1c6a9" stroke-width="1.5"/>';
	else if (prop === "inspect") content = '<path d="M-4-5h7v9h-7Z" fill="#a99771" stroke="#dfc7a1" stroke-width=".7"/><path d="M-2-2h4m-4 2h3" stroke="#5e6247" stroke-width=".8"/>';
	else if (prop === "carry" && person.cargo === "firewood") content = '<g transform="rotate(-12)"><path d="M-8-3h15m-14 3h15m-16 3h15" stroke="#b79868" stroke-width="3.4"/><path d="M-3-5v11m6-11v11" stroke="#5c5940" stroke-width="1.3"/><path d="M-8-3v.3m1 2.7v.3m-1 2.7v.3" stroke="#e0c29c" stroke-width="2"/></g>';
	else if (prop === "carry" || prop === "ammo") content = '<path d="M-7-5l7-3 7 4v9L0 8-7 4Z" fill="#8f8158" stroke="#c6ae7b" stroke-width=".8"/><path d="M0-8v16m-7-13l7 4 7-3" stroke="#594f38" stroke-width="1"/>';
	else if (prop === "medbay") content = '<rect x="-5" y="-4" width="10" height="8" rx="1" fill="#ddcdab" stroke="#777f67"/><path d="M-2 0h4m-2-2v4" stroke="#935d47" stroke-width="1.5"/>';
	else if (prop === "radio") content = '<rect x="-3" y="-7" width="6" height="10" rx="1" fill="#304c37" stroke="#9baa7c" stroke-width=".8"/><path d="M1-7v-5" stroke="#c5cfac" stroke-width="1"/><circle cy="-2" r="1.2" fill="#dccb91"/>';
	else if (["construction", "recycler", "maintain"].includes(prop)) content = '<path d="M-4 6l6-12" stroke="#aa8a59" stroke-width="2"/><path d="M-1-7l6 3" stroke="#a1afa0" stroke-width="4" stroke-linecap="square"/>';
	else if (prop === "sweep") content = '<path d="M-4-8l7 27" stroke="#baaa76" stroke-width="1.7"/><path d="M0 14l-2 8h10l-2-9Z" fill="#aa9260" stroke="#d0b575" stroke-width=".8"/><path d="M1 15v6m2-6 1 6m1-7 1 7" stroke="#6b6a45" stroke-width=".8"/>';
	else if (prop === "workshop") content = '<path d="M-4 5l7-11m-2-2l2 2 3-1" stroke="#c4cbb1" stroke-width="2" fill="none" stroke-linecap="round"/>';
	if (!content) return "";
	const y = prop === "lookout" ? -29 : attachment.y;
	return svg(`<g transform="translate(${attachment.x} ${y}) scale(${right} 1)">${content}</g>`);
}

function observedActivity(person: ShelterPersonView, reducedMotion: boolean) {
	const activities: readonly string[] = ["rest", "warm", "inspect", "lookout", "chat", "stroll", "carry", "sweep", "maintain"];
	return getShelterActivityPose({
		activity: activities.includes(person.activity) ? person.activity as ShelterRoutineActivity : null,
		elapsedMs: finite(person.elapsedMs ?? 0), phase: finite(person.activityPhase ?? 0), walking: person.walking,
		facing: person.direction.endsWith("e") ? 1 : -1, cargo: person.cargo, reducedMotion,
	});
}

function boundsFor(host: HTMLElement): TerritoryLifeBounds | null {
	const bounds = { x: Number(host.dataset.planOriginX), y: Number(host.dataset.planOriginY), width: Number(host.dataset.planWidth), height: Number(host.dataset.planHeight) };
	return Object.values(bounds).every(Number.isFinite) && bounds.width > 0 && bounds.height > 0 ? bounds : null;
}

/** Small incremental DOM actor layer; all motion and jobs are observed from the existing world. */
export function createTerritoryLife(options: TerritoryLifeOptions): TerritoryLifeController {
	let host: HTMLElement | null = null, bounds: TerritoryLifeBounds | null = null;
	let buildingDepths: number[] = [], frame = 0, paintedAt = -Infinity, destroyed = false, intersecting = true;
	const people = new Map<string, PersonNode>(), art = new PixelActorArt();
	const emptyWeapon: PixelWeaponInput = { weaponId: 'pm', modules: {}, durability: 100 };
	const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; };
	const visible = () => {
		if (!host?.isConnected || document.hidden || !intersecting) return false;
		for (let parent: HTMLElement | null = host; parent; parent = parent.parentElement) {
			if (parent.hidden || parent instanceof HTMLDetailsElement && !parent.open) return false;
		}
		const box = host.getBoundingClientRect();
		return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth;
	};
	const createPerson = (person: ShelterPersonView): PersonNode => {
		const button = document.createElement("button"); button.className = "territory-person"; button.type = "button"; button.dataset.scav = person.id;
		const body = document.createElement("span"); body.className = "territory-person-body"; body.setAttribute("aria-hidden", "true");
		const shadow = document.createElement("span"); shadow.className = "territory-person-shadow"; shadow.innerHTML = svg('<ellipse cx="2" cy="2" rx="11" ry="3.4" fill="#112c22" opacity=".45"/>');
		const sprite = document.createElement("canvas"); sprite.className = "territory-person-sprite";
		const prop = document.createElement("span"); prop.className = "territory-person-prop";
		const label = document.createElement("span"); label.className = "territory-person-label"; label.setAttribute("aria-hidden", "true");
		body.append(shadow, sprite, prop); button.append(body, label); host!.append(button);
		return { button, body, sprite, prop, label, spriteKey: '', propKey: "" };
	};
	const paint = () => {
		if (!host || !bounds || !visible()) return;
		const scale = host.getBoundingClientRect().width / bounds.width, seen = new Set<string>();
		for (const person of options.getPeople()) {
			const placement = getTerritoryPersonPlacement(person.point, bounds, buildingDepths);
			if (!placement || !person.id || seen.has(person.id)) continue;
			seen.add(person.id);
			const appearance = isScavAppearance(person.appearance) ? person.appearance : 0;
			let node = people.get(person.id);
			if (!node) { node = createPerson(person); people.set(person.id, node); }
			const { button, body, sprite, prop, label } = node;
			button.style.left = `${placement.left}%`; button.style.top = `${placement.top}%`; button.style.zIndex = String(placement.zIndex);
			button.style.setProperty("--person-scale", String(scale));
			button.dataset.activity = person.activity; button.dataset.walking = String(person.walking); button.dataset.working = String(person.working);
			const caption = `${person.name} · ${person.label}`;
			if (button.title !== caption) { button.title = caption; button.setAttribute("aria-label", `Личное дело: ${caption}`); label.textContent = caption; }
			const direction = SCAV_DIRECTIONS.includes(person.direction) ? person.direction : "se";
			const animation: PixelActorFrame = person.pixelFrame ?? { mode: person.walking ? 'walk' : 'idle', facing: direction,
				frame: person.walking ? Math.floor(finite(person.walkPhase) * PIXEL_ACTOR_FRAMES.walk) % PIXEL_ACTOR_FRAMES.walk : pixelActorTimedFrame('idle', performance.now() + appearance * 173) };
			const pose = options.reducedMotion ? { ...animation, frame: 0 } : animation;
			const loadout = person.visualLoadout, weapon = person.working ? emptyWeapon : loadout?.weapon ?? emptyWeapon;
			const gear = { profile: 'light' as const, armor: Boolean(loadout?.armorModelId), helmet: Boolean(loadout?.helmetModelId), backpack: Boolean(loadout?.packModelId) };
			const spriteKey = `${appearance}:${JSON.stringify(pose)}:${pixelWeaponSignature(weapon)}:${JSON.stringify(gear)}`;
			if (node.spriteKey !== spriteKey) {
				const image = art.get({ appearance, faction: 'scavs' }, pose, weapon, gear), scale = BODY_HEIGHT / 160;
				sprite.width = image.image.width; sprite.height = image.image.height;
				const context = sprite.getContext('2d'); if (context) { context.imageSmoothingEnabled = false; context.drawImage(image.image, 0, 0); }
				sprite.style.width = `${sprite.width * scale}px`; sprite.style.height = `${sprite.height * scale}px`;
				sprite.style.left = `${-image.anchor.x * scale}px`; sprite.style.top = `${-image.anchor.y * scale}px`;
				sprite.style.imageRendering = 'pixelated'; node.spriteKey = spriteKey;
			}
			const activityPose = observedActivity(person, Boolean(options.reducedMotion));
			body.style.setProperty("--person-bob", `${activityPose.bodyLift * FIGURE_SCALE}px`); body.style.setProperty("--person-lean", `${activityPose.bodyTilt}deg`);
			const attachment = scavAttachment(direction, person.working);
			prop.style.transformOrigin = `${24 + attachment.x * FIGURE_SCALE}px ${52 + attachment.y * FIGURE_SCALE}px`;
			prop.style.transform = `translate(${activityPose.toolX * FIGURE_SCALE}px,${activityPose.toolY * FIGURE_SCALE}px) rotate(${activityPose.toolAngle}deg)`;
			const propKey = `${direction}:${person.activity}:${person.role}:${person.walking}:${person.working}:${person.cargo ?? ""}`;
			if (node.propKey !== propKey) { prop.innerHTML = activityProp({ ...person, direction }); node.propKey = propKey; }
		}
		for (const [id, node] of people) if (!seen.has(id)) { node.button.remove(); people.delete(id); }
	};
	const animate = (at: number) => {
		frame = 0;
		if (destroyed || !visible()) return;
		if (at - paintedAt >= FRAME_INTERVAL) { paintedAt = at; paint(); }
		frame = requestAnimationFrame(animate);
	};
	const intersection = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
		intersecting = Boolean(entries.find(entry => entry.target === host)?.isIntersecting);
		refresh();
	});
	const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => refresh());
	const refresh = () => {
		if (destroyed) return;
		const next = options.getHost();
		if (next !== host) {
			stop(); intersection?.disconnect(); resize?.disconnect();
			for (const node of people.values()) node.button.remove(); people.clear();
			host = next; bounds = next ? boundsFor(next) : null; intersecting = true;
			buildingDepths = next ? [...next.querySelectorAll<HTMLElement>("[data-plan-building-depth]")].map(building => Number(building.dataset.planBuildingDepth)).filter(Number.isFinite) : [];
			if (next) { intersection?.observe(next); resize?.observe(next); }
		}
		if (!visible()) { stop(); return; }
		paint(); paintedAt = performance.now();
		if (!frame) frame = requestAnimationFrame(animate);
	};
	const mutations = new MutationObserver(() => { if (options.getHost() !== host) refresh(); });
	mutations.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
	document.addEventListener("visibilitychange", refresh); document.addEventListener("toggle", refresh, true);
	// Scrolling can bring a previously hidden plan into view even without IntersectionObserver.
	window.addEventListener("scroll", refresh, true);
	refresh();
	return {
		refresh,
		destroy() {
			if (destroyed) return;
			destroyed = true; stop(); mutations.disconnect(); intersection?.disconnect(); resize?.disconnect();
			document.removeEventListener("visibilitychange", refresh); document.removeEventListener("toggle", refresh, true); window.removeEventListener("scroll", refresh, true);
			art.clear();
			for (const node of people.values()) node.button.remove(); people.clear(); host = null;
		},
	};
}
