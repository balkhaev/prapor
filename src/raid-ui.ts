import { getCargoWeight, getWeaponDefinition, getWeaponStats, type GameState, type Raid, type RaidReport } from './game/engine';
import { MAP_BY_ID, RARITY_COLORS, RARITY_LABELS, WEAPON_BY_ID, type Supplies } from './game/data';
import { MODULE_BY_ID, MODULE_SLOT_LABELS, modulePlatformLabel, type ModuleInstance, type ModuleModel } from './game/modules';
import { scavPortrait } from './art';
import { moduleArt } from './armory-art';
import { getRaidFieldFrame, getRaidFieldObjective, getRaidFieldPlan, type RaidFieldPlan } from './raid-field';

const e = (text: unknown) => String(text).replace(/[&<>"']/g, value => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value]!));
const n = (value: number) => Math.floor(value).toLocaleString('ru-RU');
const time = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2,'0')}`;
const clock = (at: number) => new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const plans = new Map<string, RaidFieldPlan>();
function planFor(raid: Raid) {
	const key = `${raid.id}:${raid.seed}:${raid.mapId}:${raid.expedition?.stage ?? 0}:${raid.expedition?.branch ?? 'legacy'}:${raid.tactic}`;
	let plan = plans.get(key);
	if (!plan) { plan = getRaidFieldPlan(raid); plans.set(key,plan); if(plans.size > 8) plans.delete(plans.keys().next().value!); }
	return plan;
}
export function getWatchedReport(state: GameState, id: string | null): RaidReport | null {
	return state.history.find(report => report.raidId === id) ?? null;
}
export interface ConfirmedRaidPart { instanceId: string | null; model: ModuleModel; durability: number | null; foundAt: number | null }
export interface ConfirmedRaidCargo {
	status: 'carried' | 'delivered' | 'lost'; money: number; supplies: Supplies;
	parts: ConfirmedRaidPart[]; weaponIds: string[]; weight: number | null; capacity: number | null;
}
/** Report moduleIds are model IDs. Never borrow a similarly named part from the stash. */
export function getConfirmedRaidCargo(raid: Raid, candidate: RaidReport | null = null): ConfirmedRaidCargo {
	const report = candidate?.raidId === raid.id ? candidate : null;
	const cargo = report && !report.success ? report.lostCargo : raid.expedition?.cargo;
	const models = report?.success ? report.moduleIds : cargo?.modules.map(part => part.modelId) ?? [];
	const matches = !report?.success || JSON.stringify([...(cargo?.modules.map(part => part.modelId) ?? [])].sort()) === JSON.stringify([...models].sort());
	const physical: ModuleInstance[] = matches ? [...(cargo?.modules ?? [])] : [];
	const parts = models.flatMap(modelId => {
		if (!Object.hasOwn(MODULE_BY_ID, modelId)) return [];
		const index = physical.findIndex(item => item.modelId === modelId), item = index < 0 ? null : physical.splice(index,1)[0];
		return [{ instanceId: item?.id ?? null, model: MODULE_BY_ID[modelId]!, durability: item?.durability ?? null, foundAt: item?.foundAt ?? null }];
	});
	return { status: report ? report.success ? 'delivered' : 'lost' : 'carried', money: report?.success ? report.money : cargo?.money ?? 0,
		supplies: { ...(report?.success ? report.supplies : cargo?.supplies ?? { ammo: 0, medicine: 0, scrap: 0, intel: 0 }) }, parts,
		weaponIds: report?.success ? report.weaponId ? [report.weaponId] : [] : [...(cargo?.weaponIds ?? [])],
		weight: cargo && !report?.success ? getCargoWeight(cargo) : null, capacity: raid.expedition?.capacity ?? null };
}
function compatibility(model: ModuleModel) {
	const platform = model.platforms.includes('*') ? 'Разные платформы' : model.platforms.map(modulePlatformLabel).join(' / ');
	const caliber = model.calibers.includes('*') ? '' : ` · ${model.calibers.join(' / ')}`;
	const mount = model.requiresMount === 'rail-top' ? ' · Нужна верхняя планка' : model.requiresMount === 'rail-bottom' ? ' · Нужна нижняя планка'
		: model.requiresMount === 'dovetail' ? ' · Боковой кронштейн' : model.requiresMount?.startsWith('thread:') ? ' · Нужна резьба' : '';
	return platform + caliber + mount;
}
function renderCargo(raid: Raid, report: RaidReport | null) {
	const cargo = getConfirmedRaidCargo(raid, report);
	const label = cargo.status === 'carried' ? 'Подтверждено на пройденных этапах' : cargo.status === 'delivered' ? 'Доставлено при эвакуации' : 'Потерянный груз';
	const values = (['ammo','medicine','scrap','intel'] as const).filter(key => cargo.supplies[key] > 0);
	const supplyNames: Record<keyof Supplies, string> = { ammo: 'Патроны', medicine: 'Медикаменты', scrap: 'Металл', intel: 'Разведданные' };
	const note = cargo.status === 'carried' ? 'До эвакуации груз остаётся под риском.' : cargo.status === 'lost' ? 'Эти детали не попали на склад.' : 'При полном складе лишние модули продаются. Ниже — находки выхода, а не остаток склада.';
	return `<div class="live-cargo ${cargo.status === 'lost' ? 'failed' : ''}"><span class="eyebrow">${label}</span><strong>${n(cargo.money)} ₽ ${cargo.weight === null || cargo.capacity === null ? '' : `<small>${cargo.weight.toFixed(1)} / ${cargo.capacity.toFixed(1)} ед.</small>`}</strong><p>${note}</p>${values.length ? `<div class="live-cargo-supplies">${values.map(key => `<span>${supplyNames[key]} <b>${n(cargo.supplies[key])}</b></span>`).join('')}</div>` : ''}${cargo.parts.length ? `<div class="live-cargo-parts">${cargo.parts.map(part => `<article class="live-cargo-part" style="--rarity:${RARITY_COLORS[part.model.rarity]}"><span class="live-part-art">${moduleArt(part.model)}</span><div><strong>${e(part.model.label)}</strong><small>${MODULE_SLOT_LABELS[part.model.slot]} · ${RARITY_LABELS[part.model.rarity]}</small><b class="live-part-condition ${part.durability !== null && part.durability < 10 ? 'needs-repair' : ''}">${part.durability === null ? 'Состояние в отчёте не указано' : `${Math.floor(part.durability)}% · ${part.durability < 10 ? 'Нужен ремонт' : part.model.slot === 'receiver' ? 'Основа для сборки' : 'Исправная деталь'}`}</b><p>${e(compatibility(part.model))}</p>${part.instanceId ? `<small class="live-part-id">${e(part.instanceId)}${part.foundAt === null ? '' : ` · ${clock(part.foundAt)}`}</small>` : ''}</div></article>`).join('')}</div>` : `<small class="live-cargo-empty">${cargo.status === 'carried' ? 'Модули пока не подтверждены. Осмотр точки ещё не гарантирует находку.' : 'В этом грузе нет модулей.'}</small>`}${cargo.weaponIds.map(id => Object.hasOwn(WEAPON_BY_ID,id) ? `<p>Оружейный трофей: <b>${e(WEAPON_BY_ID[id]!.name)}</b></p>` : '').join('')}</div>`;
}
function renderObjective(raid: Raid, report: RaidReport | null, now: number) {
	if (report) return '';
	const goal = getRaidFieldObjective(raid, now, planFor(raid));
	return `<div class="live-objective"><span class="eyebrow">Текущая задача</span><strong data-live-goal>${e(goal.label)}</strong><p data-live-goal-detail>${e(goal.detail)}</p><div class="live-route-state"><span data-live-route>Осмотрено ${goal.visited.length} / ${goal.totalSearches} · Участок ${goal.segment} / ${goal.segments}</span><b data-live-action-time>${goal.remainingSeconds ? time(goal.remainingSeconds) : 'НА СВЯЗИ'}</b></div><span class="live-raid-progress"><i data-live-action-progress style="width:${Math.round(goal.progress*100)}%"></i></span></div>`;
}
function renderJourney(raid: Raid, report: RaidReport | null) {
	const events = report?.events ?? raid.expedition?.trail ?? [];
	if (!events.length) return '';
	return `<details class="live-journey"><summary>Ход выхода · ${events.length} ${events.length === 1 ? 'сводка' : 'сводок'}</summary>${events.map(event => `<article class="live-event ${event.kind === 'danger' ? 'danger' : ''}"><time>${clock(event.at)}</time><div><strong>${e(event.label)}</strong><p>${e(event.text)}</p></div></article>`).join('')}</details>`;
}
function renderVisits(raid: Raid, now: number) {
	const goal = getRaidFieldObjective(raid,now,planFor(raid));
	return `<details class="live-journey live-street-visits" data-live-visits ${goal.visited.length ? '' : 'hidden'}><summary data-live-visits-title>Осмотренные точки · ${goal.visited.length}</summary><div data-live-visits-list>${visitedPoints(raid,now)}</div></details>`;
}
function visitedPoints(raid: Raid, now: number) {
	return getRaidFieldObjective(raid,now,planFor(raid)).visited.map(spot => `<article><time>+${time((spot.at-raid.startedAt)/1000)}</time><div><strong>${e(spot.label)}</strong><p>Осмотр завершён. Добыча подтверждается на контрольной точке.</p></div></article>`).join('');
}
export function renderLiveRaidPanel(state: GameState, raid: Raid | null, candidate: RaidReport | null, decision = '') {
	if (!raid) return '<div class="live-raid-empty"><span class="eyebrow">За периметром</span><h2>Улица ждёт</h2><p>Подготовь бойца и начни выход, чтобы наблюдать его маршрут.</p><button class="button secondary" data-page="raids">Подготовить выход →</button></div>';
	const report = candidate?.raidId === raid.id ? candidate : null;
	const scav = state.scavs.find(item => item.id === raid.scavId), weapon = state.weapons.find(item => item.id === raid.weaponInstanceId);
	const now = Date.now(), frame = getRaidFieldFrame(raid, report ? raid.endsAt : now, planFor(raid)), stats = weapon ? getWeaponStats(weapon) : null;
	const phase = report ? report.success ? 'Выход завершён' : 'Связь с маршрутом потеряна' : frame.label;
	const mission = report ? 'Итог выхода' : raid.expedition?.status === 'choice' ? 'Нужен твой приказ' : `Этап ${raid.expedition?.stage ?? 1} · В пути`;
	const selector = `<div class="live-watch-picker"><label for="live-raid-select">Наблюдать</label><select id="live-raid-select" data-live-raid-select data-focus-key="live-raid-picker" aria-label="Наблюдаемый рейд">${!state.raids.some(item => item.id === raid.id) ? `<option value="${raid.id}">${e(raid.scavName)} · Выход завершён</option>` : ''}${state.raids.map(item => `<option value="${item.id}" ${item.id === raid.id ? 'selected' : ''}>${e(item.scavName)} · ${e(MAP_BY_ID[item.mapId]?.name ?? 'Сектор')}${item.expedition?.status === 'choice' ? ' · ПРИКАЗ' : ''}</option>`).join('')}</select></div>`;
	return `<header class="live-raid-head"><div><span class="eyebrow">${e(MAP_BY_ID[raid.mapId]?.name ?? 'Сектор')} · ${e(planFor(raid).theme.label)}</span><h2>${e(raid.scavName)}</h2></div><button class="icon-button" data-live-close aria-label="Вернуться в убежище">×</button></header>${selector}<div class="live-raid-status ${report ? report.success ? 'finished' : 'failed' : frame.action === 'skirmish' ? 'danger' : ''}" data-live-status><div><span class="live-signal"></span><strong data-live-phase>${e(phase)}</strong><b data-live-time>${report ? report.success ? 'ВЕРНУЛСЯ' : 'ЗАВЕРШЁН' : raid.expedition?.status === 'choice' ? 'ПРИКАЗ' : time((raid.endsAt-now)/1000)}</b></div><p data-live-detail>${e(report?.description ?? frame.detail)}</p><span class="live-raid-progress"><i data-live-progress style="width:${report ? 100 : Math.round(frame.progress*100)}%"></i></span><small data-live-mission>${mission}</small></div><div class="live-raid-scroll"><div class="live-kit"><span class="scav-avatar">${scavPortrait(scav?.personality ?? 'veteran', raid.scavName)}</span><div><strong>${e(weapon ? getWeaponDefinition(weapon).name : report?.lostWeapon ? 'Оружие потеряно' : 'Комплект бойца')}</strong><small><span data-live-health>${scav ? `Здоровье ${Math.floor(scav.health)} / 100` : report?.lostScav ? 'Боец потерян' : 'Выход закончен'}</span> · ${raid.tactic === 'cautious' ? 'Осторожно' : raid.tactic === 'bold' ? 'Напористо' : 'Сбалансированно'}</small><small class="live-kit-ready" data-live-ready>${stats ? stats.ready ? `Пушка исправна · ${Math.floor(weapon!.durability)}%` : e(stats.issues.join(' · ')) : ''}</small></div></div>${renderObjective(raid,report,now)}${!report && raid.expedition?.status === 'choice' ? `<div class="live-decision">${decision}<button class="button secondary" data-raid-orders="${raid.id}">Развернуть приказы →</button></div>` : !report ? `<button class="button ghost live-orders" data-raid-orders="${raid.id}">Комплект и приказы →</button>` : ''}${report ? `<div class="live-result ${report.success ? '' : 'failed'}"><span class="eyebrow">${report.success ? 'Доставлено на базу' : 'Под риском был весь груз'}</span><strong>${report.success ? `${n(report.money)} ₽` : 'Добыча потеряна'}</strong><p>${e(report.description)}</p><button class="text-button" data-page="journal">Открыть отчёт →</button></div>` : ''}<div data-live-cargo>${renderCargo(raid,report)}</div><div class="live-raid-events-head"><h3>Связь с улицей</h3><span>Текущий этап</span></div><div class="live-raid-feed" data-live-feed>${renderLiveRaidFeed(raid, report, now)}</div>${renderVisits(raid,report ? raid.endsAt : now)}${renderJourney(raid,report)}<div class="live-camera-note">Рука — осмотреть квартал. «За бойцом» — вернуться к отряду.</div></div>`;
}
function renderLiveRaidFeed(raid: Raid, report: RaidReport | null, now: number) {
	const events = getRaidFieldFrame(raid, report ? raid.endsAt : now, planFor(raid)).observedEvents.slice(-3).reverse();
	return events.map((event,index) => `<article class="live-event ${event.kind === 'danger' ? 'danger' : ''} ${index === 0 ? 'latest' : ''}"><time>${time((event.at-raid.startedAt)/1000)}</time><div><strong>${e(event.label)}</strong><p>${e(event.text)}</p></div></article>`).join('');
}
export function updateLiveRaidPanel(root: HTMLElement, raid: Raid, candidate: RaidReport | null, state?: GameState) {
	const report = candidate?.raidId === raid.id ? candidate : null, now = Date.now();
	const frame = getRaidFieldFrame(raid, report ? raid.endsAt : now, planFor(raid)), goal = getRaidFieldObjective(raid, now, planFor(raid));
	const set = (selector: string, text: string) => { const element = root.querySelector<HTMLElement>(selector); if(element && element.textContent !== text) element.textContent = text; };
	set('[data-live-phase]', report ? report.success ? 'Выход завершён' : 'Связь с маршрутом потеряна' : frame.label);
	set('[data-live-detail]', report?.description ?? frame.detail);
	set('[data-live-time]', report ? report.success ? 'ВЕРНУЛСЯ' : 'ЗАВЕРШЁН' : raid.expedition?.status === 'choice' ? 'ПРИКАЗ' : time((raid.endsAt-now)/1000));
	set('[data-live-mission]', report ? 'Итог выхода' : raid.expedition?.status === 'choice' ? 'Нужен твой приказ' : `Этап ${raid.expedition?.stage ?? 1} · В пути`);
	set('[data-live-goal]', goal.label); set('[data-live-goal-detail]', goal.detail);
	set('[data-live-route]', `Осмотрено ${goal.visited.length} / ${goal.totalSearches} · Участок ${goal.segment} / ${goal.segments}`);
	set('[data-live-action-time]', goal.remainingSeconds ? time(goal.remainingSeconds) : 'НА СВЯЗИ');
	if (state) {
		const scav = state.scavs.find(item => item.id === raid.scavId), weapon = state.weapons.find(item => item.id === raid.weaponInstanceId), stats = weapon ? getWeaponStats(weapon) : null;
		set('[data-live-health]', scav ? `Здоровье ${Math.floor(scav.health)} / 100` : report?.lostScav ? 'Боец потерян' : 'Выход закончен');
		set('[data-live-ready]', stats ? stats.ready ? `Пушка исправна · ${Math.floor(weapon!.durability)}%` : stats.issues.join(' · ') : '');
	}
	const track = root.querySelector<HTMLElement>('[data-live-progress]'); if(track) track.style.width = `${report ? 100 : Math.round(frame.progress*100)}%`;
	const actionTrack = root.querySelector<HTMLElement>('[data-live-action-progress]'); if(actionTrack) actionTrack.style.width = `${Math.round(goal.progress*100)}%`;
	root.querySelector('[data-live-status]')?.classList.toggle('danger', !report && frame.action === 'skirmish');
	const feed = root.querySelector<HTMLElement>('[data-live-feed]'), key = `${planFor(raid).id}:${frame.segmentIndex}:${report?.id ?? ''}`;
	if(feed && feed.dataset.frame !== key) { feed.innerHTML = renderLiveRaidFeed(raid,report,now); feed.dataset.frame = key; }
	const visits = root.querySelector<HTMLElement>('[data-live-visits]'), visitList = root.querySelector<HTMLElement>('[data-live-visits-list]');
	if(visits) visits.hidden = goal.visited.length === 0;
	set('[data-live-visits-title]', `Осмотренные точки · ${goal.visited.length}`);
	const visitsKey = `${planFor(raid).id}:${goal.visited.length}`;
	if(visitList && visitList.dataset.frame !== visitsKey) { visitList.innerHTML = visitedPoints(raid,report ? raid.endsAt : now); visitList.dataset.frame = visitsKey; }
	const cargo = root.querySelector<HTMLElement>('[data-live-cargo]'), cargoKey = JSON.stringify(getConfirmedRaidCargo(raid,report));
	if(cargo && cargo.dataset.cargo !== cargoKey) { cargo.innerHTML = renderCargo(raid,report); cargo.dataset.cargo = cargoKey; }
}
