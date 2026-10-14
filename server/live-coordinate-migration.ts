import type { Database } from 'bun:sqlite';
import type { LiveWorld } from '../src/game/live';
import { LIVE_WORLD_OFFSET } from '../src/game/world-generation';

type Saved = Record<string, unknown>;
const record = (value: unknown): value is Saved => typeof value === 'object' && value !== null && !Array.isArray(value);
const oldDistricts: Record<string, { x: number; y: number }> = { customs: { x: 0, y: 0 }, sawmill: { x: 128, y: 0 }, depot: { x: 0, y: 128 }, village: { x: 128, y: 128 } };

/** Move the whole durable coordinate frame atomically, including offline fighters.
 * The marker also prevents a second shift if later startup validation fails before
 * the regenerated world has been saved. Economy outbox payloads are left intact. */
export function migrateExpandedLiveCoordinates(db: Database, current: LiveWorld): boolean {
  const row = db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get();
  if (!row || current.generatorVersion < 7) return false;
  const world = JSON.parse(row.state) as Saved;
  const previous = typeof world.geometryVersion === 'string' ? /^perimeter-g(\d+)-/.exec(world.geometryVersion) : undefined;
  if (world.coordinateExpansionVersion === 7 || previous && Number(previous[1]) >= 7 || !previous && world.geometryVersion !== undefined) return false;
  const point = (value: unknown, district?: unknown): void => {
    if (!record(value) || typeof value.x !== 'number' || typeof value.y !== 'number' || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return;
    const origin = typeof district === 'string' ? oldDistricts[district] : undefined;
    value.x += LIVE_WORLD_OFFSET + (origin?.x ?? 0); value.y += LIVE_WORLD_OFFSET + (origin?.y ?? 0);
  };
  const entity = (saved: Saved): void => {
    point(saved, saved.mapId); saved.mapId = 'perimeter';
    point(saved.entryPending); point(saved.home);
    if (Array.isArray(saved.route)) saved.route.forEach(value => point(value));
    saved.path = []; saved.pathGoal = null; saved.destination = null; saved.replanAt = 0;
    if (record(saved.automation)) { saved.automation.target = null; saved.automation.targetId = null; }
    if (record(saved.sortie)) { saved.sortie.extractTarget = null; saved.sortie.blockedExtractKeys = []; saved.sortie.blockedAt = 0; }
  };
  db.transaction(() => {
    for (const player of db.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').all()) {
      const saved = JSON.parse(player.state) as Saved; entity(saved);
      db.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(saved), player.identity);
    }
    for (const boss of db.query<{ boss_id: string; state: string }, []>('SELECT boss_id,state FROM live_bosses').all()) {
      const saved = JSON.parse(boss.state) as Saved; entity(saved);
      db.query('UPDATE live_bosses SET state=? WHERE boss_id=?').run(JSON.stringify(saved), boss.boss_id);
    }
    if (Array.isArray(world.drops)) for (const drop of world.drops) if (record(drop)) { point(drop, drop.mapId); drop.mapId = 'perimeter'; }
    if (Array.isArray(world.lootCooldowns)) world.lootCooldowns = world.lootCooldowns.map(pair => {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string' || pair[0].startsWith('container:')) return pair;
      const match = /^(perimeter|customs|sawmill|depot|village):(\d+):(\d+)$/.exec(pair[0]);
      if (!match) return pair;
      const at = { x: Number(match[2]), y: Number(match[3]) }; point(at, match[1]); return [`perimeter:${at.x}:${at.y}`, pair[1]];
    });
    world.coordinateExpansionVersion = 7;
    db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(world));
  })();
  return true;
}
