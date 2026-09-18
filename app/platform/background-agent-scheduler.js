const crypto = require("crypto");
const { buildFuturePlan } = require("../orchestration/planner");
const { createJobState } = require("../orchestration/state");
const { saveJob } = require("../orchestration/persistence");
const { buildProjectContext } = require("./project-memory");
const { normalizeRecurrence, nextRunAfter, clampInteger } = require("../tasks/scheduler");

const MAX_AGENT_SCHEDULES_PER_USER = 50;
const MAX_AGENT_OBJECTIVE_CHARS = 8000;
const MAX_DUE_AGENT_SCHEDULES = 20;

function normalizeAgentScheduleInput(body = {}, now = new Date()) {
  const title = String(body.title || "").trim().slice(0, 120);
  const objective = String(body.objective || "").trim();
  if (!title) {
    const error = new Error("Schedule title is required.");
    error.code = "AGENT_SCHEDULE_TITLE_REQUIRED";
    error.statusCode = 400;
    throw error;
  }
  if (!objective || objective.length > MAX_AGENT_OBJECTIVE_CHARS) {
    const error = new Error("Scheduled Agent objective is invalid.");
    error.code = "AGENT_SCHEDULE_OBJECTIVE_INVALID";
    error.statusCode = 400;
    throw error;
  }
  const recurrence = normalizeRecurrence(body.recurrence);
  if (recurrence === "once" && body.recurrence && String(body.recurrence).toLowerCase() !== "once") {
    const error = new Error("Scheduled Agent recurrence is invalid.");
    error.code = "AGENT_SCHEDULE_RECURRENCE_INVALID";
    error.statusCode = 400;
    throw error;
  }
  const intervalCount = clampInteger(body.intervalCount, 1, 1, 365);
  const runAt = new Date(body.runAt);
  if (!Number.isFinite(runAt.getTime()) || runAt.getTime() < now.getTime() + 30000) {
    const error = new Error("Scheduled Agent run time must be at least 30 seconds in the future.");
    error.code = "AGENT_SCHEDULE_TIME_INVALID";
    error.statusCode = 400;
    throw error;
  }
  return {
    title,
    objective,
    recurrence,
    intervalCount,
    runAt,
    projectId: body.projectId ? String(body.projectId).trim() : null,
    allowResearch: body.allowResearch !== false
  };
}

function publicAgentSchedule(row) {
  return {
    id: String(row.id),
    projectId: row.project_id ? String(row.project_id) : null,
    title: row.title,
    objective: row.objective,
    recurrence: row.recurrence,
    intervalCount: Number(row.interval_count || 1),
    allowResearch: Boolean(row.allow_research),
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at || null,
    lastJobId: row.last_job_id ? String(row.last_job_id) : null,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function createScheduledFutureCoreJob(pool, schedule, now = new Date()) {
  const plan = buildFuturePlan(schedule.objective, {
    allowResearch: Boolean(schedule.allow_research),
    allowExternalActions: false
  });
  const job = createJobState({
    id: crypto.randomUUID(),
    userId: schedule.user_id,
    plan
  });
  job.projectId = schedule.project_id ? String(schedule.project_id) : null;
  job.trigger = {
    type: "schedule",
    scheduleId: String(schedule.id),
    scheduledFor: String(schedule.next_run_at)
  };
  if (job.projectId) {
    job.projectContext = await buildProjectContext(
      pool,
      schedule.user_id,
      job.projectId,
      job.objective
    );
  }
  await saveJob(pool, schedule.user_id, job, { projectId: job.projectId });
  return job;
}

async function runDueAgentSchedules({ getPool, now = new Date() } = {}) {
  const pool = typeof getPool === "function" ? getPool() : null;
  if (!pool) return { processed: 0, jobs: [] };
  const client = await pool.connect();
  const jobs = [];
  try {
    await client.query("BEGIN");
    const due = await client.query(
      `SELECT id, user_id, project_id, title, objective, recurrence,
              interval_count, allow_research, next_run_at
       FROM background_agent_schedules
       WHERE enabled = TRUE
         AND next_run_at IS NOT NULL
         AND next_run_at <= $1::timestamptz
       ORDER BY next_run_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $2`,
      [now.toISOString(), MAX_DUE_AGENT_SCHEDULES]
    );

    for (const schedule of due.rows) {
      const job = await createScheduledFutureCoreJob(client, schedule, now);
      const next = nextRunAfter({
        recurrence: schedule.recurrence,
        intervalCount: schedule.interval_count,
        from: now
      });
      await client.query(
        `UPDATE background_agent_schedules
         SET last_run_at = $1::timestamptz,
             last_job_id = $2::uuid,
             next_run_at = $3::timestamptz,
             enabled = $4,
             updated_at = NOW()
         WHERE id = $5`,
        [
          now.toISOString(),
          job.id,
          next ? next.toISOString() : null,
          Boolean(next),
          schedule.id
        ]
      );
      jobs.push(job.id);
    }

    await client.query("COMMIT");
    return { processed: due.rows.length, jobs };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

let timer = null;
let running = false;

function startBackgroundAgentScheduler({
  getPool,
  isDatabaseReady = () => true,
  env = process.env,
  onError = console.error
} = {}) {
  if (timer) return timer;
  const intervalMs = clampInteger(
    env.BACKGROUND_AGENT_SCHEDULE_POLL_MS,
    15000,
    5000,
    60000
  );
  const tick = async () => {
    if (running || !isDatabaseReady()) return;
    running = true;
    try {
      await runDueAgentSchedules({ getPool, now: new Date() });
    } catch (error) {
      onError("UNBOUND BACKGROUND AGENT SCHEDULER ERROR:", error);
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  const initial = setTimeout(() => void tick(), Math.min(intervalMs, 5000));
  initial.unref?.();
  return timer;
}

function stopBackgroundAgentScheduler() {
  if (!timer) return false;
  clearInterval(timer);
  timer = null;
  running = false;
  return true;
}

module.exports = {
  MAX_AGENT_SCHEDULES_PER_USER,
  MAX_AGENT_OBJECTIVE_CHARS,
  MAX_DUE_AGENT_SCHEDULES,
  normalizeAgentScheduleInput,
  publicAgentSchedule,
  createScheduledFutureCoreJob,
  runDueAgentSchedules,
  startBackgroundAgentScheduler,
  stopBackgroundAgentScheduler
};
