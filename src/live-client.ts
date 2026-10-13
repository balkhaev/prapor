import type { LiveCommand, LiveDrop, LiveEntity, LiveEvent, LiveMapId, LiveMapSummary, LivePlayer, LiveSnapshot, LiveStatus, LiveWorld } from './game/live';
import { BODY_PARTS, parseHealth, parseMedicalInventory, type BodyPart, type TreatmentType } from './game/health';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const number = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => number(value, min, max) && Number.isInteger(value);
const mapId = (value: unknown): value is LiveMapId => value === 'customs' || value === 'sawmill' || value === 'depot';
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
  if (code === 'treatment_in_progress') return 'Лечение ещё идёт. Заверши его или отмени; движение и стрельба прервут лечение.';
  if (code === 'aim_in_progress') return 'Боец готовит прицельный выстрел. Движение отменяет прицеливание.';
  if (code.startsWith('medicine_')) return 'Средство закончилось или не подходит для этой зоны. Выбери нужное лечение по состоянию тела.';
  if (['target_missing', 'drop_missing', 'target_gone', 'target_unavailable', 'loot_unavailable'].includes(code)) return 'Цель уже исчезла. Сводка обновляется.';
  if (code === 'spawn_protection') return 'Эта цель пока под защитой после входа. Подожди несколько секунд.';
  if (code === 'cargo_full') return 'Груз заполнен. Доставь добычу к зелёному выходу.';
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

export function readLiveStatus(value: unknown): LiveStatus {
  if (!record(value) || !text(value.id) || !text(value.name, 80) || !integer(value.online, 0, 256) || !integer(value.capacity, 1, 256) || value.online > value.capacity || !number(value.startedAt) || !Array.isArray(value.maps) || value.maps.length !== 3) return invalid();
  const capacity = value.capacity;
  const maps: LiveMapSummary[] = value.maps.map(map => {
    if (!record(map) || !mapId(map.id) || !text(map.name, 80) || !text(map.description, 500) || !['industrial', 'forest', 'urban'].includes(map.theme as string) || !integer(map.width, 2, 256) || !integer(map.height, 2, 256) || !integer(map.online, 0, capacity) || !integer(map.npcs, 0, 256)) return invalid();
    return { id: map.id, name: map.name, description: map.description, theme: map.theme as LiveMapSummary['theme'], width: map.width, height: map.height, online: map.online, npcs: map.npcs };
  });
  if (new Set(maps.map(map => map.id)).size !== 3 || maps.reduce((total, map) => total + map.online, 0) !== value.online) return invalid();
  return { id: value.id, name: value.name, online: value.online, capacity: value.capacity, startedAt: value.startedAt, maps };
}

export function readLiveSnapshot(value: unknown): LiveSnapshot {
  if (!record(value) || !number(value.now) || !text(value.selfId) || !record(value.world) || !record(value.self)) return invalid();
  const source = value.world;
  if (!mapId(source.id) || !text(source.name, 80) || !text(source.description, 500) || !['industrial', 'forest', 'urban'].includes(source.theme as string) || !integer(source.width, 2, 256) || !integer(source.height, 2, 256) || !Array.isArray(source.obstacles) || source.obstacles.length > 512 || !Array.isArray(source.extracts) || !source.extracts.length || source.extracts.length > 64 || !Array.isArray(source.zones) || source.zones.length > 128) return invalid();
  const bounds = { width: source.width, height: source.height };
  const rectangle = (value: unknown): value is Record<string, unknown> & { x: number; y: number; width: number; height: number } => point(value, bounds) && integer(value.x) && integer(value.y) && integer(value.width, 1, bounds.width) && integer(value.height, 1, bounds.height) && value.x + value.width <= bounds.width && value.y + value.height <= bounds.height;
  const world: LiveWorld = { ...bounds, id: source.id, name: source.name, description: source.description, theme: source.theme as LiveWorld['theme'], obstacles: source.obstacles.map(obstacle => {
    if (!rectangle(obstacle) || !(obstacle.kind === undefined || ['building', 'wall', 'container', 'barricade', 'tree'].includes(obstacle.kind as string)) || !(obstacle.label === undefined || text(obstacle.label, 80))) return invalid();
    return { x: obstacle.x, y: obstacle.y, width: obstacle.width, height: obstacle.height, ...(obstacle.kind ? { kind: obstacle.kind as LiveWorld['obstacles'][number]['kind'] } : {}), ...(obstacle.label ? { label: obstacle.label as string } : {}) };
  }), extracts: source.extracts.map(extract => point(extract, bounds) && integer(extract.x) && integer(extract.y) ? { x: extract.x, y: extract.y } : invalid()), zones: source.zones.map(zone => {
    if (!rectangle(zone) || !text(zone.name, 80) || !['road', 'concrete', 'forest', 'water', 'yard'].includes(zone.terrain as string) || !integer(zone.danger, 1, 3)) return invalid();
    return { x: zone.x, y: zone.y, width: zone.width, height: zone.height, name: zone.name, terrain: zone.terrain as LiveWorld['zones'][number]['terrain'], danger: zone.danger as 1 | 2 | 3 };
  }) };
  const self = value.self;
  if (self.id !== value.selfId || !['ammo', 'medkits', 'cargo', 'stash', 'kills', 'respawnAt', 'travelReadyAt', 'leaveAt'].every(key => integer(self[key])) || typeof self.patrol !== 'boolean' || !(self.targetId === null || text(self.targetId))) return invalid();
  let body: LivePlayer['body'], medicine: LivePlayer['medicine'];
  try { body = parseHealth(self.body); medicine = parseMedicalInventory(self.medicine); } catch { return invalid(); }
  const treatment = self.treatment;
  if (treatment !== null && (!record(treatment) || !['medkit', 'bandage', 'tourniquet', 'splint', 'painkiller', 'surgery'].includes(treatment.type as string) || !BODY_PARTS.includes(treatment.part as BodyPart) || !number(treatment.startedAt) || !number(treatment.endsAt) || treatment.endsAt < treatment.startedAt)) return invalid();
  const player: LivePlayer = { id: value.selfId, ammo: self.ammo as number, medkits: self.medkits as number, cargo: self.cargo as number, stash: self.stash as number, kills: self.kills as number, respawnAt: self.respawnAt as number, patrol: self.patrol, targetId: self.targetId as string | null, travelReadyAt: self.travelReadyAt as number, body, medicine, treatment: treatment === null ? null : { type: treatment.type as TreatmentType, part: treatment.part as BodyPart, startedAt: treatment.startedAt as number, endsAt: treatment.endsAt as number }, leaveAt: self.leaveAt as number };
  if (!Array.isArray(value.entities) || value.entities.length > 256 || !Array.isArray(value.drops) || value.drops.length > 512 || !Array.isArray(value.events) || value.events.length > 256) return invalid();
  const entities: LiveEntity[] = value.entities.map(entity => {
    if (!point(entity, bounds) || !record(entity) || !integer(entity.x) || !integer(entity.y) || !text(entity.id) || !text(entity.name, 80) || !['player', 'scav'].includes(entity.kind as string) || !integer(entity.appearance, 0, 31) || !number(entity.health, 0, 100) || !['idle', 'moving', 'combat', 'downed'].includes(entity.action as string) || !number(entity.safeUntil) || !(entity.faction === undefined || ['scavs', 'raiders'].includes(entity.faction as string)) || !(entity.role === undefined || ['patrol', 'guard', 'marksman'].includes(entity.role as string))) return invalid();
    if (!(entity.bleeding === undefined || typeof entity.bleeding === 'boolean') || !(entity.limping === undefined || typeof entity.limping === 'boolean') || !(entity.aimUntil === undefined || number(entity.aimUntil)) || !(entity.aimTargetId === undefined || text(entity.aimTargetId))) return invalid();
    return { x: entity.x, y: entity.y, id: entity.id, name: entity.name, kind: entity.kind as LiveEntity['kind'], appearance: entity.appearance, health: entity.health, action: entity.action as LiveEntity['action'], safeUntil: entity.safeUntil, ...(entity.faction ? { faction: entity.faction as LiveEntity['faction'] } : {}), ...(entity.role ? { role: entity.role as LiveEntity['role'] } : {}), ...(entity.bleeding === undefined ? {} : { bleeding: entity.bleeding as boolean }), ...(entity.limping === undefined ? {} : { limping: entity.limping as boolean }), ...(entity.aimUntil === undefined ? {} : { aimUntil: entity.aimUntil as number }), ...(entity.aimTargetId === undefined ? {} : { aimTargetId: entity.aimTargetId as string }) };
  });
  if (new Set(entities.map(entity => entity.id)).size !== entities.length || !entities.some(entity => entity.id === value.selfId && entity.kind === 'player')) return invalid();
  const drops: LiveDrop[] = value.drops.map(drop => point(drop, bounds) && record(drop) && text(drop.id) && integer(drop.amount, 1) ? { x: drop.x, y: drop.y, id: drop.id, amount: drop.amount } : invalid());
  const events: LiveEvent[] = value.events.map(event => {
    if (!record(event) || !text(event.id) || !number(event.at) || !text(event.text, 500) || !['join', 'leave', 'combat', 'loot', 'extract', 'respawn', 'travel'].includes(event.kind as string) || !(event.actorId === undefined || text(event.actorId)) || !(event.targetId === undefined || text(event.targetId)) || !(event.from === undefined && event.to === undefined || point(event.from, bounds) && point(event.to, bounds)) || !(event.damage === undefined || number(event.damage, 0, 100))) return invalid();
    return { id: event.id, at: event.at, text: event.text, kind: event.kind as LiveEvent['kind'], ...(typeof event.actorId === 'string' ? { actorId: event.actorId } : {}), ...(typeof event.targetId === 'string' ? { targetId: event.targetId } : {}), ...(point(event.from, bounds) && point(event.to, bounds) ? { from: { x: event.from.x, y: event.from.y }, to: { x: event.to.x, y: event.to.y } } : {}), ...(typeof event.damage === 'number' ? { damage: event.damage } : {}) };
  });
  const server = readLiveStatus(value.server), map = server.maps.find(map => map.id === world.id);
  if (!map || map.width !== world.width || map.height !== world.height || map.theme !== world.theme || map.name !== world.name) return invalid();
  return { server, now: value.now, selfId: value.selfId, self: player, world, entities, drops, events };
}

export interface LiveIdentity { accountId: string | null; playerId?: string }
export async function liveRequest<T>(path: 'status' | 'join' | 'state' | 'action' | 'leave', identity: LiveIdentity, read: (value: unknown) => T, command?: LiveCommand, signal?: AbortSignal, joinMap?: LiveMapId): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = window.setTimeout(abort, 12_000);
  try {
    const post = path === 'join' || path === 'action' || path === 'leave';
    const response = await fetch(`/api/live/${path}`, { method: post ? 'POST' : 'GET', body: post ? JSON.stringify(path === 'join' && joinMap ? { mapId: joinMap } : command ?? {}) : undefined, credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json', ...(post ? { 'Content-Type': 'application/json' } : {}), ...(identity.accountId ? { 'x-prapor-account': identity.accountId } : {}), ...(identity.playerId ? { 'x-prapor-live': identity.playerId } : {}) }, signal: controller.signal });
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
