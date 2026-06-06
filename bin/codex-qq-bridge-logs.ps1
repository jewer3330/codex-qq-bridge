$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DefaultRoot = Split-Path -Parent $ScriptDir
$Root = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { $DefaultRoot }
$LogDir = if ($env:CODEX_QQ_LOG_DIR) { $env:CODEX_QQ_LOG_DIR } else { Join-Path $Root "logs\codex-qq-bridge" }
$LogFile = Join-Path $LogDir "codex_qq_bridge_node.log"
$ErrFile = Join-Path $LogDir "codex_qq_bridge_node.err.log"

if (-not (Test-Path $LogFile)) {
  Write-Error "No Codex QQ bridge log yet. Start it with codex-qq-bridge-up.ps1."
}

$paths = @($LogFile)
if (Test-Path $ErrFile) {
  $paths += $ErrFile
}
Get-Content -Path $paths -Wait -Tail 80
