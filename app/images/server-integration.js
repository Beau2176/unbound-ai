const INTEGRATION_VERSION = "v0.64";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Image-understanding integration marker is missing: ${label}.`);
    error.code = "IMAGE_UNDERSTANDING_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Image-understanding integration marker is ambiguous: ${label}.`);
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
    `${fileImport}\nconst {\n  createImageUnderstandingRouter,\n  sendImageUnderstandingPage\n} = require("./images/routes");`,
    "image-understanding-import"
  );

  const fileParserBypass = `app.use((req, res, next) => {\n  const fileAnalysisPath =\n    req.path === "/api/file-analysis" ||\n    req.path.startsWith("/api/file-analysis/");\n  if (RAW_WEBHOOK_PATHS.has(req.path) || fileAnalysisPath) return next();\n  return jsonBodyParser(req, res, next);\n});`;
  source = replaceExactlyOnce(
    source,
    fileParserBypass,
    `app.use((req, res, next) => {\n  const fileAnalysisPath =\n    req.path === "/api/file-analysis" ||\n    req.path.startsWith("/api/file-analysis/");\n  const imageUnderstandingPath =\n    req.path === "/api/image-understanding" ||\n    req.path.startsWith("/api/image-understanding/");\n  if (RAW_WEBHOOK_PATHS.has(req.path) || fileAnalysisPath || imageUnderstandingPath) return next();\n  return jsonBodyParser(req, res, next);\n});`,
    "image-understanding-json-parser-bypass"
  );

  source = replaceExactlyOnce(
    source,
    `app.get("/files.html", sendFileAnalysisPage);`,
    `app.get("/files.html", sendFileAnalysisPage);\napp.get("/images.html", sendImageUnderstandingPage);`,
    "image-understanding-page-route"
  );

  const fileRateLimit = `const fileAnalysisRateLimit = rateLimitMiddleware({\n  policy: RATE_LIMIT_POLICY.fileAnalysis,\n  subjectResolver: accountRateSubject\n});`;
  source = replaceExactlyOnce(
    source,
    fileRateLimit,
    `${fileRateLimit}\nconst imageUnderstandingRateLimit = rateLimitMiddleware({\n  policy: RATE_LIMIT_POLICY.imageUnderstanding,\n  subjectResolver: accountRateSubject\n});`,
    "image-understanding-rate-limit"
  );

  const healthRoute = `app.get("/api/health", (req, res) => {`;
  source = replaceExactlyOnce(
    source,
    healthRoute,
    `app.use(\n  "/api/image-understanding",\n  requireDatabase,\n  requireSignedIn,\n  imageUnderstandingRateLimit,\n  requireCapability("image_understanding"),\n  createImageUnderstandingRouter({\n    recordUsageEvent,\n    estimateProviderCostMicros\n  })\n);\n\n${healthRoute}`,
    "image-understanding-api-mount"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  integrateImageUnderstandingServerSource
};
