import { SAVE_VERSION, parseSave, type ActionResult, type GameState } from './game/engine';
import type { GameActionSnapshot, GameCommand, GameSnapshot } from './game/commands';
import { MAX_GAME_SAVE_LENGTH } from './game-save';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

export interface AuthoritativeStatus { phase: 'connecting' | 'online' | 'offline' | 'changed'; message: string; busy: boolean }
export interface AuthoritativeClientOptions {
  getAccountId: () => string | null;
  onSnapshot: (snapshot: GameSnapshot) => void;
  onStatus?: (status: AuthoritativeStatus) => void;
  /** Injectable transport keeps concurrency and uncertain outcomes testable. */
  fetch?: typeof globalThis.fetch;
}

export class GameApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly snapshot?: GameSnapshot) {
    super(gameApiMessage(status, code));
    this.name = 'GameApiError';
  }
}

function gameApiMessage(status: number, code: string): string {
  if (code === 'identity_changed' || code === 'account_changed' || code === 'game_identity_changed' || status === 401) return 'Аккаунт изменился. Подключаемся к текущему серверному убежищу.';
  if (code === 'revision_conflict') return 'Состояние убежища обновилось в другом окне. Новая сводка загружена; повтори приказ.';
  if (code === 'timeout' || code === 'network') return 'Нет связи с сервером. Прогресс хранится на сервере. Приказ мог выполниться; обнови сводку перед повтором.';
  if (code === 'invalid_response') return 'Сервер прислал неполную сводку. Ожидаем новое состояние убежища.';
  if (code === 'join_required' || code === 'session_required') return 'Подключаемся к серверному убежищу.';
  if (status === 429) return 'Слишком много приказов. Подожди немного и повтори.';
  if (status >= 500) return 'Сервер убежища временно недоступен. Прогресс сохранён; подключение восстановится.';
  if (code === 'destroyed') return 'Подключение закрыто.';
  if (code === 'not_ready') return 'Дождись подключения к серверному убежищу.';
  if (code === 'busy') return 'Дождись ответа на предыдущий приказ.';
  return 'Приказ отклонён сервером. Обнови сводку и попробуй ещё раз.';
}

/** Validate the wire state without migration, local clocks or engine advancement. */
export function readAuthoritativeSnapshot(value: unknown): GameSnapshot {
  if (!record(value) || !integer(value.revision) || !integer(value.serverNow) || !record(value.identity) || !text(value.identity.id, 160) || !text(value.identity.name, 80) || !['guest', 'account'].includes(value.identity.kind as string) || !record(value.state) || value.state.schemaVersion !== SAVE_VERSION) throw new GameApiError(0, 'invalid_response');
  let raw: string;
  try { raw = JSON.stringify(value.state); } catch { throw new GameApiError(0, 'invalid_response'); }
  if (raw.length > MAX_GAME_SAVE_LENGTH || !parseSave(raw, { publicSnapshot: true })) throw new GameApiError(0, 'invalid_response');
  return { revision: value.revision, serverNow: value.serverNow, identity: { id: value.identity.id, name: value.identity.name, kind: value.identity.kind as 'guest' | 'account' }, state: value.state as unknown as GameState };
}

export function readAuthoritativeAction(value: unknown): GameActionSnapshot {
  const snapshot = readAuthoritativeSnapshot(value);
  if (!record(value) || !record(value.result) || typeof value.result.ok !== 'boolean' || !text(value.result.message, 2000) || !(value.result.raidId === undefined || text(value.result.raidId, 160))) throw new GameApiError(0, 'invalid_response');
  return { ...snapshot, result: { ok: value.result.ok, message: value.result.message, ...(typeof value.result.raidId === 'string' ? { raidId: value.result.raidId } : {}) } };
}

export function createAuthoritativeClient(options: AuthoritativeClientOptions) {
  let current: GameSnapshot | null = null, generation = 0, destroyed = false, actionPending = false;
  let accountId = options.getAccountId();
  let phase: AuthoritativeStatus['phase'] = 'connecting', message = 'Подключаемся к серверному убежищу.';
  let chain: Promise<unknown> = Promise.resolve();
  let joining: Promise<GameSnapshot> | null = null, polling: Promise<GameSnapshot> | null = null;
  const controllers = new Set<AbortController>();
  const transport = options.fetch ?? globalThis.fetch;
  const notify = () => options.onStatus?.({ phase, message, busy: actionPending });
  const isCurrent = (version: number, account: string | null) => !destroyed && version === generation && account === options.getAccountId();
  const requireCurrent = (version: number, account: string | null) => { if (!isCurrent(version, account)) throw new GameApiError(401, 'identity_changed'); };
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => { const run = chain.then(operation, operation); chain = run.catch(() => {}); return run; };

  function update(next: GameSnapshot, version: number, account: string | null, expected?: string): void {
    requireCurrent(version, account);
    if (expected && next.identity.id !== expected) throw new GameApiError(401, 'identity_changed');
    if (next.identity.kind !== (account ? 'account' : 'guest')) throw new GameApiError(401, 'identity_changed');
    // Even overlapping tabs cannot make a response move this client backwards.
    if (current && current.identity.id === next.identity.id && next.revision < current.revision) throw new GameApiError(409, 'revision_conflict');
    current = next; accountId = account; phase = 'online'; message = '';
    options.onSnapshot(next); notify();
  }

  function fail(error: unknown, version: number, account: string | null): GameApiError {
    const issue = error instanceof GameApiError ? error : new GameApiError(0, 'network');
    if (isCurrent(version, account)) {
      phase = issue.status === 401 || ['identity_changed', 'account_changed', 'game_identity_changed', 'join_required', 'session_required'].includes(issue.code) ? 'changed' : 'offline';
      if (phase === 'changed') current = null;
      message = issue.message; notify();
    }
    return issue;
  }

  async function request(path: 'join' | 'state' | 'action', version: number, account: string | null, command?: GameCommand): Promise<unknown> {
    requireCurrent(version, account);
    const expected = path === 'join' ? undefined : current?.identity.id;
    if (path !== 'join' && !expected) throw new GameApiError(409, 'not_ready');
    const controller = new AbortController(); controllers.add(controller);
    const timer = globalThis.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await transport(`/api/game/${path}`, { method: path === 'state' ? 'GET' : 'POST', body: path === 'state' ? undefined : JSON.stringify(path === 'action' ? { revision: current!.revision, command } : {}), credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json', ...(path !== 'state' ? { 'Content-Type': 'application/json' } : {}), ...(account ? { 'x-prapor-account': account } : {}), ...(expected ? { 'x-prapor-game': expected } : {}) }, signal: controller.signal });
      const body: unknown = await response.json().catch(() => null);
      requireCurrent(version, account);
      if (!response.ok) {
        const code = record(body) && typeof body.code === 'string' ? body.code : record(body) && typeof body.error === 'string' ? body.error : 'unknown';
        let conflict: GameSnapshot | undefined;
        if (code === 'revision_conflict' && record(body) && body.snapshot !== undefined) conflict = readAuthoritativeSnapshot(body.snapshot);
        throw new GameApiError(response.status, code, conflict);
      }
      return body;
    } catch (error) {
      if (error instanceof GameApiError) throw error;
      throw new GameApiError(0, controller.signal.aborted ? 'timeout' : 'network');
    } finally { globalThis.clearTimeout(timer); controllers.delete(controller); }
  }

  function resetIdentity(): void {
    generation++; current = null; accountId = options.getAccountId(); joining = null; polling = null; actionPending = false;
    for (const controller of controllers) controller.abort(); controllers.clear();
    phase = 'connecting'; message = 'Подключаемся к серверному убежищу.'; notify();
  }
  function synchronizeIdentity(): void { if (accountId !== options.getAccountId()) resetIdentity(); }

  function join(): Promise<GameSnapshot> {
    synchronizeIdentity();
    if (destroyed) return Promise.reject(new GameApiError(0, 'destroyed'));
    if (joining) return joining;
    const version = generation, account = accountId;
    phase = 'connecting'; message = 'Подключаемся к серверному убежищу.'; notify();
    const result = enqueue(async () => {
      try { const next = readAuthoritativeSnapshot(await request('join', version, account)); update(next, version, account); return next; }
      catch (error) { throw fail(error, version, account); }
    });
    joining = result;
    void result.finally(() => { if (joining === result) joining = null; }).catch(() => {});
    return result;
  }

  function poll(): Promise<GameSnapshot> {
    synchronizeIdentity();
    if (destroyed) return Promise.reject(new GameApiError(0, 'destroyed'));
    if (!current) return join();
    if (polling) return polling;
    const version = generation, account = accountId, expected = current.identity.id;
    const result = enqueue(async () => {
      try { const next = readAuthoritativeSnapshot(await request('state', version, account)); update(next, version, account, expected); return next; }
      catch (error) { throw fail(error, version, account); }
    });
    polling = result;
    void result.finally(() => { if (polling === result) polling = null; }).catch(() => {});
    return result;
  }

  function action(command: GameCommand): Promise<ActionResult> {
    synchronizeIdentity();
    if (destroyed) return Promise.resolve({ ok: false, message: new GameApiError(0, 'destroyed').message });
    if (!current || phase !== 'online') return Promise.resolve({ ok: false, message: new GameApiError(409, 'not_ready').message });
    if (actionPending) return Promise.resolve({ ok: false, message: new GameApiError(409, 'busy').message });
    const version = generation, account = accountId, expected = current.identity.id;
    actionPending = true; notify();
    return enqueue(async () => {
      try {
        const next = readAuthoritativeAction(await request('action', version, account, command));
        update(next, version, account, expected);
        return next.result;
      } catch (error) {
        const issue = error instanceof GameApiError ? error : new GameApiError(0, 'network');
        if (issue.code === 'revision_conflict' && issue.snapshot) {
          try { update(issue.snapshot, version, account, expected); message = issue.message; notify(); }
          catch (conflictError) { return { ok: false, message: fail(conflictError, version, account).message }; }
          return { ok: false, message: issue.message };
        }
        return { ok: false, message: fail(issue, version, account).message };
      } finally { if (version === generation) { actionPending = false; notify(); } }
    });
  }

  return { join, poll, action, resetIdentity, isReady: () => current !== null && phase === 'online' && !destroyed, isBusy: () => actionPending, getSnapshot: () => current,
    get ready() { return current !== null && phase === 'online' && !destroyed; }, get busy() { return actionPending; },
    destroy: () => { destroyed = true; generation++; current = null; joining = null; polling = null; for (const controller of controllers) controller.abort(); controllers.clear(); } };
}
