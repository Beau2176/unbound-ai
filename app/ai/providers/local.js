const {
  combineSystemAndMessages,
  providerError,
  normalizeHttpEndpoint
} = require("./provider-utils");
const {
  runWithProviderDeadline
} = require("../provider-deadline");

const MAX_STREAM_BUFFER_BYTES = 2 * 1024 * 1024;
const MAX_STREAM_REPLY_CHARS = 4 * 1024 * 1024;

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

function requestHeaders() {
  const headers = { "content-type": "application/json" };
  const token = String(process.env.UNBOUND_LOCAL_AI_API_KEY || "").trim();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function buildLocalMessages(instructions, input) {
  const normalized = combineSystemAndMessages(instructions, input);
  const messages = [];
  if (normalized.system) messages.push({ role: "system", content: normalized.system });
  messages.push(...normalized.messages);
  return messages;
}

function buildLocalRequestBody(instructions, input, model, { streaming = false } = {}) {
  return {
    model: String(model || getModel()).trim() || getModel(),
    messages: buildLocalMessages(instructions, input),
    stream: Boolean(streaming)
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

function publicResult(payload, selectedModel) {
  return {
    provider: "local",
    model: payload.model || selectedModel,
    reply: String(payload?.choices?.[0]?.message?.content || ""),
    usage: payload.usage || null,
    responseId: payload.id || null,
    research: { sources: [], citations: [], webSearchCalls: 0 }
  };
}

async function generateChat({
  instructions,
  input,
  model,
  signal: requestSignal = null,
  fetchImpl = fetch
} = {}) {
  assertConfigured();
  const body = buildLocalRequestBody(instructions, input, model);

  return runWithProviderDeadline(
    "chat",
    async ({ signal }) => {
      const response = await fetchImpl(endpoint(), {
        method: "POST",
        headers: requestHeaders(),
        signal,
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw providerError(
          "LOCAL_AI_REQUEST_FAILED",
          payload?.error?.message || "Local AI request failed.",
          response.status || 502
        );
      }
      return publicResult(payload, body.model);
    },
    {
      externalSignal: requestSignal,
      code: "LOCAL_AI_REQUEST_TIMEOUT",
      label: "Local AI request"
    }
  );
}
function parseOpenAiCompatibleSseEvent(block) {
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
    throw providerError("LOCAL_AI_STREAM_INVALID_EVENT", "Local AI streaming response contained invalid SSE data.", 502);
  }
}

async function streamChat({
  instructions,
  input,
  model,
  onDelta,
  signal: requestSignal = null,
  fetchImpl = fetch
} = {}) {
  assertConfigured();
  const body = buildLocalRequestBody(instructions, input, model, { streaming: true });
  const headers = requestHeaders();
  headers.accept = "text/event-stream, application/json";

  return runWithProviderDeadline(
    "stream",
    async ({ signal }) => {
      const response = await fetchImpl(endpoint(), {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const payload = await parseErrorPayload(response);
        throw providerError(
          "LOCAL_AI_STREAM_REQUEST_FAILED",
          payload?.error?.message || "Local AI streaming request failed.",
          response.status || 502
        );
      }

      const contentType = String(
        response.headers?.get?.("content-type") || ""
      ).toLowerCase();
      if (contentType.includes("application/json") && typeof response.json === "function") {
        const payload = await response.json().catch(() => ({}));
        const result = publicResult(payload, body.model);
        if (onDelta && result.reply) await onDelta(result.reply);
        return result;
      }

      if (!response.body) {
        throw providerError(
          "LOCAL_AI_STREAM_BODY_MISSING",
          "Local AI streaming response did not include a response body.",
          502
        );
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let reply = "";
      let usage = null;
      let responseId = null;
      let responseModel = body.model;

      async function handlePayload(payload) {
        if (!payload || typeof payload !== "object") return;
        if (payload.error) {
          throw providerError(
            "LOCAL_AI_STREAM_REMOTE_ERROR",
            String(
              payload?.error?.message ||
              payload?.error ||
              "Local AI streaming request failed."
            ).slice(0, 1000),
            502
          );
        }

        if (payload.id) responseId = String(payload.id);
        if (payload.model) responseModel = String(payload.model);
        if (payload.usage && typeof payload.usage === "object") usage = payload.usage;

        const delta = payload?.choices?.[0]?.delta?.content;
        const text = typeof delta === "string"
          ? delta
          : Array.isArray(delta)
            ? delta.map((part) => String(part?.text || "")).join("")
            : "";

        if (!text) return;
        if (reply.length + text.length > MAX_STREAM_REPLY_CHARS) {
          throw providerError(
            "LOCAL_AI_STREAM_REPLY_TOO_LARGE",
            "Local AI streaming reply exceeded the allowed size.",
            502
          );
        }
        reply += text;
        if (onDelta) await onDelta(text);
      }

      async function consumeText(text, flush = false) {
        buffer += String(text || "");
        if (Buffer.byteLength(buffer, "utf8") > MAX_STREAM_BUFFER_BYTES) {
          throw providerError(
            "LOCAL_AI_STREAM_BUFFER_TOO_LARGE",
            "Local AI streaming event buffer exceeded the allowed size.",
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
          const payload = parseOpenAiCompatibleSseEvent(block);
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
          "LOCAL_AI_STREAM_UNREADABLE",
          "Local AI streaming response body is not readable.",
          502
        );
      }

      return {
        provider: "local",
        model: responseModel,
        reply,
        usage,
        responseId,
        research: { sources: [], citations: [], webSearchCalls: 0 }
      };
    },
    {
      externalSignal: requestSignal,
      code: "LOCAL_AI_STREAM_TIMEOUT",
      label: "Local AI streaming request"
    }
  );
}
module.exports = {
  id: "local",
  MAX_STREAM_BUFFER_BYTES,
  MAX_STREAM_REPLY_CHARS,
  getModel,
  endpoint,
  isConfigured,
  supportsResearch,
  supportsFileAnalysis,
  requestHeaders,
  buildLocalMessages,
  buildLocalRequestBody,
  parseOpenAiCompatibleSseEvent,
  generateChat,
  streamChat
};
