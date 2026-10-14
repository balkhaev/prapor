import type { LiveDistrictId, LivePurpose, LiveStatus } from './game/live';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const percentage = (position: number, size: number) => Math.max(5, Math.min(95, position / size * 100)).toFixed(2);

/** A public planning diagram: no actor positions, loot contents or client-side spawn command. */
export function raidEntryMap(server: LiveStatus | null, selected: LiveDistrictId, busy: boolean): string {
  const map = server?.maps[0];
  if (!map || !server) return '<div class="live-entry-map-loading" role="status">Подключаем карту Периметра…</div>';
  const city = map.city;
  const regions = server.districts.map(district => `<rect class="entry-region theme-${district.theme}" x="${district.x}" y="${district.y}" width="${district.width}" height="${district.height}" rx="7"/>`).join('');
  const center = city ? `<rect class="entry-city" x="${city.x}" y="${city.y}" width="${city.width}" height="${city.height}" rx="5"/>${city.quarters.map(quarter => `<rect class="entry-quarter" x="${quarter.x + 2}" y="${quarter.y + 2}" width="${Math.max(1, quarter.width - 4)}" height="${Math.max(1, quarter.height - 4)}" rx="3"/><text x="${quarter.x + quarter.width / 2}" y="${quarter.y + quarter.height / 2}" text-anchor="middle">${escape(quarter.name)}</text>`).join('')}` : '';
  const points = server.districts.map(district => {
    const point = district.labelPoint ?? district.spawns[0] ?? { x: district.x + district.width / 2, y: district.y + district.height / 2 };
    return `<button class="live-entry-start ${district.id === selected ? 'selected' : ''}" style="left:${percentage(point.x, map.width)}%;top:${percentage(point.y, map.height)}%" data-live-button="district:${district.id}" aria-pressed="${district.id === selected}" ${busy ? 'disabled' : ''}><i aria-hidden="true"></i><strong>${escape(district.name)}</strong><span>${district.online} онлайн</span></button>`;
  }).join('');
  return `<div class="live-entry-map" aria-label="Общая карта Периметра и районы входа"><svg viewBox="0 0 ${map.width} ${map.height}" role="img" aria-label="${escape(map.name)}: город в центре и четыре района по краям"><defs><pattern id="entry-map-grid" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M 16 0 L 0 0 0 16" fill="none" stroke="#a4b39c" stroke-opacity=".08" stroke-width=".5"/></pattern></defs><rect width="${map.width}" height="${map.height}" class="entry-ground"/><rect width="${map.width}" height="${map.height}" fill="url(#entry-map-grid)"/>${regions}${center}</svg>${points}<div class="live-entry-city-label"><strong>${escape(city?.name ?? map.name)}</strong><span>Город в сердце Периметра</span></div><span class="live-entry-compass" aria-hidden="true">С ↑</span></div>`;
}

export function raidEntryPurposeName(purpose: LivePurpose): string {
  return { pvp: 'Бой с игроками', pve: 'Зачистка NPC', loot: 'Поиск добычи', boss: 'Охота на главаря', quests: 'Разведка' }[purpose];
}
