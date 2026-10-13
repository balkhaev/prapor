import { MAP_BY_ID, type Supplies } from "./data";
import type { GameState, Scav } from "./engine";

export type RaidObjective = "general" | "ammo" | "medicine" | "scrap" | "intel";
export type RaidPreparation = "none" | "scouted";
export interface RaidPlan { objective: RaidObjective; preparation: RaidPreparation }
export interface SectorIntel { knowledge: number; pressure: number }
/** Paid conditions are frozen for the entire sortie, including its later stages. */
export interface RaidStrategy extends RaidPlan, SectorIntel {}

export const RAID_OBJECTIVES: Record<RaidObjective, {
	label: string; description: string; supply: keyof Supplies | null; resourceBonus: number;
	moneyMultiplier: number; moduleMultiplier: number; chanceBonus: number; durationMultiplier: number;
}> = {
	general: { label: "Свободный поиск", description: "Обычная денежная добыча и поиск оружейных деталей.", supply: null, resourceBonus: 0, moneyMultiplier: 1, moduleMultiplier: 1, chanceBonus: 0, durationMultiplier: 1 },
	ammo: { label: "Боеприпасы", description: "+4 патрона за пройденный этап; шанс −2 п.п. Денег на 25% меньше, шанс каждого оружейного модуля вдвое ниже.", supply: "ammo", resourceBonus: 4, moneyMultiplier: .75, moduleMultiplier: .5, chanceBonus: -.02, durationMultiplier: 1 },
	medicine: { label: "Медицинские запасы", description: "+2 медикамента за пройденный этап; путь на 10% дольше. Денег на 25% меньше, шанс каждого оружейного модуля вдвое ниже.", supply: "medicine", resourceBonus: 2, moneyMultiplier: .75, moduleMultiplier: .5, chanceBonus: 0, durationMultiplier: 1.1 },
	scrap: { label: "Детали для убежища", description: "+3 детали за пройденный этап. Денег на 25% меньше, шанс каждого оружейного модуля вдвое ниже.", supply: "scrap", resourceBonus: 3, moneyMultiplier: .75, moduleMultiplier: .5, chanceBonus: 0, durationMultiplier: 1 },
	intel: { label: "Разведданные", description: "+2 разведданных за пройденный этап; шанс +2 п.п. Успешная эвакуация изучает сектор. Денег на 25% меньше, шанс каждого оружейного модуля вдвое ниже.", supply: "intel", resourceBonus: 2, moneyMultiplier: .75, moduleMultiplier: .5, chanceBonus: .02, durationMultiplier: 1 },
};
export const RAID_PREPARATIONS: Record<RaidPreparation, {
	label: string; description: string; money: number; intel: number; chanceBonus: number; durationMultiplier: number;
}> = {
	none: { label: "Без подготовки", description: "Обычный выход без дополнительного расхода разведданных.", money: 0, intel: 0, chanceBonus: 0, durationMultiplier: 1 },
	scouted: { label: "Разведанный проход", description: "20 ₽ и 2 разведданных за бойца при выходе: шанс +5 п.п., путь на 10% быстрее на всех этапах.", money: 20, intel: 2, chanceBonus: .05, durationMultiplier: .9 },
};
export const SECTOR_KNOWLEDGE_CHANCE = .006;
export const SECTOR_PRESSURE_CHANCE = -.01;

export function getRaidPlan(scav: Pick<Scav, "raidPlan">): RaidPlan {
	const plan = scav.raidPlan;
	return plan && Object.hasOwn(RAID_OBJECTIVES, plan.objective) && Object.hasOwn(RAID_PREPARATIONS, plan.preparation)
		? { objective: plan.objective, preparation: plan.preparation } : { objective: "general", preparation: "none" };
}
/** Missing sectors, including all pre-strategy saves, begin neutral. Never mutates state. */
export function getSectorIntel(state: Pick<GameState, "sectorIntel">, mapId: string): SectorIntel {
	if (!Object.hasOwn(MAP_BY_ID, mapId) || !state.sectorIntel || !Object.hasOwn(state.sectorIntel, mapId)) return { knowledge: 0, pressure: 0 };
	return { ...state.sectorIntel[mapId]! };
}
export function getRaidStrategy(state: Pick<GameState, "sectorIntel">, scav: Pick<Scav, "raidPlan">, mapId: string): RaidStrategy {
	return { ...getRaidPlan(scav), ...getSectorIntel(state, mapId) };
}
export function getRaidStrategyEffects(strategy: RaidStrategy) {
	const objective = RAID_OBJECTIVES[strategy.objective], preparation = RAID_PREPARATIONS[strategy.preparation];
	return { chanceBonus: objective.chanceBonus + preparation.chanceBonus + strategy.knowledge * SECTOR_KNOWLEDGE_CHANCE + strategy.pressure * SECTOR_PRESSURE_CHANCE,
		durationMultiplier: objective.durationMultiplier * preparation.durationMultiplier };
}

function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("strategy-object");
	const source = value as Record<string, unknown>;
	if (Object.keys(source).length !== allowed.length || allowed.some(key => !Object.hasOwn(source, key))) throw new Error("strategy-fields");
	return source;
}
export function parseRaidPlan(value: unknown): RaidPlan {
	const source = object(value, ["objective", "preparation"]);
	if (typeof source.objective !== "string" || !Object.hasOwn(RAID_OBJECTIVES, source.objective)
		|| typeof source.preparation !== "string" || !Object.hasOwn(RAID_PREPARATIONS, source.preparation)) throw new Error("strategy-plan");
	return { objective: source.objective as RaidObjective, preparation: source.preparation as RaidPreparation };
}
export function parseSectorIntel(value: unknown): SectorIntel {
	const source = object(value, ["knowledge", "pressure"]);
	if (!Number.isInteger(source.knowledge) || (source.knowledge as number) < 0 || (source.knowledge as number) > 5
		|| !Number.isInteger(source.pressure) || (source.pressure as number) < 0 || (source.pressure as number) > 6) throw new Error("strategy-sector");
	return { knowledge: source.knowledge as number, pressure: source.pressure as number };
}
export function parseRaidStrategy(value: unknown): RaidStrategy {
	const source = object(value, ["objective", "preparation", "knowledge", "pressure"]);
	return { ...parseRaidPlan({ objective: source.objective, preparation: source.preparation }), ...parseSectorIntel({ knowledge: source.knowledge, pressure: source.pressure }) };
}
export function parseSectorIntelRecord(value: unknown): Record<string, SectorIntel> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("strategy-sectors");
	const result: Record<string, SectorIntel> = {};
	for (const [mapId, entry] of Object.entries(value)) {
		if (!Object.hasOwn(MAP_BY_ID, mapId)) throw new Error("strategy-map");
		result[mapId] = parseSectorIntel(entry);
	}
	return result;
}

/** One physical sortie moves the sector, regardless of how many members it has. */
export function settleSectorIntel(state: Pick<GameState, "sectorIntel">, mapId: string, learned: boolean, deep: boolean): SectorIntel {
	const sectors = state.sectorIntel ??= {};
	for (const other of Object.keys(sectors)) if (other !== mapId) sectors[other]!.pressure = Math.max(0, sectors[other]!.pressure - 1);
	const current = getSectorIntel(state, mapId);
	const next = { knowledge: Math.min(5, current.knowledge + (learned ? 1 : 0)), pressure: Math.min(6, current.pressure + (deep ? 2 : 1)) };
	sectors[mapId] = next;
	return { ...next };
}
