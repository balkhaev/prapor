import { getCargoValue, getRaidGroup, MODULE_BY_ID, type GameState, type Raid } from './game/engine';
import { raidGearReceipt, raidLootReceipt } from './flea-ui';
import { WEAPON_BY_ID } from './game/data';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const integer = (value: number) => Math.floor(value).toLocaleString('ru-RU');

/** Saved, already paid sorties can return their real cargo, without creating another small raid. */
export function raidReturnCard(state: GameState, raid: Raid, now = Date.now()): string {
  const group = getRaidGroup(state, raid), waiting = raid.expedition?.status === 'choice';
  const names = group.map(member => member.scavName).join(' · ');
  const value = group.reduce((sum, member) => sum + getCargoValue(member.expedition?.cargo ?? { money: 0, supplies: { ammo: 0, medicine: 0, scrap: 0, intel: 0 }, weaponIds: [], modules: [] }), 0);
  const seconds = Math.max(0, Math.ceil((raid.endsAt - now) / 1000));
  return `<article class="decision-card" data-expedition="${escape(raid.id)}"><div class="decision-head"><div><span class="eyebrow">Возвращение прежнего отряда</span><h3>${escape(names)}</h3><p>${waiting ? 'Боец на связи. Верни оплаченный груз в убежище.' : 'Уже начатый выход завершится по сохранённым правилам. После возвращения все новые рейды проходят на общем Периметре.'}</p></div></div><div class="decision-content">${waiting ? `<div class="cargo-summary"><div><span>Подтверждённый груз</span><strong>≈ ${integer(value)} ₽</strong><small>Оценка наличных и предметов</small></div></div>${group.map(member => {
    const cargo = member.expedition?.cargo;
    const supplies = cargo ? ([['ammo', 'Патроны'], ['medicine', 'Медикаменты'], ['scrap', 'Материалы'], ['intel', 'Разведданные']] as const)
      .filter(([key]) => cargo.supplies[key] > 0).map(([key, label]) => `<span>${label}: <b>${integer(cargo.supplies[key])}</b></span>`).join('') : '';
    return cargo ? `<section><h4>${escape(member.scavName)}</h4><strong>${integer(cargo.money)} ₽</strong>${supplies ? `<div class="loadout-stats">${supplies}</div>` : ''}${raidLootReceipt(cargo.lootItems)}${raidGearReceipt(cargo.gearItems)}${cargo.modules.map(part => `<p>${escape(MODULE_BY_ID[part.modelId]?.label ?? 'Модуль')} · ${Math.floor(part.durability)}%</p>`).join('')}${cargo.weaponIds.map(id => `<p>${escape(WEAPON_BY_ID[id]?.name ?? 'Оружейный трофей')}</p>`).join('')}</section>` : '';
  }).join('')}<button class="button" data-action="extract" data-id="${escape(raid.id)}" data-focus-key="extract">Вернуть ${group.length > 1 ? 'отряд' : 'бойца'} с добычей →</button>` : `<strong data-raid-time="${escape(raid.id)}">${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}</strong>`}</div></article>`;
}
