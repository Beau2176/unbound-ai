const MCP_PROTOCOL_VERSION = "2026-07-28";
const DEFAULT_TIMEOUT_MS = 30000;

function clean(value, max = 1000) {
  const text = String(value || "").trim();
  return text && text.length <= max ? text : null;
}

function getMcpConfig(env = process.env) {
  const raw = clean(env.UNBOUND_MCP_GATEWAY_URL, 1000);
  let endpoint = null;
  try {
    const parsed = new URL(raw || "");
    if (parsed.protocol === "https:") endpoint = parsed.toString();
  } catch (_) {}
  const readOnlyTools = new Set(
    String(env.UNBOUND_MCP_READ_ONLY_TOOLS || "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => /^[A-Za-z0-9_.:-]{1,160}$/.test(item))
  );
  return {
    endpoint,
    token: clean(env.UNBOUND_MCP_GATEWAY_TOKEN, 2000),
    configured: Boolean(endpoint),
    readOnlyTools,
    timeoutMs: Math.min(Math.max(Number(env.UNBOUND_MCP_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, 3000), 120000)
  };
}

async function requestMcp(method, params = {}, {
  env = process.env,
  fetchImpl = fetch,
  name = null
} = {}) {
  const config = getMcpConfig(env);
  if (!config.configured) {
    const error = new Error("MCP gateway is not configured.");
    error.code = "MCP_GATEWAY_NOT_CONFIGURED";
    throw error;
  }
  const requestName = clean(name || params?.name || method, 160) || method;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  timer.unref?.();
  let response;
  try {
    response = await fetchImpl(config.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-method": method,
        "mcp-name": requestName,
        ...(config.token ? { authorization: `Bearer ${config.token}` } : {})
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: cryptoRandomId(),
        method,
        params,
        _meta: { protocolVersion: MCP_PROTOCOL_VERSION }
      })
    });
  } catch (cause) {
    const error = new Error(cause?.name === "AbortError" ? "MCP request timed out." : "MCP request failed.");
    error.code = cause?.name === "AbortError" ? "MCP_REQUEST_TIMEOUT" : "MCP_REQUEST_FAILED";
    error.cause = cause;
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const contentType = String(response.headers?.get?.("content-type") || "");
  let payload = null;
  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    const dataLines = text.split(/\r?\n/).filter((line) => line.startsWith("data:"));
    const last = dataLines.at(-1)?.slice(5).trim();
    try { payload = last ? JSON.parse(last) : null; } catch (_) {}
  } else {
    try { payload = await response.json(); } catch (_) {}
  }
  if (!response.ok || payload?.error) {
    const error = new Error("MCP gateway rejected the request.");
    error.code = "MCP_GATEWAY_ERROR";
    error.statusCode = response.status;
    error.rpcCode = payload?.error?.code || null;
    throw error;
  }
  return payload?.result ?? payload;
}

function cryptoRandomId() {
  return `unbound-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function listTools(options = {}) {
  const result = await requestMcp("tools/list", {}, { ...options, name: "tools" });
  return Array.isArray(result?.tools) ? result.tools : [];
}

async function callReadOnlyTool(name, args = {}, options = {}) {
  const config = getMcpConfig(options.env || process.env);
  const toolName = clean(name, 160);
  if (!toolName || !config.readOnlyTools.has(toolName)) {
    const error = new Error("That MCP tool is not in UNBOUND's server-side read-only allowlist.");
    error.code = "MCP_TOOL_NOT_READ_ONLY_ALLOWED";
    error.statusCode = 403;
    throw error;
  }
  return requestMcp("tools/call", { name: toolName, arguments: args && typeof args === "object" ? args : {} }, { ...options, name: toolName });
}

function publicMcpStatus(env = process.env) {
  const config = getMcpConfig(env);
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    configured: config.configured,
    statelessHttp: true,
    readOnlyToolCount: config.readOnlyTools.size,
    browserSuppliedEndpointsAccepted: false,
    rawTokenExposed: false
  };
}

module.exports = {
  MCP_PROTOCOL_VERSION,
  getMcpConfig,
  requestMcp,
  listTools,
  callReadOnlyTool,
  publicMcpStatus
};
