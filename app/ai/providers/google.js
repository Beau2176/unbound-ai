const {
  combineSystemAndMessages,
  providerError
} = require("./provider-utils");

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3.6-flash";

function getModel() {
  return String(process.env.GEMINI_MODEL || process.env.GOOGLE_AI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function apiKey() {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "").trim();
}

function isConfigured() {
  return Boolean(apiKey());
}

function supportsResearch() {
  return false;
}

function supportsFileAnalysis() {
  return false;
}

function assertConfigured() {
  if (!isConfigured()) throw providerError("AI_PROVIDER_NOT_CONFIGURED", "Google Gemini provider is not configured.", 503);
}

function toGeminiContents(messages) {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }]
  }));
}

async function generateChat({ instructions, input, model, fetchImpl = fetch } = {}) {
  assertConfigured();
  const selectedModel = String(model || getModel()).trim() || getModel();
  const normalized = combineSystemAndMessages(instructions, input);
  const body = {
    contents: toGeminiContents(normalized.messages)
  };
  if (normalized.system) {
    body.systemInstruction = { parts: [{ text: normalized.system }] };
  }

  const endpoint = `${GEMINI_BASE_URL}/models/${encodeURIComponent(selectedModel)}:generateContent`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey()
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw providerError("GEMINI_REQUEST_FAILED", payload?.error?.message || "Gemini request failed.", response.status || 502);
  }

  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const reply = parts.filter((part) => typeof part?.text === "string").map((part) => part.text).join("");

  return {
    provider: "google",
    model: selectedModel,
    reply,
    usage: payload.usageMetadata || null,
    responseId: payload.responseId || null,
    research: { sources: [], citations: [], webSearchCalls: 0 }
  };
}

module.exports = {
  id: "google",
  GEMINI_BASE_URL,
  getModel,
  isConfigured,
  supportsResearch,
  supportsFileAnalysis,
  toGeminiContents,
  generateChat
};
