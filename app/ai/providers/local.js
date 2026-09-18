function clean(value, max = 500) {
  const text = String(value || "").trim();
  return text && text.length <= max ? text : null;
}

function getModel(env = process.env) {
  return clean(env.UNBOUND_LOCAL_AI_MODEL, 120);
}

function getEndpoint(env = process.env) {
  const raw = clean(env.UNBOUND_LOCAL_AI_ENDPOINT, 500);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString().replace(/\/$/, "");
  } catch (_) {
    return null;
  }
}

function isConfigured(env = process.env) {
  return Boolean(getEndpoint(env) && getModel(env));
}

function supportsResearch() { return false; }
function supportsFileAnalysis() { return false; }

async function generateChat({
  instructions,
  input,
  model,
  research = null,
  env = process.env,
  fetchImpl = fetch
} = {}) {
  if (!isConfigured(env)) {
    const error = new Error("Local AI provider is not configured.");
    error.code = "AI_PROVIDER_NOT_CONFIGURED";
    throw error;
  }
  if (research?.enabled) {
    const error = new Error("Local AI adapter does not provide web research.");
    error.code = "AI_PROVIDER_RESEARCH_UNSUPPORTED";
    throw error;
  }
  const selectedModel = clean(model, 120) || getModel(env);
  const messages = [{ role: "system", content: String(instructions || "").slice(0, 100000) }];
  for (const item of Array.isArray(input) ? input : []) {
    const role = item?.role === "assistant" ? "assistant" : "user";
    let content = item?.content;
    if (Array.isArray(content)) content = content.map((part) => typeof part === "string" ? part : (part?.text || "")).join("\n");
    messages.push({ role, content: String(content || "").slice(0, 100000) });
  }
  const response = await fetchImpl(`${getEndpoint(env)}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(clean(env.UNBOUND_LOCAL_AI_TOKEN, 1000) ? { authorization: `Bearer ${env.UNBOUND_LOCAL_AI_TOKEN}` } : {})
    },
    body: JSON.stringify({ model: selectedModel, messages, stream: false })
  });
  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok) {
    const error = new Error("Local AI endpoint rejected the request.");
    error.code = "LOCAL_AI_API_ERROR";
    error.statusCode = response.status;
    throw error;
  }
  return {
    provider: "local",
    model: payload?.model || selectedModel,
    reply: String(payload?.choices?.[0]?.message?.content || ""),
    usage: payload?.usage || null,
    responseId: payload?.id || null,
    research: { sources: [], citations: [], webSearchCalls: 0 }
  };
}

module.exports = {
  id: "local",
  getModel,
  getEndpoint,
  isConfigured,
  supportsResearch,
  supportsFileAnalysis,
  generateChat
};
