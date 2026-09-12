const INTEGRATION_VERSION = "v0.65";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Image integration marker is missing: ${label}.`);
    error.code = "IMAGE_UNDERSTANDING_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Image integration marker is ambiguous: ${label}.`);
    error.code = "IMAGE_UNDERSTANDING_SERVER_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integrateImageUnderstandingServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "IMAGE_UNDERSTANDING_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  const fileImport = `const {\n  createFileAnalysisRouter,\n  sendFileAnalysisPage,\n  sendFileAwareIndex\n} = require("./files/routes");`;
  source = replaceExactlyOnce(
    source,
    fileImport,
    `${fileImport}\nconst {\n  createImageUnderstandingRouter,\n  sendImageUnderstandingPage\n} = require("./images/routes");\nconst {\n  createImageToolsRouter,\n  sendImageToolsPage\n} = require("./images/tools-routes");`,
    "image-imports"
  );

  const fileParserBypass = `app.use((req, res, next) => {\n  const fileAnalysisPath =\n    req.path === "/api/file-analysis" ||\n    req.path.startsWith("/api/file-analysis/");\n  if (RAW_WEBHOOK_PATHS.has(req.path) || fileAnalysisPath) return next();\n  return jsonBodyParser(req, res, next);\n});`;
  source = replaceExactlyOnce(
    source,
    fileParserBypass,
    `app.use((req, res, next) => {\n  const fileAnalysisPath =\n    req.path === "/api/file-analysis" ||\n    req.path.startsWith("/api/file-analysis/");\n  const imageUnderstandingPath =\n    req.path === "/api/image-understanding" ||\n    req.path.startsWith("/api/image-understanding/");\n  const imageToolsPath =\n    req.path === "/api/image-tools" ||\n    req.path.startsWith("/api/image-tools/");\n  if (\n    RAW_WEBHOOK_PATHS.has(req.path) ||\n    fileAnalysisPath ||\n    imageUnderstandingPath ||\n    imageToolsPath\n  ) return next();\n  return jsonBodyParser(req, res, next);\n});`,
    "image-json-parser-bypass"
  );

  source = replaceExactlyOnce(
    source,
    `app.get("/files.html", sendFileAnalysisPage);`,
    `app.get("/files.html", sendFileAnalysisPage);\napp.get("/images.html", sendImageUnderstandingPage);\napp.get("/image-tools.html", sendImageToolsPage);`,
    "image-page-routes"
  );

  const fileRateLimit = `const fileAnalysisRateLimit = rateLimitMiddleware({\n  policy: RATE_LIMIT_POLICY.fileAnalysis,\n  subjectResolver: accountRateSubject\n});`;
  source = replaceExactlyOnce(
    source,
    fileRateLimit,
    `${fileRateLimit}\nconst imageUnderstandingRateLimit = rateLimitMiddleware({\n  policy: RATE_LIMIT_POLICY.imageUnderstanding,\n  subjectResolver: accountRateSubject\n});\nconst imageToolsRateLimit = rateLimitMiddleware({\n  policy: RATE_LIMIT_POLICY.imageTools,\n  subjectResolver: accountRateSubject\n});`,
    "image-rate-limits"
  );

  const healthRoute = `app.get("/api/health", (req, res) => {`;
  source = replaceExactlyOnce(
    source,
    healthRoute,
    `app.use(\n  "/api/image-understanding",\n  requireDatabase,\n  requireSignedIn,\n  imageUnderstandingRateLimit,\n  requireCapability("image_understanding"),\n  createImageUnderstandingRouter({\n    recordUsageEvent,\n    estimateProviderCostMicros\n  })\n);\n\napp.use(\n  "/api/image-tools",\n  requireDatabase,\n  requireSignedIn,\n  imageToolsRateLimit,\n  requireCapability("image_tools"),\n  createImageToolsRouter({\n    recordUsageEvent\n  })\n);\n\n${healthRoute}`,
    "image-api-mounts"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  integrateImageUnderstandingServerSource
};
