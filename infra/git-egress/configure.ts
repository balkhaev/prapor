/**
 * Configure Prapor's private Git HTTPS egress using existing trusted SSH/Coolify access.
 * No API token, SSH key or proxy credential is written to this checkout or printed.
 */
import { randomBytes } from 'node:crypto';

const APP = 'zycfl8uafyxiplfpq4tbtxkc';
const API = 'https://deploy.balkhaev.com/api/v1';
const HELPER_PROXY = 'http://172.18.0.1:19644';
const REPOS = ['https://github.com/balkhaev/prapor.git', 'https://github.com/balkhaev/prapor'];
const MARKER = '# Managed by prapor infra/git-egress/configure.ts';
const SSH = ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15',
  '-o', 'ForwardAgent=no', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', 'root@deploy.balkhaev.com'];
const ORIGIN = 'ssh -T -i /data/coolify/ssh/keys/ssh_key@iy9ziufgkgvawjlsyyidpote -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o ForwardAgent=no -o ControlMaster=no -o ControlPath=none root@81.90.31.214 sh -s';
const mode = process.argv[2];
if (!['--apply', '--check', '--test-recovery'].includes(mode ?? '')) {
  throw new Error('Usage: bun infra/git-egress/configure.ts --apply|--check|--test-recovery');
}
const token = process.env.COOLIFY_ACCESS_TOKEN;
if (!token) throw new Error('Set COOLIFY_ACCESS_TOKEN in the operator environment');
const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

async function api(path: string, method = 'GET', body?: unknown): Promise<any> {
  const response = await fetch(API + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('Coolify request failed: HTTP ' + response.status);
  return await response.json();
}
async function remote(target: 'management' | 'origin', script: string): Promise<string> {
  const child = Bun.spawn([...SSH, target === 'origin' ? ORIGIN : 'sh -s'], {
    stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
  });
  child.stdin.write(script.replace(/\r/g, '')); child.stdin.end();
  // Remote diagnostics may contain credentials on failure: never echo arbitrary output.
  const [stdout] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (await child.exited !== 0) throw new Error('Guarded operation failed on ' + target);
  return stdout.trim();
}
async function noActiveDeployment(): Promise<void> {
  const response = await api('/deployments/applications/' + APP + '?skip=0&take=50');
  const jobs = Array.isArray(response) ? response : response.deployments;
  if (!Array.isArray(jobs) || jobs.some((job: any) => ['queued', 'in_progress', 'pending'].includes(job.status))) {
    throw new Error('Wait for the active Prapor deployment before configuring its Git route');
  }
}
function fileWrite(path: string, contents: string, mode: string): string {
  const encoded = Buffer.from(contents.replace(/\r/g, '')).toString('base64');
  return [
    '(',
    "task_file=$(mktemp '" + path + ".XXXXXX')",
    "trap 'rm -f \"$task_file\"' EXIT",
    "printf '%s' '" + encoded + "' | base64 -d > \"$task_file\"",
    "chmod " + mode + ' "$task_file"',
    "mv \"$task_file\" '" + path + "'",
    ')',
  ].join('\n');
}
const ENV_KEYS = ['GIT_CONFIG_COUNT', ...Array.from({ length: 4 }, (_, i) => ['GIT_CONFIG_KEY_' + i, 'GIT_CONFIG_VALUE_' + i]).flat()];

async function check(): Promise<void> {
  const app = await api('/applications/' + APP);
  if (!app.settings?.is_auto_deploy_enabled || !app.settings?.use_build_secrets || !app.settings?.include_source_commit_in_build) {
    throw new Error('Required native auto-deploy/build-secret/source-commit settings missing');
  }
  const envs = await api('/applications/' + APP + '/envs');
  for (const key of ENV_KEYS) {
    for (const preview of [false, true]) {
      const matches = envs.filter((env: any) => env.key === key && Boolean(env.is_preview) === preview);
      if (matches.length !== 1 || !matches[0].is_buildtime || matches[0].is_runtime || matches[0].is_literal) {
        throw new Error('Git build environment metadata mismatch: ' + key);
      }
      if (['GIT_CONFIG_VALUE_0', 'GIT_CONFIG_VALUE_1'].includes(key) && !matches[0].is_shown_once) {
        throw new Error('Git proxy credential must be hidden');
      }
    }
  }
  await remote('management', String.raw`set -eu
systemctl is-enabled --quiet prapor-git-tunnel.service
systemctl is-active --quiet prapor-git-tunnel.service
`);
  await remote('origin', String.raw`set -eu
systemctl is-enabled --quiet prapor-git-proxy.service
systemctl is-active --quiet prapor-git-proxy.service
python3 - <<'PY'
import socket, subprocess
expected = {19643: {'127.0.0.1:19643'}, 19644: {'127.0.0.1:19644', '172.18.0.1:19644'}}
for port, addresses in expected.items():
    output = subprocess.check_output(['ss', '-ltnH', 'sport = :' + str(port)], text=True)
    if {line.split()[3] for line in output.splitlines()} != addresses:
        raise SystemExit('Unexpected listener binding')
PY
for repo in https://github.com/balkhaev/prapor.git https://github.com/balkhaev/prapor; do
 test "$(git config --global --get "http.$repo.proxy")" = http://127.0.0.1:19644
done
curl --fail --silent --show-error --max-time 20 --proxy http://127.0.0.1:19644 "https://github.com/balkhaev/prapor/info/refs?service=git-upload-pack" -o /dev/null
`);
  console.log('Native auto-deploy settings, private listeners and verified GitHub TLS: OK');
}

await noActiveDeployment();
const app = await api('/applications/' + APP);
if (app.build_pack !== 'dockercompose' || app.git_repository !== 'balkhaev/prapor' || app.git_branch !== 'main' ||
    app.source_type !== 'App\\Models\\GithubApp' || !app.settings?.is_raw_compose_deployment_enabled || app.settings?.is_preview_deployments_enabled) {
  throw new Error('Unexpected production application/source; refusing configuration');
}
if (mode === '--apply') {
  const envs = await api('/applications/' + APP + '/envs');
  const installed = await remote('origin', 'test ! -f /etc/systemd/system/prapor-git-proxy.service || head -n 1 /etc/systemd/system/prapor-git-proxy.service\n');
  if (installed && installed !== MARKER) throw new Error('Proxy unit belongs to another configuration');
  if (!installed && envs.some((env: any) => ENV_KEYS.includes(env.key))) {
    throw new Error('Existing Git configuration environment belongs to another setup');
  }
  if (!installed) {
    await remote('origin', "set -eu\ntest -z \"$(ss -ltnH 'sport = :19643')\"\ntest -z \"$(ss -ltnH 'sport = :19644')\"\n");
  }
  const proxy = await Bun.file(new URL('./proxy.py', import.meta.url)).text();
  const proxyUnit = await Bun.file(new URL('./prapor-git-proxy.service', import.meta.url)).text();
  const tunnelUnit = await Bun.file(new URL('./prapor-git-tunnel.service', import.meta.url)).text();
  const generated = randomBytes(32).toString('hex');
  // The secret remains in memory and the root-owned origin credential file/Coolify's hidden build variables.
  const secret = await remote('origin', [
    'set -eu', 'umask 077',
    'test "$(sshd -T | awk \'$1=="gatewayports" {print $2}\')" = no',
    'test "$(docker network inspect coolify --format \'{{(index .IPAM.Config 0).Gateway}}\')" = 172.18.0.1',
    'test -x /usr/bin/python3',
    'for repo in https://github.com/balkhaev/prapor.git https://github.com/balkhaev/prapor; do',
    ' previous=$(git config --global --get "http.$repo.proxy" || true)',
    ' case "$previous" in ""|http://127.0.0.1:19644) ;; *) exit 3 ;; esac', 'done',
    'for directory in /etc/prapor-git-egress /usr/local/lib/prapor-git-egress; do',
    ' test ! -L "$directory"',
    ' if [ -e "$directory" ]; then test -d "$directory"; test "$(stat -c %u "$directory")" = 0; fi', 'done',
    'test ! -L /etc/systemd/system/prapor-git-proxy.service',
    'install -d -m 700 /etc/prapor-git-egress',
    "python3 - <<'PY'",
    'import os, stat',
    "path = '/etc/prapor-git-egress/proxy_token'",
    'try:',
    ' descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)',
    'except FileExistsError:', ' pass',
    'else:',
    " with os.fdopen(descriptor, 'w') as output: output.write('" + generated + "')",
    'metadata = os.lstat(path)',
    'if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o600: raise SystemExit(3)',
    'PY',
    'install -d -m 755 /usr/local/lib/prapor-git-egress',
    fileWrite('/usr/local/lib/prapor-git-egress/proxy.py', proxy, '644'),
    fileWrite('/etc/systemd/system/prapor-git-proxy.service', MARKER + '\n' + proxyUnit, '644'),
    'systemd-analyze verify /etc/systemd/system/prapor-git-proxy.service >/dev/null 2>&1',
    'cat /etc/prapor-git-egress/proxy_token',
  ].join('\n'));
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Invalid origin proxy credential');
  await remote('management', [
    'set -eu', 'umask 077',
    'test -r /data/coolify/ssh/keys/ssh_key@iy9ziufgkgvawjlsyyidpote',
    'test -r /root/.ssh/known_hosts',
    'ssh-keygen -F 81.90.31.214 -f /root/.ssh/known_hosts >/dev/null',
    'test ! -e /etc/systemd/system/prapor-git-tunnel.service || grep -Fxq \'' + MARKER + '\' /etc/systemd/system/prapor-git-tunnel.service',
    'test ! -L /etc/systemd/system/prapor-git-tunnel.service',
    fileWrite('/etc/systemd/system/prapor-git-tunnel.service', MARKER + '\n' + tunnelUnit, '644'),
    'systemd-analyze verify /etc/systemd/system/prapor-git-tunnel.service >/dev/null 2>&1',
    'systemctl daemon-reload', 'systemctl enable prapor-git-tunnel.service', 'systemctl restart prapor-git-tunnel.service',
  ].join('\n'));
  await remote('origin', [
    'set -eu', 'systemctl daemon-reload', 'systemctl enable prapor-git-proxy.service', 'systemctl restart prapor-git-proxy.service',
    'for n in $(seq 1 20); do',
    ' if curl --fail --silent --max-time 5 --proxy http://127.0.0.1:19644 "https://github.com/balkhaev/prapor/info/refs?service=git-upload-pack" -o /dev/null; then break; fi',
    ' sleep 1', 'done',
    'curl --fail --silent --max-time 20 --proxy http://127.0.0.1:19644 "https://github.com/balkhaev/prapor/info/refs?service=git-upload-pack" -o /dev/null',
    'for repo in https://github.com/balkhaev/prapor.git https://github.com/balkhaev/prapor; do',
    ' git config --global "http.$repo.proxy" http://127.0.0.1:19644', 'done',
  ].join('\n'));
  const authenticated = HELPER_PROXY.replace('http://', 'http://prapor:' + secret + '@');
  const pairs = [
    ['GIT_CONFIG_COUNT', '4'],
    ['GIT_CONFIG_KEY_0', 'http.' + REPOS[0] + '.proxy'], ['GIT_CONFIG_VALUE_0', authenticated],
    ['GIT_CONFIG_KEY_1', 'http.' + REPOS[1] + '.proxy'], ['GIT_CONFIG_VALUE_1', authenticated],
    ['GIT_CONFIG_KEY_2', 'http.' + REPOS[0] + '.version'], ['GIT_CONFIG_VALUE_2', 'HTTP/1.1'],
    ['GIT_CONFIG_KEY_3', 'http.' + REPOS[1] + '.version'], ['GIT_CONFIG_VALUE_3', 'HTTP/1.1'],
  ];
  await noActiveDeployment();
  // Coolify auto-copies newly created production envs to preview without the hidden flag.
  // Pre-create the preview rows, hidden and build-only, so that hook never exposes a credential.
  for (const preview of [true, false]) {
    await api('/applications/' + APP + '/envs/bulk', 'PATCH', { data: pairs.map(([key, value]) => ({
      key, value, is_buildtime: true, is_runtime: false, is_preview: preview, is_literal: false,
      is_multiline: false, is_shown_once: ['GIT_CONFIG_VALUE_0', 'GIT_CONFIG_VALUE_1'].includes(key!),
    })) });
  }
  await api('/applications/' + APP, 'PATCH', {
    use_build_secrets: true, include_source_commit_in_build: true, is_auto_deploy_enabled: true,
  });
  console.log('Private Git egress installed; native push deployment remains enabled');
}
if (mode === '--test-recovery') {
  // Deliberately fail only this channel's process; systemd must bring it back without a start command.
  await remote('management', [
    'set -eu',
    'systemctl is-active --quiet prapor-git-tunnel.service',
    'before=$(systemctl show prapor-git-tunnel.service -p NRestarts --value)',
    'systemctl kill --kill-whom=main --signal=SIGKILL prapor-git-tunnel.service',
    'for n in $(seq 1 20); do',
    ' current=$(systemctl show prapor-git-tunnel.service -p NRestarts --value)',
    ' if [ "$current" -gt "$before" ] && systemctl is-active --quiet prapor-git-tunnel.service; then exit 0; fi',
    ' sleep 1', 'done', 'exit 4',
  ].join('\n'));
  await remote('origin', [
    'set -eu',
    'systemctl is-active --quiet prapor-git-proxy.service',
    'before=$(systemctl show prapor-git-proxy.service -p NRestarts --value)',
    'systemctl kill --kill-whom=main --signal=SIGKILL prapor-git-proxy.service',
    'for n in $(seq 1 20); do',
    ' current=$(systemctl show prapor-git-proxy.service -p NRestarts --value)',
    ' if [ "$current" -gt "$before" ] && systemctl is-active --quiet prapor-git-proxy.service; then break; fi',
    ' sleep 1', 'done',
    'test "$(systemctl show prapor-git-proxy.service -p NRestarts --value)" -gt "$before"',
    'for n in $(seq 1 20); do',
    ' if curl --fail --silent --max-time 5 --proxy http://127.0.0.1:19644 "https://github.com/balkhaev/prapor/info/refs?service=git-upload-pack" -o /dev/null; then exit 0; fi',
    ' sleep 1', 'done', 'exit 5',
  ].join('\n'));
  console.log('Automatic recovery of both Git egress services after process failure: OK');
}
await check();

