const { hydrateJob } = require("./state");

const FUTURE_CORE_SCHEMA_SQL = [
  "CREATE TABLE IF NOT EXISTS future_core_jobs (",
  "  id UUID PRIMARY KEY,",
  "  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
  "  objective TEXT NOT NULL,",
  "  intent TEXT NOT NULL DEFAULT 'general',",
  "  status TEXT NOT NULL DEFAULT 'planned',",
  "  snapshot JSONB NOT NULL,",
  "  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),",
  "  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),",
  "  completed_at TIMESTAMPTZ",
  ");",
  "CREATE INDEX IF NOT EXISTS future_core_jobs_user_idx",
  "  ON future_core_jobs(user_id, updated_at DESC);",
  "CREATE INDEX IF NOT EXISTS future_core_jobs_status_idx",
  "  ON future_core_jobs(status, updated_at DESC);"
].join("\n");

async function saveJob(pool, userId, job, { projectId = job?.projectId || null } = {}) {
  const result = await pool.query(
    `INSERT INTO future_core_jobs (
       id, user_id, project_id, objective, intent, status, snapshot,
       created_at, updated_at, completed_at
     )
     VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7::jsonb, $8::timestamptz, $9::timestamptz, $10::timestamptz)
     ON CONFLICT (id) DO UPDATE SET
       project_id = EXCLUDED.project_id,
       objective = EXCLUDED.objective,
       intent = EXCLUDED.intent,
       status = EXCLUDED.status,
       snapshot = EXCLUDED.snapshot,
       updated_at = EXCLUDED.updated_at,
       completed_at = EXCLUDED.completed_at
     WHERE future_core_jobs.user_id = EXCLUDED.user_id
     RETURNING id, status, snapshot, created_at, updated_at, completed_at`,
    [
      job.id,
      userId,
      projectId,
      job.objective,
      job.intent || "general",
      job.status,
      JSON.stringify(job),
      job.createdAt,
      job.updatedAt,
      job.completedAt
    ]
  );
  return result.rows[0] ? hydrateJob(result.rows[0].snapshot) : null;
}

async function loadJob(pool, userId, jobId) {
  const result = await pool.query(
    `SELECT snapshot
     FROM future_core_jobs
     WHERE id = $1::uuid AND user_id = $2
     LIMIT 1`,
    [jobId, userId]
  );
  return result.rows[0] ? hydrateJob(result.rows[0].snapshot) : null;
}

async function listJobs(pool, userId, limit = 50) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const result = await pool.query(
    `SELECT snapshot
     FROM future_core_jobs
     WHERE user_id = $1
     ORDER BY updated_at DESC
     LIMIT $2`,
    [userId, safeLimit]
  );
  return result.rows.map((row) => hydrateJob(row.snapshot));
}

async function deleteFinishedJob(pool, userId, jobId) {
  const result = await pool.query(
    `DELETE FROM future_core_jobs
     WHERE id = $1::uuid
       AND user_id = $2
       AND status IN ('completed', 'failed', 'cancelled')
     RETURNING id`,
    [jobId, userId]
  );
  return Boolean(result.rows[0]);
}

module.exports = {
  FUTURE_CORE_SCHEMA_SQL,
  saveJob,
  loadJob,
  listJobs,
  deleteFinishedJob
};
