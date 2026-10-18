import type { LivePoint, LiveSnapshot } from './game/live';
import type { GameSound } from './game-sound';
import { isConfirmedPixelShot } from './pixel-animation';

/** Snapshot deltas only: reconnecting, unmuting and redisplaying history never replay gunfire. */
export class LiveCombatSound {
  private seen = new Map<string, number>();
  private world = '';
  update(snapshot: LiveSnapshot, sound: GameSound | undefined, listener: LivePoint, active: boolean): void {
    if (snapshot.worldVersion !== this.world) { this.clear(); this.world = snapshot.worldVersion; }
    for (const event of snapshot.events) {
      if (this.seen.has(event.id)) continue;
      this.seen.set(event.id, snapshot.now);
      if (!active || !sound?.enabled || !isConfirmedPixelShot(event) || snapshot.now - event.at < 0 || snapshot.now - event.at > 300) continue;
      const actor = snapshot.entities.find(entity => entity.id === event.actorId);
      const suppressed = actor?.visualLoadout?.modules?.muzzle?.includes('suppressor') || ['asval', 'vss'].includes(actor?.visualLoadout?.weaponId ?? '');
      const from = event.from!, dx = from.x - listener.x, dy = from.y - listener.y, distance = Math.hypot(dx, dy);
      if (distance > 26) continue;
      sound.play(suppressed ? 'gunshot-muted' : 'gunshot', { gain: 1 / (1 + distance * .095), pan: Math.max(-.85, Math.min(.85, (dx - dy) / 12)) });
    }
    for (const [id, at] of this.seen) if (snapshot.now - at > 12_000) this.seen.delete(id);
    while (this.seen.size > 512) this.seen.delete(this.seen.keys().next().value!);
  }
  clear(): void { this.seen.clear(); this.world = ''; }
}
