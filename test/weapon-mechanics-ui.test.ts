import { describe, expect, test } from "bun:test";
import { getWeaponRole, getWeaponStats, type WeaponInstance } from "../src/game/engine";
import { FACTORY_KITS, MODULE_BY_ID } from "../src/game/modules";
import { getWeaponMechanics, getWeaponRouteEffect } from "../src/game/weapon-mechanics";
import { weaponBonusLabel, weaponMechanicsPanel, weaponStatSummary } from "../src/weapon-mechanics-ui";

const factory = (weaponId: string): WeaponInstance => ({ id: "ui-weapon", weaponId, durability: 100, foundAt: 0, attachments: { optic: 0, magazine: 0, stock: 0 }, modules: Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId]) => [slot, { id: `ui-${slot}`, modelId, durability: 100, foundAt: 0 }])) });
const install = (weapon: WeaponInstance, modelId: string, durability = 100) => { const model = MODULE_BY_ID[modelId]!; weapon.modules[model.slot] = { id: `ui-${model.slot}`, modelId, durability, foundAt: 0 }; };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("weapon mechanics presentation", () => {
	test("uses percentage points for conditional modifiers, including small and negative effects", () => {
		expect(weaponBonusLabel(.031)).toBe("+3,1 п.п.");
		expect(weaponBonusLabel(-.009)).toBe("−0,9 п.п.");
		expect(weaponBonusLabel(0)).toBe("0 п.п.");
	});

	test("summary matches real worn power and category ammo, with reliability as an index", () => {
		const weapon = factory("ak74");
		weapon.durability = weapon.modules.receiver!.durability = 40;
		const summary = Object.fromEntries(weaponStatSummary(weapon));
		expect(summary["Мощь"]).toBe(String(getWeaponStats(weapon).power));
		expect(summary["Мощь"]).not.toBe(String(getWeaponStats(weapon).damage));
		expect(summary["Расход патронов"]).toBe("×1.30");
		expect(summary["Надёжность · индекс"]).toBe(`${getWeaponStats(weapon).reliability} / 100`);
		expect(summary).not.toHaveProperty("Урон");
	});

	test("route totals include both physical build and class effects in the selected conditions", () => {
		const weapon = factory("mosin"), stats = getWeaponStats(weapon), before = JSON.stringify(weapon);
		const html = weaponMechanicsPanel(weapon, "forest", "cautious");
		for (const branch of ["scavenge", "combat", "recon"] as const) {
			const expected = getWeaponRouteEffect(weapon, "forest", branch, "cautious", stats).bonus + (getWeaponRole(weapon).branches[branch] ?? 0);
			expect(html).toContain(weaponBonusLabel(expected));
		}
		expect(html).toContain(getWeaponMechanics(weapon).label);
		expect(html).toContain("этапах 2–3");
		expect(html).toContain("Первый этап учитывает условия Тайников");
		expect(html).toContain("классовые бонусы действуют на этапах 2–3");
		expect(html).toContain("дальняя дистанция");
		expect(html).not.toContain("% успеха");
		expect(JSON.stringify(weapon)).toBe(before);
	});

	test("replacement exposes its real contextual benefit and added service cost without installing", () => {
		const weapon = factory("ak74"), preview = structuredClone(weapon);
		install(preview, "muzzle-5.45x39-suppressor");
		const before = JSON.stringify(weapon), html = weaponMechanicsPanel(weapon, "bunker", "cautious", preview);
		expect(html).toContain("После замены");
		expect(text(html)).toContain("Износ ×1.00 → ×1.20");
		expect(html).toContain("Скрытность");
		expect(html).toContain('class="stat-after better"');
		expect(JSON.stringify(weapon)).toBe(before);
		expect(weapon.modules.muzzle).toBeUndefined();
	});

	test("an incomplete build has no advertised route bonuses even if its class normally benefits", () => {
		const weapon = factory("mosin");
		delete weapon.modules.barrel;
		const html = weaponMechanicsPanel(weapon, "forest", "balanced");
		expect(html.match(/<strong class="">0 п.п.<\/strong>/g)).toHaveLength(3);
		expect(html).toContain("Неполная сборка не даёт бонусов");
		expect(html).not.toContain("Класс оружия +");
	});

	test("explains the build cap while retaining the separate class bonus", () => {
		const weapon = factory("pkp");
		for (const modelId of ["barrel-pkp-7.62x54-long", "handguard-pkp-rail", "optic-longscope", "stock-pkp-tactical", "foregrip-bipod"]) install(weapon, modelId);
		const stats = getWeaponStats(weapon), effect = getWeaponRouteEffect(weapon, "forest", "combat", "cautious", stats);
		expect(stats.ready).toBe(true);
		expect(effect.contributions.reduce((sum, item) => sum + item.bonus, 0)).toBeGreaterThan(.12);
		expect(effect.bonus).toBe(.12);
		const html = weaponMechanicsPanel(weapon, "forest", "cautious");
		expect(html).toContain("Вклад сборки ограничен ±12 п.п.; класс оружия учитывается отдельно.");
		expect(html).toContain(weaponBonusLabel(.12 + getWeaponRole(weapon).branches.combat!));
		expect(html).toContain(`Класс оружия ${weaponBonusLabel(getWeaponRole(weapon).branches.combat!)}`);
	});

	test("does not imply that ordinary builds have reached the cap", () => {
		const html = weaponMechanicsPanel(factory("ak74"), "courtyard", "balanced");
		expect(html).not.toContain("Вклад сборки ограничен");
	});
});
