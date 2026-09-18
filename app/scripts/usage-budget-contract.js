const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  DEFAULT_PLAN_USAGE_LIMITS,
  getPlanUsageLimits,
  nextCalendarMonthIso,
  getUsageBudgetState,
  assertUsageBudget
} = require("../usage/plan-budgets");
const {
  integrateUsageBudgetServerSource
} = require("../usage/server-integration");
const { PLAN_DEFINITIONS } = require("../access/entitlements");
const {
  PLAN_PRICES,
  LEGACY_PLAN_PRICES
} = require("../billing/providers/segpay");

const appRoot = path.resolve(__dirname, "..");

function fakePool({ account = {}, usage = {} } = {}) {
  return {
    async query(sql) {
      if (sql.includes("FROM users u")) {
        return {
          rows: [{
            role: account.role || "user",
            manual_plan_tier: account.manualPlan || "premium",
            complimentary_top_tier: Boolean(account.complimentary),
            subscription_status: account.subscriptionStatus || "none",
            subscription_plan_tier: account.subscriptionPlan || null
          }]
        };
      }
      if (sql.includes("FROM usage_events")) {
        return {
          rows: [{
            estimated_cost_micros: usage.estimatedCostMicros || 0,
            chat_events: usage.chatEvents || 0,
            web_search_calls: usage.webSearchCalls || 0,
            file_analysis_events: usage.fileAnalysisEvents || 0,
            artifact_events: usage.artifactEvents || 0,
            image_understanding_events: usage.imageUnderstandingEvents || 0,
            image_tool_events: usage.imageToolEvents || 0,
            voice_events: usage.voiceEvents || 0,
            agent_step_events: usage.agentStepEvents || 0
          }]
        };
      }
      throw new Error("Unexpected usage-budget query");
    }
  };
}

function syntheticIntegratedServerSource() {
  return [
    'const { buildLaunchReadiness } = require("./ops/launch-readiness");',
    'app.post("/api/chat", chatRateLimit, researchRateLimit, async (req, res) => {',
    '  return res.json({ ok: true });',
    '});',
    'app.post("/api/chat/stream", chatRateLimit, async (req, res) => {',
    '  return res.end();',
    '});',
    'createFileAnalysisRouter({',
    '    recordUsageEvent,',
    '    estimateProviderCostMicros',
    '  })',
    'createArtifactRouter({',
    '    recordUsageEvent,',
    '    estimateProviderCostMicros',
    '  })',
    'createImageUnderstandingRouter({',
    '    recordUsageEvent,',
    '    estimateProviderCostMicros',
    '  })',
    'createImageToolsRouter({',
    '    recordUsageEvent',
    '  })',
    'createVoiceRouter({',
    '    getPool: () => pool',
    '  })',
    'startAgentWorker({',
    '  getPool: () => pool,',
    '  isDatabaseReady: () => databaseReady,',
    '  recordUsageEvent,',
    '  estimateProviderCostMicros',
    '});',
    'app.get(',
    '  "/api/account/access",',
    '  requireDatabase',
    ');'
  ].join("\n");
}

async function main() {
  assert.strictEqual(PLAN_DEFINITIONS.premium.priceMonthlyUsd, 29.99);
  assert.strictEqual(PLAN_DEFINITIONS.ultra.priceMonthlyUsd, 99.99);
  assert.strictEqual(PLAN_DEFINITIONS.max.priceMonthlyUsd, 199.99);

  assert.deepStrictEqual(PLAN_PRICES, {
    premium: "29.99",
    ultra: "99.99",
    max: "199.99"
  });
  assert.deepStrictEqual(LEGACY_PLAN_PRICES, {
    premium: ["49.99", "59.99"],
    ultra: ["129.99", "114.99"],
    max: []
  });

  assert.strictEqual(DEFAULT_PLAN_USAGE_LIMITS.premium.estimatedCostUsd, 8);
  assert.strictEqual(DEFAULT_PLAN_USAGE_LIMITS.ultra.estimatedCostUsd, 30);
  assert.strictEqual(DEFAULT_PLAN_USAGE_LIMITS.max.estimatedCostUsd, 70);
  assert.strictEqual(DEFAULT_PLAN_USAGE_LIMITS.premium.webSearchCalls, 400);
  assert.strictEqual(DEFAULT_PLAN_USAGE_LIMITS.ultra.imageToolEvents, 100);
  assert.strictEqual(DEFAULT_PLAN_USAGE_LIMITS.max.agentStepEvents, 1200);

  const overridden = getPlanUsageLimits("premium", {
    UNBOUND_USAGE_PREMIUM_ESTIMATED_COST_USD: "12.5",
    UNBOUND_USAGE_PREMIUM_WEB_SEARCH_CALLS: "777"
  });
  assert.strictEqual(overridden.estimatedCostMicros, 12_500_000);
  assert.strictEqual(overridden.webSearchCalls, 777);

  assert.strictEqual(
    nextCalendarMonthIso(new Date("2026-09-18T12:00:00Z")),
    "2026-10-01T00:00:00.000Z"
  );

  const state = await getUsageBudgetState({
    pool: fakePool({
      account: {
        manualPlan: "premium",
        subscriptionStatus: "active",
        subscriptionPlan: "ultra"
      },
      usage: {
        estimatedCostMicros: 1_000_000,
        chatEvents: 12,
        webSearchCalls: 5
      }
    }),
    userId: "42",
    env: {}
  });
  assert.strictEqual(state.planTier, "ultra");
  assert.strictEqual(state.usage.chatEvents, 12);
  assert.strictEqual(state.remaining.webSearchCalls, 1495);

  await assert.doesNotReject(() =>
    assertUsageBudget({
      pool: fakePool({
        account: { manualPlan: "premium" },
        usage: { estimatedCostMicros: 1_000_000, chatEvents: 20 }
      }),
      userId: "1",
      category: "chat",
      env: {}
    })
  );

  await assert.rejects(
    () =>
      assertUsageBudget({
        pool: fakePool({
          account: { manualPlan: "premium" },
          usage: { webSearchCalls: 400 }
        }),
        userId: "1",
        category: "research",
        env: {}
      }),
    (error) =>
      error?.code === "USAGE_MONTHLY_LIMIT_REACHED" &&
      error?.statusCode === 429 &&
      error?.usageBudget?.field === "webSearchCalls"
  );

  await assert.rejects(
    () =>
      assertUsageBudget({
        pool: fakePool({
          account: { manualPlan: "ultra" },
          usage: { estimatedCostMicros: 30_000_000 }
        }),
        userId: "1",
        category: "chat",
        env: {}
      }),
    (error) =>
      error?.code === "USAGE_MONTHLY_LIMIT_REACHED" &&
      error?.usageBudget?.field === "estimatedCostMicros"
  );

  const integrated = integrateUsageBudgetServerSource(syntheticIntegratedServerSource());
  for (const marker of [
    'require("./usage/plan-budgets")',
    "enforceChatUsageBudget",
    "enforceStreamingUsageBudget",
    "assertUsageBudget: enforceUsageBudgetForUser",
    '"/api/account/usage-budget"'
  ]) {
    assert.ok(integrated.includes(marker), `missing integrated marker: ${marker}`);
  }

  const startSource = fs.readFileSync(path.join(appRoot, "start.js"), "utf8");
  assert.ok(startSource.includes('require("./usage/server-integration")'));
  assert.ok(
    startSource.indexOf("integrateUsageBudgetServerSource(integratedSource)") >
      startSource.indexOf("integrateNativeShellServerSource(integratedSource)")
  );

  const billingDoc = fs.readFileSync(path.join(appRoot, "..", "docs", "BILLING.md"), "utf8");
  assert.ok(billingDoc.includes("$29.99/month"));
  assert.ok(billingDoc.includes("$99.99/month"));
  assert.ok(billingDoc.includes("$199.99/month"));

  console.log("Pricing and plan usage-budget contract passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
