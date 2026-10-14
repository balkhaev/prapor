import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { LiveWorld } from '../src/game/live';
import { migrateExpandedLiveCoordinates } from '../server/live-coordinate-migration';

const current = { generatorVersion: 7 } as LiveWorld;
function fixture(): Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE live_world(id INTEGER PRIMARY KEY,state TEXT); CREATE TABLE live_players(identity TEXT PRIMARY KEY,state TEXT); CREATE TABLE live_bosses(boss_id TEXT PRIMARY KEY,state TEXT); CREATE TABLE live_economy_outbox(id TEXT PRIMARY KEY,payload TEXT,acknowledged INTEGER)');
  const world = { geometryVersion: 'perimeter-g6-shipped', version: 3, drops: [{ id: 'corpse', source: 'body', mapId: 'perimeter', x: 0, y: 255, amount: 17, items: [{ id: 'private', modelId: 'old-watch' }] },
    { id: 'district-corpse', source: 'body', mapId: 'depot', x: 4, y: 5 }, { id: 'cycle', source: 'supply', mapId: 'perimeter', x: 81, y: 67, containerId: 'city-old-center-0-slot-0', expiresAt: 50000 }],
    lootCooldowns: [['container:city-old-center-0-slot-1', 60000], ['perimeter:3:4', 70000]] };
  db.query('INSERT INTO live_world VALUES(1,?)').run(JSON.stringify(world));
  db.query('INSERT INTO live_players VALUES(?,?)').run('offline', JSON.stringify({ identity: 'offline', id: 'fighter', mapId: 'perimeter', x: 0, y: 0, body: { wounded: true }, medicine: { splint: 1 }, lootItems: [{ id: 'inventory' }], searchedDropIds: ['cycle'] }));
  db.query('INSERT INTO live_players VALUES(?,?)').run('paid', JSON.stringify({ identity: 'paid', id: 'paid-fighter', mapId: 'perimeter', x: 249, y: 6, entryPending: { id: 'receipt', x: 249, y: 6, respawn: true, automatic: true, districtId: 'sawmill' },
    automation: { enabled: true, stage: 'route', target: { x: 99, y: 102 }, targetId: 'old-target' }, sortie: { poiIds: ['poi-2-0'], visitedContainerIds: ['existing-cycle'], extractTarget: { x: 6, y: 6 }, blockedExtractKeys: ['6:6'], blockedAt: 10 }, destination: { x: 4, y: 8 }, path: [{ x: 4, y: 8 }] }));
  db.query('INSERT INTO live_bosses VALUES(?,?)').run('lesnik', JSON.stringify({ id: 'boss-lesnik', mapId: 'perimeter', x: 220, y: 40, home: { x: 219, y: 41 }, route: [{ x: 218, y: 42 }], bossCycle: 9, bossDeathSettled: true, respawnAt: 120000, body: { dead: true } }));
  db.query('INSERT INTO live_economy_outbox VALUES(?,?,0)').run('receipt', JSON.stringify({ id: 'receipt', kitId: 'balanced', owner: 'paid', money: 1300, ammo: 20 }));
  return db;
}
const player = (db: Database, id: string) => JSON.parse(db.query<{ state: string }, [string]>('SELECT state FROM live_players WHERE identity=?').get(id)!.state);
const world = (db: Database) => JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world').get()!.state);

test('expanded coordinate migration moves offline rows, pending paid entries, bosses and loose cargo only once', () => {
  const db = fixture();
  try {
    const outbox = db.query('SELECT * FROM live_economy_outbox').all();
    expect(migrateExpandedLiveCoordinates(db, current)).toBe(true);
    expect(player(db, 'offline')).toMatchObject({ identity: 'offline', id: 'fighter', x: 32, y: 32, body: { wounded: true }, medicine: { splint: 1 }, lootItems: [{ id: 'inventory' }], searchedDropIds: ['cycle'] });
    expect(player(db, 'paid')).toMatchObject({ x: 281, y: 38, entryPending: { id: 'receipt', x: 281, y: 38, automatic: true, respawn: true }, automation: { enabled: true, stage: 'route', target: null, targetId: null },
      sortie: { poiIds: ['poi-2-0'], visitedContainerIds: ['existing-cycle'], extractTarget: null, blockedExtractKeys: [], blockedAt: 0 }, destination: null, path: [] });
    expect(JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_bosses').get()!.state)).toMatchObject({ x: 252, y: 72, home: { x: 251, y: 73 }, route: [{ x: 250, y: 74 }], bossCycle: 9, bossDeathSettled: true, respawnAt: 120000, body: { dead: true } });
    expect(world(db).drops).toEqual([{ id: 'corpse', source: 'body', mapId: 'perimeter', x: 32, y: 287, amount: 17, items: [{ id: 'private', modelId: 'old-watch' }] },
      { id: 'district-corpse', source: 'body', mapId: 'perimeter', x: 36, y: 165 }, { id: 'cycle', source: 'supply', mapId: 'perimeter', x: 113, y: 99, containerId: 'city-old-center-0-slot-0', expiresAt: 50000 }]);
    expect(world(db).lootCooldowns).toEqual([['container:city-old-center-0-slot-1', 60000], ['perimeter:35:36', 70000]]);
    const once = { players: db.query('SELECT * FROM live_players').all(), world: world(db) };
    expect(migrateExpandedLiveCoordinates(db, current)).toBe(false);
    expect({ players: db.query('SELECT * FROM live_players').all(), world: world(db) }).toEqual(once);
    expect(db.query('SELECT * FROM live_economy_outbox').all()).toEqual(outbox);
  } finally { db.close(); }
});

test('an invalid offline row rolls back the whole migration without touching paid receipts or setting its marker', () => {
  const db = fixture();
  try {
    db.query('INSERT INTO live_players VALUES(?,?)').run('broken', 'not-json');
    const before = { players: db.query('SELECT * FROM live_players').all(), world: db.query('SELECT * FROM live_world').all(), bosses: db.query('SELECT * FROM live_bosses').all(), outbox: db.query('SELECT * FROM live_economy_outbox').all() };
    expect(() => migrateExpandedLiveCoordinates(db, current)).toThrow();
    expect({ players: db.query('SELECT * FROM live_players').all(), world: db.query('SELECT * FROM live_world').all(), bosses: db.query('SELECT * FROM live_bosses').all(), outbox: db.query('SELECT * FROM live_economy_outbox').all() }).toEqual(before);
  } finally { db.close(); }
});

test.each(['direct G6', 'saved G7', 'interrupted G7 startup'])('G8 cumulative coordinates handle %s once while keeping kit receipts and offline bodies', scenario => {
  const db = fixture(), expanded = { generatorVersion: 8 } as LiveWorld;
  try {
    const outbox = db.query('SELECT * FROM live_economy_outbox').all();
    if (scenario !== 'direct G6') {
      expect(migrateExpandedLiveCoordinates(db, current)).toBe(true);
      if (scenario === 'saved G7') { const saved = world(db); saved.geometryVersion = 'perimeter-g7-shipped'; delete saved.coordinateExpansionVersion; db.query('UPDATE live_world SET state=?').run(JSON.stringify(saved)); }
    }
    expect(migrateExpandedLiveCoordinates(db, expanded)).toBe(true);
    expect(player(db, 'offline')).toMatchObject({ x: 96, y: 96, identity: 'offline', id: 'fighter', body: { wounded: true }, medicine: { splint: 1 }, lootItems: [{ id: 'inventory' }], searchedDropIds: ['cycle'] });
    expect(player(db, 'paid')).toMatchObject({ x: 345, y: 102, entryPending: { id: 'receipt', x: 345, y: 102, respawn: true, automatic: true } });
    expect(world(db).drops.find((drop: { id: string }) => drop.id === 'district-corpse')).toMatchObject({ x: 100, y: 229 });
    const once = { players: db.query('SELECT * FROM live_players').all(), world: world(db), bosses: db.query('SELECT * FROM live_bosses').all() };
    expect(migrateExpandedLiveCoordinates(db, expanded)).toBe(false);
    expect({ players: db.query('SELECT * FROM live_players').all(), world: world(db), bosses: db.query('SELECT * FROM live_bosses').all() }).toEqual(once);
    expect(world(db).coordinateExpansionVersion).toBe(8);
    expect(db.query('SELECT * FROM live_economy_outbox').all()).toEqual(outbox);
  } finally { db.close(); }
});
