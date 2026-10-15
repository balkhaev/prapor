import './scene-light-control.css';
import { readSceneClimate, readSceneLightMode, readSceneWeatherMode, setSceneLightMode, setSceneWeatherMode, setSceneClimatePreviewSpeed, resetSceneClimatePreview, type SceneLightMode, type SceneWeatherMode } from './scene-climate';
import { settledSurfaceWetness } from './scene-wetness';

export function mountSceneLightControl(host: Element, options: { preview?: boolean } = {}): () => void {
  const control = document.createElement('details'); control.className = 'scene-light-control';
  control.innerHTML = `<summary aria-label="Свет и погода" title="Свет и погода"><svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 2v2M2 6h2m.2-3.8 1.3 1.3M9.5 3.5l1.3-1.3M6 11a4 4 0 1 1 4-5"/><path d="M6 15a3.5 3.5 0 0 1-.5-7 5 5 0 0 1 9.2 1.3A2.9 2.9 0 1 1 15 15H6Z"/></svg><span class="scene-climate-desktop">Свет и погода</span><span class="scene-climate-mobile">Мир</span></summary><div class="scene-climate-panel"><div class="scene-climate-fields"><label>Освещение<select aria-label="Освещение сцены"><option value="auto">Автоматически</option><option value="day">День</option><option value="dusk">Сумерки</option><option value="night">Ночь</option></select></label><label>Погода<select aria-label="Погода сцены"><option value="auto">Автоматически</option><option value="clear">Ясно</option><option value="rain">Дождь</option><option value="fog">Туман</option></select></label>${options.preview ? '<label class="scene-climate-speed">Темп просмотра<select aria-label="Темп смены суток в просмотре"><option value="1">Обычный</option><option value="20">Быстрый просмотр</option></select></label>' : ''}</div><output class="scene-climate-status" aria-label="Время суток и погода" aria-live="off"></output><small>Игровые сутки — 24 минуты</small></div>`;
  const light = control.querySelector<HTMLSelectElement>('[aria-label="Освещение сцены"]')!, weather = control.querySelector<HTMLSelectElement>('[aria-label="Погода сцены"]')!;
  const status = control.querySelector<HTMLOutputElement>('output')!;
  const update = () => {
    light.value = readSceneLightMode(); weather.value = readSceneWeatherMode();
    if (control.open) { const climate = readSceneClimate(), target = settledSurfaceWetness(climate.rain); const surface = climate.wetness < target - .025 ? ' · Земля намокает' : climate.wetness > target + .025 && climate.wetness > .08 ? ' · Земля сохнет' : ''; status.textContent = `${climate.clockLabel} · ${climate.phaseLabel} · ${climate.weatherLabel}${surface}`; }
  };
  light.addEventListener('change', () => setSceneLightMode(light.value as SceneLightMode));
  weather.addEventListener('change', () => setSceneWeatherMode(weather.value as SceneWeatherMode));
  control.querySelector<HTMLSelectElement>('[aria-label="Темп смены суток в просмотре"]')?.addEventListener('change', event => setSceneClimatePreviewSpeed((event.target as HTMLSelectElement).value === '20' ? 20 : 1));
  control.addEventListener('toggle', update);
  const close = (event: Event) => { if (event.target instanceof Node && !control.contains(event.target)) control.open = false; };
  const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && control.open) { control.open = false; control.querySelector('summary')!.focus(); } };
  document.addEventListener('pointerdown', close); control.addEventListener('keydown', keydown);
  window.addEventListener('prapor:climate', update);
  const timer = window.setInterval(() => { if (!document.hidden && control.open) update(); }, 1000);
  const destroy = () => { clearInterval(timer); document.removeEventListener('pointerdown', close); window.removeEventListener('prapor:climate', update); window.removeEventListener('pagehide', pagehide); if (options.preview) resetSceneClimatePreview(); control.remove(); };
  const pagehide = (event: PageTransitionEvent) => { if (!event.persisted) destroy(); };
  window.addEventListener('pagehide', pagehide);
  update(); host.append(control); return destroy;
}
