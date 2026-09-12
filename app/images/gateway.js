const openai = require("./providers/openai");

const providers = new Map([[openai.id, openai]]);

function normalizeProviderName(value) {
  return String(value || "openai").trim().toLowerCase();
}

function getProvider(env = process.env) {
  const name = normalizeProviderName(env.AI_PROVIDER);
  const provider = providers.get(name);
  if (!provider) {
    const error = new Error(`Unsupported image-understanding provider: ${name}`);
    error.code = "IMAGE_PROVIDER_UNSUPPORTED";
    throw error;
  }
  return provider;
}

function getImageGatewayStatus(env = process.env) {
  const name = normalizeProviderName(env.AI_PROVIDER);
  const provider = providers.get(name);
  if (!provider) {
    return {
      provider: name,
      configured: false,
      model: null,
      imageUnderstanding: false,
      error: "unsupported-provider"
    };
  }
  const configured = provider.isConfigured(env);
  return {
    provider: provider.id,
    configured,
    model: provider.getModel(env),
    imageUnderstanding: typeof provider.analyzeImage === "function",
    error: configured ? null : "provider-not-configured"
  };
}

async function analyzeImage(options = {}) {
  const env = options.env || process.env;
  const provider = getProvider(env);
  if (typeof provider.analyzeImage !== "function") {
    const error = new Error(`Image provider '${provider.id}' does not support image understanding.`);
    error.code = "IMAGE_PROVIDER_UNSUPPORTED";
    throw error;
  }
  return provider.analyzeImage(options);
}

module.exports = {
  normalizeProviderName,
  getImageGatewayStatus,
  analyzeImage
};
