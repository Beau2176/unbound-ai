const MAX_PROVIDER_REPLY_CHARS = 4 * 1024 * 1024;

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    return String(part.text || part.input_text || part.output_text || "");
  }).filter(Boolean).join("\n");
}

function normalizeInputMessages(input = []) {
  return (Array.isArray(input) ? input : []).map((item) => ({
    role: item?.role === "assistant" ? "assistant" : "user",
    content: contentToText(item?.content)
  })).filter((item) => item.content);
}

function combineSystemAndMessages(instructions, input = []) {
  return {
    system: String(instructions || "").trim(),
    messages: normalizeInputMessages(input)
  };
}

function parseRetryAfterMs(value, { now = Date.now(), maxMs = 300000 } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const seconds = Number(raw);
  let delayMs = null;

  if (Number.isFinite(seconds) && seconds >= 0) {
    delayMs = seconds * 1000;
  } else {
    const dateMs = Date.parse(raw);
    if (Number.isFinite(dateMs)) {
      delayMs = dateMs - Number(now);
    }
  }

  if (!Number.isFinite(delayMs) || delayMs <= 0) return null;
  return Math.min(Math.max(Math.round(delayMs), 1), Math.max(1, Number(maxMs) || 300000));
}

function retryAfterMsFromHeaders(headers, options = {}) {
  if (!headers) return null;
  let value = null;

  try {
    if (typeof headers.get === "function") {
      value = headers.get("retry-after");
    } else if (typeof headers === "object") {
      value =
        headers["retry-after"] ??
        headers["Retry-After"] ??
        null;
    }
  } catch (_) {
    value = null;
  }

  return parseRetryAfterMs(value, options);
}

function providerError(
  code,
  message,
  statusCode = 502,
  { retryAfterMs = null } = {}
) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (Number.isFinite(Number(retryAfterMs)) && Number(retryAfterMs) > 0) {
    error.retryAfterMs = Math.round(Number(retryAfterMs));
  }
  return error;
}

function assertProviderReplySize(
  currentLength,
  additionalLength = 0,
  {
    maxChars = MAX_PROVIDER_REPLY_CHARS,
    code = "AI_PROVIDER_REPLY_TOO_LARGE",
    label = "AI provider"
  } = {}
) {
  const current = Math.max(0, Number(currentLength) || 0);
  const additional = Math.max(0, Number(additionalLength) || 0);
  const limit = Math.max(1, Number(maxChars) || MAX_PROVIDER_REPLY_CHARS);
  const total = current + additional;

  if (total > limit) {
    throw providerError(
      code,
      `${String(label || "AI provider")} response exceeded the allowed size.`,
      502
    );
  }
  return total;
}

function boundedProviderReply(value, options = {}) {
  const text = String(value || "");
  assertProviderReplySize(0, text.length, options);
  return text;
}

function normalizeHttpEndpoint(value, { allowHttp = false } = {}) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol === "https:" || (allowHttp && parsed.protocol === "http:")) return parsed;
    return null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  MAX_PROVIDER_REPLY_CHARS,
  contentToText,
  normalizeInputMessages,
  combineSystemAndMessages,
  parseRetryAfterMs,
  retryAfterMsFromHeaders,
  providerError,
  assertProviderReplySize,
  boundedProviderReply,
  normalizeHttpEndpoint
};
