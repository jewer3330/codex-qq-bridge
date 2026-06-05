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

node --check "${REPO_ROOT}/bin/codex_qq_bridge.mjs"
python3 -m py_compile "${REPO_ROOT}/plugins/astrbot_plugin_codex_remote/main.py"
python3 -m json.tool "${REPO_ROOT}/plugins/astrbot_plugin_codex_remote/_conf_schema.json" >/dev/null

echo "codex-qq-bridge checks ok"

