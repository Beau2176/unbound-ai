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

function getModelRoutingConfig(env = process.env, defaultModel = null) {
  const fallback = cleanModelId(defaultModel || env.OPENAI_MODEL || env.AI_MODEL);
  const profiles = {
    fast: cleanModelId(env.AI_MODEL_FAST || env.OPENAI_FAST_MODEL),
    deep: cleanModelId(env.AI_MODEL_DEEP || env.OPENAI_DEEP_MODEL),
    research: cleanModelId(env.AI_MODEL_RESEARCH || env.OPENAI_RESEARCH_MODEL)
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

function automaticProfile({ depthStyle, productMode } = {}) {
  const mode = String(productMode || "standard").trim().toLowerCase();
  if (mode === "research") return "research";
  return String(depthStyle || "casual").trim().toLowerCase() === "work" ? "deep" : "fast";
}

function resolveChatModel({
  requestedProfile = "auto",
  depthStyle = "casual",
  productMode = "standard",
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
    ? automaticProfile({ depthStyle, productMode })
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
  getModelRoutingConfig,
  automaticProfile,
  resolveChatModel,
  publicModelRoutingStatus
};
