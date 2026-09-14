const dns = require("dns").promises;
const net = require("net");
const crypto = require("crypto");

const BROWSER_CONTROL_VERSION = "v1.0";
const DEFAULT_COMMAND_TIMEOUT_MS = 15000;
const DEFAULT_TASK_TIMEOUT_MS = 120000;
const MAX_ACTIONS = 12;
const MAX_PAGE_TEXT = 12000;
const MAX_ELEMENTS = 100;

function getBrowserControlConfig(env = process.env) {
  const endpoint = String(
    env.UNBOUND_BROWSER_CDP_URL ||
    env.BROWSER_WS_ENDPOINT ||
    ""
  ).trim();
  return Object.freeze({
    configured: /^wss?:\/\//i.test(endpoint) || /^https?:\/\//i.test(endpoint),
    endpoint,
    commandTimeoutMs: Math.min(
      Math.max(Number(env.UNBOUND_BROWSER_COMMAND_TIMEOUT_MS) || DEFAULT_COMMAND_TIMEOUT_MS, 3000),
      60000
    ),
    taskTimeoutMs: Math.min(
      Math.max(Number(env.UNBOUND_BROWSER_TASK_TIMEOUT_MS) || DEFAULT_TASK_TIMEOUT_MS, 30000),
      300000
    )
  });
}

function publicBrowserControlStatus(env = process.env) {
  const config = getBrowserControlConfig(env);
  return {
    version: BROWSER_CONTROL_VERSION,
    configured: config.configured,
    provider: config.configured ? "remote-cdp" : null,
    publicWebOnly: true,
    privateNetworkBlocked: true,
    finalActionConfirmationRequired: true,
    rawSecretsLogged: false
  };
}

function isPrivateIp(address) {
  const value = String(address || "").toLowerCase();
  const family = net.isIP(value);
  if (family === 4) {
    const octets = value.split(".").map(Number);
    if (octets[0] === 10 || octets[0] === 127 || octets[0] === 0) return true;
    if (octets[0] === 169 && octets[1] === 254) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    if (octets[0] >= 224) return true;
    return false;
  }
  if (family === 6) {
    if (value === "::1" || value === "::") return true;
    if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) return true;
  }
  return false;
}

const hostDecisionCache = new Map();

async function assertPublicHttpUrl(value, { allowHttp = false } = {}) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch (_) {
    const error = new Error("Browser target URL is invalid.");
    error.code = "BROWSER_URL_INVALID";
    error.statusCode = 400;
    throw error;
  }
  if (parsed.username || parsed.password) {
    const error = new Error("Credentials embedded in URLs are not allowed.");
    error.code = "BROWSER_URL_CREDENTIALS_BLOCKED";
    error.statusCode = 400;
    throw error;
  }
  if (parsed.protocol !== "https:" && !(allowHttp && parsed.protocol === "http:")) {
    const error = new Error("Browser control only opens public HTTPS pages.");
    error.code = "BROWSER_URL_PROTOCOL_BLOCKED";
    error.statusCode = 400;
    throw error;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isPrivateIp(hostname)
  ) {
    const error = new Error("Private or local network destinations are blocked.");
    error.code = "BROWSER_PRIVATE_NETWORK_BLOCKED";
    error.statusCode = 403;
    throw error;
  }

  let allowed = hostDecisionCache.get(hostname);
  if (allowed === undefined) {
    try {
      const resolved = await dns.lookup(hostname, { all: true, verbatim: true });
      allowed = resolved.length > 0 && resolved.every((item) => !isPrivateIp(item.address));
    } catch (_) {
      allowed = false;
    }
    hostDecisionCache.set(hostname, allowed);
    if (hostDecisionCache.size > 500) hostDecisionCache.clear();
  }
  if (!allowed) {
    const error = new Error("Target host could not be verified as public.");
    error.code = "BROWSER_HOST_NOT_PUBLIC";
    error.statusCode = 403;
    throw error;
  }
  return parsed.toString();
}

async function resolveCdpWebSocketUrl(endpoint, fetchImpl = globalThis.fetch) {
  const value = String(endpoint || "").trim();
  if (/^wss?:\/\//i.test(value)) return value;
  if (!/^https?:\/\//i.test(value) || typeof fetchImpl !== "function") {
    const error = new Error("Remote browser endpoint is not configured.");
    error.code = "BROWSER_CDP_NOT_CONFIGURED";
    error.statusCode = 503;
    throw error;
  }
  const response = await fetchImpl(value, {
    headers: { Accept: "application/json", "User-Agent": "UNBOUND-AI-Browser-Control/1.0" }
  });
  if (!response.ok) {
    const error = new Error(`Remote browser endpoint returned HTTP ${response.status}.`);
    error.code = "BROWSER_CDP_DISCOVERY_FAILED";
    error.statusCode = 502;
    throw error;
  }
  const payload = await response.json();
  const ws = payload?.webSocketDebuggerUrl || payload?.websocketUrl || payload?.wsUrl;
  if (!/^wss?:\/\//i.test(String(ws || ""))) {
    const error = new Error("Remote browser endpoint did not provide a CDP websocket URL.");
    error.code = "BROWSER_CDP_DISCOVERY_INVALID";
    error.statusCode = 502;
    throw error;
  }
  return ws;
}

class CdpClient {
  constructor({ url, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = {}) {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = [];
  }

  async connect() {
    if (typeof WebSocket !== "function") {
      const error = new Error("WebSocket support is unavailable.");
      error.code = "BROWSER_WEBSOCKET_UNAVAILABLE";
      throw error;
    }
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      const timer = setTimeout(() => {
        try { ws.close(); } catch (_) {}
        reject(Object.assign(new Error("Remote browser connection timed out."), { code: "BROWSER_CONNECT_TIMEOUT" }));
      }, this.timeoutMs);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve();
      }, { once: true });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(Object.assign(new Error("Remote browser connection failed."), { code: "BROWSER_CONNECT_FAILED" }));
      }, { once: true });
      ws.addEventListener("message", (event) => this._onMessage(event));
      ws.addEventListener("close", () => this._onClose());
    });
    return this;
  }

  _onMessage(event) {
    let message;
    try { message = JSON.parse(String(event.data || "")); } catch (_) { return; }
    if (message.id && this.pending.has(message.id)) {
      const item = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) {
        const error = new Error(message.error.message || "CDP command failed.");
        error.code = "BROWSER_CDP_COMMAND_FAILED";
        error.details = message.error;
        item.reject(error);
      } else {
        item.resolve(message.result || {});
      }
      return;
    }
    if (message.method) {
      const remaining = [];
      for (const waiter of this.waiters) {
        if (
          waiter.method === message.method &&
          (!waiter.sessionId || waiter.sessionId === message.sessionId) &&
          (!waiter.predicate || waiter.predicate(message.params || {}))
        ) {
          clearTimeout(waiter.timer);
          waiter.resolve(message.params || {});
        } else {
          remaining.push(waiter);
        }
      }
      this.waiters = remaining;
      if (typeof this.onEvent === "function") this.onEvent(message);
    }
  }

  _onClose() {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(Object.assign(new Error("Remote browser connection closed."), { code: "BROWSER_CONNECTION_CLOSED" }));
    }
    this.pending.clear();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(Object.assign(new Error("Remote browser connection closed."), { code: "BROWSER_CONNECTION_CLOSED" }));
    }
    this.waiters = [];
  }

  send(method, params = {}, sessionId = null) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(Object.assign(new Error("Remote browser is not connected."), { code: "BROWSER_NOT_CONNECTED" }));
    }
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error(`Browser command timed out: ${method}`), { code: "BROWSER_COMMAND_TIMEOUT" }));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(payload));
    });
  }

  waitFor(method, sessionId = null, timeoutMs = this.timeoutMs, predicate = null) {
    return new Promise((resolve, reject) => {
      const waiter = { method, sessionId, predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(Object.assign(new Error(`Browser event timed out: ${method}`), { code: "BROWSER_EVENT_TIMEOUT" }));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  close() {
    try { this.ws?.close(); } catch (_) {}
  }
}

function safeJsonLiteral(value) {
  return JSON.stringify(value);
}

async function evaluate(client, sessionId, expression, { awaitPromise = true, returnByValue = true } = {}) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue
  }, sessionId);
  if (result.exceptionDetails) {
    const error = new Error("Browser page script failed.");
    error.code = "BROWSER_PAGE_SCRIPT_FAILED";
    throw error;
  }
  return result.result?.value;
}

async function installNetworkGuard(client, sessionId) {
  const decisions = new Map();
  client.onEvent = async (message) => {
    if (message.sessionId !== sessionId || message.method !== "Fetch.requestPaused") return;
    const requestId = message.params?.requestId;
    const url = message.params?.request?.url;
    if (!requestId) return;
    try {
      const parsed = new URL(String(url || ""));
      if (["data:", "blob:", "about:"].includes(parsed.protocol)) {
        await client.send("Fetch.continueRequest", { requestId }, sessionId).catch(() => {});
        return;
      }
      if (!["https:", "http:"].includes(parsed.protocol)) {
        await client.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, sessionId).catch(() => {});
        return;
      }
      const key = parsed.hostname.toLowerCase();
      let ok = decisions.get(key);
      if (ok === undefined) {
        try {
          await assertPublicHttpUrl(
            `${parsed.protocol === "https:" ? "https" : "http"}://${parsed.host}/`,
            { allowHttp: true }
          );
          ok = true;
        } catch (_) {
          ok = false;
        }
        decisions.set(key, ok);
      }
      if (!ok) {
        await client.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, sessionId).catch(() => {});
      } else {
        await client.send("Fetch.continueRequest", { requestId }, sessionId).catch(() => {});
      }
    } catch (_) {
      await client.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, sessionId).catch(() => {});
    }
  };
  await client.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);
}

async function waitForLoad(client, sessionId, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
  try {
    await client.waitFor("Page.loadEventFired", sessionId, timeoutMs);
  } catch (_) {
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}

async function createBrowserSession({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = getBrowserControlConfig(env);
  if (!config.configured) {
    const error = new Error("Remote browser control is not configured.");
    error.code = "BROWSER_CONTROL_NOT_CONFIGURED";
    error.statusCode = 503;
    throw error;
  }
  const wsUrl = await resolveCdpWebSocketUrl(config.endpoint, fetchImpl);
  const client = await new CdpClient({ url: wsUrl, timeoutMs: config.commandTimeoutMs }).connect();
  let browserContextId = null;
  try {
    const context = await client.send("Target.createBrowserContext", { disposeOnDetach: true });
    browserContextId = context.browserContextId || null;
  } catch (_) {}

  const target = await client.send("Target.createTarget", {
    url: "about:blank",
    ...(browserContextId ? { browserContextId } : {})
  });
  const targetId = target.targetId;
  const attached = await client.send("Target.attachToTarget", { targetId, flatten: true });
  const sessionId = attached.sessionId;
  await client.send("Page.enable", {}, sessionId);
  await client.send("Runtime.enable", {}, sessionId);
  await installNetworkGuard(client, sessionId);

  let closed = false;
  return {
    id: crypto.randomUUID(),
    client,
    sessionId,
    targetId,
    browserContextId,
    config,
    async navigate(url) {
      const safeUrl = await assertPublicHttpUrl(url);
      const load = waitForLoad(client, sessionId, config.commandTimeoutMs);
      await client.send("Page.navigate", { url: safeUrl }, sessionId);
      await load;
      return this.snapshot();
    },
    async snapshot() {
      const expression = `(() => {
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
        };
        let n = 0;
        const elements = [];
        const nodes = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]'));
        for (const el of nodes) {
          if (!visible(el) || elements.length >= ${MAX_ELEMENTS}) continue;
          let ref = el.getAttribute('data-unbound-ref');
          if (!ref) {
            ref = 'u' + (++n) + '-' + Math.random().toString(36).slice(2,7);
            el.setAttribute('data-unbound-ref', ref);
          }
          const label = (
            el.getAttribute('aria-label') ||
            el.innerText ||
            el.value ||
            el.getAttribute('placeholder') ||
            el.getAttribute('name') ||
            el.getAttribute('title') ||
            ''
          ).replace(/\s+/g,' ').trim().slice(0,180);
          elements.push({
            ref,
            tag: el.tagName.toLowerCase(),
            type: (el.getAttribute('type') || '').toLowerCase(),
            name: (el.getAttribute('name') || '').slice(0,120),
            label,
            href: el.href ? String(el.href).slice(0,500) : null,
            checked: typeof el.checked === 'boolean' ? el.checked : null,
            disabled: Boolean(el.disabled)
          });
        }
        return {
          url: location.href,
          title: document.title || '',
          text: (document.body?.innerText || '').replace(/\n{3,}/g,'\n\n').slice(0, ${MAX_PAGE_TEXT}),
          elements
        };
      })()`;
      return evaluate(client, sessionId, expression);
    },
    async execute(action, variables = {}) {
      const type = String(action?.action || "").toLowerCase();
      if (!["click", "fill", "select", "check", "uncheck", "submit", "navigate", "wait", "read"].includes(type)) {
        const error = new Error("Browser action is not supported.");
        error.code = "BROWSER_ACTION_UNSUPPORTED";
        error.statusCode = 400;
        throw error;
      }
      if (type === "wait") {
        const ms = Math.min(Math.max(Number(action.ms) || 500, 100), 5000);
        await new Promise((resolve) => setTimeout(resolve, ms));
        return { ok: true, waitedMs: ms };
      }
      if (type === "navigate") return this.navigate(action.url);
      if (type === "read") return this.snapshot();

      const ref = String(action.ref || "").trim();
      if (!/^[A-Za-z0-9_-]{1,120}$/.test(ref)) {
        const error = new Error("Browser element reference is invalid.");
        error.code = "BROWSER_ELEMENT_REF_INVALID";
        error.statusCode = 400;
        throw error;
      }
      let value = action.value;
      if (action.variable) {
        const key = String(action.variable);
        if (!Object.prototype.hasOwnProperty.call(variables, key)) {
          const error = new Error(`Browser variable is missing: ${key}`);
          error.code = "BROWSER_VARIABLE_MISSING";
          error.statusCode = 400;
          throw error;
        }
        value = variables[key]?.value;
      }
      const refLiteral = safeJsonLiteral(ref);
      const valueLiteral = safeJsonLiteral(String(value ?? "").slice(0, 8000));
      const expression = `(() => {
        const el = document.querySelector('[data-unbound-ref="' + CSS.escape(${refLiteral}) + '"]');
        if (!el) return { ok:false, error:'element-not-found' };
        el.scrollIntoView({block:'center', inline:'center'});
        el.focus?.();
        const type = ${safeJsonLiteral(type)};
        if (type === 'click') {
          el.click();
          return {ok:true};
        }
        if (type === 'submit') {
          const form = el.tagName === 'FORM' ? el : el.closest('form');
          if (!form) return {ok:false,error:'form-not-found'};
          if (typeof form.requestSubmit === 'function') form.requestSubmit();
          else form.submit();
          return {ok:true};
        }
        if (type === 'fill') {
          const value = ${valueLiteral};
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
          if (descriptor?.set) descriptor.set.call(el, value);
          else el.value = value;
          el.dispatchEvent(new Event('input',{bubbles:true}));
          el.dispatchEvent(new Event('change',{bubbles:true}));
          return {ok:true};
        }
        if (type === 'select') {
          el.value = ${valueLiteral};
          el.dispatchEvent(new Event('input',{bubbles:true}));
          el.dispatchEvent(new Event('change',{bubbles:true}));
          return {ok:true};
        }
        if (type === 'check' || type === 'uncheck') {
          const wanted = type === 'check';
          if (Boolean(el.checked) !== wanted) el.click();
          return {ok:true,checked:Boolean(el.checked)};
        }
        return {ok:false,error:'unsupported'};
      })()`;
      const result = await evaluate(client, sessionId, expression);
      await new Promise((resolve) => setTimeout(resolve, 450));
      return result;
    },
    async close() {
      if (closed) return;
      closed = true;
      try { await client.send("Target.closeTarget", { targetId }); } catch (_) {}
      if (browserContextId) {
        try { await client.send("Target.disposeBrowserContext", { browserContextId }); } catch (_) {}
      }
      client.close();
    }
  };
}

module.exports = {
  BROWSER_CONTROL_VERSION,
  MAX_ACTIONS,
  MAX_PAGE_TEXT,
  MAX_ELEMENTS,
  getBrowserControlConfig,
  publicBrowserControlStatus,
  isPrivateIp,
  assertPublicHttpUrl,
  resolveCdpWebSocketUrl,
  CdpClient,
  createBrowserSession
};
