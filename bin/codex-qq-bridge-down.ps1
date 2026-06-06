$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DefaultRoot = Split-Path -Parent $ScriptDir
$Root = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { $DefaultRoot }
$LogDir = if ($env:CODEX_QQ_LOG_DIR) { $env:CODEX_QQ_LOG_DIR } else { Join-Path $Root "logs\codex-qq-bridge" }
$PidFile = Join-Path $LogDir "codex_qq_bridge_node.pid"

if (-not (Test-Path $PidFile)) {
  Write-Host "Codex QQ bridge is not running."
  exit 0
}

$pidValue = [int](Get-Content -Raw -Path $PidFile)
$process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
if ($process) {
  Stop-Process -Id $pidValue -Force
  Write-Host "Stopped Codex QQ bridge PID $pidValue"
} else {
  Write-Host "Codex QQ bridge PID $pidValue is not running."
}
Remove-Item -Force $PidFile
