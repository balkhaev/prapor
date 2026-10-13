import { CONTRACTS, MAPS, MAP_BY_ID, type Contract, type RaidMap, type Supplies } from "./game/data";
import {
	GEAR_MODELS, GEAR_MODEL_BY_ID, MODULE_MODELS, RESOURCE_RECIPES, ROOM_DEFINITIONS, getContractLockReason, getContractProgress, getGearCraftReason,
	getMarketReason, getModuleCapacity, getModuleProductionQuote, getRaidGroup, getRaidGroupKey, getRaidQuote, getResourceProductionQuote,
	getRoomProductionState, getWeaponStats, getWorkerAssignmentReason, xpForLevel,
	type GameState, type Raid, type RoomInstance, type Scav,
} from "./game/engine";
import { getCommandSummary } from "./command-summary";

export interface GameplayBeat { contractId: string; title: string; purpose: string; mapId?: string }
export const GAMEPLAY_BEATS: readonly GameplayBeat[] = [
	{ contractId: "first-return", title: "Первый выход", purpose: "Отправь одного готового бойца во Дворы. На контрольной точке реши, пора ли эвакуировать груз.", mapId: "courtyard" },
	{ contractId: "working-shelter", title: "Убежище в деле", purpose: "Преврати часть добычи в снабжение: один работник, одна оплаченная партия и доставка на склад." },
	{ contractId: "gear-ready", title: "Подготовка отряда", purpose: "Снаряди бойцов бронёй и рюкзаками: защита помогает выжить, вместимость определяет, сколько груза можно вынести." },
	{ contractId: "depot-route", title: "Снабжение через депо", purpose: "Закрепи маршрут в Депо: три успешные эвакуации. Между выходами проверяй здоровье, оружие и расход припасов.", mapId: "depot" },
	{ contractId: "forest-line", title: "Тихая линия", purpose: "Освой Лесополосу: четыре успешные эвакуации. Разведданные и выбранный путь становятся частью подготовки.", mapId: "forest" },
	{ contractId: "factory-route", title: "Заводская линия", purpose: "Вернись с Завода три раза. Более опасный сектор требует осмысленной сборки и запаса на выход.", mapId: "factory" },
	{ contractId: "reserve-route", title: "Военный резерв", purpose: "Освой Резерв: три успешные эвакуации. Сравни ценность груза с риском следующего этапа.", mapId: "reserve" },
	{ contractId: "bunker-route", title: "Связь с Бункером-7", purpose: "Эвакуируй груз из Бункера-7 и заверши освоение секторов. Дальше выбирай собственные цели и сборки.", mapId: "bunker" },
];

export interface GameplayAction {
	kind: "raid" | "scav" | "room" | "market" | "arsenal" | "contracts" | "recruits" | "watch";
	label: string;
	detail: string;
	mapId?: string;
	scavId?: string;
	roomId?: string;
	tab?: "staff" | "production" | "upgrade";
	raidId?: string;
	contractId?: string;
}
export interface GameplayGuidance {
	campaign: {
		index: number; total: number; title: string; purpose: string; contractId: string | null;
		progress: number; target: number; completed: boolean; reward: { money: number; xp: number }; nextTitle: string | null;
	};
	phase: "prepare" | "raid" | "decision" | "invest";
	action: GameplayAction;
	steps: { label: string; detail: string }[];
}
type NextStep = Pick<GameplayGuidance, "phase" | "action">;
type RaidOption = { map: RaidMap; scav: Scav; quote: ReturnType<typeof getRaidQuote> };
const step = (phase: GameplayGuidance["phase"], action: GameplayAction): NextStep => ({ phase, action });
const roomOrder = (a: RoomInstance, b: RoomInstance) => a.row - b.row || a.column - b.column || a.id.localeCompare(b.id);
const fighterOrder = (a: Scav, b: Scav) => b.health - a.health || b.combat - a.combat || a.id.localeCompare(b.id);

/** A later claim predating the production chapter keeps a veteran's place in the campaign. */
function beatPassed(state: GameState, beat: GameplayBeat): boolean {
	return state.claimedContracts.includes(beat.contractId) || beat.contractId === "working-shelter"
		&& GAMEPLAY_BEATS.slice(2).some((later) => state.claimedContracts.includes(later.contractId));
}
function rewardStep(contract: Contract): NextStep {
	return step("invest", { kind: "contracts", contractId: contract.id, label: "Получить награду", detail: `«${contract.name}» выполнено: ${contract.reward.money} ₽ и ${contract.reward.xp} опыта. Получи награду, чтобы закрепить этап.` });
}
function raidRepresentatives(state: GameState): Raid[] {
	const groups = new Map<string, Raid>();
	for (const raid of [...state.raids].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))) {
		const key = getRaidGroupKey(raid);
		if (!groups.has(key)) groups.set(key, state.raids.find((member) => member.id === key) ?? raid);
	}
	return [...groups.values()];
}
function checkpointReady(state: GameState, raid: Raid): boolean {
	const group = getRaidGroup(state, raid);
	return (!raid.squad || group.length === raid.squad.members.length) && group.every((member) => member.expedition?.status === "choice");
}
function watchStep(raid: Raid, decision: boolean): NextStep {
	return step(decision ? "decision" : "raid", {
		kind: "watch", raidId: raid.id, mapId: raid.mapId,
		label: decision ? "Решить судьбу груза" : "Наблюдать рейд",
		detail: decision ? "Контрольная точка: эвакуация закрепляет найденный груз. Продолжение расходует припасы и оставляет весь груз под риском."
			: "Бойцы идут к контрольной точке. Следующий приказ — выбрать продолжение или эвакуацию; исход выхода заранее неизвестен.",
	});
}
function paidBlocker(state: GameState): NextStep | null {
	const command = getCommandSummary(state).attention.find((item) => {
		const room = state.shelter.rooms.find((target) => target.id === item.roomId);
		return Boolean(room?.queue.length && (item.kind === "capacity" || item.kind === "workers"));
	});
	return command ? step("invest", { kind: "room", roomId: command.roomId, tab: command.tab ?? "production", label: command.cta ?? "Проверить оплаченный заказ", detail: `${command.title}. ${command.detail} Оплаченная партия сохраняется.` }) : null;
}
function recoveryStep(state: GameState): NextStep | null {
	if (!state.scavs.length) return step("prepare", { kind: "recruits", label: "Восстановить отряд", detail: "Прими бесплатного бойца у связных. После найма проверь его оружие и подготовь новый выход." });
	const home = state.scavs.filter((scav) => scav.status !== "raiding").sort(fighterOrder);
	if (!home.length || home.some((scav) => scav.health >= 25)) return null;
	const scav = home[0]!;
	const medicine = Math.ceil((100 - scav.health) / (25 + state.base.medbay * 5));
	return step("prepare", { kind: "scav", scavId: scav.id,
		label: state.supplies.medicine >= medicine ? "Восстановить бойца" : "Проверить восстановление",
		detail: state.supplies.medicine >= medicine ? `${scav.name}: выход доступен со здоровьем от 25%. Полное лечение стоит ${medicine} медикаментов; можно подождать бесплатного восстановления.`
			: `${scav.name}: нужно дождаться минимальных 25% здоровья. Бесплатное восстановление идёт в убежище; для полного лечения нужно ${medicine} медикаментов.`,
	});
}
function raidOptions(state: GameState, maps: readonly RaidMap[]): RaidOption[] {
	return maps.flatMap((map) => state.scavs.filter((scav) => scav.status !== "raiding").map((scav) => ({ map, scav, quote: getRaidQuote(state, scav, map) })))
		.sort((a, b) => b.map.level - a.map.level || b.quote.chance - a.quote.chance || fighterOrder(a.scav, b.scav));
}
function readyRaidStep(option: RaidOption, detail?: string): NextStep {
	const { map, scav, quote } = option;
	return step("prepare", { kind: "raid", mapId: map.id, scavId: scav.id, label: `Подготовить выход: ${map.name}`,
		detail: `${detail ? `${detail} ` : ""}${scav.name}: ${quote.money} ₽, ${quote.ammo} патронов${quote.intel ? `, ${quote.intel} разведданных` : ""}${quote.medicine ? `, ${quote.medicine} медикамент` : ""}. Проверь комплект и отправь одного бойца. На контрольной точке можно эвакуироваться.`,
	});
}
function resourceStep(state: GameState, supply: keyof Supplies, reason: string): NextStep {
	if (getMarketReason(state, supply) === null) return step("prepare", { kind: "market", label: "Пополнить снабжение", detail: `${reason} На рынке есть доступная партия; проверь цену и место на складе перед покупкой.` });
	const recipe = RESOURCE_RECIPES.find((item) => item.output[supply] > 0);
	const room = recipe && [...state.shelter.rooms].sort(roomOrder).find((item) => item.type === recipe.roomType && item.status === "ready");
	if (room && recipe && state.money >= recipe.cost.money && (Object.keys(recipe.cost.supplies) as (keyof Supplies)[]).every((key) => state.supplies[key] >= recipe.cost.supplies[key])) {
		const production = getRoomProductionState(state, room);
		return step("invest", { kind: "room", roomId: room.id, tab: production.rate ? "production" : "staff", label: production.rate ? "Проверить производство припасов" : "Назначить работника", detail: `${reason} ${ROOM_DEFINITIONS[room.type].label}: ${room.queue.length ? "оплаченная партия уже в очереди" : `рецепт «${recipe.label}»`}. Проверь людей, заказ и свободное место.` });
	}
	return step("prepare", { kind: "market", label: "Проверить снабжение", detail: `${reason} Сейчас покупка недоступна. Базовое снабжение постепенно пополняет патроны, детали и разведданные; рубли восстанавливаются до резервного лимита. Можно продать лишнее в арсенале.` });
}
function blockedRaidStep(state: GameState, map: RaidMap): NextStep {
	const options = raidOptions(state, [map]);
	const option = options.find(({ scav }) => scav.health >= 25 && !scav.assignment) ?? options[0];
	if (!option) return recoveryStep(state) ?? step("prepare", { kind: "recruits", label: "Открыть отряд", detail: "Нужен доступный боец для следующего выхода." });
	const { scav, quote } = option;
	if (scav.assignment) return step("prepare", { kind: "room", roomId: scav.assignment, scavId: scav.id, tab: "staff", label: "Освободить бойца для рейда", detail: `${scav.name} работает в убежище. Освободи одного бойца, сохранив работников у оплаченных заказов.` });
	if (scav.health < 25) return recoveryStep(state)!;
	const gun = state.weapons.find((weapon) => weapon.id === scav.weaponInstanceId);
	if (!gun) return step("prepare", { kind: "scav", scavId: scav.id, label: "Выдать бойцу оружие", detail: `${scav.name}: ${quote.reason ?? "нужно свободное исправное оружие"} Выбери пушку в его комплекте; последнюю готовую сборку сохрани для выходов.` });
	if (!getWeaponStats(gun).ready) return step("prepare", { kind: "arsenal", scavId: scav.id, label: "Подготовить исправное оружие", detail: `${scav.name}: ${quote.reason ?? "пушка не готова"} Проверь ремонт и обязательные детали либо выдай другую готовую пушку.` });
	if (state.money < quote.money) return step("prepare", { kind: "arsenal", label: "Проверить резерв на выход", detail: `${quote.reason} Продай лишние трофеи, сохранив готовую пушку. При малом запасе рубли постепенно восстанавливаются до резервного лимита.` });
	if (state.supplies.ammo < quote.ammo) return resourceStep(state, "ammo", quote.reason!);
	if (state.supplies.intel < quote.intel) return resourceStep(state, "intel", quote.reason!);
	if (state.supplies.medicine < quote.medicine) return step("prepare", { kind: "scav", scavId: scav.id, label: "Проверить личную аптечку", detail: `${quote.reason} Пополни медикаменты или сними аптечку с комплекта; без неё выход возможен, но полевой перевязки не будет.` });
	return step("prepare", { kind: "scav", scavId: scav.id, label: "Проверить готовность бойца", detail: quote.reason ?? "Проверь здоровье, оружие и комплект перед следующим выходом." });
}
/** Hypothetical staffing uses the real quote without changing ownership, money or orders. */
function productionPreview(state: GameState, room: RoomInstance): GameState {
	if (getRoomProductionState(state, room).rate > 0 || room.status !== "ready") return state;
	const worker = state.scavs.filter((scav) => !getWorkerAssignmentReason(state, scav.id, room.id)).sort((a, b) => Number(Boolean(a.assignment)) - Number(Boolean(b.assignment)) || fighterOrder(a, b))[0];
	if (!worker) return state;
	return { ...state, scavs: state.scavs.map((scav) => scav.id === worker.id ? { ...scav, assignment: room.id } : scav), shelter: { ...state.shelter,
		rooms: state.shelter.rooms.map((candidate) => ({ ...candidate, workerIds: candidate.id === room.id ? [...candidate.workerIds.filter((id) => id !== worker.id), worker.id] : candidate.workerIds.filter((id) => id !== worker.id) })),
	} };
}
function productionStep(state: GameState): NextStep {
	const rooms = [...state.shelter.rooms].sort(roomOrder);
	const suitable = rooms.filter((room) => room.type === "medbay" || room.type === "radio");
	const candidates = suitable.map((room) => {
		const recipe = RESOURCE_RECIPES.find((item) => item.id === room.recipeId) ?? RESOURCE_RECIPES.find((item) => item.roomType === room.type)!;
		return { room, recipe, quote: getResourceProductionQuote(productionPreview(state, room), room.id, recipe.id) };
	});
	const existing = rooms.find((room) => room.queue.length) ?? candidates.find((candidate) => candidate.room.recipeId && (candidate.room.pending || candidate.room.repeat) && !candidate.quote.reason)?.room;
	const feasible = candidates.filter((candidate) => candidate.quote.reason === null).sort((a, b) => Number(Boolean(b.room.workerIds.length)) - Number(Boolean(a.room.workerIds.length)));
	if (!existing && !feasible.length && candidates.length && candidates.every((candidate) => candidate.quote.reason?.includes("нет места"))) {
		const workshop = rooms.find((room) => room.type === "workshop" && room.status === "ready");
		const model = workshop && state.modules.length < getModuleCapacity(state) ? [...MODULE_MODELS].sort((a, b) => a.craftCost.money - b.craftCost.money || a.id.localeCompare(b.id))
			.find((item) => getModuleProductionQuote(state, workshop.id, item.id).reason === null) : undefined;
		if (workshop && model) return step("invest", { kind: "room", roomId: workshop.id, tab: getRoomProductionState(state, workshop).rate ? "production" : "staff",
			label: getRoomProductionState(state, workshop).rate ? "Заказать оружейный модуль" : "Назначить работника мастерской",
			detail: `Склад припасов полон. Первой партией может стать «${model.label}» в мастерской: ${model.craftCost.money} ₽ и ${model.craftCost.scrap} деталей. Назначь одного работника и дождись доставки модуля.`,
		});
		return step("invest", { kind: "room", roomId: candidates[0]!.room.id, tab: "production", label: "Освободить место для партии", detail: "Склад припасов полон. Потрать припасы на лечение или комплект, освободи место либо увеличь склад. До этого новая партия не оплачивается." });
	}
	const room = existing ?? feasible[0]?.room ?? suitable.find((candidate) => candidate.status === "ready") ?? suitable[0];
	if (!room) return step("invest", { kind: "room", tab: "upgrade", label: "Подготовить производство", detail: "Для первой партии нужен медблок или радиорубка. Построй помещение, назначь работника и выбери доступный рецепт." });
	const production = getRoomProductionState(state, room);
	if (room.status !== "ready") return step("invest", { kind: "room", roomId: room.id, tab: "upgrade", label: "Проверить готовность помещения", detail: `${ROOM_DEFINITIONS[room.type].label} ещё строится или улучшается. После завершения станут доступны работники и заказ.` });
	if (production.job) return step("invest", { kind: "room", roomId: room.id, tab: "production", label: "Проверить первую партию", detail: `${ROOM_DEFINITIONS[room.type].label}: оплаченный заказ уже в очереди. ${production.reason ?? "Работники готовят партию."} Этап засчитывается после доставки на склад.` });
	if (!production.rate) return step("invest", { kind: "room", roomId: room.id, tab: "staff", label: "Назначить одного работника", detail: `${ROOM_DEFINITIONS[room.type].label}: назначь здорового бойца с показателем от 25%, затем выбери одну партию. Остальных можно оставить для рейдов.` });
	const recipe = RESOURCE_RECIPES.find((candidate) => candidate.id === room.recipeId) ?? RESOURCE_RECIPES.find((candidate) => candidate.roomType === room.type);
	if (!recipe) return step("invest", { kind: "room", roomId: room.id, tab: "production", label: "Выбрать заказ", detail: "Выбери один доступный модуль: материалы списываются при постановке заказа, прогресс засчитывается после доставки." });
	const quote = getResourceProductionQuote(state, room.id, recipe.id);
	if (quote.reason && state.money < quote.money) {
		const ready = raidOptions(state, MAPS.filter((map) => map.level <= state.level)).find((option) => !option.quote.reason);
		if (ready) return readyRaidStep(ready, `На первую партию нужно ${quote.money} ₽. Успешная эвакуация может пополнить запас.`);
	}
	if (quote.reason && (Object.keys(quote.supplies) as (keyof Supplies)[]).some((key) => state.supplies[key] < quote.supplies[key])) {
		const missing = (Object.keys(quote.supplies) as (keyof Supplies)[]).find((key) => state.supplies[key] < quote.supplies[key])!;
		return resourceStep(state, missing, `Для «${recipe.label}» не хватает припасов.`);
	}
	return step("invest", { kind: "room", roomId: room.id, tab: "production", label: quote.reason ? "Проверить первую партию" : "Заказать первую партию", detail: quote.reason ?? `${ROOM_DEFINITIONS[room.type].label}: «${recipe.label}», ${recipe.description} Достаточно одной партии: повторение выбираешь сам.` });
}
function kitStep(state: GameState): NextStep {
	const home = state.scavs.filter((scav) => scav.status !== "raiding").sort(fighterOrder);
	const wearer = (slot: "armor" | "backpack") => home.find((scav) => {
		const itemId = slot === "armor" ? scav.loadout.armorItemId : scav.loadout.backpackItemId;
		const item = state.gearItems.find((gear) => gear.id === itemId);
		return !item || GEAR_MODEL_BY_ID[item.modelId]?.slot !== slot;
	});
	const assigned = new Set(state.scavs.flatMap((scav) => [scav.loadout.armorItemId, scav.loadout.backpackItemId]));
	const owned = state.gearItems.find((item) => !assigned.has(item.id) && (GEAR_MODEL_BY_ID[item.modelId]?.slot === "armor" || GEAR_MODEL_BY_ID[item.modelId]?.slot === "backpack")
		&& wearer(GEAR_MODEL_BY_ID[item.modelId]!.slot as "armor" | "backpack"));
	if (owned) {
		const model = GEAR_MODEL_BY_ID[owned.modelId]!;
		return step("invest", { kind: "scav", scavId: wearer(model.slot as "armor" | "backpack")!.id, label: "Выдать готовое снаряжение", detail: `«${model.label}» уже на стойке. Выдай предмет бойцу в его комплекте: повторная покупка не нужна.` });
	}
	const craftable = [...GEAR_MODELS].filter((model) => (model.slot === "armor" || model.slot === "backpack") && wearer(model.slot) && !getGearCraftReason(state, model.id))
		.sort((a, b) => a.money - b.money || a.id.localeCompare(b.id))[0];
	if (craftable) return step("invest", { kind: "scav", scavId: wearer(craftable.slot as "armor" | "backpack")!.id, label: "Снарядить бойца", detail: `В комплекте бойца изготовь и выдай «${craftable.label}»: ${craftable.money} ₽ и ${craftable.scrap} деталей. Физические броня и рюкзаки учитываются вместе с уровнями личной подготовки.` });
	const ready = raidOptions(state, MAPS.filter((map) => map.level <= state.level)).find((option) => !option.quote.reason);
	if (ready) return readyRaidStep(ready, "Для нового снаряжения сейчас не хватает ресурсов или свободного места. Успешная эвакуация может пополнить запас; проверь стойку после выхода.");
	const blocked = blockedRaidStep(state, MAPS[0]!);
	return { ...blocked, action: { ...blocked.action, detail: `Для подготовки комплекта нужны ресурсы. ${blocked.action.detail}` } };
}
function campaignStep(state: GameState, beat: GameplayBeat | undefined, contract: Contract | undefined): NextStep {
	if (contract) {
		const predecessor = (contract.requires ?? []).map((id) => CONTRACTS.find((candidate) => candidate.id === id)).find((candidate) => candidate && !state.claimedContracts.includes(candidate.id));
		if (predecessor) return getContractLockReason(state, predecessor) === null && getContractProgress(state, predecessor) >= predecessor.target ? rewardStep(predecessor)
			: campaignStep(state, GAMEPLAY_BEATS.find((candidate) => candidate.contractId === predecessor.id), predecessor);
	}
	const targetMap = beat?.mapId ? MAP_BY_ID[beat.mapId] : undefined;
	const targetLevel = Math.max(contract?.level ?? 1, targetMap?.level ?? 1);
	if (state.level < targetLevel) {
		const detail = `Следующий сектор открывается на ${targetLevel} уровне. Сейчас ${state.level}; нужно ещё ${Math.max(0, xpForLevel(targetLevel) - state.xp)} опыта. Добывай опыт в открытых секторах.`;
		const ready = raidOptions(state, MAPS.filter((map) => map.level <= state.level)).find((option) => !option.quote.reason);
		if (ready) return readyRaidStep(ready, detail);
		const blocked = blockedRaidStep(state, MAPS.find((map) => map.level <= state.level)!);
		return { ...blocked, action: { ...blocked.action, detail: `${detail} ${blocked.action.detail}` } };
	}
	if (beat?.contractId === "working-shelter") return productionStep(state);
	if (beat?.contractId === "gear-ready") return kitStep(state);
	const maps = targetMap ? [targetMap] : MAPS.filter((map) => map.level <= state.level);
	const ready = raidOptions(state, maps).find((option) => !option.quote.reason);
	return ready ? readyRaidStep(ready) : blockedRaidStep(state, targetMap ?? MAPS[0]!);
}

/** Deterministic navigation advice only: never advances time, pays, claims or issues orders. */
export function getGameplayGuidance(state: GameState): GameplayGuidance {
	const index = GAMEPLAY_BEATS.findIndex((beat) => !beatPassed(state, beat));
	const beat = index < 0 ? undefined : GAMEPLAY_BEATS[index]!;
	const contract = CONTRACTS.find((candidate) => candidate.id === beat?.contractId);
	const campaign: GameplayGuidance["campaign"] = {
		index: index < 0 ? GAMEPLAY_BEATS.length : index + 1, total: GAMEPLAY_BEATS.length,
		title: beat?.title ?? "Свои маршруты", purpose: beat?.purpose ?? "Все секторы освоены. Собирай оружие, развивай убежище и выбирай риск каждого следующего выхода.",
		contractId: contract?.id ?? null, progress: contract ? Math.min(contract.target, getContractProgress(state, contract)) : GAMEPLAY_BEATS.length,
		target: contract?.target ?? GAMEPLAY_BEATS.length, completed: index < 0,
		reward: { money: contract?.reward.money ?? 0, xp: contract?.reward.xp ?? 0 }, nextTitle: index < 0 ? null : GAMEPLAY_BEATS[index + 1]?.title ?? null,
	};
	const raids = raidRepresentatives(state);
	const checkpoint = raids.find((raid) => checkpointReady(state, raid));
	const reward = contract && !getContractLockReason(state, contract) && getContractProgress(state, contract) >= contract.target ? contract : undefined;
	const next = checkpoint ? watchStep(checkpoint, true) : reward ? rewardStep(reward)
		: recoveryStep(state) ?? paidBlocker(state) ?? (raids[0] ? watchStep(raids[0], false) : campaignStep(state, beat, contract));
	return { campaign, ...next, steps: [
		{ label: "Подготовка", detail: "Один готовый боец, исправное оружие, комплект и припасы на выход." },
		{ label: "Выход", detail: "Открытый сектор и наблюдение до контрольной точки." },
		{ label: "Решение", detail: "Эвакуировать груз или оплатить следующий этап и принять риск." },
		{ label: "Вложение", detail: "Разобрать результат, получить награды, восстановиться и выбрать одно улучшение." },
	] };
}
