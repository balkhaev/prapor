import './scene-light-control.css';
import { readSceneLightMode, setSceneLightMode, type SceneLightMode } from './pixel-lighting';

export function mountSceneLightControl(host: Element): void {
  const label = document.createElement('label'); label.className = 'scene-light-control';
  label.innerHTML = '<span>Свет</span><select aria-label="Освещение сцены"><option value="day">День</option><option value="dusk">Сумерки</option><option value="night">Ночь</option></select>';
  const select = label.querySelector('select')!; select.value = readSceneLightMode();
  select.addEventListener('change', () => setSceneLightMode(select.value as SceneLightMode));
  window.addEventListener('prapor:lighting', () => { select.value = readSceneLightMode(); });
  host.append(label);
}
