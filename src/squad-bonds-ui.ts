import {
	getScavRelations,
	getScavRelationHistory,
	getRoomSocialEffects,
	getRaidSocialSupport,
	getSquadSocialEvents,
	getLossReaction,
	getScavIdentity,
	getWorkerAssignmentReason,
	ROOM_DEFINITIONS,
	type GameState,
	type Scav,
	type RoomInstance,
} from './game/engine';
import { MAP_BY_ID, type Supplies } from './game/data';
import { scavPortrait } from './art';

const e = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const n = (value: number) => Math.floor(value).toLocaleString('ru-RU');
const signed = (value: number) => `${value < 0 ? '−' : '+'}${Math.abs(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`;
type Relation = ReturnType<typeof getScavRelations>[number];
type SocialEvent = ReturnType<typeof getSquadSocialEvents>[number];
type Loss = ReturnType<typeof getLossReaction>[number];
type Person = { id: string; name: string; personality: string; appearance?: number; lost?: boolean };

const paths: Record<string, string> = {
	people: 'M3 21v-2a5 5 0 0 1 10 0v2M4 7a4 4 0 1 0 8 0 4 4 0 1 0-8 0M16 4a4 4 0 0 1 0 8M16 14a5 5 0 0 1 5 5v2',
	friend: 'M12 20 4 12a5 5 0 0 1 8-6 5 5 0 0 1 8 6Z',
	rival: 'm4 4 16 16M20 4 4 20M4 8V4h4M16 4h4v4M4 16v4h4m8 0h4v-4',
	familiar: 'M7 8a4 4 0 1 0 8 0 4 4 0 1 0-8 0M3 21v-2a8 8 0 0 1 16 0v2',
	neutral: 'M4 12h5m6 0h5m-8-2v4',
	voice: 'M4 5h16v11h-8l-5 4v-4H4ZM8 9h8M8 12h5',
	work: 'M5 8h14v13H5ZM8 8V4h8v4M5 13h14m-9-2v4h4v-4',
	route: 'M5 4a2 2 0 1 0 0 4 2 2 0 1 0 0-4m14 12a2 2 0 1 0 0 4 2 2 0 1 0 0-4M5 8v5c0 2 3 2 7 2s7-1 7 1',
	light: 'M12 3v3M4 6l2 2M20 6l-2 2M3 13h3M18 13h3M8 12a4 4 0 1 1 8 0c0 2-2 3-2 5h-4c0-2-2-3-2-5ZM10 20h4',
	arrow: 'M5 12h14m-5-5 5 5-5 5',
	check: 'm5 12 4 4L19 6',
};
const icon = (name: string, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] ?? paths.people}"/></svg>`;
const stamp = (state: GameState, at: number) => `День ${Math.max(1, Math.floor((at - state.createdAt) / 86_400_000) + 1)}`;

function person(state: GameState, id: string, name: string, appearance?: number): Person {
	const live = state.scavs.find(scav => scav.id === id);
	if (live) return { ...live, lost: false };
	const memorial = state.memorials.find(scav => scav.id === id);
	return { id, name: memorial?.name ?? name, personality: memorial?.personality ?? 'careful', appearance: memorial?.appearance ?? appearance, lost: true };
}

function face(value: Person, className = ''): string {
	return `<span class="social-face ${value.lost ? 'lost' : ''} ${className}">${scavPortrait(value.personality, value.name, value.appearance)}</span>`;
}

function nameLink(value: Person, context: string): string {
	return value.lost
		? `<strong class="social-person-name">${e(value.name)}</strong>`
		: `<button class="social-person-name social-person-link" type="button" data-scav="${e(value.id)}" data-focus-key="${e(context)}-${e(value.id)}" aria-label="Личное дело ${e(value.name)}">${e(value.name)}${icon('arrow', 12)}</button>`;
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

/** Choices are engine quotes: rendering never spends resources or advances a relationship. */
function eventCard(state: GameState, event: SocialEvent, context: string): string {
	const fallenId = event.eventId === 'loss' && event.scavIds[0] ? getLossReaction(state, event.scavIds[0]).find(loss => loss.id === event.id)?.fallenId : null;
	const people = event.names.map((name, index) => person(state, event.scavIds[index] ?? (index === 1 ? fallenId : null) ?? '', name, event.appearances[index]));
	const actorId = event.scavIds.find(id => state.scavs.some(scav => scav.id === id)) ?? event.scavIds[0] ?? '';
	const narrativeId = `social-narrative-${context}-${event.id}`;
	const loss = event.eventId === 'loss';
	return `<article class="social-event ${loss ? 'loss' : ''}" aria-labelledby="social-event-${e(context)}-${e(event.id)}"><div class="social-event-heading"><span class="social-event-symbol">${icon(loss ? 'light' : 'voice', 22)}</span><div><span>${loss ? 'Потеря товарища' : 'Общая история'} · ${e(stamp(state, event.at))}</span><h3 id="social-event-${e(context)}-${e(event.id)}">${e(event.title)}</h3></div></div><div class="social-event-people">${people.map(value => `${face(value)}<span>${e(value.name)}</span>`).join('<i aria-hidden="true">·</i>')}</div><p id="${e(narrativeId)}">${e(event.text)}</p><div class="social-choices" role="group" aria-label="Решение: ${e(event.title)}">${event.choices.map(choice => {
		const reasonId = `social-reason-${context}-${event.id}-${choice.id}`;
		const cost = costLabel(choice.cost);
		return `<div class="social-choice-wrap"><button class="social-choice" type="button" data-action="social-choice" data-id="${e(actorId)}" data-event="${e(event.id)}" data-choice="${e(choice.id)}" data-focus-key="social-${e(context)}-${e(event.id)}-${e(choice.id)}" aria-label="${e(`${choice.label}. ${cost}. ${choice.effectLabel}`)}" aria-describedby="${e(narrativeId)} ${e(reasonId)}" ${choice.reason ? 'disabled' : ''}><span class="social-choice-title"><strong>${e(choice.label)}</strong>${icon('arrow', 15)}</span><span class="social-choice-description">${e(choice.description)}</span><span class="social-choice-outcome"><b>${e(cost)}</b><span>${e(choice.effectLabel)}</span></span></button><small class="social-choice-reason" id="${e(reasonId)}" data-social-choice-note="${e(choice.id)}" data-social-event="${e(event.id)}" ${choice.reason ? '' : 'hidden'}>${e(choice.reason ?? '')}</small></div>`;
	}).join('')}</div><small class="social-event-footnote">Один ответ для всей этой истории. Решение сохранится после перезагрузки.</small></article>`;
}

function relationMeter(relation: Relation): string {
	const value = Math.max(-60, Math.min(60, relation.score));
	return `<div class="social-relation-meter ${e(relation.status)}" role="meter" aria-label="Отношение к ${e(relation.peerName)}" aria-valuemin="-60" aria-valuemax="60" aria-valuenow="${value}" aria-valuetext="${e(`${relation.label}, отношение ${signed(value)}`)}"><span class="social-meter-track"><i style="left:${value >= 0 ? 50 : 50 + value / 1.2}%;width:${Math.abs(value) / 1.2}%"></i></span><b>${signed(value)}</b></div>`;
}

function relationDetail(state: GameState, relation: Relation, context: string): string {
	const history = getScavRelationHistory(state, relation.id).slice().reverse();
	return `<details class="social-relation-detail" data-social-detail-key="${e(context)}-${e(relation.id)}"><summary data-focus-key="social-history-${e(context)}-${e(relation.id)}">${history.length ? 'Их общая история' : 'Характеры и совместимость'} <span aria-hidden="true">+</span></summary><p>${e(relation.compatibilityLabel)}.</p>${history.length ? `<ol class="social-history">${history.map(entry => `<li><small>${e(stamp(state, entry.at))}</small><strong>${e(entry.label)}</strong><p>${e(entry.text)}</p></li>`).join('')}</ol>` : ''}</details>`;
}

function relationRow(state: GameState, relation: Relation, context: string): string {
	const peer = person(state, relation.peerId, relation.peerName, relation.peerAppearance);
	return `<article class="social-peer ${e(relation.status)}"><div class="social-peer-head">${face(peer)}<div>${nameLink(peer, context)}<span class="social-relation-status">${icon(relation.status, 12)}${e(relation.label)}</span></div>${relationMeter(relation)}</div><p>${e(relation.description)}</p><div class="social-shared-counts"><span>${icon('work', 12)}${n(relation.workTogether)} общих партий</span><span>${icon('route', 12)}${n(relation.sortiesTogether)} пересечений на маршруте</span></div>${relationDetail(state, relation, context)}</article>`;
}

function lossCard(state: GameState, loss: Loss, context: string): string {
	const fallen = person(state, loss.fallenId, loss.fallenName, loss.fallenAppearance);
	return `<article class="social-loss ${loss.remaining === 0 ? 'resolved' : ''}" aria-labelledby="social-loss-${e(context)}-${e(loss.id)}"><div class="social-loss-head">${face(fallen)}<div><span>${loss.remaining === 0 ? 'Память остаётся' : 'Не хватает рядом'}</span><h4 id="social-loss-${e(context)}-${e(loss.id)}">${e(loss.fallenName)}</h4><small>${e(loss.relationshipLabel)} · ${e(MAP_BY_ID[loss.mapId]?.name ?? 'Последний выход')} · ${e(stamp(state, loss.at))}</small></div>${icon('light', 20)}</div><strong class="social-loss-label">${e(loss.label)}</strong><p>${e(loss.text)}</p><div class="social-loss-recovery"><span>${loss.remaining === 0 ? icon('check', 13) + ' Тяжесть потери отступила' : `Тяжесть потери: ${n(loss.remaining)} / ${n(loss.severity)}`}</span><small>${n(loss.workCompleted)} завершённых партий · ${n(loss.returnsCompleted)} возвращений${loss.resolved ? ' · поддержка оказана' : ''}</small></div></article>`;
}

function orderedRelations(state: GameState, scavId: string): Relation[] {
	return getScavRelations(state, scavId).slice().sort((left, right) =>
		Number(Boolean(right.pendingEventId)) - Number(Boolean(left.pendingEventId)) || Math.abs(right.score) - Math.abs(left.score) || right.workTogether + right.sortiesTogether - left.workTogether - left.sortiesTogether);
}

export function scavRelationsPanel(state: GameState, scav: Scav): string {
	const relations = orderedRelations(state, scav.id);
	const events = getSquadSocialEvents(state, scav.id);
	const losses = getLossReaction(state, scav.id).slice().sort((left, right) => right.at - left.at);
	const shown = relations.slice(0, 2);
	const rest = relations.slice(2);
	return `<section class="scav-relations-panel inspector-section" aria-labelledby="social-scav-${e(scav.id)}"><div class="social-section-heading"><span class="social-heading-symbol">${icon('people', 22)}</span><div><span>Свои люди</span><h3 id="social-scav-${e(scav.id)}">С кем делить убежище</h3></div><b>${relations.length} связей</b></div>${events.map(event => eventCard(state, event, `scav-${scav.id}`)).join('')}${losses[0] ? lossCard(state, losses[0], `scav-${scav.id}`) : ''}${losses.length > 1 ? `<details class="social-more" data-social-detail-key="losses-${e(scav.id)}"><summary data-focus-key="social-losses-${e(scav.id)}">Другие потери <b>${losses.length - 1}</b><span aria-hidden="true">+</span></summary><div>${losses.slice(1).map(loss => lossCard(state, loss, `scav-${scav.id}`)).join('')}</div></details>` : ''}<div class="social-peer-list">${shown.map(relation => relationRow(state, relation, `peer-${scav.id}`)).join('') || '<p class="social-empty">Пока знакомится с отрядом. Общие оплаченные смены и пересечения в рейдах станут началом отношений.</p>'}</div>${rest.length ? `<details class="social-more" data-social-detail-key="peers-${e(scav.id)}"><summary data-focus-key="social-peers-${e(scav.id)}">Остальные в отряде <b>${rest.length}</b><span aria-hidden="true">+</span></summary><div class="social-peer-list">${rest.map(relation => relationRow(state, relation, `peer-${scav.id}`)).join('')}</div></details>` : ''}<p class="social-context-note">Дружба помогает в общей комнате и по радио перед выходом. Конфликты мешают общей работе; после потерь людям нужно время и поддержка.</p></section>`;
}

type Pair = { scav: Scav; relation: Relation };
function allPairs(state: GameState): Pair[] {
	const seen = new Set<string>();
	const pairs: Pair[] = [];
	for (const scav of state.scavs) for (const relation of getScavRelations(state, scav.id)) {
		if (seen.has(relation.id)) continue;
		seen.add(relation.id);
		pairs.push({ scav, relation });
	}
	return pairs.sort((left, right) => Number(Boolean(right.relation.pendingEventId)) - Number(Boolean(left.relation.pendingEventId))
		|| Math.abs(right.relation.score) - Math.abs(left.relation.score));
}

function graph(state: GameState, pairs: Pair[]): string {
	const lossLinks = state.scavs.flatMap(scav => getLossReaction(state, scav.id).map(loss => ({ scav, loss })));
	const fallen: Person[] = [];
	for (const { loss } of lossLinks.slice().sort((left, right) => right.loss.at - left.loss.at)) {
		if (!fallen.some(value => value.id === loss.fallenId)) fallen.push(person(state, loss.fallenId, loss.fallenName, loss.fallenAppearance));
		if (fallen.length >= 2) break;
	}
	const people: Person[] = [...state.scavs.slice(0, 8 - fallen.length), ...fallen];
	const points = new Map(people.map((scav, index) => {
		const angle = -Math.PI / 2 + 2 * Math.PI * index / Math.max(people.length, 1);
		return [scav.id, people.length === 1 ? { x: 50, y: 40 } : people.length === 2 ? { x: index === 0 ? 24 : 76, y: 45 } : { x: 50 + Math.sin(angle) * 35, y: 46 - Math.cos(angle) * 32 }];
	}));
	const links = pairs.filter(pair => points.has(pair.scav.id) && points.has(pair.relation.peerId));
	return `<div class="social-map" aria-label="Доска отношений отряда"><span class="social-map-stamp">${icon('people', 14)} КРУГ СВОИХ</span><svg class="social-map-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${links.map(pair => {
		const first = points.get(pair.scav.id)!, second = points.get(pair.relation.peerId)!;
		return `<path class="${e(pair.relation.status)}" d="M${first.x} ${first.y} Q50 46 ${second.x} ${second.y}"/>`;
	}).join('')}${lossLinks.filter(({ scav, loss }) => points.has(scav.id) && points.has(loss.fallenId)).map(({ scav, loss }) => {
		const first = points.get(scav.id)!, second = points.get(loss.fallenId)!;
		return `<path class="lost" d="M${first.x} ${first.y} Q50 46 ${second.x} ${second.y}"/>`;
	}).join('')}</svg>${people.map(scav => {
		const point = points.get(scav.id)!;
		if (scav.lost) return `<div class="social-map-person lost" style="left:${point.x}%;top:${point.y}%">${face(scav)}<strong>${e(scav.name)}</strong><span class="social-map-alert loss">Помним</span></div>`;
		const loss = getLossReaction(state, scav.id).find(entry => entry.remaining > 0);
		const pending = getSquadSocialEvents(state, scav.id).length;
		return `<button class="social-map-person ${loss ? 'grieving' : ''}" type="button" style="left:${point.x}%;top:${point.y}%" data-scav="${e(scav.id)}" data-focus-key="social-map-${e(scav.id)}" aria-label="Личное дело ${e(scav.name)}${pending ? `, ${pending} событий ждут решения` : ''}${loss ? ', переживает потерю товарища' : ''}">${face(scav)}<strong>${e(scav.name)}</strong>${pending ? `<span class="social-map-alert">${icon('voice', 10)} ${pending}</span>` : loss ? '<span class="social-map-alert loss">Помнит</span>' : ''}</button>`;
	}).join('')}${people.length >= 3 ? `<div class="social-map-center" aria-hidden="true"><span>${icon('light', 24)}</span><strong>Есть к кому<br>возвращаться</strong></div>` : ''}${!people.length ? '<p class="social-map-empty">Здесь появятся лица тех,<br>кто станет своим.</p>' : ''}<div class="social-map-legend"><span class="friend">${icon('friend', 11)} Дружба</span><span class="rival">${icon('rival', 11)} Конфликт</span>${fallen.length ? `<span class="lost">${icon('light', 11)} Память</span>` : '<span class="neutral">'+icon('neutral', 11)+' Знакомятся</span>'}</div></div>${state.scavs.length > 8 - fallen.length ? `<p class="social-map-limit">На доске — ${people.length - fallen.length} бойцов${fallen.length ? ` и ${fallen.length} утраты` : ''}. Все отношения доступны ниже и в личных делах.</p>` : ''}`;
}

function pairCard(state: GameState, pair: Pair): string {
	const peer = person(state, pair.relation.peerId, pair.relation.peerName, pair.relation.peerAppearance);
	return `<article class="social-pair-card ${e(pair.relation.status)}"><div class="social-pair-people"><div>${face(pair.scav)}${nameLink(pair.scav, `pair-${pair.relation.id}`)}</div><span class="social-pair-connector">${icon(pair.relation.status, 19)}</span><div>${face(peer)}${nameLink(peer, `pair-${pair.relation.id}`)}</div></div><div class="social-pair-state"><strong>${e(pair.relation.label)}</strong><b>${signed(pair.relation.score)}</b></div><p>${e(pair.relation.description)}</p><div class="social-shared-counts"><span>${icon('work', 13)}${n(pair.relation.workTogether)} партий вместе</span><span>${icon('route', 13)}${n(pair.relation.sortiesTogether)} пересечений</span></div>${relationDetail(state, pair.relation, `pair-${pair.relation.id}`)}</article>`;
}

function crewRow(state: GameState, scav: Scav): string {
	const identity = getScavIdentity(scav);
	const loss = getLossReaction(state, scav.id).find(entry => entry.remaining > 0);
	const room = state.shelter.rooms.find(item => item.id === scav.assignment);
	const activity = scav.status === 'raiding' ? 'На маршруте' : room ? `На смене · ${ROOM_DEFINITIONS[room.type].label}` : scav.health < 25 ? 'Восстанавливается' : 'В убежище';
	return `<button class="social-crew-row ${loss ? 'grieving' : ''}" type="button" data-scav="${e(scav.id)}" data-focus-key="social-crew-${e(scav.id)}" aria-label="Личное дело ${e(scav.name)}">${face(scav)}<span><strong>${e(scav.name)}</strong><small>${e(identity.temperament)}</small><span>${e(activity)}</span></span><i aria-hidden="true">${icon(loss ? 'light' : 'arrow', 16)}</i></button>`;
}

export function squadRelationsPanel(state: GameState): string {
	const pairs = allPairs(state);
	const events = getSquadSocialEvents(state);
	const friends = pairs.filter(pair => pair.relation.status === 'friend').length;
	const rivals = pairs.filter(pair => pair.relation.status === 'rival').length;
	const losses = state.scavs.flatMap(scav => getLossReaction(state, scav.id).filter(loss => loss.remaining > 0).map(loss => ({ scav, loss })));
	const shown = pairs.slice(0, 6);
	const rest = pairs.slice(6);
	return `<section class="squad-relations" aria-label="Отношения между дикими"><div class="social-board-brief"><div class="social-board-symbol">${icon('people', 32)}</div><div><span class="eyebrow">Не просто позывные</span><h2>Люди, которые ждут друг друга</h2><p>Одна смена, общий эфир, ссора из-за мелочи. Из этого складывается отряд. Сближай тех, кто ладит, и замечай тех, кому сейчас тяжело.</p></div></div><div class="social-board-stats"><div class="friend">${icon('friend', 21)}<span><strong>${n(friends)}</strong><small>дружеских связей</small></span></div><div class="rival">${icon('rival', 21)}<span><strong>${n(rivals)}</strong><small>конфликтов</small></span></div><div>${icon('voice', 21)}<span><strong>${n(events.length)}</strong><small>историй ждут решения</small></span></div></div><div class="social-board-layout"><section class="social-board-map">${graph(state, pairs)}<p class="social-map-help">Нажми на портрет, чтобы открыть личное дело. Линии отражают реальные отношения, а значок разговора — событие, которое ждёт ответа.</p></section><section class="social-crew" aria-label="Люди в отряде"><div class="social-subheading"><h3>Сегодня в убежище</h3><span>${state.scavs.length} человек</span></div><div class="social-crew-list">${state.scavs.map(scav => crewRow(state, scav)).join('') || '<p class="social-empty">Убежище тихое. Новый наём станет началом нового круга своих.</p>'}</div></section></div>${events.length ? `<section class="social-pending" aria-labelledby="social-pending-title"><div class="social-subheading"><h3 id="social-pending-title">О чём говорят между собой</h3><span>Твой ответ изменит отношения</span></div><div class="social-event-grid">${events.map(event => eventCard(state, event, 'squad')).join('')}</div></section>` : '<div class="social-quiet"><span>'+ icon('voice', 22) +'</span><p><strong>В общем эфире пока тихо</strong>Назначай людей в одну комнату и отправляй на один маршрут с пересечением по времени. Общие дела дадут повод для разговора.</p></div>'}${losses.length ? `<section class="social-squad-losses" aria-labelledby="social-losses-title"><div class="social-subheading"><h3 id="social-losses-title">Пустое место за столом</h3><span>Потерю переживают по-разному</span></div><div class="social-loss-grid">${losses.slice(0, 4).map(({ scav, loss }) => `<div class="social-loss-owner"><span>${e(scav.name)} помнит</span>${lossCard(state, loss, `squad-${scav.id}`)}</div>`).join('')}</div>${losses.length > 4 ? `<details class="social-more" data-social-detail-key="squad-losses"><summary data-focus-key="social-losses">Кому ещё нужна поддержка <b>${losses.length - 4}</b><span aria-hidden="true">+</span></summary><div class="social-loss-grid">${losses.slice(4).map(({ scav, loss }) => `<div class="social-loss-owner"><span>${e(scav.name)} помнит</span>${lossCard(state, loss, `squad-${scav.id}`)}</div>`).join('')}</div></details>` : ''}</section>` : ''}<section class="social-pairs" aria-labelledby="social-pairs-title"><div class="social-subheading"><h3 id="social-pairs-title">Отношения в отряде</h3><span>Общие дела оставляют след</span></div><div class="social-pair-grid">${shown.map(pair => pairCard(state, pair)).join('') || '<p class="social-empty">Для первых отношений нужны хотя бы два бойца. Познакомь их через общую работу.</p>'}</div>${rest.length ? `<details class="social-more" data-social-detail-key="squad-pairs"><summary data-focus-key="social-pairs">Другие отношения <b>${rest.length}</b><span aria-hidden="true">+</span></summary><div class="social-pair-grid">${rest.map(pair => pairCard(state, pair)).join('')}</div></details>` : ''}</section></section>`;
}

/** Only the room's current available workers contribute to this quote. */
export function roomRelationsPanel(state: GameState, room: RoomInstance, selectedScavId?: string | null): string {
	const effects = getRoomSocialEffects(state, room.id);
	const negative = effects.percent < -0.001;
	const neutral = Math.abs(effects.percent) < 0.001;
	const selected = state.scavs.find(scav => scav.id === selectedScavId && !room.workerIds.includes(scav.id));
	const preview = selected ? getRoomSocialEffects(state, room.id, [...room.workerIds, selected.id]) : null;
	const assignmentReason = selected ? getWorkerAssignmentReason(state, selected.id, room.id) : null;
	return `<section class="social-room-panel ${negative ? 'strained' : neutral ? 'neutral' : 'supported'}" aria-label="Влияние отношений на ${e(ROOM_DEFINITIONS[room.type].label)}"><div class="social-room-head">${icon('people', 19)}<div><strong>Как ладит эта смена</strong><span>${e(effects.label)}</span></div><b data-room-social-effect="${e(room.id)}">${neutral ? 'Без изменения' : `${signed(effects.percent)}% к вкладу`}</b></div>${effects.workers.some(worker => Math.abs(worker.percent) >= 0.001) ? `<div class="social-room-workers">${effects.workers.filter(worker => Math.abs(worker.percent) >= 0.001).map(worker => {
		const scav = state.scavs.find(item => item.id === worker.scavId);
		return `<span><strong>${e(scav?.name ?? 'Дикий')}</strong><b>${signed(worker.percent)}%</b><small>${e(worker.reason)}</small></span>`;
	}).join('')}</div>` : ''}${selected && preview ? `<div class="social-assignment-preview ${preview.percent < -0.001 ? 'strained' : ''}" data-room-social-preview="${e(room.id)}" data-social-preview-scav="${e(selected.id)}"><div>${face(selected)}<span><small>Если назначить</small><strong>${e(selected.name)}</strong></span><b>${Math.abs(preview.percent) < 0.001 ? 'Без изменения' : `${signed(preview.percent)}% к вкладу`}</b></div><p>${e(assignmentReason ?? preview.label)}</p></div>` : ''}<p class="social-context-note">Отношения меняют вклад людей в работу. Дружба помогает только при общей смене; горе может сказываться и в одиночку.</p></section>`;
}

/** Map-specific support is a preview; the engine freezes the actual effect at dispatch. */
export function raidRelationsPanel(state: GameState, scav: Scav, mapId?: string): string {
	const support = getRaidSocialSupport(state, scav.id, mapId);
	const supporter = support.supporterId ? state.scavs.find(item => item.id === support.supporterId) : null;
	const negative = support.chance < -0.00001;
	return `<div class="social-raid-panel ${negative ? 'strained' : supporter ? 'supported' : 'neutral'}" aria-label="Товарищи и состояние перед рейдом ${e(scav.name)}"><div class="social-raid-heading">${icon(support.griefPenalty ? 'light' : 'route', 18)}<strong>${supporter ? 'Свой голос в эфире' : support.griefPenalty ? 'Тяжёлый выход' : 'Поддержка на маршруте'}</strong><b data-scav-social-effect="${e(scav.id)}">${Math.abs(support.chance) < 0.00001 ? 'Без изменения' : `${signed(support.percent)} п.п.`}</b></div>${supporter ? `<div class="social-raid-supporter">${face(supporter)}<span>${e(supporter.name)} · поддерживает на связи</span></div>` : ''}<p data-scav-social-note="${e(scav.id)}">${e(support.description)}</p></div>`;
}
