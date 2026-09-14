const http = require("http");
const crypto = require("crypto");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT || 10000);
const AUTH_TOKEN = String(process.env.UNBOUND_BROWSER_WORKER_TOKEN || "").trim();
const MAX_SESSIONS = Math.min(Math.max(Number(process.env.UNBOUND_BROWSER_MAX_SESSIONS) || 1, 1), 4);
const IDLE_TIMEOUT_MS = Math.min(Math.max(Number(process.env.UNBOUND_BROWSER_IDLE_TIMEOUT_MS) || 120000, 30000), 300000);
const PROTOCOL = "unbound-cdp-v1";
let activeSessions = 0;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function offeredProtocols(request) {
  return String(request.headers["sec-websocket-protocol"] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function authorized(request) {
  if (!AUTH_TOKEN) return false;
  return offeredProtocols(request).some((value) => value !== PROTOCOL && safeEqual(value, AUTH_TOKEN));
}

async function launchBrowser() {
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    executablePath,
    headless: "shell",
    defaultViewport: null,
    args: [
      ...chromium.args,
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-domain-reliability",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--no-default-browser-check",
      "--password-store=basic",
      "--use-mock-keychain"
    ]
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz" || req.url === "/") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify({
      ok: true,
      service: "unbound-browser-worker",
      authenticated: Boolean(AUTH_TOKEN),
      activeSessions,
      maxSessions: MAX_SESSIONS
    }));
  }
  res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
  return res.end(JSON.stringify({ error: "not-found" }));
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 8 * 1024 * 1024,
  handleProtocols(protocols) {
    return protocols.has(PROTOCOL) ? PROTOCOL : false;
  }
});

server.on("upgrade", (request, socket, head) => {
  let pathname = "";
  try { pathname = new URL(request.url, "http://localhost").pathname; } catch (_) {}
  if (pathname !== "/cdp") {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  if (!authorized(request)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  if (activeSessions >= MAX_SESSIONS) {
    socket.write("HTTP/1.1 503 Service Unavailable\r\nRetry-After: 5\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
});

wss.on("connection", async (client) => {
  activeSessions += 1;
  let browser = null;
  let upstream = null;
  let closed = false;
  let idleTimer = null;
  const pending = [];

  function armIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => finish(1000, "idle-timeout"), IDLE_TIMEOUT_MS);
    idleTimer.unref?.();
  }

  async function finish(code = 1000, reason = "closed") {
    if (closed) return;
    closed = true;
    if (idleTimer) clearTimeout(idleTimer);
    try { upstream?.close(); } catch (_) {}
    try { if (client.readyState === WebSocket.OPEN) client.close(code, String(reason).slice(0, 120)); } catch (_) {}
    try { await browser?.close(); } catch (_) {}
    activeSessions = Math.max(0, activeSessions - 1);
  }

  client.on("message", (data, isBinary) => {
    armIdleTimer();
    if (upstream?.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    } else if (pending.length < 100) {
      pending.push({ data, isBinary });
    }
  });
  client.on("close", () => void finish(1000, "client-closed"));
  client.on("error", () => void finish(1011, "client-error"));
  armIdleTimer();

  try {
    browser = await launchBrowser();
    upstream = new WebSocket(browser.wsEndpoint(), { maxPayload: 8 * 1024 * 1024 });
    upstream.on("open", () => {
      for (const item of pending.splice(0)) upstream.send(item.data, { binary: item.isBinary });
    });
    upstream.on("message", (data, isBinary) => {
      armIdleTimer();
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
    });
    upstream.on("close", () => void finish(1000, "browser-closed"));
    upstream.on("error", () => void finish(1011, "browser-error"));
  } catch (error) {
    console.error("UNBOUND BROWSER WORKER LAUNCH ERROR:", error?.message || error);
    await finish(1011, "browser-launch-failed");
  }
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`UNBOUND browser worker listening on port ${PORT}; max sessions ${MAX_SESSIONS}.`);
});
