import { LIVE_LOOT_CAPACITY, LIVE_LOOT_WEIGHT, LIVE_TERRAIN_CODES, LIVE_PROP_KINDS, type EconomyLoot, type LiveCitySite, type LiveCommand, type LiveDrop, type LiveEntity, type LiveEvent, type LiveContainerKind, type LiveDistrict, type LiveDistrictId, type LiveMapSummary, type LivePlayer, type LivePurpose, type LiveSnapshot, type LiveStatus, type LiveWorld } from './game/live';
import { readEconomyLootItems } from './game/live-loot';
import { BODY_PARTS, parseHealth, parseMedicalInventory, type BodyPart, type TreatmentType } from './game/health';
import { getBoss, type BossId } from './game/bosses';
import { isLiveKitId, type LiveEntry, type LiveKitId, type LiveLoadout } from './game/live-entry';
import { MODULE_BY_ID, MODULE_SLOTS, type ModuleSlot } from './game/modules';
import { LIVE_WORLD_LIMITS as WORLD_LIMITS } from './game/live-world-limits';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const number = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => number(value, min, max) && Number.isInteger(value);
const districtId = (value: unknown): value is LiveDistrictId => ['customs', 'sawmill', 'depot', 'village'].includes(value as string);
const purpose = (value: unknown): value is LivePurpose => ['pvp', 'pve', 'loot', 'quests', 'boss'].includes(value as string);
const bossId = (value: unknown): value is BossId => typeof value === 'string' && getBoss(value) !== null;
const containerKind = (value: unknown): value is LiveContainerKind => ['duffel', 'jacket', 'toolbox', 'medbag', 'cabinet', 'crate'].includes(value as string);
const text = (value: unknown, max = 100): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const point = (value: unknown, world: Pick<LiveWorld, 'width' | 'height'>): value is Record<string, unknown> & { x: number; y: number } => record(value) && number(value.x, 0, world.width - 1) && number(value.y, 0, world.height - 1);
const invalid = (): never => { throw new LiveApiError(0, 'invalid_response'); };
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const terrainRow = new RegExp(`^[${Object.keys(LIVE_TERRAIN_CODES).join('')}]+$`);

function readLoot(value: unknown): EconomyLoot[] {
  try { return readEconomyLootItems(value, LIVE_LOOT_CAPACITY, LIVE_LOOT_WEIGHT); } catch { return invalid(); }
}

function readAutomation(value: unknown, world: LiveWorld): NonNullable<LivePlayer['automation']> {
  if (!record(value) || !keys(value, ['enabled', 'stage', 'goal', 'targetId', 'target', 'routeId', 'routeName', 'stopIndex', 'stopCount', 'reason', 'startedAt', 'completedAt'])
    || typeof value.enabled !== 'boolean' || !['route', 'combat', 'search', 'loot', 'treat', 'extract', 'paused', 'complete', 'downed'].includes(value.stage as string)
    || !text(value.goal, 200) || !(value.targetId === null || text(value.targetId))
    || !(value.target === null || point(value.target, world) && keys(value.target, ['x', 'y']) && integer(value.target.x) && integer(value.target.y))
    || !(value.routeId === null || text(value.routeId) && world.routes?.some(route => route.id === value.routeId))
    || !(value.routeName === null || text(value.routeName, 100)) || !integer(value.stopCount, 0, world.pois.length) || !integer(value.stopIndex, 0, value.stopCount)
    || !(value.reason === null || text(value.reason, 200)) || !integer(value.startedAt) || !integer(value.completedAt)
    || ['paused', 'complete', 'downed'].includes(value.stage as string) && value.enabled || value.stage === 'complete' && value.completedAt < value.startedAt) return invalid();
  return { enabled: value.enabled, stage: value.stage as NonNullable<LivePlayer['automation']>['stage'], goal: value.goal,
    targetId: value.targetId as string | null, target: value.target === null ? null : { x: value.target.x, y: value.target.y },
    routeId: value.routeId as string | null, routeName: value.routeName as string | null, stopIndex: value.stopIndex, stopCount: value.stopCount,
    reason: value.reason as string | null, startedAt: value.startedAt, completedAt: value.completedAt };
}

/** Vetted messages keep private diagnostics and arbitrary response HTML out of the UI. */
export class LiveApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(liveErrorMessage(status, code));
    this.name = 'LiveApiError';
  }
}

function liveErrorMessage(status: number, code: string): string {
  if (code === 'network' || code === 'timeout') return 'Связь с Периметром прервалась. Подключаемся снова; последний приказ автоматически не повторяется.';
  if (code === 'invalid_response') return 'Сервер прислал неполную сводку. Ожидаем новое состояние.';
  if (code === 'join_required') return 'Связь с сервером восстановлена. Подключаемся к Периметру снова.';
  if (code === 'sortie_complete') return 'Рейд завершён. Вернись в убежище и подготовь новый выход.';
  if (status === 401 || ['account_changed', 'identity_changed', 'live_identity_changed', 'game_identity_changed'].includes(code)) return 'Игровая сессия изменилась. Дождись подключения к текущему убежищу и войди на Периметр снова.';
  if (code === 'game_required' || code === 'economy_required' || code === 'not_ready') return 'Сначала подключись к серверному убежищу. Оно хранит твой лут и припасы.';
  if (code === 'game_stash_full' || code === 'delivery_pending') return 'Добыча уже вынесена и ждёт места на складе убежища. Освободи место: доставка продолжится автоматически.';
  if (code === 'delivery_pending_full') return 'Несколько грузов уже ждут места в убежище. Освободи склад перед следующей доставкой.';
  if (code === 'supply_pending') return 'Пополнение уже отправлено в убежище. Дождись подтверждения; второй расход не нужен.';
  if (code === 'already_supplied') return 'Патроны и аптечки уже пополнены.';
  if (code === 'launch_pending') return 'Комплект уже оплачен. Подтверждаем выдачу; второй расход не нужен.';
  if (code === 'insufficient_money') return 'Не хватает денег на выбранный комплект. Выбери лёгкий комплект или пополни запас в убежище.';
  if (code === 'fighter_alive') return 'Боец уже в мире. Продолжи рейд с сохранённой позиции.';
  if (code === 'no_fighter') return 'Сохранённого бойца нет. Подготовь новый выход.';
  if (code === 'resupply_out_of_range') return 'Для пополнения припасов доберись до зелёного выхода.';
  if (code === 'no_supplies' || code === 'supply_empty') return 'На складе убежища не хватает припасов. Купи их или изготовь, затем пополни комплект у выхода.';
  if (code === 'server_full' || code === 'full') return 'Периметр заполнен. Подожди свободного места и попробуй войти ещё раз.';
  if (['not_joined', 'not_online', 'player_missing'].includes(code)) return 'Ты уже вышел с Периметра. Подключись снова.';
  if (['too_far', 'out_of_range', 'loot_out_of_range', 'extract_out_of_range'].includes(code)) return 'Цель слишком далеко. Подойди ближе.';
  if (code === 'target_out_of_range') return 'Цель далеко или за укрытием. Подойди ближе и найди прямую линию огня.';
  if (code === 'travel_out_of_range') return 'Для перехода на другую карту доберись до зелёного выхода.';
  if (code === 'travel_in_combat' || code === 'combat_active' || code === 'in_combat') return 'Выход недоступен в бою. Укройся и подожди 8 секунд после последнего попадания.';
  if (code === 'travel_cooldown') return 'Переход ещё не готов. Подожди у выхода.';
  if (code === 'same_map' || code === 'already_on_map') return 'Ты уже на этой карте.';
  if (code === 'blocked' || code === 'invalid_move') return 'Этот путь перекрыт. Выбери свободную клетку.';
  if (['downed', 'dead', 'player_downed', 'respawn_not_ready'].includes(code)) return 'Боец ранен. Дождись возвращения на Периметр.';
  if (code === 'no_ammo') return 'Патроны закончились. Доберись до выхода для пополнения комплекта.';
  if (code === 'no_medkits') return 'Аптечек больше нет. На выходе можно пополнить комплект.';
  if (code === 'treatment_in_progress') return 'Лечение ещё идёт. Заверши его или отмени; движение и стрельба прервут лечение.';
  if (code === 'aim_in_progress') return 'Боец готовит прицельный выстрел. Движение отменяет прицеливание.';
  if (code.startsWith('medicine_')) return 'Средство закончилось или не подходит для этой зоны. Выбери нужное лечение по состоянию тела.';
  if (['target_missing', 'drop_missing', 'target_gone', 'target_unavailable', 'loot_unavailable'].includes(code)) return 'Цель уже исчезла. Сводка обновляется.';
  if (code === 'spawn_protection') return 'Эта цель пока под защитой после входа. Подожди несколько секунд.';
  if (code === 'cargo_full') return 'Груз заполнен. Доставь добычу к зелёному выходу.';
  if (code === 'search_required') return 'Сначала обыщи контейнер, чтобы увидеть содержимое.';
  if (code === 'search_in_progress' || code === 'already_searching') return 'Обыск уже идёт. Останься рядом и дождись результата.';
  if (code === 'search_not_ready') return 'Контейнер ещё обыскивается. Дождись результата.';
  if (code === 'no_cargo') return 'Груза пока нет. Собери добычу перед эвакуацией.';
  if (code === 'already_alive') return 'Боец уже на Периметре.';
  if (code === 'already_healthy') return 'Здоровье уже восстановлено.';
  if (status === 429 || ['cooldown', 'action_cooldown', 'rate_limited'].includes(code)) return 'Следующий приказ ещё не готов. Подожди немного.';
  if (status >= 500) return 'Периметр временно недоступен. Подключение восстановится автоматически.';
  return 'Приказ не выполнен. Проверь обстановку и попробуй ещё раз.';
}

/** Presence can be restored after a restart; game commands and changed identities cannot be retried. */
export function shouldRejoinLivePresence(error: unknown, requestAccount: string | null, currentAccount: string | null, requestGame?: string | null, currentGame?: string | null): boolean {
  return error instanceof LiveApiError && error.status === 401 && error.code === 'join_required' && requestAccount === currentAccount && requestGame === currentGame;
}

const rectangle = (value: unknown, bounds: Pick<LiveWorld, 'width' | 'height'>): value is Record<string, unknown> & { x: number; y: number; width: number; height: number } =>
  point(value, bounds) && integer(value.x) && integer(value.y) && integer(value.width, 1, bounds.width) && integer(value.height, 1, bounds.height) && value.x + value.width <= bounds.width && value.y + value.height <= bounds.height;

function readCity(value: unknown, bounds: Pick<LiveWorld, 'width' | 'height'>) {
  if (!rectangle(value, bounds) || !keys(value, ['name', 'x', 'y', 'width', 'height', 'quarters']) || !text(value.name, 80) || !Array.isArray(value.quarters) || value.quarters.length < 4 || value.quarters.length > WORLD_LIMITS.cityQuarters) return invalid();
  const quarters = value.quarters.map(quarter => {
    if (!rectangle(quarter, bounds) || !keys(quarter, ['id', 'name', 'x', 'y', 'width', 'height']) || !text(quarter.id, 64) || !text(quarter.name, 80) || quarter.x < value.x || quarter.y < value.y || quarter.x + quarter.width > value.x + value.width || quarter.y + quarter.height > value.y + value.height) return invalid();
    return { id: quarter.id, name: quarter.name, x: quarter.x, y: quarter.y, width: quarter.width, height: quarter.height };
  });
  if (new Set(quarters.map(quarter => quarter.id)).size !== quarters.length) return invalid();
  if (quarters.reduce((area, quarter) => area + quarter.width * quarter.height, 0) !== value.width * value.height
    || quarters.some((a, index) => quarters.slice(index + 1).some(b => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y))) return invalid();
  return { name: value.name, x: value.x, y: value.y, width: value.width, height: value.height, quarters };
}

function readCitySites(value: unknown, city: LiveWorld['city'], pois: LiveWorld['pois'], bounds: Pick<LiveWorld, 'width' | 'height'>): LiveCitySite[] | undefined {
  if (value === undefined) return undefined;
  if (!city || !Array.isArray(value) || value.length > WORLD_LIMITS.citySites) return invalid();
  const poiById = new Map(pois.map(poi => [poi.id, poi]));
  let buildingCount = 0;
  type Rect = { x: number; y: number; width: number; height: number };
  const within = (child: Rect, parent: Rect) => child.x >= parent.x && child.y >= parent.y && child.x + child.width <= parent.x + parent.width && child.y + child.height <= parent.y + parent.height;
  const inside = (location: { x: number; y: number }, area: Rect) => location.x >= area.x && location.y >= area.y && location.x < area.x + area.width && location.y < area.y + area.height;
  const rect = (area: Rect): Rect => ({ x: area.x, y: area.y, width: area.width, height: area.height });
  const locations = (points: unknown[], area: Rect) => points.map(location => point(location, bounds) && keys(location, ['x', 'y']) && integer(location.x) && integer(location.y) && inside(location, area) ? { x: location.x, y: location.y } : invalid());
  const parsed = value.map((site): LiveCitySite => {
    if (!rectangle(site, bounds) || !keys(site, ['id', 'poiId', 'quarterId', 'name', 'kind', 'x', 'y', 'width', 'height', 'courtyard', 'buildings', 'passages'])
      || !text(site.id, 64) || !text(site.poiId, 100) || !text(site.quarterId, 64) || !text(site.name, 80) || !['courtyard', 'arcade', 'workyard', 'service-yard'].includes(site.kind as string)
      || !rectangle(site.courtyard, bounds) || !keys(site.courtyard, ['x', 'y', 'width', 'height']) || !within(site.courtyard, site)
      || !Array.isArray(site.buildings) || site.buildings.length < 1 || site.buildings.length > 12 || !Array.isArray(site.passages) || site.passages.length < 2 || site.passages.length > 4) return invalid();
    buildingCount += site.buildings.length;
    if (buildingCount > WORLD_LIMITS.buildings) return invalid();
    const quarter = city.quarters.find(quarter => quarter.id === site.quarterId), poi = poiById.get(site.poiId);
    if (!quarter || !within(site, quarter) || !poi || !poi.tags.includes('city') || poi.x !== site.x || poi.y !== site.y || poi.width !== site.width || poi.height !== site.height) return invalid();
    const buildings = site.buildings.map(building => {
      if (!rectangle(building, bounds) || !keys(building, ['id', 'name', 'kind', 'x', 'y', 'width', 'height', 'entrances', 'floors', 'roof', 'roofAxis', 'facade']) || !within(building, site)
        || !text(building.id, 100) || !text(building.name, 80) || !['apartment', 'shop', 'workshop', 'garage', 'service'].includes(building.kind as string)
        || !(building.floors === undefined || integer(building.floors, 1, 4)) || !(building.roof === undefined || ['gable', 'flat', 'sawtooth'].includes(building.roof as string)) || !(building.roofAxis === undefined || ['x', 'y'].includes(building.roofAxis as string)) || !(building.facade === undefined || ['brick', 'plaster', 'panel', 'metal'].includes(building.facade as string))
        || !Array.isArray(building.entrances) || building.entrances.length < 2 || building.entrances.length > 8) return invalid();
      const entrances = locations(building.entrances, building);
      if (new Set(entrances.map(port => `${port.x}:${port.y}`)).size !== entrances.length) return invalid();
      return { ...rect(building), id: building.id, name: building.name, kind: building.kind as LiveCitySite['buildings'][number]['kind'], entrances, ...(building.floors === undefined ? {} : { floors: building.floors as 1 | 2 | 3 | 4 }), ...(building.roof === undefined ? {} : { roof: building.roof as 'gable' | 'flat' | 'sawtooth' }), ...(building.roofAxis === undefined ? {} : { roofAxis: building.roofAxis as 'x' | 'y' }), ...(building.facade === undefined ? {} : { facade: building.facade as 'brick' | 'plaster' | 'panel' | 'metal' }) };
    });
    const passages = site.passages.map(passage => {
      if (!Array.isArray(passage) || passage.length < 2 || passage.length > 64) return invalid();
      const points = locations(passage, site);
      if (points.slice(1).some((point, index) => point.x !== points[index]!.x && point.y !== points[index]!.y)) return invalid();
      return points;
    });
    return { ...rect(site), id: site.id, poiId: site.poiId, quarterId: site.quarterId, name: site.name, kind: site.kind as LiveCitySite['kind'], courtyard: rect(site.courtyard), buildings, passages };
  });
  const buildingIds = parsed.flatMap(site => site.buildings.map(building => building.id));
  if (new Set(parsed.map(site => site.id)).size !== parsed.length || new Set(parsed.map(site => site.poiId)).size !== parsed.length || new Set(buildingIds).size !== buildingIds.length) return invalid();
  return parsed;
}

function readDistrict(value: unknown, bounds: Pick<LiveWorld, 'width' | 'height'>): LiveDistrict {
  if (!rectangle(value, bounds) || !districtId(value.id) || !text(value.name, 80) || !text(value.description, 500) || !['industrial', 'forest', 'urban'].includes(value.theme as string) || !Array.isArray(value.spawns) || !value.spawns.length || value.spawns.length > 16) return invalid();
  const spawns = value.spawns.map(spawn => {
    if (!point(spawn, bounds) || !integer(spawn.x) || !integer(spawn.y) || spawn.x < value.x || spawn.y < value.y || spawn.x >= value.x + value.width || spawn.y >= value.y + value.height) return invalid();
    return { x: spawn.x, y: spawn.y };
  });
  const labelPoint = value.labelPoint === undefined ? undefined : point(value.labelPoint, bounds) && keys(value.labelPoint, ['x', 'y']) ? { x: value.labelPoint.x, y: value.labelPoint.y } : invalid();
  return { id: value.id, name: value.name, description: value.description, theme: value.theme as LiveDistrict['theme'], x: value.x, y: value.y, width: value.width, height: value.height, spawns, ...(labelPoint ? { labelPoint } : {}) };
}

function readRouteBase(value: unknown) {
  if (!record(value) || !text(value.id, 64) || !text(value.name, 80) || !text(value.description, 240) || !districtId(value.districtId) || !purpose(value.purpose)) return invalid();
  return { id: value.id, name: value.name, description: value.description, districtId: value.districtId, purpose: value.purpose };
}
function uniqueRoutes(routes: Array<{ id: string; districtId: LiveDistrictId; purpose: LivePurpose }>): void {
  if (new Set(routes.map(route => route.id)).size !== routes.length || new Set(routes.map(route => `${route.districtId}:${route.purpose}`)).size !== routes.length) return invalid();
}

export function readLiveStatus(value: unknown): LiveStatus {
  if (!record(value) || !text(value.id) || !text(value.name, 80) || !integer(value.online, 0, 256) || !integer(value.capacity, 1, 256) || value.online > value.capacity || !number(value.startedAt) || !Array.isArray(value.maps) || value.maps.length !== 1 || !Array.isArray(value.districts) || value.districts.length !== 4) return invalid();
  const capacity = value.capacity;
  const maps: LiveMapSummary[] = value.maps.map(map => {
    if (!record(map) || map.id !== 'perimeter' || !text(map.name, 80) || !text(map.description, 500) || !['industrial', 'forest', 'urban', 'mixed'].includes(map.theme as string) || !integer(map.width, 2, WORLD_LIMITS.side) || !integer(map.height, 2, WORLD_LIMITS.side) || !integer(map.online, 0, capacity) || !integer(map.npcs, 0, WORLD_LIMITS.npcs)) return invalid();
    return { id: map.id, name: map.name, description: map.description, theme: map.theme as LiveMapSummary['theme'], width: map.width, height: map.height, online: map.online, npcs: map.npcs, ...(map.city === undefined ? {} : { city: readCity(map.city, map as { width: number; height: number }) }) };
  });
  if (maps[0]!.online !== value.online) return invalid();
  const districts = value.districts.map(district => {
    const parsed = readDistrict(district, maps[0]!);
    if (!record(district) || !integer(district.online, 0, capacity) || !integer(district.npcs, 0, WORLD_LIMITS.npcs)) return invalid();
    return { ...parsed, online: district.online, npcs: district.npcs };
  });
  if (new Set(districts.map(district => district.id)).size !== 4 || districts.reduce((total, district) => total + district.online, 0) !== value.online) return invalid();
  const routes: LiveStatus['routes'] = value.routes === undefined ? undefined : (() => {
    if (!Array.isArray(value.routes) || value.routes.length > 16) return invalid();
    const parsed = value.routes.map(route => {
      const base = readRouteBase(route);
      if (!record(route) || !keys(route, ['id', 'name', 'description', 'districtId', 'purpose', 'stops']) || !Array.isArray(route.stops) || route.stops.length < 2 || route.stops.length > 5 || !route.stops.every(stop => text(stop, 120)) || new Set(route.stops).size !== route.stops.length) return invalid();
      return { ...base, stops: [...route.stops] as string[] };
    });
    uniqueRoutes(parsed); return parsed;
  })();
  const bosses: LiveStatus['bosses'] = value.bosses === undefined ? undefined : (() => {
    if (!Array.isArray(value.bosses) || value.bosses.length !== 4) return invalid();
    const parsed = value.bosses.map(boss => {
      if (!record(boss) || !keys(boss, ['bossId', 'name', 'districtId', 'poiId', 'area', 'state', 'respawnAt']) || !bossId(boss.bossId)
        || boss.name !== getBoss(boss.bossId)!.name || boss.districtId !== getBoss(boss.bossId)!.districtId || !text(boss.poiId) || !rectangle(boss.area, maps[0]!)
        || !['alive', 'defeated'].includes(boss.state as string) || !integer(boss.respawnAt) || boss.state === 'alive' && boss.respawnAt !== 0) return invalid();
      const area = boss.area as Record<string, number>;
      return { bossId: boss.bossId, name: boss.name as string, districtId: boss.districtId as LiveDistrictId, poiId: boss.poiId,
        area: { x: area.x!, y: area.y!, width: area.width!, height: area.height! }, state: boss.state as 'alive' | 'defeated', respawnAt: boss.respawnAt };
    });
    if (new Set(parsed.map(boss => boss.bossId)).size !== 4) return invalid();
    return parsed;
  })();
  return { id: value.id, name: value.name, online: value.online, capacity: value.capacity, startedAt: value.startedAt, maps, districts, ...(routes ? { routes } : {}), ...(bosses ? { bosses } : {}) };
}

const loadoutKeys = ['kitId', 'label', 'weaponId', 'weaponName', 'damage', 'range', 'attackMs', 'armorProtection', 'helmetProtection', 'maxAmmo'] as const;
function readVisualLoadout(value: unknown): NonNullable<LiveEntity['visualLoadout']> {
  if (!record(value) || !keys(value, ['profile', 'weaponId', 'modules', 'helmet', 'armor', 'backpack']) || !['light', 'assault', 'scout'].includes(value.profile as string)
    || !(value.weaponId === undefined || text(value.weaponId, 64)) || !['helmet', 'armor', 'backpack'].every(key => typeof value[key] === 'boolean')) return invalid();
  const modules: Partial<Record<ModuleSlot, string>> = {};
  if (value.modules !== undefined) {
    if (!record(value.modules) || !keys(value.modules, MODULE_SLOTS) || !text(value.weaponId, 64)) return invalid();
    for (const slot of MODULE_SLOTS) {
      const modelId = value.modules[slot];
      if (modelId === undefined) continue;
      if (!text(modelId, 160) || !Object.hasOwn(MODULE_BY_ID, modelId) || MODULE_BY_ID[modelId]!.slot !== slot) return invalid();
      modules[slot] = modelId;
    }
  }
  return { profile: value.profile as NonNullable<LiveEntity['visualLoadout']>['profile'],
    ...(value.modules === undefined ? {} : { modules }),
    ...(value.weaponId === undefined ? {} : { weaponId: value.weaponId as string }), helmet: value.helmet as boolean, armor: value.armor as boolean, backpack: value.backpack as boolean };
}
function readLiveLoadout(value: unknown, extraKeys: readonly string[] = []): LiveLoadout {
  if (!record(value) || !keys(value, [...loadoutKeys, ...extraKeys]) || !isLiveKitId(value.kitId) || !text(value.label, 80) || !text(value.weaponId, 64) || !text(value.weaponName, 80)
    || !number(value.damage, 1, 100) || !integer(value.range, 1, 32) || !integer(value.attackMs, 100, 30_000) || !number(value.armorProtection, 0, 1) || !number(value.helmetProtection, 0, 1) || !integer(value.maxAmmo, 1, 256)) return invalid();
  return { kitId: value.kitId, label: value.label, weaponId: value.weaponId, weaponName: value.weaponName, damage: value.damage, range: value.range, attackMs: value.attackMs, armorProtection: value.armorProtection, helmetProtection: value.helmetProtection, maxAmmo: value.maxAmmo };
}

/** Only the authenticated player's saved body and priced field-kit quotes enter preparation. */
export function readLiveEntry(value: unknown): LiveEntry {
  if (!record(value) || !keys(value, ['server', 'now', 'mode', 'fighter', 'stock', 'kits']) || !integer(value.now) || !['new', 'continue', 'downed'].includes(value.mode as string) || !Array.isArray(value.kits) || value.kits.length > 3) return invalid();
  const server = readLiveStatus(value.server), bounds = server.maps[0]!;
  const stock = value.stock === null ? null : (() => {
    const raw = value.stock;
    if (!record(raw) || !keys(raw, ['money', 'ammo', 'medicine']) || !['money', 'ammo', 'medicine'].every(key => integer(raw[key]))) return invalid();
    return { money: raw.money as number, ammo: raw.ammo as number, medicine: raw.medicine as number };
  })();
  const kits = value.kits.map(raw => {
    const kit = readLiveLoadout(raw, ['ammo', 'medkits', 'cost', 'reason']);
    if (!record(raw) || !integer(raw.ammo, 0, kit.maxAmmo) || !integer(raw.medkits, 0, 2) || !record(raw.cost) || !keys(raw.cost, ['money', 'ammo', 'medicine']) || !integer(raw.cost.money) || !integer(raw.cost.ammo) || !integer(raw.cost.medicine)
      || raw.cost.ammo !== raw.ammo || raw.cost.medicine !== raw.medkits || !(raw.reason === null || text(raw.reason, 300))) return invalid();
    return { ...kit, ammo: raw.ammo, medkits: raw.medkits, cost: { money: raw.cost.money as number, ammo: raw.cost.ammo as number, medicine: raw.cost.medicine as number }, reason: raw.reason as string | null };
  });
  if (new Set(kits.map(kit => kit.kitId)).size !== kits.length) return invalid();
  const fighter = value.fighter === null ? null : (() => {
    const raw = value.fighter;
    if (!point(raw, bounds) || !keys(raw, ['id', 'name', 'x', 'y', 'health', 'body', 'medicine', 'ammo', 'districtId', 'purpose', 'cargo', 'lootCount', 'respawnAt', 'online', 'launchPending', 'loadout']) || !text(raw.id) || !text(raw.name, 80)
      || !integer(raw.x) || !integer(raw.y) || !number(raw.health, 0, 100) || !integer(raw.ammo) || !integer(raw.cargo) || !integer(raw.lootCount, 0, LIVE_LOOT_CAPACITY) || !integer(raw.respawnAt) || !districtId(raw.districtId) || !purpose(raw.purpose) || typeof raw.online !== 'boolean' || !(raw.launchPending === undefined || typeof raw.launchPending === 'boolean')) return invalid();
    let body: LivePlayer['body'], medicine: LivePlayer['medicine'];
    try { body = parseHealth(raw.body); medicine = parseMedicalInventory(raw.medicine); } catch { return invalid(); }
    return { id: raw.id, name: raw.name, x: raw.x, y: raw.y, health: raw.health, body, medicine, ammo: raw.ammo, districtId: raw.districtId, purpose: raw.purpose, cargo: raw.cargo, lootCount: raw.lootCount, respawnAt: raw.respawnAt, online: raw.online,
      ...(raw.loadout === undefined ? {} : { loadout: readLiveLoadout(raw.loadout) }), ...(raw.launchPending === undefined ? {} : { launchPending: raw.launchPending }) };
  })();
  if (value.mode === 'new' ? fighter !== null : fighter === null || (value.mode === 'continue' ? fighter.health <= 0 : fighter.health > 0)) return invalid();
  return { server, now: value.now, mode: value.mode as LiveEntry['mode'], fighter, stock, kits };
}

/** Only immutable, versioned geometry may be reused between server responses. */
function readWorldProps(source: unknown, bounds: Pick<LiveWorld, 'width' | 'height'>): LiveWorld['props'] {
  if (source === undefined) return undefined;
  if (!Array.isArray(source) || source.length > WORLD_LIMITS.props) return invalid();
  const props = source.map(prop => {
    if (!record(prop) || !keys(prop, ['id', 'kind', 'x', 'y', 'width', 'height', 'orientation', 'variant', 'blocking'])
      || !text(prop.id, 100) || !LIVE_PROP_KINDS.includes(prop.kind as typeof LIVE_PROP_KINDS[number]) || !point(prop, bounds)
      || !number(prop.width, .15, 10) || !number(prop.height, .15, 10) || prop.x + prop.width > bounds.width || prop.y + prop.height > bounds.height
      || !['x', 'y'].includes(prop.orientation as string) || !integer(prop.variant, 0, 3) || typeof prop.blocking !== 'boolean'
      || prop.blocking && ![prop.x, prop.y, prop.width, prop.height].every(Number.isInteger)) return invalid();
    return { id: prop.id, kind: prop.kind as typeof LIVE_PROP_KINDS[number], x: prop.x, y: prop.y, width: prop.width, height: prop.height,
      orientation: prop.orientation as 'x' | 'y', variant: prop.variant, blocking: prop.blocking };
  });
  if (new Set(props.map(prop => prop.id)).size !== props.length) return invalid();
  return props;
}

export function readLiveWorld(source: unknown): LiveWorld {
  if (!record(source) || source.id !== 'perimeter' || !text(source.name, 80) || !text(source.description, 500) || !['industrial', 'forest', 'urban', 'mixed'].includes(source.theme as string) || !integer(source.width, 2, WORLD_LIMITS.side) || !integer(source.height, 2, WORLD_LIMITS.side) || !text(source.version, 128) || !text(source.seed, 128) || !integer(source.generatorVersion, 1, 1_000_000) || !integer(source.chunkSize, 1, 128) || !Array.isArray(source.obstacles) || source.obstacles.length > WORLD_LIMITS.obstacles || !Array.isArray(source.extracts) || !source.extracts.length || source.extracts.length > 64 || !Array.isArray(source.zones) || source.zones.length > WORLD_LIMITS.zones || !Array.isArray(source.districts) || source.districts.length !== 4 || !Array.isArray(source.pois) || source.pois.length > WORLD_LIMITS.pois || !Array.isArray(source.containers) || source.containers.length > WORLD_LIMITS.containers) return invalid();
  const bounds = { width: source.width, height: source.height };
  const city = source.city === undefined ? undefined : readCity(source.city, bounds);
  const terrainRows = source.terrainRows === undefined ? undefined : (() => {
    if (!Array.isArray(source.terrainRows) || source.terrainRows.length !== bounds.height || !source.terrainRows.every(row => typeof row === 'string' && row.length === bounds.width && terrainRow.test(row))) return invalid();
    return [...source.terrainRows] as string[];
  })();
  const paths: LiveWorld['paths'] = source.paths === undefined ? undefined : (() => {
    if (!Array.isArray(source.paths) || source.paths.length > WORLD_LIMITS.paths) return invalid();
    const parsed = source.paths.map(path => {
      if (!record(path) || !text(path.id) || !text(path.name, 80) || !['road', 'trail', 'rail', 'river'].includes(path.kind as string) || !number(path.width, .1, Math.max(bounds.width, bounds.height)) || !Array.isArray(path.points) || path.points.length < 2 || path.points.length > 256) return invalid();
      return { id: path.id, name: path.name, kind: path.kind as NonNullable<LiveWorld['paths']>[number]['kind'], width: path.width, points: path.points.map(location => point(location, bounds) ? { x: location.x, y: location.y } : invalid()) };
    });
    if (new Set(parsed.map(path => path.id)).size !== parsed.length) return invalid();
    return parsed;
  })();
  const districts = source.districts.map(district => readDistrict(district, bounds));
  if (new Set(districts.map(district => district.id)).size !== 4) return invalid();
  const pois: LiveWorld['pois'] = source.pois.map(poi => {
    if (!rectangle(poi, bounds) || !text(poi.id) || !text(poi.templateId) || !text(poi.name, 80) || !districtId(poi.districtId) || !integer(poi.danger, 1, 3) || !Array.isArray(poi.tags) || poi.tags.length > 16 || !poi.tags.every(tag => text(tag, 40)) || !Array.isArray(poi.entrances) || !poi.entrances.length || poi.entrances.length > 16) return invalid();
    const entrances = poi.entrances.map(entrance => point(entrance, bounds) && integer(entrance.x) && integer(entrance.y) ? { x: entrance.x, y: entrance.y } : invalid());
    return { x: poi.x, y: poi.y, width: poi.width, height: poi.height, id: poi.id, templateId: poi.templateId, name: poi.name, districtId: poi.districtId, danger: poi.danger as 1 | 2 | 3, tags: [...poi.tags] as string[], entrances };
  });
  if (new Set(pois.map(poi => poi.id)).size !== pois.length) return invalid();
  const poiIds = new Set(pois.map(poi => poi.id));
  const citySites = readCitySites(source.citySites, city, pois, bounds);
  const routes: LiveWorld['routes'] = source.routes === undefined ? undefined : (() => {
    if (!Array.isArray(source.routes) || source.routes.length > 16) return invalid();
    const parsed = source.routes.map(route => {
      const base = readRouteBase(route);
      if (!record(route) || !keys(route, ['id', 'name', 'description', 'districtId', 'purpose', 'poiIds']) || !Array.isArray(route.poiIds) || route.poiIds.length < 2 || route.poiIds.length > 5 || !route.poiIds.every(id => text(id) && poiIds.has(id)) || new Set(route.poiIds).size !== route.poiIds.length) return invalid();
      return { ...base, poiIds: [...route.poiIds] as string[] };
    });
    uniqueRoutes(parsed); return parsed;
  })();
  const containers: LiveWorld['containers'] = source.containers.map(container => {
    if (!point(container, bounds) || !integer(container.x) || !integer(container.y) || !text(container.id) || !text(container.poiId) || !poiIds.has(container.poiId) || !containerKind(container.kind) || !['mixed', 'tools', 'medical', 'intel', 'valuables', 'provisions'].includes(container.lootTable as string) || !integer(container.searchMs, 1, 60_000)) return invalid();
    return { x: container.x, y: container.y, id: container.id, poiId: container.poiId, kind: container.kind, lootTable: container.lootTable as LiveWorld['containers'][number]['lootTable'], searchMs: container.searchMs };
  });
  if (new Set(containers.map(container => container.id)).size !== containers.length) return invalid();
  const props = readWorldProps(source.props, bounds);
  const decoded: LiveWorld = { ...bounds, id: source.id, name: source.name, description: source.description, theme: source.theme as LiveWorld['theme'], version: source.version, seed: source.seed, generatorVersion: source.generatorVersion, chunkSize: source.chunkSize, districts, pois, containers, ...(props ? { props } : {}), ...(city ? { city } : {}), ...(citySites ? { citySites } : {}), ...(terrainRows ? { terrainRows } : {}), ...(paths ? { paths } : {}), ...(routes ? { routes } : {}), obstacles: source.obstacles.map(obstacle => {
    if (!rectangle(obstacle, bounds) || !(obstacle.kind === undefined || ['building', 'wall', 'container', 'barricade', 'tree', 'water'].includes(obstacle.kind as string)) || !(obstacle.label === undefined || text(obstacle.label, 80)) || !(obstacle.propId === undefined || text(obstacle.propId, 100))) return invalid();
    return { x: obstacle.x, y: obstacle.y, width: obstacle.width, height: obstacle.height, ...(obstacle.kind ? { kind: obstacle.kind as LiveWorld['obstacles'][number]['kind'] } : {}), ...(obstacle.label ? { label: obstacle.label as string } : {}), ...(obstacle.propId ? { propId: obstacle.propId as string } : {}) };
  }), extracts: source.extracts.map(extract => point(extract, bounds) && integer(extract.x) && integer(extract.y) ? { x: extract.x, y: extract.y } : invalid()), zones: source.zones.map(zone => {
    if (!rectangle(zone, bounds) || !text(zone.name, 80) || !Object.values(LIVE_TERRAIN_CODES).includes(zone.terrain as LiveWorld['zones'][number]['terrain']) || !integer(zone.danger, 1, 3)) return invalid();
    return { x: zone.x, y: zone.y, width: zone.width, height: zone.height, name: zone.name, terrain: zone.terrain as LiveWorld['zones'][number]['terrain'], danger: zone.danger as 1 | 2 | 3 };
  }) };
  const linkedObstacles = decoded.obstacles.filter(obstacle => obstacle.propId);
  const byProp = new Map(linkedObstacles.map(obstacle => [obstacle.propId!, obstacle]));
  const propsById = new Map(props?.map(prop => [prop.id, prop]));
  if (byProp.size !== linkedObstacles.length || linkedObstacles.some(obstacle => !propsById.get(obstacle.propId!)?.blocking)
    || props?.some(prop => {
      if (!prop.blocking) return false;
      const obstacle = byProp.get(prop.id);
      return !obstacle || prop.x !== obstacle.x || prop.y !== obstacle.y || prop.width !== obstacle.width || prop.height !== obstacle.height;
    })) return invalid();
  return decoded;
}

export function readLiveSnapshot(value: unknown, cachedWorld?: LiveWorld): LiveSnapshot {
  if (!record(value) || !keys(value, ['server', 'now', 'selfId', 'world', 'self', 'entities', 'drops', 'events', 'worldVersion', 'visibleChunks']) || !number(value.now) || !text(value.selfId) || !text(value.worldVersion, 128) || !record(value.self)) return invalid();
  const world = value.world === undefined ? cachedWorld : readLiveWorld(value.world);
  if (!world || world.version !== value.worldVersion) return invalid();
  const bounds = { width: world.width, height: world.height };
  const self = value.self;
  if (!keys(self, ['id', 'ammo', 'medkits', 'cargo', 'stash', 'kills', 'bossKills', 'respawnAt', 'travelReadyAt', 'patrol', 'targetId', 'districtId', 'purpose', 'searching', 'body', 'medicine', 'treatment', 'leaveAt', 'gameId', 'lootItems', 'pendingDelivery', 'economyMessage', 'loadout', 'launchPending', 'automation']) || self.id !== value.selfId || !['ammo', 'medkits', 'cargo', 'stash', 'kills', 'respawnAt', 'travelReadyAt', 'leaveAt'].every(key => integer(self[key])) || typeof self.patrol !== 'boolean' || !(self.targetId === null || text(self.targetId)) || !districtId(self.districtId) || !purpose(self.purpose) || !(self.searching === null || record(self.searching) && keys(self.searching, ['id', 'readyAt']) && text(self.searching.id) && integer(self.searching.readyAt)) || !(self.gameId === undefined || uuid(self.gameId)) || !(self.economyMessage === undefined || typeof self.economyMessage === 'string' && self.economyMessage.length <= 2000) || !(self.bossKills === undefined || integer(self.bossKills, 0, self.kills as number))) return invalid();
  let body: LivePlayer['body'], medicine: LivePlayer['medicine'];
  try { body = parseHealth(self.body); medicine = parseMedicalInventory(self.medicine); } catch { return invalid(); }
  const treatment = self.treatment;
  if (treatment !== null && (!record(treatment) || !keys(treatment, ['type', 'part', 'startedAt', 'endsAt']) || !['medkit', 'bandage', 'tourniquet', 'splint', 'painkiller', 'surgery'].includes(treatment.type as string) || !BODY_PARTS.includes(treatment.part as BodyPart) || !number(treatment.startedAt) || !number(treatment.endsAt) || treatment.endsAt < treatment.startedAt)) return invalid();
  const pendingDelivery = self.pendingDelivery === undefined ? undefined : (() => {
    if (!Array.isArray(self.pendingDelivery) || self.pendingDelivery.length > 32) return invalid();
    return self.pendingDelivery.map(parcel => {
      if (!record(parcel) || !keys(parcel, ['items', 'money', 'message']) || !integer(parcel.money) || !text(parcel.message, 2000)) return invalid();
      return { items: readLoot(parcel.items), money: parcel.money, message: parcel.message };
    });
  })();
  const player: LivePlayer = { id: value.selfId, ammo: self.ammo as number, medkits: self.medkits as number, cargo: self.cargo as number, stash: self.stash as number, kills: self.kills as number, respawnAt: self.respawnAt as number, patrol: self.patrol, targetId: self.targetId as string | null, travelReadyAt: self.travelReadyAt as number, districtId: self.districtId, purpose: self.purpose, searching: self.searching === null ? null : { id: (self.searching as { id: string }).id, readyAt: (self.searching as { readyAt: number }).readyAt }, body, medicine, treatment: treatment === null ? null : { type: treatment.type as TreatmentType, part: treatment.part as BodyPart, startedAt: treatment.startedAt as number, endsAt: treatment.endsAt as number }, leaveAt: self.leaveAt as number };
  if (self.gameId !== undefined) player.gameId = self.gameId as string;
  if (self.lootItems !== undefined) player.lootItems = readLoot(self.lootItems);
  if (pendingDelivery !== undefined) player.pendingDelivery = pendingDelivery;
  if (self.economyMessage !== undefined) player.economyMessage = self.economyMessage as string;
  if (self.bossKills !== undefined) player.bossKills = self.bossKills as number;
  if (self.loadout !== undefined) player.loadout = readLiveLoadout(self.loadout);
  if (self.automation !== undefined) player.automation = readAutomation(self.automation, world);
  if (self.launchPending !== undefined) { if (typeof self.launchPending !== 'boolean') return invalid(); player.launchPending = self.launchPending; }
  if (!Array.isArray(value.entities) || value.entities.length > 256 || !Array.isArray(value.drops) || value.drops.length > 512 || !Array.isArray(value.events) || value.events.length > 256 || !Array.isArray(value.visibleChunks) || value.visibleChunks.length > 256) return invalid();
  const entities: LiveEntity[] = value.entities.map(entity => {
    if (!point(entity, bounds) || !record(entity) || !integer(entity.x) || !integer(entity.y) || !text(entity.id) || !text(entity.name, 80) || !['player', 'scav'].includes(entity.kind as string) || !integer(entity.appearance, 0, 31) || !number(entity.health, 0, 100) || !['idle', 'moving', 'combat', 'downed'].includes(entity.action as string) || !number(entity.safeUntil) || !(entity.faction === undefined || ['scavs', 'raiders'].includes(entity.faction as string)) || !(entity.role === undefined || ['patrol', 'guard', 'marksman'].includes(entity.role as string))) return invalid();
    if (!(entity.moveIntervalMs === undefined || number(entity.moveIntervalMs, 100, 4000)) || !(entity.bleeding === undefined || typeof entity.bleeding === 'boolean') || !(entity.limping === undefined || typeof entity.limping === 'boolean') || !(entity.aimUntil === undefined || number(entity.aimUntil)) || !(entity.aimTargetId === undefined || text(entity.aimTargetId))
      || !(entity.bossId === undefined || bossId(entity.bossId) && entity.kind === 'scav' && entity.id === `boss-${entity.bossId}` && entity.name === getBoss(entity.bossId)!.name)) return invalid();
    return { x: entity.x, y: entity.y, id: entity.id, name: entity.name, kind: entity.kind as LiveEntity['kind'], appearance: entity.appearance, health: entity.health, action: entity.action as LiveEntity['action'], safeUntil: entity.safeUntil, ...(entity.moveIntervalMs === undefined ? {} : { moveIntervalMs: entity.moveIntervalMs as number }), ...(entity.visualLoadout === undefined ? {} : { visualLoadout: readVisualLoadout(entity.visualLoadout) }), ...(entity.faction ? { faction: entity.faction as LiveEntity['faction'] } : {}), ...(entity.role ? { role: entity.role as LiveEntity['role'] } : {}), ...(entity.bossId ? { bossId: entity.bossId as BossId } : {}), ...(entity.bleeding === undefined ? {} : { bleeding: entity.bleeding as boolean }), ...(entity.limping === undefined ? {} : { limping: entity.limping as boolean }), ...(entity.aimUntil === undefined ? {} : { aimUntil: entity.aimUntil as number }), ...(entity.aimTargetId === undefined ? {} : { aimTargetId: entity.aimTargetId as string }) };
  });
  if (new Set(entities.map(entity => entity.id)).size !== entities.length || !entities.some(entity => entity.id === value.selfId && entity.kind === 'player')) return invalid();
  const drops: LiveDrop[] = value.drops.map(drop => {
    if (!point(drop, bounds) || !keys(drop, ['id', 'x', 'y', 'amount', 'items', 'containerId', 'containerKind', 'searched', 'bossId']) || !integer(drop.x) || !integer(drop.y) || !text(drop.id) || !integer(drop.amount) || !(drop.bossId === undefined || bossId(drop.bossId) && drop.containerId === undefined)) return invalid();
    const items = drop.items === undefined ? undefined : readLoot(drop.items);
    if (drop.containerId !== undefined) {
      const anchor = world.containers.find(anchor => anchor.id === drop.containerId);
      if (!anchor || anchor.x !== drop.x || anchor.y !== drop.y || !containerKind(drop.containerKind) || anchor.kind !== drop.containerKind || typeof drop.searched !== 'boolean' || (!drop.searched && (drop.amount !== 0 || items !== undefined))) return invalid();
      return { x: drop.x, y: drop.y, id: drop.id, amount: drop.amount, containerId: anchor.id, containerKind: drop.containerKind, searched: drop.searched, ...(items ? { items } : {}) };
    }
    if ((!drop.amount && !items?.length) || drop.containerKind !== undefined || drop.searched !== undefined) return invalid();
    return { x: drop.x, y: drop.y, id: drop.id, amount: drop.amount, ...(items ? { items } : {}), ...(drop.bossId ? { bossId: drop.bossId as BossId } : {}) };
  });
  const physicalIds = [...(player.lootItems ?? []), ...(player.pendingDelivery ?? []).flatMap(parcel => parcel.items), ...drops.flatMap(drop => drop.items ?? [])].map(item => item.id);
  if (new Set(drops.map(drop => drop.id)).size !== drops.length || new Set(physicalIds).size !== physicalIds.length) return invalid();
  const events: LiveEvent[] = value.events.map(event => {
    if (!record(event) || !text(event.id) || !number(event.at) || !text(event.text, 500) || !['join', 'leave', 'combat', 'loot', 'extract', 'respawn', 'travel'].includes(event.kind as string) || !(event.actorId === undefined || text(event.actorId)) || !(event.targetId === undefined || text(event.targetId)) || !(event.from === undefined && event.to === undefined || point(event.from, bounds) && point(event.to, bounds)) || !(event.damage === undefined || number(event.damage, 0, 100))) return invalid();
    return { id: event.id, at: event.at, text: event.text, kind: event.kind as LiveEvent['kind'], ...(typeof event.actorId === 'string' ? { actorId: event.actorId } : {}), ...(typeof event.targetId === 'string' ? { targetId: event.targetId } : {}), ...(point(event.from, bounds) && point(event.to, bounds) ? { from: { x: event.from.x, y: event.from.y }, to: { x: event.to.x, y: event.to.y } } : {}), ...(typeof event.damage === 'number' ? { damage: event.damage } : {}) };
  });
  const visibleChunks = value.visibleChunks.map(chunk => {
    if (!record(chunk) || !integer(chunk.x, 0, Math.ceil(world.width / world.chunkSize) - 1) || !integer(chunk.y, 0, Math.ceil(world.height / world.chunkSize) - 1)) return invalid();
    return { x: chunk.x, y: chunk.y };
  });
  if (new Set(visibleChunks.map(chunk => `${chunk.x},${chunk.y}`)).size !== visibleChunks.length) return invalid();
  const server = readLiveStatus(value.server), map = server.maps[0]!;
  for (const boss of server.bosses ?? []) {
    const poi = world.pois.find(poi => poi.id === boss.poiId);
    if (!poi || poi.districtId !== boss.districtId || poi.x !== boss.area.x || poi.y !== boss.area.y || poi.width !== boss.area.width || poi.height !== boss.area.height) return invalid();
  }
  if (map.width !== world.width || map.height !== world.height || map.theme !== world.theme || map.name !== world.name) return invalid();
  if (map.city && JSON.stringify(map.city) !== JSON.stringify(world.city)) return invalid();
  return { server, now: value.now, selfId: value.selfId, self: player, world, entities, drops, events, worldVersion: value.worldVersion, visibleChunks };
}
export interface LiveIdentity { accountId: string | null; playerId?: string; worldVersion?: string; gameId?: string | null }
export interface LiveJoinOptions { districtId?: LiveDistrictId; purpose?: LivePurpose; kitId?: LiveKitId; intent?: 'deploy' | 'continue' }
/** Cap decompressed bytes before JSON parsing, including chunked responses that
 * omit Content-Length. A city packet can be large, but never unbounded. */
async function readResponseJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > WORLD_LIMITS.wireBytes) { void response.body?.cancel().catch(() => {}); return invalid(); }
  if (!response.body) return null;
  const reader = response.body.getReader(), decoder = new TextDecoder(), chunks: string[] = [];
  let bytes = 0, pending = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > WORLD_LIMITS.wireBytes) { void reader.cancel().catch(() => {}); return invalid(); }
      pending += decoder.decode(value, { stream: true });
      if (pending.length >= 65536) { chunks.push(pending); pending = ''; }
    }
    chunks.push(pending + decoder.decode());
  } finally { reader.releaseLock(); }
  try { return JSON.parse(chunks.join('')); } catch { return null; }
}
export async function liveRequest<T>(path: 'status' | 'entry' | 'join' | 'state' | 'action' | 'leave', identity: LiveIdentity, read: (value: unknown) => T, command?: LiveCommand, signal?: AbortSignal, joinOptions?: LiveJoinOptions, transport: typeof fetch = globalThis.fetch): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = globalThis.setTimeout(abort, 12_000);
  try {
    const post = path === 'join' || path === 'action' || path === 'leave';
    const response = await transport(`/api/live/${path}`, { method: post ? 'POST' : 'GET', body: post ? JSON.stringify(path === 'join' && joinOptions ? joinOptions : command ?? {}) : undefined, credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json', ...(post ? { 'Content-Type': 'application/json' } : {}), ...(identity.accountId ? { 'x-prapor-account': identity.accountId } : {}), ...(identity.playerId ? { 'x-prapor-live': identity.playerId } : {}), ...(identity.gameId ? { 'x-prapor-game': identity.gameId } : {}), ...(identity.worldVersion ? { 'x-prapor-world-version': identity.worldVersion } : {}) }, signal: controller.signal });
    const value = await readResponseJson(response);
    if (!response.ok) throw new LiveApiError(response.status, record(value) && typeof value.error === 'string' ? value.error : record(value) && typeof value.code === 'string' ? value.code : 'unknown');
    return read(value);
  } catch (error) {
    if (error instanceof LiveApiError) throw error;
    throw new LiveApiError(0, controller.signal.aborted ? 'timeout' : 'network');
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
