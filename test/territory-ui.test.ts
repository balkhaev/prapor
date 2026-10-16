import { fundConstructionLoot } from './loot-material-fixture';
import { describe, expect, test } from "bun:test";
import {
	advance, buildRoom, createGame, getRoomSites, getRoomProductionState,
	ROOM_DEFINITIONS, saveGame, placeRoom, getRoomBounds, type ShelterRoomType,
} from "../src/game/engine";
import { readGameSession } from "../src/game-session";
import { roomMiniArt } from "../src/command-art";
import { getShelterProductionPresentation, getShelterProductionStages } from "../src/shelter-production";
import { getTerritoryPlanLayout } from "../src/territory-plan";
import { shelterBuildingHitPolygon } from "../src/shelter-isometric";
import {
	buildingCatalogue, buildingCatalogueReason, buildingPlacementControls, buildingRelocationControls,
	territoryBuildings, territoryPlan, territorySummary,
} from "../src/territory-ui";

const NOW = 1_792_000_000_000;
function withHangar(rotation: 0 | 1 = 0) {
	const state = createGame(NOW);
	state.level = 4; state.xp = 810; state.money = 5_000; state.supplies.scrap = 40;
	for(const need of ROOM_DEFINITIONS.hangar.lootRequirements??[])for(let i=0;i<need.quantity;i++)(state.lootItems??=[]).push({id:`loot-${state.nextId++}`,modelId:need.modelId,foundAt:NOW});
	fundConstructionLoot(state);
	expect(buildRoom(state, "hangar", 0, 1, state.lastUpdated, rotation).ok).toBe(true);
	advance(state, state.lastUpdated + ROOM_DEFINITIONS.hangar.buildSeconds * 1_000);
	return { state, hangar: state.shelter.rooms.find(room => room.type === "hangar")! };
}
const button = (html: string, action: string) => html.match(new RegExp(`<button[^>]*data-action="${action}"[^>]*>`))?.[0] ?? "";

describe("territory presentation and restored controls", () => {
	test("the plan shows actual building area and fractional positions without snapping", () => {
		const { state, hangar } = withHangar();
		expect(placeRoom(state, hangar.id, 57.25, 285.75, state.lastUpdated).ok).toBe(true);
		const before = saveGame(state);
		const plan = territoryPlan(state, hangar.id), summary = territorySummary(state);
		expect(plan.match(new RegExp(`data-shelter-room="${hangar.id}"`, "g"))).toHaveLength(1);
		const building = plan.match(new RegExp(`<button[^>]*data-shelter-room="${hangar.id}"[^>]*>`))![0];
		expect(building).toContain("free-plan-building");
		expect(plan).not.toContain("grid-column:");
		expect(plan).not.toContain("territory-cell");
		expect(plan.match(/data-action="choose-plan-ground"/g)).toHaveLength(1);
		expect(building).toContain('data-plan-building-x="57.25"');
		expect(building).toContain('data-plan-building-y="285.75"');
		expect(getRoomBounds(hangar).x).toBe(57.25);
		expect(getRoomBounds(hangar).y).toBe(285.75);
		for (const site of getRoomSites(hangar)) expect(plan).not.toContain(`data-shelter-column="${site.column}" data-shelter-row="${site.row}"`);
		expect(summary).toContain("<strong>67%</strong>");
		expect(summary).toContain("свободной земли");
		expect(plan).toContain('aria-label="План территории базы"');
		expect(saveGame(state)).toBe(before);
	});

	test("raised isometric buildings and ground share the same map frame in every facing", () => {
		const { state, hangar } = withHangar();
		hangar.position = { x: 57.25, y: 285.75 };
		for (const facing of [0, 1, 2, 3] as const) {
			hangar.facing = facing;
			const { projectedBounds } = getTerritoryPlanLayout(state), plan = territoryPlan(state, hangar.id);
			expect(plan).toContain('data-plan-projection="isometric"');
			expect(plan).not.toContain("Вид сверху");
			expect(plan).toContain(`viewBox="${projectedBounds.x} ${projectedBounds.y} ${projectedBounds.width} ${projectedBounds.height}"`);
			const hull = shelterBuildingHitPolygon(getRoomBounds(hangar));
			const building = plan.match(new RegExp(`<button[^>]*data-shelter-room="${hangar.id}"[^>]*>`))![0];
			const left = Number(building.match(/left:([\d.-]+)%/)![1]), top = Number(building.match(/top:([\d.-]+)%/)![1]);
			const width = Number(building.match(/;width:([\d.-]+)%/)![1]), height = Number(building.match(/;height:([\d.-]+)%/)![1]);
			expect(projectedBounds.x + left / 100 * projectedBounds.width).toBeCloseTo(Math.min(...hull.map(point => point.x)), 8);
			expect(projectedBounds.y + top / 100 * projectedBounds.height).toBeCloseTo(Math.min(...hull.map(point => point.y)), 8);
			expect(width / 100 * projectedBounds.width).toBeCloseTo(Math.max(...hull.map(point => point.x)) - Math.min(...hull.map(point => point.x)), 8);
			expect(height / 100 * projectedBounds.height).toBeCloseTo(Math.max(...hull.map(point => point.y)) - Math.min(...hull.map(point => point.y)), 8);
			expect(building).toContain("clip-path:polygon(");
			expect(plan).toContain('class="territory-building-volume"');
			expect(plan).not.toMatch(/NaN|undefined|Infinity/);
		}
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
		const state = fundConstructionLoot(createGame(NOW)); state.money = 5_000; state.supplies.scrap = 40;
		const locked = buildingCatalogue(state).match(/<article[^>]*>.*?<h3>Ангар<\/h3>.*?<\/article>/s)?.[0] ?? "";
		expect(locked).toContain("Крупная постройка");
		expect(locked).toContain("Откроется на уровне 4");
		expect(locked.match(/<button[^>]*data-room-type="hangar"[^>]*>/)?.[0]).toContain("disabled");
		state.level = 4; state.xp = 810;
		for(const need of ROOM_DEFINITIONS.hangar.lootRequirements??[])for(let i=0;i<need.quantity;i++)(state.lootItems??=[]).push({id:`loot-${state.nextId++}`,modelId:need.modelId,foundAt:NOW});
		const unlocked = buildingCatalogue(state);
		expect(unlocked.match(/<button[^>]*data-room-type="hangar"[^>]*>/)?.[0]).not.toContain("disabled");
	});

	test("the catalogue keeps complete material costs behind closed details and explains when payment happens", () => {
		const state = createGame(NOW), before = saveGame(state), html = buildingCatalogue(state);
		const cards = html.match(/<article\b[^>]*>.*?<\/article>/gs)!;
		expect(cards).toHaveLength(Object.keys(ROOM_DEFINITIONS).length);
		for (const card of cards) {
			const details = card.match(/<details\b[^>]*>.*?<\/details>/s)![0];
			expect(details.match(/^<details[^>]*>/)![0]).not.toContain("open");
			expect(details).toContain("Предметы для постройки");
			expect(details).toContain("На складе");
			expect(card.replace(details, "")).not.toContain("loot-material-requirements");
		}
		expect(html).toContain("Материалы спишутся после подтверждения");
		expect(html).toContain("Уже на базе:");
		expect(saveGame(state)).toBe(before);
	});

	test("construction explains precise cash and scrap deficits before requesting raid loot", () => {
		const state = createGame(NOW);
		state.money = ROOM_DEFINITIONS.workshop.cost.money - 40;
		state.supplies.scrap = ROOM_DEFINITIONS.workshop.cost.scrap - 3;
		expect(buildingCatalogueReason(state, "workshop")).toBe("Не хватает 40 ₽ и 3 дет.");
		state.money += 40;
		expect(buildingCatalogueReason(state, "workshop")).toBe("Не хватает 3 дет.");
		state.supplies.scrap += 3;
		expect(buildingCatalogueReason(state, "workshop")).toContain("целые трофеи");
		fundConstructionLoot(state);
		expect(buildingCatalogueReason(state, "workshop")).toBeNull();
	});

	test("base cards expose production status and worker slots, while instructions reserve dragging for the camera", () => {
		const state = createGame(NOW), before = saveGame(state);
		const html = territoryBuildings(state, state.shelter.rooms[0]!.id);
		expect(html).toContain('aria-pressed="true"');
		expect(html).toContain("Рабочие 0/1");
		for (const room of state.shelter.rooms) {
			expect(html).toContain(`data-room-status="${room.id}">${getRoomProductionState(state, room).status}`);
		}
		const summary = territorySummary(state), relocation = buildingRelocationControls(state.shelter.rooms[0]!);
		expect(summary).toContain("камера двигается");
		expect(summary).toContain("Переставить постройку");
		expect(summary).not.toContain("Перетаскивай здания");
		expect(relocation).toContain("выбери новое место во дворе и подтверди");
		expect(relocation).not.toContain("Перетащи здание");
		expect(saveGame(state)).toBe(before);
	});

	test("placement confirms only a valid selection and explains errors as escaped text", () => {
		const placement = { type: "hangar" as const, rotation: 1 as const, site: null, point: { x: 40.125, y: 280.75 } };
		const valid = buildingPlacementControls(placement, null);
		expect(valid).toContain("Строительство: Ангар");
		expect(valid).not.toContain("Участок");
		expect(button(valid, "placement-confirm")).not.toContain("disabled");
		expect(button(valid, "placement-rotate")).toBe("");
		const blocked = buildingPlacementControls(placement, '<occupied "lot">');
		expect(blocked).toContain("&lt;occupied &quot;lot&quot;&gt;");
		expect(blocked).not.toContain('<occupied "lot">');
		expect(button(blocked, "placement-confirm")).toContain("disabled");
		expect(button(buildingPlacementControls({ ...placement, site: null, point: null }, null), "placement-confirm")).toContain("disabled");
		expect(button(buildingPlacementControls({ ...placement, type: "storage" }, null), "placement-rotate")).toBe("");
		for (const facing of [0, 1, 2, 3] as const) {
			const html = buildingPlacementControls({ ...placement, facing }, null);
			expect(html).toContain(["вход во двор", "вход влево", "вход к задней границе", "вход вправо"][facing]!);
			expect(button(html, "placement-rotate")).toBe("");
		}
	});

	test("passive buildings explain their operation and relocation remains unavailable during construction", () => {
		const { state, hangar } = withHangar(), before = saveGame(state);
		const presentation = getShelterProductionPresentation(hangar, getRoomProductionState(state, hangar));
		expect(presentation.stageLabel).toBe("Работает без персонала");
		expect(presentation.productName).toBe("Ангар");
		expect(presentation.active).toBe(false); expect(presentation.paused).toBe(false);
		expect(presentation.jobId).toBeNull(); expect(presentation.reason).toBeNull();
		expect(button(buildingRelocationControls(hangar), "move-building")).not.toContain("disabled");
		expect(button(buildingRelocationControls(hangar), "turn-building")).toBe("");
		expect(buildingRelocationControls(hangar)).not.toContain("↻");
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
