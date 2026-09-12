const openai = require("./providers/openai");

const providers = new Map([[openai.id, openai]]);

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

function getGatewayStatus() {
  const name = normalizeProviderName(process.env.AI_PROVIDER);
  const provider = providers.get(name);

  if (!provider) {
    return {
      provider: name,
      configured: false,
      model: null,
      streaming: false,
      error: "unsupported-provider"
    };
  }

  return {
    provider: provider.id,
    configured: provider.isConfigured(),
    model: provider.getModel(),
    streaming: typeof provider.streamChat === "function",
    error: provider.isConfigured() ? null : "provider-not-configured"
  };
}

async function generateChat({ instructions, input, model }) {
  const provider = getProvider();
  return provider.generateChat({ instructions, input, model });
}

async function streamChat({ instructions, input, model, onDelta }) {
  const provider = getProvider();

  if (typeof provider.streamChat !== "function") {
    const result = await provider.generateChat({ instructions, input, model });
    if (onDelta && result.reply) {
      await onDelta(result.reply);
    }
    return result;
  }

  return provider.streamChat({ instructions, input, model, onDelta });
}

module.exports = {
  generateChat,
  streamChat,
  getGatewayStatus,
  normalizeProviderName
};
