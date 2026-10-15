#!/usr/bin/env bun
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const APP = "zycfl8uafyxiplfpq4tbtxkc";
const API = "https://deploy.balkhaev.com/api/v1/";
const ORIGINS = ["https://game.delopusk.ru", "https://game.balkhaev.com"];
const PAGES = ["/", "/characters.html", "/models.html", "/environment.html"];
const ssh = promisify(execFile);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
function need(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
type Job = { deployment_uuid: string; status: string; commit: string; is_webhook: boolean; pull_request_id: number; created_at: string };
type Runtime = { checks: Record<string, boolean>; assets: string[] };

export function parseArguments(args: string[]): { commit: string; wait: boolean } {
  const position = args.indexOf("--commit"), commit = args[position + 1] ?? "";
  need(position >= 0 && /^[0-9a-f]{40}$/i.test(commit), "Usage: verify-release.ts --commit <full SHA> [--wait]");
  need(args.length === (args.includes("--wait") ? 3 : 2) && args.every((arg, i) => i === position + 1 || arg === "--commit" || arg === "--wait"), "Unexpected arguments");
  return { commit: commit.toLowerCase(), wait: args.includes("--wait") };
}

async function api(path: string, token: string): Promise<unknown> {
  const response = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000), redirect: "error" });
  need(response.ok, `Coolify API HTTP ${response.status}`);
  try { return await response.json(); } catch { throw new Error("Invalid Coolify JSON response"); }
}

export async function waitForWebhook(commit: string, wait: boolean, token: string): Promise<Job> {
  const deadline = Date.now() + (wait ? 600_000 : 0);
  let previous = "";
  do {
    const history = await api(`deployments/applications/${APP}?skip=0&take=20`, token) as Job[] | { deployments: Job[] };
    const jobs = Array.isArray(history) ? history : history.deployments;
    need(Array.isArray(jobs), "Invalid Coolify history response");
    const candidate = jobs.filter(job => job.is_webhook === true && job.pull_request_id === 0 && (job.commit === commit || job.commit === "HEAD"))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const job = candidate ? await api(`deployments/${encodeURIComponent(candidate.deployment_uuid)}`, token) as Job : undefined;
    const state = job ? `${job.deployment_uuid} ${job.status} ${job.commit === "HEAD" ? "HEAD" : job.commit === commit ? commit : "another commit"}` : "Waiting for native webhook";
    if (state !== previous) { console.log(state); previous = state; }
    if (job?.status === "finished" && job.commit === commit) {
      need(job.is_webhook === true && job.pull_request_id === 0, "Release was not a production webhook deployment");
      return job;
    }
    need(!job || job.commit !== commit || ["queued", "in_progress"].includes(job.status), "Native webhook deployment did not finish successfully");
    need(wait && Date.now() < deadline, "No finished native webhook deployment for the requested SHA (use --wait)");
    await Bun.sleep(Math.min(10_000, Math.max(0, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw new Error("Native webhook verification timed out after 10 minutes");
}

export function inspectionScript(commit: string): string {
  return `import subprocess,json
expected='${commit}'
def run(args): return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,check=True).stdout
v=json.loads(run(['docker','inspect','prapor-game']))[0]
h=v['HostConfig']; e=dict(item.split('=',1) for item in v['Config']['Env'] if '=' in item)
image=json.loads(run(['docker','image','inspect',v['Image']]))[0]
mounts={m['Destination']:m for m in v['Mounts']}
def mount(target,source,rw):
 m=mounts.get(target,{})
 return m.get('Type')=='bind' and m.get('Source')==source and m.get('RW') is rw
checks={
 'healthy':v['State']['Running'] and v['State'].get('Health',{}).get('Status')=='healthy',
 'image':v['Config']['Image'].rsplit(':',1)[-1]==expected,
 'revision':image['Config'].get('Labels',{}).get('org.opencontainers.image.revision')==expected,
 'release':e.get('RELEASE_COMMIT')==expected,'production':e.get('NODE_ENV')=='production',
 'noGitConfigRuntime':not any(key.startswith('GIT_CONFIG_') for key in e),
 'readOnly':h['ReadonlyRootfs'],'capabilities':not h['Privileged'] and not h.get('CapAdd') and 'ALL' in (h.get('CapDrop') or []),
 'noNewPrivileges':any(item in ['no-new-privileges','no-new-privileges:true'] for item in (h.get('SecurityOpt') or [])),
 'cpu':h['NanoCpus']==1000000000 or h['CpuPeriod']>0 and h['CpuQuota']==h['CpuPeriod'],
 'memory':h['Memory']==768*1024*1024,
 'data':mount('/app/data','/data/prapor/data',True),
 'mailMount':mount('/run/secrets/resend_api_key','/data/prapor/secrets/resend_api_key',False),
 'googleMount':mount('/run/secrets/google_client_secret','/data/prapor/secrets/google_client_secret',False),
 'mailConfigured':e.get('RESEND_API_KEY_FILE')=='/run/secrets/resend_api_key' and bool(e.get('RESEND_FROM')),
 'googleConfigured':e.get('GOOGLE_CLIENT_SECRET_FILE')=='/run/secrets/google_client_secret' and bool(e.get('GOOGLE_CLIENT_ID'))}
public=json.loads(run(['docker','exec','prapor-game','bun','-e',${JSON.stringify(`import { accessSync, constants, statSync } from 'node:fs';
const readable = path => { try { accessSync(path, constants.R_OK); return statSync(path).size > 0; } catch { return false; } };
console.log(JSON.stringify({ assets: [...new Bun.Glob('assets/**/*').scanSync({cwd:'/app/dist',onlyFiles:true})].sort(), mailFile: readable('/run/secrets/resend_api_key'), googleFile: readable('/run/secrets/google_client_secret') }));`)}]))
checks['mailFile']=public['mailFile']; checks['googleFile']=public['googleFile']
print(json.dumps({'checks':checks,'assets':public['assets']}))`;
}

export async function inspectRuntime(commit: string, deadline: number): Promise<Runtime> {
  const options = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10"];
  const origin = ["ssh", "-i", "/data/coolify/ssh/keys/ssh_key@iy9ziufgkgvawjlsyyidpote", ...options, "root@81.90.31.214", `python3 -c ${quote(inspectionScript(commit))}`];
  let output: string;
  try { output = (await ssh("ssh", [...options, "root@deploy.balkhaev.com", origin.map(quote).join(" ")], { timeout: Math.max(1, Math.min(25_000, deadline - Date.now())), maxBuffer: 1024 * 1024, windowsHide: true })).stdout; }
  catch { throw new Error("Origin inspection failed (SSH/Docker)"); }
  const result = JSON.parse(output) as Runtime;
  for (const [name, passed] of Object.entries(result.checks)) need(passed === true, `Container check failed: ${name}`);
  need(result.assets.length > 0 && result.assets.length <= 256 && result.assets.every(path => /^[\w./-]+$/.test(path) && !path.split("/").includes("..")), "Invalid public asset inventory");
  return result;
}

async function publicResponse(origin: string, path: string, deadline: number): Promise<Response> {
  need(Date.now() < deadline, "Release verification deadline reached");
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(Math.min(10_000, deadline - Date.now())), redirect: "error", cache: "no-store" });
  need(response.status === 200, `Public HTTP check failed: ${origin}${path}`);
  const csp = response.headers.get("content-security-policy") ?? "";
  need(csp.includes("frame-ancestors 'none'") && !csp.includes("unsafe-eval"), `Public CSP check failed: ${origin}${path}`);
  return response;
}

export async function verifyPublic(assets: string[], deadline: number): Promise<void> {
  for (const origin of ORIGINS) {
    const get = (path: string) => publicResponse(origin, path, deadline);
    need((await (await get("/health")).json()).ok === true, `Health failed: ${origin}`);
    for (const page of PAGES) {
      const response = await get(page), html = await response.text();
      const entry = page === "/" ? "game" : page.slice(1, -5);
      need(response.headers.get("content-type")?.includes("text/html") && html.includes(`/assets/${entry}-`) && html.includes('type="module"'), `Built page failed: ${origin}${page}`);
    }
    for (let index = 0; index < assets.length; index += 6) await Promise.all(assets.slice(index, index + 6).map(async asset => {
      const response = await get(`/${asset}`), bytes = (await response.arrayBuffer()).byteLength;
      need(!response.headers.get("content-type")?.includes("text/html") && bytes > 0, `Built asset failed: ${asset}`);
    }));
    const world = await (await get("/api/live/status")).json();
    need(world.maps?.some((map: { width: number; height: number; city?: { quarters?: unknown[] } }) => map.width === 1024 && map.height === 1024 && map.city?.quarters?.length === 16), `World geometry check failed: ${origin}`);
    need((await (await get("/api/auth/session")).json()).googleEnabled === true, `Google configuration check failed: ${origin}`);
  }
}

export async function main(args = Bun.argv.slice(2)): Promise<void> {
  const { commit, wait } = parseArguments(args), token = process.env.COOLIFY_ACCESS_TOKEN;
  need(token, "COOLIFY_ACCESS_TOKEN is required");
  const job = await waitForWebhook(commit, wait, token), deadline = Date.now() + 90_000;
  let lastError = "";
  do {
    try {
      const runtime = await inspectRuntime(commit, deadline);
      await verifyPublic(runtime.assets, deadline);
      console.log(`Verified ${commit}: webhook ${job.deployment_uuid}; healthy image and revision; container controls and secrets; 2 domains, 4 pages, ${runtime.assets.length} assets each; CSP; world 1024/16.`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Release check failed";
      if (message !== lastError) { console.log(`Waiting for release: ${message}`); lastError = message; }
      if (Date.now() >= deadline) throw new Error(`Release verification failed after 90 seconds: ${message}`);
      await Bun.sleep(Math.min(5_000, deadline - Date.now()));
    }
  } while (Date.now() < deadline);
  throw new Error(`Release verification timed out: ${lastError}`);
}

if (import.meta.main) await main().catch(error => { console.error(error instanceof Error ? error.message : "Release verification failed"); process.exitCode = 1; });
