<#
.SYNOPSIS
  Rebuilds the task preview entries in .claude/launch.json from the existing worktrees (T-283).

.DESCRIPTION
  Each task worktree gets one vite preview, named "axis-T-###" on port 1700 + ###
  (T-277 -> 1977). Entries for worktrees that no longer exist are dropped; entries that
  aren't task previews ("axis-T-…") are kept as they are.

.EXAMPLE
  powershell -File scripts/agents/launch-config.ps1
#>
$ErrorActionPreference = "Stop"
$root = (git rev-parse --show-toplevel).Trim()
$file = Join-Path $root ".claude/launch.json"

$json = if (Test-Path $file) { Get-Content $file -Raw | ConvertFrom-Json } else {
  [pscustomobject]@{ version = "0.0.1"; configurations = @() }
}
$kept = @($json.configurations | Where-Object { $_.name -notlike "axis-T-*" })

$tasks = @()
foreach ($line in (git worktree list --porcelain)) {
  if ($line -notlike "worktree *") { continue }
  $path = $line.Substring(9)
  $name = Split-Path $path -Leaf
  if ($name -notmatch "^(?:axis-)?T-(\d+)$") { continue }
  $n = [int]$Matches[1]
  if (-not (Test-Path (Join-Path $path "package.json"))) { continue }
  # Relative to the primary checkout, as the existing entries are.
  # (Resolve-Path -Relative works in Windows PowerShell 5.1, unlike GetRelativePath.)
  Push-Location $root
  try { $rel = (Resolve-Path -LiteralPath $path -Relative) -replace "\\", "/" -replace "^\./", "" }
  finally { Pop-Location }
  $port = 1700 + $n
  $tasks += [pscustomobject]@{
    name = "axis-T-$n"
    runtimeExecutable = "pnpm"
    runtimeArgs = @("-C", $rel, "exec", "vite", "--port", "$port", "--strictPort")
    port = $port
  }
}
$tasks = @($tasks | Sort-Object { [int]($_.name -replace "\D", "") } -Descending)

$json.configurations = @($tasks + $kept)
$text = $json | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($file, $text + "`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Host "launch.json: $($tasks.Count) task previews, $($kept.Count) other entries."
