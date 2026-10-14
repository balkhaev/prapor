import { LIVE_CAPACITY, LIVE_SERVER_NAME, liveMedicalSupplyNeeded, type LiveCommand, type LiveContainerKind, type LiveDistrictId, type LiveEntity, type LivePurpose, type LiveSnapshot, type LiveStatus } from './game/live';
import { hasLiveLineOfSight, isLiveWalkable } from './game/live-maps';
import { BODY_PARTS, BODY_PART_LABELS, TREATMENT_DURATION_MS, TREATMENT_LABELS, canTreat, injuryEffects, selectTreatment, type BodyPart, type TreatmentType } from './game/health';
import { LiveApiError, liveRequest, readLiveEntry, readLiveSnapshot, readLiveStatus, shouldRejoinLivePresence, type LiveIdentity } from './live-client';
import { isLiveKitId, type LiveEntry, type LiveKitId } from './game/live-entry';
import { LiveScene } from './live-scene';
import { liveDropDetails, liveDropLabel, liveEconomyChanged, liveLootCargo } from './live-loot-ui';
import './live.css';
import './boss.css';
import { liveBossRoster, liveBossEntityDetails, liveBossGuidance, readLiveBossRoute, getLiveBossHuntGuide } from './live-boss-ui';
import { raidEntryMap, raidEntryPurposeName } from './raid-entry-ui';

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
const containerNames: Record<LiveContainerKind, string> = { duffel: 'Спортивная сумка', jacket: 'Куртка', toolbox: 'Ящик инструментов', medbag: 'Медицинская сумка', cabinet: 'Шкаф', crate: 'Грузовой ящик' };
const citySiteKinds = { courtyard: 'Жилой двор', arcade: 'Сквозной проход', workyard: 'Двор мастерских', 'service-yard': 'Служебный двор' } as const;

export interface LiveModeOptions {
  world: HTMLElement;
  dock: HTMLElement;
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
  let selectedPart: BodyPart = 'chest';
  let pollTimer = 0, lastKeyboardAt = 0;
  let controller: AbortController | null = null;
  let connection: Promise<unknown> = Promise.resolve();
  let reconnectPresence = false;
  let selectedDistrict: LiveDistrictId = 'customs', selectedPurpose: LivePurpose = 'loot';
  let selectedRouteId: string | null = null;
  let selectedBossId:string|null=null;
  let exitIntent = false, exitToMarket = false;
  const { world, dock } = options;
  world.classList.add('live-world');
  world.hidden = true;
  const overlay = document.createElement('div'); overlay.className = 'live-world-overlay';
  const scene = (options.sceneFactory ?? ((host, command, select) => new LiveScene(host, command, select)))(world, command => void send(command), id => { selectedId = id; render(); });
  world.append(overlay);
  const identity = (): LiveIdentity => ({ accountId: identityAccount, gameId: identityGame, ...(snapshot ? { playerId: snapshot.selfId, worldVersion: snapshot.worldVersion } : {}) });
  const isCurrent = (version: number, account: string | null, game: string | null) => active && !destroyed && version === generation && account === options.getAccountId() && game === options.getGameId();
  const identityChanged = () => identityAccount !== options.getAccountId() || identityGame !== options.getGameId();
  const stopRequest = () => { window.clearTimeout(pollTimer); pollTimer = 0; controller?.abort(); controller = null; requestBusy = false; actionBusy = false; };
  const schedule = (version: number) => { window.clearTimeout(pollTimer); if (active && version === generation && !destroyed) pollTimer = window.setTimeout(() => void poll(), snapshot ? 500 : 2000); };
  const clearSession = () => { snapshot = null; entry = null; entryReceivedAt = 0; receivedAt = 0; selectedId = null; selectedRouteId = null; exitIntent = false; exitToMarket = false; scene.clear(); };
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
    const market = exitToMarket;
    clearSession(); hide();
    if (market) options.onMarket(); else options.onExit();
  }

  async function leave(toMarket = false): Promise<void> {
    if (!active || actionBusy || destroyed || exitIntent) return;
    exitToMarket = toMarket;
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
        if (exitIntent && next.self.leaveAt === 0) { exitIntent = false; exitToMarket = false; message = 'Выход прерван. Боец остаётся на Периметре.'; }
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
      if (interruptedExit) { exitIntent = false; exitToMarket = false; }
      acceptSnapshot(next, command); message = interruptedExit ? 'Выход прерван приказом.' : next.self.economyMessage ?? ''; offline = false;
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
    active = false; generation++; stopRequest(); clearSession(); reconnectPresence = false; world.hidden = true; scene.hide(); overlay.innerHTML = '';
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
    dock.removeAttribute('role'); dock.removeAttribute('aria-modal'); dock.setAttribute('aria-label', 'Мультиплеер: состояние бойца и приказы');
    const shade = document.querySelector<HTMLElement>('#context-shade'); if (shade) shade.hidden = true;
    const scroll = dock.querySelector<HTMLElement>('.live-dock-scroll')?.scrollTop ?? 0;
    const entryScroll = overlay.querySelector<HTMLElement>('.live-entry-scroll')?.scrollTop ?? 0;
    const focused = dock.contains(document.activeElement) || overlay.contains(document.activeElement) ? (document.activeElement as HTMLElement).getAttribute('data-live-button') : null;
    const eventsOpen = dock.querySelector<HTMLDetailsElement>('.live-events')?.open ?? false;
    const bossRosterOpen=dock.querySelector<HTMLDetailsElement>('.live-boss-roster')?.open??false;
    const entryBossRosterOpen=overlay.querySelector<HTMLDetailsElement>('.live-boss-roster')?.open??false;
    const medicalOpen=dock.querySelector<HTMLDetailsElement>('.live-medical-fold')?.open??false;
    const goalOpen=dock.querySelector<HTMLDetailsElement>('.live-goal-fold')?.open??false;
    const controlsOpen=dock.querySelector<HTMLDetailsElement>('.live-controls-fold')?.open??false;
    const focusedSummary = document.activeElement ? ['.live-medical-fold', '.live-goal-fold', '.live-controls-fold'].find(selector => document.activeElement === dock.querySelector(`${selector} > summary`)) : undefined;
    const eventsFocused = document.activeElement === dock.querySelector('.live-events summary');
    const server = snapshot?.server ?? status, map = server?.maps[0], city = snapshot?.world.city ?? map?.city;
    const gameReady = !!options.getGameId() && options.isGameReady?.() !== false;
    const header = `<header class="live-dock-head"><div><span class="live-eyebrow">МУЛЬТИПЛЕЕР · ЕДИНЫЙ МИР</span><h2>${snapshot ? 'В рейде' : 'Периметр 01'}</h2></div><span class="live-online ${offline ? 'lost' : ''}" title="Игроков на общем сервере"><i></i>${server ? `${server.online}/${server.capacity}` : `—/${LIVE_CAPACITY}`}</span></header>`;
    const notice = message ? `<p class="live-notice ${offline ? 'lost' : ''}" role="status">${escape(message)}</p>` : '';
    const lobbyRoute = server?.routes?.find(route => route.districtId === selectedDistrict && route.purpose === selectedPurpose);
    const lobbyRecommendation = lobbyRoute ? `<section class="live-lobby-route"><span class="live-eyebrow">РЕКОМЕНДУЕМЫЙ МАРШРУТ</span><strong>${escape(lobbyRoute.name)}</strong><p>${escape(lobbyRoute.description)}</p><ol>${lobbyRoute.stops.map(stop => `<li>${escape(stop)}</li>`).join('')}</ol></section>` : '';
    const districtCards = () => (server?.districts ?? []).map(district => `<button class="live-map-card theme-${district.theme} ${district.id === selectedDistrict ? 'selected' : ''}" data-live-button="district:${district.id}" aria-pressed="${district.id === selectedDistrict}" ${actionBusy || entry?.mode === 'continue' ? 'disabled' : ''}><span class="live-map-icon" aria-hidden="true">${district.id === 'village' ? '⌂' : district.theme === 'forest' ? '♠' : district.theme === 'urban' ? '▤' : '▦'}</span><span><strong>${escape(district.name)}</strong><small>${district.online} игроков · ${district.npcs} NPC</small><p>${escape(district.description)}</p></span></button>`).join('');
    const purposeCards = () => Object.entries(purposes).filter(([id])=>id !== 'quests' || selectedPurpose === 'quests').map(([id, goal]) => `<button class="live-purpose-card ${id === selectedPurpose ? 'selected' : ''}" data-live-button="purpose:${id}" aria-pressed="${id === selectedPurpose}" ${actionBusy || entry?.mode === 'continue' ? 'disabled' : ''}><strong>${raidEntryPurposeName(id as LivePurpose)}</strong><small>${goal.description}</small></button>`).join('');
    const preparingDowned = !!snapshot && snapshot.entities.find(entity => entity.id === snapshot!.selfId)!.health <= 0;
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
      const joinLabel = actionBusy ? 'Входим в рейд…' : !gameReady ? 'Подключаемся к убежищу…' : readySeconds > 0 ? `Новый выход через ${readySeconds} сек.` : launchPending ? 'Подтвердить комплект' : continueRaid ? 'Продолжить рейд' : 'Выйти в рейд';
      const stock = entry?.stock ?? options.getStock?.();
      const kitCards = entry?.kits.map(kit => `<button class="live-entry-kit-card ${selectedKit === kit.kitId ? 'selected' : ''}" data-live-button="kit:${kit.kitId}" aria-pressed="${selectedKit === kit.kitId}" ${actionBusy || continueRaid ? 'disabled' : ''}><span>${escape(kit.label)}</span><strong>${escape(kit.weaponName)}</strong><small>${kit.ammo} патронов · ${kit.medkits} аптечки<br>Дальность ${kit.range} · броня ${Math.round(kit.armorProtection * 100)}%</small><b>${kit.cost.money ? `${integer(kit.cost.money)} ₽` : 'Без оплаты'}</b>${kit.reason ? `<em>${escape(kit.reason)}</em>` : ''}</button>`).join('') ?? '';
      const fighterBrief = entry?.fighter && continueRaid ? `<section class="live-entry-fighter"><span class="live-eyebrow">БОЕЦ УЖЕ НА ПЕРИМЕТРЕ</span><strong>${escape(entry.fighter.name)} · ${Math.ceil(entry.fighter.health)}% здоровья</strong><p>${escape(entry.fighter.loadout?.weaponName ?? 'Сохранённый комплект')} · ${integer(entry.fighter.ammo)} патронов · ${entry.fighter.lootCount} предметов · ${integer(entry.fighter.cargo)} ₽ при себе</p><small>Вернёшься на позицию ${entry.fighter.x}, ${entry.fighter.y}. Здоровье, груз и комплект сохраняются; повторной оплаты нет.</small>${launchPending ? '<p role="status">Выдача комплекта ожидает подтверждения. Повторная оплата не потребуется.</p>' : ''}</section>` : preparingDowned || entry?.mode === 'downed' ? '<p class="live-entry-downed" role="status"><strong>Боец получил тяжёлое ранение.</strong> Добыча осталась в мире. Подготовь новый комплект и выбери точку возвращения.</p>' : '';
      overlay.innerHTML = `<section class="live-entry-screen" aria-label="Подготовка выхода в общий мир"><header class="live-entry-head"><div><span class="live-eyebrow">ОНЛАЙН · ОДНА ОБЩАЯ КАРТА</span><h2>Выход в рейд</h2><p>Ты управляешь своим бойцом. Другие игроки и NPC уже в мире.</p></div><span class="live-online ${offline ? 'lost' : ''}"><i></i>${server ? `${server.online} / ${server.capacity} онлайн` : 'Подключаемся'}</span></header><div class="live-entry-scroll">${notice}${fighterBrief}<div class="live-entry-map-layout"><div><div class="live-entry-map-caption"><strong>${escape(map?.name ?? LIVE_SERVER_NAME)}</strong><span>Выбери район входа на карте</span></div>${raidEntryMap(server, selectedDistrict, actionBusy || continueRaid)}<p class="live-entry-shared">Один мир для всех целей. Можно пройти с любой окраины в город и дальше по всей карте. Встреча с другим игроком может закончиться боем.</p></div><section class="live-entry-settings"><h3>1 · Точка входа</h3><div class="live-map-list live-district-list">${districtCards()}</div><h3>2 · Цель выхода</h3><div class="live-purpose-list">${purposeCards()}</div></section></div><section class="live-entry-kit"><div><span class="live-eyebrow">СНАРЯЖЕНИЕ И ДОБЫЧА</span><h3>${continueRaid ? 'Твой комплект сохраняется' : 'Собери боевой комплект'}</h3><p>Припасы берутся из убежища. Найденный груз нужно доставить у зелёного выхода.</p></div><div class="live-entry-stock"><span>На складе<strong>${stock ? integer(stock.ammo) : '—'} патронов</strong></span><span>Медицина<strong>${stock ? integer(stock.medicine) : '—'} лекарств</strong></span></div></section>${!continueRaid ? `<div class="live-entry-kits" aria-label="Боевой комплект">${kitCards}</div>${kit?.reason ? `<p class="live-entry-kit-warning" role="status">${escape(kit.reason)} <button class="text-button" data-live-button="market">Склад и барахолка →</button></p>` : ''}` : ''}${liveBossRoster(server??null,selectedDistrict,selectedPurpose)}${lobbyRecommendation}</div><footer class="live-entry-footer"><div><strong>${escape(chosenDistrict?.name ?? 'Таможня')} · ${raidEntryPurposeName(selectedPurpose)}</strong><small>${continueRaid ? 'Возвращение к сохранённому бойцу. Повторной оплаты нет.' : kit ? `Расход: ${integer(kit.cost.money)} ₽ · ${kit.cost.ammo} патронов · ${kit.cost.medicine} лекарств` : 'Проверяем комплект и припасы…'}</small></div><button class="button primary live-join" data-live-button="${preparingDowned ? 'respawn' : 'join'}" ${actionBusy || offline || !server || !gameReady || !entry || kitBlocked || readySeconds > 0 ? 'disabled' : ''}>${joinLabel}<span>Периметр 01 →</span></button></footer></section>`;
      dock.innerHTML = `${header}<div class="live-dock-scroll"><section class="live-entry-brief"><span class="live-server-label"><i></i>${offline ? 'Восстанавливаем связь' : server ? 'Сервер на связи' : 'Проверяем сервер'}</span><h3>Одна карта. Реальные встречи.</h3><p>Дворы, здания и проходы центрального города соединяют четыре окраины. Бои с игроками, охрана NPC и добыча существуют одновременно.</p><dl><div><dt>Общая карта</dt><dd>${escape(map?.name ?? LIVE_SERVER_NAME)}</dd></div><div><dt>Игроков</dt><dd>${server ? `${server.online} / ${server.capacity}` : 'Подключаемся'}</dd></div><div><dt>Точка входа</dt><dd>${escape(chosenDistrict?.name ?? 'Таможня')}</dd></div><div><dt>Цель</dt><dd>${raidEntryPurposeName(selectedPurpose)}</dd></div></dl><p class="live-entry-risk">Ранение оставит груз в мире. При потере связи боец остаётся под угрозой 30 секунд.</p>${identityAccount ? '<small>Позывной и склад привязаны к аккаунту.</small>' : '<button class="text-button" data-live-button="account">Сохранить аккаунт →</button>'}</section>${options.onMissionBoard && !snapshot ? '<button class="button live-mission-board" data-live-button="missions">Задания отряда →</button><p class="live-empty">Отдельные вылазки бойцов отряда из убежища.</p>' : ''}<button class="text-button live-back" data-live-button="exit">← Вернуться в убежище</button></div>`;
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
      const remaining = Math.max(0, Math.ceil((snapshot.self.respawnAt - estimatedNow) / 1000));
      const canAct = !downed && !snapshot.self.launchPending && !actionBusy && !offline;
      const nearExtract = snapshot.world.extracts.some(point => distance(self, point) <= 1.5);
      const closestExtract = [...snapshot.world.extracts].sort((a,b)=>distance(self,a)-distance(self,b))[0];
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
      const selected = nearby.find(entity => entity.id === selectedId), firing = snapshot.self.targetId !== null;
      const urgent = selectTreatment(body, medicine, serverNow);
      const injured = BODY_PARTS.some(part=>body.parts[part].hp < body.parts[part].maxHp || body.parts[part].bleeding !== 'none' || body.parts[part].fracture);
      const medicalPanel = `<section class="live-medical"><h3>Тело и медицина <span>${Math.ceil(totalHP)} / ${Math.ceil(maxHP)} HP</span></h3><div class="live-body-parts" aria-label="Выбор части тела">${BODY_PARTS.map(part => {
        const state = body.parts[part], signs = [state.hp <= 0 ? 'выбита' : '', state.bleeding === 'heavy' ? 'тяжёлое кровотечение' : state.bleeding === 'light' ? 'лёгкое кровотечение' : '', state.fracture ? 'перелом' : ''].filter(Boolean).join(' · ');
        return `<button class="live-body-part ${selectedPart === part ? 'selected' : ''} ${state.hp <= 0 || state.bleeding === 'heavy' ? 'critical' : signs ? 'injured' : ''}" data-live-button="part:${part}" aria-pressed="${selectedPart === part}"><span>${BODY_PART_LABELS[part]}<b>${Math.ceil(state.hp)} / ${state.maxHp}</b></span><i style="--part-health:${state.hp / state.maxHp * 100}%"></i><small>${signs || 'Без ранений'}</small></button>`;
      }).join('')}</div><p class="live-medical-effects">${effects.movement < 1 ? `Ход ${Math.round(effects.movement * 100)}% · ` : ''}${effects.aim < 1 ? `Точность ${Math.round(effects.aim * 100)}% · ` : ''}${body.painUntil > serverNow ? 'Обезболивание действует' : 'Движение и огонь прерывают лечение'}</p>${treatment ? `<div class="live-treatment" role="status"><strong>${TREATMENT_LABELS[treatment.type]} · ${BODY_PART_LABELS[treatment.part]}</strong><span>${treatmentSeconds > 0 ? `${treatmentSeconds} сек.` : 'Завершаем…'}</span><button class="text-button" data-live-button="cancelTreatment" ${actionBusy || offline ? 'disabled' : ''}>Отменить</button></div>` : urgent && !downed ? `<button class="button live-urgent-treatment" data-live-button="treat:${urgent.type}:${urgent.part}" ${!canAct ? 'disabled' : ''}>Срочно: ${TREATMENT_LABELS[urgent.type]} · ${BODY_PART_LABELS[urgent.part]}</button>` : ''}<div class="live-medicines">${(['bandage', 'tourniquet', 'medkit', 'splint', 'painkiller', 'surgery'] as TreatmentType[]).map(type => `<button data-live-button="treat:${type}:${selectedPart}" ${!canAct || treatment || !canTreat(body, medicine, type, selectedPart, serverNow).ok ? 'disabled' : ''}><strong>${TREATMENT_LABELS[type]}</strong><span>${medicine[type]}${type === 'medkit' ? ' HP' : ' прим.'} · ${Math.ceil(TREATMENT_DURATION_MS[type] * effects.treatment / 1000)} сек.</span></button>`).join('')}</div><p class="live-medical-help">${BODY_PART_LABELS[selectedPart]} выбрана. Аптечка лечит живую зону. Хирургия возвращает выбитую конечность или живот к 1 HP и уменьшает её максимум.</p></section>`;
      const purpose = purposes[snapshot.self.purpose];
      const targetRow = (entity: LiveEntity) => {
        const range = distance(self, entity), protectedTarget = entity.safeUntil > snapshot!.now, engaged = snapshot!.self.targetId === entity.id;
        const visible = range <= (snapshot!.self.loadout?.range ?? 7) && hasLiveLineOfSight(snapshot!.world, self, entity);
        const faction = entity.bossId ? 'БОСС' : entity.kind === 'player' ? 'Игрок' : entity.faction === 'raiders' ? 'Рейдер · NPC' : 'Дикий · NPC';
        const role = entity.role === 'marksman' ? ' · стрелок' : entity.role === 'guard' ? ' · охрана' : '';
        const signs = `${entity.bleeding ? ' · кровь' : ''}${entity.limping ? ' · хромает' : ''}${entity.aimUntil && entity.aimUntil > snapshot!.now ? ' · прицеливается' : ''}`;
        return `<article class="live-person ${entity.kind === 'player' ? 'is-player' : 'is-scav'} ${entity.faction === 'raiders' ? 'is-raider' : ''} ${entity.bossId?'is-boss':''} ${selectedId === entity.id ? 'selected' : ''} ${engaged ? 'engaged' : ''}"><button class="live-person-select" data-live-button="select:${escape(entity.id)}"><i>${entity.kind === 'player' ? 'И' : entity.faction === 'raiders' ? 'Р' : 'Д'}</i><span><strong>${escape(entity.name)}</strong><small>${faction}${role} · ${range.toFixed(1)} кл. · ${entity.health > 0 ? `${Math.ceil(entity.health)}%` : 'Ранен'}${protectedTarget ? ' · защита' : range <= (snapshot!.self.loadout?.range ?? 7) && !visible ? ' · укрытие' : ''}${signs}</small></span></button><button class="live-attack" data-live-button="attack:${escape(entity.id)}" aria-pressed="${engaged}" ${!canAct || (!engaged && (entity.health <= 0 || !visible || protectedTarget || snapshot!.self.ammo < 1)) ? 'disabled' : ''} aria-label="${engaged ? 'Прекратить огонь по' : 'Открыть огонь по'} ${escape(entity.name)}" title="Приказ вести огонь до ${snapshot!.self.loadout?.range ?? 7} клеток при прямой видимости">${engaged ? 'Стоп' : 'Огонь'}</button><button class="live-attack live-aim" data-live-button="aim:${escape(entity.id)}" ${!canAct || entity.health <= 0 || !visible || protectedTarget || snapshot!.self.ammo < 1 ? 'disabled' : ''} title="Выстрел в голову: подготовка от 1,8 сек., движение отменяет прицеливание">В голову</button>${liveBossEntityDetails(entity)}</article>`;
      };
      overlay.innerHTML = `<div class="live-field-hud"><span class="live-world-signal ${offline ? 'lost' : ''}"><i></i>${offline ? 'НЕТ СВЯЗИ' : `LIVE · ${server!.online} ИГР. · ОБЩИЙ МИР`}</span><strong>${escape(locationName)} <span>${downed ? 'РАНЕН' : `${Math.ceil(self.health)}%`}</span></strong><p>${escape(currentBuilding?.name ?? currentSite?.name ?? quarter?.name ?? zone?.name ?? locationName)} <span class="live-danger danger-${danger}">${'●'.repeat(danger)}${'○'.repeat(3 - danger)}</span></p><p>${leavingLabel ? leavingLabel : treatment ? `${TREATMENT_LABELS[treatment.type]} · ${treatmentSeconds} сек.` : self.aimUntil && self.aimUntil > serverNow ? `Прицеливание · ${Math.ceil((self.aimUntil - serverNow) / 1000)} сек.` : downed ? `Возвращение через ${remaining} сек.` : snapshot.self.searching ? 'Обыскиваешь контейнер · не двигайся' : firing ? 'Ведёшь огонь · укрытия блокируют выстрелы' : snapshot.self.patrol ? 'Автопатруль · движение и бой' : `${purpose.name} · WASD / стрелки`}</p></div><div class="live-field-legend"><span><i class="own"></i>Ты</span><span><i class="player"></i>Игрок</span><span><i class="scav"></i>Дикий</span><span><i class="raider"></i>Рейдер</span><span><i class="boss"></i>Босс в поле зрения</span>${snapshot.world.citySites?.length?'<span><i class="entrance"></i>Вход</span>':''}<span><i class="extract"></i>Выход</span></div>`;
      scene.setSelected(selectedId);
      const players = nearby.filter(entity => entity.kind === 'player'), scavs = nearby.filter(entity => entity.kind === 'scav').slice(0, 8);
      const drops = snapshot.drops.filter(drop => distance(self, drop) <= 8).sort((a, b) => distance(self, a) - distance(self, b)).slice(0, 6);
      const dropRows = drops.map(drop => {
        const near = distance(self, drop) <= 1.5, name = drop.bossId ? 'Груз побеждённого главаря' : drop.containerKind ? containerNames[drop.containerKind] : 'Брошенный груз';
        const searching = snapshot!.self.searching?.id === drop.id;
        const readyAt = searching ? snapshot!.self.searching!.readyAt : 0;
        const anchor = drop.containerId ? snapshot!.world.containers.find(anchor => anchor.id === drop.containerId) : null;
        const duration = anchor?.searchMs ?? 3000, left = Math.max(0, readyAt - estimatedNow);
        const action = !near ? 'approach' : drop.containerId && !drop.searched ? 'search' : 'loot';
        const known = !drop.containerId || drop.searched;
        const hasCargo = drop.amount > 0 || (drop.items?.length ?? 0) > 0;
        const contents = known && hasCargo ? `<p class="live-container-content">${escape(liveDropLabel(drop))}</p><small>${escape(liveDropDetails(drop))}</small>` : '';
        return `<article class="live-container-row"><div><strong>${escape(name)}</strong><small>${distance(self, drop).toFixed(1)} кл. · ${!known ? 'Содержимое неизвестно' : hasCargo ? 'Содержимое найдено' : 'Пусто'}</small>${contents}</div>${searching ? `<div class="live-search-progress"><progress max="${duration}" value="${Math.max(0, Math.min(duration, duration - left))}"></progress><span>${left > 0 ? `Обыск · ${(left / 1000).toFixed(1)} сек.` : 'Ожидаем результат…'}</span></div>` : `<button class="live-attack" data-live-button="${action}:${escape(drop.id)}" ${!canAct || (action === 'loot' && !hasCargo) || (action === 'search' && snapshot!.self.searching !== null) ? 'disabled' : ''}>${!near ? 'Подойти' : action === 'search' ? 'Обыскать' : 'Забрать'}</button>`}</article>`;
      }).join('');
      const suggested = snapshot.world.pois.filter(poi => poi.tags.some(tag => purpose.tags.includes(tag))).sort((a, b) => {
        const preferred = (poi: typeof a) => snapshot!.self.purpose === 'loot' && poi.districtId === snapshot!.self.districtId && poi.tags.includes('peripheral') ? 1 : 0;
        return preferred(b) - preferred(a) || distance(self, a) - distance(self, b);
      }).slice(0, 3);
      const guidance = suggested.length ? suggested : [...snapshot.world.pois].sort((a, b) => distance(self, a) - distance(self, b)).slice(0, 3);
      const routeChoices = snapshot.world.routes?.filter(route => route.purpose === snapshot!.self.purpose) ?? [];
      const route = routeChoices.find(route => route.id === selectedRouteId) ?? routeChoices.find(route => route.districtId === snapshot!.self.districtId);
      if (route) selectedRouteId = route.id;
      const bossGuide=getLiveBossHuntGuide(snapshot,selectedBossId);
      if (bossGuide) selectedBossId = bossGuide.bossId;
      const stops = bossGuide ? snapshot.world.pois.filter(poi=>poi.id===bossGuide.poiId) : snapshot.self.purpose==='boss'?[]:route ? route.poiIds.map(id => snapshot!.world.pois.find(poi => poi.id === id)!) : guidance;
      scene.setRoute?.(!downed ? bossGuide?[bossGuide.poiId]:route?.poiIds ?? [] : []);
      const routePicker = snapshot.self.purpose==='boss'?`<div class="live-route-districts" aria-label="Район охоты на главаря">${(snapshot.server.bosses??[]).map(boss=>`<button data-live-button="boss-area:${boss.bossId}" aria-pressed="${boss.bossId===bossGuide?.bossId}">${escape(boss.name)} · ${escape(snapshot!.world.districts.find(district=>district.id===boss.districtId)?.name??'')}</button>`).join('')}</div>`:routeChoices.length ? `<div class="live-route-districts" aria-label="Район старта рекомендуемого маршрута">${routeChoices.map(choice => `<button data-live-button="route:${escape(choice.id)}" aria-pressed="${choice.id === route?.id}">${escape(snapshot!.world.districts.find(district => district.id === choice.districtId)!.name)}${city ? ' → город' : ''}</button>`).join('')}</div>` : '';
      const sites = [...snapshot.world.citySites ?? []].sort((a, b) => Number(b.id === currentSite?.id) - Number(a.id === currentSite?.id) || Number(stops.some(poi => poi.id === b.poiId)) - Number(stops.some(poi => poi.id === a.poiId)) || distance(self, a.courtyard) - distance(self, b.courtyard)).slice(0, 3);
      const siteSection = sites.length ? `<section class="live-city-sites"><h4>${inCity ? 'Дворы и проходы' : 'Рассмотреть город'}</h4><p>Осмотр приближает район на карте. «Идти» направляет туда бойца.</p>${sites.map(site => `<article class="live-city-site ${site.id === currentSite?.id ? 'current' : ''}"><div><strong>${escape(site.name)}</strong><small>${citySiteKinds[site.kind]} · ${escape(snapshot!.world.city?.quarters.find(quarter => quarter.id === site.quarterId)?.name ?? '')}</small><span>${site.buildings.map(building => escape(building.name)).join(' · ')}</span></div><div class="live-site-actions"><button data-live-button="site-view:${escape(site.id)}">Осмотр</button><button data-live-button="poi:${escape(site.poiId)}" ${!canAct ? 'disabled' : ''}>Идти →</button></div></article>`).join('')}<small>Входы и проходы отмечены на карте. Содержимое контейнеров открывается при обыске.</small></section>` : '';
      const goalSection = `<section class="live-goal"><h3>${purpose.name} <span>Маршрут на карте</span></h3>${inCity ? `<p>Сейчас: ${escape(locationName)} · ${escape(currentBuilding?.name ?? currentSite?.name ?? quarter?.name ?? zone?.name ?? 'Городские улицы')}</p>` : ''}${routePicker}${route ? `<strong class="live-route-name">${escape(route.name)}</strong><p>${escape(route.description)}</p>` : `<p>${purpose.description}</p>`}${snapshot.self.purpose === 'quests' ? '<p>Пока это маршрут разведки мест для будущих заданий. Задания и начисление наград ещё не подключены.</p>' : ''}${liveBossGuidance(snapshot,stops.map(poi=>poi.id))}${stops.map((poi, index) => `<button class="live-poi-route" data-live-button="poi:${escape(poi.id)}" ${!canAct ? 'disabled' : ''}><i>${index + 1}</i><span><strong>${escape(poi.name)}</strong><small>${escape(city && inside(poi, city) ? city.quarters.find(quarter => inside(poi, quarter))?.name ?? city.name : snapshot!.world.districts.find(district => district.id === poi.districtId)?.name ?? '')} · ${distance(self, poi).toFixed(0)} кл. по карте</small></span><b>Идти →</b></button>`).join('')}${siteSection}<small>Цифры отмечают реальные входы. Можно идти в любом порядке и свободно менять район. Игроки, NPC и содержимое контейнеров видны только поблизости.</small></section>`;
      const nextStop = [...stops].sort((a,b)=>distance(self,a)-distance(self,b))[0];
      const objective = `<section class="live-active-objective"><span>ТВОЯ ЦЕЛЬ · ${raidEntryPurposeName(snapshot.self.purpose)}</span><strong>${escape(nextStop?.name ?? locationName)}</strong><p>${snapshot.self.purpose==='pvp' ? 'Другие игроки встречаются на дорогах, во дворах и в горячих точках.' : purpose.description}</p>${nextStop ? `<button class="live-poi-route" data-live-button="poi:${escape(nextStop.id)}" ${!canAct?'disabled':''}><span>К ориентиру · ${distance(self,nextStop).toFixed(0)} кл. по карте</span><b>Идти →</b></button>` : ''}</section>`;
      const medicalSection = `<details class="live-medical-fold ${injured?'urgent':''}" ${medicalOpen || injured || treatment?'open':''}><summary>${injured ? 'Ранения · нужна помощь' : 'Здоровье и медицина'}<span>${Math.ceil(totalHP)} / ${Math.ceil(maxHP)} HP</span></summary>${medicalPanel}</details>`;
      const routeSection = `<details class="live-goal-fold" ${goalOpen?'open':''}><summary>Маршрут, дворы и проходы</summary>${goalSection}</details>`;
      const downedSection = `<section class="live-downed"><strong>Боец ранен</strong><p>Добыча осталась в мире. Выбери район и цель нового выхода.</p><div class="live-map-list live-district-list">${districtCards()}</div><div class="live-purpose-list">${purposeCards()}</div><button class="button primary" data-live-button="respawn" ${remaining > 0 || actionBusy || offline ? 'disabled' : ''}>${remaining > 0 ? `Вернуться через ${remaining} сек.` : 'Вернуться в Периметр'}</button></section>`;
      const orders = `<section class="live-orders"><div class="live-combat-status"><span>${firing ? 'Ведёшь огонь' : 'Выбери противника на карте'}</span>${firing ? `<button class="button live-cease" data-live-button="cease" ${!canAct ? 'disabled' : ''}>Прекратить огонь</button>` : ''}</div>${closestExtract ? `<button class="live-extraction-route" data-live-button="extract-route" ${!canAct ? 'disabled' : ''}><span>К зелёному выходу →</span><small>${distance(self, closestExtract).toFixed(0)} кл. по карте</small></button>` : ''}<button class="button primary live-extract" data-live-button="extract" ${!canAct || !nearExtract ? 'disabled' : ''}>${nearExtract ? 'Доставить лут в убежище' : 'Эвакуация у зелёного выхода'}</button>${resupply}</section>`;
      const controls = `<details class="live-controls-fold" ${controlsOpen?'open':''}><summary>Управление бойцом</summary><p class="live-controls-help">Нажми на землю, чтобы идти; потяни карту для обзора. WASD / стрелки — шаг. «Огонь» ведёт стрельбу по видимой цели, пробел — огонь / стоп, E — аптечка.</p><div class="live-direction-pad" aria-label="Передвижение бойца"><button data-live-button="move:0:-1" aria-label="На север" ${!canAct?'disabled':''}>↑</button><button data-live-button="move:-1:0" aria-label="На запад" ${!canAct?'disabled':''}>←</button><span>ХОД</span><button data-live-button="move:1:0" aria-label="На восток" ${!canAct?'disabled':''}>→</button><button data-live-button="move:0:1" aria-label="На юг" ${!canAct?'disabled':''}>↓</button></div><button class="button" data-live-button="patrol" aria-pressed="${snapshot.self.patrol}" ${!canAct?'disabled':''}>${snapshot.self.patrol?'Остановить автопатруль':'Включить автопатруль'}</button></details>`;
      dock.innerHTML = `${header}<div class="live-dock-scroll">${notice}${leavingNotice}${snapshot.self.launchPending ? '<p class="live-notice" role="status">Подтверждаем выдачу комплекта. Движение и бой станут доступны после подтверждения.</p>' : ''}<section class="live-self"><div class="live-self-name"><span class="live-eyebrow">ТВОЙ БОЕЦ</span><strong>${escape(self.name)}</strong><small>${downed ? 'Тяжёлое ранение' : self.safeUntil > snapshot.now ? 'Защита после входа' : snapshot.self.searching ? 'Обыск' : firing ? 'Ведёт огонь' : self.action === 'combat' ? 'В бою' : self.action === 'moving' ? 'В пути' : 'На позиции'} · ${self.x}, ${self.y}</small></div><div class="live-health" aria-label="Здоровье ${Math.ceil(self.health)} из 100"><i style="width:${self.health}%"></i><span>${Math.ceil(totalHP)} / ${Math.ceil(maxHP)} HP</span></div>${snapshot.self.loadout ? `<p class="live-self-loadout">${escape(snapshot.self.loadout.weaponName)} · ${escape(snapshot.self.loadout.label)} · дальность ${snapshot.self.loadout.range}</p>` : ''}<div class="live-player-kit"><span>Патроны<b>${integer(snapshot.self.ammo)}</b></span><span>Аптечка<b>${integer(medicine.medkit)} HP</b></span><span>Деньги при себе<b>${integer(snapshot.self.cargo)} ₽</b></span>${snapshot.self.gameId && stock?.money !== undefined ? `<span>В убежище<b>${integer(stock.money)} ₽</b></span>` : `<span>Прежний запас<b>${integer(snapshot.self.stash)} ₽</b></span>`}</div></section>${objective}${downed ? downedSection : orders}${selected ? `<section class="live-target"><h3>Выбранная цель</h3>${targetRow(selected)}</section>` : ''}${drops.length && !downed ? `<section class="live-roster"><h3>Контейнеры и груз рядом</h3>${snapshot.self.searching ? '<p class="live-empty">Не двигайся: движение прервёт обыск.</p>' : ''}${dropRows}</section>` : ''}<section class="live-roster"><h3>Игроки поблизости <span>${players.length}</span></h3>${players.length ? players.map(targetRow).join('') : '<p class="live-empty">Рядом игроков не видно. Дальние встречи появятся, когда подойдёшь ближе.</p>'}</section>${medicalSection}${liveLootCargo(snapshot.self)}${routeSection}${controls}<section class="live-roster"><h3>NPC поблизости <span>${scavs.length}</span></h3>${scavs.length ? scavs.map(targetRow).join('') : '<p class="live-empty">Рядом тихо. Посты и патрули охраняют ориентиры в разных районах.</p>'}</section><details class="live-events"><summary>Эфир поблизости · ${snapshot.events.length}</summary><div>${snapshot.events.slice(-12).reverse().map(event => `<article class="${event.kind === 'combat' ? 'combat' : ''}"><time>${new Date(event.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time><span>${escape(event.text)}</span></article>`).join('')}</div></details><p class="live-stash-note">Побед: ${integer(snapshot.self.kills)}${snapshot.self.bossKills!==undefined?` · главарей: ${integer(snapshot.self.bossKills)}`:""}${snapshot.self.stash ? `<br>Прежний запас Периметра: ${integer(snapshot.self.stash)} ₽. Доставь его в убежище у выхода.` : ''}<br>Один мир, четыре района. Найденные предметы доставляются в убежище; цены предметов — ориентир.<br>Выход: 8 сек. после боя, 5 сек. при кровотечении. При потере связи тело остаётся в мире 30 сек.</p><button class="button live-market" data-live-button="market" ${actionBusy || exitIntent ? 'disabled' : ''}>Склад и барахолка →</button><button class="text-button live-back" data-live-button="exit" ${actionBusy || exitIntent ? 'disabled' : ''}>${leavingLabel || '← Выйти с сервера в убежище'}</button></div>`;
    }
    const bossRoster=dock.querySelector<HTMLDetailsElement>('.live-boss-roster');if(bossRoster)bossRoster.open=selectedPurpose==='boss'||bossRosterOpen;
    const body = dock.querySelector<HTMLElement>('.live-dock-scroll'); if (body) body.scrollTop = scroll;
    const preparationScroll=overlay.querySelector<HTMLElement>('.live-entry-scroll'); if(preparationScroll)preparationScroll.scrollTop=entryScroll;
    const preparationBosses=overlay.querySelector<HTMLDetailsElement>('.live-boss-roster');if(preparationBosses)preparationBosses.open=selectedPurpose==='boss'||entryBossRosterOpen;
    const events = dock.querySelector<HTMLDetailsElement>('.live-events'); if (events) events.open = eventsOpen;
    if (focused) [...Array.from(dock.querySelectorAll<HTMLElement>('[data-live-button]')),...Array.from(overlay.querySelectorAll<HTMLElement>('[data-live-button]'))].find(button => button.dataset.liveButton === focused)?.focus({ preventScroll: true });
    else if (focusedSummary) dock.querySelector<HTMLElement>(`${focusedSummary} > summary`)?.focus({ preventScroll: true });
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
    if (!button || !(dock.contains(button) || overlay.contains(button)) || button.disabled) return;
    const [action, ...arguments_] = (button.dataset.liveButton ?? '').split(':');
    const id = arguments_.join(':'), dy = arguments_[1];
    if (action === 'join') void join();
    else if (action === 'boss-route') { const route=readLiveBossRoute(id);if(route&&!snapshot){selectedDistrict=route.districtId;selectedPurpose=route.purpose;selectedBossId=id;render();} }
    else if (action === 'boss-area'&&snapshot?.self.purpose==='boss'&&snapshot.server.bosses?.some(boss=>boss.bossId===id)){selectedBossId=id;render();}
    else if (action === 'kit' && isLiveKitId(id) && entry?.mode !== 'continue' && entry?.kits.some(kit => kit.kitId === id)) { selectedKit = id; render(); }
    else if (action === 'district' && entry?.mode !== 'continue' && districtId(id)) { selectedDistrict = id; render(); }
    else if (action === 'purpose' && entry?.mode !== 'continue' && Object.hasOwn(purposes, id)) { selectedPurpose = id as LivePurpose; render(); }
    else if (action === 'route' && snapshot?.world.routes?.some(route => route.id === id && route.purpose === snapshot!.self.purpose)) { selectedRouteId = id; render(); }
    else if (action === 'exit') void leave();
    else if (action === 'account') options.onAccount();
    else if (action === 'missions' && !snapshot && !actionBusy) { hide(); options.onMissionBoard?.(); }
    else if (action === 'market') void leave(true);
    else if (action === 'select' && id) { selectedId = id; scene.setSelected(id); render(); }
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
  dock.addEventListener('click', click); overlay.addEventListener('click', click); document.addEventListener('keydown', keyboard);
  return { show, hide, refreshPanel, resetIdentity, setEntrySelection, isActive: () => active, isActionPending: () => actionBusy || exitIntent, destroy: () => { hide(true); destroyed = true; generation++; dock.removeEventListener('click', click); overlay.removeEventListener('click', click); document.removeEventListener('keydown', keyboard); scene.destroy(); overlay.remove(); } };
}


