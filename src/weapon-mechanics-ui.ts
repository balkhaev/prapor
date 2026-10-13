import { MAP_BY_ID } from "./game/data";
import { getWeaponRole, getWeaponStats, type WeaponInstance } from "./game/engine";
import { getWeaponMechanics, getWeaponRouteEffect } from "./game/weapon-mechanics";
import { EXPEDITION_BRANCHES, type ExpeditionBranch } from "./game/systems";
import { TACTICS, type RaidTactic } from "./game/operations";

const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const branches: ExpeditionBranch[] = ["scavenge", "combat", "recon"];

/** Chance modifiers are percentage points; a larger value is not a promise of a successful raid. */
export function weaponBonusLabel(value: number): string {
	const rounded = Math.round(value * 1000) / 10;
	return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} п.п.`;
}

export function weaponStatSummary(weapon: WeaponInstance): [string, string][] {
	const stats = getWeaponStats(weapon);
	return [["Вес", `${stats.weight.toFixed(2)} кг`], ["Мощь", String(stats.power)], ["Эргономика", String(stats.ergonomics)], ["Отдача ↓", String(stats.recoil)], ["Надёжность · индекс", `${stats.reliability} / 100`], ["Расход патронов", `×${(stats.ammoMultiplier * getWeaponRole(weapon).ammoMultiplier).toFixed(2)}`]];
}

export function weaponMechanicsPanel(weapon: WeaponInstance, mapId: string, tactic: RaidTactic, preview?: WeaponInstance): string {
	const stats = getWeaponStats(weapon), nextStats = preview ? getWeaponStats(preview) : stats;
	const current = getWeaponMechanics(weapon), next = preview ? getWeaponMechanics(preview) : current;
	const role = getWeaponRole(weapon), nextRole = preview ? getWeaponRole(preview) : role;
	const rows = branches.map((branch) => {
		const effect = getWeaponRouteEffect(weapon, mapId, branch, tactic, stats);
		const nextEffect = preview ? getWeaponRouteEffect(preview, mapId, branch, tactic, nextStats) : effect;
		const bonus = stats.ready ? effect.bonus + (role.branches[branch] ?? 0) : 0;
		const nextBonus = nextStats.ready ? nextEffect.bonus + (nextRole.branches[branch] ?? 0) : 0;
		const changed = preview && Math.abs(nextBonus - bonus) >= 0.0005;
		const contributions = nextEffect.contributions.filter((item) => Math.abs(item.bonus) >= 0.0005);
		const categoryBonus = nextStats.ready ? nextRole.branches[branch] ?? 0 : 0;
		const limited = [effect, nextEffect].some((item) => Math.abs(item.contributions.reduce((sum, contribution) => sum + contribution.bonus, 0) - item.bonus) > .000001);
		return `<div class="weapon-route-effect"><span>${escape(EXPEDITION_BRANCHES[branch].label)}</span><strong class="${bonus > 0 ? "better" : bonus < 0 ? "worse" : ""}">${weaponBonusLabel(bonus)}${changed ? `<b class="stat-after ${nextBonus > bonus ? "better" : "worse"}">→ ${weaponBonusLabel(nextBonus)}</b>` : ""}</strong><small>${!nextStats.ready ? "Сначала заверши сборку" : [...(categoryBonus ? [`Класс оружия ${weaponBonusLabel(categoryBonus)}`] : []), ...contributions.map((item) => `${item.label} ${weaponBonusLabel(item.bonus)}`)].map(escape).join(" · ") || "Без дополнительного бонуса"}${limited ? '<br>Вклад сборки ограничен ±12 п.п.; класс оружия учитывается отдельно.' : ""}</small></div>`;
	}).join("");
	const environment = getWeaponRouteEffect(preview ?? weapon, mapId, "scavenge", tactic, nextStats).environment;
	const features = next.features.map((feature) => `<li>${escape(feature)}</li>`).join("");
	const wearChanged = preview && Math.abs(current.wearMultiplier - next.wearMultiplier) >= 0.005;
	const mapName = MAP_BY_ID[mapId]?.name, context = mapName && !environment.label.startsWith(mapName) ? `${mapName} · ${environment.label}` : environment.label;
	return `<section class="weapon-mechanics" aria-label="Роль и механики сборки"><div class="weapon-mechanics-head"><div><span class="weapon-mechanics-kicker">${preview ? "После замены" : "Характер сборки"}</span><h3>${escape(next.label)}</h3></div><span class="weapon-wear">Износ ×${current.wearMultiplier.toFixed(2)}${wearChanged ? ` → ×${next.wearMultiplier.toFixed(2)}` : ""}<small>Ниже — реже ремонт</small></span></div><p class="weapon-mechanics-context">${escape(context)} · ${escape(TACTICS[tactic].label)}</p>${features ? `<ul class="weapon-mechanics-features">${features}</ul>` : ""}<div class="weapon-route-grid" aria-label="Вклад оружия на маршрутах">${rows}</div><p class="weapon-mechanics-note">Вклад оружия в шанс на этапах 2–3. Первый этап учитывает условия Тайников; классовые бонусы действуют на этапах 2–3. Итоговый шанс также зависит от бойца и риска маршрута.${!nextStats.ready ? " Неполная сборка не даёт бонусов и не готова к выходу." : ""}</p></section>`;
}
