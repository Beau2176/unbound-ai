const {
  combineSystemAndMessages,
  providerError
} = require("./provider-utils");

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3.8-flash";
const GEMINI_THINKING_LEVELS = new Set(["low", "medium", "high"]);
const MAX_ERROR_MESSAGE_CHARS = 1000;

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

function normalizeThinkingLevel(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "none") return null;
  if (raw === "xhigh" || raw === "max") return "high";
  return GEMINI_THINKING_LEVELS.has(raw) ? raw : null;
}

function buildGenerateContentBody({
  instructions,
  input,
  reasoningEffort = null
} = {}) {
  const normalized = combineSystemAndMessages(instructions, input);
  const body = {
    contents: toGeminiContents(normalized.messages)
  };
  if (normalized.system) {
    body.systemInstruction = { parts: [{ text: normalized.system }] };
  }

  const thinkingLevel = normalizeThinkingLevel(reasoningEffort);
  if (thinkingLevel) {
    body.generationConfig = {
      thinkingConfig: {
        thinkingLevel
      }
    };
  }

  return body;
}

function extractReply(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((part) => part?.thought !== true && typeof part?.text === "string")
    .map((part) => part.text)
    .join("");
}

function errorMessage(payload, fallback) {
  return String(payload?.error?.message || fallback || "Gemini request failed.")
    .trim()
    .slice(0, MAX_ERROR_MESSAGE_CHARS) || "Gemini request failed.";
}

function requestHeaders() {
  return {
    "content-type": "application/json",
    "x-goog-api-key": apiKey()
  };
}

async function parseErrorResponse(response, fallback) {
  let payload = {};
  try {
    payload = await response.json();
  } catch (_) {}
  throw providerError(
    "GEMINI_REQUEST_FAILED",
    errorMessage(payload, fallback),
    response.status || 502
  );
}

async function generateChat({
  instructions,
  input,
  model,
  reasoningEffort = null,
  fetchImpl = fetch
} = {}) {
  assertConfigured();
  const selectedModel = String(model || getModel()).trim() || getModel();
  const body = buildGenerateContentBody({
    instructions,
    input,
    reasoningEffort
  });

  const endpoint = `${GEMINI_BASE_URL}/models/${encodeURIComponent(selectedModel)}:generateContent`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: requestHeaders(),
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    await parseErrorResponse(response, "Gemini request failed.");
  }
  const payload = await response.json().catch(() => ({}));

  return {
    provider: "google",
    model: selectedModel,
    reply: extractReply(payload),
    usage: payload.usageMetadata || null,
    responseId: payload.responseId || null,
    research: { sources: [], citations: [], webSearchCalls: 0 }
  };
}

function splitSseFrames(buffer) {
  const normalized = String(buffer || "").replace(/\r\n/g, "\n");
  const frames = [];
  let rest = normalized;
  let index;
  while ((index = rest.indexOf("\n\n")) >= 0) {
    frames.push(rest.slice(0, index));
    rest = rest.slice(index + 2);
  }
  return { frames, rest };
}

function parseSseFrame(frame) {
  const data = String(frame || "")
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return null;
  try {
    return JSON.parse(data);
  } catch (_) {
    throw providerError("GEMINI_STREAM_INVALID", "Gemini returned an invalid streaming response.", 502);
  }
}

async function streamChat({
  instructions,
  input,
  model,
  onDelta,
  reasoningEffort = null,
  fetchImpl = fetch
} = {}) {
  assertConfigured();
  const selectedModel = String(model || getModel()).trim() || getModel();
  const body = buildGenerateContentBody({
    instructions,
    input,
    reasoningEffort
  });
  const endpoint = `${GEMINI_BASE_URL}/models/${encodeURIComponent(selectedModel)}:streamGenerateContent?alt=sse`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      ...requestHeaders(),
      accept: "text/event-stream"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    await parseErrorResponse(response, "Gemini streaming request failed.");
  }
  if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") {
    throw providerError("GEMINI_STREAM_UNAVAILABLE", "Gemini did not return a readable streaming response.", 502);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
  let usage = null;
  let responseId = null;

  const handleFrame = async (frame) => {
    const payload = parseSseFrame(frame);
    if (!payload) return;
    const delta = extractReply(payload);
    if (delta) {
      reply += delta;
      if (onDelta) await onDelta(delta);
    }
    if (payload.usageMetadata) usage = payload.usageMetadata;
    if (payload.responseId) responseId = payload.responseId;
  };

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const parsed = splitSseFrames(buffer);
    buffer = parsed.rest;
    for (const frame of parsed.frames) {
      await handleFrame(frame);
    }
  }

  buffer += decoder.decode();
  const finalParsed = splitSseFrames(buffer + "\n\n");
  for (const frame of finalParsed.frames) {
    await handleFrame(frame);
  }

  return {
    provider: "google",
    model: selectedModel,
    reply,
    usage,
    responseId,
    research: { sources: [], citations: [], webSearchCalls: 0 }
  };
}

module.exports = {
  id: "google",
  GEMINI_BASE_URL,
  DEFAULT_MODEL,
  GEMINI_THINKING_LEVELS,
  getModel,
  isConfigured,
  supportsResearch,
  supportsFileAnalysis,
  toGeminiContents,
  normalizeThinkingLevel,
  buildGenerateContentBody,
  extractReply,
  splitSseFrames,
  parseSseFrame,
  generateChat,
  streamChat
};
