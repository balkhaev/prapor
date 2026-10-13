import { MAP_BY_ID } from "./game/data";
import { getWeaponStats, type WeaponInstance } from "./game/engine";
import { AMMO_BY_ID, AMMO_TYPES, AMMO_TYPE_LABELS, getAmmoEffect, getAmmoModel, type AmmoEffect, type AmmoModel, type AmmoType } from "./game/ammunition";
import { EXPEDITION_BRANCHES, type ExpeditionBranch } from "./game/systems";
import { TACTICS, type RaidTactic } from "./game/operations";
import { weaponBonusLabel } from "./weapon-mechanics-ui";

const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const percent = (value: number) => `${Math.round(value * 100)}%`;
const amount = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
const branches: ExpeditionBranch[] = ["scavenge", "combat", "recon"];

export function ammunitionCaliberLabel(caliber: string): string {
	return caliber.endsWith("g") ? `${caliber.slice(0, -1)} калибр` : `${caliber.replaceAll(".", ",").replace("x", "×")} мм`;
}

function ammunitionTypeLabel(model: AmmoModel): string {
	if (model.caliber.endsWith("g") && model.type === "expanding") return "Дробовые";
	if (model.caliber.endsWith("g") && model.type === "precision") return "Пулевые";
	return AMMO_TYPE_LABELS[model.type];
}

export function ammunitionThreat(effect: AmmoEffect): string {
	return `<span class="ammunition-branch-threat">Броня ${effect.enemy.armorClass} класса · ${percent(effect.enemy.armoredShare)} целей в броне · пробитие ${percent(effect.penetrationChance)}<br>Патрон ${weaponBonusLabel(effect.bonus)} к шансу · средний урон ${amount(effect.effectiveDamage)} · ранение ×${effect.injuryMultiplier.toFixed(2)}</span>`;
}

/** Only compatible cartridges appear; a type preference survives changing the weapon. */
export function ammunitionOptions(weapon: WeaponInstance | null | undefined, selected: AmmoType): string {
	if (!weapon) return '<option value="">Сначала выдай оружие</option>';
	return AMMO_TYPES.map((type) => {
		const model = getAmmoModel(weapon, type);
		return `<option value="${type}" ${type === selected ? "selected" : ""}>${escape(model.label)} · ${escape(ammunitionTypeLabel(model))}</option>`;
	}).join("");
}

/** A carried cartridge is identified by the dispatch snapshot, never by a future loadout. */
export function ammunitionSnapshot(modelId: string | null | undefined, legacy = false): string {
	const model = modelId && Object.hasOwn(AMMO_BY_ID, modelId) ? AMMO_BY_ID[modelId] : undefined;
	if (!model) return legacy ? '<p class="ammo-snapshot">Этот выход начат по прежним правилам боеприпасов.<small>Новые типы и расчёт брони будут учтены при следующем выходе.</small></p>' : "";
	return `<div class="ammo-snapshot" aria-label="Боеприпас в рейде"><strong>${escape(model.label)}</strong><span>${escape(ammunitionTypeLabel(model))} · урон патрона ${amount(model.damage)} · пробитие ${amount(model.penetration)}</span><small>Выбран перед выходом. Сменить боеприпас можно после возвращения.</small></div>`;
}

export interface AmmunitionPanelOptions { compare?: boolean; chargedAmmo?: number }

/** Every displayed armor chance, effective damage and route modifier comes from the raid calculation. */
export function ammunitionPanel(weapon: WeaponInstance | null | undefined, type: AmmoType, mapId: string, tactic: RaidTactic, options: AmmunitionPanelOptions = {}): string {
	if (!weapon) return '<p class="field-hint">Выдай оружие: его калибр определит доступные патроны.</p>';
	const effect = getAmmoEffect(weapon, type, mapId, "scavenge", 1, tactic), model = effect.model;
	const ready = getWeaponStats(weapon).ready;
	const armorNote = ready && AMMO_TYPES.every((candidate) => getAmmoEffect(weapon, candidate, mapId, "scavenge", 1, tactic).bonus < 0)
		? " Броня снижает вклад всех патронов: сравни средний урон и пробитие." : "";
	const routeRows = branches.map((branch) => {
		const route = getAmmoEffect(weapon, type, mapId, branch, 2, tactic);
		const bonus = ready ? route.bonus : 0;
		return `<div class="weapon-route-effect"><span>${escape(EXPEDITION_BRANCHES[branch].label)}</span><strong class="${bonus > 0 ? "better" : bonus < 0 ? "worse" : ""}">${weaponBonusLabel(bonus)}</strong><small>${ready ? `Броня ${route.enemy.armorClass} класса · ${percent(route.enemy.armoredShare)} целей в броне<br>Средний урон ${amount(route.effectiveDamage)} · ранение ×${route.injuryMultiplier.toFixed(2)}` : "Сначала заверши сборку"}</small></div>`;
	}).join("");
	const comparison = options.compare ? `<details class="ammunition-comparison" open><summary>Сравнить 4 типа · только ${escape(ammunitionCaliberLabel(model.caliber))}</summary><div class="ammunition-table-wrap"><table class="ammunition-table"><thead><tr><th scope="col">Патрон</th><th scope="col">Урон</th><th scope="col">Пробитие</th><th scope="col">Средний урон</th><th scope="col">Вклад на входе</th><th scope="col">Расход</th></tr></thead><tbody>${AMMO_TYPES.map((candidate) => {
		const variant = getAmmoEffect(weapon, candidate, mapId, "scavenge", 1, tactic);
		return `<tr class="${candidate === type ? "selected" : ""}" ${candidate === type ? 'aria-current="true"' : ""}><td>${escape(variant.model.label)}<small>${escape(ammunitionTypeLabel(variant.model))}${candidate === type ? " · выбран" : ""}</small></td><td>${amount(variant.model.damage)}</td><td>${amount(variant.model.penetration)}</td><td>${amount(variant.effectiveDamage)}</td><td>${weaponBonusLabel(ready ? variant.bonus : 0)}</td><td>×${variant.model.ammoMultiplier.toFixed(2)}</td></tr>`;
	}).join("")}</tbody></table></div></details>` : "";
	return `<section class="ammunition-panel" aria-label="Патрон и броня противника"><div class="ammunition-head"><div><span class="ammunition-kicker">${escape(ammunitionTypeLabel(model))}</span><h3>${escape(model.label)}</h3></div><span class="ammunition-caliber">${escape(ammunitionCaliberLabel(model.caliber))}</span></div><p class="ammunition-description">${escape(model.description)}</p><div class="ammunition-metrics"><span>Урон патрона<strong>${amount(model.damage)}</strong></span><span>Пробитие · индекс<strong>${amount(model.penetration)}</strong></span><span>Расход припасов<strong>×${model.ammoMultiplier.toFixed(2)}</strong></span><span>Износ оружия<strong>×${model.wearMultiplier.toFixed(2)}</strong></span></div><p class="ammunition-enemy"><strong>${escape(MAP_BY_ID[mapId]?.name ?? "Сектор")} · первый этап</strong><br>${escape(effect.enemy.label)} в броне.<br>Пробитие этой брони: <strong>${percent(effect.penetrationChance)}</strong> · средний урон по составу целей: <strong>${amount(effect.effectiveDamage)}</strong>.<br>Вклад патрона в шанс на входе: <strong class="${ready && effect.bonus > 0 ? "better" : ready && effect.bonus < 0 ? "worse" : ""}">${weaponBonusLabel(ready ? effect.bonus : 0)}</strong>${options.chargedAmmo !== undefined ? ` · на входе ${options.chargedAmmo} патр.` : ""}</p><div class="weapon-route-grid" aria-label="Вклад патрона на втором этапе">${routeRows}</div>${comparison}<p class="ammunition-note">${escape(TACTICS[tactic].label)}. Маршруты показаны для второго этапа; глубже чаще встречаются цели в броне. Урон и пробитие — игровые характеристики патрона. Пробитие относится к цели в броне, а средний урон учитывает весь состав противников; это не шанс успеха рейда.${armorNote} Множитель ранений меняет тяжесть травмы в огневом контакте. Выбор оплачивается из общего запаса патронов, точный расход учитывает оружие и маршрут.${!ready ? " Сначала заверши сборку: неполное оружие не даёт бонуса боеприпаса." : ""}</p></section>`;
}
