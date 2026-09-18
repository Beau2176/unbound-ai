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

function getProviderByName(value) {
  const name = String(value || "").trim().toLowerCase();
  return name ? providers.get(name) || null : null;
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

function researchModelForProvider(provider, env = process.env) {
  if (!provider) return null;

  const generic = String(env.AI_RESEARCH_MODEL || "").trim();
  let configured = "";

  if (provider.id === "openai") {
    configured = String(
      env.OPENAI_RESEARCH_MODEL ||
      env.AI_MODEL_RESEARCH ||
      generic ||
      ""
    ).trim();
  } else if (provider.id === "anthropic") {
    configured = String(env.ANTHROPIC_MODEL_RESEARCH || generic || "").trim();
  } else if (provider.id === "google") {
    configured = String(
      env.GEMINI_MODEL_RESEARCH ||
      env.GOOGLE_AI_MODEL_RESEARCH ||
      generic ||
      ""
    ).trim();
  } else if (provider.id === "local") {
    configured = String(env.UNBOUND_LOCAL_AI_MODEL_RESEARCH || generic || "").trim();
  }

  return configured || provider.getModel();
}

function researchRouteError(code, message, statusReason) {
  const error = new Error(message);
  error.code = code;
  error.statusReason = statusReason;
  return error;
}

function resolveResearchProvider({
  env = process.env,
  activeProvider = null,
  throwOnError = false
} = {}) {
  let active = activeProvider;
  if (!active) {
    const activeName = normalizeProviderName(env.AI_PROVIDER);
    active = providers.get(activeName) || null;
    if (!active) {
      const error = researchRouteError(
        "AI_PROVIDER_UNSUPPORTED",
        `Unsupported AI provider: ${activeName}`,
        "active-provider-unsupported"
      );
      if (throwOnError) throw error;
      return { provider: null, explicit: false, error: error.statusReason };
    }
  }

  const requestedName = String(env.AI_RESEARCH_PROVIDER || "").trim().toLowerCase();

  if (!requestedName) {
    if (!providerSupportsResearch(active)) {
      const error = researchRouteError(
        "AI_PROVIDER_RESEARCH_UNSUPPORTED",
        `AI provider '${active.id}' does not support Research Mode.`,
        "active-provider-research-unsupported"
      );
      if (throwOnError) throw error;
      return { provider: null, explicit: false, error: error.statusReason };
    }

    if (!active.isConfigured()) {
      const error = researchRouteError(
        "AI_PROVIDER_NOT_CONFIGURED",
        `AI provider '${active.id}' is not configured.`,
        "active-provider-not-configured"
      );
      if (throwOnError) throw error;
      return { provider: null, explicit: false, error: error.statusReason };
    }

    return { provider: active, explicit: false, error: null };
  }

  const provider = providers.get(requestedName);
  if (!provider) {
    const error = researchRouteError(
      "AI_RESEARCH_PROVIDER_UNSUPPORTED",
      `Unsupported Research Mode provider: ${requestedName}`,
      "research-provider-unsupported"
    );
    if (throwOnError) throw error;
    return { provider: null, explicit: true, error: error.statusReason };
  }

  if (!providerSupportsResearch(provider)) {
    const error = researchRouteError(
      "AI_RESEARCH_PROVIDER_CAPABILITY_UNSUPPORTED",
      `AI provider '${provider.id}' does not support Research Mode.`,
      "research-provider-capability-unsupported"
    );
    if (throwOnError) throw error;
    return { provider: null, explicit: true, error: error.statusReason };
  }

  if (!provider.isConfigured()) {
    const error = researchRouteError(
      "AI_RESEARCH_PROVIDER_NOT_CONFIGURED",
      `Research Mode provider '${provider.id}' is not configured.`,
      "research-provider-not-configured"
    );
    if (throwOnError) throw error;
    return { provider: null, explicit: true, error: error.statusReason };
  }

  return { provider, explicit: true, error: null };
}

function resolveProviderForRequest({
  research = null,
  model = null,
  env = process.env
} = {}) {
  const activeName = normalizeProviderName(env.AI_PROVIDER);
  const activeProvider = providers.get(activeName);

  if (!activeProvider) {
    const error = new Error(`Unsupported AI provider: ${activeName}`);
    error.code = "AI_PROVIDER_UNSUPPORTED";
    throw error;
  }

  if (!research?.enabled) {
    return {
      provider: activeProvider,
      model: String(model || "").trim() || activeProvider.getModel(),
      researchProviderExplicit: false
    };
  }

  const route = resolveResearchProvider({
    env,
    activeProvider,
    throwOnError: true
  });

  const isCrossProvider = route.provider.id !== activeProvider.id;
  const selectedModel =
    route.explicit || isCrossProvider
      ? researchModelForProvider(route.provider, env)
      : String(model || "").trim() || researchModelForProvider(route.provider, env);

  return {
    provider: route.provider,
    model: selectedModel,
    researchProviderExplicit: route.explicit
  };
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
      researchProvider: null,
      researchProviderExplicit: false,
      researchModel: null,
      researchError: "active-provider-unsupported",
      fileAnalysis: false,
      error: "unsupported-provider"
    };
  }

  const researchRoute = resolveResearchProvider({
    activeProvider: provider,
    throwOnError: false
  });
  const researchReady = Boolean(researchRoute.provider);

  return {
    provider: provider.id,
    configured: provider.isConfigured(),
    model: provider.getModel(),
    streaming: typeof provider.streamChat === "function",
    research: researchReady,
    researchProvider: researchRoute.provider?.id || null,
    researchProviderExplicit: Boolean(researchRoute.explicit),
    researchModel: researchReady
      ? researchModelForProvider(researchRoute.provider)
      : null,
    researchError: researchRoute.error || null,
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
  const route = resolveProviderForRequest({
    research,
    model,
    env: process.env
  });

  return route.provider.generateChat({
    instructions,
    input,
    model: route.model,
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
  normalizeProviderName,
  getProviderByName,
  providerSupportsResearch,
  researchModelForProvider,
  resolveResearchProvider,
  resolveProviderForRequest
};
