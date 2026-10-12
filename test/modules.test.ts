import { describe, expect, test } from "bun:test";
import {
	MAX_OFFLINE_MS,
	advance,
	assembleWeapon,
	craftModule,
	disassembleWeapon,
	dispatchRaid,
	equipWeapon,
	extractRaid,
	getModuleCapacity,
	getModuleCraftReason,
	getModuleInstallReason,
	getModuleRemoveReason,
	getModuleRepairCost,
	getModuleRecycleYield,
	getModuleSaleValue,
	getSupplyCapacity,
	getWeaponDisassembleReason,
	getWeaponStats,
	getWeaponSaleValue,
	installModule,
	loadGameWithSummary,
	parseSave,
	recycleModule,
	recycleWeapon,
	removeModule,
	repairModule,
	repairWeapon,
	saveGame,
	sellModule,
	sellWeapon,
	createGame,
	continueExpedition,
	getRepairCost,
	type GameState,
	type Raid,
	type WeaponInstance,
} from "../src/game/engine";
import { FACTORY_KITS, MODULE_BY_ID, RECEIVER_INFO, type ModuleInstance, type ModuleSlot } from "../src/game/modules";

const NOW = 1_792_000_000_000;

function workshop(): GameState {
	const state = createGame(NOW);
	state.base.workshop = 5;
	state.money = 50_000;
	state.supplies.scrap = 500;
	return state;
}

function craft(state: GameState, modelId: string): ModuleInstance {
	expect(craftModule(state, modelId).ok).toBe(true);
	const part = state.modules.at(-1)!;
	expect(part.modelId).toBe(modelId);
	return part;
}

function sks(state: GameState): WeaponInstance {
	return state.weapons.find((gun) => gun.weaponId === "sks")!;
}

function allPartIds(state: GameState): string[] {
	return [
		...state.modules.map((part) => part.id),
		...state.weapons.flatMap((gun) => Object.values(gun.modules).map((part) => part.id)),
		...state.raids.flatMap((raid) => raid.expedition?.cargo.modules.map((part) => part.id) ?? []),
	].sort();
}

function expectValid(state: GameState) {
	expect(new Set(allPartIds(state)).size).toBe(allPartIds(state).length);
	expect(parseSave(saveGame(state))).toEqual(state);
}

function readyFromReceiver(state: GameState, weaponId: string): WeaponInstance {
	if (!state.discoveredWeapons.includes(weaponId)) state.discoveredWeapons.push(weaponId);
	const receiver = craft(state, `receiver-${weaponId}`);
	expect(assembleWeapon(state, receiver.id).ok).toBe(true);
	const gun = state.weapons.at(-1)!;
	for (const slot of RECEIVER_INFO[weaponId]!.requiredSlots) {
		if (slot === "receiver") continue;
		const part = craft(state, FACTORY_KITS[weaponId]![slot]!);
		expect(installModule(state, gun.id, part.id).ok).toBe(true);
	}
	expect(getWeaponStats(gun).ready).toBe(true);
	return gun;
}

function lootedCheckpoint(): { state: GameState; raid: Raid } {
	const template = workshop();
	craft(template, "optic-reflex");
	expect(dispatchRaid(template, template.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
	for (let seed = 1; seed <= 80; seed++) {
		const state = structuredClone(template);
		const raid = state.raids[0]!;
		raid.seed = seed;
		raid.chance = 1;
		advance(state, raid.endsAt);
		if (raid.expedition!.cargo.modules.length > 0) {
			expectValid(state);
			return { state, raid };
		}
	}
	throw new Error("No carried module found in the bounded deterministic seed fixtures");
}

describe("physical weapon assembly", () => {
	test("swapping a stock conserves physical IDs, returns the old part once and makes real ergonomic tradeoffs", () => {
		const state = workshop();
		const gun = sks(state);
		const old = gun.modules.stock!;
		const original = getWeaponStats(gun);
		const replacement = craft(state, "stock-sks-folding");
		const ids = allPartIds(state);
		expect(installModule(state, gun.id, replacement.id).ok).toBe(true);
		expect(gun.modules.stock).toEqual(replacement);
		expect(state.modules.filter((part) => part.id === old.id)).toHaveLength(1);
		expect(state.modules.some((part) => part.id === replacement.id)).toBe(false);
		expect(allPartIds(state)).toEqual(ids);
		const folded = getWeaponStats(gun);
		expect(folded.ergonomics).toBeGreaterThan(original.ergonomics);
		expect(folded.recoil).toBeGreaterThan(original.recoil);
		expect(folded.weight).toBeLessThan(original.weight);
		const installed = saveGame(state);
		expect(installModule(state, gun.id, replacement.id).ok).toBe(false);
		expect(saveGame(state)).toBe(installed);
		expect(installModule(state, gun.id, old.id).ok).toBe(true);
		expect(state.modules.filter((part) => part.id === replacement.id)).toHaveLength(1);
		expect(allPartIds(state)).toEqual(ids);
		expectValid(state);
	});

	test("optic and foregrip need the real handguard mount, which cannot be removed or swapped out under its children", () => {
		const state = workshop();
		const gun = sks(state);
		const optic = craft(state, "optic-reflex");
		const before = saveGame(state);
		expect(getModuleInstallReason(state, gun.id, optic.id)).not.toBeNull();
		expect(installModule(state, gun.id, optic.id).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		const factoryHandguard = gun.modules.handguard!;
		const rail = craft(state, "handguard-sks-rail");
		expect(installModule(state, gun.id, rail.id).ok).toBe(true);
		expect(installModule(state, gun.id, optic.id).ok).toBe(true);
		const grip = craft(state, "foregrip-light");
		expect(installModule(state, gun.id, grip.id).ok).toBe(true);
		const mounted = saveGame(state);
		expect(getModuleRemoveReason(state, gun.id, "handguard")).not.toBeNull();
		expect(removeModule(state, gun.id, "handguard").ok).toBe(false);
		expect(installModule(state, gun.id, factoryHandguard.id).ok).toBe(false);
		expect(saveGame(state)).toBe(mounted);
		expect(removeModule(state, gun.id, "optic").ok).toBe(true);
		expect(removeModule(state, gun.id, "foregrip").ok).toBe(true);
		expect(installModule(state, gun.id, factoryHandguard.id).ok).toBe(true);
		expectValid(state);
	});

	test("caliber, platform and receiver identity each reject incompatible parts atomically", () => {
		const state = workshop();
		const akm = readyFromReceiver(state, "akm");
		const otherCaliber = craft(state, "barrel-ak-5.45x39-long");
		const otherPlatform = craft(state, "factory-sks-stock");
		const otherReceiver = craft(state, "receiver-sks");
		for (const part of [otherCaliber, otherPlatform, otherReceiver]) {
			const saved = saveGame(state);
			expect(getModuleInstallReason(state, akm.id, part.id)).not.toBeNull();
			expect(installModule(state, akm.id, part.id).ok).toBe(false);
			expect(saveGame(state)).toBe(saved);
		}
		expectValid(state);
	});

	test("a receiver creates a bare incomplete gun and requires owned parts before it can depart", () => {
		const state = workshop();
		const receiver = craft(state, "receiver-sks");
		const partIds = allPartIds(state);
		expect(assembleWeapon(state, receiver.id).ok).toBe(true);
		const gun = state.weapons.at(-1)!;
		expect(Object.keys(gun.modules)).toEqual(["receiver"]);
		expect(gun.modules.receiver!.id).toBe(receiver.id);
		expect(allPartIds(state)).toEqual(partIds);
		expect(getWeaponStats(gun).ready).toBe(false);
		expect(getWeaponStats(gun).power).toBe(0);
		const scav = state.scavs[0]!;
		expect(equipWeapon(state, scav.id, gun.id).ok).toBe(true);
		const bare = saveGame(state);
		expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(bare);
		for (const slot of RECEIVER_INFO.sks!.requiredSlots) {
			if (slot === "receiver") continue;
			const part = craft(state, FACTORY_KITS.sks![slot]!);
			expect(installModule(state, gun.id, part.id).ok).toBe(true);
		}
		expect(getWeaponStats(gun).ready).toBe(true);
		expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
		expectValid(state);
	});

	test("active sorties lock the whole build and individual installed parts without spending or moving anything", () => {
		const state = workshop();
		const gun = sks(state);
		const stock = craft(state, "stock-sks-folding");
		const receiver = craft(state, "receiver-sks");
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		const saved = saveGame(state);
		expect(installModule(state, gun.id, stock.id).ok).toBe(false);
		expect(installModule(state, gun.id, receiver.id).ok).toBe(false);
		expect(removeModule(state, gun.id, "stock").ok).toBe(false);
		expect(disassembleWeapon(state, gun.id).ok).toBe(false);
		expect(repairWeapon(state, gun.id).ok).toBe(false);
		expect(sellWeapon(state, gun.id).ok).toBe(false);
		expect(recycleWeapon(state, gun.id).ok).toBe(false);
		for (const part of Object.values(gun.modules)) {
			expect(repairModule(state, part.id).ok).toBe(false);
			expect(sellModule(state, part.id).ok).toBe(false);
			expect(recycleModule(state, part.id).ok).toBe(false);
		}
		expect(saveGame(state)).toBe(saved);
		expectValid(state);
	});

	test("an incomplete second gun does not make destroying the last ready build safe", () => {
		const state = workshop();
		for (const gun of [...state.weapons].slice(1)) expect(disassembleWeapon(state, gun.id).ok).toBe(true);
		const onlyReady = sks(state);
		const receiver = state.modules.find((part) => part.modelId === "receiver-pm")!;
		expect(assembleWeapon(state, receiver.id).ok).toBe(true);
		const ruinedBarrel = craft(state, FACTORY_KITS.sks!.barrel!);
		ruinedBarrel.durability = 0;
		expect(state.weapons).toHaveLength(2);
		expect(state.weapons.filter((gun) => getWeaponStats(gun).ready)).toHaveLength(1);
		const saved = saveGame(state);
		expect(getWeaponDisassembleReason(state, onlyReady.id)).not.toBeNull();
		expect(disassembleWeapon(state, onlyReady.id).ok).toBe(false);
		expect(removeModule(state, onlyReady.id, "barrel").ok).toBe(false);
		expect(sellWeapon(state, onlyReady.id).ok).toBe(false);
		expect(recycleWeapon(state, onlyReady.id).ok).toBe(false);
		expect(installModule(state, onlyReady.id, ruinedBarrel.id).ok).toBe(false);
		expect(saveGame(state)).toBe(saved);
		expectValid(state);
	});

	test("a full loose stash permits a net-zero swap but blocks removal and whole-build overflow", () => {
		const state = workshop();
		state.supplies.scrap = 10_000;
		const gun = sks(state);
		const replacement = craft(state, "stock-sks-folding");
		while (state.modules.length < getModuleCapacity(state)) craft(state, "optic-reflex");
		const ids = allPartIds(state);
		expect(installModule(state, gun.id, replacement.id).ok).toBe(true);
		expect(state.modules).toHaveLength(getModuleCapacity(state));
		expect(allPartIds(state)).toEqual(ids);
		const full = saveGame(state);
		expect(removeModule(state, gun.id, "stock").ok).toBe(false);
		expect(disassembleWeapon(state, gun.id).ok).toBe(false);
		expect(craftModule(state, "optic-reflex").ok).toBe(false);
		expect(saveGame(state)).toBe(full);
		expectValid(state);
	});

	test("disassemble and reassemble conserve wear and parts rather than repairing a worn gun", () => {
		const state = workshop();
		const gun = sks(state);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		const raid = state.raids[0]!;
		raid.chance = 1;
		advance(state, raid.endsAt);
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		expect(gun.durability).toBeLessThan(100);
		const condition = gun.durability;
		const oldParts = structuredClone(gun.modules);
		const ids = allPartIds(state);
		const money = state.money;
		const scrap = state.supplies.scrap;
		expect(disassembleWeapon(state, gun.id).ok).toBe(true);
		expect(assembleWeapon(state, oldParts.receiver!.id).ok).toBe(true);
		const rebuilt = state.weapons.at(-1)!;
		for (const slot of Object.keys(oldParts) as ModuleSlot[]) {
			if (slot !== "receiver") expect(installModule(state, rebuilt.id, oldParts[slot]!.id).ok).toBe(true);
		}
		expect(rebuilt.durability).toBe(condition);
		expect(rebuilt.modules).toEqual(oldParts);
		expect(allPartIds(state)).toEqual(ids);
		expect(state.money).toBe(money);
		expect(state.supplies.scrap).toBe(scrap);
		expectValid(state);
	});

	test("module crafting, repair and liquidation require full costs and cannot profit through immediate recycling or repair", () => {
		const state = workshop();
		const model = MODULE_BY_ID["optic-reflex"]!;
		state.supplies.scrap = model.craftCost.scrap - 1;
		const poor = saveGame(state);
		expect(craftModule(state, model.id).ok).toBe(false);
		expect(saveGame(state)).toBe(poor);
		state.supplies.scrap = 30;
		state.money = 5_000;
		const cash = state.money;
		const scrap = state.supplies.scrap;
		const made = craft(state, model.id);
		expect(getModuleSaleValue(made)).toBeLessThan(model.craftCost.money);
		expect(getModuleRecycleYield(made)).toBeLessThan(model.craftCost.scrap);
		expect(sellModule(state, made.id).ok).toBe(true);
		expect(state.money).toBeLessThan(cash);
		expect(state.supplies.scrap).toBeLessThan(scrap);
		const worn = craft(state, model.id);
		worn.durability = 20;
		const beforeRepairSale = getModuleSaleValue(worn);
		const cost = getModuleRepairCost(worn);
		state.supplies.scrap = cost.scrap - 1;
		const incompleteCost = saveGame(state);
		expect(repairModule(state, worn.id).ok).toBe(false);
		expect(saveGame(state)).toBe(incompleteCost);
		state.supplies.scrap = cost.scrap;
		const beforeRepair = state.money;
		expect(repairModule(state, worn.id).ok).toBe(true);
		expect(state.money).toBe(beforeRepair - cost.money);
		expect(state.supplies.scrap).toBe(0);
		expect(worn.durability).toBe(100);
		expect(getModuleSaleValue(worn) - cost.money).toBeLessThanOrEqual(beforeRepairSale);
		state.supplies.scrap = getSupplyCapacity(state).scrap;
		const full = saveGame(state);
		expect(recycleModule(state, worn.id).ok).toBe(false);
		expect(saveGame(state)).toBe(full);
		state.supplies.scrap = 0;
		const yieldAmount = getModuleRecycleYield(worn);
		expect(recycleModule(state, worn.id).ok).toBe(true);
		expect(state.supplies.scrap).toBe(yieldAmount);
		const after = saveGame(state);
		expect(sellModule(state, worn.id).ok).toBe(false);
		expect(recycleModule(state, worn.id).ok).toBe(false);
		expect(saveGame(state)).toBe(after);
		expectValid(state);
	});

	test("crafting a receiver requires discovery and workshop capability, rather than offering every platform from the start", () => {
		const state = createGame(NOW);
		state.money = 50_000;
		state.supplies.scrap = 500;
		const initial = saveGame(state);
		expect(getModuleCraftReason(state, "receiver-ak74")).not.toBeNull();
		expect(craftModule(state, "receiver-ak74").ok).toBe(false);
		expect(saveGame(state)).toBe(initial);
		state.discoveredWeapons.push("ak74");
		const discovered = saveGame(state);
		expect(craftModule(state, "receiver-ak74").ok).toBe(false);
		expect(saveGame(state)).toBe(discovered);
		state.base.workshop = MODULE_BY_ID["receiver-ak74"]!.workshopLevel;
		expect(craftModule(state, "receiver-ak74").ok).toBe(true);
		expectValid(state);
	});

	test("whole-build repair accepts damaged installed components even with an unworn receiver and pays the complete quote", () => {
		const state = workshop();
		const gun = sks(state);
		gun.modules.barrel!.durability = 20;
		gun.modules.magazine!.durability = 45;
		expect(gun.durability).toBe(100);
		const cost = getRepairCost(gun);
		expect(cost.money).toBeGreaterThan(0);
		expect(cost.scrap).toBeGreaterThan(0);
		state.supplies.scrap = cost.scrap - 1;
		const incomplete = saveGame(state);
		expect(repairWeapon(state, gun.id).ok).toBe(false);
		expect(saveGame(state)).toBe(incomplete);
		state.supplies.scrap = cost.scrap;
		const money = state.money;
		expect(repairWeapon(state, gun.id).ok).toBe(true);
		expect(state.money).toBe(money - cost.money);
		expect(state.supplies.scrap).toBe(0);
		expect(Object.values(gun.modules).every((part) => part.durability === 100)).toBe(true);
		expectValid(state);
	});

	test("bench servicing batches small component wear without making repair and resale profitable", () => {
		const state = workshop();
		const gun = sks(state);
		const components = Object.entries(gun.modules).filter(([slot]) => slot !== "receiver").map(([, part]) => part);
		expect(components).toHaveLength(4);
		for (const part of components) part.durability = 94;
		const individualMaterials = components.reduce((sum, part) => sum + getModuleRepairCost(part).scrap, 0);
		const cost = getRepairCost(gun);
		expect(cost.scrap).toBeGreaterThan(0);
		expect(cost.scrap).toBeLessThan(individualMaterials);
		const oldSaleValue = getWeaponSaleValue(gun);
		state.money = cost.money - 1;
		state.supplies.scrap = cost.scrap;
		const unaffordable = saveGame(state);
		expect(repairWeapon(state, gun.id).ok).toBe(false);
		expect(saveGame(state)).toBe(unaffordable);
		state.money = cost.money;
		const money = state.money;
		expect(repairWeapon(state, gun.id).ok).toBe(true);
		expect(state.money).toBe(money - cost.money);
		expect(state.supplies.scrap).toBe(0);
		expect(Object.values(gun.modules).every((part) => part.durability === 100)).toBe(true);
		expect(cost.money).toBeGreaterThanOrEqual(getWeaponSaleValue(gun) - oldSaleValue);
		const repaired = saveGame(state);
		expect(repairWeapon(state, gun.id).ok).toBe(false);
		expect(saveGame(state)).toBe(repaired);
		expect(sellWeapon(state, gun.id).ok).toBe(true);
		expect(state.money).toBeLessThanOrEqual(money + oldSaleValue);
		expectValid(state);
	});

	test("a migrated receiver keeps its paid legacy bonuses exactly once through disassembly and rebuilding", async () => {
		const raw = await Bun.file(new URL("./fixtures/legacy-v3-expedition.json", import.meta.url)).text();
		const state = parseSave(raw)!;
		expect(state).not.toBeNull();
		const raid = state.raids[0]!;
		advance(state, raid.endsAt);
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		const gun = sks(state);
		const bonuses = { ...gun.attachments };
		expect(bonuses).toEqual({ optic: 2, magazine: 1, stock: 1 });
		expect(gun.modules.receiver!.legacyAttachments).toEqual(bonuses);
		const power = getWeaponStats(gun).power;
		const parts = structuredClone(gun.modules);
		const ids = allPartIds(state);
		expect(disassembleWeapon(state, gun.id).ok).toBe(true);
		expect(assembleWeapon(state, parts.receiver!.id).ok).toBe(true);
		const rebuilt = state.weapons.at(-1)!;
		for (const slot of Object.keys(parts) as ModuleSlot[]) if (slot !== "receiver") expect(installModule(state, rebuilt.id, parts[slot]!.id).ok).toBe(true);
		expect(rebuilt.attachments).toEqual(bonuses);
		expect(rebuilt.modules.receiver!.legacyAttachments).toEqual(bonuses);
		expect(getWeaponStats(rebuilt).power).toBe(power);
		expect(allPartIds(state)).toEqual(ids);
		expectValid(state);
	});
});

describe("physical module loot and save boundaries", () => {
	test("carried modules cannot be installed or sold until one-time extraction, including after offline reload", () => {
		const { state, raid } = lootedCheckpoint();
		const carried = structuredClone(raid.expedition!.cargo.modules);
		const owned = state.modules.map((part) => part.id);
		for (const part of carried) {
			expect(state.modules.some((item) => item.id === part.id)).toBe(false);
			const saved = saveGame(state);
			expect(installModule(state, state.weapons[1]!.id, part.id).ok).toBe(false);
			expect(sellModule(state, part.id).ok).toBe(false);
			expect(repairModule(state, part.id).ok).toBe(false);
			expect(recycleModule(state, part.id).ok).toBe(false);
			expect(saveGame(state)).toBe(saved);
		}
		const offline = loadGameWithSummary(saveGame(state), state.lastUpdated + MAX_OFFLINE_MS * 3)!;
		expect(offline).not.toBeNull();
		expect(offline.summary.completedCount).toBe(0);
		expect(offline.state.raids[0]!.expedition!.cargo.modules).toEqual(carried);
		// Parts keep their acquisition dates through a local clock rollback,
		// even when those dates are later than the rebased simulation cursor.
		const loaded = loadGameWithSummary(saveGame(offline.state), NOW - 60_000)!;
		expect(loaded).not.toBeNull();
		expect(loaded.summary.completedCount).toBe(0);
		expect(loaded.state.raids[0]!.expedition!.cargo.modules).toEqual(carried);
		expect(loaded.state.modules.map((part) => part.id)).toEqual(owned);
		expect(extractRaid(loaded.state, raid.id, loaded.state.lastUpdated).ok).toBe(true);
		for (const part of carried) expect(loaded.state.modules.filter((item) => item.id === part.id)).toEqual([part]);
		const after = saveGame(loaded.state);
		expect(extractRaid(loaded.state, raid.id, loaded.state.lastUpdated).ok).toBe(false);
		expect(advance(loaded.state, loaded.state.lastUpdated).completedCount).toBe(0);
		expect(saveGame(loaded.state)).toBe(after);
		expectValid(loaded.state);
	});

	test("losing a gun destroys its installed parts and unextracted cargo while preserving unrelated loose and installed pieces", () => {
		const { state: template } = lootedCheckpoint();
		const gun = sks(template);
		const installed = Object.values(gun.modules).map((part) => part.id);
		const cargo = template.raids[0]!.expedition!.cargo.modules.map((part) => part.id);
		const unrelated = allPartIds(template).filter((id) => !installed.includes(id) && !cargo.includes(id));
		let lost: GameState | null = null;
		for (let seed = 1; seed <= 1_000; seed++) {
			const state = structuredClone(template);
			const raid = state.raids[0]!;
			expect(continueExpedition(state, raid.id, "combat", raid.expedition!.offers[0]!, state.lastUpdated).ok).toBe(true);
			raid.seed = seed;
			raid.chance = 0;
			advance(state, raid.endsAt);
			if (state.history[0]!.lostWeapon) { lost = state; break; }
		}
		expect(lost).not.toBeNull();
		expect(lost!.history[0]!.lostCargo!.modules.map((part) => part.id)).toEqual(cargo);
		expect(lost!.weapons.some((weapon) => weapon.id === gun.id)).toBe(false);
		for (const id of [...installed, ...cargo]) expect(allPartIds(lost!)).not.toContain(id);
		for (const id of unrelated) expect(allPartIds(lost!)).toContain(id);
		expectValid(lost!);
		const loaded = loadGameWithSummary(saveGame(lost!), lost!.lastUpdated + MAX_OFFLINE_MS)!;
		expect(loaded).not.toBeNull();
		for (const id of [...installed, ...cargo]) expect(allPartIds(loaded.state)).not.toContain(id);
		expectValid(loaded.state);
	});

	test("forged v4 saves cannot duplicate module IDs across loose, installed or carried ownership", () => {
		const { state } = lootedCheckpoint();
		const mutations: ((value: ReturnType<typeof JSON.parse>) => void)[] = [
			(value) => { value.modules.push(value.weapons[0].modules.barrel); },
			(value) => { value.modules.push(value.raids[0].expedition.cargo.modules[0]); },
			(value) => { value.raids[0].expedition.cargo.modules.push(value.modules[0]); },
			(value) => { value.weapons[1].modules.stock.id = value.weapons[0].modules.stock.id; },
			(value) => { value.raids[0].expedition.cargo.modules.push(value.raids[0].expedition.cargo.modules[0]); },
		];
		for (const mutate of mutations) {
			const value = JSON.parse(saveGame(state));
			mutate(value);
			expect(parseSave(JSON.stringify(value))).toBeNull();
		}
		expectValid(state);
	});

	test("forged module models, slots, parent mounts and receiver condition cannot reach gameplay", () => {
		const state = workshop();
		const gun = sks(state);
		const rail = craft(state, "handguard-sks-rail");
		expect(installModule(state, gun.id, rail.id).ok).toBe(true);
		const optic = craft(state, "optic-reflex");
		expect(installModule(state, gun.id, optic.id).ok).toBe(true);
		const mutations: ((value: ReturnType<typeof JSON.parse>) => void)[] = [
			(value) => { value.modules[0].modelId = "constructor"; },
			(value) => { value.weapons[0].modules.receiver.modelId = "receiver-pm"; },
			(value) => { value.weapons[0].modules.magazine = value.weapons[0].modules.barrel; delete value.weapons[0].modules.barrel; },
			(value) => { value.weapons[0].modules.handguard.modelId = "factory-sks-handguard"; },
			(value) => { value.weapons[0].modules.receiver.durability = 50; },
			(value) => { value.modules[0].durability = Number.NaN; },
			(value) => { value.modules[0].durability = -1; },
			(value) => { value.modules[0].foundAt = -1; },
			(value) => { value.modules[0].id = "module-999999"; },
			(value) => { value.modules[0].legacyAttachments = { optic: 1, magazine: 0, stock: 0 }; },
			(value) => { value.weapons[0].attachments.optic = 1; },
			(value) => { value.weapons[0].modules.receiver.legacyAttachments = { optic: 4, magazine: 0, stock: 0 }; value.weapons[0].attachments.optic = 4; },
		];
		for (const mutate of mutations) {
			const value = JSON.parse(saveGame(state));
			mutate(value);
			expect(parseSave(JSON.stringify(value))).toBeNull();
		}
		expectValid(state);
	});
});
