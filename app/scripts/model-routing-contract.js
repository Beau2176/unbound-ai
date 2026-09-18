const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  cleanProviderId,
  cleanModelId,
  normalizeModelProfile,
  getModelRoutingConfig,
  researchIntent,
  deepIntent,
  automaticProfile,
  resolveChatModel,
  publicModelRoutingStatus
} = require("../ai/model-routing");
const {
  integrateModelRoutingServerSource
} = require("../ai/model-routing-server-integration");
const { injectModelRoutingUi } = require("../ai/model-routing-ui");
const { injectEmailAccountUi } = require("../email/account-page");
const { CAPABILITY_CATALOG, buildCapabilityAccess } = require("../access/entitlements");

const appRoot = path.join(__dirname, "..");

function count(text, needle) {
  return String(text).split(needle).length - 1;
}

function main() {
  assert.strictEqual(cleanProviderId("ANTHROPIC"), "anthropic");
  assert.strictEqual(cleanProviderId("browser-supplied-provider"), null);
  assert.strictEqual(cleanModelId("gpt-example-fast"), "gpt-example-fast");
  assert.strictEqual(cleanModelId("provider/model:2026-09"), "provider/model:2026-09");
  assert.strictEqual(cleanModelId("model with spaces"), null);
  assert.strictEqual(cleanModelId(";rm -rf"), null);
  assert.strictEqual(normalizeModelProfile("DEEP"), "deep");
  assert.strictEqual(normalizeModelProfile("anything-else"), "auto");

  const env = {
    AI_MODEL: "model-default",
    AI_MODEL_FAST: "model-fast",
    AI_MODEL_DEEP: "model-deep",
    AI_MODEL_RESEARCH: "model-research",
    AI_PROVIDER: "openai",
    AI_PROVIDER_DEEP: "anthropic",
    AI_PROVIDER_RESEARCH: "openai"
  };
  const config = getModelRoutingConfig(env);
  assert.strictEqual(config.defaultModel, "model-default");
  assert.deepStrictEqual(config.configuredProfiles, ["fast", "deep", "research"]);
  assert.strictEqual(config.multipleModelsConfigured, true);
  assert.strictEqual(automaticProfile({ depthStyle: "casual", productMode: "standard" }), "fast");
  assert.strictEqual(automaticProfile({ depthStyle: "work", productMode: "standard" }), "deep");
  assert.strictEqual(automaticProfile({ depthStyle: "casual", productMode: "research" }), "research");
  assert.strictEqual(researchIntent("What is the latest news on this?"), true);
  assert.strictEqual(researchIntent("Explain this without searching the web."), false);
  assert.strictEqual(deepIntent("Debug this architecture and refactor the code."), true);
  assert.strictEqual(
    automaticProfile({ depthStyle: "casual", productMode: "standard", message: "Compare these architectures and optimize the design." }),
    "deep"
  );
  assert.strictEqual(
    automaticProfile({ depthStyle: "casual", productMode: "standard", message: "Look up the latest release notes." }),
    "research"
  );

  const disabled = resolveChatModel({
    requestedProfile: "deep",
    depthStyle: "work",
    defaultModel: "model-default",
    enabled: false,
    env
  });
  assert.strictEqual(disabled.model, "model-default");
  assert.strictEqual(disabled.routed, false);
  assert.strictEqual(disabled.reason, "capability-not-enabled");

  const autoFast = resolveChatModel({
    requestedProfile: "auto",
    depthStyle: "casual",
    productMode: "standard",
    defaultModel: "model-default",
    enabled: true,
    env
  });
  assert.strictEqual(autoFast.model, "model-fast");
  assert.strictEqual(autoFast.profile, "fast");

  const autoDeep = resolveChatModel({
    requestedProfile: "auto",
    depthStyle: "work",
    defaultModel: "model-default",
    enabled: true,
    env
  });
  assert.strictEqual(autoDeep.model, "model-deep");
  assert.strictEqual(autoDeep.provider, "anthropic");
  assert.strictEqual(autoDeep.profile, "deep");

  const autoResearch = resolveChatModel({
    requestedProfile: "auto",
    depthStyle: "casual",
    productMode: "research",
    defaultModel: "model-default",
    enabled: true,
    env
  });
  assert.strictEqual(autoResearch.model, "model-research");
  assert.strictEqual(autoResearch.profile, "research");

  const explicit = resolveChatModel({
    requestedProfile: "deep",
    depthStyle: "casual",
    defaultModel: "model-default",
    enabled: true,
    env
  });
  assert.strictEqual(explicit.model, "model-deep");

  const fallback = resolveChatModel({
    requestedProfile: "research",
    defaultModel: "model-default",
    enabled: true,
    env: { AI_MODEL: "model-default" }
  });
  assert.strictEqual(fallback.model, "model-default");
  assert.strictEqual(fallback.profile, "default");
  assert.strictEqual(fallback.routed, false);

  const status = publicModelRoutingStatus(env, "model-default");
  assert.strictEqual(status.implemented, true);
  assert.strictEqual(status.multipleModelsConfigured, true);
  assert.strictEqual(status.multipleProvidersConfigured, true);
  assert(status.configuredProviderProfiles.includes("deep"));
  assert.strictEqual(status.rawModelIdsExposed, false);
  assert.strictEqual(status.browserSuppliedModelIdsAccepted, false);

  assert.strictEqual(CAPABILITY_CATALOG.multi_model.implemented, true);
  assert.strictEqual(CAPABILITY_CATALOG.multi_model.minimumPlan, "ultra");
  const free = buildCapabilityAccess({ planTier: "free" }).find((item) => item.key === "multi_model");
  const premium = buildCapabilityAccess({ planTier: "premium" }).find((item) => item.key === "multi_model");
  const ultra = buildCapabilityAccess({ planTier: "ultra" }).find((item) => item.key === "multi_model");
  const legacyTop = buildCapabilityAccess({ planTier: "top" }).find((item) => item.key === "multi_model");
  assert.strictEqual(free.usable, false);
  assert.strictEqual(premium.usable, false);
  assert.strictEqual(ultra.usable, true);
  assert.strictEqual(legacyTop.usable, true);

  const serverSource = fs.readFileSync(path.join(appRoot, "server.js"), "utf8");
  const integratedServer = integrateModelRoutingServerSource(serverSource);
  assert.strictEqual(count(integratedServer, 'require("./ai/model-routing")'), 1);
  assert.strictEqual(count(integratedServer, 'item.key === "multi_model"'), 2);
  assert.strictEqual(count(integratedServer, "model: modelRoute.model,"), 2);
  assert.strictEqual(count(integratedServer, "provider: modelRoute.provider,"), 2);
  assert.ok(integratedServer.includes("requestedProfile: req.body?.modelProfile"));
  assert.ok(integratedServer.includes("message,"));
  assert.ok(integratedServer.includes("enabled: multiModelEnabled"));
  new vm.Script(integratedServer, { filename: "integrated-server-model-routing.js" });

  const indexSource = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const routedHtml = injectModelRoutingUi(indexSource);
  assert.strictEqual(count(routedHtml, 'id="modelProfileSelect"'), 1);
  assert.strictEqual(count(routedHtml, "let modelProfile = \"auto\";"), 1);
  assert.strictEqual(count(routedHtml, "modelProfile,"), 2);
  assert.ok(routedHtml.includes('option value="fast">FAST · ULTRA'));
  assert.ok(routedHtml.includes('option value="deep">DEEP · ULTRA'));
  assert.ok(routedHtml.includes('option value="research">RESEARCH · ULTRA'));
  assert.ok(routedHtml.includes('canUseCapability("multi_model")'));
  assert.ok(routedHtml.includes("Multi-model routing requires Ultra access."));
  assert.ok(!routedHtml.includes('name="model"'));

  const fullyComposedHtml = injectEmailAccountUi(indexSource);
  assert.strictEqual(count(fullyComposedHtml, 'id="modelProfileSelect"'), 1);
  assert.strictEqual(count(fullyComposedHtml, '<script src="/email-account-ui.js" defer></script>'), 1);

  const startup = fs.readFileSync(path.join(appRoot, "start.js"), "utf8");
  assert.ok(startup.includes('require("./ai/model-routing-server-integration")'));
  assert.ok(startup.includes("integrateModelRoutingServerSource(integratedSource)"));
  assert.ok(
    startup.indexOf("integrateModelRoutingServerSource(integratedSource)") >
      startup.indexOf("integrateAdvertisingPolicyServerSource(integratedSource)"),
    "Model routing should be applied after the existing production integration chain."
  );

  console.log("PASS model-routing contract: Ultra entitlement, legacy TOP compatibility, server-only model IDs, automatic/profile routing, fallback behavior, UI composition, and production integration.");
}

main();
