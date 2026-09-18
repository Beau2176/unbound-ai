const express = require("express");
const crypto = require("crypto");
const { publicPlatformCatalog } = require("./registry");
const {
  normalizeProjectInput,
  normalizeVaultAssetInput,
  publicProject,
  publicVaultAsset
} = require("./projects");
const { writeAuditEvent } = require("./audit");
const {
  normalizeProjectMemoryInput
} = require("./project-memory");
const {
  MAX_AGENT_SCHEDULES_PER_USER,
  normalizeAgentScheduleInput,
  publicAgentSchedule
} = require("./background-agent-scheduler");
const { publicMcpStatus, listMcpTools, callMcpTool } = require("../connections/mcp-client");
const { publicSandboxStatus, createSandboxJob, getSandboxJob } = require("../coding/sandbox-client");
const {
  marketplaceEnabled,
  creatorMarketplaceEnabled,
  normalizeMarketplaceSkillInput,
  publicMarketplaceSkill,
  publicMarketplaceInstall,
  canInstallMarketplaceSkill
} = require("./skill-marketplace");

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function createPlatformRouter({ getPool, env = process.env } = {}) {
  if (typeof getPool !== "function") throw new Error("Platform parity routes require a database pool provider.");
  const router = express.Router();

  router.get("/catalog", (req, res) => res.json(publicPlatformCatalog(env)));

  router.get("/marketplace/status", (req, res) => res.json({
    enabled: marketplaceEnabled(env),
    creatorSubmissionsEnabled: creatorMarketplaceEnabled(env),
    executionMode: "manifest_only",
    creatorSelfPublish: false,
    externalWriteAccess: false
  }));

  router.get("/mcp/status", (req, res) => res.json(publicMcpStatus(env)));

  router.get("/mcp/tools", async (req, res) => {
    try {
      return res.json(await listMcpTools({ env }));
    } catch (error) {
      return res.status(error.statusCode || 502).json({ error: error.message, code: error.code || "MCP_ERROR" });
    }
  });

  router.post("/mcp/tools/:name/call", async (req, res) => {
    try {
      const listed = await listMcpTools({ env });
      const tool = listed.tools.find((item) => item.name === String(req.params.name || ""));
      if (!tool) return res.status(404).json({ error: "MCP tool not found." });
      const result = await callMcpTool({
        tool,
        arguments: req.body?.arguments || {},
        approved: req.body?.approved === true,
        env
      });
      await writeAuditEvent(getPool(), req.user.id, "mcp.tool.call", {
        tool: tool.name,
        readOnly: tool.readOnly,
        approved: req.body?.approved === true,
        status: result.status
      });
      return res.json(result);
    } catch (error) {
      return res.status(error.statusCode || 502).json({ error: error.message, code: error.code || "MCP_ERROR" });
    }
  });

  router.get("/projects", async (req, res) => {
    try {
      const result = await getPool().query(
        `SELECT id, name, description, status, created_at, updated_at
         FROM ai_projects WHERE user_id = $1
         ORDER BY updated_at DESC LIMIT 100`,
        [req.user.id]
      );
      return res.json({ projects: result.rows.map(publicProject) });
    } catch (error) {
      console.error("UNBOUND PROJECT LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load projects." });
    }
  });

  router.post("/projects", async (req, res) => {
    try {
      const input = normalizeProjectInput(req.body);
      const id = crypto.randomUUID();
      const pool = getPool();
      const result = await pool.query(
        `INSERT INTO ai_projects (id, user_id, name, description, status, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4, 'active', NOW(), NOW())
         RETURNING id, name, description, status, created_at, updated_at`,
        [id, req.user.id, input.name, input.description]
      );
      await writeAuditEvent(pool, req.user.id, "project.create", { projectId: id, name: input.name });
      return res.status(201).json({ project: publicProject(result.rows[0]) });
    } catch (error) {
      if (String(error?.code || "").startsWith("PROJECT_")) return res.status(error.statusCode || 400).json({ error: error.message, code: error.code });
      console.error("UNBOUND PROJECT CREATE ERROR:", error);
      return res.status(500).json({ error: "Could not create project." });
    }
  });

  router.get("/projects/:id/memory", async (req, res) => {
    if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid project ID." });
    try {
      const pool = getPool();
      const project = await pool.query(
        "SELECT id FROM ai_projects WHERE id = $1::uuid AND user_id = $2 LIMIT 1",
        [req.params.id, req.user.id]
      );
      if (!project.rows[0]) return res.status(404).json({ error: "Project not found." });
      const result = await pool.query(
        `SELECT id, content, enabled, created_at, updated_at
         FROM project_memories
         WHERE project_id = $1::uuid AND user_id = $2
         ORDER BY updated_at DESC, id DESC
         LIMIT 200`,
        [req.params.id, req.user.id]
      );
      return res.json({
        memories: result.rows.map((row) => ({
          id: String(row.id),
          content: row.content,
          enabled: Boolean(row.enabled),
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }))
      });
    } catch (error) {
      console.error("UNBOUND PROJECT MEMORY LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load project memory." });
    }
  });

  router.post("/projects/:id/memory", async (req, res) => {
    if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid project ID." });
    try {
      const input = normalizeProjectMemoryInput(req.body);
      const pool = getPool();
      const project = await pool.query(
        "SELECT id FROM ai_projects WHERE id = $1::uuid AND user_id = $2 LIMIT 1",
        [req.params.id, req.user.id]
      );
      if (!project.rows[0]) return res.status(404).json({ error: "Project not found." });
      const count = await pool.query(
        "SELECT COUNT(*)::int AS count FROM project_memories WHERE project_id = $1::uuid AND user_id = $2",
        [req.params.id, req.user.id]
      );
      if (Number(count.rows[0]?.count || 0) >= 200) {
        return res.status(409).json({ error: "This project already has the maximum number of memory entries." });
      }
      const result = await pool.query(
        `INSERT INTO project_memories (project_id, user_id, content, enabled, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4, NOW(), NOW())
         RETURNING id, content, enabled, created_at, updated_at`,
        [req.params.id, req.user.id, input.content, input.enabled]
      );
      await writeAuditEvent(pool, req.user.id, "project.memory.create", {
        projectId: req.params.id,
        memoryId: String(result.rows[0].id)
      });
      return res.status(201).json({
        memory: {
          id: String(result.rows[0].id),
          content: result.rows[0].content,
          enabled: Boolean(result.rows[0].enabled),
          createdAt: result.rows[0].created_at,
          updatedAt: result.rows[0].updated_at
        }
      });
    } catch (error) {
      if (String(error?.code || "").startsWith("PROJECT_MEMORY_")) {
        return res.status(error.statusCode || 400).json({ error: error.message, code: error.code });
      }
      console.error("UNBOUND PROJECT MEMORY CREATE ERROR:", error);
      return res.status(500).json({ error: "Could not save project memory." });
    }
  });

  router.delete("/projects/:projectId/memory/:memoryId", async (req, res) => {
    if (!validUuid(req.params.projectId) || !/^\d+$/.test(String(req.params.memoryId || ""))) {
      return res.status(400).json({ error: "Invalid project memory ID." });
    }
    try {
      const pool = getPool();
      const result = await pool.query(
        `DELETE FROM project_memories
         WHERE id = $1 AND project_id = $2::uuid AND user_id = $3
         RETURNING id`,
        [req.params.memoryId, req.params.projectId, req.user.id]
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Project memory not found." });
      await writeAuditEvent(pool, req.user.id, "project.memory.delete", {
        projectId: req.params.projectId,
        memoryId: req.params.memoryId
      });
      return res.json({ ok: true, id: req.params.memoryId });
    } catch (error) {
      console.error("UNBOUND PROJECT MEMORY DELETE ERROR:", error);
      return res.status(500).json({ error: "Could not delete project memory." });
    }
  });

  router.get("/projects/:id/skills", async (req, res) => {
    if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid project ID." });
    try {
      const project = await getPool().query("SELECT id FROM ai_projects WHERE id = $1::uuid AND user_id = $2 LIMIT 1", [req.params.id, req.user.id]);
      if (!project.rows[0]) return res.status(404).json({ error: "Project not found." });
      const result = await getPool().query(
        `SELECT skill_id, enabled, updated_at
         FROM project_skill_settings
         WHERE project_id = $1::uuid AND user_id = $2
         ORDER BY skill_id ASC`,
        [req.params.id, req.user.id]
      );
      return res.json({ settings: result.rows });
    } catch (error) {
      console.error("UNBOUND PROJECT SKILLS LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load project skills." });
    }
  });

  router.put("/projects/:id/skills/:skillId", async (req, res) => {
    if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid project ID." });
    const catalog = publicPlatformCatalog(env);
    const skill = catalog.skills.find((item) => item.id === String(req.params.skillId || ""));
    if (!skill) return res.status(404).json({ error: "Unknown skill." });
    try {
      const pool = getPool();
      const project = await pool.query("SELECT id FROM ai_projects WHERE id = $1::uuid AND user_id = $2 LIMIT 1", [req.params.id, req.user.id]);
      if (!project.rows[0]) return res.status(404).json({ error: "Project not found." });
      const enabled = req.body?.enabled !== false;
      const result = await pool.query(
        `INSERT INTO project_skill_settings (project_id, user_id, skill_id, enabled, updated_at)
         VALUES ($1::uuid, $2, $3, $4, NOW())
         ON CONFLICT (project_id, skill_id) DO UPDATE SET
           enabled = EXCLUDED.enabled,
           updated_at = NOW()
         WHERE project_skill_settings.user_id = EXCLUDED.user_id
         RETURNING skill_id, enabled, updated_at`,
        [req.params.id, req.user.id, skill.id, enabled]
      );
      await writeAuditEvent(pool, req.user.id, "project.skill.update", { projectId: req.params.id, skillId: skill.id, enabled });
      return res.json({ setting: result.rows[0] });
    } catch (error) {
      console.error("UNBOUND PROJECT SKILLS UPDATE ERROR:", error);
      return res.status(500).json({ error: "Could not update that project skill." });
    }
  });

  router.get("/projects/:id/assets", async (req, res) => {
    if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid project ID." });
    try {
      const result = await getPool().query(
        `SELECT a.id, a.project_id, a.name, a.media_type, a.bytes, a.storage_provider, a.storage_state, a.created_at, a.updated_at
         FROM vault_assets a
         JOIN ai_projects p ON p.id = a.project_id
         WHERE a.user_id = $1 AND a.project_id = $2::uuid AND p.user_id = $1
         ORDER BY a.updated_at DESC`,
        [req.user.id, req.params.id]
      );
      return res.json({ assets: result.rows.map(publicVaultAsset) });
    } catch (error) {
      console.error("UNBOUND VAULT LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load vault assets." });
    }
  });

  router.post("/projects/:id/assets", async (req, res) => {
    if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid project ID." });
    try {
      const input = normalizeVaultAssetInput(req.body);
      const pool = getPool();
      const project = await pool.query("SELECT id FROM ai_projects WHERE id = $1::uuid AND user_id = $2 LIMIT 1", [req.params.id, req.user.id]);
      if (!project.rows[0]) return res.status(404).json({ error: "Project not found." });

      const storageConfigured = Boolean(String(env.UNBOUND_OBJECT_STORAGE_PROVIDER || "").trim() && String(env.UNBOUND_OBJECT_STORAGE_KEY || "").trim());
      const state = storageConfigured ? "awaiting_upload" : "metadata_only";
      const provider = storageConfigured ? String(env.UNBOUND_OBJECT_STORAGE_PROVIDER).slice(0, 80) : null;
      const result = await pool.query(
        `INSERT INTO vault_assets (
           id, user_id, project_id, name, media_type, bytes, storage_provider, storage_state, created_at, updated_at
         ) VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, NOW(), NOW())
         RETURNING id, project_id, name, media_type, bytes, storage_provider, storage_state, created_at, updated_at`,
        [input.id, req.user.id, req.params.id, input.name, input.mediaType, input.bytes, provider, state]
      );
      await writeAuditEvent(pool, req.user.id, "vault.asset.register", { projectId: req.params.id, assetId: input.id, storageState: state });
      return res.status(201).json({
        asset: publicVaultAsset(result.rows[0]),
        uploadAvailable: storageConfigured,
        note: storageConfigured ? "Object storage is configured; upload transport can be connected next." : "Metadata is saved, but raw file storage remains disabled until encrypted object storage is configured."
      });
    } catch (error) {
      if (String(error?.code || "").startsWith("VAULT_")) return res.status(error.statusCode || 400).json({ error: error.message, code: error.code });
      console.error("UNBOUND VAULT CREATE ERROR:", error);
      return res.status(500).json({ error: "Could not register vault asset." });
    }
  });

  router.get("/coding/jobs", async (req, res) => {
    try {
      const result = await getPool().query(
        `SELECT id, project_id, objective, status, provider_job_id, created_at, updated_at, completed_at
         FROM coding_workspace_jobs
         WHERE user_id = $1
         ORDER BY updated_at DESC
         LIMIT 100`,
        [req.user.id]
      );
      return res.json({ jobs: result.rows });
    } catch (error) {
      console.error("UNBOUND CODING JOB LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load coding workspace jobs." });
    }
  });

  router.post("/coding/jobs", async (req, res) => {
    const objective = String(req.body?.objective || "").trim().slice(0, 8000);
    if (!objective) return res.status(400).json({ error: "Coding objective is required." });
    const sandboxConfigured = Boolean(String(env.UNBOUND_CODE_SANDBOX_URL || "").trim());
    const id = crypto.randomUUID();
    const status = sandboxConfigured ? "queued" : "blocked_configuration";
    try {
      const pool = getPool();
      await pool.query(
        `INSERT INTO coding_workspace_jobs (id, user_id, objective, status, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4, NOW(), NOW())`,
        [id, req.user.id, objective, status]
      );
      await writeAuditEvent(pool, req.user.id, "coding.job.create", { jobId: id, status });
      return res.status(202).json({
        job: { id, objective, status },
        sandboxConfigured,
        note: sandboxConfigured ? "Coding workspace job queued." : "A sandbox provider must be connected before code can execute outside the main app server."
      });
    } catch (error) {
      console.error("UNBOUND CODING JOB CREATE ERROR:", error);
      return res.status(500).json({ error: "Could not create coding workspace job." });
    }
  });

  router.get("/coding/sandbox/status", (req, res) => res.json(publicSandboxStatus(env)));

  router.post("/coding/jobs/:id/dispatch", async (req, res) => {
    if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid coding job ID." });
    try {
      const pool = getPool();
      const selected = await pool.query(
        `SELECT id, objective, status, provider_job_id
         FROM coding_workspace_jobs
         WHERE id = $1::uuid AND user_id = $2
         LIMIT 1`,
        [req.params.id, req.user.id]
      );
      const job = selected.rows[0];
      if (!job) return res.status(404).json({ error: "Coding job not found." });
      if (job.provider_job_id) return res.status(409).json({ error: "Coding job was already dispatched." });

      const remote = await createSandboxJob({
        objective: job.objective,
        repository: req.body?.repository || null,
        branch: req.body?.branch || null,
        env
      });
      const providerJobId = String(remote.id || remote.jobId || "").slice(0, 300);
      if (!providerJobId) return res.status(502).json({ error: "Sandbox did not return a job ID." });
      const status = ["queued", "running", "completed", "failed", "cancelled"].includes(String(remote.status || ""))
        ? String(remote.status)
        : "queued";
      await pool.query(
        `UPDATE coding_workspace_jobs
         SET provider_job_id = $1, status = $2, updated_at = NOW()
         WHERE id = $3::uuid AND user_id = $4`,
        [providerJobId, status, req.params.id, req.user.id]
      );
      await writeAuditEvent(pool, req.user.id, "coding.job.dispatch", { jobId: req.params.id, status });
      return res.status(202).json({ id: req.params.id, providerJobId, status });
    } catch (error) {
      return res.status(error.statusCode || 502).json({ error: error.message, code: error.code || "CODE_SANDBOX_ERROR" });
    }
  });

  router.post("/coding/jobs/:id/sync", async (req, res) => {
    if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid coding job ID." });
    try {
      const pool = getPool();
      const selected = await pool.query(
        `SELECT id, provider_job_id
         FROM coding_workspace_jobs
         WHERE id = $1::uuid AND user_id = $2
         LIMIT 1`,
        [req.params.id, req.user.id]
      );
      const job = selected.rows[0];
      if (!job) return res.status(404).json({ error: "Coding job not found." });
      if (!job.provider_job_id) return res.status(409).json({ error: "Coding job has not been dispatched." });

      const remote = await getSandboxJob(job.provider_job_id, { env });
      const status = ["queued", "running", "completed", "failed", "cancelled"].includes(String(remote.status || ""))
        ? String(remote.status)
        : "running";
      await pool.query(
        `UPDATE coding_workspace_jobs
         SET status = $1,
             completed_at = CASE WHEN $1 IN ('completed', 'failed', 'cancelled') THEN NOW() ELSE completed_at END,
             updated_at = NOW()
         WHERE id = $2::uuid AND user_id = $3`,
        [status, req.params.id, req.user.id]
      );
      await writeAuditEvent(pool, req.user.id, "coding.job.sync", { jobId: req.params.id, status });
      return res.json({ id: req.params.id, status, result: remote.result || null });
    } catch (error) {
      return res.status(error.statusCode || 502).json({ error: error.message, code: error.code || "CODE_SANDBOX_ERROR" });
    }
  });

  router.get("/background-agents", async (req, res) => {
    try {
      const result = await getPool().query(
        `SELECT id, project_id, title, objective, recurrence, interval_count,
                allow_research, next_run_at, last_run_at, last_job_id,
                enabled, created_at, updated_at
         FROM background_agent_schedules
         WHERE user_id = $1
         ORDER BY enabled DESC, next_run_at ASC NULLS LAST, id DESC`,
        [req.user.id]
      );
      return res.json({ schedules: result.rows.map(publicAgentSchedule) });
    } catch (error) {
      console.error("UNBOUND BACKGROUND AGENT LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load background Agent schedules." });
    }
  });

  router.post("/background-agents", async (req, res) => {
    try {
      const input = normalizeAgentScheduleInput(req.body, new Date());
      if (input.projectId && !validUuid(input.projectId)) {
        return res.status(400).json({ error: "Invalid project ID." });
      }
      const pool = getPool();
      if (input.projectId) {
        const project = await pool.query(
          "SELECT id FROM ai_projects WHERE id = $1::uuid AND user_id = $2 LIMIT 1",
          [input.projectId, req.user.id]
        );
        if (!project.rows[0]) return res.status(404).json({ error: "Project not found." });
      }
      const count = await pool.query(
        "SELECT COUNT(*)::int AS count FROM background_agent_schedules WHERE user_id = $1",
        [req.user.id]
      );
      if (Number(count.rows[0]?.count || 0) >= MAX_AGENT_SCHEDULES_PER_USER) {
        return res.status(409).json({ error: "You already have the maximum number of background Agent schedules." });
      }
      const result = await pool.query(
        `INSERT INTO background_agent_schedules (
           user_id, project_id, title, objective, recurrence, interval_count,
           allow_research, next_run_at, enabled, created_at, updated_at
         )
         VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8::timestamptz, TRUE, NOW(), NOW())
         RETURNING id, project_id, title, objective, recurrence, interval_count,
                   allow_research, next_run_at, last_run_at, last_job_id,
                   enabled, created_at, updated_at`,
        [
          req.user.id,
          input.projectId,
          input.title,
          input.objective,
          input.recurrence,
          input.intervalCount,
          input.allowResearch,
          input.runAt.toISOString()
        ]
      );
      await writeAuditEvent(pool, req.user.id, "background_agent.create", {
        scheduleId: String(result.rows[0].id),
        projectId: input.projectId,
        recurrence: input.recurrence
      });
      return res.status(201).json({ schedule: publicAgentSchedule(result.rows[0]) });
    } catch (error) {
      if (String(error?.code || "").startsWith("AGENT_SCHEDULE_")) {
        return res.status(error.statusCode || 400).json({ error: error.message, code: error.code });
      }
      console.error("UNBOUND BACKGROUND AGENT CREATE ERROR:", error);
      return res.status(500).json({ error: "Could not create background Agent schedule." });
    }
  });

  router.post("/background-agents/:id/toggle", async (req, res) => {
    if (!/^\d+$/.test(String(req.params.id || "")) || typeof req.body?.enabled !== "boolean") {
      return res.status(400).json({ error: "Invalid background Agent schedule update." });
    }
    try {
      const result = await getPool().query(
        `UPDATE background_agent_schedules
         SET enabled = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3
         RETURNING id, project_id, title, objective, recurrence, interval_count,
                   allow_research, next_run_at, last_run_at, last_job_id,
                   enabled, created_at, updated_at`,
        [req.body.enabled, req.params.id, req.user.id]
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Background Agent schedule not found." });
      return res.json({ schedule: publicAgentSchedule(result.rows[0]) });
    } catch (error) {
      console.error("UNBOUND BACKGROUND AGENT TOGGLE ERROR:", error);
      return res.status(500).json({ error: "Could not update background Agent schedule." });
    }
  });

  router.delete("/background-agents/:id", async (req, res) => {
    if (!/^\d+$/.test(String(req.params.id || ""))) {
      return res.status(400).json({ error: "Invalid background Agent schedule ID." });
    }
    try {
      const pool = getPool();
      const result = await pool.query(
        "DELETE FROM background_agent_schedules WHERE id = $1 AND user_id = $2 RETURNING id",
        [req.params.id, req.user.id]
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Background Agent schedule not found." });
      await writeAuditEvent(pool, req.user.id, "background_agent.delete", { scheduleId: req.params.id });
      return res.json({ ok: true, id: req.params.id });
    } catch (error) {
      console.error("UNBOUND BACKGROUND AGENT DELETE ERROR:", error);
      return res.status(500).json({ error: "Could not delete background Agent schedule." });
    }
  });


  router.get("/marketplace/skills", async (req, res) => {
    if (!marketplaceEnabled(env)) return res.status(404).json({ error: "Not found." });
    try {
      const result = await getPool().query(
        `SELECT id, creator_user_id, slug, name, summary, category, manifest,
                review_status, published, created_at, updated_at
         FROM marketplace_skills
         WHERE review_status = 'approved' AND published = TRUE
         ORDER BY updated_at DESC, name ASC
         LIMIT 200`
      );
      return res.json({ skills: result.rows.map(publicMarketplaceSkill) });
    } catch (error) {
      console.error("UNBOUND MARKETPLACE LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load marketplace skills." });
    }
  });

  router.get("/marketplace/skills/mine", async (req, res) => {
    if (!creatorMarketplaceEnabled(env)) return res.status(404).json({ error: "Not found." });
    try {
      const result = await getPool().query(
        `SELECT id, creator_user_id, slug, name, summary, category, manifest,
                review_status, published, created_at, updated_at
         FROM marketplace_skills
         WHERE creator_user_id = $1
         ORDER BY updated_at DESC
         LIMIT 200`,
        [req.user.id]
      );
      return res.json({ skills: result.rows.map(publicMarketplaceSkill) });
    } catch (error) {
      console.error("UNBOUND CREATOR SKILL LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load creator skills." });
    }
  });

  router.post("/marketplace/skills", async (req, res) => {
    if (!creatorMarketplaceEnabled(env)) return res.status(404).json({ error: "Not found." });
    try {
      const input = normalizeMarketplaceSkillInput(req.body);
      const pool = getPool();
      const result = await pool.query(
        `INSERT INTO marketplace_skills (
           id, creator_user_id, slug, name, summary, category, manifest,
           review_status, published, created_at, updated_at
         )
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, 'draft', FALSE, NOW(), NOW())
         RETURNING id, creator_user_id, slug, name, summary, category, manifest,
                   review_status, published, created_at, updated_at`,
        [
          input.id,
          req.user.id,
          input.slug,
          input.name,
          input.summary,
          input.category,
          JSON.stringify(input.manifest)
        ]
      );
      await writeAuditEvent(pool, req.user.id, "marketplace.skill.create", {
        skillId: input.id,
        slug: input.slug
      });
      return res.status(201).json({ skill: publicMarketplaceSkill(result.rows[0]) });
    } catch (error) {
      if (error?.code === "23505") return res.status(409).json({ error: "That skill slug is already in use." });
      if (String(error?.code || "").startsWith("MARKETPLACE_SKILL_")) {
        return res.status(error.statusCode || 400).json({ error: error.message, code: error.code });
      }
      console.error("UNBOUND CREATOR SKILL CREATE ERROR:", error);
      return res.status(500).json({ error: "Could not create marketplace skill." });
    }
  });

  router.post("/marketplace/skills/:id/submit", async (req, res) => {
    if (!creatorMarketplaceEnabled(env)) return res.status(404).json({ error: "Not found." });
    if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid skill ID." });
    try {
      const pool = getPool();
      const result = await pool.query(
        `UPDATE marketplace_skills
         SET review_status = 'pending_review', published = FALSE, updated_at = NOW()
         WHERE id = $1::uuid
           AND creator_user_id = $2
           AND review_status IN ('draft', 'rejected')
         RETURNING id, creator_user_id, slug, name, summary, category, manifest,
                   review_status, published, created_at, updated_at`,
        [req.params.id, req.user.id]
      );
      if (!result.rows[0]) {
        return res.status(409).json({ error: "Only your draft or rejected skills can be submitted for review." });
      }
      await writeAuditEvent(pool, req.user.id, "marketplace.skill.submit", { skillId: req.params.id });
      return res.json({ skill: publicMarketplaceSkill(result.rows[0]) });
    } catch (error) {
      console.error("UNBOUND CREATOR SKILL SUBMIT ERROR:", error);
      return res.status(500).json({ error: "Could not submit marketplace skill." });
    }
  });

  router.get("/marketplace/installs", async (req, res) => {
    if (!marketplaceEnabled(env)) return res.status(404).json({ error: "Not found." });
    try {
      const result = await getPool().query(
        `SELECT id, skill_id, project_id, scope_key, enabled, created_at, updated_at
         FROM marketplace_skill_installs
         WHERE user_id = $1
         ORDER BY updated_at DESC, id DESC`,
        [req.user.id]
      );
      return res.json({ installs: result.rows.map(publicMarketplaceInstall) });
    } catch (error) {
      console.error("UNBOUND MARKETPLACE INSTALL LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load installed skills." });
    }
  });

  router.post("/marketplace/skills/:id/install", async (req, res) => {
    if (!marketplaceEnabled(env)) return res.status(404).json({ error: "Not found." });
    if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid skill ID." });
    const projectId = req.body?.projectId ? String(req.body.projectId) : null;
    if (projectId && !validUuid(projectId)) return res.status(400).json({ error: "Invalid project ID." });
    try {
      const pool = getPool();
      const skillResult = await pool.query(
        `SELECT id, creator_user_id, slug, name, summary, category, manifest,
                review_status, published, created_at, updated_at
         FROM marketplace_skills
         WHERE id = $1::uuid
         LIMIT 1`,
        [req.params.id]
      );
      const skill = skillResult.rows[0];
      if (!skill || !canInstallMarketplaceSkill(skill)) {
        return res.status(404).json({ error: "Published skill not found." });
      }
      if (projectId) {
        const project = await pool.query(
          "SELECT id FROM ai_projects WHERE id = $1::uuid AND user_id = $2 LIMIT 1",
          [projectId, req.user.id]
        );
        if (!project.rows[0]) return res.status(404).json({ error: "Project not found." });
      }
      const scopeKey = projectId || "global";
      const result = await pool.query(
        `INSERT INTO marketplace_skill_installs (
           user_id, skill_id, project_id, scope_key, enabled, created_at, updated_at
         )
         VALUES ($1, $2::uuid, $3::uuid, $4, TRUE, NOW(), NOW())
         ON CONFLICT (user_id, skill_id, scope_key) DO UPDATE SET
           enabled = TRUE,
           updated_at = NOW()
         RETURNING id, skill_id, project_id, scope_key, enabled, created_at, updated_at`,
        [req.user.id, req.params.id, projectId, scopeKey]
      );
      await writeAuditEvent(pool, req.user.id, "marketplace.skill.install", {
        skillId: req.params.id,
        projectId,
        scope: scopeKey
      });
      return res.status(201).json({
        install: publicMarketplaceInstall(result.rows[0]),
        executionMode: "manifest_only",
        note: "Installed marketplace skills cannot execute arbitrary code or gain external-write access."
      });
    } catch (error) {
      console.error("UNBOUND MARKETPLACE INSTALL ERROR:", error);
      return res.status(500).json({ error: "Could not install marketplace skill." });
    }
  });

  router.delete("/marketplace/installs/:id", async (req, res) => {
    if (!marketplaceEnabled(env)) return res.status(404).json({ error: "Not found." });
    if (!/^\d+$/.test(String(req.params.id || ""))) {
      return res.status(400).json({ error: "Invalid install ID." });
    }
    try {
      const pool = getPool();
      const result = await pool.query(
        "DELETE FROM marketplace_skill_installs WHERE id = $1 AND user_id = $2 RETURNING id, skill_id",
        [req.params.id, req.user.id]
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Installed skill not found." });
      await writeAuditEvent(pool, req.user.id, "marketplace.skill.uninstall", {
        installId: req.params.id,
        skillId: String(result.rows[0].skill_id)
      });
      return res.json({ ok: true, id: req.params.id });
    } catch (error) {
      console.error("UNBOUND MARKETPLACE UNINSTALL ERROR:", error);
      return res.status(500).json({ error: "Could not uninstall marketplace skill." });
    }
  });

  router.get("/audit", async (req, res) => {
    try {
      const result = await getPool().query(
        `SELECT id, action, details, created_at
         FROM platform_audit_events
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 200`,
        [req.user.id]
      );
      return res.json({ events: result.rows });
    } catch (error) {
      console.error("UNBOUND AUDIT LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load audit history." });
    }
  });

  return router;
}

module.exports = {
  validUuid,
  createPlatformRouter
};
