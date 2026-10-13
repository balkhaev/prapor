import { describe, expect, test } from "bun:test";
import { advanceRaidFeedback, followRaidCamera, getRaidRoutePreview, RAID_ALERT_DURATION_MS, type RaidFeedbackState } from "../src/raid-feedback";
import { getRaidFieldFrame, getRaidFieldPlan } from "../src/raid-field";
import { createGame, dispatchRaid } from "../src/game/engine";

const frame = (segmentIndex: number, action: "move" | "skirmish" | "search" | "checkpoint", paused = false) => ({ segmentIndex, action, paused, label: `Участок ${segmentIndex}` });
const advance = (previous: RaidFeedbackState | null, segment = 0, action: "move" | "skirmish" | "search" | "checkpoint" = "move", deltaMs = 16, reducedMotion = false, paused = false) =>
	advanceRaidFeedback(previous, { raidId: "raid-1", planId: "plan-1", frame: frame(segment, action, paused), deltaMs, reducedMotion });

describe("raid presentation feedback", () => {
	test("opening or reloading mid-contact primes state without historical alerts or gunfire", () => {
		const initial = advance(null, 5, "skirmish");
		expect(initial.transition).toBeNull(); expect(initial.state.alert).toBeNull(); expect(initial.shot).toBeNull();
		expect(advance(initial.state, 5, "skirmish").transition).toBeNull();
		expect(advance(null, 5, "skirmish")).toEqual(initial);
	});
	test("each action transition emits once; alerts and a contact burst expire in finite time", () => {
		const initial = advance(null).state;
		let current = advance(initial, 1, "skirmish");
		expect(current.transition?.action).toBe("skirmish"); expect(current.shot?.hostile).toBe(false);
		current = advance(current.state, 1, "skirmish", 330);
		expect(current.transition).toBeNull(); expect(current.shot?.hostile).toBe(true);
		current = advance(current.state, 1, "skirmish", 370);
		expect(current.shot?.hostile).toBe(false);
		current = advance(current.state, 1, "skirmish", RAID_ALERT_DURATION_MS);
		expect(current.state.alert).toBeNull(); expect(current.shot).toBeNull();
		for (let i = 0; i < 10; i++) { current = advance(current.state, 1, "skirmish", 1600); expect(current.shot).toBeNull(); expect(current.transition).toBeNull(); }
		expect(advance(current.state, 3, "search").transition?.action).toBe("search");
	});
	test("reduced motion, paused contacts and settlements never produce shot cues", () => {
		const previous = advance(null).state;
		const reduced = advance(previous, 1, "skirmish", 16, true);
		expect(reduced.transition?.action).toBe("skirmish"); expect(reduced.shot).toBeNull();
		expect(advance(previous, 1, "skirmish", 16, false, true).shot).toBeNull();
		const settled = advanceRaidFeedback(previous, { raidId: "raid-1", planId: "plan-1", frame: frame(1, "checkpoint", true), deltaMs: 16, reducedMotion: false, settled: true });
		expect(settled.transition).toBeNull(); expect(settled.shot).toBeNull();
		const contact = advance(previous, 1, "skirmish");
		expect(advanceRaidFeedback(contact.state, { raidId: "raid-1", planId: "plan-1", frame: frame(2, "checkpoint", true), deltaMs: 16, reducedMotion: false, settled: true }).state.alert).toBeNull();
		for (const delta of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(advance(contact.state, 1, "skirmish", delta).state.alert?.remainingMs).toBe(RAID_ALERT_DURATION_MS);
	});
	test("route preview follows the live path, ends before the next action and never mutates simulation", () => {
		const now = 1_792_000_000_000, state = createGame(now);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", now).ok).toBe(true);
		const raid = state.raids[0]!, before = structuredClone(raid), plan = getRaidFieldPlan(raid);
		for (const segment of plan.segments) {
			const at = raid.startedAt + (raid.endsAt - raid.startedAt) * (segment.start + (segment.end - segment.start) * .7);
			const live = getRaidFieldFrame(raid, at, plan), preview = getRaidRoutePreview(plan, live, 2);
			if (!live.walking) { expect(preview).toEqual([]); continue; }
			expect(preview[0]).toEqual(live.position);
			let length = 0;
			for (let i = 1; i < preview.length; i++) {
				const a = preview[i - 1]!, b = preview[i]!;
				expect(a.x === b.x || a.y === b.y).toBe(true);
				length += Math.hypot(b.x - a.x, b.y - a.y);
			}
			expect(length).toBeLessThanOrEqual(2.000001);
		}
		expect(raid).toEqual(before);
		expect(getRaidRoutePreview(plan, getRaidFieldFrame(raid, raid.endsAt, plan))).toEqual([]);
	});
	test("follow snaps to a clear viewport position once, ignores micro-jitter and damps larger movement", () => {
		const view = { width: 840, height: 520 }, pawn = { x: 750, y: 450 };
		const snapped = followRaidCamera({ zoom: 2, x: 0, y: 0 }, pawn, view, 16, true);
		expect((pawn.x - snapped.x) * 2).toBeCloseTo(view.width * .46);
		expect((pawn.y - snapped.y) * 2).toBeCloseTo(view.height * .58);
		expect(followRaidCamera(snapped, { x: 752, y: 451 }, view, 16)).toEqual(snapped);
		const advanced = followRaidCamera(snapped, { x: 850, y: 500 }, view, 16);
		expect(advanced.x).toBeGreaterThan(snapped.x); expect(advanced.x).toBeLessThan(snapped.x + 100);
		expect(advanced.y).toBeGreaterThan(snapped.y); expect(advanced.y).toBeLessThan(snapped.y + 50);
		expect(followRaidCamera(snapped, { x: 850, y: 500 }, view, Number.NaN)).toEqual(snapped);
		expect(followRaidCamera(snapped, { x: 850, y: 500 }, view, 16, false, true).x).toBeCloseTo(snapped.x + 95.5);
	});
});
