<#
.SYNOPSIS
  Builds AXISNotes at a new version and publishes it to the updates folder (T-066, T-282).

.DESCRIPTION
  1. Refuses unless the working tree is clean (untracked files are ignored), the branch is
     main, the tag vX.Y.Z doesn't exist yet and the signing key matches the public key built
     into the app (src-tauri/src/updates.rs).
  2. Runs pnpm lint, pnpm typecheck and the tests (Vitest on half the cores, a failed test
     retried once, so load on a busy machine doesn't stop a release; -SkipChecks skips them in an emergency;
     the skip is written to the tag and to publish-log.txt in the updates folder).
  3. Sets the version in package.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml,
     and builds the Windows installer (NSIS .exe).
  4. Authenticode-signs the installer with signtool when -CertThumbprint is given.
  5. Copies it into the updates folder and writes latest.json (version, notes, SHA-256) and
     latest.json.sig, an Ed25519 signature of latest.json's exact bytes.
  6. Commits the version change as "Release X.Y.Z: version bump" and creates the annotated
     tag vX.Y.Z on it. Nothing is pushed.
  7. Keeps the -Keep newest installers in the updates folder (10 by default) and deletes
     older ones.

  Every AXISNotes that checks that folder then offers the update. Only a manifest whose
  signature checks out is installed automatically; anything else is offered for a manual
  install, marked as not verified.

  The private signing key lives outside the repository, by default in
  %APPDATA%\AXISNotes\update-signing.key, readable only by you. Back it up offline: without
  it, installed apps never again verify an update automatically.

.EXAMPLE
  powershell -File scripts/publish-update.ps1 -Version 0.2.1 -Notes "Fixes the tag pane"

.EXAMPLE
  powershell -File scripts/publish-update.ps1 -Version 0.3.0 -Folder "\\nas\AXISNotes Updates"

.EXAMPLE
  powershell -File scripts/publish-update.ps1 -Version 0.3.112 -DryRun
  Checks everything that would stop a publish, and changes nothing.

.EXAMPLE
  powershell -File scripts/publish-update.ps1 -NewKey
  Creates the signing key pair once and prints the public key to put in updates.rs.
#>
param(
  [string]$Version = "",
  [string]$Notes = "",
  [string]$Folder = (Join-Path $env:USERPROFILE "AXISNotes Updates"),
  # Publish the installer already built for -Version instead of building again. The version
  # change must already be committed; only the tag is created.
  [switch]$SkipBuild,
  # Skip lint, typecheck and tests. For emergencies only; the skip is logged.
  [switch]$SkipChecks,
  # Check what would stop a publish, print the plan and change nothing.
  [switch]$DryRun,
  # Create a new signing key pair at -KeyPath and print its public key, then stop.
  [switch]$NewKey,
  [string]$KeyPath = (Join-Path $env:APPDATA "AXISNotes\update-signing.key"),
  # How many installers to keep in the updates folder, newest first.
  [ValidateRange(1, 1000)][int]$Keep = 10,
  # Authenticode certificate (SHA-1 thumbprint, in your certificate store) for signtool.
  [string]$CertThumbprint = "",
  [string]$TimestampUrl = "http://timestamp.digicert.com",
  # Extra lines for the release commit message, e.g. a Co-Authored-By trailer.
  [string]$CommitTrailer = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$signer = Join-Path $PSScriptRoot "update-signing.mjs"
$utf8 = New-Object System.Text.UTF8Encoding($false)  # no BOM
$versionFiles = @("package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock")

function Invoke-Signer([string[]]$arguments) {
  $out = & node $signer @arguments
  if ($LASTEXITCODE -ne 0) { throw "update-signing.mjs $($arguments[0]) failed." }
  return $out
}

function Invoke-Git([string[]]$arguments) {
  Push-Location $root
  try {
    $out = & git @arguments
    if ($LASTEXITCODE -ne 0) { throw "git $($arguments -join ' ') failed." }
    return $out
  } finally {
    Pop-Location
  }
}

# ---- New key pair -------------------------------------------------------------------------

if ($NewKey) {
  if (Test-Path $KeyPath) {
    throw "A signing key already exists at $KeyPath. It is not replaced: installed apps trust its public key."
  }
  $public = Invoke-Signer @("keygen", $KeyPath)
  # Only this Windows user may read the key: drop inherited permissions, grant just you.
  & icacls $KeyPath /inheritance:r /grant:r "${env:USERDOMAIN}\${env:USERNAME}:(F)" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "The key was created, but access to $KeyPath couldn't be restricted." }
  Write-Host "Created the update signing key: $KeyPath"
  Write-Host "Public key (set UPDATE_PUBLIC_KEY in src-tauri/src/updates.rs to this):"
  Write-Host "  $public"
  Write-Host "Back the key file up somewhere offline. It is never committed."
  return
}

# ---- What would stop a publish ------------------------------------------------------------

$problems = New-Object System.Collections.Generic.List[string]
if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') {
  $problems.Add("-Version must look like 1.2.3 (got '$Version').")
}

$dirty = @(Invoke-Git @("status", "--porcelain", "--untracked-files=no"))
if ($dirty.Count -gt 0) {
  $list = ($dirty | Select-Object -First 8) -join "`n    "
  $problems.Add("The working tree has uncommitted changes. Commit or stash them first:`n    $list")
}
$branch = (Invoke-Git @("rev-parse", "--abbrev-ref", "HEAD")) -join ""
if ($branch -ne "main") {
  $problems.Add("Releases are built from main, but this checkout is on '$branch'.")
}
if ($Version) {
  Push-Location $root
  try {
    & git rev-parse -q --verify "refs/tags/v$Version" | Out-Null
    $tagExists = $LASTEXITCODE -eq 0
  } finally {
    Pop-Location
  }
  if ($tagExists) { $problems.Add("The tag v$Version already exists.") }

  $current = ([IO.File]::ReadAllText((Join-Path $root "package.json")) | ConvertFrom-Json).version
  $core = { param($v) [version]($v -replace '-.*$', '') }
  if ($SkipBuild) {
    if ($current -ne $Version) {
      $problems.Add("-SkipBuild publishes the committed version, but package.json says $current, not $Version.")
    }
  } elseif ($Version -match '^\d' -and -not ((& $core $Version) -gt (& $core $current))) {
    $problems.Add("$Version is not newer than the current version $current.")
  }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $problems.Add("Node.js is needed to sign the manifest, and 'node' isn't on PATH.")
} elseif (-not (Test-Path $KeyPath)) {
  $problems.Add("No signing key at $KeyPath. Restore it from your backup, or create one with -NewKey (installed apps then need an update that embeds the new public key).")
} else {
  $source = [IO.File]::ReadAllText((Join-Path $root "src-tauri/src/updates.rs"))
  $embedded = [regex]::Match($source, 'UPDATE_PUBLIC_KEY: &str = "([^"]*)"').Groups[1].Value
  $public = (Invoke-Signer @("pubkey", $KeyPath)) -join ""
  if ($public -ne $embedded) {
    $problems.Add("The key at $KeyPath doesn't match UPDATE_PUBLIC_KEY in src-tauri/src/updates.rs, so the app couldn't verify this release.")
  }
}

$signtool = $null
if ($CertThumbprint) {
  $found = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($found) {
    $signtool = $found.Source
  } else {
    $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $signtool) { $problems.Add("-CertThumbprint was given, but signtool.exe wasn't found (install the Windows SDK).") }
}

if ($problems.Count -gt 0) {
  Write-Host "Not published:" -ForegroundColor Red
  foreach ($p in $problems) { Write-Host "  - $p" -ForegroundColor Red }
  exit 1
}

$file = "AXISNotes_${Version}_x64-setup.exe"
if (-not $CertThumbprint) {
  Write-Warning "The installer won't be Authenticode-signed (no -CertThumbprint), so Windows may warn about it. The app still checks it against the signed manifest."
}

if ($DryRun) {
  Write-Host "Dry run: nothing was changed. A publish would:"
  if ($SkipChecks) { Write-Host "  - skip lint, typecheck and tests (logged)" } else { Write-Host "  - run pnpm lint, pnpm typecheck and pnpm test" }
  if ($SkipBuild) { Write-Host "  - use the installer already built for $Version" } else { Write-Host "  - set the version to $Version and build $file" }
  if ($CertThumbprint) { Write-Host "  - Authenticode-sign it with certificate $CertThumbprint" }
  Write-Host "  - copy it to $Folder with a signed latest.json"
  if (-not $SkipBuild) { Write-Host "  - commit 'Release ${Version}: version bump'" }
  Write-Host "  - create the annotated tag v$Version (not pushed)"
  Write-Host "  - keep the $Keep newest installers in the folder"
  return
}

# ---- Checks -------------------------------------------------------------------------------

if ($SkipChecks) {
  Write-Warning "Skipping lint, typecheck and tests (-SkipChecks). This is recorded in the tag and publish-log.txt."
  $checks = "skipped (-SkipChecks)"
} else {
  foreach ($check in @("lint", "typecheck", "test")) {
    Write-Host "pnpm $check..."
    Push-Location $root
    try {
      if ($check -eq "test") {
        # Half the cores, and a failed test runs once more (T-285). With every core busy, a
        # busy machine made healthy UI tests hit their 20 s limit and stopped the publish;
        # a real failure still fails twice.
        & pnpm exec vitest run --maxWorkers=50% --retry=1
      } else {
        & pnpm $check
      }
      $code = $LASTEXITCODE
    } finally {
      Pop-Location
    }
    if ($code -ne 0) {
      Write-Host "Not published: pnpm $check failed." -ForegroundColor Red
      exit 1
    }
  }
  $checks = "lint, typecheck and tests passed"
}

# ---- Build --------------------------------------------------------------------------------

# Replace the first match of $pattern in a file, keeping everything else byte-for-byte.
function Set-FirstMatch([string]$path, [string]$pattern, [string]$replacement) {
  $text = [IO.File]::ReadAllText($path)
  $regex = New-Object System.Text.RegularExpressions.Regex($pattern, "Multiline")
  if (-not $regex.IsMatch($text)) { throw "No version found in $path" }
  [IO.File]::WriteAllText($path, $regex.Replace($text, $replacement, 1), $utf8)
}

if (-not $SkipBuild) {
  Set-FirstMatch (Join-Path $root "package.json") '"version": "[^"]*"' "`"version`": `"$Version`""
  Set-FirstMatch (Join-Path $root "src-tauri/tauri.conf.json") '"version": "[^"]*"' "`"version`": `"$Version`""
  Set-FirstMatch (Join-Path $root "src-tauri/Cargo.toml") '^version = "[^"]*"' "version = `"$Version`""
  Write-Host "Building AXISNotes $Version..."
  Push-Location $root
  try {
    pnpm tauri build --bundles nsis
    $built = $LASTEXITCODE -eq 0
  } finally {
    Pop-Location
  }
  if (-not $built) {
    # Leave the tree clean, so fixing the problem and running again works.
    Invoke-Git (@("checkout", "--") + $versionFiles) | Out-Null
    throw "The build failed; the version change was undone."
  }
}

$installer = Join-Path $root "src-tauri/target/release/bundle/nsis/$file"
if (-not (Test-Path $installer)) { throw "Installer not found: $installer" }

if ($CertThumbprint) {
  & $signtool sign /sha1 $CertThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $installer
  if ($LASTEXITCODE -ne 0) { throw "signtool couldn't sign $file." }
  & $signtool verify /pa $installer | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "signtool couldn't verify the signature on $file." }
  $authenticode = "signed ($CertThumbprint)"
} else {
  $authenticode = "unsigned"
}

# ---- Publish ------------------------------------------------------------------------------

New-Item -ItemType Directory -Force -Path $Folder | Out-Null
Copy-Item $installer (Join-Path $Folder $file) -Force
$sha256 = (Get-FileHash -Algorithm SHA256 (Join-Path $Folder $file)).Hash.ToLowerInvariant()

$manifest = [ordered]@{
  version   = $Version
  notes     = $Notes
  pubDate   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{ file = $file; sha256 = $sha256 }
  }
}
# Written after the installer is in place, and swapped in whole, so the app never reads a
# manifest that points at a missing or half-copied file. The signature covers the exact
# bytes written; it is checked before either file replaces the published ones.
$tmp = Join-Path $Folder "latest.json.tmp"
$sigTmp = Join-Path $Folder "latest.json.sig.tmp"
[IO.File]::WriteAllText($tmp, ($manifest | ConvertTo-Json -Depth 5), $utf8)
Invoke-Signer @("sign", $KeyPath, $tmp, $sigTmp) | Out-Null
Invoke-Signer @("verify", $public, $tmp, $sigTmp) | Out-Null
Move-Item $sigTmp (Join-Path $Folder "latest.json.sig") -Force
Move-Item $tmp (Join-Path $Folder "latest.json") -Force

# ---- Commit and tag -----------------------------------------------------------------------

if (-not $SkipBuild) {
  Invoke-Git (@("add", "--") + $versionFiles) | Out-Null
  $message = "Release ${Version}: version bump"
  if ($CommitTrailer) { $message = "$message`n`n$CommitTrailer" }
  Invoke-Git @("commit", "-q", "-m", $message) | Out-Null
}
$commit = (Invoke-Git @("rev-parse", "--short", "HEAD")) -join ""
$tagMessage = "AXISNotes $Version`n`n$Notes`n`nChecks: $checks`nInstaller: $authenticode, sha256 $sha256"
Invoke-Git @("tag", "-a", "v$Version", "-m", $tagMessage) | Out-Null

# ---- Tidy the folder ----------------------------------------------------------------------

$installers = Get-ChildItem -Path $Folder -Filter "AXISNotes_*_x64-setup.exe" -File | ForEach-Object {
  if ($_.Name -match '^AXISNotes_(\d+\.\d+\.\d+)') { [pscustomobject]@{ Item = $_; Version = [version]$Matches[1] } }
} | Sort-Object Version -Descending
$removed = 0
foreach ($old in @($installers | Select-Object -Skip $Keep)) {
  if ($old.Item.Name -eq $file) { continue }
  Remove-Item -LiteralPath $old.Item.FullName -Force
  $removed++
}

$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$line = "$stamp  $Version  commit $commit  checks: $checks  installer: $authenticode  sha256 $sha256`r`n"
[IO.File]::AppendAllText((Join-Path $Folder "publish-log.txt"), $line, $utf8)

Write-Host ""
Write-Host "Published AXISNotes $Version to $Folder"
Write-Host "  $file ($authenticode)"
Write-Host "  sha256 $sha256"
Write-Host "  latest.json signed; checks: $checks"
Write-Host "  tagged v$Version at $commit (not pushed)"
if ($removed -gt 0) { Write-Host "  removed $removed older installer(s), keeping the $Keep newest" }
