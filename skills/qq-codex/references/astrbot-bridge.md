# AstrBot Bridge Reference

This reference describes the local, reusable QQ-Codex bridge pattern.

## Components

| Direction | Component | Role |
| --- | --- | --- |
| QQ -> Codex | AstrBot | QQ login, platform transport, plugin host |
| QQ -> Codex | `astrbot_plugin_codex_remote` | Extracts QQ text/images, checks commands, calls bridge |
| QQ -> Codex | `codex_qq_bridge.mjs` | Queues work, invokes `codex exec`, exposes status/cancel/chat APIs |
| Codex -> QQ | `codex-qq-notify*` | Sends text, image, or voice through AstrBot OpenAPI |
| Any -> UI | `codex-self` | Publishes Codex status for QQ, web, Live2D, and voice surfaces |

## Host Paths

Keep these defaults portable by allowing environment overrides:

```text
CODEX_HOME=$HOME/.codex
CODEX_SERVER_ROOT=$HOME/.codex/servers
ASTRBOT_HOME=$CODEX_SERVER_ROOT/astrbot
CODEX_QQ_BRIDGE_URL=http://127.0.0.1:8765
CODEX_QQ_BRIDGE_HOST=0.0.0.0
ASTRBOT_URL=http://127.0.0.1:6185
CODEX_QQ_TOKEN_FILE=$ASTRBOT_HOME/data/codex_qq_bridge.token
ASTRBOT_OPENAPI_KEY_FILE=$ASTRBOT_HOME/data/codex_openapi_im.key
CODEX_QQ_NOTIFY_UMO=<AstrBot unified message origin>
CODEX_QQ_SECRET_DROP_FILE=/tmp/github_token
```

`CODEX_QQ_TOKEN_FILE` is shared between the AstrBot plugin and the bridge. `ASTRBOT_OPENAPI_KEY_FILE` is used by the notify wrappers and needs `im` scope for text, plus `file` scope for image or voice attachments.

Keep reusable plugin source in `${CODEX_HOME}/plugins/astrbot_plugin_codex_remote`. Copy or mount that source into `${ASTRBOT_HOME}/data/plugins/astrbot_plugin_codex_remote` for the running service.

The bundled helper performs that copy:

```bash
CODEX_HOME=/path/to/.codex \
CODEX_SERVER_ROOT=/path/to/servers \
/path/to/.codex/skills/qq-codex/scripts/install-astrbot-plugin.sh
```

## Inbound Flow

1. QQ user sends a private or group message.
2. AstrBot routes the message to `astrbot_plugin_codex_remote`.
3. The plugin handles commands:
   - `codex_ping`
   - `codex_status`
   - `codex_cancel`
4. For work requests, the plugin extracts text and up to the configured number of image attachments.
5. The plugin posts a JSON request to the bridge with:
   - message text;
   - workspace;
   - authorization token;
   - attachment metadata;
   - stream progress settings;
   - UMO for progress replies.
6. The Node bridge queues the run and invokes local `codex exec`.
7. The bridge streams progress back through AstrBot OpenAPI and returns the final reply.

## Outbound Flow

Codex should use wrappers:

```bash
codex-qq-notify "text"
codex-qq-notify-image /absolute/path.png "optional text"
codex-qq-notify-voice /absolute/path.wav "optional text"
```

Wrappers read the OpenAPI key from `ASTRBOT_OPENAPI_KEY_FILE`, send to `CODEX_QQ_NOTIFY_UMO`, and fail fast when the key or target session is missing.

## Bridge HTTP API

Common endpoints on `codex_qq_bridge.mjs`:

- `GET /status`: current queue, running task, and self-status snapshot.
- `POST /cancel`: cancel the running task.
- `POST /run`: enqueue a QQ-originated work request.
- `POST /chat`: enqueue a local/browser-originated request.
- `GET /chat/stream`: Server-Sent Events for local status/chat display.
- `POST /self/status`: publish Codex self-status.
- `DELETE /self/status`: clear Codex self-status.

Keep this API local unless an explicit reverse proxy and authentication design exists.

## Packaging Checklist

- [ ] Bridge source and wrappers live under `${CODEX_HOME}/bin`.
- [ ] The reusable skill lives under `${CODEX_HOME}/skills/qq-codex`.
- [ ] Reusable AstrBot plugin source lives under `${CODEX_HOME}/plugins/astrbot_plugin_codex_remote`.
- [ ] Transport service, plugin runtime data, tokens, and attachments live under `${CODEX_SERVER_ROOT}/astrbot`.
- [ ] Start/stop/log wrappers exist for the bridge.
- [ ] The plugin or transport has a QQ user/group allow-list.
- [ ] The bridge returns immediate acknowledgement, status, cancel, streaming progress, and final answer.
- [ ] Notify wrappers support text, images, and voice.
- [ ] Tracked files do not contain token prefixes such as `github_pat_`, `ghp_`, `GH_TOKEN`, `GITHUB_TOKEN`, bridge tokens, AppSecret, or OpenAPI keys.
- [ ] Git commit and push update the development repository after packaging.
