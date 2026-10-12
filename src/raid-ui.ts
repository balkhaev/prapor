import { getCargoWeight, getWeaponDefinition, type GameState, type Raid, type RaidReport } from './game/engine';
import { MAP_BY_ID } from './game/data';
import { scavPortrait } from './art';
import { getRaidFieldFrame, getRaidFieldPlan, type RaidFieldPlan } from './raid-field';

const e = (text: unknown) => String(text).replace(/[&<>"']/g, value => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value]!));
const n = (value: number) => Math.floor(value).toLocaleString('ru-RU');
const time = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2,'0')}`;
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
export function renderLiveRaidPanel(state: GameState, raid: Raid | null, report: RaidReport | null, decision = '') {
	if (!raid) return '<div class="live-raid-empty"><span class="eyebrow">За периметром</span><h2>Улица ждёт</h2><p>Подготовь бойца и начни выход, чтобы наблюдать его маршрут.</p><button class="button secondary" data-page="raids">Подготовить выход →</button></div>';
	const scav = state.scavs.find(item => item.id === raid.scavId), weapon = state.weapons.find(item => item.id === raid.weaponInstanceId);
	const frame = getRaidFieldFrame(raid, Date.now(), planFor(raid));
	const phase = report ? report.success ? 'Выход завершён' : 'Связь с маршрутом потеряна' : frame.label;
	const mission = report ? 'Итог выхода' : raid.expedition?.status === 'choice' ? 'Нужен твой приказ' : `Этап ${raid.expedition?.stage ?? 1} · В пути`;
	const selector = `<div class="live-watch-picker"><label for="live-raid-select">Наблюдать</label><select id="live-raid-select" data-live-raid-select data-focus-key="live-raid-picker" aria-label="Наблюдаемый рейд">${!state.raids.some(item => item.id === raid.id) ? `<option value="${raid.id}">${e(raid.scavName)} · Выход завершён</option>` : ''}${state.raids.map(item => `<option value="${item.id}" ${item.id === raid.id ? 'selected' : ''}>${e(item.scavName)} · ${e(MAP_BY_ID[item.mapId]?.name ?? 'Сектор')}${item.expedition?.status === 'choice' ? ' · ПРИКАЗ' : ''}</option>`).join('')}</select></div>`;
	return `<header class="live-raid-head"><div><span class="eyebrow">${e(MAP_BY_ID[raid.mapId]?.name ?? 'Сектор')} · ${e(planFor(raid).theme.label)}</span><h2>${e(raid.scavName)}</h2></div><button class="icon-button" data-live-close aria-label="Вернуться в убежище">×</button></header>${selector}<div class="live-raid-status ${report ? report.success ? 'finished' : 'failed' : frame.action === 'skirmish' ? 'danger' : ''}" data-live-status><div><span class="live-signal"></span><strong data-live-phase>${e(phase)}</strong><b data-live-time>${report ? report.success ? 'ВЕРНУЛСЯ' : 'ЗАВЕРШЁН' : raid.expedition?.status === 'choice' ? 'ПРИКАЗ' : time((raid.endsAt-Date.now())/1000)}</b></div><p data-live-detail>${e(report?.description ?? frame.detail)}</p><span class="live-raid-progress"><i data-live-progress style="width:${report ? 100 : Math.round(frame.progress*100)}%"></i></span><small data-live-mission>${mission}</small></div><div class="live-raid-scroll"><div class="live-kit"><span class="scav-avatar">${scavPortrait(scav?.personality ?? 'veteran', raid.scavName)}</span><div><strong>${e(weapon ? getWeaponDefinition(weapon).name : report?.lostWeapon ? 'Оружие потеряно' : 'Комплект бойца')}</strong><small>${scav ? `Здоровье ${Math.floor(scav.health)} / 100` : report?.lostScav ? 'Боец потерян' : 'Выход закончен'} · ${raid.tactic === 'cautious' ? 'Осторожно' : raid.tactic === 'bold' ? 'Напористо' : 'Сбалансированно'}</small></div></div>${report ? `<div class="live-result ${report.success ? '' : 'failed'}"><span class="eyebrow">${report.success ? 'Доставлено на базу' : 'Под риском был весь груз'}</span><strong>${report.success ? `${n(report.money)} ₽` : 'Добыча потеряна'}</strong><p>${e(report.description)}</p><button class="text-button" data-page="journal">Открыть отчёт →</button></div>` : `<div class="live-cargo"><span class="eyebrow">В рюкзаке с пройденных точек</span><strong>${n(raid.expedition?.cargo.money ?? 0)} ₽ <small>${getCargoWeight(raid.expedition?.cargo ?? {money:0,supplies:{ammo:0,medicine:0,scrap:0,intel:0},weaponIds:[],modules:[]}).toFixed(1)} / ${(raid.expedition?.capacity ?? 10).toFixed(1)} ед.</small></strong><p>Груз попадёт на базу после эвакуации.</p></div>`}<div class="live-raid-events-head"><h3>Связь с улицей</h3><span>Сейчас</span></div><div class="live-raid-feed" data-live-feed>${renderLiveRaidFeed(raid, report)}</div>${!report && raid.expedition?.status === 'choice' ? `<div class="live-decision">${decision}<button class="button secondary" data-raid-orders="${raid.id}">Развернуть приказы →</button></div>` : !report ? `<button class="button ghost live-orders" data-raid-orders="${raid.id}">Комплект и приказы →</button>` : ''}<div class="live-camera-note">Рука — осмотреть квартал. «За бойцом» — вернуться к отряду.</div></div>`;
}
function renderLiveRaidFeed(raid: Raid, report: RaidReport | null) {
	const events = getRaidFieldFrame(raid, report ? raid.endsAt : Date.now(), planFor(raid)).observedEvents.slice(-3).reverse();
	return events.map((event,index) => `<article class="live-event ${event.kind === 'danger' ? 'danger' : ''} ${index === 0 ? 'latest' : ''}"><i>${event.kind === 'danger' ? '!' : '·'}</i><div><strong>${e(event.label)}</strong><p>${e(event.text)}</p></div></article>`).join('');
}
export function updateLiveRaidPanel(root: HTMLElement, raid: Raid, report: RaidReport | null) {
	const frame = getRaidFieldFrame(raid, Date.now(), planFor(raid));
	const set = (selector: string, text: string) => { const element = root.querySelector<HTMLElement>(selector); if(element && element.textContent !== text) element.textContent = text; };
	set('[data-live-phase]', report ? report.success ? 'Выход завершён' : 'Связь с маршрутом потеряна' : frame.label);
	set('[data-live-detail]', report?.description ?? frame.detail);
	set('[data-live-time]', report ? report.success ? 'ВЕРНУЛСЯ' : 'ЗАВЕРШЁН' : raid.expedition?.status === 'choice' ? 'ПРИКАЗ' : time((raid.endsAt-Date.now())/1000));
	set('[data-live-mission]', report ? 'Итог выхода' : raid.expedition?.status === 'choice' ? 'Нужен твой приказ' : `Этап ${raid.expedition?.stage ?? 1} · В пути`);
	const track = root.querySelector<HTMLElement>('[data-live-progress]'); if(track) track.style.width = `${report ? 100 : Math.round(frame.progress*100)}%`;
	root.querySelector('[data-live-status]')?.classList.toggle('danger', !report && frame.action === 'skirmish');
	const feed = root.querySelector<HTMLElement>('[data-live-feed]');
	const key = `${raid.expedition?.stage ?? 0}:${frame.segmentIndex}:${Boolean(report)}`;
	if(feed && feed.dataset.frame !== key) { feed.innerHTML = renderLiveRaidFeed(raid,report); feed.dataset.frame = key; }
}
