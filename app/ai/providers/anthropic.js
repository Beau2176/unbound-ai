const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_VERSION = "2023-06-01";

function clean(value, max = 200) {
  const text = String(value || "").trim();
  return text && text.length <= max ? text : null;
}

function getModel(env = process.env) {
  return clean(env.ANTHROPIC_MODEL, 120);
}

function isConfigured(env = process.env) {
  return Boolean(clean(env.ANTHROPIC_API_KEY, 500) && getModel(env));
}

function supportsResearch() {
  return false;
}

function supportsFileAnalysis() {
  return false;
}

function normalizeInput(input = []) {
  return (Array.isArray(input) ? input : []).map((item) => {
    const role = item?.role === "assistant" ? "assistant" : "user";
    let content = item?.content;
    if (Array.isArray(content)) {
      content = content.map((part) => {
        if (typeof part === "string") return part;
        return part?.text || part?.content || "";
      }).join("\n");
    } else if (content && typeof content === "object") {
      content = content.text || content.content || JSON.stringify(content);
    }
    return { role, content: String(content || "").slice(0, 100000) };
  }).filter((item) => item.content);
}

async function generateChat({
  instructions,
  input,
  model,
  research = null,
  env = process.env,
  fetchImpl = fetch
} = {}) {
  if (!isConfigured(env)) {
    const error = new Error("Anthropic provider is not configured.");
    error.code = "AI_PROVIDER_NOT_CONFIGURED";
    throw error;
  }
  if (research?.enabled) {
    const error = new Error("Anthropic adapter research tools are not enabled yet.");
    error.code = "AI_PROVIDER_RESEARCH_UNSUPPORTED";
    throw error;
  }
  const selectedModel = clean(model, 120) || getModel(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  timer.unref?.();
  let response;
  try {
    response = await fetchImpl(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": String(env.ANTHROPIC_API_KEY),
        "anthropic-version": clean(env.ANTHROPIC_VERSION, 40) || DEFAULT_VERSION
      },
      body: JSON.stringify({
        model: selectedModel,
        max_tokens: Math.min(Math.max(Number(env.ANTHROPIC_MAX_TOKENS) || 4096, 256), 16384),
        system: String(instructions || "").slice(0, 100000),
        messages: normalizeInput(input)
      })
    });
  } catch (cause) {
    const error = new Error(cause?.name === "AbortError" ? "Anthropic request timed out." : "Anthropic request failed.");
    error.code = cause?.name === "AbortError" ? "ANTHROPIC_REQUEST_TIMEOUT" : "ANTHROPIC_REQUEST_FAILED";
    error.cause = cause;
    throw error;
  } finally {
    clearTimeout(timer);
  }
  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok) {
    const error = new Error("Anthropic rejected the request.");
    error.code = "ANTHROPIC_API_ERROR";
    error.statusCode = response.status;
    throw error;
  }
  const reply = (Array.isArray(payload?.content) ? payload.content : [])
    .filter((item) => item?.type === "text")
    .map((item) => String(item.text || ""))
    .join("");
  return {
    provider: "anthropic",
    model: payload?.model || selectedModel,
    reply,
    usage: payload?.usage || null,
    responseId: payload?.id || null,
    research: { sources: [], citations: [], webSearchCalls: 0 }
  };
}

module.exports = {
  id: "anthropic",
  API_URL,
  getModel,
  isConfigured,
  supportsResearch,
  supportsFileAnalysis,
  normalizeInput,
  generateChat
};
