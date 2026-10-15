import './pixel-model-preview.css';
import { SCAV_APPEARANCES } from './game/scav-appearances';
import { BOSSES, getBoss, type BossId } from './game/bosses';
import { WEAPON_BY_ID } from './game/data';
import { GEAR_MODEL_BY_ID } from './game/systems';
import type { LiveEntity } from './game/live';
import { PixelRaster } from './pixel-art';
import { PIXEL_FACINGS, type PixelActorMode, type PixelFacing } from './pixel-animation';
import { PixelActorArt, PIXEL_ACTOR_FRAMES, type PixelActorGear } from './pixel-actors';
import { paintPixelWeapon, pixelWeaponId, PIXEL_WEAPON_IDS, type PixelWeaponId } from './pixel-weapons';

const weaponLabels: Record<PixelWeaponId, { name: string; detail: string }> = {
  pm: { name: 'ПМ «Старик»', detail: 'Пистолет · одна рука' },
  pp91: { name: 'Кедр «Шершень»', detail: 'Пистолет-пулемёт · рамочный приклад' },
  sks: { name: 'СКС «Лесник»', detail: 'Карабин · деревянная ложа' },
  mosin: { name: 'Мосинка «Дед»', detail: 'Винтовка · продольный затвор' },
  akm: { name: 'АКМ «Гром»', detail: 'Автомат · изогнутый магазин' },
  svd: { name: 'СВД «Горизонт»', detail: 'Винтовка · прицел ПСО' },
  unknown: { name: 'Неизвестное оружие', detail: 'Нейтральный силуэт · без оптики' },
};
const facingLabels: Record<PixelFacing, string> = { e: 'Справа', se: 'Спереди справа', s: 'Спереди', sw: 'Спереди слева', w: 'Слева', nw: 'Сзади слева', n: 'Сзади', ne: 'Сзади справа' };
const poseLabels: Record<PixelActorMode, string> = { idle: 'Стоит', walk: 'Идёт', aim: 'Целится', fire: 'Стреляет', hit: 'Получает попадание', downed: 'Ранен на земле' };
const profileLabels: Record<PixelActorGear['profile'], string> = { light: 'Налегке', assault: 'Штурм', scout: 'Разведка' };
const frameDuration: Record<PixelActorMode, number> = { idle: 440, walk: 110, aim: 380, fire: 90, hit: 160, downed: 1000 };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const art = new PixelActorArt();
type Figure = 'scav' | 'raider' | BossId;
const state = { figure: 'scav' as Figure, appearance: 0, weapon: 'akm' as PixelWeaponId, mode: 'walk' as PixelActorMode, facing: 'se' as PixelFacing, frame: 0, playing: !reducedMotion.matches, rotating: !reducedMotion.matches, gear: { profile: 'assault', helmet: true, armor: true, backpack: true } as PixelActorGear };

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing preview element: ${id}`);
  return found as T;
}
const appearanceSelect = element<HTMLSelectElement>('model-appearance');
const figureSelect = element<HTMLSelectElement>('model-figure');
const weaponSelect = element<HTMLSelectElement>('model-weapon');
const poseSelect = element<HTMLSelectElement>('model-pose');
const facingSelect = element<HTMLSelectElement>('model-facing');
const playButton = element<HTMLButtonElement>('play-animation');
const rotateButton = element<HTMLButtonElement>('rotate-model');
const frameInput = element<HTMLInputElement>('animation-frame');
const selectedCanvas = element<HTMLCanvasElement>('selected-model');
const stage = element<HTMLDivElement>('model-stage');
const profileButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-profile]')];
const bearingCards = new Map<PixelFacing, { button: HTMLButtonElement; canvas: HTMLCanvasElement }>();
const weaponCards = new Map<PixelWeaponId, HTMLButtonElement>();

for (const look of SCAV_APPEARANCES) appearanceSelect.add(new Option(`${String(look.id + 1).padStart(2, '0')} · ${look.name}`, String(look.id)));
for (const id of PIXEL_WEAPON_IDS) weaponSelect.add(new Option(weaponLabels[id].name, id));
weaponSelect.value = state.weapon;
for (const facing of PIXEL_FACINGS) facingSelect.add(new Option(facingLabels[facing], facing));
facingSelect.value = state.facing;

for (const facing of PIXEL_FACINGS) {
  const button = document.createElement('button'), canvas = document.createElement('canvas'), label = document.createElement('span');
  button.type = 'button'; button.className = 'bearing-card'; button.setAttribute('aria-label', `Рассмотреть: ${facingLabels[facing].toLowerCase()}`);
  canvas.width = 192; canvas.height = 208; canvas.setAttribute('aria-hidden', 'true'); label.textContent = facingLabels[facing];
  button.append(canvas, label); button.addEventListener('click', () => selectFacing(facing));
  bearingCards.set(facing, { button, canvas }); element('bearing-grid').append(button);
}
for (const id of PIXEL_WEAPON_IDS) {
  const button = document.createElement('button'), canvas = document.createElement('canvas'), title = document.createElement('strong'), detail = document.createElement('small');
  button.type = 'button'; button.className = 'weapon-card'; button.setAttribute('aria-label', `Взять в руки ${weaponLabels[id].name}`);
  canvas.width = 128; canvas.height = 56; canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  if (context) paintPixelWeapon(new PixelRaster(context, canvas.width, canvas.height), id, { x: 48, y: 36 }, 'e');
  title.textContent = weaponLabels[id].name; detail.textContent = weaponLabels[id].detail; button.append(canvas, title, detail);
  button.addEventListener('click', () => { state.weapon = id; weaponSelect.value = id; changed(); });
  weaponCards.set(id, button); element('pixel-weapon-grid').append(button);
}

function identity(): Pick<LiveEntity, 'appearance' | 'faction' | 'bossId' | 'role'> {
  const boss = getBoss(state.figure);
  return { appearance: state.appearance, faction: state.figure === 'scav' ? 'scavs' : 'raiders', role: state.figure === 'scav' ? 'patrol' : 'guard', ...(boss ? { bossId: boss.id } : {}) };
}
let framing: { left: number; right: number; top: number; bottom: number } | null = null;
/** Frame every bearing and pose frame together so walking never recentres the feet. */
function modelBounds(): NonNullable<typeof framing> {
  if (framing) return framing;
  const bounds = { left: 0, right: 0, top: 0, bottom: 0 }, entity = identity();
  for (const facing of PIXEL_FACINGS) for (let frame = 0; frame < PIXEL_ACTOR_FRAMES[state.mode]; frame++) {
    const sprite = art.get(entity, { mode: state.mode, frame, facing }, state.weapon, state.gear);
    bounds.left = Math.min(bounds.left, -sprite.anchor.x); bounds.right = Math.max(bounds.right, sprite.image.width - sprite.anchor.x);
    bounds.top = Math.min(bounds.top, -sprite.anchor.y); bounds.bottom = Math.max(bounds.bottom, sprite.image.height - sprite.anchor.y);
  }
  framing = bounds; return bounds;
}
function drawActor(canvas: HTMLCanvasElement, facing: PixelFacing, large: boolean): void {
  const context = canvas.getContext('2d'); if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const bounds = modelBounds(), modelWidth = bounds.right - bounds.left, modelHeight = bounds.bottom - bounds.top;
  const scale = large ? Math.max(1, Math.min(2, Math.floor(Math.min((canvas.width - 32) / modelWidth, (canvas.height - 32) / modelHeight)))) : 1;
  const anchor = large ? { x: Math.floor((canvas.width - modelWidth * scale) / 2) - bounds.left * scale, y: Math.floor((canvas.height - modelHeight * scale) / 2) - bounds.top * scale } : { x: 96, y: 176 };
  const ground = new PixelRaster(context, canvas.width, canvas.height);
  if (large) {
    for (let offset = -3; offset <= 3; offset++) {
      const x = anchor.x + offset * 43 * scale, y = anchor.y + 7;
      ground.line(x - 120 * scale, y - 60 * scale, x + 120 * scale, y + 60 * scale, '#35422d');
      ground.line(x - 120 * scale, y + 60 * scale, x + 120 * scale, y - 60 * scale, '#35422d');
    }
    ground.polygon([{ x: anchor.x, y: anchor.y - 30 * scale }, { x: anchor.x + 72 * scale, y: anchor.y + 6 }, { x: anchor.x, y: anchor.y + 38 * scale }, { x: anchor.x - 72 * scale, y: anchor.y + 6 }], '#414d34');
    ground.line(anchor.x - 72 * scale, anchor.y + 6, anchor.x, anchor.y + 38 * scale, '#64704a');
    ground.line(anchor.x, anchor.y + 38 * scale, anchor.x + 72 * scale, anchor.y + 6, '#64704a');
  }
  ground.ellipse(anchor.x, anchor.y + 3, 34 * scale, 10 * scale, large ? '#2e3a29' : '#1e2c20');
  const sprite = art.get(identity(), { mode: state.mode, frame: state.frame, facing }, state.weapon, state.gear);
  context.imageSmoothingEnabled = false;
  context.drawImage(sprite.image, anchor.x - sprite.anchor.x * scale, anchor.y - sprite.anchor.y * scale, sprite.image.width * scale, sprite.image.height * scale);
}

function render(): void {
  drawActor(selectedCanvas, state.facing, true);
  for (const [facing, { button, canvas }] of bearingCards) { drawActor(canvas, facing, false); button.setAttribute('aria-pressed', String(facing === state.facing)); }
  element('stage-direction').textContent = facingLabels[state.facing];
  const description = `${element('model-summary').textContent}. ${poseLabels[state.mode]}. ${facingLabels[state.facing]}.`;
  if (selectedCanvas.getAttribute('aria-label') !== description) selectedCanvas.setAttribute('aria-label', description);
  frameInput.value = String(state.frame + 1);
  element<HTMLOutputElement>('frame-number').value = `${state.frame + 1} / ${PIXEL_ACTOR_FRAMES[state.mode]}`;
}

function refreshControls(): void {
  const appearance = SCAV_APPEARANCES[state.appearance]!, boss = getBoss(state.figure), name = boss?.name ?? (state.figure === 'raider' ? `Налётчик · ${appearance.name}` : appearance.name);
  element('model-title').textContent = name;
  element('appearance-number').textContent = `${String(state.appearance + 1).padStart(2, '0')} / 32`;
  const worn = [state.gear.helmet ? 'шлем' : '', state.gear.armor ? 'бронежилет' : '', state.gear.backpack ? 'рюкзак' : ''].filter(Boolean);
  const description = `${name} · ${weaponLabels[state.weapon].name} · ${profileLabels[state.gear.profile]}${worn.length ? `: ${worn.join(', ')}` : ' · без защиты и рюкзака'}`;
  element('model-summary').textContent = description;
  selectedCanvas.setAttribute('aria-label', `${description}. ${poseLabels[state.mode]}. ${facingLabels[state.facing]}.`);
  frameInput.max = String(PIXEL_ACTOR_FRAMES[state.mode]); frameInput.disabled = PIXEL_ACTOR_FRAMES[state.mode] === 1;
  playButton.setAttribute('aria-pressed', String(state.playing)); playButton.textContent = state.playing ? 'Пауза' : 'Оживить';
  rotateButton.setAttribute('aria-pressed', String(state.rotating));
  const status = element('animation-status'); status.classList.toggle('paused', !state.playing);
  status.textContent = state.playing ? 'Анимация' : 'Стоп-кадр';
  for (const button of profileButtons) button.setAttribute('aria-pressed', String(button.dataset.profile === state.gear.profile));
  for (const part of ['helmet', 'armor', 'backpack'] as const) element<HTMLInputElement>(`model-${part}`).checked = state.gear[part] === true;
  for (const [id, button] of weaponCards) button.setAttribute('aria-pressed', String(id === state.weapon));
  facingSelect.value = state.facing;
}

let lastFrameAt = performance.now(), lastTurnAt = lastFrameAt, requestId = 0;
function schedule(): void {
  if (requestId) cancelAnimationFrame(requestId);
  requestId = 0;
  lastFrameAt = performance.now(); lastTurnAt = lastFrameAt;
  if (state.playing && !document.hidden) requestId = requestAnimationFrame(animate);
}
function animate(at: number): void {
  requestId = 0;
  if (!state.playing || document.hidden) return;
  let redraw = false;
  const duration = frameDuration[state.mode], frames = PIXEL_ACTOR_FRAMES[state.mode];
  if (at - lastFrameAt >= duration) {
    const steps = Math.floor((at - lastFrameAt) / duration); lastFrameAt += steps * duration;
    if (frames > 1) { state.frame = (state.frame + steps) % frames; redraw = true; }
  }
  if (state.rotating && at - lastTurnAt >= 1600) {
    state.facing = PIXEL_FACINGS[(PIXEL_FACINGS.indexOf(state.facing) + 1) % PIXEL_FACINGS.length]!;
    lastTurnAt = at; facingSelect.value = state.facing; redraw = true;
  }
  if (redraw) render();
  requestId = requestAnimationFrame(animate);
}
function changed(): void { state.frame = 0; framing = null; art.clear(); refreshControls(); render(); schedule(); }
function selectFacing(facing: PixelFacing): void { state.facing = facing; state.rotating = false; refreshControls(); render(); schedule(); }

appearanceSelect.addEventListener('change', () => { state.appearance = Number(appearanceSelect.value); changed(); });
figureSelect.addEventListener('change', () => {
  state.figure = figureSelect.value as Figure;
  const boss = getBoss(state.figure);
  if (boss) {
    const slot = GEAR_MODEL_BY_ID[boss.armorModelId]?.slot;
    state.appearance = 28 + BOSSES.findIndex(candidate => candidate.id === boss.id);
    state.weapon = pixelWeaponId(boss.weaponId);
    state.gear = { profile: WEAPON_BY_ID[boss.weaponId]?.category === 'sniper' ? 'scout' : 'assault', helmet: slot === 'helmet', armor: slot === 'armor', backpack: slot === 'backpack' };
  } else {
    state.gear = { profile: state.figure === 'raider' ? 'assault' : 'light', helmet: true, armor: true, backpack: false };
    state.weapon = state.figure === 'raider' ? 'akm' : 'pm';
  }
  appearanceSelect.value = String(state.appearance); weaponSelect.value = state.weapon; changed();
});
weaponSelect.addEventListener('change', () => { state.weapon = weaponSelect.value as PixelWeaponId; changed(); });
poseSelect.addEventListener('change', () => { state.mode = poseSelect.value as PixelActorMode; changed(); });
facingSelect.addEventListener('change', () => selectFacing(facingSelect.value as PixelFacing));
for (const button of profileButtons) button.addEventListener('click', () => { state.gear.profile = button.dataset.profile as PixelActorGear['profile']; changed(); });
for (const part of ['helmet', 'armor', 'backpack'] as const) element<HTMLInputElement>(`model-${part}`).addEventListener('change', event => { state.gear[part] = (event.currentTarget as HTMLInputElement).checked; changed(); });
element('turn-left').addEventListener('click', () => selectFacing(PIXEL_FACINGS[(PIXEL_FACINGS.indexOf(state.facing) + 7) % 8]!));
element('turn-right').addEventListener('click', () => selectFacing(PIXEL_FACINGS[(PIXEL_FACINGS.indexOf(state.facing) + 1) % 8]!));
playButton.addEventListener('click', () => { state.playing = !state.playing; refreshControls(); schedule(); });
rotateButton.addEventListener('click', () => { state.rotating = !state.rotating; refreshControls(); schedule(); });
frameInput.addEventListener('input', () => { state.playing = false; state.frame = Math.max(0, Math.min(PIXEL_ACTOR_FRAMES[state.mode] - 1, Number(frameInput.value) - 1)); refreshControls(); render(); schedule(); });
document.addEventListener('visibilitychange', schedule);
reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) { state.playing = false; state.rotating = false; refreshControls(); schedule(); } });
const resize = new ResizeObserver(entries => {
  const box = entries[0]?.contentRect; if (!box) return;
  const width = Math.max(1, Math.floor(box.width)), height = Math.max(1, Math.floor(box.height));
  if (selectedCanvas.width !== width || selectedCanvas.height !== height) { selectedCanvas.width = width; selectedCanvas.height = height; render(); }
});
resize.observe(stage);
window.addEventListener('pagehide', () => { if (requestId) cancelAnimationFrame(requestId); requestId = 0; art.clear(); });
window.addEventListener('pageshow', () => { render(); schedule(); });
refreshControls(); render(); schedule();
