import { AMMO_TYPES, getAmmoEffect } from "../src/game/ammunition";
import { MAP_BY_ID } from "../src/game/data";
import {
	advance, continueExpedition, createGame, dispatchRaid, extractRaid, getRaidQuote,
	getExpeditionChoices, getRepairCost, setLoadoutOption, xpForLevel, type RunPerk,
} from "../src/game/engine";

// Each type sees the same fixed seed set, fully serviced factory SKS and healthy
// starter scav. Fees measure supplies paid, not the net after ammunition loot.
const NOW = 1_792_000_000_000;
const samples = Math.max(50, Math.min(5_000, Number(Bun.argv[2]) || 150));
const rows: Record<string, unknown>[] = [];
const round = (value: number) => Math.round(value * 100) / 100;
const preferredPerks: RunPerk[] = ["careful", "fieldMedic", "gunsmith"];

for (const mapId of ["courtyard", "bunker"] as const) for (const depth of [1, 3]) for (const type of AMMO_TYPES) {
	let returned = 0, wounds = 0, totalAmmo = 0, weaponWear = 0, repairs = 0, repairMoney = 0, repairScrap = 0, firstChance = 0;
	for (let seed = 1; seed <= samples; seed++) {
		const state = createGame(NOW);
		state.rng = Math.imul(seed, 0x9e3779b1) >>> 0 || 1;
		state.level = 9; state.xp = xpForLevel(9);
		state.money = 50_000;
		state.supplies = { ammo: 1_000, medicine: 100, scrap: 1_000, intel: 100 };
		const gun = state.weapons[0]!, scav = state.scavs[0]!;
		// The late-game sector needs an experienced scav; identical across the eight
		// ammunition choices, so deep sorties remain observable rather than all fatal.
		if (mapId === "bunker") { scav.level = 9; scav.combat = 90; scav.scouting = 90; }
		gun.durability = 100;
		for (const part of Object.values(gun.modules)) part.durability = 100;
		scav.health = 100;
		const selection = setLoadoutOption(state, scav.id, "ammoType", type);
		if (!selection.ok) throw new Error(selection.message);
		const quote = getRaidQuote(state, scav, MAP_BY_ID[mapId]!);
		if (quote.reason) throw new Error(quote.reason);
		firstChance = quote.chance;
		totalAmmo += quote.ammo;
		const dispatched = dispatchRaid(state, scav.id, mapId, NOW);
		if (!dispatched.ok) throw new Error(dispatched.message);
		for (let guard = 0; state.raids.length && guard < 4; guard++) {
			const raid = state.raids[0]!;
			advance(state, raid.endsAt);
			if (!state.raids.length) break;
			if (raid.expedition?.status !== "choice") throw new Error("Missing checkpoint");
			if (raid.expedition.stage >= depth) {
				const extraction = extractRaid(state, raid.id, state.lastUpdated);
				if (!extraction.ok) throw new Error(extraction.message);
			} else {
				const branch = mapId === "bunker" ? "combat" : "scavenge";
				const perk = preferredPerks.find((preferred) => raid.expedition!.offers.includes(preferred)) ?? raid.expedition.offers[0]!;
				const next = getExpeditionChoices(state, raid, perk).find((choice) => choice.branch === branch)!;
				if (next.reason) throw new Error(next.reason);
				totalAmmo += next.ammo;
				const continuation = continueExpedition(state, raid.id, branch, perk, state.lastUpdated);
				if (!continuation.ok) throw new Error(continuation.message);
			}
		}
		const report = state.history[0];
		if (state.raids.length || !report) throw new Error("Sortie did not finish");
		returned += Number(report.success);
		wounds += 100 - scav.health;
		weaponWear += 100 - gun.durability;
		if (state.weapons.some((item) => item.id === gun.id)) {
			const repair = getRepairCost(gun);
			repairs += 1; repairMoney += repair.money; repairScrap += repair.scrap;
		}
	}
	rows.push({ map: mapId, depth, type, started: samples, firstChancePct: round(firstChance * 100),
		returnedPct: round(returned * 100 / samples), healthLostPerStarted: round(wounds / samples),
		paidAmmoPerStarted: round(totalAmmo / samples), weaponWearPerStarted: round(weaponWear / samples),
		retainedWeapons: repairs, repairMoneyPerRetained: round(repairMoney / Math.max(1, repairs)),
		repairScrapPerRetained: round(repairScrap / Math.max(1, repairs)) });
}

console.log(JSON.stringify({ samplesPerType: samples, totalSorties: samples * 4 * AMMO_TYPES.length,
	fixture: { weapon: "factory-sks", tactic: "balanced", health: 100, weaponCondition: 100, armour: "none", matchedSeeds: true,
		courtyardScav: "starter", bunkerScav: { level: 9, combat: 90, scouting: 90 }, perks: "prefer careful, fieldMedic, gunsmith when offered" },
	precisionNiche: AMMO_TYPES.map((type) => { const effect = getAmmoEffect({ weaponId: "sks" }, type, "reserve", "recon", 1, "cautious"); return { type, bonusPct: round(effect.bonus * 100), effectiveDamage: round(effect.effectiveDamage) }; }),
	quietNiche: ["sks", "asval"].map((weaponId) => ({ weapon: weaponId, suppression: weaponId === "asval" ? "integral" : "none", choices: AMMO_TYPES.map((type) => {
		const effect = getAmmoEffect({ weaponId }, type, "courtyard", "recon", 1, "cautious");
		return { type, bonusPct: round(effect.bonus * 100), effectiveDamage: round(effect.effectiveDamage) };
	}) })),
	rows }, null, 2));
