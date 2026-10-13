import { describe, expect, test } from 'bun:test';
import { createGameSound, GameSoundLimiter } from '../src/game-sound';

describe('short sound feedback scheduling', () => {
	test('a held or repeated UI action produces discrete cues without a rapid click storm', () => {
		const limiter = new GameSoundLimiter(), heard: number[] = [];
		for (let time = 0; time <= 500; time += 10) if (limiter.reserve('select', time, 50, 2)) heard.push(time);
		expect(heard).toEqual([0, 80, 160, 240, 320, 400, 480]);
		// A rejected event cannot restart the cooldown and starve the next deliberate action.
		expect(limiter.reserve('select', 550, 50, 2)).toBe(false);
		expect(limiter.reserve('select', 560, 50, 2)).toBe(true);
	});

	test('simultaneous completion and radio events share one bounded voice budget that frees after playback', () => {
		const limiter = new GameSoundLimiter();
		expect(limiter.reserve('complete', 0, 400, 4)).toBe(true);
		expect(limiter.reserve('return', 40, 300, 4)).toBe(true);
		expect(limiter.reserve('danger', 80, 220, 3)).toBe(false);
		expect(limiter.reserve('search', 80, 150, 2)).toBe(true);
		expect(limiter.reserve('build', 120, 160, 3)).toBe(false);
		expect(limiter.reserve('danger', 340, 220, 3)).toBe(true);
		expect(limiter.reserve('build', 380, 160, 3)).toBe(true);
		expect(limiter.reserve('complete', 420, 400, 4)).toBe(true);
	});

	test('different events cannot bypass the global gap and clock rollback cannot flood feedback', () => {
		const limiter = new GameSoundLimiter();
		expect(limiter.reserve('assign', 1000, 120, 3)).toBe(true);
		expect(limiter.reserve('confirm', 1000, 120, 3)).toBe(false);
		expect(limiter.reserve('confirm', 1039, 120, 3)).toBe(false);
		expect(limiter.reserve('confirm', 1040, 120, 3)).toBe(true);
		expect(limiter.reserve('danger', 999, 220, 3)).toBe(false);
		expect(limiter.reserve('danger', 1080, 220, 3)).toBe(true);
		limiter.clear();
		expect(limiter.reserve('danger', 0, 220, 3)).toBe(true);
	});

	test('invalid reservations are harmless and unsupported environments stay silent', async () => {
		const limiter = new GameSoundLimiter();
		for (const [time, duration, voices] of [[NaN, 100, 2], [-1, 100, 2], [0, Infinity, 2], [0, 0, 2], [0, 1001, 2], [0, 100, 0], [0, 100, 11], [0, 100, 1.5]]) {
			expect(limiter.reserve('select', time!, duration!, voices!)).toBe(false);
		}
		expect(limiter.reserve('select', 0, 100, 2)).toBe(true);
		// Bun has no browser AudioContext: creating, muting, playing and destroying require no mocks.
		const sound = createGameSound();
		expect(sound.enabled).toBe(false);
		expect(await sound.setEnabled(true)).toBe(false);
		for (const cue of ['select', 'confirm', 'blocked', 'assign', 'build', 'complete', 'depart', 'return', 'danger', 'search'] as const) sound.play(cue);
		expect(await sound.setEnabled(false)).toBe(false);
		sound.destroy(); sound.destroy();
		expect(await sound.setEnabled(true)).toBe(false);
	});
});
