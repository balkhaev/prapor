import { describe, expect, test } from "bun:test";
import { createGame, getRoomBounds, getShelterFrontier, saveGame } from "../src/game/engine";
import { shelterBuildingHitPolygon, shelterRectPolygon } from "../src/shelter-isometric";
import { getTerritoryPlanLayout } from "../src/territory-plan";
import { territoryPlan } from "../src/territory-ui";

const NOW = 1_792_000_000_000;
const key = (site: { column: number; row: number }) => `${site.column}:${site.row}`;

describe("continuous territory map geometry", () => {
	test("the initial yard exposes three useful boundary entrances, all valid expansion quotes", () => {
		const state = createGame(NOW), before = saveGame(state), layout = getTerritoryPlanLayout(state);
		const frontier = new Set(getShelterFrontier(state.shelter).map(key));
		expect(layout.expansions).toHaveLength(3);
		expect(new Set(layout.expansions.map(item => item.side))).toEqual(new Set(["west", "east", "south"]));
		for (const entrance of layout.expansions) expect(frontier.has(key(entrance.site))).toBe(true);
		expect(layout.landscape.perimeter.filter(edge => edge.side === "west")).toHaveLength(1);
		expect(layout.landscape.perimeter.filter(edge => edge.side === "east")).toHaveLength(1);
		expect(layout.landscape.perimeter.filter(edge => edge.side === "south")).toHaveLength(1);
		expect(saveGame(state)).toBe(before);
	});

	test("separated edges and inward openings retain reachable expansion choices", () => {
		const state = createGame(NOW);
		state.shelter.sites = state.shelter.sites.filter(site => !(site.column === 1 && site.row === 1));
		const layout = getTerritoryPlanLayout(state), frontier = new Set(getShelterFrontier(state.shelter).map(key));
		expect(layout.expansions.some(item => item.site.column === 1 && item.site.row === 1)).toBe(true);
		for (const entrance of layout.expansions) expect(frontier.has(key(entrance.site))).toBe(true);
		expect(layout.landscape.lots).toHaveLength(11);
	});

	test("a reserved expansion keeps its own progress and isn't offered as new land", () => {
		const state = createGame(NOW);
		state.shelter.expansions.push({ column: -1, row: 1, workDone: 7, workRequired: 20, cost: { money: 60, scrap: 2 } });
		const layout = getTerritoryPlanLayout(state);
		const pending = layout.expansions.filter(item => item.site.column === -1 && item.site.row === 1);
		expect(pending).toHaveLength(1);
		expect(pending[0]!.progress).toBe(35);
		expect(territoryPlan(state, null)).toContain('aria-label="Подготовка новой земли: 35%"');
	});

	test("map bounds and button footprints preserve exact positions and stored facing", () => {
		const state = createGame(NOW), room = state.shelter.rooms[0]!;
		room.position = { x: 251.375, y: 207.625 }; room.facing = 1;
		const rect = getRoomBounds(room), layout = getTerritoryPlanLayout(state), html = territoryPlan(state, room.id);
		expect(rect.width).toBe(100); expect(rect.height).toBe(172);
		expect(html).toContain('data-plan-building-x="251.375"');
		expect(html).toContain('data-plan-building-y="207.625"');
		expect(html).toContain('data-plan-building-width="100"');
		expect(html).toContain('data-plan-building-height="172"');
		expect(html).toContain(`data-plan-width="${layout.projectedBounds.width}"`);
		expect(html).toContain(`data-plan-height="${layout.projectedBounds.height}"`);
		expect(html).toContain('data-plan-projection="isometric"');
		expect(layout.bounds.x).toBeLessThan(rect.x);
		expect(layout.bounds.x + layout.bounds.width).toBeGreaterThan(rect.x + rect.width);
		expect(html).not.toContain("grid-column:");
		expect(html).not.toContain("grid-row:");
	});

	test("projected map bounds include the continuous ground and raised building hulls", () => {
		const state = createGame(NOW);
		state.shelter.sites.push({ column: -1, row: 2 }, { column: 3, row: 3 });
		for (const facing of [0, 1, 2, 3] as const) {
			state.shelter.rooms[0]!.facing = facing;
			const { landscape, projectedBounds: frame } = getTerritoryPlanLayout(state);
			const points = [...landscape.lots.flatMap(shelterRectPolygon), ...state.shelter.rooms.flatMap(room => shelterBuildingHitPolygon(getRoomBounds(room)))];
			for (const point of points) {
				expect(point.x).toBeGreaterThanOrEqual(frame.x);
				expect(point.x).toBeLessThanOrEqual(frame.x + frame.width);
				expect(point.y).toBeGreaterThanOrEqual(frame.y);
				expect(point.y).toBeLessThanOrEqual(frame.y + frame.height);
			}
		}
	});
});
