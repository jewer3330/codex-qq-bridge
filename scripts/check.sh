#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

zsh -n \
  "${REPO_ROOT}/bin/codex-qq-bridge-up" \
  "${REPO_ROOT}/bin/codex-qq-bridge-down" \
  "${REPO_ROOT}/bin/codex-qq-bridge-logs" \
  "${REPO_ROOT}/bin/codex-qq-notify" \
  "${REPO_ROOT}/bin/codex-qq-notify-image" \
  "${REPO_ROOT}/bin/codex-qq-notify-voice" \
  "${REPO_ROOT}/scripts/install-to-codex.sh"

if command -v pwsh >/dev/null 2>&1; then
  pwsh -NoProfile -Command '$ok=$true; foreach ($file in $args) { $tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $file), [ref]$tokens, [ref]$errors) > $null; if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error "$file: $_" }; $ok=$false } }; if (-not $ok) { exit 1 }' \
    "${REPO_ROOT}/bin/codex-qq-bridge-up.ps1" \
    "${REPO_ROOT}/bin/codex-qq-bridge-down.ps1" \
    "${REPO_ROOT}/bin/codex-qq-bridge-logs.ps1" \
    "${REPO_ROOT}/bin/codex-qq-notify.ps1" \
    "${REPO_ROOT}/scripts/install-to-codex.ps1"
fi

node --check "${REPO_ROOT}/bin/codex_qq_bridge.mjs"
python3 -m py_compile "${REPO_ROOT}/plugins/astrbot_plugin_codex_remote/main.py"
python3 -m json.tool "${REPO_ROOT}/plugins/astrbot_plugin_codex_remote/_conf_schema.json" >/dev/null

echo "codex-qq-bridge checks ok"
