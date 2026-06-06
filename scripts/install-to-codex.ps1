param(
  [string]$CodexHome = $(if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }),
  [string]$CodexServerRoot = $(if ($env:CODEX_SERVER_ROOT) { $env:CODEX_SERVER_ROOT } else { Join-Path (Join-Path $HOME ".codex") "servers" }),
  [string]$MarketplaceFile = $(if ($env:CODEX_MARKETPLACE_FILE) { $env:CODEX_MARKETPLACE_FILE } else { Join-Path (Join-Path $CodexHome ".agents") "plugins\marketplace.json" }),
  [switch]$InstallAstrBotRuntimePlugin
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$BinDir = Join-Path $CodexHome "bin"
$SkillsDir = Join-Path $CodexHome "skills"
$PluginRoot = Join-Path $CodexHome "plugins"
$AstrBotPluginDir = Join-Path $PluginRoot "astrbot_plugin_codex_remote"
$CodexPluginDir = Join-Path $PluginRoot "codex-qq-bridge"
$AstrBotRuntimePlugins = Join-Path $CodexServerRoot "astrbot\data\plugins"

New-Item -ItemType Directory -Force -Path $BinDir, $SkillsDir, $PluginRoot, $AstrBotRuntimePlugins, (Split-Path -Parent $MarketplaceFile) | Out-Null

Copy-Item -Recurse -Force (Join-Path $RepoRoot "bin\*") $BinDir
if (Test-Path $AstrBotPluginDir) { Remove-Item -Recurse -Force $AstrBotPluginDir }
Copy-Item -Recurse -Force (Join-Path $RepoRoot "plugins\astrbot_plugin_codex_remote") $AstrBotPluginDir

$SkillDest = Join-Path $SkillsDir "qq-codex"
if (Test-Path $SkillDest) { Remove-Item -Recurse -Force $SkillDest }
Copy-Item -Recurse -Force (Join-Path $RepoRoot "skills\qq-codex") $SkillDest

if (Test-Path $CodexPluginDir) { Remove-Item -Recurse -Force $CodexPluginDir }
New-Item -ItemType Directory -Force -Path $CodexPluginDir | Out-Null
Get-ChildItem -Force $RepoRoot | Where-Object {
  $_.Name -notin @(".git", ".codegraph", "__pycache__")
} | ForEach-Object {
  Copy-Item -Recurse -Force $_.FullName (Join-Path $CodexPluginDir $_.Name)
}

if ($InstallAstrBotRuntimePlugin) {
  $RuntimePlugin = Join-Path $AstrBotRuntimePlugins "astrbot_plugin_codex_remote"
  if (Test-Path $RuntimePlugin) { Remove-Item -Recurse -Force $RuntimePlugin }
  Copy-Item -Recurse -Force $AstrBotPluginDir $RuntimePlugin
}

if (Test-Path $MarketplaceFile) {
  $marketplace = Get-Content -Raw -Path $MarketplaceFile | ConvertFrom-Json
} else {
  $marketplace = [pscustomobject]@{
    name = "personal"
    interface = [pscustomobject]@{ displayName = "Personal" }
    plugins = @()
  }
}

$entry = [pscustomobject]@{
  name = "codex-qq-bridge"
  source = [pscustomobject]@{ source = "local"; path = "./plugins/codex-qq-bridge" }
  policy = [pscustomobject]@{ installation = "AVAILABLE"; authentication = "ON_INSTALL" }
  category = "Productivity"
}
$plugins = @($marketplace.plugins | Where-Object { $_.name -ne $entry.name })
$marketplace.plugins = @($plugins + $entry)
$marketplace | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -Path $MarketplaceFile

Write-Host "Installed Codex QQ bridge source into $CodexHome"
Write-Host "Registered Codex QQ Bridge in $MarketplaceFile"
