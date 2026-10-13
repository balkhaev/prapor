import type { Supplies } from "./data";

export type ShelterRoomType = "workshop" | "ammo" | "recycler" | "medbay" | "radio" | "storage" | "dormitory";
export interface ShelterCost { money: number; supplies: Supplies }
export interface ProductionJob {
	id: string; kind: "module" | "resource"; recipeId: string; modelId: string | null;
	workDone: number; workRequired: number; paid: ShelterCost;
	output: { supplies: Supplies; moduleModelId: string | null }; createdAt: number;
}
export interface RoomInstance {
	id: string; type: ShelterRoomType; column: number; row: number; level: number;
	status: "building" | "ready" | "upgrading";
	construction: { workDone: number; workRequired: number; targetLevel: number; cost: { money: number; scrap: number } } | null;
	workerIds: string[]; queue: ProductionJob[]; recipeId: string | null; repeat: boolean; pending: boolean; cycles: number;
}
export interface ShelterSite { column: number; row: number }
export interface ShelterExpansion extends ShelterSite {
	workDone: number; workRequired: number; cost: { money: number; scrap: number };
}
export interface ShelterState { rooms: RoomInstance[]; sites: ShelterSite[]; expansions: ShelterExpansion[] }
export const SHELTER_COLUMNS = 4;
export const SHELTER_ROWS = 3;
export const SHELTER_COORDINATE_LIMIT = 128;
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
/** Only an outer wall adjoining an already open floor can be excavated; the entrance street is never a candidate. */
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
}> = {
	workshop: { label: "Мастерская", description: "Оружейные детали производятся по заказу. Опытные мастера и дополнительные рабочие ускоряют очередь.", color: "#d0a76f", cost: { money: 260, scrap: 10 }, buildSeconds: 90, workerSkill: "balanced", production: true },
	ammo: { label: "Патронный цех", description: "Снаряжает партии патронов из деталей и рублей. Нужны рабочие с боевым опытом.", color: "#b5bd80", cost: { money: 160, scrap: 5 }, buildSeconds: 60, workerSkill: "combat", production: true },
	recycler: { label: "Разборочная", description: "Сортирует утиль в детали. Партия расходует патроны и рубли; силён боец с разносторонним опытом.", color: "#bd997d", cost: { money: 145, scrap: 5 }, buildSeconds: 50, workerSkill: "balanced", production: true },
	medbay: { label: "Медблок", description: "Готовит медикаменты из деталей. Внимательные разведчики работают эффективнее.", color: "#a0bd9b", cost: { money: 200, scrap: 7 }, buildSeconds: 75, workerSkill: "scouting", production: true },
	radio: { label: "Радиорубка", description: "Готовит разведданные за рубли. Нужны наблюдательные бойцы.", color: "#8eafbd", cost: { money: 180, scrap: 6 }, buildSeconds: 70, workerSkill: "scouting", production: true },
	storage: { label: "Склад", description: "Дополнительные места для оружия, деталей и припасов. Рабочие не требуются.", color: "#a2a98a", cost: { money: 220, scrap: 8 }, buildSeconds: 80, workerSkill: "balanced", production: false },
	dormitory: { label: "Жилой блок", description: "Два новых места для отряда на первом уровне, затем ещё по одному. Рабочие не требуются.", color: "#c1ae94", cost: { money: 240, scrap: 8 }, buildSeconds: 90, workerSkill: "balanced", production: false },
};
const supplies = (changes: Partial<Supplies> = {}): Supplies => ({ ammo: 0, medicine: 0, scrap: 0, intel: 0, ...changes });
export const RESOURCE_RECIPES: { id: string; roomType: ShelterRoomType; label: string; description: string; durationSeconds: number; cost: ShelterCost; output: Supplies }[] = [
	{ id: "ammo-batch", roomType: "ammo", label: "Партия патронов", description: "12 патронов из одной детали и 10 ₽.", durationSeconds: 40, cost: { money: 10, supplies: supplies({ scrap: 1 }) }, output: supplies({ ammo: 12 }) },
	{ id: "scrap-batch", roomType: "recycler", label: "Сортировка утиля", description: "6 деталей за 15 ₽ и 2 патрона.", durationSeconds: 55, cost: { money: 15, supplies: supplies({ ammo: 2 }) }, output: supplies({ scrap: 6 }) },
	{ id: "medicine-batch", roomType: "medbay", label: "Медицинские наборы", description: "3 медикамента из 2 деталей и 20 ₽.", durationSeconds: 75, cost: { money: 20, supplies: supplies({ scrap: 2 }) }, output: supplies({ medicine: 3 }) },
	{ id: "intel-batch", roomType: "radio", label: "Сводка разведки", description: "3 разведданных за 25 ₽.", durationSeconds: 65, cost: { money: 25, supplies: supplies() }, output: supplies({ intel: 3 }) },
];
export const RESOURCE_RECIPE_BY_ID = Object.fromEntries(RESOURCE_RECIPES.map((recipe) => [recipe.id, recipe])) as Record<string, typeof RESOURCE_RECIPES[number]>;
export function initialShelter(base: Record<string, number>): ShelterState {
	return { sites: initialSites(), expansions: [], rooms: ["workshop", "medbay", "radio", "storage"].map((type, column) => ({ id: `room-${type}`, type: type as ShelterRoomType, column, row: 0,
		level: base[type] ?? 1, status: "ready", construction: null, workerIds: [], queue: [], recipeId: null, repeat: false, pending: false, cycles: 0 })) };
}
