import { WEAPON_BY_ID, type Rarity, type Supplies } from "./data";
import { getGearModel, getLootCapacity, getModuleCapacity, getModuleSaleValue, getStorageCapacity, getSupplyCapacity, getWeaponSaleValue, getWeaponStats, parseTradeGear, parseTradeModule, parseTradeWeapon, type ActionResult, type GameState, type WeaponInstance } from "./engine";
import { noteAchievementSupply, pruneAchievementInventory } from "./achievements";
import { FIELD_KITS, FIELD_KIT_CAPACITY, ensureShelterLogistics, getFieldKitStock, type FieldKit } from "./shelter-logistics";
import { RESOURCE_RECIPE_BY_ID } from "./shelter";
import { GEAR_MODEL_BY_ID, MARKET_OFFERS, type GearItem } from "./systems";
import { MODULE_BY_ID, type ModuleInstance } from "./modules";
import { getLootModel, getLootTraderPrice, parseLootItem, type LootItem } from "./loot";
export { creditMarketMoney } from "./engine";

export type TradeKind = "loot" | "weapon" | "module" | "gear" | "supply" | "kit";
export interface TradeRef { kind: TradeKind; id: string; quantity: number }
export type TradeAsset =
	| { kind: "loot"; item: LootItem }
	| { kind: "weapon"; item: WeaponInstance }
	| { kind: "module"; item: ModuleInstance }
	| { kind: "gear"; item: GearItem }
	| { kind: "supply"; id: keyof Supplies; quantity: number }
	| { kind: "kit"; id: FieldKit; quantity: number };
export interface TradeInventoryRow {
	ref: TradeRef; label: string; description: string; rarity: Rarity; condition: number | null;
	weight: number; guidePrice: number; traderPrice: number | null; reason: string | null; available: number;
}
export interface TradeQuote { asset: TradeAsset | null; guidePrice: number; label: string; reason: string | null }
const supplyLabels: Record<keyof Supplies, string> = { ammo: "Патроны", medicine: "Медикаменты", scrap: "Детали", intel: "Разведданные" };
const supplyWeights: Supplies = { ammo: .1, medicine: 1, scrap: .5, intel: .25 };
const unitPrice = (key: keyof Supplies) => { const offer = MARKET_OFFERS.find(offer => offer.supply === key)!; return offer.money / offer.amount; };
const priceModule = (item: ModuleInstance) => Math.max(2, Math.round(MODULE_BY_ID[item.modelId]!.value * (.4 + item.durability * .006)));
const kitPrice = (key: FieldKit) => {
	const recipe = RESOURCE_RECIPE_BY_ID[FIELD_KITS[key].recipeId]!;
	return Math.ceil(recipe.cost.money + (Object.keys(recipe.cost.supplies) as (keyof Supplies)[]).reduce((sum, supply) => sum + recipe.cost.supplies[supply] * unitPrice(supply), 0) + recipe.durationSeconds * .3);
};
const success = (message: string): ActionResult => ({ ok: true, message });
const fail = (message: string): ActionResult => ({ ok: false, message });
export function parseTradeRef(value: unknown): TradeRef | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const source = value as Record<string, unknown>;
	if (Object.keys(source).some(key => !["kind", "id", "quantity"].includes(key)) || !["loot", "weapon", "module", "gear", "supply", "kit"].includes(source.kind as string)
		|| typeof source.id !== "string" || !source.id || source.id.length > 80 || !Number.isSafeInteger(source.quantity) || Number(source.quantity) < 1 || Number(source.quantity) > 10000) return null;
	if (source.kind === "supply" ? !Object.hasOwn(supplyLabels, source.id) : source.kind === "kit" ? !Object.hasOwn(FIELD_KITS, source.id) : source.quantity !== 1) return null;
	return { kind: source.kind as TradeKind, id: source.id, quantity: source.quantity as number };
}
/** A self-contained immutable listing snapshot. Unknown fields and malformed guns never enter escrow. */
export function parseTradeAsset(value: unknown): TradeAsset | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const source = value as Record<string, unknown>;
	if (source.kind === "supply" || source.kind === "kit") {
		const ref = parseTradeRef(source); if (!ref) return null;
		return ref.kind === "supply" ? { kind: "supply", id: ref.id as keyof Supplies, quantity: ref.quantity } : { kind: "kit", id: ref.id as FieldKit, quantity: ref.quantity };
	}
	if (Object.keys(source).some(key => !["kind", "item"].includes(key))) return null;
	if (source.kind === "weapon") { const item = parseTradeWeapon(source.item); return item ? { kind: "weapon", item } : null; }
	if (source.kind === "module") { const item = parseTradeModule(source.item); return item ? { kind: "module", item } : null; }
	if (source.kind === "gear") { const item = parseTradeGear(source.item); return item ? { kind: "gear", item } : null; }
	if (source.kind === "loot") { try { const item = parseLootItem(source.item); return Number(item.id.split("-")[1]) < 1e12 ? { kind: "loot", item } : null; } catch { return null; } }
	return null;
}
function blockedWeapon(state: GameState, gun: WeaponInstance): string | null {
	if (state.raids.some(raid => raid.weaponInstanceId === gun.id)) return "Оружие сейчас в рейде.";
	if (state.scavs.some(scav => scav.weaponInstanceId === gun.id)) return "Сначала верни оружие бойца на стойку.";
	if (state.weapons.length <= 1) return "Последнюю пушку нужно оставить для отряда.";
	if (getWeaponStats(gun).ready && !state.weapons.some(other => other.id !== gun.id && getWeaponStats(other).ready)) return "Последнюю готовую пушку нужно оставить отряду.";
	return null;
}
export function getTradeInventory(state: GameState): TradeInventoryRow[] {
	const rows: TradeInventoryRow[] = [];
	const physical = (kind: TradeKind, id: string, label: string, description: string, rarity: Rarity, condition: number | null, weight: number, guidePrice: number, traderPrice: number | null, reason: string | null) => rows.push({ ref: { kind, id, quantity: 1 }, label, description, rarity, condition, weight, guidePrice, traderPrice, reason, available: 1 });
	for (const item of state.lootItems ?? []) { const model = getLootModel(item); physical("loot", item.id, model.label, model.description, model.rarity, null, model.weight, model.guidePrice, getLootTraderPrice(item), null); }
	for (const item of state.weapons) { const model = WEAPON_BY_ID[item.weaponId]!; physical("weapon", item.id, model.name, model.description, model.rarity, item.durability, getWeaponStats(item).weight, Object.values(item.modules).reduce((sum, part) => sum + priceModule(part), 0), getWeaponSaleValue(item), blockedWeapon(state, item)); }
	for (const item of state.modules) { const model = MODULE_BY_ID[item.modelId]!; physical("module", item.id, model.label, model.description, model.rarity, item.durability, model.stats.weight, priceModule(item), getModuleSaleValue(item), null); }
	for (const item of state.gearItems) { const model = getGearModel(item), worn = state.scavs.some(scav => [scav.loadout.armorItemId, scav.loadout.backpackItemId, scav.loadout.helmetItemId].includes(item.id)); physical("gear", item.id, model.label, model.description, "uncommon", item.durability, model.weight, Math.round(model.money * (.4 + item.durability * .006)), null, worn ? "Сначала сними снаряжение с бойца." : null); }
	for (const key of Object.keys(supplyLabels) as (keyof Supplies)[]) if (state.supplies[key] >= 1) rows.push({ ref: { kind: "supply", id: key, quantity: 1 }, label: supplyLabels[key], description: "Припасы убежища. Цена партии зависит от количества; выставленные припасы недоступны рейдам и производству.", rarity: "common", condition: null, weight: supplyWeights[key], guidePrice: Math.ceil(unitPrice(key)), traderPrice: null, reason: null, available: Math.floor(state.supplies[key]) });
	const kits = getFieldKitStock(state);
	for (const key of Object.keys(FIELD_KITS) as FieldKit[]) if (kits[key] >= 1) rows.push({ ref: { kind: "kit", id: key, quantity: 1 }, label: FIELD_KITS[key].label, description: FIELD_KITS[key].description, rarity: "uncommon", condition: null, weight: 1, guidePrice: kitPrice(key), traderPrice: null, reason: null, available: kits[key] });
	return rows;
}
export function getTradeQuote(state: GameState, input: TradeRef): TradeQuote {
	const ref = parseTradeRef(input); if (!ref) return { asset: null, guidePrice: 0, label: "Предмет", reason: "Некорректный товар или количество." };
	const row = getTradeInventory(state).find(row => row.ref.kind === ref.kind && row.ref.id === ref.id);
	if (!row) return { asset: null, guidePrice: 0, label: "Предмет", reason: "Предмет отсутствует на складе." };
	if (row.reason || row.available < ref.quantity) return { asset: null, guidePrice: row.guidePrice, label: row.label, reason: row.reason ?? "Недостаточно предметов для всей партии." };
	let asset: TradeAsset;
	if (ref.kind === "supply") asset = { kind: "supply", id: ref.id as keyof Supplies, quantity: ref.quantity };
	else if (ref.kind === "kit") asset = { kind: "kit", id: ref.id as FieldKit, quantity: ref.quantity };
	else if (ref.kind === "weapon") asset = { kind: "weapon", item: structuredClone(state.weapons.find(item => item.id === ref.id)!) };
	else if (ref.kind === "module") asset = { kind: "module", item: structuredClone(state.modules.find(item => item.id === ref.id)!) };
	else if (ref.kind === "gear") asset = { kind: "gear", item: structuredClone(state.gearItems.find(item => item.id === ref.id)!) };
	else asset = { kind: "loot", item: structuredClone(state.lootItems!.find(item => item.id === ref.id)!) };
	return { asset, label: row.label, guidePrice: ref.kind === "supply" ? Math.ceil(unitPrice(ref.id as keyof Supplies) * ref.quantity) : row.guidePrice * ref.quantity, reason: null };
}
export function takeTradeAsset(state: GameState, ref: TradeRef): ActionResult & { asset?: TradeAsset } {
	const quote = getTradeQuote(state, ref); if (!quote.asset || quote.reason) return fail(quote.reason ?? "Товар недоступен.");
	const asset = quote.asset;
	if (asset.kind === "supply") state.supplies[asset.id] -= asset.quantity;
	else if (asset.kind === "kit") ensureShelterLogistics(state).kits[asset.id] -= asset.quantity;
	else if (asset.kind === "weapon") state.weapons = state.weapons.filter(item => item.id !== asset.item.id);
	else if (asset.kind === "module") state.modules = state.modules.filter(item => item.id !== asset.item.id);
	else if (asset.kind === "gear") state.gearItems = state.gearItems.filter(item => item.id !== asset.item.id);
	else state.lootItems = state.lootItems!.filter(item => item.id !== asset.item.id);
	pruneAchievementInventory(state);
	return { ...success(`${quote.label} передан на барахолку.`), asset };
}
function allPhysicalIds(state: GameState): Set<string> {
	return new Set([...state.weapons.flatMap(gun => [gun.id, ...Object.values(gun.modules).map(part => part.id)]), ...state.modules.map(item => item.id), ...state.gearItems.map(item => item.id), ...(state.lootItems ?? []).map(item => item.id), ...state.raids.flatMap(raid => [...(raid.expedition?.cargo.modules.map(item => item.id) ?? []), ...(raid.expedition?.cargo.lootItems?.map(item => item.id) ?? [])])]);
}
/** Atomic delivery: validate the whole parcel and capacity before changing either inventory or identifiers. */
export function receiveTradeAsset(state: GameState, input: TradeAsset, now = state.lastUpdated, rekey = true): ActionResult {
	const asset = parseTradeAsset(input); if (!asset || !Number.isFinite(now) || now < 0 || now > state.lastUpdated) return fail("Некорректная посылка.");
	if (asset.kind === "supply") {
		if (state.supplies[asset.id] + asset.quantity > getSupplyCapacity(state)[asset.id]) return fail("Для всей партии нет места на складе.");
		state.supplies[asset.id] += asset.quantity;
		noteAchievementSupply(state, asset.id, asset.quantity);
	} else if (asset.kind === "kit") {
		if (getFieldKitStock(state)[asset.id] + asset.quantity > FIELD_KIT_CAPACITY) return fail("Шкаф полевых комплектов полон.");
		ensureShelterLogistics(state).kits[asset.id] += asset.quantity;
	} else {
		const capacity = asset.kind === "weapon" ? getStorageCapacity(state) : asset.kind === "module" ? getModuleCapacity(state) : asset.kind === "gear" ? 28 : getLootCapacity(state);
		const count = asset.kind === "weapon" ? state.weapons.length : asset.kind === "module" ? state.modules.length : asset.kind === "gear" ? state.gearItems.length : state.lootItems?.length ?? 0;
		if (count >= capacity) return fail("Нет места для купленного предмета.");
		const ids = [asset.item.id, ...(asset.kind === "weapon" ? Object.values(asset.item.modules).map(part => part.id) : [])];
		if (rekey && state.nextId + ids.length >= 1e12) return fail("Лимит идентификаторов исчерпан.");
		if (!rekey && ids.some(itemId => allPhysicalIds(state).has(itemId) || Number(itemId.split("-")[1]) >= state.nextId)) return fail("Предмет с таким номером уже существует или номер недопустим.");
		if (rekey) {
			asset.item.id = `${asset.kind === "weapon" ? "gun" : asset.kind}-${state.nextId++}`;
			if ("foundAt" in asset.item) asset.item.foundAt = now;
			if (asset.kind === "weapon") for (const part of Object.values(asset.item.modules)) { part.id = `module-${state.nextId++}`; part.foundAt = now; }
		}
		if (asset.kind === "weapon") { state.weapons.push(asset.item); if (!state.discoveredWeapons.includes(asset.item.weaponId)) state.discoveredWeapons.push(asset.item.weaponId); }
		else if (asset.kind === "module") { state.modules.push(asset.item); const weaponId = MODULE_BY_ID[asset.item.modelId]!.weaponId; if (MODULE_BY_ID[asset.item.modelId]!.slot === "receiver" && weaponId && !state.discoveredWeapons.includes(weaponId)) state.discoveredWeapons.push(weaponId); }
		else if (asset.kind === "gear") state.gearItems.push(asset.item);
		else (state.lootItems ??= []).push(asset.item);
	}
	return success("Предметы получены со склада барахолки.");
}
/** Used for market snapshots, without player inventory ownership checks. */
export function getTradeAssetRow(asset: TradeAsset): Omit<TradeInventoryRow, "ref" | "reason" | "available"> {
	if (asset.kind === "loot") { const model = getLootModel(asset.item); return { label: model.label, description: model.description, rarity: model.rarity, condition: null, weight: model.weight, guidePrice: model.guidePrice, traderPrice: getLootTraderPrice(asset.item) }; }
	if (asset.kind === "weapon") { const model = WEAPON_BY_ID[asset.item.weaponId]!; return { label: model.name, description: model.description, rarity: model.rarity, condition: asset.item.durability, weight: getWeaponStats(asset.item).weight, guidePrice: Object.values(asset.item.modules).reduce((sum, part) => sum + priceModule(part), 0), traderPrice: getWeaponSaleValue(asset.item) }; }
	if (asset.kind === "module") { const model = MODULE_BY_ID[asset.item.modelId]!; return { label: model.label, description: model.description, rarity: model.rarity, condition: asset.item.durability, weight: model.stats.weight, guidePrice: priceModule(asset.item), traderPrice: getModuleSaleValue(asset.item) }; }
	if (asset.kind === "gear") { const model = GEAR_MODEL_BY_ID[asset.item.modelId]!; return { label: model.label, description: model.description, rarity: "uncommon", condition: asset.item.durability, weight: model.weight, guidePrice: Math.round(model.money * (.4 + asset.item.durability * .006)), traderPrice: null }; }
	if (asset.kind === "supply") return { label: supplyLabels[asset.id], description: "Припасы убежища.", rarity: "common", condition: null, weight: supplyWeights[asset.id] * asset.quantity, guidePrice: Math.ceil(unitPrice(asset.id) * asset.quantity), traderPrice: null };
	return { label: FIELD_KITS[asset.id].label, description: FIELD_KITS[asset.id].description, rarity: "uncommon", condition: null, weight: asset.quantity, guidePrice: kitPrice(asset.id) * asset.quantity, traderPrice: null };
}
