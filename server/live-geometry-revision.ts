import type { Database } from 'bun:sqlite';

/** Routes contain coordinates derived from a particular layout. Clear them for
 * every saved fighter before the startup writes the new world hash, including
 * fighters that will stay offline throughout this process. Durable stop/container
 * identities and economy receipts remain independent of the geometry revision. */
export function invalidateLiveGeometryRoutes(db: Database, currentVersion: string): number {
  const row = db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get();
  if (!row) return 0;
  const world = JSON.parse(row.state) as { geometryVersion?: string };
  if (typeof world.geometryVersion !== 'string' || world.geometryVersion === currentVersion) return 0;
  return db.transaction(() => {
    let changed = 0;
    const update = db.query('UPDATE live_players SET state=? WHERE identity=?');
    for (const player of db.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').all()) {
      const saved = JSON.parse(player.state) as Record<string, unknown>, sortie = saved.sortie;
      if (!sortie || typeof sortie !== 'object' || Array.isArray(sortie)) continue;
      const route = sortie as Record<string, unknown>;
      if (route.extractTarget === null && Array.isArray(route.blockedExtractKeys) && !route.blockedExtractKeys.length && route.blockedAt === 0) continue;
      route.extractTarget = null; route.blockedExtractKeys = []; route.blockedAt = 0;
      update.run(JSON.stringify(saved), player.identity); changed++;
    }
    return changed;
  })();
}
