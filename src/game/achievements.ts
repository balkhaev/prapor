import type { GameState, WeaponInstance, Scav, Raid, RaidReport } from "./engine";
import { getWeaponStats, getRaidQuote, getExpeditionChoices, getCargoWeight, getSupplyCapacity, getModuleCapacity } from "./engine";
import { MAP_BY_ID, WEAPON_BY_ID, type Supplies } from "./data";
import { MODULE_BY_ID, RECEIVER_INFO, type ModuleInstance } from "./modules";
import { GEAR_MODEL_BY_ID, BLUEPRINTS } from "./systems";
import { ROOM_DEFINITIONS, RESOURCE_RECIPE_BY_ID, type ProductionJob, type RoomInstance, type ShelterCost } from "./shelter";
import { getRoomSocialEffects, getRaidSocialSupport } from "./squad-bonds";

export const ACHIEVEMENTS = [
	{ id: "enough", title: "Приказ: достаточно", category: "raids", description: "Эвакуироваться вручную после второго этапа с рюкзаком, заполненным минимум на 80%, когда следующий этап ещё доступен.", hint: "Умение остановиться — тоже приказ." },
	{ id: "dual-radio", title: "Два радиосеанса", category: "raids", description: "В одном ручном выходе передать находки оружейного склада на втором этапе, затем тайников — на третьем.", hint: "Переданные чертежи остаются дома независимо от судьбы груза." },
	{ id: "lighten", title: "Минус обвес, плюс маршрут", category: "armory", description: "Пересобрать ту же пушку с меньшей мощностью и сократить время выхода минимум на 5%. Отправить бойца.", hint: "Сравнение учитывает одинакового бойца, сектор и состояние базы." },
	{ id: "magazine", title: "Один магазин меняет приказ", category: "armory", description: "Заменой магазина открыть выход, которому не хватало только патронов, и отправиться без пополнения запаса.", hint: "Экономия должна уложиться в запас, который был до замены." },
	{ id: "inheritance", title: "Железо по наследству", category: "armory", description: "Перенести две реальные детали между пушками одной платформы разных калибров и отправить исправную новую сборку.", hint: "Ствол и магазин должны соответствовать новому калибру." },
	{ id: "radio-unload", title: "Разгрузка по рации", category: "base", description: "Пока боец ждёт на точке, оплатить заказ припасами, мешающими приёмке. Принять весь груз и завершить этот заказ.", hint: "Работает с патронами и деталями. Отмена заказа разрывает цепочку." },
	{ id: "storage-chain", title: "Склад — часть станка", category: "base", description: "Освободить место для готовой партии изготовлением полезной вещи, получить ту же партию и использовать изделие в рейде.", hint: "Партия должна действительно упереться в полный склад." },
	{ id: "recycle-chain", title: "Запчасти вернулись в бой", category: "base", description: "Утилем из настоящего рейда закрыть нехватку деталей, изготовить выбранную вещь и использовать её в выходе.", hint: "Между разборкой и изготовлением не должно быть нового поступления деталей." },
	{ id: "renovation", title: "Ремонт без пересменки", category: "base", description: "Во время улучшения комнаты перевести её работника на другой заказ, затем вернуть и закончить исходный.", hint: "Оба заказа оплачены; первая очередь сохраняет свой номер." },
	{ id: "two-fronts", title: "Два фронта", category: "people", description: "Друг прикрывает ручной выход с базы и завершает настоящую смену, пока рейдер выносит груз со второго этапа или глубже.", hint: "Нужны общая рабочая история и фактическая помощь друга на выходе." },
	{ id: "truce", title: "Перемирие у станка", category: "people", description: "После смены, замедленной конфликтом, поговорить и выполнить новый совместный заказ с меньшим штрафом.", hint: "Разговор подтверждается работой, а не нажатием кнопки." },
	{ id: "separate-benches", title: "Разные станки — общий дом", category: "people", description: "После разговора о границах развести конфликтующую пару по разным цехам и завершить обоим настоящую смену.", hint: "Оба должны реально работать отдельно, без взаимного штрафа." },
] as const;
export type AchievementId = typeof ACHIEVEMENTS[number]["id"];
type Category = typeof ACHIEVEMENTS[number]["category"];
export interface AchievementEvidence { readonly at: number; readonly text: string; readonly sourceIds: readonly string[] }
interface JobCredit { jobId: string; roomId: string; required: number; workers: { id: string; work: number }[]; pairs: { id: string; work: number; penalty: number; conflictWork: number }[] }
interface CraftedChain { achievementId: "storage-chain" | "recycle-chain"; sourceId: string; jobId: string | null; itemId: string | null; delivered: boolean }
export interface AchievementState {
	unlocked: Partial<Record<AchievementId, AchievementEvidence>>;
	seen: AchievementId[];
	ammoVersion: number;
	scrapVersion: number;
	active: {
		builds: { weapon: WeaponInstance }[];
		magazines: { scavId: string; mapId: string; gunId: string; receiverId: string; ammo: number; version: number; partId: string }[];
		transfers: { partId: string; receiverId: string; weaponId: string }[];
		inheritance: { receiverId: string; donorReceiverId: string; partIds: string[] }[];
		dual: string[];
		radio: { raidId: string; jobId: string; roomId: string; scavName: string; mapId: string; cargo: Supplies; extracted: boolean }[];
		crafts: CraftedChain[];
		recycle: { sourceId: string; version: number; scrapBefore: number; scrapAfter: number; money: number; workshopLevel: number; discoveredWeapons: string[]; blueprints: string[]; moduleSpace: boolean; gearSpace: boolean; rooms: { id: string; level: number }[] }[];
		renovation: { roomId: string; jobId: string; workerId: string; otherJobId: string | null; otherRoomId: string | null; upgraded: boolean; otherDone: boolean; returned: boolean; returnWork: number; alternateJobId: string | null; alternateWork: number }[];
		fronts: { raidId: string; supporterId: string; jobId: string | null; workingJobId: string | null; work: number }[];
		conflicts: { pairId: string; jobId: string; penalty: number }[];
		peace: { pairId: string; sourceJobId: string; penalty: number; afterId: number }[];
		separation: { pairId: string; sourceJobId: string; afterId: number; scavIds: [string, string]; credits: { scavId: string; jobId: string; roomId: string; work: number }[]; receipts: { scavId: string; jobId: string; roomId: string }[] }[];
		credits: JobCredit[];
		loot: { itemId: string; raidId: string }[];
	};
}
export function createAchievementState(): AchievementState {
	return { unlocked: {}, seen: [], ammoVersion: 0, scrapVersion: 0, active: { builds: [], magazines: [], transfers: [], inheritance: [], dual: [], radio: [], crafts: [], recycle: [], renovation: [], fronts: [], conflicts: [], peace: [], separation: [], credits: [], loot: [] } };
}
const keys: readonly (keyof Supplies)[] = ["ammo", "medicine", "scrap", "intel"];
const bounded = <T>(list: T[], item: T, limit: number) => { list.push(item); if (list.length > limit) list.splice(0, list.length - limit); };
const sequence = (id: string) => Number(id.split("-")[1]);
function earn(state: GameState, id: AchievementId, at: number, text: string, sourceIds: string[]) {
	if (state.achievements.unlocked[id]) return;
	state.achievements.unlocked[id] = Object.freeze({ at, text: text.slice(0, 400), sourceIds: Object.freeze([...new Set(sourceIds)].slice(0, 8)) });
}
export function getUnseenAchievementIds(state: GameState): AchievementId[] { return ACHIEVEMENTS.filter((item) => state.achievements.unlocked[item.id] && !state.achievements.seen.includes(item.id)).map((item) => item.id); }
export function markAchievementsSeen(state: GameState, ids: readonly AchievementId[] = getUnseenAchievementIds(state)): void {
	for (const id of ids) if (state.achievements.unlocked[id] && !state.achievements.seen.includes(id)) state.achievements.seen.push(id);
}
export interface AchievementView { id: AchievementId; title: string; category: Category; description: string; hint: string; unlocked: boolean; unlockedAt: number | null; evidence: string | null; active: boolean; steps: { label: string; done: boolean }[] }
export function getAchievementViews(state: GameState): AchievementView[] {
	const a = state.achievements.active;
	const step = (label: string, done = false) => ({ label, done });
	const mostAdvanced = <T>(items: readonly T[], rank: (item: T) => number): T | undefined => items.reduce<T | undefined>((best, item) => best === undefined || rank(item) > rank(best) ? item : best, undefined);
	// Every chain uses one witness: stages from unrelated orders or fighters cannot merge.
	const checkpoint = mostAdvanced(state.raids.filter(raid => !raid.isAuto && raid.expedition?.stage === 2 && raid.expedition.status === 'choice'), raid => getCargoWeight(raid.expedition!.cargo) / raid.expedition!.capacity);
	const readyToContinue = Boolean(checkpoint?.expedition?.offers.some(perk => getExpeditionChoices(state, checkpoint, perk).some(quote => quote.reason === null)));
	const dual = a.dual.map(id => state.raids.find(raid => raid.id === id)).find(raid => raid && !raid.isAuto);
	const build = mostAdvanced(a.builds, entry => {
		const weapon = state.weapons.find(item => item.id === entry.weapon.id);
		return weapon && getWeaponStats(weapon).ready && getWeaponStats(weapon).power < getWeaponStats(entry.weapon).power ? 1 : 0;
	});
	const changedBuild = build ? state.weapons.find(weapon => weapon.id === build.weapon.id) : undefined;
	const magazine = a.magazines.find(entry => entry.version === state.achievements.ammoVersion && state.weapons.some(weapon => weapon.id === entry.gunId && weapon.modules.receiver?.id === entry.receiverId && weapon.modules.magazine?.id === entry.partId));
	const inheritance = mostAdvanced(a.inheritance, entry => {
		const weapon = state.weapons.find(item => item.modules.receiver?.id === entry.receiverId);
		return weapon ? entry.partIds.filter(id => Object.values(weapon.modules).some(part => part.id === id)).length : 0;
	});
	const inheritedWeapon = inheritance ? state.weapons.find(weapon => weapon.modules.receiver?.id === inheritance.receiverId) : undefined;
	const inheritedParts = inheritance && inheritedWeapon ? inheritance.partIds.filter(id => Object.values(inheritedWeapon.modules).some(part => part.id === id)).length : 0;
	const radio = mostAdvanced(a.radio, entry => Number(entry.extracted));
	const storage = mostAdvanced(a.crafts.filter(entry => entry.achievementId === 'storage-chain'), entry => Number(entry.itemId !== null) + Number(entry.delivered));
	const recycle = mostAdvanced(a.crafts.filter(entry => entry.achievementId === 'recycle-chain'), entry => Number(entry.itemId !== null) + Number(entry.delivered));
	const recycledSource = Boolean(recycle || a.recycle.some(entry => entry.version === state.achievements.scrapVersion));
	const renovation = mostAdvanced(a.renovation, entry => Number(entry.otherDone) + Number(entry.upgraded) + Number(entry.returned));
	const fronts = mostAdvanced(a.fronts, entry => Number(entry.jobId !== null));
	const peace = mostAdvanced(a.peace, entry => Number(a.credits.some(credit => sequence(credit.jobId) >= entry.afterId && credit.pairs.some(pair => pair.id === entry.pairId && pair.work > 0 && pair.penalty > entry.penalty))));
	const improvedWork = Boolean(peace && a.credits.some(credit => sequence(credit.jobId) >= peace.afterId && credit.pairs.some(pair => pair.id === peace.pairId && pair.work > 0 && pair.penalty > peace.penalty)));
	const separation = mostAdvanced(a.separation, entry => entry.receipts.length);
	const separateAssignments = separation?.scavIds.map(id => state.scavs.find(scav => scav.id === id)?.assignment ?? null);
	const separateRooms = Boolean(separateAssignments?.[0] && separateAssignments[1] && separateAssignments[0] !== separateAssignments[1]);
	const stages: Record<AchievementId, { active: boolean; steps: AchievementView['steps'] }> = {
		enough: { active: Boolean(checkpoint), steps: [step('Дойти вручную до второй точки связи', Boolean(checkpoint)), step('Заполнить рюкзак минимум на 80%', Boolean(checkpoint && getCargoWeight(checkpoint.expedition!.cargo) >= checkpoint.expedition!.capacity * 0.8)), step('Сохранить возможность идти на третий этап', readyToContinue), step('Выбрать эвакуацию с добычей')] },
		'dual-radio': { active: Boolean(dual), steps: [step('Пройти второй этап через оружейный склад', Boolean(dual)), step('Выбрать тайники для третьего этапа', Boolean(dual?.expedition?.stage === 3 && dual.expedition.branch === 'scavenge')), step('Передать сведения из обеих точек одного ручного выхода')] },
		lighten: { active: Boolean(build), steps: [step('Начать переделку исправной сборки', Boolean(build)), step('Снизить мощность той же пушки', Boolean(changedBuild && build && getWeaponStats(changedBuild).ready && getWeaponStats(changedBuild).power < getWeaponStats(build.weapon).power)), step('Отправить бойца: тот же маршрут стал короче минимум на 5%')] },
		magazine: { active: Boolean(magazine), steps: [step('Для выхода не хватало только патронов', Boolean(magazine)), step('После замены магазина исходного запаса хватило', Boolean(magazine)), step('Отправить эту сборку без пополнения запаса')] },
		inheritance: { active: inheritedParts > 0, steps: [step('Перенести первую деталь между калибрами одной платформы', inheritedParts >= 1), step('Сохранить в новой сборке две детали прежней', inheritedParts >= 2), step('Собрать исправное оружие нового калибра', Boolean(inheritedParts >= 2 && inheritedWeapon && getWeaponStats(inheritedWeapon).ready)), step('Отправить бойца с этой сборкой')] },
		'radio-unload': { active: Boolean(radio), steps: [step('Освободить место под груз оплатой заказа', Boolean(radio)), step('Принять весь груз бойца, ожидавшего на точке', Boolean(radio?.extracted)), step('Выполнить этот же заказ без отмены')] },
		'storage-chain': { active: Boolean(storage), steps: [step('Освободить склад изготовлением вещи под готовую партию', Boolean(storage)), step('Получить изготовленное изделие', Boolean(storage?.itemId)), step('Принять ту же готовую партию', Boolean(storage?.delivered)), step('Использовать изделие в новом выходе')] },
		'recycle-chain': { active: recycledSource, steps: [step('Рейдовым утилем закрыть нехватку деталей для вещи', recycledSource), step('Изготовить выбранное изделие без нового поступления деталей', Boolean(recycle?.itemId)), step('Использовать это изделие в выходе')] },
		renovation: { active: Boolean(renovation), steps: [step('Начать улучшение комнаты с незавершённым заказом', Boolean(renovation)), step('Работник завершил другой заказ во время ремонта', Boolean(renovation?.otherDone)), step('Вернуть работника после улучшения комнаты', Boolean(renovation?.upgraded && renovation.returned)), step('Закончить исходный заказ после возвращения')] },
		'two-fronts': { active: Boolean(fronts), steps: [step('Друг с общей рабочей историей помогает выходу с базы', Boolean(fronts)), step('Друг завершил настоящую смену во время этого выхода', Boolean(fronts?.jobId)), step('Вынести груз вручную со второго этапа или глубже')] },
		truce: { active: Boolean(peace), steps: [step('Совместный заказ действительно замедлялся конфликтом', Boolean(peace)), step('Поговорить с той же парой', Boolean(peace)), step('Начать новый совместный заказ с меньшим штрафом', improvedWork), step('Завершить эту полезную смену')] },
		'separate-benches': { active: Boolean(separation), steps: [step('Обсудить границы после общего конфликта', Boolean(separation)), step('Назначить бойцов в разные цеха', separateRooms), step('Один из бойцов уже завершил отдельную смену', Boolean(separation?.receipts.length)), step('Оба завершили оплаченные смены за разными станками')] },
	};
	return ACHIEVEMENTS.map(item => {
		const evidence = state.achievements.unlocked[item.id], route = stages[item.id];
		return { ...item, unlocked: Boolean(evidence), unlockedAt: evidence?.at ?? null, evidence: evidence?.text ?? null, active: !evidence && route.active, steps: route.steps.map(entry => ({ ...entry, done: Boolean(evidence) || entry.done })) };
	});
}

/** Resource receipts invalidate economy chains even if a later spend hides the receipt. */
export function noteAchievementSupply(state: GameState, key: keyof Supplies, amount: number) {
	if (amount <= 0 || key !== "ammo" && key !== "scrap") return;
	const field = key === "ammo" ? "ammoVersion" : "scrapVersion";
	state.achievements[field] += amount;
	if (state.achievements[field] >= 1e12) { state.achievements[field] = 0; if (key === "ammo") state.achievements.active.magazines = []; else state.achievements.active.recycle = []; }
}
export function noteAchievementBuild(state: GameState, weapon: WeaponInstance) {
	if (!getWeaponStats(weapon).ready || state.achievements.unlocked.lighten) return;
	const existing = state.achievements.active.builds.find((item) => item.weapon.id === weapon.id);
	if (existing && getWeaponStats(existing.weapon).power >= getWeaponStats(weapon).power && getWeaponStats(existing.weapon).weight >= getWeaponStats(weapon).weight) return;
	if (existing) existing.weapon = structuredClone(weapon); else bounded(state.achievements.active.builds, { weapon: structuredClone(weapon) }, 32);
}
export function noteAchievementTransfer(state: GameState, weapon: WeaponInstance, parts: readonly ModuleInstance[]) {
	const receiver = weapon.modules.receiver; if (!receiver || state.achievements.unlocked.inheritance) return;
	for (const part of parts) {
		state.achievements.active.transfers = state.achievements.active.transfers.filter((entry) => entry.partId !== part.id);
		bounded(state.achievements.active.transfers, { partId: part.id, receiverId: receiver.id, weaponId: weapon.weaponId }, 128);
	}
}
export function noteAchievementInstalled(state: GameState, before: WeaponInstance, weapon: WeaponInstance, part: ModuleInstance) {
	const receiver = weapon.modules.receiver, donor = state.achievements.active.transfers.find((item) => item.partId === part.id);
	if (receiver && donor && donor.receiverId !== receiver.id && RECEIVER_INFO[donor.weaponId]!.platform === RECEIVER_INFO[weapon.weaponId]!.platform && RECEIVER_INFO[donor.weaponId]!.caliber !== RECEIVER_INFO[weapon.weaponId]!.caliber) {
		let chain = state.achievements.active.inheritance.find((item) => item.receiverId === receiver.id && item.donorReceiverId === donor.receiverId);
		if (!chain) { chain = { receiverId: receiver.id, donorReceiverId: donor.receiverId, partIds: [] }; bounded(state.achievements.active.inheritance, chain, 32); }
		if (!chain.partIds.includes(part.id)) bounded(chain.partIds, part.id, 12);
	}
	if (MODULE_BY_ID[part.modelId]!.slot !== "magazine" || !before.modules.magazine || before.modules.magazine.id === part.id || !receiver || state.achievements.unlocked.magazine) return;
	for (const scav of state.scavs.filter((person) => person.weaponInstanceId === weapon.id)) for (const map of Object.values(MAP_BY_ID)) {
		const shadow = { ...state, weapons: state.weapons.map((gun) => gun.id === weapon.id ? before : gun) };
		const old = getRaidQuote(shadow, scav, map), current = getRaidQuote(state, scav, map);
		const funded = getRaidQuote({ ...shadow, supplies: { ...shadow.supplies, ammo: 1e8 } }, scav, map);
		if (old.ammo > state.supplies.ammo && funded.reason === null && current.reason === null && current.ammo <= state.supplies.ammo) {
			state.achievements.active.magazines = state.achievements.active.magazines.filter((item) => item.scavId !== scav.id || item.mapId !== map.id);
			bounded(state.achievements.active.magazines, { scavId: scav.id, mapId: map.id, gunId: weapon.id, receiverId: receiver.id, ammo: state.supplies.ammo, version: state.achievements.ammoVersion, partId: part.id }, 90);
		}
	}
}
export function noteAchievementDispatch(state: GameState, scav: Scav, raid: Raid, beforeAmmo: number, at: number) {
	const a = state.achievements.active, weapon = state.weapons.find((gun) => gun.id === raid.weaponInstanceId)!;
	const baseline = a.builds.find((entry) => entry.weapon.id === weapon.id)?.weapon;
	if (baseline && baseline.modules.receiver?.id === weapon.modules.receiver?.id) {
		// Recompute both builds against today's actor/base, never a historical quote.
		const old = { ...baseline, durability: weapon.durability, modules: { ...baseline.modules } };
		if (old.modules.receiver) old.modules.receiver = { ...old.modules.receiver, durability: weapon.durability };
		const actor = { ...scav, status: "ready" as const }, map = MAP_BY_ID[raid.mapId]!;
		const funded = { ...state, money: 1e8, supplies: { ammo: 1e8, medicine: 1e8, scrap: state.supplies.scrap, intel: 1e8 } };
		const oldQuote = getRaidQuote({ ...funded, weapons: funded.weapons.map((gun) => gun.id === weapon.id ? old : gun) }, actor, map), quote = getRaidQuote(funded, actor, map);
		if (getWeaponStats(weapon).ready && getWeaponStats(weapon).power < getWeaponStats(old).power && quote.duration <= oldQuote.duration * 0.95) earn(state, "lighten", at, `${scav.name}: мощность ${getWeaponStats(old).power} → ${getWeaponStats(weapon).power}, путь ${oldQuote.duration} → ${quote.duration} с.`, [raid.id, weapon.id]);
	}
	a.builds = a.builds.filter((entry) => entry.weapon.id !== weapon.id);
	const magazine = a.magazines.find((item) => item.scavId === scav.id && item.mapId === raid.mapId && item.gunId === weapon.id && item.receiverId === weapon.modules.receiver?.id && item.partId === weapon.modules.magazine?.id && item.version === state.achievements.ammoVersion && beforeAmmo <= item.ammo);
	if (magazine) earn(state, "magazine", at, `${scav.name} вышел в «${MAP_BY_ID[raid.mapId]!.name}» после замены магазина, без нового поступления патронов.`, [raid.id, weapon.id, magazine.partId]);
	a.magazines = a.magazines.filter((item) => item.scavId !== scav.id);
	const inherited = a.inheritance.find((item) => item.receiverId === weapon.modules.receiver?.id && item.partIds.filter((id) => Object.values(weapon.modules).some((part) => part.id === id)).length >= 2);
	if (inherited && getWeaponStats(weapon).ready && weapon.modules.barrel && weapon.modules.magazine) {
		const donor = a.transfers.find((entry) => entry.receiverId === inherited.donorReceiverId);
		earn(state, "inheritance", at, `${scav.name} вышел с ${WEAPON_BY_ID[weapon.weaponId]!.name} (${RECEIVER_INFO[weapon.weaponId]!.caliber}): в сборке сохранились две детали ${donor ? WEAPON_BY_ID[donor.weaponId]!.name : "прежней пушки"} другого калибра.`, [raid.id, inherited.receiverId, inherited.donorReceiverId, ...inherited.partIds]);
	}
	for (const chain of [...a.crafts]) if (chain.delivered && chain.itemId && (Object.values(weapon.modules).some((part) => part.id === chain.itemId) || [scav.loadout.armorItemId, scav.loadout.helmetItemId, scav.loadout.backpackItemId].includes(chain.itemId))) {
		const module = Object.values(weapon.modules).find((part) => part.id === chain.itemId), gear = state.gearItems.find((item) => item.id === chain.itemId);
		const label = module ? MODULE_BY_ID[module.modelId]!.label : gear ? GEAR_MODEL_BY_ID[gear.modelId]!.label : "изделие";
		earn(state, chain.achievementId, at, `${scav.name} вышел в «${MAP_BY_ID[raid.mapId]!.name}» с «${label}»: ${chain.achievementId === "storage-chain" ? "изготовление освободило склад для сохранённой готовой партии" : "детали из рейдового утиля закрыли нехватку на изготовление"}.`, [chain.sourceId, chain.itemId, raid.id]);
		a.crafts = a.crafts.filter((item) => item !== chain);
	}
	if (!raid.isAuto && !state.achievements.unlocked["two-fronts"]) {
		const support = getRaidSocialSupport(state, scav.id, raid.mapId), peer = state.scavs.find((person) => person.id === support.supporterId), pair = state.social.pairs.find((entry) => entry.scavIds.includes(scav.id) && entry.scavIds.includes(peer?.id ?? ""));
		const withoutFriend = { ...state, social: { ...state.social, pairs: state.social.pairs.map((entry) => entry.scavIds.includes(scav.id) && entry.score >= 16 ? { ...entry, score: 0 } : entry) } };
		// The chance cap can absorb the entire nominal friendship bonus.
		const actualBonus = raid.chance - getRaidQuote(withoutFriend, scav, MAP_BY_ID[raid.mapId]!).chance;
		if (support.chance > 0 && actualBonus > 1e-12 && peer && peer.status !== "raiding" && pair && pair.workTogether > 0 && pair.lastWorkId) bounded(a.fronts, { raidId: raid.id, supporterId: peer.id, jobId: null, workingJobId: null, work: 0 }, 15);
	}
}
export function noteAchievementCheckpoint(state: GameState, raid: Raid, at: number) {
	if (raid.isAuto || raid.expedition?.legacyLoot) return;
	const expedition = raid.expedition!;
	if (expedition.stage === 2 && expedition.branch === "combat" && !state.achievements.active.dual.includes(raid.id)) bounded(state.achievements.active.dual, raid.id, 15);
	if (expedition.stage === 3 && expedition.branch === "scavenge" && state.achievements.active.dual.includes(raid.id)) earn(state, "dual-radio", at, `${raid.scavName} передал сведения оружейного склада на втором этапе и тайников на третьем.`, [raid.id]);
}
export function noteAchievementContinue(state: GameState, raid: Raid) { state.achievements.active.radio = state.achievements.active.radio.filter((entry) => entry.raidId !== raid.id || entry.extracted); }
export function noteAchievementExtract(state: GameState, raid: Raid, at: number) {
	if (!raid.isAuto && raid.expedition?.stage === 2 && getCargoWeight(raid.expedition.cargo) >= raid.expedition.capacity * 0.8 && raid.expedition.offers.some((perk) => getExpeditionChoices(state, raid, perk).some((quote) => quote.reason === null))) earn(state, "enough", at, `${raid.scavName}: эвакуация с ${getCargoWeight(raid.expedition.cargo).toFixed(1)} / ${raid.expedition.capacity.toFixed(1)} ед. груза; дальнейший маршрут был доступен.`, [raid.id]);
}
export function noteAchievementRaidFinished(state: GameState, raid: Raid, report: RaidReport) {
	const a = state.achievements.active;
	for (const chain of a.radio.filter((item) => item.raidId === raid.id)) {
		if (report.success && !raid.isAuto && keys.every((key) => chain.cargo[key] === report.supplies[key] && raid.expedition?.cargo.supplies[key] === chain.cargo[key])) chain.extracted = true;
		else a.radio = a.radio.filter((item) => item !== chain);
	}
	const front = a.fronts.find((item) => item.raidId === raid.id);
	if (front?.jobId && report.success && report.depth >= 2 && raid.expedition && getCargoWeight(raid.expedition.cargo) > 0) earn(state, "two-fronts", report.at, `${raid.scavName} вынес груз после этапа ${report.depth}; друг ${state.scavs.find((person) => person.id === front.supporterId)?.name ?? "на базе"} закончил смену во время выхода.`, [raid.id, front.supporterId, front.jobId]);
	a.fronts = a.fronts.filter((item) => item.raidId !== raid.id);
	a.dual = a.dual.filter((id) => id !== raid.id);
}
export function noteAchievementLoot(state: GameState, raidId: string, itemIds: readonly string[]) {
	for (const itemId of itemIds) { state.achievements.active.loot = state.achievements.active.loot.filter((item) => item.itemId !== itemId); bounded(state.achievements.active.loot, { itemId, raidId }, 128); }
}

/** Called before payment, only after the action has passed all acceptance checks. */
export function prepareAchievementPayment(state: GameState, cost: ShelterCost): { raidId: string; scavName: string; mapId: string; cargo: Supplies }[] {
	const capacity = getSupplyCapacity(state);
	return state.raids.filter((raid) => !raid.isAuto && raid.expedition?.status === "choice" && ["ammo", "scrap"].some((key) => { const k = key as "ammo" | "scrap"; return cost.supplies[k] > 0 && state.supplies[k] + raid.expedition!.cargo.supplies[k] > capacity[k] && state.supplies[k] - cost.supplies[k] + raid.expedition!.cargo.supplies[k] <= capacity[k]; })).map((raid) => ({ raidId: raid.id, scavName: raid.scavName, mapId: raid.mapId, cargo: { ...raid.expedition!.cargo.supplies } }));
}
export function noteAchievementPaid(state: GameState, room: RoomInstance, job: ProductionJob, candidates: ReturnType<typeof prepareAchievementPayment>) {
	for (const candidate of candidates) bounded(state.achievements.active.radio, { ...candidate, roomId: room.id, jobId: job.id, extracted: false }, 32);
}
export function prepareAchievementCraft(state: GameState, cost: number): string[] {
	const capacity = getSupplyCapacity(state);
	return state.shelter.rooms.flatMap((room) => { const job = room.queue[0]; if (!job || job.workDone < job.workRequired || !job.output.supplies.scrap || state.supplies.scrap + job.output.supplies.scrap <= capacity.scrap || state.supplies.scrap - cost + job.output.supplies.scrap > capacity.scrap) return []; return [job.id]; });
}
export function noteAchievementCrafted(state: GameState, kind: "module" | "gear" | "job", modelId: string, roomId: string | null, itemId: string | null, jobId: string | null, blockedJobs: readonly string[]) {
	const a = state.achievements.active;
	for (const sourceId of blockedJobs) bounded(a.crafts, { achievementId: "storage-chain", sourceId, itemId, jobId, delivered: false }, 32);
	for (const receipt of a.recycle.filter((entry) => entry.version === state.achievements.scrapVersion)) {
		const module = kind !== "gear" ? MODULE_BY_ID[modelId]! : null, gear = kind === "gear" ? GEAR_MODEL_BY_ID[modelId]! : null;
		const cost = module?.craftCost.scrap ?? gear!.scrap, money = module?.craftCost.money ?? gear!.money;
		const discovery = !module || module.slot !== "receiver" || receipt.discoveredWeapons.includes(module.weaponId!);
		const room = receipt.rooms.find((entry) => entry.id === roomId);
		const allowed = kind === "gear" ? receipt.gearSpace && (!gear!.blueprint || receipt.blueprints.includes(gear!.blueprint)) : discovery && (kind === "module" ? receipt.moduleSpace && receipt.workshopLevel >= module!.workshopLevel : Boolean(room && room.level >= module!.workshopLevel));
		if (allowed && receipt.money >= money && receipt.scrapBefore < cost && receipt.scrapAfter >= cost) bounded(a.crafts, { achievementId: "recycle-chain", sourceId: receipt.sourceId, itemId, jobId, delivered: itemId !== null }, 32);
	}
	// This receipt describes one actual pre-fabrication shortage, never a catalogue tail.
	a.recycle = [];
}
export function prepareAchievementRecycle(state: GameState, sourceId: string, yieldAmount: number): AchievementState["active"]["recycle"] {
	if (!state.achievements.active.loot.some((entry) => entry.itemId === sourceId)) return [];
	return [{ sourceId, version: state.achievements.scrapVersion, scrapBefore: state.supplies.scrap, scrapAfter: state.supplies.scrap + yieldAmount, money: state.money, workshopLevel: state.base.workshop, discoveredWeapons: [...state.discoveredWeapons], blueprints: [...state.blueprints], moduleSpace: state.modules.length < getModuleCapacity(state), gearSpace: state.gearItems.length < 28, rooms: state.shelter.rooms.filter((room) => room.type === "workshop" && room.status === "ready" && room.queue.length < 5).map((room) => ({ id: room.id, level: room.level })) }];
}
export function noteAchievementRecycled(state: GameState, candidates: ReturnType<typeof prepareAchievementRecycle>) {
	state.achievements.active.recycle = candidates.map((entry) => ({ ...entry, version: state.achievements.scrapVersion }));
}

export function creditAchievementWork(state: GameState, room: RoomInstance, job: ProductionJob, amount: number) {
	if (amount <= 0) return;
	const a = state.achievements.active, workers = room.workerIds.filter((id) => { const person = state.scavs.find((scav) => scav.id === id); return person && person.status !== "raiding" && person.health >= 25 && person.assignment === room.id; });
	if (!workers.length) return;
	let credit = a.credits.find((entry) => entry.jobId === job.id);
	if (!credit) { credit = { jobId: job.id, roomId: room.id, required: job.workRequired, workers: [], pairs: [] }; bounded(a.credits, credit, 128); }
	for (const id of workers) { const existing = credit.workers.find((entry) => entry.id === id); if (existing) existing.work = Math.min(job.workRequired, existing.work + amount); else credit.workers.push({ id, work: amount }); }
	for (const chain of a.renovation) if (workers.includes(chain.workerId)) {
		if (chain.returned && chain.jobId === job.id) chain.returnWork = Math.min(job.workRequired, chain.returnWork + amount);
		if (room.id !== chain.roomId && state.shelter.rooms.some((room) => room.id === chain.roomId && room.status === "upgrading")) { if (chain.alternateJobId !== job.id) { chain.alternateJobId = job.id; chain.alternateWork = 0; } chain.alternateWork = Math.min(job.workRequired, chain.alternateWork + amount); }
	}
	for (const chain of a.fronts) if (workers.includes(chain.supporterId) && state.raids.some((raid) => raid.id === chain.raidId)) { if (chain.workingJobId !== job.id) { chain.workingJobId = job.id; chain.work = 0; } chain.work = Math.min(job.workRequired, chain.work + amount); }
	const social = getRoomSocialEffects(state, room.id);
	for (const pair of state.social.pairs.filter((entry) => entry.scavIds.every((id) => workers.includes(id)))) {
		const penalty = pair.score <= -12 && social.workers.filter((worker) => pair.scavIds.includes(worker.scavId)).every((worker) => worker.multiplier < 1) ? Math.max(-0.1, pair.score / 600) : 0;
		const existing = credit.pairs.find((entry) => entry.id === pair.id);
		if (existing) { existing.work = Math.min(job.workRequired, existing.work + amount); existing.penalty = Math.min(existing.penalty, penalty); if (penalty < 0) existing.conflictWork = Math.min(job.workRequired, existing.conflictWork + amount); } else credit.pairs.push({ id: pair.id, work: amount, penalty, conflictWork: penalty < 0 ? amount : 0 });
	}
	for (const chain of a.separation) {
		const assigned = chain.scavIds.map((id) => state.scavs.find((scav) => scav.id === id)?.assignment ?? null);
		if (!assigned[0] || !assigned[1] || assigned[0] === assigned[1] || sequence(job.id) < chain.afterId) continue;
		for (const scavId of chain.scavIds.filter((id) => workers.includes(id))) {
			const existing = chain.credits.find((entry) => entry.scavId === scavId && entry.jobId === job.id);
			if (existing) existing.work = Math.min(job.workRequired, existing.work + amount); else { chain.credits = chain.credits.filter((entry) => entry.scavId !== scavId); chain.credits.push({ scavId, jobId: job.id, roomId: room.id, work: amount }); }
		}
	}
}
export function noteAchievementUpgrade(state: GameState, room: RoomInstance) {
	const job = room.queue[0], credit = job ? state.achievements.active.credits.find((entry) => entry.jobId === job.id) : undefined;
	if (!job || job.workDone <= 0 || job.workDone >= job.workRequired || !credit) return;
	for (const workerId of room.workerIds.filter((id) => credit.workers.some((entry) => entry.id === id && entry.work > 0))) bounded(state.achievements.active.renovation, { roomId: room.id, jobId: job.id, workerId, otherJobId: null, otherRoomId: null, upgraded: false, otherDone: false, returned: false, returnWork: 0, alternateJobId: null, alternateWork: 0 }, 32);
}
export function noteAchievementUpgradeDone(state: GameState, room: RoomInstance) { for (const chain of state.achievements.active.renovation.filter((entry) => entry.roomId === room.id)) chain.upgraded = true; }
export function noteAchievementAssignment(state: GameState, scavId: string, roomId: string | null) {
	for (const chain of state.achievements.active.renovation.filter((entry) => entry.workerId === scavId)) if (roomId === chain.roomId && chain.upgraded && chain.otherDone) chain.returned = true;
}
export function noteAchievementSocialDecision(state: GameState, pairId: string, choiceId: string) {
	const a = state.achievements.active, source = a.conflicts.find((entry) => entry.pairId === pairId), pair = state.social.pairs.find((entry) => entry.id === pairId);
	if (!source || !pair) return;
	a.peace = a.peace.filter((entry) => entry.pairId !== pairId); bounded(a.peace, { pairId, sourceJobId: source.jobId, penalty: source.penalty, afterId: state.nextId }, 105);
	if (choiceId === "space") { a.separation = a.separation.filter((entry) => entry.pairId !== pairId); bounded(a.separation, { pairId, sourceJobId: source.jobId, afterId: state.nextId, scavIds: [...pair.scavIds], credits: [], receipts: [] }, 105); }
}
export function noteAchievementJobDone(state: GameState, room: RoomInstance, job: ProductionJob, itemId: string | null, at: number) {
	const a = state.achievements.active, credit = a.credits.find((entry) => entry.jobId === job.id), qualified = credit?.workers.filter((entry) => entry.work >= job.workRequired / 5).map((entry) => entry.id) ?? [];
	for (const chain of [...a.radio].filter((entry) => entry.jobId === job.id)) {
		if (chain.extracted) {
			const output = job.output.moduleModelId ? MODULE_BY_ID[job.output.moduleModelId]!.label : RESOURCE_RECIPE_BY_ID[job.recipeId]!.label;
			earn(state, "radio-unload", at, `${chain.scavName} вернулся из «${MAP_BY_ID[chain.mapId]!.name}»: приняты все ${chain.cargo.ammo} патронов, ${chain.cargo.scrap} деталей, ${chain.cargo.medicine} медикаментов и ${chain.cargo.intel} разведданных. ${ROOM_DEFINITIONS[room.type].label} завершила освободивший место заказ «${output}».`, [chain.raidId, job.id]);
		}
		a.radio = a.radio.filter((entry) => entry !== chain);
	}
	for (const chain of a.crafts) { if (chain.sourceId === job.id && chain.achievementId === "storage-chain") chain.delivered = true; if (chain.jobId === job.id) { chain.itemId = itemId; if (chain.achievementId === "recycle-chain") chain.delivered = true; } }
	for (const chain of [...a.renovation]) {
		const origin = state.shelter.rooms.find((entry) => entry.id === chain.roomId);
		if (room.id !== chain.roomId && origin?.status === "upgrading" && chain.alternateJobId === job.id && chain.alternateWork >= job.workRequired / 5 && qualified.includes(chain.workerId)) { chain.otherDone = true; chain.otherJobId = job.id; chain.otherRoomId = room.id; chain.alternateJobId = null; chain.alternateWork = 0; }
		if (job.id === chain.jobId) { if (chain.upgraded && chain.otherDone && chain.returned && chain.returnWork >= job.workRequired / 5 && room.workerIds.includes(chain.workerId) && qualified.includes(chain.workerId)) {
			const alternate = state.shelter.rooms.find((entry) => entry.id === chain.otherRoomId)!;
			earn(state, "renovation", at, `${state.scavs.find((entry) => entry.id === chain.workerId)!.name}: ${ROOM_DEFINITIONS[alternate.type].label} приняла смену на время ремонта, затем ${ROOM_DEFINITIONS[room.type].label} завершила сохранённый исходный заказ на уровне ${room.level}.`, [chain.workerId, chain.jobId, chain.otherJobId!]);
		} a.renovation = a.renovation.filter((entry) => entry !== chain); }
	}
	for (const chain of a.fronts) if (chain.workingJobId === job.id && chain.work >= job.workRequired / 5 && qualified.includes(chain.supporterId) && state.raids.some((raid) => raid.id === chain.raidId)) { chain.jobId = job.id; chain.workingJobId = null; chain.work = 0; }
	for (const pairCredit of credit?.pairs ?? []) if (pairCredit.work >= job.workRequired / 5) {
		const peace = a.peace.find((entry) => entry.pairId === pairCredit.id);
		if (peace && sequence(job.id) >= peace.afterId && pairCredit.penalty > peace.penalty) {
			const pair = state.social.pairs.find((pair) => pair.id === pairCredit.id)!;
			const names = pair.scavIds.map((id) => state.scavs.find((scav) => scav.id === id)!.name).join(" и ");
			earn(state, "truce", at, `${names}: ${ROOM_DEFINITIONS[room.type].label}, новый общий заказ после разговора. Реальный штраф пары к работе уменьшился с ${(-peace.penalty * 100).toFixed(1)}% до ${(-pairCredit.penalty * 100).toFixed(1)}%.`, [peace.sourceJobId, job.id, ...pair.scavIds]);
		}
		if (pairCredit.penalty < 0 && pairCredit.conflictWork >= job.workRequired / 5) { a.conflicts = a.conflicts.filter((entry) => entry.pairId !== pairCredit.id); bounded(a.conflicts, { pairId: pairCredit.id, jobId: job.id, penalty: pairCredit.penalty }, 105); }
	}
	for (const chain of a.separation) {
		for (const entry of chain.credits.filter((entry) => entry.jobId === job.id && entry.work >= job.workRequired / 5)) { chain.receipts = chain.receipts.filter((receipt) => receipt.scavId !== entry.scavId); chain.receipts.push({ scavId: entry.scavId, jobId: job.id, roomId: room.id }); }
		chain.credits = chain.credits.filter((entry) => entry.jobId !== job.id);
		if (chain.receipts.length === 2 && chain.receipts[0]!.roomId !== chain.receipts[1]!.roomId && chain.receipts[0]!.jobId !== chain.receipts[1]!.jobId) {
			const shifts = chain.receipts.map((receipt) => `${state.scavs.find((scav) => scav.id === receipt.scavId)!.name} — ${ROOM_DEFINITIONS[state.shelter.rooms.find((room) => room.id === receipt.roomId)!.type].label}`).join("; ");
			earn(state, "separate-benches", at, `${shifts}. После разговора о границах оба завершили оплаченные смены за разными станками без взаимного штрафа.`, [chain.sourceJobId, ...chain.receipts.map((entry) => entry.jobId), ...chain.scavIds]);
		}
	}
	a.credits = a.credits.filter((entry) => entry.jobId !== job.id);
}
export function noteAchievementCancelled(state: GameState, jobId: string) {
	const a = state.achievements.active;
	a.radio = a.radio.filter((entry) => entry.jobId !== jobId); a.crafts = a.crafts.filter((entry) => entry.sourceId !== jobId && entry.jobId !== jobId); a.renovation = a.renovation.filter((entry) => entry.jobId !== jobId); a.credits = a.credits.filter((entry) => entry.jobId !== jobId);
	for (const chain of a.fronts) if (chain.workingJobId === jobId) { chain.workingJobId = null; chain.work = 0; }
	for (const chain of a.renovation) if (chain.alternateJobId === jobId) { chain.alternateJobId = null; chain.alternateWork = 0; }
	for (const chain of a.separation) chain.credits = chain.credits.filter((entry) => entry.jobId !== jobId);
}

/** Death and dismissal remove only working chains; earned evidence survives. */
export function pruneAchievementPeople(state: GameState) {
	const a = state.achievements.active, people = new Set(state.scavs.map((person) => person.id)), pairs = new Set(state.social.pairs.map((pair) => pair.id));
	a.magazines = a.magazines.filter((entry) => people.has(entry.scavId));
	a.renovation = a.renovation.filter((entry) => people.has(entry.workerId));
	a.fronts = a.fronts.filter((entry) => people.has(entry.supporterId) && state.raids.some((raid) => raid.id === entry.raidId));
	a.conflicts = a.conflicts.filter((entry) => pairs.has(entry.pairId)); a.peace = a.peace.filter((entry) => pairs.has(entry.pairId)); a.separation = a.separation.filter((entry) => pairs.has(entry.pairId));
	for (const credit of a.credits) { credit.workers = credit.workers.filter((entry) => people.has(entry.id)); credit.pairs = credit.pairs.filter((entry) => pairs.has(entry.id)); }
	pruneAchievementInventory(state);
}
export function pruneAchievementInventory(state: GameState) {
	const a = state.achievements.active, guns = new Set(state.weapons.map((gun) => gun.id)), parts = new Set([...state.modules.map((part) => part.id), ...state.weapons.flatMap((gun) => Object.values(gun.modules).map((part) => part.id))]), items = new Set([...guns, ...parts, ...state.gearItems.map((item) => item.id)]);
	a.builds = a.builds.filter((entry) => guns.has(entry.weapon.id));
	a.magazines = a.magazines.filter((entry) => guns.has(entry.gunId) && parts.has(entry.receiverId) && parts.has(entry.partId));
	a.transfers = a.transfers.filter((entry) => parts.has(entry.partId));
	a.inheritance = a.inheritance.filter((entry) => parts.has(entry.receiverId));
	for (const entry of a.inheritance) entry.partIds = entry.partIds.filter((id) => parts.has(id));
	a.crafts = a.crafts.filter((entry) => entry.itemId === null || items.has(entry.itemId));
	a.loot = a.loot.filter((entry) => items.has(entry.itemId));
}

type Obj = Record<string, unknown>;
function object(value: unknown, fields: readonly string[]): Obj { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("achievement-object"); const item = value as Obj; if (Object.keys(item).some((key) => !fields.includes(key)) || fields.some((key) => !Object.hasOwn(item, key))) throw new Error("achievement-field"); return item; }
function number(value: unknown, max = 1e15, min = 0, integer = true) { if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) throw new Error("achievement-number"); return value; }
function string(value: unknown, max = 120) { if (typeof value !== "string" || !value.length || value.length > max) throw new Error("achievement-string"); return value; }
function boolean(value: unknown) { if (typeof value !== "boolean") throw new Error("achievement-boolean"); return value; }
function list<T>(value: unknown, max: number, parse: (item: unknown) => T): T[] { if (!Array.isArray(value) || value.length > max) throw new Error("achievement-array"); return value.map(parse); }
function nullable(value: unknown) { return value === null ? null : string(value); }
function unique<T>(items: T[], key: (entry: T) => string) { if (new Set(items.map(key)).size !== items.length) throw new Error("achievement-duplicate"); return items; }
function supplies(value: unknown): Supplies { const item = object(value, keys); return { ammo: number(item.ammo, 1e15, 0, false), medicine: number(item.medicine, 1e15, 0, false), scrap: number(item.scrap, 1e15, 0, false), intel: number(item.intel, 1e15, 0, false) }; }
function id(value: unknown): AchievementId { const result = string(value); if (!ACHIEVEMENTS.some((item) => item.id === result)) throw new Error("achievement-id"); return result as AchievementId; }
export function parseAchievementState(value: unknown, parseWeapon: (value: unknown) => WeaponInstance): AchievementState {
	const source = object(value, ["unlocked", "seen", "ammoVersion", "scrapVersion", "active"]), result = createAchievementState(), unlocked = source.unlocked;
	if (!unlocked || typeof unlocked !== "object" || Array.isArray(unlocked)) throw new Error("achievement-unlocked");
	for (const [key, value] of Object.entries(unlocked)) { const known = id(key), entry = object(value, ["at", "text", "sourceIds"]); result.unlocked[known] = Object.freeze({ at: number(entry.at, 1e15, 0, false), text: string(entry.text, 400), sourceIds: Object.freeze(unique(list(entry.sourceIds, 8, (value) => string(value)), (value) => value)) }); }
	result.seen = unique(list(source.seen, 12, id), (item) => item); if (result.seen.some((key) => !result.unlocked[key])) throw new Error("achievement-seen"); result.ammoVersion = number(source.ammoVersion, 1e12, 0, false); result.scrapVersion = number(source.scrapVersion, 1e12, 0, false);
	const a = object(source.active, Object.keys(result.active));
	result.active.builds = unique(list(a.builds, 32, (value) => { const item = object(value, ["weapon"]); return { weapon: parseWeapon(item.weapon) }; }), (item) => item.weapon.id);
	result.active.magazines = unique(list(a.magazines, 90, (value) => { const item = object(value, ["scavId", "mapId", "gunId", "receiverId", "ammo", "version", "partId"]); return { scavId: string(item.scavId), mapId: string(item.mapId), gunId: string(item.gunId), receiverId: string(item.receiverId), ammo: number(item.ammo, 1e15, 0, false), version: number(item.version, 1e12, 0, false), partId: string(item.partId) }; }), (item) => `${item.scavId}:${item.mapId}`);
	result.active.transfers = unique(list(a.transfers, 128, (value) => { const item = object(value, ["partId", "receiverId", "weaponId"]); return { partId: string(item.partId), receiverId: string(item.receiverId), weaponId: string(item.weaponId) }; }), (item) => item.partId);
	result.active.inheritance = unique(list(a.inheritance, 32, (value) => { const item = object(value, ["receiverId", "donorReceiverId", "partIds"]); return { receiverId: string(item.receiverId), donorReceiverId: string(item.donorReceiverId), partIds: unique(list(item.partIds, 12, (value) => string(value)), (item) => item) }; }), (item) => `${item.receiverId}:${item.donorReceiverId}`);
	result.active.dual = unique(list(a.dual, 15, (value) => string(value)), (item) => item);
	result.active.radio = unique(list(a.radio, 32, (value) => { const item = object(value, ["raidId", "jobId", "roomId", "scavName", "mapId", "cargo", "extracted"]); return { raidId: string(item.raidId), jobId: string(item.jobId), roomId: string(item.roomId), scavName: string(item.scavName), mapId: string(item.mapId), cargo: supplies(item.cargo), extracted: boolean(item.extracted) }; }), (item) => `${item.raidId}:${item.jobId}`);
	result.active.crafts = unique(list(a.crafts, 32, (value) => { const item = object(value, ["achievementId", "sourceId", "jobId", "itemId", "delivered"]); if (!["storage-chain", "recycle-chain"].includes(string(item.achievementId))) throw new Error("achievement-craft-kind"); return { achievementId: item.achievementId as CraftedChain["achievementId"], sourceId: string(item.sourceId), jobId: nullable(item.jobId), itemId: nullable(item.itemId), delivered: boolean(item.delivered) }; }), (item) => `${item.achievementId}:${item.sourceId}:${item.jobId}:${item.itemId}`);
	result.active.recycle = list(a.recycle, 1, (value) => { const item = object(value, ["sourceId", "version", "scrapBefore", "scrapAfter", "money", "workshopLevel", "discoveredWeapons", "blueprints", "moduleSpace", "gearSpace", "rooms"]); return { sourceId: string(item.sourceId), version: number(item.version, 1e12, 0, false), scrapBefore: number(item.scrapBefore, 1e15, 0, false), scrapAfter: number(item.scrapAfter, 1e15, 0, false), money: number(item.money, 1e15, 0, false), workshopLevel: number(item.workshopLevel, 5, 1), discoveredWeapons: unique(list(item.discoveredWeapons, Object.keys(RECEIVER_INFO).length, (value) => string(value)), (item) => item), blueprints: unique(list(item.blueprints, Object.keys(BLUEPRINTS).length, (value) => string(value)), (item) => item), moduleSpace: boolean(item.moduleSpace), gearSpace: boolean(item.gearSpace), rooms: unique(list(item.rooms, 256, (value) => { const room = object(value, ["id", "level"]); return { id: string(room.id), level: number(room.level, 5, 1) }; }), (item) => item.id) }; });
	result.active.renovation = unique(list(a.renovation, 32, (value) => { const item = object(value, ["roomId", "jobId", "workerId", "otherJobId", "otherRoomId", "upgraded", "otherDone", "returned", "returnWork", "alternateJobId", "alternateWork"]); return { roomId: string(item.roomId), jobId: string(item.jobId), workerId: string(item.workerId), otherJobId: nullable(item.otherJobId), otherRoomId: nullable(item.otherRoomId), upgraded: boolean(item.upgraded), otherDone: boolean(item.otherDone), returned: boolean(item.returned), returnWork: number(item.returnWork, 1e12, 0, false), alternateJobId: nullable(item.alternateJobId), alternateWork: number(item.alternateWork, 1e12, 0, false) }; }), (item) => `${item.jobId}:${item.workerId}`);
	result.active.fronts = unique(list(a.fronts, 15, (value) => { const item = object(value, ["raidId", "supporterId", "jobId", "workingJobId", "work"]); return { raidId: string(item.raidId), supporterId: string(item.supporterId), jobId: nullable(item.jobId), workingJobId: nullable(item.workingJobId), work: number(item.work, 1e12, 0, false) }; }), (item) => item.raidId);
	result.active.conflicts = unique(list(a.conflicts, 105, (value) => { const item = object(value, ["pairId", "jobId", "penalty"]); return { pairId: string(item.pairId), jobId: string(item.jobId), penalty: number(item.penalty, 0, -0.1, false) }; }), (item) => item.pairId);
	result.active.peace = unique(list(a.peace, 105, (value) => { const item = object(value, ["pairId", "sourceJobId", "penalty", "afterId"]); return { pairId: string(item.pairId), sourceJobId: string(item.sourceJobId), penalty: number(item.penalty, 0, -0.1, false), afterId: number(item.afterId, 1e12, 1) }; }), (item) => item.pairId);
	result.active.separation = unique(list(a.separation, 105, (value) => { const item = object(value, ["pairId", "sourceJobId", "afterId", "scavIds", "credits", "receipts"]); const scavIds = unique(list(item.scavIds, 2, (value) => string(value)), (item) => item); if (scavIds.length !== 2) throw new Error("achievement-pair"); return { pairId: string(item.pairId), sourceJobId: string(item.sourceJobId), afterId: number(item.afterId, 1e12, 1), scavIds: scavIds as [string, string], credits: unique(list(item.credits, 2, (value) => { const credit = object(value, ["scavId", "jobId", "roomId", "work"]); return { scavId: string(credit.scavId), jobId: string(credit.jobId), roomId: string(credit.roomId), work: number(credit.work, 1e12, 0, false) }; }), (item) => item.scavId), receipts: unique(list(item.receipts, 2, (value) => { const receipt = object(value, ["scavId", "jobId", "roomId"]); return { scavId: string(receipt.scavId), jobId: string(receipt.jobId), roomId: string(receipt.roomId) }; }), (item) => item.scavId) }; }), (item) => item.pairId);
	result.active.credits = unique(list(a.credits, 128, (value) => { const item = object(value, ["jobId", "roomId", "required", "workers", "pairs"]); return { jobId: string(item.jobId), roomId: string(item.roomId), required: number(item.required, 1e12, 1), workers: unique(list(item.workers, 15, (value) => { const worker = object(value, ["id", "work"]); return { id: string(worker.id), work: number(worker.work, 1e12, 0, false) }; }), (item) => item.id), pairs: unique(list(item.pairs, 105, (value) => { const pair = object(value, ["id", "work", "penalty", "conflictWork"]); return { id: string(pair.id), work: number(pair.work, 1e12, 0, false), penalty: number(pair.penalty, 0, -0.1, false), conflictWork: number(pair.conflictWork, 1e12, 0, false) }; }), (item) => item.id) }; }), (item) => item.jobId);
	result.active.loot = unique(list(a.loot, 128, (value) => { const item = object(value, ["itemId", "raidId"]); return { itemId: string(item.itemId), raidId: string(item.raidId) }; }), (item) => item.itemId);
	return result;
}
export function validateAchievementState(state: GameState) {
	if (state.achievements.ammoVersion >= 1e12 || state.achievements.scrapVersion >= 1e12) throw new Error("achievement-version");
	const checkId = (value: string, prefix?: string) => { if (!/^(gun|scav|raid|report|gear|module|job)-[1-9]\d*$/.test(value) || prefix && !value.startsWith(`${prefix}-`) || sequence(value) >= state.nextId) throw new Error("achievement-source"); };
	const room = (id: string) => { if (!state.shelter.rooms.some((room) => room.id === id)) throw new Error("achievement-room"); };
	const pair = (id: string) => { if (!state.social.pairs.some((pair) => pair.id === id)) throw new Error("achievement-social"); };
	for (const evidence of Object.values(state.achievements.unlocked)) { if (evidence.at > state.lastUpdated || !evidence.sourceIds.length) throw new Error("achievement-evidence"); for (const source of evidence.sourceIds) checkId(source); }
	const a = state.achievements.active;
	for (const item of a.builds) { checkId(item.weapon.id, "gun"); for (const part of Object.values(item.weapon.modules)) checkId(part.id, "module"); if (!getWeaponStats(item.weapon).ready || item.weapon.modules.receiver?.durability !== item.weapon.durability || new Set(Object.values(item.weapon.modules).map((part) => part.id)).size !== Object.keys(item.weapon.modules).length) throw new Error("achievement-baseline"); }
	for (const item of a.magazines) { checkId(item.scavId, "scav"); checkId(item.gunId, "gun"); checkId(item.receiverId, "module"); checkId(item.partId, "module"); if (!Object.hasOwn(MAP_BY_ID, item.mapId) || item.version > state.achievements.ammoVersion) throw new Error("achievement-magazine"); }
	for (const item of a.transfers) { checkId(item.partId, "module"); checkId(item.receiverId, "module"); if (!Object.hasOwn(RECEIVER_INFO, item.weaponId)) throw new Error("achievement-platform"); }
	for (const item of a.inheritance) { checkId(item.receiverId, "module"); checkId(item.donorReceiverId, "module"); if (item.receiverId === item.donorReceiverId) throw new Error("achievement-donor"); for (const part of item.partIds) checkId(part, "module"); }
	for (const id of a.dual) { checkId(id, "raid"); if (!state.raids.some((raid) => raid.id === id && !raid.isAuto && raid.expedition && raid.expedition.stage >= 2)) throw new Error("achievement-dual"); }
	for (const item of a.radio) {
		checkId(item.raidId, "raid"); checkId(item.jobId, "job"); room(item.roomId);
		const raid = state.raids.find((raid) => raid.id === item.raidId), report = state.history.find((report) => report.raidId === item.raidId);
		if (!Object.hasOwn(MAP_BY_ID, item.mapId) || !state.shelter.rooms.some((room) => room.id === item.roomId && room.queue.some((job) => job.id === item.jobId)) || item.extracted && (raid || report && (!report.success || report.mapId !== item.mapId || report.scavName !== item.scavName || keys.some((key) => report.supplies[key] !== item.cargo[key]))) || !item.extracted && (!raid || raid.isAuto || raid.expedition?.status !== "choice" || raid.mapId !== item.mapId || raid.scavName !== item.scavName || keys.some((key) => raid.expedition!.cargo.supplies[key] !== item.cargo[key]))) throw new Error("achievement-paid-job");
	}
	for (const item of a.crafts) { checkId(item.sourceId); if (item.jobId) checkId(item.jobId, "job"); if (item.itemId) checkId(item.itemId); if (!item.jobId && !item.itemId) throw new Error("achievement-output"); }
	for (const item of a.recycle) { checkId(item.sourceId); if (item.version > state.achievements.scrapVersion || item.scrapAfter <= item.scrapBefore || item.discoveredWeapons.some((id) => !Object.hasOwn(RECEIVER_INFO, id) || !state.discoveredWeapons.includes(id)) || item.blueprints.some((id) => !Object.hasOwn(BLUEPRINTS, id) || !state.blueprints.includes(id))) throw new Error("achievement-recipe"); for (const entry of item.rooms) { room(entry.id); if (!state.shelter.rooms.some((room) => room.id === entry.id && room.type === "workshop" && room.level >= entry.level)) throw new Error("achievement-workshop"); } }
	for (const item of a.renovation) { room(item.roomId); checkId(item.jobId, "job"); checkId(item.workerId, "scav"); if (item.otherJobId) checkId(item.otherJobId, "job"); if (item.alternateJobId) checkId(item.alternateJobId, "job"); if (item.otherRoomId) room(item.otherRoomId); if (item.otherDone !== Boolean(item.otherJobId && item.otherRoomId) || item.returned && (!item.otherDone || !item.upgraded) || item.otherRoomId === item.roomId || item.returnWork && !item.returned || !item.alternateJobId && item.alternateWork) throw new Error("achievement-renovation"); }
	for (const item of a.fronts) { checkId(item.raidId, "raid"); checkId(item.supporterId, "scav"); if (item.jobId) checkId(item.jobId, "job"); if (item.workingJobId) checkId(item.workingJobId, "job"); if (!state.raids.some((raid) => raid.id === item.raidId && !raid.isAuto) || !item.workingJobId && item.work) throw new Error("achievement-front"); }
	for (const item of a.conflicts) { pair(item.pairId); checkId(item.jobId, "job"); if (item.penalty >= 0) throw new Error("achievement-conflict"); }
	for (const item of a.peace) { pair(item.pairId); checkId(item.sourceJobId, "job"); if (item.penalty >= 0 || item.afterId > state.nextId) throw new Error("achievement-peace"); }
	for (const item of a.separation) { pair(item.pairId); checkId(item.sourceJobId, "job"); if (item.afterId > state.nextId || !state.social.pairs.some((pair) => pair.id === item.pairId && pair.scavIds.every((id) => item.scavIds.includes(id)))) throw new Error("achievement-separation"); for (const entry of [...item.credits, ...item.receipts]) { checkId(entry.scavId, "scav"); checkId(entry.jobId, "job"); room(entry.roomId); if (!item.scavIds.includes(entry.scavId) || "work" in entry && typeof entry.work === "number" && entry.work <= 0) throw new Error("achievement-worker"); } }
	for (const item of a.credits) { checkId(item.jobId, "job"); room(item.roomId); const job = state.shelter.rooms.find((room) => room.id === item.roomId)?.queue.find((job) => job.id === item.jobId); if (!job || job.workRequired !== item.required) throw new Error("achievement-credit-job"); for (const worker of item.workers) { checkId(worker.id, "scav"); if (worker.work <= 0 || worker.work > job.workDone) throw new Error("achievement-credit"); } for (const entry of item.pairs) { pair(entry.id); const people = state.social.pairs.find((pair) => pair.id === entry.id)!.scavIds; if (entry.work <= 0 || entry.work > job.workDone || entry.conflictWork > entry.work || (entry.penalty < 0) !== (entry.conflictWork > 0) || people.some((id) => !item.workers.some((worker) => worker.id === id && worker.work >= entry.work))) throw new Error("achievement-credit"); } }
	for (const item of a.loot) { checkId(item.itemId); checkId(item.raidId, "raid"); }
}
export function rebaseAchievementClock(state: GameState, shift: number) {
	for (const id of ACHIEVEMENTS.map((item) => item.id)) { const evidence = state.achievements.unlocked[id]; if (evidence) state.achievements.unlocked[id] = Object.freeze({ ...evidence, at: Math.max(0, evidence.at - shift) }); }
}
