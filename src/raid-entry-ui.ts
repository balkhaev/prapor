import type { LiveDistrictId, LivePurpose, LiveStatus } from './game/live';
import { cityStreetPlan } from './game/world-landscape';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const percentage = (position: number, size: number) => Math.max(5, Math.min(95, position / size * 100)).toFixed(2);

/** A public planning diagram: no actor positions, loot contents or client-side spawn command. */
export function raidEntryMap(server: LiveStatus | null, selected: LiveDistrictId, busy: boolean): string {
  const map = server?.maps[0];
  if (!map || !server) return '<div class="live-entry-map-loading" role="status">Подключаем карту Периметра…</div>';
  const city = map.city;
  const regions = server.districts.map(district => `<rect class="entry-region theme-${district.theme}" x="${district.x + 1}" y="${district.y + 1}" width="${district.width - 2}" height="${district.height - 2}" rx="5"/>`).join('');
  const woods = server.districts.map((district, index) => {
    const x = district.x + district.width * .12, y = district.y + district.height * .12, w = district.width * .78, h = district.height * .78;
    return `<path d="M${x},${y + h * .23} Q${x + w * .45},${y - h * .15} ${x + w * .85},${y + h * .12} T${x + w * .81},${y + h * .81} Q${x + w * .55},${y + h * 1.1} ${x + w * .12},${y + h * .78} T${x},${y + h * .23}Z" fill="url(#entry-map-woods)" opacity="${district.theme === 'forest' ? '.88' : index === 0 ? '.3' : '.5'}"/>`;
  }).join('');
  // The public city boundary and authored street plan are shared with the world.
  // Roof blocks illustrate its quarters; this preparation diagram contains no private entities.
  const streets = city ? cityStreetPlan(city) : [];
  const blocks = city?.quarters.map((quarter, qi) => {
    const roofs: string[] = [];
    for (let y = quarter.y + 5; y < quarter.y + quarter.height - 8; y += 11) for (let x = quarter.x + 5; x < quarter.x + quarter.width - 8; x += 10) {
      const seed = (x * 13 + y * 7 + qi * 19) >>> 0, w = 4.5 + seed % 3, h = 5 + seed % 4;
      const road = streets.some(street => street.points.slice(1).some((b, index) => {
        const a = street.points[index]!;
        return a.x === b.x ? x < a.x + street.width / 2 + 1 && x + w > a.x - street.width / 2 - 1 && y < Math.max(a.y, b.y) && y + h > Math.min(a.y, b.y)
          : y < a.y + street.width / 2 + 1 && y + h > a.y - street.width / 2 - 1 && x < Math.max(a.x, b.x) && x + w > Math.min(a.x, b.x);
      }));
      if (road) continue;
      roofs.push(`<rect x="${x + .7}" y="${y + .9}" width="${w}" height="${h}" fill="#132922" opacity=".6"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx=".35" fill="${['#a19c81', '#7f9690', '#989d82', '#a2957a'][qi % 4]}" stroke="#c9c5a4" stroke-width=".28"/><path d="M${x + .6},${y + .7}h${w - 1.2}v${h - 1.4}h-${w - 1.2}Z" fill="url(#entry-map-roof)" opacity=".45"/>`);
    }
    return roofs.join('');
  }).join('') ?? '';
  const center = city ? `<rect class="entry-city" x="${city.x}" y="${city.y}" width="${city.width}" height="${city.height}" rx="3"/>${city.quarters.map(quarter => `<rect class="entry-quarter" x="${quarter.x + 2}" y="${quarter.y + 2}" width="${Math.max(1, quarter.width - 4)}" height="${Math.max(1, quarter.height - 4)}" rx="2"/>`).join('')}${blocks}${streets.map(street => {
    const path = street.points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
    return `<path d="${path}" fill="none" stroke="#a9b094" stroke-width="${street.width + .8}" stroke-linejoin="round"/><path d="${path}" fill="none" stroke="#243d35" stroke-width="${street.width}" stroke-linejoin="round"/><path d="${path}" fill="none" stroke="#a4ab8399" stroke-width=".3" stroke-dasharray="2 3"/>`;
  }).join('')}${city.quarters.map(quarter => `<g><rect x="${quarter.x + 7}" y="${quarter.y + quarter.height - 11}" width="${quarter.width - 14}" height="7" rx="1" fill="#122c26" fill-opacity=".86"/><text x="${quarter.x + quarter.width / 2}" y="${quarter.y + quarter.height - 6.5}" text-anchor="middle">${escape(quarter.name)}</text></g>`).join('')}` : '';
  const selectedDistrict = server.districts.find(district => district.id === selected);
  const deployment = selectedDistrict?.spawns[0];
  const selectedArea = selectedDistrict ? `<rect x="${selectedDistrict.x + 2}" y="${selectedDistrict.y + 2}" width="${selectedDistrict.width - 4}" height="${selectedDistrict.height - 4}" rx="4" fill="#e2c082" fill-opacity=".025" stroke="#e4c58a" stroke-width=".8" stroke-dasharray="3 2"/>` : '';
  const approach = deployment && city ? `<path d="M${deployment.x},${deployment.y} L${deployment.x < city.x ? city.x : city.x + city.width},${deployment.y} L${deployment.x < city.x ? city.x : city.x + city.width},${deployment.y < city.y ? city.y : city.y + city.height}" fill="none" stroke="#e4c58a" stroke-width=".75" stroke-dasharray="1.5 2" opacity=".6"/><circle cx="${deployment.x}" cy="${deployment.y}" r="2.4" fill="#edd4a1" stroke="#102b22" stroke-width=".8"/>` : '';
  const points = server.districts.map(district => {
    const point = district.labelPoint ?? district.spawns[0] ?? { x: district.x + district.width / 2, y: district.y + district.height / 2 };
    return `<button class="live-entry-start ${district.id === selected ? 'selected' : ''}" style="left:${percentage(point.x, map.width)}%;top:${percentage(point.y, map.height)}%" data-live-button="district:${district.id}" aria-pressed="${district.id === selected}" ${busy ? 'disabled' : ''}><i aria-hidden="true"></i><strong>${escape(district.name)}</strong><span>${district.online} онлайн</span></button>`;
  }).join('');
  const coordinates = Array.from({ length: 7 }, (_, index) => `<text x="${map.width * (index + 1) / 8}" y="5" text-anchor="middle" fill-opacity=".5">${String.fromCharCode(65 + index)}</text><text x="3" y="${map.height * (index + 1) / 8}" fill-opacity=".5">${index + 1}</text>`).join('');
  return `<div class="live-entry-map" aria-label="Схема Периметра и районы входа"><svg viewBox="0 0 ${map.width} ${map.height}" role="img" aria-label="${escape(map.name)}: схема кварталов, городских улиц и четырёх районов входа"><defs><pattern id="entry-map-grid" width="${map.width / 8}" height="${map.height / 8}" patternUnits="userSpaceOnUse"><path d="M${map.width / 8},0H0V${map.height / 8}" fill="none" stroke="#c1cbb0" stroke-opacity=".15" stroke-width=".35"/></pattern><pattern id="entry-map-woods" width="5" height="6" patternUnits="userSpaceOnUse"><rect width="5" height="6" fill="#223f2c"/><circle cx="1" cy="2" r="1.2" fill="#486447"/><circle cx="3.5" cy="5" r="1.4" fill="#365637"/></pattern><pattern id="entry-map-roof" width="1.5" height="1.5" patternUnits="userSpaceOnUse"><path d="M0,0H1.5" stroke="#2a4035" stroke-width=".4"/></pattern><radialGradient id="entry-map-vignette"><stop offset=".6" stop-color="#08261a" stop-opacity="0"/><stop offset="1" stop-color="#08261a" stop-opacity=".65"/></radialGradient></defs><rect width="${map.width}" height="${map.height}" class="entry-ground"/>${regions}${woods}${center}${selectedArea}${approach}<rect width="${map.width}" height="${map.height}" fill="url(#entry-map-grid)"/><rect width="${map.width}" height="${map.height}" fill="url(#entry-map-vignette)"/>${coordinates}</svg>${points}<div class="live-entry-city-label"><strong>${escape(city?.name ?? map.name)}</strong><span>Городские кварталы · схема входа</span></div><span class="live-entry-compass" aria-hidden="true">С ↑</span></div>`;
}

export function raidEntryPurposeName(purpose: LivePurpose): string {
  return { pvp: 'Бой с игроками', pve: 'Зачистка NPC', loot: 'Поиск добычи', boss: 'Охота на главаря', quests: 'Разведка' }[purpose];
}
