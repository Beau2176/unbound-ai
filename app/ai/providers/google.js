const {
  combineSystemAndMessages,
  providerError
} = require("./provider-utils");
const {
  runWithProviderDeadline
} = require("../provider-deadline");

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3.8-flash";
const GEMINI_THINKING_LEVELS = new Set(["low", "medium", "high"]);
const MAX_STREAM_BUFFER_BYTES = 2 * 1024 * 1024;
const MAX_STREAM_REPLY_CHARS = 4 * 1024 * 1024;

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
  if (!raw) return null;
  if (raw === "none" || raw === "minimal") return "low";
  if (raw === "xhigh" || raw === "max") return "high";
  return GEMINI_THINKING_LEVELS.has(raw) ? raw : null;
}

function buildGeminiRequestBody(instructions, input, reasoningEffort = null) {
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

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((part) => part?.thought !== true && typeof part?.text === "string")
    .map((part) => part.text)
    .join("");
}

function geminiEndpoint(model, { streaming = false } = {}) {
  const selectedModel = String(model || getModel()).trim() || getModel();
  const method = streaming ? "streamGenerateContent" : "generateContent";
  const suffix = streaming ? "?alt=sse" : "";
  return `${GEMINI_BASE_URL}/models/${encodeURIComponent(selectedModel)}:${method}${suffix}`;
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

async function generateChat({
  instructions,
  input,
  model,
  reasoningEffort = null,
  signal: requestSignal = null,
  fetchImpl = fetch
} = {}) {
  assertConfigured();
  const selectedModel = String(model || getModel()).trim() || getModel();

  return runWithProviderDeadline(
    "chat",
    async ({ signal }) => {
      const response = await fetchImpl(geminiEndpoint(selectedModel), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey()
        },
        redirect: "error",
        signal,
        body: JSON.stringify(buildGeminiRequestBody(instructions, input, reasoningEffort))
      });
      if (!response.ok) {
        const payload = await parseErrorPayload(response);
        throw providerError(
          "GEMINI_REQUEST_FAILED",
          payload?.error?.message || "Gemini request failed.",
          response.status || 502
        );
      }
      const payload = await response.json().catch(() => ({}));
      const reply = extractGeminiText(payload);

      return {
        provider: "google",
        model: selectedModel,
        reply,
        usage: payload.usageMetadata || null,
        responseId: payload.responseId || null,
        research: { sources: [], citations: [], webSearchCalls: 0 }
      };
    },
    {
      externalSignal: requestSignal,
      code: "GEMINI_REQUEST_TIMEOUT",
      label: "Gemini request"
    }
  );
}
function parseSseEvent(block) {
  const data = String(block || "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  if (!data || data === "[DONE]") return null;
  try {
    return JSON.parse(data);
  } catch (_) {
    throw providerError("GEMINI_STREAM_INVALID_EVENT", "Gemini streaming response contained invalid SSE data.", 502);
  }
}

async function streamChat({
  instructions,
  input,
  model,
  onDelta,
  reasoningEffort = null,
  signal: requestSignal = null,
  fetchImpl = fetch
} = {}) {
  assertConfigured();
  const selectedModel = String(model || getModel()).trim() || getModel();

  return runWithProviderDeadline(
    "stream",
    async ({ signal }) => {
      const response = await fetchImpl(geminiEndpoint(selectedModel, { streaming: true }), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "text/event-stream",
          "x-goog-api-key": apiKey()
        },
        redirect: "error",
        signal,
        body: JSON.stringify(buildGeminiRequestBody(instructions, input, reasoningEffort))
      });

      if (!response.ok) {
        const payload = await parseErrorPayload(response);
        throw providerError(
          "GEMINI_STREAM_REQUEST_FAILED",
          payload?.error?.message || "Gemini streaming request failed.",
          response.status || 502
        );
      }
      if (!response.body) {
        throw providerError(
          "GEMINI_STREAM_BODY_MISSING",
          "Gemini streaming response did not include a response body.",
          502
        );
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let reply = "";
      let usage = null;
      let responseId = null;

      async function handlePayload(payload) {
        const delta = extractGeminiText(payload);
        if (delta) {
          if (reply.length + delta.length > MAX_STREAM_REPLY_CHARS) {
            throw providerError(
              "GEMINI_STREAM_REPLY_TOO_LARGE",
              "Gemini streaming reply exceeded the allowed size.",
              502
            );
          }
          reply += delta;
          if (onDelta) await onDelta(delta);
        }
        if (payload?.usageMetadata) usage = payload.usageMetadata;
        if (payload?.responseId) responseId = payload.responseId;
      }

      async function consumeText(text, flush = false) {
        buffer += String(text || "");
        if (Buffer.byteLength(buffer, "utf8") > MAX_STREAM_BUFFER_BYTES) {
          throw providerError(
            "GEMINI_STREAM_BUFFER_TOO_LARGE",
            "Gemini streaming event buffer exceeded the allowed size.",
            502
          );
        }

        const blocks = buffer.split(/\r?\n\r?\n/);
        if (!flush) {
          buffer = blocks.pop() || "";
        } else {
          buffer = "";
        }

        for (const block of blocks) {
          const payload = parseSseEvent(block);
          if (payload) await handlePayload(payload);
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
          await consumeText(
            typeof chunk === "string"
              ? chunk
              : decoder.decode(chunk, { stream: true })
          );
        }
        await consumeText(decoder.decode(), true);
      } else {
        throw providerError(
          "GEMINI_STREAM_UNREADABLE",
          "Gemini streaming response body is not readable.",
          502
        );
      }

      return {
        provider: "google",
        model: selectedModel,
        reply,
        usage,
        responseId,
        research: { sources: [], citations: [], webSearchCalls: 0 }
      };
    },
    {
      externalSignal: requestSignal,
      code: "GEMINI_STREAM_TIMEOUT",
      label: "Gemini streaming request"
    }
  );
}
module.exports = {
  id: "google",
  GEMINI_BASE_URL,
  DEFAULT_MODEL,
  GEMINI_THINKING_LEVELS,
  MAX_STREAM_BUFFER_BYTES,
  MAX_STREAM_REPLY_CHARS,
  getModel,
  isConfigured,
  supportsResearch,
  supportsFileAnalysis,
  toGeminiContents,
  normalizeThinkingLevel,
  buildGeminiRequestBody,
  extractGeminiText,
  geminiEndpoint,
  parseSseEvent,
  generateChat,
  streamChat
};
