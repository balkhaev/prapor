import { describe, expect, test } from "bun:test";
import { WEAPONS } from "../src/game/data";
import { type GameState, type WeaponInstance, advance, dispatchSquadRaid, getWeaponStats, setLoadoutOption } from "../src/game/engine";
import { FACTORY_KITS, RECEIVER_INFO } from "../src/game/modules";
import { AMMO_TYPES, getAmmoEffect, getAmmoModel } from "../src/game/ammunition";
import { ammunitionCaliberLabel, ammunitionCards, ammunitionOptions, ammunitionPanel, ammunitionSnapshot, ammunitionThreat } from "../src/ammunition-ui";
import { weaponBonusLabel } from "../src/weapon-mechanics-ui";
import { squadRaidComposer, squadRaidDecision, squadRaidSummary } from "../src/squad-raid-ui";
import { fundedSquadFixture, SQUAD_FIXTURE_NOW } from "./squad-raid-fixtures";

const factory = (weaponId: string): WeaponInstance => ({ id: "ammo-ui", weaponId, durability: 100, foundAt: 0, attachments: { optic: 0, magazine: 0, stock: 0 }, modules: Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId]) => [slot, { id: `ammo-ui-${slot}`, modelId, durability: 100, foundAt: 0 }])) });
const number = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });

function mixedAmmoCheckpoint(): GameState {
	for (let offset = 0; offset < 256; offset++) {
		const state = fundedSquadFixture(SQUAD_FIXTURE_NOW + offset);
		for (const [index, type] of ["piercing", "expanding", "precision"].entries()) {
			const result = setLoadoutOption(state, state.scavs[index]!.id, "ammoType", type);
			if (!result.ok) throw new Error(result.message);
		}
		const result = dispatchSquadRaid(state, state.scavs.map((scav) => scav.id), "courtyard", state.lastUpdated);
		if (!result.ok) throw new Error(result.message);
		advance(state, Math.max(...state.raids.map((raid) => raid.endsAt)));
		if (state.raids.length === 3 && state.raids.every((raid) => raid.expedition?.status === "choice")) return state;
	}
	throw new Error("No genuine mixed-ammunition checkpoint found");
}

describe("ammunition presentation", () => {
	test("offers exactly eight compatible cartridges for every platform and retains the chosen type", () => {
		for (const definition of WEAPONS) {
			const weapon = factory(definition.id);
			const html = ammunitionOptions(weapon, "precision");
			expect(html.match(/<option/g)).toHaveLength(8);
			expect(html.match(/ selected/g)).toHaveLength(1);
			expect(html).toContain('value="precision" selected');
			for (const type of AMMO_TYPES) expect(html).toContain(getAmmoModel(weapon, type).label);
			expect(getAmmoModel(weapon, "precision").caliber).toBe(RECEIVER_INFO[weapon.weaponId]!.caliber);
		}
	});

	test("uses readable rifle and shotgun calibers", () => {
		expect(ammunitionCaliberLabel("5.45x39")).toBe("5,45×39 мм");
		expect(ammunitionCaliberLabel("12g")).toBe("12 калибр");
		expect(ammunitionCaliberLabel("20g")).toBe("20 калибр");
	});

	test("requires a weapon before presenting caliber-specific options or modifiers", () => {
		expect(ammunitionOptions(null, "piercing")).toBe('<option value="">Сначала выдай оружие</option>');
		const html = ammunitionPanel(null, "piercing", "bunker", "bold");
		expect(html).toContain("Выдай оружие");
		expect(html).not.toContain("п.п.");
		expect(html).not.toContain("Пробитие");
	});

	test("shows selected round damage rather than weapon power, and the real first-stage effect", () => {
		const weapon = factory("ak74"), effect = getAmmoEffect(weapon, "piercing", "bunker", "scavenge", 1, "balanced");
		const html = ammunitionPanel(weapon, "piercing", "bunker", "balanced", { chargedAmmo: 14 });
		expect(effect.model.damage).not.toBe(getWeaponStats(weapon).power);
		expect(html).toContain(`Урон патрона<strong>${number(effect.model.damage)}</strong>`);
		expect(html).toContain(`Пробитие · индекс<strong>${number(effect.model.penetration)}</strong>`);
		expect(html).toContain(`средний урон по составу целей: <strong>${number(effect.effectiveDamage)}</strong>`);
		expect(html).toContain(`Пробитие этой брони: <strong>${Math.round(effect.penetrationChance * 100)}%</strong>`);
		expect(html).toContain(weaponBonusLabel(effect.bonus));
		expect(html).toContain("на входе 14 патр.");
		expect(html).toContain("это не шанс успеха рейда");
		expect(html).toContain("общего запаса патронов");
	});

	test("route rows use the actual next-stage armor, damage, modifier and injury severity", () => {
		const weapon = factory("mosin"), html = ammunitionPanel(weapon, "precision", "forest", "cautious");
		for (const branch of ["scavenge", "combat", "recon"] as const) {
			const expected = getAmmoEffect(weapon, "precision", "forest", branch, 2, "cautious");
			expect(html).toContain(weaponBonusLabel(expected.bonus));
			expect(html).toContain(`Броня ${expected.enemy.armorClass} класса · ${Math.round(expected.enemy.armoredShare * 100)}% целей в броне`);
			expect(html).toContain(`Средний урон ${number(expected.effectiveDamage)} · ранение ×${expected.injuryMultiplier.toFixed(2)}`);
		}
		expect(html).toContain("для второго этапа; глубже чаще встречаются цели в броне");
	});

	test("compares the eight real rounds under the same selected sector and tactic without mutation", () => {
		const weapon = factory("saiga"), before = JSON.stringify(weapon);
		const html = ammunitionPanel(weapon, "expanding", "reserve", "bold", { compare: true });
		expect(html).toContain("Сравнить 8 типов · только 12 калибр");
		expect(html.match(/<tr class=/g)).toHaveLength(8);
		expect(html.match(/aria-current="true"/g)).toHaveLength(1);
		for (const type of AMMO_TYPES) {
			const effect = getAmmoEffect(weapon, type, "reserve", "scavenge", 1, "bold");
			expect(html).toContain(`<td>${number(effect.model.damage)}</td><td>${number(effect.model.penetration)}</td><td>${number(effect.effectiveDamage)}</td><td>${weaponBonusLabel(effect.bonus)}</td><td>×${effect.model.ammoMultiplier.toFixed(2)}</td>`);
		}
		expect(JSON.stringify(weapon)).toBe(before);
	});

	test("all platforms show eight selectable packs from their own caliber with real stats and no inventory grants", () => {
		for (const definition of WEAPONS) {
			const weapon = factory(definition.id), before = JSON.stringify(weapon);
			const html = ammunitionCards(weapon, "highpressure", { selectScavId: 'scav-"1' });
			expect(html.match(/<button /g)).toHaveLength(8);
			expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
			expect(html).toContain('data-ammo-pick="highpressure"');
			expect(html).toContain('data-ammo-scav="scav-&quot;1"');
			for (const type of AMMO_TYPES) {
				const model = getAmmoModel(weapon, type);
				expect(html).toContain(`data-ammo-art="${model.id}"`);
				expect(html).toContain(`пачка ${model.packRounds}`);
				expect(html).toContain(`<b>${model.packCode}</b>`);
				expect(html).toContain(`Урон <b>${number(model.damage)}</b> · пробитие <b>${number(model.penetration)}</b>`);
				expect(html).toContain(`Припасы ×${model.ammoMultiplier.toFixed(2)} · износ ×${model.wearMultiplier.toFixed(2)}`);
			}
			expect(html).not.toContain("На складе");
			expect(html).not.toContain("Купить");
			expect(JSON.stringify(weapon)).toBe(before);
		}
	});

	test("pack count stays descriptive while the actual dispatch amount comes from the quote", () => {
		const weapon = factory("pm"), html = ammunitionPanel(weapon, "surplus", "depot", "cautious", { chargedAmmo: 9 });
		expect(html).toContain('data-ammo-art="ammo-9x18-surplus" role="img"');
		expect(html).toContain("На изображении пачка 50 патронов.");
		expect(html).toContain("На входе потребуется <strong>9 патр.</strong> из общего запаса.");
		expect(html).toContain("Маршруты и действие патрона");
		expect(html).not.toContain('<details class="ammunition-route-details" open');
	});

	test("incomplete weapons retain raw cartridge stats and advertise no active bonuses", () => {
		const weapon = factory("ak74"); delete weapon.modules.barrel;
		const html = ammunitionPanel(weapon, "expanding", "courtyard", "balanced", { compare: true });
		expect(html.match(/<strong class="">0 п.п.<\/strong>/g)).toHaveLength(4);
		expect(html).toContain("неполное оружие не даёт бонуса боеприпаса");
		expect(html).toContain("Урон патрона<strong>56</strong>");
		expect(html).not.toContain("+3,");
	});

	test("a raid identifies the frozen caliber and gives no speculative current-sector claims", () => {
		const model = getAmmoModel(factory("pm"), "piercing");
		const html = ammunitionSnapshot(model.id);
		expect(html).toContain(model.label);
		expect(html).toContain(`data-ammo-art="${model.id}"`);
		expect(html).toContain("/art/ammo/ammo-9x18.png");
		expect(html).toContain("Выбран перед выходом");
		expect(html).toContain("после возвращения");
		expect(html).not.toContain("п.п.");
		expect(html).not.toContain("средний урон");
		expect(ammunitionSnapshot(null, true)).toContain("прежним правилам");
		expect(ammunitionSnapshot("__proto__")).toBe("");
		expect(ammunitionSnapshot("unknown")).toBe("");
	});

	test("branch decisions display the actual quoted armor effect and no independent success chance", () => {
		const effect = getAmmoEffect(factory("pm"), "piercing", "bunker", "combat", 3, "balanced");
		const html = ammunitionThreat(effect);
		expect(html).toContain(`Броня ${effect.enemy.armorClass} класса`);
		expect(html).toContain(`пробитие ${Math.round(effect.penetrationChance * 100)}%`);
		expect(html).toContain(`Патрон ${weaponBonusLabel(effect.bonus)} к шансу`);
		expect(html).toContain(`ранение ×${effect.injuryMultiplier.toFixed(2)}`);
		expect(html).not.toContain("% успеха");
	});

	test("a squad with three calibers shows each fighter's frozen round and personal route effect", () => {
		const state = mixedAmmoCheckpoint(), before = JSON.stringify(state), leader = state.raids[0]!;
		const summary = squadRaidSummary(state, leader), decision = squadRaidDecision(state, leader, leader.expedition!.offers[0]);
		expect(decision.match(/class="squad-ammunition-threat"/g)).toHaveLength(3);
		for (const raid of state.raids) {
			const run = raid.expedition!, weapon = state.weapons.find((item) => item.id === raid.weaponInstanceId)!;
			expect(summary).toContain(getAmmoModel(weapon, run.loadout.ammoType).label);
			for (const branch of ["scavenge", "combat", "recon"] as const) {
				const effect = getAmmoEffect(weapon, run.loadout.ammoType, raid.mapId, branch, 2, raid.tactic);
				expect(decision).toContain(`<b>${raid.scavName}</b>: пробитие ${Math.round(effect.penetrationChance * 100)}% · патрон ${weaponBonusLabel(effect.bonus)} к шансу`);
			}
		}
		expect(JSON.stringify(state)).toBe(before);
	});

	test("squad preparation names the actual ammo of each compatible weapon", () => {
		const state = fundedSquadFixture();
		for (const scav of state.scavs) expect(setLoadoutOption(state, scav.id, "ammoType", "precision").ok).toBe(true);
		const html = squadRaidComposer(state, state.scavs.map((scav) => scav.id), "courtyard");
		for (const scav of state.scavs) {
			const weapon = state.weapons.find((item) => item.id === scav.weaponInstanceId)!;
			expect(html).toContain(getAmmoModel(weapon, "precision").label);
		}
	});
});
