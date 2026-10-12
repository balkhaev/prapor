import type { Raid } from "./game/engine";
import type { ModuleSlot } from "./game/modules";
import type { ExpeditionBranch } from "./game/systems";
import type { Supplies } from "./game/data";

export interface RaidFieldPoint { x: number; y: number; z?: number }
export type RaidFieldAction = "move" | "cover" | "search" | "skirmish" | "extract" | "checkpoint";
export type RaidFieldCategory = "supplies" | "workshop" | "medical" | "intel" | "armory";
export interface RaidFieldTheme {
	label: string; ground: number; road: number; wall: number; roof: number; accent: number;
	weather: "rain" | "dust" | "mist" | "ash" | "clear" | "drips";
}
export interface RaidFieldBuilding extends RaidFieldPoint {
	id: string; width: number; height: number; elevation: number;
	kind: "apartments" | "garage" | "warehouse" | "factory" | "hangar" | "bunker" | "cabin" | "trees";
	color: number; roof: number;
}
export interface RaidFieldProp extends RaidFieldPoint {
	id: string; kind: "crate" | "car" | "barrier" | "tree" | "barrel" | "sandbags" | "lamp"; blocking: boolean;
}
export interface RaidFieldLoot extends RaidFieldPoint {
	id: string; label: string; category: RaidFieldCategory; approach: RaidFieldPoint;
}
export interface RaidFieldSegment {
	id: string; kind: Exclude<RaidFieldAction, "checkpoint">; start: number; end: number;
	path: RaidFieldPoint[]; label: string; detail: string; targetId: string | null; enemyPositions: RaidFieldPoint[];
}
export interface RaidFieldPlan {
	id: string; seed: number; mapId: string; theme: RaidFieldTheme; width: number; height: number;
	tiles: { x: number; y: number; kind: "street" | "sidewalk" | "yard"; walkable: boolean }[];
	buildings: RaidFieldBuilding[]; props: RaidFieldProp[]; lootSpots: RaidFieldLoot[];
	entry: RaidFieldPoint; checkpoint: RaidFieldPoint; path: RaidFieldPoint[]; segments: RaidFieldSegment[];
	walkable: boolean[];
}
export interface RaidFieldObservedEvent { id: string; at: number; label: string; text: string; kind: "neutral" | "danger" }
export interface RaidFieldFrame {
	progress: number; position: RaidFieldPoint; direction: RaidFieldPoint; action: RaidFieldAction;
	label: string; detail: string; segmentIndex: number; segmentProgress: number; walking: boolean; paused: boolean;
	enemyPositions: RaidFieldPoint[]; observedEvents: RaidFieldObservedEvent[]; visitedLootIds: string[]; visibleLootIds: string[];
	weatherPhase: number;
}
export interface RaidFieldOutcome {
	moneyMultiplier: number; resourceBonus: Supplies; preferredSlots: ModuleSlot[]; narrative: string;
}

const THEMES: Record<string, RaidFieldTheme> = {
	courtyard: { label: "Панельные дворы", ground: 0x485143, road: 0x66624f, wall: 0x9c9980, roof: 0x626b59, accent: 0xc1b88a, weather: "rain" },
	depot: { label: "Грузовой узел", ground: 0x5b5041, road: 0x777060, wall: 0x986d4d, roof: 0x596354, accent: 0xd1aa71, weather: "dust" },
	forest: { label: "Лесные просеки", ground: 0x354b35, road: 0x837351, wall: 0x806c4b, roof: 0x435d3b, accent: 0xa3c181, weather: "mist" },
	factory: { label: "Промышленный квартал", ground: 0x44453d, road: 0x655f50, wall: 0x997258, roof: 0x59665b, accent: 0xdfa474, weather: "ash" },
	reserve: { label: "Гарнизонные улицы", ground: 0x4a5346, road: 0x727466, wall: 0x8c9378, roof: 0x5c6f55, accent: 0xb8c5a1, weather: "clear" },
	bunker: { label: "Подземные переходы", ground: 0x303d3b, road: 0x536360, wall: 0x7f8d7c, roof: 0x45554d, accent: 0xaad4c4, weather: "drips" },
};
const CATEGORY_LABELS: Record<RaidFieldCategory, string[]> = {
	supplies: ["Служебный фургон", "Дворовый тайник", "Ящики снабжения", "Брошенная разгрузка"],
	workshop: ["Оружейный верстак", "Склад деталей", "Гараж механика", "Ящик инструментов"],
	medical: ["Медицинский пост", "Санитарный ящик", "Аптечный запас"],
	intel: ["Пост связи", "Полевые документы", "Антенный узел", "Карта патрулей"],
	armory: ["Армейские ящики", "Оружейная стойка", "Патронный склад", "Пост охраны"],
};
const clamp = (n: number, low = 0, high = 1) => Math.max(low, Math.min(high, n));
function hash(text: string): number {
	let value = 2166136261;
	for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
	return value >>> 0;
}
function generator(seed: number): () => number {
	let value = seed || 1;
	return () => { value = Math.imul(value, 1664525) + 1013904223 >>> 0; return value / 4294967296; };
}
function fieldIdentity(raid: Raid): string {
	return `${raid.mapId}:${raid.seed >>> 0}:${raid.expedition?.stage ?? 1}:${raid.expedition?.branch ?? "scavenge"}:${raid.tactic}`;
}
const center = (x: number, y: number): RaidFieldPoint => ({ x: x + .5, y: y + .5 });
const distance = (a: RaidFieldPoint, b: RaidFieldPoint) => Math.hypot(b.x - a.x, b.y - a.y);

export function projectRaidFieldPoint(point: RaidFieldPoint, options: { originX?: number; originY?: number; tileWidth?: number; tileHeight?: number; elevationScale?: number } = {}): RaidFieldPoint {
	return { x: (options.originX ?? 420) + (point.x - point.y) * (options.tileWidth ?? 64) / 2,
		y: (options.originY ?? 20) + (point.x + point.y) * (options.tileHeight ?? 32) / 2 - (point.z ?? 0) * (options.elevationScale ?? 26) };
}

export function isRaidFieldWalkable(plan: RaidFieldPlan, point: RaidFieldPoint): boolean {
	const x = Math.floor(point.x), y = Math.floor(point.y);
	return Number.isFinite(point.x) && Number.isFinite(point.y) && x >= 0 && y >= 0 && x < plan.width && y < plan.height && Boolean(plan.walkable[y * plan.width + x]);
}

function nearestWalkable(plan: RaidFieldPlan, point: RaidFieldPoint): RaidFieldPoint {
	if (isRaidFieldWalkable(plan, point)) return center(Math.floor(point.x), Math.floor(point.y));
	let nearest = plan.entry, best = Infinity;
	for (let i = 0; i < plan.walkable.length; i++) if (plan.walkable[i]) {
		const p = center(i % plan.width, Math.floor(i / plan.width)), d = distance(point, p);
		if (d < best) { nearest = p; best = d; }
	}
	return { ...nearest };
}

/** Cardinal street navigation, with building/solid-cover cells excluded. Never cuts corners. */
export function findRaidFieldPath(plan: RaidFieldPlan, from: RaidFieldPoint, to: RaidFieldPoint): RaidFieldPoint[] {
	const a = nearestWalkable(plan, from), b = nearestWalkable(plan, to);
	const start = Math.floor(a.y) * plan.width + Math.floor(a.x), goal = Math.floor(b.y) * plan.width + Math.floor(b.x);
	const queue = [start], previous = new Int32Array(plan.width * plan.height).fill(-1);
	previous[start] = start;
	for (let at = 0; at < queue.length && previous[goal]! < 0; at++) {
		const current = queue[at]!, x = current % plan.width, y = Math.floor(current / plan.width);
		const candidates = (plan.seed & 1) ? [[x + 1, y], [x, y - 1], [x - 1, y], [x, y + 1]] : [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]];
		for (const [nx, ny] of candidates) {
			if (nx! < 0 || ny! < 0 || nx! >= plan.width || ny! >= plan.height) continue;
			const next = ny! * plan.width + nx!;
			if (plan.walkable[next] && previous[next]! < 0) { previous[next] = current; queue.push(next); }
		}
	}
	if (previous[goal]! < 0) return [{ ...a }];
	const result: RaidFieldPoint[] = [];
	for (let current = goal; ; current = previous[current]!) {
		result.push(center(current % plan.width, Math.floor(current / plan.width)));
		if (current === start) break;
	}
	return result.reverse();
}

function buildingKind(mapId: string, random: () => number): RaidFieldBuilding["kind"] {
	switch (mapId) {
		case "depot": return random() < .8 ? "warehouse" : "garage";
		case "forest": return random() < .75 ? "trees" : "cabin";
		case "factory": return random() < .8 ? "factory" : "warehouse";
		case "reserve": return random() < .7 ? "hangar" : "warehouse";
		case "bunker": return "bunker";
		default: return random() < .6 ? "apartments" : "garage";
	}
}
function chooseCategory(mapId: string, branch: ExpeditionBranch, index: number, random: () => number): RaidFieldCategory {
	if (branch === "combat" && index === 0) return "armory";
	if (branch === "recon" && index === 0) return "intel";
	const pools: Record<string, RaidFieldCategory[]> = {
		courtyard: ["supplies", "workshop", "medical"], depot: ["armory", "supplies", "workshop"],
		forest: ["supplies", "medical", "intel"], factory: ["workshop", "armory", "supplies"],
		reserve: ["armory", "intel", "supplies"], bunker: ["intel", "workshop", "medical"],
	};
	const pool = pools[mapId] ?? pools.courtyard!;
	return pool[Math.floor(random() * pool.length)]!;
}

/** Derives the paid expedition's street layout. It neither reads nor consumes simulation RNG. */
export function getRaidFieldPlan(raid: Raid): RaidFieldPlan {
	const identity = fieldIdentity(raid), seed = hash(identity), random = generator(seed);
	const mapId = Object.hasOwn(THEMES, raid.mapId) ? raid.mapId : "courtyard", theme = THEMES[mapId]!;
	const width = 24, height = 20, vertical = [2, 8 + Math.floor(random() * 2), 15, 21], horizontal = [2, 8, 13 + Math.floor(random() * 2), 18];
	const plan: RaidFieldPlan = { id: identity, seed, mapId, theme: { ...theme }, width, height,
		tiles: [], buildings: [], props: [], lootSpots: [], entry: center(2, 18), checkpoint: center(21, 2), path: [], segments: [], walkable: Array(width * height).fill(true) as boolean[] };
	for (let row = 0; row < horizontal.length - 1; row++) for (let col = 0; col < vertical.length - 1; col++) {
		const left = vertical[col]! + 2, top = horizontal[row]! + 2;
		const availableWidth = vertical[col + 1]! - left - 1, availableHeight = horizontal[row + 1]! - top - 1;
		const w = Math.max(1, availableWidth - random() * .8), h = Math.max(1, availableHeight - random() * .7);
		const kind = buildingKind(mapId, random), elevation = kind === "apartments" ? 2.2 + random() * 2.2 : kind === "trees" ? 2.4 + random() * 1.5 : kind === "factory" ? 2 + random() : 1 + random() * 1.4;
		const building: RaidFieldBuilding = { id: `building-${row}-${col}`, x: left + .12, y: top + .12, width: w - .18, height: h - .18, elevation, kind, color: theme.wall, roof: theme.roof };
		plan.buildings.push(building);
		for (let y = Math.floor(building.y); y < Math.ceil(building.y + building.height); y++) for (let x = Math.floor(building.x); x < Math.ceil(building.x + building.width); x++) plan.walkable[y * width + x] = false;
	}
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const d = Math.min(...vertical.map((v) => Math.abs(x - v)), ...horizontal.map((h) => Math.abs(y - h)));
		plan.tiles.push({ x, y, kind: d <= .1 ? "street" : d <= 1.1 ? "sidewalk" : "yard", walkable: plan.walkable[y * width + x]! });
	}
	// Roadside solid cover always leaves the connected center street free.
	for (let i = 0; i < 17; i++) {
		const v = vertical[Math.floor(random() * vertical.length)]!, h = 3 + Math.floor(random() * 14), x = v + (random() < .5 ? -1 : 1), y = h;
		if (!plan.walkable[y * width + x] || horizontal.some((r) => Math.abs(r - y) <= 1) || (x === 2 && y === 18) || (x === 21 && y === 2)) continue;
		const kind: RaidFieldProp["kind"] = mapId === "forest" ? "tree" : mapId === "reserve" ? "sandbags" : mapId === "bunker" ? "barrel" : ["car", "crate", "barrier", "barrel"][i % 4] as RaidFieldProp["kind"];
		plan.props.push({ id: `cover-${i}`, ...center(x, y), kind, blocking: true });
		plan.walkable[y * width + x] = false;
	}
	for (let i = 0; i < 6; i++) plan.props.push({ id: `lamp-${i}`, x: vertical[i % vertical.length]! + .12, y: horizontal[Math.floor(i / 2)]! + .12, kind: "lamp", blocking: false });
	const branch = raid.expedition?.branch ?? "scavenge", count = branch === "scavenge" ? 3 : 2;
	const candidates: RaidFieldPoint[] = [];
	for (let y = 4; y < height - 3; y++) for (let x = 3; x < width - 3; x++) if (plan.walkable[y * width + x] && (vertical.includes(x) || horizontal.includes(y))) candidates.push(center(x, y));
	for (let i = 0; i < count; i++) {
		const candidatesForBand = candidates.filter((p) => p.y >= (count - i - 1) * 4 + 3 && p.y < (count - i) * 4 + 6);
		const pool = candidatesForBand.length ? candidatesForBand : candidates;
		const approach = pool[Math.floor(random() * pool.length)]!, category = chooseCategory(mapId, branch, i, random);
		const labels = CATEGORY_LABELS[category], label = labels[Math.floor(random() * labels.length)]!;
		plan.lootSpots.push({ id: `loot-${i}`, x: approach.x + .3, y: approach.y - .25, label, category, approach: { ...approach } });
	}
	let cursor = plan.entry;
	const weighted: (Omit<RaidFieldSegment, "start" | "end"> & { weight: number })[] = [];
	const add = (kind: RaidFieldSegment["kind"], path: RaidFieldPoint[], weight: number, label: string, detail: string, targetId: string | null = null, enemyPositions: RaidFieldPoint[] = []) => {
		weighted.push({ id: `segment-${weighted.length}`, kind, path, weight, label, detail, targetId, enemyPositions });
	};
	for (let i = 0; i < plan.lootSpots.length; i++) {
		const spot = plan.lootSpots[i]!, path = findRaidFieldPath(plan, cursor, spot.approach);
		const split = path.length > 1 ? Math.max(1, Math.min(path.length - 1, Math.floor(path.length * .58))) : 0, mid = path[split] ?? cursor;
		add("move", path.slice(0, split + 1), Math.max(2, split * .55), i ? "Следующая улица" : "Выход на улицы", `Движение через район «${theme.label}» к точке «${spot.label}».`);
		const enemy = nearestWalkable(plan, { x: mid.x + (random() < .5 ? 2 : -2), y: mid.y - 2 });
		const encounter = branch === "combat" || raid.tactic === "bold" ? "skirmish" : "cover";
		add(encounter, [{ ...mid }], encounter === "skirmish" ? 4 : raid.tactic === "cautious" ? 4.8 : 2.8,
			encounter === "skirmish" ? "Контакт у перекрёстка" : "Наблюдение из укрытия",
			encounter === "skirmish" ? "Боец удерживает позицию. Итог столкновения станет известен на контрольной точке." : "Боец пережидает патруль и проверяет проход; открытый участок ещё впереди.", null, [enemy]);
		add("move", path.slice(split), Math.max(1.5, (path.length - split - 1) * .55), "Переход к объекту", `Подход к точке «${spot.label}» по свободному проходу.`);
		add("search", [{ ...spot.approach }], branch === "scavenge" ? 4.5 : 3.1, `Осмотр: ${spot.label}`, "Осмотр объекта. Добыча будет учтена после достижения контрольной точки.", spot.id);
		cursor = spot.approach;
	}
	const exitPath = findRaidFieldPath(plan, cursor, plan.checkpoint);
	add("extract", exitPath, Math.max(3, exitPath.length * .55), "К точке связи", "Боец следует к защищённому посту. Там можно эвакуироваться с грузом или выбрать следующий маршрут.");
	const total = weighted.reduce((sum, segment) => sum + segment.weight, 0);
	let elapsed = 0;
	plan.segments = weighted.map(({ weight, ...segment }, index) => {
		const start = elapsed / total; elapsed += weight;
		return { ...segment, start, end: index === weighted.length - 1 ? 1 : elapsed / total };
	});
	plan.path = plan.segments.flatMap((segment) => segment.path).filter((p, i, all) => i === 0 || p.x !== all[i - 1]!.x || p.y !== all[i - 1]!.y);
	for (const tile of plan.tiles) tile.walkable = plan.walkable[tile.y * width + tile.x]!;
	return plan;
}

function pointOnPath(path: RaidFieldPoint[], fraction: number): { position: RaidFieldPoint; direction: RaidFieldPoint } {
	if (path.length < 2) return { position: { ...(path[0] ?? { x: 0, y: 0 }) }, direction: { x: 1, y: 0 } };
	let length = 0;
	for (let i = 1; i < path.length; i++) length += distance(path[i - 1]!, path[i]!);
	let remaining = length * clamp(fraction);
	for (let i = 1; i < path.length; i++) {
		const a = path[i - 1]!, b = path[i]!, edge = distance(a, b);
		if (remaining <= edge || i === path.length - 1) {
			const t = edge ? clamp(remaining / edge) : 0;
			return { position: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, direction: { x: b.x - a.x, y: b.y - a.y } };
		}
		remaining -= edge;
	}
	return { position: { ...path[path.length - 1]! }, direction: { x: 1, y: 0 } };
}

/** Reveals only observations whose scheduled time has arrived, never settlement RNG/results. */
export function getRaidFieldFrame(raid: Raid, now: number, suppliedPlan?: RaidFieldPlan): RaidFieldFrame {
	const plan = suppliedPlan?.id === fieldIdentity(raid) ? suppliedPlan : getRaidFieldPlan(raid);
	const waiting = raid.expedition?.status === "choice";
	const duration = Math.max(1, raid.endsAt - raid.startedAt), progress = waiting ? 1 : clamp((Number.isFinite(now) ? now : raid.startedAt) - raid.startedAt, 0, duration) / duration;
	const index = Math.max(0, plan.segments.findIndex((segment) => progress < segment.end));
	const segmentIndex = progress >= 1 ? plan.segments.length - 1 : index, segment = plan.segments[segmentIndex]!;
	const segmentProgress = clamp((progress - segment.start) / Math.max(.0001, segment.end - segment.start));
	const pose = waiting ? { position: { ...plan.checkpoint }, direction: { x: 1, y: 0 } } : pointOnPath(segment.path, segmentProgress);
	if (!waiting && segment.path.length < 2) {
		const target = segment.enemyPositions[0] ?? plan.lootSpots.find((spot) => spot.id === segment.targetId);
		if (target) {
			const span = distance(pose.position, target);
			if (span > .001) pose.direction = { x: (target.x - pose.position.x) / span, y: (target.y - pose.position.y) / span };
		}
	}
	const visitedLootIds = plan.segments.filter((s) => s.kind === "search" && s.end <= progress).map((s) => s.targetId!);
	const observedEvents = plan.segments.filter((s) => s.start <= progress).map((s) => ({ id: `${plan.id}:${s.id}`, at: raid.startedAt + Math.round(s.start * duration), label: s.label, text: s.detail, kind: s.kind === "skirmish" ? "danger" as const : "neutral" as const }));
	return { progress, position: pose.position, direction: pose.direction, action: waiting ? "checkpoint" : segment.kind,
		label: waiting ? "На связи · ждёт приказа" : segment.label, detail: waiting ? "Контрольная точка достигнута. Груз остаётся под риском до эвакуации." : segment.detail,
		segmentIndex, segmentProgress, walking: !waiting && progress < 1 && segment.path.length > 1 && (segment.kind === "move" || segment.kind === "extract"), paused: waiting || progress >= 1,
		enemyPositions: !waiting && progress < 1 && (segment.kind === "cover" || segment.kind === "skirmish") ? segment.enemyPositions.map((p) => ({ ...p })) : [],
		observedEvents, visitedLootIds, visibleLootIds: segment.kind === "search" && segment.targetId && !visitedLootIds.includes(segment.targetId) ? [...visitedLootIds, segment.targetId] : [...visitedLootIds],
		weatherPhase: Math.max(0, (Number.isFinite(now) ? now : raid.startedAt) - raid.startedAt) / 1000,
	};
}

/** Used only when the real checkpoint settles. Modifiers add no RNG draws or success knowledge. */
export function getRaidFieldOutcome(raid: Raid, suppliedPlan?: RaidFieldPlan): RaidFieldOutcome {
	const plan = suppliedPlan?.id === fieldIdentity(raid) ? suppliedPlan : getRaidFieldPlan(raid);
	const categories = plan.lootSpots.map((spot) => spot.category), resourceBonus: Supplies = { ammo: 0, medicine: 0, scrap: 0, intel: 0 };
	const preferredSlots: ModuleSlot[] = [];
	const target = categories[Math.floor(generator(plan.seed ^ 0x52ac193b)() * categories.length)]!;
	switch (target) {
		case "armory": resourceBonus.ammo = 2; preferredSlots.push("barrel", "magazine", "muzzle"); break;
		case "workshop": resourceBonus.scrap = 2; preferredSlots.push("stock", "handguard", "foregrip"); break;
		case "medical": resourceBonus.medicine = 1; break;
		case "intel": resourceBonus.intel = 1; preferredSlots.push("optic"); break;
		case "supplies": resourceBonus.scrap = 1; resourceBonus.ammo = 1; preferredSlots.push("magazine", "stock"); break;
	}
	const moneyMultiplier = .94 + (plan.seed % 15) / 100;
	return { moneyMultiplier, resourceBonus, preferredSlots,
		narrative: `${plan.theme.label}: осмотрены ${plan.lootSpots.map((spot) => `«${spot.label}»`).join(" и ")}. ${raid.expedition?.branch === "combat" || raid.tactic === "bold" ? "Проход через огневой контакт." : "Переходы под прикрытием укрытий."}` };
}
