import type { LiveCityRegion, LiveDistrictId, LivePurpose, LiveStatus } from './game/live';
import { cityStreetPlan } from './game/world-landscape';
import { METROPOLIS_CITY, metropolisStreetPlan } from './game/world-metropolis-plan';
import { PIXEL_PALETTE as P } from './pixel-art';
import { PIXEL_SCENE_THEME as T } from './pixel-scene-theme';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const percentage = (position: number, size: number) => Math.max(5, Math.min(95, position / size * 100)).toFixed(2);

/** The entry diagram imports street metadata, never the expensive world generator. */
export function raidEntryStreets(city: LiveCityRegion) {
  if (!city.quarters.some(quarter => quarter.id === 'metro-northworks')) return cityStreetPlan(city);
  const center = METROPOLIS_CITY.quarters.slice(0, 4);
  const x = Math.min(...center.map(quarter => quarter.x)), y = Math.min(...center.map(quarter => quarter.y));
  return [...metropolisStreetPlan(), ...cityStreetPlan({ ...city, x, y,
    width: Math.max(...center.map(quarter => quarter.x + quarter.width)) - x,
    height: Math.max(...center.map(quarter => quarter.y + quarter.height)) - y, quarters: center })];
}

/** A public planning diagram: no actor positions, loot contents or client-side spawn command. */
export function raidEntryMap(server: LiveStatus | null, selected: LiveDistrictId, busy: boolean): string {
  const map = server?.maps[0];
  if (!map || !server) return '<div class="live-entry-map-loading" role="status">Подключаем карту Периметра…</div>';
  const city = map.city;
  const unit = Math.max(map.width, map.height) / 256;
  const regions = server.districts.map(district => `<rect class="entry-region theme-${district.theme}" x="${district.x + 1}" y="${district.y + 1}" width="${district.width - 2}" height="${district.height - 2}" rx="1"/>`).join('');
  const woods = server.districts.map((district, index) => {
    const x = district.x + district.width * .12, y = district.y + district.height * .12, w = district.width * .78, h = district.height * .78;
    return `<path d="M${x},${y + h * .24}H${x + w * .16}V${y + h * .08}H${x + w * .59}V${y}H${x + w * .81}V${y + h * .19}H${x + w}V${y + h * .74}H${x + w * .83}V${y + h}H${x + w * .28}V${y + h * .87}H${x}Z" fill="url(#entry-map-woods)" opacity="${district.theme === 'forest' ? '.88' : index === 0 ? '.3' : '.5'}"/>`;
  }).join('');
  // The public city boundary and authored street plan are shared with the world.
  // Roof blocks illustrate its quarters; this preparation diagram contains no private entities.
  const streets = city ? raidEntryStreets(city) : [];
  // One bounded schematic, regardless of how many square kilometres the city covers.
  const area = city?.quarters.reduce((sum, quarter) => sum + quarter.width * quarter.height, 0) ?? 0;
  const step = Math.max(10, Math.ceil(Math.sqrt(area / 550))), roofScale = step / 10;
  let roofCount = 0;
  const blocks = city?.quarters.map((quarter, qi) => {
    const roofs: string[] = [];
    for (let y = quarter.y + 5; y < quarter.y + quarter.height - step; y += step + 1) for (let x = quarter.x + 5; x < quarter.x + quarter.width - step; x += step) {
      if (roofCount >= 600) break;
      const seed = (x * 13 + y * 7 + qi * 19) >>> 0, w = (4.5 + seed % 3) * roofScale, h = (5 + seed % 4) * roofScale;
      const road = streets.some(street => street.points.slice(1).some((b, index) => {
        const a = street.points[index]!;
        return a.x === b.x ? x < a.x + street.width / 2 + 1 && x + w > a.x - street.width / 2 - 1 && y < Math.max(a.y, b.y) && y + h > Math.min(a.y, b.y)
          : y < a.y + street.width / 2 + 1 && y + h > a.y - street.width / 2 - 1 && x < Math.max(a.x, b.x) && x + w > Math.min(a.x, b.x);
      }));
      if (road) continue;
      roofCount++;
      roofs.push(`<rect x="${x + .7}" y="${y + .9}" width="${w}" height="${h}" fill="${P.ink}" opacity=".6"/><rect data-entry-roof x="${x}" y="${y}" width="${w}" height="${h}" fill="${[P.roof, P.steel, P.panelShade, P.wood][qi % 4]}" stroke="${P.cream}" stroke-width=".28"/><path d="M${x + .6},${y + .7}h${w - 1.2}v${h - 1.4}h-${w - 1.2}Z" fill="url(#entry-map-roof)" opacity=".45"/>`);
    }
    return roofs.join('');
  }).join('') ?? '';
  const center = city ? `<rect class="entry-city" x="${city.x}" y="${city.y}" width="${city.width}" height="${city.height}" rx="1"/>${city.quarters.map(quarter => `<rect class="entry-quarter" x="${quarter.x + 2}" y="${quarter.y + 2}" width="${Math.max(1, quarter.width - 4)}" height="${Math.max(1, quarter.height - 4)}" rx="1"/>`).join('')}${blocks}${streets.map(street => {
    const path = street.points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
    return `<path d="${path}" fill="none" stroke="${P.concreteShade}" stroke-width="${street.width + .8}" stroke-linejoin="miter"/><path d="${path}" fill="none" stroke="${P.ink}" stroke-width="${street.width}" stroke-linejoin="miter"/><path d="${path}" fill="none" stroke="${P.yellow}99" stroke-width=".3" stroke-dasharray="2 3"/>`;
  }).join('')}${city.quarters.map(quarter => {
    const font = 4.2 * unit, limit = Math.max(8, Math.floor((quarter.width - 14) / (font * .56))), lines: string[] = [];
    for (const word of quarter.name.split(' ')) {
      if (lines.length && lines[lines.length - 1]!.length + word.length + 1 <= limit) lines[lines.length - 1] += ` ${word}`;
      else lines.push(word);
    }
    const height = font * (lines.length * 1.2 + .6), top = quarter.y + quarter.height - height - 5;
    return `<g><title>${escape(quarter.name)}</title><rect x="${quarter.x + 5}" y="${top}" width="${quarter.width - 10}" height="${height}" rx="1" fill="${T.panel}" fill-opacity=".86"/><text style="font-size:${font}px" x="${quarter.x + quarter.width / 2}" y="${top + font * 1.12}" text-anchor="middle">${lines.map((line, i) => `<tspan x="${quarter.x + quarter.width / 2}" dy="${i ? font * 1.2 : 0}">${escape(line)}</tspan>`).join('')}</text></g>`;
  }).join('')}` : '';
  const selectedDistrict = server.districts.find(district => district.id === selected);
  const deployment = selectedDistrict?.spawns[0];
  const selectedArea = selectedDistrict ? `<rect x="${selectedDistrict.x + 2}" y="${selectedDistrict.y + 2}" width="${selectedDistrict.width - 4}" height="${selectedDistrict.height - 4}" rx="1" fill="${T.self}" fill-opacity=".025" stroke="${T.self}" stroke-width=".8" stroke-dasharray="3 2"/>` : '';
  const approach = deployment && city ? `<path d="M${deployment.x},${deployment.y} L${deployment.x < city.x ? city.x : city.x + city.width},${deployment.y} L${deployment.x < city.x ? city.x : city.x + city.width},${deployment.y < city.y ? city.y : city.y + city.height}" fill="none" stroke="${T.self}" stroke-width="${.75 * unit}" stroke-dasharray="${1.5 * unit} ${2 * unit}" opacity=".6"/><circle cx="${deployment.x}" cy="${deployment.y}" r="${2.4 * unit}" fill="${T.text}" stroke="${T.panel}" stroke-width="${.8 * unit}"/>` : '';
  const points = server.districts.map(district => {
    const point = district.labelPoint ?? district.spawns[0] ?? { x: district.x + district.width / 2, y: district.y + district.height / 2 };
    return `<button class="live-entry-start ${district.id === selected ? 'selected' : ''}" style="left:${percentage(point.x, map.width)}%;top:${percentage(point.y, map.height)}%" data-live-button="district:${district.id}" aria-pressed="${district.id === selected}" ${busy ? 'disabled' : ''}><i aria-hidden="true"></i><strong>${escape(district.name)}</strong><span>${district.online} онлайн</span></button>`;
  }).join('');
  const coordinates = Array.from({ length: 7 }, (_, index) => `<text x="${map.width * (index + 1) / 8}" y="5" text-anchor="middle" fill-opacity=".5">${String.fromCharCode(65 + index)}</text><text x="3" y="${map.height * (index + 1) / 8}" fill-opacity=".5">${index + 1}</text>`).join('');
  return `<div class="live-entry-map" aria-label="Схема Периметра и районы входа"><svg shape-rendering="crispEdges" viewBox="0 0 ${map.width} ${map.height}" role="img" aria-label="${escape(map.name)}: схема кварталов, городских улиц и четырёх районов входа"><defs><pattern id="entry-map-grid" width="${map.width / 8}" height="${map.height / 8}" patternUnits="userSpaceOnUse"><path d="M${map.width / 8},0H0V${map.height / 8}" fill="none" stroke="${P.concrete}" stroke-opacity=".15" stroke-width=".35"/></pattern><pattern id="entry-map-woods" width="5" height="6" patternUnits="userSpaceOnUse"><rect width="5" height="6" fill="${P.leafShade}"/><path d="M1,0h1v1h1v1h1v1H0V2h1Z" fill="${P.leaf}"/><path d="M3,3h1v1h1v1H2V4h1Z" fill="${P.leafLight}"/></pattern><pattern id="entry-map-roof" width="1.5" height="1.5" patternUnits="userSpaceOnUse"><path d="M0,0H1.5" stroke="${P.ink}" stroke-width=".4"/></pattern></defs><rect width="${map.width}" height="${map.height}" class="entry-ground"/>${regions}${woods}${center}${selectedArea}${approach}<rect width="${map.width}" height="${map.height}" fill="url(#entry-map-grid)"/>${coordinates}</svg>${points}<div class="live-entry-city-label"><strong>${escape(city?.name ?? map.name)}</strong><span>Городские кварталы · схема входа</span></div><span class="live-entry-compass" aria-hidden="true">С ↑</span></div>`;
}

export function raidEntryPurposeName(purpose: LivePurpose): string {
  return { pvp: 'Бой с игроками', pve: 'Зачистка NPC', loot: 'Поиск добычи', boss: 'Охота на главаря', quests: 'Разведка' }[purpose];
}
