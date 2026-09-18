const {
  combineSystemAndMessages,
  providerError,
  normalizeHttpEndpoint
} = require("./provider-utils");

function getModel() {
  return String(process.env.UNBOUND_LOCAL_AI_MODEL || "local").trim() || "local";
}

function endpoint() {
  const parsed = normalizeHttpEndpoint(process.env.UNBOUND_LOCAL_AI_ENDPOINT, { allowHttp: true });
  if (!parsed) return null;
  if (/\/v1\/chat\/completions\/?$/.test(parsed.pathname)) return parsed.toString();
  parsed.pathname = parsed.pathname.replace(/\/$/, "") + "/v1/chat/completions";
  return parsed.toString();
}

function isConfigured() {
  return Boolean(endpoint());
}

function supportsResearch() {
  return false;
}

function supportsFileAnalysis() {
  return false;
}

function assertConfigured() {
  if (!isConfigured()) throw providerError("AI_PROVIDER_NOT_CONFIGURED", "Local AI provider is not configured.", 503);
}

async function generateChat({ instructions, input, model, fetchImpl = fetch } = {}) {
  assertConfigured();
  const selectedModel = String(model || getModel()).trim() || getModel();
  const normalized = combineSystemAndMessages(instructions, input);
  const messages = [];
  if (normalized.system) messages.push({ role: "system", content: normalized.system });
  messages.push(...normalized.messages);

  const headers = { "content-type": "application/json" };
  const token = String(process.env.UNBOUND_LOCAL_AI_API_KEY || "").trim();
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetchImpl(endpoint(), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: selectedModel,
      messages,
      stream: false
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw providerError("LOCAL_AI_REQUEST_FAILED", payload?.error?.message || "Local AI request failed.", response.status || 502);
  }

  return {
    provider: "local",
    model: payload.model || selectedModel,
    reply: String(payload?.choices?.[0]?.message?.content || ""),
    usage: payload.usage || null,
    responseId: payload.id || null,
    research: { sources: [], citations: [], webSearchCalls: 0 }
  };
}

module.exports = {
  id: "local",
  getModel,
  endpoint,
  isConfigured,
  supportsResearch,
  supportsFileAnalysis,
  generateChat
};
