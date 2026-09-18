const INTEGRATION_VERSION = "pricing-usage-v1";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Usage-budget integration marker is missing: ${label}.`);
    error.code = "USAGE_BUDGET_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Usage-budget integration marker is ambiguous: ${label}.`);
    error.code = "USAGE_BUDGET_SERVER_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integrateUsageBudgetServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "USAGE_BUDGET_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  const launchImport = `const { buildLaunchReadiness } = require("./ops/launch-readiness");`;
  source = replaceExactlyOnce(
    source,
    launchImport,
    `${launchImport}
const {
  assertUsageBudget: assertPlanUsageBudget,
  getUsageBudgetState
} = require("./usage/plan-budgets");`,
    "usage-budget-import"
  );

  const chatRoute = `app.post("/api/chat", chatRateLimit, researchRateLimit, async (req, res) => {`;
  source = replaceExactlyOnce(
    source,
    chatRoute,
    `async function enforceUsageBudgetForUser({ userId, category }) {
  if (!databaseReady || !pool || !userId) return null;
  return assertPlanUsageBudget({
    pool,
    userId,
    category,
    env: process.env
  });
}

async function enforceChatUsageBudget(req, res, next) {
  try {
    if (!databaseReady || !pool) return next();
    const user = await findSessionUser(req);
    if (!user) return next();

    await enforceUsageBudgetForUser({ userId: user.id, category: "chat" });
    if (normalizeProductMode(req.body?.productMode) === "research") {
      await enforceUsageBudgetForUser({ userId: user.id, category: "research" });
    }
    return next();
  } catch (error) {
    if (error?.code !== "USAGE_MONTHLY_LIMIT_REACHED") return next(error);
    return res.status(Number(error.statusCode) || 429).json({
      error: error.publicMessage || error.message || "Monthly usage allowance reached.",
      code: error.code,
      usageBudget: error.usageBudget || null
    });
  }
}

async function enforceStreamingUsageBudget(req, res, next) {
  try {
    if (!databaseReady || !pool) return next();
    const user = await findSessionUser(req);
    if (!user) return next();
    await enforceUsageBudgetForUser({ userId: user.id, category: "chat" });
    return next();
  } catch (error) {
    if (error?.code !== "USAGE_MONTHLY_LIMIT_REACHED") return next(error);
    return res.status(Number(error.statusCode) || 429).json({
      error: error.publicMessage || error.message || "Monthly usage allowance reached.",
      code: error.code,
      usageBudget: error.usageBudget || null
    });
  }
}

${chatRoute.replace(", async (req, res) => {", ", enforceChatUsageBudget, async (req, res) => {")}`,
    "chat-usage-budget-middleware"
  );

  const streamRoute = `app.post("/api/chat/stream", chatRateLimit, async (req, res) => {`;
  source = replaceExactlyOnce(
    source,
    streamRoute,
    streamRoute.replace(", async (req, res) => {", ", enforceStreamingUsageBudget, async (req, res) => {"),
    "stream-usage-budget-middleware"
  );

  const fileRouter = `createFileAnalysisRouter({
    recordUsageEvent,
    estimateProviderCostMicros
  })`;
  source = replaceExactlyOnce(
    source,
    fileRouter,
    `createFileAnalysisRouter({
    recordUsageEvent,
    estimateProviderCostMicros,
    assertUsageBudget: enforceUsageBudgetForUser
  })`,
    "file-analysis-budget"
  );

  const artifactRouter = `createArtifactRouter({
    recordUsageEvent,
    estimateProviderCostMicros
  })`;
  source = replaceExactlyOnce(
    source,
    artifactRouter,
    `createArtifactRouter({
    recordUsageEvent,
    estimateProviderCostMicros,
    assertUsageBudget: enforceUsageBudgetForUser
  })`,
    "artifact-budget"
  );

  const imageUnderstandingRouter = `createImageUnderstandingRouter({
    recordUsageEvent,
    estimateProviderCostMicros
  })`;
  source = replaceExactlyOnce(
    source,
    imageUnderstandingRouter,
    `createImageUnderstandingRouter({
    recordUsageEvent,
    estimateProviderCostMicros,
    assertUsageBudget: enforceUsageBudgetForUser
  })`,
    "image-understanding-budget"
  );

  const imageToolsRouter = `createImageToolsRouter({
    recordUsageEvent
  })`;
  source = replaceExactlyOnce(
    source,
    imageToolsRouter,
    `createImageToolsRouter({
    recordUsageEvent,
    assertUsageBudget: enforceUsageBudgetForUser
  })`,
    "image-tools-budget"
  );

  const agentRouter = `createAgentRouter({
    getPool: () => pool,
    createRunRateLimit: agentRunRateLimit
  })`;
  source = replaceExactlyOnce(
    source,
    agentRouter,
    `createAgentRouter({
    getPool: () => pool,
    createRunRateLimit: agentRunRateLimit,
    assertUsageBudget: enforceUsageBudgetForUser
  })`,
    "agent-router-budget"
  );

  const voiceRouter = `createVoiceRouter({
    getPool: () => pool
  })`;
  source = replaceExactlyOnce(
    source,
    voiceRouter,
    `createVoiceRouter({
    getPool: () => pool,
    assertUsageBudget: enforceUsageBudgetForUser
  })`,
    "voice-budget"
  );

  const agentWorker = `startAgentWorker({
  getPool: () => pool,
  isDatabaseReady: () => databaseReady,
  recordUsageEvent,
  estimateProviderCostMicros
});`;
  source = replaceExactlyOnce(
    source,
    agentWorker,
    `startAgentWorker({
  getPool: () => pool,
  isDatabaseReady: () => databaseReady,
  recordUsageEvent,
  estimateProviderCostMicros,
  assertUsageBudget: enforceUsageBudgetForUser
});`,
    "agent-budget"
  );

  const accountAccessRoute = `app.get(
  "/api/account/access",`;
  source = replaceExactlyOnce(
    source,
    accountAccessRoute,
    `app.get(
  "/api/account/usage-budget",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const state = await getUsageBudgetState({
        pool,
        userId: req.user.id,
        env: process.env
      });
      return res.json({ usageBudget: state });
    } catch (error) {
      console.error("UNBOUND AI USAGE BUDGET STATUS ERROR:", error);
      return res.status(500).json({
        error: "Could not load monthly usage allowance."
      });
    }
  }
);

${accountAccessRoute}`,
    "usage-budget-account-route"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  integrateUsageBudgetServerSource
};
