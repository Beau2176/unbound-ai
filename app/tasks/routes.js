const express = require("express");
const path = require("path");
const {
  MAX_TASKS_PER_USER,
  normalizeTaskInput,
  publicScheduledTask,
  publicTaskEvent
} = require("./scheduler");

function validNumericId(value) {
  return /^\d+$/.test(String(value || "").trim());
}

function createScheduledTasksRouter({ getPool } = {}) {
  if (typeof getPool !== "function") {
    throw new Error("Scheduled tasks require a database pool provider.");
  }
  const router = express.Router();

  router.get("/", async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.query(
        `SELECT id, title, note, recurrence, interval_count, next_run_at,
                last_run_at, enabled, created_at, updated_at
         FROM scheduled_tasks
         WHERE user_id = $1
         ORDER BY enabled DESC, next_run_at ASC NULLS LAST, id DESC`,
        [req.user.id]
      );
      return res.json({ tasks: result.rows.map(publicScheduledTask) });
    } catch (error) {
      console.error("UNBOUND AI SCHEDULED TASK LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load scheduled tasks." });
    }
  });

  router.post("/", async (req, res) => {
    try {
      const input = normalizeTaskInput(req.body, new Date());
      const pool = getPool();
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS tasks
         FROM scheduled_tasks
         WHERE user_id = $1`,
        [req.user.id]
      );
      if (Number(countResult.rows[0]?.tasks || 0) >= MAX_TASKS_PER_USER) {
        return res.status(409).json({
          error: `You can keep up to ${MAX_TASKS_PER_USER} scheduled tasks at a time.`
        });
      }

      const result = await pool.query(
        `INSERT INTO scheduled_tasks (
           user_id, title, note, recurrence, interval_count, next_run_at,
           enabled, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW(), NOW())
         RETURNING id, title, note, recurrence, interval_count, next_run_at,
                   last_run_at, enabled, created_at, updated_at`,
        [
          req.user.id,
          input.title,
          input.note,
          input.recurrence,
          input.intervalCount,
          input.runAt.toISOString()
        ]
      );
      return res.status(201).json({ task: publicScheduledTask(result.rows[0]) });
    } catch (error) {
      if (String(error?.code || "").startsWith("SCHEDULED_TASK_")) {
        return res.status(Number(error.statusCode) || 400).json({
          error: error.publicMessage || "The scheduled task is invalid.",
          code: error.code
        });
      }
      console.error("UNBOUND AI SCHEDULED TASK CREATE ERROR:", error);
      return res.status(500).json({ error: "Could not create that scheduled task." });
    }
  });

  router.put("/:id", async (req, res) => {
    const taskId = String(req.params.id || "").trim();
    if (!validNumericId(taskId)) {
      return res.status(400).json({ error: "Invalid task ID." });
    }
    try {
      const input = normalizeTaskInput(req.body, new Date());
      const result = await getPool().query(
        `UPDATE scheduled_tasks
         SET title = $1,
             note = $2,
             recurrence = $3,
             interval_count = $4,
             next_run_at = $5,
             enabled = TRUE,
             updated_at = NOW()
         WHERE id = $6 AND user_id = $7
         RETURNING id, title, note, recurrence, interval_count, next_run_at,
                   last_run_at, enabled, created_at, updated_at`,
        [
          input.title,
          input.note,
          input.recurrence,
          input.intervalCount,
          input.runAt.toISOString(),
          taskId,
          req.user.id
        ]
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Scheduled task not found." });
      return res.json({ task: publicScheduledTask(result.rows[0]) });
    } catch (error) {
      if (String(error?.code || "").startsWith("SCHEDULED_TASK_")) {
        return res.status(Number(error.statusCode) || 400).json({
          error: error.publicMessage || "The scheduled task is invalid.",
          code: error.code
        });
      }
      console.error("UNBOUND AI SCHEDULED TASK UPDATE ERROR:", error);
      return res.status(500).json({ error: "Could not update that scheduled task." });
    }
  });

  router.post("/:id/toggle", async (req, res) => {
    const taskId = String(req.params.id || "").trim();
    if (!validNumericId(taskId)) return res.status(400).json({ error: "Invalid task ID." });
    if (typeof req.body?.enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be true or false." });
    }
    try {
      const result = await getPool().query(
        `UPDATE scheduled_tasks
         SET enabled = $1,
             updated_at = NOW()
         WHERE id = $2 AND user_id = $3
           AND ($1 = FALSE OR next_run_at IS NOT NULL)
         RETURNING id, title, note, recurrence, interval_count, next_run_at,
                   last_run_at, enabled, created_at, updated_at`,
        [req.body.enabled, taskId, req.user.id]
      );
      if (!result.rows[0]) {
        return res.status(409).json({
          error: req.body.enabled
            ? "This completed one-time task must be rescheduled before it can be enabled."
            : "Scheduled task not found."
        });
      }
      return res.json({ task: publicScheduledTask(result.rows[0]) });
    } catch (error) {
      console.error("UNBOUND AI SCHEDULED TASK TOGGLE ERROR:", error);
      return res.status(500).json({ error: "Could not change that scheduled task." });
    }
  });

  router.delete("/:id", async (req, res) => {
    const taskId = String(req.params.id || "").trim();
    if (!validNumericId(taskId)) return res.status(400).json({ error: "Invalid task ID." });
    try {
      const result = await getPool().query(
        `DELETE FROM scheduled_tasks
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [taskId, req.user.id]
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Scheduled task not found." });
      return res.json({ ok: true, id: taskId });
    } catch (error) {
      console.error("UNBOUND AI SCHEDULED TASK DELETE ERROR:", error);
      return res.status(500).json({ error: "Could not delete that scheduled task." });
    }
  });

  router.get("/events/recent", async (req, res) => {
    try {
      const unreadOnly = String(req.query.unread || "").trim() === "1";
      const result = await getPool().query(
        `SELECT id, task_id, title, note, scheduled_for, acknowledged_at, created_at
         FROM scheduled_task_events
         WHERE user_id = $1
           AND ($2::boolean = FALSE OR acknowledged_at IS NULL)
         ORDER BY created_at DESC, id DESC
         LIMIT 100`,
        [req.user.id, unreadOnly]
      );
      return res.json({ events: result.rows.map(publicTaskEvent) });
    } catch (error) {
      console.error("UNBOUND AI SCHEDULED TASK EVENT LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load reminder events." });
    }
  });

  router.post("/events/:id/ack", async (req, res) => {
    const eventId = String(req.params.id || "").trim();
    if (!validNumericId(eventId)) return res.status(400).json({ error: "Invalid reminder event ID." });
    try {
      const result = await getPool().query(
        `UPDATE scheduled_task_events
         SET acknowledged_at = COALESCE(acknowledged_at, NOW())
         WHERE id = $1 AND user_id = $2
         RETURNING id, task_id, title, note, scheduled_for, acknowledged_at, created_at`,
        [eventId, req.user.id]
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Reminder event not found." });
      return res.json({ event: publicTaskEvent(result.rows[0]) });
    } catch (error) {
      console.error("UNBOUND AI SCHEDULED TASK ACK ERROR:", error);
      return res.status(500).json({ error: "Could not acknowledge that reminder." });
    }
  });

  return router;
}

function sendScheduledTasksPage(req, res) {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "..", "tasks.html"));
}

module.exports = {
  validNumericId,
  createScheduledTasksRouter,
  sendScheduledTasksPage
};
