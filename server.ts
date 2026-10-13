import { join } from "node:path";
import { createHandler, readServerOptions } from "./server/handler";
import { createAccountService, getClientAddress, readAccountOptions } from "./server/accounts";
import { isIP } from "node:net";
import { createLiveService, readLiveOptions } from "./server/live";
import { createGameService, readGameOptions } from "./server/game";

const { hostname, port } = readServerOptions(process.env);
const accounts = createAccountService(readAccountOptions(process.env));
const game = createGameService(readGameOptions(process.env, accounts));
const live = createLiveService({ ...readLiveOptions(process.env, accounts), economy: game.liveEconomy });
const trustedProxies = (process.env.TRUSTED_PROXIES ?? "").split(",").map(value => value.trim()).filter(Boolean);
if (trustedProxies.some(value => !isIP(value))) throw new Error("TRUSTED_PROXIES must contain exact proxy IP addresses");
const handler = createHandler(join(import.meta.dir, "dist"), accounts, live, game);
const server = Bun.serve({
  hostname,
  port,
  maxRequestBodySize: 5_000_000,
  fetch: (request, server) => handler(request, getClientAddress(request, server.requestIP(request)?.address, trustedProxies)),
});

for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
  server.stop(true);
  live.close();
  game.close();
  accounts.close();
});

console.log(`Production game listening on http://${server.hostname}:${server.port}`);
