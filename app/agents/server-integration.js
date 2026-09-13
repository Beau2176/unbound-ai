const INTEGRATION_VERSION = "v0.75";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Agent integration marker is missing: ${label}.`);
    error.code = "AGENT_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Agent integration marker is ambiguous: ${label}.`);
    error.code = "AGENT_SERVER_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integrateAgentServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "AGENT_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  const taskImports = `const {\n  createScheduledTasksRouter,\n  sendScheduledTasksPage\n} = require("./tasks/routes");\nconst { startScheduledTaskWorker } = require("./tasks/scheduler");`;
  source = replaceExactlyOnce(
    source,
    taskImports,
    `${taskImports}\nconst { createAgentRouter, sendAgentPage } = require("./agents/routes");\nconst { startAgentWorker } = require("./agents/runner");`,
    "agent-imports"
  );

  const tasksPage = `app.get(\n  "/tasks.html",\n  requireDatabase,\n  requireSignedIn,\n  requireCapability("monitoring"),\n  sendScheduledTasksPage\n);`;
  source = replaceExactlyOnce(
    source,
    tasksPage,
    `${tasksPage}\napp.get(\n  "/agents.html",\n  requireDatabase,\n  requireSignedIn,\n  requireCapability("agents"),\n  sendAgentPage\n);`,
    "agent-page-route"
  );

  const voiceRateLimit = `const voiceSessionRateLimit = rateLimitMiddleware({\n  policy: RATE_LIMIT_POLICY.voiceSessions,\n  subjectResolver: accountRateSubject\n});`;
  source = replaceExactlyOnce(
    source,
    voiceRateLimit,
    `${voiceRateLimit}\nconst agentRunRateLimit = rateLimitMiddleware({\n  policy: RATE_LIMIT_POLICY.agentRuns,\n  subjectResolver: accountRateSubject\n});`,
    "agent-rate-limit"
  );

  const taskEventIndex = `CREATE INDEX IF NOT EXISTS scheduled_task_events_user_idx\n      ON scheduled_task_events(user_id, acknowledged_at, created_at DESC);`;
  source = replaceExactlyOnce(
    source,
    taskEventIndex,
    `${taskEventIndex}\n\n    CREATE TABLE IF NOT EXISTS agent_runs (\n      id BIGSERIAL PRIMARY KEY,\n      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n      objective TEXT NOT NULL,\n      research_enabled BOOLEAN NOT NULL DEFAULT FALSE,\n      max_steps INTEGER NOT NULL DEFAULT 3,\n      completed_steps INTEGER NOT NULL DEFAULT 0,\n      status TEXT NOT NULL DEFAULT 'queued',\n      cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,\n      final_output TEXT NOT NULL DEFAULT '',\n      final_sources JSONB NOT NULL DEFAULT '[]'::jsonb,\n      error_public TEXT,\n      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n      started_at TIMESTAMPTZ,\n      completed_at TIMESTAMPTZ,\n      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n      CONSTRAINT agent_runs_steps_check CHECK (max_steps BETWEEN 1 AND 4),\n      CONSTRAINT agent_runs_completed_steps_check CHECK (completed_steps BETWEEN 0 AND 4),\n      CONSTRAINT agent_runs_status_check\n        CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled'))\n    );\n\n    CREATE INDEX IF NOT EXISTS agent_runs_user_idx\n      ON agent_runs(user_id, created_at DESC);\n\n    CREATE INDEX IF NOT EXISTS agent_runs_queue_idx\n      ON agent_runs(status, cancel_requested, created_at, id);\n\n    CREATE TABLE IF NOT EXISTS agent_steps (\n      id BIGSERIAL PRIMARY KEY,\n      run_id BIGINT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,\n      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n      step_number INTEGER NOT NULL,\n      output TEXT NOT NULL DEFAULT '',\n      provider TEXT,\n      model TEXT,\n      web_search_calls INTEGER NOT NULL DEFAULT 0,\n      sources JSONB NOT NULL DEFAULT '[]'::jsonb,\n      citations JSONB NOT NULL DEFAULT '[]'::jsonb,\n      usage JSONB,\n      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n      UNIQUE(run_id, step_number),\n      CONSTRAINT agent_steps_step_number_check CHECK (step_number BETWEEN 1 AND 4)\n    );\n\n    CREATE INDEX IF NOT EXISTS agent_steps_user_run_idx\n      ON agent_steps(user_id, run_id, step_number);`,
    "agent-schema"
  );

  const taskWorker = `startScheduledTaskWorker({\n  getPool: () => pool,\n  isDatabaseReady: () => databaseReady\n});`;
  source = replaceExactlyOnce(
    source,
    taskWorker,
    `${taskWorker}\nstartAgentWorker({\n  getPool: () => pool,\n  isDatabaseReady: () => databaseReady,\n  recordUsageEvent,\n  estimateProviderCostMicros\n});`,
    "agent-worker-start"
  );

  const healthRoute = `app.get("/api/health", (req, res) => {`;
  source = replaceExactlyOnce(
    source,
    healthRoute,
    `app.use(\n  "/api/agents",\n  requireDatabase,\n  requireSignedIn,\n  requireCapability("agents"),\n  createAgentRouter({\n    getPool: () => pool,\n    createRunRateLimit: agentRunRateLimit\n  })\n);\n\n${healthRoute}`,
    "agent-api-mount"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  integrateAgentServerSource
};
