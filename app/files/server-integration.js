const INTEGRATION_VERSION = "v0.63";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`File-analysis integration marker is missing: ${label}.`);
    error.code = "FILE_ANALYSIS_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`File-analysis integration marker is ambiguous: ${label}.`);
    error.code = "FILE_ANALYSIS_SERVER_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integrateFileAnalysisServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "FILE_ANALYSIS_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  const launchImport = `const { buildLaunchReadiness } = require("./ops/launch-readiness");`;
  source = replaceExactlyOnce(
    source,
    launchImport,
    `${launchImport}\nconst {\n  createFileAnalysisRouter,\n  sendFileAnalysisPage,\n  sendFileAwareIndex\n} = require("./files/routes");`,
    "file-analysis-import"
  );

  const jsonParserMiddleware = `app.use((req, res, next) => {\n  if (RAW_WEBHOOK_PATHS.has(req.path)) return next();\n  return jsonBodyParser(req, res, next);\n});`;
  source = replaceExactlyOnce(
    source,
    jsonParserMiddleware,
    `app.use((req, res, next) => {\n  const fileAnalysisPath =\n    req.path === "/api/file-analysis" ||\n    req.path.startsWith("/api/file-analysis/");\n  if (RAW_WEBHOOK_PATHS.has(req.path) || fileAnalysisPath) return next();\n  return jsonBodyParser(req, res, next);\n});`,
    "file-analysis-json-parser-bypass"
  );

  const accountIndexRoutes = `app.get("/index.html", sendAccountIndexPage);\napp.get("/email-account-ui.js", sendEmailAccountUiScript);`;
  source = replaceExactlyOnce(
    source,
    accountIndexRoutes,
    `app.get("/index.html", sendFileAwareIndex);\napp.get("/email-account-ui.js", sendEmailAccountUiScript);\napp.get("/files.html", sendFileAnalysisPage);`,
    "file-analysis-page-routes"
  );

  const researchRateLimit = `const researchRateLimit = rateLimitMiddleware({\n  policy: RATE_LIMIT_POLICY.research,\n  subjectResolver: accountRateSubject,\n  when: async (req) => normalizeProductMode(req.body?.productMode) === "research"\n});`;
  source = replaceExactlyOnce(
    source,
    researchRateLimit,
    `${researchRateLimit}\nconst fileAnalysisRateLimit = rateLimitMiddleware({\n  policy: RATE_LIMIT_POLICY.fileAnalysis,\n  subjectResolver: accountRateSubject\n});`,
    "file-analysis-rate-limit"
  );

  const healthRoute = `app.get("/api/health", (req, res) => {`;
  source = replaceExactlyOnce(
    source,
    healthRoute,
    `app.use(\n  "/api/file-analysis",\n  requireDatabase,\n  requireSignedIn,\n  fileAnalysisRateLimit,\n  requireCapability("file_analysis"),\n  createFileAnalysisRouter({\n    recordUsageEvent,\n    estimateProviderCostMicros\n  })\n);\n\n${healthRoute}`,
    "file-analysis-api-mount"
  );

  source = replaceExactlyOnce(
    source,
    `app.get("/", sendAccountIndexPage);`,
    `app.get("/", sendFileAwareIndex);`,
    "file-analysis-root-route"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  integrateFileAnalysisServerSource
};
