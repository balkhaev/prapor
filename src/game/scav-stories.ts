import { MAP_BY_ID, type Supplies } from "./data";
import type { GameState, Scav, RaidReport, ActionResult } from "./engine";
import type { RecruitCandidate } from "./recruitment";
import { defaultScavAppearance } from "./scav-appearances";

export type ScavEventId = "arrival" | "first_return" | "shaken" | "deep_return" | "craftsman" | "trusted";
export type ScavMemoryKind = "joined" | "return" | "injury" | "deep_return" | "module" | "event" | "lost";
export interface ScavMemory {
	kind: ScavMemoryKind; at: number; sourceId: string | null; mapId: string | null;
	eventId: ScavEventId | null; choiceId: string | null;
}
export interface ScavStory {
	identityKey: string; joinedAt: number; bond: number; stress: number;
	counters: { wins: number; injuries: number; deepReturns: number; modules: number; batches: number };
	memories: ScavMemory[];
	pending: { eventId: ScavEventId; at: number; sourceId: string | null; mapId: string | null } | null;
	completedEvents: ScavEventId[];
}
export interface ScavMemorial {
	id: string; name: string; personality: string; profile: Scav["profile"]; story: ScavStory;
	appearance: number;
	at: number; mapId: string; raidId: string; level: number; xp: number; raids: number;
}
export interface ScavIdentity {
	realName: string; age: number; profession: string; habit: string; motive: string; keepsake: string;
	quote: string; temperament: string; temperamentDescription: string; gender: "male" | "female";
}
export interface ScavEventChoice {
	id: string; label: string; description: string;
	cost: { money: number; supplies: Supplies }; effects: { bond: number; stress: number };
	effectLabel: string; reason: string | null;
}
export interface ScavPersonalEvent {
	id: ScavEventId; title: string; text: string; quote: string; at: number; choices: ScavEventChoice[];
}

export const SCAV_STORY_EVENTS: readonly ScavEventId[] = ["arrival", "first_return", "shaken", "deep_return", "craftsman", "trusted"];
export const MAX_SCAV_MEMORIES = 12;
export const MAX_SCAV_MEMORIALS = 20;
const emptySupplies = (): Supplies => ({ ammo: 0, medicine: 0, scrap: 0, intel: 0 });
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const hash = (key: string) => {
	let value = 0x811c9dc5;
	for (const character of key) value = Math.imul(value ^ character.charCodeAt(0), 0x01000193);
	return value >>> 0;
};
const pick = <T>(values: readonly T[], key: string, salt: string): T => values[hash(`${key}:${salt}`) % values.length]!;
const realNames = ["Алексей Котов", "Денис Грачёв", "Михаил Серов", "Илья Белов", "Павел Зимин", "Роман Нечаев", "Сергей Лапин", "Антон Власов", "Виктор Мельников", "Никита Савин", "Олег Крылов", "Андрей Горин", "Юрий Чернов", "Иван Тихонов", "Тимур Волков", "Евгений Фомин", "Максим Орлов", "Константин Руднев", "Глеб Астахов", "Василий Круглов", "Аркадий Семёнов", "Леонид Борисов", "Вадим Шестаков", "Ярослав Ким"] as const;
const femaleNames = ["Александра Котова", "Дарья Грачёва", "Мария Серова", "Ирина Белова", "Полина Зимина", "Раиса Нечаева", "Светлана Лапина", "Анна Власова", "Вера Мельникова", "Нина Савина", "Ольга Крылова", "Алёна Горина", "Юлия Чернова", "Инна Тихонова", "Татьяна Волкова", "Евгения Фомина", "Марина Орлова", "Ксения Руднева", "Галина Астахова", "Валентина Круглова", "Арина Семёнова", "Лидия Борисова", "Виктория Шестакова", "Яна Ким"] as const;
const femaleAppearances = new Set([1, 5, 9, 12, 14, 16, 19, 21, 23, 25, 28]);
const professions: Record<string, readonly string[]> = {
	veteran: ["водитель школьного автобуса", "ночной охранник", "пожарный", "инкассатор", "мастер путей", "инструктор в тире"],
	runner: ["велокурьер", "почтальон", "электромонтёр", "проводник электрички", "таксист", "лесник"],
	collector: ["часовщик", "слесарь депо", "учитель труда", "радиомеханик", "печник", "мастер холодильников"],
	careful: ["фельдшер", "библиотекарь", "диспетчер", "ветеринар", "архивист", "лаборант"],
};
const femaleProfessions: Record<string, readonly string[]> = {
	veteran: ["водитель школьного автобуса", "ночная охранница", "пожарная", "инкассатор", "мастер путей", "инструктор в тире"],
	runner: ["велокурьер", "почтальон", "электромонтёр", "проводница электрички", "таксист", "лесничая"],
	collector: ["часовщица", "слесарь депо", "учительница труда", "радиомеханик", "печница", "мастер холодильников"],
	careful: ["фельдшер", "библиотекарь", "диспетчер", "ветеринар", "архивист", "лаборантка"],
};
const habits = ["выравнивает кружки на столе", "считает ступени вполголоса", "напевает одну строчку старой песни", "рисует карты на обороте упаковок", "берёт чай только в своей кружке", "проверяет узлы на чужих рюкзаках", "разговаривает с неисправной техникой", "прячет последний сухарь на потом", "никогда не садится спиной к двери", "чинит пуговицы соседям по койке", "записывает имена в маленький блокнот", "делится последней сигаретой, даже не куря"] as const;
const temperaments = [
	{ label: "Тихий заботливый", description: "Не любит громких обещаний. Запоминает, кто посидел рядом в трудную ночь.", quote: "Пока есть с кем делить чай, это ещё дом." },
	{ label: "Упрямый мастер", description: "Показывает привязанность делом. Ценит доверие не только к оружию, но и к своим решениям.", quote: "Не выбрасывай. Дай мне десять минут и нормальный свет." },
	{ label: "Сухой шутник", description: "Шутит, когда страшно. Не любит, когда за шутками не замечают настоящих чувств.", quote: "Вернусь раньше — чай за мной. Если позже, тоже." },
	{ label: "Осторожный мечтатель", description: "Проверяет всё дважды, но строит планы на жизнь после этого места.", quote: "Мне бы однажды выйти отсюда без оружия. Просто погулять." },
	{ label: "Прямой защитник", description: "Резко говорит и первым подставляет плечо. Ценит честный ответ больше утешения.", quote: "Скажи, что ждёшь обратно. Этого хватит." },
	{ label: "Сдержанный одиночка", description: "Рассчитывает на себя. Своими считает тех, кто не торопит с откровенностью.", quote: "Ключ оставлю на крючке. Значит, собираюсь вернуться." },
] as const;
const motives = [
	{ motive: "найти младшего брата, от которого осталась одна радиочастота", keepsake: "самодельный брелок брата", lastWords: "Если услышите эту частоту — скажите, что я не переставал искать." },
	{ motive: "собрать безопасный дом для людей со своего двора", keepsake: "ключ от квартиры, которой больше нет", lastWords: "Ключ на крючке оставьте. Вдруг кому-то ещё пригодится дом." },
	{ motive: "восстановить старую мастерскую и снова учить ремеслу", keepsake: "потёртая мерная линейка наставника", lastWords: "Станок не бросайте. Хорошая вещь переживёт нас обоих." },
	{ motive: "выбраться к морю, которое пока видел только на открытке", keepsake: "выцветшая открытка с маяком", lastWords: "У маяка, говорят, всегда светло. Когда-нибудь проверьте за меня." },
	{ motive: "вернуть долг людям, однажды вытащившим из огня", keepsake: "оплавленная металлическая пуговица", lastWords: "Сегодня моя очередь прикрывать. Идите, я вас догоню." },
	{ motive: "сохранить имена пропавших, чтобы они не стали просто цифрами", keepsake: "блокнот с именами и пустыми страницами", lastWords: "Имя запишите правильно. И не забудьте остальных." },
] as const;

function identityFor(key: string, personality: string, appearance?: number): ScavIdentity {
	const temperament = pick(temperaments, key, "temperament"), purpose = pick(motives, key, "purpose");
	const female = femaleAppearances.has(appearance ?? -1);
	const femaleTemperaments: Record<string, string> = { "Тихий заботливый": "Тихая заботливая", "Упрямый мастер": "Упрямая мастерица", "Сухой шутник": "Ироничная", "Осторожный мечтатель": "Осторожная мечтательница", "Прямой защитник": "Прямолинейная защитница", "Сдержанный одиночка": "Сдержанная одиночка" };
	return { realName: pick(female ? femaleNames : realNames, key, "name"), age: [0, 5, 25, 27].includes(appearance ?? -1) ? 43 + hash(`${key}:age`) % 18 : 23 + hash(`${key}:age`) % 30,
		profession: pick((female ? femaleProfessions : professions)[personality] ?? professions.careful!, key, "profession"), habit: pick(habits, key, "habit"),
		motive: female ? purpose.motive.replace("пока видел", "пока видела") : purpose.motive, keepsake: purpose.keepsake, quote: temperament.quote,
		temperament: female ? femaleTemperaments[temperament.label]! : temperament.label, temperamentDescription: female ? temperament.description.replace("первым", "первой") : temperament.description, gender: female ? "female" : "male" };
}
export function getScavIdentity(scav: Pick<Scav, "id" | "personality" | "story"> & { appearance?: number }): ScavIdentity {
	return identityFor(scav.story.identityKey, scav.personality, scav.appearance ?? defaultScavAppearance(scav.personality));
}
export function getRecruitCandidateIdentity(candidate: RecruitCandidate, state?: Pick<GameState, "nextId">): ScavIdentity {
	const key = candidate.id === "recruit-recovery" && state ? `recovery:scav-${state.nextId}` : candidate.id;
	return identityFor(key, { assault: "veteran", scout: "runner", technician: "collector" }[candidate.role], candidate.appearance);
}

export function createScavStory(identityKey: string, now: number, arrival: boolean): ScavStory {
	return { identityKey, joinedAt: now, bond: 20, stress: 0, counters: { wins: 0, injuries: 0, deepReturns: 0, modules: 0, batches: 0 },
		memories: [{ kind: "joined", at: now, sourceId: null, mapId: null, eventId: null, choiceId: null }],
		pending: arrival ? { eventId: "arrival", at: now, sourceId: null, mapId: null } : null, completedEvents: [] };
}

function pushMemory(story: ScavStory, memory: ScavMemory) {
	story.memories.push(memory);
	// The six decisions are personal history and also the provenance of saved modifiers.
	// Keep them; ordinary memories occupy the remaining places in chronological order.
	while (story.memories.length > MAX_SCAV_MEMORIES) {
		const removable = story.memories.findIndex((entry) => entry.kind !== "event");
		story.memories.splice(removable < 0 ? 0 : removable, 1);
	}
}
type ChoiceDefinition = Omit<ScavEventChoice, "reason" | "effectLabel">;
const choice = (id: string, label: string, description: string, money: number, supplies: Partial<Supplies>, bond: number, stress: number): ChoiceDefinition =>
	({ id, label, description, cost: { money, supplies: { ...emptySupplies(), ...supplies } }, effects: { bond, stress } });
const choices: Record<ScavEventId, readonly ChoiceDefinition[]> = {
	arrival: [choice("welcome", "Поставить вторую кружку", "Устроить тёплый вечер и выслушать личную историю.", 35, {}, 10, -2),
		choice("space", "Дать освоиться", "Показать койку, оставить место для личной вещи и не расспрашивать.", 0, {}, 4, 0)],
	first_return: [choice("share", "Отложить личную долю", "Отдать часть выручки на личную цель бойца — без обещаний будущих наград.", 55, {}, 12, -5),
		choice("toast", "Встретить всем отрядом", "Выслушать рассказ о вылазке и отметить возвращение за общим столом.", 0, {}, 5, -2)],
	shaken: [choice("care", "Помочь пережить ночь", "Выделить лекарства, тихое место и время, чтобы он рассказал о случившемся.", 0, { medicine: 2 }, 8, -18),
		choice("listen", "Посидеть рядом", "Ничего не требовать и слушать. Без лекарств восстановление душевных сил будет скромнее.", 0, {}, 4, -7)],
	deep_return: [choice("signal", "Проверить личный след", "Потратить разведданные на зацепку, связанную с его прежней жизнью.", 25, { intel: 2 }, 12, -9),
		choice("promise", "Сохранить зацепку", "Вклеить находку в его досье. Поиски могут подождать, главное — он вернулся.", 0, {}, 5, -3)],
	craftsman: [choice("tools", "Собрать личный набор", "Отдать хорошие инструменты, чтобы у станка появилось место с его именем.", 35, { scrap: 3 }, 12, -8),
		choice("mark", "Поставить личное клеймо", "Признать работу мастера: первая удачная деталь останется в памяти отряда.", 0, {}, 6, -2)],
	trusted: [choice("home", "Помочь с мечтой", "Выделить часть запаса на жизнь после рейдов. Это поддержка, а не новый источник дохода.", 110, { scrap: 3 }, 15, -12),
		choice("family", "Принять в круг своих", "Сказать прямо: здесь ждут близкого человека, а не очередное оружие на ногах.", 0, {}, 8, -5)],
};

function scores(story: ScavStory) {
	let bond = 20 + Math.min(15, story.counters.wins * 2), stress = story.counters.injuries * 14 + story.counters.deepReturns * 3 - story.counters.wins * 4;
	for (const memory of story.memories) if (memory.kind === "event" && memory.eventId) {
		const selected = choices[memory.eventId].find((entry) => entry.id === memory.choiceId);
		if (selected) { bond += selected.effects.bond; stress += selected.effects.stress; }
	}
	return { bond: clamp(bond, 0, 100), stress: clamp(stress, 0, 100) };
}
function updateScores(story: ScavStory) { Object.assign(story, scores(story)); }
export function getScavStoryEffects(scav: Pick<Scav, "story">): { chance: number; work: number } {
	return { chance: clamp((scav.story.bond - 20) / 4000 - scav.story.stress / 5000, -0.02, 0.02),
		work: clamp(1 + (scav.story.bond - 20) / 1600 - scav.story.stress / 2000, 0.95, 1.05) };
}
function eligible(story: ScavStory, eventId: ScavEventId) {
	return eventId === "arrival" || (eventId === "first_return" && story.counters.wins >= 1)
		|| (eventId === "shaken" && story.counters.injuries >= 1) || (eventId === "deep_return" && story.counters.deepReturns >= 1)
		|| (eventId === "craftsman" && story.counters.modules >= 5) || (eventId === "trusted" && story.counters.wins >= 5);
}
function offerNextEvent(story: ScavStory, now: number) {
	if (story.pending) return;
	const eventId = SCAV_STORY_EVENTS.slice(1).find((id) => !story.completedEvents.includes(id) && eligible(story, id));
	if (!eventId) return;
	const memoryKind: ScavMemoryKind = eventId === "shaken" ? "injury" : eventId === "deep_return" ? "deep_return" : eventId === "craftsman" ? "module" : "return";
	const source = [...story.memories].reverse().find((entry) => entry.kind === memoryKind)
		?? [...story.memories].reverse().find((entry) => eventId !== "craftsman" && entry.sourceId?.startsWith("raid-"));
	story.pending = { eventId, at: now, sourceId: source?.sourceId ?? null, mapId: source?.mapId ?? null };
}
export function noteScavProduction(scav: Scav, module: boolean, jobId: string, now: number) {
	const story = scav.story;
	story.counters.batches++;
	if (module) {
		story.counters.modules++;
		if (story.counters.modules === 1 || story.counters.modules === 5 || story.counters.modules % 20 === 0)
			pushMemory(story, { kind: "module", at: now, sourceId: jobId, mapId: null, eventId: null, choiceId: null });
	}
	offerNextEvent(story, now);
}
export function noteScavRaid(scav: Scav, report: RaidReport) {
	const story = scav.story;
	if (report.success) story.counters.wins++;
	const injured = !report.success || scav.health < 60;
	if (injured) story.counters.injuries++;
	if (report.success && report.depth >= 2) story.counters.deepReturns++;
	pushMemory(story, { kind: report.lostScav ? "lost" : report.success && report.depth >= 2 ? "deep_return" : injured ? "injury" : "return",
		at: report.at, sourceId: report.raidId, mapId: report.mapId, eventId: null, choiceId: null });
	updateScores(story);
	if (!report.lostScav) offerNextEvent(story, report.at);
}

function eventNarrative(scav: Scav, eventId: ScavEventId) {
	const person = getScavIdentity(scav), shortName = person.realName.split(" ")[0]!, purpose = pick(motives, scav.story.identityKey, "purpose");
	const sector = scav.story.pending?.mapId ? MAP_BY_ID[scav.story.pending.mapId]?.name : null;
	const variants = {
		arrival: { title: "Вещь на прикроватной полке", text: `${scav.name} распаковывает мешок: патроны, сменная рубашка и ${person.keepsake}. Прежняя профессия — ${person.profession}. ${shortName} не рассказывает историю целиком, но признаётся в своей цели: ${person.motive}.`, quote: person.quote },
		first_return: { title: "Первое «я дома»", text: `После первого удачного возвращения ${scav.name} задерживается у двери. На столе — добыча, в руках — ${person.keepsake}. Сегодня ${shortName} впервые говорит «у нас», рассказывая об убежище. До личной цели ещё далеко: ${person.motive}.`, quote: pick(["Казалось, встречать будет некому. А вы свет оставили.", "Всю дорогу в голове одно: успею ли к вашему чаю?", "В этот раз было куда возвращаться."], scav.story.identityKey, "return-quote") },
		shaken: { title: "Ночь без сна", text: `После возвращения${sector ? ` из «${sector}»` : " с вылазки"} ${scav.name} держится в стороне от разговоров за столом. Снова и снова ${person.habit}. ${shortName} говорит, что дело не только в ранах: на маршруте всплыло то, о чём раньше не хотелось говорить.`, quote: pick(["Не спрашивай, почему свет не выключаю. Просто побудь рядом.", "Звук был как тогда. Я понимаю, что здесь безопасно. Руки пока не понимают.", "Всё в порядке — плохая фраза. Сегодня не всё. Завтра попробуем снова."], scav.story.identityKey, "injury-quote") },
		deep_return: { title: "То, что не попало в ведомость", text: `После второго или более дальнего этапа${sector ? ` сектора «${sector}»` : ""} ${scav.name} отдаёт груз и просит минуту. На улицах нашлась личная зацепка: ${person.motive}. Теперь рядом лежат пометка на карте и ${person.keepsake}.`, quote: pick(["Это может оказаться пустяком. Но для меня сейчас это всё.", "Обычно считаю вес добычи. Сегодня эта мелочь оказалась важнее килограммов.", "Не хочу снова жить одним ожиданием. Давай хотя бы проверим."], scav.story.identityKey, "deep-quote") },
		craftsman: { title: "Пятое изделие", text: `Пятый оружейный модуль готов. ${scav.name} ещё раз протирает стол: навыки из прежней жизни — ${person.profession} — неожиданно пригодились. На полке у станка теперь лежит ${person.keepsake}. Это уже не просто назначенная смена: ${shortName} обживает своё место.`, quote: pick(["Когда руки заняты, в голове наконец тихо.", "Эту деталь не отличишь от заводской. Только я знаю, сколько было переделок.", "Теперь можно не стыдиться, когда кто-нибудь скажет: это моя работа."], scav.story.identityKey, "work-quote") },
		trusted: { title: "Планы на после", text: `Пять удачных возвращений спустя ${scav.name} впервые оставляет на полке ${person.keepsake}, уходя на общий ужин. В разговоре о будущем уже нет «если выживу»: ${person.motive}. ${shortName} спрашивает, будет ли здесь место, когда очередная вылазка закончится.`, quote: purpose.lastWords === "Имя запишите правильно. И не забудьте остальных." ? "Раньше в блокноте были только пропавшие. Может, пора начать записывать живых?" : "Оказывается, привыкнуть к людям страшнее, чем выйти на улицу. Но без вас уже не хочется." },
	};
	return variants[eventId];
}
function choiceReason(state: GameState, scav: Scav, selected: ChoiceDefinition): string | null {
	if (scav.status === "raiding" || state.raids.some((raid) => raid.scavId === scav.id)) return "Разговор — после возвращения из рейда.";
	if (state.money < selected.cost.money) return `Нужно ${selected.cost.money} ₽.`;
	const supplyNames: Record<keyof Supplies, string> = { ammo: "патронов", medicine: "лекарств", scrap: "деталей", intel: "разведданных" };
	for (const key of Object.keys(selected.cost.supplies) as (keyof Supplies)[]) if (state.supplies[key] < selected.cost.supplies[key]) return `Нужно ${selected.cost.supplies[key]} ${supplyNames[key]}.`;
	return null;
}
export function getScavPersonalEvent(state: GameState, scav: Scav): ScavPersonalEvent | null {
	const pending = scav.story.pending;
	if (!pending) return null;
	const female = getScavIdentity(scav).gender === "female";
	const personalText = (text: string) => female ? text.replaceAll(" его ", " её ").replaceAll(" он ", " она ").replaceAll("именно его", "именно её") : text;
	return { id: pending.eventId, ...eventNarrative(scav, pending.eventId), at: pending.at,
		choices: choices[pending.eventId].map((selected) => {
			const after = scores({ ...scav.story, memories: [...scav.story.memories, { kind: "event", eventId: pending.eventId, choiceId: selected.id, at: state.lastUpdated, sourceId: pending.sourceId, mapId: pending.mapId }] });
			const bond = after.bond - scav.story.bond, stress = after.stress - scav.story.stress;
			return { ...selected, label: personalText(selected.label), description: personalText(selected.description), cost: { money: selected.cost.money, supplies: { ...selected.cost.supplies } }, effects: { ...selected.effects },
				effectLabel: `Доверие ${bond >= 0 ? "+" : "−"}${Math.abs(bond)}${stress ? ` · напряжение ${stress < 0 ? "−" : "+"}${Math.abs(stress)}` : " · напряжение без изменений"}`,
				reason: choiceReason(state, scav, selected) };
		}) };
}
export function getScavStoryChoiceQuote(state: GameState, scavId: string, eventId: string, choiceId: string): ScavEventChoice | null {
	const scav = state.scavs.find((item) => item.id === scavId);
	if (!scav || scav.story.pending?.eventId !== eventId) return null;
	return getScavPersonalEvent(state, scav)?.choices.find((entry) => entry.id === choiceId) ?? null;
}
export function resolveScavPersonalEvent(state: GameState, scavId: string, eventId: string, choiceId: string): ActionResult {
	const scav = state.scavs.find((item) => item.id === scavId);
	if (!scav) return { ok: false, message: "Боец не найден." };
	const pending = scav.story.pending;
	const quote = getScavStoryChoiceQuote(state, scavId, eventId, choiceId);
	if (!pending || !quote || scav.story.completedEvents.includes(pending.eventId)) return { ok: false, message: "Этот разговор уже завершён или выбор не предлагается." };
	if (quote.reason) return { ok: false, message: quote.reason };
	state.money -= quote.cost.money;
	for (const key of Object.keys(quote.cost.supplies) as (keyof Supplies)[]) state.supplies[key] -= quote.cost.supplies[key];
	pushMemory(scav.story, { kind: "event", at: state.lastUpdated, sourceId: pending.sourceId, mapId: pending.mapId, eventId: pending.eventId, choiceId: quote.id });
	scav.story.completedEvents.push(pending.eventId); scav.story.pending = null;
	updateScores(scav.story); offerNextEvent(scav.story, state.lastUpdated);
	return { ok: true, message: `${scav.name}: ${quote.label}. Этот разговор останется в памяти.` };
}

export function getScavMemories(scav: Pick<Scav, "id" | "name" | "personality" | "story">) {
	const identity = getScavIdentity(scav);
	const returned = identity.gender === "female" ? "Вернулась" : "Вернулся", made = identity.gender === "female" ? "собрала" : "собрал";
	return scav.story.memories.map((memory) => {
		const sector = memory.mapId ? MAP_BY_ID[memory.mapId]?.name : null;
		const selected = memory.eventId ? choices[memory.eventId].find((entry) => entry.id === memory.choiceId) : null;
		const label = memory.kind === "joined" ? "Новая койка" : memory.kind === "return" ? "Снова дома" : memory.kind === "injury" ? "Трудное возвращение" : memory.kind === "deep_return" ? "Дальний выход" : memory.kind === "module" ? "Работа своими руками" : memory.kind === "lost" ? "Последний выход" : selected?.label ?? "Личный разговор";
		const text = memory.kind === "joined" ? `${identity.realName}: на личной полке теперь лежит ${identity.keepsake}.`
			: memory.kind === "event" ? selected!.description
				: memory.kind === "lost" ? `Связь оборвалась${sector ? ` в «${sector}»` : ""}. Место за общим столом осталось пустым.`
				: memory.kind === "module" ? `${scav.name} ${made} оружейную деталь за оплаченную смену. Теперь это часть личной истории.`
					: memory.kind === "deep_return" ? `${returned} с дальних улиц${sector ? ` «${sector}»` : ""} с грузом и ещё одной историей.`
						: memory.kind === "injury" ? `${returned}${sector ? ` из «${sector}»` : ""} с тяжёлым воспоминанием. В убежище ждали этого возвращения.`
							: `После добычи${sector ? ` из «${sector}»` : ""} нашлось время сесть за общий стол.`;
		return { kind: memory.kind, at: memory.at, label: identity.gender === "female" ? label.replaceAll(" его ", " её ") : label,
			text: identity.gender === "female" ? text.replaceAll(" его ", " её ").replaceAll("именно его", "именно её") : text };
	});
}
export function rememberLostScav(state: GameState, scav: Scav, report: RaidReport) {
	const memorial: ScavMemorial = { id: scav.id, name: scav.name, personality: scav.personality, appearance: scav.appearance ?? defaultScavAppearance(scav.personality), profile: structuredClone(scav.profile), story: structuredClone(scav.story),
		at: report.at, mapId: report.mapId, raidId: report.raidId, level: Math.min(15, 1 + Math.floor(Math.sqrt(scav.xp / 60))), xp: scav.xp, raids: scav.raids };
	memorial.story.pending = null;
	state.memorials.unshift(memorial); state.memorials.length = Math.min(state.memorials.length, MAX_SCAV_MEMORIALS);
}
export function getScavMemorials(state: Pick<GameState, "memorials">) {
	return state.memorials.map((record) => {
		const identity = getScavIdentity(record), lastWords = pick(motives, record.story.identityKey, "purpose").lastWords;
		return { ...record, identity, memories: getScavMemories(record), lastWords: identity.gender === "female" ? lastWords.replace("не переставал", "не переставала") : lastWords };
	});
}

/** Used by the explicit save parser; no player supplied prose becomes game content. */
export function validateScavStory(story: ScavStory, scav: Pick<Scav, "id" | "profile" | "raids" | "xp">, now: number, nextId: number) {
	const identityMatch = /^recruit-([1-9]\d*)-([012])-([1-9]\d*)$/.exec(story.identityKey);
	if (story.identityKey !== scav.id && story.identityKey !== `recovery:${scav.id}` && (!identityMatch || Number(identityMatch[1]) > 1e9 || Number(identityMatch[3]) > 4294967295)) throw new Error("story-identity");
	if (scav.profile.candidateId !== null && story.identityKey !== scav.profile.candidateId) throw new Error("story-candidate");
	if (story.joinedAt > now || story.counters.wins > scav.raids || story.counters.injuries > scav.raids || story.counters.deepReturns > story.counters.wins
		|| story.counters.modules > story.counters.batches || story.counters.batches + story.counters.modules * 2 > scav.xp) throw new Error("story-counter");
	const decisions = story.memories.filter((memory) => memory.kind === "event");
	if (story.memories.length === 0 || decisions.length !== story.completedEvents.length || decisions.some((memory, index) => !memory.eventId || story.completedEvents[index] !== memory.eventId)
		|| new Set(decisions.map((memory) => memory.eventId)).size !== decisions.length) throw new Error("story-decision-ledger");
	if (story.completedEvents.some((eventId) => !eligible(story, eventId)) || (story.pending && (!eligible(story, story.pending.eventId) || story.completedEvents.includes(story.pending.eventId)))) throw new Error("story-milestone");
	const checkSource = (sourceId: string | null, mapId: string | null) => {
		if (sourceId === null) { if (mapId !== null) throw new Error("story-source"); return; }
		if (!/^(raid|job)-[1-9]\d*$/.test(sourceId) || Number(sourceId.split("-")[1]) >= nextId || (sourceId.startsWith("raid-") ? mapId === null : mapId !== null)) throw new Error("story-source");
	};
	for (const [index, memory] of story.memories.entries()) {
		if (memory.at < story.joinedAt || memory.at > now || (index > 0 && memory.at < story.memories[index - 1]!.at)) throw new Error("story-time");
		checkSource(memory.sourceId, memory.mapId);
		if (memory.kind === "joined") {
			if (memory.at !== story.joinedAt || memory.sourceId !== null || memory.mapId !== null || memory.eventId !== null || memory.choiceId !== null) throw new Error("story-join");
		} else if (memory.kind === "event") {
			if (!memory.eventId || !choices[memory.eventId].some((entry) => entry.id === memory.choiceId)) throw new Error("story-choice");
			if (memory.eventId === "arrival" && (memory.sourceId !== null || memory.mapId !== null)) throw new Error("story-arrival-source");
		} else {
			if (memory.eventId !== null || memory.choiceId !== null || !memory.sourceId || (memory.kind === "module" ? !memory.sourceId.startsWith("job-") : !memory.sourceId.startsWith("raid-"))) throw new Error("story-memory");
		}
	}
	if (new Set(story.memories.filter((memory) => memory.kind !== "event").map((memory) => `${memory.kind}:${memory.sourceId}`)).size !== story.memories.filter((memory) => memory.kind !== "event").length) throw new Error("story-memory-repeat");
	if (story.pending) {
		if (story.pending.at < story.joinedAt || story.pending.at > now) throw new Error("story-pending-time");
		checkSource(story.pending.sourceId, story.pending.mapId);
		if (story.pending.eventId === "arrival" && (story.pending.sourceId !== null || story.pending.mapId !== null || story.pending.at !== story.joinedAt)) throw new Error("story-arrival");
	}
	const expected = scores(story);
	if (story.bond !== expected.bond || story.stress !== expected.stress) throw new Error("story-score");
}
