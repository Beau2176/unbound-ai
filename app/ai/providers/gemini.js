const API_ROOT = "https://generativelanguage.googleapis.com/v1beta";

function clean(value, max = 200) {
  const text = String(value || "").trim();
  return text && text.length <= max ? text : null;
}

function getModel(env = process.env) {
  return clean(env.GEMINI_MODEL || env.GOOGLE_AI_MODEL, 120);
}

function apiKey(env = process.env) {
  return clean(env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY, 500);
}

function isConfigured(env = process.env) {
  return Boolean(apiKey(env) && getModel(env));
}

function supportsResearch() {
  return false;
}

function supportsFileAnalysis() {
  return false;
}

function normalizeInput(input = []) {
  return (Array.isArray(input) ? input : []).map((item) => {
    const role = item?.role === "assistant" ? "model" : "user";
    let value = item?.content;
    if (Array.isArray(value)) {
      value = value.map((part) => typeof part === "string" ? part : (part?.text || part?.content || "")).join("\n");
    } else if (value && typeof value === "object") {
      value = value.text || value.content || JSON.stringify(value);
    }
    const text = String(value || "").slice(0, 100000);
    return text ? { role, parts: [{ text }] } : null;
  }).filter(Boolean);
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
    const error = new Error("Gemini provider is not configured.");
    error.code = "AI_PROVIDER_NOT_CONFIGURED";
    throw error;
  }
  if (research?.enabled) {
    const error = new Error("Gemini adapter research tools are not enabled yet.");
    error.code = "AI_PROVIDER_RESEARCH_UNSUPPORTED";
    throw error;
  }
  const selectedModel = clean(model, 120) || getModel(env);
  const url = `${API_ROOT}/models/${encodeURIComponent(selectedModel)}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  timer.unref?.();
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey(env)
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: String(instructions || "").slice(0, 100000) }] },
        contents: normalizeInput(input)
      })
    });
  } catch (cause) {
    const error = new Error(cause?.name === "AbortError" ? "Gemini request timed out." : "Gemini request failed.");
    error.code = cause?.name === "AbortError" ? "GEMINI_REQUEST_TIMEOUT" : "GEMINI_REQUEST_FAILED";
    error.cause = cause;
    throw error;
  } finally {
    clearTimeout(timer);
  }
  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok) {
    const error = new Error("Gemini rejected the request.");
    error.code = "GEMINI_API_ERROR";
    error.statusCode = response.status;
    throw error;
  }
  const parts = payload?.candidates?.[0]?.content?.parts;
  const reply = (Array.isArray(parts) ? parts : []).map((part) => String(part?.text || "")).join("");
  return {
    provider: "gemini",
    model: payload?.modelVersion || selectedModel,
    reply,
    usage: payload?.usageMetadata || null,
    responseId: payload?.responseId || null,
    research: { sources: [], citations: [], webSearchCalls: 0 }
  };
}

module.exports = {
  id: "gemini",
  API_ROOT,
  getModel,
  apiKey,
  isConfigured,
  supportsResearch,
  supportsFileAnalysis,
  normalizeInput,
  generateChat
};
