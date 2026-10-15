import './environment-preview.css';
import { mountSceneLightControl } from './scene-light-control';
import { createWorld, type WorldSnapshot } from './scene';
import { createGame } from './game/engine';
import { MAPS } from './game/data';
import { LiveScene } from './live-scene';
import { cityPreviewFocus, createCityPreviewSnapshot } from './metropolis-preview';
import type { LiveSnapshot } from './game/live';

const stage = document.querySelector<HTMLElement>('#environment-stage')!;
const choice = document.querySelector<HTMLSelectElement>('#environment-scene')!;
const locationLabel = document.querySelector<HTMLElement>('#environment-location')!;
const toolbar = document.querySelector<HTMLElement>('.environment-toolbar')!;
mountSceneLightControl(toolbar, { preview: true });
choice.add(new Option('Ольховск · большой город', 'metropolis'));
const requested = new URLSearchParams(location.search).get('scene');
choice.value = requested === 'base' ? 'base' : requested ? 'metropolis' : 'base';

const quarterLabel = document.createElement('label'); quarterLabel.className = 'environment-quarter'; quarterLabel.hidden = true;
quarterLabel.append('Район');
const quarterChoice = document.createElement('select'); quarterChoice.id = 'environment-quarter'; quarterChoice.setAttribute('aria-label', 'Район города');
quarterLabel.append(quarterChoice); toolbar.insertBefore(quarterLabel, document.querySelector('.environment-camera'));
const legacyHost = document.createElement('div'), cityHost = document.createElement('div'), loading = document.createElement('p');
legacyHost.className = cityHost.className = 'environment-render-host';
cityHost.hidden = true; loading.className = 'environment-loading'; loading.hidden = true; loading.setAttribute('role', 'status');
stage.append(legacyHost, cityHost, loading);

let state: ReturnType<typeof createGame> | null = null;
let world: ReturnType<typeof createWorld> | null = null, worldReady = false;
let cityScene: LiveScene | null = null, citySnapshot: LiveSnapshot | null = null, cityPromise: Promise<LiveSnapshot> | null = null;
let sceneRequest = 0, disposed = false;
function prepare(): void {
  state = createGame(Date.now()); state.level = 9; state.xp = 5760; state.money = 5000;
  state.supplies = { ammo: 200, medicine: 6, scrap: 40, intel: 100 };
}
function snapshot(): WorldSnapshot {
  const current = state!;
  return { identityKey: `environment-${choice.value}`, base: current.base, shelter: current.shelter, scavs: current.scavs,
    raids: [], weapons: current.weapons, gearItems: current.gearItems, maps: MAPS, level: current.level };
}
function ensureWorld(): void {
  if (world) return;
  world = createWorld(legacyHost, snapshot, () => {}, { canInteract: () => false, canDrag: () => false, canCamera: () => true });
  world.game.events.once('ready', () => { worldReady = true; if (choice.value === 'metropolis') world?.game.loop.sleep(); else void showScene(); });
}
function cityFocus(): void {
  if (cityScene && citySnapshot) cityScene.focusPoint(cityPreviewFocus(citySnapshot.world, quarterChoice.value));
}
async function showScene(): Promise<void> {
  const request = ++sceneRequest, city = choice.value === 'metropolis';
  cityScene?.hide(); legacyHost.hidden = city; cityHost.hidden = !city; quarterLabel.hidden = !city;
  document.querySelector<HTMLElement>('.environment-footer span')!.textContent = city
    ? 'Обзор без входа в рейд · выберите район или нажмите на карту · потяните для перемещения'
    : 'Потяните сцену для обзора · колесо мыши меняет масштаб';
  locationLabel.textContent = choice.selectedOptions[0]?.textContent ?? 'Окружение';
  const url = new URL(location.href); url.searchParams.set('scene', choice.value); history.replaceState(null, '', url);
  if (city) {
    world?.game.loop.sleep(); loading.hidden = false; loading.textContent = 'Собираем улицы и кварталы…';
    try {
      // Pure generation: no live client, login, launch, save or command endpoint is used.
      cityPromise ??= import('./game/world-generation').then(({ generateLiveWorld }) => createCityPreviewSnapshot(generateLiveWorld()));
      const preview = await cityPromise;
      if (disposed || request !== sceneRequest) return;
      if (!cityScene) {
        citySnapshot = preview;
        cityScene = new LiveScene(cityHost, () => {}, () => {}, { observer: true, controls: false });
        cityScene.update(preview);
        quarterChoice.add(new Option('Весь город', ''));
        for (const quarter of preview.world.city?.quarters ?? []) quarterChoice.add(new Option(quarter.name, quarter.id));
      }
      loading.hidden = true; quarterChoice.value = ''; cityScene.show(); cityScene.showOverview(true);
      locationLabel.textContent = `${preview.world.city?.name ?? preview.world.name} · ${preview.world.width} × ${preview.world.height}`;
    } catch {
      if (request === sceneRequest) {
        cityScene?.destroy(); cityScene = null; citySnapshot = null; quarterChoice.options.length = 0;
        loading.textContent = 'Не удалось подготовить город. Выберите другое место и попробуйте снова.'; cityPromise = null;
      }
    }
    return;
  }
  loading.hidden = true; prepare(); ensureWorld();
  if (!worldReady || !world) return;
  world.game.loop.wake(); world.setView('base'); world.setPanMode(true);
}
choice.addEventListener('change', () => { void showScene(); });
quarterChoice.addEventListener('change', () => { if (quarterChoice.value) cityFocus(); else cityScene?.showOverview(true); });
document.querySelector('#environment-out')!.addEventListener('click', () => { if (choice.value === 'metropolis') cityScene?.zoomBy(1 / 1.2); else world?.zoomBy(1 / 1.2); });
document.querySelector('#environment-in')!.addEventListener('click', () => { if (choice.value === 'metropolis') cityScene?.zoomBy(1.2); else world?.zoomBy(1.2); });
document.querySelector('#environment-overview')!.addEventListener('click', () => {
  if (choice.value === 'metropolis') { cityScene?.showOverview(true); quarterChoice.value = ''; return; }
  if (!world) return;
  world.resetCamera();
});
document.querySelector('#environment-focus')!.addEventListener('click', () => {
  if (choice.value === 'metropolis') { cityFocus(); return; }
  world?.focusBase();
});
window.addEventListener('pagehide', event => {
  cityScene?.hide();
  if (event.persisted) world?.game.loop.sleep();
  else { disposed = true; sceneRequest++; cityScene?.destroy(); world?.game.destroy(true); }
});
window.addEventListener('pageshow', event => { if (event.persisted) { if (choice.value === 'metropolis') cityScene?.show(); else world?.game.loop.wake(); } });
void showScene();
