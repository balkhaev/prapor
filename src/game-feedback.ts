import { ROOM_DEFINITIONS, type GameState } from "./game/engine";
import { getRaidFieldFrame, getRaidFieldPlan } from "./raid-field";
import type { GameSoundCue } from "./game-sound";

export type GameResourceGains = Record<"money" | keyof GameState["supplies"], number>;
export interface GameFeedbackEvent { cue: GameSoundCue; label: string }
export interface GameFeedbackCursor {
	model: GameState;
	balances: GameResourceGains;
	rooms: Record<string, { cycles: number; status: string }>;
	expansions: string[];
	raids: string[];
	reports: string[];
	watchId: string | null;
	watchPhase: string | null;
}
const siteKey = (site: { column: number; row: number }) => `${site.column}:${site.row}`;

function watchPhase(state: GameState, watchId: string | null, now: number) {
	const raid = state.raids.find((item) => item.id === watchId);
	if (!raid) return { key: null, action: null };
	const frame = getRaidFieldFrame(raid, now, getRaidFieldPlan(raid));
	return { key: `${raid.id}:${raid.expedition?.stage ?? 1}:${raid.expedition?.branch ?? ""}:${frame.segmentIndex}:${frame.action}`, action: frame.action };
}

/** An observation cursor is local to this running model; loading a save primes it silently. */
export function createGameFeedbackCursor(state: GameState, watchId: string | null = null, now = Date.now()): GameFeedbackCursor {
	return {
		model: state, balances: { money: state.money, ...state.supplies },
		rooms: Object.fromEntries(state.shelter.rooms.map((room) => [room.id, { cycles: room.cycles, status: room.status }])),
		expansions: state.shelter.expansions.map(siteKey), raids: state.raids.map((raid) => raid.id), reports: state.history.map((report) => report.id),
		watchId, watchPhase: watchPhase(state, watchId, now).key,
	};
}

/** Cues observe real delivery, construction and raid phases; they never settle jobs or grant rewards. */
export function observeGameFeedback(cursor: GameFeedbackCursor, state: GameState, watchId: string | null = null, now = Date.now()): { cursor: GameFeedbackCursor; events: GameFeedbackEvent[]; gains: GameResourceGains } {
	const next = createGameFeedbackCursor(state, watchId, now), events: GameFeedbackEvent[] = [];
	const gains: GameResourceGains = { money: 0, ammo: 0, medicine: 0, scrap: 0, intel: 0 };
	if (cursor.model !== state) return { cursor: next, events, gains };
	for (const key of Object.keys(gains) as (keyof GameResourceGains)[]) gains[key] = Math.max(0, Math.floor(next.balances[key] - cursor.balances[key]));
	const emit = (cue: GameSoundCue, label: string) => { if (!events.some((event) => event.cue === cue)) events.push({ cue, label }); };
	for (const room of state.shelter.rooms) {
		const before = cursor.rooms[room.id];
		if (!before) continue;
		if (room.cycles > before.cycles) emit("complete", `${ROOM_DEFINITIONS[room.type].label}: партия доставлена на склад`);
		if (before.status !== "ready" && room.status === "ready") emit("build", `${ROOM_DEFINITIONS[room.type].label}: готова к работе`);
	}
	const open = new Set(state.shelter.sites.map(siteKey)), pending = new Set(next.expansions);
	if (cursor.expansions.some((key) => !pending.has(key) && open.has(key))) emit("build", "Новая площадка готова к строительству");
	if (state.raids.some((raid) => !cursor.raids.includes(raid.id))) emit("depart", "Боец вышел на маршрут");
	for (const report of state.history) if (!cursor.reports.includes(report.id)) emit(report.success ? "return" : "blocked", `${report.scavName}: ${report.success ? "вернулся с выхода" : "выход завершился с потерями"}`);
	if (cursor.watchId === watchId && cursor.watchPhase && next.watchPhase !== cursor.watchPhase) {
		const phase = watchPhase(state, watchId, now);
		if (phase.action === "skirmish") emit("danger", "Контакт на маршруте");
		else if (phase.action === "search") emit("search", "Боец осматривает точку");
		else if (phase.action === "checkpoint") emit("confirm", "Контрольная точка: ожидается приказ");
	}
	return { cursor: next, events, gains };
}
