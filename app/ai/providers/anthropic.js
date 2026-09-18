const {
  combineSystemAndMessages,
  providerError
} = require("./provider-utils");

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_STREAM_BUFFER_BYTES = 2 * 1024 * 1024;
const MAX_STREAM_REPLY_CHARS = 4 * 1024 * 1024;

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

function buildAnthropicRequestBody(instructions, input, model, { streaming = false } = {}) {
  const selectedModel = String(model || getModel()).trim() || getModel();
  const normalized = combineSystemAndMessages(instructions, input);
  const body = {
    model: selectedModel,
    max_tokens: maxTokens(),
    messages: normalized.messages
  };
  if (normalized.system) body.system = normalized.system;
  if (streaming) body.stream = true;
  return body;
}

function anthropicHeaders() {
  return {
    "content-type": "application/json",
    "accept": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01"
  };
}

async function parseErrorPayload(response) {
  try {
    return await response.json();
  } catch (_) {
    try {
      const text = await response.text();
      return { error: { message: String(text || "").slice(0, 1000) } };
    } catch (_) {
      return {};
    }
  }
}

async function generateChat({ instructions, input, model, fetchImpl = fetch } = {}) {
  assertConfigured();
  const body = buildAnthropicRequestBody(instructions, input, model);
  const response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: anthropicHeaders(),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const payload = await parseErrorPayload(response);
    throw providerError("ANTHROPIC_REQUEST_FAILED", payload?.error?.message || "Anthropic request failed.", response.status || 502);
  }

  const payload = await response.json().catch(() => ({}));
  const reply = (Array.isArray(payload.content) ? payload.content : [])
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");

  return {
    provider: "anthropic",
    model: payload.model || body.model,
    reply,
    usage: payload.usage || null,
    responseId: payload.id || null,
    research: { sources: [], citations: [], webSearchCalls: 0 }
  };
}

function parseAnthropicSseEvent(block) {
  const lines = String(block || "").split(/\r?\n/);
  const event = lines
    .filter((line) => line.startsWith("event:"))
    .map((line) => line.slice(6).trim())
    .filter(Boolean)
    .pop() || null;
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  if (!data || data === "[DONE]") return null;
  try {
    return { event, payload: JSON.parse(data) };
  } catch (_) {
    throw providerError("ANTHROPIC_STREAM_INVALID_EVENT", "Anthropic streaming response contained invalid SSE data.", 502);
  }
}

async function streamChat({
  instructions,
  input,
  model,
  onDelta,
  fetchImpl = fetch
} = {}) {
  assertConfigured();
  const body = buildAnthropicRequestBody(instructions, input, model, { streaming: true });
  const headers = anthropicHeaders();
  headers.accept = "text/event-stream";

  const response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const payload = await parseErrorPayload(response);
    throw providerError("ANTHROPIC_STREAM_REQUEST_FAILED", payload?.error?.message || "Anthropic streaming request failed.", response.status || 502);
  }
  if (!response.body) {
    throw providerError("ANTHROPIC_STREAM_BODY_MISSING", "Anthropic streaming response did not include a response body.", 502);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
  let usage = null;
  let responseId = null;
  let responseModel = body.model;

  async function handleEvent(item) {
    if (!item) return;
    const payload = item.payload || {};

    if (payload.type === "error" || item.event === "error") {
      throw providerError(
        "ANTHROPIC_STREAM_REMOTE_ERROR",
        String(payload?.error?.message || "Anthropic streaming request failed.").slice(0, 1000),
        502
      );
    }

    if (payload.type === "message_start") {
      responseId = payload?.message?.id || responseId;
      responseModel = payload?.message?.model || responseModel;
      if (payload?.message?.usage) usage = { ...payload.message.usage };
      return;
    }

    if (payload.type === "content_block_delta" && payload?.delta?.type === "text_delta") {
      const delta = String(payload.delta.text || "");
      if (!delta) return;
      if (reply.length + delta.length > MAX_STREAM_REPLY_CHARS) {
        throw providerError("ANTHROPIC_STREAM_REPLY_TOO_LARGE", "Anthropic streaming reply exceeded the allowed size.", 502);
      }
      reply += delta;
      if (onDelta) await onDelta(delta);
      return;
    }

    if (payload.type === "message_delta" && payload.usage && typeof payload.usage === "object") {
      usage = { ...(usage || {}), ...payload.usage };
    }
  }

  async function consumeText(text, flush = false) {
    buffer += String(text || "");
    if (Buffer.byteLength(buffer, "utf8") > MAX_STREAM_BUFFER_BYTES) {
      throw providerError("ANTHROPIC_STREAM_BUFFER_TOO_LARGE", "Anthropic streaming event buffer exceeded the allowed size.", 502);
    }

    const blocks = buffer.split(/\r?\n\r?\n/);
    if (!flush) {
      buffer = blocks.pop() || "";
    } else {
      buffer = "";
    }

    for (const block of blocks) {
      await handleEvent(parseAnthropicSseEvent(block));
    }
  }

  if (typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        await consumeText(decoder.decode(value, { stream: true }));
      }
      await consumeText(decoder.decode(), true);
    } finally {
      try { reader.releaseLock(); } catch (_) {}
    }
  } else if (Symbol.asyncIterator in Object(response.body)) {
    for await (const chunk of response.body) {
      await consumeText(typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }));
    }
    await consumeText(decoder.decode(), true);
  } else {
    throw providerError("ANTHROPIC_STREAM_UNREADABLE", "Anthropic streaming response body is not readable.", 502);
  }

  return {
    provider: "anthropic",
    model: responseModel,
    reply,
    usage,
    responseId,
    research: { sources: [], citations: [], webSearchCalls: 0 }
  };
}

module.exports = {
  id: "anthropic",
  ANTHROPIC_MESSAGES_URL,
  DEFAULT_MODEL,
  MAX_STREAM_BUFFER_BYTES,
  MAX_STREAM_REPLY_CHARS,
  getModel,
  isConfigured,
  supportsResearch,
  supportsFileAnalysis,
  maxTokens,
  buildAnthropicRequestBody,
  parseAnthropicSseEvent,
  generateChat,
  streamChat
};
