const crypto = require("crypto");
const { hydrateJob } = require("./state");
const { createModelTaskExecutor, runJobWave } = require("./runner");
const { saveJob } = require("./persistence");
const { buildProjectContext } = require("../platform/project-memory");

const DEFAULT_BACKGROUND_POLL_MS = 5000;
const MIN_BACKGROUND_POLL_MS = 2000;
const MAX_BACKGROUND_POLL_MS = 60000;
const CLAIM_TTL_SECONDS = 120;

function clamp(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

async function claimBackgroundJob(pool) {
  const client = await pool.connect();
  const token = crypto.randomUUID();
  try {
    await client.query("BEGIN");
    const selected = await client.query(
      `SELECT id, user_id, project_id, snapshot
       FROM future_core_jobs
       WHERE status IN ('planned', 'running')
         AND (
           worker_claimed_at IS NULL OR
           worker_claimed_at < NOW() - ($1::text || ' seconds')::interval
         )
       ORDER BY updated_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [CLAIM_TTL_SECONDS]
    );
    const row = selected.rows[0];
    if (!row) {
      await client.query("COMMIT");
      return null;
    }
    await client.query(
      `UPDATE future_core_jobs
       SET worker_claim_token = $1::uuid,
           worker_claimed_at = NOW(),
           updated_at = NOW()
       WHERE id = $2::uuid`,
      [token, row.id]
    );
    await client.query("COMMIT");
    return {
      id: String(row.id),
      userId: String(row.user_id),
      projectId: row.project_id ? String(row.project_id) : null,
      token,
      job: hydrateJob(row.snapshot)
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function releaseBackgroundClaim(pool, id, token) {
  await pool.query(
    `UPDATE future_core_jobs
     SET worker_claim_token = NULL,
         worker_claimed_at = NULL
     WHERE id = $1::uuid AND worker_claim_token = $2::uuid`,
    [id, token]
  );
}

async function processBackgroundJob({
  pool,
  claim,
  estimateProviderCostMicros = null
} = {}) {
  const job = claim.job;
  if (claim.projectId) {
    job.projectId = claim.projectId;
    job.projectContext = await buildProjectContext(
      pool,
      claim.userId,
      claim.projectId,
      job.objective
    );
  }
  const executor = createModelTaskExecutor({ estimateProviderCostMicros });
  const result = await runJobWave({ job, executeTaskImpl: executor });
  await saveJob(pool, claim.userId, job, { projectId: claim.projectId });
  await releaseBackgroundClaim(pool, claim.id, claim.token);
  return result;
}

async function processNextBackgroundJob({
  getPool,
  isDatabaseReady = () => true,
  estimateProviderCostMicros = null
} = {}) {
  if (!isDatabaseReady()) return { processed: 0 };
  const pool = typeof getPool === "function" ? getPool() : null;
  if (!pool) return { processed: 0 };
  const claim = await claimBackgroundJob(pool);
  if (!claim) return { processed: 0 };
  try {
    const result = await processBackgroundJob({ pool, claim, estimateProviderCostMicros });
    return { processed: 1, id: claim.id, status: result.job?.status || null };
  } catch (error) {
    await releaseBackgroundClaim(pool, claim.id, claim.token).catch(() => {});
    throw error;
  }
}

let timer = null;
let running = false;

function startFutureCoreBackgroundWorker({
  getPool,
  isDatabaseReady = () => true,
  estimateProviderCostMicros = null,
  env = process.env,
  onError = console.error
} = {}) {
  if (timer) return timer;
  const intervalMs = clamp(
    env.FUTURE_CORE_BACKGROUND_POLL_MS,
    DEFAULT_BACKGROUND_POLL_MS,
    MIN_BACKGROUND_POLL_MS,
    MAX_BACKGROUND_POLL_MS
  );

  const tick = async () => {
    if (running || !isDatabaseReady()) return;
    running = true;
    try {
      await processNextBackgroundJob({
        getPool,
        isDatabaseReady,
        estimateProviderCostMicros
      });
    } catch (error) {
      onError("UNBOUND FUTURE CORE BACKGROUND WORKER ERROR:", error);
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  const initial = setTimeout(() => void tick(), Math.min(intervalMs, 3000));
  initial.unref?.();
  return timer;
}

function stopFutureCoreBackgroundWorker() {
  if (!timer) return false;
  clearInterval(timer);
  timer = null;
  running = false;
  return true;
}

module.exports = {
  DEFAULT_BACKGROUND_POLL_MS,
  MIN_BACKGROUND_POLL_MS,
  MAX_BACKGROUND_POLL_MS,
  CLAIM_TTL_SECONDS,
  claimBackgroundJob,
  releaseBackgroundClaim,
  processBackgroundJob,
  processNextBackgroundJob,
  startFutureCoreBackgroundWorker,
  stopFutureCoreBackgroundWorker
};
