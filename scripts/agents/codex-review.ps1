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
    [string] $Model = ""   # omit = invoke-codex.ps1's default; "" = Codex's own default
)

$ErrorActionPreference = "Stop"
$repo     = (git rev-parse --show-toplevel).Trim()
$worktree = (Resolve-Path $Worktree).Path
$out      = Join-Path $repo ".agents/reviews/$TaskId.md"
$logDir   = Join-Path $repo ".agents/logs"
New-Item -ItemType Directory -Force (Split-Path $out), $logDir | Out-Null

$prompt = @"
You are reviewing work on the AXIS project because the human asked for a Codex review.
(Claude normally builds and verifies tasks on its own; see AGENTS.md.)
Review task ${TaskId}: the changes on the current branch versus '$Base'. Inspect them with
'git diff $Base...HEAD' and 'git log $Base..HEAD', and read the surrounding code as needed.
If a brief exists at .agents/briefs/$TaskId.md, check the work against it. Suite work is
specified in docs/SUITE*.md; AXIS_BUILD_PROMPT.md is the historical AXISNotes spec.

Focus on: correctness bugs, deviations from the brief and specs, file-ownership
violations, missing or weak tests, data-loss risks (file writes, renames, trash),
path-traversal/security issues, and cross-platform problems (Windows paths, line endings).
Do NOT modify any files. Report only issues you are confident about; no style nitpicks.

Your final message is saved verbatim as the review file. Format it as Markdown:
Line 1: 'Verdict: approve' or 'Verdict: changes-requested'
Then '## Findings' with a numbered list, most severe first, each with file:line,
severity (high/medium/low), the problem, and a concrete failure scenario.
Then '## Tests' saying what you ran (if anything) and the result.
"@

# Move the previous review aside (review files are untracked, and Claude writes most of
# them), so Codex writes a fresh one. Each run keeps its own timestamped copy in the logs, and
# if no new review gets written (Codex missing, a failed launch, an error) it's put back.
$prev = $null
if (Test-Path $out) {
    $prev = Join-Path $logDir ("$TaskId.review.{0:yyyyMMdd-HHmmss}.prev.md" -f (Get-Date))
    Move-Item $out $prev
}

$codexArgs = @("exec", "-C", $worktree, "-s", "read-only", "-o", $out)

# Only pass -Model through when given, so invoke-codex.ps1 keeps the shared default.
$modelArg = @{}
if ($PSBoundParameters.ContainsKey("Model")) { $modelArg.Model = $Model }

$code = 1
$restored = $false
try {
    & (Join-Path $PSScriptRoot "invoke-codex.ps1") -CodexArgs $codexArgs -Prompt $prompt @modelArg `
        -LogBase (Join-Path $logDir "$TaskId.review") | Out-Null
    $code = $LASTEXITCODE
} finally {
    if (-not (Test-Path $out) -and $prev) {
        Move-Item $prev $out
        $restored = $true
        Write-Warning "No new review was written; the previous review is back at $out"
    }
}
if (-not $restored -and (Test-Path $out)) { Get-Content $out -Raw }
exit $code
