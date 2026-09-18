const assert = require("assert");
const { buildFuturePlan, detectIntent } = require("../orchestration/planner");
const {
  createJobState,
  getRunnableTasks,
  startTask,
  completeTask,
  approveTask,
  applyUsage,
  serializeJob,
  hydrateJob
} = require("../orchestration/state");
const { publicRegistry, unavailableToolsForTask } = require("../orchestration/registry");
const { runJobWave } = require("../orchestration/runner");
const { FUTURE_CORE_SCHEMA_SQL } = require("../orchestration/persistence");
const { integrateFutureCoreV2ServerSource } = require("../orchestration/server-integration");

async function main() {
  assert.strictEqual(detectIntent("research current AI trends and build a report"), "research_build");
  assert.strictEqual(detectIntent("send this application"), "action");

  const plan = buildFuturePlan("Research the current market, build a launch brief, and publish it.");
  assert.strictEqual(plan.intent, "mixed_action");
  assert(plan.tasks.some((task) => task.id === "research"));
  assert(plan.tasks.some((task) => task.id === "build"));
  assert(plan.tasks.some((task) => task.id === "execute_action"));
  const action = plan.tasks.find((task) => task.id === "execute_action");
  assert.strictEqual(action.approval.required, true);
  assert(action.tools.includes("external_action"));

  const registry = publicRegistry();
  assert(registry.specialists.length >= 6);
  assert(registry.tools.find((tool) => tool.id === "external_action").approvalRequired);
  assert(unavailableToolsForTask(action).includes("external_action"));

  const simple = buildFuturePlan("Analyze this architecture.");
  const job = createJobState({
    id: "11111111-1111-4111-8111-111111111111",
    userId: "42",
    plan: simple,
    budget: { maxConcurrent: 2, maxModelCalls: 8, maxWebCalls: 4, maxCostMicros: 200000 }
  });
  assert.strictEqual(job.status, "planned");
  assert.deepStrictEqual(getRunnableTasks(job).map((task) => task.id), ["analysis"]);

  startTask(job, "analysis");
  completeTask(job, "analysis", { output: "analysis complete", usage: { modelCalls: 1, webCalls: 0, costMicros: 1000 } });
  applyUsage(job, { modelCalls: 1, webCalls: 0, costMicros: 1000 });
  assert(getRunnableTasks(job).some((task) => task.id === "review"));

  const restored = hydrateJob(serializeJob(job));
  assert.strictEqual(restored.id, job.id);
  assert.strictEqual(restored.tasks.find((task) => task.id === "analysis").output, "analysis complete");

  const actionPlan = buildFuturePlan("Send the completed message.");
  const approvalJob = createJobState({
    id: "22222222-2222-4222-8222-222222222222",
    userId: "42",
    plan: actionPlan
  });
  startTask(approvalJob, "analysis");
  completeTask(approvalJob, "analysis", { output: "ready" });
  startTask(approvalJob, "prepare_action");
  completeTask(approvalJob, "prepare_action", { output: "prepared" });
  assert.strictEqual(approvalJob.status, "waiting_approval");
  assert.throws(() => startTask(approvalJob, "execute_action"), /not runnable/i);
  approveTask(approvalJob, "execute_action", "user:42");
  assert(getRunnableTasks(approvalJob).some((task) => task.id === "execute_action"));

  const runPlan = buildFuturePlan("Analyze this request.");
  const runJob = createJobState({
    id: "33333333-3333-4333-8333-333333333333",
    userId: "42",
    plan: runPlan
  });
  const wave = await runJobWave({
    job: runJob,
    executeTaskImpl: async ({ task }) => ({
      output: `done:${task.id}`,
      sources: [],
      usage: { modelCalls: 1, webCalls: 0, costMicros: 500 }
    })
  });
  assert.strictEqual(wave.executed, 1);
  assert.strictEqual(runJob.tasks.find((task) => task.id === "analysis").status, "completed");
  assert.strictEqual(runJob.budget.usedModelCalls, 1);

  assert(FUTURE_CORE_SCHEMA_SQL.includes("CREATE TABLE IF NOT EXISTS future_core_jobs"));
  assert(FUTURE_CORE_SCHEMA_SQL.includes("snapshot JSONB NOT NULL"));

  const minimal = [
    'const { createMemoryRouter, sendMemoryPage } = require("./memory/routes");',
    'const { buildMemoryPrompt } = require("./memory/context");',
    'const { buildProjectCoreMemoryPrompt, getProjectIdentity } = require("./project/identity");',
    "async function schema() {",
    "  await pool.query(`",
    "    CREATE INDEX IF NOT EXISTS user_memories_user_idx",
    "      ON user_memories(user_id, enabled, updated_at DESC, id DESC);",
    "  `);",
    "}",
    'app.get("/api/health", (req, res) => {',
    "});"
  ].join("\n");
  const integrated = integrateFutureCoreV2ServerSource(minimal);
  assert(integrated.includes('require("./orchestration/routes")'));
  assert(integrated.includes("UNBOUND_FUTURE_CORE_V2_ENABLED"));
  assert(integrated.includes('requireCapability("agents")'));
  assert(integrated.includes('"/api/future-core-v2"'));
  assert.strictEqual(integrateFutureCoreV2ServerSource(integrated), integrated);

  console.log("PASS Future Core v2 staged orchestrator: resumable jobs, specialists, budgets, approval gate, persistence, and launch flag.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
