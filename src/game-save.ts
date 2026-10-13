import { SAVE_KEY, SAVE_VERSION, loadGameWithSummary, parseSave, saveGame, type AdvanceSummary, type GameState } from "./game/engine";

export const PREVIOUS_SAVE_KEY = `${SAVE_KEY}.previous`;
export const GAME_SAVE_FORMAT = "prapor.local-save";
export const GAME_SAVE_VERSION = 1;
export const MAX_GAME_SAVE_LENGTH = 1_200_000;
export const MAX_SESSION_LENGTH = 100_000;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface SaveStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface SaveMetadata { revision: number; writerId: string | null; savedAt: number | null }
export interface ParsedGameSave extends SaveMetadata { state: GameState; summary: AdvanceSummary; session: JsonValue | null }
export interface OpenGameSave extends SaveMetadata {
	status: "empty" | "ready" | "recovered" | "protected" | "unavailable";
	state: GameState | null; summary: AdvanceSummary | null; session: JsonValue | null;
	raw: string | null; protectedRaw: string | null; reason: string | null;
}
export interface SaveConflict extends SaveMetadata { conflict: boolean; reason: string | null }
export type SaveFailureCode = "unavailable" | "coordination" | "protected" | "conflict" | "invalid" | "verification";
export type SaveResult = ({ ok: true } & SaveMetadata) | { ok: false; code: SaveFailureCode; reason: string };
export interface GameSaveStore {
	open(now?: number): OpenGameSave;
	detectConflict(): SaveConflict;
	saveSync(state: GameState, session?: unknown, options?: { replaceProtected?: boolean }): SaveResult;
	getMetadata(): SaveMetadata;
	exportCurrent(state: GameState, session?: unknown): string;
}

type Envelope = {
	format: typeof GAME_SAVE_FORMAT; version: typeof GAME_SAVE_VERSION; revision: number;
	writerId: string; savedAt: number; game: unknown; session: JsonValue | null; checksum: string;
};
type ValidDocument = SaveMetadata & { state: GameState; session: JsonValue | null; gameRaw: string };
type DocumentResult = { document: ValidDocument | null; reason: "invalid" | "future" | null };
const noMetadata = (): SaveMetadata => ({ revision: 0, writerId: null, savedAt: null });
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const safeInteger = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;

function checksum(text: string): string {
	let sum = 2166136261;
	for (let i = 0; i < text.length; i++) sum = Math.imul(sum ^ text.charCodeAt(i), 16777619);
	return (sum >>> 0).toString(16).padStart(8, "0");
}
function signedPayload(value: Omit<Envelope, "checksum">): string {
	return JSON.stringify({ format: value.format, version: value.version, revision: value.revision,
		writerId: value.writerId, savedAt: value.savedAt, game: value.game, session: value.session });
}

function cloneSession(value: unknown): JsonValue | null {
	if (value === undefined || value === null) return null;
	let nodes = 0;
	const visit = (item: unknown, depth: number): JsonValue => {
		if (++nodes > 6000 || depth > 18) throw new Error("session-size");
		if (item === null || typeof item === "boolean") return item;
		if (typeof item === "number" && Number.isFinite(item)) return item;
		if (typeof item === "string" && item.length <= MAX_SESSION_LENGTH) return item;
		if (Array.isArray(item)) return item.map((child) => visit(child, depth + 1));
		if (record(item) && (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null)) {
			const copy: { [key: string]: JsonValue } = Object.create(null) as { [key: string]: JsonValue };
			for (const [key, child] of Object.entries(item)) {
				if (key === "__proto__" || key === "prototype" || key === "constructor" || key.length > 200) throw new Error("session-key");
				copy[key] = visit(child, depth + 1);
			}
			return copy;
		}
		throw new Error("session-json");
	};
	const cloned = visit(value, 0);
	if (JSON.stringify(cloned).length > MAX_SESSION_LENGTH) throw new Error("session-size");
	// Reconstruct ordinary JSON objects without retaining caller references.
	return JSON.parse(JSON.stringify(cloned)) as JsonValue;
}

function parseDocument(raw: string | null): DocumentResult {
	if (raw === null) return { document: null, reason: null };
	try {
		if (raw.length > MAX_GAME_SAVE_LENGTH) return { document: null, reason: "invalid" };
		const value: unknown = JSON.parse(raw);
		if (!record(value)) return { document: null, reason: "invalid" };
		if (Object.hasOwn(value, "format")) {
			if (value.format !== GAME_SAVE_FORMAT || value.version !== GAME_SAVE_VERSION) return { document: null, reason: "future" };
			const allowed = ["format", "version", "revision", "writerId", "savedAt", "game", "session", "checksum"];
			if (Object.keys(value).some((key) => !allowed.includes(key)) || allowed.some((key) => !Object.hasOwn(value, key))
				|| !safeInteger(value.revision) || typeof value.writerId !== "string" || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(value.writerId)
				|| !safeInteger(value.savedAt, 8_640_000_000_000_000) || typeof value.checksum !== "string" || !/^[0-9a-f]{8}$/.test(value.checksum)) return { document: null, reason: "invalid" };
			const session = cloneSession(value.session), gameRaw = JSON.stringify(value.game);
			const state = parseSave(gameRaw);
			if (!state) return { document: null, reason: record(value.game) && typeof value.game.schemaVersion === "number" && value.game.schemaVersion > SAVE_VERSION ? "future" : "invalid" };
			const body: Omit<Envelope, "checksum"> = { format: GAME_SAVE_FORMAT, version: GAME_SAVE_VERSION, revision: value.revision,
				writerId: value.writerId, savedAt: value.savedAt, game: value.game, session };
			if (checksum(signedPayload(body)) !== value.checksum) return { document: null, reason: "invalid" };
			return { document: { state, session, gameRaw, revision: value.revision, writerId: value.writerId, savedAt: value.savedAt }, reason: null };
		}
		const state = parseSave(raw);
		return state ? { document: { state, session: null, gameRaw: raw, revision: 0, writerId: null, savedAt: state.lastUpdated }, reason: null }
			: { document: null, reason: typeof value.schemaVersion === "number" && value.schemaVersion > SAVE_VERSION ? "future" : "invalid" };
	} catch { return { document: null, reason: "invalid" }; }
}

function encode(state: GameState, session: unknown, metadata: { revision: number; writerId: string; savedAt: number }): string {
	const gameRaw = saveGame(state);
	if (!parseSave(gameRaw) || !safeInteger(metadata.revision) || !safeInteger(metadata.savedAt, 8_640_000_000_000_000)
		|| !/^[a-zA-Z0-9_.:-]{1,128}$/.test(metadata.writerId)) throw new Error("invalid-save");
	const body: Omit<Envelope, "checksum"> = { format: GAME_SAVE_FORMAT, version: GAME_SAVE_VERSION, ...metadata, game: JSON.parse(gameRaw) as unknown, session: cloneSession(session) };
	const encoded = JSON.stringify({ ...body, checksum: checksum(signedPayload(body)) });
	if (encoded.length > MAX_GAME_SAVE_LENGTH) throw new Error("save-size");
	return encoded;
}

/** Imports current envelopes and original v1–v5 files through the engine's strict parser. */
export function isValidGameSave(raw: string): boolean {
	return parseDocument(raw).document !== null;
}

/** Imports current envelopes and original v1–v5 files through the engine's strict parser. */
export function parseGameSave(raw: string | null, now = Date.now()): ParsedGameSave | null {
	const parsed = parseDocument(raw).document;
	if (!parsed) return null;
	const advanced = loadGameWithSummary(parsed.gameRaw, now);
	return advanced ? { ...advanced, session: parsed.session, revision: parsed.revision, writerId: parsed.writerId, savedAt: parsed.savedAt } : null;
}

export function exportGameSave(state: GameState, session: unknown = null): string {
	return encode(state, session, { revision: 0, writerId: "export", savedAt: state.lastUpdated });
}

/**
 * Local browser persistence only. The caller must hold the same origin's
 * lifetime WebLock while writing; localStorage itself has no compare-and-swap.
 * Read previews never acquire ownership, advance a stored cursor, or write.
 */
export function createGameSaveStore(storage: SaveStorage, options: { writerId: string; isExclusiveHeld: () => boolean }): GameSaveStore {
	let baseline: { primary: string | null; previous: string | null } | null = null;
	let metadata = noMetadata();
	let protectedRaw: string | null = null;
	const read = () => ({ primary: storage.getItem(SAVE_KEY), previous: storage.getItem(PREVIOUS_SAVE_KEY) });
	const open = (now = Date.now()): OpenGameSave => {
		if (!safeInteger(now, 8_640_000_000_000_000)) {
			baseline = null;
			return { ...metadata, status: "unavailable", state: null, summary: null, session: null, raw: null, protectedRaw: null, reason: "invalid-time" };
		}
		try {
			const current = read();
			baseline = current;
			const primary = parseDocument(current.primary), previous = parseDocument(current.previous);
			const candidate = primary.document ?? previous.document;
			protectedRaw = current.primary !== null && !primary.document ? current.primary : !candidate && current.previous !== null ? current.previous : null;
			metadata = candidate ? { revision: candidate.revision, writerId: candidate.writerId, savedAt: candidate.savedAt } : noMetadata();
			const loaded = candidate ? loadGameWithSummary(candidate.gameRaw, now) : null;
			const unsupported = primary.reason === "future";
			const status = primary.document && loaded ? "ready" : previous.document && loaded && !unsupported ? "recovered" : protectedRaw !== null ? "protected" : "empty";
			return { ...metadata, status, state: loaded?.state ?? null, summary: loaded?.summary ?? null, session: candidate?.session ?? null,
				raw: current.primary, protectedRaw, reason: protectedRaw !== null ? unsupported ? "unsupported-save" : "unreadable-save" : null };
		} catch {
			baseline = null; metadata = noMetadata(); protectedRaw = null;
			return { ...metadata, status: "unavailable", state: null, summary: null, session: null, raw: null, protectedRaw: null, reason: "storage-unavailable" };
		}
	};
	const detectConflict = (): SaveConflict => {
		try {
			const current = read(), parsed = parseDocument(current.primary).document;
			const details = parsed ? { revision: parsed.revision, writerId: parsed.writerId, savedAt: parsed.savedAt } : noMetadata();
			return { ...details, conflict: !baseline || current.primary !== baseline.primary || current.previous !== baseline.previous,
				reason: !baseline ? "save-not-opened" : current.primary !== baseline.primary || current.previous !== baseline.previous ? "stored-progress-changed" : null };
		} catch { return { ...metadata, conflict: true, reason: "storage-unavailable" }; }
	};
	const fail = (code: SaveFailureCode, reason: string): SaveResult => ({ ok: false, code, reason });
	const saveSync = (state: GameState, session: unknown = null, saveOptions: { replaceProtected?: boolean } = {}): SaveResult => {
		if (!options.isExclusiveHeld()) return fail("coordination", "exclusive-writer-lock-required");
		if (!baseline) return fail("unavailable", "save-not-opened");
		if (protectedRaw !== null && !saveOptions.replaceProtected) return fail("protected", "original-save-protected");
		const conflict = detectConflict();
		if (conflict.conflict) return fail(conflict.reason === "storage-unavailable" ? "unavailable" : "conflict", conflict.reason ?? "stored-progress-changed");
		if (metadata.revision >= Number.MAX_SAFE_INTEGER) return fail("invalid", "save-revision-exhausted");
		let encoded: string;
		const next = { revision: metadata.revision + 1, writerId: options.writerId, savedAt: state.lastUpdated };
		try { encoded = encode(state, session, next); } catch { return fail("invalid", "state-or-session-invalid"); }
		const previousPrimary = parseDocument(baseline.primary).document;
		// An unreadable primary is never copied over the last good recovery slot.
		const backup = previousPrimary ? baseline.primary : baseline.previous;
		try {
			if (backup !== null && backup !== baseline.previous) storage.setItem(PREVIOUS_SAVE_KEY, backup);
			// Recheck even while locked to catch unrelated writers that ignore the protocol.
			if (storage.getItem(SAVE_KEY) !== baseline.primary) return fail("conflict", "stored-progress-changed");
			storage.setItem(SAVE_KEY, encoded);
			if (storage.getItem(SAVE_KEY) !== encoded) return fail("verification", "written-save-not-confirmed");
			baseline = { primary: encoded, previous: backup };
			metadata = next; protectedRaw = null;
			return { ok: true, ...metadata };
		} catch {
			// A failed primary write may have successfully rotated the backup. Keep
			// the still-valid primary as the retry baseline, without claiming saved.
			try {
				if (storage.getItem(SAVE_KEY) === baseline.primary && storage.getItem(PREVIOUS_SAVE_KEY) === backup) baseline = { primary: baseline.primary, previous: backup };
			} catch { /* The caller will show storage failure until it is readable again. */ }
			return fail("unavailable", "save-write-failed");
		}
	};
	return { open, detectConflict, saveSync, getMetadata: () => ({ ...metadata }), exportCurrent: exportGameSave };
}
