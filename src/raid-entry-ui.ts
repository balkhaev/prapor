import type { LiveCityRegion, LiveDistrictId, LiveLandscapePath, LivePurpose, LiveStatus } from './game/live';
import { cityStreetPlan } from './game/world-landscape';
import { METROPOLIS_CITY, metropolisParcelPlan, metropolisStreetPlan } from './game/world-metropolis-plan';
import { PIXEL_PALETTE as P, pixelSeed } from './pixel-art';
import { PIXEL_SCENE_THEME as T } from './pixel-scene-theme';
import { pixelLandcoverBands, segmentTouchesRect, type LandcoverRect } from './pixel-landcover';

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

export function entryRoadTouchesRect(streets: readonly LiveLandscapePath[], box: LandcoverRect): boolean {
  return streets.some(street => street.points.some((point, index) => index > 0 && segmentTouchesRect(street.points[index - 1]!, point, box, street.width / 2 + 1)));
}

/** Bounded roof glyphs illustrate real land parcels; their locations do not claim building/loot precision. */
export function raidEntryBlocks(city: LiveCityRegion, streets: readonly LiveLandscapePath[]): Array<LandcoverRect & { sourceId: string; variant: number }> {
  const metro = city.quarters.some(quarter => quarter.id === 'metro-northworks');
  const lots = [...(metro ? metropolisParcelPlan().map(parcel => ({ id: parcel.id, rect: parcel.rect, count: parcel.layout === 'garden' ? 2 : parcel.layout === 'yard' ? 3 : 4 })) : []),
    ...city.quarters.filter(quarter => !metro || !quarter.id.startsWith('metro-')).map(quarter => ({ id: quarter.id, rect: quarter, count: 20 }))];
  const blocks: Array<LandcoverRect & { sourceId: string; variant: number }> = [];
  for (const lot of lots) {
    const local: LandcoverRect[] = [], seed = pixelSeed(lot.id);
    for (let attempt = 0; attempt < lot.count * 5 && local.length < lot.count && blocks.length < 600; attempt++) {
      const variant = (seed + attempt * 719) >>> 0;
      const width = Math.min(lot.rect.width * .26, 9 + variant % 13), height = Math.min(lot.rect.height * .22, 7 + (variant >>> 5) % 11);
      const u = ((seed % 997) / 997 + attempt * .61803398875) % 1, v = (((seed >>> 9) % 991) / 991 + attempt * .41421356237) % 1;
      const box = { x: Math.round(lot.rect.x + 2 + u * Math.max(0, lot.rect.width - width - 4)), y: Math.round(lot.rect.y + 2 + v * Math.max(0, lot.rect.height - height - 4)), width, height };
      if (entryRoadTouchesRect(streets, box) || local.some(other => box.x < other.x + other.width + 2 && box.x + box.width + 2 > other.x && box.y < other.y + other.height + 2 && box.y + box.height + 2 > other.y)) continue;
      local.push(box); blocks.push({ ...box, sourceId: lot.id, variant: variant % 4 });
    }
  }
  return blocks;
}

const contourPath = (bounds: LandcoverRect, id: string): string => pixelLandcoverBands(bounds, id).map(band => {
  const x = Math.round(band.x), y = Math.round(band.y), width = Math.max(1, Math.round(band.width)), height = Math.max(1, Math.round(band.height));
  return `M${x},${y}h${width}v${height}h-${width}Z`;
}).join('');

/** A public planning diagram: no actor positions, loot contents or client-side spawn command. */
export function raidEntryMap(server: LiveStatus | null, selected: LiveDistrictId, busy: boolean): string {
  const map = server?.maps[0];
  if (!map || !server) return '<div class="live-entry-map-loading" role="status">Подключаем карту Периметра…</div>';
  const city = map.city;
  const unit = Math.max(map.width, map.height) / 256;
  const woods = server.districts.map((district, index) => {
    const x = district.x + district.width * .08, y = district.y + district.height * .07;
    return `<path d="${contourPath({ x, y, width: district.width * .86, height: district.height * .79 }, district.id)}" fill="url(#entry-map-woods)" opacity="${district.theme === 'forest' ? '.65' : index === 0 ? '.22' : '.32'}"/>`;
  }).join('');
  // The public city boundary and authored street plan are shared with the world.
  // Roof blocks illustrate its quarters; this preparation diagram contains no private entities.
  const streets = city ? raidEntryStreets(city) : [];
  const parcels = city?.quarters.some(quarter => quarter.id === 'metro-northworks') ? metropolisParcelPlan() : [];
  const land = parcels.map(parcel => `<path d="${contourPath({ x: parcel.rect.x - 4, y: parcel.rect.y - 3, width: parcel.rect.width + 8, height: parcel.rect.height + 6 }, parcel.id)}" fill="${parcel.layout === 'garden' ? P.leafShade : parcel.layout === 'yard' ? P.concreteShade : P.panelShade}" opacity=".33"/>`).join('');
  const blocks = city ? raidEntryBlocks(city, streets).map(({ x, y, width, height, variant }) => `<rect x="${x + .7}" y="${y + .9}" width="${width}" height="${height}" fill="${P.ink}" opacity=".5"/><rect data-entry-roof x="${x}" y="${y}" width="${width}" height="${height}" fill="${[P.roof, P.steel, P.panelShade, P.wood][variant]}"/><path d="M${x + .6},${y + .7}h${width - 1.2}v${height - 1.4}h-${width - 1.2}Z" fill="url(#entry-map-roof)" opacity=".3"/>`).join('') : '';
  const center = city ? `${land}${blocks}${streets.map(street => {
    const path = street.points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
    return `<path d="${path}" fill="none" stroke="${P.concreteShade}" stroke-width="${street.width + .8}" stroke-linejoin="round"/><path d="${path}" fill="none" stroke="${P.ink}" stroke-width="${street.width}" stroke-linejoin="round"/>`;
  }).join('')}${city.quarters.map(quarter => {
    const font = 4.2 * unit, limit = Math.max(8, Math.floor((quarter.width - 14) / (font * .56))), lines: string[] = [];
    for (const word of quarter.name.split(' ')) {
      if (lines.length && lines[lines.length - 1]!.length + word.length + 1 <= limit) lines[lines.length - 1] += ` ${word}`;
      else lines.push(word);
    }
    const height = font * (lines.length * 1.2 + .6), top = quarter.y + quarter.height - height - 5;
    return `<g><title>${escape(quarter.name)}</title><text class="entry-quarter-label" style="font-size:${font}px;stroke-width:${unit * 1.4}px" x="${quarter.x + quarter.width / 2}" y="${top + font * 1.12}" text-anchor="middle">${lines.map((line, i) => `<tspan x="${quarter.x + quarter.width / 2}" dy="${i ? font * 1.2 : 0}">${escape(line)}</tspan>`).join('')}</text></g>`;
  }).join('')}` : '';
  const selectedDistrict = server.districts.find(district => district.id === selected);
  const deployment = selectedDistrict?.spawns[0];
  const approach = deployment ? `<circle cx="${deployment.x}" cy="${deployment.y}" r="${5 * unit}" fill="none" stroke="${T.self}" stroke-width="${.8 * unit}"/><circle cx="${deployment.x}" cy="${deployment.y}" r="${2.4 * unit}" fill="${T.text}" stroke="${T.panel}" stroke-width="${.8 * unit}"/>` : '';
  const points = server.districts.map(district => {
    const point = district.labelPoint ?? district.spawns[0] ?? { x: district.x + district.width / 2, y: district.y + district.height / 2 };
    return `<button class="live-entry-start ${district.id === selected ? 'selected' : ''}" style="left:${percentage(point.x, map.width)}%;top:${percentage(point.y, map.height)}%" data-live-button="district:${district.id}" aria-pressed="${district.id === selected}" ${busy ? 'disabled' : ''}><i aria-hidden="true"></i><strong>${escape(district.name)}</strong><span>${district.online} онлайн</span></button>`;
  }).join('');
  const coordinates = Array.from({ length: 7 }, (_, index) => `<text x="${map.width * (index + 1) / 8}" y="5" text-anchor="middle" fill-opacity=".5">${String.fromCharCode(65 + index)}</text><text x="3" y="${map.height * (index + 1) / 8}" fill-opacity=".5">${index + 1}</text>`).join('');
  return `<div class="live-entry-map" aria-label="Схема Периметра и районы входа"><svg shape-rendering="crispEdges" viewBox="0 0 ${map.width} ${map.height}" role="img" aria-label="${escape(map.name)}: схема кварталов, городских улиц и четырёх районов входа"><defs><pattern id="entry-map-grid" width="${map.width / 8}" height="${map.height / 8}" patternUnits="userSpaceOnUse"><path d="M${map.width / 8},0H0V${map.height / 8}" fill="none" stroke="${P.concrete}" stroke-opacity=".06" stroke-width=".35"/></pattern><pattern id="entry-map-woods" width="5" height="6" patternUnits="userSpaceOnUse"><rect width="5" height="6" fill="${P.leafShade}"/><path d="M1,0h1v1h1v1h1v1H0V2h1Z" fill="${P.leaf}"/><path d="M3,3h1v1h1v1H2V4h1Z" fill="${P.leafLight}"/></pattern><pattern id="entry-map-roof" width="1.5" height="1.5" patternUnits="userSpaceOnUse"><path d="M0,0H1.5" stroke="${P.ink}" stroke-width=".4"/></pattern></defs><rect width="${map.width}" height="${map.height}" class="entry-ground"/>${woods}${center}${approach}<rect width="${map.width}" height="${map.height}" fill="url(#entry-map-grid)"/>${coordinates}</svg>${points}<div class="live-entry-city-label"><strong>${escape(city?.name ?? map.name)}</strong><span>Городские кварталы · схема входа</span></div><span class="live-entry-compass" aria-hidden="true">С ↑</span></div>`;
}

export function raidEntryPurposeName(purpose: LivePurpose): string {
  return { pvp: 'Бой с игроками', pve: 'Зачистка NPC', loot: 'Поиск добычи', boss: 'Охота на главаря', quests: 'Разведка' }[purpose];
}
