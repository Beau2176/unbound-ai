const {
  combineSystemAndMessages,
  retryAfterMsFromHeaders,
  assertProviderReplySize,
  providerError
} = require("./provider-utils");
const {
  runWithProviderDeadline
} = require("../provider-deadline");

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5";
const ANTHROPIC_EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);
const ANTHROPIC_WEB_SEARCH_TOOL_TYPE = "web_search_20260318";
const ANTHROPIC_RESEARCH_SYSTEM_PROMPT = `
UNBOUND Research Mode is active.
- Use the provided web_search tool to investigate before answering.
- Ground current or externally verifiable claims in the returned web sources.
- Preserve the provider's source citations in the final response.
- If search results are insufficient, say what could not be verified instead of inventing facts.
`.trim();
const MAX_RESEARCH_SOURCES = 12;
const MAX_RESEARCH_CITATIONS = 30;
const MAX_RESEARCH_CONTINUATIONS = 3;
const MAX_STREAM_BUFFER_BYTES = 2 * 1024 * 1024;
const MAX_STREAM_REPLY_CHARS = 4 * 1024 * 1024;

function getModel() {
  return String(process.env.ANTHROPIC_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function isConfigured() {
  return Boolean(String(process.env.ANTHROPIC_API_KEY || "").trim());
}

function supportsResearch() {
  return true;
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

function normalizeEffort(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "none" || raw === "minimal") return "low";
  if (raw === "maximum") return "max";
  return ANTHROPIC_EFFORT_LEVELS.has(raw) ? raw : null;
}

function modelSupportsEffortControls(model) {
  const selected = String(model || getModel()).trim().toLowerCase();
  return /^claude-(?:sonnet-5|opus-5|fable-5|mythos-5)(?:$|-)/.test(selected);
}

function normalizeResearchMaxUses(value) {
  const count = Number.parseInt(String(value ?? "4"), 10);
  return Number.isFinite(count) ? Math.min(Math.max(count, 1), 10) : 4;
}

function buildAnthropicWebSearchTool(research = {}) {
  return {
    type: ANTHROPIC_WEB_SEARCH_TOOL_TYPE,
    name: "web_search",
    max_uses: normalizeResearchMaxUses(research.maxToolCalls),
    allowed_callers: ["direct"],
    response_inclusion: "full"
  };
}

function safeResearchUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString().slice(0, 2048);
  } catch (_) {
    return null;
  }
}

function extractAnthropicResponses(payloads) {
  const sources = [];
  const sourceNumbers = new Map();
  const citations = [];
  let reply = "";
  let webSearchCalls = 0;

  function addSource(rawUrl, rawTitle) {
    const url = safeResearchUrl(rawUrl);
    if (!url) return null;
    if (sourceNumbers.has(url)) return sourceNumbers.get(url);
    if (sources.length >= MAX_RESEARCH_SOURCES) return null;
    const number = sources.length + 1;
    sources.push({
      number,
      title: String(rawTitle || "Source").trim().slice(0, 220) || "Source",
      url
    });
    sourceNumbers.set(url, number);
    return number;
  }

  const list = Array.isArray(payloads) ? payloads : [payloads];
  for (const payload of list) {
    let observedSearchCalls = 0;
    for (const block of Array.isArray(payload?.content) ? payload.content : []) {
      if (block?.type === "server_tool_use" && block?.name === "web_search") {
        observedSearchCalls += 1;
        continue;
      }

      if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const result of block.content) {
          if (result?.type === "web_search_result") {
            addSource(result.url, result.title);
          }
        }
        continue;
      }

      if (block?.type !== "text" || typeof block.text !== "string") continue;

      const startIndex = reply.length;
      assertProviderReplySize(reply.length, block.text.length, {
        code: "ANTHROPIC_REPLY_TOO_LARGE",
        label: "Anthropic"
      });
      reply += block.text;
      const endIndex = reply.length;

      if (endIndex <= startIndex || !Array.isArray(block.citations)) continue;
      for (const citation of block.citations) {
        if (
          citations.length >= MAX_RESEARCH_CITATIONS ||
          citation?.type !== "web_search_result_location"
        ) continue;
        const sourceNumber = addSource(citation.url, citation.title);
        if (!sourceNumber) continue;
        citations.push({ sourceNumber, startIndex, endIndex });
      }
    }

    const reportedSearchCalls = Math.max(
      0,
      Number(payload?.usage?.server_tool_use?.web_search_requests || 0)
    );
    webSearchCalls += Math.max(reportedSearchCalls, observedSearchCalls);
  }

  return {
    reply,
    research: { sources, citations, webSearchCalls }
  };
}

function mergeAnthropicUsage(payloads) {
  const list = Array.isArray(payloads) ? payloads : [payloads];
  const total = {};
  let found = false;

  for (const payload of list) {
    const usage = payload?.usage;
    if (!usage || typeof usage !== "object") continue;
    found = true;
    for (const [key, value] of Object.entries(usage)) {
      if (key === "server_tool_use" && value && typeof value === "object") {
        total.server_tool_use = total.server_tool_use || {};
        for (const [nestedKey, nestedValue] of Object.entries(value)) {
          if (Number.isFinite(Number(nestedValue))) {
            total.server_tool_use[nestedKey] =
              Number(total.server_tool_use[nestedKey] || 0) + Number(nestedValue);
          }
        }
        continue;
      }
      if (Number.isFinite(Number(value))) {
        total[key] = Number(total[key] || 0) + Number(value);
      }
    }
  }

  return found ? total : null;
}

function buildAnthropicRequestBody(
  instructions,
  input,
  model,
  { streaming = false, reasoningEffort = null, research = null } = {}
) {
  const selectedModel = String(model || getModel()).trim() || getModel();
  const normalized = combineSystemAndMessages(instructions, input);
  const body = {
    model: selectedModel,
    max_tokens: maxTokens(),
    messages: normalized.messages
  };
  if (normalized.system) body.system = normalized.system;
  if (streaming) body.stream = true;

  if (research?.enabled) {
    body.system = [body.system, ANTHROPIC_RESEARCH_SYSTEM_PROMPT]
      .filter(Boolean)
      .join("\n\n");
    body.tools = [buildAnthropicWebSearchTool(research)];
  }

  const effort = normalizeEffort(reasoningEffort);
  if (effort && modelSupportsEffortControls(selectedModel)) {
    body.output_config = { effort };
  }
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
  const body = buildAnthropicRequestBody(
    instructions,
    input,
    model,
    { reasoningEffort, research }
  );
  const kind = research?.enabled ? "research" : "chat";

  return runWithProviderDeadline(
    kind,
    async ({ signal }) => {
      async function send(requestBody) {
        const response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
          method: "POST",
          headers: anthropicHeaders(),
          redirect: "error",
          signal,
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errorPayload = await parseErrorPayload(response);
          throw providerError(
            "ANTHROPIC_REQUEST_FAILED",
            errorPayload?.error?.message || "Anthropic request failed.",
            response.status || 502,
            { retryAfterMs: retryAfterMsFromHeaders(response.headers) }
          );
        }
        return response.json().catch(() => ({}));
      }

      const payloads = [];
      const continuationMessages = [...body.messages];
      let payload = await send(body);
      payloads.push(payload);
      let continuationCount = 0;

      while (
        research?.enabled &&
        payload?.stop_reason === "pause_turn" &&
        continuationCount < MAX_RESEARCH_CONTINUATIONS
      ) {
        continuationMessages.push({
          role: "assistant",
          content: Array.isArray(payload.content) ? payload.content : []
        });
        payload = await send({
          ...body,
          messages: continuationMessages
        });
        payloads.push(payload);
        continuationCount += 1;
      }

      if (research?.enabled && payload?.stop_reason === "pause_turn") {
        throw providerError(
          "ANTHROPIC_RESEARCH_CONTINUATION_LIMIT",
          "Anthropic research did not complete within the allowed continuation limit.",
          502
        );
      }

      const extracted = extractAnthropicResponses(payloads);

      return {
        provider: "anthropic",
        model: payload.model || body.model,
        reply: extracted.reply,
        usage: mergeAnthropicUsage(payloads),
        responseId: payload.id || payloads[0]?.id || null,
        research: research?.enabled
          ? extracted.research
          : { sources: [], citations: [], webSearchCalls: 0 }
      };
    },
    {
      externalSignal: requestSignal,
      code: research?.enabled
        ? "ANTHROPIC_RESEARCH_TIMEOUT"
        : "ANTHROPIC_REQUEST_TIMEOUT",
      label: research?.enabled
        ? "Anthropic Research Mode request"
        : "Anthropic request"
    }
  );
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
  reasoningEffort = null,
  signal: requestSignal = null,
  fetchImpl = fetch
} = {}) {
  return runWithProviderDeadline(
    "stream",
    async ({ signal }) => {
      assertConfigured();
      const body = buildAnthropicRequestBody(
        instructions,
        input,
        model,
        { streaming: true, reasoningEffort }
      );
      const headers = anthropicHeaders();
      headers.accept = "text/event-stream";

      const response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
        method: "POST",
        headers,
        redirect: "error",
        signal,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const payload = await parseErrorPayload(response);
        throw providerError(
          "ANTHROPIC_STREAM_REQUEST_FAILED",
          payload?.error?.message || "Anthropic streaming request failed.",
          response.status || 502,
          { retryAfterMs: retryAfterMsFromHeaders(response.headers) }
        );
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
    },
    {
      externalSignal: requestSignal,
      code: "ANTHROPIC_STREAM_TIMEOUT",
      label: "Anthropic streaming request"
    }
  );
}

module.exports = {
  id: "anthropic",
  ANTHROPIC_MESSAGES_URL,
  DEFAULT_MODEL,
  ANTHROPIC_EFFORT_LEVELS,
  ANTHROPIC_WEB_SEARCH_TOOL_TYPE,
  ANTHROPIC_RESEARCH_SYSTEM_PROMPT,
  MAX_RESEARCH_SOURCES,
  MAX_RESEARCH_CITATIONS,
  MAX_RESEARCH_CONTINUATIONS,
  MAX_STREAM_BUFFER_BYTES,
  MAX_STREAM_REPLY_CHARS,
  getModel,
  isConfigured,
  supportsResearch,
  supportsFileAnalysis,
  maxTokens,
  normalizeEffort,
  modelSupportsEffortControls,
  normalizeResearchMaxUses,
  buildAnthropicWebSearchTool,
  extractAnthropicResponses,
  mergeAnthropicUsage,
  buildAnthropicRequestBody,
  parseAnthropicSseEvent,
  generateChat,
  streamChat
};
