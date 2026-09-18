const crypto = require("crypto");

const A2A_PROTOCOL_VERSION = "1.0";
const A2A_CARD_PATH = "/.well-known/agent-card.json";
const MAX_A2A_MESSAGE_CHARS = 12000;
const MAX_A2A_RESPONSE_BYTES = 2 * 1024 * 1024;

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function a2aError(code, message, statusCode = 502) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function configuredCardUrl(env = process.env) {
  const raw = String(env.UNBOUND_A2A_AGENT_CARD_URL || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (!url.pathname || url.pathname === "/") url.pathname = A2A_CARD_PATH;
    return url;
  } catch (_) {
    return null;
  }
}

function publicA2AStatus(env = process.env) {
  const cardUrl = configuredCardUrl(env);
  return {
    configured: Boolean(cardUrl),
    protocolVersion: A2A_PROTOCOL_VERSION,
    agentCardConfigured: Boolean(cardUrl),
    arbitraryUserEndpointsAllowed: false,
    outboundMessagesRequireApproval: true,
    supportedBindings: ["HTTP+JSON", "JSONRPC"],
    crossOriginInterfacesAllowed: enabled(env.UNBOUND_A2A_ALLOW_CROSS_ORIGIN_INTERFACE),
    credentialsExposed: false
  };
}

function requestHeaders(env = process.env, { json = false } = {}) {
  const headers = {
    accept: json ? "application/a2a+json, application/json" : "application/json",
    "A2A-Version": A2A_PROTOCOL_VERSION,
    "User-Agent": "UNBOUND-AI-A2A/1.0"
  };
  if (json) headers["content-type"] = "application/a2a+json";
  const token = String(env.UNBOUND_A2A_TOKEN || "").trim();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function fetchJson(url, {
  method = "GET",
  body,
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = 20000,
  jsonRpc = false
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Math.max(Number(timeoutMs) || 20000, 1000), 60000));
  timer.unref?.();
  try {
    const headers = requestHeaders(env, { json: body !== undefined });
    if (jsonRpc && body !== undefined) headers["content-type"] = "application/json";
    const response = await fetchImpl(String(url), {
      method,
      headers,
      signal: controller.signal,
      redirect: "error",
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const length = Number(response.headers?.get?.("content-length") || 0);
    if (length > MAX_A2A_RESPONSE_BYTES) {
      throw a2aError("A2A_RESPONSE_TOO_LARGE", "A2A peer response exceeded the allowed size.", 502);
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_A2A_RESPONSE_BYTES) {
      throw a2aError("A2A_RESPONSE_TOO_LARGE", "A2A peer response exceeded the allowed size.", 502);
    }
    let payload = null;
    try { payload = JSON.parse(raw); } catch (_) {}
    if (!response.ok) {
      const remoteMessage =
        payload?.error?.message ||
        payload?.message ||
        "A2A peer request failed.";
      throw a2aError("A2A_REMOTE_REQUEST_FAILED", String(remoteMessage).slice(0, 500), response.status || 502);
    }
    if (!payload || typeof payload !== "object") {
      throw a2aError("A2A_REMOTE_RESPONSE_INVALID", "A2A peer returned an invalid JSON response.", 502);
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw a2aError("A2A_REQUEST_TIMEOUT", "A2A peer request timed out.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function publicAgentCard(card = {}) {
  const interfaces = Array.isArray(card.supportedInterfaces)
    ? card.supportedInterfaces.slice(0, 10).map((item) => ({
        url: String(item?.url || "").slice(0, 1000),
        protocolBinding: String(item?.protocolBinding || "").slice(0, 40),
        protocolVersion: String(item?.protocolVersion || "").slice(0, 20),
        tenant: item?.tenant ? String(item.tenant).slice(0, 300) : null
      }))
    : [];
  const skills = Array.isArray(card.skills)
    ? card.skills.slice(0, 100).map((skill) => ({
        id: String(skill?.id || "").slice(0, 160),
        name: String(skill?.name || "").slice(0, 220),
        description: String(skill?.description || "").slice(0, 1000),
        tags: Array.isArray(skill?.tags) ? skill.tags.slice(0, 30).map((tag) => String(tag).slice(0, 100)) : []
      }))
    : [];
  return {
    name: String(card.name || "").slice(0, 220),
    description: String(card.description || "").slice(0, 2000),
    version: String(card.version || "").slice(0, 80),
    capabilities: card.capabilities && typeof card.capabilities === "object" ? card.capabilities : {},
    defaultInputModes: Array.isArray(card.defaultInputModes) ? card.defaultInputModes.slice(0, 20) : [],
    defaultOutputModes: Array.isArray(card.defaultOutputModes) ? card.defaultOutputModes.slice(0, 20) : [],
    supportedInterfaces: interfaces,
    skills,
    securitySchemeNames: card.securitySchemes && typeof card.securitySchemes === "object"
      ? Object.keys(card.securitySchemes).slice(0, 30)
      : []
  };
}

function validateAgentCard(card) {
  if (!card || typeof card !== "object" || !String(card.name || "").trim()) {
    throw a2aError("A2A_AGENT_CARD_INVALID", "A2A Agent Card is missing required identity information.", 502);
  }
  if (!Array.isArray(card.supportedInterfaces) || !card.supportedInterfaces.length) {
    throw a2aError("A2A_AGENT_CARD_NO_INTERFACE", "A2A Agent Card does not declare a supported interface.", 502);
  }
  return card;
}

async function getAgentCard({
  env = process.env,
  fetchImpl = fetch
} = {}) {
  const cardUrl = configuredCardUrl(env);
  if (!cardUrl) {
    throw a2aError("A2A_NOT_CONFIGURED", "A2A peer is not configured.", 503);
  }
  const card = validateAgentCard(await fetchJson(cardUrl, { env, fetchImpl }));
  return { card, cardUrl };
}

function selectInterface(card, cardUrl, env = process.env) {
  const supported = Array.isArray(card?.supportedInterfaces) ? card.supportedInterfaces : [];
  const candidates = supported
    .map((item, index) => {
      let url;
      try {
        url = new URL(String(item?.url || ""));
      } catch (_) {
        return null;
      }
      const binding = String(item?.protocolBinding || "").toUpperCase();
      const version = String(item?.protocolVersion || "");
      if (url.protocol !== "https:" || !["HTTP+JSON", "JSONRPC"].includes(binding)) return null;
      if (version && !version.startsWith("1.")) return null;
      if (
        !enabled(env.UNBOUND_A2A_ALLOW_CROSS_ORIGIN_INTERFACE) &&
        url.origin !== cardUrl.origin
      ) return null;
      return {
        index,
        url,
        binding,
        tenant: item?.tenant ? String(item.tenant).slice(0, 300) : null,
        protocolVersion: version || A2A_PROTOCOL_VERSION
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);
  if (!candidates.length) {
    throw a2aError(
      "A2A_NO_SUPPORTED_INTERFACE",
      "A2A peer does not expose a supported same-origin HTTP+JSON or JSON-RPC v1 interface.",
      502
    );
  }
  return candidates[0];
}

function normalizeTextMessage(value) {
  const text = String(value || "").trim();
  if (!text || text.length > MAX_A2A_MESSAGE_CHARS) {
    throw a2aError(
      "A2A_MESSAGE_INVALID",
      `A2A message must contain between 1 and ${MAX_A2A_MESSAGE_CHARS} characters.`,
      400
    );
  }
  return text;
}

function buildSendMessageRequest({
  text,
  tenant = null,
  taskId = null,
  contextId = null
} = {}) {
  const message = {
    messageId: crypto.randomUUID(),
    role: "ROLE_USER",
    parts: [{ text: normalizeTextMessage(text), mediaType: "text/plain" }]
  };
  if (taskId) message.taskId = String(taskId).slice(0, 500);
  if (contextId) message.contextId = String(contextId).slice(0, 500);
  const request = {
    message,
    configuration: { acceptedOutputModes: ["text/plain"] }
  };
  if (tenant) request.tenant = String(tenant).slice(0, 300);
  return request;
}

function httpMessageUrl(interfaceUrl) {
  const url = new URL(interfaceUrl.toString());
  url.pathname = url.pathname.replace(/\/$/, "") + "/message:send";
  url.search = "";
  url.hash = "";
  return url;
}

async function sendA2AMessage({
  text,
  approved = false,
  taskId = null,
  contextId = null,
  env = process.env,
  fetchImpl = fetch
} = {}) {
  if (approved !== true) {
    throw a2aError(
      "A2A_APPROVAL_REQUIRED",
      "Sending a message to another agent can trigger external work and requires explicit approval.",
      409
    );
  }

  const { card, cardUrl } = await getAgentCard({ env, fetchImpl });
  const selected = selectInterface(card, cardUrl, env);
  const params = buildSendMessageRequest({
    text,
    tenant: selected.tenant,
    taskId,
    contextId
  });

  let payload;
  if (selected.binding === "HTTP+JSON") {
    payload = await fetchJson(httpMessageUrl(selected.url), {
      method: "POST",
      body: params,
      env,
      fetchImpl
    });
  } else {
    payload = await fetchJson(selected.url, {
      method: "POST",
      body: {
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "SendMessage",
        params
      },
      env,
      fetchImpl,
      jsonRpc: true
    });
    if (payload.error) {
      throw a2aError(
        "A2A_REMOTE_ERROR",
        String(payload.error.message || "A2A JSON-RPC peer returned an error.").slice(0, 500),
        502
      );
    }
    payload = payload.result;
  }

  if (!payload || typeof payload !== "object" || (!payload.task && !payload.message)) {
    throw a2aError("A2A_SEND_RESPONSE_INVALID", "A2A peer returned an invalid SendMessage response.", 502);
  }

  return {
    status: "completed",
    peer: publicAgentCard(card),
    binding: selected.binding,
    protocolVersion: A2A_PROTOCOL_VERSION,
    result: {
      task: payload.task || null,
      message: payload.message || null
    }
  };
}

module.exports = {
  A2A_PROTOCOL_VERSION,
  A2A_CARD_PATH,
  MAX_A2A_MESSAGE_CHARS,
  configuredCardUrl,
  publicA2AStatus,
  requestHeaders,
  fetchJson,
  publicAgentCard,
  validateAgentCard,
  getAgentCard,
  selectInterface,
  buildSendMessageRequest,
  httpMessageUrl,
  sendA2AMessage
};
