import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { invalidateLiveGeometryRoutes } from '../server/live-geometry-revision';
import { migrateExpandedLiveCoordinates } from '../server/live-coordinate-migration';
import type { LiveWorld } from '../src/game/live';

const G10 = 'perimeter-g10-shipped', G11 = 'perimeter-g11-organic';
function fixture(): Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE live_world(id INTEGER PRIMARY KEY,state TEXT); CREATE TABLE live_players(identity TEXT PRIMARY KEY,state TEXT); CREATE TABLE live_bosses(boss_id TEXT PRIMARY KEY,state TEXT); CREATE TABLE live_economy_outbox(id TEXT PRIMARY KEY,payload TEXT,acknowledged INTEGER);');
  db.query('INSERT INTO live_world VALUES(1,?)').run(JSON.stringify({ version: 3, geometryVersion: G10, coordinateExpansionVersion: 10,
    drops: [{ id: 'physical-cycle', containerId: 'metro-civic-block-0-address-0-search', x: 340, y: 146, items: [{ id: 'physical-item', modelId: 'coffee' }] }],
    lootCooldowns: [['container:metro-civic-block-0-address-1-search', 200000]], scavs: [], events: [] }));
  db.query('INSERT INTO live_players VALUES(?,?)').run('offline', JSON.stringify({ id: 'fighter', identity: 'offline', mapId: 'perimeter', x: 400, y: 400,
    body: { wounded: true }, medicine: { splint: 1 }, lootItems: [{ id: 'inventory-item' }], searchedDropIds: ['physical-cycle'],
    entryPending: { id: 'paid-receipt', x: 266, y: 266, respawn: true },
    automation: { enabled: true, stage: 'extract', routeId: 'customs-loot', stopIndex: 2 },
    sortie: { poiIds: ['metro-civic-block-0'], visitedContainerIds: ['visited'], skippedDropIds: ['physical-cycle'], enteredStop: 2,
      recalling: true, extractTarget: { x: 18, y: 188 }, blockedExtractKeys: ['266,266'], blockedAt: 1234 } }));
  db.query('INSERT INTO live_bosses VALUES(?,?)').run('lesnik', JSON.stringify({ bossCycle: 7, body: { injured: true }, bossDeathSettled: false }));
  db.query('INSERT INTO live_economy_outbox VALUES(?,?,?)').run('paid-receipt', JSON.stringify({ id: 'paid-receipt', kind: 'supply', money: 20, ammo: 30 }), 0);
  return db;
}
const player = (db: Database) => JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_players WHERE identity=\'offline\'').get()!.state);
const rest = (db: Database) => ({ world: db.query('SELECT * FROM live_world').all(), bosses: db.query('SELECT * FROM live_bosses').all(), receipts: db.query('SELECT * FROM live_economy_outbox').all() });

test('G10 to G11 changes route-derived coordinates once without shifting the 384 coordinate frame or touching durable progress', () => {
  const db = fixture();
  try {
    const before = player(db), durable = rest(db);
    expect(migrateExpandedLiveCoordinates(db, { generatorVersion: 11 } as LiveWorld)).toBe(false);
    expect(invalidateLiveGeometryRoutes(db, G11)).toBe(1);
    expect(player(db)).toEqual({ ...before, sortie: { ...before.sortie, extractTarget: null, blockedExtractKeys: [], blockedAt: 0 } });
    expect(rest(db)).toEqual(durable);
    // An interrupted startup can repeat the invalidation before its world save.
    expect(invalidateLiveGeometryRoutes(db, G11)).toBe(0);
    expect(player(db).x).toBe(400); expect(player(db).y).toBe(400);
    const world = JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world').get()!.state);
    world.geometryVersion = G11; db.query('UPDATE live_world SET state=?').run(JSON.stringify(world));
    const current = player(db); current.sortie.extractTarget = { x: 1005, y: 836 }; current.sortie.blockedExtractKeys = ['18,188']; current.sortie.blockedAt = 9999;
    db.query('UPDATE live_players SET state=? WHERE identity=\'offline\'').run(JSON.stringify(current));
    expect(invalidateLiveGeometryRoutes(db, G11)).toBe(0); expect(player(db)).toEqual(current);
  } finally { db.close(); }
});

test('a malformed offline save rolls back route invalidation for every player and leaves receipt/world recovery intact', () => {
  const db = fixture();
  try {
    db.query('INSERT INTO live_players VALUES(?,?)').run('damaged', '{');
    const before = db.query('SELECT * FROM live_players').all(), durable = rest(db);
    expect(() => invalidateLiveGeometryRoutes(db, G11)).toThrow();
    expect(db.query('SELECT * FROM live_players').all()).toEqual(before); expect(rest(db)).toEqual(durable);
  } finally { db.close(); }
});
