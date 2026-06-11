#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEFAULT_CODEX_HOME="$(cd "${SKILL_DIR}/../.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$DEFAULT_CODEX_HOME}"
if [[ -z "${CODEX_SERVER_ROOT:-}" ]]; then
  if [[ "$CODEX_HOME" == */work/.codex ]]; then
    SERVER_ROOT="$(cd "${CODEX_HOME}/../.." && pwd)/servers"
  else
    SERVER_ROOT="${CODEX_HOME}/servers"
  fi
else
  SERVER_ROOT="$CODEX_SERVER_ROOT"
fi
ASTRBOT_HOME="${ASTRBOT_HOME:-${SERVER_ROOT}/astrbot}"

SOURCE_DIR="${CODEX_QQ_ASTRBOT_PLUGIN_SOURCE:-${CODEX_HOME}/plugins/astrbot_plugin_codex_remote}"
TARGET_DIR="${CODEX_QQ_ASTRBOT_PLUGIN_TARGET:-${ASTRBOT_HOME}/data/plugins/astrbot_plugin_codex_remote}"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "install-astrbot-plugin: source plugin not found: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
rsync -a --delete --exclude='__pycache__/' --exclude='*.pyc' "${SOURCE_DIR}/" "${TARGET_DIR}/"
echo "Installed AstrBot Codex plugin:"
echo "  source: $SOURCE_DIR"
echo "  target: $TARGET_DIR"
