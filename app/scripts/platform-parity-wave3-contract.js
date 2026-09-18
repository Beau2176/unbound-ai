const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { validProjectId, normalizeProjectMemoryInput, rankProjectMemories, buildProjectContext } = require("../platform/project-memory");
const { normalizeAgentScheduleInput, createScheduledFutureCoreJob } = require("../platform/background-agent-scheduler");
const { claimBackgroundJob } = require("../orchestration/background-worker");
const { integratePlatformParityServerSource } = require("../platform/server-integration");

async function main() {
  const projectId = "11111111-1111-4111-8111-111111111111";
  assert.strictEqual(validProjectId(projectId), true);
  assert.strictEqual(validProjectId("not-a-uuid"), false);
  assert.deepStrictEqual(normalizeProjectMemoryInput({ content: "Launch date is October 1.", enabled: true }), { content: "Launch date is October 1.", enabled: true });
  assert.throws(() => normalizeProjectMemoryInput({ content: "" }), /between 1 and 1200/i);
  const ranked = rankProjectMemories([
    { id: "1", content: "Brand color is blue." },
    { id: "2", content: "Launch date is October 1 and launch checklist is ready." },
    { id: "3", content: "Office snacks are stocked." }
  ], "What is the launch date?");
  assert.strictEqual(ranked[0].id, "2");

  const contextPool = {
    query: async (sql) => {
      const text = String(sql);
      if (text.includes("FROM ai_projects")) return { rows: [{ id: projectId, name: "UNBOUND Launch", description: "Launch workspace", status: "active" }] };
      if (text.includes("FROM project_memories")) return { rows: [{ id: 9, project_id: projectId, content: "Launch date is October 1.", enabled: true, created_at: "2026-09-18T00:00:00Z", updated_at: "2026-09-18T00:00:00Z" }] };
      return { rows: [] };
    }
  };
  const context = await buildProjectContext(contextPool, "42", projectId, "launch date");
  assert(context.includes("Project: UNBOUND Launch"));
  assert(context.includes("Launch date is October 1."));
  assert.strictEqual(await buildProjectContext(contextPool, "42", "bad-id", "x"), "");

  const now = new Date("2026-09-18T20:00:00Z");
  const scheduleInput = normalizeAgentScheduleInput({ title: "Morning research", objective: "Research current AI releases", recurrence: "daily", intervalCount: 1, runAt: "2026-09-18T21:00:00Z", projectId, allowResearch: true }, now);
  assert.strictEqual(scheduleInput.recurrence, "daily");
  assert.strictEqual(scheduleInput.projectId, projectId);

  const scheduledPool = {
    query: async (sql, params) => {
      const text = String(sql);
      if (text.includes("FROM ai_projects")) return { rows: [{ id: projectId, name: "UNBOUND Launch", description: "", status: "active" }] };
      if (text.includes("FROM project_memories")) return { rows: [] };
      if (text.includes("INSERT INTO future_core_jobs")) return { rows: [{ snapshot: JSON.parse(params[6]) }] };
      return { rows: [] };
    }
  };
  const scheduledJob = await createScheduledFutureCoreJob(scheduledPool, { id: 77, user_id: 42, project_id: projectId, objective: "Research current AI releases", allow_research: true, next_run_at: "2026-09-18T21:00:00Z" }, now);
  assert.strictEqual(scheduledJob.background, true);
  assert.strictEqual(scheduledJob.projectId, projectId);
  assert.strictEqual(scheduledJob.trigger.type, "schedule");

  let capturedSelect = "";
  const claimClient = {
    query: async (sql) => {
      const text = String(sql);
      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };
      if (text.includes("SELECT id, user_id, project_id, snapshot")) { capturedSelect = text; return { rows: [] }; }
      return { rows: [] };
    },
    release: () => {}
  };
  assert.strictEqual(await claimBackgroundJob({ connect: async () => claimClient }), null);
  assert(capturedSelect.includes("snapshot->>\'background\' = \'true\'"));
  assert(capturedSelect.includes("FOR UPDATE SKIP LOCKED"));

  const minimal = [
    "const { createFutureCoreRouter } = require(\"./orchestration/routes\");",
    "async function schema() {",
    "  await pool.query(\`",
    "    CREATE INDEX IF NOT EXISTS future_core_jobs_status_idx",
    "      ON future_core_jobs(status, updated_at DESC);",
    "  \`);",
    "}",
    "startAgentWorker({",
    "  getPool: () => pool,",
    "  isDatabaseReady: () => databaseReady,",
    "  recordUsageEvent,",
    "  estimateProviderCostMicros",
    "});",
    "app.get(\"/api/health\", (req, res) => {",
    "});"
  ].join("\n");
  const integrated = integratePlatformParityServerSource(minimal);
  assert(integrated.includes("require(\"./orchestration/background-worker\")"));
  assert(integrated.includes("require(\"./platform/background-agent-scheduler\")"));
  assert(integrated.includes("CREATE TABLE IF NOT EXISTS project_memories"));
  assert(integrated.includes("CREATE TABLE IF NOT EXISTS background_agent_schedules"));
  assert(integrated.includes("UNBOUND_FUTURE_CORE_BACKGROUND_ENABLED"));
  assert(integrated.includes("UNBOUND_BACKGROUND_AGENT_SCHEDULER_ENABLED"));
  assert.strictEqual((integrated.match(/startFutureCoreBackgroundWorker\(\{/g) || []).length, 1);
  assert.strictEqual((integrated.match(/startBackgroundAgentScheduler\(\{/g) || []).length, 1);
  assert.strictEqual(integratePlatformParityServerSource(integrated), integrated);

  const futureRoutes = fs.readFileSync(path.join(__dirname, "..", "orchestration", "routes.js"), "utf8");
  assert(futureRoutes.includes("job.background = Boolean(req.body?.background)"));
  assert(futureRoutes.includes("FUTURE_CORE_BACKGROUND_MANAGED"));
  const platformRoutes = fs.readFileSync(path.join(__dirname, "..", "platform", "routes.js"), "utf8");
  assert(platformRoutes.includes("router.get(\"/projects/:id/memory\""));
  assert(platformRoutes.includes("router.get(\"/background-agents\""));
  assert(platformRoutes.includes("router.post(\"/background-agents\""));
  console.log("PASS platform parity wave 3: background-only claiming, scheduled agents, project memory, and worker integration.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
