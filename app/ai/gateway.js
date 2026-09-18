const openai = require("./providers/openai");
const anthropic = require("./providers/anthropic");
const google = require("./providers/google");
const local = require("./providers/local");
const {
  getProviderCircuitSnapshot,
  beginProviderCircuitAttempt,
  cancelProviderCircuitAttempt,
  recordProviderCircuitSuccess,
  recordProviderCircuitFailure
} = require("./provider-circuit-breaker");
const {
  beginProviderAttempt,
  finishProviderAttempt,
  recordProviderRoutingEvent,
  getProviderTelemetrySnapshot
} = require("./provider-telemetry");
const {
  getProviderDeadlinePolicy
} = require("./provider-deadline");
const {
  runWithProviderBulkhead,
  getProviderBulkheadSnapshots,
  isProviderBulkheadError
} = require("./provider-bulkhead");

const providers = new Map([
  [openai.id, openai],
  [anthropic.id, anthropic],
  [google.id, google],
  [local.id, local]
]);

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "FETCH_FAILED"
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

function fallbackModelForProvider(provider, env = process.env) {
  if (!provider) return null;

  const generic = String(env.AI_FALLBACK_MODEL || "").trim();
  let configured = "";

  if (provider.id === "openai") {
    configured = String(
      env.OPENAI_FALLBACK_MODEL ||
      env.OPENAI_MODEL_FALLBACK ||
      generic ||
      ""
    ).trim();
  } else if (provider.id === "anthropic") {
    configured = String(env.ANTHROPIC_MODEL_FALLBACK || generic || "").trim();
  } else if (provider.id === "google") {
    configured = String(
      env.GEMINI_MODEL_FALLBACK ||
      env.GOOGLE_AI_MODEL_FALLBACK ||
      generic ||
      ""
    ).trim();
  } else if (provider.id === "local") {
    configured = String(env.UNBOUND_LOCAL_AI_MODEL_FALLBACK || generic || "").trim();
  }

  return configured || provider.getModel();
}

function routeError(code, message, statusReason) {
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
      const error = routeError(
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
      const error = routeError(
        "AI_PROVIDER_RESEARCH_UNSUPPORTED",
        `AI provider '${active.id}' does not support Research Mode.`,
        "active-provider-research-unsupported"
      );
      if (throwOnError) throw error;
      return { provider: null, explicit: false, error: error.statusReason };
    }

    if (!active.isConfigured()) {
      const error = routeError(
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
    const error = routeError(
      "AI_RESEARCH_PROVIDER_UNSUPPORTED",
      `Unsupported Research Mode provider: ${requestedName}`,
      "research-provider-unsupported"
    );
    if (throwOnError) throw error;
    return { provider: null, explicit: true, error: error.statusReason };
  }

  if (!providerSupportsResearch(provider)) {
    const error = routeError(
      "AI_RESEARCH_PROVIDER_CAPABILITY_UNSUPPORTED",
      `AI provider '${provider.id}' does not support Research Mode.`,
      "research-provider-capability-unsupported"
    );
    if (throwOnError) throw error;
    return { provider: null, explicit: true, error: error.statusReason };
  }

  if (!provider.isConfigured()) {
    const error = routeError(
      "AI_RESEARCH_PROVIDER_NOT_CONFIGURED",
      `Research Mode provider '${provider.id}' is not configured.`,
      "research-provider-not-configured"
    );
    if (throwOnError) throw error;
    return { provider: null, explicit: true, error: error.statusReason };
  }

  return { provider, explicit: true, error: null };
}

function resolveFallbackProvider({
  env = process.env,
  primaryProvider = null,
  throwOnError = false
} = {}) {
  const requestedName = String(env.AI_FALLBACK_PROVIDER || "").trim().toLowerCase();
  if (!requestedName) {
    return { provider: null, explicit: false, error: null };
  }

  let primary = primaryProvider;
  if (!primary) {
    const primaryName = normalizeProviderName(env.AI_PROVIDER);
    primary = providers.get(primaryName) || null;
  }

  const provider = providers.get(requestedName);
  if (!provider) {
    const error = routeError(
      "AI_FALLBACK_PROVIDER_UNSUPPORTED",
      `Unsupported fallback AI provider: ${requestedName}`,
      "fallback-provider-unsupported"
    );
    if (throwOnError) throw error;
    return { provider: null, explicit: true, error: error.statusReason };
  }

  if (primary && provider.id === primary.id) {
    const error = routeError(
      "AI_FALLBACK_PROVIDER_SAME_AS_PRIMARY",
      `Fallback provider '${provider.id}' must differ from the active provider.`,
      "fallback-provider-same-as-primary"
    );
    if (throwOnError) throw error;
    return { provider: null, explicit: true, error: error.statusReason };
  }

  if (!provider.isConfigured()) {
    const error = routeError(
      "AI_FALLBACK_PROVIDER_NOT_CONFIGURED",
      `Fallback AI provider '${provider.id}' is not configured.`,
      "fallback-provider-not-configured"
    );
    if (throwOnError) throw error;
    return { provider: null, explicit: true, error: error.statusReason };
  }

  return { provider, explicit: true, error: null };
}

function retryStatus(error) {
  const value = Number(error?.statusCode ?? error?.status);
  return Number.isFinite(value) ? value : null;
}

function nestedErrorCode(error) {
  return String(
    error?.code ||
    error?.cause?.code ||
    error?.cause?.cause?.code ||
    ""
  ).trim().toUpperCase();
}

function isRetryableProviderError(error) {
  if (!error) return false;

  const status = retryStatus(error);
  if (status === 408 || status === 425 || status === 429) return true;
  if (status !== null && status >= 500 && status <= 599) {
    const code = nestedErrorCode(error);
    if (code.endsWith("_STREAM_REMOTE_ERROR")) {
      return /overload|temporar|unavailable|rate.?limit|timeout|capacity|try again|server error/i.test(
        String(error.message || "")
      );
    }
    return true;
  }

  const code = nestedErrorCode(error);
  if (RETRYABLE_NETWORK_CODES.has(code)) return true;

  if (
    /_(?:STREAM_BODY_MISSING|STREAM_UNREADABLE)$/.test(code) ||
    /(?:NETWORK|TIMEOUT|CONNECTION|SOCKET)_ERROR$/.test(code)
  ) {
    return true;
  }

  if (
    error instanceof TypeError &&
    /fetch|network|socket|connect|timeout|terminated/i.test(String(error.message || ""))
  ) {
    return true;
  }

  return false;
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

function getGatewayStatus({ includeTelemetry = false } = {}) {
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
      failoverEnabled: false,
      fallbackProvider: null,
      fallbackModel: null,
      fallbackError: "active-provider-unsupported",
      circuitBreaker: getProviderCircuitSnapshot({
        primaryProviderId: name,
        fallbackProviderId: null
      }),
      ...(includeTelemetry ? { telemetry: getProviderTelemetrySnapshot() } : {}),
      deadlines: getProviderDeadlinePolicy(),
      bulkheads: {},
      fileAnalysis: false,
      error: "unsupported-provider"
    };
  }

  const researchRoute = resolveResearchProvider({
    activeProvider: provider,
    throwOnError: false
  });
  const researchReady = Boolean(researchRoute.provider);
  const fallbackRoute = resolveFallbackProvider({
    primaryProvider: provider,
    throwOnError: false
  });
  const failoverEnabled = Boolean(fallbackRoute.provider);
  const circuitBreaker = getProviderCircuitSnapshot({
    primaryProviderId: provider.id,
    fallbackProviderId: fallbackRoute.provider?.id || null
  });
  const bulkheads = getProviderBulkheadSnapshots([
    provider.id,
    fallbackRoute.provider?.id,
    researchRoute.provider?.id
  ]);

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
    failoverEnabled,
    fallbackProvider: fallbackRoute.provider?.id || null,
    fallbackModel: failoverEnabled
      ? fallbackModelForProvider(fallbackRoute.provider)
      : null,
    fallbackError: fallbackRoute.error || null,
    circuitBreaker,
    ...(includeTelemetry ? { telemetry: getProviderTelemetrySnapshot() } : {}),
    deadlines: getProviderDeadlinePolicy(),
    bulkheads,
    fileAnalysis: providerSupportsFileAnalysis(provider),
    error: provider.isConfigured() ? null : "provider-not-configured"
  };
}

async function generateWithProvider(provider, options, role = "primary") {
  return runWithProviderBulkhead(provider?.id, async () => {
    const attempt = beginProviderAttempt({
      providerId: provider?.id,
      role
    });
    try {
      const result = await provider.generateChat(options);
      finishProviderAttempt(attempt, { ok: true });
      return result;
    } catch (error) {
      finishProviderAttempt(attempt, {
        ok: false,
        retryable: isRetryableProviderError(error),
        errorCode: nestedErrorCode(error)
      });
      throw error;
    }
  });
}

async function streamWithProvider(provider, options, role = "primary") {
  return runWithProviderBulkhead(provider?.id, async () => {
    const attempt = beginProviderAttempt({
      providerId: provider?.id,
      role
    });
    try {
      let result;
      if (typeof provider.streamChat === "function") {
        result = await provider.streamChat(options);
      } else {
        result = await provider.generateChat(options);
        if (options.onDelta && result.reply) {
          await options.onDelta(result.reply);
        }
      }
      finishProviderAttempt(attempt, { ok: true });
      return result;
    } catch (error) {
      finishProviderAttempt(attempt, {
        ok: false,
        retryable: isRetryableProviderError(error),
        errorCode: nestedErrorCode(error)
      });
      throw error;
    }
  });
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

  const primaryOptions = {
    instructions,
    input,
    model: route.model,
    research,
    reasoningEffort
  };

  // Research Mode has its own sourced-provider route and intentionally does not
  // participate in general provider failover/circuit breaking.
  if (research?.enabled) {
    return generateWithProvider(route.provider, primaryOptions, "research");
  }

  const fallbackRoute = resolveFallbackProvider({
    primaryProvider: route.provider,
    throwOnError: false
  });
  const circuitAttempt = beginProviderCircuitAttempt({
    primaryProviderId: route.provider.id,
    fallbackProviderId: fallbackRoute.provider?.id || null
  });

  if (circuitAttempt.bypassPrimary && fallbackRoute.provider) {
    recordProviderRoutingEvent({
      type: "circuit_bypass",
      fromProvider: route.provider.id,
      toProvider: fallbackRoute.provider.id
    });
    return generateWithProvider(fallbackRoute.provider, {
      instructions,
      input,
      model: fallbackModelForProvider(fallbackRoute.provider),
      research: null,
      reasoningEffort
    }, "fallback");
  }

  try {
    const result = await generateWithProvider(route.provider, primaryOptions);
    recordProviderCircuitSuccess({
      primaryProviderId: route.provider.id,
      fallbackProviderId: fallbackRoute.provider?.id || null
    });
    return result;
  } catch (error) {
    const retryable = isRetryableProviderError(error);
    if (isProviderBulkheadError(error)) {
      if (circuitAttempt.halfOpenProbe) {
        cancelProviderCircuitAttempt({
          primaryProviderId: route.provider.id,
          fallbackProviderId: fallbackRoute.provider?.id || null
        });
      }
    } else {
      recordProviderCircuitFailure({
        primaryProviderId: route.provider.id,
        fallbackProviderId: fallbackRoute.provider?.id || null,
        retryable,
        errorCode: nestedErrorCode(error)
      });
    }

    if (!retryable || !fallbackRoute.provider) throw error;

    recordProviderRoutingEvent({
      type: "failover",
      fromProvider: route.provider.id,
      toProvider: fallbackRoute.provider.id
    });
    return generateWithProvider(fallbackRoute.provider, {
      instructions,
      input,
      model: fallbackModelForProvider(fallbackRoute.provider),
      research: null,
      reasoningEffort
    }, "fallback");
  }
}

async function streamChat({
  instructions,
  input,
  model,
  onDelta,
  reasoningEffort = null
}) {
  const provider = getProvider();
  const selectedModel = String(model || "").trim() || provider.getModel();
  const fallbackRoute = resolveFallbackProvider({
    primaryProvider: provider,
    throwOnError: false
  });
  const circuitAttempt = beginProviderCircuitAttempt({
    primaryProviderId: provider.id,
    fallbackProviderId: fallbackRoute.provider?.id || null
  });

  if (circuitAttempt.bypassPrimary && fallbackRoute.provider) {
    recordProviderRoutingEvent({
      type: "circuit_bypass",
      fromProvider: provider.id,
      toProvider: fallbackRoute.provider.id
    });
    return streamWithProvider(fallbackRoute.provider, {
      instructions,
      input,
      model: fallbackModelForProvider(fallbackRoute.provider),
      onDelta,
      reasoningEffort
    }, "fallback");
  }

  let emittedPrimaryOutput = false;

  const primaryOnDelta = async (delta) => {
    if (String(delta || "").length) emittedPrimaryOutput = true;
    if (onDelta) await onDelta(delta);
  };

  try {
    const result = await streamWithProvider(provider, {
      instructions,
      input,
      model: selectedModel,
      onDelta: primaryOnDelta,
      reasoningEffort
    });
    recordProviderCircuitSuccess({
      primaryProviderId: provider.id,
      fallbackProviderId: fallbackRoute.provider?.id || null
    });
    return result;
  } catch (error) {
    const retryable = isRetryableProviderError(error);
    if (isProviderBulkheadError(error)) {
      if (circuitAttempt.halfOpenProbe) {
        cancelProviderCircuitAttempt({
          primaryProviderId: provider.id,
          fallbackProviderId: fallbackRoute.provider?.id || null
        });
      }
    } else {
      recordProviderCircuitFailure({
        primaryProviderId: provider.id,
        fallbackProviderId: fallbackRoute.provider?.id || null,
        retryable,
        errorCode: nestedErrorCode(error)
      });
    }

    // Never restart a stream after visible output was emitted; that risks
    // duplicate/conflicting answers. Only pre-output transient failures fail over.
    if (emittedPrimaryOutput || !retryable || !fallbackRoute.provider) throw error;

    recordProviderRoutingEvent({
      type: "failover",
      fromProvider: provider.id,
      toProvider: fallbackRoute.provider.id
    });
    return streamWithProvider(fallbackRoute.provider, {
      instructions,
      input,
      model: fallbackModelForProvider(fallbackRoute.provider),
      onDelta,
      reasoningEffort
    }, "fallback");
  }
}

async function analyzeFile(options = {}) {
  const provider = getProvider();
  if (!providerSupportsFileAnalysis(provider) || typeof provider.analyzeFile !== "function") {
    const error = new Error(`AI provider '${provider.id}' does not support file analysis.`);
    error.code = "AI_PROVIDER_FILE_ANALYSIS_UNSUPPORTED";
    throw error;
  }
  return runWithProviderBulkhead(
    provider.id,
    () => provider.analyzeFile(options)
  );
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
  fallbackModelForProvider,
  resolveResearchProvider,
  resolveFallbackProvider,
  isRetryableProviderError,
  resolveProviderForRequest
};
