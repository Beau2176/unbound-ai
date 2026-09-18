const {
  combineSystemAndMessages,
  retryAfterMsFromHeaders,
  assertProviderReplySize,
  providerError
} = require("./provider-utils");
const {
  runWithProviderDeadline
} = require("../provider-deadline");

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3.8-flash";
const GEMINI_THINKING_LEVELS = new Set(["low", "medium", "high"]);
const GOOGLE_GROUNDING_PROVIDER = "google_search";
const GOOGLE_GROUNDING_RETENTION_DAYS = 30;
const MAX_RESEARCH_SOURCES = 12;
const MAX_RESEARCH_CITATIONS = 30;
const MAX_SEARCH_SUGGESTIONS_HTML = 200 * 1024;
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

function googleGroundingApproved(env = process.env) {
  return ["1", "true", "yes", "on"].includes(
    String(env.UNBOUND_GOOGLE_SEARCH_GROUNDING_APPROVED || "")
      .trim()
      .toLowerCase()
  );
}

function supportsResearch() {
  return googleGroundingApproved();
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

function buildGeminiRequestBody(
  instructions,
  input,
  reasoningEffort = null,
  research = null
) {
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
  if (research?.enabled) {
    body.tools = [{ googleSearch: {} }];
  }
  return body;
}

function visibleGeminiParts(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const visible = [];
  let replyStartIndex = 0;

  parts.forEach((part, partIndex) => {
    if (part?.thought === true || typeof part?.text !== "string") return;
    const text = part.text;
    assertProviderReplySize(replyStartIndex, text.length, {
      code: "GEMINI_REPLY_TOO_LARGE",
      label: "Gemini"
    });
    visible.push({
      partIndex,
      text,
      replyStartIndex
    });
    replyStartIndex += text.length;
  });

  return visible;
}

function extractGeminiText(payload) {
  return visibleGeminiParts(payload).map((part) => part.text).join("");
}

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString().slice(0, 2048);
  } catch (_) {
    return null;
  }
}

function utf8ByteOffsetToStringIndex(text, byteOffset) {
  const value = String(text || "");
  const target = Number(byteOffset);
  if (!Number.isInteger(target) || target < 0) return null;

  const totalBytes = Buffer.byteLength(value, "utf8");
  if (target > totalBytes) return null;
  if (target === totalBytes) return value.length;

  let bytes = 0;
  let index = 0;
  for (const symbol of value) {
    if (bytes === target) return index;
    const size = Buffer.byteLength(symbol, "utf8");
    if (bytes + size > target) return null;
    bytes += size;
    index += symbol.length;
  }
  return bytes === target ? index : null;
}

function normalizeSearchSuggestionsHtml(value) {
  const html = typeof value === "string" ? value.trim() : "";
  if (!html || Buffer.byteLength(html, "utf8") > MAX_SEARCH_SUGGESTIONS_HTML) {
    return null;
  }
  return html;
}

function extractGeminiResearchMetadata(payload) {
  const candidate = payload?.candidates?.[0] || {};
  const metadata = candidate?.groundingMetadata || {};
  const visibleParts = visibleGeminiParts(payload);
  const visibleByPartIndex = new Map(
    visibleParts.map((part) => [part.partIndex, part])
  );

  const sources = [];
  const sourceNumberByChunkIndex = new Map();
  const seenUrls = new Map();

  for (const [chunkIndex, chunk] of (metadata.groundingChunks || []).entries()) {
    const url = safeHttpUrl(chunk?.web?.uri);
    if (!url) continue;

    let sourceNumber = seenUrls.get(url) || null;
    if (!sourceNumber && sources.length < MAX_RESEARCH_SOURCES) {
      sourceNumber = sources.length + 1;
      sources.push({
        number: sourceNumber,
        title: String(chunk?.web?.title || "Source").trim().slice(0, 220) || "Source",
        url
      });
      seenUrls.set(url, sourceNumber);
    }
    if (sourceNumber) sourceNumberByChunkIndex.set(chunkIndex, sourceNumber);
  }

  const citations = [];
  const citationKeys = new Set();

  for (const support of Array.isArray(metadata.groundingSupports)
    ? metadata.groundingSupports
    : []) {
    if (citations.length >= MAX_RESEARCH_CITATIONS) break;

    const segment = support?.segment || {};
    const partIndex = Number.isInteger(Number(segment.partIndex))
      ? Number(segment.partIndex)
      : 0;
    const visiblePart = visibleByPartIndex.get(partIndex);
    if (!visiblePart) continue;

    const localStart = utf8ByteOffsetToStringIndex(
      visiblePart.text,
      Number(segment.startIndex)
    );
    const localEnd = utf8ByteOffsetToStringIndex(
      visiblePart.text,
      Number(segment.endIndex)
    );
    if (
      localStart === null ||
      localEnd === null ||
      localEnd < localStart
    ) continue;

    const startIndex = visiblePart.replyStartIndex + localStart;
    const endIndex = visiblePart.replyStartIndex + localEnd;

    for (const rawIndex of Array.isArray(support?.groundingChunkIndices)
      ? support.groundingChunkIndices
      : []) {
      if (citations.length >= MAX_RESEARCH_CITATIONS) break;
      const sourceNumber = sourceNumberByChunkIndex.get(Number(rawIndex));
      if (!sourceNumber) continue;
      const key = `${sourceNumber}:${startIndex}:${endIndex}`;
      if (citationKeys.has(key)) continue;
      citationKeys.add(key);
      citations.push({ sourceNumber, startIndex, endIndex });
    }
  }

  citations.sort((a, b) => {
    if (a.endIndex !== b.endIndex) return a.endIndex - b.endIndex;
    return a.sourceNumber - b.sourceNumber;
  });

  const webSearchQueries = Array.isArray(metadata.webSearchQueries)
    ? metadata.webSearchQueries
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];
  const searchSuggestionsHtml = normalizeSearchSuggestionsHtml(
    metadata?.searchEntryPoint?.renderedContent
  );

  return {
    sources,
    citations,
    webSearchCalls: webSearchQueries.length || (sources.length ? 1 : 0),
    searchSuggestionsHtml,
    groundingProvider: GOOGLE_GROUNDING_PROVIDER,
    googleGrounded: Boolean(
      sources.length &&
      citations.length &&
      searchSuggestionsHtml
    ),
    providerRetentionDays: GOOGLE_GROUNDING_RETENTION_DAYS,
    storagePolicy: {
      persistText: true,
      persistSources: false,
      persistCitations: false,
      persistSearchSuggestions: false
    }
  };
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
  research = null,
  reasoningEffort = null,
  signal: requestSignal = null,
  fetchImpl = fetch
} = {}) {
  assertConfigured();
  if (research?.enabled && !googleGroundingApproved()) {
    throw providerError(
      "GEMINI_GROUNDING_APPROVAL_REQUIRED",
      "Google Search grounding is launch-gated until commercial-use approval is recorded.",
      503
    );
  }
  const selectedModel = String(model || getModel()).trim() || getModel();

  return runWithProviderDeadline(
    research?.enabled ? "research" : "chat",
    async ({ signal }) => {
      const response = await fetchImpl(geminiEndpoint(selectedModel), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey()
        },
        redirect: "error",
        signal,
        body: JSON.stringify(
          buildGeminiRequestBody(instructions, input, reasoningEffort, research)
        )
      });
      if (!response.ok) {
        const payload = await parseErrorPayload(response);
        throw providerError(
          "GEMINI_REQUEST_FAILED",
          payload?.error?.message || "Gemini request failed.",
          response.status || 502,
          { retryAfterMs: retryAfterMsFromHeaders(response.headers) }
        );
      }
      const payload = await response.json().catch(() => ({}));
      const reply = extractGeminiText(payload);
      let researchMetadata = {
        sources: [],
        citations: [],
        webSearchCalls: 0
      };

      if (research?.enabled) {
        researchMetadata = extractGeminiResearchMetadata(payload);
        if (!researchMetadata.googleGrounded) {
          throw providerError(
            "GEMINI_RESEARCH_GROUNDING_INCOMPLETE",
            "Gemini Research Mode did not return complete Google Search grounding metadata and Search Suggestions.",
            502
          );
        }
      }

      return {
        provider: "google",
        model: selectedModel,
        reply,
        usage: payload.usageMetadata || null,
        responseId: payload.responseId || null,
        research: researchMetadata
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
    throw providerError(
      "GEMINI_STREAM_INVALID_EVENT",
      "Gemini streaming response contained invalid SSE data.",
      502
    );
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
          response.status || 502,
          { retryAfterMs: retryAfterMsFromHeaders(response.headers) }
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
  GOOGLE_GROUNDING_PROVIDER,
  GOOGLE_GROUNDING_RETENTION_DAYS,
  MAX_RESEARCH_SOURCES,
  MAX_RESEARCH_CITATIONS,
  MAX_SEARCH_SUGGESTIONS_HTML,
  MAX_STREAM_BUFFER_BYTES,
  MAX_STREAM_REPLY_CHARS,
  getModel,
  isConfigured,
  googleGroundingApproved,
  supportsResearch,
  supportsFileAnalysis,
  toGeminiContents,
  normalizeThinkingLevel,
  buildGeminiRequestBody,
  visibleGeminiParts,
  extractGeminiText,
  utf8ByteOffsetToStringIndex,
  normalizeSearchSuggestionsHtml,
  extractGeminiResearchMetadata,
  geminiEndpoint,
  parseSseEvent,
  generateChat,
  streamChat
};
