const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  marketplaceEnabled,
  creatorMarketplaceEnabled,
  normalizeMarketplaceSkillInput,
  canInstallMarketplaceSkill,
  SAFE_MARKETPLACE_PERMISSIONS,
  SAFE_MARKETPLACE_TOOLS
} = require("../platform/skill-marketplace");
const { integratePlatformParityServerSource } = require("../platform/server-integration");

function main() {
  assert.strictEqual(marketplaceEnabled({}), false);
  assert.strictEqual(creatorMarketplaceEnabled({}), false);
  assert.strictEqual(marketplaceEnabled({ UNBOUND_SKILL_MARKETPLACE_ENABLED: "true" }), true);
  assert.strictEqual(creatorMarketplaceEnabled({ UNBOUND_SKILL_CREATOR_ENABLED: "true" }), true);

  const normalized = normalizeMarketplaceSkillInput({
    name: "Research Helper",
    slug: "Research Helper",
    summary: "A bounded research workflow.",
    category: "knowledge",
    version: "1.2.0",
    instructions: "Research the user's topic and summarize the evidence.",
    permissions: ["web.read", "model.invoke"],
    tools: ["web_research"],
    executableCode: "require('child_process')",
    endpoint: "https://evil.example.test"
  });

  assert.strictEqual(normalized.slug, "research-helper");
  assert.deepStrictEqual(normalized.manifest.permissions, ["web.read", "model.invoke"]);
  assert.deepStrictEqual(normalized.manifest.tools, ["web_research"]);
  assert.strictEqual(normalized.manifest.executableCode, false);
  assert.strictEqual(normalized.manifest.externalWriteAccess, false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(normalized.manifest, "endpoint"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(normalized.manifest, "code"), false);

  assert.throws(
    () => normalizeMarketplaceSkillInput({
      name: "Unsafe",
      summary: "Unsafe permission request.",
      instructions: "Do something.",
      permissions: ["external.write"]
    }),
    /Unsupported marketplace skill permissions/
  );
  assert.throws(
    () => normalizeMarketplaceSkillInput({
      name: "Unsafe Tool",
      summary: "Unsafe tool request.",
      instructions: "Do something.",
      tools: ["shell_exec"]
    }),
    /Unsupported marketplace skill tools/
  );

  assert(SAFE_MARKETPLACE_PERMISSIONS.includes("web.read"));
  assert(!SAFE_MARKETPLACE_PERMISSIONS.includes("external.write"));
  assert(SAFE_MARKETPLACE_TOOLS.includes("web_research"));
  assert(!SAFE_MARKETPLACE_TOOLS.includes("shell_exec"));

  assert.strictEqual(canInstallMarketplaceSkill({
    review_status: "approved",
    published: true
  }), true);
  assert.strictEqual(canInstallMarketplaceSkill({
    review_status: "pending_review",
    published: true
  }), false);
  assert.strictEqual(canInstallMarketplaceSkill({
    review_status: "approved",
    published: false
  }), false);

  const routes = fs.readFileSync(path.join(__dirname, "..", "platform", "routes.js"), "utf8");
  assert(routes.includes('"/marketplace/skills"'));
  assert(routes.includes('"/marketplace/skills/:id/submit"'));
  assert(routes.includes('"/marketplace/skills/:id/install"'));
  assert(routes.includes('"/marketplace/installs/:id"'));
  assert(routes.includes("creatorSelfPublish: false"));
  assert(routes.includes('executionMode: "manifest_only"'));
  assert(!routes.includes('"/marketplace/skills/:id/approve"'));
  assert(!routes.includes('"/marketplace/skills/:id/publish"'));

  const minimal = [
    'const { createFutureCoreRouter } = require("./orchestration/routes");',
    "async function schema() {",
    "  await pool.query(`",
    "    CREATE INDEX IF NOT EXISTS future_core_jobs_status_idx",
    "      ON future_core_jobs(status, updated_at DESC);",
    "  `);",
    "}",
    'app.get("/api/health", (req, res) => {',
    "});"
  ].join("\n");

  const integrated = integratePlatformParityServerSource(minimal);
  assert(integrated.includes("CREATE TABLE IF NOT EXISTS marketplace_skills"));
  assert(integrated.includes("CREATE TABLE IF NOT EXISTS marketplace_skill_installs"));
  assert(integrated.includes("UNBOUND_PLATFORM_PARITY_ENABLED"));
  assert.strictEqual(integratePlatformParityServerSource(integrated), integrated);

  console.log("PASS platform parity wave 4: safe Skills Marketplace manifests, review-gated installs, and creator submissions.");
}

main();
