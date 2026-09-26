<#
.SYNOPSIS
  Run `codex <args>` with a prompt fed on stdin from a file. Shared by codex-task.ps1
  and codex-review.ps1.

.NOTES
  Piping a string into the npm `codex.ps1` shim hangs when PowerShell runs
  non-interactively in the background, so the prompt is written to a file and
  passed as redirected stdin to `codex.cmd` instead.
#>
param(
    [Parameter(Mandatory)] [string[]] $CodexArgs,
    [Parameter(Mandatory)] [string] $Prompt,
    [Parameter(Mandatory)] [string] $LogBase   # e.g. .agents/logs/T-003 -> .prompt.md, .log, .err.log
)

$ErrorActionPreference = "Stop"
$promptFile = "$LogBase.prompt.md"
$outLog     = "$LogBase.log"
$errLog     = "$LogBase.err.log"
[IO.File]::WriteAllText($promptFile, $Prompt, (New-Object Text.UTF8Encoding $false))

$shim = (Get-Command codex -CommandType ExternalScript, Application | Select-Object -First 1).Source
$codexCmd = Join-Path (Split-Path $shim) "codex.cmd"
if (-not (Test-Path $codexCmd)) { throw "codex.cmd not found next to $shim" }

# Windows PowerShell 5.1 joins ArgumentList without quoting, so quote each arg.
$argLine = ($CodexArgs + "-" | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join " "

$p = Start-Process -FilePath $codexCmd -ArgumentList $argLine -NoNewWindow -Wait -PassThru `
    -RedirectStandardInput $promptFile -RedirectStandardOutput $outLog -RedirectStandardError $errLog
Get-Content $outLog -Tail 40
exit $p.ExitCode
