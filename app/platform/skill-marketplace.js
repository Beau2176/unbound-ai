const crypto = require("crypto");

const MARKETPLACE_VERSION = "v1.0";
const SKILL_CATEGORIES = Object.freeze([
  "knowledge",
  "productivity",
  "coding",
  "creative",
  "data",
  "workspace",
  "automation",
  "accessibility"
]);

const SAFE_MARKETPLACE_PERMISSIONS = Object.freeze([
  "model.invoke",
  "web.read",
  "files.read",
  "files.write",
  "images.generate",
  "memory.read",
  "memory.write",
  "project.read",
  "project.write",
  "mcp.read",
  "browser.read"
]);

const SAFE_MARKETPLACE_TOOLS = Object.freeze([
  "web_research",
  "file_analysis",
  "image_generation",
  "project_memory",
  "future_core",
  "code_workspace",
  "mcp_read",
  "browser_read"
]);

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function marketplaceEnabled(env = process.env) {
  return enabled(env.UNBOUND_SKILL_MARKETPLACE_ENABLED);
}

function creatorMarketplaceEnabled(env = process.env) {
  return enabled(env.UNBOUND_SKILL_CREATOR_ENABLED);
}

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function normalizeSlug(value) {
  return cleanText(value, 64)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function uniqueAllowed(values, allowed, max, field) {
  const input = Array.isArray(values) ? values : [];
  const output = [];
  for (const raw of input) {
    const value = String(raw || "").trim();
    if (!value || output.includes(value)) continue;
    if (!allowed.includes(value)) {
      const error = new Error("Unsupported marketplace skill " + field + ": " + value + ".");
      error.code = "MARKETPLACE_SKILL_UNSAFE_" + field.toUpperCase();
      error.statusCode = 400;
      throw error;
    }
    output.push(value);
    if (output.length >= max) break;
  }
  return output;
}

function normalizeMarketplaceSkillInput(body = {}) {
  const name = cleanText(body.name, 80);
  const slug = normalizeSlug(body.slug || name);
  const summary = cleanText(body.summary, 500);
  const category = cleanText(body.category || "productivity", 40).toLowerCase();
  const version = cleanText(body.version || "1.0.0", 32);
  const instructions = cleanText(body.instructions, 8000);

  if (!name) {
    const error = new Error("Skill name is required.");
    error.code = "MARKETPLACE_SKILL_NAME_REQUIRED";
    error.statusCode = 400;
    throw error;
  }
  if (slug.length < 3) {
    const error = new Error("Skill slug must be at least 3 characters.");
    error.code = "MARKETPLACE_SKILL_SLUG_INVALID";
    error.statusCode = 400;
    throw error;
  }
  if (!summary) {
    const error = new Error("Skill summary is required.");
    error.code = "MARKETPLACE_SKILL_SUMMARY_REQUIRED";
    error.statusCode = 400;
    throw error;
  }
  if (!SKILL_CATEGORIES.includes(category)) {
    const error = new Error("Unsupported skill category.");
    error.code = "MARKETPLACE_SKILL_CATEGORY_INVALID";
    error.statusCode = 400;
    throw error;
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    const error = new Error("Skill version must use semantic versioning.");
    error.code = "MARKETPLACE_SKILL_VERSION_INVALID";
    error.statusCode = 400;
    throw error;
  }
  if (!instructions) {
    const error = new Error("Skill instructions are required.");
    error.code = "MARKETPLACE_SKILL_INSTRUCTIONS_REQUIRED";
    error.statusCode = 400;
    throw error;
  }

  const permissions = uniqueAllowed(
    body.permissions,
    SAFE_MARKETPLACE_PERMISSIONS,
    12,
    "permissions"
  );
  const tools = uniqueAllowed(body.tools, SAFE_MARKETPLACE_TOOLS, 12, "tools");

  return {
    id: crypto.randomUUID(),
    slug,
    name,
    summary,
    category,
    version,
    manifest: {
      manifestVersion: MARKETPLACE_VERSION,
      slug,
      name,
      summary,
      category,
      version,
      instructions,
      permissions,
      tools,
      executableCode: false,
      externalWriteAccess: false
    }
  };
}

function publicMarketplaceSkill(row) {
  const manifest = row.manifest && typeof row.manifest === "object" ? row.manifest : {};
  return {
    id: String(row.id),
    creatorUserId: row.creator_user_id ? String(row.creator_user_id) : null,
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    category: row.category,
    version: manifest.version || "1.0.0",
    permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],
    tools: Array.isArray(manifest.tools) ? manifest.tools : [],
    reviewStatus: row.review_status || "draft",
    published: Boolean(row.published),
    executableCode: false,
    externalWriteAccess: false,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicMarketplaceInstall(row) {
  return {
    id: String(row.id),
    skillId: String(row.skill_id),
    projectId: row.project_id ? String(row.project_id) : null,
    scope: row.scope_key || "global",
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function canInstallMarketplaceSkill(row) {
  return Boolean(row && row.published === true && row.review_status === "approved");
}

module.exports = {
  MARKETPLACE_VERSION,
  SKILL_CATEGORIES,
  SAFE_MARKETPLACE_PERMISSIONS,
  SAFE_MARKETPLACE_TOOLS,
  marketplaceEnabled,
  creatorMarketplaceEnabled,
  normalizeMarketplaceSkillInput,
  publicMarketplaceSkill,
  publicMarketplaceInstall,
  canInstallMarketplaceSkill
};
