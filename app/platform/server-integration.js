const INTEGRATION_VERSION = "v1.0";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error("Platform parity integration marker is missing: " + label + ".");
    error.code = "PLATFORM_PARITY_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error("Platform parity integration marker is ambiguous: " + label + ".");
    error.code = "PLATFORM_PARITY_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integratePlatformParityServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "PLATFORM_PARITY_SOURCE_EMPTY";
    throw error;
  }
  if (
    source.includes('createPlatformRouter({') &&
    source.includes("/api/platform") &&
    source.includes("UNBOUND_PLATFORM_PARITY_ENABLED") &&
    source.includes("CREATE TABLE IF NOT EXISTS ai_projects") &&
    source.includes("CREATE TABLE IF NOT EXISTS project_memories") &&
    source.includes("CREATE TABLE IF NOT EXISTS marketplace_skills") &&
    source.includes("CREATE TABLE IF NOT EXISTS marketplace_skill_installs")
  ) return source;

  const futureImport = 'const { createFutureCoreRouter } = require("./orchestration/routes");';
  source = replaceExactlyOnce(
    source,
    futureImport,
    futureImport +
      '\nconst { createPlatformRouter } = require("./platform/routes");' +
      '\nconst { startFutureCoreBackgroundWorker } = require("./orchestration/background-worker");' +
      '\nconst { startBackgroundAgentScheduler } = require("./platform/background-agent-scheduler");',
    "platform-import"
  );

  const futureIndex = [
    "CREATE INDEX IF NOT EXISTS future_core_jobs_status_idx",
    "      ON future_core_jobs(status, updated_at DESC);"
  ].join("\n");

  const schemaBlock = [
    futureIndex,
    "",
    "    CREATE TABLE IF NOT EXISTS ai_projects (",
    "      id UUID PRIMARY KEY,",
    "      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "      name TEXT NOT NULL,",
    "      description TEXT NOT NULL DEFAULT \'\',",
    "      status TEXT NOT NULL DEFAULT \'active\',",
    "      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),",
    "      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),",
    "      CONSTRAINT ai_projects_name_check CHECK (char_length(name) BETWEEN 1 AND 100),",
    "      CONSTRAINT ai_projects_status_check CHECK (status IN (\'active\', \'archived\'))",
    "    );",
    "",
    "    CREATE INDEX IF NOT EXISTS ai_projects_user_idx",
    "      ON ai_projects(user_id, updated_at DESC);",
    "",
    "    CREATE TABLE IF NOT EXISTS project_skill_settings (",
    "      project_id UUID NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,",
    "      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "      skill_id TEXT NOT NULL,",
    "      enabled BOOLEAN NOT NULL DEFAULT TRUE,",
    "      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),",
    "      PRIMARY KEY (project_id, skill_id)",
    "    );",
    "",
    "    CREATE INDEX IF NOT EXISTS project_skill_settings_user_idx",
    "      ON project_skill_settings(user_id, project_id, updated_at DESC);",
    "",
    "    CREATE TABLE IF NOT EXISTS vault_assets (",
    "      id UUID PRIMARY KEY,",
    "      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "      project_id UUID REFERENCES ai_projects(id) ON DELETE CASCADE,",
    "      name TEXT NOT NULL,",
    "      media_type TEXT NOT NULL DEFAULT \'application/octet-stream\',",
    "      bytes BIGINT NOT NULL DEFAULT 0,",
    "      storage_provider TEXT,",
    "      storage_state TEXT NOT NULL DEFAULT \'metadata_only\',",
    "      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),",
    "      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),",
    "      CONSTRAINT vault_assets_bytes_check CHECK (bytes >= 0),",
    "      CONSTRAINT vault_assets_state_check CHECK (storage_state IN (\'metadata_only\', \'awaiting_upload\', \'stored\', \'quarantined\', \'deleted\'))",
    "    );",
    "",
    "    CREATE INDEX IF NOT EXISTS vault_assets_user_project_idx",
    "      ON vault_assets(user_id, project_id, updated_at DESC);",
    "",
    "    CREATE TABLE IF NOT EXISTS coding_workspace_jobs (",
    "      id UUID PRIMARY KEY,",
    "      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "      project_id UUID REFERENCES ai_projects(id) ON DELETE SET NULL,",
    "      objective TEXT NOT NULL,",
    "      status TEXT NOT NULL,",
    "      provider_job_id TEXT,",
    "      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),",
    "      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),",
    "      completed_at TIMESTAMPTZ,",
    "      CONSTRAINT coding_workspace_jobs_status_check",
    "        CHECK (status IN (\'blocked_configuration\', \'queued\', \'running\', \'completed\', \'failed\', \'cancelled\'))",
    "    );",
    "",
    "    CREATE INDEX IF NOT EXISTS coding_workspace_jobs_user_idx",
    "      ON coding_workspace_jobs(user_id, updated_at DESC);",
    "",
    "    CREATE TABLE IF NOT EXISTS platform_audit_events (",
    "      id BIGSERIAL PRIMARY KEY,",
    "      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "      action TEXT NOT NULL,",
    "      details JSONB NOT NULL DEFAULT \'{}\'::jsonb,",
    "      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    "    );",
    "",
    "    CREATE INDEX IF NOT EXISTS platform_audit_events_user_idx",
    "      ON platform_audit_events(user_id, created_at DESC, id DESC);",
    "",
    "    ALTER TABLE future_core_jobs",
    "      ADD COLUMN IF NOT EXISTS project_id UUID;",
    "    ALTER TABLE future_core_jobs",
    "      ADD COLUMN IF NOT EXISTS worker_claim_token UUID;",
    "    ALTER TABLE future_core_jobs",
    "      ADD COLUMN IF NOT EXISTS worker_claimed_at TIMESTAMPTZ;",
    "",
    "    CREATE INDEX IF NOT EXISTS future_core_jobs_project_idx",
    "      ON future_core_jobs(user_id, project_id, updated_at DESC);",
    "    CREATE INDEX IF NOT EXISTS future_core_jobs_worker_claim_idx",
    "      ON future_core_jobs(status, worker_claimed_at, updated_at);",
    "",
    "    CREATE TABLE IF NOT EXISTS project_memories (",
    "      id BIGSERIAL PRIMARY KEY,",
    "      project_id UUID NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,",
    "      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "      content TEXT NOT NULL,",
    "      enabled BOOLEAN NOT NULL DEFAULT TRUE,",
    "      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),",
    "      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),",
    "      CONSTRAINT project_memories_content_check CHECK (char_length(content) BETWEEN 1 AND 1200)",
    "    );",
    "",
    "    CREATE INDEX IF NOT EXISTS project_memories_project_idx",
    "      ON project_memories(user_id, project_id, enabled, updated_at DESC, id DESC);",
    "",
    "    CREATE TABLE IF NOT EXISTS background_agent_schedules (",
    "      id BIGSERIAL PRIMARY KEY,",
    "      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "      project_id UUID REFERENCES ai_projects(id) ON DELETE CASCADE,",
    "      title TEXT NOT NULL,",
    "      objective TEXT NOT NULL,",
    "      recurrence TEXT NOT NULL DEFAULT 'once',",
    "      interval_count INTEGER NOT NULL DEFAULT 1,",
    "      allow_research BOOLEAN NOT NULL DEFAULT TRUE,",
    "      next_run_at TIMESTAMPTZ,",
    "      last_run_at TIMESTAMPTZ,",
    "      last_job_id UUID,",
    "      enabled BOOLEAN NOT NULL DEFAULT TRUE,",
    "      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),",
    "      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),",
    "      CONSTRAINT background_agent_recurrence_check CHECK (recurrence IN ('once','hourly','daily','weekly')),",
    "      CONSTRAINT background_agent_interval_check CHECK (interval_count BETWEEN 1 AND 365),",
    "      CONSTRAINT background_agent_objective_check CHECK (char_length(objective) BETWEEN 1 AND 8000)",
    "    );",
    "",
    "    CREATE INDEX IF NOT EXISTS background_agent_schedules_user_idx",
    "      ON background_agent_schedules(user_id, enabled, next_run_at);",
    "    CREATE INDEX IF NOT EXISTS background_agent_schedules_due_idx",
    "      ON background_agent_schedules(next_run_at, id)",
    "      WHERE enabled = TRUE AND next_run_at IS NOT NULL;"
  ].join("\n");

  source = replaceExactlyOnce(source, futureIndex, schemaBlock, "platform-schema");

  const agentWorker = [
    "startAgentWorker({",
    "  getPool: () => pool,",
    "  isDatabaseReady: () => databaseReady,",
    "  recordUsageEvent,",
    "  estimateProviderCostMicros",
    "});"
  ].join("\n");
  if (source.includes(agentWorker) && !source.includes("startFutureCoreBackgroundWorker({")) {
    const backgroundWorkers = [
      agentWorker,
      "if (String(process.env.UNBOUND_FUTURE_CORE_BACKGROUND_ENABLED || '').toLowerCase() === 'true') {",
      "  startFutureCoreBackgroundWorker({",
      "    getPool: () => pool,",
      "    isDatabaseReady: () => databaseReady,",
      "    estimateProviderCostMicros",
      "  });",
      "}",
      "if (String(process.env.UNBOUND_BACKGROUND_AGENT_SCHEDULER_ENABLED || '').toLowerCase() === 'true') {",
      "  startBackgroundAgentScheduler({",
      "    getPool: () => pool,",
      "    isDatabaseReady: () => databaseReady",
      "  });",
      "}"
    ].join("\n");
    source = replaceExactlyOnce(source, agentWorker, backgroundWorkers, "platform-background-workers");
  }

  const healthRoute = 'app.get("/api/health", (req, res) => {';
  const routeBlock = [
    "function requirePlatformParityEnabled(req, res, next) {",
    "  const enabled = String(process.env.UNBOUND_PLATFORM_PARITY_ENABLED || \'\').trim().toLowerCase() === \'true\';",
    "  if (!enabled) return res.status(404).json({ error: \'Not found.\' });",
    "  return next();",
    "}",
    "",
    "app.use(",
    "  \'/api/platform\',",
    "  requireDatabase,",
    "  requireSignedIn,",
    "  requireCapability(\'agents\'),",
    "  requirePlatformParityEnabled,",
    "  createPlatformRouter({",
    "    getPool: () => pool,",
    "    env: process.env",
    "  })",
    ");",
    "",
    healthRoute
  ].join("\n");

  source = replaceExactlyOnce(source, healthRoute, routeBlock, "platform-route-mount");
  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  integratePlatformParityServerSource
};
