import { describe, expect, test } from "bun:test";
import {
	MAX_OFFLINE_MS, advance, createGame, dispatchRaid, parseSave, saveGame,
	buildRoom, getBuildRoomQuote, upgradeRoom, getRoomUpgradeQuote,
	assignWorker, getRoomWorkerCapacity, getRoomProductionState,
	queueModuleProduction, getModuleProductionQuote, setRoomRecipe, cancelProduction,
	getModuleCapacity, getSupplyCapacity, getScavCapacity, getStorageCapacity,
	MODULE_BY_ID, setAutoRaid, getWorkerAffinity, type RoomInstance, type GameState,
} from "../src/game/engine";

const NOW = 1_792_000_000_000;
function copy(state: GameState): GameState {
	const restored = parseSave(saveGame(state));
	expect(restored).not.toBeNull();
	return restored!;
}
function varyTicks(state: GameState, until: number) {
	const ticks = [997, 7001, 131, 20_013, 301, 8999];
	let i = 0;
	while (state.lastUpdated < until) advance(state, Math.min(until, state.lastUpdated + ticks[i++ % ticks.length]!));
}
function funded(): GameState {
	const state = createGame(NOW);
	state.money = 20_000;
	state.supplies = { ammo: 200, medicine: 0, scrap: 200, intel: 50 };
	return state;
}
function room(state: GameState, type: RoomInstance["type"]) {
	return state.shelter.rooms.find(room => room.type === type)!;
}
function construct(state: GameState, type: RoomInstance["type"], column: number, row: number) {
	const quote = getBuildRoomQuote(state, type, column, row);
	expect(quote.reason).toBeNull();
	expect(buildRoom(state, type, column, row, state.lastUpdated).ok).toBe(true);
	advance(state, state.lastUpdated + quote.duration * 1000 + 1);
	return state.shelter.rooms.find(room => room.column === column && room.row === row)!;
}

describe("construction, workforce and paid production", () => {
	test("building reserves its quote once, rejects occupied and unaffordable sites, then completes offline", () => {
		const state = funded();
		const quote = getBuildRoomQuote(state, "ammo", 0, 1);
		const money = state.money, scrap = state.supplies.scrap;
		expect(buildRoom(state, "ammo", 0, 1, NOW).ok).toBe(true);
		const built = room(state, "ammo");
		expect(built.status).toBe("building");
		expect(state.money).toBe(money - quote.money);
		expect(state.supplies.scrap).toBe(scrap - quote.scrap);
		const reserved = saveGame(state);
		expect(buildRoom(state, "recycler", 0, 1, NOW).ok).toBe(false);
		expect(assignWorker(state, state.scavs[0]!.id, built.id, NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(reserved);
		advance(state, NOW + quote.duration * 1000 - 1);
		expect(built.status).toBe("building");
		advance(state, NOW + quote.duration * 1000);
		expect(built.status).toBe("ready");
		expect(built.construction).toBeNull();
		expect(copy(state)).toEqual(state);
		state.money = 0;
		const poor = saveGame(state);
		expect(buildRoom(state, "storage", 1, 1, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(poor);
	});

	test("workers move atomically between rooms and cannot be assigned while raiding", () => {
		const state = funded();
		const worker = state.scavs[0]!, bench = room(state, "workshop"), medbay = room(state, "medbay");
		expect(assignWorker(state, worker.id, bench.id, NOW).ok).toBe(true);
		expect(worker.assignment).toBe(bench.id);
		expect(bench.workerIds).toEqual([worker.id]);
		expect(assignWorker(state, worker.id, medbay.id, NOW).ok).toBe(true);
		expect(bench.workerIds).toEqual([]);
		expect(medbay.workerIds).toEqual([worker.id]);
		expect(worker.assignment).toBe(medbay.id);
		const before = saveGame(state);
		expect(dispatchRaid(state, worker.id, "courtyard", NOW).ok).toBe(false);
		expect(assignWorker(state, worker.id, room(state, "storage").id, NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		expect(assignWorker(state, worker.id, null, NOW).ok).toBe(true);
		expect(medbay.workerIds).toEqual([]);
		expect(dispatchRaid(state, worker.id, "courtyard", NOW).ok).toBe(true);
		const raiding = saveGame(state);
		expect(assignWorker(state, worker.id, bench.id, NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(raiding);
		expect(copy(state)).toEqual(state);
	});

	test("worker capacity is enforced without evicting an existing worker", () => {
		const state = funded(), bench = room(state, "workshop");
		const capacity = getRoomWorkerCapacity(bench);
		for (const worker of state.scavs.slice(0, capacity)) expect(assignWorker(state, worker.id, bench.id, NOW).ok).toBe(true);
		const extra = state.scavs[capacity];
		if (extra) {
			const before = saveGame(state);
			expect(assignWorker(state, extra.id, bench.id, NOW).ok).toBe(false);
			expect(saveGame(state)).toBe(before);
		}
		expect(copy(state)).toEqual(state);
	});

	test("the room's relevant skill changes production speed and assignment to a second slot adds work", () => {
		const state = funded(), medbay = room(state, "medbay");
		const veteran = state.scavs[0]!, scout = state.scavs[1]!;
		veteran.combat = 100; veteran.scouting = 10;
		scout.combat = 10; scout.scouting = 100;
		expect(getWorkerAffinity(veteran, "ammo")).toBeGreaterThan(getWorkerAffinity(scout, "ammo"));
		expect(getWorkerAffinity(scout, "medbay")).toBeGreaterThan(getWorkerAffinity(veteran, "medbay"));
		expect(assignWorker(state, veteran.id, medbay.id, NOW).ok).toBe(true);
		const ordinary = getRoomProductionState(state, medbay).rate;
		expect(assignWorker(state, veteran.id, null, NOW).ok).toBe(true);
		expect(assignWorker(state, scout.id, medbay.id, NOW).ok).toBe(true);
		expect(getRoomProductionState(state, medbay).rate).toBeGreaterThan(ordinary);
		const quote = getRoomUpgradeQuote(state, medbay.id);
		expect(upgradeRoom(state, medbay.id, NOW).ok).toBe(true);
		advance(state, NOW + quote.duration * 1000);
		const single = getRoomProductionState(state, medbay).rate;
		expect(assignWorker(state, veteran.id, medbay.id, state.lastUpdated).ok).toBe(true);
		expect(getRoomProductionState(state, medbay).rate).toBeGreaterThan(single);
		expect(copy(state)).toEqual(state);
	});

	test("an assigned worker keeps its auto order but waits at the workplace until explicitly released", () => {
		const state = funded(), worker = state.scavs[0]!, bench = room(state, "workshop");
		expect(assignWorker(state, worker.id, bench.id, NOW).ok).toBe(true);
		expect(setAutoRaid(state, worker.id, "courtyard", 70, NOW).ok).toBe(true);
		advance(state, NOW + 60_000);
		expect(state.raids.some(raid => raid.scavId === worker.id)).toBe(false);
		expect(worker.assignment).toBe(bench.id);
		expect(worker.autoRaid.enabled).toBe(true);
		expect(assignWorker(state, worker.id, null, state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated);
		expect(state.raids.some(raid => raid.scavId === worker.id)).toBe(true);
		expect(copy(state)).toEqual(state);
	});

	test("assigning a worker at the same instant an automatic order becomes affordable reserves the worker for the base", () => {
		const state = funded(), worker = state.scavs[0]!, bench = room(state, "workshop");
		state.supplies.ammo = 0;
		expect(setAutoRaid(state, worker.id, "courtyard", 70, NOW).ok).toBe(true);
		expect(state.raids).toHaveLength(0);
		state.supplies.ammo = 24;
		expect(assignWorker(state, worker.id, bench.id, NOW).ok).toBe(true);
		expect(state.raids).toHaveLength(0);
		expect(worker.autoRaid.enabled).toBe(true);
		expect(worker.assignment).toBe(bench.id);
		expect(copy(state)).toEqual(state);
	});

	test("an unstaffed module order reserves materials, pauses without loss and produces exactly one physical part", () => {
		const state = funded(), bench = room(state, "workshop");
		const modelId = "factory-sks-stock", model = MODULE_BY_ID[modelId]!;
		const money = state.money, scrap = state.supplies.scrap, count = state.modules.length;
		expect(queueModuleProduction(state, bench.id, modelId, NOW).ok).toBe(true);
		expect(state.money).toBe(money - model.craftCost.money);
		expect(state.supplies.scrap).toBe(scrap - model.craftCost.scrap);
		expect(bench.queue).toHaveLength(1);
		advance(state, NOW + 20_000);
		expect(bench.queue[0]!.workDone).toBe(0);
		expect(state.modules).toHaveLength(count);
		expect(assignWorker(state, state.scavs[0]!.id, bench.id, state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated + 5000);
		const progress = bench.queue[0]!.workDone;
		expect(progress).toBeGreaterThan(0);
		expect(assignWorker(state, state.scavs[0]!.id, null, state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated + 30_000);
		expect(bench.queue[0]!.workDone).toBe(progress);
		expect(copy(state)).toEqual(state);
		expect(assignWorker(state, state.scavs[0]!.id, bench.id, state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated + 600_000);
		expect(bench.queue).toHaveLength(0);
		expect(state.modules).toHaveLength(count + 1);
		const part = state.modules.at(-1)!;
		expect(part.modelId).toBe(modelId);
		expect(part.durability).toBe(100);
		expect(state.modules.filter(item => item.id === part.id)).toHaveLength(1);
		advance(state, state.lastUpdated + 600_000);
		expect(state.modules).toHaveLength(count + 1);
		expect(copy(state)).toEqual(state);
	});

	test("complete module output waits behind a full inventory and is credited once when a slot opens", () => {
		const state = funded(), bench = room(state, "workshop");
		expect(assignWorker(state, state.scavs[0]!.id, bench.id, NOW).ok).toBe(true);
		expect(queueModuleProduction(state, bench.id, "factory-sks-stock", NOW).ok).toBe(true);
		while (state.modules.length < getModuleCapacity(state)) state.modules.push({ id: `module-${state.nextId++}`, modelId: "factory-sks-stock", durability: 100, foundAt: NOW });
		advance(state, NOW + 600_000);
		expect(bench.queue).toHaveLength(1);
		expect(bench.queue[0]!.workDone).toBe(bench.queue[0]!.workRequired);
		const paid = { ...bench.queue[0]!.paid, supplies: { ...bench.queue[0]!.paid.supplies } };
		const money = state.money;
		advance(state, state.lastUpdated + 600_000);
		expect(bench.queue[0]!.paid).toEqual(paid);
		expect(state.money).toBe(money);
		state.modules.pop();
		advance(state, state.lastUpdated + 1);
		expect(bench.queue).toHaveLength(0);
		expect(state.modules).toHaveLength(getModuleCapacity(state));
		expect(state.money).toBe(money);
		expect(copy(state)).toEqual(state);
	});

	test("medical batches reserve exact inputs, emit a full batch once and do not restart without repeat", () => {
		const state = funded(), medbay = room(state, "medbay");
		expect(assignWorker(state, state.scavs[1]!.id, medbay.id, NOW).ok).toBe(true);
		const money = state.money, scrap = state.supplies.scrap;
		expect(setRoomRecipe(state, medbay.id, "medicine-batch", false, NOW).ok).toBe(true);
		expect(state.money).toBe(money - 20);
		expect(state.supplies.scrap).toBe(scrap - 2);
		expect(state.supplies.medicine).toBe(0);
		advance(state, NOW + 600_000);
		expect(state.supplies.medicine).toBe(3);
		expect(medbay.cycles).toBe(1);
		expect(medbay.queue).toHaveLength(0);
		advance(state, NOW + 1_200_000);
		expect(state.supplies.medicine).toBe(3);
		expect(state.money).toBe(money - 20);
		expect(copy(state)).toEqual(state);
	});

	test("repeat waits for materials without debt and disabling repeat finishes the paid batch", () => {
		const state = funded(), medbay = room(state, "medbay");
		state.money = 19;
		state.supplies.scrap = 0;
		expect(assignWorker(state, state.scavs[1]!.id, medbay.id, NOW).ok).toBe(true);
		expect(setRoomRecipe(state, medbay.id, "medicine-batch", true, NOW).ok).toBe(true);
		expect(medbay.queue).toHaveLength(0);
		expect(state.money).toBe(19);
		state.money = 1000; state.supplies.scrap = 4;
		advance(state, NOW + 1);
		expect(medbay.queue).toHaveLength(1);
		expect(state.money).toBe(980);
		expect(state.supplies.scrap).toBe(2);
		expect(setRoomRecipe(state, medbay.id, null, false, state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated + 600_000);
		expect(state.supplies.medicine).toBe(3);
		expect(medbay.queue).toHaveLength(0);
		expect(medbay.repeat).toBe(false);
		expect(state.money).toBe(980);
		expect(copy(state)).toEqual(state);
	});

	test("blocked resource output holds the entire paid batch until its whole output fits", () => {
		const state = funded(), medbay = room(state, "medbay");
		expect(assignWorker(state, state.scavs[1]!.id, medbay.id, NOW).ok).toBe(true);
		expect(setRoomRecipe(state, medbay.id, "medicine-batch", false, NOW).ok).toBe(true);
		const capacity = getSupplyCapacity(state).medicine;
		state.supplies.medicine = capacity - 2;
		advance(state, NOW + 600_000);
		expect(state.supplies.medicine).toBe(capacity - 2);
		expect(medbay.queue).toHaveLength(1);
		expect(getRoomProductionState(state, medbay).reason).not.toBeNull();
		state.supplies.medicine--;
		advance(state, state.lastUpdated + 1);
		expect(state.supplies.medicine).toBe(capacity);
		expect(medbay.queue).toHaveLength(0);
		expect(medbay.cycles).toBe(1);
		expect(copy(state)).toEqual(state);
	});

	test("cancellation refunds only unstarted jobs and cannot replay a refund", () => {
		const state = funded(), bench = room(state, "workshop");
		const model = MODULE_BY_ID["factory-sks-stock"]!;
		const money = state.money, scrap = state.supplies.scrap;
		expect(queueModuleProduction(state, bench.id, model.id, NOW).ok).toBe(true);
		const id = bench.queue[0]!.id;
		expect(cancelProduction(state, bench.id, id, NOW).ok).toBe(true);
		expect(state.money).toBe(money);
		expect(state.supplies.scrap).toBe(scrap);
		const refunded = saveGame(state);
		expect(cancelProduction(state, bench.id, id, NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(refunded);
		expect(assignWorker(state, state.scavs[0]!.id, bench.id, NOW).ok).toBe(true);
		expect(queueModuleProduction(state, bench.id, model.id, NOW).ok).toBe(true);
		advance(state, NOW + 1000);
		expect(bench.queue[0]!.workDone).toBeGreaterThan(0);
		const spent = state.money;
		expect(cancelProduction(state, bench.id, bench.queue[0]!.id, state.lastUpdated).ok).toBe(true);
		expect(state.money).toBe(spent);
		expect(bench.queue).toHaveLength(0);
		expect(copy(state)).toEqual(state);
	});

	test("additional storage and housing add capacity only after completion", () => {
		const state = funded(), beds = getScavCapacity(state), guns = getStorageCapacity(state), parts = getModuleCapacity(state);
		expect(buildRoom(state, "dormitory", 0, 1, NOW).ok).toBe(true);
		expect(buildRoom(state, "storage", 1, 1, NOW).ok).toBe(true);
		expect(getScavCapacity(state)).toBe(beds);
		expect(getStorageCapacity(state)).toBe(guns);
		advance(state, NOW + 100_000);
		expect(getScavCapacity(state)).toBe(beds + 2);
		expect(getStorageCapacity(state)).toBeGreaterThan(guns);
		expect(getModuleCapacity(state)).toBeGreaterThan(parts);
		expect(copy(state)).toEqual(state);
	});

	test("upgrading pauses a paid module without losing progress and applies its level after construction", () => {
		const state = funded(), bench = room(state, "workshop");
		expect(assignWorker(state, state.scavs[0]!.id, bench.id, NOW).ok).toBe(true);
		expect(queueModuleProduction(state, bench.id, "factory-sks-stock", NOW).ok).toBe(true);
		advance(state, NOW + 5000);
		const progress = bench.queue[0]!.workDone;
		const quote = getRoomUpgradeQuote(state, bench.id);
		expect(upgradeRoom(state, bench.id, state.lastUpdated).ok).toBe(true);
		expect(bench.level).toBe(1);
		expect(bench.status).toBe("upgrading");
		advance(state, state.lastUpdated + quote.duration * 1000 - 1);
		expect(bench.queue[0]!.workDone).toBe(progress);
		expect(bench.level).toBe(1);
		expect(copy(state)).toEqual(state);
		advance(state, state.lastUpdated + 1);
		expect(bench.level).toBe(2);
		expect(bench.status).toBe("ready");
		expect(state.base.workshop).toBe(2);
		expect(bench.queue[0]!.workDone).toBe(progress);
		expect(getRoomWorkerCapacity(bench)).toBeGreaterThan(1);
		advance(state, state.lastUpdated + 600_000);
		expect(bench.queue).toHaveLength(0);
		expect(copy(state)).toEqual(state);
	});

	test("queue limits, platform locks and wrong rooms reject a new order without spending", () => {
		const state = funded(), bench = room(state, "workshop");
		for (let i = 0; i < 5; i++) expect(queueModuleProduction(state, bench.id, "factory-sks-stock", NOW).ok).toBe(true);
		const full = saveGame(state);
		expect(queueModuleProduction(state, bench.id, "factory-sks-stock", NOW).ok).toBe(false);
		expect(queueModuleProduction(state, room(state, "medbay").id, "factory-sks-stock", NOW).ok).toBe(false);
		expect(setRoomRecipe(state, bench.id, "medicine-batch", true, NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(full);
		const locked = funded();
		expect(getModuleProductionQuote(locked, room(locked, "workshop").id, "receiver-ak74").reason).not.toBeNull();
		const before = saveGame(locked);
		expect(queueModuleProduction(locked, room(locked, "workshop").id, "receiver-ak74", NOW).ok).toBe(false);
		expect(saveGame(locked)).toBe(before);
	});

	test("production, new construction and auto raids are deterministic across irregular ticks and mid-queue reload", () => {
		const long = funded();
		long.rng = 0x763511;
		const ammo = construct(long, "ammo", 0, 1);
		const start = long.lastUpdated;
		long.supplies = { ammo: 0, medicine: 0, scrap: 30, intel: 3 };
		expect(assignWorker(long, long.scavs[0]!.id, room(long, "workshop").id, start).ok).toBe(true);
		expect(assignWorker(long, long.scavs[1]!.id, ammo.id, start).ok).toBe(true);
		expect(queueModuleProduction(long, room(long, "workshop").id, "factory-sks-stock", start).ok).toBe(true);
		expect(queueModuleProduction(long, room(long, "workshop").id, "factory-sks-magazine", start).ok).toBe(true);
		expect(setRoomRecipe(long, ammo.id, "ammo-batch", true, start).ok).toBe(true);
		expect(setAutoRaid(long, long.scavs[2]!.id, "courtyard", 70, start).ok).toBe(true);
		expect(buildRoom(long, "storage", 1, 1, start).ok).toBe(true);
		const short = copy(long);
		advance(long, start + 12 * 60_000);
		varyTicks(short, start + 67_123);
		const restored = copy(short);
		varyTicks(restored, start + 12 * 60_000);
		expect(restored).toEqual(long);
		expect(copy(long)).toEqual(long);
	});

	test("capped offline time and clock rollback neither replay paid output nor alter remaining work", () => {
		const original = funded(), bench = room(original, "workshop");
		expect(assignWorker(original, original.scavs[0]!.id, bench.id, NOW).ok).toBe(true);
		expect(queueModuleProduction(original, bench.id, "factory-sks-stock", NOW).ok).toBe(true);
		expect(buildRoom(original, "dormitory", 0, 1, NOW).ok).toBe(true);
		advance(original, NOW + 13_007);
		const before = copy(original), reverted = copy(original);
		const workDone = room(reverted, "workshop").queue[0]!.workDone;
		advance(reverted, NOW + 1000);
		expect(room(reverted, "workshop").queue[0]!.workDone).toBe(workDone);
		advance(before, before.lastUpdated + 120_000);
		advance(reverted, reverted.lastUpdated + 120_000);
		expect(reverted.modules.map(part => [part.modelId, part.durability])).toEqual(before.modules.map(part => [part.modelId, part.durability]));
		expect(reverted.shelter.rooms.map(room => [room.level, room.status, room.cycles])).toEqual(before.shelter.rooms.map(room => [room.level, room.status, room.cycles]));
		expect(copy(reverted)).toEqual(reverted);
		const capped = funded(), medbay = room(capped, "medbay");
		expect(assignWorker(capped, capped.scavs[1]!.id, medbay.id, NOW).ok).toBe(true);
		expect(setRoomRecipe(capped, medbay.id, "medicine-batch", true, NOW).ok).toBe(true);
		const eightHours = copy(capped);
		advance(eightHours, NOW + MAX_OFFLINE_MS);
		const result = advance(capped, NOW + MAX_OFFLINE_MS * 3);
		expect(result.capped).toBe(true);
		expect(capped.money).toBe(eightHours.money);
		expect(capped.supplies).toEqual(eightHours.supplies);
		expect(capped.shelter).toEqual(eightHours.shelter);
		const after = saveGame(capped);
		advance(capped, capped.lastUpdated);
		expect(saveGame(capped)).toBe(after);
		expect(copy(capped)).toEqual(capped);
	});
});

describe("shelter save integrity and migration", () => {
	test("v4 migration preserves upgraded rooms, module ownership, stock and a live expedition", () => {
		const original = createGame(NOW);
		original.base = { workshop: 3, medbay: 2, radio: 2, storage: 4 };
		original.money = 4802;
		original.supplies = { ammo: 500, medicine: 100, scrap: 252, intel: 84 };
		expect(dispatchRaid(original, original.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		advance(original, NOW + 7001);
		const legacy = JSON.parse(saveGame(original));
		legacy.schemaVersion = 4;
		delete legacy.shelter;
		for (const scav of legacy.scavs) delete scav.assignment;
		const migrated = parseSave(JSON.stringify(legacy))!;
		expect(migrated).not.toBeNull();
		expect(migrated.shelter.rooms).toHaveLength(4);
		for (const room of migrated.shelter.rooms) {
			expect(room.level).toBe(original.base[room.type as keyof typeof original.base]);
			expect(room.status).toBe("ready");
			expect(room.workerIds).toEqual([]);
			expect(room.queue).toEqual([]);
		}
		expect(migrated.money).toBe(original.money);
		expect(migrated.supplies).toEqual(original.supplies);
		expect(migrated.weapons).toEqual(original.weapons);
		expect(migrated.modules).toEqual(original.modules);
		expect(migrated.raids).toEqual(original.raids);
		expect(migrated.nextId).toBe(original.nextId);
		expect(migrated.rng).toBe(original.rng);
		expect(migrated.scavs.every(scav => scav.assignment === null)).toBe(true);
		const stock = { ...migrated.supplies };
		advance(migrated, NOW + MAX_OFFLINE_MS);
		for (const key of ["ammo", "medicine", "scrap", "intel"] as const) expect(migrated.supplies[key]).toBeGreaterThanOrEqual(stock[key]);
		expect(parseSave(saveGame(migrated))).toEqual(migrated);
	});

	test("unknown rooms, duplicate sites, forged workers and malformed construction cannot be imported", () => {
		const state = createGame(NOW);
		const mutations: ((value: any) => void)[] = [
			value => { value.shelter.rooms[0].type = "constructor"; },
			value => { value.shelter.rooms[0].column = 4; },
			value => { value.shelter.rooms[0].row = 3; },
			value => { value.shelter.rooms[1].column = value.shelter.rooms[0].column; value.shelter.rooms[1].row = value.shelter.rooms[0].row; },
			value => { value.shelter.rooms.push(value.shelter.rooms[0]); },
			value => { value.shelter.rooms[0].workerIds = ["scav-999"]; },
			value => { value.scavs[0].assignment = "room-999"; },
			value => { value.scavs[0].assignment = value.shelter.rooms[0].id; },
			value => { value.shelter.rooms[0].workerIds = [value.scavs[0].id]; },
			value => { value.shelter.rooms[0].level = 6; },
			value => { value.shelter.rooms[0].status = "building"; },
			value => { value.shelter.rooms[0].construction = { workDone: -1, workRequired: 1000, targetLevel: 2, cost: { money: 1, scrap: 0 } }; },
			value => { value.shelter.extra = true; },
		];
		for (const mutate of mutations) {
			const value = JSON.parse(saveGame(state)); mutate(value);
			expect(parseSave(JSON.stringify(value))).toBeNull();
		}
		expect(copy(state)).toEqual(state);
	});

	test("import verifies a queued module's recipe, paid inputs, output and work requirement", () => {
		const state = funded(), bench = room(state, "workshop");
		expect(queueModuleProduction(state, bench.id, "factory-sks-stock", NOW).ok).toBe(true);
		const mutations: ((value: any) => void)[] = [
			value => { value.shelter.rooms[0].queue[0].output.moduleModelId = "receiver-pkp"; },
			value => { value.shelter.rooms[0].queue[0].output.supplies.scrap = 500; },
			value => { value.shelter.rooms[0].queue[0].paid.money = 1_000_000; },
			value => { value.shelter.rooms[0].queue[0].paid.supplies.scrap = 1_000_000; },
			value => { value.shelter.rooms[0].queue[0].workRequired = 1; },
			value => { value.shelter.rooms[0].queue[0].workDone = -1; },
			value => { value.shelter.rooms[0].queue[0].workDone = value.shelter.rooms[0].queue[0].workRequired + 1; },
			value => { value.shelter.rooms[0].queue[0].recipeId = "module:receiver-pkp"; },
			value => { value.shelter.rooms[0].queue.push(value.shelter.rooms[0].queue[0]); },
			value => { value.shelter.rooms[1].queue.push(value.shelter.rooms[0].queue[0]); value.shelter.rooms[0].queue = []; },
		];
		for (const mutate of mutations) {
			const value = JSON.parse(saveGame(state)); mutate(value);
			expect(parseSave(JSON.stringify(value))).toBeNull();
		}
		expect(copy(state)).toEqual(state);
	});

	test("a queued high-tier model requires that room's actual level and a receiver retains its permanent platform requirement", () => {
		const state = funded(), bench = room(state, "workshop");
		const quote = getRoomUpgradeQuote(state, bench.id);
		expect(upgradeRoom(state, bench.id, NOW).ok).toBe(true);
		advance(state, NOW + quote.duration * 1000);
		expect(queueModuleProduction(state, bench.id, "optic-scope", state.lastUpdated).ok).toBe(true);
		const downgraded = JSON.parse(saveGame(state));
		downgraded.shelter.rooms[0].level = 1;
		expect(parseSave(JSON.stringify(downgraded))).toBeNull();
		const receiver = funded(), workshop = room(receiver, "workshop");
		expect(queueModuleProduction(receiver, workshop.id, "receiver-sks", NOW).ok).toBe(true);
		const forgotten = JSON.parse(saveGame(receiver));
		forgotten.discoveredWeapons = forgotten.discoveredWeapons.filter((weapon: string) => weapon !== "sks");
		expect(parseSave(JSON.stringify(forgotten))).toBeNull();
		expect(copy(state)).toEqual(state);
		expect(copy(receiver)).toEqual(receiver);
	});
});
