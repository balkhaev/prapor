import { describe, expect, test } from "bun:test";
import { MAPS } from "../src/game/data";
import { advance, continueExpedition, createGame, dispatchRaid, dispatchSquadRaid, getSquadRaidActions, parseSave, saveGame, type Raid } from "../src/game/engine";
import { getRaidFieldPlan, isRaidFieldWalkable, type RaidFieldPlan, type RaidFieldPoint } from "../src/raid-field";
import { getSquadRaidFieldFrame } from "../src/squad-raid-field";
import { earnSquadRelationship, fundedSquadFixture, genuineSquadSettlement } from "./squad-raid-fixtures";

const NOW = 1_792_000_000_000;

function start(mapId = "courtyard", offset = 0, count = 3) {
	const state = createGame(NOW + offset);
	state.level = 9; state.xp = 5760; state.money = 30_000;
	state.supplies = { ammo: 500, medicine: 50, scrap: 1_000, intel: 100 };
	expect(dispatchSquadRaid(state, state.scavs.slice(0, count).map((scav) => scav.id), mapId, state.lastUpdated).ok).toBe(true);
	return { state, raid: state.raids[0]! };
}

function safe(plan: RaidFieldPlan, point: RaidFieldPoint) {
	return Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.y >= 0 && point.x < plan.width && point.y < plan.height
		&& isRaidFieldWalkable(plan, point)
		&& !plan.buildings.some((building) => point.x >= building.x && point.x < building.x + building.width && point.y >= building.y && point.y < building.y + building.height)
		&& !plan.props.some((prop) => prop.blocking && Math.floor(prop.x) === Math.floor(point.x) && Math.floor(prop.y) === Math.floor(point.y));
}

function at(raid: Raid, fraction: number) { return raid.startedAt + (raid.endsAt - raid.startedAt) * fraction; }

function trueCheckpoint() {
	for (let offset = 0; offset < 512; offset++) {
		const result = start("courtyard", offset);
		advance(result.state, result.raid.endsAt);
		if (result.state.raids.length === 3 && result.state.raids.every((raid) => raid.expedition!.status === "choice")) return result;
	}
	throw new Error("No actual party checkpoint for field continuation");
}

describe("shared squad street choreography", () => {
	test("all real member raids share one randomized street while retaining their saved faces and distinct native weapons", () => {
		for (const map of MAPS) {
			const shapes = new Set<string>();
			for (const offset of [0, 7, 91, 123456]) {
				const { state, raid } = start(map.id, offset), plan = getRaidFieldPlan(raid);
				for (const memberRaid of state.raids) expect(getRaidFieldPlan(memberRaid)).toEqual(plan);
				shapes.add(JSON.stringify({ buildings: plan.buildings, path: plan.path, loot: plan.lootSpots }));
				const frame = getSquadRaidFieldFrame(raid, state.raids, at(raid, .32))!;
				expect(frame.members.map((member) => member.scavId)).toEqual(state.scavs.map((scav) => scav.id));
				expect(new Set(frame.members.map((member) => member.appearance)).size).toBe(3);
				expect(new Set(frame.members.map((member) => member.loadout.weapon!.weaponId)).size).toBe(3);
				for (const member of frame.members) {
					const actual = state.scavs.find((scav) => scav.id === member.scavId)!, gun = state.weapons.find((weapon) => weapon.id === actual.weaponInstanceId)!;
					expect(member.appearance).toBe(actual.appearance!); expect(member.loadout.weapon!.id).toBe(gun.id);
					expect(Object.fromEntries(Object.entries(member.loadout.weapon!.modules).map(([slot, part]) => [slot, part.modelId])))
						.toEqual(Object.fromEntries(Object.entries(gun.modules).map(([slot, part]) => [slot, part.modelId])));
				}
			}
			expect(shapes.size).toBeGreaterThanOrEqual(3);
		}
	});

	test("two and three fighters walk a cohesive formation through every sector without stacking or crossing a building or solid cover", () => {
		for (const map of MAPS) for (const offset of [0, 7, 91]) for (const count of [2, 3]) {
			const { state, raid } = start(map.id, offset, count), plan = getRaidFieldPlan(raid);
			for (let index = 0; index <= 180; index++) {
				const frame = getSquadRaidFieldFrame(raid, state.raids, at(raid, index / 180), plan)!;
				for (const member of frame.members) expect({ map: map.id, offset, index, scavId: member.scavId, safe: safe(plan, member.position) }).toEqual({ map: map.id, offset, index, scavId: member.scavId, safe: true });
				for (let first = 0; first < frame.members.length; first++) for (let second = first + 1; second < frame.members.length; second++) {
					const a = frame.members[first]!.position, b = frame.members[second]!.position, distance = Math.hypot(a.x - b.x, a.y - b.y);
					expect(distance).toBeGreaterThan(.05); expect(distance).toBeLessThan(3);
				}
			}
		}
	});

	test("arbitrary 30, 60 and 120 Hz sampling, selection of another teammate and reload produce exactly the same actors at the same clock", () => {
		const { state, raid } = start(), saved = saveGame(state), plan = getRaidFieldPlan(raid), target = at(raid, .73);
		const expected = getSquadRaidFieldFrame(raid, state.raids, target, plan)!;
		for (const hz of [30, 60, 120]) {
			for (let time = raid.startedAt; time < target; time += 1_000 / hz) getSquadRaidFieldFrame(raid, state.raids, time, plan);
			expect(getSquadRaidFieldFrame(raid, state.raids, target, plan)).toEqual(expected);
		}
		for (const memberRaid of state.raids) {
			const otherView = getSquadRaidFieldFrame(memberRaid, state.raids, target)!;
			expect(otherView.members.map((member) => ({ id: member.scavId, position: member.position, action: member.action })))
				.toEqual(expected.members.map((member) => ({ id: member.scavId, position: member.position, action: member.action })));
		}
		const restored = parseSave(saved)!;
		expect(getSquadRaidFieldFrame(restored.raids[0]!, restored.raids, target)).toEqual(expected);
		expect(saveGame(state)).toBe(saved);
	});

	test("street choreography remains continuous across movement, searching and contact boundaries", () => {
		for (const offset of [0, 7, 91]) {
			const { state, raid } = start("depot", offset), plan = getRaidFieldPlan(raid);
			for (const segment of plan.segments.slice(1)) {
				const boundary = at(raid, segment.start), before = getSquadRaidFieldFrame(raid, state.raids, boundary - .01, plan)!, after = getSquadRaidFieldFrame(raid, state.raids, boundary + .01, plan)!;
				for (const actor of before.members) {
					const next = after.members.find((member) => member.scavId === actor.scavId)!;
					expect(Math.hypot(next.position.x - actor.position.x, next.position.y - actor.position.y)).toBeLessThan(.02);
				}
			}
		}
	});

	test("future cover, rescue and hesitation stay hidden until their authored street contact and reveal no previews as inventory", () => {
		const { state, raid } = start(), saved = saveGame(state), duration = raid.endsAt - raid.startedAt;
		const initial = getSquadRaidFieldFrame(raid, state.raids, raid.startedAt)!;
		expect(initial.actions).toEqual([]); expect(initial.activeAction).toBeNull(); expect(initial.shots).toEqual([]);
		for (const action of getSquadRaidActions(raid)) {
			const before = getSquadRaidFieldFrame(raid, state.raids, at(raid, action.progress) - .01)!;
			expect(before.actions.some((candidate) => candidate.id === action.id)).toBe(false);
			const observed = getSquadRaidFieldFrame(raid, state.raids, raid.startedAt + Math.ceil(duration * action.progress))!;
			expect(observed.actions.some((candidate) => candidate.id === action.id)).toBe(true);
			if (action.kind === "cover") {
				expect(observed.members.find((member) => member.scavId === action.actorId)!.helpingId).toBe(action.targetId);
				expect(observed.members.find((member) => member.scavId === action.targetId)!.helpedById).toBe(action.actorId);
			}
		}
		expect(saveGame(state)).toBe(saved);
	});

	test("continuing changes the shared streets and rejects a stale plan before computing any member position", () => {
		const { state, raid } = trueCheckpoint(), oldPlan = getRaidFieldPlan(raid), perk = raid.expedition!.offers[0]!;
		expect(continueExpedition(state, state.raids[1]!.id, "combat", perk, state.lastUpdated).ok).toBe(true);
		const currentPlan = getRaidFieldPlan(raid); expect(currentPlan.id).not.toBe(oldPlan.id);
		const now = at(raid, .41), expected = getSquadRaidFieldFrame(raid, state.raids, now)!;
		expect(getSquadRaidFieldFrame(raid, state.raids, now, oldPlan)).toEqual(expected);
		expect(expected.plan.id).toBe(currentPlan.id);
		expect(expected.members.every((member) => safe(currentPlan, member.position))).toBe(true);
	});

	test("a held group checkpoint pauses every actor and all shots without exposing later actions", () => {
		const { state, raid } = trueCheckpoint(), before = getSquadRaidFieldFrame(raid, state.raids, raid.endsAt)!;
		expect(before.frame.paused).toBe(true); expect(before.members.every((member) => !member.walking)).toBe(true);
		expect(before.shots).toEqual([]); expect(before.activeAction).toBeNull();
		const after = getSquadRaidFieldFrame(raid, state.raids, raid.endsAt + 86_400_000)!;
		expect({ ...after, frame: { ...after.frame, weatherPhase: before.frame.weatherPhase } }).toEqual(before);
	});

	test("an old solo raid keeps its own presentation and is never inflated into a phantom group", () => {
		const state = createGame(NOW); expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		expect(getSquadRaidFieldFrame(state.raids[0]!, state.raids, NOW + 7_000)).toBeNull();
	});

	test("a genuine rescue approaches the wounded fighter along safe streets, stabilizes them and then escorts the same physical person", () => {
		const { departure, report } = genuineSquadSettlement("rescue"), raid = departure.raids[0]!, rescue = report.squad!.actions.find((action) => action.kind === "rescue")!, plan = getRaidFieldPlan(raid);
		const contact = plan.segments.find((segment) => rescue.progress >= segment.start && rescue.progress <= segment.end)!;
		for (let index = 0; index < 30; index++) {
			const progress = rescue.progress + (contact.end - rescue.progress) * index / 30, frame = getSquadRaidFieldFrame(raid, departure.raids, at(raid, progress), plan)!;
			expect(frame.members.every((member) => safe(plan, member.position))).toBe(true);
			const helper = frame.members.find((member) => member.scavId === rescue.actorId)!, victim = frame.members.find((member) => member.scavId === rescue.targetId)!;
			expect(helper.helpingId).toBe(victim.scavId); expect(victim.helpedById).toBe(helper.scavId);
			expect(helper.action).toBe("rescue"); expect(victim.action).toBe("wounded");
			if (index > 20) { expect(helper.walking).toBe(false); expect(Math.hypot(helper.position.x - victim.position.x, helper.position.y - victim.position.y)).toBeLessThan(.6); }
		}
		const escorted = getSquadRaidFieldFrame(raid, departure.raids, at(raid, Math.min(.99, contact.end + .01)), plan)!;
		expect(escorted.members.find((member) => member.scavId === rescue.actorId)!.action).toBe("escort");
		expect(escorted.members.find((member) => member.scavId === rescue.targetId)!.action).toBe("escort");
		const restored = parseSave(saveGame(departure))!, now = at(raid, rescue.progress + (contact.end - rescue.progress) * .8);
		expect(getSquadRaidFieldFrame(restored.raids[0]!, restored.raids, now)).toEqual(getSquadRaidFieldFrame(raid, departure.raids, now));
	});

	test("a genuine casualty report retains native people and their actual final health, removes only lost guns and never animates a corpse", () => {
		const { state, raids, report } = genuineSquadSettlement("casualty", true), frame = getSquadRaidFieldFrame(raids[0]!, [], report.at, undefined, report)!;
		for (const outcome of report.squad!.outcomes) {
			const actor = frame.members.find((member) => member.scavId === outcome.scavId)!, native = report.squad!.members.find((member) => member.scavId === outcome.scavId)!;
			expect(actor.name).toBe(native.scavName); expect(actor.appearance).toBe(native.appearance); expect(actor.health).toBe(outcome.health);
			expect(actor.lostScav).toBe(outcome.lostScav); expect(actor.lostWeapon).toBe(outcome.lostWeapon);
			if (outcome.lostScav) { expect(actor.action).toBe("fallen"); expect(actor.walking).toBe(false); expect(actor.health).toBe(0); }
			if (outcome.lostWeapon) expect(actor.loadout.weapon).toBeNull();
			else expect(actor.loadout.weapon!.id).toBe(native.weaponInstanceId);
			expect(safe(frame.plan, actor.position)).toBe(true);
			if (!outcome.lostScav) expect(actor.health).toBe(state.scavs.find((scav) => scav.id === actor.scavId)!.health);
		}
	});

	test("earned rival ties suppress supporting fire during hesitation while real friends cover their crossing", () => {
		for (const kind of ["friend", "rival"] as const) {
			const state = fundedSquadFixture(), memberIds = earnSquadRelationship(state, kind);
			expect(dispatchSquadRaid(state, memberIds, "courtyard", state.lastUpdated).ok).toBe(true);
			const raid = state.raids[0]!, action = raid.squad!.actions[0]!, plan = getRaidFieldPlan(raid), contact = plan.segments.find((segment) => action.progress >= segment.start && action.progress <= segment.end)!;
			const shots = new Set<string>();
			for (let progress = action.progress + .016; progress < contact.end; progress += .0005) {
				const frame = getSquadRaidFieldFrame(raid, state.raids, at(raid, progress), plan)!;
				expect(frame.members.every((member) => member.coordination === (kind === "friend" ? "friends" : "rivals"))).toBe(true);
				for (const shot of frame.shots.filter((shot) => !shot.hostile)) shots.add(shot.actorId);
				if (kind === "rival") expect(frame.members.every((member) => member.action === "hesitation" && !member.helpingId)).toBe(true);
				else expect(frame.members.every((member) => member.action === "cover" && member.helpingId)).toBe(true);
			}
			expect(shots.size === 0).toBe(kind === "rival");
		}
	});
});
