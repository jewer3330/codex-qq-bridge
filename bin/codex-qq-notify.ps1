param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Message
)

$ErrorActionPreference = "Stop"
if (-not $Message -or $Message.Count -eq 0) {
  Write-Error "Usage: codex-qq-notify.ps1 MESSAGE"
}

$AstrBotUrl = if ($env:ASTRBOT_URL) { $env:ASTRBOT_URL } else { "http://127.0.0.1:6185" }
$ServerRoot = if ($env:CODEX_SERVER_ROOT) { $env:CODEX_SERVER_ROOT } else { Join-Path (Join-Path $HOME ".codex") "servers" }
$AstrBotHome = if ($env:ASTRBOT_HOME) { $env:ASTRBOT_HOME } else { Join-Path $ServerRoot "astrbot" }
$ApiKeyFile = if ($env:ASTRBOT_OPENAPI_KEY_FILE) { $env:ASTRBOT_OPENAPI_KEY_FILE } else { Join-Path $AstrBotHome "data\codex_openapi_im.key" }
$TargetUmo = if ($env:CODEX_QQ_NOTIFY_UMO) { $env:CODEX_QQ_NOTIFY_UMO } else { "default:FriendMessage:FE5A8E0DFC9FFB4B141210C3543F049A" }

if (-not (Test-Path $ApiKeyFile)) {
  Write-Error "Missing AstrBot OpenAPI key file: $ApiKeyFile"
}
$ApiKey = (Get-Content -Raw -Path $ApiKeyFile).Trim()
if (-not $ApiKey) {
  Write-Error "API key file is empty: $ApiKeyFile"
}

$payload = @{
  umo = $TargetUmo
  message = ($Message -join " ")
} | ConvertTo-Json -Depth 10

$headers = @{
  Authorization = "Bearer $ApiKey"
  "Content-Type" = "application/json; charset=utf-8"
}
$response = Invoke-RestMethod -Method Post -Uri "$($AstrBotUrl.TrimEnd('/'))/api/v1/im/message" -Headers $headers -Body $payload
if ($response.status -ne "ok") {
  throw "AstrBot returned: $($response | ConvertTo-Json -Depth 10)"
}
Write-Host "sent"
