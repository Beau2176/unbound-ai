const assert = require("assert");
const { normalizeProjectMemoryInput, rankProjectMemories, buildProjectContext } = require("../platform/project-memory");
const { normalizeAgentScheduleInput, publicAgentSchedule } = require("../platform/background-agent-scheduler");
const { buildTaskPrompt } = require("../orchestration/runner");
const { createJobState } = require("../orchestration/state");
const { buildFuturePlan } = require("../orchestration/planner");
const { saveJob } = require("../orchestration/persistence");
const { integratePlatformParityServerSource } = require("../platform/server-integration");

async function main() {
  assert.deepStrictEqual(
    normalizeProjectMemoryInput({ content: "Use concise launch briefs.", enabled: true }),
    { content: "Use concise launch briefs.", enabled: true }
  );
  assert.throws(() => normalizeProjectMemoryInput({ content: "" }), /between 1 and/);

  const ranked = rankProjectMemories([
    { id: "1", content: "The mobile launch requires signed Android evidence." },
    { id: "2", content: "Marketing uses the blue and gold brand." },
    { id: "3", content: "Android native launch testing is unfinished." }
  ], "What is left for the Android launch?");
  assert(["1", "3"].includes(ranked[0].id));

  const fakePool = {
    query: async (sql) => {
      if (String(sql).includes("FROM ai_projects")) {
        return { rows: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "UNBOUND Mobile", description: "Native mobile work", status: "active" }] };
      }
      if (String(sql).includes("FROM project_memories")) {
        return { rows: [
          { id: 1, project_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", content: "Require signed Android device evidence before store launch.", enabled: true },
          { id: 2, project_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", content: "Voice playback uses the selected device voice.", enabled: true }
        ] };
      }
      return { rows: [] };
    }
  };
  const projectContext = await buildProjectContext(fakePool, "42", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Android launch evidence");
  assert(projectContext.includes("UNBOUND Mobile"));
  assert(projectContext.includes("signed Android device evidence"));

  const plan = buildFuturePlan("Analyze the mobile launch readiness.");
  const job = createJobState({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", userId: "42", plan });
  job.projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  job.projectContext = projectContext;
  const prompt = buildTaskPrompt(job, job.tasks[0]);
  assert(prompt.includes("Project context:"));
  assert(prompt.includes("signed Android device evidence"));

  const queries = [];
  const persistencePool = {
    query: async (sql, params) => {
      queries.push({ sql: String(sql), params });
      return { rows: [{ snapshot: JSON.parse(params[6]), id: params[0], status: params[5] }] };
    }
  };
  await saveJob(persistencePool, "42", job, { projectId: job.projectId });
  assert(queries[0].sql.includes("project_id"));
  assert.strictEqual(queries[0].params[2], job.projectId);

  const now = new Date("2026-09-18T20:00:00Z");
  const schedule = normalizeAgentScheduleInput({
    title: "Morning brief",
    objective: "Research current AI news and summarize it.",
    recurrence: "daily",
    intervalCount: 1,
    runAt: "2026-09-19T14:00:00Z",
    projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  }, now);
  assert.strictEqual(schedule.recurrence, "daily");
  assert.strictEqual(schedule.allowResearch, true);
  assert.strictEqual(publicAgentSchedule({
    id: 4, project_id: schedule.projectId, title: schedule.title, objective: schedule.objective,
    recurrence: schedule.recurrence, interval_count: 1, allow_research: true,
    next_run_at: schedule.runAt.toISOString(), enabled: true
  }).projectId, schedule.projectId);

  const workerMarker = [
    "startAgentWorker({",
    "  getPool: () => pool,",
    "  isDatabaseReady: () => databaseReady,",
    "  recordUsageEvent,",
    "  estimateProviderCostMicros",
    "});"
  ].join("\n");
  const minimal = [
    'const { createFutureCoreRouter } = require("./orchestration/routes");',
    workerMarker,
    "async function schema() {",
    "  await pool.query(`",
    "    CREATE INDEX IF NOT EXISTS future_core_jobs_status_idx",
    "      ON future_core_jobs(status, updated_at DESC);",
    "  `);",
    "}",
    'app.get("/api/health", (req, res) => {',
    "});"
  ].join("\n");
  const integrated = integratePlatformParityServerSource(minimal);
  assert(integrated.includes("CREATE TABLE IF NOT EXISTS project_memories"));
  assert(integrated.includes("CREATE TABLE IF NOT EXISTS background_agent_schedules"));
  assert(integrated.includes("worker_claimed_at"));
  assert(integrated.includes('require("./orchestration/background-worker")'));
  assert(integrated.includes("UNBOUND_FUTURE_CORE_BACKGROUND_ENABLED"));
  assert(integrated.includes("UNBOUND_BACKGROUND_AGENT_SCHEDULER_ENABLED"));
  assert(integrated.includes("startFutureCoreBackgroundWorker({"));
  assert(integrated.includes("startBackgroundAgentScheduler({"));
  assert.strictEqual(integratePlatformParityServerSource(integrated), integrated);

  console.log("PASS platform parity wave 3: project memory, project-linked Future Core jobs, schedules, and separately gated background workers.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
