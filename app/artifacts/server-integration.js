const INTEGRATION_VERSION = "wave-14-artifact-studio";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Artifact Studio integration marker is missing: ${label}.`);
    error.code = "ARTIFACT_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Artifact Studio integration marker is ambiguous: ${label}.`);
    error.code = "ARTIFACT_SERVER_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integrateArtifactServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "ARTIFACT_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  const fileImport = `const {
  createFileAnalysisRouter,
  sendFileAnalysisPage,
  sendFileAwareIndex
} = require("./files/routes");`;
  source = replaceExactlyOnce(
    source,
    fileImport,
    `${fileImport}
const {
  createArtifactRouter,
  sendArtifactStudioPage
} = require("./artifacts/routes");`,
    "artifact-import"
  );

  const parserBlock = `app.use((req, res, next) => {
  const fileAnalysisPath =
    req.path === "/api/file-analysis" ||
    req.path.startsWith("/api/file-analysis/");
  if (RAW_WEBHOOK_PATHS.has(req.path) || fileAnalysisPath) return next();
  return jsonBodyParser(req, res, next);
});`;
  source = replaceExactlyOnce(
    source,
    parserBlock,
    `app.use((req, res, next) => {
  const fileAnalysisPath =
    req.path === "/api/file-analysis" ||
    req.path.startsWith("/api/file-analysis/");
  const artifactPath =
    req.path === "/api/artifacts" ||
    req.path.startsWith("/api/artifacts/");
  if (RAW_WEBHOOK_PATHS.has(req.path) || fileAnalysisPath || artifactPath) return next();
  return jsonBodyParser(req, res, next);
});`,
    "artifact-json-parser-bypass"
  );

  source = replaceExactlyOnce(
    source,
    `app.get("/files.html", sendFileAnalysisPage);`,
    `app.get("/files.html", sendFileAnalysisPage);
app.get("/artifact-studio.html", sendArtifactStudioPage);`,
    "artifact-page-route"
  );

  const fileLimit = `const fileAnalysisRateLimit = rateLimitMiddleware({
  policy: RATE_LIMIT_POLICY.fileAnalysis,
  subjectResolver: accountRateSubject
});`;
  source = replaceExactlyOnce(
    source,
    fileLimit,
    `${fileLimit}
const artifactRateLimit = rateLimitMiddleware({
  policy: RATE_LIMIT_POLICY.artifacts,
  subjectResolver: accountRateSubject
});`,
    "artifact-rate-limit"
  );

  const healthRoute = `app.get("/api/health", (req, res) => {`;
  source = replaceExactlyOnce(
    source,
    healthRoute,
    `app.use(
  "/api/artifacts",
  requireDatabase,
  requireSignedIn,
  artifactRateLimit,
  requireCapability("artifact_creation"),
  createArtifactRouter({
    recordUsageEvent,
    estimateProviderCostMicros
  })
);

${healthRoute}`,
    "artifact-api-mount"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  integrateArtifactServerSource
};
