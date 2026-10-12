import { describe, expect, test } from "bun:test";
import { createGame, dispatchRaid, parseSave, saveGame, type Raid } from "../src/game/engine";
import { MAPS } from "../src/game/data";
import {
	findRaidFieldPath, getRaidFieldFrame, getRaidFieldOutcome, getRaidFieldPlan,
	isRaidFieldWalkable, projectRaidFieldPoint, type RaidFieldPlan, type RaidFieldPoint,
} from "../src/raid-field";

const NOW = 1_792_000_000_000;
function raidFor(mapId = "courtyard", seed = 698906565, stage = 1, branch: "scavenge" | "combat" | "recon" = "scavenge"): Raid {
	const state = createGame(NOW);
	state.level = 9; state.xp = 5760; state.money = 5000;
	state.supplies = { ammo: 200, medicine: 6, scrap: 40, intel: 100 };
	expect(dispatchRaid(state, state.scavs[0]!.id, mapId, NOW).ok).toBe(true);
	const raid = state.raids[0]!;
	raid.seed = seed; raid.expedition!.stage = stage; raid.expedition!.branch = branch;
	return raid;
}
function safe(plan: RaidFieldPlan, point: RaidFieldPoint) {
	return Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x < plan.width && point.y >= 0 && point.y < plan.height
		&& !plan.buildings.some((building) => point.x >= building.x && point.x < building.x + building.width && point.y >= building.y && point.y < building.y + building.height)
		&& !plan.props.some((prop) => prop.blocking && Math.floor(prop.x) === Math.floor(point.x) && Math.floor(prop.y) === Math.floor(point.y));
}
function safePath(plan: RaidFieldPlan, path: readonly RaidFieldPoint[]) {
	if (!path.length || !path.every((point) => safe(plan, point) && isRaidFieldWalkable(plan, point))) return false;
	return path.slice(1).every((point, index) => {
		const previous = path[index]!, dx = point.x - previous.x, dy = point.y - previous.y;
		if (Math.abs(dx) + Math.abs(dy) > 1.000001 || dx !== 0 && dy !== 0) return false;
		return [0, .25, .5, .75, 1].every((t) => safe(plan, { x: previous.x + dx * t, y: previous.y + dy * t }));
	});
}

describe("seeded street raid presentation", () => {
	test("all six sectors reproduce from saved seed while seeds, branches and stages produce distinct street plans", () => {
		const themes = new Set<string>();
		for (const map of MAPS) {
			const shapes = new Set<string>();
			for (const seed of [7, 91, 123456, 698906565]) {
				const raid = raidFor(map.id, seed), plan = getRaidFieldPlan(raid), before = structuredClone(raid);
				expect(getRaidFieldPlan(structuredClone(raid))).toEqual(plan);
				expect(raid).toEqual(before);
				expect(plan.mapId).toBe(map.id);
				themes.add(plan.theme.label);
				shapes.add(JSON.stringify({ buildings: plan.buildings, path: plan.path, loot: plan.lootSpots }));
			}
			expect(shapes.size).toBeGreaterThanOrEqual(3);
			const variants = new Set<string>();
			for (const stage of [1, 2, 3]) for (const branch of ["scavenge", "combat", "recon"] as const) {
				const plan = getRaidFieldPlan(raidFor(map.id, 123456, stage, branch));
				variants.add(JSON.stringify({ buildings: plan.buildings, path: plan.path, loot: plan.lootSpots }));
				if (branch === "combat") expect(plan.lootSpots[0]?.category).toBe("armory");
				if (branch === "recon") expect(plan.lootSpots[0]?.category).toBe("intel");
			}
			expect(variants.size).toBe(9);
		}
		expect(themes.size).toBe(6);
	});

	test("every generated route and loot approach remains connected without cutting through buildings or solid cover", () => {
		for (const map of MAPS) for (const seed of [7, 91, 123456, 698906565]) for (const stage of [1, 2, 3]) for (const branch of ["scavenge", "combat", "recon"] as const) {
			const plan = getRaidFieldPlan(raidFor(map.id, seed, stage, branch));
			expect({ id: plan.id, safe: safePath(plan, plan.path) }).toEqual({ id: plan.id, safe: true });
			expect(plan.path[0]).toEqual(plan.entry);
			expect(plan.path.at(-1)).toEqual(plan.checkpoint);
			expect(plan.segments.every((segment) => safePath(plan, segment.path))).toBe(true);
			for (const target of [plan.checkpoint, ...plan.lootSpots.map((spot) => spot.approach)]) {
				const path = findRaidFieldPath(plan, plan.entry, target);
				expect(path.at(-1)).toEqual(target);
				expect(safePath(plan, path)).toBe(true);
			}
			expect(plan.segments[0]?.start).toBe(0);
			expect(plan.segments.at(-1)?.end).toBe(1);
			expect(plan.segments.every((segment, i) => segment.end > segment.start && (i === 0 || segment.start === plan.segments[i - 1]!.end))).toBe(true);
		}
	});

	test("30, 60 and 120 Hz sampling gives the same position and observations at the same raid time, including reload", () => {
		for (const map of MAPS) {
			const raid = raidFor(map.id, 91, 2, "combat"), plan = getRaidFieldPlan(raid), duration = raid.endsAt - raid.startedAt;
			const at = raid.startedAt + Math.round(duration * .73), expected = getRaidFieldFrame(raid, at, plan);
			for (const hz of [30, 60, 120]) {
				for (let time = raid.startedAt; time < at; time += 1000 / hz) {
					const frame = getRaidFieldFrame(raid, time, plan);
					if (!safe(plan, frame.position)) throw new Error(`nonwalkable frame: ${plan.id} at ${time}`);
				}
				expect(getRaidFieldFrame(raid, at, plan)).toEqual(expected);
			}
			expect(getRaidFieldFrame(structuredClone(raid), at)).toEqual(expected);
			for (let i = 1; i < plan.segments.length; i++) {
				const boundary = raid.startedAt + plan.segments[i]!.start * duration;
				const before = getRaidFieldFrame(raid, boundary - .01, plan), after = getRaidFieldFrame(raid, boundary + .01, plan);
				expect(Math.hypot(after.position.x - before.position.x, after.position.y - before.position.y)).toBeLessThan(.01);
			}
		}
	});

	test("future searches, enemies and observation events stay hidden until their actual timeline interval", () => {
		const raid = raidFor("depot", 91, 2, "combat"), plan = getRaidFieldPlan(raid), duration = raid.endsAt - raid.startedAt;
		const initial = getRaidFieldFrame(raid, raid.startedAt, plan);
		expect(initial.visitedLootIds).toEqual([]);
		expect(initial.visibleLootIds).toEqual([]);
		expect(initial.enemyPositions).toEqual([]);
		for (const segment of plan.segments) {
			const now = raid.startedAt + Math.ceil((segment.start + segment.end) / 2 * duration);
			const frame = getRaidFieldFrame(raid, now, plan);
			expect(frame.observedEvents.every((event) => event.at <= now && event.at >= raid.startedAt)).toBe(true);
			if (segment.id !== plan.segments.at(-1)!.id) expect(frame.observedEvents.map((event) => event.label)).not.toContain(plan.segments.at(-1)!.label);
			const alreadySearched = plan.segments.filter((item) => item.kind === "search" && item.end < (now - raid.startedAt) / duration).map((item) => item.targetId!);
			expect(frame.visitedLootIds).toEqual(alreadySearched);
			if (segment.kind === "search") expect(frame.visibleLootIds).toContain(segment.targetId!);
			else expect(frame.visibleLootIds).toEqual(frame.visitedLootIds);
			if (segment.kind !== "cover" && segment.kind !== "skirmish") expect(frame.enemyPositions).toEqual([]);
		}
	});

	test("choice checkpoints hold the actor and observations forever and cannot reveal which future outcome a chance will roll", () => {
		const raid = raidFor("courtyard", 91), plan = getRaidFieldPlan(raid), before = structuredClone(raid);
		for (const fraction of [0, .25, .5, .9, 1]) {
			const at = raid.startedAt + Math.round((raid.endsAt - raid.startedAt) * fraction);
			expect(getRaidFieldFrame({ ...raid, chance: 0 }, at, plan)).toEqual(getRaidFieldFrame({ ...raid, chance: 1 }, at, plan));
		}
		raid.expedition!.status = "choice";
		const first = getRaidFieldFrame(raid, raid.endsAt, plan);
		for (const now of [raid.endsAt + 1000, raid.endsAt + 86_400_000]) {
			const later = getRaidFieldFrame(raid, now, plan);
			expect({ ...later, weatherPhase: 0 }).toEqual({ ...first, weatherPhase: 0 });
			expect(later.position).toEqual(plan.checkpoint);
			expect(later.action).toBe("checkpoint");
			expect(later.walking).toBe(false);
			expect(later.paused).toBe(true);
			expect(later.enemyPositions).toEqual([]);
		}
		expect({ ...raid, expedition: before.expedition }).toEqual(before);
	});

	test("planning, presentation and bounded encounter modifiers never change paid raid state or consume its RNG", () => {
		const state = createGame(NOW);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		const before = saveGame(state), raid = state.raids[0]!;
		for (let i = 0; i < 40; i++) {
			const plan = getRaidFieldPlan(raid), frame = getRaidFieldFrame(raid, NOW + i * 700, plan), outcome = getRaidFieldOutcome(raid, plan);
			expect(outcome.moneyMultiplier).toBeGreaterThanOrEqual(.94);
			expect(outcome.moneyMultiplier).toBeLessThanOrEqual(1.08);
			expect(Object.values(outcome.resourceBonus).every((value) => Number.isInteger(value) && value >= 0)).toBe(true);
			expect(Object.values(outcome.resourceBonus).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(2);
			for (const key of ["success", "outcome", "moneyMultiplier", "resourceBonus", "health", "actualLoot"]) expect(Object.hasOwn(frame, key)).toBe(false);
		}
		expect(saveGame(state)).toBe(before);
		const restored = parseSave(before)!;
		expect(restored).not.toBeNull();
		expect(getRaidFieldPlan(restored.raids[0]!)).toEqual(getRaidFieldPlan(raid));
	});

	test("isometric projection preserves floor positions and gives height only to elevated geometry", () => {
		const point = { x: 7.5, y: 9.5 }, floor = projectRaidFieldPoint(point), roof = projectRaidFieldPoint({ ...point, z: 3 });
		expect(roof.x).toBe(floor.x);
		expect(roof.y).toBeLessThan(floor.y);
		const east = projectRaidFieldPoint({ ...point, x: point.x + 1 }), south = projectRaidFieldPoint({ ...point, y: point.y + 1 });
		expect(east.x).toBeGreaterThan(floor.x);
		expect(south.x).toBeLessThan(floor.x);
		expect(east.y).toBe(south.y);
		expect(point).toEqual({ x: 7.5, y: 9.5 });
	});
});
