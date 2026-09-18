const openai = require("./providers/openai");
const anthropic = require("./providers/anthropic");
const google = require("./providers/google");
const local = require("./providers/local");

const providers = new Map([
  [openai.id, openai],
  [anthropic.id, anthropic],
  [google.id, google],
  [local.id, local]
]);

function normalizeProviderName(value) {
  return String(value || "openai").trim().toLowerCase();
}

function getProvider() {
  const name = normalizeProviderName(process.env.AI_PROVIDER);
  const provider = providers.get(name);

  if (!provider) {
    const error = new Error(`Unsupported AI provider: ${name}`);
    error.code = "AI_PROVIDER_UNSUPPORTED";
    throw error;
  }

  return provider;
}

function providerSupportsResearch(provider) {
  return typeof provider?.supportsResearch === "function" && provider.supportsResearch();
}

function providerSupportsFileAnalysis(provider) {
  return typeof provider?.supportsFileAnalysis === "function" && provider.supportsFileAnalysis();
}

function getGatewayStatus() {
  const name = normalizeProviderName(process.env.AI_PROVIDER);
  const provider = providers.get(name);

  if (!provider) {
    return {
      provider: name,
      configured: false,
      model: null,
      streaming: false,
      research: false,
      fileAnalysis: false,
      error: "unsupported-provider"
    };
  }

  return {
    provider: provider.id,
    configured: provider.isConfigured(),
    model: provider.getModel(),
    streaming: typeof provider.streamChat === "function",
    research: providerSupportsResearch(provider),
    fileAnalysis: providerSupportsFileAnalysis(provider),
    error: provider.isConfigured() ? null : "provider-not-configured"
  };
}

async function generateChat({
  instructions,
  input,
  model,
  research = null,
  reasoningEffort = null
}) {
  const provider = getProvider();

  if (research?.enabled && !providerSupportsResearch(provider)) {
    const error = new Error(`AI provider '${provider.id}' does not support Research Mode.`);
    error.code = "AI_PROVIDER_RESEARCH_UNSUPPORTED";
    throw error;
  }

  return provider.generateChat({
    instructions,
    input,
    model,
    research,
    reasoningEffort
  });
}

async function streamChat({
  instructions,
  input,
  model,
  onDelta,
  reasoningEffort = null
}) {
  const provider = getProvider();

  if (typeof provider.streamChat !== "function") {
    const result = await provider.generateChat({
      instructions,
      input,
      model,
      reasoningEffort
    });
    if (onDelta && result.reply) {
      await onDelta(result.reply);
    }
    return result;
  }

  return provider.streamChat({
    instructions,
    input,
    model,
    onDelta,
    reasoningEffort
  });
}

async function analyzeFile(options = {}) {
  const provider = getProvider();
  if (!providerSupportsFileAnalysis(provider) || typeof provider.analyzeFile !== "function") {
    const error = new Error(`AI provider '${provider.id}' does not support file analysis.`);
    error.code = "AI_PROVIDER_FILE_ANALYSIS_UNSUPPORTED";
    throw error;
  }
  return provider.analyzeFile(options);
}

module.exports = {
  generateChat,
  streamChat,
  analyzeFile,
  getGatewayStatus,
  normalizeProviderName
};
