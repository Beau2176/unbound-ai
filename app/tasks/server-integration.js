const INTEGRATION_VERSION = "v0.73";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Scheduled-task integration marker is missing: ${label}.`);
    error.code = "SCHEDULED_TASK_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Scheduled-task integration marker is ambiguous: ${label}.`);
    error.code = "SCHEDULED_TASK_SERVER_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integrateScheduledTasksServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "SCHEDULED_TASK_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  const commandCenterImport = `const {\n  createCommandCenterRouter,\n  sendCommandCenterPage\n} = require("./command-center/routes");`;
  source = replaceExactlyOnce(
    source,
    commandCenterImport,
    `${commandCenterImport}\nconst {\n  createScheduledTasksRouter,\n  sendScheduledTasksPage\n} = require("./tasks/routes");\nconst { startScheduledTaskWorker } = require("./tasks/scheduler");`,
    "scheduled-task-imports"
  );

  const commandCenterPage = `app.get(\n  "/command-center.html",\n  requireDatabase,\n  requireSignedIn,\n  requireCapability("command_center"),\n  sendCommandCenterPage\n);`;
  source = replaceExactlyOnce(
    source,
    commandCenterPage,
    `${commandCenterPage}\napp.get(\n  "/tasks.html",\n  requireDatabase,\n  requireSignedIn,\n  requireCapability("monitoring"),\n  sendScheduledTasksPage\n);`,
    "scheduled-task-page-route"
  );

  const usageIndex = `CREATE INDEX IF NOT EXISTS usage_events_provider_model_idx\n      ON usage_events(provider, model);`;
  source = replaceExactlyOnce(
    source,
    usageIndex,
    `${usageIndex}\n\n    CREATE TABLE IF NOT EXISTS scheduled_tasks (\n      id BIGSERIAL PRIMARY KEY,\n      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n      title TEXT NOT NULL,\n      note TEXT NOT NULL DEFAULT '',\n      recurrence TEXT NOT NULL DEFAULT 'once',\n      interval_count INTEGER NOT NULL DEFAULT 1,\n      next_run_at TIMESTAMPTZ,\n      last_run_at TIMESTAMPTZ,\n      enabled BOOLEAN NOT NULL DEFAULT TRUE,\n      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n      CONSTRAINT scheduled_tasks_recurrence_check\n        CHECK (recurrence IN ('once', 'hourly', 'daily', 'weekly')),\n      CONSTRAINT scheduled_tasks_interval_check\n        CHECK (interval_count BETWEEN 1 AND 365)\n    );\n\n    CREATE INDEX IF NOT EXISTS scheduled_tasks_user_idx\n      ON scheduled_tasks(user_id, enabled, next_run_at);\n\n    CREATE INDEX IF NOT EXISTS scheduled_tasks_due_idx\n      ON scheduled_tasks(next_run_at, id)\n      WHERE enabled = TRUE AND next_run_at IS NOT NULL;\n\n    CREATE TABLE IF NOT EXISTS scheduled_task_events (\n      id BIGSERIAL PRIMARY KEY,\n      task_id BIGINT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,\n      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n      title TEXT NOT NULL,\n      note TEXT NOT NULL DEFAULT '',\n      scheduled_for TIMESTAMPTZ NOT NULL,\n      acknowledged_at TIMESTAMPTZ,\n      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n      UNIQUE(task_id, scheduled_for)\n    );\n\n    CREATE INDEX IF NOT EXISTS scheduled_task_events_user_idx\n      ON scheduled_task_events(user_id, acknowledged_at, created_at DESC);`,
    "scheduled-task-schema"
  );

  const startupAnchor = `if (!databaseReady && process.env.DATABASE_URL) {\n    scheduleDatabaseInitialization("initialization-failure");\n  }\n}\n\nvoid initializeDatabaseWithRetry();\n\nfunction requireDatabase(req, res, next) {`;
  source = replaceExactlyOnce(
    source,
    startupAnchor,
    `if (!databaseReady && process.env.DATABASE_URL) {\n    scheduleDatabaseInitialization("initialization-failure");\n  }\n}\n\nvoid initializeDatabaseWithRetry();\nstartScheduledTaskWorker({\n  getPool: () => pool,\n  isDatabaseReady: () => databaseReady\n});\n\nfunction requireDatabase(req, res, next) {`,
    "scheduled-task-worker-start"
  );

  const healthRoute = `app.get("/api/health", (req, res) => {`;
  source = replaceExactlyOnce(
    source,
    healthRoute,
    `app.use(\n  "/api/tasks",\n  requireDatabase,\n  requireSignedIn,\n  requireCapability("monitoring"),\n  createScheduledTasksRouter({\n    getPool: () => pool\n  })\n);\n\n${healthRoute}`,
    "scheduled-task-api-mount"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  integrateScheduledTasksServerSource
};
