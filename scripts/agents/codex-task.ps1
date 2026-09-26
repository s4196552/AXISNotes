<#
.SYNOPSIS
  Hand a task to Codex (non-interactive) in its own git worktree.

.EXAMPLE
  .\scripts\agents\codex-task.ps1 -TaskId T-003
  Reads .agents/briefs/T-003.md, creates worktree ..\axis-T-003 on branch
  agent/codex/T-003 (if missing), and runs Codex there.
#>
param(
    [Parameter(Mandatory)] [string] $TaskId,
    [string] $Base = "main",
    [string] $Model = ""          # e.g. gpt-6-sol; empty = Codex default
)

$ErrorActionPreference = "Stop"
$repo     = (git rev-parse --show-toplevel).Trim()
$brief    = Join-Path $repo ".agents/briefs/$TaskId.md"
$worktree = Join-Path (Split-Path $repo -Parent) "axis-$TaskId"
$branch   = "agent/codex/$TaskId"
$logDir   = Join-Path $repo ".agents/logs"

if (-not (Test-Path $brief)) { throw "Missing brief: $brief" }
New-Item -ItemType Directory -Force $logDir | Out-Null

if (-not (Test-Path $worktree)) {
    git -C $repo worktree add $worktree -b $branch $Base
}

$prompt = @"
You are the Codex builder on the AXIS project. Read AGENTS.md and AXIS_BUILD_PROMPT.md in
this worktree first and follow them exactly.

Your task: $TaskId. Work only in this worktree, on branch $branch, and only edit the files
listed as yours in the brief. When done: run the tests, commit with the prefix "${TaskId}:",
and write your handoff note to $repo/.agents/handoffs/$TaskId.md.

--- TASK BRIEF ---
$(Get-Content $brief -Raw)
"@

$codexArgs = @("exec", "-C", $worktree, "-s", "workspace-write",
          "--add-dir", (Join-Path $repo ".agents"),
          "-o", (Join-Path $logDir "$TaskId.last.md"))
if ($Model) { $codexArgs += @("-m", $Model) }
$codexArgs += "-"

$prompt | codex @codexArgs 2>&1 | Tee-Object -FilePath (Join-Path $logDir "$TaskId.log")
exit $LASTEXITCODE

