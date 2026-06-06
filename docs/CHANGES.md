# Change Log

## 0.1.0

- Split the QQ remote capability into a standalone development source project.
- Kept installed runtime entrypoints under `.codex/bin`, while this repository
  owns the editable source copies and packaging scripts.
- Added plugin metadata in `.codex-plugin/plugin.json`.
- Documented dependencies, runtime boundaries, and install/check flows.
- Packaged the AstrBot plugin source, local Node bridge, text/image/voice QQ
  notification wrappers, and `qq-codex` skill together.
- Made default install and runtime paths portable: `CODEX_HOME` defaults to
  `$HOME/.codex`, and `CODEX_SERVER_ROOT` defaults to `$HOME/.codex/servers`.
- Added PowerShell installation and basic Windows helpers for bridge start,
  stop, logs, and text notification.
- Installers now copy the full plugin source into `.codex/plugins/codex-qq-bridge`
  and register it in the personal Codex marketplace.
