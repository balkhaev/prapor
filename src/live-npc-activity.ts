import type { LiveEntity, LiveFactionSite, LiveNpcActivity } from './game/live';

const labels: Record<LiveNpcActivity, string> = {
  patrol: 'Патрулирует',
  travel: 'Идёт к соседнему посту',
  inspect: 'Осматривает место',
  rest: 'Отдыхает',
  investigate: 'Проверяет подозрительное место',
  return: 'Возвращается на пост',
  combat: 'Ведёт бой',
  assemble: 'Собирается с отрядом',
  capture: 'Занимает точку',
  forage: 'Ищет припасы',
  haul: 'Несёт добычу на базу',
  withdraw: 'Отступает к своим',
  defend: 'Защищает базу',
  reinforce: 'Идёт на помощь',
  retake: 'Отбивает точку',
  assault: 'Штурмует базу',
  regroup: 'Перегруппировывается',
};

/** Only describe what the server has revealed about an observed ordinary NPC. */
export function liveNpcActivityLabel(entity: LiveEntity): string | null {
  if (entity.kind !== 'scav' || entity.bossId || entity.health <= 0 || !entity.npcActivity) return null;
  if (entity.npcSquad && entity.npcActivity === 'travel') return 'Идёт с отрядом';
  return labels[entity.npcActivity];
}

export function liveNpcSquadLabel(entity: LiveEntity): string | null {
  if (entity.kind !== 'scav' || entity.bossId || entity.health <= 0 || !entity.npcSquad) return null;
  const number = Number(entity.npcSquad.id.split('-').at(-1)) + 1;
  return `${entity.npcSquad.leader ? 'Командир' : 'Боец'} отряда ${number}`;
}

export function liveFactionSiteLabel(site: LiveFactionSite): string {
  const place = site.kind === 'base' ? 'База' : 'Точка';
  const owner = site.owner === 'raiders' ? 'рейдеров' : site.owner === 'scavs' ? 'диких' : 'без владельца';
  return `${place} ${owner}${site.contested ? site.kind === 'base' ? ' · идёт бой за базу' : ' · идёт бой за точку' : ''}`;
}
