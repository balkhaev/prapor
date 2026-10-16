import { LIVE_CAPACITY, LIVE_SERVER_NAME, liveMedicalSupplyNeeded, type LiveCommand, type LiveDistrictId, type LivePurpose, type LiveSnapshot, type LiveStatus } from './game/live';
import { isLiveWalkable } from './game/live-maps';
import { BODY_PARTS, BODY_PART_LABELS, TREATMENT_DURATION_MS, TREATMENT_LABELS, canTreat, injuryEffects, selectTreatment, type BodyPart, type TreatmentType } from './game/health';
import { LiveApiError, liveRequest, readLiveEntry, readLiveSnapshot, readLiveStatus, shouldRejoinLivePresence, type LiveIdentity } from './live-client';
import { isLiveKitId, type LiveEntry, type LiveKitId } from './game/live-entry';
import { LiveScene } from './live-scene';
import { liveEconomyChanged, liveLootCargo } from './live-loot-ui';
import './live.css';
import './boss.css';
import './autobattle.css';
import { liveBossRoster, liveBossGuidance, readLiveBossRoute, getLiveBossHuntGuide } from './live-boss-ui';
import { raidEntryMap, raidEntryPurposeName } from './raid-entry-ui';
import { liveAutobattlePanel, liveAutobattleStatus, liveObservedContact } from './live-autobattle-ui';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const integer = (value: number) => Math.floor(value).toLocaleString('ru-RU');
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const inside = (point: { x: number; y: number }, area: { x: number; y: number; width: number; height: number }) => point.x >= area.x && point.y >= area.y && point.x < area.x + area.width && point.y < area.y + area.height;
const districtId = (value: string): value is LiveDistrictId => ['customs', 'sawmill', 'depot', 'village'].includes(value);
const purposes: Record<LivePurpose, { name: string; description: string; tags: string[] }> = {
  pvp: { name: 'PvP · игроки', description: 'Ищи встречи на дорогах и в горячих точках.', tags: ['contested'] },
  pve: { name: 'PvE · NPC', description: 'Осмотри посты охраны и позиции диких.', tags: ['contested', 'camp'] },
  loot: { name: 'Добыча', description: 'Обыскивай сумки, шкафы, куртки и ящики.', tags: ['search'] },
  boss: { name: 'Охота на босса', description: 'Подготовься к главарю района, забери ценный груз и доставь его у выхода.', tags: ['contested'] },
  quests: { name: 'Задания', description: 'Разведай места для будущих поручений.', tags: ['quests', 'documents', 'medicine', 'visit'] },
};
const citySiteKinds = { courtyard: 'Жилой двор', arcade: 'Сквозной проход', workyard: 'Двор мастерских', 'service-yard': 'Служебный двор' } as const;

export interface LiveModeOptions {
  world: HTMLElement;
  dock: HTMLElement;
  /** A sibling of auxiliary windows keeps raid controls available above them. */
  hudRoot?: HTMLElement;
  onExit: () => void;
  onAccount: () => void;
  getAccountId: () => string | null;
  getGameId: () => string | null;
  isGameReady?: () => boolean;
  getStock?: () => { ammo: number; medicine: number; money?: number } | null;
  onMarket: () => void;
  onMissionBoard?: () => void;
  onEconomyChange?: () => void;
  onError?: (message: string) => void;
  /** Injectable presentation and transport let tests exercise response races. */
  sceneFactory?: (world: HTMLElement, command: (command: LiveCommand) => void, select: (id: string) => void) => Pick<LiveScene, 'show' | 'hide' | 'clear' | 'setSelected' | 'update' | 'destroy'> & Partial<Pick<LiveScene, 'setRoute' | 'focusPoint'>>;
  fetch?: typeof globalThis.fetch;
}

/** One server connection per visible mode. Mutations are never automatically replayed. */
export function createLiveMode(options: LiveModeOptions) {
  let active = false, destroyed = false, generation = 0, requestBusy = false, actionBusy = false;
  let identityAccount: string | null = null, snapshot: LiveSnapshot | null = null, status: LiveStatus | null = null;
  let entry: LiveEntry | null = null, entryReceivedAt = 0, selectedKit: LiveKitId = 'scav';
  let identityGame: string | null = null;
  let message = '', offline = false, selectedId: string | null = null, receivedAt = 0;
  let revealContacts = false;
  let selectedPart: BodyPart = 'chest';
  let pollTimer = 0;
  let controller: AbortController | null = null;
  let connection: Promise<unknown> = Promise.resolve();
  let reconnectPresence = false;
  let selectedDistrict: LiveDistrictId = 'customs', selectedPurpose: LivePurpose = 'loot';
  let selectedRouteId: string | null = null;
  let selectedBossId:string|null=null;
  let exitIntent = false;
  const { world, dock } = options;
  world.classList.add('live-world');
  world.hidden = true;
  const overlay = document.createElement('div'); overlay.className = 'live-world-overlay';
  const raidStatus = document.createElement('section'); raidStatus.className = 'field-raid-status'; raidStatus.hidden = true;
  raidStatus.setAttribute('aria-label', 'Боец на Периметре: состояние и возвращение');
  const scene = (options.sceneFactory ?? ((host, command, select) => new LiveScene(host, command, select)))(world, command => void send(command), id => { selectedId = id; revealContacts = true; render(); });
  world.append(overlay);
  (options.hudRoot ?? world).append(raidStatus);
  const identity = (): LiveIdentity => ({ accountId: identityAccount, gameId: identityGame, ...(snapshot ? { playerId: snapshot.selfId, worldVersion: snapshot.worldVersion } : {}) });
  const isCurrent = (version: number, account: string | null, game: string | null) => active && !destroyed && version === generation && account === options.getAccountId() && game === options.getGameId();
  const identityChanged = () => identityAccount !== options.getAccountId() || identityGame !== options.getGameId();
  const stopRequest = () => { window.clearTimeout(pollTimer); pollTimer = 0; controller?.abort(); controller = null; requestBusy = false; actionBusy = false; };
  const schedule = (version: number) => { window.clearTimeout(pollTimer); if (active && version === generation && !destroyed) pollTimer = window.setTimeout(() => void poll(), snapshot ? 500 : 2000); };
  const clearSession = () => { snapshot = null; entry = null; entryReceivedAt = 0; receivedAt = 0; selectedId = null; selectedRouteId = null; exitIntent = false; scene.clear(); };
  const acceptSnapshot = (next: LiveSnapshot, command?: LiveCommand) => {
    if (next.self.gameId && next.self.gameId !== identityGame) throw new LiveApiError(401, 'game_identity_changed');
    const economyChanged = liveEconomyChanged(snapshot?.self ?? null, next.self, command?.type);
    if (snapshot?.worldVersion !== next.worldVersion) { selectedId = null; selectedRouteId = null; scene.setSelected(null); }
    if (command?.type === 'respawn') selectedRouteId = null;
    else if (selectedId && !next.entities.some(entity => entity.id === selectedId && entity.health > 0)) selectedId = null;
    snapshot = next; status = next.server; receivedAt = Date.now(); scene.update(next);
    if (command?.type === 'respawn' || next.entities.find(entity => entity.id === next.selfId)!.health <= 0 && entry?.mode !== 'downed') entry = null;
    if (economyChanged || command?.type === 'loot') options.onEconomyChange?.();
  };

  function finishExit(): void {
    clearSession(); hide();
    options.onExit();
  }

  async function leave(): Promise<void> {
    if (!active || actionBusy || destroyed || exitIntent) return;
    if (!snapshot) { finishExit(); return; }
    if (identityChanged()) { resetIdentity(); return; }
    stopRequest(); exitIntent = true;
    const version = ++generation, account = identityAccount, game = identityGame;
    requestBusy = true; actionBusy = true; controller = new AbortController(); message = ''; render();
    try {
      const reply = await liveRequest('leave', identity(), value => {
        if (!value || typeof value !== 'object' || !('ok' in value) || value.ok !== true || 'leaveAt' in value && (typeof value.leaveAt !== 'number' || !Number.isFinite(value.leaveAt) || value.leaveAt < 0)) throw new LiveApiError(0, 'invalid_response');
        return value as { ok: true; leaveAt?: number };
      }, undefined, controller.signal, undefined, options.fetch);
      if (!isCurrent(version, account, game)) return;
      if (!reply.leaveAt) { finishExit(); return; }
      if (snapshot) {
        snapshot = { ...snapshot, now: snapshot.now + (Date.now() - receivedAt), self: { ...snapshot.self, treatment: null, leaveAt: reply.leaveAt } };
        receivedAt = Date.now();
      }
      offline = false;
    } catch (error) {
      if (isCurrent(version, account, game) && exitIntent && error instanceof LiveApiError && error.status === 401 && ['join_required', 'not_joined', 'not_online', 'player_missing'].includes(error.code)) finishExit();
      else explain(error, version, account, game);
    }
    finally { if (version === generation) { controller = null; requestBusy = false; actionBusy = false; render(); schedule(version); } }
  }

  function explain(error: unknown, version: number, account: string | null, game: string | null): void {
    if (!isCurrent(version, account, game)) return;
    const issue = error instanceof LiveApiError ? error : new LiveApiError(0, 'network');
    const changed = message !== issue.message;
    message = issue.message;
    offline = issue.status === 0 || issue.status >= 500;
    if (shouldRejoinLivePresence(issue, account, options.getAccountId(), game, options.getGameId()) && snapshot) {
      reconnectPresence = true;
      clearSession();
    } else if (issue.status === 401 || ['account_changed', 'identity_changed', 'live_identity_changed', 'game_identity_changed', 'not_joined', 'not_online', 'player_missing'].includes(issue.code)) {
      reconnectPresence = false;
      clearSession();
    } else if (reconnectPresence && issue.status >= 400 && issue.status < 500 && issue.status !== 429) reconnectPresence = false;
    if (changed && !reconnectPresence) options.onError?.(message);
  }

  async function poll(): Promise<void> {
    if (!active || destroyed) return;
    if (identityChanged()) { resetIdentity(); return; }
    const version = generation, account = identityAccount, game = identityGame;
    if (requestBusy) { schedule(version); return; }
    if (reconnectPresence && !snapshot) { void join(true); return; }
    requestBusy = true; controller = new AbortController();
    try {
      if (snapshot) {
        const expected = snapshot.selfId;
        const cachedWorld = snapshot.world;
        const next = await liveRequest('state', identity(), value => readLiveSnapshot(value, cachedWorld), undefined, controller.signal, undefined, options.fetch);
        if (!isCurrent(version, account, game)) return;
        if (next.selfId !== expected) throw new LiveApiError(401, 'identity_changed');
        if (exitIntent && next.self.leaveAt === 0) { exitIntent = false; message = 'Выход прерван. Боец остаётся на Периметре.'; }
        acceptSnapshot(next);
        if (next.entities.find(entity => entity.id === next.selfId)!.health <= 0 && game) {
          const preparation = await liveRequest('entry', { accountId: account, gameId: game }, readLiveEntry, undefined, controller.signal, undefined, options.fetch);
          if (!isCurrent(version, account, game)) return;
          entry = preparation; entryReceivedAt = Date.now();
        }
      } else if (game && options.isGameReady?.() !== false) {
        const next = await liveRequest('entry', { accountId: account, gameId: game }, readLiveEntry, undefined, controller.signal, undefined, options.fetch);
        if (!isCurrent(version, account, game)) return;
        entry = next; entryReceivedAt = Date.now(); status = next.server;
        if (next.mode === 'continue' && next.fighter) { selectedDistrict = next.fighter.districtId; selectedPurpose = next.fighter.purpose; }
      } else {
        const next = await liveRequest('status', identity(), readLiveStatus, undefined, controller.signal, undefined, options.fetch);
        if (!isCurrent(version, account, game)) return;
        status = next;
      }
      if (offline) message = '';
      offline = false;
    } catch (error) {
      if (isCurrent(version, account, game) && exitIntent && error instanceof LiveApiError && error.status === 401 && ['join_required', 'not_joined', 'not_online', 'player_missing'].includes(error.code)) finishExit();
      else explain(error, version, account, game);
    }
    finally { if (version === generation) { controller = null; requestBusy = false; render(); schedule(version); } }
  }

  async function join(reconnecting = false): Promise<void> {
    if (!active || actionBusy || destroyed) return;
    if (!options.getGameId() || options.isGameReady?.() === false) { message = 'Подключаемся к убежищу. После подключения можно войти на Периметр с общим складом и барахолкой.'; render(); return; }
    stopRequest();
    if (!reconnecting && (!entry || entry.mode !== 'continue' && entry.kits.find(kit => kit.kitId === selectedKit)?.reason)) { message = 'Проверь комплект и припасы перед выходом.'; render(); return; }
    const version = ++generation, account = identityAccount = options.getAccountId(), game = identityGame = options.getGameId(), requested = { districtId: selectedDistrict, purpose: selectedPurpose };
    const launchOptions = reconnecting || entry?.mode === 'continue' ? { intent: 'continue' as const } : { ...requested, kitId: selectedKit, intent: 'deploy' as const };
    reconnectPresence = reconnecting;
    requestBusy = true; actionBusy = true; message = reconnecting ? 'Связь с сервером восстановлена. Подключаемся к Периметру снова.' : ''; offline = false; render();
    try {
      const result = connection.then(async () => {
        if (!isCurrent(version, account, game)) return null;
        const joined = await liveRequest('join', { accountId: account, gameId: game }, readLiveSnapshot, undefined, undefined, launchOptions, options.fetch);
        if (!isCurrent(version, account, game)) {
          // Serialize cleanup before another join can reuse this same player identity.
          await liveRequest('leave', { accountId: account, gameId: game, playerId: joined.selfId }, value => value, undefined, undefined, undefined, options.fetch).catch(() => {});
          return null;
        }
        return joined;
      });
      connection = result.catch(() => {});
      const next = await result;
      if (!next || !isCurrent(version, account, game)) return;
      reconnectPresence = false;
      message = !reconnecting && (next.self.districtId !== requested.districtId || next.self.purpose !== requested.purpose) ? 'Боец продолжает с сохранённой позиции и целью. Новый выбор района применяется при первом входе или возвращении после ранения. Между районами можно ходить пешком.' : '';
      selectedDistrict = next.self.districtId; selectedPurpose = next.self.purpose;
      acceptSnapshot(next); scene.setSelected(null);
      world.querySelector<HTMLCanvasElement>('canvas')?.focus({ preventScroll: true });
    } catch (error) { explain(error, version, account, game); }
    finally { if (version === generation) { requestBusy = false; actionBusy = false; render(); schedule(version); } }
  }

  async function send(command: LiveCommand): Promise<void> {
    if (!active || !snapshot || snapshot.self.launchPending || actionBusy || offline || destroyed) return;
    if (identityChanged()) { resetIdentity(); return; }
    // A command takes priority over a read, so an older poll cannot replace its result.
    stopRequest();
    const version = ++generation, account = identityAccount, game = identityGame, expected = snapshot.selfId;
    requestBusy = true; actionBusy = true; controller = new AbortController(); message = ''; render();
    try {
      const cachedWorld = snapshot.world;
      const next = await liveRequest('action', identity(), value => readLiveSnapshot(value, cachedWorld), command, controller.signal, undefined, options.fetch);
      if (!isCurrent(version, account, game)) return;
      if (next.selfId !== expected) throw new LiveApiError(401, 'identity_changed');
      const interruptedExit = exitIntent && next.self.leaveAt === 0;
      if (interruptedExit) { exitIntent = false; }
      acceptSnapshot(next, command); message = interruptedExit ? 'Выход прерван приказом.' : ['resupply', 'extract', 'respawn', 'loot'].includes(command.type) ? next.self.economyMessage ?? '' : ''; offline = false;
    } catch (error) { explain(error, version, account, game); }
    finally { if (version === generation) { controller = null; requestBusy = false; actionBusy = false; render(); schedule(version); } }
  }

  function resetIdentity(): void {
    generation++; stopRequest(); clearSession(); reconnectPresence = false; identityAccount = options.getAccountId(); identityGame = options.getGameId(); message = ''; offline = false;
    if (active) { render(); void poll(); }
  }

  function show(): void {
    if (destroyed) return;
    if (active) { refreshPanel(); return; }
    active = true; generation++; reconnectPresence = false; identityAccount = options.getAccountId(); identityGame = options.getGameId(); message = ''; offline = false;
    world.hidden = false; scene.show(); render(); void poll();
  }

  function hide(force = false): boolean {
    if (!active) return true;
    if (!force && snapshot && !destroyed && !identityChanged()) { void leave(); return false; }
    const leaving = snapshot ? identity() : null;
    active = false; generation++; stopRequest(); clearSession(); reconnectPresence = false; world.hidden = true; scene.hide(); overlay.innerHTML = ''; raidStatus.hidden = true; raidStatus.innerHTML = '';
    dock.classList.remove('live-dock', 'live-entry-dock'); world.classList.remove('live-preparing');
    if (leaving) connection = connection.then(() => liveRequest('leave', leaving, value => value, undefined, undefined, undefined, options.fetch)).catch(() => {});
    return true;
  }

  function refreshPanel(): void {
    if (!active) return;
    if (identityChanged()) { resetIdentity(); return; }
    render();
  }

  function setEntrySelection(selection: { districtId?: LiveDistrictId; purpose?: LivePurpose }): void {
    if (snapshot || actionBusy || destroyed) return;
    if (selection.districtId && districtId(selection.districtId)) selectedDistrict = selection.districtId;
    if (selection.purpose && Object.hasOwn(purposes, selection.purpose)) selectedPurpose = selection.purpose;
    if (active) render();
  }

  function render(): void {
    if (!active) return;
    dock.classList.remove('context-open', 'raid-dock', 'gameplay-overview'); dock.classList.add('live-dock');
    dock.removeAttribute('role'); dock.removeAttribute('aria-modal'); dock.setAttribute('aria-label', 'Автоматический рейд: состояние бойца и маршрут');
    const shade = document.querySelector<HTMLElement>('#context-shade'); if (shade) shade.hidden = true;
    const scroll = dock.querySelector<HTMLElement>('.live-dock-scroll')?.scrollTop ?? 0;
    const entryScroll = overlay.querySelector<HTMLElement>('.live-entry-scroll')?.scrollTop ?? 0;
    const focusHost = raidStatus.contains(document.activeElement) ? raidStatus : dock.contains(document.activeElement) ? dock : overlay.contains(document.activeElement) ? overlay : null;
    const focused = focusHost ? (document.activeElement as HTMLElement).getAttribute('data-live-button') : null;
    const focusedFieldPanel = focusHost ? (document.activeElement as HTMLElement).getAttribute('data-field-panel') : null;
    const eventsOpen = dock.querySelector<HTMLDetailsElement>('.live-events')?.open ?? false;
    const bossRosterOpen=dock.querySelector<HTMLDetailsElement>('.live-boss-roster')?.open??false;
    const entryBossRosterOpen=overlay.querySelector<HTMLDetailsElement>('.live-boss-roster')?.open??false;
    const medicalOpen=dock.querySelector<HTMLDetailsElement>('.live-medical-fold')?.open??false;
    const goalOpen=dock.querySelector<HTMLDetailsElement>('.live-goal-fold')?.open??false;
    const contactsOpen=dock.querySelector<HTMLDetailsElement>('.live-contact-fold')?.open??false;
    const kitOpen=dock.querySelector<HTMLDetailsElement>('.live-kit-fold')?.open??false;
    const entryMapOpen=overlay.querySelector<HTMLDetailsElement>('.live-entry-map-fold')?.open??false;
    const entryRouteOpen=overlay.querySelector<HTMLDetailsElement>('.live-entry-route-fold')?.open??false;
    const legendOpen=overlay.querySelector<HTMLDetailsElement>('.live-field-legend')?.open??false;
    const focusedSummary = document.activeElement ? ['.live-medical-fold', '.live-goal-fold', '.live-contact-fold', '.live-kit-fold', '.live-entry-map-fold', '.live-entry-route-fold', '.live-field-legend'].find(selector => document.activeElement === focusHost?.querySelector(`${selector} > summary`)) : undefined;
    const eventsFocused = document.activeElement === dock.querySelector('.live-events summary');
    const preparingDowned = !!snapshot && snapshot.entities.find(entity => entity.id === snapshot!.selfId)!.health <= 0;
    const server = !snapshot || preparingDowned ? entry?.server ?? snapshot?.server ?? status : snapshot.server;
    const map = server?.maps[0], city = snapshot?.world.city ?? map?.city;
    const gameReady = !!options.getGameId() && options.isGameReady?.() !== false;
    raidStatus.hidden = !snapshot || preparingDowned;
    if (snapshot && !preparingDowned) {
      const self = snapshot.entities.find(entity => entity.id === snapshot!.selfId)!;
      const auto = liveAutobattleStatus(snapshot);
      const seconds = Math.max(0, Math.ceil((snapshot.self.leaveAt - snapshot.now - Math.max(0, Date.now() - receivedAt)) / 1000));
      const stage = offline ? 'Связь потеряна · восстанавливаем' : exitIntent ? snapshot.self.leaveAt ? seconds > 0 ? `Выход через ${seconds} сек.` : 'Завершаем выход…' : 'Выходим с Периметра…' : auto.label;
      const blocked = actionBusy || offline || !!snapshot.self.launchPending || exitIntent || self.health <= 0;
      raidStatus.innerHTML = `<div class="field-raid-stage stage-${auto.stage}"><i aria-hidden="true"></i><span>${escape(stage)}</span><strong>${escape(auto.goal)}</strong></div><dl class="field-raid-vitals"><div><dt>Здоровье</dt><dd>${Math.ceil(self.health)}<small>%</small></dd></div><div><dt>Боезапас</dt><dd>${integer(snapshot.self.ammo)}</dd></div><div><dt>Груз</dt><dd>${integer(snapshot.self.cargo)}<small>₽</small></dd></div></dl><div class="field-raid-actions"><button data-field-panel="dock" aria-controls="command-dock" aria-expanded="false" aria-label="Сводка">Сводка</button>${auto.complete ? `<button data-live-button="exit" ${blocked ? 'disabled' : ''}>В убежище →</button>` : `<button class="field-raid-recall" data-live-button="recall" ${blocked || auto.stage === 'extract' ? 'disabled' : ''}>${auto.stage === 'extract' ? 'Возвращается →' : 'Вернуть бойца →'}</button>`}</div>`;
    } else raidStatus.innerHTML = '';
    const header = `<header class="live-dock-head"><div><span class="live-eyebrow">ОБЩИЙ МИР</span><h2>${snapshot && !preparingDowned ? 'Твой боец' : 'Периметр 01'}</h2></div><span class="live-online ${offline ? 'lost' : ''}" title="Игроков на общем сервере"><i></i>${server ? `${server.online}/${server.capacity}` : `—/${LIVE_CAPACITY}`}</span><button class="icon-button field-live-close" data-field-close="dock" data-live-button="field-close" aria-label="Свернуть панель рейда">×</button></header>`;
    const notice = message ? `<p class="live-notice ${offline ? 'lost' : ''}" role="status">${escape(message)}</p>` : '';
    const lobbyRoute = server?.routes?.find(route => route.districtId === selectedDistrict && route.purpose === selectedPurpose);
    const lobbyRecommendation = lobbyRoute ? `<section class="live-lobby-route"><span class="live-eyebrow">РЕКОМЕНДУЕМЫЙ МАРШРУТ</span><strong>${escape(lobbyRoute.name)}</strong><p>${escape(lobbyRoute.description)}</p><ol>${lobbyRoute.stops.map(stop => `<li>${escape(stop)}</li>`).join('')}</ol></section>` : '';
    const districtCards = () => (server?.districts ?? []).map(district => `<button class="live-map-card theme-${district.theme} ${district.id === selectedDistrict ? 'selected' : ''}" data-live-button="district:${district.id}" aria-pressed="${district.id === selectedDistrict}" ${actionBusy || entry?.mode === 'continue' ? 'disabled' : ''}><span class="live-map-icon" aria-hidden="true">${district.id === 'village' ? '⌂' : district.theme === 'forest' ? '♠' : district.theme === 'urban' ? '▤' : '▦'}</span><span><strong>${escape(district.name)}</strong><small>${district.online} игроков · ${district.npcs} NPC</small><p>${escape(district.description)}</p></span></button>`).join('');
    const purposeCards = () => Object.entries(purposes).filter(([id])=>id !== 'quests' || selectedPurpose === 'quests').map(([id, goal]) => `<button class="live-purpose-card ${id === selectedPurpose ? 'selected' : ''}" data-live-button="purpose:${id}" aria-pressed="${id === selectedPurpose}" ${actionBusy || entry?.mode === 'continue' ? 'disabled' : ''}><strong>${raidEntryPurposeName(id as LivePurpose)}</strong><small>${goal.description}</small></button>`).join('');
    if (!snapshot || preparingDowned) {
      if (preparingDowned) scene.setRoute?.([]);
      world.classList.add('live-preparing'); dock.classList.add('live-entry-dock');
      const chosenDistrict = server?.districts.find(district => district.id === selectedDistrict);
      const continueRaid = entry?.mode === 'continue';
      const entryNow = entry ? entry.now + Math.max(0, Date.now() - entryReceivedAt) : Date.now();
      const readySeconds = entry?.mode === 'downed' ? Math.max(0, Math.ceil(((entry.fighter?.respawnAt ?? 0) - entryNow) / 1000)) : 0;
      const kit = entry?.kits.find(kit => kit.kitId === selectedKit);
      const kitBlocked = !continueRaid && (!kit || kit.reason !== null);
      const launchPending = entry?.fighter?.launchPending === true;
      const joinLabel = actionBusy ? 'Входим в рейд…' : !gameReady ? 'Подключаемся к убежищу…' : readySeconds > 0 ? `Новый выход через ${readySeconds} сек.` : launchPending ? 'Подтвердить комплект' : continueRaid ? 'Продолжить рейд' : 'Начать рейд';
      const stock = entry?.stock ?? options.getStock?.();
      const kitCards = entry?.kits.map(kit => `<button class="live-entry-kit-card ${selectedKit === kit.kitId ? 'selected' : ''} ${kit.reason ? 'unavailable' : ''}" data-live-button="kit:${kit.kitId}" aria-pressed="${selectedKit === kit.kitId}" ${actionBusy || continueRaid ? 'disabled' : ''}><span>${escape(kit.label)}</span><strong>${escape(kit.weaponName)}</strong><small>${kit.ammo} патронов · ${kit.medkits} аптечки · броня ${Math.round(kit.armorProtection * 100)}%</small><b>${kit.cost.money ? `${integer(kit.cost.money)} ₽` : 'Без оплаты'} <span>+ ${kit.cost.ammo} патр. · ${kit.cost.medicine} лек.</span></b>${kit.reason ? `<em>${escape(kit.reason)}</em>` : ''}</button>`).join('') ?? '';
      const fighterBrief = entry?.fighter && continueRaid ? `<section class="live-entry-fighter"><span class="live-eyebrow">БОЕЦ УЖЕ НА ПЕРИМЕТРЕ</span><strong>${escape(entry.fighter.name)} · ${Math.ceil(entry.fighter.health)}% здоровья</strong><p>${escape(entry.fighter.loadout?.weaponName ?? 'Сохранённый комплект')} · ${integer(entry.fighter.ammo)} патронов · ${entry.fighter.lootCount} предметов · ${integer(entry.fighter.cargo)} ₽ при себе</p><small>Вернёшься на позицию ${entry.fighter.x}, ${entry.fighter.y}. Здоровье, груз и комплект сохраняются; повторной оплаты нет.</small>${launchPending ? '<p role="status">Выдача комплекта ожидает подтверждения. Повторная оплата не потребуется.</p>' : ''}</section>` : preparingDowned || entry?.mode === 'downed' ? '<p class="live-entry-downed" role="status"><strong>Боец получил тяжёлое ранение.</strong> Добыча осталась в мире. Подготовь новый комплект и выбери точку возвращения.</p>' : '';
      overlay.innerHTML = `<section class="live-entry-screen" aria-label="Подготовка выхода в общий мир">
        <header class="live-entry-head"><div><span class="live-eyebrow">ПОДГОТОВКА БОЙЦА</span><h2>Выход в рейд</h2><p>Выбери район, задачу и комплект. Дальше боец действует сам.</p></div><button class="button ghost live-entry-back" data-live-button="exit" aria-label="Вернуться в убежище">← Убежище</button></header>
        <div class="live-entry-scroll">${notice}${fighterBrief}<div class="live-entry-plan">
          <section class="live-entry-step"><h3><b>1</b> Куда идём</h3><p>Выбери район входа.</p><div class="live-map-list live-district-list">${districtCards()}</div><details class="live-entry-map-fold" ${entryMapOpen ? 'open' : ''}><summary>Посмотреть карту района</summary><div class="live-entry-map-caption"><strong>${escape(map?.name ?? LIVE_SERVER_NAME)}</strong></div>${raidEntryMap(server, selectedDistrict, actionBusy || continueRaid)}<p class="live-entry-shared">Один общий мир. Между районами можно пройти пешком.</p></details></section>
          <section class="live-entry-step"><h3><b>2</b> Что делаем</h3><p>Задача определяет маршрут бойца.</p><div class="live-purpose-list">${purposeCards()}</div>${liveBossRoster(server??null,selectedDistrict,selectedPurpose)}</section>
          <section class="live-entry-step"><h3><b>3</b> С чем идём</h3><p>${continueRaid ? 'Твой комплект сохраняется.' : 'Оружие и припасы со склада убежища.'}</p>${!continueRaid ? `<div class="live-entry-kits" aria-label="Боевой комплект">${kitCards}</div>${kit?.reason ? `<p class="live-entry-kit-warning" role="status">${escape(kit.reason)} <button class="text-button" data-live-button="market">Склад и барахолка →</button></p>` : ''}` : ''}<div class="live-entry-stock"><span>На складе<strong>${stock ? integer(stock.ammo) : '—'} патронов</strong></span><span>Медицина<strong>${stock ? integer(stock.medicine) : '—'} лекарств</strong></span></div></section>
        </div>${lobbyRecommendation ? `<details class="live-entry-route-fold" ${entryRouteOpen ? 'open' : ''}><summary>План маршрута · ${escape(lobbyRoute!.name)}</summary>${lobbyRecommendation}</details>` : ''}</div>
        <footer class="live-entry-footer"><div><strong>${escape(chosenDistrict?.name ?? 'Таможня')} · ${raidEntryPurposeName(selectedPurpose)}</strong><small>${continueRaid ? 'Возвращение к сохранённому бойцу. Повторной оплаты нет.' : kit ? `Расход: ${integer(kit.cost.money)} ₽ · ${kit.cost.ammo} патронов · ${kit.cost.medicine} лекарств` : 'Проверяем комплект и припасы…'}</small></div><button class="button primary live-join" data-live-button="${preparingDowned ? 'respawn' : 'join'}" ${actionBusy || offline || !server || !gameReady || !entry || kitBlocked || readySeconds > 0 ? 'disabled' : ''}>${joinLabel}<span>${continueRaid ? 'К своему бойцу →' : 'Отправить бойца →'}</span></button></footer>
      </section>`;
      dock.innerHTML = `${header}<div class="live-dock-scroll"><section class="live-entry-brief"><span class="live-server-label"><i></i>${offline ? 'Восстанавливаем связь' : server ? `На связи · ${server.online} / ${server.capacity} игроков` : 'Проверяем сервер'}</span><h3>Подготовь.<br>Наблюдай.<br>Верни с добычей.</h3><p>Боец сам идёт по маршруту, сражается, лечится и собирает груз.</p><div class="live-entry-camera-note"><strong>Карта под рукой</strong><p>Зажми левую кнопку мыши и тяни карту. Колесо меняет масштаб. Кнопка «Боец» вернёт камеру к нему.</p></div><p class="live-entry-risk">При тяжёлом ранении груз остаётся в мире. Чтобы сохранить находки, нажми «Вернуть бойца» и дождись выхода.</p>${identityAccount ? '<small>Позывной и склад привязаны к аккаунту.</small>' : '<button class="text-button" data-live-button="account">Сохранить аккаунт →</button>'}</section>${options.onMissionBoard && !snapshot ? '<button class="button live-mission-board" data-live-button="missions">Люди убежища →</button>' : ''}<button class="text-button live-back" data-live-button="exit">← Вернуться в убежище</button></div>`;
    } else {
      world.classList.remove('live-preparing'); dock.classList.remove('live-entry-dock');
      const self = snapshot.entities.find(entity => entity.id === snapshot!.selfId)!;
      const downed = self.health <= 0;
      const estimatedNow = snapshot.now + Math.max(0, Date.now() - receivedAt);
      const body = snapshot.self.body, medicine = snapshot.self.medicine, treatment = snapshot.self.treatment;
      const serverNow = estimatedNow, effects = injuryEffects(body, serverNow);
      const treatmentSeconds = treatment ? Math.max(0, Math.ceil((treatment.endsAt - serverNow) / 1000)) : 0;
      const leavingSeconds = Math.max(0, Math.ceil((snapshot.self.leaveAt - serverNow) / 1000));
      const leavingLabel = exitIntent ? snapshot.self.leaveAt ? leavingSeconds > 0 ? `Выход через ${leavingSeconds} сек.` : 'Завершаем выход…' : 'Выходим с Периметра…' : '';
      const leavingNotice = exitIntent ? `<p class="live-notice live-leaving" role="status"><strong>${leavingLabel}</strong><br>Боец остаётся в опасной зоне. Движение, стрельба или лечение отменят выход.</p>` : '';
      const totalHP = BODY_PARTS.reduce((sum, part) => sum + body.parts[part].hp, 0), maxHP = BODY_PARTS.reduce((sum, part) => sum + body.parts[part].maxHp, 0);
      const canAct = !downed && snapshot.self.automation?.stage !== 'complete' && !snapshot.self.launchPending && !actionBusy && !offline;
      const nearExtract = snapshot.world.extracts.some(point => distance(self, point) <= 1.5);
      const stock = options.getStock?.() ?? null;
      const ammoLimit = snapshot.self.loadout?.maxAmmo ?? 60;
      const ammoTake = stock ? Math.min(stock.ammo, Math.max(0, ammoLimit - snapshot.self.ammo)) : null;
      const medicineNeed = liveMedicalSupplyNeeded(medicine);
      const medicineTake = stock ? Math.min(stock.medicine, medicineNeed) : null;
      const supplied = snapshot.self.ammo >= ammoLimit && medicineNeed === 0;
      const emptyStock = stock !== null && !ammoTake && !medicineTake;
      const resupply = snapshot.self.gameId && nearExtract ? `<div class="live-resupply"><button class="button" data-live-button="resupply" ${!canAct || supplied || emptyStock ? 'disabled' : ''}>${supplied ? 'Комплект пополнен' : 'Пополнить из убежища'}</button><small>${stock ? `Со склада: ${integer(stock.ammo)} патронов · ${integer(stock.medicine)} лекарств. ${emptyStock && !supplied ? 'Нужны припасы на складе.' : !supplied ? `Заберёшь: патроны +${ammoTake}, лекарства +${medicineTake}.` : ''}` : 'Патроны и лекарства расходуются со склада убежища.'}</small></div>` : '';
      const district = snapshot.world.districts.find(district => district.id === snapshot!.self.districtId)!;
      const inCity = !!city && inside(self, city), quarter = inCity ? city?.quarters.find(quarter => inside(self, quarter)) : undefined;
      const currentSite = snapshot.world.citySites?.find(site => inside(self, site));
      const currentBuilding = currentSite?.buildings.find(building => inside(self, building));
      const locationName = inCity ? city!.name : district.name;
      const zone = [...snapshot.world.zones].reverse().find(zone => self.x >= zone.x && self.x < zone.x + zone.width && self.y >= zone.y && self.y < zone.y + zone.height);
      const danger = zone?.danger ?? 1;
      const nearby = snapshot.entities.filter(entity => entity.id !== self.id).sort((a, b) => distance(self, a) - distance(self, b));
      const selected = nearby.find(entity => entity.id === selectedId);
      const urgent = selectTreatment(body, medicine, serverNow);
      const injured = BODY_PARTS.some(part=>body.parts[part].hp < body.parts[part].maxHp || body.parts[part].bleeding !== 'none' || body.parts[part].fracture);
      const medicalPanel = `<section class="live-medical"><h3>Тело и медицина <span>${Math.ceil(totalHP)} / ${Math.ceil(maxHP)} HP</span></h3><div class="live-body-parts" aria-label="Выбор части тела">${BODY_PARTS.map(part => {
        const state = body.parts[part], signs = [state.hp <= 0 ? 'выбита' : '', state.bleeding === 'heavy' ? 'тяжёлое кровотечение' : state.bleeding === 'light' ? 'лёгкое кровотечение' : '', state.fracture ? 'перелом' : ''].filter(Boolean).join(' · ');
        return `<button class="live-body-part ${selectedPart === part ? 'selected' : ''} ${state.hp <= 0 || state.bleeding === 'heavy' ? 'critical' : signs ? 'injured' : ''}" data-live-button="part:${part}" aria-pressed="${selectedPart === part}"><span>${BODY_PART_LABELS[part]}<b>${Math.ceil(state.hp)} / ${state.maxHp}</b></span><i style="--part-health:${state.hp / state.maxHp * 100}%"></i><small>${signs || 'Без ранений'}</small></button>`;
      }).join('')}</div><p class="live-medical-effects">${effects.movement < 1 ? `Ход ${Math.round(effects.movement * 100)}% · ` : ''}${effects.aim < 1 ? `Точность ${Math.round(effects.aim * 100)}% · ` : ''}${body.painUntil > serverNow ? 'Обезболивание действует' : 'Движение и огонь прерывают лечение'}</p>${treatment ? `<div class="live-treatment" role="status"><strong>${TREATMENT_LABELS[treatment.type]} · ${BODY_PART_LABELS[treatment.part]}</strong><span>${treatmentSeconds > 0 ? `${treatmentSeconds} сек.` : 'Завершаем…'}</span><button class="text-button" data-live-button="cancelTreatment" ${actionBusy || offline ? 'disabled' : ''}>Отменить</button></div>` : urgent && !downed ? `<button class="button live-urgent-treatment" data-live-button="treat:${urgent.type}:${urgent.part}" ${!canAct ? 'disabled' : ''}>Срочно: ${TREATMENT_LABELS[urgent.type]} · ${BODY_PART_LABELS[urgent.part]}</button>` : ''}<div class="live-medicines">${(['bandage', 'tourniquet', 'medkit', 'splint', 'painkiller', 'surgery'] as TreatmentType[]).map(type => `<button data-live-button="treat:${type}:${selectedPart}" ${!canAct || treatment || !canTreat(body, medicine, type, selectedPart, serverNow).ok ? 'disabled' : ''}><strong>${TREATMENT_LABELS[type]}</strong><span>${medicine[type]}${type === 'medkit' ? ' HP' : ' прим.'} · ${Math.ceil(TREATMENT_DURATION_MS[type] * effects.treatment / 1000)} сек.</span></button>`).join('')}</div><p class="live-medical-help">${BODY_PART_LABELS[selectedPart]} выбрана. Аптечка лечит живую зону. Хирургия возвращает выбитую конечность или живот к 1 HP и уменьшает её максимум.</p></section>`;
      const purpose = purposes[snapshot.self.purpose];
      const auto = liveAutobattleStatus(snapshot);
      overlay.innerHTML = `<div class="live-field-hud"><span class="live-world-signal ${offline ? 'lost' : ''}"><i></i>${offline ? 'НЕТ СВЯЗИ' : auto.complete ? 'РЕЙД ЗАВЕРШЁН' : auto.enabled ? 'АВТОБОЙ · ПРЯМОЙ ЭФИР' : 'АВТОБОЙ · ОЖИДАНИЕ'}</span><strong>${escape(locationName)}</strong><p>${escape(currentBuilding?.name ?? currentSite?.name ?? quarter?.name ?? zone?.name ?? locationName)} <span class="live-danger danger-${danger}" aria-label="Опасность ${danger} из 3">${'●'.repeat(danger)}${'○'.repeat(3 - danger)}</span></p></div><p class="live-pan-help">Тяни карту мышью · Колесо — масштаб</p><details class="live-field-legend" ${legendOpen ? 'open' : ''}><summary>Обозначения карты</summary><div class="live-legend-items"><span><i class="own"></i>Твой боец</span><span><i class="player"></i>Игрок</span><span><i class="scav"></i>Дикий</span><span><i class="raider"></i>Рейдер</span><span><i class="extract"></i>Выход</span></div></details>`;
      scene.setSelected(selectedId);
      const players = nearby.filter(entity => entity.kind === 'player'), scavs = nearby.filter(entity => entity.kind === 'scav').slice(0, 8);
      const suggested = snapshot.world.pois.filter(poi => poi.tags.some(tag => purpose.tags.includes(tag))).sort((a, b) => {
        const preferred = (poi: typeof a) => snapshot!.self.purpose === 'loot' && poi.districtId === snapshot!.self.districtId && poi.tags.includes('peripheral') ? 1 : 0;
        return preferred(b) - preferred(a) || distance(self, a) - distance(self, b);
      }).slice(0, 3);
      const guidance = suggested.length ? suggested : [...snapshot.world.pois].sort((a, b) => distance(self, a) - distance(self, b)).slice(0, 3);
      const routeChoices = snapshot.world.routes?.filter(route => route.purpose === snapshot!.self.purpose) ?? [];
      const route = routeChoices.find(route => route.id === snapshot!.self.automation?.routeId) ?? routeChoices.find(route => route.id === selectedRouteId) ?? routeChoices.find(route => route.districtId === snapshot!.self.districtId);
      if (route) selectedRouteId = route.id;
      const bossGuide=getLiveBossHuntGuide(snapshot,selectedBossId);
      if (bossGuide) selectedBossId = bossGuide.bossId;
      const stops = bossGuide ? snapshot.world.pois.filter(poi=>poi.id===bossGuide.poiId) : snapshot.self.purpose==='boss'?[]:route ? route.poiIds.map(id => snapshot!.world.pois.find(poi => poi.id === id)!) : guidance;
      scene.setRoute?.(!downed ? bossGuide?[bossGuide.poiId]:route?.poiIds ?? [] : []);
      const routePicker = snapshot.self.purpose==='boss'?`<div class="live-route-districts" aria-label="Осмотр главарей на карте">${(snapshot.server.bosses??[]).map(boss=>`<button data-live-button="boss-area:${boss.bossId}" aria-pressed="${boss.bossId===bossGuide?.bossId}">Осмотр: ${escape(boss.name)} · ${escape(snapshot!.world.districts.find(district=>district.id===boss.districtId)?.name??'')}</button>`).join('')}</div>`:routeChoices.length ? `<div class="live-route-districts" aria-label="Район старта рекомендуемого маршрута">${routeChoices.map(choice => `<button data-live-button="route:${escape(choice.id)}" aria-pressed="${choice.id === route?.id}" ${!canAct || auto.complete ? 'disabled' : ''}>${escape(snapshot!.world.districts.find(district => district.id === choice.districtId)!.name)}${city ? ' → город' : ''}</button>`).join('')}</div>` : '';
      const sites = [...snapshot.world.citySites ?? []].sort((a, b) => Number(b.id === currentSite?.id) - Number(a.id === currentSite?.id) || Number(stops.some(poi => poi.id === b.poiId)) - Number(stops.some(poi => poi.id === a.poiId)) || distance(self, a.courtyard) - distance(self, b.courtyard)).slice(0, 3);
      const goalSection = `<section class="live-goal"><h3>${purpose.name} <span>План выхода</span></h3>${routePicker}${route ? `<strong class="live-route-name">${escape(route.name)}</strong><p>${escape(route.description)}</p>` : `<p>${purpose.description}</p>`}${liveBossGuidance(snapshot,stops.map(poi=>poi.id))}<ol class="live-route-stops">${stops.map((poi, index) => `<li class="${index < auto.stopIndex ? 'passed' : index === auto.stopIndex ? 'current' : ''}"><b>${index + 1}</b><span><strong>${escape(poi.name)}</strong><small>${distance(self, poi).toFixed(0)} клеток по карте</small></span><button data-live-button="poi-view:${escape(poi.id)}" aria-label="Рассмотреть ${escape(poi.name)}">◎</button></li>`).join('')}</ol>${sites.length ? `<h4>Дворы и проходы</h4>${sites.map(site=>`<button class="live-site-observe" data-live-button="site-view:${escape(site.id)}"><span>${escape(site.name)}<small>${citySiteKinds[site.kind]} · ${site.buildings.length} зданий</small></span><b>◎</b></button>`).join('')}` : ''}<small>Осмотр перемещает камеру. Боец следует своему маршруту.</small></section>`;
      const medicalSection = `<details class="live-medical-fold ${injured?'urgent':''}" ${medicalOpen?'open':''}><summary>${treatment ? 'Боец лечится' : injured ? 'Ранения · нужна помощь' : 'Здоровье и медицина'}<span>${Math.ceil(totalHP)} / ${Math.ceil(maxHP)} HP</span></summary><p class="live-auto-medical-note">В автобою боец сам выбирает лечение. Ручной приказ приостановит автоматический маршрут.</p>${medicalPanel}${!auto.complete ? resupply : ''}</details>`;
      const routeSection = `<details class="live-goal-fold" ${goalOpen?'open':''}><summary>Маршрут и осмотр карты<span>${Math.min(auto.stopIndex, auto.stopCount)} / ${auto.stopCount} точек</span></summary>${goalSection}</details>`;
      const contacts = [...players, ...scavs].filter(entity=>entity.health>0);
      const contactSection = `<details class="live-contact-fold" ${revealContacts && selected || contactsOpen ? 'open' : ''}><summary>Игроки поблизости <span>${players.length} · NPC ${scavs.length}</span></summary>${contacts.length ? contacts.map(entity=>liveObservedContact(entity,self,selectedId)).join('') : '<p class="live-empty">Новых контактов нет. Дальние участники появятся в поле зрения бойца.</p>'}</details>`;
      const selfPanel = `<section class="live-self"><div class="live-self-name"><strong>${escape(self.name)}</strong><small>Здоровье ${Math.ceil(self.health)}%</small></div><div class="live-health" aria-label="Здоровье ${Math.ceil(self.health)} из 100"><i style="width:${self.health}%"></i><span>${Math.ceil(totalHP)} / ${Math.ceil(maxHP)} HP</span></div><div class="live-player-kit"><span>Патроны<b>${integer(snapshot.self.ammo)}</b></span><span>Медицина<b>${integer(medicine.medkit)} <small>HP</small></b></span><span>Груз<b>${integer(snapshot.self.cargo)} <small>₽</small></b></span></div></section>`;
      const kitSection = `<details class="live-kit-fold" ${kitOpen ? 'open' : ''}><summary>Снаряжение<span>${escape(snapshot.self.loadout?.weaponName ?? 'Комплект')}</span></summary><p>${escape(snapshot.self.loadout?.label ?? 'Сохранённый комплект')}</p>${snapshot.self.loadout ? `<p class="live-self-loadout">${escape(snapshot.self.loadout.weaponName)} <span>Дальность ${snapshot.self.loadout.range} · защита ${Math.round(snapshot.self.loadout.armorProtection * 100)}%</span></p>` : ''}<p>Победы: ${integer(snapshot.self.kills)} · Позиция: ${self.x}, ${self.y}</p></details>`;
      dock.innerHTML = `${header}<div class="live-dock-scroll">${notice}${leavingNotice}${snapshot.self.launchPending ? '<p class="live-notice" role="status">Подтверждаем выдачу комплекта. Выход начнётся после подтверждения.</p>' : ''}${liveAutobattlePanel(snapshot, actionBusy || offline || !!snapshot.self.launchPending || exitIntent)}${selfPanel}${!auto.complete || snapshot.self.pendingDelivery?.length ? liveLootCargo(snapshot.self) : ''}${routeSection}${medicalSection}${contactSection}${kitSection}<details class="live-events"><summary>События рейда<span>${snapshot.events.length}</span></summary><div>${snapshot.events.length ? snapshot.events.slice(-12).reverse().map(event => `<article class="${event.kind === 'combat' ? 'combat' : ''}"><time>${new Date(event.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time><span>${escape(event.text)}</span></article>`).join('') : '<p class="live-empty">Здесь появятся контакты и события вылазки.</p>'}</div></details><div class="live-dock-footer"><button class="text-button" data-live-button="market" ${actionBusy || exitIntent ? 'disabled' : ''}>Склад и барахолка →</button>${!auto.complete ? `<button class="text-button live-back" data-live-button="exit" ${actionBusy || exitIntent ? 'disabled' : ''}>${leavingLabel || '← В убежище без эвакуации'}</button>` : ''}<p>Без эвакуации груз остаётся при бойце в мире. При потере связи он ещё 30 секунд под угрозой.</p></div></div>`;
    }
    const bossRoster=dock.querySelector<HTMLDetailsElement>('.live-boss-roster');if(bossRoster)bossRoster.open=selectedPurpose==='boss'||bossRosterOpen;
    const body = dock.querySelector<HTMLElement>('.live-dock-scroll'); if (body) body.scrollTop = scroll;
    const preparationScroll=overlay.querySelector<HTMLElement>('.live-entry-scroll'); if(preparationScroll)preparationScroll.scrollTop=entryScroll;
    const preparationBosses=overlay.querySelector<HTMLDetailsElement>('.live-boss-roster');if(preparationBosses)preparationBosses.open=selectedPurpose==='boss'||entryBossRosterOpen;
    const events = dock.querySelector<HTMLDetailsElement>('.live-events'); if (events) events.open = eventsOpen;
    revealContacts = false;
    if (focused) [...Array.from(focusHost!.querySelectorAll<HTMLElement>('[data-live-button]')),...Array.from(raidStatus.querySelectorAll<HTMLElement>('[data-live-button]')),...Array.from(dock.querySelectorAll<HTMLElement>('[data-live-button]')),...Array.from(overlay.querySelectorAll<HTMLElement>('[data-live-button]'))].find(button => button.dataset.liveButton === focused)?.focus({ preventScroll: true });
    else if (focusedFieldPanel) focusHost!.querySelector<HTMLElement>(`[data-field-panel="${focusedFieldPanel}"]`)?.focus({ preventScroll: true });
    else if (focusedSummary) focusHost?.querySelector<HTMLElement>(`${focusedSummary} > summary`)?.focus({ preventScroll: true });
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
    if (!button || !(dock.contains(button) || overlay.contains(button) || raidStatus.contains(button)) || button.disabled) return;
    const [action, ...arguments_] = (button.dataset.liveButton ?? '').split(':');
    const id = arguments_.join(':'), dy = arguments_[1];
    if (action === 'join') void join();
    else if (action === 'boss-route') { const route=readLiveBossRoute(id);if(route&&!snapshot){selectedDistrict=route.districtId;selectedPurpose=route.purpose;selectedBossId=id;render();} }
    else if (action === 'boss-area'&&snapshot?.self.purpose==='boss'&&snapshot.server.bosses?.some(boss=>boss.bossId===id)){if(snapshot.self.automation){const boss=snapshot.server.bosses.find(boss=>boss.bossId===id)!;scene.focusPoint?.({x:boss.area.x+boss.area.width/2,y:boss.area.y+boss.area.height/2});}else{selectedBossId=id;render();}}
    else if (action === 'kit' && isLiveKitId(id) && entry?.mode !== 'continue' && entry?.kits.some(kit => kit.kitId === id)) { selectedKit = id; render(); }
    else if (action === 'district' && entry?.mode !== 'continue' && districtId(id)) { selectedDistrict = id; render(); }
    else if (action === 'purpose' && entry?.mode !== 'continue' && Object.hasOwn(purposes, id)) { selectedPurpose = id as LivePurpose; render(); }
    else if (action === 'route' && snapshot?.world.routes?.some(route => route.id === id && route.purpose === snapshot!.self.purpose)) { selectedRouteId = id; void send({ type: 'automation', enabled: true, routeId: id }); }
    else if (action === 'auto-toggle' && snapshot) void send({ type: 'automation', enabled: !snapshot.self.automation?.enabled });
    else if (action === 'recall') void send({ type: 'recall' });
    else if (action === 'poi-view' && snapshot) { const poi = snapshot.world.pois.find(poi=>poi.id===id); if(poi) scene.focusPoint?.(poi); }
    else if (action === 'exit') void leave();
    else if (action === 'account') options.onAccount();
    else if (action === 'missions' && !snapshot && !actionBusy) options.onMissionBoard?.();
    else if (action === 'market') options.onMarket();
    else if (action === 'select' && id) { selectedId = id; revealContacts = true; scene.setSelected(id); render(); }
    else if (action === 'attack' && id && snapshot) void send({ type: 'engage', targetId: snapshot.self.targetId === id ? null : id });
    else if (action === 'cease') void send({ type: 'engage', targetId: null });
    else if (action === 'aim' && id) void send({ type: 'attack', targetId: id, aimed: true });
    else if (action === 'part' && BODY_PARTS.includes(id as BodyPart)) { selectedPart = id as BodyPart; render(); }
    else if (action === 'treat' && arguments_[0] && arguments_[1]) void send({ type: 'treat', medicine: arguments_[0] as TreatmentType, part: arguments_[1] as BodyPart });
    else if (action === 'loot' && id) void send({ type: 'loot', id });
    else if (action === 'search' && id) void send({ type: 'search', id });
    else if (action === 'approach' && snapshot) {
      const drop = snapshot.drops.find(drop => drop.id === id);
      if (drop) void send({ type: 'move', x: drop.x, y: drop.y });
    }
    else if (action === 'site-view' && snapshot) {
      const site = snapshot.world.citySites?.find(site => site.id === id);
      if (site) scene.focusPoint?.({ x: site.courtyard.x + site.courtyard.width / 2, y: site.courtyard.y + site.courtyard.height / 2 });
    }
    else if (action === 'poi' && snapshot) {
      const poi = snapshot.world.pois.find(poi => poi.id === id);
      if (poi) {
        const points = [...poi.entrances].sort((a, b) => {
          const self = snapshot!.entities.find(entity => entity.id === snapshot!.selfId)!;
          return distance(self, a) - distance(self, b);
        });
        const goal = points.find(point => isLiveWalkable(snapshot!.world, point));
        if (goal) void send({ type: 'move', ...goal });
      }
    }
    else if (action === 'extract-route' && snapshot) { const self = snapshot.entities.find(entity => entity.id === snapshot!.selfId)!; const destination = [...snapshot.world.extracts].filter(point => isLiveWalkable(snapshot!.world,point)).sort((a,b)=>distance(self,a)-distance(self,b))[0]; if(destination) void send({type:'move',...destination}); }
    else if (action === 'move') move(Number(arguments_[0]), Number(dy));
    else if (action === 'patrol' && snapshot) void send({ type: 'patrol', enabled: !snapshot.self.patrol });
    else if (action === 'respawn') void send({ type: 'respawn', districtId: selectedDistrict, purpose: selectedPurpose, kitId: selectedKit });
    else if (action === 'heal' || action === 'extract' || action === 'resupply' || action === 'cancelTreatment') void send({ type: action });
  };
  dock.addEventListener('click', click); overlay.addEventListener('click', click); raidStatus.addEventListener('click', click);
  return { show, hide, refreshPanel, resetIdentity, setEntrySelection, isActive: () => active, isActionPending: () => actionBusy || exitIntent, destroy: () => { hide(true); destroyed = true; generation++; dock.removeEventListener('click', click); overlay.removeEventListener('click', click); raidStatus.removeEventListener('click', click); scene.destroy(); overlay.remove(); raidStatus.remove(); } };
}


