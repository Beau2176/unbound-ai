const express = require("express");
const path = require("path");
const {
  MAX_ACTIVE_RUNS_PER_USER,
  MAX_AGENT_HISTORY_PER_USER,
  normalizeAgentInput,
  publicAgentRun,
  publicAgentStep
} = require("./runner");

function validNumericId(value) {
  return /^\d+$/.test(String(value || "").trim());
}

function passthrough(req, res, next) {
  return next();
}

function createAgentRouter({ getPool, createRunRateLimit = passthrough } = {}) {
  if (typeof getPool !== "function") {
    throw new Error("Agents require a database pool provider.");
  }
  if (typeof createRunRateLimit !== "function") {
    throw new Error("Agent creation rate limiter must be middleware.");
  }
  const router = express.Router();

  router.get("/runs", async (req, res) => {
    try {
      const result = await getPool().query(
        `SELECT id, objective, research_enabled, max_steps, completed_steps,
                status, cancel_requested, final_output, final_sources,
                error_public, created_at, started_at, completed_at, updated_at
         FROM agent_runs
         WHERE user_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        [req.user.id, MAX_AGENT_HISTORY_PER_USER]
      );
      return res.json({ runs: result.rows.map(publicAgentRun) });
    } catch (error) {
      console.error("UNBOUND AI AGENT LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load Agent runs." });
    }
  });

  router.get("/runs/:id", async (req, res) => {
    const runId = String(req.params.id || "").trim();
    if (!validNumericId(runId)) return res.status(400).json({ error: "Invalid Agent run ID." });
    try {
      const pool = getPool();
      const [runResult, stepsResult] = await Promise.all([
        pool.query(
          `SELECT id, objective, research_enabled, max_steps, completed_steps,
                  status, cancel_requested, final_output, final_sources,
                  error_public, created_at, started_at, completed_at, updated_at
           FROM agent_runs
           WHERE id = $1 AND user_id = $2
           LIMIT 1`,
          [runId, req.user.id]
        ),
        pool.query(
          `SELECT id, run_id, step_number, output, provider, model,
                  web_search_calls, sources, created_at
           FROM agent_steps
           WHERE run_id = $1 AND user_id = $2
           ORDER BY step_number ASC`,
          [runId, req.user.id]
        )
      ]);
      if (!runResult.rows[0]) return res.status(404).json({ error: "Agent run not found." });
      return res.json({ run: publicAgentRun(runResult.rows[0]), steps: stepsResult.rows.map(publicAgentStep) });
    } catch (error) {
      console.error("UNBOUND AI AGENT DETAIL ERROR:", error);
      return res.status(500).json({ error: "Could not load that Agent run." });
    }
  });

  router.post("/runs", createRunRateLimit, async (req, res) => {
    try {
      const input = normalizeAgentInput(req.body);
      const pool = getPool();
      const activeResult = await pool.query(
        `SELECT COUNT(*)::int AS active
         FROM agent_runs
         WHERE user_id = $1
           AND status IN ('queued', 'running')`,
        [req.user.id]
      );
      if (Number(activeResult.rows[0]?.active || 0) >= MAX_ACTIVE_RUNS_PER_USER) {
        return res.status(409).json({ error: `You can have up to ${MAX_ACTIVE_RUNS_PER_USER} queued or running Agent jobs at once.` });
      }

      await pool.query(
        `DELETE FROM agent_runs
         WHERE id IN (
           SELECT id FROM agent_runs
           WHERE user_id = $1 AND status IN ('completed', 'failed', 'cancelled')
           ORDER BY created_at DESC, id DESC
           OFFSET $2
         )`,
        [req.user.id, MAX_AGENT_HISTORY_PER_USER - 1]
      );

      const result = await pool.query(
        `INSERT INTO agent_runs (
           user_id, objective, research_enabled, max_steps, completed_steps,
           status, cancel_requested, final_output, final_sources,
           created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, 0, 'queued', FALSE, '', '[]'::jsonb, NOW(), NOW())
         RETURNING id, objective, research_enabled, max_steps, completed_steps,
                   status, cancel_requested, final_output, final_sources,
                   error_public, created_at, started_at, completed_at, updated_at`,
        [req.user.id, input.objective, input.research, input.maxSteps]
      );
      return res.status(202).json({ run: publicAgentRun(result.rows[0]) });
    } catch (error) {
      if (String(error?.code || "").startsWith("AGENT_")) {
        return res.status(Number(error.statusCode) || 400).json({ error: error.publicMessage || "The Agent run is invalid.", code: error.code });
      }
      console.error("UNBOUND AI AGENT CREATE ERROR:", error);
      return res.status(500).json({ error: "Could not create that Agent run." });
    }
  });

  router.post("/runs/:id/cancel", async (req, res) => {
    const runId = String(req.params.id || "").trim();
    if (!validNumericId(runId)) return res.status(400).json({ error: "Invalid Agent run ID." });
    try {
      const result = await getPool().query(
        `UPDATE agent_runs
         SET cancel_requested = TRUE,
             status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
             completed_at = CASE WHEN status = 'queued' THEN NOW() ELSE completed_at END,
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND status IN ('queued', 'running')
         RETURNING id, objective, research_enabled, max_steps, completed_steps,
                   status, cancel_requested, final_output, final_sources,
                   error_public, created_at, started_at, completed_at, updated_at`,
        [runId, req.user.id]
      );
      if (!result.rows[0]) return res.status(409).json({ error: "That Agent run is already finished or was not found." });
      return res.json({ run: publicAgentRun(result.rows[0]) });
    } catch (error) {
      console.error("UNBOUND AI AGENT CANCEL ERROR:", error);
      return res.status(500).json({ error: "Could not cancel that Agent run." });
    }
  });

  router.delete("/runs/:id", async (req, res) => {
    const runId = String(req.params.id || "").trim();
    if (!validNumericId(runId)) return res.status(400).json({ error: "Invalid Agent run ID." });
    try {
      const result = await getPool().query(
        `DELETE FROM agent_runs
         WHERE id = $1 AND user_id = $2 AND status IN ('completed', 'failed', 'cancelled')
         RETURNING id`,
        [runId, req.user.id]
      );
      if (!result.rows[0]) return res.status(409).json({ error: "Only finished Agent runs can be deleted." });
      return res.json({ ok: true, id: runId });
    } catch (error) {
      console.error("UNBOUND AI AGENT DELETE ERROR:", error);
      return res.status(500).json({ error: "Could not delete that Agent run." });
    }
  });

  return router;
}

function sendAgentPage(req, res) {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "..", "agents.html"));
}

module.exports = { validNumericId, passthrough, createAgentRouter, sendAgentPage };
