import type { LiveCommand, LiveEntity, LivePoint, LiveSnapshot } from './game/live';
import { scavDirection, type ScavDirection } from './scav-isometric';

type AtlasFrame = { frame: { x: number; y: number; w: number; h: number }; spriteSourceSize: { x: number; y: number; w: number; h: number }; sourceSize: { w: number; h: number } };
type Atlas = { image: HTMLImageElement; frames: Record<string, AtlasFrame> };
type Motion = { from: LivePoint; to: LivePoint; at: number; direction: ScavDirection };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** A presentation only: interpolation ends at the last confirmed server position. */
export class LiveScene {
  private canvas = document.createElement('canvas');
  private context: CanvasRenderingContext2D;
  private observer: ResizeObserver;
  private snapshot: LiveSnapshot | null = null;
  private motions = new Map<string, Motion>();
  private atlases = new Map<number, Atlas | null>();
  private frame = 0;
  private paintedAt = 0;
  private active = false;
  private width = 800;
  private height = 520;
  private tile = 48;
  private origin = { x: 400, y: 260 };
  private camera: LivePoint = { x: 16, y: 12 };
  private zoom = 1;
  private selected: string | null = null;
  private hitTargets: { entity: LiveEntity; x: number; y: number }[] = [];
  private controls = document.createElement('div');

  constructor(private host: HTMLElement, private command: (command: LiveCommand) => void, private select: (id: string) => void) {
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    this.context = context;
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Общий Периметр. Нажми на землю для движения или выбери бойца. Стрелки и WASD перемещают тебя.');
    this.canvas.setAttribute('role', 'application');
    this.controls.className = 'live-camera';
    this.controls.innerHTML = '<button data-live-zoom="out" aria-label="Отдалить Периметр">−</button><button data-live-zoom="fit" aria-label="Следовать за своим бойцом">За мной</button><button data-live-zoom="in" aria-label="Приблизить Периметр">+</button>';
    host.append(this.canvas, this.controls);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.canvas.addEventListener('click', this.click);
    this.controls.addEventListener('click', this.zoomClick);
    this.resize();
  }

  show(): void { if (this.active) return; this.active = true; this.resize(); this.animate(); }
  hide(): void { this.active = false; cancelAnimationFrame(this.frame); this.frame = 0; }
  clear(): void { this.snapshot = null; this.motions.clear(); this.selected = null; this.paint(); }
  setSelected(id: string | null): void { this.selected = id; }
  update(snapshot: LiveSnapshot): void {
    const at = performance.now();
    for (const entity of snapshot.entities) {
      const existing = this.motions.get(entity.id);
      const from = existing ? this.interpolated(existing, at) : { x: entity.x, y: entity.y };
      const dx = (entity.x - from.x) - (entity.y - from.y), dy = (entity.x - from.x) + (entity.y - from.y);
      this.motions.set(entity.id, { from, to: { x: entity.x, y: entity.y }, at, direction: scavDirection(dx, dy, existing?.direction) });
      this.loadAtlas(entity.appearance);
    }
    for (const id of this.motions.keys()) if (!snapshot.entities.some(entity => entity.id === id)) this.motions.delete(id);
    this.snapshot = snapshot;
    if (!this.active) this.paint();
  }
  destroy(): void { this.hide(); this.observer.disconnect(); this.canvas.removeEventListener('click', this.click); this.controls.removeEventListener('click', this.zoomClick); this.canvas.remove(); this.controls.remove(); }

  private resize(): void {
    const box = this.host.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    this.width = box.width; this.height = box.height;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * ratio); this.canvas.height = Math.round(this.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.paint();
  }
  private zoomClick = (event: MouseEvent): void => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-live-zoom]')?.dataset.liveZoom;
    if (!action) return;
    this.zoom = action === 'fit' ? 1 : clamp(this.zoom * (action === 'in' ? 1.25 : .8), .65, 1.8);
    this.canvas.focus({ preventScroll: true });
  };
  private click = (event: MouseEvent): void => {
    if (!this.snapshot || !this.active) return;
    this.canvas.focus({ preventScroll: true });
    const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const mini = this.minimapBounds(this.snapshot);
    if (x >= mini.x - 8 && x <= mini.x + mini.width + 8 && y >= mini.y - 8 && y <= mini.y + mini.height + 21) {
      if (x >= mini.x && x <= mini.x + mini.width && y >= mini.y && y <= mini.y + mini.height) this.command({ type: 'move', x: clamp(Math.round((x - mini.x) / mini.scale), 0, this.snapshot.world.width - 1), y: clamp(Math.round((y - mini.y) / mini.scale), 0, this.snapshot.world.height - 1) });
      return;
    }
    const target = [...this.hitTargets].reverse().find(target => Math.abs(target.x - x) < Math.max(14, 18 * this.zoom) && y >= target.y - Math.max(38, 62 * this.zoom) && y <= target.y + 10 * this.zoom);
    if (target && target.entity.id !== this.snapshot.selfId) { this.selected = target.entity.id; this.select(target.entity.id); return; }
    const self = this.snapshot.entities.find(entity => entity.id === this.snapshot?.selfId);
    const drop = this.snapshot.drops.find(drop => { const p = this.project(drop); return Math.hypot(x - p.x, y - p.y) < 18; });
    if (drop && self && Math.hypot(drop.x - self.x, drop.y - self.y) <= 1.5) { this.command({ type: 'loot', id: drop.id }); return; }
    const dx = (x - this.origin.x) / (this.tile / 2), dy = (y - this.origin.y) / (this.tile / 4);
    const destination = { x: Math.round((dx + dy) / 2 + this.camera.x), y: Math.round((dy - dx) / 2 + this.camera.y) };
    if (destination.x >= 0 && destination.y >= 0 && destination.x < this.snapshot.world.width && destination.y < this.snapshot.world.height) this.command({ type: 'move', ...destination });
  };
  private animate = (at = performance.now()): void => { if (!this.active) return; if (at - this.paintedAt >= 1000 / 30) { this.paint(); this.paintedAt = at; } this.frame = requestAnimationFrame(this.animate); };
  private interpolated(motion: Motion, at: number): LivePoint { const amount = clamp((at - motion.at) / 350, 0, 1); return { x: motion.from.x + (motion.to.x - motion.from.x) * amount, y: motion.from.y + (motion.to.y - motion.from.y) * amount }; }
  private project(point: LivePoint, elevation = 0): LivePoint { return { x: this.origin.x + ((point.x - this.camera.x) - (point.y - this.camera.y)) * this.tile / 2, y: this.origin.y + ((point.x - this.camera.x) + (point.y - this.camera.y)) * this.tile / 4 - elevation }; }
  private polygon(points: LivePoint[], color: string, stroke?: string): void { const c = this.context; c.beginPath(); points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath(); c.fillStyle = color; c.fill(); if (stroke) { c.strokeStyle = stroke; c.lineWidth = .7; c.stroke(); } }
  private quad(x: number, y: number, width = 1, height = 1, elevation = 0): LivePoint[] { return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }].map(p => this.project(p, elevation)); }
  private label(text: string, x: number, y: number, color: string, size = 10): void { const c = this.context; c.font = `600 ${size}px Manrope, sans-serif`; c.textAlign = 'center'; c.lineWidth = 4; c.strokeStyle = '#101c18'; c.strokeText(text, x, y); c.fillStyle = color; c.fillText(text, x, y); }

  private paint(): void {
    const c = this.context, now = performance.now();
    c.clearRect(0, 0, this.width, this.height);
    const gradient = c.createRadialGradient(this.width * .5, this.height * .5, 20, this.width * .5, this.height * .5, this.width * .7);
    gradient.addColorStop(0, '#39443b'); gradient.addColorStop(1, '#101d18'); c.fillStyle = gradient; c.fillRect(0, 0, this.width, this.height);
    if (!this.snapshot) return;
    const snapshot = this.snapshot, self = snapshot.entities.find(entity => entity.id === snapshot.selfId);
    this.tile = (this.width < 480 ? 44 : 54) * this.zoom;
    this.origin = { x: this.width * .5, y: this.height * .58 };
    if (self) this.camera = this.interpolated(this.motions.get(self.id)!, now);
    const world = snapshot.world;
    for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
      const p = this.project({ x, y }); if (p.x < -this.tile || p.x > this.width + this.tile || p.y < -this.tile || p.y > this.height + this.tile) continue;
      const road = x % 8 === 0 || x % 8 === 1 || y % 8 === 0 || y % 8 === 1;
      const shade = (x * 17 + y * 29) % 5;
      this.polygon(this.quad(x - .5, y - .5), road ? ['#4a514b', '#414a43', '#454d47', '#434c46', '#474e47'][shade]! : ['#354133', '#394535', '#3d4837', '#374233', '#3a4434'][shade]!, road ? '#5b61554a' : '#4b574345');
      if (road && (x + y) % 4 === 0) { c.strokeStyle = '#9d9c7342'; const a = this.project({ x: x - .18, y }), b = this.project({ x: x + .18, y }); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
    }
    for (const [index, extract] of world.extracts.entries()) {
      const p = this.project(extract); this.polygon(this.quad(extract.x - .7, extract.y - .7, 1.4, 1.4), '#5b8d5655', '#a4cf76');
      c.strokeStyle = '#c3d991'; c.lineWidth = 2; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x, p.y - 40); c.stroke();
      this.polygon([{ x: p.x, y: p.y - 40 }, { x: p.x + 25, y: p.y - 35 }, { x: p.x, y: p.y - 29 }], '#b2ce7e'); this.label(`ВЫХОД ${index + 1}`, p.x, p.y + 21, '#cce5a2');
    }
    const objects: { depth: number; paint: () => void }[] = [];
    for (const [index, obstacle] of world.obstacles.entries()) objects.push({ depth: obstacle.x + obstacle.y + (obstacle.width + obstacle.height) / 2, paint: () => {
      const elevation = this.tile * (.9 + index % 3 * .12), base = this.quad(obstacle.x - .5, obstacle.y - .5, obstacle.width, obstacle.height), top = this.quad(obstacle.x - .5, obstacle.y - .5, obstacle.width, obstacle.height, elevation);
      this.polygon([base[1]!, base[2]!, top[2]!, top[1]!], '#424c43', '#65705b'); this.polygon([base[2]!, base[3]!, top[3]!, top[2]!], '#2d392f', '#56634e'); this.polygon(top, index % 2 ? '#66715c' : '#706f58', '#909276');
      const anchor = this.project({ x: obstacle.x + obstacle.width / 2 - .5, y: obstacle.y + obstacle.height / 2 - .5 }, elevation + 3);
      c.strokeStyle = '#8e92784d'; c.beginPath(); c.moveTo(top[0]!.x, top[0]!.y); c.lineTo(top[2]!.x, top[2]!.y); c.stroke();
      this.label(index % 3 === 0 ? 'СКЛАД' : index % 3 === 1 ? 'ГАРАЖИ' : 'УКРЫТИЕ', anchor.x, anchor.y, '#c1c2a2', 8);
    } });
    for (const drop of snapshot.drops) objects.push({ depth: drop.x + drop.y, paint: () => {
      const p = this.project(drop); this.polygon([{ x: p.x - 8, y: p.y - 4 }, { x: p.x, y: p.y - 9 }, { x: p.x + 8, y: p.y - 4 }, { x: p.x, y: p.y + 1 }], '#d2a662', '#efd49a'); c.fillStyle = '#9b753e'; c.fillRect(p.x - 6, p.y - 3, 12, 8); this.label(`${Math.floor(drop.amount)} ₽`, p.x, p.y + 22, '#ebc98d', 9);
    } });
    this.hitTargets = [];
    for (const entity of snapshot.entities) objects.push({ depth: entity.x + entity.y + .1, paint: () => this.paintEntity(entity, now) });
    objects.sort((a, b) => a.depth - b.depth).forEach(object => object.paint());
    this.minimap(snapshot);
  }
  private paintEntity(entity: LiveEntity, now: number): void {
    const snapshot = this.snapshot!, motion = this.motions.get(entity.id)!, point = this.interpolated(motion, now), p = this.project(point), c = this.context;
    if (p.x < -40 || p.x > this.width + 40 || p.y < -50 || p.y > this.height + 100) return;
    const own = entity.id === snapshot.selfId, selected = entity.id === this.selected, color = own ? '#f2d49a' : entity.kind === 'player' ? '#8dd5e4' : '#d2a082';
    c.beginPath(); c.ellipse(p.x, p.y, 13 * this.zoom, 6 * this.zoom, 0, 0, Math.PI * 2); c.fillStyle = '#0005'; c.fill();
    if (own || selected) { c.strokeStyle = color; c.lineWidth = 2; c.stroke(); }
    const atlas = this.atlases.get(entity.appearance) ?? this.atlases.get(entity.appearance % 4);
    const walking = entity.action === 'moving' && now - motion.at < 650;
    const pose = walking ? Math.floor(now / 190) % 2 ? 'walk-a' : 'walk-b' : entity.action === 'combat' ? 'work' : 'idle';
    const frame = atlas?.frames[`${pose}-${motion.direction}`] ?? atlas?.frames['idle-se'];
    const scale = 66 * this.zoom / 360;
    c.save(); if (entity.health <= 0) { c.globalAlpha = .45; c.translate(p.x, p.y); c.rotate(-Math.PI / 2); c.translate(-p.x, -p.y); }
    if (atlas && frame) c.drawImage(atlas.image, frame.frame.x, frame.frame.y, frame.frame.w, frame.frame.h, p.x + (frame.spriteSourceSize.x - frame.sourceSize.w * .5) * scale, p.y + (frame.spriteSourceSize.y - 480) * scale, frame.frame.w * scale, frame.frame.h * scale);
    else { c.fillStyle = color; c.fillRect(p.x - 7, p.y - 34, 14, 27); c.beginPath(); c.arc(p.x, p.y - 39, 6, 0, Math.PI * 2); c.fill(); }
    c.restore();
    const top = p.y - 70 * this.zoom;
    this.label(own ? `ТЫ · ${entity.name}` : entity.name, p.x, top, color, own ? 11 : 10);
    this.label(entity.kind === 'player' ? own ? 'ТВОЙ БОЕЦ' : 'ИГРОК' : 'ДИКИЙ · NPC', p.x, top + 13, own ? '#e8d8b6' : entity.kind === 'player' ? '#90c4ce' : '#ad9b88', 7);
    c.fillStyle = '#14271a'; c.fillRect(p.x - 17, top + 18, 34, 3); c.fillStyle = entity.health > 35 ? '#b6cc85' : '#e09d82'; c.fillRect(p.x - 17, top + 18, 34 * entity.health / 100, 3);
    if (entity.safeUntil > snapshot.now) this.label('ЗАЩИТА', p.x, p.y + 20, '#bddbb7', 8);
    // A firing cue is brief and tied to a confirmed combat update.
    if (entity.action === 'combat' && now - motion.at < 300) { c.fillStyle = '#f2bc72'; c.beginPath(); c.arc(p.x + 16, p.y - 30, 2 + Math.sin(now / 65) * 1.5, 0, Math.PI * 2); c.fill(); }
    this.hitTargets.push({ entity, x: p.x, y: p.y });
  }
  private minimapBounds(snapshot: LiveSnapshot): { x: number; y: number; width: number; height: number; scale: number } {
    const scale = Math.min(this.width < 480 ? 2.1 : 2.5, (this.width * .28) / snapshot.world.width, (this.height * .22) / snapshot.world.height);
    const width = snapshot.world.width * scale, height = snapshot.world.height * scale;
    return { x: this.width - width - 16, y: 62, width, height, scale };
  }
  private minimap(snapshot: LiveSnapshot): void {
    const c = this.context, { x, y, scale, width, height } = this.minimapBounds(snapshot);
    c.fillStyle = '#14241fe6'; c.fillRect(x - 8, y - 8, width + 16, height + 29); c.strokeStyle = '#7c8c6166'; c.strokeRect(x - 8, y - 8, width + 16, height + 29);
    for (const obstacle of snapshot.world.obstacles) { c.fillStyle = '#63715b'; c.fillRect(x + obstacle.x * scale, y + obstacle.y * scale, obstacle.width * scale, obstacle.height * scale); }
    for (const extract of snapshot.world.extracts) { c.fillStyle = '#a9d380'; c.fillRect(x + extract.x * scale - 2, y + extract.y * scale - 2, 4, 4); }
    for (const entity of snapshot.entities) { c.fillStyle = entity.id === snapshot.selfId ? '#ffe0a4' : entity.kind === 'player' ? '#81d0e3' : '#ce9778'; c.beginPath(); c.arc(x + entity.x * scale, y + entity.y * scale, entity.id === snapshot.selfId ? 2.8 : 1.6, 0, Math.PI * 2); c.fill(); }
    this.label('ПЕРИМЕТР 01', x + width / 2, y + height + 14, '#a9b596', 8);
  }
  private loadAtlas(appearance: number): void {
    if (this.atlases.has(appearance)) return;
    this.atlases.set(appearance, null);
    const image = new Image();
    const ready = new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = `/art/scav-isometric-${appearance}.png`; });
    void Promise.all([ready, fetch(`/art/scav-isometric-${appearance}.json`).then(response => { if (!response.ok) throw new Error('Atlas unavailable'); return response.json() as Promise<{ frames: Record<string, AtlasFrame> }>; })]).then(([, value]) => { this.atlases.set(appearance, { image, frames: value.frames }); }).catch(() => { if (appearance >= 4) this.loadAtlas(appearance % 4); });
  }
}
