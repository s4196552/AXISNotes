<#
.SYNOPSIS
  Ask Codex to review a task branch (normally one Claude built) against the base branch.

.EXAMPLE
  .\scripts\agents\codex-review.ps1 -TaskId T-002 -Worktree ..\axis-T-002
  Writes the review to .agents/reviews/T-002.md.
#>
param(
    [Parameter(Mandatory)] [string] $TaskId,
    [Parameter(Mandatory)] [string] $Worktree,
    [string] $Base = "main"
)

$ErrorActionPreference = "Stop"
$repo   = (git rev-parse --show-toplevel).Trim()
$out    = Join-Path $repo ".agents/reviews/$TaskId.md"
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null

$instructions = @"
Review task $TaskId for the AXIS project per AGENTS.md (cross-review rule).
Focus on correctness bugs, spec deviations from AXIS_BUILD_PROMPT.md, file-ownership
violations, missing tests, and security issues (API keys, 'Off'/'AI: never' folder leaks).
Start with a verdict line: 'Verdict: approve' or 'Verdict: changes-requested'.
Then list findings, most severe first, each with file:line.
"@

Push-Location $Worktree
try {
    $result = codex review --base $Base $instructions 2>&1
    $result | Set-Content -Encoding utf8 $out
    $result
} finally { Pop-Location }
