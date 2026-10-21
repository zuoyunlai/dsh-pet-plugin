# =============================================================================
#  dsh-pet installer  (DeepSeek Harness local bundle)
#
#  Normal use: double-click install.cmd next to this file.
#  Manual use:
#     powershell -NoProfile -ExecutionPolicy Bypass -File "<this file>"
#     ... -Update      refresh the installed files only (safe while DSH runs)
#     ... -Verify      report install status
#     ... -Uninstall   remove the plugin
#
#  What it does:
#    1. adds "@local/dsh-pet": "file:<this folder>" to the profile dependencies
#    2. adds "@local/dsh-pet" to dsh.profile.bundles
#    3. runs pnpm install in the profile so node_modules really owns the package
#
#  Step 1+3 matter: the desktop host reconciles the profile with pnpm, and a
#  package that only sits in node_modules (without being a declared dependency)
#  gets pruned. Declaring it as a file: dependency makes it survive.
#
#  DSH must be closed for install/uninstall: the profile package.json is
#  watched by HMR.
# =============================================================================
[CmdletBinding()]
param(
  [switch]$Uninstall,
  [switch]$Verify,
  [switch]$Update,
  [switch]$Force,
  [string]$ProfileName = 'desktop',
  # test hook: throwaway profile dir, also skips the "is DSH running" check
  [string]$ProfileDir = ''
)

$ErrorActionPreference = 'Stop'

$src = $PSScriptRoot
# read the name from package.json so renaming the package never breaks the installer
$meta   = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $src 'package.json') | ConvertFrom-Json
$pkg    = $meta.name
$isTest = [bool]$ProfileDir
if ($isTest) {
  $profileDir = $ProfileDir
} else {
  $profileDir = Join-Path (Join-Path $env:USERPROFILE '.dsh\profiles') $ProfileName
}
$pkgJson   = Join-Path $profileDir 'package.json'
$dest   = Join-Path $profileDir ("node_modules\" + ($pkg -replace '/', '\'))
$destDir = Split-Path -Parent $dest
# legacy install dir (before the rename): migrated on install
$legacyDir  = Join-Path $profileDir 'node_modules\@local\dsh-pet'
$legacyPkg  = '@local/dsh-pet'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$fileSpec  = 'file:' + ($src -replace '\\', '/')

Write-Host "plugin source : $src"
Write-Host "profile       : $profileDir"
Write-Host ''

foreach ($f in @('package.json', 'client.js', 'cordis.patch.yml', 'index.js')) {
  if (-not (Test-Path -LiteralPath (Join-Path $src $f))) {
    throw "Not a dsh-pet bundle folder: missing $f (looked in $src)"
  }
}

function Test-Json([string]$text) {
  try { [void]($text | ConvertFrom-Json); return $true } catch { return $false }
}

# ---------- update: refresh files only, profile untouched, safe while DSH runs ----
if ($Update) {
  if (-not (Test-Path -LiteralPath (Join-Path $dest 'client.js'))) {
    if (Test-Path -LiteralPath (Join-Path $legacyDir 'client.js')) {
      Write-Host "[i] updating the pre-rename install at $legacyDir" -ForegroundColor Yellow
      $dest = $legacyDir
      $destDir = Split-Path -Parent $dest
    } else {
      Write-Host "Not installed at $dest - run install.cmd first." -ForegroundColor Yellow
      exit 2
    }
  }
  $resolved = (Resolve-Path -LiteralPath $dest).Path
  if ($resolved -eq $src) {
    Write-Host "[ok] installed copy IS this folder (file: dependency) - nothing to copy"
  } else {
    Copy-Item -LiteralPath $src -Destination $destDir -Recurse -Force
    Write-Host "[ok] refreshed $dest"
  }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    & node --check (Join-Path $dest 'client.js')
    if ($LASTEXITCODE -ne 0) { throw 'Updated client.js does not parse.' }
  }
  Write-Host ''
  Write-Host 'Reload the DSH window (Ctrl+R). If the change does not show up, restart DSH.' -ForegroundColor Green
  exit 0
}

if (-not (Test-Path -LiteralPath $pkgJson)) {
  throw "No profile package.json at $pkgJson"
}

$raw       = [IO.File]::ReadAllText($pkgJson)
$hasEntry  = $raw -match [regex]::Escape('"' + $pkg + '"')
$installed = Test-Path -LiteralPath (Join-Path $dest 'client.js')

if ($Verify) {
  Write-Host "copied into node_modules      : $installed"
  Write-Host "listed in dsh.profile.bundles : $hasEntry"
  Write-Host "package.json parses           : $(Test-Json $raw)"
  if ($installed -and $hasEntry -and (Test-Json $raw)) {
    Write-Host ''
    if (Test-Path (Join-Path $profileDir ("node_modules\\" + $pkg + "\\package.json"))) {
      Write-Host "declared as dependency        : yes ($fileSpec)" -ForegroundColor Green
    } else {
      Write-Host "declared as dependency        : unknown" -ForegroundColor Yellow
    }
    Write-Host 'OK. If the pet is missing after a restart, open DevTools (Ctrl+Shift+I)' -ForegroundColor Green
    Write-Host 'and look for "[dsh-pet]" or "slot entry crashed" in the console.' -ForegroundColor Green
    exit 0
  }
  Write-Host ''
  Write-Host 'Not fully installed. Close DSH and run install.cmd.' -ForegroundColor Yellow
  exit 2
}

$running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like '*DeepSeek*Harness*' })
if (-not $isTest -and $running.Count -gt 0 -and -not $Force) {
  Write-Host 'DSH is running. Close it completely, then run this again.' -ForegroundColor Yellow
  Write-Host 'Reason: the profile package.json is watched by HMR; writing it during a live' -ForegroundColor Yellow
  Write-Host 'session can abort the running turn. Add -Force only if you accept that.' -ForegroundColor Yellow
  exit 2
}

# ---------- uninstall ----------
if ($Uninstall) {
  $backup = "$pkgJson.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
  Copy-Item -LiteralPath $pkgJson -Destination $backup -Force
  # dependency entry first: "pkg": "file:...",   (keeps the array edits below simple)
  $next = $raw -replace ('\s*' + [regex]::Escape('"' + $pkg + '"') + '\s*:\s*"file:[^"]*"\s*,?'), ''
  $next = $next -replace ([regex]::Escape('"' + $pkg + '",') + '\s*'), ''
  $next = $next -replace (',\s*' + [regex]::Escape('"' + $pkg + '"')), ''
  if (-not (Test-Json $next)) {
    throw 'Refusing to write: the edited package.json would not parse. Nothing changed.'
  }
  [IO.File]::WriteAllText($pkgJson, $next, $utf8NoBom)
  Write-Host "[ok] removed $pkg from the profile (backup: $backup)"
  if (-not $isTest) {
    & pnpm install --dir $profileDir --prefer-offline
    Write-Host "[ok] pnpm install finished (exit $LASTEXITCODE)"
  }
  Write-Host ''
  Write-Host 'Done. Restart DSH to finish.'
  exit 0
}

# ---------- install ----------
$backup = "$pkgJson.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
Copy-Item -LiteralPath $pkgJson -Destination $backup -Force
Write-Host "[ok] profile backed up: $backup"

$next = $raw
# migration: drop the pre-rename package entry (dependency + bundles rows)
if ($legacyPkg -ne $pkg -and $next -match [regex]::Escape('"' + $legacyPkg + '"')) {
  $next = $next -replace ('\s*' + [regex]::Escape('"' + $legacyPkg + '"') + '\s*:\s*"file:[^"]*"\s*,?'), ''
  $next = $next -replace ([regex]::Escape('"' + $legacyPkg + '",') + '\s*'), ''
  $next = $next -replace (',\s*' + [regex]::Escape('"' + $legacyPkg + '"')), ''
  Write-Host "[ok] removed legacy entry $legacyPkg"
}
if ($next -notmatch '"bundles"\s*:\s*\[') {
  throw 'No "bundles" array in the profile package.json. Add this line by hand: ' + $pkg
}
if ($next -notmatch [regex]::Escape('"' + $pkg + '"')) {
  $next = $next -replace '("bundles"\s*:\s*\[)', ('$1' + "`r`n        `"$pkg`",")
  Write-Host "[ok] added $pkg to dsh.profile.bundles"
}
if ($next -notmatch [regex]::Escape($fileSpec)) {
  if ($next -notmatch '"dependencies"\s*:\s*\{') {
    throw 'No "dependencies" object in the profile package.json.'
  }
  $dep = '$1' + "`r`n    `"$pkg`": `"$fileSpec`","
  $next = $next -replace '("dependencies"\s*:\s*\{)', $dep
  Write-Host "[ok] declared dependency: $pkg -> $fileSpec"
}
if (-not (Test-Json $next)) {
  throw 'Refusing to write: the edited package.json would not parse. Nothing changed.'
}
[IO.File]::WriteAllText($pkgJson, $next, $utf8NoBom)

# materialize through pnpm so the package survives the host's own reconcile
$pnpmOk = $true
if (-not $isTest) {
  # a stray hand-copied folder here would confuse pnpm; drop it first
  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
  if (Test-Path -LiteralPath $legacyDir) { Remove-Item -LiteralPath $legacyDir -Recurse -Force; Write-Host '[ok] removed legacy folder' }
  & pnpm install --dir $profileDir --prefer-offline
  $pnpmOk = ($LASTEXITCODE -eq 0)
  Write-Host "[ok] pnpm install finished (exit $LASTEXITCODE)"
  if (-not $pnpmOk) {
    Copy-Item -LiteralPath $backup -Destination $pkgJson -Force
    throw 'pnpm install failed; profile package.json restored. Nothing else was changed.'
  }
} else {
  # test mode: no dependency graph to resolve, just place the files
  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  Copy-Item -LiteralPath $src -Destination $destDir -Recurse -Force
  Write-Host "[ok] test mode: copied plugin to $dest"
}

# ---------- post-check ----------
$okCopy  = Test-Path -LiteralPath (Join-Path $dest 'client.js')
$after   = [IO.File]::ReadAllText($pkgJson)
$okJson  = Test-Json $after
$okEntry = $after -match [regex]::Escape('"' + $pkg + '"')
if (-not ($okCopy -and $okJson -and $okEntry)) {
  throw "Post-check failed (copy=$okCopy json=$okJson entry=$okEntry). Restore $backup and report this."
}
Write-Host "[ok] post-check: files, bundles entry and JSON all good"

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  & node --check (Join-Path $dest 'client.js')
  if ($LASTEXITCODE -ne 0) { throw 'Installed client.js does not parse.' }
  Write-Host '[ok] installed client.js parses'
}

Write-Host ''
Write-Host 'Installed. Start DSH again.' -ForegroundColor Green
Write-Host 'If the pet misbehaves: DevTools (Ctrl+Shift+I) -> console lines starting with' -ForegroundColor Green
Write-Host '"[dsh-pet]" tell you exactly where it got stuck.' -ForegroundColor Green
exit 0
