import type { LiveEvent, LivePoint } from './game/live';

export type GunfireSurface = NonNullable<LiveEvent['impact']> | 'ground';
type Particle = LivePoint & { x2: number; y2: number; size: number; alpha: number; color: string; kind: 'spark' | 'dust' | 'smoke' | 'case' };
export interface GunfireFrame {
  flightMs: number;
  flash: { points: LivePoint[]; alpha: number; radius: number } | null;
  tracer: { from: LivePoint; to: LivePoint; alpha: number } | null;
  particles: Particle[];
}
export interface GunfireInput {
  id: string; age: number; from: LivePoint; to: LivePoint; eject: LivePoint; muzzle?: LivePoint;
  scale: number; small?: boolean; reducedMotion?: boolean; suppressed?: boolean; surface: GunfireSurface;
}
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
const lerp = (a: LivePoint, b: LivePoint, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Pure event-time sampling: particles neither accumulate nor depend on render rate.
 * Only confirmed armor hits throw bright flecks; flesh/fabric and ground make dust. */
export function sampleGunfire(input: GunfireInput): GunfireFrame {
  const { age, from, to, eject, surface, small, reducedMotion, suppressed } = input;
  const scale = clamp(Number.isFinite(input.scale) ? input.scale : 1, .1, 3);
  const dx = to.x - from.x, dy = to.y - from.y, distance = Math.hypot(dx, dy), ux = dx / (distance || 1), uy = dy / (distance || 1);
  const flightMs = clamp(distance / (9 * scale), 26, 90);
  const frame: GunfireFrame = { flightMs, flash: null, tracer: null, particles: [] };
  if (!Number.isFinite(age) || age < 0 || age >= 850 || ![from.x, from.y, to.x, to.y, eject.x, eject.y].every(Number.isFinite)) return frame;
  let seed = 17;
  for (const char of input.id) seed = (Math.imul(seed, 31) + char.charCodeAt(0)) >>> 0;
  const noise = (index: number) => ((Math.imul(seed ^ (index * 374761393), 668265263) >>> 0) % 1000) / 1000;
  const muzzle = input.muzzle ?? from;
  const local = (forward: number, side: number): LivePoint => ({ x: muzzle.x + (ux * forward - uy * side) * scale, y: muzzle.y + (uy * forward + ux * side) * scale });
  const flashMs = suppressed ? 75 : 145;
  if (age < flashMs) {
    const pulse = (1 - age / flashMs) ** 1.6, length = (suppressed ? 4 : 12 + noise(1) * 8) * (.45 + pulse * .55);
    frame.flash = { alpha: pulse * (reducedMotion ? .45 : 1), radius: (suppressed ? 9 : 31) * scale,
      points: [local(-1, 0), local(length * .32, -length * .22), local(length * .7, -length * .09), local(length, 0), local(length * .55, length * .13), local(length * .25, length * .2)] };
  }
  if (age < flightMs + 32 && distance > 1) {
    const head = clamp(age / flightMs, 0, 1), tail = clamp((age - 22) / flightMs, 0, 1);
    frame.tracer = { from: lerp(from, to, tail), to: lerp(from, to, head), alpha: (suppressed ? .4 : .8) * (1 - Math.max(0, age - flightMs) / 32) };
  }
  const add = (kind: Particle['kind'], point: LivePoint, size: number, alpha: number, color: string, end = point) => {
    frame.particles.push({ ...point, x2: end.x, y2: end.y, size: Math.max(.6, size * scale), alpha: clamp(alpha, 0, 1), color, kind });
  };
  // Brass departs from the actual breech, tumbles, then bounces onto the ground.
  if (!small && age < 800) {
    const t = age / 530, side = noise(2) > .5 ? 1 : -1;
    const point = { x: eject.x + (-uy * side * 18 + ux * 3) * scale * Math.min(t, 1.4),
      y: eject.y + (-12 * Math.sin(Math.min(t, 1) * Math.PI) + 25 * Math.min(t, 1) - (t > 1 ? 3 * Math.sin((t - 1) * Math.PI * 2) : 0)) * scale };
    add('case', point, 1.2, Math.min(1, (800 - age) / 180), '#d9b775', { x: point.x + Math.cos(t * 18) * 2.4 * scale, y: point.y + Math.sin(t * 18) * 2.4 * scale });
  }
  if (!small && !reducedMotion && age < 610) for (let i = 0; i < 3; i++) {
    const t = clamp((age - i * 25) / 610, 0, 1);
    if (age < i * 25) continue;
    add('smoke', { x: from.x + (ux * (4 + i * 2 + t * 9) + (noise(i + 3) - .5) * t * 15) * scale,
      y: from.y + (uy * 5 - t * (9 + i * 4)) * scale }, 1.3 + t * 4, (1 - t) * (suppressed ? .1 : .2), '#c2beb0');
  }
  const impactAge = age - flightMs;
  if (impactAge >= 0 && impactAge < 520) {
    const count = small ? 2 : reducedMotion ? 3 : surface === 'armor' ? 10 : 7;
    for (let i = 0; i < count; i++) {
      const spark = surface === 'armor' && i < (small ? 1 : 6), lifetime = spark ? 170 + noise(i + 7) * 160 : 440 + noise(i + 7) * 80;
      if (impactAge >= lifetime) continue;
      const t = impactAge / lifetime, angle = Math.atan2(-uy, -ux) + (noise(i + 21) - .5) * 2.8;
      const speed = (spark ? 17 : 6) + noise(i + 31) * (spark ? 16 : 9), reach = speed * t * scale;
      const point = { x: to.x + Math.cos(angle) * reach, y: to.y + Math.sin(angle) * reach * .7 + t * t * (spark ? 13 : 8) * scale };
      add(spark ? 'spark' : 'dust', point, spark ? .8 : 1 + t * 2, (1 - t) * (spark ? .95 : .48),
        spark ? i % 2 ? '#ffd58c' : '#fff0c5' : surface === 'body' ? '#a59780' : '#b8ac93',
        spark ? { x: point.x - Math.cos(angle) * 4 * scale * (1 - t), y: point.y - Math.sin(angle) * 3 * scale * (1 - t) } : point);
    }
  }
  return frame;
}

export function paintGunfire(c: CanvasRenderingContext2D, input: GunfireInput): void {
  const frame = sampleGunfire(input), scale = clamp(input.scale, .1, 3), muzzle = input.muzzle ?? input.from;
  c.save();
  if (frame.flash) {
    const { alpha, points, radius } = frame.flash;
    if (!input.small && !input.reducedMotion) {
      const light = c.createRadialGradient(muzzle.x, muzzle.y, 0, muzzle.x, muzzle.y, radius);
      light.addColorStop(0, '#ffbc6355'); light.addColorStop(.3, '#ff9a3528'); light.addColorStop(1, '#ff981900');
      c.globalAlpha = alpha; c.globalCompositeOperation = 'screen'; c.fillStyle = light;
      c.fillRect(muzzle.x - radius, muzzle.y - radius, radius * 2, radius * 2); c.globalCompositeOperation = 'source-over';
    }
    c.globalAlpha = alpha; c.fillStyle = '#ffbd58'; c.beginPath();
    points.forEach((point, i) => i ? c.lineTo(point.x, point.y) : c.moveTo(point.x, point.y)); c.closePath(); c.fill();
    c.fillStyle = '#fff5d9'; c.fillRect(muzzle.x - scale, muzzle.y - scale, 3 * scale, 2 * scale);
  }
  if (frame.tracer) {
    c.globalAlpha = frame.tracer.alpha; c.strokeStyle = '#ffe5a8'; c.lineWidth = Math.max(.7, scale * .85);
    c.beginPath(); c.moveTo(frame.tracer.from.x, frame.tracer.from.y); c.lineTo(frame.tracer.to.x, frame.tracer.to.y); c.stroke();
  }
  for (const particle of frame.particles) {
    c.globalAlpha = particle.alpha; c.fillStyle = c.strokeStyle = particle.color;
    if (particle.kind === 'spark' || particle.kind === 'case') {
      c.lineWidth = particle.size; c.beginPath(); c.moveTo(particle.x, particle.y); c.lineTo(particle.x2, particle.y2); c.stroke();
    } else {
      c.fillRect(Math.round(particle.x - particle.size / 2), Math.round(particle.y - particle.size / 2), Math.ceil(particle.size), Math.max(1, Math.ceil(particle.size * .65)));
    }
  }
  c.restore();
}
