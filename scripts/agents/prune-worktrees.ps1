<#
.SYNOPSIS
  Reports task worktrees and agent branches that are already merged into main, and removes
  them only with -Apply (T-283).

.DESCRIPTION
  Every task gets its own worktree (AGENTS.md). Merged ones pile up: each holds a full copy
  of the app with its own node_modules (often hundreds of MB). This script lists:
    - merged worktrees with no local changes: safe to remove
    - merged worktrees with local changes: kept, so nothing is lost
    - unmerged worktrees and branches, and the ones with no row on .agents/TASKS.md
    - merged agent branches with no worktree: safe to delete
  With -Apply it runs `git worktree remove` (never --force) and `git branch -d` (never -D)
  on the safe ones only, then `git worktree prune`. src-tauri/target is reported, never
  touched.

.EXAMPLE
  powershell -File scripts/agents/prune-worktrees.ps1
.EXAMPLE
  powershell -File scripts/agents/prune-worktrees.ps1 -Apply
.EXAMPLE
  powershell -File scripts/agents/prune-worktrees.ps1 -Sizes   # also measure sizes (slow)
#>
param(
  [switch]$Apply,
  [switch]$Sizes,
  [string]$Base = "main"
)

$ErrorActionPreference = "Stop"
$root = (git rev-parse --show-toplevel).Trim()
Set-Location $root

function Get-FolderSizeGB([string]$path) {
  if (-not (Test-Path $path)) { return 0 }
  $bytes = (Get-ChildItem -LiteralPath $path -Recurse -Force -File -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum
  return [math]::Round(($bytes / 1GB), 2)
}

function Test-Merged([string]$branch) {
  git merge-base --is-ancestor $branch $Base 2>$null
  return $LASTEXITCODE -eq 0
}

# Worktrees, from git's porcelain listing.
$worktrees = @()
$current = $null
foreach ($line in (git worktree list --porcelain)) {
  if ($line -like "worktree *") {
    if ($current) { $worktrees += $current }
    $current = [ordered]@{ Path = $line.Substring(9); Branch = $null }
  } elseif ($line -like "branch refs/heads/*") {
    $current.Branch = $line.Substring(18)
  }
}
if ($current) { $worktrees += $current }

$board = if (Test-Path ".agents/TASKS.md") { Get-Content ".agents/TASKS.md" -Raw } else { "" }
$baseTip = (git rev-parse $Base).Trim()

$removable = @(); $dirty = @(); $unmerged = @()
# The first worktree is the primary checkout: never a candidate.
foreach ($w in ($worktrees | Select-Object -Skip 1)) {
  $path = $w.Path -replace "/", "\"
  if (-not $w.Branch -or $w.Branch -eq $Base) { continue } # detached or the base: leave alone
  # A branch still at the base's tip is a task just started, not a finished one.
  if ((git rev-parse $w.Branch).Trim() -eq $baseTip) { continue }
  $changes = if (Test-Path -LiteralPath $path) { git -C $path status --porcelain 2>$null } else { "" }
  $item = [pscustomobject]@{ Branch = $w.Branch; Path = $path; Changes = ($changes | Measure-Object).Count }
  if (Test-Merged $w.Branch) {
    if ($item.Changes -eq 0) { $removable += $item } else { $dirty += $item }
  } else {
    $unmerged += $item
  }
}

$withWorktree = @($worktrees | ForEach-Object { $_.Branch })
$branches = git for-each-ref --format="%(refname:short)" refs/heads/agent
$mergedBranches = @(); $unmergedBranches = @()
foreach ($b in $branches) {
  if ($withWorktree -contains $b) { continue }
  if ((git rev-parse $b).Trim() -eq $baseTip) { continue }
  if (Test-Merged $b) { $mergedBranches += $b } else { $unmergedBranches += $b }
}

$taskOf = { param($b) if ($b -match "T-\d+") { $Matches[0] } else { "" } }
$offBoard = @(@($unmerged | ForEach-Object { $_.Branch }) + $unmergedBranches |
  Where-Object { $t = & $taskOf $_; $t -and ($board -notmatch "\|\s*$t\s*\|") })

Write-Host "Merged into $Base, no local changes (removable): $($removable.Count) worktrees"
if ($Sizes -and $removable.Count) {
  $total = 0
  foreach ($r in $removable) { $total += Get-FolderSizeGB $r.Path }
  Write-Host "  about $total GB"
}
Write-Host "Merged, but with local changes (kept): $($dirty.Count)"
$dirty | ForEach-Object { Write-Host "  $($_.Branch)  $($_.Path)  ($($_.Changes) changed files)" }
Write-Host "Not merged (kept): $($unmerged.Count) worktrees, $($unmergedBranches.Count) branches without a worktree"
$unmerged | ForEach-Object { Write-Host "  $($_.Branch)  $($_.Path)" }
$unmergedBranches | ForEach-Object { Write-Host "  $_" }
Write-Host "Unmerged with no row on .agents/TASKS.md: $($offBoard.Count)"
$offBoard | ForEach-Object { Write-Host "  $_" }
Write-Host "Merged branches without a worktree (deletable): $($mergedBranches.Count)"
if ($Sizes) { Write-Host "src-tauri/target (not touched): $(Get-FolderSizeGB (Join-Path $root 'src-tauri/target')) GB" }

if (-not $Apply) {
  Write-Host ""
  Write-Host "Nothing was changed. Run again with -Apply to remove the removable worktrees and delete the merged branches."
  return
}

foreach ($r in $removable) {
  Write-Host "Removing $($r.Path)"
  git worktree remove $r.Path
  if ($LASTEXITCODE -eq 0) { git branch -d $r.Branch | Out-Null }
}
foreach ($b in $mergedBranches) { git branch -d $b | Out-Null }
git worktree prune
Write-Host "Done."
