import type { LiveCommand, LiveDrop, LiveEntity, LiveEvent, LivePlayer, LiveSnapshot, LiveStatus, LiveWorld } from './game/live';
import { BODY_PARTS, parseHealth, parseMedicalInventory, type BodyPart, type TreatmentType } from './game/health';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const number = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
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
  if (!record(value) || !text(value.id) || !text(value.name, 80) || !number(value.online, 0, 256) || !Number.isInteger(value.online) || !number(value.capacity, 1, 256) || !Number.isInteger(value.capacity) || value.online > value.capacity || !number(value.startedAt)) return invalid();
  return { id: value.id, name: value.name, online: value.online, capacity: value.capacity, startedAt: value.startedAt };
}

export function readLiveSnapshot(value: unknown): LiveSnapshot {
  if (!record(value) || !number(value.now) || !text(value.selfId) || !record(value.world) || !record(value.self)) return invalid();
  const source = value.world;
  if (!number(source.width, 2, 256) || !Number.isInteger(source.width) || !number(source.height, 2, 256) || !Number.isInteger(source.height) || !Array.isArray(source.obstacles) || source.obstacles.length > 256 || !Array.isArray(source.extracts) || source.extracts.length > 64) return invalid();
  const bounds = { width: source.width, height: source.height };
  const world: LiveWorld = { ...bounds, obstacles: source.obstacles.map(obstacle => {
    if (!point(obstacle, bounds) || !record(obstacle) || !number(obstacle.width, 1, source.width as number) || !number(obstacle.height, 1, source.height as number) || obstacle.x + obstacle.width > bounds.width || obstacle.y + obstacle.height > bounds.height) return invalid();
    return { x: obstacle.x, y: obstacle.y, width: obstacle.width, height: obstacle.height };
  }), extracts: source.extracts.map(extract => point(extract, bounds) ? { x: extract.x, y: extract.y } : invalid()) };
  const self = value.self;
  if (self.id !== value.selfId || !['ammo', 'medkits', 'cargo', 'stash', 'kills', 'respawnAt', 'leaveAt'].every(key => number(self[key])) || typeof self.patrol !== 'boolean') return invalid();
  let body: LivePlayer['body'], medicine: LivePlayer['medicine'];
  try { body = parseHealth(self.body); medicine = parseMedicalInventory(self.medicine); } catch { return invalid(); }
  const treatment = self.treatment;
  if (treatment !== null && (!record(treatment) || !['medkit', 'bandage', 'tourniquet', 'splint', 'painkiller', 'surgery'].includes(treatment.type as string) || !BODY_PARTS.includes(treatment.part as BodyPart) || !number(treatment.startedAt) || !number(treatment.endsAt) || treatment.endsAt < treatment.startedAt)) return invalid();
  const player: LivePlayer = { id: value.selfId, ammo: self.ammo as number, medkits: self.medkits as number, cargo: self.cargo as number, stash: self.stash as number, kills: self.kills as number, respawnAt: self.respawnAt as number, patrol: self.patrol, body, medicine, treatment: treatment === null ? null : { type: treatment.type as TreatmentType, part: treatment.part as BodyPart, startedAt: treatment.startedAt as number, endsAt: treatment.endsAt as number }, leaveAt: self.leaveAt as number };
  if (!Array.isArray(value.entities) || value.entities.length > 256 || !Array.isArray(value.drops) || value.drops.length > 512 || !Array.isArray(value.events) || value.events.length > 256) return invalid();
  const entities: LiveEntity[] = value.entities.map(entity => {
    if (!point(entity, bounds) || !record(entity) || !text(entity.id) || !text(entity.name, 80) || !['player', 'scav'].includes(entity.kind as string) || !number(entity.appearance, 0, 31) || !Number.isInteger(entity.appearance) || !number(entity.health, 0, 100) || !['idle', 'moving', 'combat', 'downed'].includes(entity.action as string) || !number(entity.safeUntil)) return invalid();
    if (!(entity.bleeding === undefined || typeof entity.bleeding === 'boolean') || !(entity.limping === undefined || typeof entity.limping === 'boolean') || !(entity.aimUntil === undefined || number(entity.aimUntil)) || !(entity.aimTargetId === undefined || text(entity.aimTargetId))) return invalid();
    return { x: entity.x, y: entity.y, id: entity.id, name: entity.name, kind: entity.kind as LiveEntity['kind'], appearance: entity.appearance, health: entity.health, action: entity.action as LiveEntity['action'], safeUntil: entity.safeUntil, ...(entity.bleeding === undefined ? {} : { bleeding: entity.bleeding as boolean }), ...(entity.limping === undefined ? {} : { limping: entity.limping as boolean }), ...(entity.aimUntil === undefined ? {} : { aimUntil: entity.aimUntil as number }), ...(entity.aimTargetId === undefined ? {} : { aimTargetId: entity.aimTargetId as string }) };
  });
  if (new Set(entities.map(entity => entity.id)).size !== entities.length || !entities.some(entity => entity.id === value.selfId && entity.kind === 'player')) return invalid();
  const drops: LiveDrop[] = value.drops.map(drop => point(drop, bounds) && record(drop) && text(drop.id) && number(drop.amount, 1) ? { x: drop.x, y: drop.y, id: drop.id, amount: drop.amount } : invalid());
  const events: LiveEvent[] = value.events.map(event => {
    if (!record(event) || !text(event.id) || !number(event.at) || !text(event.text, 500) || !['join', 'leave', 'combat', 'loot', 'extract', 'respawn'].includes(event.kind as string) || !(event.actorId === undefined || text(event.actorId)) || !(event.targetId === undefined || text(event.targetId))) return invalid();
    return { id: event.id, at: event.at, text: event.text, kind: event.kind as LiveEvent['kind'], ...(typeof event.actorId === 'string' ? { actorId: event.actorId } : {}), ...(typeof event.targetId === 'string' ? { targetId: event.targetId } : {}) };
  });
  return { server: readLiveStatus(value.server), now: value.now, selfId: value.selfId, self: player, world, entities, drops, events };
}

export interface LiveIdentity { accountId: string | null; playerId?: string }
export async function liveRequest<T>(path: 'status' | 'join' | 'state' | 'action' | 'leave', identity: LiveIdentity, read: (value: unknown) => T, command?: LiveCommand, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = window.setTimeout(abort, 12_000);
  try {
    const post = path === 'join' || path === 'action' || path === 'leave';
    const response = await fetch(`/api/live/${path}`, { method: post ? 'POST' : 'GET', body: post ? JSON.stringify(command ?? {}) : undefined, credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json', ...(post ? { 'Content-Type': 'application/json' } : {}), ...(identity.accountId ? { 'x-prapor-account': identity.accountId } : {}), ...(identity.playerId ? { 'x-prapor-live': identity.playerId } : {}) }, signal: controller.signal });
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
