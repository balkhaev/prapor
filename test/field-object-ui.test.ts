import { describe, expect, test } from "bun:test";
import { fieldObjectContent, placeFieldObjectCard } from "../src/field-object-ui";
import { createGame, assignWorker, queueModuleProduction, advance } from "../src/game/engine";
import { projectShelterRect } from "../src/shelter-camera";

const NOW = 1_792_000_000_000;

describe("context cards stay attached to the actual scene", () => {
	test("camera projection is converted from client pixels into the overlay coordinate space", () => {
		const surface = { left: 150, top: 80, width: 1100, height: 750 };
		const anchor = projectShelterRect({ x: 330, y: 200, width: 40, height: 50 }, { zoom: 2, x: 100, y: 80 }, surface, { width: 840, height: 520 })!;
		const placement = placeFieldObjectCard(anchor, surface, { width: 280, height: 180 }, { top: 16, bottom: 16 })!;
		expect(placement.left + placement.anchorX + surface.left).toBeCloseTo(anchor.left + anchor.width / 2);
		expect(placement.top + placement.anchorY + surface.top).toBeCloseTo(placement.side === "above" ? anchor.top : anchor.top + anchor.height);
		expect(placement.left).toBeGreaterThanOrEqual(16);
		expect(placement.left + placement.width).toBeLessThanOrEqual(1084);
	});

	test("a target near the top opens below, while one at the bottom opens above", () => {
		const surface = { left: 0, top: 0, width: 1200, height: 800 }, size = { width: 300, height: 230 };
		expect(placeFieldObjectCard({ left: 500, top: 100, width: 80, height: 60, visible: true }, surface, size)!.side).toBe("below");
		expect(placeFieldObjectCard({ left: 500, top: 650, width: 80, height: 60, visible: true }, surface, size)!.side).toBe("above");
	});

	test("panned-offscreen selection docks without following it outside the viewport", () => {
		const placement = placeFieldObjectCard({ left: -2000, top: 1800, width: 80, height: 60, visible: false }, { left: 0, top: 0, width: 1200, height: 800 }, { width: 320, height: 230 })!;
		expect(placement).toMatchObject({ side: "docked", left: 864, top: 480 });
	});

	test("mobile docks above the controls and the card always fits narrow and short screens", () => {
		for (const surface of [{ left: 36, top: 60, width: 390, height: 640 }, { left: 0, top: 0, width: 240, height: 160 }]) {
			const placement = placeFieldObjectCard({ left: 100, top: 100, width: 80, height: 60, visible: true }, surface, { width: 320, height: 280 })!;
			expect(placement.side).toBe("docked");
			expect(placement.width).toBeLessThanOrEqual(surface.width - 32);
			expect(placement.top).toBeGreaterThanOrEqual(0);
			expect(placement.top + Math.min(280, placement.maxHeight)).toBeLessThanOrEqual(surface.height);
		}
	});

	test("invalid geometry never produces a positioned floating card", () => {
		expect(placeFieldObjectCard({ left: Number.NaN, top: 0, width: 50, height: 50, visible: true }, { left: 0, top: 0, width: 1000, height: 700 }, { width: 300, height: 220 })).toBeNull();
	});
});

describe("context cards show the current gameplay state", () => {
	test("room actions and production ETA use the paid queue without changing state", () => {
		const state = createGame(NOW), room = state.shelter.rooms.find(candidate => candidate.type === "workshop")!, worker = state.scavs[0]!;
		state.money = 20_000; state.supplies.scrap = 80;
		expect(assignWorker(state, worker.id, room.id, NOW).ok).toBe(true);
		expect(queueModuleProduction(state, room.id, "optic-reflex", NOW).ok).toBe(true);
		advance(state, NOW + 1000);
		const before = JSON.stringify(state), html = fieldObjectContent(state, { kind: "room", id: room.id })!;
		expect(html).toContain("Производство идёт");
		expect(html).toContain("room-staff");
		expect(html).toContain("room-production");
		expect(html).toContain("room-upgrade");
		expect(html).toContain('max="100"');
		expect(html).toContain('Люди <b>1 /');
		expect(html).toContain('Очередь <b>1</b>');
		expect(JSON.stringify(state)).toBe(before);
	});

	test("a workerless production card gives the same actual waiting reason as the full room", () => {
		const state = createGame(NOW), room = state.shelter.rooms.find(candidate => candidate.type === "workshop")!;
		const html = fieldObjectContent(state, { kind: "room", id: room.id })!;
		expect(html).toContain("Ждёт работников");
		expect(html).toContain('is-primary" data-field-object-action="room-staff"');
	});

	test("fighter identity, health and activity are escaped and use the same portrait", () => {
		const state = createGame(NOW), scav = state.scavs[0]!;
		scav.name = '<script>Нож</script>'; scav.health = 19; scav.status = "wounded";
		const before = JSON.stringify(state), html = fieldObjectContent(state, { kind: "scav", id: scav.id }, "Идёт <отдыхать>")!;
		expect(html).toContain("&lt;script&gt;Нож&lt;/script&gt;");
		expect(html).not.toContain("<script>");
		expect(html).toContain("Восстанавливается");
		expect(html).toContain('value="19"');
		expect(html).toContain('class="scav-portrait"');
		expect(html).toContain("scav-equipment");
		expect(html).toContain("scav-orders");
		expect(JSON.stringify(state)).toBe(before);
	});

	test("removed objects produce no stale dossier", () => {
		const state = createGame(NOW);
		expect(fieldObjectContent(state, { kind: "scav", id: "gone" })).toBeNull();
		expect(fieldObjectContent(state, { kind: "room", id: "gone" })).toBeNull();
	});
});
