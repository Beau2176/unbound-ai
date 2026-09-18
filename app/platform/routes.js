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

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function createPlatformRouter({ getPool, env = process.env } = {}) {
  if (typeof getPool !== "function") throw new Error("Platform parity routes require a database pool provider.");
  const router = express.Router();

  router.get("/catalog", (req, res) => res.json(publicPlatformCatalog(env)));

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
