import { describe, expect, test } from "bun:test";
import { advance, assignWorker, createGame, dispatchRaid, loadGameWithSummary, queueModuleProduction, saveGame, SAVE_KEY, SAVE_VERSION } from "../src/game/engine";
import { createGameSaveStore, exportGameSave, parseGameSave, PREVIOUS_SAVE_KEY, type SaveStorage } from "../src/game-save";

const NOW = 1_792_000_000_000;
class MemoryStorage implements SaveStorage {
	items = new Map<string, string>();
	writes: { key: string; value: string }[] = [];
	readDenied = false;
	failKey: string | null = null;
	onWrite: ((key: string) => void) | null = null;
	getItem(key: string) { if (this.readDenied) throw new Error("denied"); return this.items.get(key) ?? null; }
	setItem(key: string, value: string) {
		if (this.failKey === key) throw new Error("quota");
		this.onWrite?.(key);
		this.writes.push({ key, value }); this.items.set(key, value);
	}
}
function fixture() {
	const state = createGame(NOW);
	expect(assignWorker(state, state.scavs[0]!.id, state.shelter.rooms[0]!.id, NOW).ok).toBe(true);
	expect(queueModuleProduction(state, state.shelter.rooms[0]!.id, "factory-sks-stock", NOW).ok).toBe(true);
	expect(dispatchRaid(state, state.scavs[1]!.id, "courtyard", NOW).ok).toBe(true);
	advance(state, NOW + 5000);
	return state;
}

describe("validated local progress and current-screen persistence", () => {
	test("one envelope restores the exact paid game and JSON screen state without touching either caller object", () => {
		const storage = new MemoryStorage(), store = createGameSaveStore(storage, { writerId: "tab-a", isExclusiveHeld: () => true });
		expect(store.open(NOW).status).toBe("empty");
		const state = fixture(), gameBefore = saveGame(state), session = { view: "raid", selectedRaidId: state.raids[0]!.id, camera: { x: 412.2, y: 317, zoom: 1.35, following: false }, drawer: "worker", search: "приклад" };
		const screenBefore = JSON.stringify(session);
		expect(store.saveSync(state, session)).toMatchObject({ ok: true, revision: 1, writerId: "tab-a", savedAt: state.lastUpdated });
		expect(storage.writes.map((write) => write.key)).toEqual([SAVE_KEY]);
		const loaded = parseGameSave(storage.getItem(SAVE_KEY), state.lastUpdated)!;
		expect(loaded.state).toEqual(state);
		expect(loaded.session).toEqual(session);
		expect(saveGame(state)).toBe(gameBefore); expect(JSON.stringify(session)).toBe(screenBefore);
		session.camera.zoom = 4;
		expect(parseGameSave(storage.getItem(SAVE_KEY), state.lastUpdated)!.session).toEqual(JSON.parse(screenBefore));
	});

	test("legacy raw saves stay under the original key and become the first validated recovery slot", () => {
		const storage = new MemoryStorage(), state = fixture(), raw = saveGame(state);
		storage.items.set(SAVE_KEY, raw);
		const store = createGameSaveStore(storage, { writerId: "tab-a", isExclusiveHeld: () => true }), opened = store.open(state.lastUpdated);
		expect(opened.status).toBe("ready"); expect(opened.revision).toBe(0); expect(opened.session).toBeNull();
		expect(store.saveSync(opened.state!, { view: "base" }).ok).toBe(true);
		expect(storage.getItem(PREVIOUS_SAVE_KEY)).toBe(raw);
		expect(storage.writes.map((write) => write.key)).toEqual([PREVIOUS_SAVE_KEY, SAVE_KEY]);
		expect(parseGameSave(raw, state.lastUpdated)!.state).toEqual(loadGameWithSummary(raw, state.lastUpdated)!.state);
	});

	test("portable exports and raw v5 imports use the same strict parser with no separate replay cursor", () => {
		const state = fixture(), session = { view: "raid", room: null, ids: [state.scavs[0]!.id] };
		const raw = saveGame(state), portable = exportGameSave(state, session);
		const direct = loadGameWithSummary(raw, state.lastUpdated + 20_000)!;
		const imported = parseGameSave(portable, state.lastUpdated + 20_000)!;
		expect(imported.state).toEqual(direct.state); expect(imported.summary).toEqual(direct.summary); expect(imported.session).toEqual(session);
		expect(parseGameSave(raw, state.lastUpdated + 20_000)!.state).toEqual(direct.state);
		expect(parseGameSave(portable, NaN)).toBeNull();
	});

	test("a real pre-module v3 expedition migrates with its original cargo, RNG and settlement intact", async () => {
		const raw = await Bun.file(new URL("./fixtures/legacy-v3-expedition.json", import.meta.url)).text();
		const timestamp = (JSON.parse(raw) as { lastUpdated: number }).lastUpdated;
		for (const now of [timestamp, timestamp + 120_000]) {
			const direct = loadGameWithSummary(raw, now)!, imported = parseGameSave(raw, now)!;
			expect(imported.state).toEqual(direct.state); expect(imported.summary).toEqual(direct.summary); expect(imported.state.rng).toBe(direct.state.rng);
		}
	});

	test("a missing primary resumes the last good game and screen then safely writes a higher revision", () => {
		const storage = new MemoryStorage(), first = createGame(NOW), second = createGame(NOW + 1);
		const store = createGameSaveStore(storage, { writerId: "tab-a", isExclusiveHeld: () => true }); store.open(NOW);
		expect(store.saveSync(first, { view: "map" }).ok).toBe(true);
		expect(store.saveSync(second, { view: "base" }).ok).toBe(true);
		const backup = storage.getItem(PREVIOUS_SAVE_KEY)!;
		storage.items.delete(SAVE_KEY);
		const resumed = createGameSaveStore(storage, { writerId: "tab-b", isExclusiveHeld: () => true }), opened = resumed.open(NOW);
		expect(opened.status).toBe("recovered"); expect(opened.protectedRaw).toBeNull(); expect(opened.session).toEqual({ view: "map" });
		expect(resumed.saveSync(opened.state!, opened.session)).toMatchObject({ ok: true, revision: 2 });
		expect(storage.getItem(PREVIOUS_SAVE_KEY)).toBe(backup);
	});

	test("a corrupt primary recovers confirmed paid work but never overwrites its original bytes automatically", () => {
		const storage = new MemoryStorage(), state = fixture(), backup = exportGameSave(state, { view: "raid" });
		storage.items.set(PREVIOUS_SAVE_KEY, backup); storage.items.set(SAVE_KEY, '{"format":"prapor.local-save","version":1,');
		const store = createGameSaveStore(storage, { writerId: "tab-a", isExclusiveHeld: () => true }), opened = store.open(state.lastUpdated);
		expect(opened.status).toBe("recovered"); expect(opened.state).toEqual(state); expect(opened.session).toEqual({ view: "raid" });
		expect(opened.protectedRaw).toBe(storage.getItem(SAVE_KEY));
		expect(store.saveSync(opened.state!, opened.session)).toMatchObject({ ok: false, code: "protected" }); expect(storage.writes).toEqual([]);
		expect(store.saveSync(opened.state!, opened.session, { replaceProtected: true }).ok).toBe(true);
		expect(storage.getItem(PREVIOUS_SAVE_KEY)).toBe(backup);
	});

	test("future and unknown formats, malformed primary and an empty stored record stay protected", () => {
		for (const raw of [JSON.stringify({ ...createGame(NOW), schemaVersion: SAVE_VERSION + 1 }), '{"format":"prapor.local-save","version":2}', '{"format":"another-game","version":1}', '{"money":9000}', ""]) {
			const storage = new MemoryStorage(); storage.items.set(SAVE_KEY, raw); storage.items.set(PREVIOUS_SAVE_KEY, exportGameSave(createGame(NOW)));
			const store = createGameSaveStore(storage, { writerId: "tab-a", isExclusiveHeld: () => true }), opened = store.open(NOW);
			expect(opened.protectedRaw).toBe(raw); expect(opened.reason).not.toBeNull();
			expect(store.saveSync(createGame(NOW))).toMatchObject({ ok: false, code: "protected" });
			expect(storage.getItem(SAVE_KEY)).toBe(raw); expect(storage.writes).toEqual([]);
		}
	});

	test("checksum catches valid-looking changed money or camera bytes instead of accepting plausible corruption", () => {
		const raw = exportGameSave(createGame(NOW), { camera: { zoom: 1 } });
		for (const mutate of [(value: any) => { value.game.money += 1; }, (value: any) => { value.session.camera.zoom = 2; }, (value: any) => { value.revision += 1; }]) {
			const value = JSON.parse(raw); mutate(value); expect(parseGameSave(JSON.stringify(value), NOW)).toBeNull();
		}
		expect(parseGameSave(raw, NOW)).not.toBeNull();
	});

	test("only a real exclusive writer can save; reading and checking never acquire or rewrite ownership", () => {
		const storage = new MemoryStorage(); storage.items.set(SAVE_KEY, saveGame(createGame(NOW)));
		let held = false;
		const store = createGameSaveStore(storage, { writerId: "tab-a", isExclusiveHeld: () => held }); store.open(NOW);
		for (let i = 0; i < 4; i++) expect(store.detectConflict().conflict).toBe(false);
		expect(store.saveSync(createGame(NOW))).toMatchObject({ ok: false, code: "coordination" }); expect(storage.writes).toEqual([]);
		held = true; expect(store.saveSync(createGame(NOW)).ok).toBe(true);
		held = false; expect(store.saveSync(createGame(NOW + 1))).toMatchObject({ ok: false, code: "coordination" });
	});

	test("an older tab cannot overwrite another writer's newer progress, even at an identical engine timestamp", () => {
		const storage = new MemoryStorage(); storage.items.set(SAVE_KEY, saveGame(createGame(NOW)));
		let owner = "a";
		const a = createGameSaveStore(storage, { writerId: "tab-a", isExclusiveHeld: () => owner === "a" }), b = createGameSaveStore(storage, { writerId: "tab-b", isExclusiveHeld: () => owner === "b" });
		const aState = a.open(NOW).state!, bState = b.open(NOW).state!;
		expect(queueModuleProduction(aState, aState.shelter.rooms[0]!.id, "factory-sks-stock", NOW).ok).toBe(true);
		expect(a.saveSync(aState, { view: "base" }).ok).toBe(true); const primary = storage.getItem(SAVE_KEY), backup = storage.getItem(PREVIOUS_SAVE_KEY), writes = storage.writes.length;
		expect(b.detectConflict()).toMatchObject({ conflict: true, revision: 1, writerId: "tab-a" });
		owner = "b";
		expect(b.saveSync(bState, { view: "raid" })).toMatchObject({ ok: false, code: "conflict" });
		expect(storage.getItem(SAVE_KEY)).toBe(primary); expect(storage.getItem(PREVIOUS_SAVE_KEY)).toBe(backup); expect(storage.writes).toHaveLength(writes);
		expect(parseGameSave(storage.getItem(SAVE_KEY), NOW)!.state.shelter.rooms[0]!.queue).toEqual(aState.shelter.rooms[0]!.queue);
		expect(parseGameSave(storage.getItem(SAVE_KEY), NOW)!.state.money).toBe(aState.money);
		const current = b.open(NOW).state!; expect(b.saveSync(current, { view: "map" })).toMatchObject({ ok: true, revision: 2, writerId: "tab-b" });
		expect(a.detectConflict().conflict).toBe(true);
	});

	test("a writer that ignores coordination during backup rotation is detected before committing the primary", () => {
		const storage = new MemoryStorage(), old = saveGame(createGame(NOW)); storage.items.set(SAVE_KEY, old);
		const store = createGameSaveStore(storage, { writerId: "tab-a", isExclusiveHeld: () => true }); store.open(NOW);
		const foreign = exportGameSave(fixture(), { view: "raid" });
		storage.onWrite = (key) => { if (key === PREVIOUS_SAVE_KEY) storage.items.set(SAVE_KEY, foreign); };
		expect(store.saveSync(createGame(NOW), { view: "base" })).toMatchObject({ ok: false, code: "conflict" });
		expect(storage.getItem(SAVE_KEY)).toBe(foreign); expect(storage.getItem(PREVIOUS_SAVE_KEY)).toBe(old);
		expect(store.detectConflict().conflict).toBe(true);
	});

	test("quota failures in backup or primary leave a valid confirmed save and never falsely report success", () => {
		for (const failedKey of [PREVIOUS_SAVE_KEY, SAVE_KEY]) {
			const storage = new MemoryStorage(), state = fixture(), raw = saveGame(state); storage.items.set(SAVE_KEY, raw);
			const store = createGameSaveStore(storage, { writerId: "tab-a", isExclusiveHeld: () => true }); store.open(state.lastUpdated);
			storage.failKey = failedKey;
			expect(store.saveSync(state, { view: "raid" })).toMatchObject({ ok: false, code: "unavailable" });
			expect(storage.getItem(SAVE_KEY)).toBe(raw); expect(parseGameSave(storage.getItem(SAVE_KEY), state.lastUpdated)!.state).toEqual(state);
			expect(store.getMetadata().revision).toBe(0);
			storage.failKey = null; expect(store.saveSync(state, { view: "raid" }).ok).toBe(true);
		}
	});

	test("denied reads and invalid time cannot replace existing progress with a fresh session", () => {
		const storage = new MemoryStorage(); storage.items.set(SAVE_KEY, saveGame(createGame(NOW))); storage.readDenied = true;
		const store = createGameSaveStore(storage, { writerId: "tab-a", isExclusiveHeld: () => true });
		expect(store.open(NOW).status).toBe("unavailable"); expect(store.detectConflict().conflict).toBe(true);
		expect(store.saveSync(createGame(NOW))).toMatchObject({ ok: false, code: "unavailable" }); expect(storage.writes).toEqual([]);
		storage.readDenied = false; expect(store.open(NaN).status).toBe("unavailable"); expect(store.saveSync(createGame(NOW)).ok).toBe(false);
		expect(store.open(NOW).status).toBe("ready");
	});

	test("invalid game ownership, cyclic/nonfinite session and excessive session data are rejected before either slot changes", () => {
		const storage = new MemoryStorage(), store = createGameSaveStore(storage, { writerId: "tab-a", isExclusiveHeld: () => true }); store.open(NOW);
		const state = createGame(NOW), cycle: Record<string, unknown> = {}; cycle.self = cycle;
		for (const session of [cycle, { zoom: Infinity }, { callback: () => 1 }, { query: "x".repeat(100_001) }, JSON.parse('{"__proto__":{"polluted":true}}')]) {
			expect(store.saveSync(state, session)).toMatchObject({ ok: false, code: "invalid" });
		}
		state.scavs[1]!.weaponInstanceId = state.scavs[0]!.weaponInstanceId;
		expect(store.saveSync(state)).toMatchObject({ ok: false, code: "invalid" }); expect(storage.writes).toEqual([]);
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	test("offline recovery settles the same engine cursor once and the persisted replacement does not replay its summary", () => {
		const storage = new MemoryStorage(), state = fixture(), raw = exportGameSave(state, { selectedRaidId: state.raids[0]!.id }); storage.items.set(SAVE_KEY, raw);
		const later = state.lastUpdated + 90_000, store = createGameSaveStore(storage, { writerId: "tab-a", isExclusiveHeld: () => true });
		const opened = store.open(later), direct = loadGameWithSummary(saveGame(state), later)!;
		expect(opened.state).toEqual(direct.state); expect(opened.summary).toEqual(direct.summary); expect(storage.getItem(SAVE_KEY)).toBe(raw);
		expect(store.saveSync(opened.state!, opened.session).ok).toBe(true);
		const again = store.open(later); expect(again.state).toEqual(opened.state); expect(again.summary!.completedCount).toBe(0); expect(again.summary!.elapsedMs).toBe(0);
	});
});
