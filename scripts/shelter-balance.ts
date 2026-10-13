import { type Supplies } from "../src/game/data";
import {
	advance, assignWorker, buildRoom, continueExpedition, createGame,
	dispatchRaid, extractRaid, FIELD_KITS, getFieldKitStock, getResourceProductionQuote,
	getRoomProductionState, getRoomUpgradeQuote, RESOURCE_RECIPES, saveGame, parseSave,
	setFieldKit, setRoomRecipe, upgradeRoom, type ActionResult, type GameState,
	type FieldKitSelection, type RoomInstance,
} from "../src/game/engine";

const NOW = 1_792_000_000_000;
const requested = Number(Bun.argv[2]);
const samples = Number.isFinite(requested) && requested > 0 ? Math.max(80, Math.min(300, Math.floor(requested))) : 180;
const round = (value: number) => Math.round(value * 100) / 100;
const keys = ["ammo", "medicine", "scrap", "intel"] as const;
const requireAction = (result: ActionResult) => { if (!result.ok) throw new Error(result.message); };
const blank = (): Supplies => ({ ammo: 0, medicine: 0, scrap: 0, intel: 0 });
function restore(state: GameState) {
	const restored = parseSave(saveGame(state));
	if (!restored) throw new Error("Balance fixture failed save validation");
	return restored;
}
function funded(seed = 1) {
	const state = createGame(NOW);
	state.rng = Math.imul(seed, 0x9e3779b1) >>> 0 || 1;
	state.money = 20_000;
	state.supplies = { ammo: 80, medicine: 8, scrap: 80, intel: 20 };
	return state;
}
function prepareRoom(type: RoomInstance["type"], level: number) {
	const state = funded();
	let room = state.shelter.rooms.find((item) => item.type === type);
	if (!room) {
		requireAction(buildRoom(state, type, 0, 1, state.lastUpdated));
		room = state.shelter.rooms.find((item) => item.type === type)!;
		advance(state, state.lastUpdated + room.construction!.workRequired / 1000);
	}
	while (room.level < level) {
		const quote = getRoomUpgradeQuote(state, room.id);
		requireAction(upgradeRoom(state, room.id, state.lastUpdated));
		advance(state, state.lastUpdated + quote.duration * 1000);
	}
	requireAction(assignWorker(state, state.scavs[0]!.id, room.id, state.lastUpdated));
	state.supplies = { ammo: 24, medicine: 8, scrap: 20, intel: 5 };
	return { state, room };
}

// A first paid batch, with the same actual worker and room level for both
// recipes. A no-job control advances the same clocks to subtract passive aid.
const production = RESOURCE_RECIPES.map((recipe) => {
	const { state, room } = prepareRoom(recipe.roomType, recipe.outputKit ? 1 : 2);
	const control = restore(state), startedAt = state.lastUpdated;
	const quote = getResourceProductionQuote(state, room.id, recipe.id);
	if (quote.reason) throw new Error(`${recipe.id}: ${quote.reason}`);
	const before = { money: state.money, ...state.supplies }, kitsBefore = getFieldKitStock(state);
	requireAction(setRoomRecipe(state, room.id, recipe.id, false, startedAt));
	const paid = { money: before.money - state.money,
		supplies: Object.fromEntries(keys.map((key) => [key, before[key] - state.supplies[key]])) };
	if (paid.money !== recipe.cost.money || keys.some((key) => paid.supplies[key] !== recipe.cost.supplies[key]))
		throw new Error(`${recipe.id}: actual payment disagrees with quoted inputs`);
	const running = getRoomProductionState(state, room);
	if (running.remainingSeconds === null) throw new Error(`${recipe.id}: no actual worker duration`);
	const until = startedAt + Math.ceil(running.remainingSeconds * 1000);
	advance(state, until); advance(control, until);
	if (room.cycles !== 1 || room.queue.length) throw new Error(`${recipe.id}: batch did not deliver exactly once`);
	const units = recipe.outputKit ? getFieldKitStock(state)[recipe.outputKit] - kitsBefore[recipe.outputKit]
		: keys.reduce((sum, key) => sum + recipe.output[key], 0);
	if (units < 1) throw new Error(`${recipe.id}: missing actual output`);
	const actualOutput = recipe.outputKit ? { [recipe.outputKit]: units }
		: Object.fromEntries(keys.map((key) => [key, state.supplies[key] - control.supplies[key] + recipe.cost.supplies[key]]));
	if (!recipe.outputKit && keys.some((key) => actualOutput[key] !== recipe.output[key]))
		throw new Error(`${recipe.id}: unexpected produced units after subtracting passive aid`);
	return { recipe: recipe.id, label: recipe.label, room: recipe.roomType, level: room.level,
		worker: state.scavs[0]!.name, workerRate: round(running.rate), units,
		secondsWithActualWorker: round((until - startedAt) / 1000), secondsPerUnit: round((until - startedAt) / 1000 / units),
		actualPaidInputs: paid, moneyPerUnit: round(paid.money / units),
		suppliesPerUnit: Object.fromEntries(keys.map((key) => [key, round(recipe.cost.supplies[key] / units)])), actualOutput };
});

// Manufacture both kits in the common fixture, using a different worker.
// All comparisons thus have exactly the same production history and departure
// clock. The three orders differ only in the consumed support slot.
const initial = funded();
for (const kit of ["maintenance", "trauma"] as const) {
	const room = initial.shelter.rooms.find((item) => item.type === (kit === "maintenance" ? "workshop" : "medbay"))!;
	requireAction(assignWorker(initial, initial.scavs[1]!.id, room.id, initial.lastUpdated));
	requireAction(setRoomRecipe(initial, room.id, FIELD_KITS[kit].recipeId, false, initial.lastUpdated));
	const remaining = getRoomProductionState(initial, room).remainingSeconds;
	if (remaining === null) throw new Error("Common kit manufacturing stalled");
	advance(initial, initial.lastUpdated + Math.ceil(remaining * 1000));
	requireAction(assignWorker(initial, initial.scavs[1]!.id, null, initial.lastUpdated));
}
initial.money = 10_000;
initial.supplies = { ammo: 24, medicine: 2, scrap: 0, intel: 4 };
const raidRows = [];
for (const targetDepth of [1, 3]) for (const kit of ["none", "maintenance", "trauma"] as FieldKitSelection[]) {
	let extracted = 0, returned = 0, lostWeapons = 0, injury = 0, survivorInjury = 0, wear = 0, componentWear = 0, cash = 0, seconds = 0, depth = 0;
	const delivered = blank();
	for (let seed = 1; seed <= samples; seed++) {
		const state = restore(initial), start = state.lastUpdated;
		state.rng = Math.imul(seed, 0x9e3779b1) >>> 0 || 1;
		const scav = state.scavs[0]!, weapon = state.weapons.find((item) => item.id === scav.weaponInstanceId)!;
		const startMoney = state.money;
		requireAction(setFieldKit(state, scav.id, kit));
		requireAction(dispatchRaid(state, scav.id, "courtyard", start));
		for (let guard = 0; state.raids.length && guard < 4; guard++) {
			const raid = state.raids[0]!;
			advance(state, raid.endsAt);
			if (!state.raids.length) break;
			if (raid.expedition?.status !== "choice") throw new Error("Missing genuine checkpoint");
			if (raid.expedition.stage >= targetDepth) requireAction(extractRaid(state, raid.id, state.lastUpdated));
			else requireAction(continueExpedition(state, raid.id, "scavenge", raid.expedition.offers[0]!, state.lastUpdated));
		}
		const report = state.history[0];
		if (!report || state.raids.length) throw new Error("Raid did not settle");
		if ((report.fieldKit ?? "none") !== kit) throw new Error("Consumed kit missing from retained report");
		extracted += Number(report.success); returned += Number(!report.lostScav); lostWeapons += Number(report.lostWeapon);
		injury += 100 - scav.health;
		if (!report.lostScav) survivorInjury += 100 - scav.health;
		wear += 100 - weapon.durability;
		const parts = Object.entries(weapon.modules).filter(([slot]) => slot !== "receiver");
		componentWear += parts.reduce((sum, [, part]) => sum + 100 - part.durability, 0) / parts.length;
		cash += state.money - startMoney; seconds += (state.lastUpdated - start) / 1000; depth += report.depth;
		for (const key of keys) delivered[key] += report.supplies[key];
	}
	const recipe = kit === "none" ? undefined : RESOURCE_RECIPES.find((item) => item.id === FIELD_KITS[kit].recipeId)!;
	raidRows.push({ kit, targetDepth, extractedPct: round(extracted * 100 / samples), returnedPct: round(returned * 100 / samples),
		weaponLostPct: round(lostWeapons * 100 / samples), averageSettledDepth: round(depth / samples), seconds: round(seconds / samples),
		averageDamageTakenAllDepartures: round(injury / samples), averageDamageTakenAmongSurvivors: round(survivorInjury / returned),
		averageWeaponConditionSpent: round(wear / samples), averageNonReceiverPartConditionSpent: round(componentWear / samples),
		cashAfterRaidFees: round(cash / samples), cashAfterRaidFeesAndKitProduction: round(cash / samples - (recipe?.cost.money ?? 0)),
		kitManufacturingInputs: recipe?.cost ?? { money: 0, supplies: blank() },
		realDeliveredSupplies: Object.fromEntries(keys.map((key) => [key, round(delivered[key] / samples)])) });
}

console.log(JSON.stringify({ samples, productionConditions: "One first batch by Boroda at the actual room level; ordinary and alternate supply recipes both use level2. Worker duration comes from the real queue rate. Build/upgrade inputs are excluded. A matching no-job control subtracts passive aid from supply delivery.",
	raidConditions: `All rows share one validated common fixture with each kit physically produced by another worker, both workers then released, full health/SKS condition, no equipped armor/backpack, ammo24/medicine2/scrap0/intel4, 10000 cash, neutral sector. Each row uses the same ${samples} seeds and the first genuinely offered perk. Courtyard/scavenge routes target depths1/3. Failures deliver zero loot. Damage and wear are measured before post-return recovery, including references to lost people/equipment; loss percentages are reported separately. Kit cost includes manufacturing inputs, excludes repair savings/resale. Cash stays above passive recovery allowance.`,
	production, raids: raidRows }, null, 2));
