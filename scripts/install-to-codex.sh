#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-/Volumes/ssd/work/.codex}"
ASTRBOT_PLUGIN_DIR="${CODEX_HOME}/plugins/astrbot_plugin_codex_remote"

mkdir -p "${CODEX_HOME}/bin" "${CODEX_HOME}/plugins" "${CODEX_HOME}/skills"

rsync -a --exclude '__pycache__/' "${REPO_ROOT}/bin/" "${CODEX_HOME}/bin/"
rsync -a --delete --exclude '__pycache__/' \
  "${REPO_ROOT}/plugins/astrbot_plugin_codex_remote/" \
  "${ASTRBOT_PLUGIN_DIR}/"
rsync -a --delete "${REPO_ROOT}/skills/qq-codex/" "${CODEX_HOME}/skills/qq-codex/"

chmod +x \
  "${CODEX_HOME}/bin/codex_qq_bridge.mjs" \
  "${CODEX_HOME}/bin/codex-qq-bridge-up" \
  "${CODEX_HOME}/bin/codex-qq-bridge-down" \
  "${CODEX_HOME}/bin/codex-qq-bridge-logs" \
  "${CODEX_HOME}/bin/codex-qq-notify" \
  "${CODEX_HOME}/bin/codex-qq-notify-image" \
  "${CODEX_HOME}/bin/codex-qq-notify-voice" \
  "${CODEX_HOME}/skills/qq-codex/scripts/install-astrbot-plugin.sh"

echo "Installed Codex QQ bridge source into ${CODEX_HOME}"

