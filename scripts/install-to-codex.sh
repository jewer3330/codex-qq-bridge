#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-${HOME}/.codex}"
CODEX_SERVER_ROOT="${CODEX_SERVER_ROOT:-${HOME}/.codex/servers}"
ASTRBOT_PLUGIN_DIR="${CODEX_HOME}/plugins/astrbot_plugin_codex_remote"
INSTALL_ASTRBOT_RUNTIME_PLUGIN="${INSTALL_ASTRBOT_RUNTIME_PLUGIN:-0}"

mkdir -p "${CODEX_HOME}/bin" "${CODEX_HOME}/plugins" "${CODEX_HOME}/skills"
mkdir -p "${CODEX_SERVER_ROOT}/astrbot/data/plugins"

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

if [[ "$INSTALL_ASTRBOT_RUNTIME_PLUGIN" == "1" ]]; then
  CODEX_HOME="$CODEX_HOME" CODEX_SERVER_ROOT="$CODEX_SERVER_ROOT" \
    "${CODEX_HOME}/skills/qq-codex/scripts/install-astrbot-plugin.sh"
fi

echo "Installed Codex QQ bridge source into ${CODEX_HOME}"
