from __future__ import annotations

import asyncio
import json
import mimetypes
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, filter
import astrbot.api.message_components as Comp
from astrbot.api.star import Context, Star


GITHUB_TOKEN_RE = re.compile(
    r"\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"
)
GITHUB_TOKEN_COMMAND_RE = re.compile(
    r"^(?:github[-_\s]*(?:token|pat)|gh[-_\s]*(?:token|pat)|github密钥|github令牌)[:：\s]+",
    re.I,
)


class CodexRemotePlugin(Star):
    def __init__(self, context: Context, config: dict | None = None):
        super().__init__(context)
        self.config = config or {}
        self.history_mgr = context.message_history_manager
        self.db = getattr(self.history_mgr, "db", None)
        self.zh_converter = self._load_zh_converter()

    @filter.platform_adapter_type(
        filter.PlatformAdapterType.QQOFFICIAL
        | filter.PlatformAdapterType.QQOFFICIAL_WEBHOOK
        | filter.PlatformAdapterType.AIOCQHTTP,
    )
    @filter.event_message_type(filter.EventMessageType.ALL)
    async def forward_to_codex(self, event: AstrMessageEvent):
        """Forward QQ messages to local Codex."""
        message = self._normalize_incoming_text(
            event.message_str or event.get_message_outline() or ""
        )
        if not message:
            return

        prefix = self._normalize_incoming_text(
            str(self.config.get("handle_prefix") or "")
        )
        if prefix:
            if not message.startswith(prefix):
                return
            message = message[len(prefix) :].strip()
            if not message:
                event.should_call_llm(True)
                yield event.plain_result("收到前缀了，但后面没有任务内容。")
                event.stop_event()
                return

        event.should_call_llm(True)

        sender_id = event.get_sender_id()
        allowed = self._list_config("allowed_sender_ids")
        if allowed and sender_id not in allowed:
            logger.warning("Rejected Codex remote request from sender_id=%s", sender_id)
            yield event.plain_result("这个 QQ 账号还没有授权使用 Codex 远程入口。")
            event.stop_event()
            return

        normalized = self._normalize_command(message)
        if normalized in {"/codex_ping", "codex_ping"}:
            await self._record_chat_event(event, "in", "message", message, persist=False)
            reply = await asyncio.to_thread(self._health)
            await self._record_chat_event(event, "out", "health", reply, persist=False)
            yield event.plain_result(reply)
            event.stop_event()
            return
        if normalized in {"/codex_status", "codex_status"} or self._is_status_request(message):
            await self._record_chat_event(event, "in", "message", message, persist=False)
            reply = await asyncio.to_thread(self._status)
            await self._record_chat_event(event, "out", "status", reply, persist=False)
            yield event.plain_result(reply)
            event.stop_event()
            return
        if normalized in {"/codex_cancel", "codex_cancel"} or self._is_cancel_request(message):
            await self._record_chat_event(event, "in", "message", message, persist=False)
            reply = await asyncio.to_thread(self._cancel)
            await self._record_chat_event(event, "out", "cancel", reply, persist=False)
            yield event.plain_result(reply)
            event.stop_event()
            return
        token = self._extract_github_token_delivery(message)
        if token:
            reply = await asyncio.to_thread(self._save_secret_drop_file, token)
            await self._record_chat_event(
                event,
                "in",
                "secret",
                "GitHub token 已通过安全投递接收，内容不展示。",
                persist=False,
            )
            await self._record_chat_event(event, "out", "secret", reply, persist=False)
            yield event.plain_result(reply)
            event.stop_event()
            return

        image_attachments = await self._image_attachments(event)
        history = await self._recent_history(event)
        await self._record_chat_event(
            event,
            "in",
            "message",
            self._message_with_attachment_summary(message, image_attachments),
        )

        ack = str(self.config.get("ack_message") or "")
        if ack:
            await self._record_chat_event(event, "out", "ack", ack, persist=False)
            yield event.plain_result(ack)

        task = asyncio.create_task(
            asyncio.to_thread(
                self._call_bridge,
                event,
                message,
                history,
                image_attachments,
            )
        )
        reply: str | None = None
        stream_enabled = self._bool_config("stream_progress_enabled", True)
        if self._bool_config("progress_enabled", True) and not stream_enabled:
            started = time.monotonic()
            wait_seconds = self._int_config("progress_first_seconds", 15, minimum=1)
            interval_seconds = self._int_config("progress_interval_seconds", 30, minimum=5)
            while reply is None:
                try:
                    reply = await asyncio.wait_for(asyncio.shield(task), timeout=wait_seconds)
                except asyncio.TimeoutError:
                    elapsed = int(time.monotonic() - started)
                    progress = await asyncio.to_thread(self._progress_text, elapsed)
                    await self._record_chat_event(event, "out", "progress", progress, persist=False)
                    yield event.plain_result(progress)
                    wait_seconds = interval_seconds
        else:
            reply = await task

        final_reply = self._trim_reply(reply)
        await self._record_chat_event(event, "out", "final", final_reply)
        voice_enabled = self._bool_config("voice_reply_enabled", True)
        include_text = self._bool_config("voice_reply_include_text", True)
        if include_text or not voice_enabled:
            yield event.plain_result(final_reply)
        if voice_enabled:
            voice_result = await asyncio.to_thread(self._voice_reply, final_reply)
            if voice_result:
                path = voice_result["container_path"]
                yield event.chain_result([Comp.Record(file=path, url=path)])
            elif not include_text:
                yield event.plain_result(final_reply)
        event.stop_event()

    def _list_config(self, key: str) -> list[str]:
        value = self.config.get(key, [])
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if isinstance(value, str) and value.strip():
            return [item.strip() for item in value.split(",") if item.strip()]
        return []

    def _normalize_command(self, message: str) -> str:
        return self._redact_secrets(message).strip().lower().replace("！", "!").replace("？", "?")

    def _redact_secrets(self, text: str) -> str:
        return GITHUB_TOKEN_RE.sub("[REDACTED_GITHUB_TOKEN]", str(text or ""))

    def _find_github_token(self, text: str) -> str:
        match = GITHUB_TOKEN_RE.search(str(text or ""))
        return match.group(0) if match else ""

    def _extract_github_token_delivery(self, text: str) -> str:
        value = str(text or "").strip()
        token = self._find_github_token(value)
        if not token:
            return ""
        remainder = GITHUB_TOKEN_RE.sub("", value).strip()
        if not remainder or GITHUB_TOKEN_COMMAND_RE.match(value):
            return token
        return ""

    def _secret_drop_file(self) -> Path:
        return Path(str(self.config.get("secret_drop_file") or "/tmp/github_token"))

    def _save_secret_drop_file(self, token: str) -> str:
        target = self._secret_drop_file()
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(token.strip(), encoding="utf-8")
            target.chmod(0o600)
            return "GitHub token 已安全保存到本机临时文件，我现在可以继续建仓和推送。用完会删除。"
        except Exception as exc:
            logger.warning("GitHub token secure delivery failed: %s", exc)
            return f"GitHub token 保存失败: {exc}"

    def _is_status_request(self, message: str) -> bool:
        text = self._normalize_command(message)
        if len(text) > 80:
            return False
        status_terms = ("进度", "状态", "status", "跑到哪", "做到哪", "到哪了", "还在跑", "还没好", "好了没")
        if any(term in text for term in status_terms):
            return True
        stuck_markers = ("吗", "么", "是不是", "看看", "你卡", "卡住了啊", "?")
        return "卡住" in text and any(marker in text for marker in stuck_markers)

    def _is_cancel_request(self, message: str) -> bool:
        text = self._normalize_command(message)
        cancel_terms = ("取消任务", "取消当前", "停掉", "别跑了", "停止任务", "cancel", "abort", "kill")
        return any(term in text for term in cancel_terms) and len(text) <= 80

    def _history_platform_id(self, event: AstrMessageEvent) -> str:
        return str(self.config.get("history_platform_id") or event.get_platform_name() or "qq_remote")

    def _history_session_id(self, event: AstrMessageEvent) -> str:
        raw = str(event.unified_msg_origin or event.get_sender_id() or "default")
        value = re.sub(r"[^A-Za-z0-9_.:-]+", "_", raw).strip("_")
        return value[-100:] or "default"

    def _message_parts(self, text: str) -> list[dict[str, str]]:
        return [{"type": "plain", "text": str(text or "")}]

    def _history_content(self, role: str, text: str) -> dict[str, Any]:
        content_type = "user" if role == "in" else "bot"
        return {"type": content_type, "message": self._message_parts(self._redact_secrets(text))}

    def _history_creator(self) -> str:
        return str(self.config.get("history_creator") or "astrbot")

    async def _ensure_history_session(self, event: AstrMessageEvent) -> None:
        if not self.db or not self._bool_config("astrbot_history_enabled", True):
            return
        session_id = self._history_session_id(event)
        try:
            existing = await self.db.get_platform_session_by_id(session_id)
            if existing:
                await self.db.update_platform_session(session_id=session_id)
                return
            display = event.get_sender_name() or event.get_sender_id() or session_id
            await self.db.create_platform_session(
                creator=self._history_creator(),
                platform_id=self._history_platform_id(event),
                session_id=session_id,
                display_name=f"QQ Remote: {display}",
                is_group=1 if event.get_group_id() else 0,
            )
        except Exception as exc:
            logger.debug("Codex history session update failed: %s", exc)

    async def _append_astrbot_history(
        self,
        event: AstrMessageEvent,
        role: str,
        text: str,
    ) -> None:
        if not self._bool_config("astrbot_history_enabled", True):
            return
        try:
            await self._ensure_history_session(event)
            await self.history_mgr.insert(
                platform_id=self._history_platform_id(event),
                user_id=self._history_session_id(event),
                content=self._history_content(role, text),
                sender_id=event.get_sender_id() if role == "in" else "codex",
                sender_name=event.get_sender_name() if role == "in" else "大管家",
            )
        except Exception as exc:
            logger.debug("Codex AstrBot history insert failed: %s", exc)

    def _plain_text_from_history_content(self, content: Any) -> str:
        if not isinstance(content, dict):
            return ""
        parts = content.get("message")
        if not isinstance(parts, list):
            return ""
        texts: list[str] = []
        for part in parts:
            if isinstance(part, dict) and part.get("type") == "plain":
                text = part.get("text")
                if isinstance(text, str):
                    texts.append(self._redact_secrets(text))
        return "".join(texts).strip()

    def _message_with_attachment_summary(
        self,
        text: str,
        attachments: list[dict[str, Any]],
    ) -> str:
        image_count = sum(1 for item in attachments if item.get("type") == "image")
        if not image_count:
            return self._redact_secrets(text)
        summary = f"[图片附件 {image_count} 个]"
        return f"{self._redact_secrets(text)}\n{summary}".strip()

    def _is_image_component(self, comp: Any) -> bool:
        comp_type = getattr(comp, "type", "")
        comp_type = getattr(comp_type, "value", comp_type)
        return str(comp_type or comp.__class__.__name__).lower() == "image"

    async def _image_attachments(self, event: AstrMessageEvent) -> list[dict[str, Any]]:
        if not self._bool_config("image_input_enabled", True):
            return []
        limit = self._int_config("max_image_attachments", 4, minimum=0)
        if limit <= 0:
            return []

        attachments: list[dict[str, Any]] = []
        for comp in event.get_messages():
            if len(attachments) >= limit:
                break
            if not self._is_image_component(comp):
                continue
            attachments.append(await self._image_attachment(comp, len(attachments) + 1))
        return attachments

    async def _image_attachment(self, comp: Any, index: int) -> dict[str, Any]:
        raw_file = str(getattr(comp, "file", "") or "").strip()
        raw_url = str(getattr(comp, "url", "") or "").strip()
        source = raw_url or raw_file
        local_path = ""
        error = ""

        converter = getattr(comp, "convert_to_file_path", None)
        if callable(converter):
            try:
                local_path = str(await converter())
            except Exception as exc:
                error = str(exc)

        if not local_path:
            local_path = self._path_from_media_ref(source)

        host_path = self._host_file_path(local_path)
        name = self._attachment_name(host_path or source, index)
        item: dict[str, Any] = {
            "type": "image",
            "index": index,
            "name": name,
            "path": host_path,
            "container_path": local_path if local_path and local_path != host_path else "",
            "url": raw_url if raw_url.startswith(("http://", "https://")) else "",
            "source": self._safe_media_ref(source),
            "mime_type": mimetypes.guess_type(host_path or name)[0] or "",
            "error": error[:240] if error else "",
        }
        return {key: value for key, value in item.items() if value not in ("", None)}

    def _path_from_media_ref(self, ref: str) -> str:
        value = str(ref or "").strip()
        if not value:
            return ""
        if value.startswith("file://"):
            parsed = urllib.parse.urlparse(value)
            return urllib.request.url2pathname(parsed.path)
        if value.startswith(("http://", "https://", "base64://")):
            return ""
        return value

    def _host_file_path(self, file_path: str) -> str:
        value = str(file_path or "").strip()
        if not value:
            return ""
        container_root = str(self.config.get("container_data_root") or "/AstrBot/data").rstrip("/")
        host_root = str(
            self.config.get("host_data_root") or "/Volumes/ssd/servers/astrbot/data"
        ).rstrip("/")
        if value == container_root:
            return host_root
        if value.startswith(container_root + "/"):
            return host_root + value[len(container_root) :]
        return value

    def _attachment_name(self, value: str, index: int) -> str:
        cleaned = str(value or "").split("?", 1)[0].rstrip("/")
        name = Path(cleaned).name
        return name or f"image-{index}"

    def _safe_media_ref(self, ref: str) -> str:
        value = str(ref or "").strip()
        if value.startswith("base64://"):
            return "base64://[omitted]"
        if len(value) > 500:
            return value[:500] + "..."
        return value

    async def _recent_history(self, event: AstrMessageEvent) -> list[dict[str, str]]:
        if not self._bool_config("context_history_enabled", True):
            return []
        limit = self._int_config("context_history_messages", 12, minimum=0)
        if limit <= 0:
            return []
        try:
            records = await self.history_mgr.get(
                platform_id=self._history_platform_id(event),
                user_id=self._history_session_id(event),
                page=1,
                page_size=limit,
            )
        except Exception as exc:
            logger.debug("Codex recent history load failed: %s", exc)
            return []

        items: list[dict[str, str]] = []
        for record in records[-limit:]:
            content = getattr(record, "content", None)
            text = self._plain_text_from_history_content(content)
            if not text:
                continue
            role = "user" if isinstance(content, dict) and content.get("type") == "user" else "assistant"
            items.append({"role": role, "text": text})
        return items

    def _token(self) -> str:
        token_file = str(self.config.get("token_file") or "")
        if not token_file:
            return ""
        try:
            return Path(token_file).read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            logger.error("Codex bridge token file not found: %s", token_file)
            return ""

    def _bridge_base_url(self) -> str:
        bridge_url = str(self.config.get("bridge_url") or "").rstrip("/")
        return bridge_url.removesuffix("/run").rstrip("/")

    def _bridge_json(
        self,
        path: str,
        *,
        method: str = "GET",
        payload: dict[str, Any] | None = None,
        timeout: int = 5,
    ) -> dict[str, Any]:
        base_url = self._bridge_base_url()
        if not base_url:
            return {"ok": False, "reply": "Codex 桥地址为空。"}

        data = None
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            base_url + path,
            data=data,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "X-Codex-Bridge-Token": self._token(),
            },
            method=method,
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _voice_reply(self, text: str) -> dict[str, str] | None:
        if not self._bool_config("voice_reply_enabled", True):
            return None
        value = str(text or "").strip()
        if not value:
            return None

        payload = {
            "text": value,
            "host_dir": str(
                self.config.get("voice_reply_host_dir")
                or "/Volumes/ssd/servers/astrbot/data/codex_voice_replies"
            ),
            "container_dir": str(
                self.config.get("voice_reply_container_dir")
                or "/AstrBot/data/codex_voice_replies"
            ),
            "engine": str(self.config.get("voice_reply_engine") or "edge"),
            "voice": str(self.config.get("voice_reply_voice") or "zh-TW-HsiaoChenNeural"),
            "rate": self._int_config("voice_reply_rate", 190, minimum=80),
            "speed": self._float_config("voice_reply_speed", 0.98, minimum=0.5),
            "max_chars": self._int_config("voice_reply_max_chars", 600, minimum=80),
        }
        try:
            data = self._bridge_json(
                "/voice/synthesize",
                method="POST",
                payload=payload,
                timeout=self._int_config("voice_reply_timeout_seconds", 120, minimum=10),
            )
        except Exception as exc:
            logger.warning("Codex voice reply synthesis failed: %s", exc)
            return None

        voice = data.get("voice_reply") if isinstance(data, dict) else None
        if not isinstance(voice, dict):
            logger.warning("Codex voice reply returned no voice metadata: %s", data)
            return None
        container_path = str(voice.get("container_path") or "").strip()
        if not container_path:
            logger.warning("Codex voice reply returned empty container path: %s", voice)
            return None
        return {"container_path": container_path}

    async def _record_chat_event(
        self,
        event: AstrMessageEvent,
        role: str,
        kind: str,
        text: str,
        *,
        persist: bool = True,
    ) -> None:
        if persist:
            await self._append_astrbot_history(event, role, text)
        try:
            await asyncio.to_thread(
                self._bridge_json,
                "/chat/event",
                method="POST",
                payload={
                    "role": role,
                    "kind": kind,
                    "text": text,
                    "session_id": event.unified_msg_origin,
                    "platform": event.get_platform_name(),
                    "sender_name": event.get_sender_name(),
                },
                timeout=3,
            )
        except Exception as exc:
            logger.debug("Codex chat mirror event failed: %s", exc)

    def _health(self) -> str:
        try:
            data = self._bridge_json("/health", timeout=5)
            return "Codex 桥已连接。" if data.get("ok") else f"Codex 桥异常: {data}"
        except Exception as exc:
            return f"Codex 桥未连接: {exc}"

    def _status(self) -> str:
        try:
            data = self._bridge_json("/status", timeout=5)
        except Exception as exc:
            return f"Codex 状态查询失败: {exc}"

        running = data.get("running")
        pending = int(data.get("pending_count") or 0)
        if running:
            elapsed = self._format_duration(int(running.get("elapsed_seconds") or 0))
            preview = str(running.get("message_preview") or "").strip()
            lines = [f"大管家正在处理，已用 {elapsed}，队列等待 {pending} 个。"]
            detail = self._running_detail(running)
            if detail:
                lines.append(f"当前状态：{detail}")
            idle_seconds = running.get("last_activity_seconds_ago")
            if isinstance(idle_seconds, int) and idle_seconds >= 45:
                lines.append(f"最近可见活动：{self._format_duration(idle_seconds)}前。")
            if preview:
                lines.append(f"任务：{preview}")
            return "\n".join(lines)
        lines = [f"大管家空闲，队列等待 {pending} 个。"]
        last_run = data.get("last_run")
        if isinstance(last_run, dict):
            lines.append(self._last_run_summary(last_run))
        return "\n".join(line for line in lines if line)

    def _cancel(self) -> str:
        try:
            data = self._bridge_json("/cancel", method="POST", payload={}, timeout=5)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            return f"大管家取消失败 HTTP {exc.code}: {body}"
        except Exception as exc:
            return f"大管家取消失败: {exc}"
        return str(data.get("reply") or data)

    def _call_bridge(
        self,
        event: AstrMessageEvent,
        message: str,
        history: list[dict[str, str]] | None = None,
        attachments: list[dict[str, Any]] | None = None,
    ) -> str:
        bridge_url = str(self.config.get("bridge_url") or "")
        if not bridge_url:
            return "Codex 桥地址为空。"

        payload: dict[str, Any] = {
            "message": self._redact_secrets(message),
            "message_outline": self._redact_secrets(event.get_message_outline()),
            "message_type": str(event.get_message_type()),
            "sender_id": event.get_sender_id(),
            "sender_name": event.get_sender_name(),
            "group_id": event.get_group_id(),
            "session_id": event.unified_msg_origin,
            "platform": event.get_platform_name(),
            "platform_id": event.get_platform_id(),
            "history": history or [],
            "attachments": attachments or [],
            "mode": str(self.config.get("mode") or "exec"),
            "timeout_seconds": int(self.config.get("timeout_seconds") or 900),
            "stream_progress_enabled": self._bool_config("stream_progress_enabled", True),
            "stream_progress_umo": event.unified_msg_origin,
            "stream_progress_interval_seconds": self._int_config(
                "stream_progress_interval_seconds", 6, minimum=2
            ),
            "stream_progress_detail_chars": self._int_config(
                "stream_progress_detail_chars", 520, minimum=80
            ),
        }
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            bridge_url,
            data=raw,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "X-Codex-Bridge-Token": self._token(),
            },
            method="POST",
        )
        timeout = int(self.config.get("timeout_seconds") or 900) + 15
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            try:
                data = json.loads(body)
                return str(data.get("reply") or data.get("error") or body)
            except Exception:
                return f"Codex 桥 HTTP {exc.code}: {body}"
        except Exception as exc:
            return f"Codex 桥调用失败: {exc}"

        return str(data.get("reply") or data)

    def _trim_reply(self, reply: str) -> str:
        max_chars = int(self.config.get("max_reply_chars") or 3500)
        if max_chars <= 0 or len(reply) <= max_chars:
            return reply
        return reply[:max_chars] + "\n\n[回复过长，已截断]"

    def _load_zh_converter(self):
        if not self._bool_config("incoming_simplify_chinese", True):
            return None
        try:
            from opencc import OpenCC  # type: ignore

            return OpenCC("t2s")
        except Exception as exc:
            logger.debug("OpenCC is not available; using lightweight fallback: %s", exc)
            return None

    def _simplify_chinese(self, text: str) -> str:
        if not text:
            return text
        if self.zh_converter:
            try:
                return self.zh_converter.convert(text)
            except Exception as exc:
                logger.debug("OpenCC conversion failed: %s", exc)

        table = str.maketrans(
            {
                "妳": "你",
                "嗎": "吗",
                "麼": "么",
                "為": "为",
                "進": "进",
                "狀": "状",
                "態": "态",
                "還": "还",
                "沒": "没",
                "語": "语",
                "聲": "声",
                "識": "识",
                "別": "别",
                "聽": "听",
                "幹": "干",
                "後": "后",
                "裡": "里",
                "裏": "里",
                "發": "发",
                "這": "这",
                "個": "个",
                "對": "对",
                "話": "话",
                "開": "开",
                "關": "关",
                "復": "复",
                "聯": "联",
                "繫": "系",
                "務": "务",
                "處": "处",
            }
        )
        return text.translate(table)

    def _clean_stt_text(self, text: str) -> str:
        if not self._bool_config("stt_cleanup_enabled", True):
            return text
        text = text.replace("\u3000", " ")
        text = re.sub(r"\s+", " ", text).strip()
        text = re.sub(r"^[，。！？、,.!?；;：:\s]+", "", text)
        text = re.sub(r"[，,]\s*[，,]+", "，", text)
        text = self._repair_common_stt_errors(text)

        normalized = re.sub(r"\s+", "", text).lower()
        noise = {
            "字幕由amara.org社区提供",
            "字幕由amára.org社区提供",
            "谢谢观看",
            "感谢观看",
            "请不吝点赞订阅转发打赏支持明镜与点点栏目",
        }
        if normalized in noise:
            return ""
        return text

    def _repair_common_stt_errors(self, text: str) -> str:
        text = re.sub(r"语音[试是式事]别", "语音识别", text)
        text = re.sub(r"(?<=语音识别)很?不转", lambda match: match.group(0).replace("不转", "不准"), text)
        text = re.sub(r"^小梦与阴", "小墨语音", text)
        text = re.sub(r"^小梦与音", "小墨语音", text)
        text = re.sub(r"^小梦语音", "小墨语音", text)
        return text

    def _normalize_incoming_text(self, text: str) -> str:
        normalized = str(text or "").strip()
        if self._bool_config("incoming_simplify_chinese", True):
            normalized = self._simplify_chinese(normalized)
        return self._clean_stt_text(normalized)

    def _bool_config(self, key: str, default: bool) -> bool:
        value = self.config.get(key, default)
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() not in {"", "0", "false", "no", "off"}
        return bool(value)

    def _int_config(self, key: str, default: int, *, minimum: int) -> int:
        try:
            value = int(self.config.get(key) or default)
        except (TypeError, ValueError):
            value = default
        return max(minimum, value)

    def _float_config(self, key: str, default: float, *, minimum: float) -> float:
        try:
            value = float(self.config.get(key) or default)
        except (TypeError, ValueError):
            value = default
        return max(minimum, value)

    def _format_duration(self, seconds: int) -> str:
        seconds = max(0, seconds)
        minutes, secs = divmod(seconds, 60)
        if minutes:
            return f"{minutes}分{secs}秒"
        return f"{secs}秒"

    def _running_detail(self, running: dict[str, Any]) -> str:
        detail = str(
            running.get("last_output")
            or running.get("phase")
            or ""
        ).strip()
        if not detail:
            return ""
        detail = re.sub(r"\s+", " ", detail)
        max_chars = self._int_config("progress_detail_chars", 180, minimum=40)
        if len(detail) > max_chars:
            return detail[:max_chars] + "..."
        return detail

    def _last_run_summary(self, run: dict[str, Any]) -> str:
        ok = bool(run.get("ok"))
        status = "成功" if ok else "失败"
        elapsed = self._format_duration(int(run.get("elapsed_seconds") or 0))
        preview = str(run.get("message_preview") or "").strip()
        reply = str(run.get("reply_preview") or "").strip()
        lines = [f"最近任务：{status}，耗时 {elapsed}。"]
        if preview:
            lines.append(f"任务：{preview}")
        if reply:
            reply = re.sub(r"\s+", " ", reply)
            if len(reply) > 120:
                reply = reply[:120] + "..."
            lines.append(f"结果：{reply}")
        return "\n".join(lines)

    def _progress_text(self, elapsed_seconds: int) -> str:
        status = self._status()
        if status.startswith("大管家正在处理"):
            return f"进度更新：\n{status}\n本次请求已等待 {self._format_duration(elapsed_seconds)}。"
        return f"进度：大管家仍在组织处理，本次请求已等待 {self._format_duration(elapsed_seconds)}。\n{status}"
