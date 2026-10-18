<#
.SYNOPSIS
  Builds AXISNotes at a new version and publishes it to the updates folder (T-066).

.DESCRIPTION
  1. Sets the version in package.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml.
  2. Builds the Windows installer (NSIS .exe).
  3. Copies it into the updates folder and writes latest.json (version, notes, SHA-256).

  Every AXISNotes that checks that folder then offers the update ("Install and restart").
  The version must be higher than the installed one. Commit the version change afterwards.

.EXAMPLE
  powershell -File scripts/publish-update.ps1 -Version 0.2.1 -Notes "Fixes the tag pane"

.EXAMPLE
  powershell -File scripts/publish-update.ps1 -Version 0.3.0 -Folder "\\nas\AXISNotes Updates"
#>
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Notes = "",
  [string]$Folder = (Join-Path $env:USERPROFILE "AXISNotes Updates"),
  # Publish the installer already built for -Version instead of building again.
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding($false)  # no BOM

if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') {
  throw "Version must look like 1.2.3 (got '$Version')."
}

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
    if ($LASTEXITCODE -ne 0) { throw "The build failed." }
  } finally {
    Pop-Location
  }
}

$file = "AXISNotes_${Version}_x64-setup.exe"
$installer = Join-Path $root "src-tauri/target/release/bundle/nsis/$file"
if (-not (Test-Path $installer)) { throw "Installer not found: $installer" }

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
# manifest that points at a missing or half-copied file.
$tmp = Join-Path $Folder "latest.json.tmp"
[IO.File]::WriteAllText($tmp, ($manifest | ConvertTo-Json -Depth 5), $utf8)
Move-Item $tmp (Join-Path $Folder "latest.json") -Force

Write-Host ""
Write-Host "Published AXISNotes $Version to $Folder"
Write-Host "  $file"
Write-Host "  sha256 $sha256"
if (-not $SkipBuild) {
  Write-Host "Commit the version change: package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock"
}
