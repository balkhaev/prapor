import type { Raid, RaidReport, WeaponInstance } from "./game/engine";
import type { SquadRaidAction, SquadRaidMember } from "./game/squad-raids";
import { findRaidFieldPath, getRaidFieldFrame, getRaidFieldPlan, getRaidFieldPlanId, isRaidFieldWalkable, type RaidFieldFrame, type RaidFieldPlan, type RaidFieldPoint } from "./raid-field";
import type { ScavVisualLoadout } from "./scav-loadout";
import { MODULE_SLOTS } from "./game/modules";

export type SquadStreetAction = RaidFieldFrame["action"] | "rescue" | "wounded" | "hesitation" | "escort" | "fallen";
export interface SquadRaidFieldMember {
	raid: Raid; scavId: string; name: string; appearance: number; role: SquadRaidMember["role"];
	position: RaidFieldPoint; direction: RaidFieldPoint; walking: boolean; action: SquadStreetAction;
	health: number; helpingId: string | null; helpedById: string | null; coordination: "friends" | "neutral" | "rivals";
	statusText: string; lostScav: boolean; lostWeapon: boolean; loadout: ScavVisualLoadout;
}
export interface SquadRaidFieldShot {
	actorId: string; targetId: string | null; enemyIndex: number; hostile: boolean; strength: number;
}
export interface SquadRaidFieldFrame {
	plan: RaidFieldPlan; frame: RaidFieldFrame; members: SquadRaidFieldMember[];
	actions: SquadRaidAction[]; activeActions: SquadRaidAction[]; activeAction: SquadRaidAction | null; focus: RaidFieldPoint; shots: SquadRaidFieldShot[];
}

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const length = (points: readonly RaidFieldPoint[]) => points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y), 0);
function sample(points: readonly RaidFieldPoint[], distance: number): RaidFieldPoint {
	let remaining = Math.max(0, distance);
	for (let index = 1; index < points.length; index++) {
		const from = points[index - 1]!, to = points[index]!, span = Math.hypot(to.x - from.x, to.y - from.y);
		if (remaining <= span || index === points.length - 1) {
			const fraction = span > 0 ? clamp(remaining / span) : 0;
			return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
		}
		remaining -= span;
	}
	return { ...(points[0] ?? { x: .5, y: .5 }) };
}
function tangent(points: readonly RaidFieldPoint[], at: number): RaidFieldPoint {
	const from = sample(points, at - .24), to = sample(points, at + .24), span = Math.hypot(to.x - from.x, to.y - from.y);
	return span > .0001 ? { x: (to.x - from.x) / span, y: (to.y - from.y) / span } : { x: 1, y: 0 };
}
function lane(plan: RaidFieldPlan, points: readonly RaidFieldPoint[], at: number, offset: number): { position: RaidFieldPoint; direction: RaidFieldPoint } {
	const position = sample(points, at), direction = tangent(points, at);
	const proposed = { x: position.x - direction.y * offset, y: position.y + direction.x * offset };
	// Offsets remain within the cardinal corridor, including corners; no cut through a solid cell.
	return { position: isRaidFieldWalkable(plan, proposed) ? proposed : position, direction };
}
function weaponSnapshot(member: SquadRaidMember, raid: Raid): WeaponInstance {
	const modules: WeaponInstance["modules"] = {};
	for (const slot of MODULE_SLOTS) {
		const modelId = member.weaponModules[slot];
		if (modelId) modules[slot] = { id: `${member.weaponInstanceId}:${slot}`, modelId, durability: 100, foundAt: raid.startedAt };
	}
	return { id: member.weaponInstanceId, weaponId: member.weaponId, durability: 100, attachments: { optic: 0, magazine: 0, stock: 0 }, modules, foundAt: raid.startedAt };
}
const roles = { point: "Впереди", cover: "Прикрытие", medic: "Помощь" };

/** A shared street route, frozen partners and authored combat actions; no renderer RNG or save mutation. */
export function getSquadRaidFieldFrame(raid: Raid, allRaids: readonly Raid[], now: number, suppliedPlan?: RaidFieldPlan, report?: RaidReport | null): SquadRaidFieldFrame | null {
	const squad = report?.squad ?? raid.squad;
	if (!squad || squad.members.length < 2) return null;
	const plan = suppliedPlan?.id === getRaidFieldPlanId(raid) ? suppliedPlan : getRaidFieldPlan(raid), frame = getRaidFieldFrame(raid, report ? raid.endsAt : Math.min(now, raid.endsAt), plan);
	const prefix = findRaidFieldPath(plan, { x: plan.entry.x - 2, y: plan.entry.y }, plan.entry);
	const points = [...prefix.slice(0, -1), ...plan.path], prefixLength = length(prefix);
	const travelled = prefixLength + plan.segments.slice(0, frame.segmentIndex).reduce((sum, segment) => sum + length(segment.path), 0)
		+ length(plan.segments[frame.segmentIndex]?.path ?? []) * frame.segmentProgress;
	const stage = raid.expedition?.stage ?? 1;
	const actions = squad.actions.filter((action) => action.stage === stage && action.progress <= frame.progress);
	const activeActions = !report && !frame.paused ? actions.filter((action) => {
		if (action.kind !== "rescue") return frame.enemyPositions.length > 0 && (frame.action === "cover" || frame.action === "skirmish");
		const segment = plan.segments.find((candidate) => action.progress >= candidate.start && action.progress <= candidate.end);
		return frame.progress <= (segment?.end ?? action.progress + .04);
	}) : [];
	const activeAction = [...activeActions].reverse().find((action) => action.kind === "rescue") ?? [...activeActions].reverse().find((action) => action.kind === "hesitation") ?? activeActions.at(-1) ?? null;
	const rescue = [...actions].reverse().find((action) => action.kind === "rescue") ?? null;
	const relation = (scavId: string) => {
		const scores = squad.bonds.filter((bond) => bond.scavIds.includes(scavId)).map((bond) => bond.score);
		return scores.some((score) => score <= -12) ? "rivals" as const : scores.some((score) => score >= 16) ? "friends" as const : "neutral" as const;
	};
	const distances = new Map(squad.members.map((member, index) => [member.scavId, travelled - index * (relation(member.scavId) === "rivals" ? .95 : .78)]));
	let rescueApproaching = false;
	if (rescue) {
		const targetAt = distances.get(rescue.targetId) ?? travelled, actorAt = distances.get(rescue.actorId) ?? travelled;
		const encounter = plan.segments.find((segment) => rescue.progress >= segment.start && rescue.progress <= segment.end);
		const phase = clamp((frame.progress - rescue.progress) / Math.max(.001, (encounter?.end ?? rescue.progress + .04) - rescue.progress));
		rescueApproaching = phase > 0 && phase < .55;
		// Approach along the same corridor, then remain alongside the rescued fighter on withdrawal.
		distances.set(rescue.actorId, actorAt + (targetAt - .35 - actorAt) * clamp(phase / .55));
	}
	const members = squad.members.map((member, index): SquadRaidFieldMember => {
		const actual = allRaids.find((candidate) => candidate.id === member.raidId);
		const memberRaid: Raid = actual ?? { ...raid, id: member.raidId, scavId: member.scavId, scavName: member.scavName, scavAppearance: member.appearance, weaponInstanceId: member.weaponInstanceId, seed: member.seed, tactic: member.tactic };
		const outcome = report?.squad?.outcomes.find((candidate) => candidate.scavId === member.scavId);
		const lostScav = Boolean(outcome?.lostScav), lostWeapon = Boolean(outcome?.lostWeapon);
		let at = distances.get(member.scavId) ?? travelled;
		if (lostScav) {
			const contact = [...plan.segments].reverse().find((segment) => segment.kind === "cover" || segment.kind === "skirmish");
			at = prefixLength + plan.segments.slice(0, contact ? plan.segments.indexOf(contact) : 0).reduce((sum, segment) => sum + length(segment.path), 0) - index * .78;
		}
		const slot = lane(plan, points, at, index === 0 ? 0 : index === 1 ? .15 : -.15);
		let action: SquadStreetAction = lostScav ? "fallen" : frame.action, statusText = roles[member.role], helpingId: string | null = null, helpedById: string | null = null;
		if (!lostScav && rescue && rescue.actorId === member.scavId) { action = activeAction?.kind === "rescue" ? "rescue" : "escort"; helpingId = rescue.targetId; statusText = action === "rescue" ? "Помогает товарищу" : "Выводит товарища"; }
		if (!lostScav && rescue && rescue.targetId === member.scavId) { action = activeAction?.kind === "rescue" ? "wounded" : "escort"; helpedById = rescue.actorId; statusText = action === "wounded" ? "Нужна помощь" : "Идёт с товарищем"; }
		const covering = [...activeActions].reverse().find((event) => event.kind === "cover" && event.actorId === member.scavId);
		const covered = activeActions.find((event) => event.kind === "cover" && event.targetId === member.scavId);
		const hesitating = activeActions.find((event) => event.kind === "hesitation" && event.actorId === member.scavId);
		const delayed = activeActions.find((event) => event.kind === "hesitation" && event.targetId === member.scavId);
		if (!lostScav && !rescue && covering) { action = "cover"; helpingId = covering.targetId; statusText = "Прикрывает товарища"; }
		if (!lostScav && !rescue && covered) { helpedById = covered.actorId; if (!helpingId) statusText = "Под прикрытием"; }
		if (!lostScav && !rescue && hesitating && !covering) { action = "hesitation"; statusText = "Медлит из-за конфликта"; }
		if (!lostScav && !rescue && delayed && !helpingId) statusText = "Прикрытие запаздывает";
		if (lostScav) statusText = "Погиб · последний контакт";
		const approaching = action === "rescue" && rescueApproaching;
		return { raid: memberRaid, scavId: member.scavId, name: member.scavName, appearance: member.appearance, role: member.role, ...slot,
			walking: !lostScav && !frame.paused && (frame.walking || approaching), action, health: outcome?.health ?? member.health, helpingId, helpedById, coordination: relation(member.scavId), statusText, lostScav, lostWeapon,
			loadout: { armorModelId: member.loadout.armorModelId || null, helmetModelId: member.loadout.helmetModelId, packModelId: member.loadout.packModelId || null, weapon: lostWeapon ? null : weaponSnapshot(member, raid) } };
	});
	const visible = members.filter((member) => !member.lostScav);
	const focus = (visible.length ? visible : members).reduce((value, member, _, all) => ({ x: value.x + member.position.x / all.length, y: value.y + member.position.y / all.length }), { x: 0, y: 0 });
	const shots: SquadRaidFieldShot[] = [];
	if (!report && !frame.paused && frame.enemyPositions.length && (frame.action === "skirmish" || activeActions.some((action) => action.kind === "cover"))) {
		const segment = plan.segments[frame.segmentIndex]!, elapsed = Math.max(0, (frame.progress - segment.start) * (raid.endsAt - raid.startedAt));
		for (const member of members.filter((candidate) => candidate.action !== "hesitation" && candidate.action !== "rescue" && candidate.action !== "wounded" && (candidate.role === "point" || candidate.helpingId && candidate.action === "cover"))) {
			const phase = (elapsed - (member.role === "point" ? 0 : 160)) % 620;
			if (phase >= 0 && phase < 80) shots.push({ actorId: member.scavId, targetId: null, enemyIndex: 0, hostile: false, strength: 1 - phase / 80 });
		}
		const phase = (elapsed - 310) % 780;
		if (phase >= 0 && phase < 80) shots.push({ actorId: "hostile-0", targetId: members[0]!.scavId, enemyIndex: 0, hostile: true, strength: 1 - phase / 80 });
	}
	return { plan, frame, members, actions, activeActions, activeAction, focus, shots };
}
