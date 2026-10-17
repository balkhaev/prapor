import type { LiveEntity, LiveNpcActivity } from './game/live';

const labels: Record<LiveNpcActivity, string> = {
  patrol: 'Патрулирует',
  travel: 'Идёт к соседнему посту',
  inspect: 'Осматривает место',
  rest: 'Отдыхает',
  investigate: 'Проверяет подозрительное место',
  return: 'Возвращается на пост',
  combat: 'Ведёт бой',
};

/** Only describe what the server has revealed about an observed ordinary NPC. */
export function liveNpcActivityLabel(entity: LiveEntity): string | null {
  return entity.kind === 'scav' && !entity.bossId && entity.health > 0 && entity.npcActivity
    ? labels[entity.npcActivity] : null;
}
