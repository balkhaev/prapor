import { expect, test } from 'bun:test';
import type { LiveCityRegion } from '../src/game/live';
import { generateWorldProps } from '../src/game/world-props';

function sceneryFixture(width: number, height: number, ground: string, city?: LiveCityRegion) {
  return { width, height, terrainRows: Array.from({ length: height }, () => ground.repeat(width)), paths: [], obstacles: [], extracts: [], city,
    citySites: [], districts: [], pois: [], containers: [], npcSpawns: [] } as Parameters<typeof generateWorldProps>[0];
}

test('street furniture follows pavements and power lines use long rural spans without roadside parking clutter', () => {
  const make = (urban: boolean) => {
    const world = sceneryFixture(128, 64, 'y', urban ? { name: 'Город', x: 0, y: 0, width: 128, height: 64, quarters: [] } : undefined);
    for (let y = 25; y <= 37; y++) world.terrainRows![y] = (y >= 29 && y <= 33 ? 'r' : 'c').repeat(128);
    world.paths = [{ id: 'collector-test', name: 'Улица', kind: 'road', width: 4, points: [{ x: 4, y: 31 }, { x: 123, y: 31 }] }];
    return generateWorldProps(world, 'frontage-layout').props;
  };
  const urban = make(true), rural = make(false), lamps = urban.filter(prop => prop.kind === 'lamp'), poles = rural.filter(prop => prop.kind === 'power-pole');
  expect(lamps.length).toBeGreaterThan(10); expect(poles.length).toBeGreaterThan(3); expect(poles.length).toBeLessThan(8);
  expect(urban.some(prop => prop.kind === 'power-pole')).toBe(false); expect(rural.some(prop => prop.kind === 'lamp')).toBe(false);
  expect([...urban, ...rural].some(prop => ['car', 'bus', 'bench'].includes(prop.kind))).toBe(false);
  for (const [items, spacing] of [[lamps, 7], [poles, 18]] as const) for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++)
    expect(Math.hypot(items[i]!.x - items[j]!.x, items[i]!.y - items[j]!.y)).toBeGreaterThanOrEqual(spacing);
});

test('large uninterrupted forest is filled in every region without truncating at the public prop cap', () => {
  const world = sceneryFixture(448, 448, 'f'), first = generateWorldProps(world, 'large-forest').props, repeat = generateWorldProps(world, 'large-forest').props;
  expect(first).toEqual(repeat); expect(first.length).toBeGreaterThan(4000); expect(first.length).toBeLessThan(5500);
  const counts = [[0, 0], [224, 0], [0, 224], [224, 224]].map(([x, y]) => first.filter(prop => prop.x >= x! && prop.x < x! + 224 && prop.y >= y! && prop.y < y! + 224).length);
  expect(Math.min(...counts)).toBeGreaterThan(900); expect(Math.max(...counts) - Math.min(...counts)).toBeLessThan(100);
});

test('legacy civic halls keep outdoor gardens, playgrounds and vegetation outside their real six-wall envelope', () => {
  const world = sceneryFixture(80, 64, 'g'), hall = { x: 20, y: 20, width: 18, height: 12 };
  world.pois = [{ x: 16, y: 16, width: 28, height: 28, id: 'civic-hall', templateId: 'city-hospital', name: 'Больница', districtId: 'village', danger: 2, tags: ['city'], entrances: [] }];
  world.obstacles = [
    { x: 20, y: 20, width: 7, height: 1, kind: 'wall', label: 'Приёмное отделение' },
    { x: 30, y: 20, width: 8, height: 1, kind: 'wall' },
    { x: 20, y: 31, width: 7, height: 1, kind: 'wall' },
    { x: 30, y: 31, width: 8, height: 1, kind: 'wall' },
    { x: 20, y: 21, width: 1, height: 10, kind: 'wall' },
    { x: 37, y: 21, width: 1, height: 10, kind: 'wall' },
  ];
  for (const seed of ['perimeter-alpha-01', 'civic-yard']) {
    const props = generateWorldProps(world, seed).props;
    expect(props.length).toBeGreaterThan(20);
    expect(props.some(prop => prop.x < hall.x + hall.width && prop.x + prop.width > hall.x
      && prop.y < hall.y + hall.height && prop.y + prop.height > hall.y)).toBe(false);
  }
});
