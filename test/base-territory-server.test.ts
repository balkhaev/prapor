import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGameService, readGameCommand, type GameService } from "../server/game";
import { readAuthoritativeAction, readAuthoritativeSnapshot } from "../src/authoritative-client";
import { getRoomSites, getShelterRoomAt, parseSave, saveGame } from "../src/game/engine";
import type { GameCommand, GameSnapshot } from "../src/game/commands";

const NOW = 1_792_000_000_000, ORIGIN = "http://territory.test";
const services: GameService[] = [], folders: string[] = [];
afterEach(async () => {
	for (const service of services.splice(0)) service.close();
	for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
function setup(dbPath = ":memory:") {
	let now = NOW;
	const service = createGameService({ dbPath, secureCookies: false, allowedOrigins: [ORIGIN], now: () => now });
	services.push(service); return { service, setTime: (value: number) => { now = value; } };
}
interface Client { cookie: string; snapshot: GameSnapshot }
function request(path: string, method = "GET", body?: unknown, client?: Client) {
	return new Request(`${ORIGIN}/api/game/${path}`, { method, headers: {
		...(method === "POST" ? { origin: ORIGIN, "content-type": "application/json" } : {}),
		...(client ? { cookie: client.cookie, "x-prapor-game": client.snapshot.identity.id } : {}),
	}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function connect(service: GameService, cookie = ""): Promise<Client> {
	const response = (await service.fetch(new Request(`${ORIGIN}/api/game/join`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", cookie }, body: "{}" })))!;
	return { cookie: response.headers.get("set-cookie")?.split(";")[0] ?? cookie, snapshot: readAuthoritativeSnapshot(await response.json()) };
}
async function action(service: GameService, client: Client, command: GameCommand) {
	const response = (await service.fetch(request("action", "POST", { revision: client.snapshot.revision, command }, client)))!;
	const raw = await response.json(); expect(response.status).toBe(200);
	const snapshot = readAuthoritativeAction(raw); client.snapshot = snapshot; return snapshot;
}
async function poll(service: GameService, client: Client) {
	const response = (await service.fetch(request("state", "GET", undefined, client)))!;
	expect(response.status).toBe(200); client.snapshot = readAuthoritativeSnapshot(await response.json()); return client.snapshot;
}

describe("authoritative base placement commands", () => {
	test("accepts legacy and rotated intent, rejects clocks, client footprints and malformed orientations", async () => {
		for (const command of [
			{ type: "buildRoom", args: ["hangar", 0, 1] }, { type: "buildRoom", args: ["hangar", 0, 1, 1] },
			{ type: "moveRoom", args: ["room-workshop", 0, 1] }, { type: "moveRoom", args: ["room-workshop", 0, 1, 0] },
			{ type: "rotateRoom", args: ["room-workshop"] },
		] satisfies GameCommand[]) expect(readGameCommand(command)).toEqual(command);
		const { service } = setup(), client = await connect(service), before = structuredClone(client.snapshot);
		for (const command of [
			{ type: "buildRoom", args: ["hangar", 0, 1, NOW + 1] },
			{ type: "buildRoom", args: ["hangar", 0, 1, 1, NOW] },
			{ type: "buildRoom", args: ["hangar", 0, 1, -1] },
			{ type: "buildRoom", args: ["hangar", 0, 1, .5] },
			{ type: "moveRoom", args: ["room-workshop", 0, -1] },
			{ type: "moveRoom", args: ["room-workshop", 129, 1] },
			{ type: "moveRoom", args: ["room-workshop", 0.5, 1] },
			{ type: "moveRoom", args: ["room-workshop", 0, 1, null] },
			{ type: "moveRoom", args: ["room-workshop", 0, 1, 2] },
			{ type: "moveRoom", args: ["room-workshop", 0, 1, 1, NOW] },
			{ type: "moveRoom", args: ["room-workshop", 0, 1], footprint: { width: 1, height: 1 } },
			{ type: "rotateRoom", args: ["room-workshop", 1] },
		]) {
			expect(() => readGameCommand(command)).toThrow();
			expect((await service.fetch(request("action", "POST", { revision: before.revision, command }, client)))!.status).toBe(400);
		}
		expect(await poll(service, client)).toEqual(before);
	});

	test("moves live paid production with server time and leaves assignments and orders intact", async () => {
		const { service, setTime } = setup(), client = await connect(service), workerId = client.snapshot.state.scavs[0]!.id;
		expect((await action(service, client, { type: "assignWorker", args: [workerId, "room-workshop"] })).result.ok).toBe(true);
		expect((await action(service, client, { type: "queueModuleProduction", args: ["room-workshop", "factory-sks-stock"] })).result.ok).toBe(true);
		const count = client.snapshot.state.modules.length, jobId = client.snapshot.state.shelter.rooms[0]!.queue[0]!.id;
		setTime(NOW + 1000);
		const moved = await action(service, client, { type: "moveRoom", args: ["room-workshop", 0, 2] });
		expect(moved.result.ok).toBe(true); expect(moved.serverNow).toBe(NOW + 1000);
		const room = moved.state.shelter.rooms.find(room => room.id === "room-workshop")!;
		expect(room.column).toBe(0); expect(room.row).toBe(2);
		expect(room.workerIds).toEqual([workerId]); expect(room.queue[0]!.id).toBe(jobId);
		expect(room.queue[0]!.workDone).toBeGreaterThan(0);
		expect(moved.state.scavs.find(scav => scav.id === workerId)!.assignment).toBe(room.id);
		setTime(NOW + 600_000); const settled = await poll(service, client);
		expect(settled.state.modules).toHaveLength(count + 1);
		expect(settled.state.shelter.rooms.find(value => value.id === room.id)!.queue).toHaveLength(0);
		expect(parseSave(saveGame(settled.state))).not.toBeNull();
	});

	test("rechecks owned cells and collisions; a locked large building cannot spend resources", async () => {
		const { service } = setup(), client = await connect(service), original = structuredClone(client.snapshot.state);
		for (const command of [
			{ type: "moveRoom", args: ["room-workshop", 1, 0] },
			{ type: "moveRoom", args: ["room-workshop", 4, 1] },
			{ type: "buildRoom", args: ["hangar", 0, 1] },
		] as GameCommand[]) expect((await action(service, client, command)).result.ok).toBe(false);
		expect(client.snapshot.state).toEqual(original);
		expect((await action(service, client, { type: "buildRoom", args: ["ammo", 0, 1] })).result.ok).toBe(true);
		const room = getShelterRoomAt(client.snapshot.state.shelter, 0, 1)!;
		expect(room.status).toBe("building"); expect(room.id).toMatch(/^room-[1-9]\d*$/);
		const before = structuredClone(client.snapshot.state);
		expect((await action(service, client, { type: "moveRoom", args: [room.id, 0, 2] })).result.ok).toBe(false);
		expect(client.snapshot.state).toEqual(before);
	});

	test("rotated large construction and atomic placement survive a server restart", async () => {
		const folder = await mkdtemp(join(tmpdir(), "prapor-territory-")); folders.push(folder);
		const path = join(folder, "game.sqlite"), first = setup(path), client = await connect(first.service);
		const db = new Database(path);
		try {
			const stored = parseSave(db.query<{ state: string }, []>("SELECT state FROM authoritative_games LIMIT 1").get()!.state)!;
			stored.level = 4; stored.xp = 810; stored.money = 20_000; stored.supplies.scrap = 200;
			db.query("UPDATE authoritative_games SET state=?,revision=revision+1").run(saveGame(stored));
		} finally { db.close(); }
		await poll(first.service, client);
		for (const column of [0, 1]) expect((await action(first.service, client, { type: "excavateShelter", args: [column, 3] })).result.ok).toBe(true);
		first.setTime(NOW + 20_000); await poll(first.service, client);
		const before = client.snapshot.state.money;
		expect((await action(first.service, client, { type: "buildRoom", args: ["hangar", 0, 1, 1] })).result.ok).toBe(true);
		let room = getShelterRoomAt(client.snapshot.state.shelter, 1, 3)!;
		expect(room.rotation).toBe(1); expect(getRoomSites(room)).toHaveLength(6); expect(client.snapshot.state.money).toBe(before - 900);
		first.setTime(NOW + 200_000); await poll(first.service, client);
		expect((await action(first.service, client, { type: "moveRoom", args: [room.id, 0, 1, 0] })).result.ok).toBe(true);
		expect(getShelterRoomAt(client.snapshot.state.shelter, 2, 2)!.id).toBe(room.id);
		expect((await action(first.service, client, { type: "rotateRoom", args: [room.id] })).result.ok).toBe(true);
		expect((await action(first.service, client, { type: "buildRoom", args: ["ammo", 2, 2] })).result.ok).toBe(true);
		const placed = structuredClone(client.snapshot.state);
		expect((await action(first.service, client, { type: "rotateRoom", args: [room.id] })).result.ok).toBe(false);
		expect(client.snapshot.state).toEqual(placed);
		const saved = structuredClone(readAuthoritativeSnapshot(client.snapshot));
		services.splice(services.indexOf(first.service), 1); first.service.close();
		const second = setup(path); second.setTime(NOW + 200_000);
		const rejoined = await connect(second.service, client.cookie);
		expect(rejoined.snapshot).toEqual(saved);
		room = getShelterRoomAt(rejoined.snapshot.state.shelter, 1, 3)!;
		expect(room.rotation).toBe(1); expect(room.id).toBe(getShelterRoomAt(saved.state.shelter, 0, 1)!.id);
	});
});
