import { LIVE_CAPACITY, LIVE_SERVER_NAME, type LiveCommand, type LiveEntity, type LiveSnapshot, type LiveStatus } from './game/live';
import { LiveApiError, liveRequest, readLiveSnapshot, readLiveStatus, shouldRejoinLivePresence, type LiveIdentity } from './live-client';
import { LiveScene } from './live-scene';
import './live.css';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const integer = (value: number) => Math.floor(value).toLocaleString('ru-RU');
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

export interface LiveModeOptions {
  world: HTMLElement;
  dock: HTMLElement;
  onExit: () => void;
  onAccount: () => void;
  getAccountId: () => string | null;
  onError?: (message: string) => void;
}

/** One server connection per visible mode. Mutations are never automatically replayed. */
export function createLiveMode(options: LiveModeOptions) {
  let active = false, destroyed = false, generation = 0, requestBusy = false, actionBusy = false;
  let identityAccount: string | null = null, snapshot: LiveSnapshot | null = null, status: LiveStatus | null = null;
  let message = '', offline = false, selectedId: string | null = null, receivedAt = 0;
  let pollTimer = 0, lastKeyboardAt = 0;
  let controller: AbortController | null = null;
  let connection: Promise<unknown> = Promise.resolve();
  let reconnectPresence = false;
  const { world, dock } = options;
  world.classList.add('live-world');
  world.hidden = true;
  const overlay = document.createElement('div'); overlay.className = 'live-world-overlay';
  const scene = new LiveScene(world, command => void send(command), id => { selectedId = id; render(); });
  world.append(overlay);
  const identity = (): LiveIdentity => ({ accountId: identityAccount, ...(snapshot ? { playerId: snapshot.selfId } : {}) });
  const isCurrent = (version: number, account: string | null) => active && !destroyed && version === generation && account === options.getAccountId();
  const stopRequest = () => { window.clearTimeout(pollTimer); pollTimer = 0; controller?.abort(); controller = null; requestBusy = false; actionBusy = false; };
  const schedule = (version: number) => { window.clearTimeout(pollTimer); if (active && version === generation && !destroyed) pollTimer = window.setTimeout(() => void poll(), 1000); };
  const clearSession = () => { snapshot = null; receivedAt = 0; selectedId = null; scene.clear(); };

  function explain(error: unknown, version: number, account: string | null): void {
    if (!isCurrent(version, account)) return;
    const issue = error instanceof LiveApiError ? error : new LiveApiError(0, 'network');
    const changed = message !== issue.message;
    message = issue.message;
    offline = issue.status === 0 || issue.status >= 500;
    if (shouldRejoinLivePresence(issue, account, options.getAccountId()) && snapshot) {
      reconnectPresence = true;
      clearSession();
    } else if (issue.status === 401 || ['account_changed', 'identity_changed', 'live_identity_changed', 'not_joined', 'not_online', 'player_missing'].includes(issue.code)) {
      reconnectPresence = false;
      clearSession();
    } else if (reconnectPresence && issue.status >= 400 && issue.status < 500 && issue.status !== 429) reconnectPresence = false;
    if (changed && !reconnectPresence) options.onError?.(message);
  }

  async function poll(): Promise<void> {
    if (!active || destroyed) return;
    if (identityAccount !== options.getAccountId()) { resetIdentity(); return; }
    const version = generation, account = identityAccount;
    if (requestBusy) { schedule(version); return; }
    if (reconnectPresence && !snapshot) { void join(true); return; }
    requestBusy = true; controller = new AbortController();
    try {
      if (snapshot) {
        const expected = snapshot.selfId;
        const next = await liveRequest('state', identity(), readLiveSnapshot, undefined, controller.signal);
        if (!isCurrent(version, account)) return;
        if (next.selfId !== expected) throw new LiveApiError(401, 'identity_changed');
        snapshot = next; status = next.server; receivedAt = Date.now(); scene.update(next);
      } else {
        const next = await liveRequest('status', { accountId: null }, readLiveStatus, undefined, controller.signal);
        if (!isCurrent(version, account)) return;
        status = next;
      }
      if (offline) message = '';
      offline = false;
    } catch (error) { explain(error, version, account); }
    finally { if (version === generation) { controller = null; requestBusy = false; render(); schedule(version); } }
  }

  async function join(reconnecting = false): Promise<void> {
    if (!active || actionBusy || destroyed) return;
    stopRequest();
    const version = ++generation, account = identityAccount = options.getAccountId();
    reconnectPresence = reconnecting;
    requestBusy = true; actionBusy = true; message = reconnecting ? 'Связь с сервером восстановлена. Подключаемся к Периметру снова.' : ''; offline = false; render();
    try {
      const result = connection.then(async () => {
        if (!isCurrent(version, account)) return null;
        const joined = await liveRequest('join', { accountId: account }, readLiveSnapshot);
        if (!isCurrent(version, account)) {
          // Serialize cleanup before another join can reuse this same player identity.
          await liveRequest('leave', { accountId: account, playerId: joined.selfId }, value => value).catch(() => {});
          return null;
        }
        return joined;
      });
      connection = result.catch(() => {});
      const next = await result;
      if (!next || !isCurrent(version, account)) return;
      reconnectPresence = false; message = '';
      snapshot = next; status = next.server; receivedAt = Date.now(); scene.update(next); scene.setSelected(null);
      world.querySelector<HTMLCanvasElement>('canvas')?.focus({ preventScroll: true });
    } catch (error) { explain(error, version, account); }
    finally { if (version === generation) { requestBusy = false; actionBusy = false; render(); schedule(version); } }
  }

  async function send(command: LiveCommand): Promise<void> {
    if (!active || !snapshot || actionBusy || offline || destroyed) return;
    if (identityAccount !== options.getAccountId()) { resetIdentity(); return; }
    // A command takes priority over a read, so an older poll cannot replace its result.
    stopRequest();
    const version = ++generation, account = identityAccount, expected = snapshot.selfId;
    requestBusy = true; actionBusy = true; controller = new AbortController(); message = ''; render();
    try {
      const next = await liveRequest('action', identity(), readLiveSnapshot, command, controller.signal);
      if (!isCurrent(version, account)) return;
      if (next.selfId !== expected) throw new LiveApiError(401, 'identity_changed');
      snapshot = next; status = next.server; receivedAt = Date.now(); offline = false; scene.update(next);
    } catch (error) { explain(error, version, account); }
    finally { if (version === generation) { controller = null; requestBusy = false; actionBusy = false; render(); schedule(version); } }
  }

  function resetIdentity(): void {
    generation++; stopRequest(); clearSession(); reconnectPresence = false; identityAccount = options.getAccountId(); message = ''; offline = false;
    if (active) { render(); void poll(); }
  }

  function show(): void {
    if (destroyed) return;
    if (active) { refreshPanel(); return; }
    active = true; generation++; reconnectPresence = false; identityAccount = options.getAccountId(); message = ''; offline = false;
    world.hidden = false; scene.show(); render(); void poll();
  }

  function hide(): void {
    if (!active) return;
    const leaving = snapshot ? identity() : null;
    active = false; generation++; stopRequest(); clearSession(); reconnectPresence = false; world.hidden = true; scene.hide(); overlay.innerHTML = '';
    dock.classList.remove('live-dock');
    if (leaving) connection = connection.then(() => liveRequest('leave', leaving, value => value)).catch(() => {});
  }

  function refreshPanel(): void {
    if (!active) return;
    if (identityAccount !== options.getAccountId()) { resetIdentity(); return; }
    render();
  }

  function render(): void {
    if (!active) return;
    dock.classList.remove('context-open', 'raid-dock', 'gameplay-overview'); dock.classList.add('live-dock');
    dock.removeAttribute('role'); dock.removeAttribute('aria-modal'); dock.setAttribute('aria-label', 'Мультиплеер: состояние бойца и приказы');
    const shade = document.querySelector<HTMLElement>('#context-shade'); if (shade) shade.hidden = true;
    const scroll = dock.querySelector<HTMLElement>('.live-dock-scroll')?.scrollTop ?? 0;
    const focused = dock.contains(document.activeElement) ? (document.activeElement as HTMLElement).getAttribute('data-live-button') : null;
    const eventsOpen = dock.querySelector<HTMLDetailsElement>('.live-events')?.open ?? false;
    const eventsFocused = document.activeElement === dock.querySelector('.live-events summary');
    const server = snapshot?.server ?? status;
    const header = `<header class="live-dock-head"><div><span class="live-eyebrow">МУЛЬТИПЛЕЕР · 1 СЕРВЕР</span><h2>${escape(server?.name ?? LIVE_SERVER_NAME)}</h2></div><span class="live-online ${offline ? 'lost' : ''}"><i></i>${server ? `${server.online}/${server.capacity}` : `—/${LIVE_CAPACITY}`}</span></header>`;
    const notice = message ? `<p class="live-notice ${offline ? 'lost' : ''}" role="status">${escape(message)}</p>` : '';
    if (!snapshot) {
      overlay.innerHTML = `<div class="live-lobby-scene"><span class="live-eyebrow">ПО ТУ СТОРОНУ УБЕЖИЩА</span><h2>Периметр живёт.<br>Ты входишь в него.</h2><p>Одна общая зона. Другие игроки, дикие и добыча.<br>Без конца матча и без ожидания нового рейда.</p><div class="live-lobby-model" aria-hidden="true"></div><span class="live-lobby-tag"><i></i>БЕСКОНЕЧНЫЙ LIVE</span></div>`;
      dock.innerHTML = `${header}<div class="live-dock-scroll">${notice}<div class="live-server-card"><span class="live-server-label"><i></i>${offline ? 'Связь восстанавливается' : server ? 'Сервер на связи' : 'Проверяем связь'}</span><h3>Бесконечный Периметр</h3><p>Встреть диких и реальных игроков. Передвигайся, вступай в бой, собирай добычу и доноси её до выхода.</p><div class="live-server-facts"><span><b>${server?.capacity ?? LIVE_CAPACITY}</b> места</span><span><b>24/7</b> общий мир</span><span><b>PvPvE</b> встречи</span></div><button class="button primary live-join" data-live-button="join" ${actionBusy || offline || (server && server.online >= server.capacity) ? 'disabled' : ''}>${actionBusy ? 'Входим на Периметр…' : server && server.online >= server.capacity ? 'Сервер заполнен' : 'Войти на сервер'}</button></div><div class="live-kit-note"><strong>Свой комплект для онлайна</strong><p>На сервере у тебя отдельный боец, патроны и аптечки. Рейды убежища и его ресурсы продолжают жить отдельно. Онлайн склад сохраняется на сервере.</p>${identityAccount ? '<span>Позывной и склад привязаны к аккаунту.</span>' : '<span>Гостевой позывной сохраняется в этом браузере.</span><button class="text-button" data-live-button="account">Войти в аккаунт →</button>'}</div><button class="text-button live-back" data-live-button="exit">← Вернуться в убежище</button></div>`;
    } else {
      const self = snapshot.entities.find(entity => entity.id === snapshot!.selfId)!;
      const downed = self.health <= 0;
      const remaining = Math.max(0, Math.ceil((snapshot.self.respawnAt - snapshot.now - (Date.now() - receivedAt)) / 1000));
      const canAct = !downed && !actionBusy && !offline;
      const nearExtract = snapshot.world.extracts.some(point => distance(self, point) <= 1.5);
      const nearby = snapshot.entities.filter(entity => entity.id !== self.id).sort((a, b) => distance(self, a) - distance(self, b));
      const selected = nearby.find(entity => entity.id === selectedId);
      const targetRow = (entity: LiveEntity) => {
        const range = distance(self, entity), protectedTarget = entity.safeUntil > snapshot!.now;
        return `<article class="live-person ${entity.kind === 'player' ? 'is-player' : 'is-scav'} ${selectedId === entity.id ? 'selected' : ''}"><button class="live-person-select" data-live-button="select:${escape(entity.id)}"><i>${entity.kind === 'player' ? 'И' : 'Д'}</i><span><strong>${escape(entity.name)}</strong><small>${entity.kind === 'player' ? 'Игрок' : 'Дикий · NPC'} · ${range.toFixed(1)} кл. · ${entity.health > 0 ? `${Math.ceil(entity.health)} HP` : 'Ранен'}${protectedTarget ? ' · защита' : ''}</small></span></button><button class="live-attack" data-live-button="attack:${escape(entity.id)}" ${!canAct || entity.health <= 0 || range > 7 || protectedTarget ? 'disabled' : ''} aria-label="Атаковать ${escape(entity.name)}" title="Стрелять: до 7 клеток при прямой видимости">Огонь</button></article>`;
      };
      overlay.innerHTML = `<div class="live-field-hud"><span class="live-signal ${offline ? 'lost' : ''}"><i></i>${offline ? 'НЕТ СВЯЗИ' : 'LIVE · ОБЩИЙ МИР'}</span><strong>${escape(self.name)} <span>${downed ? 'РАНЕН' : `${Math.ceil(self.health)} HP`}</span></strong><p>${downed ? `Возвращение через ${remaining} сек.` : snapshot.self.patrol ? 'Автопатруль включён · приказы доступны' : 'Нажми на землю · WASD / стрелки'}</p></div><div class="live-field-legend"><span><i class="own"></i>Ты</span><span><i class="player"></i>Игрок</span><span><i class="scav"></i>Дикий</span><span><i class="extract"></i>Выход</span></div>`;
      scene.setSelected(selectedId);
      const players = nearby.filter(entity => entity.kind === 'player'), scavs = nearby.filter(entity => entity.kind === 'scav' && distance(self, entity) <= 9).slice(0, 6);
      const drops = snapshot.drops.filter(drop => distance(self, drop) <= 1.5);
      dock.innerHTML = `${header}<div class="live-dock-scroll">${notice}<section class="live-self"><div class="live-self-name"><span class="live-eyebrow">ТВОЙ БОЕЦ</span><strong>${escape(self.name)}</strong><small>${downed ? 'Тяжёлое ранение' : self.safeUntil > snapshot.now ? 'Защита после входа' : self.action === 'combat' ? 'В бою' : self.action === 'moving' ? 'В пути' : 'На позиции'} · ${self.x}, ${self.y}</small></div><div class="live-health" aria-label="Здоровье ${Math.ceil(self.health)} из 100"><i style="width:${self.health}%"></i><span>${Math.ceil(self.health)} / 100 HP</span></div><div class="live-player-kit"><span>Патроны<b>${integer(snapshot.self.ammo)}</b></span><span>Аптечки<b>${integer(snapshot.self.medkits)}</b></span><span>При себе<b>${integer(snapshot.self.cargo)} ₽</b></span><span>На складе<b>${integer(snapshot.self.stash)} ₽</b></span></div></section>${downed ? `<section class="live-downed"><strong>Боец ранен</strong><p>Добыча осталась на Периметре. Новый комплект готовится.</p><button class="button primary" data-live-button="respawn" ${remaining > 0 || actionBusy || offline ? 'disabled' : ''}>${remaining > 0 ? `Вернуться через ${remaining} сек.` : 'Вернуться на Периметр'}</button></section>` : `<section class="live-orders"><div class="live-actions"><button class="button" data-live-button="patrol" aria-pressed="${snapshot.self.patrol}" ${!canAct ? 'disabled' : ''}>${snapshot.self.patrol ? 'Патруль: вкл.' : 'Автопатруль'}</button><button class="button" data-live-button="heal" ${!canAct || snapshot.self.medkits < 1 || self.health >= 100 ? 'disabled' : ''}>Аптечка +45 HP</button></div><button class="button primary live-extract" data-live-button="extract" ${!canAct || !nearExtract ? 'disabled' : ''}>${nearExtract ? 'Сдать добычу и пополнить комплект' : 'Эвакуация · подойди к выходу'}</button><p class="live-controls-help">Выбери землю для маршрута. Приблизься к цели и нажми «Огонь». Здания перекрывают обзор.</p><div class="live-direction-pad" aria-label="Передвижение бойца"><button data-live-button="move:0:-1" aria-label="На север" ${!canAct ? 'disabled' : ''}>↑</button><button data-live-button="move:-1:0" aria-label="На запад" ${!canAct ? 'disabled' : ''}>←</button><span>ХОД</span><button data-live-button="move:1:0" aria-label="На восток" ${!canAct ? 'disabled' : ''}>→</button><button data-live-button="move:0:1" aria-label="На юг" ${!canAct ? 'disabled' : ''}>↓</button></div></section>`}${selected ? `<section class="live-target"><h3>Выбранная цель</h3>${targetRow(selected)}</section>` : ''}${drops.length ? `<section class="live-roster"><h3>Добыча рядом</h3>${drops.map(drop => `<button class="live-loot" data-live-button="loot:${escape(drop.id)}" ${!canAct ? 'disabled' : ''}><span>Подобрать груз</span><strong>${integer(drop.amount)} ₽</strong></button>`).join('')}</section>` : ''}<section class="live-roster"><h3>Другие игроки <span>${players.length}</span></h3>${players.length ? players.map(targetRow).join('') : '<p class="live-empty">Ты первый на Периметре. Новые игроки появятся в общей зоне.</p>'}</section><section class="live-roster"><h3>Дикие поблизости <span>${scavs.length}</span></h3>${scavs.length ? scavs.map(targetRow).join('') : '<p class="live-empty">Рядом тихо. Продолжай осматривать Периметр.</p>'}</section><details class="live-events"><summary>Эфир Периметра · ${snapshot.events.length}</summary><div>${snapshot.events.slice(-12).reverse().map(event => `<article class="${event.kind === 'combat' ? 'combat' : ''}"><time>${new Date(event.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time><span>${escape(event.text)}</span></article>`).join('')}</div></details><p class="live-stash-note">Онлайн склад: ${integer(snapshot.self.stash)} ₽ · Побед: ${integer(snapshot.self.kills)}<br>Вынеси груз через зелёный выход. Склад хранится на сервере.</p><button class="text-button live-back" data-live-button="exit">← Выйти с сервера в убежище</button></div>`;
    }
    const body = dock.querySelector<HTMLElement>('.live-dock-scroll'); if (body) body.scrollTop = scroll;
    const events = dock.querySelector<HTMLDetailsElement>('.live-events'); if (events) events.open = eventsOpen;
    if (focused) Array.from(dock.querySelectorAll<HTMLElement>('[data-live-button]')).find(button => button.dataset.liveButton === focused)?.focus({ preventScroll: true });
    else if (eventsFocused) dock.querySelector<HTMLElement>('.live-events summary')?.focus({ preventScroll: true });
  }

  function move(dx: number, dy: number): void {
    const self = snapshot?.entities.find(entity => entity.id === snapshot!.selfId);
    if (!self || self.health <= 0 || !snapshot || offline || actionBusy) return;
    const x = self.x + dx, y = self.y + dy;
    if (x >= 0 && y >= 0 && x < snapshot.world.width && y < snapshot.world.height) void send({ type: 'move', x, y });
  }

  const click = (event: MouseEvent): void => {
    if (!active) return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-live-button]');
    if (!button || !dock.contains(button) || button.disabled) return;
    const [action, ...arguments_] = (button.dataset.liveButton ?? '').split(':');
    const id = arguments_.join(':'), dy = arguments_[1];
    if (action === 'join') void join();
    else if (action === 'exit') options.onExit();
    else if (action === 'account') options.onAccount();
    else if (action === 'select' && id) { selectedId = id; scene.setSelected(id); render(); }
    else if (action === 'attack' && id) void send({ type: 'attack', targetId: id });
    else if (action === 'loot' && id) void send({ type: 'loot', id });
    else if (action === 'move') move(Number(arguments_[0]), Number(dy));
    else if (action === 'patrol' && snapshot) void send({ type: 'patrol', enabled: !snapshot.self.patrol });
    else if (action === 'heal' || action === 'extract' || action === 'respawn') void send({ type: action });
  };
  const keyboard = (event: KeyboardEvent): void => {
    if (!active || !snapshot || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('#modal-root .modal, .account-dialog, [role="dialog"][aria-modal="true"]')) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]') || !target || !(world.contains(target) || dock.contains(target))) return;
    const moves: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], ц: [0, -1], s: [0, 1], ы: [0, 1], a: [-1, 0], ф: [-1, 0], d: [1, 0], в: [1, 0] };
    const direction = moves[event.key] ?? moves[event.key.toLowerCase()];
    if (!direction) return;
    event.preventDefault();
    if (performance.now() - lastKeyboardAt < 350) return;
    lastKeyboardAt = performance.now(); move(...direction);
  };
  dock.addEventListener('click', click); document.addEventListener('keydown', keyboard);
  return { show, hide, refreshPanel, resetIdentity, isActive: () => active, isActionPending: () => actionBusy, destroy: () => { hide(); destroyed = true; generation++; dock.removeEventListener('click', click); document.removeEventListener('keydown', keyboard); scene.destroy(); overlay.remove(); } };
}


