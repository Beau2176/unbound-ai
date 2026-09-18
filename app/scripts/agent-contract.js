const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  MAX_AGENT_STEPS,
  MAX_ACTIVE_RUNS_PER_USER,
  normalizeAgentInput,
  buildAgentStepPrompt,
  publicAgentRun,
  publicAgentStep,
  executeAgentRun
} = require("../agents/runner");
const { validNumericId } = require("../agents/routes");
const { CAPABILITY_CATALOG, buildCapabilityAccess } = require("../access/entitlements");
const { getRateLimitPolicy } = require("../security/rate-limit");
const { buildFileAwareIndexHtml, AGENTS_NAV_LINK } = require("../files/routes");

async function main() {
  assert.strictEqual(MAX_AGENT_STEPS, 4);
  assert.strictEqual(MAX_ACTIVE_RUNS_PER_USER, 5);
  assert.strictEqual(validNumericId("42"), true);
  assert.strictEqual(validNumericId("x42"), false);

  const input = normalizeAgentInput({
    objective: "Compare two approaches and recommend one.",
    research: true,
    maxSteps: 99
  });
  assert.strictEqual(input.research, true);
  assert.strictEqual(input.maxSteps, 4);
  assert.throws(() => normalizeAgentInput({ objective: "" }), /objective/i);

  const firstPrompt = buildAgentStepPrompt({
    objective: "Build a launch plan",
    stepNumber: 1,
    maxSteps: 3
  });
  assert.ok(firstPrompt.includes("Pass 1 of 3"));
  const finalPrompt = buildAgentStepPrompt({
    objective: "Build a launch plan",
    stepNumber: 3,
    maxSteps: 3,
    previousOutput: "draft"
  });
  assert.ok(finalPrompt.includes("Final pass 3 of 3"));
  assert.ok(finalPrompt.includes("draft"));

  const runPublic = publicAgentRun({
    id: 7,
    objective: "Test",
    research_enabled: true,
    max_steps: 3,
    completed_steps: 1,
    status: "running",
    cancel_requested: false,
    final_output: "draft",
    final_sources: [],
    created_at: new Date(),
    updated_at: new Date()
  });
  assert.strictEqual(runPublic.id, "7");
  assert.strictEqual(runPublic.research, true);

  const stepPublic = publicAgentStep({
    id: 9,
    run_id: 7,
    step_number: 1,
    output: "draft",
    web_search_calls: 2,
    sources: [],
    created_at: new Date()
  });
  assert.strictEqual(stepPublic.runId, "7");
  assert.strictEqual(stepPublic.webSearchCalls, 2);

  let calls = 0;
  const models = [];
  const queries = [];
  const fakePool = {
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.includes("FROM agent_steps") && sql.includes("ORDER BY step_number DESC")) {
        return { rows: [] };
      }
      if (sql.includes("SELECT cancel_requested")) {
        return { rows: [{ cancel_requested: false }] };
      }
      return { rows: [] };
    }
  };
  const usageEvents = [];
  const result = await executeAgentRun({
    pool: fakePool,
    run: {
      id: 10,
      user_id: 20,
      objective: "Produce a concise test result",
      research_enabled: true,
      max_steps: 2
    },
    getGatewayStatusImpl: () => ({ configured: true, model: "test-model" }),
    generateChatImpl: async ({ research, model, reasoningEffort }) => {
      calls += 1;
      models.push({ model, reasoningEffort });
      return {
        provider: "openai",
        model: "test-model",
        reply: `pass-${calls}`,
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        responseId: `response-${calls}`,
        research: research?.enabled
          ? {
              webSearchCalls: 1,
              sources: [{ number: 1, title: "Source", url: "https://example.com/" }],
              citations: []
            }
          : { webSearchCalls: 0, sources: [], citations: [] }
      };
    },
    recordUsageEvent: async (event) => usageEvents.push(event),
    estimateProviderCostMicros: () => 123,
    env: {
      AI_MODEL: "test-model",
      AI_MODEL_DEEP: "test-model-deep",
      AI_MODEL_RESEARCH: "test-model-research"
    }
  });
  assert.strictEqual(result.status, "completed");
  assert.strictEqual(result.completedSteps, 2);
  assert.strictEqual(result.finalOutput, "pass-2");
  assert.strictEqual(calls, 2);
  assert.strictEqual(models.length, 2);
  assert.ok(models.every((item) => item.model === "test-model-research"));
  assert.ok(models.every((item) => item.reasoningEffort === "low"));
  assert.strictEqual(usageEvents.length, 2);
  assert.ok(queries.some((item) => item.sql.includes("INSERT INTO agent_steps")));
  assert.ok(queries.some((item) => item.sql.includes("status = 'completed'")));

  assert.strictEqual(CAPABILITY_CATALOG.agents.implemented, true);
  const free = buildCapabilityAccess({ planTier: "free" }).find((item) => item.key === "agents");
  const top = buildCapabilityAccess({ planTier: "top" }).find((item) => item.key === "agents");
  assert.strictEqual(free.usable, false);
  assert.strictEqual(top.usable, true);

  const rate = getRateLimitPolicy({});
  assert.strictEqual(rate.agentRuns.scope, "agent_run_account");
  assert.strictEqual(rate.agentRuns.limit, 10);

  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const indexHtml = buildFileAwareIndexHtml(indexSource);
  assert.ok(indexHtml.includes(AGENTS_NAV_LINK));

  const page = fs.readFileSync(path.join(__dirname, "..", "agents.html"), "utf8");
  assert.ok(page.includes("UNBOUND AI · TOP"));
  assert.ok(page.includes("/api/agents/runs"));
  assert.ok(page.includes("cannot yet send messages"));
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let checked = 0;
  while ((match = scriptPattern.exec(page))) {
    const code = String(match[1] || "").trim();
    if (!code) continue;
    new vm.Script(code, { filename: `agents.html#inline-script-${checked + 1}` });
    checked += 1;
  }
  assert.ok(checked >= 1);

  console.log("UNBOUND AI bounded Agent contract checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
