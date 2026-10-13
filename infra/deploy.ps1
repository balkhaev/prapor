[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string] $Commit,
    [string] $Project = 'F:/code/prapor',
    [string] $ResendKeyFile = 'F:/AI/prapor/resend_api_key',
    [string] $GoogleSecretFile = 'F:/AI/prapor/google_client_secret',
    [switch] $ValidateOnly
)

$ErrorActionPreference = 'Stop'
$managementTarget = 'root@deploy.balkhaev.com'
$originTarget = 'root@81.90.31.214'
$originKey = '/data/coolify/ssh/keys/ssh_key@iy9ziufgkgvawjlsyyidpote'
$sshOptions = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15')
$projectPath = (Resolve-Path -LiteralPath $Project).Path
$scratchBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$releaseId = 'prapor-release-' + $Commit.Substring(0, 12) + '-' + [Guid]::NewGuid().ToString('N')
$scratchPath = Join-Path $scratchBase $releaseId
$remoteScratch = '/tmp/' + $releaseId
$remoteStarted = $false
$secretSource = $null
$secretHash = $null
$googleSecretSource = $null
$googleSecretHash = $null

function Get-GitText([string[]] $Arguments) {
    $output = & git -C $projectPath @Arguments
    if ($LASTEXITCODE -ne 0) { throw ('Git failed: ' + ($Arguments -join ' ')) }
    return ($output -join "`n").Trim()
}

function Invoke-Management([string] $Script) {
    # Send scripts as data, avoiding PowerShell/native-shell quote conversion.
    $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($Script -replace "`r", '') + "`n"))
    $payload | & ssh @sshOptions $managementTarget 'base64 --decode --ignore-garbage | sh'
    if ($LASTEXITCODE -ne 0) { throw "Management server operation failed ($LASTEXITCODE)" }
}

function Invoke-Origin([string] $Script) {
    $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($Script -replace "`r", '') + "`n"))
    Invoke-Management "printf '%s' '$payload' | base64 --decode | ssh -i '$originKey' -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 '$originTarget' 'sh -s'"
}

function Copy-ToManagement([string] $LocalPath, [string] $RemotePath) {
    & scp @sshOptions $LocalPath "${managementTarget}:$RemotePath"
    if ($LASTEXITCODE -ne 0) { throw "Upload failed ($LASTEXITCODE)" }
}

function Ensure-RuntimeSecret([string] $Name, [string] $LocalFile, [string] $Checksum) {
    if ($Name -notin @('resend_api_key', 'google_client_secret')) { throw 'Unsupported runtime secret.' }
    if ($LocalFile) {
        # Secrets are siblings of the source export, never build-context inputs.
        Copy-ToManagement $LocalFile "$remoteScratch/$Name"
        Invoke-Management "set -eu`nchmod 600 '$remoteScratch/$Name'`ntest `"`$(sha256sum '$remoteScratch/$Name' | awk '{print `$1}')`" = '$Checksum'`nscp -i '$originKey' -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 '$remoteScratch/$Name' '${originTarget}:$remoteScratch/$Name'"
        $secretScript = @'
set -eu
scratch='__SCRATCH__'
secret=/data/prapor/secrets/__NAME__
test ! -L /data/prapor/secrets
test ! -L "$secret"
test ! -e "$secret" || test -f "$secret"
chmod 600 "$scratch/__NAME__"
test "$(sha256sum "$scratch/__NAME__" | awk '{print $1}')" = '__HASH__'
install -d -m 700 /data/prapor/secrets
chown 0:0 /data/prapor/secrets
if test ! -f "$secret" || ! cmp -s "$scratch/__NAME__" "$secret"; then
    test ! -e "$secret.next"
    install -m 400 "$scratch/__NAME__" "$secret.next"
    chown 1000:1000 "$secret.next"
    mv "$secret.next" "$secret"
fi
chown 1000:1000 "$secret"
chmod 400 "$secret"
test -s "$secret"
test "$(stat -c '%a:%u:%g' "$secret")" = '400:1000:1000'
test "$(sha256sum "$secret" | awk '{print $1}')" = '__HASH__'
'@
        Invoke-Origin ($secretScript.Replace('__SCRATCH__', $remoteScratch).Replace('__HASH__', $Checksum).Replace('__NAME__', $Name))
    } else {
        # With no local file, preserve the existing provisioned value verbatim.
        $existingSecretScript = @'
set -eu
secret=/data/prapor/secrets/__NAME__
test ! -L /data/prapor/secrets
test ! -L "$secret"
test -f "$secret" && test -s "$secret"
test "$(stat -c '%a:%u:%g' "$secret")" = '400:1000:1000'
test "$(stat -c '%a:%u:%g' /data/prapor/secrets)" = '700:0:0'
'@
        Invoke-Origin ($existingSecretScript.Replace('__NAME__', $Name))
    }
}

try {
    if ((Get-GitText @('branch', '--show-current')) -ne 'main') { throw 'Release requires canonical main.' }
    if ((Get-GitText @('rev-parse', 'HEAD')) -ne $Commit) { throw 'Release commit must be canonical HEAD.' }
    if (Get-GitText @('status', '--porcelain', '--untracked-files=normal')) { throw 'Save and integrate repository changes before releasing.' }
    $canonicalRoot = (Get-GitText @('rev-parse', '--show-toplevel')) -replace '\\', '/'
    if ($canonicalRoot -ne ($projectPath -replace '\\', '/')) { throw 'Project must be the repository root.' }
    $policy = Get-Content -LiteralPath (Join-Path $projectPath '.devhub/worktree.json') -Raw | ConvertFrom-Json
    if ($policy.releaseBranch -ne 'main') { throw 'Unexpected release branch in project policy.' }

    if ($ResendKeyFile -and (Test-Path -LiteralPath $ResendKeyFile -PathType Leaf)) {
        $secretSource = (Resolve-Path -LiteralPath $ResendKeyFile).Path
        $secretItem = Get-Item -LiteralPath $secretSource
        $projectPrefix = $projectPath.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        if ($secretSource.StartsWith($projectPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Resend key must live outside the Git checkout.' }
        if (($secretItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $secretItem.Length -lt 1 -or $secretItem.Length -gt 1024) { throw 'Resend key must be a small regular protected file.' }
        $secretHash = (Get-FileHash -LiteralPath $secretSource -Algorithm SHA256).Hash.ToLowerInvariant()
    } elseif ($PSBoundParameters.ContainsKey('ResendKeyFile') -and $ResendKeyFile) {
        throw 'Explicit Resend key file is missing.'
    }

    if ($GoogleSecretFile -and (Test-Path -LiteralPath $GoogleSecretFile -PathType Leaf)) {
        $googleSecretSource = (Resolve-Path -LiteralPath $GoogleSecretFile).Path
        $googleSecretItem = Get-Item -LiteralPath $googleSecretSource
        $projectPrefix = $projectPath.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        if ($googleSecretSource.StartsWith($projectPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Google client secret must live outside the Git checkout.' }
        if (($googleSecretItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $googleSecretItem.Length -lt 1 -or $googleSecretItem.Length -gt 1024) { throw 'Google client secret must be a small regular protected file.' }
        $googleSecretHash = (Get-FileHash -LiteralPath $googleSecretSource -Algorithm SHA256).Hash.ToLowerInvariant()
    } elseif ($PSBoundParameters.ContainsKey('GoogleSecretFile') -and $GoogleSecretFile) {
        throw 'Explicit Google client secret file is missing.'
    }

    New-Item -ItemType Directory -Path $scratchPath | Out-Null
    $archivePath = Join-Path $scratchPath 'source.tar'
    # Export only tracked build inputs and these infrastructure files. Private
    # env files, Git metadata, editor settings and dependencies never transfer.
    $inputs = @('Dockerfile', '.dockerignore', 'package.json', 'bun.lock', 'tsconfig.json', 'vite.config.ts', 'index.html', 'characters.html', 'src', 'public', 'server.ts', 'server', 'infra')
    & git -C $projectPath archive --format=tar "--output=$archivePath" $Commit @inputs
    if ($LASTEXITCODE -ne 0) { throw 'Checked source export failed.' }
    $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $releaseEnv = "# Managed by prapor infra/deploy.ps1.`nPRAPOR_IMAGE=prapor-game:$Commit`nPRAPOR_COMMIT=$Commit`n"
    $releaseEnvPath = Join-Path $scratchPath 'release.env'
    [IO.File]::WriteAllText($releaseEnvPath, $releaseEnv, [Text.UTF8Encoding]::new($false))
    $infraPath = Join-Path $projectPath 'infra'
    & docker compose --env-file $releaseEnvPath -f (Join-Path $infraPath 'production.compose.yaml') config -q
    if ($LASTEXITCODE -ne 0) { throw 'Production Compose validation failed.' }
    & docker compose -f (Join-Path $infraPath 'mirror.compose.yaml') config -q
    if ($LASTEXITCODE -ne 0) { throw 'Mirror Compose validation failed.' }
    $fromLines = Get-Content -LiteralPath (Join-Path $projectPath 'Dockerfile') | Where-Object { $_ -match '^FROM\s' }
    foreach ($line in $fromLines) {
        if ($line -notmatch '@sha256:[a-f0-9]{64}(\s|$)') { throw 'Pin every Dockerfile base image by digest before release.' }
    }
    if ($ValidateOnly) {
        Write-Output "Release inputs and Compose files validated for $Commit. No server changes."
        return
    }

    Invoke-Management @'
set -eu
test "$(getent ahostsv4 game.delopusk.ru | head -1 | awk '{print $1}')" = '81.90.31.214'
test "$(getent ahostsv4 game.balkhaev.com | head -1 | awk '{print $1}')" = '49.13.216.63'
test "$(docker inspect coolify-proxy --format '{{(index .NetworkSettings.Networks "coolify").IPAddress}}')" = '10.0.1.7'
docker network inspect coolify >/dev/null
'@
    Invoke-Origin @'
set -eu
docker network inspect coolify >/dev/null
test "$(docker inspect coolify-proxy --format '{{(index .NetworkSettings.Networks "coolify").IPAddress}}')" = '172.18.0.2'
if docker inspect prapor-game >/dev/null 2>&1; then
    test "$(docker inspect prapor-game --format '{{index .Config.Labels "com.docker.compose.project"}}')" = 'prapor-production'
fi
test ! -e /data/prapor/compose.yaml || grep -Fq 'Managed by prapor infra/deploy.ps1.' /data/prapor/compose.yaml
test ! -e /data/prapor/release.env || grep -Fq 'Managed by prapor infra/deploy.ps1.' /data/prapor/release.env
'@
    Invoke-Management "set -eu`nmkdir -m 700 '$remoteScratch'"
    $remoteStarted = $true
    Copy-ToManagement $archivePath "$remoteScratch/source.tar"
    Copy-ToManagement $releaseEnvPath "$remoteScratch/release.env"
    Invoke-Management "set -eu`ntest `"`$(sha256sum '$remoteScratch/source.tar' | awk '{print `$1}')`" = '$archiveHash'`nssh -i '$originKey' -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 '$originTarget' 'mkdir -m 700 $remoteScratch'`nscp -i '$originKey' -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 '$remoteScratch/source.tar' '$remoteScratch/release.env' '${originTarget}:$remoteScratch/'"
    Ensure-RuntimeSecret 'resend_api_key' $secretSource $secretHash
    Ensure-RuntimeSecret 'google_client_secret' $googleSecretSource $googleSecretHash

    $originScript = @'
set -eu
scratch='__SCRATCH__'
commit='__COMMIT__'
case "$scratch" in /tmp/prapor-release-*) ;; *) exit 1 ;; esac
test "$(sha256sum "$scratch/source.tar" | awk '{print $1}')" = '__HASH__'
mkdir "$scratch/source"
tar -xf "$scratch/source.tar" -C "$scratch/source"
docker compose --env-file "$scratch/release.env" -f "$scratch/source/infra/production.compose.yaml" config -q
docker build --label "org.opencontainers.image.revision=$commit" --tag "prapor-game:$commit" "$scratch/source"
test "$(docker inspect "prapor-game:$commit" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$commit"
smoke="${scratch##*/}-smoke"
trap 'docker rm -f "$smoke" >/dev/null 2>&1 || true' EXIT
signature=''
for mode in absent inherited configured; do
    if test "$mode" = configured; then
        docker run --rm -d --name "$smoke" --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /app/data:uid=1000,gid=1000,mode=0700 --tmpfs /tmp:uid=1000,gid=1000,mode=1770 --mount type=bind,src=/data/prapor/secrets/resend_api_key,dst=/run/secrets/resend_api_key,readonly --mount type=bind,src=/data/prapor/secrets/google_client_secret,dst=/run/secrets/google_client_secret,readonly -e RESEND_API_KEY_FILE=/run/secrets/resend_api_key -e 'RESEND_FROM=ggpick <noreply@ggpick.club>' -e PUBLIC_BASE_URL=https://game.balkhaev.com -e GOOGLE_CLIENT_ID=764541788875-0bj0prqnptqop4u5b2v5qgf2i4ut7t26.apps.googleusercontent.com -e GOOGLE_CLIENT_SECRET_FILE=/run/secrets/google_client_secret -e GOOGLE_REDIRECT_URIS=https://game.delopusk.ru/callback/auth/google,https://game.balkhaev.com/callback/auth/google "prapor-game:$commit" >/dev/null
    elif test "$mode" = inherited; then
        docker run --rm -d --name "$smoke" --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /app/data:uid=1000,gid=1000,mode=0700 --tmpfs /tmp:uid=1000,gid=1000,mode=1770 -e NODE_ENV=production -e DEVHUB_ORIGIN=http://evil.invalid -e DEVHUB_ROOT=/missing -e DEVHUB_PORT=1 -e DEVHUB_EMBEDDED=true "prapor-game:$commit" >/dev/null
    else
        docker run --rm -d --name "$smoke" --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /app/data:uid=1000,gid=1000,mode=0700 --tmpfs /tmp:uid=1000,gid=1000,mode=1770 "prapor-game:$commit" >/dev/null
    fi
    sleep 2
    current=$(docker exec "$smoke" bun -e '
const health = await fetch("http://127.0.0.1:3000/health");
if (health.status !== 200 || (await health.json()).ok !== true) throw new Error("Health failed");
const page = await fetch("http://127.0.0.1:3000/");
const text = await page.text();
if (page.status !== 200 || !text.includes("/assets/")) throw new Error("Built page failed");
const names=["content-security-policy","x-frame-options","x-content-type-options","referrer-policy","cache-control","cross-origin-resource-policy"];
if (page.headers.get("x-frame-options") !== "DENY" || !page.headers.get("content-security-policy")?.includes("frame-ancestors")) throw new Error("Security headers failed");
console.log(Bun.hash(JSON.stringify(names.map(name=>[name,health.headers.get(name),page.headers.get(name)]))).toString());
')
    if test "$mode" = absent; then signature="$current"; else test "$signature" = "$current"; fi
    if test "$mode" = configured; then
        docker exec "$smoke" bun -e '
const session = await fetch("http://127.0.0.1:3000/api/auth/session", {headers:{Host:"game.delopusk.ru"}});
if (session.status !== 200 || (await session.json()).googleEnabled !== true) throw new Error("Google OAuth configuration failed");
for (const origin of ["https://game.delopusk.ru", "https://game.balkhaev.com"]) {
    const response = await fetch("http://127.0.0.1:3000/api/auth/google", {method:"POST", headers:{Origin:origin,"Content-Type":"application/json",Host:new URL(origin).host}, body:JSON.stringify({intent:"login"})});
    if (response.status !== 200 || !response.headers.get("set-cookie")) throw new Error("Google OAuth start failed");
    const url = new URL((await response.json()).url);
    if (url.origin !== "https://accounts.google.com" || url.searchParams.get("redirect_uri") !== `${origin}/callback/auth/google`) throw new Error("Google OAuth callback origin failed");
}
'
    fi
    docker stop -t 5 "$smoke" >/dev/null
done
printf '%s\n' 'Standalone artifact smoke passed without/with DEVHUB variables and with runtime email/Google secrets.'
app_uid=$(docker run --rm --entrypoint id "prapor-game:$commit" -u)
app_gid=$(docker run --rm --entrypoint id "prapor-game:$commit" -g)
test "$app_uid:$app_gid" = '1000:1000'
install -d -m 755 /data/prapor
install -d -m 700 /data/prapor/data
chown "$app_uid:$app_gid" /data/prapor/data
install -m 644 "$scratch/source/infra/production.compose.yaml" /data/prapor/compose.yaml.next
install -m 600 "$scratch/release.env" /data/prapor/release.env.next
mv /data/prapor/compose.yaml.next /data/prapor/compose.yaml
mv /data/prapor/release.env.next /data/prapor/release.env
docker compose --env-file /data/prapor/release.env -f /data/prapor/compose.yaml up -d --wait --wait-timeout 90
test "$(docker inspect prapor-game --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$commit"
'@
    Invoke-Origin ($originScript.Replace('__SCRATCH__', $remoteScratch).Replace('__COMMIT__', $Commit).Replace('__HASH__', $archiveHash))
    Invoke-Management @'
set -eu
ready=0
for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error --max-time 10 --output /dev/null https://game.delopusk.ru/health 2>/dev/null; then ready=1; break; fi
    sleep 3
done
test "$ready" = 1 || { curl --fail --silent --show-error --max-time 10 --output /dev/null https://game.delopusk.ru/health; exit 1; }
'@

    $mirrorScript = @'
set -eu
scratch='__SCRATCH__'
image='nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236'
if docker inspect prapor-game-mirror >/dev/null 2>&1; then
    test "$(docker inspect prapor-game-mirror --format '{{index .Config.Labels "com.docker.compose.project"}}')" = 'prapor-game-mirror'
fi
test ! -e /data/prapor/mirror/compose.yaml || grep -Fq 'Managed by prapor infra/deploy.ps1.' /data/prapor/mirror/compose.yaml
test ! -e /data/prapor/mirror/nginx.conf || grep -Fq 'Managed by prapor infra/deploy.ps1.' /data/prapor/mirror/nginx.conf
test ! -e /data/coolify/proxy/dynamic/prapor-game-mirror.yaml || grep -Fq 'Managed by prapor infra/deploy.ps1.' /data/coolify/proxy/dynamic/prapor-game-mirror.yaml
mkdir "$scratch/mirror"
tar -xf "$scratch/source.tar" -C "$scratch/mirror" infra/mirror.compose.yaml infra/mirror.nginx.conf infra/mirror.edge.yaml
docker pull "$image"
docker run --rm --user 101:101 --read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp:uid=101,gid=101,mode=1770 --entrypoint nginx -v "$scratch/mirror/infra/mirror.nginx.conf:/etc/nginx/nginx.conf:ro" "$image" -t
docker compose -f "$scratch/mirror/infra/mirror.compose.yaml" config -q
install -d -m 755 /data/prapor/mirror
install -m 644 "$scratch/mirror/infra/mirror.nginx.conf" /data/prapor/mirror/nginx.conf.next
install -m 644 "$scratch/mirror/infra/mirror.compose.yaml" /data/prapor/mirror/compose.yaml.next
mv /data/prapor/mirror/nginx.conf.next /data/prapor/mirror/nginx.conf
mv /data/prapor/mirror/compose.yaml.next /data/prapor/mirror/compose.yaml
docker compose -f /data/prapor/mirror/compose.yaml up -d --wait --wait-timeout 90
install -m 644 "$scratch/mirror/infra/mirror.edge.yaml" /data/coolify/proxy/dynamic/prapor-game-mirror.yaml.next
mv /data/coolify/proxy/dynamic/prapor-game-mirror.yaml.next /data/coolify/proxy/dynamic/prapor-game-mirror.yaml
ready=0
for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error --max-time 10 --output /dev/null https://game.balkhaev.com/health 2>/dev/null; then ready=1; break; fi
    sleep 3
done
test "$ready" = 1 || { curl --fail --silent --show-error --max-time 10 --output /dev/null https://game.balkhaev.com/health; exit 1; }
'@
    Invoke-Management ($mirrorScript.Replace('__SCRATCH__', $remoteScratch))
    Write-Output "Published ${Commit}: https://game.delopusk.ru and https://game.balkhaev.com. Verify account and save flows on both domains."
} finally {
    if ($remoteStarted) {
        try {
            Invoke-Origin "set -eu`ncase '$remoteScratch' in /tmp/prapor-release-*) rm -rf -- '$remoteScratch' ;; *) exit 1 ;; esac"
            Invoke-Management "set -eu`ncase '$remoteScratch' in /tmp/prapor-release-*) rm -rf -- '$remoteScratch' ;; *) exit 1 ;; esac"
        } catch {
            Write-Warning "Release scratch cleanup failed: $remoteScratch. $($_.Exception.Message)"
        }
    }
    if (Test-Path -LiteralPath $scratchPath) {
        $resolvedScratch = [IO.Path]::GetFullPath($scratchPath)
        $expectedPrefix = $scratchBase.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        if (-not $resolvedScratch.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolvedScratch -Leaf) -notlike 'prapor-release-*') { throw 'Unsafe scratch cleanup path.' }
        Remove-Item -LiteralPath $resolvedScratch -Recurse -Force
    }
}
