import {
	getRecruitmentBoard,
	getRecruitmentNetworks,
	getRecruitmentRefreshQuote,
	getRecruitCandidateQuote,
	getDismissScavReason,
	getScavCapacity,
	getScavTalentOffers,
	getScavProfileEffects,
	RECRUIT_ROLES,
	RECRUIT_BACKGROUNDS,
	RECRUIT_TRAITS,
	RECRUIT_DRAWBACKS,
	SCAV_TALENTS,
	type GameState,
	type Scav,
} from './game/engine';
import { PERSONALITY_BY_ID, WEAPON_BY_ID } from './game/data';
import { scavPortrait } from './art';

const e = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const n = (value: number) => Math.floor(value).toLocaleString('ru-RU');
const clamp = (value: number) => Math.max(0, Math.min(100, value));
const paths: Record<string, string> = {
	assault: 'm12 3 8 4v5c0 5-4 8-8 10-4-2-8-5-8-10V7ZM8 12h8M12 8v8',
	scout: 'M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20m3 6-2 5-5 3 2-5Z',
	technician: 'M14 5a5 5 0 0 0-6 6l-5 5a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-4 3-3-3 3-4Z',
	radio: 'M4 10h16v11H4ZM7 10l10-7M7 14h2m-2 4h2M15 14a2 2 0 1 0 0 4 2 2 0 1 0 0-4',
	people: 'M4 21v-2a5 5 0 0 1 10 0v2M5 7a4 4 0 1 0 8 0 4 4 0 1 0-8 0M17 4a4 4 0 0 1 0 8M17 14a5 5 0 0 1 4 5v2',
	refresh: 'M20 8H5l4-4M4 16h15l-4 4M20 8v4M4 16v-4',
	check: 'm5 12 4 4L19 6',
	lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5ZM12 14v3',
	talent: 'm12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',
};
const icon = (name: string, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] ?? paths.people}"/></svg>`;

function profileDefinition(scav: Scav) {
	return scav.profile.backgroundId ? RECRUIT_BACKGROUNDS[scav.profile.backgroundId] : null;
}

function traitPair(traitId: string | null, drawbackId: string | null) {
	const trait = traitId ? RECRUIT_TRAITS[traitId] : null;
	const drawback = drawbackId ? RECRUIT_DRAWBACKS[drawbackId] : null;
	return `${trait ? `<div class="recruit-trait positive"><span aria-hidden="true">+</span><div><strong>${e(trait.label)}</strong><p>${e(trait.description)}</p></div></div>` : ''}${drawback ? `<div class="recruit-trait drawback"><span aria-hidden="true">−</span><div><strong>${e(drawback.label)}</strong><p>${e(drawback.description)}</p></div></div>` : ''}`;
}

function rosterPanel(state: GameState) {
	const full = state.scavs.length >= getScavCapacity(state);
	return `<details class="recruit-roster" ${full ? 'open' : ''}><summary>${icon('people', 18)}<span>Места в отряде<small>${state.scavs.length} / ${getScavCapacity(state)} · радиорубка и жилые блоки увеличивают лимит</small></span><b aria-hidden="true">+</b></summary><div class="recruit-roster-body"><p>Отпущенный боец уходит навсегда. Его оружие и экипировка остаются на складе. Перед уходом потребуется подтверждение.</p><div class="recruit-roster-list">${state.scavs.map(scav => {
		const reason = getDismissScavReason(state, scav.id);
		const background = profileDefinition(scav);
		const label = background ? RECRUIT_ROLES[background.role].label : PERSONALITY_BY_ID[scav.personality]?.name ?? 'Дикий';
		return `<div class="recruit-roster-row"><span class="recruit-roster-portrait">${scavPortrait(scav.personality, scav.name)}</span><div><strong>${e(scav.name)} <small>ур. ${scav.level}</small></strong><span>${e(label)}</span>${reason ? `<small id="recruit-dismiss-${e(scav.id)}" class="recruit-blocked">${e(reason)}</small>` : ''}</div><button class="button ghost small" type="button" data-action="dismiss-scav" data-id="${e(scav.id)}" data-focus-key="dismiss-${e(scav.id)}" aria-label="Отпустить ${e(scav.name)}" ${reason ? `disabled aria-describedby="recruit-dismiss-${e(scav.id)}"` : ''}>Отпустить</button></div>`;
	}).join('') || '<p>В отряде пока никого. Один доступный кандидат придёт бесплатно.</p>'}</div></div></details>`;
}

/** This screen renders fixed dossiers and engine quotes without consuming RNG or money. */
export function recruitmentPanel(state: GameState): string {
	const board = getRecruitmentBoard(state);
	const networks = getRecruitmentNetworks(state);
	const refresh = getRecruitmentRefreshQuote(state);
	const capacity = getScavCapacity(state);
	const free = Math.max(0, capacity - state.scavs.length);
	const network = networks.filter(item => item.unlocked).at(-1);
	return `<section class="recruitment-board" aria-label="Досье кандидатов"><div class="recruit-board-brief"><div class="recruit-radio-mark" aria-hidden="true">${icon('radio', 36)}<span class="recruit-signal"><i></i><i></i><i></i><i></i></span></div><div><span class="eyebrow">${e(network?.label ?? 'Уличный эфир')} · досье на выбор</span><h2>Свой среди чужих</h2><p>Собери отряд под свой стиль: штурмовик для опасных улиц, разведчик для добычи, техник для производства. На уровнях 2, 4 и 6 каждый выберет свой талант.</p></div><div class="recruit-budget"><span>В распоряжении</span><strong>${n(state.money)} ₽</strong><small>${n(state.supplies.intel)} разведданных</small></div></div><div class="recruit-capacity ${free ? '' : 'full'}" role="status">${icon('people', 18)}<span><strong>${free ? `Свободных мест: ${free} из ${capacity}` : `Отряд заполнен: ${state.scavs.length} / ${capacity}`}</strong>${free ? 'У выбранного кандидата будут свои навыки, сильная сторона и слабость.' : 'Увеличь радиорубку, построй жилой блок или отпусти свободного бойца ниже.'}</span></div><div class="recruit-candidates">${board.map((candidate, index) => {
		const quote = getRecruitCandidateQuote(state, candidate.id);
		const recovery = state.scavs.length === 0 && quote.money === 0;
		const role = recovery ? { ...RECRUIT_ROLES[candidate.role], label: 'Восстановление отряда' } : RECRUIT_ROLES[candidate.role];
		const background = recovery ? { ...RECRUIT_BACKGROUNDS[candidate.backgroundId]!, label: 'Нейтральный боец', description: 'Без особой черты и слабости. Получит оружие и запас патронов для первого выхода.', tier: 0 } : RECRUIT_BACKGROUNDS[candidate.backgroundId];
		const weapon = quote.weaponId ? state.weapons.find(item => item.id === quote.weaponId) : null;
		const weaponName = weapon ? getWeaponName(state, weapon.id) : null;
		const personality = candidate.role === 'assault' ? 'veteran' : candidate.role === 'scout' ? 'runner' : 'collector';
		return `<article class="recruit-dossier ${quote.reason ? 'unavailable' : ''}" style="--recruit-accent:${e(role.accent)}" aria-labelledby="recruit-name-${e(candidate.id)}"><div class="recruit-dossier-stamp"><span>ДОСЬЕ ${String(index + 1).padStart(2, '0')}</span><b>КАНАЛ ${['I', 'II', 'III'][background?.tier ?? 0]}</b></div><div class="recruit-dossier-head"><div class="recruit-dossier-portrait">${scavPortrait(personality, candidate.name)}<span class="recruit-role-mark">${icon(candidate.role, 19)}</span></div><div><span class="recruit-role-label">${e(role.label)}</span><h3 id="recruit-name-${e(candidate.id)}">${e(candidate.name)}</h3><small>Уровень 1 · новый путь</small></div></div><div class="recruit-background"><strong>${e(background?.label ?? role.label)}</strong><p>${e(background?.description ?? role.description)}</p></div><div class="recruit-skill-grid"><div><span>Бой <b>${n(candidate.combat)}</b></span><i><em style="width:${clamp(candidate.combat)}%"></em></i></div><div><span>Поиск <b>${n(candidate.scouting)}</b></span><i><em style="width:${clamp(candidate.scouting)}%"></em></i></div></div><div class="recruit-character">${recovery ? '<div class="recruit-trait positive"><span aria-hidden="true">+</span><div><strong>Второй шанс</strong><p>Таланты за опыт доступны на уровнях 2, 4 и 6.</p></div></div>' : traitPair(candidate.traitId, candidate.drawbackId)}</div><div class="recruit-dossier-foot"><span class="recruit-arrival">${weapon ? `Оружие со склада: <b>${e(weaponName)}</b> · ${Math.floor(weapon.durability)}%` : recovery ? 'Аварийное оружие и патроны для первого выхода' : 'Придёт без оружия — снаряди из арсенала'}</span><button class="button" type="button" data-action="recruit-candidate" data-id="${e(candidate.id)}" data-focus-key="recruit-${e(candidate.id)}" aria-label="Нанять ${e(candidate.name)} за ${n(quote.money)} рублей" ${quote.reason ? `disabled aria-describedby="recruit-reason-${e(candidate.id)}"` : ''}>${icon('people', 17)}<span>Нанять</span><strong>${quote.money ? `${n(quote.money)} ₽` : 'Бесплатно'}</strong></button>${quote.reason ? `<small class="recruit-blocked" id="recruit-reason-${e(candidate.id)}">${e(quote.reason)}</small>` : `<small class="recruit-price-note">${quote.money ? 'Цена за бойца. Таланты выбираются за опыт.' : 'Первый боец для восстановления отряда'}</small>`}</div></article>`;
	}).join('') || '<div class="recruit-no-candidates"><strong>Все позывные разобраны</strong><p>Запроси новую подборку по радио. Уже нанятые бойцы остаются в отряде.</p></div>'}</div><div class="recruit-refresh"><div><strong>${icon('refresh', 18)} Новые позывные</strong><p>Замени оставшиеся досье новой подборкой. Навыки и характер видны до найма.</p>${refresh.reason ? `<small id="recruit-refresh-reason" class="recruit-blocked">${e(refresh.reason)}</small>` : ''}</div><button class="button secondary" type="button" data-action="recruit-refresh" data-focus-key="recruit-refresh" ${refresh.reason ? 'disabled aria-describedby="recruit-refresh-reason"' : ''}><span>Запросить досье</span><strong>${n(refresh.money)} ₽${refresh.intel ? ` · ${n(refresh.intel)} разв.` : ''}</strong></button></div><section class="recruit-networks" aria-labelledby="recruit-network-title"><div class="recruit-network-head"><h3 id="recruit-network-title">Сеть контактов</h3><span>Открытые каналы сохраняются после потерь</span></div><div class="recruit-network-grid">${networks.map(item => `<article class="recruit-network ${item.unlocked ? 'unlocked' : 'locked'}"><div><span class="recruit-network-mark">${icon(item.unlocked ? 'check' : 'lock', 16)}</span><strong>${e(item.label)}</strong><b>${item.unlocked ? 'Открыт' : 'Закрыт'}</b></div><p>${e(item.description)}</p><span class="recruit-network-progress" role="progressbar" aria-label="${e(item.label)}: прогресс открытия" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${item.unlocked ? 100 : Math.round(clamp(item.progress * 100))}"><i style="width:${item.unlocked ? 100 : clamp(item.progress * 100)}%"></i></span><small>${e(item.requirement)}</small></article>`).join('')}</div></section>${rosterPanel(state)}</section>`;
}

function getWeaponName(state: GameState, id: string) {
	const weapon = state.weapons.find(item => item.id === id);
	return weapon ? WEAPON_BY_ID[weapon.weaponId]?.name ?? 'Свободное оружие' : 'Свободное оружие';
}

function effectsSummary(scav: Scav) {
	const effects = getScavProfileEffects(scav);
	const labels: string[] = [];
	const signed = (value: number) => `${value > 0 ? '+' : '−'}${Math.abs(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`;
	if (Math.abs(effects.chance) >= 0.001) labels.push(`Шанс ${signed(effects.chance * 100)} п.п.`);
	if (Math.abs(effects.loot) >= 0.001) labels.push(`Добыча ${signed(effects.loot * 100)}%`);
	if (Math.abs(effects.duration - 1) >= 0.001) labels.push(`Время ${signed((effects.duration - 1) * 100)}%`);
	if (Math.abs(effects.ammo - 1) >= 0.001) labels.push(`Патроны ${signed((effects.ammo - 1) * 100)}%`);
	if (Math.abs(effects.capacity) >= 0.001) labels.push(`Груз ${signed(effects.capacity)}`);
	if (Math.abs(effects.work - 1) >= 0.001) labels.push(`Личный вклад ${signed((effects.work - 1) * 100)}%`);
	return labels.length ? `<div class="scav-profile-effects" aria-label="Суммарный эффект характера и талантов">${labels.map(label => `<span>${e(label)}</span>`).join('')}</div>` : '';
}

export function scavRecruitmentPanel(state: GameState, scav: Scav): string {
	const background = profileDefinition(scav);
	const role = background ? RECRUIT_ROLES[background.role] : null;
	const offers = getScavTalentOffers(scav);
	const raiding = scav.status === 'raiding' || state.raids.some(raid => raid.scavId === scav.id);
	const thresholds = [2, 4, 6];
	const nextLevel = thresholds[scav.profile.talents.length];
	return `<section class="scav-recruitment-panel inspector-section" aria-label="Характер и развитие ${e(scav.name)}"><div class="scav-recruitment-title"><span class="scav-specialty-mark">${icon(background?.role ?? 'talent', 22)}</span><div><h3>${e(role?.label ?? 'Путь дикого')}</h3><p>${e(background?.label ?? 'Боец первого отряда')}</p></div><span class="scav-talent-count">${scav.profile.talents.length} / 3 таланта</span></div>${background ? `<p class="scav-recruitment-story">${e(background.description)}</p>` : ''}<div class="recruit-character">${traitPair(scav.profile.traitId, scav.profile.drawbackId)}</div>${effectsSummary(scav)}<div class="scav-talent-path" aria-label="Развитие на уровнях 2, 4 и 6">${thresholds.map((level, index) => {
		const selected = scav.profile.talents[index];
		return `<span class="${selected ? 'chosen' : offers?.level === level ? 'available' : ''}"><i>${selected ? icon('check', 12) : level}</i><b>${selected ? 'Выбран' : offers?.level === level ? 'Выбери' : `Ур. ${level}`}</b></span>`;
	}).join('')}</div>${scav.profile.talents.length ? `<div class="scav-chosen-talents">${scav.profile.talents.map(id => {
		const talent = SCAV_TALENTS[id];
		return talent ? `<div>${icon('talent', 16)}<span><strong>${e(talent.label)}</strong><small>${e(talent.description)}</small></span></div>` : '';
	}).join('')}</div>` : ''}${offers ? `<div class="scav-talent-offers"><div><strong>Уровень ${offers.level} · один талант навсегда</strong><p>${raiding ? 'Выбери после возвращения. Текущий рейд уже учитывает прежнее снаряжение и навыки.' : 'Выбор меняет стиль бойца. Остальные таланты этого уровня закрываются.'}</p></div><div class="scav-talent-options" role="group" aria-label="Таланты уровня ${offers.level} для ${e(scav.name)}">${offers.offers.map(talent => `<button type="button" data-action="scav-talent" data-id="${e(scav.id)}" data-talent="${e(talent.id)}" data-focus-key="talent-${e(talent.id)}" ${raiding ? 'disabled' : ''}><span>${icon('talent', 17)}<strong>${e(talent.label)}</strong></span><small>${e(talent.description)}</small><b>${raiding ? 'После рейда' : 'Выбрать →'}</b></button>`).join('')}</div></div>` : nextLevel ? `<p class="scav-next-talent">Следующий выбор — на уровне ${nextLevel}. Опыт приходит из рейдов.</p>` : '<p class="scav-next-talent">Путь выбран. Сочетай таланты с тактикой, оружием и рабочим местом.</p>'}</section>`;
}
