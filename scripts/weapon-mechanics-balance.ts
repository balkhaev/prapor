import { MAPS, WEAPONS } from "../src/game/data";
import { createGame, dispatchRaid, getExpeditionChoices, getRaidQuote, getWeaponBuildIssues, getWeaponStats } from "../src/game/engine";
import { FACTORY_KITS, MODULE_BY_ID, type ModuleInstance } from "../src/game/modules";
import { TACTICS, type RaidTactic } from "../src/game/operations";
import { EXPEDITION_BRANCHES, type ExpeditionBranch } from "../src/game/systems";
import { getWeaponMechanics, getWeaponRouteEffect } from "../src/game/weapon-mechanics";

// A read-only, deterministic comparison: same fresh fighter, funds and equipment.
// No account, disk save, loot roll or live game state is used.
const NOW = 1_792_000_000_000;
const samples = [
	...WEAPONS.map((weapon) => ({ label: weapon.name, weaponId: weapon.id, parts: [] as string[] })),
	{ label: "АК-74 · ближнее наведение", weaponId: "ak74", parts: ["barrel-ak-5.45x39-short", "handguard-ak-carbon", "stock-ak-folding", "magazine-ak-5.45x39-quick", "optic-micro", "foregrip-angled", "laser-micro"] },
	{ label: "АК-74 · подготовленная позиция", weaponId: "ak74", parts: ["barrel-ak-5.45x39-long", "handguard-ak-carbon", "stock-ak-precision", "magazine-ak-5.45x39-drum", "optic-longscope", "foregrip-bipod", "muzzle-5.45x39-brake"] },
	{ label: "СКС · свет в темноте", weaponId: "sks", parts: ["handguard-sks-carbon", "flashlight-focus"] },
	{ label: "СКС · скрытный маршрут", weaponId: "sks", parts: ["handguard-sks-carbon", "optic-prism", "muzzle-7.62x39-compact-suppressor", "magazine-sks-7.62x39-window"] },
	{ label: "Кедр · короткий выход", weaponId: "pp91", parts: ["barrel-kedr-9x18-short", "handguard-kedr-carbon", "stock-kedr-folding", "magazine-kedr-9x18-quick", "optic-micro", "foregrip-stubby", "laser-micro"] },
	{ label: "Мосинка · дальний рубеж", weaponId: "mosin", parts: ["barrel-mosin-7.62x54-long", "handguard-mosin-carbon", "stock-mosin-precision", "magazine-mosin-7.62x54-quick", "optic-longscope", "foregrip-bipod", "muzzle-7.62x54-compact-suppressor"] },
];
const percentage = (value: number) => Math.round(value * 10_000) / 100;
const rows = samples.flatMap((sample) => [100, 60, 20].map((condition) => {
	const state = createGame(NOW), weapon = state.weapons[0]!, scav = state.scavs[0]!;
	state.money = 100_000;
	state.level = 50;
	state.supplies.ammo = state.supplies.intel = state.supplies.medicine = 10_000;
	weapon.weaponId = sample.weaponId;
	weapon.durability = condition;
	weapon.modules = {};
	for (const modelId of [...Object.values(FACTORY_KITS[sample.weaponId]!), ...sample.parts]) {
		const model = MODULE_BY_ID[modelId!]!;
		const part: ModuleInstance = { id: `module-${state.nextId++}`, modelId: model.id, durability: condition, foundAt: NOW };
		weapon.modules[model.slot] = part;
	}
	const issues = getWeaponBuildIssues(weapon);
	if (issues.length) throw new Error(`${sample.label}: ${issues.join(" ")}`);
	const stats = getWeaponStats(weapon), mechanics = getWeaponMechanics(weapon);
	const routes = MAPS.map((map) => {
		const quote = getRaidQuote(state, scav, map);
		const branches = (Object.keys(EXPEDITION_BRANCHES) as ExpeditionBranch[]).map((branch) => ({
			branch, ...Object.fromEntries((Object.keys(TACTICS) as RaidTactic[]).map((tactic) => {
				const effect = getWeaponRouteEffect(weapon, map.id, branch, tactic, stats);
				if (!Number.isFinite(effect.bonus) || Math.abs(effect.bonus) > .12) throw new Error(`Unbounded ${sample.label}/${map.id}/${branch}/${tactic}`);
				return [tactic, percentage(effect.bonus)];
			})),
		}));
		const quotes = (Object.keys(TACTICS) as RaidTactic[]).map((tactic) => {
			const preview = structuredClone(state), fighter = preview.scavs[0]!;
			fighter.tactic = tactic;
			const first = getRaidQuote(preview, fighter, map);
			const dispatched = dispatchRaid(preview, fighter.id, map.id, NOW);
			if (!dispatched.ok) throw new Error(`${sample.label}/${map.id}/${tactic}: ${dispatched.message}`);
			const raid = preview.raids[0]!;
			raid.expedition!.status = "choice";
			return { tactic, firstStageChancePct: percentage(first.chance), firstAmmo: first.ammo, durationSeconds: first.duration,
				secondStageBeforeWear: getExpeditionChoices(preview, raid).map((next) => ({ branch: next.branch,
					chancePct: percentage(next.chance), ammo: next.ammo, durationSeconds: next.duration, reason: next.reason })) };
		});
		return { sector: map.id, firstStageChancePct: percentage(quote.chance), durationSeconds: quote.duration,
			ammo: quote.ammo, effectPoints: branches, quotes };
	});
	return { build: sample.label, condition, stats, role: mechanics.label, wearMultiplier: mechanics.wearMultiplier, routes };
}));
console.log(JSON.stringify({ conditions: "All weapon parts share the indicated condition; percentages are probability points, not bullet damage. Second-stage previews use unchanged condition to compare setups before raid wear.",
	profileCount: WEAPONS.length, buildCount: samples.length, rows }, null, 2));
