export type GameSoundCue = 'select'|'confirm'|'blocked'|'assign'|'build'|'complete'|'depart'|'return'|'danger'|'search';
export interface GameSound {
	readonly enabled: boolean;
	setEnabled(enabled: boolean): Promise<boolean>;
	play(cue: GameSoundCue): void;
	destroy(): void;
}

const PREFERENCE_KEY = 'prapor-sound-v1';
const MASTER_GAIN = .18;
const MAX_VOICES = 10;
const MIN_CUE_GAP_MS = 40;
const COOLDOWN_MS: Record<GameSoundCue, number> = {
	select: 80, confirm: 160, blocked: 220, assign: 180, build: 260,
	complete: 420, depart: 500, return: 600, danger: 700, search: 320,
};

/** Keeps a burst of UI or timeline events from turning into a loud pile of sounds. */
export class GameSoundLimiter {
	private lastCue = new Map<GameSoundCue, number>();
	private lastStarted = Number.NEGATIVE_INFINITY;
	private reservations: { until: number; voices: number }[] = [];
	reserve(cue: GameSoundCue, nowMs: number, durationMs: number, voices: number): boolean {
		if (!Object.hasOwn(COOLDOWN_MS, cue) || !Number.isFinite(nowMs) || nowMs < 0 || !Number.isFinite(durationMs)
			|| durationMs <= 0 || durationMs > 1000 || !Number.isInteger(voices) || voices < 1 || voices > 4) return false;
		this.reservations = this.reservations.filter((entry) => entry.until > nowMs);
		if (nowMs - this.lastStarted < MIN_CUE_GAP_MS || nowMs - (this.lastCue.get(cue) ?? Number.NEGATIVE_INFINITY) < COOLDOWN_MS[cue]
			|| this.reservations.reduce((count, entry) => count + entry.voices, 0) + voices > MAX_VOICES) return false;
		this.lastStarted = nowMs; this.lastCue.set(cue, nowMs);
		this.reservations.push({ until: nowMs + durationMs, voices });
		return true;
	}
	clear(): void { this.lastCue.clear(); this.lastStarted = Number.NEGATIVE_INFINITY; this.reservations = []; }
}

type Voice = {
	delay: number; duration: number; gain: number; frequency: number; endFrequency?: number;
} & ({ kind: 'tone'; wave: OscillatorType } | { kind: 'noise'; filter: BiquadFilterType });
const tone = (frequency: number, duration: number, gain: number, delay = 0, endFrequency?: number, wave: OscillatorType = 'sine'): Voice =>
	({ kind: 'tone', wave, frequency, duration, gain, delay, endFrequency });
const noise = (frequency: number, duration: number, gain: number, delay = 0, filter: BiquadFilterType = 'bandpass', endFrequency?: number): Voice =>
	({ kind: 'noise', filter, frequency, duration, gain, delay, endFrequency });

// Small physical textures: a latch, a wooden knock, paper, and a filtered radio.
// None of these cues is a loop or uses the gameplay's random stream.
const CUES: Record<GameSoundCue, readonly Voice[]> = {
	select: [tone(1180, .035, .12, 0, 720), noise(1900, .021, .10)],
	confirm: [noise(1000, .028, .14), tone(430, .080, .17, .012, 190, 'triangle'), tone(770, .065, .09, .042)],
	blocked: [tone(180, .095, .13, 0, 115, 'triangle'), noise(850, .042, .07), tone(115, .065, .09, .080)],
	assign: [noise(1400, .034, .17), tone(420, .085, .15, .008, 210, 'triangle'), noise(2200, .025, .12, .072)],
	build: [noise(520, .115, .27, 0, 'lowpass', 260), tone(110, .155, .20, 0, 55, 'triangle'), noise(1750, .035, .12, .025)],
	complete: [tone(660, .120, .16), tone(880, .155, .13, .075), tone(1320, .235, .09, .150), tone(330, .180, .04)],
	depart: [noise(1800, .170, .10), tone(940, .043, .11, .015), tone(680, .062, .10, .077)],
	return: [noise(1600, .210, .10), tone(620, .043, .11, .012), tone(890, .080, .12, .073), tone(1180, .095, .08, .160)],
	danger: [noise(600, .075, .23, 0, 'lowpass', 290), tone(75, .110, .16, 0, 42, 'triangle'), noise(2100, .175, .09, .035)],
	search: [noise(2300, .105, .11, 0, 'highpass', 1400), noise(900, .070, .12, .035), tone(210, .055, .08, .090, 145, 'triangle')],
};

function storedPreference(): boolean {
	try { return typeof window !== 'undefined' && window.localStorage.getItem(PREFERENCE_KEY) === 'on'; } catch { return false; }
}
function savePreference(enabled: boolean): void {
	try { if (typeof window !== 'undefined') window.localStorage.setItem(PREFERENCE_KEY, enabled ? 'on' : 'off'); } catch { /* Sound remains usable when storage is unavailable. */ }
}
const hidden = () => typeof document !== 'undefined' && document.hidden;
function userGestureActive(): boolean {
	return typeof navigator === 'undefined' || !navigator.userActivation || navigator.userActivation.isActive;
}

/** Audio creation and unlocking happen only through the player's sound control or a trusted input gesture. */
export function createGameSound(): GameSound {
	let enabled = storedPreference(), destroyed = false, change = 0;
	let context: AudioContext | null = null, master: GainNode | null = null, noiseBuffer: AudioBuffer | null = null;
	const limiter = new GameSoundLimiter();
	const active = new Set<{ stop: () => void }>();
	const stopAll = () => { for (const voice of [...active]) voice.stop(); limiter.clear(); };
	const onVisibility = () => { if (hidden()) { stopAll(); void context?.suspend().catch(() => {}); } };
	if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

	function startVoice(part: Voice, at: number): void {
		if (!context || !master) return;
		const audio = context, nodes: AudioNode[] = [];
		let source: AudioScheduledSourceNode | null = null, timer: ReturnType<typeof setTimeout> | null = null;
		let cleaned = false;
		const cleanup = () => {
			if (cleaned) return; cleaned = true;
			if (timer !== null) clearTimeout(timer);
			if (source) source.onended = null;
			for (const node of nodes) { try { node.disconnect(); } catch { /* Already disconnected. */ } }
			active.delete(handle);
		};
		const handle = { stop: () => { try { source?.stop(); } catch { /* A voice may already have ended. */ } cleanup(); } };
		try {
			const envelope = audio.createGain(); nodes.push(envelope);
			const start = at + part.delay, end = start + part.duration, pitch = .985 + Math.random() * .03;
			envelope.gain.setValueAtTime(0, start);
			envelope.gain.linearRampToValueAtTime(Math.min(.30, part.gain), start + Math.min(.006, part.duration / 4));
			envelope.gain.exponentialRampToValueAtTime(.0001, end);
			envelope.gain.setValueAtTime(0, end + .008);
			envelope.connect(master);
			if (part.kind === 'tone') {
				const oscillator = audio.createOscillator(); source = oscillator; nodes.push(oscillator);
				oscillator.type = part.wave;
				oscillator.frequency.setValueAtTime(part.frequency * pitch, start);
				if (part.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(part.endFrequency * pitch, end);
				oscillator.connect(envelope); oscillator.start(start); oscillator.stop(end + .012);
			} else {
				const buffer = audio.createBufferSource(), filter = audio.createBiquadFilter(); source = buffer; nodes.push(buffer, filter);
				buffer.buffer = noiseBuffer; filter.type = part.filter; filter.Q.value = part.filter === 'bandpass' ? .75 : .6;
				filter.frequency.setValueAtTime(part.frequency * pitch, start);
				if (part.endFrequency) filter.frequency.exponentialRampToValueAtTime(part.endFrequency * pitch, end);
				buffer.connect(filter); filter.connect(envelope);
				buffer.start(start, Math.random() * .10, part.duration); buffer.stop(end + .012);
			}
			active.add(handle); source.onended = cleanup;
			// A suspended or interrupted context may delay onended; wall time still releases every node.
			timer = setTimeout(handle.stop, Math.ceil((end - audio.currentTime) * 1000) + 120);
		} catch { handle.stop(); }
	}

	return {
		get enabled() { return enabled; },
		async setEnabled(next: boolean): Promise<boolean> {
			if (destroyed) return false;
			const request = ++change;
			if (!next) {
				enabled = false; savePreference(false); stopAll();
				try { await context?.suspend(); } catch { /* Muting still takes effect if the browser has closed audio. */ }
				return false;
			}
			// A saved opt-in does not grant permission to create/resume audio during page loading.
			if (hidden() || ((!context || context.state !== 'running') && !userGestureActive())) return false;
			enabled = true;
			try {
				if (!context || context.state === 'closed') {
					const Audio = typeof window === 'undefined' ? undefined : window.AudioContext
						?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
					if (!Audio) { enabled = false; return false; }
					context = new Audio({ latencyHint: 'interactive' });
					master = context.createGain(); master.gain.value = MASTER_GAIN;
					const compressor = context.createDynamicsCompressor();
					compressor.threshold.value = -18; compressor.knee.value = 12; compressor.ratio.value = 4;
					compressor.attack.value = .002; compressor.release.value = .08;
					master.connect(compressor); compressor.connect(context.destination);
					noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * .40), context.sampleRate);
					const samples = noiseBuffer.getChannelData(0);
					for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
				}
				if (context.state !== 'running') await context.resume();
				if (destroyed || request !== change || hidden() || context.state !== 'running') return false;
				enabled = true; savePreference(true); return true;
			} catch {
				if (destroyed || request !== change) return false;
				enabled = false; stopAll();
				void context?.close().catch(() => {}); context = null; master = null; noiseBuffer = null;
				return false;
			}
		},
		play(cue: GameSoundCue): void {
			if (destroyed || !enabled || hidden() || !context || context.state !== 'running' || !Object.hasOwn(CUES, cue)) return;
			const parts = CUES[cue], duration = Math.max(...parts.map((part) => part.delay + part.duration));
			if (active.size + parts.length > MAX_VOICES || !limiter.reserve(cue, context.currentTime * 1000, duration * 1000 + 25, parts.length)) return;
			for (const part of parts) startVoice(part, context.currentTime + .004);
		},
		destroy(): void {
			if (destroyed) return; destroyed = true; change++; enabled = false; stopAll();
			if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
			void context?.close().catch(() => {}); context = null; master = null; noiseBuffer = null;
		},
	};
}
