import type { LiveDistrictId, LivePurpose } from './game/live';

export type RaidEntrySelection = { districtId?: LiveDistrictId; purpose?: LivePurpose };

export const ENTRY_DISTRICTS: { id: LiveDistrictId; name: string; detail: string; symbol: string }[] = [
  { id: 'customs', name: 'Таможня', detail: 'Склады и северный въезд в город', symbol: '▦' },
  { id: 'sawmill', name: 'Лесопилка', detail: 'Лесные тропы и производственные дворы', symbol: '♠' },
  { id: 'depot', name: 'Депо', detail: 'Платформы, мастерские и грузовые пути', symbol: '▤' },
  { id: 'village', name: 'Посёлок', detail: 'Жилые дворы и южные переправы', symbol: '⌂' },
];

/** Old squad destinations remain useful as recommendations for the shared world. */
export function multiplayerSelection(mapId?: string, purpose: LivePurpose = 'loot'): RaidEntrySelection {
  const districtId: LiveDistrictId = mapId === 'courtyard' ? 'village' : mapId === 'depot' ? 'depot' : mapId === 'forest' || mapId === 'bunker' ? 'sawmill' : 'customs';
  return { districtId, purpose };
}

export function multiplayerEntryBrief(missions: number, waiting: number): string {
  return `<section class="gameplay-focus command-live-entry" aria-label="Выход в общий рейд"><span class="eyebrow">ОБЩИЙ ПЕРИМЕТР · PvPvE</span><h2>Выйти в рейд</h2><p>Выбери комплект и точку входа. Управляй своим бойцом, встречай игроков и NPC, ищи добычу и доставляй её в убежище.</p><button class="button" data-open-live>Подготовить выход →</button><small>Одна большая карта · свободное движение · прогресс на сервере</small><button class="text-button" data-mission-board>Задания отряда${missions ? ` · ${missions} в пути` : ''}${waiting ? ` · ${waiting} ждут приказ` : ''} →</button></section>`;
}
