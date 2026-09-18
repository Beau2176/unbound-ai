const assert = require("assert");
const { publicPlatformCatalog, providerCatalog, connectorCatalog, workspaceStatus } = require("../platform/registry");
const { normalizeProjectInput, normalizeVaultAssetInput } = require("../platform/projects");
const { safeAuditDetails, normalizeAuditAction } = require("../platform/audit");
const { integratePlatformParityServerSource } = require("../platform/server-integration");

function main() {
  const env = {
    OPENAI_API_KEY: "openai",
    ANTHROPIC_API_KEY: "anthropic",
    GEMINI_API_KEY: "gemini",
    UNBOUND_LOCAL_AI_ENDPOINT: "http://127.0.0.1:11434",
    GITHUB_CLIENT_ID: "github",
    UNBOUND_MCP_GATEWAY_URL: "https://mcp.example.test",
    BROWSER_CDP_URL: "wss://browser.example.test",
    UNBOUND_OBJECT_STORAGE_PROVIDER: "s3",
    UNBOUND_OBJECT_STORAGE_KEY: "configured",
    UNBOUND_CODE_SANDBOX_URL: "https://sandbox.example.test",
    UNBOUND_FUTURE_CORE_V2_ENABLED: "true"
  };

  const catalog = publicPlatformCatalog(env);
  assert.strictEqual(catalog.version, "v1.0");
  assert(catalog.skills.some((skill) => skill.id === "coding"));
  assert(catalog.protocols.some((protocol) => protocol.id === "mcp" && protocol.implemented));
  assert.strictEqual(providerCatalog(env).find((provider) => provider.id === "openai").configured, true);
  assert.strictEqual(providerCatalog(env).find((provider) => provider.id === "anthropic").configured, true);
  assert.strictEqual(connectorCatalog(env).find((connector) => connector.id === "mcp_gateway").configured, true);
  assert.strictEqual(workspaceStatus(env).encryptedObjectStorage, true);
  assert.strictEqual(workspaceStatus(env).codeWorkspace, true);
  assert.strictEqual(workspaceStatus(env).futureCore, true);

  assert.deepStrictEqual(normalizeProjectInput({ name: "Project A", description: "Details" }), {
    name: "Project A",
    description: "Details"
  });
  assert.throws(() => normalizeProjectInput({ name: "" }), /required/i);
  const asset = normalizeVaultAssetInput({ name: "report.pdf", mediaType: "application/pdf", bytes: 123 });
  assert.strictEqual(asset.name, "report.pdf");
  assert.strictEqual(asset.storageState, "metadata_only");

  assert.strictEqual(normalizeAuditAction("project.create"), "project.create");
  assert.strictEqual(normalizeAuditAction("not allowed spaces"), "unknown");
  assert.deepStrictEqual(
    safeAuditDetails({ projectId: "123", password: "secret", apiKey: "secret", ok: true }),
    { projectId: "123", ok: true }
  );

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
  assert(integrated.includes('require("./platform/routes")'));
  assert(integrated.includes("CREATE TABLE IF NOT EXISTS ai_projects"));
  assert(integrated.includes("CREATE TABLE IF NOT EXISTS vault_assets"));
  assert(integrated.includes("CREATE TABLE IF NOT EXISTS coding_workspace_jobs"));
  assert(integrated.includes("CREATE TABLE IF NOT EXISTS platform_audit_events"));
  assert(integrated.includes("UNBOUND_PLATFORM_PARITY_ENABLED"));
  assert(integrated.includes("requireCapability('agents')") || integrated.includes('requireCapability("agents")'));
  assert(integrated.includes('"/api/platform"'));
  assert.strictEqual(integratePlatformParityServerSource(integrated), integrated);

  console.log("PASS platform parity wave 1: projects, vault metadata, skills, connectors, providers, coding jobs, and audit controls.");
}

main();
