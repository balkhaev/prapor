import type { LiveDistrictId } from './live';

export const BOSS_SAVE_VERSION = 26;
export type BossId = 'bugor' | 'lesnik' | 'liteyshchik' | 'komendant';
export interface BossDefinition {
	id: BossId; name: string; title: string; description: string;
	mapId: string; depth: 2 | 3; districtId: LiveDistrictId;
	/** Prefer an authored arena of this type, inside a matching danger zone. */
	poiTemplateId: string;
	weaponId: string; armorModelId: string; trophyModelId: string;
	lootModelId: string; moduleModelId: string; gearModelId: string;
	chancePenalty: number; extraAmmo: number; extraIntel: number; extraSeconds: number; bounty: number;
	live: { incomingDamage: number; outgoingDamage: number; attackMs: number; range: number; aggroRange: number; respawnMs: number; corpseMs: number };
}
export const BOSSES: readonly BossDefinition[] = [
	{ id: 'bugor', name: 'Бугор', title: 'Главарь налётчиков', description: 'Удерживает склады и переправы Посёлка. Плотная защита и ближний бой: лёгкий одиночный комплект здесь рискует всем грузом.',
		mapId: 'depot', depth: 2, districtId: 'village', poiTemplateId: 'clinic', weaponId: 'pp91', armorModelId: 'patrol_armor',
		trophyModelId: 'boss-bugor-sign', lootModelId: 'circuit-board', moduleModelId: 'receiver-pp91', gearModelId: 'patrol_armor',
		chancePenalty: .12, extraAmmo: 2, extraIntel: 1, extraSeconds: 30, bounty: 100,
		live: { incomingDamage: .65, outgoingDamage: 1.2, attackMs: 2100, range: 14, aggroRange: 18, respawnMs: 12 * 60_000, corpseMs: 5 * 60_000 } },
	{ id: 'lesnik', name: 'Лесник', title: 'Хозяин лесных дворов', description: 'Следит за тропами Лесопилки с дальнего рубежа. Разведка, подходящий прицел и подготовленный отряд помогают пережить встречу.',
		mapId: 'forest', depth: 2, districtId: 'sawmill', poiTemplateId: 'cabin', weaponId: 'mosin', armorModelId: 'kevlar_helmet',
		trophyModelId: 'boss-lesnik-compass', lootModelId: 'luxury-watch', moduleModelId: 'receiver-mosin', gearModelId: 'kevlar_helmet',
		chancePenalty: .15, extraAmmo: 3, extraIntel: 1, extraSeconds: 40, bounty: 150,
		live: { incomingDamage: .55, outgoingDamage: 1.3, attackMs: 2300, range: 20, aggroRange: 22, respawnMs: 14 * 60_000, corpseMs: 5 * 60_000 } },
	{ id: 'liteyshchik', name: 'Литейщик', title: 'Смотритель ангаров', description: 'Охраняет промышленную часть Таможни. Долгий бой против защищённого противника требует запаса боеприпасов и исправного оружия.',
		mapId: 'factory', depth: 3, districtId: 'customs', poiTemplateId: 'workshop', weaponId: 'akm', armorModelId: 'plate_armor',
		trophyModelId: 'boss-liteyshchik-key', lootModelId: 'thermal-sensor', moduleModelId: 'receiver-akm', gearModelId: 'plate_armor',
		chancePenalty: .18, extraAmmo: 4, extraIntel: 2, extraSeconds: 60, bounty: 250,
		live: { incomingDamage: .48, outgoingDamage: 1.4, attackMs: 2000, range: 16, aggroRange: 20, respawnMs: 16 * 60_000, corpseMs: 6 * 60_000 } },
	{ id: 'komendant', name: 'Комендант', title: 'Командир ремонтного депо', description: 'Удерживает тяжёлые склады Депо. Самый опасный охотничий маршрут: защита, медицина и согласованный отряд ценнее лишнего места в пустом рюкзаке.',
		mapId: 'reserve', depth: 3, districtId: 'depot', poiTemplateId: 'depot', weaponId: 'svd', armorModelId: 'heavy_armor',
		trophyModelId: 'boss-komendant-seal', lootModelId: 'military-cpu', moduleModelId: 'receiver-svd', gearModelId: 'heavy_armor',
		chancePenalty: .22, extraAmmo: 5, extraIntel: 2, extraSeconds: 70, bounty: 350,
		live: { incomingDamage: .4, outgoingDamage: 1.5, attackMs: 2200, range: 22, aggroRange: 24, respawnMs: 18 * 60_000, corpseMs: 6 * 60_000 } },
];
export const BOSS_BY_ID: Readonly<Record<BossId, BossDefinition>> = Object.fromEntries(BOSSES.map(boss => [boss.id, boss])) as Record<BossId, BossDefinition>;
export function getBossForMap(mapId: string): BossDefinition | null { return BOSSES.find(boss => boss.mapId === mapId) ?? null; }
export function getBoss(id: string): BossDefinition | null { return Object.hasOwn(BOSS_BY_ID, id) ? BOSS_BY_ID[id as BossId] : null; }
