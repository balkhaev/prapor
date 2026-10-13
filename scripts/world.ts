import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { generateLiveWorld, validateGeneratedWorld, worldChunks, WORLD_TEMPLATES } from '../src/game/world-generation';

const args = process.argv.slice(2);
const allowed = new Set(['--seed', '--out']);
const options = new Map<string, string>();
for (let index = 0; index < args.length; index += 2) {
  const key = args[index], value = args[index + 1];
  if (!key || !allowed.has(key) || !value || value.startsWith('--') || options.has(key)) throw new Error('Usage: bun run world:generate [--seed layout-name] [--out path/to/world.json]');
  options.set(key, value);
}
const world = generateLiveWorld(options.get('--seed'));
const report = validateGeneratedWorld(world);
console.log(JSON.stringify({ version: world.version, seed: world.seed, dimensions: [world.width, world.height], ...report,
  npcPosts: world.npcSpawns.length, templateLibrary: WORLD_TEMPLATES.length,
  districts: world.districts.map(district => ({ id: district.id, name: district.name, spawn: district.spawns[0] })),
  containerKinds: [...new Set(world.containers.map(container => container.kind))],
}, null, 2));
if (options.has('--out')) {
  const path = resolve(options.get('--out')!);
  await mkdir(dirname(path), { recursive: true });
  // Offline content artifact. No game database, live seed or private loot state is changed.
  await writeFile(path, JSON.stringify({ world, chunks: worldChunks(world) }, null, 2), { flag: 'wx' });
  console.log(`Generated layout saved: ${path}`);
}
