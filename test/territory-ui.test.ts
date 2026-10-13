import { describe, expect, test } from "bun:test";
import {
	advance, buildRoom, createGame, excavateShelter, getRoomSites, getRoomProductionState,
	ROOM_DEFINITIONS, saveGame, type ShelterRoomType,
} from "../src/game/engine";
import { readGameSession } from "../src/game-session";
import { roomMiniArt } from "../src/command-art";
import { getShelterProductionPresentation, getShelterProductionStages } from "../src/shelter-production";
import {
	buildingCatalogue, buildingPlacementControls, buildingRelocationControls,
	territoryPlan, territorySummary,
} from "../src/territory-ui";

const NOW = 1_792_000_000_000;
function withHangar(rotation: 0 | 1 = 0) {
	const state = createGame(NOW);
	state.level = 4; state.xp = 810; state.money = 5_000; state.supplies.scrap = 40;
	if (rotation) {
		for (const column of [0, 1]) expect(excavateShelter(state, column, 3, state.lastUpdated).ok).toBe(true);
		advance(state, NOW + 20_000);
	}
	expect(buildRoom(state, "hangar", 0, 1, state.lastUpdated, rotation).ok).toBe(true);
	advance(state, state.lastUpdated + ROOM_DEFINITIONS.hangar.buildSeconds * 1_000);
	return { state, hangar: state.shelter.rooms.find(room => room.type === "hangar")! };
}
const button = (html: string, action: string) => html.match(new RegExp(`<button[^>]*data-action="${action}"[^>]*>`))?.[0] ?? "";

describe("territory presentation and restored controls", () => {
	test("the plan shows a large building once and counts every occupied lot", () => {
		const { state, hangar } = withHangar(), before = saveGame(state);
		const plan = territoryPlan(state, hangar.id), summary = territorySummary(state);
		expect(plan.match(new RegExp(`data-shelter-room="${hangar.id}"`, "g"))).toHaveLength(1);
		expect(plan).toContain("grid-column:2/span 3;grid-row:2/span 2");
		for (const site of getRoomSites(hangar)) expect(plan).not.toContain(`data-shelter-column="${site.column}" data-shelter-row="${site.row}"`);
		expect(summary).toContain("<strong>2</strong>");
		expect(summary).toContain("свободно из 12");
		expect(plan).toContain('aria-label="План территории базы"');
		expect(saveGame(state)).toBe(before);
	});

	test("restoration never opens construction controls inside an existing rotated building", () => {
		const { state, hangar } = withHangar(1), before = saveGame(state);
		for (const site of getRoomSites(hangar)) {
			const session = readGameSession({ version: 1, view: "base", context: "build", site }, state);
			expect(session.site).toBeNull(); expect(session.context).toBe("overview");
		}
		const site = { column: 2, row: 2 };
		expect(readGameSession({ version: 1, view: "base", context: "build", site }, state).site).toEqual(site);
		expect(saveGame(state)).toBe(before);
	});

	test("catalogue communicates the future footprint and disables locked construction", () => {
		const state = createGame(NOW); state.money = 5_000; state.supplies.scrap = 40;
		const locked = buildingCatalogue(state).match(/<article[^>]*>.*?<h3>Ангар<\/h3>.*?<\/article>/s)?.[0] ?? "";
		expect(locked).toContain("3 × 2 участков");
		expect(locked).toContain("Откроется на уровне 4");
		expect(locked.match(/<button[^>]*data-room-type="hangar"[^>]*>/)?.[0]).toContain("disabled");
		state.level = 4; state.xp = 810;
		const unlocked = buildingCatalogue(state);
		expect(unlocked.match(/<button[^>]*data-room-type="hangar"[^>]*>/)?.[0]).not.toContain("disabled");
	});

	test("placement confirms only a valid selection and explains errors as escaped text", () => {
		const placement = { type: "hangar" as const, rotation: 1 as const, site: { column: 0, row: 1 } };
		const valid = buildingPlacementControls(placement, null);
		expect(valid).toContain("Ангар · 2 × 3");
		expect(button(valid, "placement-confirm")).not.toContain("disabled");
		expect(button(valid, "placement-rotate")).not.toContain("disabled");
		const blocked = buildingPlacementControls(placement, '<occupied "lot">');
		expect(blocked).toContain("&lt;occupied &quot;lot&quot;&gt;");
		expect(blocked).not.toContain('<occupied "lot">');
		expect(button(blocked, "placement-confirm")).toContain("disabled");
		expect(button(buildingPlacementControls({ ...placement, site: null }, null), "placement-confirm")).toContain("disabled");
		expect(button(buildingPlacementControls({ ...placement, type: "storage" }, null), "placement-rotate")).toContain("disabled");
	});

	test("passive buildings explain their operation and relocation remains unavailable during construction", () => {
		const { state, hangar } = withHangar(), before = saveGame(state);
		const presentation = getShelterProductionPresentation(hangar, getRoomProductionState(state, hangar));
		expect(presentation.stageLabel).toBe("Работает без персонала");
		expect(presentation.productName).toBe("Ангар");
		expect(presentation.active).toBe(false); expect(presentation.paused).toBe(false);
		expect(presentation.jobId).toBeNull(); expect(presentation.reason).toBeNull();
		expect(button(buildingRelocationControls(hangar), "move-building")).not.toContain("disabled");
		expect(button(buildingRelocationControls({ ...hangar, status: "upgrading" }), "move-building")).toContain("disabled");
		expect(saveGame(state)).toBe(before);
	});

	test("every available building has complete local artwork and presentation labels", () => {
		for (const type of Object.keys(ROOM_DEFINITIONS) as ShelterRoomType[]) {
			const art = roomMiniArt(type);
			expect(art).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
			expect(art).toContain('role="img" aria-label="');
			expect(art).not.toContain("undefined");
			expect(getShelterProductionStages(type)).toHaveLength(3);
		}
		expect(roomMiniArt("hangar")).toContain("погрузчик");
	});
});
