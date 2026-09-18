const { FUTURE_CORE_SCHEMA_SQL } = require("./persistence");

const INTEGRATION_VERSION = "v2.0-staged";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Future Core v2 integration marker is missing: ${label}.`);
    error.code = "FUTURE_CORE_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Future Core v2 integration marker is ambiguous: ${label}.`);
    error.code = "FUTURE_CORE_SERVER_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integrateFutureCoreV2ServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "FUTURE_CORE_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }
  if (
    source.includes('createFutureCoreRouter({') &&
    source.includes('"/api/future-core-v2"') &&
    source.includes("UNBOUND_FUTURE_CORE_V2_ENABLED") &&
    source.includes("CREATE TABLE IF NOT EXISTS future_core_jobs")
  ) return source;

  const memoryImports = `const { createMemoryRouter, sendMemoryPage } = require("./memory/routes");
const { buildMemoryPrompt } = require("./memory/context");
const { buildProjectCoreMemoryPrompt, getProjectIdentity } = require("./project/identity");`;
  source = replaceExactlyOnce(
    source,
    memoryImports,
    `${memoryImports}
const { createFutureCoreRouter } = require("./orchestration/routes");`,
    "future-core-imports"
  );

  const memoryIndex = `CREATE INDEX IF NOT EXISTS user_memories_user_idx
      ON user_memories(user_id, enabled, updated_at DESC, id DESC);`;
  source = replaceExactlyOnce(
    source,
    memoryIndex,
    `${memoryIndex}

    ${FUTURE_CORE_SCHEMA_SQL.split("\n").join("\n    ")}`,
    "future-core-schema"
  );

  const healthRoute = `app.get("/api/health", (req, res) => {`;
  source = replaceExactlyOnce(
    source,
    healthRoute,
    `function requireFutureCoreV2Enabled(req, res, next) {
  const enabled = String(process.env.UNBOUND_FUTURE_CORE_V2_ENABLED || "").trim().toLowerCase() === "true";
  if (!enabled) return res.status(404).json({ error: "Not found." });
  return next();
}

app.use(
  "/api/future-core-v2",
  requireDatabase,
  requireSignedIn,
  requireCapability("agents"),
  requireFutureCoreV2Enabled,
  createFutureCoreRouter({
    getPool: () => pool,
    estimateProviderCostMicros
  })
);

${healthRoute}`,
    "future-core-api-mount"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  integrateFutureCoreV2ServerSource
};
