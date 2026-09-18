const {
  combineSystemAndMessages,
  providerError
} = require("./provider-utils");

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5";

function getModel() {
  return String(process.env.ANTHROPIC_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function isConfigured() {
  return Boolean(String(process.env.ANTHROPIC_API_KEY || "").trim());
}

function supportsResearch() {
  return false;
}

function supportsFileAnalysis() {
  return false;
}

function assertConfigured() {
  if (!isConfigured()) throw providerError("AI_PROVIDER_NOT_CONFIGURED", "Anthropic provider is not configured.", 503);
}

function maxTokens() {
  const value = Number.parseInt(String(process.env.ANTHROPIC_MAX_TOKENS || "4096"), 10);
  return Number.isFinite(value) ? Math.min(Math.max(value, 256), 32000) : 4096;
}

async function generateChat({ instructions, input, model, fetchImpl = fetch } = {}) {
  assertConfigured();
  const selectedModel = String(model || getModel()).trim() || getModel();
  const normalized = combineSystemAndMessages(instructions, input);
  const body = {
    model: selectedModel,
    max_tokens: maxTokens(),
    messages: normalized.messages
  };
  if (normalized.system) body.system = normalized.system;

  const response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw providerError("ANTHROPIC_REQUEST_FAILED", payload?.error?.message || "Anthropic request failed.", response.status || 502);
  }

  const reply = (Array.isArray(payload.content) ? payload.content : [])
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");

  return {
    provider: "anthropic",
    model: payload.model || selectedModel,
    reply,
    usage: payload.usage || null,
    responseId: payload.id || null,
    research: { sources: [], citations: [], webSearchCalls: 0 }
  };
}

module.exports = {
  id: "anthropic",
  ANTHROPIC_MESSAGES_URL,
  getModel,
  isConfigured,
  supportsResearch,
  supportsFileAnalysis,
  generateChat
};
