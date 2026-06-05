#!/usr/bin/env node
import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8765;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CODEX_HOME = process.env.CODEX_HOME || path.resolve(SCRIPT_DIR, "..");
const DEFAULT_SERVER_ROOT = process.env.CODEX_SERVER_ROOT || "/Volumes/ssd/servers";
const DEFAULT_ASTRBOT_HOME = process.env.ASTRBOT_HOME || path.join(DEFAULT_SERVER_ROOT, "astrbot");
const DEFAULT_VOICE_TTS_HOME = process.env.VOICE_TTS_HOME || path.join(DEFAULT_SERVER_ROOT, "voice-tts");
const DEFAULT_WORKSPACE = DEFAULT_CODEX_HOME;
const DEFAULT_TOKEN_FILE = path.join(DEFAULT_ASTRBOT_HOME, "data/codex_qq_bridge.token");
const DEFAULT_CODEX_BIN = "/Applications/Codex.app/Contents/Resources/codex";
const DEFAULT_RUN_LEDGER_FILE = path.join(DEFAULT_CODEX_HOME, "logs/codex-qq-bridge/runs.jsonl");
const DEFAULT_SECRET_DROP_FILE = "/tmp/github_token";
const DEFAULT_ASTRBOT_URL = "http://127.0.0.1:6185";
const DEFAULT_ASTRBOT_OPENAPI_KEY_FILE = path.join(DEFAULT_ASTRBOT_HOME, "data/codex_openapi_im.key");
const DEFAULT_VOICE_REPLY_HOST_DIR = path.join(DEFAULT_ASTRBOT_HOME, "data/codex_voice_replies");
const DEFAULT_VOICE_REPLY_CONTAINER_DIR = "/AstrBot/data/codex_voice_replies";
const DEFAULT_VOICE_REPLY_ENGINE = "edge";
const DEFAULT_VOICE_REPLY_VOICE = "zh-TW-HsiaoChenNeural";
const DEFAULT_VOICE_REPLY_RATE = 190;
const DEFAULT_VOICE_REPLY_SPEED = 0.98;
const DEFAULT_KOKORO_TTS_BIN = path.join(DEFAULT_VOICE_TTS_HOME, ".venv/bin/python");
const DEFAULT_KOKORO_TTS_SCRIPT = path.join(DEFAULT_CODEX_HOME, "bin/codex_kokoro_tts.py");
const DEFAULT_EDGE_TTS_BIN = path.join(DEFAULT_VOICE_TTS_HOME, ".venv/bin/edge-tts");
const DEFAULT_INDEX_TTS2_SAY_BIN = path.join(DEFAULT_CODEX_HOME, "bin/index-tts2-say");
const DEFAULT_INDEX_TTS2_OUTPUT_DIR = path.join(DEFAULT_VOICE_TTS_HOME, "outputs/index-tts2");
const DEFAULT_VOICE_REPLY_MAX_CHARS = 600;
const DEFAULT_VOICE_REPLY_SAMPLE_RATE = 24000;
const VOICE_REPLY_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_CAPTURE_BYTES = 1024 * 1024;
const MAX_CHAT_EVENTS = 300;
const MAX_PROGRESS_TEXT_BYTES = 1200;
const MAX_PROGRESS_TAIL_BYTES = 4000;
const MAX_RECENT_RUNS = 30;
const MAX_IMAGE_ATTACHMENTS = 4;
const DEFAULT_STREAM_PROGRESS_INTERVAL_SECONDS = 6;
const DEFAULT_STREAM_PROGRESS_DETAIL_CHARS = 520;
const DEFAULT_SELF_STATUS_TTL_SECONDS = 20 * 60;
const STREAM_PROGRESS_MIN_CHARS = 8;
const GITHUB_TOKEN_PATTERN_SOURCE = "\\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\\b";
const GITHUB_TOKEN_COMMAND_PATTERN = /^(?:github[-_\s]*(?:token|pat)|gh[-_\s]*(?:token|pat)|github密钥|github令牌)[:：\s]+/i;

let runQueue = Promise.resolve();
let pendingCount = 0;
let currentRun = null;
let activeChild = null;
let nextChatEventId = 1;
const chatEvents = [];
const recentRuns = [];
const sseClients = new Set();
let selfStatus = null;

const CHAT_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Codex 大管家</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --panel: #ffffff;
      --line: #d8dee8;
      --text: #17202e;
      --muted: #647187;
      --qq: #0f766e;
      --codex: #294b7a;
      --system: #6d5f2f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    .app {
      height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr auto;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    h1 {
      margin: 0;
      font-size: 17px;
      font-weight: 650;
      letter-spacing: 0;
    }
    .meta {
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    button {
      height: 32px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 12px;
      background: #fff;
      color: var(--text);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    button:hover { background: #f0f3f7; }
    main {
      min-height: 0;
      overflow-y: auto;
      padding: 18px;
    }
    .composer {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      padding: 12px 18px 16px;
      border-top: 1px solid var(--line);
      background: var(--panel);
    }
    textarea {
      width: 100%;
      min-height: 48px;
      max-height: 150px;
      resize: vertical;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 9px 10px;
      color: var(--text);
      font: inherit;
      font-size: 14px;
      line-height: 1.45;
    }
    textarea:focus {
      outline: 2px solid #b7d4ff;
      border-color: #8bb9f0;
    }
    .composer button {
      height: 48px;
      min-width: 78px;
      align-self: end;
      color: #fff;
      border-color: #255c9f;
      background: #2f6faf;
    }
    .composer button:hover { background: #275f98; }
    .composer button:disabled {
      cursor: wait;
      opacity: 0.65;
    }
    .stream {
      max-width: 980px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .empty {
      margin: 12vh auto 0;
      color: var(--muted);
      text-align: center;
      font-size: 14px;
    }
    .row {
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }
    .row.out { justify-content: flex-end; }
    .bubble {
      max-width: min(760px, 88vw);
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 10px 12px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .out .bubble {
      border-color: #bfd0e7;
      background: #f8fbff;
    }
    .system .bubble {
      border-color: #ded6b3;
      background: #fffdf4;
      max-width: 680px;
    }
    .self .bubble {
      border-color: #c7d7bc;
      background: #fbfdf8;
      max-width: 720px;
    }
    .label {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      color: var(--muted);
      font-size: 12px;
    }
    .role {
      font-weight: 650;
      color: var(--qq);
    }
    .out .role { color: var(--codex); }
    .system .role { color: var(--system); }
    .self .role { color: #3f6f3a; }
    .text {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.55;
      font-size: 14px;
    }
    @media (max-width: 640px) {
      header {
        align-items: flex-start;
        flex-direction: column;
        gap: 10px;
      }
      .actions { width: 100%; justify-content: space-between; }
      main { padding: 12px; }
      .bubble { max-width: 94vw; }
      .composer {
        grid-template-columns: 1fr;
        padding: 10px 12px 12px;
      }
      .composer button {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <div>
        <h1>Codex 大管家</h1>
        <div class="meta" id="status">连接中</div>
      </div>
      <div class="actions">
        <button id="reload" type="button">刷新</button>
        <button id="clear" type="button">清屏</button>
      </div>
    </header>
    <main id="main">
      <div class="stream" id="stream">
        <div class="empty" id="empty">等待消息</div>
      </div>
    </main>
    <form class="composer" id="composer">
      <textarea id="message" rows="2" placeholder="直接交给大管家处理"></textarea>
      <button id="send" type="submit">发送</button>
    </form>
  </div>
  <script>
    const stream = document.getElementById("stream");
    const statusEl = document.getElementById("status");
    const main = document.getElementById("main");
    const composer = document.getElementById("composer");
    const messageInput = document.getElementById("message");
    const sendButton = document.getElementById("send");
    let lastId = 0;
    let polling = false;
    let source = null;

    function roleLabel(event) {
      if (event.role === "self" || event.platform === "self") return "Codex";
      if (event.platform === "local") return event.role === "in" ? "本机" : "大管家";
      if (event.role === "in") return "QQ";
      if (event.role === "out") return "大管家";
      return "系统";
    }

    function formatTime(value) {
      try {
        return new Intl.DateTimeFormat("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        }).format(new Date(value));
      } catch {
        return "";
      }
    }

    function setStatus(data) {
      const running = data.status && data.status.running;
      const pending = data.status ? data.status.pending_count : 0;
      const self = data.status && data.status.self_status;
      if (self && self.active) {
        statusEl.textContent = "Codex · " + self.phase + " · " + self.summary;
      } else if (running) {
        statusEl.textContent = "处理中 · 队列 " + pending + " · " + (running.message_preview || "");
      } else {
        statusEl.textContent = "空闲 · 队列 " + pending + (source ? " · 实时连接" : "");
      }
    }

    function appendEvent(event) {
      if (!event) return;
      const numericId = Number(event.id);
      if (Number.isFinite(numericId)) {
        if (numericId <= lastId) return;
        lastId = numericId;
      }
      const empty = document.getElementById("empty");
      if (empty) empty.remove();

      const row = document.createElement("div");
      row.className = "row " + (event.role || "system");

      const bubble = document.createElement("div");
      bubble.className = "bubble";

      const label = document.createElement("div");
      label.className = "label";

      const role = document.createElement("span");
      role.className = "role";
      role.textContent = roleLabel(event);

      const time = document.createElement("span");
      time.textContent = formatTime(event.created_at);

      const kind = document.createElement("span");
      kind.textContent = event.kind || "";

      label.append(role, time, kind);

      const text = document.createElement("div");
      text.className = "text";
      text.textContent = event.text || "";

      bubble.append(label, text);
      row.appendChild(bubble);
      stream.appendChild(row);
      main.scrollTop = main.scrollHeight;
    }

    async function poll(reset) {
      if (polling) return;
      polling = true;
      try {
        if (reset) {
          lastId = 0;
          stream.innerHTML = '<div class="empty" id="empty">等待消息</div>';
        }
        const response = await fetch("/chat/events?after=" + lastId, { cache: "no-store" });
        const data = await response.json();
        setStatus(data);
        for (const event of data.events || []) appendEvent(event);
      } catch (error) {
        statusEl.textContent = "连接断开，重试中";
      } finally {
        polling = false;
      }
    }

    function connectEvents() {
      if (source) source.close();
      source = new EventSource("/chat/stream?after=" + lastId);
      source.addEventListener("snapshot", (message) => {
        const data = JSON.parse(message.data);
        const events = data.events || [];
        if (!events.length && lastId > 0) {
          lastId = 0;
          stream.innerHTML = '<div class="empty" id="empty">等待消息</div>';
          poll(true);
          return;
        }
        setStatus(data);
        for (const event of events) appendEvent(event);
      });
      source.addEventListener("event", (message) => {
        appendEvent(JSON.parse(message.data));
      });
      source.addEventListener("status", (message) => {
        setStatus({ status: JSON.parse(message.data) });
      });
      source.onerror = () => {
        statusEl.textContent = "实时连接断开，重连中";
      };
    }

    async function sendLocalMessage(text) {
      const response = await fetch("/local/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.reply || data.error || "发送失败");
      }
      return data;
    }

    document.getElementById("reload").addEventListener("click", () => poll(false));
    document.getElementById("clear").addEventListener("click", () => {
      lastId = 0;
      stream.innerHTML = '<div class="empty" id="empty">等待消息</div>';
      poll(true);
      connectEvents();
    });
    composer.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = messageInput.value.trim();
      if (!text) return;
      sendButton.disabled = true;
      try {
        await sendLocalMessage(text);
        messageInput.value = "";
      } catch (error) {
        appendEvent({
          created_at: new Date().toISOString(),
          role: "system",
          kind: "error",
          text: error.message
        });
      } finally {
        sendButton.disabled = false;
        messageInput.focus();
      }
    });
    messageInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        composer.requestSubmit();
      }
    });
    poll(true);
    connectEvents();
  </script>
</body>
</html>`;

function parseArgs(argv) {
  const get = (name, fallback) => {
    const eq = argv.find((item) => item.startsWith(`${name}=`));
    if (eq) return eq.slice(name.length + 1);
    const idx = argv.indexOf(name);
    if (idx !== -1 && idx + 1 < argv.length) return argv[idx + 1];
    return fallback;
  };

  return {
    host: get("--host", process.env.CODEX_QQ_BRIDGE_HOST || DEFAULT_HOST),
    port: Number(get("--port", process.env.CODEX_QQ_BRIDGE_PORT || DEFAULT_PORT)),
    cwd: get("--cwd", process.env.CODEX_QQ_CWD || DEFAULT_WORKSPACE),
    codexBin: get("--codex-bin", process.env.CODEX_BIN || DEFAULT_CODEX_BIN),
    tokenFile: get("--token-file", process.env.CODEX_QQ_TOKEN_FILE || DEFAULT_TOKEN_FILE),
    ledgerFile: get("--ledger-file", process.env.CODEX_QQ_LEDGER_FILE || DEFAULT_RUN_LEDGER_FILE),
    secretDropFile: get("--secret-drop-file", process.env.CODEX_QQ_SECRET_DROP_FILE || DEFAULT_SECRET_DROP_FILE),
    astrbotUrl: get("--astrbot-url", process.env.ASTRBOT_URL || DEFAULT_ASTRBOT_URL),
    astrbotOpenapiKeyFile: get(
      "--astrbot-openapi-key-file",
      process.env.ASTRBOT_OPENAPI_KEY_FILE || DEFAULT_ASTRBOT_OPENAPI_KEY_FILE,
    ),
    timeout: Number(get("--timeout", process.env.CODEX_QQ_TIMEOUT || 900)),
    mode: get("--mode", process.env.CODEX_QQ_MODE || "exec"),
  };
}

async function readToken(tokenFile) {
  if (!tokenFile) return "";
  try {
    return (await fs.readFile(tokenFile, "utf8")).trim();
  } catch {
    return "";
  }
}

function githubTokenRegex(flags = "g") {
  return new RegExp(GITHUB_TOKEN_PATTERN_SOURCE, flags);
}

function redactSecrets(text) {
  return String(text || "").replace(githubTokenRegex("g"), "[REDACTED_GITHUB_TOKEN]");
}

function redactStructured(value) {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map((item) => redactStructured(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactStructured(item)]),
  );
}

function findGitHubToken(text) {
  const match = String(text || "").match(githubTokenRegex(""));
  return match ? match[0] : "";
}

function extractGitHubTokenDelivery(text) {
  const value = String(text || "").trim();
  const token = findGitHubToken(value);
  if (!token) return "";
  const remainder = value.replace(githubTokenRegex("g"), "").trim();
  if (!remainder || GITHUB_TOKEN_COMMAND_PATTERN.test(value)) return token;
  return "";
}

async function saveSecretDropFile(file, secret) {
  const target = String(file || DEFAULT_SECRET_DROP_FILE);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, String(secret || "").trim(), { mode: 0o600, encoding: "utf8" });
  await fs.chmod(target, 0o600);
  return target;
}

async function readOptionalSecret(file) {
  if (!file) return "";
  try {
    return (await fs.readFile(file, "utf8")).trim();
  } catch {
    return "";
  }
}

function requestJson(method, targetUrl, body, headers = {}, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const client = url.protocol === "https:" ? https : http;
    const raw = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
    const req = client.request(
      url,
      {
        method,
        headers: {
          ...(raw
            ? {
                "content-type": "application/json; charset=utf-8",
                "content-length": String(raw.length),
              }
            : {}),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text = clampCapture(text + chunk);
        });
        res.on("end", () => {
          let data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            data = text;
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
            return;
          }
          const error = new Error(`HTTP ${res.statusCode}: ${tailText(text, 800)}`);
          error.status = res.statusCode;
          reject(error);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
    if (raw) req.write(raw);
    req.end();
  });
}

async function sendAstrBotImMessage(args, umo, message) {
  const target = String(umo || "").trim();
  const text = String(message || "").trim();
  if (!target || !text) return false;
  const apiKey = await readOptionalSecret(args.astrbotOpenapiKeyFile);
  if (!apiKey) {
    log("AstrBot OpenAPI key missing; stream progress not sent", {
      file: args.astrbotOpenapiKeyFile,
    });
    return false;
  }
  const url = `${String(args.astrbotUrl || DEFAULT_ASTRBOT_URL).replace(/\/+$/, "")}/api/v1/im/message`;
  await requestJson(
    "POST",
    url,
    { umo: target, message: text },
    { authorization: `Bearer ${apiKey}` },
    10_000,
  );
  return true;
}

function tailText(text, limit = 4000) {
  const value = redactSecrets(text).trim();
  if (value.length <= limit) return value;
  return value.slice(-limit);
}

function trimChatText(text, limit = 6000) {
  const value = redactSecrets(text).trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n[内容过长，面板已截断]`;
}

function log(message, fields = {}) {
  const safeFields = redactStructured(fields);
  const suffix = Object.keys(safeFields).length ? ` ${JSON.stringify(safeFields)}` : "";
  console.log(`[${new Date().toISOString()}] ${redactSecrets(message)}${suffix}`);
}

function rememberChatEvent(event) {
  const item = {
    id: nextChatEventId,
    created_at: new Date().toISOString(),
    role: "system",
    kind: "event",
    text: "",
    ...event,
  };
  nextChatEventId += 1;
  item.text = trimChatText(item.text);
  chatEvents.push(item);
  while (chatEvents.length > MAX_CHAT_EVENTS) chatEvents.shift();
  broadcastSseEvent("event", item);
  broadcastStatus();
  return item;
}

function writeSse(res, eventName, data) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(redactStructured(data))}\n\n`);
}

function broadcastSseEvent(eventName, data) {
  for (const res of [...sseClients]) {
    try {
      writeSse(res, eventName, data);
    } catch {
      sseClients.delete(res);
    }
  }
}

function broadcastStatus() {
  broadcastSseEvent("status", statusPayload());
}

function openSseStream(req, res, after = 0) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(": connected\n\n");
  sseClients.add(res);
  writeSse(res, "snapshot", chatEventsPayload(Number.isFinite(after) ? after : 0));
  req.on("close", () => {
    sseClients.delete(res);
  });
}

function rememberRecentRun(record) {
  recentRuns.unshift(redactStructured(record));
  while (recentRuns.length > MAX_RECENT_RUNS) recentRuns.pop();
}

async function loadRecentRuns(ledgerFile) {
  try {
    const raw = await fs.readFile(ledgerFile, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean).slice(-MAX_RECENT_RUNS);
    const loaded = [];
    for (const line of lines) {
      try {
        loaded.push(JSON.parse(line));
      } catch {}
    }
    loaded.reverse().forEach(rememberRecentRun);
  } catch (error) {
    if (error.code !== "ENOENT") log("Failed to load run ledger", { file: ledgerFile, error: error.message });
  }
}

async function appendRunRecord(ledgerFile, record) {
  const safeRecord = redactStructured(record);
  rememberRecentRun(safeRecord);
  try {
    await fs.mkdir(path.dirname(ledgerFile), { recursive: true });
    await fs.appendFile(ledgerFile, `${JSON.stringify(safeRecord)}\n`, "utf8");
  } catch (error) {
    log("Failed to append run ledger", { file: ledgerFile, error: error.message });
  }
}

function chatEventsPayload(after = 0) {
  return {
    ok: true,
    events: chatEvents.filter((event) => event.id > after),
    status: statusPayload(),
  };
}

function normalizeSelfStatus() {
  if (!selfStatus) return null;
  const updatedAt = Date.parse(selfStatus.updated_at || "");
  const ttlSeconds = Number(selfStatus.ttl_seconds || DEFAULT_SELF_STATUS_TTL_SECONDS);
  const active = Number.isFinite(updatedAt) && Date.now() - updatedAt <= ttlSeconds * 1000;
  return {
    ...selfStatus,
    active,
    stale_seconds: Number.isFinite(updatedAt) ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null,
  };
}

function updateSelfStatus(payload) {
  const now = new Date().toISOString();
  const phase = String(payload.phase || payload.kind || "working").trim();
  const summary = String(payload.summary || payload.text || "").trim();
  if (!summary) {
    const error = new Error("self status summary is required");
    error.status = 400;
    throw error;
  }
  const source = String(payload.source || "codex").trim() || "codex";
  const requestId = payload.request_id ? String(payload.request_id) : `self-${Date.now()}`;
  const ttlSeconds = positiveNumber(
    payload.ttl_seconds || process.env.CODEX_SELF_STATUS_TTL_SECONDS,
    DEFAULT_SELF_STATUS_TTL_SECONDS,
    10,
    24 * 60 * 60,
  );
  selfStatus = {
    source,
    phase,
    summary,
    detail: payload.detail ? String(payload.detail) : "",
    request_id: requestId,
    updated_at: now,
    ttl_seconds: ttlSeconds,
  };
  const event = rememberChatEvent({
    role: "self",
    kind: phase,
    text: summary,
    request_id: requestId,
    session_id: payload.session_id ? String(payload.session_id) : "codex:self",
    platform: "self",
    sender_name: source,
  });
  broadcastStatus();
  return { ok: true, self_status: normalizeSelfStatus(), event };
}

function clearSelfStatus(payload = {}) {
  const previous = selfStatus;
  selfStatus = null;
  const event = rememberChatEvent({
    role: "self",
    kind: String(payload.kind || "done"),
    text: String(payload.summary || payload.text || previous?.summary || "Codex 状态已清空。"),
    request_id: payload.request_id ? String(payload.request_id) : previous?.request_id,
    session_id: payload.session_id ? String(payload.session_id) : "codex:self",
    platform: "self",
    sender_name: String(payload.source || previous?.source || "codex"),
  });
  broadcastStatus();
  return { ok: true, self_status: null, event };
}

function writeHtml(res, status, body) {
  const raw = Buffer.from(body, "utf8");
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": String(raw.length),
  });
  res.end(raw);
}

function clampCapture(text) {
  if (text.length <= MAX_CAPTURE_BYTES) return text;
  return text.slice(-MAX_CAPTURE_BYTES);
}

function stripAnsi(text) {
  return String(text || "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\r/g, "\n");
}

function progressLinesFromChunk(chunk) {
  const clean = stripAnsi(chunk)
    .split("\n")
    .map((line) => line.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim())
    .filter(Boolean)
    .filter((line) => line !== "█" && !/^[-\\|/]+$/.test(line));
  return clean;
}

function usefulProgressLines(source, lines) {
  if (source === "progress-file") return lines.slice(-6);

  const noisyPatterns = [
    /^OpenAI Codex\b/i,
    /^workdir:/i,
    /^model:/i,
    /^provider:/i,
    /^tokens used$/i,
    /^[\d,]+$/,
    /^approval:/i,
    /^sandbox:/i,
    /^reasoning\b/i,
    /^session id:/i,
    /^user$/i,
    /^codex$/i,
    /^exec$/i,
    /^succeeded in \d+/i,
    /^[-*] /,
    /^来源信息[:：]?$/,
    /^工作方式[:：]?$/,
    /^进度回报[:：]?$/,
    /^用户消息[:：]?$/,
    /^消息概要[:：]?$/,
    /^最近对话上下文[:：]?$/,
    /^你正在通过 QQ 机器人接收用户的远程请求/,
    /^如果任务预计超过/,
    /^推荐命令格式/,
    /^只写阶段性事实/,
    /^Codex QQ bridge listening/,
    /^Codex workspace:/,
    /^Mode:/,
    /^\/bin\/zsh -lc\b/,
    /^sleep \d+$/,
    /^printf\b/,
    /\$\{CODEX_QQ_PROGRESS_FILE/,
    /CODEX_QQ_PROGRESS_FILE/,
    /\/progress\.log/,
    /^\/Volumes\/ssd\/work(?:\/|$)/,
    /\bin \/Volumes\/ssd\/work\//,
    /codex_core_plugins::/,
    /chatgpt\.com\/backend-api\/plugins/,
    /Unauthorized/,
  ];

  return lines
    .filter((line) => !noisyPatterns.some((pattern) => pattern.test(line)))
    .filter((line) => line.length <= 240)
    .slice(-6);
}

function updateRunProgress(source, chunk) {
  if (!currentRun) return;
  const preview = String(currentRun.message_preview || "").trim();
  const previewHead = preview.slice(0, 32);
  const lines = usefulProgressLines(source, progressLinesFromChunk(chunk))
    .filter((line) => !preview || (line !== preview && !line.includes(previewHead)));
  if (!lines.length) return;
  const text = tailText(lines.join("\n"), MAX_PROGRESS_TEXT_BYTES);
  const now = new Date().toISOString();
  currentRun.last_activity_at = now;
  currentRun.last_output_at = now;
  currentRun.last_output_source = source;
  currentRun.last_output = text;
  currentRun.output_tail = tailText(
    [currentRun.output_tail, text].filter(Boolean).join("\n"),
    MAX_PROGRESS_TAIL_BYTES,
  );
  broadcastStatus();
  void maybePushStreamProgress(currentRun, text);
}

function updateRunPhase(phase) {
  if (!currentRun) return;
  const now = new Date().toISOString();
  currentRun.phase = String(phase || "");
  currentRun.last_activity_at = now;
  broadcastStatus();
}

function streamProgressMessage(run, text) {
  const elapsed = Math.max(0, Math.round((Date.now() - Date.parse(run.started_at)) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const duration = minutes ? `${minutes}分${seconds}秒` : `${seconds}秒`;
  return `大管家实时输出（${duration}）：\n${text}`;
}

async function maybePushStreamProgress(run, text) {
  if (!run || !run.stream_progress_enabled) return;
  const value = tailText(text, run.stream_progress_detail_chars || DEFAULT_STREAM_PROGRESS_DETAIL_CHARS);
  if (value.length < STREAM_PROGRESS_MIN_CHARS) return;
  if (value === run.last_stream_progress_text) return;

  const now = Date.now();
  const intervalMs = Math.max(1, run.stream_progress_interval_seconds || DEFAULT_STREAM_PROGRESS_INTERVAL_SECONDS) * 1000;
  if (run.last_stream_progress_sent_at && now - run.last_stream_progress_sent_at < intervalMs) {
    run.pending_stream_progress_text = value;
    if (!run.pending_stream_progress_timer) {
      const delay = Math.max(250, intervalMs - (now - run.last_stream_progress_sent_at));
      run.pending_stream_progress_timer = setTimeout(() => {
        run.pending_stream_progress_timer = null;
        const pending = run.pending_stream_progress_text;
        run.pending_stream_progress_text = "";
        if (pending) void maybePushStreamProgress(run, pending);
      }, delay);
      run.pending_stream_progress_timer.unref();
    }
    return;
  }

  run.last_stream_progress_text = value;
  run.last_stream_progress_sent_at = now;
  run.pending_stream_progress_text = "";
  rememberChatEvent({
    role: "out",
    kind: "stream",
    text: value,
    request_id: run.request_id,
    session_id: run.session_id,
    platform: run.platform,
  });
  if (!run.stream_progress_umo) return;
  try {
    await sendAstrBotImMessage(run.stream_progress_args, run.stream_progress_umo, streamProgressMessage(run, value));
  } catch (error) {
    log("Failed to push stream progress to QQ", {
      request_id: run.request_id,
      error: error.message,
    });
  }
}

function terminateProcessTree(child, signal) {
  if (!child?.pid) return;
  try {
    if (process.platform !== "win32") {
      process.kill(-child.pid, signal);
      return;
    }
  } catch (error) {
    if (error.code !== "ESRCH") log("Failed to signal Codex process group", { pid: child.pid, signal, error: error.message });
  }

  try {
    child.kill(signal);
  } catch (error) {
    if (error.code !== "ESRCH") log("Failed to signal Codex process", { pid: child.pid, signal, error: error.message });
  }
}

function buildPrompt(payload, progressFile = "") {
  const message = redactSecrets(payload.message || "").trim();
  const senderId = String(payload.sender_id || "");
  const senderName = String(payload.sender_name || "");
  const sessionId = String(payload.session_id || "");
  const platform = String(payload.platform || "");
  const platformId = String(payload.platform_id || "");
  const messageType = String(payload.message_type || "");
  const groupId = String(payload.group_id || "");
  const outline = String(payload.message_outline || "").trim();
  const outlineBlock = outline && outline !== message ? `\n消息概要:\n${outline}\n` : "";
  const historyBlock = formatHistory(payload.history);
  const attachmentsBlock = formatAttachments(normalizeAttachments(payload.attachments));
  const progressBlock = progressFile
    ? `\n进度回报:\n- 如果任务预计超过 30 秒，或进入“研究/安装/启动/验证/收尾”等阶段，请向这个本地进度文件追加一行简短状态：${progressFile}\n- 推荐命令格式：printf '%s\\n' '正在检查候选方案' >> \"$CODEX_QQ_PROGRESS_FILE\"\n- 只写阶段性事实，不写密钥、token、完整日志或大段输出。\n`
    : "";

  return `你正在通过 QQ 机器人接收用户的远程请求。你对外的身份是“大管家”：负责接单、拆解、组织内部团队、汇报进度、收口结果。请作为本机 Codex 执行任务，不要把自己说成 AstrBot、QQ 机器人或其他模型。

来源信息:
- platform: ${platform}
- platform_id: ${platformId}
- session_id: ${sessionId}
- message_type: ${messageType}
- sender_id: ${senderId}
- sender_name: ${senderName}
- group_id: ${groupId}

工作方式:
- 需要查看或修改文件时可以直接在当前工作目录操作。
- 默认由“大管家”统一对外回复；内部可以按任务临时组建探索、实现、验证等角色，但不要把内部过程写成噪声。
- 如果任务适合多 agent 并行，先在当前主线程判断关键路径，再把互不冲突的侧向任务交给内部 agent，最终整合后回复用户。
- 回复适合发回 QQ，保持简洁；阶段性进度由外层大管家插件发送，你只需要在完成时给出最终收口结果。
- 你可以把自身状态外显到本机统一状态总线：${path.join(DEFAULT_CODEX_HOME, "bin/codex-self")} <phase> <summary>。入口来自 QQ、网页、本机 CLI 或其他会话都一样；桌面 Live2D、网页、QQ 和语音会订阅这条状态。常用 phase: thinking, working, installing, starting, verifying, done, error, blocked, smiling。用户要求说话时加 --say；要求 QQ 通知时加 --qq。状态摘要只写短事实，不写密钥、token、完整日志或大段输出。
- 如果做了文件或命令操作，最后说明关键路径和验证结果。
- 注意结合下方最近对话上下文，用户可能会用“这个/刚才/继续/搞一搞”等指代前文。
${progressBlock}
${outlineBlock}
${attachmentsBlock}
${historyBlock}

用户消息:
${message}
`;
}

function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  const items = [];
  for (const raw of attachments) {
    if (!raw || typeof raw !== "object") continue;
    const type = String(raw.type || "").toLowerCase();
    const pathValue = String(raw.path || "").trim();
    const item = {
      type,
      path: pathValue,
      name: String(raw.name || path.basename(pathValue) || "").trim(),
      mime_type: String(raw.mime_type || "").trim(),
      url: String(raw.url || "").trim(),
      source: String(raw.source || "").trim(),
      error: String(raw.error || "").trim(),
    };
    if (item.type !== "image") continue;
    items.push(item);
    if (items.length >= MAX_IMAGE_ATTACHMENTS) break;
  }
  return items;
}

function imagePathsFromAttachments(attachments) {
  return attachments
    .filter((item) => item.type === "image" && item.path)
    .map((item) => item.path)
    .slice(0, MAX_IMAGE_ATTACHMENTS);
}

function formatAttachments(attachments) {
  if (!attachments.length) return "";
  const lines = [];
  attachments.forEach((item, index) => {
    const details = [
      `name=${item.name || `image-${index + 1}`}`,
      item.path ? `path=${item.path}` : "",
      item.url ? `url=${item.url}` : "",
      item.mime_type ? `mime=${item.mime_type}` : "",
      item.error ? `note=${item.error}` : "",
    ].filter(Boolean);
    lines.push(`${index + 1}. image: ${details.join(", ")}`);
  });
  return `\n图片附件:\n${lines.join("\n")}\n- 这些图片已尽量作为 Codex 初始图片附件传入；如果需要读图，请直接结合图片内容回答。\n`;
}

function formatHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return "";
  const lines = [];
  for (const item of history.slice(-20)) {
    if (!item || typeof item !== "object") continue;
    const role = item.role === "assistant" ? "大管家" : "用户";
    const text = redactSecrets(item.text || "").trim();
    if (!text) continue;
    lines.push(`${role}: ${tailText(text, 1200)}`);
  }
  if (!lines.length) return "";
  return `\n最近对话上下文:\n${lines.join("\n\n")}\n`;
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function positiveNumber(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum) return fallback;
  return Math.min(number, maximum);
}

function voiceTextFromReply(text, maxChars = DEFAULT_VOICE_REPLY_MAX_CHARS) {
  const limit = positiveNumber(maxChars, DEFAULT_VOICE_REPLY_MAX_CHARS, 80, 3000);
  let value = String(text || "")
    .replace(/```[\s\S]*?```/g, "有一段代码我先略过。")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[\s>*-]+/gm, "")
    .replace(/[_*~#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (value.length > limit) value = `${value.slice(0, limit).trim()}。后面内容比较长，我已放在文字里。`;
  return value;
}

function containerPathForVoice(hostPath, hostDir, containerDir) {
  const cleanHostDir = String(hostDir || DEFAULT_VOICE_REPLY_HOST_DIR).replace(/\/+$/, "");
  const cleanContainerDir = String(containerDir || DEFAULT_VOICE_REPLY_CONTAINER_DIR).replace(/\/+$/, "");
  const value = String(hostPath || "");
  if (value.startsWith(`${cleanHostDir}/`)) {
    return `${cleanContainerDir}${value.slice(cleanHostDir.length)}`;
  }
  return `${cleanContainerDir}/${path.basename(value)}`;
}

async function cleanupOldVoiceReplies(hostDir) {
  try {
    const entries = await fs.readdir(hostDir, { withFileTypes: true });
    const now = Date.now();
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile() || !/\.(aiff|wav)$/i.test(entry.name)) return;
      const target = path.join(hostDir, entry.name);
      try {
        const stat = await fs.stat(target);
        if (now - stat.mtimeMs > VOICE_REPLY_MAX_AGE_MS) {
          await fs.rm(target, { force: true });
        }
      } catch {}
    }));
  } catch {}
}

function runSimpleProcess(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(file, args, {
      cwd: options.cwd || DEFAULT_WORKSPACE,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(options.env || {}) },
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
    }, options.timeoutMs || 60_000);
    timer.unref();
    child.stdout.on("data", (chunk) => {
      stdout = clampCapture(stdout + chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk) => {
      stderr = clampCapture(stderr + chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${file} exited with ${signal || code}: ${tailText(stderr || stdout, 1000)}`));
    });
  });
}

async function synthesizeVoiceReply(payload) {
  const rawText = String(payload.text || "").trim();
  if (!rawText) return { ok: false, reply: "语音回复文本为空。" };

  const hostDir = String(payload.host_dir || process.env.CODEX_QQ_VOICE_REPLY_HOST_DIR || DEFAULT_VOICE_REPLY_HOST_DIR);
  const containerDir = String(payload.container_dir || process.env.CODEX_QQ_VOICE_REPLY_CONTAINER_DIR || DEFAULT_VOICE_REPLY_CONTAINER_DIR);
  const engine = String(payload.engine || process.env.CODEX_QQ_VOICE_REPLY_ENGINE || DEFAULT_VOICE_REPLY_ENGINE);
  const voice = String(payload.voice || process.env.CODEX_QQ_VOICE_REPLY_VOICE || DEFAULT_VOICE_REPLY_VOICE);
  const rate = positiveNumber(payload.rate || process.env.CODEX_QQ_VOICE_REPLY_RATE, DEFAULT_VOICE_REPLY_RATE, 80, 400);
  const speed = positiveNumber(payload.speed || process.env.CODEX_QQ_VOICE_REPLY_SPEED, DEFAULT_VOICE_REPLY_SPEED, 0.5, 2);
  const maxChars = positiveNumber(payload.max_chars || process.env.CODEX_QQ_VOICE_REPLY_MAX_CHARS, DEFAULT_VOICE_REPLY_MAX_CHARS, 80, 3000);
  const text = voiceTextFromReply(rawText, maxChars);
  const id = `${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${randomUUID().slice(0, 8)}`;
  const aiffPath = path.join(hostDir, `${id}.aiff`);
  const textPath = path.join(hostDir, `${id}.txt`);
  const wavPath = path.join(hostDir, `${id}.wav`);

  await fs.mkdir(hostDir, { recursive: true });
  await cleanupOldVoiceReplies(hostDir);
  if (engine === "kokoro") {
    const pythonBin = String(payload.kokoro_python || process.env.CODEX_QQ_KOKORO_TTS_BIN || DEFAULT_KOKORO_TTS_BIN);
    const scriptPath = String(payload.kokoro_script || process.env.CODEX_QQ_KOKORO_TTS_SCRIPT || DEFAULT_KOKORO_TTS_SCRIPT);
    await fs.writeFile(textPath, text, "utf8");
    try {
      await runSimpleProcess(pythonBin, [scriptPath, "--text-file", textPath, "--out", wavPath, "--voice", voice, "--speed", String(speed)], {
        cwd: DEFAULT_WORKSPACE,
        timeoutMs: 180_000,
      });
    } finally {
      await fs.rm(textPath, { force: true });
    }
  } else if (engine === "edge") {
    const edgeTtsBin = String(payload.edge_tts_bin || process.env.CODEX_QQ_EDGE_TTS_BIN || DEFAULT_EDGE_TTS_BIN);
    const mp3Path = path.join(hostDir, `${id}.mp3`);
    const edgeRate = String(payload.edge_rate || process.env.CODEX_QQ_EDGE_TTS_RATE || "-8%");
    const edgePitch = String(payload.edge_pitch || process.env.CODEX_QQ_EDGE_TTS_PITCH || "+8Hz");
    try {
      await runSimpleProcess(edgeTtsBin, ["--voice", voice, `--rate=${edgeRate}`, `--pitch=${edgePitch}`, "--text", text, "--write-media", mp3Path], {
        cwd: DEFAULT_WORKSPACE,
        timeoutMs: 120_000,
      });
      await runSimpleProcess("afconvert", ["-f", "WAVE", "-d", `LEI16@${DEFAULT_VOICE_REPLY_SAMPLE_RATE}`, mp3Path, wavPath], {
        cwd: DEFAULT_WORKSPACE,
        timeoutMs: 60_000,
      });
    } finally {
      await fs.rm(mp3Path, { force: true });
    }
  } else if (engine === "indextts2") {
    const indexTts2Bin = String(payload.index_tts2_bin || process.env.CODEX_QQ_INDEX_TTS2_SAY_BIN || DEFAULT_INDEX_TTS2_SAY_BIN);
    const indexTts2OutputDir = String(payload.index_tts2_output_dir || process.env.CODEX_QQ_INDEX_TTS2_OUTPUT_DIR || DEFAULT_INDEX_TTS2_OUTPUT_DIR);
    const rawWavPath = path.join(indexTts2OutputDir, `${id}.raw.wav`);
    try {
      await fs.mkdir(indexTts2OutputDir, { recursive: true });
      await runSimpleProcess(indexTts2Bin, ["--no-play", "--output", rawWavPath, text], {
        cwd: DEFAULT_WORKSPACE,
        timeoutMs: 240_000,
      });
      await runSimpleProcess("afconvert", ["-f", "WAVE", "-d", `LEI16@${DEFAULT_VOICE_REPLY_SAMPLE_RATE}`, rawWavPath, wavPath], {
        cwd: DEFAULT_WORKSPACE,
        timeoutMs: 60_000,
      });
    } finally {
      await fs.rm(rawWavPath, { force: true });
    }
  } else {
    await runSimpleProcess("say", ["-v", voice, "-r", String(rate), "-o", aiffPath, text], {
      cwd: DEFAULT_WORKSPACE,
      timeoutMs: 120_000,
    });
    await runSimpleProcess("afconvert", ["-f", "WAVE", "-d", `LEI16@${DEFAULT_VOICE_REPLY_SAMPLE_RATE}`, aiffPath, wavPath], {
      cwd: DEFAULT_WORKSPACE,
      timeoutMs: 60_000,
    });
    await fs.rm(aiffPath, { force: true });
  }

  return {
    ok: true,
    voice_reply: {
      text,
      host_path: wavPath,
      container_path: containerPathForVoice(wavPath, hostDir, containerDir),
      mime_type: "audio/wav",
      format: "wav",
      sample_rate: DEFAULT_VOICE_REPLY_SAMPLE_RATE,
      engine,
      voice,
      rate,
      speed,
    },
  };
}

function runProcess(file, args, options, input, timeoutMs, onProgress) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let closed = false;

    const child = spawn(file, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", ...(options.env || {}) },
      detached: process.platform !== "win32",
    });
    activeChild = child;

    const clearActiveChild = () => {
      if (activeChild === child) activeChild = null;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child, "SIGTERM");
      setTimeout(() => terminateProcessTree(child, "SIGKILL"), 5000).unref();
    }, timeoutMs);
    timer.unref();

    let progressSnapshot = "";
    const progressTimer = options.progressFile
      ? setInterval(async () => {
          try {
            const value = await fs.readFile(options.progressFile, "utf8");
            if (value && value !== progressSnapshot) {
              progressSnapshot = value;
              onProgress?.("progress-file", tailText(value, MAX_PROGRESS_TAIL_BYTES));
            }
          } catch {}
        }, 2500)
      : null;
    progressTimer?.unref();

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout = clampCapture(stdout + text);
      onProgress?.("stdout", text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr = clampCapture(stderr + text);
      onProgress?.("stderr", text);
    });
    child.on("error", (error) => {
      if (closed) return;
      closed = true;
      clearActiveChild();
      clearTimeout(timer);
      if (progressTimer) clearInterval(progressTimer);
      resolve({ error, stdout, stderr, code: null, signal: null, timedOut });
    });
    child.on("close", (code, signal) => {
      if (closed) return;
      closed = true;
      clearActiveChild();
      clearTimeout(timer);
      if (progressTimer) clearInterval(progressTimer);
      resolve({ stdout, stderr, code, signal, timedOut });
    });

    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

async function runCodex(payload, args) {
  payload = redactStructured(payload);
  const message = String(payload.message || "").trim();
  const attachments = normalizeAttachments(payload.attachments);
  const requestedImagePaths = imagePathsFromAttachments(attachments);
  const imagePaths = [];
  for (const imagePath of requestedImagePaths) {
    if (await pathExists(imagePath)) {
      imagePaths.push(imagePath);
    } else {
      log("Image attachment path is not readable", { path: imagePath });
    }
  }
  if (!message && !imagePaths.length) return { ok: false, reply: "没有收到可处理的文本或图片。" };

  const requestId = String(payload.request_id || randomUUID());
  const cwd = String(payload.cwd || args.cwd);
  const parsedTimeout = Number(payload.timeout_seconds || args.timeout);
  const timeout = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : args.timeout;
  const mode = String(payload.mode || args.mode);
  const streamProgressEnabled = payload.stream_progress_enabled !== false;
  const streamProgressUmo = Object.prototype.hasOwnProperty.call(payload, "stream_progress_umo")
    ? String(payload.stream_progress_umo || "")
    : String(payload.session_id || "");
  const streamProgressIntervalSeconds = positiveNumber(
    payload.stream_progress_interval_seconds || process.env.CODEX_QQ_STREAM_PROGRESS_INTERVAL_SECONDS,
    DEFAULT_STREAM_PROGRESS_INTERVAL_SECONDS,
    2,
    300,
  );
  const streamProgressDetailChars = positiveNumber(
    payload.stream_progress_detail_chars || process.env.CODEX_QQ_STREAM_PROGRESS_DETAIL_CHARS,
    DEFAULT_STREAM_PROGRESS_DETAIL_CHARS,
    80,
    1600,
  );
  if (!["exec", "resume-last"].includes(mode)) {
    return { ok: false, reply: `Codex 桥不支持这个执行模式: ${mode}` };
  }

  if (!(await pathExists(cwd))) {
    return { ok: false, reply: `Codex 工作目录不存在: ${cwd}` };
  }

  const started = Date.now();
  currentRun = {
    request_id: requestId,
    started_at: new Date(started).toISOString(),
    elapsed_seconds: 0,
    mode,
    cwd,
    platform: String(payload.platform || ""),
    sender_id: String(payload.sender_id || ""),
    session_id: String(payload.session_id || ""),
    message_preview: message.slice(0, 120),
    attachment_count: attachments.length,
    image_count: imagePaths.length,
    image_paths: imagePaths,
    phase: "已接单，正在准备 Codex 执行环境。",
    last_activity_at: new Date(started).toISOString(),
    last_output: "",
    last_output_source: "",
    output_tail: "",
    stream_progress_enabled: streamProgressEnabled,
    stream_progress_umo: streamProgressUmo,
    stream_progress_interval_seconds: streamProgressIntervalSeconds,
    stream_progress_detail_chars: streamProgressDetailChars,
    stream_progress_args: args,
    last_stream_progress_text: "",
    last_stream_progress_sent_at: 0,
    pending_stream_progress_text: "",
    pending_stream_progress_timer: null,
  };
  broadcastStatus();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-qq-"));
  const outputFile = path.join(tmpDir, "last-message.txt");
  const progressFile = path.join(tmpDir, "progress.log");
  const prompt = buildPrompt(payload, progressFile);
  let finalResult = null;

  const cliArgs =
    mode === "resume-last"
      ? [
          "-a",
          "never",
          "-s",
          "danger-full-access",
          "-C",
          cwd,
          "exec",
          "resume",
          "--last",
          "--all",
          "--skip-git-repo-check",
          ...imagePaths.flatMap((imagePath) => ["-i", imagePath]),
          "-o",
          outputFile,
          "-",
        ]
      : [
          "-a",
          "never",
          "-s",
          "danger-full-access",
          "exec",
          "--skip-git-repo-check",
          "-C",
          cwd,
          "--color",
          "never",
          ...imagePaths.flatMap((imagePath) => ["-i", imagePath]),
          "-o",
          outputFile,
          "-",
        ];

  try {
    log("Codex run started", {
      request_id: requestId,
      mode,
      cwd,
      platform: payload.platform || "",
      sender_id: payload.sender_id || "",
      session_id: payload.session_id || "",
      image_count: imagePaths.length,
    });
    updateRunPhase("Codex 进程已启动，正在读取任务和上下文。");
    const result = await runProcess(
      args.codexBin,
      cliArgs,
      {
        cwd,
        progressFile,
        env: {
          CODEX_QQ_PROGRESS_FILE: progressFile,
          CODEX_QQ_REQUEST_ID: requestId,
        },
      },
      prompt,
      timeout * 1000,
      updateRunProgress,
    );
    updateRunPhase("Codex 进程已结束，正在整理最终回复。");
    if (result.error) {
      log("Codex run failed to start", { request_id: requestId, error: result.error.message });
      finalResult = { ok: false, reply: `启动 Codex 失败: ${result.error.message}`, request_id: requestId };
      return finalResult;
    }
    if (result.timedOut) {
      log("Codex run timed out", { request_id: requestId, timeout_seconds: timeout });
      finalResult = {
        ok: false,
        reply: `大管家处理超过 ${timeout} 秒，已经超时。可以把任务拆短一点再发。`,
        request_id: requestId,
        timed_out: true,
      };
      return finalResult;
    }

    let reply = "";
    try {
      reply = (await fs.readFile(outputFile, "utf8")).trim();
    } catch {}

    if (!reply) reply = tailText(result.stdout) || tailText(result.stderr);

    const ok = result.code === 0;
    if (!reply) {
      reply = ok ? "大管家没有拿到返回内容。" : "大管家处理失败，但没有返回错误文本。";
    } else if (!ok) {
      reply = `大管家处理失败:\n${reply}`;
    }

    finalResult = {
      ok,
      reply,
      request_id: requestId,
      elapsed_seconds: Math.round((Date.now() - started) / 10) / 100,
      returncode: result.code,
      signal: result.signal,
    };
    return finalResult;
  } finally {
    if (currentRun?.pending_stream_progress_timer) {
      clearTimeout(currentRun.pending_stream_progress_timer);
      currentRun.pending_stream_progress_timer = null;
    }
    const ended = Date.now();
    if (finalResult) {
      const run = currentRun || {};
      await appendRunRecord(args.ledgerFile, {
        request_id: requestId,
        started_at: run.started_at || new Date(started).toISOString(),
        completed_at: new Date(ended).toISOString(),
        elapsed_seconds: Math.round((ended - started) / 10) / 100,
        ok: Boolean(finalResult.ok),
        timed_out: Boolean(finalResult.timed_out),
        returncode: finalResult.returncode ?? null,
        signal: finalResult.signal ?? null,
        mode,
        cwd,
        platform: String(payload.platform || ""),
        sender_id: String(payload.sender_id || ""),
        session_id: String(payload.session_id || ""),
        message_preview: message.slice(0, 120),
        attachment_count: attachments.length,
        image_count: imagePaths.length,
        last_output: tailText(run.last_output || run.phase || "", 500),
        reply_preview: tailText(finalResult.reply || "", 1000),
      });
    }
    currentRun = null;
    broadcastStatus();
    log("Codex run finished", {
      request_id: requestId,
      elapsed_seconds: Math.round((ended - started) / 10) / 100,
    });
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function enqueueRun(payload, args) {
  pendingCount += 1;
  broadcastStatus();
  const runNext = async () => {
    pendingCount = Math.max(0, pendingCount - 1);
    broadcastStatus();
    return runCodex(payload, args);
  };
  const next = runQueue.then(runNext, runNext);
  runQueue = next.catch(() => {});
  return next;
}

function statusPayload() {
  let running = null;
  if (currentRun) {
    const lastActivityAt = currentRun.last_activity_at ? Date.parse(currentRun.last_activity_at) : NaN;
    const {
      output_tail: _outputTail,
      stream_progress_args: _streamProgressArgs,
      pending_stream_progress_timer: _pendingStreamProgressTimer,
      ...run
    } = currentRun;
    running = {
      ...run,
      elapsed_seconds: Math.round((Date.now() - Date.parse(currentRun.started_at)) / 1000),
      last_activity_seconds_ago: Number.isFinite(lastActivityAt)
        ? Math.max(0, Math.round((Date.now() - lastActivityAt) / 1000))
        : null,
    };
  }
  return {
    ok: true,
    runtime: "node",
    running,
    self_status: normalizeSelfStatus(),
    pending_count: pendingCount,
    last_run: recentRuns[0] || null,
    recent_runs: recentRuns.slice(0, 5),
  };
}

function writeJson(res, status, body) {
  const raw = Buffer.from(JSON.stringify(redactStructured(body)), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(raw.length),
  });
  res.end(raw);
}

function isLocalRequest(req) {
  const address = req.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function authorized(req, token) {
  if (!token) return true;
  const bearer = String(req.headers.authorization || "");
  const header = String(req.headers["x-codex-bridge-token"] || "");
  const got = bearer.startsWith("Bearer ") ? bearer.slice("Bearer ".length).trim() : header;
  return got === token;
}

async function readJsonBody(req) {
  const length = Number(req.headers["content-length"] || 0);
  if (!length || length > MAX_BODY_BYTES) {
    const error = new Error("请求体为空或过大。");
    error.status = 413;
    throw error;
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error("请求体过大。");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = await readToken(args.tokenFile);
  await loadRecentRuns(args.ledgerFile);
  rememberChatEvent({ role: "system", kind: "start", text: "Codex 大管家状态总线已启动。" });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/chat")) {
      if (!isLocalRequest(req)) {
        writeJson(res, 403, { ok: false, reply: "聊天面板只允许本机访问。" });
        return;
      }
      writeHtml(res, 200, CHAT_HTML);
      return;
    }

    if (req.method === "GET" && url.pathname === "/chat/events") {
      if (!isLocalRequest(req)) {
        writeJson(res, 403, { ok: false, reply: "聊天面板只允许本机访问。" });
        return;
      }
      const after = Number(url.searchParams.get("after") || 0);
      writeJson(res, 200, chatEventsPayload(Number.isFinite(after) ? after : 0));
      return;
    }

    if (req.method === "GET" && url.pathname === "/chat/stream") {
      if (!isLocalRequest(req)) {
        writeJson(res, 403, { ok: false, reply: "聊天面板只允许本机访问。" });
        return;
      }
      const after = Number(url.searchParams.get("after") || 0);
      openSseStream(req, res, Number.isFinite(after) ? after : 0);
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      writeJson(res, 200, {
        ok: true,
        status: "ready",
        runtime: "node",
        codex_bin: args.codexBin,
        cwd: args.cwd,
      });
      return;
    }

    if (url.pathname === "/self/status" && (req.method === "POST" || req.method === "DELETE")) {
      if (!isLocalRequest(req) && !authorized(req, token)) {
        writeJson(res, 401, { ok: false, reply: "Codex 自身状态入口未授权。" });
        return;
      }
      try {
        const payload = Number(req.headers["content-length"] || 0) > 0 ? await readJsonBody(req) : {};
        const result = req.method === "DELETE" ? clearSelfStatus(payload) : updateSelfStatus(payload);
        writeJson(res, 200, result);
      } catch (error) {
        const status = Number(error.status || 400);
        writeJson(res, status, { ok: false, reply: `Codex 自身状态更新失败: ${error.message}` });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/local/run") {
      if (!isLocalRequest(req)) {
        writeJson(res, 403, { ok: false, reply: "本机入口只允许本机访问。" });
        return;
      }
      try {
        const payload = await readJsonBody(req);
        const message = String(payload.message || "").trim();
        if (!message) {
          writeJson(res, 400, { ok: false, reply: "没有收到可处理的文本。" });
          return;
        }
        const requestId = payload.request_id ? String(payload.request_id) : `local-${Date.now()}`;
        const localPayload = {
          ...payload,
          request_id: requestId,
          platform: "local",
          sender_id: String(payload.sender_id || "local-self"),
          sender_name: String(payload.sender_name || "本机"),
          session_id: String(payload.session_id || "local:self"),
          message,
          stream_progress_enabled: payload.stream_progress_enabled !== false,
          stream_progress_umo: "",
        };
        rememberChatEvent({
          role: "in",
          kind: "request",
          text: message,
          request_id: requestId,
          session_id: localPayload.session_id,
          platform: "local",
          sender_name: localPayload.sender_name,
        });
        enqueueRun(localPayload, args)
          .then((result) => {
            rememberChatEvent({
              role: "out",
              kind: result.ok ? "final" : "error",
              text: String(result.reply || ""),
              request_id: result.request_id ? String(result.request_id) : requestId,
              session_id: localPayload.session_id,
              platform: "local",
            });
          })
          .catch((error) => {
            rememberChatEvent({
              role: "out",
              kind: "error",
              text: `本机任务失败: ${error.message}`,
              request_id: requestId,
              session_id: localPayload.session_id,
              platform: "local",
            });
          });
        writeJson(res, 202, {
          ok: true,
          accepted: true,
          request_id: requestId,
          pending_count: pendingCount,
          panel_url: "http://127.0.0.1:8765/chat",
          reply: "已交给大管家处理。",
        });
      } catch (error) {
        const status = Number(error.status || 400);
        writeJson(res, status, { ok: false, reply: `本机请求失败: ${error.message}` });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/status") {
      if (!authorized(req, token)) {
        writeJson(res, 401, { ok: false, reply: "Codex 桥 token 不正确。" });
        return;
      }
      writeJson(res, 200, statusPayload());
      return;
    }

    if (req.method === "GET" && url.pathname === "/runs") {
      if (!authorized(req, token)) {
        writeJson(res, 401, { ok: false, reply: "Codex 桥 token 不正确。" });
        return;
      }
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 10), 1), MAX_RECENT_RUNS);
      writeJson(res, 200, { ok: true, runs: recentRuns.slice(0, limit) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/cancel") {
      if (!authorized(req, token)) {
        writeJson(res, 401, { ok: false, reply: "Codex 桥 token 不正确。" });
        return;
      }
      if (!activeChild || !currentRun) {
        writeJson(res, 200, { ok: true, reply: "当前没有正在执行的大管家任务。", ...statusPayload() });
        return;
      }
      const requestId = currentRun.request_id;
      const child = activeChild;
      terminateProcessTree(child, "SIGTERM");
      setTimeout(() => terminateProcessTree(child, "SIGKILL"), 5000).unref();
      writeJson(res, 200, { ok: true, reply: `已请求取消当前大管家任务: ${requestId}` });
      return;
    }

    if (req.method === "POST" && url.pathname === "/chat/event") {
      if (!authorized(req, token)) {
        writeJson(res, 401, { ok: false, reply: "Codex 桥 token 不正确。" });
        return;
      }
      try {
        const payload = await readJsonBody(req);
        const event = rememberChatEvent({
          role: String(payload.role || "system"),
          kind: String(payload.kind || "event"),
          text: String(payload.text || ""),
          request_id: payload.request_id ? String(payload.request_id) : undefined,
          session_id: payload.session_id ? String(payload.session_id) : undefined,
          platform: payload.platform ? String(payload.platform) : undefined,
          sender_name: payload.sender_name ? String(payload.sender_name) : undefined,
        });
        writeJson(res, 200, { ok: true, event });
      } catch (error) {
        const status = Number(error.status || 400);
        writeJson(res, status, { ok: false, reply: `聊天事件记录失败: ${error.message}` });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/voice/synthesize") {
      if (!authorized(req, token)) {
        writeJson(res, 401, { ok: false, reply: "Codex 桥 token 不正确。" });
        return;
      }
      try {
        const payload = await readJsonBody(req);
        const result = await synthesizeVoiceReply(payload);
        writeJson(res, result.ok ? 200 : 400, result);
      } catch (error) {
        const status = Number(error.status || 500);
        writeJson(res, status, { ok: false, reply: `语音回复生成失败: ${error.message}` });
      }
      return;
    }

    if (req.method !== "POST" || url.pathname !== "/run") {
      writeJson(res, 404, { ok: false, error: "not found" });
      return;
    }

    if (!authorized(req, token)) {
      writeJson(res, 401, { ok: false, reply: "Codex 桥 token 不正确。" });
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const deliveredToken = extractGitHubTokenDelivery(payload.message || payload.message_outline || "");
      if (deliveredToken) {
        const target = await saveSecretDropFile(args.secretDropFile, deliveredToken);
        const requestId = payload.request_id ? String(payload.request_id) : undefined;
        rememberChatEvent({
          role: "in",
          kind: "secret",
          text: "GitHub token 已通过安全投递接收，内容不展示。",
          request_id: requestId,
          session_id: payload.session_id ? String(payload.session_id) : undefined,
          platform: payload.platform ? String(payload.platform) : undefined,
          sender_name: payload.sender_name ? String(payload.sender_name) : undefined,
        });
        rememberChatEvent({
          role: "out",
          kind: "secret",
          text: `GitHub token 已保存到 ${target}，权限 0600。`,
          request_id: requestId,
        });
        log("Secret token delivered through QQ bridge", {
          request_id: requestId,
          target,
          sender_id: payload.sender_id || "",
          session_id: payload.session_id || "",
        });
        writeJson(res, 200, {
          ok: true,
          secret_saved: true,
          path: target,
          reply: "GitHub token 已安全保存到本机临时文件，我现在可以继续建仓和推送。用完会删除。",
          request_id: requestId,
        });
        return;
      }
      rememberChatEvent({
        role: "in",
        kind: "request",
        text: String(payload.message || payload.message_outline || ""),
        request_id: payload.request_id ? String(payload.request_id) : undefined,
        session_id: payload.session_id ? String(payload.session_id) : undefined,
        platform: payload.platform ? String(payload.platform) : undefined,
        sender_name: payload.sender_name ? String(payload.sender_name) : undefined,
      });
      const result = await enqueueRun(payload, args);
      rememberChatEvent({
        role: "out",
        kind: result.ok ? "final" : "error",
        text: String(result.reply || ""),
        request_id: result.request_id ? String(result.request_id) : undefined,
      });
      writeJson(res, result.ok ? 200 : 500, result);
    } catch (error) {
      const status = Number(error.status || 400);
      writeJson(res, status, { ok: false, reply: `Codex 桥请求失败: ${error.message}` });
    }
  });

  server.listen(args.port, args.host, () => {
    console.log(`Codex QQ bridge listening on http://${args.host}:${args.port}`);
    console.log(`Codex workspace: ${args.cwd}`);
    console.log(`Mode: ${args.mode}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
