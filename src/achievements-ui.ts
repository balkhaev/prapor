import { getAchievementViews, type AchievementView } from './game/achievements';
import type { GameState } from './game/engine';

export type AchievementFilter = 'all' | 'earned' | 'active';
export const ACHIEVEMENT_FILTERS: readonly AchievementFilter[] = ['all', 'earned', 'active'];
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const categories = [
	{ id: 'raids', title: 'Рейды', subtitle: 'Маршрут, груз и вовремя принятое решение', mark: 'I' },
	{ id: 'armory', title: 'Арсенал', subtitle: 'Сборка, которая доказала свою пользу в поле', mark: 'II' },
	{ id: 'base', title: 'Тыл', subtitle: 'Производство и убежище работают на результат', mark: 'III' },
	{ id: 'people', title: 'Люди', subtitle: 'За каждым решением — чья-то история', mark: 'IV' },
] as const;
const patchPaths: Record<string, string> = {
	enough: 'M24 46h30M29 46V30h20v16M33 30v-7h12v7M29 55l7 6 16-17',
	'dual-radio': 'M26 56V34h26v22ZM31 28l17-8M33 42h12M33 49h5M21 25a25 25 0 0 1 36 0M26 30a18 18 0 0 1 26 0',
	lighten: 'M24 55c4-21 11-32 31-34-2 21-14 34-31 34ZM25 54l26-26M33 46l-1-10M41 38l10 1',
	magazine: 'M26 28h26v22l-8 12H26ZM30 35h18M30 42h18M30 49h13M30 23v5M37 23v5M44 23v5',
	inheritance: 'M23 31h15v16H23ZM40 42h15v16H40ZM33 47l7 8M38 38l7-7M45 31h-7M45 31v7',
	'radio-unload': 'M24 46h29v14H24ZM28 46v-8h8v8M42 40V28M37 31l5-5 5 5M34 23a18 18 0 0 1 23 0',
	'storage-chain': 'M23 36l16-9 16 9v22l-16 9-16-9ZM23 36l16 9 16-9M39 45v22M31 31l16 9',
	'recycle-chain': 'M30 28l9-7 9 7M39 21v13M53 36l8 9-8 9M61 45H46M47 61l-9 7-9-7M38 68V53M24 54l-8-9 8-9M16 45h15',
	renovation: 'M23 60V34l16-10 16 10v26ZM23 43h32M23 52h32M32 34v9M45 43v9M32 52v8M48 23l7-7 7 7M55 16v15',
	'two-fronts': 'M23 58V38h16v20ZM28 38v-7h6v7M46 57V35h12v22ZM46 43h12M48 29l8-7M25 25h14M32 18v14',
	truce: 'M19 43l12-12 8 5 8-5 12 12-18 19-12-9ZM28 34l-8-5M51 34l8-5M32 43l7-7 10 8M27 49l10 10M33 43l13 12',
	'separate-benches': 'M19 44h16M21 44v17M33 44v17M45 44h16M47 44v17M59 44v17M25 38v-8h5v8M50 38v-8h5v8M37 24h6M40 21v19',
};
const date = (at: number) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' }).format(at);

/** The patch is a souvenir. Its artwork has no gameplay effect. */
export function achievementPatch(id: string, earned: boolean, large = false): string {
	return `<svg class="achievement-patch${earned ? ' earned' : ''}${large ? ' large' : ''}" viewBox="0 0 80 88" fill="none" aria-hidden="true"><path class="patch-cloth" d="M11 9h58v47L40 79 11 56Z"/><path class="patch-stitch" d="M16 14h48v39L40 72 16 53Z"/><path class="patch-symbol" d="${patchPaths[id] ?? 'M25 45l10 10 20-24'}"/><path class="patch-rank" d="M26 12h28M31 75h18"/></svg>`;
}

export function readAchievementFilter(value: unknown): AchievementFilter {
	return typeof value === 'string' && ACHIEVEMENT_FILTERS.includes(value as AchievementFilter) ? value as AchievementFilter : 'all';
}

export function filterAchievementViews(views: readonly AchievementView[], filter: AchievementFilter): AchievementView[] {
	return views.filter(view => filter === 'all' || (filter === 'earned' ? view.unlocked : view.active && !view.unlocked));
}

function achievementCard(view: AchievementView, fresh: ReadonlySet<string>): string {
	const status = view.unlocked ? 'Получено' : view.active ? 'История началась' : 'Предстоит заслужить';
	const completedSteps = view.steps.some(step => step.done);
	return `<article class="achievement-card ${view.unlocked ? 'earned' : view.active ? 'in-progress' : 'waiting'} category-${view.category}" aria-labelledby="achievement-title-${escape(view.id)}" data-achievement="${escape(view.id)}"><div class="achievement-card-head">${achievementPatch(view.id, view.unlocked)}<div><span class="achievement-status">${view.unlocked ? '<span aria-hidden="true">✓</span>' : '<span class="achievement-status-dot" aria-hidden="true"></span>'}${status}${fresh.has(view.id) ? '<b class="achievement-new">Новое</b>' : ''}</span><h3 id="achievement-title-${escape(view.id)}">${escape(view.title)}</h3><p>${escape(view.description)}</p></div></div>${view.unlocked && view.evidence ? `<div class="achievement-proof"><span class="achievement-proof-label">Твоя история</span><p>${escape(view.evidence)}</p>${view.unlockedAt !== null ? `<time datetime="${new Date(view.unlockedAt).toISOString()}">${date(view.unlockedAt)}</time>` : ''}</div>` : `<p class="achievement-hint">${escape(view.hint)}</p>`}<details class="achievement-route" data-achievement-detail="${escape(view.id)}"${view.active && !view.unlocked ? ' open' : ''}><summary><span>${view.unlocked ? 'Как это получилось' : 'Условия и цепочка'}</span><span aria-hidden="true">+</span></summary><ol>${view.steps.map(step => `<li class="${step.done ? 'done' : 'pending'}"><span class="achievement-step-mark" aria-hidden="true">${step.done ? '✓' : ''}</span><span>${escape(step.label)}${step.done ? '<small>Подтверждено</small>' : ''}</span></li>`).join('')}</ol>${!view.unlocked && !completedSteps ? '<p class="achievement-route-note">Начни эту цепочку — здесь появятся подтверждённые этапы.</p>' : ''}</details><div class="achievement-card-foot"><span>${view.unlocked ? 'Нашивка в коллекции' : 'Нашивка за эту историю'}</span><span>ПРАПОР / ${String(Object.keys(patchPaths).indexOf(view.id) + 1).padStart(2, '0')}</span></div></article>`;
}

/** Read-only presentation: no claiming, save mutation or invented completion counters. */
export function achievementsPanel(state: GameState, filter: AchievementFilter = 'all', fresh: ReadonlySet<string> = new Set()): string {
	return renderAchievementsPanel(getAchievementViews(state), filter, fresh);
}

export function renderAchievementsPanel(views: readonly AchievementView[], filter: AchievementFilter = 'all', fresh: ReadonlySet<string> = new Set()): string {
	const earned = views.filter(view => view.unlocked), active = views.filter(view => view.active && !view.unlocked);
	const selected = filterAchievementViews(views, filter);
	const newEarned = earned.filter(view => fresh.has(view.id)).length;
	const latest = [...earned].sort((a, b) => (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0))[0];
	const tabs = [{ id: 'all', label: 'Все истории', count: views.length }, { id: 'active', label: 'В процессе', count: active.length }, { id: 'earned', label: 'Получены', count: earned.length }];
	return `<section class="achievements-board" aria-label="Достижения убежища"><div class="achievement-brief"><div class="achievement-brief-mark">${achievementPatch(latest?.id ?? 'enough', Boolean(latest), true)}</div><div class="achievement-brief-copy"><span class="eyebrow">Знаки отряда · коллекция нашивок</span><h2>Есть что рассказать.</h2><p>Каждая нашивка — за решение, которое сработало. Собери маршрут, сборку или производственную цепочку и сохрани историю результата.</p><span class="achievement-cosmetic-note">Нашивки — на память об истории. Характеристики бойцов и снаряжения не меняются.</span></div><div class="achievement-total"><strong>${earned.length}<span> / ${views.length}</span></strong><span>НАШИВОК СОБРАНО</span>${latest ? `<small>Последняя: ${escape(latest.title)}</small>` : '<small>Первая история ещё впереди</small>'}</div></div><div class="achievement-toolbar"><div class="achievement-filters" role="group" aria-label="Фильтр достижений">${tabs.map(tab => `<button type="button" data-achievement-filter="${tab.id}" data-focus-key="achievement-filter-${tab.id}" aria-pressed="${filter === tab.id}" class="${filter === tab.id ? 'active' : ''}">${tab.label}<span>${tab.count}</span></button>`).join('')}</div><p>Этапы подтверждаются поступками</p></div>${filter === 'active' && newEarned ? `<div class="achievement-new-note"><span>Новые нашивки: ${newEarned}</span><button type="button" data-achievement-filter="earned">Посмотреть полученные →</button></div>` : ''}<div class="achievement-results" aria-live="polite" aria-atomic="true"><span class="sr-only">${filter === 'all' ? 'Все истории' : filter === 'earned' ? 'Полученные достижения' : 'Истории в процессе'}: ${selected.length}</span></div>${selected.length ? categories.map(category => {
		const cards = selected.filter(view => view.category === category.id);
		if (!cards.length) return '';
		return `<section class="achievement-category" aria-labelledby="achievement-category-${category.id}"><div class="achievement-category-head"><span class="achievement-category-number">${category.mark}</span><div><h3 id="achievement-category-${category.id}">${category.title}</h3><p>${category.subtitle}</p></div><span class="achievement-category-count">${cards.length} ${cards.length === 1 ? 'история' : cards.length < 5 ? 'истории' : 'историй'}</span></div><div class="achievement-grid">${cards.map(view => achievementCard(view, fresh)).join('')}</div></section>`;
	}).join('') : `<div class="achievement-empty">${achievementPatch(filter === 'earned' ? 'inheritance' : 'dual-radio', false)}<h3>${filter === 'earned' ? 'Нашивок пока нет' : 'Открытых цепочек пока нет'}</h3><p>${filter === 'earned' ? 'Выбери историю во вкладке «Все истории». Здесь останется результат с именем бойца и подробностями того, что получилось.' : 'Начни одну из историй. Когда появится подтверждённый этап, эта цепочка окажется здесь.'}</p><button type="button" class="button secondary" data-achievement-filter="all" data-focus-key="achievement-empty-all">Посмотреть все истории</button></div>`}</section>`;
}

export function achievementNotice(views: readonly AchievementView[]): string {
	const earned = views.filter(view => view.unlocked);
	const first = earned[0];
	if (!first) return '';
	return `${achievementPatch(first.id, true)}<div class="achievement-notice-copy"><div id="achievement-announcement" role="status" aria-live="polite" aria-atomic="true"><span>Новая нашивка${earned.length > 1 ? ` · ещё ${earned.length - 1}` : ''}</span><strong>${escape(first.title)}</strong></div><button type="button" class="achievement-notice-link" data-page="achievements">Посмотреть историю →</button></div><button type="button" class="achievement-notice-close" data-action="dismiss-achievement-notice" aria-label="Закрыть уведомление о достижении">×</button>`;
}
