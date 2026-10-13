import { afterEach, describe, expect, test } from 'bun:test';
import { createGameService, readGameCommand, type GameService } from '../server/game';
import { getFieldKitStock, getProductionReserve, getRoomProductionState, type ShelterCost } from '../src/game/engine';
import { readAuthoritativeAction, readAuthoritativeSnapshot } from '../src/authoritative-client';
import type { GameActionSnapshot, GameCommand, GameSnapshot } from '../src/game/commands';

const NOW = 1_792_000_000_000, ORIGIN = 'http://shelter.test';
const services: GameService[] = [];
afterEach(() => { for (const service of services.splice(0)) service.close(); });
const cost = (money = 0, changes: Partial<ShelterCost['supplies']> = {}): ShelterCost =>
  ({ money, supplies: { ammo: 0, medicine: 0, scrap: 0, intel: 0, ...changes } });
function setup(extra: Partial<Parameters<typeof createGameService>[0]> = {}) {
  let clock = NOW;
  const service = createGameService({ dbPath: ':memory:', secureCookies: false, allowedOrigins: [ORIGIN], now: () => clock, outcomeSeed: () => 698906565, ...extra });
  services.push(service);
  return { service, setTime: (time: number) => { clock = time; } };
}
interface Client { cookie: string; snapshot: GameSnapshot; account?: string }
function request(path: string, method = 'GET', body?: unknown, client?: Client, extra: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/game/${path}`, { method, headers: {
    ...(method === 'POST' ? { origin: ORIGIN, 'content-type': 'application/json' } : {}),
    ...(client ? { cookie: client.cookie, 'x-prapor-game': client.snapshot.identity.id, ...(client.account ? { 'x-prapor-account': client.account } : {}) } : {}), ...extra,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function joinClient(service: GameService, cookie = '', account?: string): Promise<Client> {
  const response = (await service.fetch(request('join', 'POST', {}, undefined, { cookie, ...(account ? { 'x-prapor-account': account } : {}) }), 'test-ip'))!;
  expect(response.status).toBe(200);
  return { cookie: response.headers.get('set-cookie')?.split(';')[0] ?? cookie, snapshot: readAuthoritativeSnapshot(await response.json()), account };
}
async function action(service: GameService, client: Client, command: GameCommand, revision = client.snapshot.revision) {
  const response = (await service.fetch(request('action', 'POST', { revision, command }, client), 'test-ip'))!;
  const raw = await response.json() as GameActionSnapshot & { code?: string; snapshot?: GameSnapshot };
  if (response.ok) client.snapshot = readAuthoritativeAction(raw);
  else if (raw.snapshot) client.snapshot = readAuthoritativeSnapshot(raw.snapshot);
  return { response, body: raw };
}
async function state(service: GameService, client: Client) {
  const response = (await service.fetch(request('state', 'GET', undefined, client), 'test-ip'))!;
  expect(response.status).toBe(200);
  client.snapshot = readAuthoritativeSnapshot(await response.json());
  return client.snapshot;
}

describe('authoritative shelter logistics commands', () => {
  test('accepts bounded intent only and rejects invented kit stock, effects, payment and client clocks', async () => {
    const { service } = setup(), client = await joinClient(service), before = structuredClone(client.snapshot);
    const scavId = before.state.scavs[0]!.id;
    for (const command of [
      { type: 'setProductionReserve', args: [{ ...cost(), kits: { maintenance: 8, trauma: 8 } }] },
      { type: 'setProductionReserve', args: [cost(-1)] },
      { type: 'setProductionReserve', args: [cost(.5)] },
      { type: 'setProductionReserve', args: [cost(1_000_000_001)] },
      { type: 'setProductionReserve', args: [cost(0, { ammo: -1 })] },
      { type: 'setProductionReserve', args: [cost(0, { intel: .1 })] },
      { type: 'setProductionReserve', args: [cost(0, { scrap: 1_000_001 })] },
      { type: 'setProductionReserve', args: [{ money: 0, supplies: { ammo: 0, medicine: 0, scrap: 0 } }] },
      { type: 'setProductionReserve', args: [cost(), NOW + 86_400_000] },
      { type: 'setRoomStockTarget', args: ['room-medbay', -1] },
      { type: 'setRoomStockTarget', args: ['room-medbay', .5] },
      { type: 'setRoomStockTarget', args: ['room-medbay', 1_000_001] },
      { type: 'setRoomStockTarget', args: ['room-medbay', 3, NOW + 86_400_000] },
      { type: 'setFieldKit', args: [scavId, 'toString'] },
      { type: 'setFieldKit', args: [scavId, { injuryMultiplier: 0 }] },
      { type: 'queueFieldKitProduction', args: ['room-workshop', 'none'] },
      { type: 'queueFieldKitProduction', args: ['room-workshop', '__proto__'] },
      { type: 'queueFieldKitProduction', args: ['room-workshop', 'maintenance', NOW + 86_400_000] },
      { type: 'queueFieldKitProduction', args: ['room-workshop', 'maintenance'], paid: cost() },
    ]) {
      expect(() => readGameCommand(command)).toThrow();
      expect((await service.fetch(request('action', 'POST', { revision: before.revision, command }, client)))!.status).toBe(400);
    }
    expect(await state(service, client)).toEqual(before);
    const max = cost(1_000_000_000, { ammo: 1_000_000, medicine: 1_000_000, scrap: 1_000_000, intel: 1_000_000 });
    expect(readGameCommand({ type: 'setProductionReserve', args: [max] })).toEqual({ type: 'setProductionReserve', args: [max] });
    expect(readGameCommand({ type: 'setRoomStockTarget', args: ['room-medbay', null] }).type).toBe('setRoomStockTarget');
    expect(service.healthy()).toBe(true);
  });

  test('reserves and batch targets are server settings; paid output completes and lowering a floor resumes production', async () => {
    const { service, setTime } = setup(), client = await joinClient(service), workerId = client.snapshot.state.scavs[1]!.id;
    const reserve = cost(600, { ammo: 12, scrap: client.snapshot.state.supplies.scrap - 2, intel: 2 });
    const targetMedicine = client.snapshot.state.supplies.medicine + 3;
    expect((await action(service, client, { type: 'setProductionReserve', args: [reserve] })).body.result.ok).toBe(true);
    expect(getProductionReserve(client.snapshot.state)).toEqual(reserve);
    const protectedMoney = client.snapshot.state.money, protectedScrap = client.snapshot.state.supplies.scrap;
    const blocked = await action(service, client, { type: 'queueFieldKitProduction', args: ['room-workshop', 'maintenance'] });
    expect(blocked.body.result.ok).toBe(false);
    expect(client.snapshot.state.money).toBe(protectedMoney);
    expect(client.snapshot.state.supplies.scrap).toBe(protectedScrap);
    expect(client.snapshot.state.shelter.rooms[0]!.queue).toHaveLength(0);
    expect((await action(service, client, { type: 'assignWorker', args: [workerId, 'room-medbay'] })).body.result.ok).toBe(true);
    expect((await action(service, client, { type: 'setRoomRecipe', args: ['room-medbay', 'medicine-batch', true] })).body.result.ok).toBe(true);
    expect((await action(service, client, { type: 'setRoomStockTarget', args: ['room-medbay', targetMedicine] })).body.result.ok).toBe(true);
    const paidRoom = client.snapshot.state.shelter.rooms.find(room => room.id === 'room-medbay')!;
    const remaining = getRoomProductionState(client.snapshot.state, paidRoom).remainingSeconds!;
    setTime(NOW + Math.ceil(remaining * 1000)); await state(service, client);
    const completed = client.snapshot.state.shelter.rooms.find(room => room.id === 'room-medbay')!;
    expect(completed.cycles).toBe(1); expect(completed.queue).toHaveLength(0);
    expect(client.snapshot.state.supplies.medicine).toBe(targetMedicine);
    const beforeResume = { money: client.snapshot.state.money, scrap: client.snapshot.state.supplies.scrap };
    expect((await action(service, client, { type: 'setProductionReserve', args: [cost()] })).body.result.ok).toBe(true);
    expect((await action(service, client, { type: 'setRoomStockTarget', args: ['room-medbay', null] })).body.result.ok).toBe(true);
    expect(client.snapshot.state.shelter.rooms.find(room => room.id === 'room-medbay')!.queue).toHaveLength(1);
    expect(client.snapshot.state.money).toBe(beforeResume.money - 20);
    expect(client.snapshot.state.supplies.scrap).toBe(beforeResume.scrap - 2);
  });

  test('duplicate production and dispatch requests cannot spend or issue two kits; the snapshot stays frozen through extraction', async () => {
    const { service, setTime } = setup(), one = await joinClient(service), workerId = one.snapshot.state.scavs[1]!.id, scavId = one.snapshot.state.scavs[0]!.id;
    expect((await action(service, one, { type: 'assignWorker', args: [workerId, 'room-workshop'] })).body.result.ok).toBe(true);
    const two = await joinClient(service, one.cookie), before = { money: one.snapshot.state.money, scrap: one.snapshot.state.supplies.scrap };
    const command: GameCommand = { type: 'queueFieldKitProduction', args: ['room-workshop', 'maintenance'] };
    const duplicateOrder = await Promise.all([action(service, one, command), action(service, two, command)]);
    expect(duplicateOrder.map(result => result.response.status).sort()).toEqual([200, 409]);
    await state(service, one);
    const workshop = one.snapshot.state.shelter.rooms.find(room => room.id === 'room-workshop')!;
    expect(workshop.queue).toHaveLength(1);
    expect(workshop.queue[0]!.createdAt).toBe(NOW);
    expect(one.snapshot.state.money).toBe(before.money - 25);
    expect(one.snapshot.state.supplies.scrap).toBe(before.scrap - 3);
    expect(getFieldKitStock(one.snapshot.state).maintenance).toBe(0);
    const remaining = getRoomProductionState(one.snapshot.state, workshop).remainingSeconds!;
    setTime(NOW + Math.ceil(remaining * 1000)); await state(service, one);
    expect(getFieldKitStock(one.snapshot.state).maintenance).toBe(1);
    expect((await action(service, one, { type: 'setFieldKit', args: [scavId, 'maintenance'] })).body.result.ok).toBe(true);
    const departureRevision = one.snapshot.revision;
    expect((await action(service, one, { type: 'dispatchRaid', args: [scavId, 'courtyard'] })).body.result.ok).toBe(true);
    const paidRaid = structuredClone(one.snapshot.state.raids[0]!), paidMoney = one.snapshot.state.money;
    expect(paidRaid.fieldKit).toBe('maintenance'); expect(paidRaid.outcomeSeed).toBeUndefined();
    expect(getFieldKitStock(one.snapshot.state).maintenance).toBe(0);
    const duplicate = await action(service, one, { type: 'dispatchRaid', args: [scavId, 'courtyard'] }, departureRevision);
    expect(duplicate.response.status).toBe(409);
    expect(one.snapshot.state.money).toBe(paidMoney);
    expect(one.snapshot.state.raids).toHaveLength(1);
    expect((await action(service, one, { type: 'setFieldKit', args: [scavId, 'trauma'] })).body.result.ok).toBe(true);
    expect(one.snapshot.state.raids[0]!.fieldKit).toBe('maintenance');
    setTime(paidRaid.endsAt); await state(service, one);
    expect(one.snapshot.state.raids[0]!.expedition!.status).toBe('choice');
    const extractionRevision = one.snapshot.revision;
    expect((await action(service, one, { type: 'extractRaid', args: [paidRaid.id] })).body.result.ok).toBe(true);
    expect(one.snapshot.state.history).toHaveLength(1);
    expect(one.snapshot.state.history[0]!.fieldKit).toBe('maintenance');
    const final = structuredClone(one.snapshot.state);
    expect((await action(service, one, { type: 'extractRaid', args: [paidRaid.id] }, extractionRevision)).response.status).toBe(409);
    expect(one.snapshot.state).toEqual(final);
    expect(JSON.stringify(one.snapshot)).not.toContain('outcomeSeed');
  });

  test('account and guest shelters keep separate settings and an identity change rejects these commands', async () => {
    let accountActive = true;
    const { service } = setup({ accounts: { resolveLiveIdentity: request => accountActive && request.headers.get('cookie') === 'account=session' ? { id: 'account-one', name: 'Shelter' } : null } });
    const account = await joinClient(service, 'account=session', 'account-one'), guest = await joinClient(service);
    expect(account.snapshot.identity.kind).toBe('account'); expect(guest.snapshot.identity.kind).toBe('guest');
    const guestBefore = structuredClone(guest.snapshot.state), reserve = cost(300, { ammo: 12, medicine: 1, scrap: 5 });
    expect((await action(service, account, { type: 'setProductionReserve', args: [reserve] })).body.result.ok).toBe(true);
    const scavId = account.snapshot.state.scavs[0]!.id;
    expect((await action(service, account, { type: 'setFieldKit', args: [scavId, 'trauma'] })).body.result.ok).toBe(true);
    expect((await state(service, guest)).state).toEqual(guestBefore);
    const spoof = { ...guest, snapshot: account.snapshot };
    expect((await service.fetch(request('action', 'POST', { revision: account.snapshot.revision, command: { type: 'queueFieldKitProduction', args: ['room-workshop', 'maintenance'] } }, spoof)))!.status).toBe(401);
    accountActive = false;
    expect((await service.fetch(request('action', 'POST', { revision: account.snapshot.revision, command: { type: 'setProductionReserve', args: [cost()] } }, account)))!.status).toBe(401);
    accountActive = true;
    const rejoined = await joinClient(service, account.cookie, account.account);
    expect(getProductionReserve(rejoined.snapshot.state)).toEqual(reserve);
    expect(rejoined.snapshot.state.scavs[0]!.fieldKit).toBe('trauma');
  });
});
