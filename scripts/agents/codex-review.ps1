<#
.SYNOPSIS
  Ask Codex to review a task branch (normally one Claude built) against the base branch.

.EXAMPLE
  .\scripts\agents\codex-review.ps1 -TaskId T-002 -Worktree ..\axis-T-002
  Writes the review to .agents/reviews/T-002.md.

.NOTES
  Uses `codex exec` in a read-only sandbox rather than `codex review`, because
  `codex review --base` does not accept custom instructions.
#>
param(
    [Parameter(Mandatory)] [string] $TaskId,
    [Parameter(Mandatory)] [string] $Worktree,
    [string] $Base = "main",
    [string] $Model = ""
)

$ErrorActionPreference = "Stop"
$repo     = (git rev-parse --show-toplevel).Trim()
$worktree = (Resolve-Path $Worktree).Path
$out      = Join-Path $repo ".agents/reviews/$TaskId.md"
$logDir   = Join-Path $repo ".agents/logs"
New-Item -ItemType Directory -Force (Split-Path $out), $logDir | Out-Null

$prompt = @"
You are the Codex reviewer on the AXIS project (cross-review rule in AGENTS.md).
Review task ${TaskId}: the changes on the current branch versus '$Base'. Inspect them with
'git diff $Base...HEAD' and 'git log $Base..HEAD', and read the surrounding code as needed.
If a brief exists at .agents/briefs/$TaskId.md, check the work against it.

Focus on: correctness bugs, deviations from AXIS_BUILD_PROMPT.md, file-ownership
violations, missing or weak tests, data-loss risks (file writes, renames, trash),
path-traversal/security issues, and cross-platform problems (Windows paths, line endings).
Do NOT modify any files. Report only issues you are confident about; no style nitpicks.

Your final message is saved verbatim as the review file. Format it as Markdown:
Line 1: 'Verdict: approve' or 'Verdict: changes-requested'
Then '## Findings' with a numbered list, most severe first, each with file:line,
severity (high/medium/low), the problem, and a concrete failure scenario.
Then '## Tests' saying what you ran (if anything) and the result.
"@

$codexArgs = @("exec", "-C", $worktree, "-s", "read-only", "-o", $out)
if ($Model) { $codexArgs += @("-m", $Model) }

& (Join-Path $PSScriptRoot "invoke-codex.ps1") -CodexArgs $codexArgs -Prompt $prompt `
    -LogBase (Join-Path $logDir "$TaskId.review") | Out-Null
$code = $LASTEXITCODE
if (Test-Path $out) { Get-Content $out -Raw }
exit $code
