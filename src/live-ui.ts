import { LIVE_CAPACITY, LIVE_SERVER_NAME, type LiveCommand, type LiveEntity, type LiveMapId, type LiveSnapshot, type LiveStatus } from './game/live';
import { hasLiveLineOfSight, isLiveMapId } from './game/live-maps';
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
  let selectedMap: LiveMapId = 'customs';
  const { world, dock } = options;
  world.classList.add('live-world');
  world.hidden = true;
  const overlay = document.createElement('div'); overlay.className = 'live-world-overlay';
  const scene = new LiveScene(world, command => void send(command), id => { selectedId = id; render(); });
  world.append(overlay);
  const identity = (): LiveIdentity => ({ accountId: identityAccount, ...(snapshot ? { playerId: snapshot.selfId } : {}) });
  const isCurrent = (version: number, account: string | null) => active && !destroyed && version === generation && account === options.getAccountId();
  const stopRequest = () => { window.clearTimeout(pollTimer); pollTimer = 0; controller?.abort(); controller = null; requestBusy = false; actionBusy = false; };
  const schedule = (version: number) => { window.clearTimeout(pollTimer); if (active && version === generation && !destroyed) pollTimer = window.setTimeout(() => void poll(), snapshot ? 500 : 2000); };
  const clearSession = () => { snapshot = null; receivedAt = 0; selectedId = null; scene.clear(); };
  const acceptSnapshot = (next: LiveSnapshot) => {
    if (snapshot?.world.id !== next.world.id) { selectedId = null; scene.setSelected(null); }
    else if (selectedId && !next.entities.some(entity => entity.id === selectedId && entity.health > 0)) selectedId = null;
    snapshot = next; status = next.server; receivedAt = Date.now(); scene.update(next);
  };

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
        acceptSnapshot(next);
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
    const version = ++generation, account = identityAccount = options.getAccountId(), requestedMap = selectedMap;
    reconnectPresence = reconnecting;
    requestBusy = true; actionBusy = true; message = reconnecting ? 'Связь с сервером восстановлена. Подключаемся к Периметру снова.' : ''; offline = false; render();
    try {
      const result = connection.then(async () => {
        if (!isCurrent(version, account)) return null;
        const joined = await liveRequest('join', { accountId: account }, readLiveSnapshot, undefined, undefined, reconnecting ? undefined : requestedMap);
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
      reconnectPresence = false;
      message = !reconnecting && next.world.id !== requestedMap ? `Боец вернулся на карту «${next.world.name}», где был сохранён. Перейти на другую карту можно у зелёного выхода.` : '';
      acceptSnapshot(next); scene.setSelected(null);
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
      acceptSnapshot(next); offline = false;
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
    const header = `<header class="live-dock-head"><div><span class="live-eyebrow">МУЛЬТИПЛЕЕР · 3 КАРТЫ · 1 СЕРВЕР</span><h2>${escape(snapshot?.world.name ?? server?.name ?? LIVE_SERVER_NAME)}</h2></div><span class="live-online ${offline ? 'lost' : ''}"><i></i>${server ? `${server.online}/${server.capacity}` : `—/${LIVE_CAPACITY}`}</span></header>`;
    const notice = message ? `<p class="live-notice ${offline ? 'lost' : ''}" role="status">${escape(message)}</p>` : '';
    const mapCards = (travel = false) => (server?.maps ?? []).filter(map => !travel || map.id !== snapshot?.world.id).map(map => `<button class="live-map-card theme-${map.theme} ${!travel && map.id === selectedMap ? 'selected' : ''}" data-live-button="${travel ? 'travel' : 'map'}:${map.id}" ${travel && (actionBusy || offline || !snapshot || snapshot.self.travelReadyAt > snapshot.now) ? 'disabled' : ''} ${!travel ? `aria-pressed="${map.id === selectedMap}"` : ''}><span class="live-map-icon" aria-hidden="true">${map.theme === 'forest' ? '♠' : map.theme === 'urban' ? '▤' : '▦'}</span><span><strong>${escape(map.name)}</strong><small>${map.online} игроков · ${map.npcs} NPC · ${map.width}×${map.height}</small>${!travel ? `<p>${escape(map.description)}</p>` : ''}</span>${travel ? '<b aria-hidden="true">→</b>' : ''}</button>`).join('');
    if (!snapshot) {
      overlay.innerHTML = '<div class="live-lobby-scene"><span class="live-eyebrow">ПО ТУ СТОРОНУ УБЕЖИЩА</span><h2>Три карты.<br>Один живой мир.</h2><p>Склады Таможни, лесные тропы Лесопилки и тесные платформы Депо. В каждой зоне встречаются реальные игроки, дикие и рейдеры.</p><div class="live-lobby-model" aria-hidden="true"></div><span class="live-lobby-tag"><i></i>БЕСКОНЕЧНЫЙ PvPvE</span></div>';
      dock.innerHTML = `${header}<div class="live-dock-scroll">${notice}<div class="live-server-label"><i></i>${offline ? 'Связь восстанавливается' : server ? 'Общий сервер на связи' : 'Проверяем связь'}</div><h3 class="live-map-title">Выбери первую карту</h3><div class="live-map-list">${mapCards()}</div><button class="button primary live-join" data-live-button="join" ${actionBusy || offline || !server || server.online >= server.capacity ? 'disabled' : ''}>${actionBusy ? 'Входим на Периметр…' : server && server.online >= server.capacity ? 'Сервер заполнен' : `Войти · ${escape(server?.maps.find(map => map.id === selectedMap)?.name ?? 'Таможня')}`}</button><p class="live-controls-help">32 места на весь сервер. Карты общие для всех: без конца матча и без ожидания нового рейда.</p><div class="live-kit-note"><strong>Твой боец остаётся в мире</strong><p>Позиция, здоровье и добыча сохраняются на сервере. При повторном входе вернёшься на последнюю карту. Переходы между картами находятся у зелёных выходов.</p>${identityAccount ? '<span>Позывной и склад привязаны к аккаунту.</span>' : '<span>Гостевой позывной сохраняется в этом браузере.</span><button class="text-button" data-live-button="account">Войти в аккаунт →</button>'}</div><button class="text-button live-back" data-live-button="exit">← Вернуться в убежище</button></div>`;
    } else {
      const self = snapshot.entities.find(entity => entity.id === snapshot!.selfId)!;
      const downed = self.health <= 0;
      const estimatedNow = snapshot.now + Math.max(0, Date.now() - receivedAt);
      const remaining = Math.max(0, Math.ceil((snapshot.self.respawnAt - estimatedNow) / 1000));
      const travelRemaining = Math.max(0, Math.ceil((snapshot.self.travelReadyAt - estimatedNow) / 1000));
      const canAct = !downed && !actionBusy && !offline;
      const nearExtract = snapshot.world.extracts.some(point => distance(self, point) <= 1.5);
      const currentMap = snapshot.server.maps.find(map => map.id === snapshot!.world.id)!;
      const zone = [...snapshot.world.zones].reverse().find(zone => self.x >= zone.x && self.x < zone.x + zone.width && self.y >= zone.y && self.y < zone.y + zone.height);
      const danger = zone?.danger ?? 1;
      const nearby = snapshot.entities.filter(entity => entity.id !== self.id).sort((a, b) => distance(self, a) - distance(self, b));
      const selected = nearby.find(entity => entity.id === selectedId);
      const firing = snapshot.self.targetId !== null;
      const targetRow = (entity: LiveEntity) => {
        const range = distance(self, entity), protectedTarget = entity.safeUntil > snapshot!.now;
        const engaged = snapshot!.self.targetId === entity.id;
        const visible = range <= 7 && hasLiveLineOfSight(snapshot!.world, self, entity);
        const faction = entity.kind === 'player' ? 'Игрок' : entity.faction === 'raiders' ? 'Рейдер · NPC' : 'Дикий · NPC';
        const role = entity.role === 'marksman' ? ' · стрелок' : entity.role === 'guard' ? ' · охрана' : '';
        return `<article class="live-person ${entity.kind === 'player' ? 'is-player' : 'is-scav'} ${entity.faction === 'raiders' ? 'is-raider' : ''} ${selectedId === entity.id ? 'selected' : ''} ${engaged ? 'engaged' : ''}"><button class="live-person-select" data-live-button="select:${escape(entity.id)}"><i>${entity.kind === 'player' ? 'И' : entity.faction === 'raiders' ? 'Р' : 'Д'}</i><span><strong>${escape(entity.name)}</strong><small>${faction}${role} · ${range.toFixed(1)} кл. · ${entity.health > 0 ? `${Math.ceil(entity.health)} HP` : 'Ранен'}${protectedTarget ? ' · защита' : range <= 7 && !visible ? ' · укрытие' : ''}</small></span></button><button class="live-attack" data-live-button="attack:${escape(entity.id)}" aria-pressed="${engaged}" ${!canAct || (!engaged && (entity.health <= 0 || !visible || protectedTarget || snapshot!.self.ammo < 1)) ? 'disabled' : ''} aria-label="${engaged ? 'Прекратить огонь по' : 'Открыть огонь по'} ${escape(entity.name)}" title="Приказ вести огонь до 7 клеток при прямой видимости">${engaged ? 'Стоп' : 'Огонь'}</button></article>`;
      };
      overlay.innerHTML = `<div class="live-field-hud"><span class="live-signal ${offline ? 'lost' : ''}"><i></i>${offline ? 'НЕТ СВЯЗИ' : `LIVE · ${currentMap.online} ИГР. · ${currentMap.npcs} NPC`}</span><strong>${escape(snapshot.world.name)} <span>${downed ? 'РАНЕН' : `${Math.ceil(self.health)} HP`}</span></strong><p>${escape(zone?.name ?? snapshot.world.name)} <span class="live-danger danger-${danger}">${'●'.repeat(danger)}${'○'.repeat(3 - danger)}</span></p><p>${downed ? `Возвращение через ${remaining} сек.` : firing ? 'Ведёшь огонь · укрытия блокируют выстрелы' : snapshot.self.patrol ? 'Автопатруль · движение и бой' : 'Нажми на землю · WASD / стрелки'}</p></div><div class="live-field-legend"><span><i class="own"></i>Ты</span><span><i class="player"></i>Игрок</span><span><i class="scav"></i>Дикий</span><span><i class="raider"></i>Рейдер</span><span><i class="extract"></i>Переход</span></div>`;
      scene.setSelected(selectedId);
      const players = nearby.filter(entity => entity.kind === 'player'), scavs = nearby.filter(entity => entity.kind === 'scav' && distance(self, entity) <= 12).slice(0, 8);
      const drops = snapshot.drops.filter(drop => distance(self, drop) <= 1.5);
      dock.innerHTML = `${header}<div class="live-dock-scroll">${notice}<section class="live-self"><div class="live-self-name"><span class="live-eyebrow">ТВОЙ БОЕЦ</span><strong>${escape(self.name)}</strong><small>${downed ? 'Тяжёлое ранение' : self.safeUntil > snapshot.now ? 'Защита после входа' : firing ? 'Ведёт огонь' : self.action === 'combat' ? 'В бою' : self.action === 'moving' ? 'В пути' : 'На позиции'} · ${self.x}, ${self.y}</small></div><div class="live-health" aria-label="Здоровье ${Math.ceil(self.health)} из 100"><i style="width:${self.health}%"></i><span>${Math.ceil(self.health)} / 100 HP</span></div><div class="live-player-kit"><span>Патроны<b>${integer(snapshot.self.ammo)}</b></span><span>Аптечки<b>${integer(snapshot.self.medkits)}</b></span><span>При себе<b>${integer(snapshot.self.cargo)} ₽</b></span><span>На складе<b>${integer(snapshot.self.stash)} ₽</b></span></div></section>${downed ? `<section class="live-downed"><strong>Боец ранен</strong><p>Добыча осталась на карте. Новый комплект готовится.</p><button class="button primary" data-live-button="respawn" ${remaining > 0 || actionBusy || offline ? 'disabled' : ''}>${remaining > 0 ? `Вернуться через ${remaining} сек.` : 'Вернуться на карту'}</button></section>` : `<section class="live-orders"><div class="live-actions"><button class="button" data-live-button="patrol" aria-pressed="${snapshot.self.patrol}" ${!canAct ? 'disabled' : ''}>${snapshot.self.patrol ? 'Патруль: вкл.' : 'Автопатруль'}</button><button class="button" data-live-button="heal" ${!canAct || snapshot.self.medkits < 1 || self.health >= 100 ? 'disabled' : ''}>Аптечка +45 HP</button>${firing ? `<button class="button live-cease" data-live-button="cease" ${!canAct ? 'disabled' : ''}>Прекратить огонь</button>` : ''}</div><button class="button primary live-extract" data-live-button="extract" ${!canAct || !nearExtract ? 'disabled' : ''}>${nearExtract ? 'Сдать груз · пополнить комплект' : 'Доберись до зелёного выхода'}</button><p class="live-controls-help">Выбери бойца и нажми «Огонь» — стрельба продолжится, пока цель в поле зрения. Пробел — огонь / стоп, E — аптечка. Потяни карту для обзора.</p><div class="live-direction-pad" aria-label="Передвижение бойца"><button data-live-button="move:0:-1" aria-label="На север" ${!canAct ? 'disabled' : ''}>↑</button><button data-live-button="move:-1:0" aria-label="На запад" ${!canAct ? 'disabled' : ''}>←</button><span>ХОД</span><button data-live-button="move:1:0" aria-label="На восток" ${!canAct ? 'disabled' : ''}>→</button><button data-live-button="move:0:1" aria-label="На юг" ${!canAct ? 'disabled' : ''}>↓</button></div></section>`}${nearExtract && !downed ? `<section class="live-transfers"><h3>Переход на другую карту</h3><p>${travelRemaining ? `Переход готов через ${travelRemaining} сек.` : 'Груз уйдёт на склад. Здоровье, патроны и аптечки останутся с тобой.'} После боя подожди 8 секунд.</p>${mapCards(true)}</section>` : ''}${selected ? `<section class="live-target"><h3>Выбранная цель</h3>${targetRow(selected)}</section>` : ''}${drops.length ? `<section class="live-roster"><h3>Добыча рядом</h3>${drops.map(drop => `<button class="live-loot" data-live-button="loot:${escape(drop.id)}" ${!canAct ? 'disabled' : ''}><span>Подобрать груз</span><strong>${integer(drop.amount)} ₽</strong></button>`).join('')}</section>` : ''}<section class="live-roster"><h3>Игроки на карте <span>${players.length}</span></h3>${players.length ? players.map(targetRow).join('') : '<p class="live-empty">Другие игроки пока в соседних зонах или не вошли на сервер.</p>'}</section><section class="live-roster"><h3>NPC поблизости <span>${scavs.length}</span></h3>${scavs.length ? scavs.map(targetRow).join('') : '<p class="live-empty">Рядом тихо. На карте есть охрана и патрули. Осмотрись через «Вся карта».</p>'}</section><details class="live-events"><summary>Эфир карты · ${snapshot.events.length}</summary><div>${snapshot.events.slice(-12).reverse().map(event => `<article class="${event.kind === 'combat' ? 'combat' : ''}"><time>${new Date(event.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time><span>${escape(event.text)}</span></article>`).join('')}</div></details><p class="live-stash-note">На складе: ${integer(snapshot.self.stash)} ₽ · Побед: ${integer(snapshot.self.kills)}<br>Три общие карты. Позиция и добыча сохраняются на сервере.</p><button class="text-button live-back" data-live-button="exit">← Выйти с сервера в убежище</button></div>`;
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
    else if (action === 'map' && isLiveMapId(id)) { selectedMap = id; render(); }
    else if (action === 'travel' && isLiveMapId(id)) void send({ type: 'travel', mapId: id });
    else if (action === 'exit') options.onExit();
    else if (action === 'account') options.onAccount();
    else if (action === 'select' && id) { selectedId = id; scene.setSelected(id); render(); }
    else if (action === 'attack' && id && snapshot) void send({ type: 'engage', targetId: snapshot.self.targetId === id ? null : id });
    else if (action === 'cease') void send({ type: 'engage', targetId: null });
    else if (action === 'loot' && id) void send({ type: 'loot', id });
    else if (action === 'move') move(Number(arguments_[0]), Number(dy));
    else if (action === 'patrol' && snapshot) void send({ type: 'patrol', enabled: !snapshot.self.patrol });
    else if (action === 'heal' || action === 'extract' || action === 'respawn') void send({ type: action });
  };
  const keyboard = (event: KeyboardEvent): void => {
    if (!active || !snapshot || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('#modal-root .modal, .account-dialog, [role="dialog"][aria-modal="true"]')) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]') || !target || !(world.contains(target) || dock.contains(target))) return;
    if ((event.code === 'Space' && target.tagName === 'CANVAS') || event.key.toLowerCase() === 'e' || event.key.toLowerCase() === 'у') {
      event.preventDefault();
      if (event.repeat) return;
      if (event.code === 'Space' && selectedId) void send({ type: 'engage', targetId: snapshot.self.targetId === selectedId ? null : selectedId });
      else if (event.code !== 'Space') void send({ type: 'heal' });
      return;
    }
    const moves: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], ц: [0, -1], s: [0, 1], ы: [0, 1], a: [-1, 0], ф: [-1, 0], d: [1, 0], в: [1, 0] };
    const direction = moves[event.key] ?? moves[event.key.toLowerCase()];
    if (!direction) return;
    event.preventDefault();
    if (performance.now() - lastKeyboardAt < 350) return;
    lastKeyboardAt = performance.now(); move(...direction);
  };
  dock.addEventListener('click', click); document.addEventListener('keydown', keyboard);
  return { show, hide, refreshPanel, resetIdentity, isActive: () => active, destroy: () => { hide(); destroyed = true; generation++; dock.removeEventListener('click', click); document.removeEventListener('keydown', keyboard); scene.destroy(); overlay.remove(); } };
}


