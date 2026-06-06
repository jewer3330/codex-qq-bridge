# Codex QQ Bridge

This is the development source project for the local QQ-to-Codex capability.
It is separate from the installed `.codex/bin` and `.codex/skills` copies so
the bridge can be reviewed, changed, tested, committed, and packaged as a
standalone plugin-style project.

## What Changed

- Added a Node.js HTTP bridge, `bin/codex_qq_bridge.mjs`, that queues QQ-originated
  jobs, invokes the local Codex CLI, exposes `/status`, `/runs`, `/chat`, `/run`,
  `/cancel`, and `/speak`, and streams throttled progress back through AstrBot.
- Added an AstrBot plugin in `plugins/astrbot_plugin_codex_remote` that receives
  QQ messages, enforces sender allow-lists, forwards text and image attachments
  to the bridge, mirrors recent history, handles status/cancel commands, accepts
  explicit GitHub token handoff, and can return voice replies.
- Added proactive QQ notification wrappers for text, image, and voice:
  `codex-qq-notify`, `codex-qq-notify-image`, and `codex-qq-notify-voice`.
- Added the reusable Codex skill under `skills/qq-codex`.
- Added install and check scripts for promoting this source tree into a local
  Codex installation.

## Install

macOS/Linux/WSL/Git Bash:

```bash
scripts/install-to-codex.sh
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-to-codex.ps1
```

The install script is lightweight: it copies only source-controlled bridge files
and marketplace metadata into:

- `${CODEX_HOME:-$HOME/.codex}/bin`
- `${CODEX_HOME:-$HOME/.codex}/plugins/codex-qq-bridge`
- `${CODEX_HOME:-$HOME/.codex}/plugins/astrbot_plugin_codex_remote`
- `${CODEX_HOME:-$HOME/.codex}/skills/qq-codex`
- `${CODEX_HOME:-$HOME/.codex}/.agents/plugins/marketplace.json`

It does not require Docker and does not create service runtime data by default.
AstrBot login state, tokens, plugins, attachments, and databases belong under
`${CODEX_SERVER_ROOT:-$HOME/.codex/servers}/astrbot` only when you actually run
or connect an AstrBot service.

To use a different installation root:

```bash
CODEX_HOME=/opt/codex \
CODEX_SERVER_ROOT=/srv/codex \
scripts/install-to-codex.sh
```

To also copy the AstrBot runtime plugin during install, explicitly opt in:

```bash
INSTALL_ASTRBOT_RUNTIME_PLUGIN=1 scripts/install-to-codex.sh
```

On Windows, the installer also copies PowerShell helpers:

```powershell
~\.codex\bin\codex-qq-bridge-up.ps1
~\.codex\bin\codex-qq-bridge-down.ps1
~\.codex\bin\codex-qq-bridge-logs.ps1
~\.codex\bin\codex-qq-notify.ps1 "message"
```

The Unix shell wrappers still require macOS/Linux/WSL/Git Bash. Docker is only
needed if your chosen AstrBot deployment uses Docker. QQ voice conversion
currently uses macOS `afconvert`; use WSL with a compatible audio converter or
keep QQ voice delivery on macOS until the ffmpeg route is added.

## Marketplace

Install scripts register this plugin in the personal Codex marketplace at
`${CODEX_MARKETPLACE_FILE:-$CODEX_HOME/.agents/plugins/marketplace.json}` with
source path `./plugins/codex-qq-bridge`.

## Check

```bash
scripts/check.sh
```

This checks shell syntax, Node syntax, Python syntax, and the AstrBot config
schema JSON. It does not require QQ login.

## Runtime Data Boundary

Do not commit QQ login state, OpenAPI keys, bridge tokens, AstrBot databases,
attachments, generated voice files, or logs. Keep those under
`${CODEX_SERVER_ROOT:-$HOME/.codex/servers}/astrbot` or another server-owned
runtime directory.
