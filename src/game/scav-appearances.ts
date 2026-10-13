export interface ScavAppearance {
	readonly id: number;
	readonly personality: string;
	readonly name: string;
}

/** Atlas IDs are permanent: saves retain the same model as the roster changes. */
export const SCAV_APPEARANCES: readonly ScavAppearance[] = Object.freeze([
	{ id: 0, personality: "veteran", name: "Борода" },
	{ id: 1, personality: "collector", name: "Рыжий" },
	{ id: 2, personality: "runner", name: "Шустрый" },
	{ id: 3, personality: "careful", name: "Осторожный" },
	{ id: 4, personality: "veteran", name: "Шрам" },
	{ id: 5, personality: "veteran", name: "Сталь" },
	{ id: 6, personality: "veteran", name: "Уголь" },
	{ id: 7, personality: "veteran", name: "Усатый" },
	{ id: 8, personality: "veteran", name: "Мороз" },
	{ id: 9, personality: "veteran", name: "Искра" },
	{ id: 10, personality: "veteran", name: "Бронза" },
	{ id: 11, personality: "collector", name: "Дождь" },
	{ id: 12, personality: "collector", name: "Сажа" },
	{ id: 13, personality: "collector", name: "Мастер" },
	{ id: 14, personality: "collector", name: "Янтарь" },
	{ id: 15, personality: "collector", name: "Песок" },
	{ id: 16, personality: "collector", name: "Вишня" },
	{ id: 17, personality: "collector", name: "Ржавый" },
	{ id: 18, personality: "runner", name: "Сумрак" },
	{ id: 19, personality: "runner", name: "Ласточка" },
	{ id: 20, personality: "runner", name: "Срез" },
	{ id: 21, personality: "runner", name: "Мох" },
	{ id: 22, personality: "runner", name: "Призрак" },
	{ id: 23, personality: "runner", name: "Синица" },
	{ id: 24, personality: "runner", name: "Белый" },
	{ id: 25, personality: "careful", name: "Тихая" },
	{ id: 26, personality: "careful", name: "Линза" },
	{ id: 27, personality: "careful", name: "Дед" },
	{ id: 28, personality: "careful", name: "Медь" },
	{ id: 29, personality: "careful", name: "Сторож" },
	{ id: 30, personality: "careful", name: "Снегирь" },
	{ id: 31, personality: "careful", name: "Лётчик" },
].map((appearance) => Object.freeze(appearance)));

const LEGACY_APPEARANCES: Readonly<Record<string, number>> = Object.freeze({ veteran: 0, collector: 1, runner: 2, careful: 3 });

export function isScavAppearance(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < SCAV_APPEARANCES.length;
}

/** Missing visual IDs in older saves retain their original personality model. */
export function defaultScavAppearance(personality: string): number {
	return Object.hasOwn(LEGACY_APPEARANCES, personality) ? LEGACY_APPEARANCES[personality]! : 0;
}

/** Visual variety uses its own hash, leaving combat, loot and recruitment rolls intact. */
export function chooseScavAppearance(personality: string, identity: string, used: readonly number[] = []): number {
	const pool = SCAV_APPEARANCES.filter((appearance) => appearance.personality === personality);
	if (!pool.length) return defaultScavAppearance(personality);
	const available = pool.filter((appearance) => !used.includes(appearance.id));
	const choices = available.length ? available : pool;
	let hash = 0x811c9dc5;
	for (let index = 0; index < identity.length; index++) hash = Math.imul(hash ^ identity.charCodeAt(index), 0x01000193);
	return choices[(hash >>> 0) % choices.length]!.id;
}
