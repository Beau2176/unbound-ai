const PROFILE_IDS = Object.freeze(["auto", "fast", "deep", "research"]);

function cleanModelId(value) {
  const model = String(value || "").trim();
  if (!model || model.length > 120) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(model) ? model : null;
}

function normalizeModelProfile(value) {
  const profile = String(value || "auto").trim().toLowerCase();
  return PROFILE_IDS.includes(profile) ? profile : "auto";
}

function providerModelEnv(env = process.env) {
  const provider = String(env.AI_PROVIDER || "openai").trim().toLowerCase();
  if (provider === "anthropic") {
    return {
      fallback: env.ANTHROPIC_MODEL,
      fast: env.ANTHROPIC_MODEL_FAST,
      deep: env.ANTHROPIC_MODEL_DEEP,
      research: env.ANTHROPIC_MODEL_RESEARCH
    };
  }
  if (provider === "google") {
    return {
      fallback: env.GEMINI_MODEL || env.GOOGLE_AI_MODEL,
      fast: env.GEMINI_MODEL_FAST || env.GOOGLE_AI_MODEL_FAST,
      deep: env.GEMINI_MODEL_DEEP || env.GOOGLE_AI_MODEL_DEEP,
      research: env.GEMINI_MODEL_RESEARCH || env.GOOGLE_AI_MODEL_RESEARCH
    };
  }
  if (provider === "local") {
    return {
      fallback: env.UNBOUND_LOCAL_AI_MODEL,
      fast: env.UNBOUND_LOCAL_AI_MODEL_FAST,
      deep: env.UNBOUND_LOCAL_AI_MODEL_DEEP,
      research: env.UNBOUND_LOCAL_AI_MODEL_RESEARCH
    };
  }
  return {
    fallback: env.OPENAI_MODEL || env.AI_MODEL,
    fast: env.AI_MODEL_FAST || env.OPENAI_FAST_MODEL,
    deep: env.AI_MODEL_DEEP || env.OPENAI_DEEP_MODEL,
    research: env.AI_MODEL_RESEARCH || env.OPENAI_RESEARCH_MODEL
  };
}

function getModelRoutingConfig(env = process.env, defaultModel = null) {
  const providerEnv = providerModelEnv(env);
  const fallback = cleanModelId(defaultModel || providerEnv.fallback);
  const profiles = {
    fast: cleanModelId(providerEnv.fast),
    deep: cleanModelId(providerEnv.deep),
    research: cleanModelId(providerEnv.research)
  };
  const configuredProfiles = Object.entries(profiles)
    .filter(([, model]) => Boolean(model))
    .map(([profile]) => profile);
  const uniqueModels = new Set([fallback, ...Object.values(profiles)].filter(Boolean));

  return {
    defaultModel: fallback,
    profiles,
    configuredProfiles,
    multipleModelsConfigured: uniqueModels.size >= 2
  };
}

function researchIntent(message) {
  const text = String(message || "").trim().toLowerCase();
  if (!text) return false;
  if (/\b(do not|don't|dont|without)\s+(search|browse|look up|research|check the web|use the web)\b/i.test(text)) {
    return false;
  }
  return /\b(latest|current|today|tonight|this week|this month|right now|up[- ]to[- ]date|news|search(?: the)? web|browse(?: the)? web|look (?:it )?up|look online|check online|check the web|research this|find online|verify online|web search|internet search)\b/i.test(text);
}

function deepIntent(message) {
  const text = String(message || "").trim().toLowerCase();
  if (!text) return false;
  if (text.length >= 700) return true;
  return /\b(analy[sz]e|compare|debug|diagnose|architecture|design a system|write (?:the )?code|implement|refactor|security review|threat model|business plan|strategy|forecast|model this|step[- ]by[- ]step|deep dive|prove|derive|optimi[sz]e)\b/i.test(text);
}

function automaticProfile({ depthStyle, productMode, message } = {}) {
  const mode = String(productMode || "standard").trim().toLowerCase();
  if (mode === "research" || researchIntent(message)) return "research";
  if (String(depthStyle || "casual").trim().toLowerCase() === "work" || deepIntent(message)) {
    return "deep";
  }
  return "fast";
}

function resolveChatModel({
  requestedProfile = "auto",
  depthStyle = "casual",
  productMode = "standard",
  message = "",
  defaultModel = null,
  enabled = false,
  env = process.env
} = {}) {
  const config = getModelRoutingConfig(env, defaultModel);
  const fallback = config.defaultModel || cleanModelId(defaultModel);
  const requested = normalizeModelProfile(requestedProfile);

  if (!enabled) {
    return {
      model: fallback,
      profile: "default",
      requestedProfile: requested,
      routed: false,
      reason: "capability-not-enabled"
    };
  }

  const targetProfile = requested === "auto"
    ? automaticProfile({ depthStyle, productMode, message })
    : requested;
  const routedModel = config.profiles[targetProfile] || fallback;

  return {
    model: routedModel,
    profile: config.profiles[targetProfile] ? targetProfile : "default",
    requestedProfile: requested,
    routed: Boolean(config.profiles[targetProfile] && routedModel !== fallback),
    reason: config.profiles[targetProfile] ? "profile-configured" : "profile-fallback"
  };
}

function publicModelRoutingStatus(env = process.env, defaultModel = null) {
  const config = getModelRoutingConfig(env, defaultModel);
  return {
    implemented: true,
    multipleModelsConfigured: config.multipleModelsConfigured,
    configuredProfiles: [...config.configuredProfiles],
    rawModelIdsExposed: false,
    browserSuppliedModelIdsAccepted: false
  };
}

module.exports = {
  PROFILE_IDS,
  cleanModelId,
  normalizeModelProfile,
  providerModelEnv,
  getModelRoutingConfig,
  researchIntent,
  deepIntent,
  automaticProfile,
  resolveChatModel,
  publicModelRoutingStatus
};
