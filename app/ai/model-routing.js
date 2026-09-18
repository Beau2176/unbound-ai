const PROFILE_IDS = Object.freeze(["auto", "fast", "deep", "research"]);
const PROVIDER_IDS = Object.freeze(["openai", "anthropic", "gemini", "local"]);

function cleanProviderId(value) {
  const provider = String(value || "").trim().toLowerCase();
  return PROVIDER_IDS.includes(provider) ? provider : null;
}

function cleanModelId(value) {
  const model = String(value || "").trim();
  if (!model || model.length > 120) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(model) ? model : null;
}

function normalizeModelProfile(value) {
  const profile = String(value || "auto").trim().toLowerCase();
  return PROFILE_IDS.includes(profile) ? profile : "auto";
}

function getModelRoutingConfig(env = process.env, defaultModel = null, defaultProvider = null) {
  const fallback = cleanModelId(defaultModel || env.OPENAI_MODEL || env.AI_MODEL);
  const providerFallback = cleanProviderId(defaultProvider || env.AI_PROVIDER) || "openai";
  const profiles = {
    fast: cleanModelId(env.AI_MODEL_FAST || env.OPENAI_FAST_MODEL),
    deep: cleanModelId(env.AI_MODEL_DEEP || env.OPENAI_DEEP_MODEL),
    research: cleanModelId(env.AI_MODEL_RESEARCH || env.OPENAI_RESEARCH_MODEL)
  };
  const providerProfiles = {
    fast: cleanProviderId(env.AI_PROVIDER_FAST),
    deep: cleanProviderId(env.AI_PROVIDER_DEEP),
    research: cleanProviderId(env.AI_PROVIDER_RESEARCH)
  };
  const configuredProfiles = Object.entries(profiles)
    .filter(([, model]) => Boolean(model))
    .map(([profile]) => profile);
  const uniqueModels = new Set([fallback, ...Object.values(profiles)].filter(Boolean));

  const uniqueProviders = new Set([providerFallback, ...Object.values(providerProfiles)].filter(Boolean));
  return {
    defaultModel: fallback,
    defaultProvider: providerFallback,
    profiles,
    providerProfiles,
    configuredProfiles,
    multipleModelsConfigured: uniqueModels.size >= 2,
    multipleProvidersConfigured: uniqueProviders.size >= 2
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
  defaultProvider = null,
  enabled = false,
  env = process.env
} = {}) {
  const config = getModelRoutingConfig(env, defaultModel, defaultProvider);
  const fallback = config.defaultModel || cleanModelId(defaultModel);
  const requested = normalizeModelProfile(requestedProfile);

  if (!enabled) {
    return {
      model: fallback,
      provider: config.defaultProvider,
      profile: "default",
      requestedProfile: requested,
      routed: false,
      reason: "capability-not-enabled"
    };
  }

  const targetProfile = requested === "auto"
    ? automaticProfile({ depthStyle, productMode, message })
    : requested;
  const routedProvider = config.providerProfiles[targetProfile] || config.defaultProvider;
  const routedModel = config.profiles[targetProfile] || (
    routedProvider === config.defaultProvider ? fallback : null
  );
  const profileConfigured = Boolean(config.profiles[targetProfile] || config.providerProfiles[targetProfile]);

  return {
    model: routedModel,
    provider: routedProvider,
    profile: profileConfigured ? targetProfile : "default",
    requestedProfile: requested,
    routed: Boolean(
      profileConfigured &&
      (routedModel !== fallback || routedProvider !== config.defaultProvider)
    ),
    reason: profileConfigured ? "profile-configured" : "profile-fallback"
  };
}

function publicModelRoutingStatus(env = process.env, defaultModel = null, defaultProvider = null) {
  const config = getModelRoutingConfig(env, defaultModel, defaultProvider);
  return {
    implemented: true,
    multipleModelsConfigured: config.multipleModelsConfigured,
    multipleProvidersConfigured: config.multipleProvidersConfigured,
    configuredProfiles: [...config.configuredProfiles],
    configuredProviderProfiles: Object.entries(config.providerProfiles)
      .filter(([, provider]) => Boolean(provider))
      .map(([profile]) => profile),
    rawModelIdsExposed: false,
    browserSuppliedModelIdsAccepted: false
  };
}

module.exports = {
  PROFILE_IDS,
  PROVIDER_IDS,
  cleanProviderId,
  cleanModelId,
  normalizeModelProfile,
  getModelRoutingConfig,
  researchIntent,
  deepIntent,
  automaticProfile,
  resolveChatModel,
  publicModelRoutingStatus
};
