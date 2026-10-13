import { describe, expect, test } from 'bun:test';
import { achievementsPanel, achievementNotice, filterAchievementViews, readAchievementFilter, renderAchievementsPanel } from '../src/achievements-ui';
import { createGame, saveGame } from '../src/game/engine';
import { getAchievementViews, type AchievementView } from '../src/game/achievements';
import { readGameSession } from '../src/game-session';

const NOW = 1_792_000_000_000;
function sample(overrides: Partial<AchievementView> = {}): AchievementView {
	return { id: 'enough', title: 'Хватит на сегодня', description: 'Сохранить груз.', hint: 'Эвакуироваться после полезной находки.', category: 'raids', unlocked: false, unlockedAt: null, evidence: null, active: false,
		steps: [{ label: 'Найти груз', done: false }, { label: 'Вернуться', done: false }], ...overrides };
}

describe('achievement collection and recorded stories', () => {
	test('real gameplay renders every achievement without claiming or changing the frozen save', () => {
		const state = createGame(NOW), before = saveGame(state);
		const views = getAchievementViews(state);
		expect(views.every(view => !view.unlocked && !view.active && view.steps.every(step => !step.done))).toBe(true);
		function freeze(value: unknown) {
			if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
			Object.freeze(value);
			for (const child of Object.values(value)) freeze(child);
		}
		freeze(state);
		const html = achievementsPanel(state);
		expect((html.match(/data-achievement="/g) ?? []).length).toBe(12);
		for (const view of views) expect(html).toContain(`data-achievement="${view.id}"`);
		expect(html).toContain('Характеристики бойцов и снаряжения не меняются');
		expect(html).not.toContain('role="progressbar"');
		expect(html).not.toContain('0/100');
		expect(saveGame(state)).toBe(before);
	});

	test('active excludes already earned stories and does not pretend untouched chains are started', () => {
		const untouched = sample(), started = sample({ id: 'magazine', active: true, steps: [{ label: 'Сборка готова', done: true }, { label: 'Пройти этап', done: false }] });
		const earned = sample({ id: 'truce', category: 'people', active: true, unlocked: true, unlockedAt: NOW, evidence: 'Смена завершена.' });
		const views = [untouched, started, earned];
		expect(filterAchievementViews(views, 'active').map(view => view.id)).toEqual(['magazine']);
		expect(filterAchievementViews(views, 'earned').map(view => view.id)).toEqual(['truce']);
		expect(filterAchievementViews(views, 'all')).toEqual(views);
		expect(renderAchievementsPanel(views, 'active')).toContain('Подтверждено');
		expect(renderAchievementsPanel(views, 'active')).not.toContain('data-achievement="enough"');
	});

	test('separate production witnesses cannot be combined into a falsely completed chain', () => {
		const state = createGame(NOW);
		state.achievements.active.crafts.push(
			{ achievementId: 'storage-chain', sourceId: 'job-111', jobId: null, itemId: 'module-112', delivered: false },
			{ achievementId: 'storage-chain', sourceId: 'job-113', jobId: 'job-114', itemId: null, delivered: true },
		);
		const view = getAchievementViews(state).find(view => view.id === 'storage-chain')!;
		expect(view.active).toBe(true);
		expect(view.unlocked).toBe(false);
		expect(view.steps[1]!.done && view.steps[2]!.done).toBe(false);
		expect(view.steps.at(-1)!.done).toBe(false);
	});

	test('earned card preserves the personal result and safely escapes every rendered story', () => {
		const view = sample({ title: '<script>title</script>', unlocked: true, unlockedAt: NOW, evidence: 'Лис <img src=x onerror=alert(1)> доставил «&».' });
		const html = renderAchievementsPanel([view], 'earned', new Set([view.id]));
		expect(html).toContain('&lt;script&gt;title&lt;/script&gt;');
		expect(html).toContain('Лис &lt;img src=x onerror=alert(1)&gt; доставил «&amp;».');
		expect(html).toContain('Твоя история');
		expect(html).toContain('datetime="');
		expect(html).toContain('Новое');
		expect(html).not.toContain('<script>');
		expect(html).not.toContain('<img');
		const notice = achievementNotice([view]);
		expect(notice).toContain('aria-live="polite"');
		expect(notice).toContain('data-page="achievements"');
		expect(notice).not.toContain('<script>');
	});

	test('both empty filtered states offer a usable return to the whole collection', () => {
		const views = [sample()];
		const earned = renderAchievementsPanel(views, 'earned');
		const active = renderAchievementsPanel(views, 'active');
		expect(earned).toContain('Нашивок пока нет');
		expect(active).toContain('Открытых цепочек пока нет');
		for (const html of [earned, active]) expect(html).toContain('data-achievement-filter="all"');
		expect(achievementNotice(views)).toBe('');
	});
});

describe('achievement screen session', () => {
	test('page and filter resume, while untrusted filters fall back without touching gameplay', () => {
		const state = createGame(NOW), before = saveGame(state);
		for (const filter of ['all', 'earned', 'active'] as const) {
			const session = readGameSession({ version: 1, page: 'achievements', filters: { achievements: filter } }, state);
			expect(session.page).toBe('achievements');
			expect(session.filters.achievements).toBe(filter);
			expect(readAchievementFilter(filter)).toBe(filter);
		}
		for (const value of ['constructor', '__proto__', null, 42, ['earned']]) {
			expect(readGameSession({ version: 1, page: 'achievements', filters: { achievements: value } }, state).filters.achievements).toBe('all');
			expect(readAchievementFilter(value)).toBe('all');
		}
		expect(saveGame(state)).toBe(before);
	});
});
