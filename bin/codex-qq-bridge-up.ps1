param(
  [string]$HostAddress = $(if ($env:CODEX_QQ_BRIDGE_HOST) { $env:CODEX_QQ_BRIDGE_HOST } else { "0.0.0.0" }),
  [int]$Port = $(if ($env:CODEX_QQ_BRIDGE_PORT) { [int]$env:CODEX_QQ_BRIDGE_PORT } else { 8765 })
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DefaultRoot = Split-Path -Parent $ScriptDir
$Root = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { $DefaultRoot }
$ServerRoot = if ($env:CODEX_SERVER_ROOT) { $env:CODEX_SERVER_ROOT } else { Join-Path (Join-Path $HOME ".codex") "servers" }
$Node = if ($env:NODE) { $env:NODE } else { "node" }
$Bridge = Join-Path $Root "bin\codex_qq_bridge.mjs"
$TokenFile = if ($env:CODEX_QQ_TOKEN_FILE) { $env:CODEX_QQ_TOKEN_FILE } else { Join-Path $ServerRoot "astrbot\data\codex_qq_bridge.token" }
$LogDir = if ($env:CODEX_QQ_LOG_DIR) { $env:CODEX_QQ_LOG_DIR } else { Join-Path $Root "logs\codex-qq-bridge" }
$LogFile = Join-Path $LogDir "codex_qq_bridge_node.log"
$ErrFile = Join-Path $LogDir "codex_qq_bridge_node.err.log"
$PidFile = Join-Path $LogDir "codex_qq_bridge_node.pid"

New-Item -ItemType Directory -Force -Path $LogDir, (Split-Path -Parent $TokenFile) | Out-Null
if (-not (Test-Path $TokenFile)) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  ([System.BitConverter]::ToString($bytes) -replace "-", "").ToLowerInvariant() | Set-Content -NoNewline -Encoding ASCII -Path $TokenFile
}

if (Test-Path $PidFile) {
  $existingPid = Get-Content -Raw -Path $PidFile
  if ($existingPid -and (Get-Process -Id ([int]$existingPid) -ErrorAction SilentlyContinue)) {
    Write-Host "Codex QQ bridge already running with PID $existingPid"
    exit 0
  }
}

$process = Start-Process -FilePath $Node -ArgumentList @($Bridge, "--host", $HostAddress, "--port", "$Port") -RedirectStandardOutput $LogFile -RedirectStandardError $ErrFile -PassThru -WindowStyle Hidden
$process.Id | Set-Content -NoNewline -Encoding ASCII -Path $PidFile
Write-Host "Codex QQ bridge started with Node PID $($process.Id), http://${HostAddress}:$Port"
Write-Host "Logs: $LogFile"
Write-Host "Errors: $ErrFile"
