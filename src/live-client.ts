import type { LiveCommand, LiveDrop, LiveEntity, LiveEvent, LiveContainerKind, LiveDistrict, LiveDistrictId, LiveMapSummary, LivePlayer, LivePurpose, LiveSnapshot, LiveStatus, LiveWorld } from './game/live';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const number = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => number(value, min, max) && Number.isInteger(value);
const districtId = (value: unknown): value is LiveDistrictId => ['customs', 'sawmill', 'depot', 'village'].includes(value as string);
const purpose = (value: unknown): value is LivePurpose => ['pvp', 'pve', 'loot', 'quests'].includes(value as string);
const containerKind = (value: unknown): value is LiveContainerKind => ['duffel', 'jacket', 'toolbox', 'medbag', 'cabinet', 'crate'].includes(value as string);
const text = (value: unknown, max = 100): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const point = (value: unknown, world: Pick<LiveWorld, 'width' | 'height'>): value is Record<string, unknown> & { x: number; y: number } => record(value) && number(value.x, 0, world.width - 1) && number(value.y, 0, world.height - 1);
const invalid = (): never => { throw new LiveApiError(0, 'invalid_response'); };

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
  if (status === 401 || ['account_changed', 'identity_changed', 'live_identity_changed'].includes(code)) return 'Игровая сессия изменилась. Войди на сервер заново с текущим аккаунтом.';
  if (code === 'server_full' || code === 'full') return 'Периметр заполнен. Подожди свободного места и попробуй войти ещё раз.';
  if (['not_joined', 'not_online', 'player_missing'].includes(code)) return 'Ты уже вышел с Периметра. Подключись снова.';
  if (['too_far', 'out_of_range', 'loot_out_of_range', 'extract_out_of_range'].includes(code)) return 'Цель слишком далеко. Подойди ближе.';
  if (code === 'target_out_of_range') return 'Цель далеко или за укрытием. Подойди ближе и найди прямую линию огня.';
  if (code === 'travel_out_of_range') return 'Для перехода на другую карту доберись до зелёного выхода.';
  if (code === 'travel_in_combat' || code === 'combat_active' || code === 'in_combat') return 'Переход недоступен в бою. Укройся и подожди 8 секунд после последнего попадания.';
  if (code === 'travel_cooldown') return 'Переход ещё не готов. Подожди у выхода.';
  if (code === 'same_map' || code === 'already_on_map') return 'Ты уже на этой карте.';
  if (code === 'blocked' || code === 'invalid_move') return 'Этот путь перекрыт. Выбери свободную клетку.';
  if (['downed', 'dead', 'player_downed', 'respawn_not_ready'].includes(code)) return 'Боец ранен. Дождись возвращения на Периметр.';
  if (code === 'no_ammo') return 'Патроны закончились. Доберись до выхода для пополнения комплекта.';
  if (code === 'no_medkits') return 'Аптечек больше нет. На выходе можно пополнить комплект.';
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
export function shouldRejoinLivePresence(error: unknown, requestAccount: string | null, currentAccount: string | null): boolean {
  return error instanceof LiveApiError && error.status === 401 && error.code === 'join_required' && requestAccount === currentAccount;
}

const rectangle = (value: unknown, bounds: Pick<LiveWorld, 'width' | 'height'>): value is Record<string, unknown> & { x: number; y: number; width: number; height: number } =>
  point(value, bounds) && integer(value.x) && integer(value.y) && integer(value.width, 1, bounds.width) && integer(value.height, 1, bounds.height) && value.x + value.width <= bounds.width && value.y + value.height <= bounds.height;

function readDistrict(value: unknown, bounds: Pick<LiveWorld, 'width' | 'height'>): LiveDistrict {
  if (!rectangle(value, bounds) || !districtId(value.id) || !text(value.name, 80) || !text(value.description, 500) || !['industrial', 'forest', 'urban'].includes(value.theme as string) || !Array.isArray(value.spawns) || !value.spawns.length || value.spawns.length > 16) return invalid();
  const spawns = value.spawns.map(spawn => {
    if (!point(spawn, bounds) || !integer(spawn.x) || !integer(spawn.y) || spawn.x < value.x || spawn.y < value.y || spawn.x >= value.x + value.width || spawn.y >= value.y + value.height) return invalid();
    return { x: spawn.x, y: spawn.y };
  });
  return { id: value.id, name: value.name, description: value.description, theme: value.theme as LiveDistrict['theme'], x: value.x, y: value.y, width: value.width, height: value.height, spawns };
}

export function readLiveStatus(value: unknown): LiveStatus {
  if (!record(value) || !text(value.id) || !text(value.name, 80) || !integer(value.online, 0, 256) || !integer(value.capacity, 1, 256) || value.online > value.capacity || !number(value.startedAt) || !Array.isArray(value.maps) || value.maps.length !== 1 || !Array.isArray(value.districts) || value.districts.length !== 4) return invalid();
  const capacity = value.capacity;
  const maps: LiveMapSummary[] = value.maps.map(map => {
    if (!record(map) || map.id !== 'perimeter' || !text(map.name, 80) || !text(map.description, 500) || !['industrial', 'forest', 'urban', 'mixed'].includes(map.theme as string) || !integer(map.width, 2, 256) || !integer(map.height, 2, 256) || !integer(map.online, 0, capacity) || !integer(map.npcs, 0, 256)) return invalid();
    return { id: map.id, name: map.name, description: map.description, theme: map.theme as LiveMapSummary['theme'], width: map.width, height: map.height, online: map.online, npcs: map.npcs };
  });
  if (maps[0]!.online !== value.online) return invalid();
  const districts = value.districts.map(district => {
    const parsed = readDistrict(district, maps[0]!);
    if (!record(district) || !integer(district.online, 0, capacity) || !integer(district.npcs, 0, 256)) return invalid();
    return { ...parsed, online: district.online, npcs: district.npcs };
  });
  if (new Set(districts.map(district => district.id)).size !== 4 || districts.reduce((total, district) => total + district.online, 0) !== value.online) return invalid();
  return { id: value.id, name: value.name, online: value.online, capacity: value.capacity, startedAt: value.startedAt, maps, districts };
}

/** Only immutable, versioned geometry may be reused between server responses. */
export function readLiveWorld(source: unknown): LiveWorld {
  if (!record(source) || source.id !== 'perimeter' || !text(source.name, 80) || !text(source.description, 500) || !['industrial', 'forest', 'urban', 'mixed'].includes(source.theme as string) || !integer(source.width, 2, 256) || !integer(source.height, 2, 256) || !text(source.version, 128) || !text(source.seed, 128) || !integer(source.generatorVersion, 1, 1_000_000) || !integer(source.chunkSize, 1, 128) || !Array.isArray(source.obstacles) || source.obstacles.length > 512 || !Array.isArray(source.extracts) || !source.extracts.length || source.extracts.length > 64 || !Array.isArray(source.zones) || source.zones.length > 128 || !Array.isArray(source.districts) || source.districts.length !== 4 || !Array.isArray(source.pois) || source.pois.length > 256 || !Array.isArray(source.containers) || source.containers.length > 512) return invalid();
  const bounds = { width: source.width, height: source.height };
  const districts = source.districts.map(district => readDistrict(district, bounds));
  if (new Set(districts.map(district => district.id)).size !== 4) return invalid();
  const pois: LiveWorld['pois'] = source.pois.map(poi => {
    if (!rectangle(poi, bounds) || !text(poi.id) || !text(poi.templateId) || !text(poi.name, 80) || !districtId(poi.districtId) || !integer(poi.danger, 1, 3) || !Array.isArray(poi.tags) || poi.tags.length > 16 || !poi.tags.every(tag => text(tag, 40)) || !Array.isArray(poi.entrances) || !poi.entrances.length || poi.entrances.length > 16) return invalid();
    const entrances = poi.entrances.map(entrance => point(entrance, bounds) && integer(entrance.x) && integer(entrance.y) ? { x: entrance.x, y: entrance.y } : invalid());
    return { x: poi.x, y: poi.y, width: poi.width, height: poi.height, id: poi.id, templateId: poi.templateId, name: poi.name, districtId: poi.districtId, danger: poi.danger as 1 | 2 | 3, tags: [...poi.tags] as string[], entrances };
  });
  if (new Set(pois.map(poi => poi.id)).size !== pois.length) return invalid();
  const containers: LiveWorld['containers'] = source.containers.map(container => {
    if (!point(container, bounds) || !integer(container.x) || !integer(container.y) || !text(container.id) || !text(container.poiId) || !pois.some(poi => poi.id === container.poiId) || !containerKind(container.kind) || !['mixed', 'tools', 'medical', 'intel', 'valuables', 'provisions'].includes(container.lootTable as string) || !integer(container.searchMs, 1, 60_000)) return invalid();
    return { x: container.x, y: container.y, id: container.id, poiId: container.poiId, kind: container.kind, lootTable: container.lootTable as LiveWorld['containers'][number]['lootTable'], searchMs: container.searchMs };
  });
  if (new Set(containers.map(container => container.id)).size !== containers.length) return invalid();
  return { ...bounds, id: source.id, name: source.name, description: source.description, theme: source.theme as LiveWorld['theme'], version: source.version, seed: source.seed, generatorVersion: source.generatorVersion, chunkSize: source.chunkSize, districts, pois, containers, obstacles: source.obstacles.map(obstacle => {
    if (!rectangle(obstacle, bounds) || !(obstacle.kind === undefined || ['building', 'wall', 'container', 'barricade', 'tree'].includes(obstacle.kind as string)) || !(obstacle.label === undefined || text(obstacle.label, 80))) return invalid();
    return { x: obstacle.x, y: obstacle.y, width: obstacle.width, height: obstacle.height, ...(obstacle.kind ? { kind: obstacle.kind as LiveWorld['obstacles'][number]['kind'] } : {}), ...(obstacle.label ? { label: obstacle.label as string } : {}) };
  }), extracts: source.extracts.map(extract => point(extract, bounds) && integer(extract.x) && integer(extract.y) ? { x: extract.x, y: extract.y } : invalid()), zones: source.zones.map(zone => {
    if (!rectangle(zone, bounds) || !text(zone.name, 80) || !['road', 'concrete', 'forest', 'water', 'yard'].includes(zone.terrain as string) || !integer(zone.danger, 1, 3)) return invalid();
    return { x: zone.x, y: zone.y, width: zone.width, height: zone.height, name: zone.name, terrain: zone.terrain as LiveWorld['zones'][number]['terrain'], danger: zone.danger as 1 | 2 | 3 };
  }) };
}

export function readLiveSnapshot(value: unknown, cachedWorld?: LiveWorld): LiveSnapshot {
  if (!record(value) || !number(value.now) || !text(value.selfId) || !text(value.worldVersion, 128) || !record(value.self)) return invalid();
  const world = value.world === undefined ? cachedWorld : readLiveWorld(value.world);
  if (!world || world.version !== value.worldVersion) return invalid();
  const bounds = { width: world.width, height: world.height };
  const self = value.self;
  if (self.id !== value.selfId || !['ammo', 'medkits', 'cargo', 'stash', 'kills', 'respawnAt', 'travelReadyAt'].every(key => integer(self[key])) || typeof self.patrol !== 'boolean' || !(self.targetId === null || text(self.targetId)) || !districtId(self.districtId) || !purpose(self.purpose) || !(self.searching === null || record(self.searching) && text(self.searching.id) && integer(self.searching.readyAt))) return invalid();
  const player: LivePlayer = { id: value.selfId, ammo: self.ammo as number, medkits: self.medkits as number, cargo: self.cargo as number, stash: self.stash as number, kills: self.kills as number, respawnAt: self.respawnAt as number, patrol: self.patrol, targetId: self.targetId as string | null, travelReadyAt: self.travelReadyAt as number, districtId: self.districtId, purpose: self.purpose, searching: self.searching === null ? null : { id: (self.searching as { id: string }).id, readyAt: (self.searching as { readyAt: number }).readyAt } };
  if (!Array.isArray(value.entities) || value.entities.length > 256 || !Array.isArray(value.drops) || value.drops.length > 512 || !Array.isArray(value.events) || value.events.length > 256 || !Array.isArray(value.visibleChunks) || value.visibleChunks.length > 256) return invalid();
  const entities: LiveEntity[] = value.entities.map(entity => {
    if (!point(entity, bounds) || !record(entity) || !integer(entity.x) || !integer(entity.y) || !text(entity.id) || !text(entity.name, 80) || !['player', 'scav'].includes(entity.kind as string) || !integer(entity.appearance, 0, 31) || !number(entity.health, 0, 100) || !['idle', 'moving', 'combat', 'downed'].includes(entity.action as string) || !number(entity.safeUntil) || !(entity.faction === undefined || ['scavs', 'raiders'].includes(entity.faction as string)) || !(entity.role === undefined || ['patrol', 'guard', 'marksman'].includes(entity.role as string))) return invalid();
    return { x: entity.x, y: entity.y, id: entity.id, name: entity.name, kind: entity.kind as LiveEntity['kind'], appearance: entity.appearance, health: entity.health, action: entity.action as LiveEntity['action'], safeUntil: entity.safeUntil, ...(entity.faction ? { faction: entity.faction as LiveEntity['faction'] } : {}), ...(entity.role ? { role: entity.role as LiveEntity['role'] } : {}) };
  });
  if (new Set(entities.map(entity => entity.id)).size !== entities.length || !entities.some(entity => entity.id === value.selfId && entity.kind === 'player')) return invalid();
  const drops: LiveDrop[] = value.drops.map(drop => {
    if (!point(drop, bounds) || !integer(drop.x) || !integer(drop.y) || !text(drop.id) || !integer(drop.amount)) return invalid();
    if (drop.containerId !== undefined) {
      const anchor = world.containers.find(anchor => anchor.id === drop.containerId);
      if (!anchor || anchor.x !== drop.x || anchor.y !== drop.y || !containerKind(drop.containerKind) || anchor.kind !== drop.containerKind || typeof drop.searched !== 'boolean' || (!drop.searched && drop.amount !== 0)) return invalid();
      return { x: drop.x, y: drop.y, id: drop.id, amount: drop.amount, containerId: anchor.id, containerKind: drop.containerKind, searched: drop.searched };
    }
    if (drop.amount < 1 || drop.containerKind !== undefined || drop.searched !== undefined) return invalid();
    return { x: drop.x, y: drop.y, id: drop.id, amount: drop.amount };
  });
  if (new Set(drops.map(drop => drop.id)).size !== drops.length) return invalid();
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
  if (map.width !== world.width || map.height !== world.height || map.theme !== world.theme || map.name !== world.name) return invalid();
  return { server, now: value.now, selfId: value.selfId, self: player, world, entities, drops, events, worldVersion: value.worldVersion, visibleChunks };
}
export interface LiveIdentity { accountId: string | null; playerId?: string; worldVersion?: string }
export interface LiveJoinOptions { districtId: LiveDistrictId; purpose: LivePurpose }
export async function liveRequest<T>(path: 'status' | 'join' | 'state' | 'action' | 'leave', identity: LiveIdentity, read: (value: unknown) => T, command?: LiveCommand, signal?: AbortSignal, joinOptions?: LiveJoinOptions): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = window.setTimeout(abort, 12_000);
  try {
    const post = path === 'join' || path === 'action' || path === 'leave';
    const response = await fetch(`/api/live/${path}`, { method: post ? 'POST' : 'GET', body: post ? JSON.stringify(path === 'join' && joinOptions ? joinOptions : command ?? {}) : undefined, credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json', ...(post ? { 'Content-Type': 'application/json' } : {}), ...(identity.accountId ? { 'x-prapor-account': identity.accountId } : {}), ...(identity.playerId ? { 'x-prapor-live': identity.playerId } : {}), ...(identity.worldVersion ? { 'x-prapor-world-version': identity.worldVersion } : {}) }, signal: controller.signal });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new LiveApiError(response.status, record(value) && typeof value.error === 'string' ? value.error : record(value) && typeof value.code === 'string' ? value.code : 'unknown');
    return read(value);
  } catch (error) {
    if (error instanceof LiveApiError) throw error;
    throw new LiveApiError(0, controller.signal.aborted ? 'timeout' : 'network');
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
