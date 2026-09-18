const MCP_PROTOCOL_VERSION = "2026-07-28";

function endpoint(env = process.env) {
  try {
    const parsed = new URL(String(env.UNBOUND_MCP_GATEWAY_URL || "").trim());
    if (parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

function publicMcpStatus(env = process.env) {
  return {
    configured: Boolean(endpoint(env)),
    protocolVersion: MCP_PROTOCOL_VERSION,
    transport: "streamable-http-stateless",
    arbitraryUserEndpointsAllowed: false,
    writeToolsRequireApproval: true
  };
}

function mcpError(code, message, statusCode = 502) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

async function mcpRequest({
  method,
  name,
  params = {},
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = 20000
} = {}) {
  const url = endpoint(env);
  if (!url) throw mcpError("MCP_GATEWAY_NOT_CONFIGURED", "MCP gateway is not configured.", 503);

  const headers = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    "Mcp-Method": String(method || ""),
    "Mcp-Name": String(name || "tools")
  };
  const token = String(env.UNBOUND_MCP_GATEWAY_TOKEN || "").trim();
  if (token) headers.authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Math.max(Number(timeoutMs) || 20000, 1000), 60000));
  timer.unref?.();

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw mcpError("MCP_GATEWAY_REQUEST_FAILED", payload?.error?.message || "MCP gateway request failed.", response.status || 502);
    }
    if (payload?.error) {
      throw mcpError("MCP_REMOTE_ERROR", payload.error.message || "MCP server returned an error.", 502);
    }
    return payload?.result ?? null;
  } catch (error) {
    if (error?.name === "AbortError") throw mcpError("MCP_GATEWAY_TIMEOUT", "MCP gateway request timed out.", 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function publicTool(tool = {}) {
  const annotations = tool?.annotations && typeof tool.annotations === "object" ? tool.annotations : {};
  return {
    name: String(tool.name || "").slice(0, 160),
    title: String(tool.title || tool.name || "Tool").slice(0, 220),
    description: String(tool.description || "").slice(0, 1000),
    inputSchema: tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : {},
    readOnly: annotations.readOnlyHint === true,
    destructive: annotations.destructiveHint === true,
    approvalRequired: annotations.readOnlyHint !== true
  };
}

async function listMcpTools(options = {}) {
  const result = await mcpRequest({ ...options, method: "tools/list", name: "tools", params: {} });
  const tools = Array.isArray(result?.tools) ? result.tools.map(publicTool).filter((tool) => tool.name) : [];
  return {
    tools,
    ttlMs: Number(result?.ttlMs || 0) || null,
    cacheScope: result?.cacheScope || null
  };
}

async function callMcpTool({
  tool,
  arguments: args = {},
  approved = false,
  env = process.env,
  fetchImpl = fetch
} = {}) {
  const toolName = String(tool?.name || "").trim();
  if (!toolName) throw mcpError("MCP_TOOL_INVALID", "MCP tool is invalid.", 400);
  const readOnly = tool?.readOnly === true || tool?.annotations?.readOnlyHint === true;
  if (!readOnly && approved !== true) {
    throw mcpError("MCP_TOOL_APPROVAL_REQUIRED", "This MCP tool may change external state and requires explicit approval.", 409);
  }

  const result = await mcpRequest({
    method: "tools/call",
    name: toolName,
    params: { name: toolName, arguments: args && typeof args === "object" ? args : {} },
    env,
    fetchImpl
  });

  if (result?.resultType === "input_required") {
    return {
      status: "input_required",
      requestState: result.requestState || null,
      requests: Array.isArray(result.requests) ? result.requests : [],
      content: []
    };
  }
  return {
    status: "completed",
    content: Array.isArray(result?.content) ? result.content : [],
    isError: Boolean(result?.isError)
  };
}

module.exports = {
  MCP_PROTOCOL_VERSION,
  endpoint,
  publicMcpStatus,
  mcpRequest,
  publicTool,
  listMcpTools,
  callMcpTool
};
