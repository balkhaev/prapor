import type { LiveSnapshot } from './game/live';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const labels = {
  route: 'Идёт по маршруту', combat: 'Ведёт бой', search: 'Обыскивает контейнер', loot: 'Собирает добычу',
  treat: 'Лечится', extract: 'Возвращается с добычей', paused: 'Рейд на паузе', complete: 'Рейд завершён', downed: 'Боец тяжело ранен',
} as const;

/** Presentation reads server intent; it never advances a mission or issues a command. */
export function liveAutobattleStatus(snapshot: LiveSnapshot) {
  const auto = snapshot.self.automation;
  const self = snapshot.entities.find(entity => entity.id === snapshot.selfId)!;
  const stage = self.health <= 0 ? 'downed' : auto?.stage ?? 'paused';
  return { stage, label: labels[stage], enabled: auto?.enabled === true,
    complete: stage === 'complete', goal: auto?.goal || 'Включи автобой, чтобы продолжить выход.',
    routeName: auto?.routeName ?? null, stopIndex: auto?.stopIndex ?? 0, stopCount: auto?.stopCount ?? 0,
    reason: auto?.reason ?? null, startedAt: auto?.startedAt ?? 0 };
}

export function liveAutobattlePanel(snapshot: LiveSnapshot, blocked: boolean): string {
  const status = liveAutobattleStatus(snapshot);
  const progress = status.stopCount ? Math.min(100, status.stopIndex / status.stopCount * 100) : 0;
  const elapsed = status.startedAt ? Math.max(0, Math.floor(((snapshot.self.automation?.completedAt || snapshot.now) - status.startedAt) / 1000)) : 0;
  const duration = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const receipt = status.complete ? [...snapshot.events].reverse().find(event => event.kind === 'extract' && event.actorId === snapshot.selfId && event.at >= status.startedAt) : null;
  const disabled = blocked || status.stage === 'downed' ? 'disabled' : '';
  const returning = status.stage === 'extract';
  const completionHelp = snapshot.self.pendingDelivery?.length ? 'Груз вынесен и ждёт доставки. Проверь место на складе убежища.' : 'Новый рейд можно подготовить в убежище.';
  const actions = status.complete
    ? `${receipt ? `<p class="live-auto-receipt">${escape(receipt.text)}</p>` : ''}<button class="button primary live-auto-finish" data-live-button="exit" ${blocked ? 'disabled' : ''}>Вернуться в убежище →</button><small>${completionHelp}</small>`
    : `<div class="live-auto-actions"><button class="button ${status.enabled ? '' : 'primary'}" data-live-button="auto-toggle" aria-pressed="${status.enabled}" ${disabled}>${status.enabled ? 'Пауза' : 'Продолжить рейд'}</button><button class="button ${status.enabled ? 'primary' : ''}" data-live-button="recall" ${disabled || returning ? 'disabled' : ''}>${returning ? 'Боец возвращается…' : 'Вернуть бойца →'}</button></div><small>${returning ? 'Дождись зелёного выхода: там груз отправится в убежище.' : 'Боец действует сам. Верни его к выходу, чтобы сохранить добычу.'}</small>`;
  return `<section class="live-auto-panel stage-${status.stage}" aria-label="Состояние автоматического рейда"><div class="live-auto-heading"><span class="live-auto-signal ${status.enabled ? 'active' : ''}"><i></i>${status.complete ? 'ВЫХОД ЗАВЕРШЁН' : status.enabled ? 'АВТОБОЙ АКТИВЕН' : 'АВТОБОЙ НА ПАУЗЕ'}</span><time aria-label="Время в рейде">${duration}</time></div><h3>${status.label}</h3><p class="live-auto-goal" role="status">${escape(status.goal)}</p>${status.reason ? `<p class="live-auto-reason">${escape(status.reason)}</p>` : ''}${actions}<div class="live-auto-progress"><span>${escape(status.routeName ?? 'Маршрут выхода')}</span><b>${status.stopCount ? `${Math.min(status.stopIndex, status.stopCount)} / ${status.stopCount}` : '—'}</b><progress max="100" value="${progress}" aria-label="Пройденные точки маршрута"></progress></div></section>`;
}

export function liveObservedContact(entity: LiveSnapshot['entities'][number], self: { x: number; y: number }, selectedId: string | null): string {
  const range = Math.hypot(entity.x - self.x, entity.y - self.y);
  const kind = entity.bossId ? 'Главарь' : entity.kind === 'player' ? 'Игрок' : entity.faction === 'raiders' ? 'Рейдер' : 'Дикий';
  return `<article class="live-observed-contact ${entity.bossId ? 'boss' : entity.kind}" ><button data-live-button="select:${escape(entity.id)}" aria-pressed="${selectedId === entity.id}"><i>${entity.bossId ? '◆' : entity.kind === 'player' ? 'И' : 'Д'}</i><span><strong>${escape(entity.name)}</strong><small>${kind} · ${range.toFixed(1)} кл. · ${Math.ceil(entity.health)}% здоровья</small></span><b>◎</b></button></article>`;
}
