import './pixel-model-preview.css';
import { SCAV_APPEARANCES } from './game/scav-appearances';
import { BOSSES, getBoss, type BossId } from './game/bosses';
import { CATEGORY_LABELS, WEAPONS, WEAPON_BY_ID } from './game/data';
import { getWeaponBuildIssues, getWeaponStats, type WeaponInstance } from './game/engine';
import { MODULE_BY_ID, MODULE_SLOT_LABELS, RECEIVER_INFO, type ModuleSlot } from './game/modules';
import { GEAR_MODEL_BY_ID } from './game/systems';
import type { LiveEntity } from './game/live';
import { weaponBuildArt } from './armory-art';
import { MODULE_DISPLAY_SLOTS } from './module-catalog';
import { PixelRaster } from './pixel-art';
import { PIXEL_FACINGS, type PixelActorFrame, type PixelActorMode, type PixelFacing } from './pixel-animation';
import { PixelActorArt, type PixelActorGear } from './pixel-actors';
import { PIXEL_ACTOR_ANCHOR, PIXEL_ACTOR_NATIVE_SIZE, PIXEL_ACTOR_FRAMES, PIXEL_ACTOR_FRAME_MS } from './pixel-actor-config';
import { paintPixelWeapon, type PixelWeaponInput } from './pixel-weapons';
import { changePixelPreviewModule, copyPixelPreviewBuild, pixelPreviewModuleOptions } from './pixel-model-builds';
import { readPixelArsenalPreview } from './pixel-arsenal-preview';
import { createWeaponShowcaseBuild, type WeaponShowcasePreset } from './weapon-showcase';
import { createPixelCombatPreview, pixelCombatPreviewLabel, PIXEL_COMBAT_PREVIEW_FRAME_MS, PIXEL_COMBAT_PREVIEW_FRAMES } from './pixel-combat-preview';

const weaponLabels: Readonly<Record<string, { name: string; detail: string }>> = Object.fromEntries([
  ...WEAPONS.map(definition => [definition.id, { name: definition.name, detail: `${CATEGORY_LABELS[definition.category]} · ${RECEIVER_INFO[definition.id]!.caliber}` }]),
  ['unknown', { name: 'Неизвестное оружие', detail: 'Нейтральный силуэт · без оптики' }],
]);
const facingLabels: Record<PixelFacing, string> = { e: 'Справа', se: 'Спереди справа', s: 'Спереди', sw: 'Спереди слева', w: 'Слева', nw: 'Сзади слева', n: 'Сзади', ne: 'Сзади справа' };
type PreviewMode = PixelActorMode | 'transition';
const poseLabels: Record<PreviewMode, string> = { transition: 'Ходьба → бой', idle: 'Стоит', walk: 'Идёт', aim: 'Целится', fire: 'Стреляет', hit: 'Получает попадание', downed: 'Ранен на земле' };
const profileLabels: Record<PixelActorGear['profile'], string> = { light: 'Налегке', assault: 'Штурм', scout: 'Разведка' };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const art = new PixelActorArt();
type Figure = 'scav' | 'raider' | BossId;
type BuildPreset = WeaponShowcasePreset | 'custom';
const state = { figure: 'scav' as Figure, appearance: 0, weapon: 'akm', preset: 'factory' as BuildPreset, source: 'catalog' as 'catalog' | 'arsenal', mode: 'transition' as PreviewMode, facing: 'se' as PixelFacing, frame: 0, speed: 1, limping: false, playing: !reducedMotion.matches, rotating: !reducedMotion.matches, gear: { profile: 'assault', helmet: true, armor: true, backpack: true } as PixelActorGear };
const transitionFrames = new Map<boolean, readonly PixelActorFrame[]>();
const frameCount = () => state.mode === 'transition' ? PIXEL_COMBAT_PREVIEW_FRAMES : PIXEL_ACTOR_FRAMES[state.mode];
function animationFrame(facing: PixelFacing): PixelActorFrame {
  if (state.mode !== 'transition') return { mode: state.mode, frame: state.frame, facing };
  if (!transitionFrames.has(state.limping)) transitionFrames.set(state.limping, createPixelCombatPreview(state.limping));
  return { ...transitionFrames.get(state.limping)![state.frame]!, facing };
}
const customBuilds = new Map<string, WeaponInstance>();
let selectedBuild: WeaponInstance | null = createWeaponShowcaseBuild(state.weapon);
const importedBuild = readPixelArsenalPreview(window.location.hash);
if (importedBuild) {
  state.weapon = importedBuild.weapon.weaponId; state.appearance = importedBuild.appearance; state.preset = 'custom'; state.source = 'arsenal';
  selectedBuild = copyPixelPreviewBuild(importedBuild.weapon); customBuilds.set(state.weapon, copyPixelPreviewBuild(selectedBuild));
}
const weaponInput = (): PixelWeaponInput => selectedBuild ?? 'unknown';

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
const speedSelect = element<HTMLSelectElement>('animation-speed');
const previousFrame = element<HTMLButtonElement>('previous-frame');
const nextFrame = element<HTMLButtonElement>('next-frame');
const selectedCanvas = element<HTMLCanvasElement>('selected-model');
const stage = element<HTMLDivElement>('model-stage');
const profileButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-profile]')];
const presetButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-build-preset]')];
const bearingCards = new Map<PixelFacing, { button: HTMLButtonElement; canvas: HTMLCanvasElement }>();
const weaponCards = new Map<string, HTMLButtonElement>();
const moduleControls = new Map<ModuleSlot, { select: HTMLSelectElement; note: HTMLElement }>();

for (const look of SCAV_APPEARANCES) appearanceSelect.add(new Option(`${String(look.id + 1).padStart(2, '0')} · ${look.name}`, String(look.id)));
for (const definition of WEAPONS) weaponSelect.add(new Option(definition.name, definition.id));
weaponSelect.add(new Option(weaponLabels.unknown!.name, 'unknown'));
weaponSelect.value = state.weapon;
appearanceSelect.value = String(state.appearance);
for (const facing of PIXEL_FACINGS) facingSelect.add(new Option(facingLabels[facing], facing));
facingSelect.value = state.facing;

for (const facing of PIXEL_FACINGS) {
  const button = document.createElement('button'), canvas = document.createElement('canvas'), label = document.createElement('span');
  button.type = 'button'; button.className = 'bearing-card'; button.setAttribute('aria-label', `Рассмотреть: ${facingLabels[facing].toLowerCase()}`);
  canvas.width = PIXEL_ACTOR_NATIVE_SIZE.width; canvas.height = PIXEL_ACTOR_NATIVE_SIZE.height; canvas.setAttribute('aria-hidden', 'true'); label.textContent = facingLabels[facing];
  button.append(canvas, label); button.addEventListener('click', () => selectFacing(facing));
  bearingCards.set(facing, { button, canvas }); element('bearing-grid').append(button);
}
for (const id of [...WEAPONS.map(definition => definition.id), 'unknown']) {
  const button = document.createElement('button'), canvas = document.createElement('canvas'), title = document.createElement('strong'), detail = document.createElement('small');
  button.type = 'button'; button.className = 'weapon-card'; button.setAttribute('aria-label', `Примерить ${weaponLabels[id]!.name}`);
  canvas.width = 256; canvas.height = 96; canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  if (context) paintPixelWeapon(new PixelRaster(context, canvas.width, canvas.height), id === 'unknown' ? 'unknown' : createWeaponShowcaseBuild(id), { x: 96, y: 60 }, 'e');
  title.textContent = weaponLabels[id]!.name; detail.textContent = weaponLabels[id]!.detail; button.append(canvas, title, detail);
  button.addEventListener('click', () => { selectWeapon(id); changed(); });
  weaponCards.set(id, button); element('pixel-weapon-grid').append(button);
}
for (const slot of MODULE_DISPLAY_SLOTS) {
  const label = document.createElement('label'), title = document.createElement('span'), select = document.createElement('select'), note = document.createElement('small');
  label.className = 'module-control'; title.textContent = MODULE_SLOT_LABELS[slot]; select.id = `model-module-${slot}`;
  select.setAttribute('aria-label', MODULE_SLOT_LABELS[slot]); label.append(title, select, note); element('model-module-controls').append(label);
  moduleControls.set(slot, { select, note });
  select.addEventListener('change', () => {
    if (!selectedBuild) return;
    const result = changePixelPreviewModule(selectedBuild, slot, select.value);
    element('model-build-note').textContent = result.error ?? (result.removed.length ? `Сняты вместе с опорой: ${result.removed.join(' · ')}.` : `${MODULE_SLOT_LABELS[slot]}: ${select.value ? 'установлено в примерке' : 'снято в примерке'}.`);
    if (!result.error) { selectedBuild = result.weapon; state.preset = 'custom'; state.source = 'catalog'; customBuilds.set(state.weapon, copyPixelPreviewBuild(selectedBuild)); }
    changed();
  });
}

function selectWeapon(id: string): void {
  state.weapon = id; state.source = 'catalog'; weaponSelect.value = id; element('model-build-note').textContent = '';
  selectedBuild = id === 'unknown' ? null : state.preset === 'custom' ? copyPixelPreviewBuild(customBuilds.get(id) ?? createWeaponShowcaseBuild(id)) : createWeaponShowcaseBuild(id, state.preset);
}

function refreshBuild(): void {
  for (const button of presetButtons) { button.setAttribute('aria-pressed', String(button.dataset.buildPreset === state.preset)); button.disabled = !selectedBuild; }
  const source = state.source === 'arsenal' ? 'Сборка из арсенала' : state.preset === 'factory' ? 'Штатная сборка' : state.preset === 'field' ? 'Пример полевой сборки' : 'Своя примерка';
  element('build-source').textContent = source;
  element('build-help').textContent = state.source === 'arsenal' ? 'Показаны установленные детали и их состояние из арсенала. Изменения ниже остаются только в примерке.' : 'Каталог для примерки. Штатные и полевые комплекты — примеры; они не меняют оружие в арсенале.';
  element('model-build-name').textContent = weaponLabels[state.weapon]!.name;
  element('model-build-art').innerHTML = selectedBuild ? weaponBuildArt(selectedBuild) : '<p>Модель оружия не определена</p>';
  const issues = selectedBuild ? getWeaponBuildIssues(selectedBuild) : [], stats = selectedBuild ? getWeaponStats(selectedBuild) : null;
  element('model-build-summary').textContent = selectedBuild ? `${source} · ${Object.keys(selectedBuild.modules).length} / 11 деталей · состояние ${Math.round(selectedBuild.durability)}% · вес ${stats!.weight.toLocaleString('ru')} кг` : 'Нейтральный силуэт без установленных модулей';
  const readiness = element('model-build-readiness'); readiness.classList.toggle('incomplete', Boolean(stats && !stats.ready));
  readiness.textContent = !selectedBuild ? '' : stats?.ready ? 'Сборка готова к выходу' : 'Неполная или изношенная сборка';
  element('model-build-issues').textContent = issues.join(' ');
  for (const [slot, { select, note }] of moduleControls) {
    select.replaceChildren(new Option('Не установлено', ''));
    if (selectedBuild) for (const { model, reason } of pixelPreviewModuleOptions(selectedBuild, slot)) {
      const option = new Option(reason ? `${model.label} · ${reason}` : model.label, model.id); option.disabled = Boolean(reason); select.add(option);
    }
    select.value = selectedBuild?.modules[slot]?.modelId ?? ''; select.disabled = !selectedBuild;
    const part = selectedBuild?.modules[slot], model = part ? MODULE_BY_ID[part.modelId] : null;
    note.textContent = model && part ? `${model.label} · ${Math.round(part.durability)}%` : selectedBuild && RECEIVER_INFO[selectedBuild.weaponId]!.requiredSlots.includes(slot) ? 'Обязательная деталь снята' : 'Свободное место';
  }
}

function filterWeapons(): void {
  const category = element<HTMLSelectElement>('model-weapon-category').value, query = element<HTMLInputElement>('model-weapon-search').value.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim();
  let count = 0;
  for (const [id, button] of weaponCards) {
    const definition = WEAPON_BY_ID[id], text = `${weaponLabels[id]!.name} ${weaponLabels[id]!.detail}`.toLocaleLowerCase('ru').replaceAll('ё', 'е');
    button.hidden = (category !== 'all' && definition?.category !== category) || !text.includes(query);
    if (!button.hidden && definition) count++;
  }
  element('model-weapon-count').textContent = `${count} из ${WEAPONS.length} платформ`;
}

function identity(): Pick<LiveEntity, 'appearance' | 'faction' | 'bossId' | 'role' | 'limping'> {
  const boss = getBoss(state.figure);
  return { appearance: state.appearance, limping: state.limping, faction: state.figure === 'scav' ? 'scavs' : 'raiders', role: state.figure === 'scav' ? 'patrol' : 'guard', ...(boss ? { bossId: boss.id } : {}) };
}
let framing: { left: number; right: number; top: number; bottom: number } | null = null;
/** Frame every bearing and pose frame together so walking never recentres the feet. */
function modelBounds(): NonNullable<typeof framing> {
  if (framing) return framing;
  // A mixed sequence keeps one camera rectangle even while the gun is raised.
  // Native bounds include every layered pose without generating hundreds of
  // intermediate textures merely to find the preview's camera placement.
  if (state.mode === 'transition') {
    framing = { left: -PIXEL_ACTOR_ANCHOR.x, right: PIXEL_ACTOR_NATIVE_SIZE.width - PIXEL_ACTOR_ANCHOR.x, top: -PIXEL_ACTOR_ANCHOR.y, bottom: PIXEL_ACTOR_NATIVE_SIZE.height - PIXEL_ACTOR_ANCHOR.y };
    return framing;
  }
  const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }, entity = identity();
  for (const facing of PIXEL_FACINGS) for (let frame = 0; frame < PIXEL_ACTOR_FRAMES[state.mode]; frame++) {
    const sprite = art.get(entity, { mode: state.mode, frame, facing }, weaponInput(), state.gear);
    bounds.left = Math.min(bounds.left, -sprite.anchor.x); bounds.right = Math.max(bounds.right, sprite.image.width - sprite.anchor.x);
    bounds.top = Math.min(bounds.top, -sprite.anchor.y); bounds.bottom = Math.max(bounds.bottom, sprite.image.height - sprite.anchor.y);
  }
  framing = bounds; return bounds;
}
function drawActor(canvas: HTMLCanvasElement, facing: PixelFacing, large: boolean): void {
  const context = canvas.getContext('2d'); if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const bounds = modelBounds(), modelWidth = bounds.right - bounds.left, modelHeight = bounds.bottom - bounds.top;
  const scale = large ? Math.max(.125, Math.min(4, Math.floor(Math.min((canvas.width - 32) / modelWidth, (canvas.height - 54) / modelHeight) * 8) / 8)) : 1;
  const anchor = large ? { x: Math.round((canvas.width - modelWidth * scale) / 2 - bounds.left * scale), y: Math.round((canvas.height - 22 - modelHeight * scale) / 2 - bounds.top * scale) } : PIXEL_ACTOR_ANCHOR;
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
  const sprite = art.get(identity(), animationFrame(facing), weaponInput(), state.gear);
  context.imageSmoothingEnabled = false;
  context.save();
  // One origin for the whole cycle keeps the pixel grid stable when tight crops change.
  context.setTransform(scale, 0, 0, scale, anchor.x, anchor.y);
  context.drawImage(sprite.image, -sprite.anchor.x, -sprite.anchor.y);
  context.restore();
}

function render(): void {
  drawActor(selectedCanvas, state.facing, true);
  for (const [facing, { button, canvas }] of bearingCards) { drawActor(canvas, facing, false); button.setAttribute('aria-pressed', String(facing === state.facing)); }
  element('stage-direction').textContent = facingLabels[state.facing];
  const poseLabel = state.mode === 'transition' ? pixelCombatPreviewLabel(state.frame) : poseLabels[state.mode];
  element('stage-pose').textContent = poseLabel;
  const description = `${element('model-summary').textContent}. ${poseLabel}. ${facingLabels[state.facing]}.`;
  if (selectedCanvas.getAttribute('aria-label') !== description) selectedCanvas.setAttribute('aria-label', description);
  frameInput.value = String(state.frame + 1);
  frameInput.setAttribute('aria-valuetext', `${state.frame + 1} из ${frameCount()}, ${poseLabel}`);
  element<HTMLOutputElement>('frame-number').value = `${state.frame + 1} / ${frameCount()}`;
}

function refreshControls(): void {
  const appearance = SCAV_APPEARANCES[state.appearance]!, boss = getBoss(state.figure), name = boss?.name ?? (state.figure === 'raider' ? `Налётчик · ${appearance.name}` : appearance.name);
  element('model-title').textContent = name;
  element('appearance-number').textContent = `${String(state.appearance + 1).padStart(2, '0')} / 32`;
  const worn = [state.gear.helmet ? 'шлем' : '', state.gear.armor ? 'бронежилет' : '', state.gear.backpack ? 'рюкзак' : ''].filter(Boolean);
  const description = `${name} · ${weaponLabels[state.weapon]!.name} · ${state.source === 'arsenal' ? 'сборка из арсенала' : state.preset === 'field' ? 'пример полевой сборки' : state.preset === 'custom' ? 'своя примерка' : 'штатная сборка'} · ${profileLabels[state.gear.profile]}${worn.length ? `: ${worn.join(', ')}` : ' · без защиты и рюкзака'}`;
  element('model-summary').textContent = description;
  selectedCanvas.setAttribute('aria-label', `${description}. ${poseLabels[state.mode]}. ${facingLabels[state.facing]}.`);
  frameInput.max = String(frameCount()); frameInput.disabled = frameCount() === 1;
  element('motion-guide').textContent = state.mode === 'transition' ? 'Боец идёт, останавливается, прицеливается, делает два выстрела и продолжает путь. Стрелки и ползунок позволяют рассмотреть каждый переход.' : 'Стрелки останавливают движение и показывают соседний кадр. Скорость меняется только в этом просмотре.';
  previousFrame.disabled = frameInput.disabled; nextFrame.disabled = frameInput.disabled;
  speedSelect.value = String(state.speed);
  element<HTMLInputElement>('model-limping').checked = state.limping;
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
  const duration = (state.mode === 'transition' ? PIXEL_COMBAT_PREVIEW_FRAME_MS : PIXEL_ACTOR_FRAME_MS[state.mode]) / state.speed, frames = frameCount();
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
function changed(): void { state.frame = 0; framing = null; art.clear(); refreshControls(); refreshBuild(); render(); schedule(); }
function selectFacing(facing: PixelFacing): void { state.facing = facing; state.rotating = false; refreshControls(); render(); schedule(); }
function stepFrame(offset: number): void {
  state.playing = false;
  const frames = frameCount(); state.frame = (state.frame + offset + frames) % frames;
  refreshControls(); render(); schedule();
}

appearanceSelect.addEventListener('change', () => { state.appearance = Number(appearanceSelect.value); changed(); });
figureSelect.addEventListener('change', () => {
  state.figure = figureSelect.value as Figure;
  const boss = getBoss(state.figure);
  if (boss) {
    const slot = GEAR_MODEL_BY_ID[boss.armorModelId]?.slot;
    state.appearance = 28 + BOSSES.findIndex(candidate => candidate.id === boss.id);
    selectWeapon(boss.weaponId);
    state.gear = { profile: WEAPON_BY_ID[boss.weaponId]?.category === 'sniper' ? 'scout' : 'assault', helmet: slot === 'helmet', armor: slot === 'armor', backpack: slot === 'backpack' };
  } else {
    state.gear = { profile: state.figure === 'raider' ? 'assault' : 'light', helmet: true, armor: true, backpack: false };
    selectWeapon(state.figure === 'raider' ? 'akm' : 'pm');
  }
  appearanceSelect.value = String(state.appearance); weaponSelect.value = state.weapon; changed();
});
weaponSelect.addEventListener('change', () => { selectWeapon(weaponSelect.value); changed(); });
for (const button of presetButtons) button.addEventListener('click', () => {
  const next = button.dataset.buildPreset as BuildPreset;
  if (next === 'custom' && selectedBuild && !customBuilds.has(state.weapon)) customBuilds.set(state.weapon, copyPixelPreviewBuild(selectedBuild));
  state.preset = next; state.source = 'catalog'; selectWeapon(state.weapon); changed();
});
element('model-weapon-category').addEventListener('change', filterWeapons);
element('model-weapon-search').addEventListener('input', filterWeapons);
poseSelect.addEventListener('change', () => { state.mode = poseSelect.value as PreviewMode; changed(); });
facingSelect.addEventListener('change', () => selectFacing(facingSelect.value as PixelFacing));
for (const button of profileButtons) button.addEventListener('click', () => { state.gear.profile = button.dataset.profile as PixelActorGear['profile']; changed(); });
for (const part of ['helmet', 'armor', 'backpack'] as const) element<HTMLInputElement>(`model-${part}`).addEventListener('change', event => { state.gear[part] = (event.currentTarget as HTMLInputElement).checked; changed(); });
element('turn-left').addEventListener('click', () => selectFacing(PIXEL_FACINGS[(PIXEL_FACINGS.indexOf(state.facing) + 7) % 8]!));
element('turn-right').addEventListener('click', () => selectFacing(PIXEL_FACINGS[(PIXEL_FACINGS.indexOf(state.facing) + 1) % 8]!));
playButton.addEventListener('click', () => { state.playing = !state.playing; refreshControls(); schedule(); });
rotateButton.addEventListener('click', () => { state.rotating = !state.rotating; refreshControls(); schedule(); });
frameInput.addEventListener('input', () => { state.playing = false; state.frame = Math.max(0, Math.min(frameCount() - 1, Number(frameInput.value) - 1)); refreshControls(); render(); schedule(); });
previousFrame.addEventListener('click', () => stepFrame(-1));
nextFrame.addEventListener('click', () => stepFrame(1));
speedSelect.addEventListener('change', () => {
  const speed = Number(speedSelect.value); if (![.5, 1, 1.5, 2].includes(speed)) return;
  state.speed = speed; refreshControls(); schedule();
});
element<HTMLInputElement>('model-limping').addEventListener('change', event => {
  state.limping = (event.currentTarget as HTMLInputElement).checked;
  if (state.limping && state.mode !== 'transition') { state.mode = 'walk'; poseSelect.value = state.mode; }
  changed();
});
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
refreshControls(); refreshBuild(); filterWeapons(); render(); schedule();
