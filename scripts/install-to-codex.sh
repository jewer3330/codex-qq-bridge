#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-${HOME}/.codex}"
CODEX_SERVER_ROOT="${CODEX_SERVER_ROOT:-${HOME}/.codex/servers}"
ASTRBOT_PLUGIN_DIR="${CODEX_HOME}/plugins/astrbot_plugin_codex_remote"
CODEX_PLUGIN_DIR="${CODEX_HOME}/plugins/codex-qq-bridge"
MARKETPLACE_FILE="${CODEX_MARKETPLACE_FILE:-${CODEX_HOME}/.agents/plugins/marketplace.json}"
INSTALL_ASTRBOT_RUNTIME_PLUGIN="${INSTALL_ASTRBOT_RUNTIME_PLUGIN:-0}"

mkdir -p "${CODEX_HOME}/bin" "${CODEX_HOME}/plugins" "${CODEX_HOME}/skills"
mkdir -p "${CODEX_SERVER_ROOT}/astrbot/data/plugins"
mkdir -p "$(dirname "$MARKETPLACE_FILE")"

rsync -a --exclude '__pycache__/' "${REPO_ROOT}/bin/" "${CODEX_HOME}/bin/"
rsync -a --delete --exclude '__pycache__/' \
  "${REPO_ROOT}/plugins/astrbot_plugin_codex_remote/" \
  "${ASTRBOT_PLUGIN_DIR}/"
rsync -a --delete "${REPO_ROOT}/skills/qq-codex/" "${CODEX_HOME}/skills/qq-codex/"
rsync -a --delete \
  --exclude '.git/' \
  --exclude '.codegraph/' \
  --exclude '__pycache__/' \
  "${REPO_ROOT}/" "${CODEX_PLUGIN_DIR}/"

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

python3 - "$MARKETPLACE_FILE" <<'PY'
import json
import sys
from pathlib import Path

marketplace = Path(sys.argv[1])
entry = {
    "name": "codex-qq-bridge",
    "source": {"source": "local", "path": "./plugins/codex-qq-bridge"},
    "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
    "category": "Productivity",
}
if marketplace.exists():
    data = json.loads(marketplace.read_text(encoding="utf-8"))
else:
    data = {"name": "personal", "interface": {"displayName": "Personal"}, "plugins": []}
plugins = data.setdefault("plugins", [])
plugins[:] = [plugin for plugin in plugins if plugin.get("name") != entry["name"]]
plugins.append(entry)
marketplace.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

echo "Installed Codex QQ bridge source into ${CODEX_HOME}"
echo "Registered Codex QQ Bridge in ${MARKETPLACE_FILE}"
