import { MAP_BY_ID, type Supplies } from "./data";
import type { GameState, Scav, Raid, RaidReport, ActionResult } from "./engine";
import type { RoomInstance, ProductionJob } from "./shelter";
import { ROOM_DEFINITIONS, MAX_SHELTER_SITES } from "./shelter";
import { defaultScavAppearance, isScavAppearance } from "./scav-appearances";
import { getScavProfileEffects } from "./recruitment";
import { getScavStoryEffects } from "./scav-stories";

export type SquadEventKind = "first_shift" | "friction" | "crossed_routes";
export type SquadRelationStatus = "friend" | "rival" | "familiar" | "neutral";
export interface SquadEventSource {
	eventId: SquadEventKind; at: number; sourceIds: string[]; mapId: string | null; roomId: string | null;
	workTogether: number; sortiesTogether: number; difficultSorties: number;
}
export interface SquadDecision extends SquadEventSource {
	choiceId: string;
}
export interface SquadBond {
	id: string; scavIds: [string, string]; compatibility: number; score: number;
	workTogether: number; sortiesTogether: number; difficultSorties: number;
	lastWorkId: string | null; lastWorkRoomId: string | null; lastSortieIds: [string, string] | null; lastSortieMapId: string | null; lastAt: number;
	pending: SquadEventSource | null; decisions: SquadDecision[];
	/** At most one unfinished paid job per pair. Only actual credited work earns this. */
	workCredit: { jobId: string; roomId: string; workDone: number } | null;
	/** Actual overlapping solo sorties, counted only when both participants return alive. */
	overlap: { raidIds: [string, string]; startedAt: [number, number]; mapId: string; at: number; returned: { raidId: string; at: number; success: boolean }[] } | null;
}
export interface ScavLossReaction {
	id: string; scavId: string; fallenId: string; fallenName: string; fallenAppearance: number;
	mapId: string; raidId: string; at: number; relationshipScore: number; severity: number;
	baseBatches: number; baseRaids: number; workCompleted: number; returnsCompleted: number;
	choiceId: "listen" | "ritual" | null; choiceAt: number | null;
	workCredit: { jobId: string; roomId: string; workDone: number } | null;
}
export interface SquadSocialState { pairs: SquadBond[]; losses: ScavLossReaction[] }
export interface ScavRelationView {
	id: string; peerId: string; peerName: string; peerAppearance: number; score: number;
	status: SquadRelationStatus; label: string; compatibility: number; compatibilityLabel: string;
	workTogether: number; sortiesTogether: number; description: string; pendingEventId: string | null;
}
export interface SquadSocialChoice {
	id: string; label: string; description: string; cost: { money: number; supplies: Supplies };
	effectLabel: string; reason: string | null;
}
export interface SquadSocialEvent {
	id: string; eventId: SquadEventKind | "loss"; pairId: string | null; scavIds: string[];
	names: string[]; appearances: number[]; title: string; text: string; at: number; choices: SquadSocialChoice[];
}
export interface ScavLossView {
	id: string; fallenId: string; fallenName: string; fallenAppearance: number; mapId: string; at: number;
	relationshipLabel: string; severity: number; remaining: number; label: string; text: string;
	resolved: boolean; choiceId: string | null; workCompleted: number; returnsCompleted: number;
}
export const MAX_SQUAD_PAIRS = 105;
export const MAX_SCAV_LOSSES = 3;
export const SQUAD_EVENT_KINDS: readonly SquadEventKind[] = ["first_shift", "friction", "crossed_routes"];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const supplies = (partial: Partial<Supplies> = {}): Supplies => ({ ammo: 0, medicine: 0, scrap: 0, intel: 0, ...partial });
const hash = (key: string) => {
	let result = 0x811c9dc5;
	for (const character of key) result = Math.imul(result ^ character.charCodeAt(0), 0x01000193);
	return result >>> 0;
};
const actorId = (scav: string | Pick<Scav, "id">) => typeof scav === "string" ? scav : scav.id;
const appearance = (scav: Scav) => scav.appearance ?? defaultScavAppearance(scav.personality);
const pairId = (a: string, b: string) => [a, b].sort().join("~");
const pairPeople = (state: GameState, pair: SquadBond) => pair.scavIds.map((id) => state.scavs.find((scav) => scav.id === id)!);

function compatibilityFor(a: Scav, b: Scav) {
	const ordered = [a, b].sort((left, right) => left.id.localeCompare(right.id));
	let value = hash(`${ordered[0]!.story.identityKey}:${ordered[1]!.story.identityKey}:compatibility`) % 5 - 2;
	if (a.profile.traitId && a.profile.traitId === b.profile.traitId) value++;
	if ((a.profile.traitId === "bench_craft" && b.profile.drawbackId === "rough_hands") || (b.profile.traitId === "bench_craft" && a.profile.drawbackId === "rough_hands")) value--;
	if ((a.profile.traitId === "short_bursts" && b.profile.drawbackId === "wasteful") || (b.profile.traitId === "short_bursts" && a.profile.drawbackId === "wasteful")) value--;
	return clamp(value, -2, 2);
}
const workDelta = (compatibility: number) => compatibility < 0 ? compatibility * 2 : compatibility + 2;
function statusFor(score: number): SquadRelationStatus { return score >= 16 ? "friend" : score <= -12 ? "rival" : score === 0 ? "neutral" : "familiar"; }
function relationLabel(score: number) { return score >= 16 ? "Друзья" : score <= -12 ? "Конфликт" : score > 0 ? "Сближаются" : score < 0 ? "Напряжение" : "Знакомятся"; }
function compatibilityLabel(value: number) { return value >= 1 ? "Легко находят общий язык" : value <= -1 ? "Разные привычки" : "Нужно узнать друг друга"; }
type ChoiceDefinition = { id: string; label: string; description: string; money: number; supplies: Supplies; score: number };
const options: Record<SquadEventKind, readonly ChoiceDefinition[]> = {
	first_shift: [
		{ id: "tea", label: "Устроить общий чай", description: "После смены оставить время для разговора и разделить припасы за одним столом.", money: 35, supplies: supplies(), score: 12 },
		{ id: "respect", label: "Отметить вклад обоих", description: "Назвать вслух, что у каждого получилось. Никто не остался чужой парой рук.", money: 0, supplies: supplies(), score: 5 },
	],
	friction: [
		{ id: "mediate", label: "Разобраться вместе", description: "Выделить материалы для исправления спорной детали и дать обоим договориться о порядке работы.", money: 20, supplies: supplies(), score: 18 },
		{ id: "space", label: "Установить границы", description: "Выслушать обоих и договориться не задевать чужие привычки. Новые назначения остаются твоим решением.", money: 0, supplies: supplies(), score: 6 },
	],
	crossed_routes: [
		{ id: "debrief", label: "Сверить две карты", description: "Сопоставить записи с перекрывающихся выходов и разобрать, где пригодились чужие подсказки.", money: 0, supplies: supplies({ intel: 1 }), score: 12 },
		{ id: "signal", label: "Придумать личный позывной", description: "Оставить на карте знак: на этой частоте отвечает свой. Каждая вылазка по-прежнему одиночная.", money: 0, supplies: supplies(), score: 6 },
	],
};
function calculatedScore(pair: Pick<SquadBond, "compatibility" | "workTogether" | "sortiesTogether" | "difficultSorties" | "decisions">) {
	// A long difficult career must remain repairable: no invisible, unbounded debt behind a capped meter.
	return clamp(clamp(pair.workTogether * workDelta(pair.compatibility), -36, 36) + Math.min(24, pair.sortiesTogether * 4) - Math.min(28, pair.difficultSorties * 7)
		+ pair.decisions.reduce((sum, decision) => sum + (options[decision.eventId].find((entry) => entry.id === decision.choiceId)?.score ?? 0), 0), -60, 60);
}
function milestone(pair: Pick<SquadBond, "compatibility" | "workTogether" | "sortiesTogether" | "difficultSorties" | "decisions">, kind: SquadEventKind) {
	return kind === "first_shift" ? pair.workTogether >= 3 : kind === "crossed_routes" ? pair.sortiesTogether >= 2
		: (pair.workTogether >= 4 || pair.sortiesTogether >= 2) && calculatedScore(pair) <= -8;
}
function offerPairEvent(pair: SquadBond, source: Omit<SquadEventSource, "eventId" | "workTogether" | "sortiesTogether" | "difficultSorties">) {
	if (pair.pending) return;
	const eventId = SQUAD_EVENT_KINDS.find((kind) => !pair.decisions.some((entry) => entry.eventId === kind) && milestone(pair, kind));
	if (eventId) pair.pending = { eventId, ...source, sourceIds: [...source.sourceIds], workTogether: pair.workTogether, sortiesTogether: pair.sortiesTogether, difficultSorties: pair.difficultSorties };
}

export function createSquadSocialState(state: Pick<GameState, "scavs" | "lastUpdated">): SquadSocialState {
	const social: SquadSocialState = { pairs: [], losses: [] };
	for (let i = 0; i < state.scavs.length; i++) for (let j = i + 1; j < state.scavs.length; j++) {
		const [a, b] = [state.scavs[i]!, state.scavs[j]!].sort((left, right) => left.id.localeCompare(right.id));
		social.pairs.push({ id: pairId(a!.id, b!.id), scavIds: [a!.id, b!.id], compatibility: compatibilityFor(a!, b!), score: 0,
			workTogether: 0, sortiesTogether: 0, difficultSorties: 0, lastWorkId: null, lastWorkRoomId: null, lastSortieIds: null, lastSortieMapId: null, lastAt: state.lastUpdated,
			pending: null, decisions: [], workCredit: null, overlap: null });
	}
	return social;
}
export function ensureSquadPairs(state: GameState) {
	const live = new Set(state.scavs.map((scav) => scav.id));
	state.social.pairs = state.social.pairs.filter((pair) => pair.scavIds.every((id) => live.has(id)));
	state.social.losses = state.social.losses.filter((loss) => live.has(loss.scavId));
	const existing = new Set(state.social.pairs.map((pair) => pair.id));
	for (const pair of createSquadSocialState(state).pairs) if (!existing.has(pair.id)) state.social.pairs.push(pair);
	state.social.pairs.sort((a, b) => a.id.localeCompare(b.id));
}
export function removeSquadMember(state: GameState, scavId: string) {
	state.social.pairs = state.social.pairs.filter((pair) => !pair.scavIds.includes(scavId));
	state.social.losses = state.social.losses.filter((loss) => loss.scavId !== scavId);
}
function relationView(state: GameState, pair: SquadBond, ownId: string): ScavRelationView {
	const peerId = pair.scavIds.find((id) => id !== ownId)!;
	const peer = state.scavs.find((scav) => scav.id === peerId)!;
	const status = statusFor(pair.score);
	return { id: pair.id, peerId, peerName: peer.name, peerAppearance: appearance(peer), score: pair.score, status, label: relationLabel(pair.score),
		compatibility: pair.compatibility, compatibilityLabel: compatibilityLabel(pair.compatibility), workTogether: pair.workTogether, sortiesTogether: pair.sortiesTogether,
		description: status === "friend" ? "Общий труд и пережитые выходы сделали их своими. Рядом работа спорится, а перед выходом есть кому ответить по радио."
			: status === "rival" ? "Споры мешают общей смене. Развести по разным станкам можно сразу; общий разговор поможет разобраться в причинах."
			: pair.workTogether + pair.sortiesTogether === 0 ? "Пока нет общей истории. Отношения меняются после настоящих смен и перекрывающихся выходов в один сектор."
			: pair.score < 0 ? "Общий опыт пока обостряет разницу привычек. Важны и назначения, и разговоры после смены." : "Они уже узнают привычки друг друга. Дальнейшая история зависит от общих дел и твоих решений.",
		pendingEventId: pair.pending ? `${pair.id}:${pair.pending.eventId}` : null };
}
export function getScavRelations(state: GameState, scav: string | Pick<Scav, "id">): ScavRelationView[] {
	const id = actorId(scav);
	if (!state.scavs.some((person) => person.id === id)) return [];
	return state.social.pairs.filter((pair) => pair.scavIds.includes(id)).map((pair) => relationView(state, pair, id))
		.sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || a.id.localeCompare(b.id));
}
export function getScavRelationHistory(state: GameState, relationId: string): { label: string; text: string; at: number }[] {
	const pair = state.social.pairs.find((entry) => entry.id === relationId);
	if (!pair) return [];
	const names = pairPeople(state, pair).map((person) => person.name).join(" и ");
	return pair.decisions.map((decision) => {
		const option = options[decision.eventId].find((entry) => entry.id === decision.choiceId)!;
		return { label: option.label, text: `${names}: ${option.description}`, at: decision.at };
	});
}
function lossRemaining(loss: ScavLossReaction) {
	return Math.max(0, loss.severity - loss.workCompleted - loss.returnsCompleted * 4 - (loss.choiceId === "ritual" ? 12 : loss.choiceId === "listen" ? 6 : 0));
}
function griefFor(state: GameState, scavId: string) { return Math.min(24, state.social.losses.filter((loss) => loss.scavId === scavId).reduce((sum, loss) => sum + lossRemaining(loss), 0)); }
export function getLossReaction(state: GameState, scav: string | Pick<Scav, "id">): ScavLossView[] {
	return state.social.losses.filter((loss) => loss.scavId === actorId(scav)).map((loss) => {
		const remaining = lossRemaining(loss), label = loss.relationshipScore >= 16 ? "Пустая койка друга" : loss.relationshipScore <= -12 ? "Разговор, которого не будет" : "Один из своих не вернулся";
		return { id: loss.id, fallenId: loss.fallenId, fallenName: loss.fallenName, fallenAppearance: loss.fallenAppearance, mapId: loss.mapId, at: loss.at,
			relationshipLabel: relationLabel(loss.relationshipScore), severity: loss.severity, remaining, label,
			text: loss.relationshipScore >= 16 ? `${loss.fallenName} больше не ответит по знакомой частоте. Общая смена напоминает о пустом месте у станка.`
				: loss.relationshipScore <= -12 ? `Последний спор с ${loss.fallenName} теперь нельзя закончить. За раздражением осталось чувство, что важные слова не были сказаны.`
				: `${loss.fallenName} не вернулся из «${MAP_BY_ID[loss.mapId]!.name}». Даже у тех, кто мало успел познакомиться, стало тише за общим столом.`,
			resolved: loss.choiceId !== null, choiceId: loss.choiceId, workCompleted: loss.workCompleted, returnsCompleted: loss.returnsCompleted };
	});
}
export function getRoomSocialEffects(state: GameState, roomId: string, workerIds?: readonly string[]) {
	const room = state.shelter.rooms.find((item) => item.id === roomId);
	const ids = [...new Set(workerIds ?? room?.workerIds ?? [])];
	const active = ids.map((id) => state.scavs.find((scav) => scav.id === id)).filter((scav): scav is Scav => Boolean(scav && scav.status !== "raiding" && scav.health >= 25));
	const validRoom = room?.status === "ready" && ROOM_DEFINITIONS[room.type].production;
	const workers = active.map((scav) => {
		const peers = validRoom ? state.social.pairs.filter((pair) => pair.scavIds.includes(scav.id) && pair.scavIds.every((id) => active.some((person) => person.id === id))) : [];
		const companionship = clamp(peers.reduce((sum, pair) => sum + (pair.score >= 16 ? Math.min(0.1, pair.score / 600) : pair.score <= -12 ? Math.max(-0.1, pair.score / 600) : 0), 0), -0.1, 0.1);
		const grief = validRoom ? griefFor(state, scav.id) / 400 : 0;
		const multiplier = clamp(1 + companionship - grief, 0.88, 1.1);
		return { scavId: scav.id, multiplier, percent: (multiplier - 1) * 100,
			reason: [companionship > 0 ? "Друг рядом у станка" : companionship < 0 ? "Спор в общей смене" : "", grief > 0 ? "Переживает потерю товарища" : ""].filter(Boolean).join(" · ") || "Общая история пока не влияет на смену" };
	});
	const skill = room ? ROOM_DEFINITIONS[room.type].workerSkill : "balanced";
	const weight = (scav: Scav) => (700 + Math.round(clamp(skill === "combat" ? scav.combat : skill === "scouting" ? scav.scouting : (scav.combat + scav.scouting) / 2, 0, 100)) * 10)
		* getScavProfileEffects(scav).work * getScavStoryEffects(scav).work;
	const total = active.reduce((sum, scav) => sum + weight(scav), 0);
	const modified = active.reduce((sum, scav, index) => sum + weight(scav) * workers[index]!.multiplier, 0);
	const levelMultiplier = room ? (9 + room.level) / 10 : 1;
	const neutralRate = Math.floor(total * levelMultiplier), actualRate = Math.floor(modified * levelMultiplier);
	const multiplier = neutralRate ? actualRate / neutralRate : 1;
	const pairs = validRoom ? state.social.pairs.filter((pair) => pair.scavIds.every((id) => active.some((scav) => scav.id === id))).map((pair) => relationView(state, pair, pair.scavIds[0])) : [];
	return { multiplier, percent: (multiplier - 1) * 100, workers, pairs,
		label: multiplier > 1.00001 ? "Свои рядом: смена быстрее" : multiplier < 0.99999 ? "Напряжение в смене" : "Спокойная смена" };
}
export function getRaidSocialSupport(state: GameState, scav: string | Pick<Scav, "id">, mapId?: string) {
	const id = actorId(scav), person = state.scavs.find((item) => item.id === id);
	const friends = person ? state.social.pairs.filter((pair) => pair.scavIds.includes(id) && pair.score >= 16).map((pair) => {
		const peer = state.scavs.find((item) => item.id === pair.scavIds.find((peerId) => peerId !== id))!;
		const raid = state.raids.find((item) => item.scavId === peer.id);
		const available = peer.health >= 25 && (peer.status !== "raiding" || Boolean(mapId && raid?.mapId === mapId));
		return { peer, score: pair.score, available, viaSector: Boolean(raid) };
	}).filter((entry) => entry.available).sort((a, b) => b.score - a.score || a.peer.id.localeCompare(b.peer.id)) : [];
	const supporter = friends[0], support = supporter ? Math.min(0.02, supporter.score / 1500) : 0;
	const griefPenalty = Math.min(0.03, griefFor(state, id) / 800), chance = support - griefPenalty;
	return { chance, percent: chance * 100, supporterId: supporter?.peer.id ?? null, supporterName: supporter?.peer.name ?? null, griefPenalty,
		description: [supporter ? `${supporter.peer.name}: ${supporter.viaSector ? "отвечает по радио из того же сектора" : "проверяет маршрут и ждёт на связи в убежище"} (+${(support * 100).toFixed(1)} п.п.)` : "Друга на связи пока нет",
			griefPenalty ? `пережитая потеря: −${(griefPenalty * 100).toFixed(1)} п.п.` : ""].filter(Boolean).join(" · ") };
}

/** Called only for units of work actually credited by the shelter simulation. */
export function creditSquadWork(state: GameState, room: RoomInstance, job: ProductionJob, creditedWork: number) {
	if (creditedWork <= 0 || room.status !== "ready") return;
	const workers = room.workerIds.filter((id) => {
		const scav = state.scavs.find((person) => person.id === id);
		return scav && scav.health >= 25 && scav.status !== "raiding" && scav.assignment === room.id;
	});
	for (const pair of state.social.pairs) if (pair.scavIds.every((id) => workers.includes(id))) {
		if (pair.workCredit?.jobId !== job.id) pair.workCredit = { jobId: job.id, roomId: room.id, workDone: 0 };
		pair.workCredit.workDone = Math.min(job.workRequired, pair.workCredit.workDone + creditedWork);
	}
	for (const loss of state.social.losses) if (workers.includes(loss.scavId)) {
		if (loss.workCredit?.jobId !== job.id) loss.workCredit = { jobId: job.id, roomId: room.id, workDone: 0 };
		loss.workCredit.workDone = Math.min(job.workRequired, loss.workCredit.workDone + creditedWork);
	}
}
function qualifiedWorkPairs(state: GameState, job: ProductionJob) {
	return state.social.pairs.filter((pair) => pair.workCredit?.jobId === job.id && pair.workCredit.workDone >= Math.ceil(job.workRequired / 5));
}
export function getSocialProductionWorkers(state: GameState, room: RoomInstance, job: ProductionJob): string[] {
	return [...new Set([...room.workerIds.filter((id) => {
		const scav = state.scavs.find((person) => person.id === id);
		return scav && scav.health >= 25 && scav.status !== "raiding";
	}), ...qualifiedWorkPairs(state, job).flatMap((pair) => pair.scavIds),
		...state.social.losses.filter((loss) => loss.workCredit?.jobId === job.id && loss.workCredit.workDone >= Math.ceil(job.workRequired / 5)).map((loss) => loss.scavId)])];
}
export function noteSquadProduction(state: GameState, room: RoomInstance, job: ProductionJob, workers: readonly string[], now: number) {
	for (const pair of qualifiedWorkPairs(state, job)) {
		if (pair.lastWorkId === job.id) continue;
		pair.workTogether++; pair.lastWorkId = job.id; pair.lastWorkRoomId = room.id; pair.lastAt = now; pair.score = calculatedScore(pair);
		offerPairEvent(pair, { at: now, sourceIds: [job.id], mapId: null, roomId: room.id });
	}
	for (const pair of state.social.pairs) if (pair.workCredit?.jobId === job.id) pair.workCredit = null;
	for (const loss of state.social.losses) if (loss.workCredit?.jobId === job.id) {
		if (workers.includes(loss.scavId) && loss.workCredit.workDone >= Math.ceil(job.workRequired / 5)) loss.workCompleted++;
		loss.workCredit = null;
	}
}
export function discardSquadWork(state: GameState, jobId: string) {
	for (const pair of state.social.pairs) if (pair.workCredit?.jobId === jobId) pair.workCredit = null;
	for (const loss of state.social.losses) if (loss.workCredit?.jobId === jobId) loss.workCredit = null;
}
export function noteSquadDispatch(state: GameState, raid: Raid) {
	for (const pair of state.social.pairs) if (pair.scavIds.includes(raid.scavId) && !pair.overlap) {
		const peerId = pair.scavIds.find((id) => id !== raid.scavId), peerRaid = state.raids.find((item) => item.scavId === peerId && item.id !== raid.id && item.mapId === raid.mapId);
		if (!peerRaid || (peerRaid.expedition?.status !== "choice" && peerRaid.endsAt <= raid.startedAt)) continue;
		pair.overlap = { raidIds: pair.scavIds.map((id) => id === raid.scavId ? raid.id : peerRaid.id) as [string, string],
			startedAt: pair.scavIds.map((id) => id === raid.scavId ? raid.startedAt : peerRaid.startedAt) as [number, number], mapId: raid.mapId, at: raid.startedAt, returned: [] };
	}
}
export function noteSquadRaid(state: GameState, scav: Scav, report: RaidReport) {
	if (report.lostScav) {
		for (const survivor of state.scavs) {
			const pair = state.social.pairs.find((entry) => entry.id === pairId(survivor.id, scav.id));
			const score = pair?.score ?? 0;
			state.social.losses.unshift({ id: `loss:${survivor.id}:${scav.id}:${report.raidId}`, scavId: survivor.id, fallenId: scav.id,
				fallenName: scav.name, fallenAppearance: appearance(scav), mapId: report.mapId, raidId: report.raidId, at: report.at,
				relationshipScore: score, severity: score >= 16 ? 24 : score <= -12 ? 12 : 8, baseBatches: survivor.story.counters.batches,
				baseRaids: survivor.raids, workCompleted: 0, returnsCompleted: 0, choiceId: null, choiceAt: null, workCredit: null });
		}
		removeSquadMember(state, scav.id);
		for (const survivor of state.scavs) {
			const keep = new Set(state.social.losses.filter((loss) => loss.scavId === survivor.id).slice(0, MAX_SCAV_LOSSES).map((loss) => loss.id));
			state.social.losses = state.social.losses.filter((loss) => loss.scavId !== survivor.id || keep.has(loss.id));
		}
		return;
	}
	for (const loss of state.social.losses) if (loss.scavId === scav.id) loss.returnsCompleted++;
	for (const pair of state.social.pairs) {
		const overlap = pair.overlap;
		if (!overlap?.raidIds.includes(report.raidId) || overlap.returned.some((entry) => entry.raidId === report.raidId)) continue;
		overlap.returned.push({ raidId: report.raidId, at: report.at, success: report.success });
		if (overlap.returned.length < 2) continue;
		pair.sortiesTogether++; if (overlap.returned.some((entry) => !entry.success)) pair.difficultSorties++;
		pair.lastSortieIds = [...overlap.raidIds]; pair.lastSortieMapId = overlap.mapId; pair.lastAt = report.at; pair.score = calculatedScore(pair);
		offerPairEvent(pair, { at: report.at, sourceIds: [...overlap.raidIds], mapId: overlap.mapId, roomId: null });
		pair.overlap = null;
	}
}

function choiceReason(state: GameState, actors: readonly string[], money: number, cost: Supplies) {
	if (actors.some((id) => state.scavs.find((scav) => scav.id === id)?.status === "raiding")) return "Разговор — когда оба вернутся в убежище.";
	if (state.money < money) return `Нужно ${money} ₽.`;
	const labels: Record<keyof Supplies, string> = { ammo: "патронов", medicine: "медикаментов", scrap: "деталей", intel: "разведданных" };
	for (const key of Object.keys(cost) as (keyof Supplies)[]) if (state.supplies[key] < cost[key]) return `Нужно ${cost[key]} ${labels[key]}.`;
	return null;
}
function pairNarrative(state: GameState, pair: SquadBond) {
	const [a, b] = pairPeople(state, pair);
	const pending = pair.pending!, sector = pending.mapId ? MAP_BY_ID[pending.mapId]!.name : null;
	return pending.eventId === "first_shift" ? { title: "Две кружки у станка", text: `${a!.name} и ${b!.name} завершили три оплаченные партии вместе. Теперь замечают, кто оставляет инструменты на краю стола, а кто перепроверяет чужую деталь. После смены один задержался у двери: есть повод поговорить.` }
		: pending.eventId === "friction" ? { title: "Чужие руки, общий станок", text: `${a!.name} и ${b!.name} снова спорят о порядке работы. Это уже мешает смене: усталость превращает разные привычки в личные претензии. Нужен разговор, в котором услышат обоих.` }
		: { title: "На знакомой частоте", text: `${a!.name} и ${b!.name} дважды вернулись живыми с перекрывающихся одиночных выходов${sector ? ` в «${sector}»` : " в один сектор"}. По радио передавали ориентиры и ждали чужой ответ. Теперь у них есть общая история, которую не видно в ведомости добычи.` };
}
export function getSquadSocialEvents(state: GameState, scav?: string | Pick<Scav, "id">): SquadSocialEvent[] {
	const filterId = scav ? actorId(scav) : null, events: SquadSocialEvent[] = [];
	for (const pair of state.social.pairs) {
		if (!pair.pending || (filterId && !pair.scavIds.includes(filterId))) continue;
		const people = pairPeople(state, pair), pending = pair.pending;
		events.push({ id: `${pair.id}:${pending.eventId}`, eventId: pending.eventId, pairId: pair.id, scavIds: [...pair.scavIds], names: people.map((person) => person.name), appearances: people.map(appearance),
			...pairNarrative(state, pair), at: pending.at, choices: options[pending.eventId].map((option) => ({ id: option.id, label: option.label, description: option.description,
				cost: { money: option.money, supplies: { ...option.supplies } }, effectLabel: `Отношения +${calculatedScore({ ...pair, decisions: [...pair.decisions, { ...pending, choiceId: option.id }] }) - pair.score}`,
				reason: choiceReason(state, pair.scavIds, option.money, option.supplies) })) });
	}
	for (const loss of state.social.losses) {
		if (loss.choiceId !== null || (filterId && loss.scavId !== filterId)) continue;
		const person = state.scavs.find((scav) => scav.id === loss.scavId)!, view = getLossReaction(state, loss.scavId).find((item) => item.id === loss.id)!;
		events.push({ id: loss.id, eventId: "loss", pairId: null, scavIds: [person.id], names: [person.name, loss.fallenName], appearances: [appearance(person), loss.fallenAppearance],
			title: view.label, text: `${person.name}: ${view.text} Поддержка, законченные смены и собственные возвращения помогут пережить потерю; память о товарище останется.`, at: loss.at,
			choices: [{ id: "ritual", label: "Устроить вечер памяти", description: "Помочь уснуть, поставить на общий стол личную вещь товарища и выслушать всё, что осталось несказанным.", cost: { money: 0, supplies: supplies({ medicine: 1 }) }, effectLabel: `Переживание −${Math.min(12, view.remaining)}`,
				reason: choiceReason(state, [person.id], 0, supplies({ medicine: 1 })) },
				{ id: "listen", label: "Остаться рядом", description: "Без обещаний и требований посидеть рядом. Для поддержки не нужны деньги или припасы.", cost: { money: 0, supplies: supplies() }, effectLabel: `Переживание −${Math.min(6, view.remaining)}`,
					reason: choiceReason(state, [person.id], 0, supplies()) }] });
	}
	return events.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
/** Presentation invalidation excludes per-tick in-flight production accounting. */
export function getSocialPresentationKey(state: GameState): string {
	return JSON.stringify({ pairs: state.social.pairs.map((pair) => [pair.id, pair.score, pair.workTogether, pair.sortiesTogether, pair.pending?.eventId ?? null, pair.decisions.map((decision) => decision.choiceId)]),
		losses: state.social.losses.map((loss) => [loss.id, lossRemaining(loss), loss.choiceId]),
		people: state.scavs.map((scav) => [scav.id, scav.status, scav.health >= 25, scav.assignment]),
		raids: state.raids.map((raid) => [raid.scavId, raid.mapId]),
		// Affordability changes choices; repeated income ticks with unchanged quotes do not.
		choices: getSquadSocialEvents(state).map((event) => [event.id, event.choices.map((choice) => choice.reason)]) });
}
export function resolveSocialEvent(state: GameState, eventId: string, choiceId: string): ActionResult {
	const event = getSquadSocialEvents(state).find((item) => item.id === eventId), quote = event?.choices.find((choice) => choice.id === choiceId);
	if (!event || !quote) return { ok: false, message: "Этот разговор уже завершён или выбор не предлагается." };
	if (quote.reason) return { ok: false, message: quote.reason };
	state.money -= quote.cost.money;
	for (const key of Object.keys(quote.cost.supplies) as (keyof Supplies)[]) state.supplies[key] -= quote.cost.supplies[key];
	if (event.eventId === "loss") {
		const loss = state.social.losses.find((entry) => entry.id === eventId)!;
		loss.choiceId = choiceId as "listen" | "ritual"; loss.choiceAt = state.lastUpdated;
	} else {
		const pair = state.social.pairs.find((entry) => entry.id === event.pairId)!, source = pair.pending!;
		pair.decisions.push({ ...source, sourceIds: [...source.sourceIds], choiceId, at: state.lastUpdated });
		pair.pending = null; pair.score = calculatedScore(pair);
		// A later milestone may have happened while the first conversation waited.
		const kind = SQUAD_EVENT_KINDS.find((candidate) => !pair.decisions.some((entry) => entry.eventId === candidate) && milestone(pair, candidate));
		if (kind) {
			const isWork = kind === "first_shift" || kind === "friction" && pair.lastWorkId !== null;
			offerPairEvent(pair, { at: state.lastUpdated, sourceIds: isWork ? [pair.lastWorkId!] : [...(pair.lastSortieIds ?? [])], mapId: isWork ? null : pair.lastSortieMapId,
				roomId: isWork ? pair.lastWorkRoomId : null });
		}
	}
	return { ok: true, message: `${event.names.join(" и ")}: ${quote.label}. Разговор останется в общей истории.` };
}
export function rebaseSquadSocialClock(state: GameState, shift: number) {
	const rebase = (at: number) => Math.max(0, at - shift);
	for (const pair of state.social.pairs) {
		pair.lastAt = rebase(pair.lastAt); if (pair.pending) pair.pending.at = rebase(pair.pending.at);
		for (const decision of pair.decisions) decision.at = rebase(decision.at);
		if (pair.overlap) { pair.overlap.at = rebase(pair.overlap.at); pair.overlap.startedAt = pair.overlap.startedAt.map(rebase) as [number, number]; for (const returned of pair.overlap.returned) returned.at = rebase(returned.at); }
	}
	for (const loss of state.social.losses) { loss.at = rebase(loss.at); if (loss.choiceAt !== null) loss.choiceAt = rebase(loss.choiceAt); }
}

type Obj = Record<string, unknown>;
function object(value: unknown, fields: readonly string[]): Obj {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("social-object");
	const source = value as Obj;
	if (Object.keys(source).some((key) => !fields.includes(key))) throw new Error("social-field");
	return source;
}
function num(value: unknown, max = 1e15, min = 0, integer = true): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) throw new Error("social-number");
	return value;
}
function str(value: unknown, max = 120): string {
	if (typeof value !== "string" || !value.length || value.length > max) throw new Error("social-string");
	return value;
}
function list<T>(value: unknown, max: number, parse: (item: unknown) => T): T[] {
	if (!Array.isArray(value) || value.length > max) throw new Error("social-array");
	return value.map((item) => parse(item));
}
function nullableString(value: unknown): string | null { return value === null ? null : str(value); }
function eventSource(source: Obj): SquadEventSource {
	const eventId = str(source.eventId) as SquadEventKind;
	if (!SQUAD_EVENT_KINDS.includes(eventId)) throw new Error("social-event");
	return { eventId, at: num(source.at, 1e15, 0, false), sourceIds: list(source.sourceIds, 2, str), mapId: nullableString(source.mapId), roomId: nullableString(source.roomId),
		workTogether: num(source.workTogether, 1e9), sortiesTogether: num(source.sortiesTogether, 1e9), difficultSorties: num(source.difficultSorties, 1e9) };
}
export function parseSquadSocialState(value: unknown): SquadSocialState {
	const source = object(value, ["pairs", "losses"]);
	return { pairs: list(source.pairs, MAX_SQUAD_PAIRS, (entry): SquadBond => {
		const pair = object(entry, ["id", "scavIds", "compatibility", "score", "workTogether", "sortiesTogether", "difficultSorties", "lastWorkId", "lastWorkRoomId", "lastSortieIds", "lastSortieMapId", "lastAt", "pending", "decisions", "workCredit", "overlap"]);
		const scavIds = list(pair.scavIds, 2, str); if (scavIds.length !== 2) throw new Error("social-pair");
		const lastSortieIds = pair.lastSortieIds === null ? null : list(pair.lastSortieIds, 2, str); if (lastSortieIds && lastSortieIds.length !== 2) throw new Error("social-sortie");
		let workCredit: SquadBond["workCredit"] = null, overlap: SquadBond["overlap"] = null;
		if (pair.workCredit !== null) { const credit = object(pair.workCredit, ["jobId", "roomId", "workDone"]); workCredit = { jobId: str(credit.jobId), roomId: str(credit.roomId), workDone: num(credit.workDone, 1e12, 1) }; }
		if (pair.overlap !== null) {
			const link = object(pair.overlap, ["raidIds", "startedAt", "mapId", "at", "returned"]), raids = list(link.raidIds, 2, str), startedAt = list(link.startedAt, 2, (value) => num(value, 1e15, 0, false));
			if (raids.length !== 2 || startedAt.length !== 2) throw new Error("social-overlap");
			overlap = { raidIds: raids as [string, string], startedAt: startedAt as [number, number], mapId: str(link.mapId), at: num(link.at, 1e15, 0, false), returned: list(link.returned, 1, (value) => {
				const returned = object(value, ["raidId", "at", "success"]); if (typeof returned.success !== "boolean") throw new Error("social-success");
				return { raidId: str(returned.raidId), at: num(returned.at, 1e15, 0, false), success: returned.success };
			}) };
		}
		return { id: str(pair.id), scavIds: scavIds as [string, string], compatibility: num(pair.compatibility, 2, -2), score: num(pair.score, 60, -60),
			workTogether: num(pair.workTogether, 1e9), sortiesTogether: num(pair.sortiesTogether, 1e9), difficultSorties: num(pair.difficultSorties, 1e9),
			lastWorkId: nullableString(pair.lastWorkId), lastWorkRoomId: nullableString(pair.lastWorkRoomId), lastSortieIds: lastSortieIds as [string, string] | null, lastSortieMapId: nullableString(pair.lastSortieMapId), lastAt: num(pair.lastAt, 1e15, 0, false),
			pending: pair.pending === null ? null : eventSource(object(pair.pending, ["eventId", "at", "sourceIds", "mapId", "roomId", "workTogether", "sortiesTogether", "difficultSorties"])),
			decisions: list(pair.decisions, 3, (value) => { const decision = object(value, ["eventId", "at", "sourceIds", "mapId", "roomId", "choiceId", "workTogether", "sortiesTogether", "difficultSorties"]);
				return { ...eventSource(decision), choiceId: str(decision.choiceId), workTogether: num(decision.workTogether, 1e9), sortiesTogether: num(decision.sortiesTogether, 1e9), difficultSorties: num(decision.difficultSorties, 1e9) }; }), workCredit, overlap };
	}), losses: list(source.losses, 15 * MAX_SCAV_LOSSES, (entry): ScavLossReaction => {
		const loss = object(entry, ["id", "scavId", "fallenId", "fallenName", "fallenAppearance", "mapId", "raidId", "at", "relationshipScore", "severity", "baseBatches", "baseRaids", "workCompleted", "returnsCompleted", "choiceId", "choiceAt", "workCredit"]);
		if (!isScavAppearance(loss.fallenAppearance) || ![null, "listen", "ritual"].includes(loss.choiceId as string | null)) throw new Error("social-loss");
		let workCredit: ScavLossReaction["workCredit"] = null;
		if (loss.workCredit !== null) { const credit = object(loss.workCredit, ["jobId", "roomId", "workDone"]); workCredit = { jobId: str(credit.jobId), roomId: str(credit.roomId), workDone: num(credit.workDone, 1e12, 1) }; }
		return { id: str(loss.id), scavId: str(loss.scavId), fallenId: str(loss.fallenId), fallenName: str(loss.fallenName, 30), fallenAppearance: loss.fallenAppearance,
			mapId: str(loss.mapId), raidId: str(loss.raidId), at: num(loss.at, 1e15, 0, false), relationshipScore: num(loss.relationshipScore, 60, -60), severity: num(loss.severity, 24),
			baseBatches: num(loss.baseBatches, 1e9), baseRaids: num(loss.baseRaids, 1e9), workCompleted: num(loss.workCompleted, 1e9), returnsCompleted: num(loss.returnsCompleted, 1e9),
			choiceId: loss.choiceId as ScavLossReaction["choiceId"], choiceAt: loss.choiceAt === null ? null : num(loss.choiceAt, 1e15, 0, false), workCredit };
	}) };
}

/** Explicit schema validation: saved prose cannot change authored outcomes or modifiers. */
export function validateSquadSocialState(state: GameState) {
	const unique = (values: readonly string[]) => { if (new Set(values).size !== values.length) throw new Error("social-duplicate"); };
	const sourceId = (id: string, kind: "raid" | "job" | "scav") => { if (!new RegExp(`^${kind}-[1-9]\\d*$`).test(id) || Number(id.split("-")[1]) >= state.nextId) throw new Error("social-source"); };
	const existingRooms = new Set(state.shelter.rooms.map((room) => room.id)), queuedJobs = new Set(state.shelter.rooms.flatMap((room) => room.queue.map((job) => job.id)));
	const checkSource = (source: SquadEventSource, pair: SquadBond) => {
		if (source.at > state.lastUpdated || source.at < Math.max(...pairPeople(state, pair).map((person) => person.story.joinedAt))) throw new Error("social-time");
		if (source.workTogether > pair.workTogether || source.sortiesTogether > pair.sortiesTogether || source.difficultSorties > pair.difficultSorties || source.difficultSorties > source.sortiesTogether) throw new Error("social-source-counter");
		if (source.sourceIds.length === 1) {
			sourceId(source.sourceIds[0]!, "job"); if (queuedJobs.has(source.sourceIds[0]!) || source.mapId !== null || source.roomId === null || !existingRooms.has(source.roomId)) throw new Error("social-work-source");
		} else if (source.sourceIds.length === 2) {
			unique(source.sourceIds); for (const id of source.sourceIds) sourceId(id, "raid");
			if (source.roomId !== null || source.mapId === null || !MAP_BY_ID[source.mapId]) throw new Error("social-raid-source");
			for (const [index, id] of source.sourceIds.entries()) {
				if (state.raids.some((raid) => raid.id === id)) throw new Error("social-unfinished-return");
				const report = state.history.find((item) => item.raidId === id), person = pairPeople(state, pair)[index]!;
				if (report && (report.lostScav || report.scavName !== person.name || report.mapId !== source.mapId || report.at > source.at)) throw new Error("social-report-source");
			}
		} else throw new Error("social-source-count");
		if (source.eventId === "first_shift" && source.sourceIds.length !== 1 || source.eventId === "crossed_routes" && source.sourceIds.length !== 2) throw new Error("social-source-kind");
	};
	unique(state.social.pairs.map((pair) => pair.id)); unique(state.social.losses.map((loss) => loss.id));
	if (state.social.pairs.length !== state.scavs.length * (state.scavs.length - 1) / 2) throw new Error("social-pair-coverage");
	for (const pair of state.social.pairs) {
		unique(pair.scavIds); const people = pairPeople(state, pair);
		if (people.some((person) => !person) || pair.id !== pairId(...pair.scavIds) || pair.scavIds.join("~") !== pair.id || pair.compatibility !== compatibilityFor(people[0]!, people[1]!)) throw new Error("social-peer");
		if (pair.lastAt > state.lastUpdated || pair.lastAt < Math.max(...people.map((person) => person.story.joinedAt)) || pair.workTogether > Math.min(...people.map((person) => person.story.counters.batches))
			|| pair.sortiesTogether > Math.min(...people.map((person) => person.raids)) || pair.difficultSorties > pair.sortiesTogether || pair.difficultSorties > people.reduce((sum, person) => sum + person.story.counters.injuries, 0)) throw new Error("social-counters");
		if (pair.score !== calculatedScore(pair)) throw new Error("social-score");
		if ((pair.workTogether === 0) !== (pair.lastWorkId === null) || (pair.workTogether === 0) !== (pair.lastWorkRoomId === null)
			|| (pair.sortiesTogether === 0) !== (pair.lastSortieIds === null) || (pair.sortiesTogether === 0) !== (pair.lastSortieMapId === null)
			|| pair.lastWorkRoomId !== null && !existingRooms.has(pair.lastWorkRoomId) || pair.lastSortieMapId !== null && !MAP_BY_ID[pair.lastSortieMapId]) throw new Error("social-counter-source");
		if (pair.lastWorkId) { sourceId(pair.lastWorkId, "job"); if (queuedJobs.has(pair.lastWorkId)) throw new Error("social-work-unfinished"); }
		if (pair.lastSortieIds) { unique(pair.lastSortieIds); for (const id of pair.lastSortieIds) { sourceId(id, "raid"); if (state.raids.some((raid) => raid.id === id)) throw new Error("social-raid-unfinished"); } }
		unique(pair.decisions.map((entry) => entry.eventId));
		for (const [index, decision] of pair.decisions.entries()) {
			checkSource(decision, pair);
			if (!options[decision.eventId].some((option) => option.id === decision.choiceId) || decision.workTogether > pair.workTogether || decision.sortiesTogether > pair.sortiesTogether || decision.difficultSorties > decision.sortiesTogether || decision.difficultSorties > pair.difficultSorties
				|| !milestone({ ...pair, ...decision, decisions: pair.decisions.slice(0, index) }, decision.eventId) || index > 0 && decision.at < pair.decisions[index - 1]!.at) throw new Error("social-decision");
		}
		if (pair.pending) { checkSource(pair.pending, pair); if (pair.decisions.some((entry) => entry.eventId === pair.pending!.eventId) || !milestone({ ...pair, ...pair.pending }, pair.pending.eventId)) throw new Error("social-pending"); }
		if (pair.workCredit) {
			sourceId(pair.workCredit.jobId, "job"); const room = state.shelter.rooms.find((item) => item.id === pair.workCredit!.roomId), job = room?.queue[0];
			if (!job || job.id !== pair.workCredit.jobId || pair.workCredit.workDone > job.workDone) throw new Error("social-work-credit");
		}
		if (pair.overlap) {
			const overlap = pair.overlap; unique(overlap.raidIds); unique(overlap.returned.map((entry) => entry.raidId));
			if (!MAP_BY_ID[overlap.mapId] || overlap.at > state.lastUpdated || overlap.at < Math.max(...people.map((person) => person.story.joinedAt))
				|| Math.max(...overlap.startedAt) !== overlap.at || overlap.startedAt.some((at, index) => at < people[index]!.story.joinedAt)) throw new Error("social-overlap-time");
			for (const [index, id] of overlap.raidIds.entries()) {
				sourceId(id, "raid"); const returned = overlap.returned.find((entry) => entry.raidId === id), raid = state.raids.find((entry) => entry.id === id), person = people[index]!;
				if (returned) {
					if (raid || returned.at < overlap.at || returned.at > state.lastUpdated) throw new Error("social-return-time");
					const report = state.history.find((entry) => entry.raidId === id);
					if (report && (report.lostScav || report.success !== returned.success || report.at !== returned.at || report.scavName !== person.name || report.mapId !== overlap.mapId)) throw new Error("social-return-report");
					if (person.raids < 1) throw new Error("social-return-counter");
				} else if (!raid || raid.scavId !== person.id || raid.mapId !== overlap.mapId || raid.startedAt < overlap.startedAt[index]!
					|| raid.expedition && !raid.expedition.trail.some((event) => event.at === overlap.startedAt[index])) throw new Error("social-overlap-ref");
			}
			if (overlap.returned.some((entry) => !overlap.raidIds.includes(entry.raidId))) throw new Error("social-return-id");
		}
	}
	for (const loss of state.social.losses) {
		const survivor = state.scavs.find((person) => person.id === loss.scavId), memorial = state.memorials.find((person) => person.id === loss.fallenId), report = state.history.find((item) => item.raidId === loss.raidId);
		sourceId(loss.scavId, "scav"); sourceId(loss.fallenId, "scav"); sourceId(loss.raidId, "raid");
		if (!survivor || !memorial || state.scavs.some((person) => person.id === loss.fallenId) || loss.id !== `loss:${loss.scavId}:${loss.fallenId}:${loss.raidId}` || !MAP_BY_ID[loss.mapId]
			|| loss.at < survivor.story.joinedAt || loss.at > state.lastUpdated || loss.severity !== (loss.relationshipScore >= 16 ? 24 : loss.relationshipScore <= -12 ? 12 : 8)) throw new Error("social-loss-evidence");
		if (memorial && (memorial.name !== loss.fallenName || memorial.appearance !== loss.fallenAppearance || memorial.mapId !== loss.mapId || memorial.raidId !== loss.raidId || memorial.at !== loss.at)) throw new Error("social-loss-memorial");
		if (report && (!report.lostScav || report.scavName !== loss.fallenName || report.scavAppearance !== undefined && report.scavAppearance !== loss.fallenAppearance || report.mapId !== loss.mapId || report.at !== loss.at)) throw new Error("social-loss-report");
		if (loss.workCompleted + loss.baseBatches > survivor.story.counters.batches || loss.returnsCompleted + loss.baseRaids > survivor.raids || (loss.choiceId === null) !== (loss.choiceAt === null)
			|| loss.choiceAt !== null && (loss.choiceAt < loss.at || loss.choiceAt > state.lastUpdated) || state.social.losses.filter((entry) => entry.scavId === loss.scavId).length > MAX_SCAV_LOSSES) throw new Error("social-loss-recovery");
		if (loss.workCredit) {
			sourceId(loss.workCredit.jobId, "job"); const room = state.shelter.rooms.find((item) => item.id === loss.workCredit!.roomId), job = room?.queue[0];
			if (!job || job.id !== loss.workCredit.jobId || loss.workCredit.workDone > job.workDone) throw new Error("social-loss-work-credit");
		}
	}
	if (new Set(state.social.losses.map((loss) => loss.raidId)).size > state.stats.lostScavs || state.social.pairs.length > MAX_SQUAD_PAIRS || state.shelter.rooms.length > MAX_SHELTER_SITES) throw new Error("social-loss-count");
}
