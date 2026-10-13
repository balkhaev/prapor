import type { Supplies } from "./data";
import type { FieldKit, ShelterLogistics } from "./shelter-logistics";
import type { LootItem } from "./loot";
import type { LootRequirement } from "./loot-uses";

export type ShelterRoomType = "workshop" | "ammo" | "recycler" | "medbay" | "radio" | "storage" | "dormitory" | "hangar";
export interface ShelterCost { money: number; supplies: Supplies }
export interface ProductionJob {
	id: string; kind: "module" | "resource"; recipeId: string; modelId: string | null;
	workDone: number; workRequired: number; paid: ShelterCost;
	output: { supplies: Supplies; moduleModelId: string | null; fieldKit?: FieldKit }; createdAt: number;
	/** Consumed once at payment; these are receipts, not usable inventory. */
	paidLoot?: LootItem[];
}
export interface RoomInstance {
	id: string; type: ShelterRoomType; column: number; row: number; level: number;
	/** Absolute ground coordinates; column/row identify the land lot containing the origin. */
	position?: { x: number; y: number };
	/** Quarter turn; old saves and compact structures default to the original orientation. */
	rotation?: 0 | 1;
	status: "building" | "ready" | "upgrading";
	construction: { workDone: number; workRequired: number; targetLevel: number; cost: { money: number; scrap: number }; paidLoot?: LootItem[] } | null;
	workerIds: string[]; queue: ProductionJob[]; recipeId: string | null; repeat: boolean; pending: boolean; cycles: number;
	stockTarget?: number;
}
export interface ShelterSite { column: number; row: number }
export interface ShelterExpansion extends ShelterSite {
	workDone: number; workRequired: number; cost: { money: number; scrap: number };
}
export interface ShelterState { rooms: RoomInstance[]; sites: ShelterSite[]; expansions: ShelterExpansion[]; logistics?: ShelterLogistics }
export const SHELTER_COLUMNS = 4;
export const SHELTER_ROWS = 3;
export const SHELTER_COORDINATE_LIMIT = 128;
export const SHELTER_POSITION_LIMIT = 30_000;
export const SHELTER_ROOM_CLEARANCE = 8;
export const SHELTER_LAND_ORIGIN = { x: 30, y: 132 } as const;
export const SHELTER_LAND_STRIDE = { x: 192, y: 132 } as const;
/** Keep the opening through the north fence clear; legacy buildings begin at y=148. */
export const SHELTER_GATE_APPROACH = { x: 288, y: 132, width: 60, height: 16 } as const;
export const MAX_SHELTER_SITES = 256;
export const SHELTER_EXCAVATION = { money: 60, scrap: 2, duration: 20 } as const;
type ShelterLayout = { rooms?: readonly RoomInstance[]; sites?: readonly ShelterSite[]; expansions?: readonly ShelterExpansion[] };
const initialSites = (): ShelterSite[] => Array.from({ length: SHELTER_ROWS }, (_, row) =>
	Array.from({ length: SHELTER_COLUMNS }, (_, column) => ({ column, row }))).flat();
export function isShelterSiteCoordinate(column: number, row: number): boolean {
	return Number.isInteger(column) && Number.isInteger(row) && Math.abs(column) <= SHELTER_COORDINATE_LIMIT && row >= 0 && row <= SHELTER_COORDINATE_LIMIT;
}
/** Old saves and presentation snapshots without layout data keep the original foundation. */
export function getShelterSites(shelter: ShelterLayout): readonly ShelterSite[] { return shelter.sites ?? initialSites(); }
/** New territory must adjoin an owned site; the entrance street is never a candidate. */
export function getShelterFrontier(shelter: ShelterLayout): ShelterSite[] {
	const sites = getShelterSites(shelter);
	const reserved = new Set([...sites, ...(shelter.expansions ?? [])].map((site) => `${site.column}:${site.row}`));
	const frontier = new Map<string, ShelterSite>();
	for (const site of sites) for (const [column, row] of [[site.column - 1, site.row], [site.column + 1, site.row], [site.column, site.row - 1], [site.column, site.row + 1]]) {
		if (!isShelterSiteCoordinate(column!, row!)) continue;
		const key = `${column}:${row}`;
		if (!reserved.has(key)) frontier.set(key, { column: column!, row: row! });
	}
	return [...frontier.values()].sort((a, b) => a.row - b.row || a.column - b.column);
}
export const ROOM_DEFINITIONS: Record<ShelterRoomType, {
	label: string; description: string; color: string; cost: { money: number; scrap: number };
	buildSeconds: number; workerSkill: "combat" | "scouting" | "balanced"; production: boolean;
	footprint?: { width: number; height: number }; unlockLevel?: number;
	lootRequirements?: LootRequirement[];
}> = {
	workshop: { label: "Мастерская", description: "Оружейные детали производятся по заказу. Опытные мастера и дополнительные рабочие ускоряют очередь.", color: "#d0a76f", cost: { money: 260, scrap: 10 }, buildSeconds: 90, workerSkill: "balanced", production: true },
	ammo: { label: "Патронный цех", description: "Снаряжает партии патронов из деталей и рублей. Нужны рабочие с боевым опытом.", color: "#b5bd80", cost: { money: 160, scrap: 5 }, buildSeconds: 60, workerSkill: "combat", production: true },
	recycler: { label: "Разборочная", description: "Сортирует утиль в детали. Партия расходует патроны и рубли; силён боец с разносторонним опытом.", color: "#bd997d", cost: { money: 145, scrap: 5 }, buildSeconds: 50, workerSkill: "balanced", production: true },
	medbay: { label: "Медблок", description: "Готовит медикаменты из деталей. Внимательные разведчики работают эффективнее.", color: "#a0bd9b", cost: { money: 200, scrap: 7 }, buildSeconds: 75, workerSkill: "scouting", production: true },
	radio: { label: "Радиорубка", description: "Готовит разведданные за рубли. Нужны наблюдательные бойцы.", color: "#8eafbd", cost: { money: 180, scrap: 6 }, buildSeconds: 70, workerSkill: "scouting", production: true },
	storage: { label: "Склад", description: "Дополнительные места для оружия, деталей и припасов. Рабочие не требуются.", color: "#a2a98a", cost: { money: 220, scrap: 8 }, buildSeconds: 80, workerSkill: "balanced", production: false },
	dormitory: { label: "Жилой блок", description: "Два новых места для отряда на первом уровне, затем ещё по одному. Рабочие не требуются.", color: "#c1ae94", cost: { money: 240, scrap: 8 }, buildSeconds: 90, workerSkill: "balanced", production: false },
	hangar: { label: "Ангар", description: "Просторная постройка, доступная с 4-го уровня. На каждом уровне: +18 мест для оружия, +48 для деталей и дополнительный запас припасов. Рабочие не требуются.", color: "#87a0ad", cost: { money: 900, scrap: 30 }, buildSeconds: 180, workerSkill: "balanced", production: false, footprint: { width: 3, height: 2 }, unlockLevel: 4 },
};
const constructionLoot: Record<ShelterRoomType, [string, number][]> = {
	workshop: [["tool-case", 1], ["pliers", 1]], medbay: [["bandage-roll", 2], ["antiseptic", 1]],
	radio: [["copper-wire", 2], ["battery", 1]], storage: [["duct-tape", 2], ["pliers", 1]],
	dormitory: [["ration", 2], ["coffee", 1]], ammo: [["duct-tape", 1], ["pliers", 1]],
	recycler: [["pliers", 2], ["duct-tape", 1]], hangar: [["precision-tools", 1], ["circuit-board", 1], ["battery", 2]],
};
for (const type of Object.keys(constructionLoot) as ShelterRoomType[]) ROOM_DEFINITIONS[type].lootRequirements = constructionLoot[type].map(([modelId, quantity]) => ({ modelId, quantity }));
export function getRoomFootprint(room: Pick<RoomInstance, "type" | "rotation">): { width: number; height: number } {
	const footprint = ROOM_DEFINITIONS[room.type].footprint ?? { width: 1, height: 1 };
	return room.rotation === 1 ? { width: footprint.height, height: footprint.width } : { ...footprint };
}
type PositionedRoom = Pick<RoomInstance, "column" | "row" | "position">;
type RoomGeometry = PositionedRoom & Pick<RoomInstance, "type" | "rotation">;
export function isShelterRoomPosition(x: number, y: number): boolean {
	return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= SHELTER_POSITION_LIMIT && y >= 0 && y <= SHELTER_POSITION_LIMIT;
}
export function getRoomPosition(room: PositionedRoom): { x: number; y: number } {
	return room.position ? { ...room.position } : { x: 40 + room.column * SHELTER_LAND_STRIDE.x, y: 148 + room.row * SHELTER_LAND_STRIDE.y };
}
export function getRoomPositionSite(x: number, y: number): ShelterSite {
	return { column: Math.floor((x - SHELTER_LAND_ORIGIN.x) / SHELTER_LAND_STRIDE.x), row: Math.floor((y - SHELTER_LAND_ORIGIN.y) / SHELTER_LAND_STRIDE.y) };
}
export function getRoomBounds(room: RoomGeometry): { x: number; y: number; width: number; height: number } {
	const footprint = getRoomFootprint(room);
	return { ...getRoomPosition(room), width: footprint.width * SHELTER_LAND_STRIDE.x - 20, height: footprint.height * SHELTER_LAND_STRIDE.y - 32 };
}
export function shelterBoundsOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }, clearance = 0): boolean {
	return a.x < b.x + b.width + clearance && a.x + a.width + clearance > b.x && a.y < b.y + b.height + clearance && a.y + a.height + clearance > b.y;
}
/** Land intersects the actual ground rectangle; several separated buildings can share a lot. */
export function getRoomSites(room: RoomGeometry): ShelterSite[] {
	const rect = getRoomBounds(room), origin = getRoomPositionSite(rect.x, rect.y);
	const endColumn = Math.ceil((rect.x + rect.width - SHELTER_LAND_ORIGIN.x) / SHELTER_LAND_STRIDE.x) - 1;
	const endRow = Math.ceil((rect.y + rect.height - SHELTER_LAND_ORIGIN.y) / SHELTER_LAND_STRIDE.y) - 1;
	return Array.from({ length: endRow - origin.row + 1 }, (_, row) => Array.from({ length: endColumn - origin.column + 1 }, (_, column) =>
		({ column: origin.column + column, row: origin.row + row }))).flat();
}
/** Hit testing uses the exact building rectangle, never the containing land lot. */
export function getShelterRoomAtPoint(shelter: ShelterLayout, x: number, y: number): RoomInstance | undefined {
	return shelter.rooms?.find(room => { const rect = getRoomBounds(room); return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height; });
}
/** Legacy land lookup returns its first intersecting building; point selection is exact. */
export function getShelterRoomAt(shelter: ShelterLayout, column: number, row: number): RoomInstance | undefined {
	return shelter.rooms?.find(room => getRoomSites(room).some(site => site.column === column && site.row === row));
}
const supplies = (changes: Partial<Supplies> = {}): Supplies => ({ ammo: 0, medicine: 0, scrap: 0, intel: 0, ...changes });
export const RESOURCE_RECIPES: { id: string; roomType: ShelterRoomType; label: string; description: string; durationSeconds: number; cost: ShelterCost; output: Supplies; minLevel?: number; outputKit?: FieldKit; lootRequirements?: LootRequirement[]; releasedIn?: number }[] = [
	{ id: "ammo-batch", roomType: "ammo", label: "Партия патронов", description: "12 патронов из одной детали и 10 ₽.", durationSeconds: 40, cost: { money: 10, supplies: supplies({ scrap: 1 }) }, output: supplies({ ammo: 12 }) },
	{ id: "scrap-batch", roomType: "recycler", label: "Сортировка утиля", description: "6 деталей за 15 ₽ и 2 патрона.", durationSeconds: 55, cost: { money: 15, supplies: supplies({ ammo: 2 }) }, output: supplies({ scrap: 6 }) },
	{ id: "medicine-batch", roomType: "medbay", label: "Медицинские наборы", description: "3 медикамента из 2 деталей и 20 ₽.", durationSeconds: 75, cost: { money: 20, supplies: supplies({ scrap: 2 }) }, output: supplies({ medicine: 3 }) },
	{ id: "intel-batch", roomType: "radio", label: "Сводка разведки", description: "3 разведданных за 25 ₽.", durationSeconds: 65, cost: { money: 25, supplies: supplies() }, output: supplies({ intel: 3 }) },
	{ id: "ammo-careful", roomType: "ammo", minLevel: 2, label: "Экономное снаряжение", description: "18 патронов из 1 детали и 18 ₽. Экономит детали, но требует больше времени.", durationSeconds: 80, cost: { money: 18, supplies: supplies({ scrap: 1 }) }, output: supplies({ ammo: 18 }) },
	{ id: "scrap-precise", roomType: "recycler", minLevel: 2, label: "Точная разборка", description: "8 деталей за 25 ₽, 2 патрона и 1 разведданное. Больше деталей, но разведка нужна и рейдам.", durationSeconds: 90, cost: { money: 25, supplies: supplies({ ammo: 2, intel: 1 }) }, output: supplies({ scrap: 8 }) },
	{ id: "medicine-express", roomType: "medbay", minLevel: 2, label: "Срочная медицина", description: "2 медикамента за 30 ₽, 1 деталь и 2 патрона. Быстрее обычной партии, дороже на единицу.", durationSeconds: 30, cost: { money: 30, supplies: supplies({ scrap: 1, ammo: 2 }) }, output: supplies({ medicine: 2 }) },
	{ id: "intel-analysis", roomType: "radio", minLevel: 2, label: "Анализ находок", description: "4 разведданных за 15 ₽ и 2 детали. Экономит рубли ценой деталей и времени.", durationSeconds: 90, cost: { money: 15, supplies: supplies({ scrap: 2 }) }, output: supplies({ intel: 4 }) },
	{ id: "maintenance-kit", roomType: "workshop", label: "Ремкомплект для рейда", description: "1 ремкомплект за 25 ₽ и 3 детали. Снижает износ оружия на всём выходе.", durationSeconds: 65, cost: { money: 25, supplies: supplies({ scrap: 3 }) }, output: supplies(), outputKit: "maintenance" },
	{ id: "trauma-kit", roomType: "medbay", label: "Травмокомплект для рейда", description: "1 травмокомплект за 20 ₽, 1 медикамент и 2 детали. Смягчает ранения на всём выходе.", durationSeconds: 70, cost: { money: 20, supplies: supplies({ medicine: 1, scrap: 2 }) }, output: supplies(), outputKit: "trauma" },
	{ id: "maintenance-from-loot", roomType: "workshop", label: "Ремкомплект из трофеев", description: "Пассатижи и скотч превращаются в 1 ремкомплект за 8 ₽. Целые трофеи расходуются при запуске и при отмене не возвращаются.", durationSeconds: 55, cost: { money: 8, supplies: supplies() }, output: supplies(), outputKit: "maintenance", lootRequirements: [{ modelId: "pliers", quantity: 1 }, { modelId: "duct-tape", quantity: 1 }] },
	{ id: "trauma-from-loot", roomType: "medbay", label: "Травмокомплект из находок", description: "Бинт и антисептик превращаются в 1 травмокомплект за 5 ₽. Целые трофеи расходуются при запуске и при отмене не возвращаются.", durationSeconds: 60, cost: { money: 5, supplies: supplies() }, output: supplies(), outputKit: "trauma", lootRequirements: [{ modelId: "bandage-roll", quantity: 1 }, { modelId: "antiseptic", quantity: 1 }] },
	{ id: "ammo-from-loot", roomType: "ammo", label: "Патроны из медного кабеля", description: "1 целый кабель и 8 ₽ дают 24 патрона. Трофей расходуется при запуске и при отмене не возвращается.", durationSeconds: 55, cost: { money: 8, supplies: supplies() }, output: supplies({ ammo: 24 }), lootRequirements: [{ modelId: "copper-wire", quantity: 1 }] },
	{ id: "intel-from-loot", roomType: "radio", label: "Расшифровка журнала патрулей", description: "1 целый журнал и 10 ₽ дают 6 разведданных. Трофей расходуется при запуске и при отмене не возвращается.", durationSeconds: 70, cost: { money: 10, supplies: supplies() }, output: supplies({ intel: 6 }), lootRequirements: [{ modelId: "patrol-log", quantity: 1 }] },
	{ id: "ammo-from-powder", roomType: "ammo", releasedIn: 23, label: "Патроны из пороха", description: "Порох, капсюли и 8 ₽ дают 36 патронов. Целые трофеи расходуются при запуске и не возвращаются при отмене.", durationSeconds: 55, cost: { money: 8, supplies: supplies() }, output: supplies({ ammo: 36 }), lootRequirements: [{ modelId: "gunpowder", quantity: 1 }, { modelId: "primer", quantity: 1 }] },
	{ id: "medicine-from-antibiotics", roomType: "medbay", releasedIn: 23, label: "Медицина из аптечных находок", description: "Антибиотики, обезболивающее и 5 ₽ дают 5 медикаментов. Целые трофеи расходуются при запуске и не возвращаются при отмене.", durationSeconds: 75, cost: { money: 5, supplies: supplies() }, output: supplies({ medicine: 5 }), lootRequirements: [{ modelId: "antibiotics", quantity: 1 }, { modelId: "painkillers", quantity: 1 }] },
	{ id: "maintenance-from-sewing", roomType: "workshop", releasedIn: 23, label: "Ремкомплект из крепежа", description: "2 набора крепежа, швейный набор и 8 ₽ дают 1 ремкомплект. Целые трофеи расходуются при запуске и не возвращаются при отмене.", durationSeconds: 60, cost: { money: 8, supplies: supplies() }, output: supplies(), outputKit: "maintenance", lootRequirements: [{ modelId: "screws", quantity: 2 }, { modelId: "sewing-kit", quantity: 1 }] },
];
export const RESOURCE_RECIPE_BY_ID = Object.fromEntries(RESOURCE_RECIPES.map((recipe) => [recipe.id, recipe])) as Record<string, typeof RESOURCE_RECIPES[number]>;
export function initialShelter(base: Record<string, number>): ShelterState {
	return { sites: initialSites(), expansions: [], rooms: ["workshop", "medbay", "radio", "storage"].map((type, column) => ({ id: `room-${type}`, type: type as ShelterRoomType, column, row: 0,
		level: base[type] ?? 1, status: "ready", construction: null, workerIds: [], queue: [], recipeId: null, repeat: false, pending: false, cycles: 0 })) };
}
