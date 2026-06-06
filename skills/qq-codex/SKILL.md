---
name: qq-codex
description: Use when setting up, operating, or packaging a bidirectional QQ-Codex bridge where QQ messages can invoke local Codex work and Codex can proactively send text, images, voice, progress, or status back to QQ. Covers AstrBot/OpenAPI, OneBot-style alternatives, local bridge wrappers, allow-list safety, storage layout, image attachments, streaming progress, and troubleshooting remote Codex execution.
---

# QQ Codex Bridge

Use this skill when the user wants QQ to contact local Codex, Codex to contact QQ, or this remote-control capability to be packaged for other people.

## Mental Model

The QQ bot framework is transport. Codex stays the worker.

```text
QQ -> bot framework/plugin -> local Codex bridge -> codex exec -> bridge/plugin -> QQ
Codex -> notify wrapper -> bot framework OpenAPI -> QQ
```

Prefer AstrBot for production-like local setups because it owns QQ login, reconnects, plugin loading, attachments, and OpenAPI message sending. Use OneBot/NapCat/Lagrange only when the target environment already standardizes on OneBot.

## Installed Layout

Defaults:

- `CODEX_HOME=${HOME}/.codex`
- `CODEX_SERVER_ROOT=${HOME}/.codex/servers`
- Transport service: `${CODEX_SERVER_ROOT}/astrbot`
- Reusable AstrBot plugin source: `${CODEX_HOME}/plugins/astrbot_plugin_codex_remote`
- AstrBot plugin runtime copy: `${CODEX_SERVER_ROOT}/astrbot/data/plugins/astrbot_plugin_codex_remote`
- Codex bridge source: `${CODEX_HOME}/bin/codex_qq_bridge.mjs`
- Bridge wrappers: `${CODEX_HOME}/bin/codex-qq-bridge-up`, `codex-qq-bridge-down`, `codex-qq-bridge-logs`
- Codex to QQ text: `${CODEX_HOME}/bin/codex-qq-notify`
- Codex to QQ image: `${CODEX_HOME}/bin/codex-qq-notify-image`
- Codex to QQ voice: `${CODEX_HOME}/bin/codex-qq-notify-voice`
- Shared status: `${CODEX_HOME}/bin/codex-self` when installed by the wider local extensions bundle
- Bridge token: `${CODEX_SERVER_ROOT}/astrbot/data/codex_qq_bridge.token`
- AstrBot OpenAPI key: `${CODEX_SERVER_ROOT}/astrbot/data/codex_openapi_im.key`

Override `CODEX_HOME` and `CODEX_SERVER_ROOT` for custom disks or service roots. For details, read `references/astrbot-bridge.md`.

Install or refresh the AstrBot plugin runtime copy with:

```bash
${CODEX_HOME:-$HOME/.codex}/skills/qq-codex/scripts/install-astrbot-plugin.sh
```

## Storage Rules

- Put bridge source, wrappers, reusable scripts, and this skill under `${CODEX_HOME}`.
- Put reusable plugin source under `${CODEX_HOME}/plugins`; copy or mount it into the service runtime.
- Put Docker Compose stacks, bot configs, tokens, SQLite files, plugins, attachments, and runtime logs under `${CODEX_SERVER_ROOT}/<service>`.
- Do not put service state, uploads, bot secrets, or container volumes in `.codex`.
- If packaging for others, make paths configurable with environment variables while keeping these defaults documented.

## Operating Workflow

1. Confirm the QQ transport is running. For the local AstrBot setup, use the service wrappers from its own skill or compose directory.
2. Start the Codex bridge:

```bash
${CODEX_HOME:-$HOME/.codex}/bin/codex-qq-bridge-up
```

The wrapper defaults to `CODEX_QQ_BRIDGE_HOST=0.0.0.0` so Docker-hosted AstrBot can reach the host bridge. Use `CODEX_QQ_BRIDGE_HOST=127.0.0.1` when the transport runs on the host and no container access is needed.

3. Confirm health:

```bash
curl -s http://127.0.0.1:8765/status
```

4. In QQ, use `codex_ping`, `codex_status`, and `codex_cancel` for quick checks.
5. For long tasks, keep streaming progress enabled so QQ sees incremental output instead of waiting for a final reply.
6. When Codex needs to proactively contact QQ, call the notify wrappers instead of reimplementing AstrBot OpenAPI calls.

## Codex To QQ

Use text notification for status, completion, blockers, and short answers:

```bash
${CODEX_HOME:-$HOME/.codex}/bin/codex-qq-notify "任务完成：已经提交并推送。"
```

Use image notification when an artifact should be visible in QQ:

```bash
${CODEX_HOME:-$HOME/.codex}/bin/codex-qq-notify-image /absolute/path/output.png "图片生成好了"
```

Use voice notification when the user asks for voice replies:

```bash
${CODEX_HOME:-$HOME/.codex}/bin/codex-qq-notify-voice /absolute/path/reply.wav "语音回复"
```

Set `CODEX_QQ_NOTIFY_UMO` when sending to a specific QQ session. The default should point at the most recent authorized private session for the local machine.

## QQ To Codex

The inbound plugin should:

- authenticate the request with the bridge token;
- enforce QQ user/group allow-lists before invoking Codex;
- immediately acknowledge accepted work;
- forward text and host-readable image paths to the bridge;
- keep image files under the transport service data directory;
- enable stream progress for long runs;
- expose status and cancel commands.

The bridge should call Codex CLI with a trusted local policy only after the allow-list check has happened. Keep one outward voice, usually `大管家`, even if internal agents are used.

## Safety

- Treat every allowed QQ account as able to operate this machine through Codex.
- Keep the bridge bound to localhost or a trusted private network; if binding `0.0.0.0` for Docker access, rely on local firewalling plus the bridge token and QQ allow-list.
- Never put bridge tokens, QQ secrets, OpenAPI keys, or GitHub tokens in final replies, logs meant for users, or committed files.
- Before committing this capability, run a tracked-file secret scan for common token prefixes.
- Use `codex-self` for status summaries and keep them short; do not put secrets or large logs in status text.

## Troubleshooting

- If QQ messages arrive but no Codex work starts, check the AstrBot plugin config and bridge token path.
- If Codex runs but QQ sees no progress, inspect `stream_progress_enabled`, AstrBot OpenAPI key scope, and `${CODEX_HOME}/bin/codex-qq-bridge-logs`.
- If images are ignored, ensure the plugin maps `/AstrBot/data` to `${CODEX_SERVER_ROOT}/astrbot/data` and passes readable host paths to Codex.
- If proactive QQ messages fail, verify `ASTRBOT_URL`, `ASTRBOT_OPENAPI_KEY_FILE`, and `CODEX_QQ_NOTIFY_UMO`.
- If the user asks for a reusable packaging pass, update this skill and the bridge wrappers together, then commit and push the `.codex` repo.
