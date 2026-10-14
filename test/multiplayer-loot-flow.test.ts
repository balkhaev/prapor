import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGameService, type GameService } from "../server/game";
import { createLiveService, type LiveService } from "../server/live";
import type { EconomyLoot, LiveEconomy } from "../server/live-economy";
import type { GameActionSnapshot, GameCommand, GameSnapshot } from "../src/game/commands";
import type { LiveCommand, LivePoint, LiveSnapshot } from "../src/game/live";
import { getLiveMap } from "../src/game/live-maps";
import { readMarketSnapshot, type MarketSnapshot } from "../src/game/flea";
import { createHealth, createMedicalInventory } from "../src/game/health";
import { readLiveSnapshot } from '../src/live-client';
import { getLiveLootDefinition } from '../src/game/live-loot';

const ORIGIN = "http://multiplayer.test", NOW = 1_792_000_000_000;
const fixtures: Array<{ folder: string; game: GameService; live: LiveService }> = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    fixture.live.close(); fixture.game.close();
    await rm(fixture.folder, { recursive: true, force: true });
  }
});
interface Player { cookie: string; game: GameSnapshot; live: LiveSnapshot }
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), "prapor-multiplayer-flow-")), gamePath = join(folder, "game.sqlite"), livePath = join(folder, "live.sqlite");
  let time = NOW;
  const gameOptions = { dbPath: gamePath, secureCookies: false, allowedOrigins: [ORIGIN], now: () => time };
  let game = createGameService(gameOptions);
  const liveOptions = { dbPath: livePath, secureCookies: false, allowedOrigins: [ORIGIN], now: () => time, random: () => 0, automaticTicks: false, economy: game.liveEconomy };
  const value = { folder, game, live: createLiveService(liveOptions) }; fixtures.push(value);
  const request = (path: string, player?: Player, body?: unknown) => new Request(`${ORIGIN}/api/${path}`, {
    method: body === undefined ? "GET" : "POST", headers: {
      ...(body === undefined ? {} : { origin: ORIGIN, "content-type": "application/json" }),
      ...(player ? { cookie: player.cookie, "x-prapor-game": player.game.identity.id, "x-prapor-live": player.live.selfId } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  async function enter(): Promise<Player> {
    const gameReply = (await game.fetch(request("game/join", undefined, {})))!;
    expect(gameReply.status).toBe(200);
    const player = { cookie: gameReply.headers.get("set-cookie")!.split(";")[0]!, game: await gameReply.json() as GameSnapshot, live: { selfId: "" } as LiveSnapshot };
    const liveReply = (await value.live.fetch(request("live/join", player, { kitId: 'assault' })))!;
    expect(liveReply.status).toBe(200); player.live = await liveReply.json() as LiveSnapshot;
    const liveCookie = liveReply.headers.get("set-cookie")?.split(";")[0]; if (liveCookie) player.cookie += `; ${liveCookie}`;
    await gameState(player);
    return player;
  }
  async function gameState(player: Player) {
    const reply = (await game.fetch(request("game/state", player)))!; expect(reply.status).toBe(200);
    player.game = await reply.json() as GameSnapshot; return player.game;
  }
  async function gameAction(player: Player, command: GameCommand) {
    const reply = (await game.fetch(request("game/action", player, { revision: player.game.revision, command })))!;
    expect(reply.status).toBe(200); player.game = await reply.json() as GameActionSnapshot;
    expect((player.game as GameActionSnapshot).result.ok).toBe(true); return player.game;
  }
  async function liveAction(player: Player, command: LiveCommand, expectedStatus = 200) {
    const reply = (await value.live.fetch(request("live/action", player, command)))!; expect(reply.status).toBe(expectedStatus);
    const body = await reply.json() as LiveSnapshot; if (reply.ok) player.live = body; return body;
  }
  async function market(player: Player): Promise<MarketSnapshot> {
    const reply = (await game.fetch(request("game/market", player)))!; expect(reply.status).toBe(200); return readMarketSnapshot(await reply.json());
  }
  async function editLive(players: Player[], items: EconomyLoot[] = [], ammo?: number, medkits?: number, position?: LivePoint) {
    value.live.close();
    const db = new Database(livePath);
    try {
      const exit = getLiveMap("perimeter").extracts[0]!;
      for (const player of players) {
        const row = db.query<{ identity: string; state: string }, []>("SELECT identity,state FROM live_players").all().find(row => JSON.parse(row.state).id === player.live.selfId)!;
        const state = JSON.parse(row.state); Object.assign(state, position ?? exit, { safeUntil: 0, lastCombatAt: 0, disconnectAt: 0, ...(ammo === undefined ? {} : { ammo }), ...(medkits === undefined ? {} : { medkits }) });
        if (medkits !== undefined) state.medicine = createMedicalInventory({ ...state.medicine, medkit: medkits * 40 });
        db.query("UPDATE live_players SET state=? WHERE identity=?").run(JSON.stringify(state), row.identity);
      }
      const row = db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!, world = JSON.parse(row.state);
      for (const scav of world.scavs) { scav.health = 0; scav.body = createHealth(); scav.body.parts.head.hp = 0; scav.respawnAt = NOW + 1_000_000; }
      if (items.length) world.drops.push({ id: randomUUID(), mapId: "perimeter", ...exit, amount: 0, items, source: "body", expiresAt: NOW + 1_000_000 });
      db.query("UPDATE live_world SET state=? WHERE id=1").run(JSON.stringify(world));
    } finally { db.close(); }
    value.live = createLiveService(liveOptions);
    for (const player of players) {
      const reply = (await value.live.fetch(request("live/join", player, {})))!; expect(reply.status).toBe(200); player.live = await reply.json() as LiveSnapshot;
    }
  }
  async function restart(players: Player[]) {
    value.live.close(); game.close();
    game = createGameService(gameOptions); value.game = game; liveOptions.economy = game.liveEconomy;
    value.live = createLiveService(liveOptions);
    for (const player of players) {
      const reply = (await value.live.fetch(request("live/join", player, {})))!; expect(reply.status).toBe(200); player.live = await reply.json() as LiveSnapshot;
    }
  }
  async function advance(ms: number, players: Player[]) {
    for (let elapsed = 0; elapsed < ms; elapsed += 250) {
      time += 250; value.live.tick();
      if (elapsed % 1000 === 0) for (const player of players) {
        const reply = (await value.live.fetch(request("live/state", player)))!; expect(reply.status).toBe(200); player.live = await reply.json() as LiveSnapshot;
      }
    }
    for (const player of players) { const reply = (await value.live.fetch(request("live/state", player)))!; expect(reply.status).toBe(200); player.live = await reply.json() as LiveSnapshot; }
  }
  return { value, enter, request, gameState, gameAction, liveAction, market, editLive, restart, advance,
    setBridge: (bridge: LiveEconomy) => { liveOptions.economy = bridge; } };
}

describe("real multiplayer loot, shared market and headquarters supplies", () => {
  test('two real headquarters contend for physical armor and a compatible module; extraction equips and installs their exact condition once', async () => {
    const f = await fixture(), first = await f.enter(), second = await f.enter();
    const items: EconomyLoot[] = [
      { id: randomUUID(), kind: 'gear', modelId: 'padded_vest', durability: 65, foundAt: NOW - 1000 },
      { id: randomUUID(), kind: 'module', modelId: 'factory-sks-stock', durability: 77, foundAt: NOW - 500 },
      { id: randomUUID(), modelId: 'perfume', foundAt: NOW - 100 },
    ];
    await f.editLive([first, second], items);
    const drop = first.live.drops.find(drop => drop.items?.some(item => item.id === items[0]!.id))!;
    expect(drop).toBeDefined(); expect(readLiveSnapshot(first.live).drops.find(item => item.id === drop.id)!.items).toEqual(items);
    await f.liveAction(first, { type: 'loot', id: drop.id });
    expect(readLiveSnapshot(first.live).self.lootItems).toEqual(items);
    await f.liveAction(second, { type: 'loot', id: drop.id }, 409);
    await f.liveAction(first, { type: 'extract' });
    const delivered = await f.gameState(first), gear = delivered.state.gearItems.find(item => item.modelId === 'padded_vest')!;
    const module = delivered.state.modules.find(item => item.modelId === 'factory-sks-stock' && item.foundAt === NOW - 500)!;
    expect(gear).toBeDefined(); expect(gear.durability).toBe(65); expect(gear.id).toMatch(/^gear-\d+$/);
    expect(module).toBeDefined(); expect(module.durability).toBe(77); expect(module.id).toMatch(/^module-\d+$/);
    expect(delivered.state.lootItems!.map(item => item.modelId)).toEqual(['perfume']);
    const scav = delivered.state.scavs[0]!, gun = delivered.state.weapons.find(item => item.weaponId === 'sks')!;
    await f.gameAction(first, { type: 'equipGear', args: [scav.id, 'armor', gear.id] });
    await f.gameAction(first, { type: 'installModule', args: [gun.id, module.id] });
    expect(first.game.state.scavs[0]!.loadout.armorItemId).toBe(gear.id);
    expect(first.game.state.weapons.find(item => item.id === gun.id)!.modules.stock).toEqual(module);
    expect(first.game.state.modules.some(item => item.id === module.id)).toBe(false);
    const before = structuredClone(first.game);
    await f.restart([first, second]);
    const restored = await f.gameState(first); expect(restored.state.gearItems).toEqual(before.state.gearItems);
    expect(restored.state.weapons.find(item => item.id === gun.id)!.modules.stock).toEqual(module);
    expect(restored.state.lootItems).toEqual(before.state.lootItems); expect(restored.revision).toBe(before.revision);
    const other = await f.gameState(second); expect(other.state.gearItems).toHaveLength(0); expect(other.state.lootItems ?? []).toHaveLength(0);
  });

  test("a generated jacket hides physical contents until server search and two real headquarters can extract its loot only once", async () => {
    const f = await fixture(), first = await f.enter(), second = await f.enter();
    const anchor = getLiveMap("perimeter").containers.find(anchor => anchor.kind === "jacket")!;
    await f.editLive([first, second], [], undefined, undefined, anchor);
    const hidden = first.live.drops.find(drop => drop.containerId === anchor.id)!;
    expect(hidden).toBeDefined(); expect(hidden).toMatchObject({ containerKind: "jacket", searched: false, amount: 0 }); expect(hidden.items).toBeUndefined();
    expect(second.live.drops.find(drop => drop.id === hidden.id)!.items).toBeUndefined();
    await f.liveAction(first, { type: "loot", id: hidden.id }, 409);
    await f.liveAction(first, { type: "search", id: hidden.id }); await f.liveAction(second, { type: "search", id: hidden.id });
    await f.advance(anchor.searchMs - 250, [first, second]); expect(first.live.drops.find(drop => drop.id === hidden.id)!.items).toBeUndefined();
    await f.advance(250, [first, second]);
    const revealed = first.live.drops.find(drop => drop.id === hidden.id)!;
    expect(revealed.searched).toBe(true); expect(revealed.items!.length).toBeGreaterThan(0);
    expect(second.live.drops.find(drop => drop.id === hidden.id)!.items).toEqual(revealed.items);
    expect(new Set(revealed.items!.map(item => item.id)).size).toBe(revealed.items!.length);
    const attempts = await Promise.all([f.value.live.fetch(f.request("live/action", first, { type: "loot", id: hidden.id })), f.value.live.fetch(f.request("live/action", second, { type: "loot", id: hidden.id }))]);
    expect(attempts.map(reply => reply!.status).sort()).toEqual([200, 409]);
    await f.advance(250, [first, second]);
    const winner = first.live.self.lootItems!.length ? first : second, loser = winner === first ? second : first;
    expect(winner.live.self.lootItems).toEqual(revealed.items); expect(loser.live.self.lootItems).toEqual([]);
    await f.editLive([winner]);
    const existing = new Set([...winner.game.state.modules, ...winner.game.state.gearItems, ...(winner.game.state.lootItems ?? [])].map(item => item.id));
    await f.liveAction(winner, { type: "extract" });
    const credited = await f.gameState(winner), models = revealed.items!.filter(item => !getLiveLootDefinition(item).autoSell).map(item => item.modelId).sort();
    const received = [...credited.state.modules, ...credited.state.gearItems, ...(credited.state.lootItems ?? [])].filter(item => !existing.has(item.id));
    expect(received.map(item => item.modelId).sort()).toEqual(models);
    const ids = received.map(item => item.id), revision = credited.revision;
    await f.liveAction(winner, { type: "extract" }); await f.restart([winner, loser]);
    const restored = (await f.gameState(winner)).state;
    expect([...restored.modules, ...restored.gearItems, ...(restored.lootItems ?? [])].filter(item => !existing.has(item.id)).map(item => item.id)).toEqual(ids); expect(winner.game.revision).toBe(revision);
    expect((await f.gameState(loser)).state.lootItems ?? []).toEqual([]); expect(loser.game.state.gearItems).toEqual([]);
  });
  test("two guests compete for one physical find, extract it to headquarters, trade it and use bought supplies online", async () => {
    const f = await fixture(), first = await f.enter(), second = await f.enter();
    const item = { id: randomUUID(), modelId: "coffee", foundAt: NOW };
    await f.editLive([first, second], [item]);
    const shared = (await f.value.live.fetch(f.request("live/state", first)))!; expect(shared.status).toBe(200);
    first.live = await shared.json() as LiveSnapshot;
    expect(first.live.server.online).toBe(2);
    const drop = first.live.drops.find(drop => drop.items?.some(value => value.id === item.id))!; expect(drop).toBeDefined();
    await f.liveAction(first, { type: "loot", id: drop.id });
    expect(first.live.self.lootItems?.map(item => item.id)).toEqual([item.id]);
    await f.liveAction(second, { type: "loot", id: drop.id }, 409);
    expect((await f.gameState(first)).state.lootItems ?? []).toHaveLength(0);
    await f.liveAction(first, { type: "extract" });
    expect(first.live.self.lootItems ?? []).toHaveLength(0);
    const extracted = await f.gameState(first), trophy = extracted.state.lootItems!.find(item => item.modelId === "coffee")!;
    expect(trophy).toBeDefined(); expect(trophy.id).toMatch(/^loot-\d+$/);
    const rewardCounts = { raids: extracted.state.stats.raidsCompleted, wins: extracted.state.stats.raidsWon };
    await f.liveAction(first, { type: "extract" });
    expect((await f.gameState(first)).state.lootItems).toHaveLength(1);
    await f.gameAction(first, { type: "listMarketItem", args: [{ kind: "loot", id: trophy.id, quantity: 1 }, 55] });
    const offer = (await f.market(second)).offers.find(offer => offer.asset.kind === "loot" && offer.asset.item.modelId === "coffee")!;
    expect(offer.guidePrice).toBe(55); expect(offer.owner).toBe(false);
    await f.gameAction(second, { type: "buyMarketListing", args: [offer.id] });
    expect((await f.market(first)).mine.find(item => item.id === offer.id)!.claimable).toBe(true);
    await f.gameAction(first, { type: "claimMarketSale", args: [offer.id] });
    expect((await f.gameState(first)).state.stats.raidsCompleted).toBe(rewardCounts.raids);
    expect(first.game.state.stats.raidsWon).toBe(rewardCounts.wins);
    const bought = second.game.state.lootItems!.find(item => item.modelId === "coffee")!;
    const scrap = second.game.state.supplies.scrap;
    await f.gameAction(second, { type: "recycleLootItem", args: [bought.id] });
    expect(second.game.state.supplies.scrap).toBe(scrap + 1);

    await f.gameAction(first, { type: 'buySupplies', args: ['ammo'] });
    await f.gameAction(first, { type: "listMarketItem", args: [{ kind: "supply", id: "ammo", quantity: 10 }, 65] });
    const ammoOffer = (await f.market(second)).offers.find(offer => offer.asset.kind === "supply" && offer.asset.id === "ammo")!;
    await f.gameAction(second, { type: "buyMarketListing", args: [ammoOffer.id] });
    const beforeAmmo = second.game.state.supplies.ammo, beforeMedicine = second.game.state.supplies.medicine;
    await f.editLive([second], [], 50, 1);
    expect(second.live.self.medicine.medkit).toBe(40);
    await f.liveAction(second, { type: "resupply" });
    expect(second.live.self.ammo).toBe(60); expect(second.live.self.medkits).toBe(2);
    expect(second.live.self.medicine.medkit).toBe(80);
    await f.gameState(second);
    expect(second.game.state.supplies.ammo).toBe(beforeAmmo - 10);
    expect(second.game.state.supplies.medicine).toBe(beforeMedicine - 1);
    await f.liveAction(second, { type: "resupply" }, 409);
    await f.gameState(second);
    expect(second.game.state.supplies.ammo).toBe(beforeAmmo - 10);
    expect(second.game.state.supplies.medicine).toBe(beforeMedicine - 1);
    const publicView = JSON.stringify(first.live);
    expect(publicView).not.toContain("guest:"); expect(publicView).not.toContain("account:");
  });
  test("a committed headquarters credit survives a lost acknowledgement and restarting both real databases without another trophy", async () => {
    const f = await fixture(), player = await f.enter(), item = { id: randomUUID(), modelId: "gold-ring", foundAt: NOW };
    await f.editLive([player], [item]);
    const drop = player.live.drops.find(drop => drop.items?.some(value => value.id === item.id))!;
    await f.liveAction(player, { type: "loot", id: drop.id });
    const bridge = f.value.game.liveEconomy;
    let loseAcknowledgement = true;
    f.setBridge({ ...bridge, deliver(parcel) {
      const result = bridge.deliver(parcel);
      if (loseAcknowledgement && result.ok) { loseAcknowledgement = false; throw new Error("Simulated process loss after the real game commit"); }
      return result;
    } });
    await f.liveAction(player, { type: "extract" });
    expect(player.live.self.pendingDelivery).toHaveLength(1);
    const credited = await f.gameState(player), lootId = credited.state.lootItems![0]!.id, revision = credited.revision;
    expect(credited.state.lootItems?.map(item => item.modelId)).toEqual(["gold-ring"]);
    await f.restart([player]);
    expect(player.live.self.pendingDelivery ?? []).toHaveLength(0);
    await f.gameState(player);
    expect(player.game.state.lootItems?.map(item => item.id)).toEqual([lootId]);
    expect(player.game.revision).toBe(revision);
    expect(player.live.self.lootItems ?? []).toHaveLength(0);
  });
});
