# Dependencies

## Runtime

- Node.js 20+ for `bin/codex_qq_bridge.mjs`.
- Codex CLI on `PATH`, or set `CODEX_BIN=/absolute/path/to/codex`.
- AstrBot with QQ Official Bot, QQ Official Webhook, or aiocqhttp/OneBot adapter.
- AstrBot OpenAPI with `im` scope for text and `file` scope for images/voice.
- macOS/Linux/WSL shell wrappers use `screen`, `curl`, `lsof`, `python3`, and standard Unix shell tools.
- Windows installation and basic bridge control use PowerShell 5+ or PowerShell 7+.
- macOS `afconvert` is required for QQ voice conversion in `codex-qq-notify-voice`.

Docker is not required to install this plugin. It is only needed when the
selected AstrBot deployment runs as a Docker service.

## Python / AstrBot Plugin Libraries

- `astrbot.api` modules supplied by the AstrBot runtime.
- Python standard library: `asyncio`, `json`, `mimetypes`, `re`, `time`,
  `urllib`, `pathlib`, and `typing`.
- Optional `opencc` for Traditional-to-Simplified Chinese normalization.

## Node Libraries

The bridge intentionally uses only Node built-in modules:

- `node:http`
- `node:https`
- `node:child_process`
- `node:crypto`
- `node:fs`
- `node:os`
- `node:path`
- `node:url`

## Optional Voice Backends

- `edge-tts` for softer neural voice replies.
- Kokoro local TTS through `codex_kokoro_tts.py` from the voice stack.
- IndexTTS2 through `index-tts2-say` from the voice stack.
- macOS `say` as a fallback.
