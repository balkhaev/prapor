import {
	getRecruitCandidateIdentity,
	getScavIdentity,
	getScavMemories,
	getScavMemorials,
	getScavPersonalEvent,
	getScavStoryEffects,
	MAX_SCAV_MEMORIALS,
	type GameState,
	type RecruitCandidate,
	type Scav,
} from './game/engine';
import { MAP_BY_ID, type Supplies } from './game/data';
import { scavPortrait } from './art';

const e = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const n = (value: number) => Math.floor(value).toLocaleString('ru-RU');
const percent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const signed = (value: number) => `${value > 0 ? '+' : '−'}${Math.abs(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`;
const plural = (value: number, forms: [string, string, string]) => value % 100 >= 11 && value % 100 <= 14 ? forms[2] : value % 10 === 1 ? forms[0] : value % 10 >= 2 && value % 10 <= 4 ? forms[1] : forms[2];
const ageLabel = (age: number) => `${n(age)} ${plural(age, ['год', 'года', 'лет'])}`;
const time = (state: GameState, at: number) => `День ${Math.max(1, Math.floor((at - state.createdAt) / 86_400_000) + 1)} · ${new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(at)}`;

const paths: Record<string, string> = {
	keepsake: 'M7 8V4h10v4M4 8h16v13H4ZM4 12h16M12 8v13',
	voice: 'M5 5h14v10h-7l-5 4v-4H5ZM8 9h8M8 12h5',
	heart: 'M12 20 4 12a5 5 0 0 1 8-6 5 5 0 0 1 8 6Z',
	stress: 'M12 3 2 21h20ZM12 9v5M12 17v1',
	memory: 'M6 3h12v18H6ZM9 7h6M9 11h6M9 15h4',
	people: 'M4 21v-2a5 5 0 0 1 10 0v2M5 7a4 4 0 1 0 8 0 4 4 0 1 0-8 0M17 4a4 4 0 0 1 0 8M17 14a5 5 0 0 1 4 5v2',
	arrow: 'M5 12h14m-5-5 5 5-5 5',
	light: 'M12 3v3M4 6l2 2M20 6l-2 2M3 13h3M18 13h3M8 12a4 4 0 1 1 8 0c0 2-2 3-2 5h-4c0-2-2-3-2-5ZM10 20h4',
};
const icon = (name: string, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] ?? paths.memory}"/></svg>`;

/** A candidate's identity is fixed before hire, including recovery offers. */
export function candidateIdentityPanel(candidate: RecruitCandidate, state?: GameState): string {
	const identity = getRecruitCandidateIdentity(candidate, state);
	return `<div class="candidate-identity"><div class="candidate-human"><span>${e(identity.realName)} · ${ageLabel(identity.age)}</span><b>${e(identity.temperament)}</b></div><blockquote class="candidate-voice">«${e(identity.quote)}»</blockquote><details class="candidate-life"><summary>Кто стоит за позывным <span aria-hidden="true">+</span></summary><div><p><strong>До убежища</strong> — ${e(identity.profession)}.</p><p><strong>Хочет</strong> ${e(identity.motive)}.</p><p>${e(identity.temperamentDescription)}</p><p><strong>Привычка:</strong> ${e(identity.habit)}.</p><span class="candidate-keepsake">${icon('keepsake', 15)}<span><small>Носит с собой</small>${e(identity.keepsake)}</span></span></div></details></div>`;
}

function costLabel(cost: { money: number; supplies: Supplies }): string {
	const parts: string[] = [];
	if (cost.money > 0) parts.push(`${n(cost.money)} ₽`);
	if (cost.supplies.ammo > 0) parts.push(`${n(cost.supplies.ammo)} патр.`);
	if (cost.supplies.medicine > 0) parts.push(`${n(cost.supplies.medicine)} мед.`);
	if (cost.supplies.scrap > 0) parts.push(`${n(cost.supplies.scrap)} деталей`);
	if (cost.supplies.intel > 0) parts.push(`${n(cost.supplies.intel)} разв.`);
	return parts.length ? parts.join(' · ') : 'Без затрат';
}

function personalEventPanel(state: GameState, scav: Scav): string {
	const event = getScavPersonalEvent(state, scav);
	if (!event) return '';
	const narrativeId = `story-narrative-${scav.id}-${event.id}`;
	return `<section class="scav-personal-event" aria-labelledby="story-event-${e(scav.id)}"><div class="story-event-heading"><span class="story-event-mark">${icon('voice', 21)}</span><div><span>Личный разговор · ${e(time(state, event.at))}</span><h3 id="story-event-${e(scav.id)}">${e(event.title)}</h3></div></div><p id="${e(narrativeId)}">${e(event.text)}</p><blockquote>«${e(event.quote)}»</blockquote><div class="story-choices" role="group" aria-label="Решение в личном событии ${e(scav.name)}">${event.choices.map(choice => {
		const reasonId = `story-choice-reason-${scav.id}-${event.id}-${choice.id}`;
		const cost = costLabel(choice.cost);
		return `<div class="story-choice-wrap"><button class="story-choice" type="button" data-action="story-choice" data-id="${e(scav.id)}" data-event="${e(event.id)}" data-choice="${e(choice.id)}" data-focus-key="story-${e(scav.id)}-${e(event.id)}-${e(choice.id)}" aria-label="${e(`${choice.label} для ${scav.name}. ${cost}. ${choice.effectLabel}`)}" aria-describedby="${e(narrativeId)} ${e(reasonId)}" ${choice.reason ? 'disabled' : ''}><span class="story-choice-title"><strong>${e(choice.label)}</strong>${icon('arrow', 16)}</span><span class="story-choice-description">${e(choice.description)}</span><span class="story-choice-results"><b>${e(cost)}</b><span>${e(choice.effectLabel)}</span></span></button><small class="story-choice-reason" id="${e(reasonId)}" data-story-choice-note="${e(choice.id)}" ${choice.reason ? '' : 'hidden'}>${e(choice.reason ?? '')}</small></div>`;
	}).join('')}</div><small class="story-event-note">Этот ответ останется частью личной истории.</small></section>`;
}

function stateMeter(kind: 'bond' | 'stress', value: number): string {
	const label = kind === 'bond' ? 'Доверие' : 'Напряжение';
	const mood = kind === 'bond'
		? value < 20 ? 'Присматривается' : value < 45 ? 'Знает своих' : value < 70 ? 'Доверяет отряду' : 'Берегёт своих'
		: value < 20 ? 'Спокойно' : value < 45 ? 'На стороже' : value < 70 ? 'Нужно перевести дух' : 'Тяжёлое напряжение';
	return `<div class="story-state-meter ${kind} ${kind === 'stress' && value >= 60 ? 'high' : ''}"><div>${icon(kind === 'bond' ? 'heart' : 'stress', 16)}<span>${label}</span><b>${percent(value)} / 100</b></div><span class="story-meter-track" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent(value)}" aria-valuetext="${percent(value)} из 100, ${mood}"><i style="width:${percent(value)}%"></i></span><small>${mood}</small></div>`;
}

function memoryEntry(state: GameState, memory: ReturnType<typeof getScavMemories>[number]): string {
	return `<li class="story-memory" data-memory-kind="${e(memory.kind)}"><span class="story-memory-pin" aria-hidden="true"></span><div><small>${e(time(state, memory.at))}</small><strong>${e(memory.label)}</strong><p>${e(memory.text)}</p></div></li>`;
}

export function scavStoryPanel(state: GameState, scav: Scav): string {
	const identity = getScavIdentity(scav);
	const effects = getScavStoryEffects(scav);
	const memories = getScavMemories(scav).slice().sort((left, right) => right.at - left.at);
	const current = memories.slice(0, 3);
	const older = memories.slice(3);
	const effectLabels: string[] = [];
	if (Math.abs(effects.chance) >= 0.00001) effectLabels.push(`Шанс этапа ${signed(effects.chance * 100)} п.п.`);
	if (Math.abs(effects.work - 1) >= 0.00001) effectLabels.push(`Личный вклад ${signed((effects.work - 1) * 100)}%`);
	return `<section class="scav-story-panel inspector-section" aria-labelledby="scav-life-${e(scav.id)}"><div class="scav-life-heading"><span class="story-person-mark">${icon('people', 22)}</span><div><span>Человек за позывным</span><h3 id="scav-life-${e(scav.id)}">${e(identity.realName)}</h3><small>${ageLabel(identity.age)} · ${e(identity.profession)}</small></div><b>${e(identity.temperament)}</b></div><blockquote class="scav-life-voice">«${e(identity.quote)}»</blockquote><p class="scav-life-biography">Хочет ${e(identity.motive)}.</p><div class="scav-life-facts"><p><span>Характер</span><strong>${e(identity.temperamentDescription)}</strong></p><p><span>Привычка</span><strong>${e(identity.habit)}</strong></p><div class="scav-keepsake">${icon('keepsake', 19)}<span><small>Личная вещь</small><strong>${e(identity.keepsake)}</strong></span></div></div><div class="story-state-grid">${stateMeter('bond', scav.story.bond)}${stateMeter('stress', scav.story.stress)}</div><p class="story-state-note">Возвращения и личные решения меняют доверие. Тяжёлые выходы оставляют напряжение.</p>${effectLabels.length ? `<div class="story-state-effects" aria-label="Влияние состояния на следующий выход и производство">${effectLabels.map(label => `<span>${e(label)}</span>`).join('')}</div>` : ''}${personalEventPanel(state, scav)}<div class="scav-career" aria-label="Личный путь ${e(scav.name)}"><span><strong>${n(scav.raids)}</strong><small>выходов</small></span><span><strong>${n(scav.story.counters.wins)}</strong><small>возвращений с добычей</small></span><span><strong>${n(scav.story.counters.modules)}</strong><small>собранных модулей</small></span></div><section class="scav-memories" aria-labelledby="scav-memories-${e(scav.id)}"><div class="scav-memory-heading"><h4 id="scav-memories-${e(scav.id)}">${icon('memory', 17)} Воспоминания</h4><span>${memories.length ? `${memories.length} ${plural(memories.length, ['запись', 'записи', 'записей'])}` : 'История начинается'}</span></div>${current.length ? `<ol class="story-memory-list">${current.map(memory => memoryEntry(state, memory)).join('')}</ol>${older.length ? `<details class="story-older-memories"><summary>Ещё ${older.length} ${plural(older.length, ['запись', 'записи', 'записей'])} <span aria-hidden="true">+</span></summary><ol class="story-memory-list">${older.map(memory => memoryEntry(state, memory)).join('')}</ol></details>` : ''}` : '<p class="story-memory-empty">Первый разговор и первый выход станут началом личной истории.</p>'}</section></section>`;
}

/** Read-only memorials preserve a lost person's face and story without rewards. */
export function scavMemorialPanel(state: GameState): string {
	const memorials = getScavMemorials(state).slice().sort((left, right) => right.at - left.at);
	if (!memorials.length) return '';
	return `<details class="scav-memorial-panel"><summary><span class="memorial-light">${icon('light', 21)}</span><span><strong>Кого помним</strong><small>${memorials.length} ${plural(memorials.length, ['история', 'истории', 'историй'])} ${memorials.length === 1 ? 'осталась' : 'остались'} в убежище</small></span><b aria-hidden="true">+</b></summary><div class="scav-memorial-body"><p class="memorial-intro">Книга памяти хранит до ${MAX_SCAV_MEMORIALS} последних личных историй. У каждого позывного — своё лицо, своя мечта и свой путь.</p><div class="scav-memorial-grid">${memorials.map(memorial => `<article class="scav-memorial" aria-labelledby="memorial-name-${e(memorial.id)}"><div class="memorial-person"><span class="memorial-portrait">${scavPortrait(memorial.personality, memorial.name, memorial.appearance)}</span><div><span>Связь потеряна</span><h4 id="memorial-name-${e(memorial.id)}">${e(memorial.name)}</h4><p>${e(memorial.identity.realName)} · ${ageLabel(memorial.identity.age)}</p></div></div><div class="memorial-place"><strong>${e(MAP_BY_ID[memorial.mapId]?.name ?? 'Последний выход')}</strong><small>${e(time(state, memorial.at))}</small></div><blockquote>«${e(memorial.lastWords)}»</blockquote><div class="memorial-keepsake">${icon('keepsake', 15)}<span>${e(memorial.identity.keepsake)}</span></div><details class="memorial-history"><summary>История бойца <span>ур. ${memorial.level} · ${memorial.raids} выходов</span><b aria-hidden="true">+</b></summary><div><p>Мечта: ${e(memorial.identity.motive)}.</p><div class="memorial-career"><span>${n(memorial.story.counters.wins)} возвращений с добычей</span><span>${n(memorial.story.counters.modules)} модулей</span><span>${n(memorial.story.counters.deepReturns)} дальних выходов</span></div>${memorial.memories.length ? `<ol class="story-memory-list">${memorial.memories.slice(-3).reverse().map(memory => memoryEntry(state, memory)).join('')}</ol>` : ''}</div></details></article>`).join('')}</div></div></details>`;
}
