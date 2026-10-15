import './environment-preview.css';
import { mountSceneLightControl } from './scene-light-control';
import { createWorld, type WorldSnapshot } from './scene';
import { createGame, dispatchRaid } from './game/engine';
import { MAPS } from './game/data';
import { getRaidFieldPlan } from './raid-field';

const stage = document.querySelector<HTMLElement>('#environment-stage')!;
const choice = document.querySelector<HTMLSelectElement>('#environment-scene')!;
const locationLabel = document.querySelector<HTMLElement>('#environment-location')!;
mountSceneLightControl(document.querySelector('.environment-toolbar')!, { preview: true });
for (const map of MAPS) choice.add(new Option(map.name, map.id));
choice.add(new Option('Карта маршрутов', 'map'));
const requested = new URLSearchParams(location.search).get('scene');
choice.value = requested === 'base' || requested === 'map' || MAPS.some(map => map.id === requested) ? requested! : 'base';

let state = createGame(Date.now()), beganAt = performance.now(), duration = 60000;
function prepare(): void {
  state = createGame(Date.now()); state.level = 9; state.xp = 5760; state.money = 5000;
  state.supplies = { ammo: 200, medicine: 6, scrap: 40, intel: 100 };
  if (choice.value !== 'base' && choice.value !== 'map') {
    dispatchRaid(state, state.scavs[0]!.id, choice.value, Date.now());
    const raid = state.raids[0];
    if (raid) { raid.seed = 698906565; duration = Math.max(60000, raid.endsAt - raid.startedAt); }
  }
  beganAt = performance.now();
}
prepare();
function snapshot(): WorldSnapshot {
  const raid = state.raids[0];
  if (raid) { const now = Date.now(), elapsed = (performance.now() - beganAt) % duration; raid.startedAt = now - elapsed; raid.endsAt = raid.startedAt + duration; }
  return { identityKey: `environment-${choice.value}`, base: state.base, shelter: state.shelter, scavs: state.scavs,
    raids: state.raids, selectedRaidId: raid?.id ?? null, weapons: state.weapons, gearItems: state.gearItems,
    maps: MAPS, level: state.level, selectedMapId: choice.value === 'base' || choice.value === 'map' ? 'courtyard' : choice.value };
}
const world = createWorld(stage, snapshot, () => {}, { canInteract: () => false, canDrag: () => false, canCamera: () => true });
function showScene(): void {
  prepare(); world.selectRaid(state.raids[0]?.id ?? null); world.setView(choice.value === 'map' ? 'map' : choice.value === 'base' ? 'base' : 'raid');
  document.querySelector<HTMLElement>('.environment-camera')!.hidden = choice.value === 'map';
  document.querySelector<HTMLElement>('.scene-light-control')!.hidden = choice.value === 'map';
  document.querySelector<HTMLElement>('.environment-footer span')!.textContent = choice.value === 'map'
    ? 'Оперативная схема · координаты районов и направления от базы'
    : 'Потяните сцену для обзора · колесо мыши меняет масштаб';
  world.setPanMode(true); world.setRaidFollow(true);
  locationLabel.textContent = choice.selectedOptions[0]?.textContent ?? 'Окружение';
  const url = new URL(location.href); url.searchParams.set('scene', choice.value); history.replaceState(null, '', url);
}
choice.addEventListener('change', showScene);
document.querySelector('#environment-out')!.addEventListener('click', () => world.zoomBy(1 / 1.2));
document.querySelector('#environment-in')!.addEventListener('click', () => world.zoomBy(1.2));
document.querySelector('#environment-overview')!.addEventListener('click', () => {
  if (choice.value === 'base') { world.resetCamera(); return; }
  const raid = state.raids[0]; if (!raid) return;
  const plan = getRaidFieldPlan(raid);
  world.setRaidFollow(false); world.zoomBy(.7 / world.getCameraState().zoom);
  const camera = world.getCameraState(), canvas = world.game.canvas;
  const center = { x: plan.height * 32 + 160 + (plan.width - plan.height) * 16, y: 110 + (plan.width + plan.height) * 8 };
  world.panBy((center.x - canvas.width / camera.zoom / 2 - camera.x) * camera.zoom, (center.y - canvas.height / camera.zoom / 2 - camera.y) * camera.zoom);
});
document.querySelector('#environment-focus')!.addEventListener('click', () => { if (choice.value === 'base') world.focusBase(); else { world.setRaidFollow(true); world.zoomBy(1.8 / world.getCameraState().zoom); } });
world.game.events.once('ready', showScene);
window.addEventListener('pagehide', event => { if (event.persisted) world.game.loop.sleep(); else world.game.destroy(true); });
window.addEventListener('pageshow', event => { if (event.persisted) world.game.loop.wake(); });
