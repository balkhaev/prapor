import { SCAV_NAMES } from "./data";
import type { GameState, Scav } from "./engine";

export type RecruitRole = "assault" | "scout" | "technician";
export type RecruitTier = 0 | 1 | 2;
export interface ScavProfileEffects {
	chance: number; loot: number; duration: number; ammo: number; capacity: number; work: number;
}
export interface ScavProfile {
	backgroundId: string | null; traitId: string | null; drawbackId: string | null;
	talents: string[]; candidateId: string | null;
}
export interface RecruitCandidate {
	id: string; name: string; role: RecruitRole; backgroundId: string; traitId: string; drawbackId: string;
	combat: number; scouting: number; cost: number;
}
export interface RecruitmentState {
	rng: number; generation: number; tier: RecruitTier; boardSeed: number; boardTier: RecruitTier;
	board: RecruitCandidate[];
	/** Only this board's three consumed offers. Older boards cannot reappear. */
	hiredCandidateIds: string[];
}
export interface ScavModifierDefinition {
	id: string; label: string; description: string; effects: Partial<ScavProfileEffects>;
}
export interface ScavTalentDefinition extends ScavModifierDefinition { role: RecruitRole | "any" }

export const RECRUIT_ROLES: Record<RecruitRole, { id: RecruitRole; label: string; description: string; accent: string }> = {
	assault: { id: "assault", label: "Стрелок", description: "Держит контакт и прикрывает отход.", accent: "#d7a779" },
	scout: { id: "scout", label: "Разведчик", description: "Ищет короткие пути и тащит находки.", accent: "#8bbf9d" },
	technician: { id: "technician", label: "Техник", description: "Полезен за станком и на поиске деталей.", accent: "#81b4c9" },
};
export const RECRUIT_BACKGROUNDS: Record<string, { id: string; label: string; description: string; role: RecruitRole; tier: RecruitTier }> = {
	yard_guard: { id: "yard_guard", label: "Дворовый сторож", description: "Знает, как удержать проход между гаражами.", role: "assault", tier: 0 },
	bike_courier: { id: "bike_courier", label: "Курьер", description: "Весь район прошёл дворами, не по карте.", role: "scout", tier: 0 },
	garage_hand: { id: "garage_hand", label: "Гаражный мастер", description: "Из двух сломанных вещей собирает одну рабочую.", role: "technician", tier: 0 },
	checkpoint_guard: { id: "checkpoint_guard", label: "Охранник блокпоста", description: "Прикрывал смены у городского кордона.", role: "assault", tier: 1 },
	smuggler: { id: "smuggler", label: "Проводник", description: "Помнит проходы между новыми секторами.", role: "scout", tier: 1 },
	armorer: { id: "armorer", label: "Оружейник", description: "Отличает годный модуль ещё до разборки.", role: "technician", tier: 1 },
	contract_fighter: { id: "contract_fighter", label: "Контрактник", description: "Вернулся из горячих районов и ищет свой отряд.", role: "assault", tier: 2 },
	deep_runner: { id: "deep_runner", label: "Рейдер глубины", description: "Доходил до дальних улиц и выбирался с грузом.", role: "scout", tier: 2 },
	plant_engineer: { id: "plant_engineer", label: "Заводской инженер", description: "Поднимал производство под обстрелом.", role: "technician", tier: 2 },
};
export const RECRUIT_TRAITS: Record<string, ScavModifierDefinition> = {
	steady_hands: { id: "steady_hands", label: "Твёрдая рука", description: "+3 п.п. к шансу пройти этап рейда.", effects: { chance: 0.03 } },
	short_bursts: { id: "short_bursts", label: "Короткие очереди", description: "На 12% меньше расход патронов; округление вверх.", effects: { ammo: 0.88 } },
	pack_rat: { id: "pack_rat", label: "Запасливый", description: "+3 единицы вместимости груза в рейде.", effects: { capacity: 3 } },
	fleet_foot: { id: "fleet_foot", label: "Лёгкий шаг", description: "Этапы рейда на 10% короче.", effects: { duration: 0.9 } },
	bench_craft: { id: "bench_craft", label: "Умелые руки", description: "Личный вклад в производство на 22% выше.", effects: { work: 1.22 } },
	part_picker: { id: "part_picker", label: "Глаз на детали", description: "+12% к множителю добычи в новых рейдах.", effects: { loot: 0.12 } },
};
export const RECRUIT_DRAWBACKS: Record<string, ScavModifierDefinition> = {
	heavy_boots: { id: "heavy_boots", label: "Тяжёлый шаг", description: "Этапы рейда на 10% дольше.", effects: { duration: 1.1 } },
	rough_hands: { id: "rough_hands", label: "Грубая работа", description: "Личный вклад в производство на 10% ниже.", effects: { work: 0.9 } },
	timid: { id: "timid", label: "Нервничает в контакте", description: "−2,5 п.п. к шансу пройти этап рейда.", effects: { chance: -0.025 } },
	wasteful: { id: "wasteful", label: "Стреляет с запасом", description: "На 15% больше расход патронов; округление вверх.", effects: { ammo: 1.15 } },
	slow_step: { id: "slow_step", label: "Не любит спешить", description: "Этапы рейда на 12% дольше.", effects: { duration: 1.12 } },
	light_pack: { id: "light_pack", label: "Маленький рюкзак", description: "−2 единицы вместимости груза в рейде.", effects: { capacity: -2 } },
};
export const SCAV_TALENTS: Record<string, ScavTalentDefinition> = {
	composure: { id: "composure", label: "Хладнокровие", description: "+2 п.п. к шансу пройти этап рейда.", role: "any", effects: { chance: 0.02 } },
	resourceful: { id: "resourceful", label: "Хозяйственный", description: "+8% к множителю добычи в новых рейдах.", role: "any", effects: { loot: 0.08 } },
	practiced: { id: "practiced", label: "Набитая рука", description: "Личный вклад в производство на 12% выше.", role: "any", effects: { work: 1.12 } },
	streetwise: { id: "streetwise", label: "Знание дворов", description: "Этапы рейда на 6% короче.", role: "any", effects: { duration: 0.94 } },
	quick_sort: { id: "quick_sort", label: "Компактная укладка", description: "+1 единица вместимости груза в рейде.", role: "any", effects: { capacity: 1 } },
	frugal_load: { id: "frugal_load", label: "Бережливый стрелок", description: "На 6% меньше расход патронов.", role: "any", effects: { ammo: 0.94 } },
	controlled_fire: { id: "controlled_fire", label: "Контроль огня", description: "На 10% меньше расход патронов.", role: "assault", effects: { ammo: 0.9 } },
	contact_drill: { id: "contact_drill", label: "Работа в контакте", description: "+2,5 п.п. к шансу пройти этап рейда.", role: "assault", effects: { chance: 0.025 } },
	march_drill: { id: "march_drill", label: "Марш-бросок", description: "Этапы рейда на 8% короче.", role: "assault", effects: { duration: 0.92 } },
	street_memory: { id: "street_memory", label: "Память улиц", description: "Этапы рейда на 10% короче.", role: "scout", effects: { duration: 0.9 } },
	cargo_rig: { id: "cargo_rig", label: "Укладка груза", description: "+2 единицы вместимости груза в рейде.", role: "scout", effects: { capacity: 2 } },
	cache_sense: { id: "cache_sense", label: "Чутьё тайников", description: "+10% к множителю добычи в новых рейдах.", role: "scout", effects: { loot: 0.1 } },
	bench_rhythm: { id: "bench_rhythm", label: "Ритм станка", description: "Личный вклад в производство на 15% выше.", role: "technician", effects: { work: 1.15 } },
	field_sorting: { id: "field_sorting", label: "Полевой отбор", description: "+10% к множителю добычи в новых рейдах.", role: "technician", effects: { loot: 0.1 } },
	precise_fit: { id: "precise_fit", label: "Точная подгонка", description: "На 8% меньше расход патронов.", role: "technician", effects: { ammo: 0.92 } },
};

const roles: RecruitRole[] = ["assault", "scout", "technician"];
const roleTraits: Record<RecruitRole, string[]> = { assault: ["steady_hands", "short_bursts"], scout: ["pack_rat", "fleet_foot"], technician: ["bench_craft", "part_picker"] };
const roleDrawbacks: Record<RecruitRole, string[]> = { assault: ["heavy_boots", "rough_hands"], scout: ["timid", "wasteful"], technician: ["slow_step", "light_pack"] };
const roleStats: Record<RecruitRole, [number, number]> = { assault: [38, 25], scout: [24, 40], technician: [28, 34] };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export const neutralScavProfile = (): ScavProfile => ({ backgroundId: null, traitId: null, drawbackId: null, talents: [], candidateId: null });
export function getScavRecruitRole(scav: Scav): RecruitRole | null {
	return scav.profile?.backgroundId ? RECRUIT_BACKGROUNDS[scav.profile.backgroundId]?.role ?? null : null;
}
export function getScavProfileEffects(scav: Scav): ScavProfileEffects {
	const effects: ScavProfileEffects = { chance: 0, loot: 0, duration: 1, ammo: 1, capacity: 0, work: 1 };
	const profile = scav.profile;
	if (!profile) return effects;
	const modifiers = [profile.traitId ? RECRUIT_TRAITS[profile.traitId] : undefined,
		profile.drawbackId ? RECRUIT_DRAWBACKS[profile.drawbackId] : undefined, ...profile.talents.map((talent) => SCAV_TALENTS[talent])];
	for (const modifier of modifiers) if (modifier) {
		for (const key of ["chance", "loot", "capacity"] as const) effects[key] += modifier.effects[key] ?? 0;
		for (const key of ["duration", "ammo", "work"] as const) effects[key] *= modifier.effects[key] ?? 1;
	}
	effects.chance = clamp(effects.chance, -0.06, 0.09); effects.loot = clamp(effects.loot, -0.15, 0.35);
	effects.capacity = clamp(effects.capacity, -2, 8); effects.duration = clamp(effects.duration, 0.7, 1.3);
	effects.ammo = clamp(effects.ammo, 0.7, 1.3); effects.work = clamp(effects.work, 0.75, 1.5);
	return effects;
}

export function getScavTalentOffers(scav: Scav): { level: 2 | 4 | 6; offers: ScavTalentDefinition[] } | null {
	const picked = scav.profile?.talents ?? [], level = ([2, 4, 6] as const)[picked.length];
	if (!level || scav.level < level) return null;
	const role = getScavRecruitRole(scav);
	const available = Object.values(SCAV_TALENTS).filter((talent) => !picked.includes(talent.id) && (talent.role === "any" || talent.role === role))
		.sort((a, b) => Number(a.role === "any") - Number(b.role === "any"));
	// Each threshold offers a different focus. The persisted earlier choice removes itself.
	const offset = picked.length * 2, ordered = [...available.slice(offset % available.length), ...available.slice(0, offset % available.length)];
	return { level, offers: ordered.slice(0, 3) };
}

export function getRecruitmentNetworks(state: GameState) {
	const districtProgress = Math.min(state.stats.raidsCompleted / 3, state.stats.mapsVisited.length / 2, 1);
	const veteranProgress = Math.min(state.stats.raidsWon / 5, state.base.radio / 2, 1);
	return [
		{ id: "yard", label: "Дворовые связи", description: "Сторожа, курьеры и гаражные мастера.", tier: 0 as RecruitTier, unlocked: true, requirement: "Доступно с начала", progress: 1 },
		{ id: "city", label: "Городские связные", description: "Охранники блокпостов, проводники и оружейники.", tier: 1 as RecruitTier,
			unlocked: state.recruitment.tier >= 1 || districtProgress >= 1, requirement: `${Math.min(3, state.stats.raidsCompleted)}/3 завершённых рейда · ${Math.min(2, state.stats.mapsVisited.length)}/2 посещённых сектора`, progress: districtProgress },
		{ id: "veterans", label: "Проверенные контакты", description: "Контрактники, дальние рейдеры и заводские инженеры.", tier: 2 as RecruitTier,
			unlocked: state.recruitment.tier >= 2 || (districtProgress >= 1 && veteranProgress >= 1), requirement: `${Math.min(5, state.stats.raidsWon)}/5 успешных рейдов · радиорубка ${state.base.radio}/2 · городские связные`, progress: Math.min(districtProgress, veteranProgress) },
	];
}
export function getEarnedRecruitmentTier(state: Pick<GameState, "stats" | "base">): RecruitTier {
	if (state.stats.raidsCompleted < 3 || state.stats.mapsVisited.length < 2) return 0;
	return state.stats.raidsWon >= 5 && state.base.radio >= 2 ? 2 : 1;
}

export function stepRecruitmentSeed(seed: number): number {
	let value = seed >>> 0 || 0x48a17ce9;
	value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
	return value >>> 0 || 1;
}
export function buildRecruitmentBoard(seed: number, generation: number, tier: RecruitTier): RecruitCandidate[] {
	let cursor = seed >>> 0;
	const random = () => { cursor = stepRecruitmentSeed(cursor); return cursor / 4294967296; };
	const usedNames = new Set<string>();
	return roles.map((role, index) => {
		const contactTier = index === generation % 3 ? tier : Math.floor(random() * (tier + 1)) as RecruitTier;
		const background = Object.values(RECRUIT_BACKGROUNDS).find((entry) => entry.role === role && entry.tier === contactTier)!;
		const names = SCAV_NAMES.filter((name) => !usedNames.has(name));
		const name = names[Math.floor(random() * names.length)]!; usedNames.add(name);
		const traitId = roleTraits[role][Math.floor(random() * roleTraits[role].length)]!;
		const drawbackId = roleDrawbacks[role][Math.floor(random() * roleDrawbacks[role].length)]!;
		const [combat, scouting] = roleStats[role];
		const rolledCombat = combat + contactTier * 4 + Math.floor(random() * 7), rolledScouting = scouting + contactTier * 4 + Math.floor(random() * 7);
		return { id: `recruit-${generation}-${index}-${seed}`, name, role, backgroundId: background.id, traitId, drawbackId,
			combat: rolledCombat, scouting: rolledScouting, cost: 260 + index * 20 + contactTier * 120 + (rolledCombat + rolledScouting - combat - scouting) * 5 };
	});
}
export function createRecruitmentState(state: Pick<GameState, "createdAt" | "rng" | "stats" | "base">): RecruitmentState {
	// This stream never consumes the campaign RNG or a raid seed, including migrations.
	const mixed = (state.rng ^ (Math.trunc(state.createdAt) >>> 0) ^ Math.imul(Math.floor(state.createdAt / 4294967296) >>> 0, 0x9e3779b1) ^ 0xa739d2b5) >>> 0;
	const boardSeed = stepRecruitmentSeed(mixed), tier = getEarnedRecruitmentTier(state);
	return { rng: stepRecruitmentSeed(boardSeed), boardSeed, boardTier: tier, generation: 1, tier, board: buildRecruitmentBoard(boardSeed, 1, tier), hiredCandidateIds: [] };
}
export const RECOVERY_RECRUIT_ID = "recruit-recovery";
const recoveryCandidate: RecruitCandidate = { id: RECOVERY_RECRUIT_ID, name: "Сосед", role: "assault", backgroundId: "yard_guard", traitId: "steady_hands", drawbackId: "heavy_boots", combat: 22, scouting: 23, cost: 0 };
export function getRecruitmentBoard(state: GameState): readonly RecruitCandidate[] {
	return state.scavs.length === 0 && state.recruitment.board.length === 0 ? [{ ...recoveryCandidate }] : state.recruitment.board;
}
export function isRecruitTraitForRole(id: string, role: RecruitRole) { return roleTraits[role].includes(id); }
export function isRecruitDrawbackForRole(id: string, role: RecruitRole) { return roleDrawbacks[role].includes(id); }
