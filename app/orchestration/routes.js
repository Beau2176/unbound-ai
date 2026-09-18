const express = require("express");
const { buildFuturePlan } = require("./planner");
const {
  createJobState,
  approveTask,
  cancelJob
} = require("./state");
const {
  createModelTaskExecutor,
  runJobWave
} = require("./runner");
const {
  saveJob,
  loadJob,
  listJobs,
  deleteFinishedJob
} = require("./persistence");
const { publicRegistry } = require("./registry");
const { buildProjectContext } = require("../platform/project-memory");
const {
  ensurePlanSupportedByTeam,
  teamSnapshot
} = require("./teams");

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function createFutureCoreRouter({
  getPool,
  estimateProviderCostMicros = null,
  executeTaskImpl = null
} = {}) {
  if (typeof getPool !== "function") throw new Error("Future Core v2 requires a database pool provider.");
  const router = express.Router();

  router.get("/status", (req, res) => {
    return res.json({
      staged: false,
      enabled: true,
      version: "v2.1",
      registry: publicRegistry()
    });
  });

  router.post("/plan", (req, res) => {
    try {
      const plan = buildFuturePlan(req.body?.objective, {
        allowResearch: req.body?.allowResearch !== false,
        allowExternalActions: Boolean(req.body?.allowExternalActions)
      });
      return res.json({ plan });
    } catch (error) {
      if (String(error?.code || "").startsWith("FUTURE_CORE_")) {
        return res.status(Number(error.statusCode) || 400).json({ error: error.publicMessage || error.message, code: error.code });
      }
      return res.status(500).json({ error: "Could not create that Future Core plan." });
    }
  });

  router.get("/jobs", async (req, res) => {
    try {
      return res.json({ jobs: await listJobs(getPool(), req.user.id) });
    } catch (error) {
      console.error("UNBOUND FUTURE CORE LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load Future Core jobs." });
    }
  });

  router.post("/jobs", async (req, res) => {
    try {
      const pool = getPool();
      const projectId = req.body?.projectId ? String(req.body.projectId).trim() : null;
      const teamId = req.body?.teamId ? String(req.body.teamId).trim() : null;
      if (projectId && !validUuid(projectId)) {
        return res.status(400).json({ error: "Invalid project ID." });
      }
      if (teamId && !validUuid(teamId)) {
        return res.status(400).json({ error: "Invalid Agent team ID." });
      }
      if (projectId) {
        const project = await pool.query(
          "SELECT id FROM ai_projects WHERE id = $1::uuid AND user_id = $2 LIMIT 1",
          [projectId, req.user.id]
        );
        if (!project.rows[0]) return res.status(404).json({ error: "Project not found." });
      }

      let team = null;
      if (teamId) {
        const selected = await pool.query(
          `SELECT id, project_id, name, description, roles, active, created_at, updated_at
           FROM agent_teams
           WHERE id = $1::uuid AND user_id = $2 AND active = TRUE
           LIMIT 1`,
          [teamId, req.user.id]
        );
        team = selected.rows[0] || null;
        if (!team) return res.status(404).json({ error: "Agent team not found." });
        if (team.project_id && String(team.project_id) !== String(projectId || "")) {
          return res.status(409).json({
            error: "That Agent team belongs to a different project.",
            code: "FUTURE_CORE_TEAM_PROJECT_MISMATCH"
          });
        }
      }

      const plan = buildFuturePlan(req.body?.objective, {
        allowResearch: req.body?.allowResearch !== false,
        allowExternalActions: Boolean(req.body?.allowExternalActions)
      });
      if (team) ensurePlanSupportedByTeam(plan, team.roles);

      const job = createJobState({
        userId: req.user.id,
        plan,
        budget: req.body?.budget || {}
      });
      job.projectId = projectId;
      job.teamId = teamId;
      job.team = team ? teamSnapshot(team) : null;
      job.background = Boolean(req.body?.background);
      if (projectId) {
        job.projectContext = await buildProjectContext(pool, req.user.id, projectId, job.objective);
      }
      await saveJob(pool, req.user.id, job, { projectId });
      return res.status(201).json({ job });
    } catch (error) {
      if (String(error?.code || "").startsWith("FUTURE_CORE_")) {
        return res.status(Number(error.statusCode) || 400).json({
          error: error.publicMessage || error.message,
          code: error.code,
          missingSpecialists: error.missingSpecialists || undefined
        });
      }
      console.error("UNBOUND FUTURE CORE CREATE ERROR:", error);
      return res.status(500).json({ error: "Could not create that Future Core job." });
    }
  });

  router.get("/jobs/:id", async (req, res) => {
    if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid Future Core job ID." });
    try {
      const job = await loadJob(getPool(), req.user.id, req.params.id);
      if (!job) return res.status(404).json({ error: "Future Core job not found." });
      return res.json({ job });
    } catch (error) {
      console.error("UNBOUND FUTURE CORE DETAIL ERROR:", error);
      return res.status(500).json({ error: "Could not load that Future Core job." });
    }
  });

  router.post("/jobs/:id/run", async (req, res) => {
    if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid Future Core job ID." });
    try {
      const pool = getPool();
      const job = await loadJob(pool, req.user.id, req.params.id);
      if (!job) return res.status(404).json({ error: "Future Core job not found." });
      if (job.background) {
        return res.status(409).json({
          error: "This Future Core job is managed by the background worker.",
          code: "FUTURE_CORE_BACKGROUND_MANAGED"
        });
      }

      if (job.projectId) {
        job.projectContext = await buildProjectContext(pool, req.user.id, job.projectId, job.objective);
      }
      const executor = executeTaskImpl || createModelTaskExecutor({ estimateProviderCostMicros });
      const result = await runJobWave({ job, executeTaskImpl: executor });
      await saveJob(pool, req.user.id, job, { projectId: job.projectId || null });
      return res.json(result);
    } catch (error) {
      console.error("UNBOUND FUTURE CORE RUN ERROR:", error);
      return res.status(500).json({
        error: error?.publicMessage || "Could not run that Future Core job.",
        code: error?.code || null
      });
    }
  });

  router.post("/jobs/:id/tasks/:taskId/approve", async (req, res) => {
    if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid Future Core job ID." });
    try {
      const pool = getPool();
      const job = await loadJob(pool, req.user.id, req.params.id);
      if (!job) return res.status(404).json({ error: "Future Core job not found." });
      approveTask(job, req.params.taskId, `user:${req.user.id}`);
      await saveJob(pool, req.user.id, job);
      return res.json({ job });
    } catch (error) {
      if (String(error?.code || "").startsWith("FUTURE_CORE_")) {
        return res.status(409).json({ error: error.message, code: error.code });
      }
      console.error("UNBOUND FUTURE CORE APPROVAL ERROR:", error);
      return res.status(500).json({ error: "Could not approve that Future Core task." });
    }
  });

  router.post("/jobs/:id/cancel", async (req, res) => {
    if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid Future Core job ID." });
    try {
      const pool = getPool();
      const job = await loadJob(pool, req.user.id, req.params.id);
      if (!job) return res.status(404).json({ error: "Future Core job not found." });
      cancelJob(job);
      await saveJob(pool, req.user.id, job);
      return res.json({ job });
    } catch (error) {
      console.error("UNBOUND FUTURE CORE CANCEL ERROR:", error);
      return res.status(500).json({ error: "Could not cancel that Future Core job." });
    }
  });

  router.delete("/jobs/:id", async (req, res) => {
    if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid Future Core job ID." });
    try {
      const deleted = await deleteFinishedJob(getPool(), req.user.id, req.params.id);
      if (!deleted) return res.status(409).json({ error: "Only finished Future Core jobs can be deleted." });
      return res.json({ ok: true, id: req.params.id });
    } catch (error) {
      console.error("UNBOUND FUTURE CORE DELETE ERROR:", error);
      return res.status(500).json({ error: "Could not delete that Future Core job." });
    }
  });

  return router;
}

module.exports = {
  validUuid,
  createFutureCoreRouter
};
