import { MAP_BY_ID, WEAPON_BY_ID } from "./data";
import { TACTICS, type RaidTactic } from "./operations";
import { GEAR_MODEL_BY_ID, EXPEDITION_BRANCHES, type ExpeditionBranch } from "./systems";
import { MODULE_BY_ID, MODULE_SLOTS, type ModuleSlot } from "./modules";
import { RECRUIT_TRAITS } from "./recruitment";
import { defaultScavAppearance, isScavAppearance } from "./scav-appearances";
import { getRaidQuote, getFieldKitStock, FIELD_KITS, type FieldKit, type GameState, type Raid, type RaidReport, type Expedition } from "./engine";
import { getRaidFieldPlan } from "../raid-field";
import { isAmmoType } from "./ammunition";

export type SquadRaidRole = "point" | "cover" | "medic";
export const SQUAD_ROLE_LABELS: Record<SquadRaidRole, string> = { point: "Проводник", cover: "Прикрытие", medic: "Замыкающий" };
export interface SquadRaidMember {
	raidId: string; scavId: string; scavName: string; appearance: number;
	weaponInstanceId: string; weaponId: string; weaponModules: Partial<Record<ModuleSlot, string>>;
	role: SquadRaidRole; seed: number; combat: number; scouting: number; health: number;
	outcomeSeed?: number;
	traitId: string | null; tactic: RaidTactic; medkit: boolean;
	baseChance: number; chance: number; baseDuration: number; loadout: Expedition["loadout"];
}
export interface SquadRaidAction {
	id: string; stage: number; kind: "cover" | "hesitation" | "rescue";
	actorId: string; targetId: string; progress: number; text: string;
}
export interface SquadRaidSnapshot {
	leaderRaidId: string; routeSeed: number; stage: number; branch: ExpeditionBranch;
	members: SquadRaidMember[]; bonds: { scavIds: [string, string]; score: number }[];
	actions: SquadRaidAction[]; usedMedkits: string[];
}
export interface SquadRaidOutcome {
	scavId: string; raidId: string; success: boolean; lostScav: boolean; lostWeapon: boolean; health: number; rescuedBy: string | null;
}
export interface SquadRaidReport extends SquadRaidSnapshot { outcomes: SquadRaidOutcome[] }
export interface SquadRaidQuote {
	money: number; ammo: number; intel: number; medicine: number; chance: number; duration: number; reason: string | null;
	members: { scavId: string; scavName: string; role: SquadRaidRole; chance: number; money: number; ammo: number; intel: number; medicine: number }[];
	relationships: { scavIds: [string, string]; score: number; label: string }[]; rescueKits: number;
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
function generator(seed: number) {
	let value = seed >>> 0 || 0x6d2b79f5;
	return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 4294967296; };
}
const scoreFor = (snapshot: Pick<SquadRaidSnapshot, "bonds">, a: string, b: string) => snapshot.bonds.find((bond) => bond.scavIds.includes(a) && bond.scavIds.includes(b))?.score ?? 0;
export function getRaidGroupKey(raid: Pick<Raid, "id" | "squad">): string { return raid.squad?.leaderRaidId ?? raid.id; }
export function getRaidGroup(state: GameState, raid: Raid): Raid[] {
	return raid.squad ? raid.squad.members.map((member) => state.raids.find((other) => other.id === member.raidId)).filter((other): other is Raid => Boolean(other)) : state.raids.filter((other) => other.id === raid.id);
}
export function getSquadRaidActions(raid: Pick<Raid | RaidReport, "squad">, _now?: number): SquadRaidAction[] { return raid.squad?.actions ?? []; }
export function getSquadChanceBonus(bonds: SquadRaidSnapshot["bonds"], scavId: string): number {
	const peers = bonds.filter((bond) => bond.scavIds.includes(scavId));
	return clamp(.01 + peers.reduce((sum, bond) => sum + (bond.score >= 16 ? .015 : bond.score <= -12 ? -.025 : 0), 0), -.04, .04);
}
export function getSquadRaidQuote(state: GameState, scavIds: readonly string[], mapId: string): SquadRaidQuote {
	const result: SquadRaidQuote = { money: 0, ammo: 0, intel: 0, medicine: 0, chance: 0, duration: 0, reason: null, members: [], relationships: [], rescueKits: 0 };
	if (!Array.isArray(scavIds) || scavIds.length < 2 || scavIds.length > 3 || new Set(scavIds).size !== scavIds.length) { result.reason = "В отряде нужны 2–3 разных бойца."; return result; }
	const map = Object.hasOwn(MAP_BY_ID, mapId) ? MAP_BY_ID[mapId] : undefined;
	if (!map) { result.reason = "Сектор не найден."; return result; }
	const people = scavIds.map((id) => state.scavs.find((scav) => scav.id === id));
	if (people.some((person) => !person)) { result.reason = "Один из бойцов больше не доступен."; return result; }
	const weapons = people.map((person) => person!.weaponInstanceId).filter((id) => id !== null);
	if (new Set(weapons).size !== weapons.length || weapons.some((id) => state.raids.some((raid) => raid.weaponInstanceId === id))) { result.reason = "Каждому бойцу нужно своё свободное оружие."; return result; }
	for (let i = 0; i < scavIds.length; i++) for (let j = i + 1; j < scavIds.length; j++) {
		const ids = [scavIds[i]!, scavIds[j]!].sort() as [string, string];
		const score = state.social.pairs.find((pair) => pair.scavIds.includes(ids[0]) && pair.scavIds.includes(ids[1]))?.score ?? 0;
		result.relationships.push({ scavIds: ids, score, label: score >= 16 ? "Друзья прикрывают увереннее" : score <= -12 ? "Конфликт задерживает поддержку" : "Осваивают общий порядок" });
	}
	result.chance = 1;
	for (let i = 0; i < people.length; i++) {
		const scav = people[i]!, quote = getRaidQuote(state, scav, map), chance = clamp(quote.chance + getSquadChanceBonus(result.relationships, scav.id), .15, .97);
		const role: SquadRaidRole = i === 0 ? "point" : i === 1 ? "cover" : "medic";
		result.members.push({ scavId: scav.id, scavName: scav.name, role, chance, money: quote.money, ammo: quote.ammo, intel: quote.intel, medicine: quote.medicine });
		result.money += quote.money; result.ammo += quote.ammo; result.intel += quote.intel; result.medicine += quote.medicine;
		result.duration = Math.max(result.duration, quote.duration); result.chance *= chance;
		// Resource competition is checked for the full party below. Readiness is personal.
		const readiness = getRaidQuote({ ...state, money: Number.MAX_SAFE_INTEGER, supplies: { ...state.supplies, ammo: Number.MAX_SAFE_INTEGER, intel: Number.MAX_SAFE_INTEGER, medicine: Number.MAX_SAFE_INTEGER } }, scav, map).reason;
		if (!result.reason && readiness) result.reason = `${scav.name}: ${readiness}`;
	}
	if (!result.reason && state.money < result.money) result.reason = `Для отряда нужно ${result.money} ₽.`;
	if (!result.reason && state.supplies.ammo < result.ammo) result.reason = `Для отряда нужно ${result.ammo} патронов.`;
	if (!result.reason && state.supplies.intel < result.intel) result.reason = `Для отряда нужно ${result.intel} разведданных.`;
	if (!result.reason && state.supplies.medicine < result.medicine) result.reason = `Для личных аптечек нужно ${result.medicine} медикаментов.`;
	for (const kit of Object.keys(FIELD_KITS) as FieldKit[]) {
		const required = people.filter(person => person?.fieldKit === kit).length;
		if (!result.reason && getFieldKitStock(state)[kit] < required) result.reason = `Для отряда нужны ${required} комплекта «${FIELD_KITS[kit].label}». Изготовь недостающие или измени личные комплекты.`;
	}
	result.rescueKits = result.medicine;
	return result;
}
export function createSquadRaidSnapshot(state: GameState, raids: Raid[], routeSeed: number): SquadRaidSnapshot {
	const leader = raids[0]!;
	const members = raids.map((raid, index): SquadRaidMember => {
		const scav = state.scavs.find((person) => person.id === raid.scavId)!, weapon = state.weapons.find((gun) => gun.id === raid.weaponInstanceId)!;
		return { raidId: raid.id, scavId: scav.id, scavName: scav.name, appearance: scav.appearance ?? defaultScavAppearance(scav.personality), weaponInstanceId: weapon.id, weaponId: weapon.weaponId,
			weaponModules: Object.fromEntries(Object.entries(weapon.modules).map(([slot, part]) => [slot, part.modelId])), role: index === 0 ? "point" : index === 1 ? "cover" : "medic", seed: raid.seed,
			...(raid.outcomeSeed !== undefined ? { outcomeSeed: raid.outcomeSeed } : {}),
			combat: scav.combat, scouting: scav.scouting, health: scav.health, traitId: scav.profile.traitId, tactic: raid.tactic, medkit: raid.expedition!.loadout.medkit,
			baseChance: raid.expedition!.baseChance, chance: raid.chance, baseDuration: raid.expedition!.baseDuration, loadout: structuredClone(raid.expedition!.loadout) };
	});
	const bonds: SquadRaidSnapshot["bonds"] = [];
	for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
		const ids = [members[i]!.scavId, members[j]!.scavId].sort() as [string, string];
		bonds.push({ scavIds: ids, score: state.social.pairs.find((pair) => pair.scavIds.includes(ids[0]) && pair.scavIds.includes(ids[1]))?.score ?? 0 });
	}
	return { leaderRaidId: leader.id, routeSeed, stage: leader.expedition!.stage, branch: leader.expedition!.branch, members, bonds, actions: [], usedMedkits: [] };
}
export function getSquadRawOutcomes(snapshot: SquadRaidSnapshot, mapId: string): { member: SquadRaidMember; success: boolean; lostScav: boolean; lostWeapon: boolean }[] {
	const map = MAP_BY_ID[mapId]!;
	return snapshot.members.map((member) => {
		const random = generator(((member.outcomeSeed ?? member.seed) ^ Math.imul(snapshot.stage, 0x45d9f3b)) >>> 0), success = random() < member.chance;
		const fatal = generator(((member.outcomeSeed ?? member.seed) ^ Math.imul(snapshot.stage, 0x6c078965)) >>> 0);
		const lostWeapon = !success && fatal() < .2 + map.danger * .22 + (snapshot.stage - 1) * .08;
		const lostScav = !success && fatal() < (map.danger * .08 + (snapshot.stage - 1) * .018) * TACTICS[member.tactic].fatalityMultiplier;
		return { member, success, lostScav, lostWeapon: lostScav || lostWeapon };
	});
}
/** A frozen plan is also the settlement plan. It never draws game RNG or spends resources. */
export function planSquadRaidActions(raid: Raid): SquadRaidAction[] {
	const squad = raid.squad!;
	const field = getRaidFieldPlan(raid), contacts = field.segments.filter((segment) => segment.kind === "cover" || segment.kind === "skirmish");
	const first = contacts[0], last = contacts.at(-1);
	const combatAt = first ? first.start + (first.end - first.start) * .28 : .58;
	const rescueAt = last ? last.start + (last.end - last.start) * .64 : .82;
	const actions: SquadRaidAction[] = [];
	const add = (kind: SquadRaidAction["kind"], actor: SquadRaidMember, target: SquadRaidMember, progress: number, text: string) => actions.push({ id: `${squad.leaderRaidId}:${squad.stage}:${actions.length}`, stage: squad.stage, kind, actorId: actor.scavId, targetId: target.scavId, progress, text });
	for (const target of squad.members) {
		const actor = [...squad.members].filter((member) => member.scavId !== target.scavId).sort((a, b) => scoreFor(squad, b.scavId, target.scavId) - scoreFor(squad, a.scavId, target.scavId) || (a.role === "cover" ? -1 : b.role === "cover" ? 1 : 0) || a.scavId.localeCompare(b.scavId))[0]!;
		const score = scoreFor(squad, actor.scavId, target.scavId);
		add(score <= -12 ? "hesitation" : "cover", actor, target, combatAt + Math.min(.012, actions.length * .004), score <= -12 ? `${actor.scavName} спорит с ${target.scavName} о позиции. Прикрытие запаздывает; риск ранения выше.` : score >= 16 ? `${actor.scavName} узнаёт сигнал ${target.scavName} и уверенно прикрывает его переход. Ранения легче.` : `${actor.scavName} держит угол, пока ${target.scavName} пересекает улицу. Ранения легче.`);
	}
	const raw = getSquadRawOutcomes(squad, raid.mapId), medicsUsed = new Set(squad.usedMedkits);
	for (const victim of raw.filter((result) => result.lostScav)) {
		const random = generator((squad.routeSeed ^ (victim.member.outcomeSeed ?? victim.member.seed) ^ Math.imul(squad.stage, 0x51f15e5)) >>> 0);
		const helpers = raw.filter((result) => result.success && result.member.medkit && !medicsUsed.has(result.member.scavId)).sort((a, b) => scoreFor(squad, b.member.scavId, victim.member.scavId) - scoreFor(squad, a.member.scavId, victim.member.scavId) || a.member.scavId.localeCompare(b.member.scavId));
		const helper = helpers.find((result) => random() < (scoreFor(squad, result.member.scavId, victim.member.scavId) >= 16 ? .98 : scoreFor(squad, result.member.scavId, victim.member.scavId) <= -12 ? .3 : .72));
		if (!helper) continue;
		medicsUsed.add(helper.member.scavId);
		add("rescue", helper.member, victim.member, rescueAt, `${helper.member.scavName} тратит свою заранее взятую аптечку, стабилизирует ${victim.member.scavName} и вытаскивает его вместе с оружием. Отряд отходит.`);
	}
	return actions;
}
export function squadInjuryMultiplier(squad: SquadRaidSnapshot, scavId: string): number {
	const support = squad.actions.find((action) => action.targetId === scavId && (action.kind === "cover" || action.kind === "hesitation"));
	return !support ? 1 : support.kind === "hesitation" ? 1.12 : scoreFor(squad, support.actorId, scavId) >= 16 ? .8 : .92;
}

// Explicit reconstruction rejects hidden fields and injected combat outcomes.
const obj = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("squad-object");
	const source = value as Record<string, unknown>;
	if (Object.keys(source).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(source, key))) throw new Error("squad-fields");
	return source;
};
const str = (value: unknown, max = 100) => { if (typeof value !== "string" || value.length < 1 || value.length > max) throw new Error("squad-string"); return value; };
const num = (value: unknown, lo: number, hi: number, integer = false) => { if (typeof value !== "number" || !Number.isFinite(value) || value < lo || value > hi || integer && !Number.isInteger(value)) throw new Error("squad-number"); return value; };
const bool = (value: unknown) => { if (typeof value !== "boolean") throw new Error("squad-boolean"); return value; };
const arr = <T>(value: unknown, max: number, parser: (entry: unknown) => T): T[] => { if (!Array.isArray(value) || value.length > max) throw new Error("squad-array"); return value.map(parser); };
const known = <T>(value: unknown, values: Record<string, T>) => { const key = str(value); if (!Object.hasOwn(values, key)) throw new Error("squad-known"); return key; };
function parseMember(value: unknown, version: number): SquadRaidMember {
	const source = obj(value, ["raidId", "scavId", "scavName", "appearance", "weaponInstanceId", "weaponId", "weaponModules", "role", "seed", ...(value !== null && typeof value === "object" && Object.hasOwn(value, "outcomeSeed") ? ["outcomeSeed"] : []), "combat", "scouting", "health", "traitId", "tactic", "medkit", "baseChance", "chance", "baseDuration", "loadout"]);
	if (!isScavAppearance(source.appearance) || !["point", "cover", "medic"].includes(source.role as string)) throw new Error("squad-appearance-role");
	const modules = source.weaponModules;
	if (!modules || typeof modules !== "object" || Array.isArray(modules) || Object.keys(modules).some((slot) => !MODULE_SLOTS.includes(slot as ModuleSlot))) throw new Error("squad-modules");
	const weaponModules: SquadRaidMember["weaponModules"] = {};
	for (const [slot, model] of Object.entries(modules)) { const modelId = known(model, MODULE_BY_ID); if (MODULE_BY_ID[modelId]!.slot !== slot) throw new Error("squad-module-slot"); weaponModules[slot as ModuleSlot] = modelId; }
	const kit = obj(source.loadout, ["armorModelId", "armorCondition", "helmetModelId", "helmetCondition", "packModelId", "packCondition", "ammoType", "medkit"]);
	const model = (value: unknown, slot: "armor" | "helmet" | "backpack", empty: string | null) => { if (value === empty) return empty; const id = known(value, GEAR_MODEL_BY_ID); if (GEAR_MODEL_BY_ID[id]!.slot !== slot) throw new Error("squad-gear-slot"); return id; };
	if (!isAmmoType(kit.ammoType) || (version < 13 && kit.ammoType !== "standard" && kit.ammoType !== "piercing")) throw new Error("squad-ammo");
	const loadout: Expedition["loadout"] = { armorModelId: model(kit.armorModelId, "armor", "none")!, armorCondition: num(kit.armorCondition, 0, 100), helmetModelId: model(kit.helmetModelId, "helmet", null), helmetCondition: num(kit.helmetCondition, 0, 100), packModelId: model(kit.packModelId, "backpack", "none")!, packCondition: num(kit.packCondition, 0, 100), ammoType: kit.ammoType, medkit: bool(kit.medkit) };
	return { raidId: str(source.raidId), scavId: str(source.scavId), scavName: str(source.scavName, 30), appearance: source.appearance as number,
		weaponInstanceId: str(source.weaponInstanceId), weaponId: known(source.weaponId, WEAPON_BY_ID), weaponModules, role: source.role as SquadRaidRole,
		seed: num(source.seed, 1, 4294967295, true), ...(Object.hasOwn(source, "outcomeSeed") ? { outcomeSeed: num(source.outcomeSeed, 1, 4294967295, true) } : {}), combat: num(source.combat, 0, 100), scouting: num(source.scouting, 0, 100), health: num(source.health, 0, 100), traitId: source.traitId === null ? null : known(source.traitId, RECRUIT_TRAITS), tactic: known(source.tactic, TACTICS) as RaidTactic, medkit: bool(source.medkit), baseChance: num(source.baseChance, .15, .97), chance: num(source.chance, .15, .97), baseDuration: num(source.baseDuration, 20, 600), loadout };
}
export function parseSquadRaidSnapshot(value: unknown, report = false, version = 13): SquadRaidSnapshot | SquadRaidReport {
	const source = obj(value, ["leaderRaidId", "routeSeed", "stage", "branch", "members", "bonds", "actions", "usedMedkits", ...(report ? ["outcomes"] : [])]);
	const snapshot: SquadRaidSnapshot = { leaderRaidId: str(source.leaderRaidId), routeSeed: num(source.routeSeed, 1, 4294967295, true), stage: num(source.stage, 1, 3, true), branch: known(source.branch, EXPEDITION_BRANCHES) as ExpeditionBranch,
		members: arr(source.members, 3, (entry) => parseMember(entry, version)), bonds: arr(source.bonds, 3, (entry) => { const bond = obj(entry, ["scavIds", "score"]); const ids = arr(bond.scavIds, 2, (id) => str(id)); if (ids.length !== 2 || ids[0]! >= ids[1]!) throw new Error("squad-bond-ids"); return { scavIds: ids as [string, string], score: num(bond.score, -60, 60, true) }; }),
		actions: arr(source.actions, 6, (entry) => { const action = obj(entry, ["id", "stage", "kind", "actorId", "targetId", "progress", "text"]); if (!["cover", "hesitation", "rescue"].includes(action.kind as string)) throw new Error("squad-action-kind"); return { id: str(action.id), stage: num(action.stage, 1, 3, true), kind: action.kind as SquadRaidAction["kind"], actorId: str(action.actorId), targetId: str(action.targetId), progress: num(action.progress, 0, 1), text: str(action.text, 400) }; }), usedMedkits: arr(source.usedMedkits, 2, (id) => str(id)) };
	if (!report) return snapshot;
	return { ...snapshot, outcomes: arr(source.outcomes, 3, (entry) => { const outcome = obj(entry, ["scavId", "raidId", "success", "lostScav", "lostWeapon", "health", "rescuedBy"]); return { scavId: str(outcome.scavId), raidId: str(outcome.raidId), success: bool(outcome.success), lostScav: bool(outcome.lostScav), lostWeapon: bool(outcome.lostWeapon), health: num(outcome.health, 0, 100), rescuedBy: outcome.rescuedBy === null ? null : str(outcome.rescuedBy) }; }) };
}
function validateSnapshot(snapshot: SquadRaidSnapshot, mapId: string, nextId: number, report: boolean, publicSnapshot = false) {
	if (snapshot.members.length < 2 || new Set(snapshot.members.map((member) => member.scavId)).size !== snapshot.members.length || new Set(snapshot.members.map((member) => member.raidId)).size !== snapshot.members.length || new Set(snapshot.members.map((member) => member.weaponInstanceId)).size !== snapshot.members.length || snapshot.leaderRaidId !== snapshot.members[0]!.raidId || snapshot.routeSeed !== snapshot.members[0]!.seed) throw new Error("squad-members");
	for (const [index, member] of snapshot.members.entries()) {
		if (!/^raid-[1-9]\d*$/.test(member.raidId) || Number(member.raidId.slice(5)) >= nextId || !/^scav-[1-9]\d*$/.test(member.scavId) || Number(member.scavId.slice(5)) >= nextId || !/^gun-[1-9]\d*$/.test(member.weaponInstanceId) || Number(member.weaponInstanceId.slice(4)) >= nextId || member.role !== (index === 0 ? "point" : index === 1 ? "cover" : "medic") || member.medkit !== member.loadout.medkit || !member.weaponModules.receiver || MODULE_BY_ID[member.weaponModules.receiver]!.weaponId !== member.weaponId) throw new Error("squad-member-provenance");
	}
	const expectedBonds = snapshot.members.flatMap((member, index) => snapshot.members.slice(index + 1).map((peer) => [member.scavId, peer.scavId].sort().join("~"))).sort();
	if (snapshot.bonds.map((bond) => bond.scavIds.join("~")).sort().join("|") !== expectedBonds.join("|")) throw new Error("squad-bonds");
	const leader = snapshot.members[0]!;
	const fake: Raid = { id: leader.raidId, scavId: leader.scavId, scavName: leader.scavName, scavAppearance: leader.appearance, mapId,
		weaponInstanceId: leader.weaponInstanceId, startedAt: 0, endsAt: 20_000, chance: leader.chance, lootBonus: 0, seed: leader.seed,
		isAuto: false, tactic: leader.tactic, armorLevel: 0, backpackLevel: 0, squad: { ...snapshot, usedMedkits: [] },
		expedition: { stage: snapshot.stage, status: "travel", branch: snapshot.branch, cargo: { money: 0, supplies: { ammo: 0, medicine: 0, scrap: 0, intel: 0 }, weaponIds: [], modules: [] },
			perks: [], offers: [], discoveries: [], loadout: leader.loadout, autoDepth: 1, baseChance: leader.baseChance, baseDuration: leader.baseDuration,
			capacity: 8, ammoMultiplier: 1, trail: [], legacyLoot: false, gunCombatBonus: 0 } };
	if (!publicSnapshot && JSON.stringify(snapshot.actions) !== JSON.stringify(planSquadRaidActions(fake))) throw new Error("squad-combat-plan");
	const used = snapshot.actions.filter((action) => action.kind === "rescue").map((action) => action.actorId);
	if (report ? JSON.stringify(snapshot.usedMedkits) !== JSON.stringify(used) : snapshot.usedMedkits.length !== 0) throw new Error("squad-medkit-ledger");
}
export function validateSquadRaids(state: GameState, publicSnapshot = false) {
	for (const raid of state.raids) {
		const squad = raid.squad; if (!squad) continue;
		validateSnapshot(squad, raid.mapId, state.nextId, false, publicSnapshot);
		if (!raid.expedition || raid.expedition.legacyLoot || raid.isAuto || squad.stage !== raid.expedition.stage || squad.branch !== raid.expedition.branch) throw new Error("squad-expedition");
		if (!publicSnapshot && raid.expedition.status === "choice" && getSquadRawOutcomes(squad, raid.mapId).some((outcome) => !outcome.success)) throw new Error("squad-false-checkpoint");
		const encoded = JSON.stringify(squad);
		for (const member of squad.members) {
			const peer = state.raids.find((other) => other.id === member.raidId), scav = state.scavs.find((person) => person.id === member.scavId);
			if (!peer?.expedition || !scav || JSON.stringify(peer.squad) !== encoded || peer.scavId !== member.scavId || peer.scavName !== member.scavName || peer.scavAppearance !== member.appearance || peer.seed !== member.seed || peer.weaponInstanceId !== member.weaponInstanceId || peer.mapId !== raid.mapId || peer.startedAt !== raid.startedAt || peer.endsAt !== raid.endsAt || peer.expedition.status !== raid.expedition.status || peer.expedition.stage !== squad.stage || peer.expedition.branch !== squad.branch || JSON.stringify(peer.expedition.perks) !== JSON.stringify(raid.expedition.perks) || JSON.stringify(peer.expedition.offers) !== JSON.stringify(raid.expedition.offers) || peer.chance !== member.chance || peer.expedition.baseChance !== member.baseChance || peer.expedition.baseDuration !== member.baseDuration || scav.combat < member.combat || scav.scouting < member.scouting || scav.profile.traitId !== member.traitId || peer.tactic !== member.tactic || JSON.stringify(peer.expedition.loadout) !== JSON.stringify(member.loadout)) throw new Error("squad-owner-clock");
			if (peer.outcomeSeed !== member.outcomeSeed) throw new Error("squad-private-seed");
			const weapon = state.weapons.find((gun) => gun.id === member.weaponInstanceId)!;
			const actualModels = Object.fromEntries(Object.entries(weapon.modules).map(([slot, part]) => [slot, part.modelId]));
			if (weapon.weaponId !== member.weaponId || Object.keys(actualModels).length !== Object.keys(member.weaponModules).length || MODULE_SLOTS.some((slot) => actualModels[slot] !== member.weaponModules[slot]) || member.health < 25 || peer.expedition.status === "travel" && member.health !== scav.health) throw new Error("squad-frozen-equipment");
		}
	}
	for (const report of state.history) {
		const squad = report.squad; if (!squad) continue;
		validateSnapshot(squad, report.mapId, state.nextId, true, publicSnapshot);
		if (squad.stage !== report.depth || squad.outcomes.length !== squad.members.length || squad.outcomes.some((outcome, index) => outcome.scavId !== squad.members[index]!.scavId || outcome.raidId !== squad.members[index]!.raidId || outcome.success && (outcome.lostScav || outcome.lostWeapon) || outcome.lostScav && !outcome.lostWeapon)) throw new Error("squad-report-outcomes");
		const own = squad.outcomes.find((outcome) => outcome.raidId === report.raidId);
		if (!own || own.success !== report.success || own.lostScav !== report.lostScav || own.lostWeapon !== report.lostWeapon || squad.members.find((member) => member.raidId === report.raidId)?.scavName !== report.scavName) throw new Error("squad-report-owner");
		for (const outcome of squad.outcomes) {
			const rescue = squad.actions.find((action) => action.kind === "rescue" && action.targetId === outcome.scavId);
			const raw = getSquadRawOutcomes(squad, report.mapId).find((result) => result.member.scavId === outcome.scavId)!;
			if (!publicSnapshot && (outcome.success !== raw.success || outcome.lostScav !== (rescue ? false : raw.lostScav) || outcome.lostWeapon !== (rescue ? false : raw.lostWeapon)) || outcome.lostScav && outcome.health !== 0 || rescue && (outcome.health < 5 || outcome.health >= 25)) throw new Error("squad-causal-outcome");
			if (outcome.rescuedBy !== (rescue?.actorId ?? null) || rescue && (outcome.success || outcome.lostScav || outcome.lostWeapon)) throw new Error("squad-rescue-outcome");
			const peer = state.history.find((other) => other.raidId === outcome.raidId);
			if (peer && (JSON.stringify(peer.squad) !== JSON.stringify(squad) || peer.at !== report.at || peer.mapId !== report.mapId)) throw new Error("squad-report-group");
		}
	}
}
