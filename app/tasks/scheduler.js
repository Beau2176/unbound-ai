const DEFAULT_POLL_INTERVAL_MS = 60 * 1000;
const MIN_POLL_INTERVAL_MS = 30 * 1000;
const MAX_POLL_INTERVAL_MS = 5 * 60 * 1000;
const MAX_DUE_BATCH = 50;
const MAX_TASKS_PER_USER = 50;
const MAX_SCHEDULE_YEARS = 5;

const RECURRENCES = Object.freeze(["once", "hourly", "daily", "weekly"]);

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeRecurrence(value) {
  const recurrence = String(value || "once").trim().toLowerCase();
  return RECURRENCES.includes(recurrence) ? recurrence : "once";
}

function recurrenceIntervalLimit(recurrence) {
  if (recurrence === "hourly") return 168;
  if (recurrence === "daily") return 365;
  if (recurrence === "weekly") return 104;
  return 1;
}

function normalizeScheduleDate(value, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error("Scheduled time is invalid.");
    error.code = "SCHEDULED_TASK_TIME_INVALID";
    error.statusCode = 400;
    error.publicMessage = "Choose a valid date and time.";
    throw error;
  }
  const minimum = now.getTime() + 30 * 1000;
  const maximum = new Date(now);
  maximum.setUTCFullYear(maximum.getUTCFullYear() + MAX_SCHEDULE_YEARS);
  if (date.getTime() < minimum) {
    const error = new Error("Scheduled time must be in the future.");
    error.code = "SCHEDULED_TASK_TIME_PAST";
    error.statusCode = 400;
    error.publicMessage = "Choose a time at least 30 seconds in the future.";
    throw error;
  }
  if (date.getTime() > maximum.getTime()) {
    const error = new Error("Scheduled time is too far in the future.");
    error.code = "SCHEDULED_TASK_TIME_TOO_FAR";
    error.statusCode = 400;
    error.publicMessage = `Choose a time within ${MAX_SCHEDULE_YEARS} years.`;
    throw error;
  }
  return date;
}

function normalizeTaskInput(body = {}, now = new Date()) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!title || title.length > 120) {
    const error = new Error("Task title must be between 1 and 120 characters.");
    error.code = "SCHEDULED_TASK_TITLE_INVALID";
    error.statusCode = 400;
    error.publicMessage = "Enter a reminder title up to 120 characters.";
    throw error;
  }
  if (note.length > 2000) {
    const error = new Error("Task note is too long.");
    error.code = "SCHEDULED_TASK_NOTE_TOO_LONG";
    error.statusCode = 400;
    error.publicMessage = "Keep the reminder note under 2,000 characters.";
    throw error;
  }

  const recurrence = normalizeRecurrence(body.recurrence);
  const intervalCount = clampInteger(
    body.intervalCount,
    1,
    1,
    recurrenceIntervalLimit(recurrence)
  );
  const runAt = normalizeScheduleDate(body.runAt, now);

  return {
    title,
    note,
    recurrence,
    intervalCount,
    runAt
  };
}

function nextRunAfter({ recurrence, intervalCount = 1, from = new Date() } = {}) {
  const normalized = normalizeRecurrence(recurrence);
  if (normalized === "once") return null;
  const count = clampInteger(intervalCount, 1, 1, recurrenceIntervalLimit(normalized));
  const next = new Date(from);
  if (normalized === "hourly") next.setTime(next.getTime() + count * 60 * 60 * 1000);
  if (normalized === "daily") next.setUTCDate(next.getUTCDate() + count);
  if (normalized === "weekly") next.setUTCDate(next.getUTCDate() + count * 7);
  return next;
}

function publicScheduledTask(row) {
  return {
    id: String(row.id),
    title: row.title,
    note: row.note || "",
    recurrence: normalizeRecurrence(row.recurrence),
    intervalCount: Number(row.interval_count || 1),
    nextRunAt: row.next_run_at || null,
    lastRunAt: row.last_run_at || null,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicTaskEvent(row) {
  return {
    id: String(row.id),
    taskId: row.task_id === null ? null : String(row.task_id),
    title: row.title,
    note: row.note || "",
    scheduledFor: row.scheduled_for,
    acknowledgedAt: row.acknowledged_at || null,
    createdAt: row.created_at
  };
}

async function runDueTasks({ getPool, now = new Date() } = {}) {
  if (typeof getPool !== "function") return { processed: 0 };
  const pool = getPool();
  if (!pool) return { processed: 0 };

  const client = await pool.connect();
  let processed = 0;
  try {
    await client.query("BEGIN");
    const due = await client.query(
      `SELECT id, user_id, title, note, recurrence, interval_count, next_run_at
       FROM scheduled_tasks
       WHERE enabled = TRUE
         AND next_run_at IS NOT NULL
         AND next_run_at <= $1
       ORDER BY next_run_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $2`,
      [now.toISOString(), MAX_DUE_BATCH]
    );

    for (const task of due.rows) {
      await client.query(
        `INSERT INTO scheduled_task_events (
           task_id, user_id, title, note, scheduled_for, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (task_id, scheduled_for) DO NOTHING`,
        [
          task.id,
          task.user_id,
          task.title,
          task.note || "",
          task.next_run_at,
          now.toISOString()
        ]
      );

      const next = nextRunAfter({
        recurrence: task.recurrence,
        intervalCount: task.interval_count,
        from: now
      });
      await client.query(
        `UPDATE scheduled_tasks
         SET last_run_at = $1,
             next_run_at = $2,
             enabled = $3,
             updated_at = $1
         WHERE id = $4`,
        [now.toISOString(), next ? next.toISOString() : null, Boolean(next), task.id]
      );
      processed += 1;
    }

    await client.query("COMMIT");
    return { processed };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

let workerTimer = null;
let workerRunning = false;

function startScheduledTaskWorker({
  getPool,
  isDatabaseReady = () => true,
  env = process.env,
  onError = console.error
} = {}) {
  if (workerTimer) return workerTimer;
  const intervalMs = clampInteger(
    env.SCHEDULED_TASK_POLL_MS,
    DEFAULT_POLL_INTERVAL_MS,
    MIN_POLL_INTERVAL_MS,
    MAX_POLL_INTERVAL_MS
  );

  const tick = async () => {
    if (workerRunning || !isDatabaseReady()) return;
    workerRunning = true;
    try {
      await runDueTasks({ getPool, now: new Date() });
    } catch (error) {
      onError("UNBOUND AI SCHEDULED TASK WORKER ERROR:", error);
    } finally {
      workerRunning = false;
    }
  };

  workerTimer = setInterval(() => void tick(), intervalMs);
  workerTimer.unref?.();
  const initial = setTimeout(() => void tick(), Math.min(5000, intervalMs));
  initial.unref?.();
  return workerTimer;
}

function stopScheduledTaskWorker() {
  if (!workerTimer) return false;
  clearInterval(workerTimer);
  workerTimer = null;
  workerRunning = false;
  return true;
}

module.exports = {
  DEFAULT_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  MAX_POLL_INTERVAL_MS,
  MAX_DUE_BATCH,
  MAX_TASKS_PER_USER,
  MAX_SCHEDULE_YEARS,
  RECURRENCES,
  clampInteger,
  normalizeRecurrence,
  normalizeScheduleDate,
  normalizeTaskInput,
  nextRunAfter,
  publicScheduledTask,
  publicTaskEvent,
  runDueTasks,
  startScheduledTaskWorker,
  stopScheduledTaskWorker
};
