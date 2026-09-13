const INTEGRATION_VERSION = "v0.70";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Voice integration marker is missing: ${label}.`);
    error.code = "VOICE_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Voice integration marker is ambiguous: ${label}.`);
    error.code = "VOICE_SERVER_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integrateVoiceServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "VOICE_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  const imageToolsImport = `const {\n  createImageToolsRouter,\n  sendImageToolsPage\n} = require("./images/tools-routes");`;
  source = replaceExactlyOnce(
    source,
    imageToolsImport,
    `${imageToolsImport}\nconst {\n  createVoiceRouter,\n  sendVoicePage\n} = require("./voice/routes");`,
    "voice-import"
  );

  source = replaceExactlyOnce(
    source,
    `app.get("/image-tools.html", sendImageToolsPage);`,
    `app.get("/image-tools.html", sendImageToolsPage);\napp.get("/voice.html", sendVoicePage);`,
    "voice-page-route"
  );

  const imageToolsRateLimit = `const imageToolsRateLimit = rateLimitMiddleware({\n  policy: RATE_LIMIT_POLICY.imageTools,\n  subjectResolver: accountRateSubject\n});`;
  source = replaceExactlyOnce(
    source,
    imageToolsRateLimit,
    `${imageToolsRateLimit}\nconst voiceSessionRateLimit = rateLimitMiddleware({\n  policy: RATE_LIMIT_POLICY.voiceSessions,\n  subjectResolver: accountRateSubject\n});`,
    "voice-rate-limit"
  );

  const healthRoute = `app.get("/api/health", (req, res) => {`;
  source = replaceExactlyOnce(
    source,
    healthRoute,
    `app.use(\n  "/api/voice",\n  requireDatabase,\n  requireSignedIn,\n  voiceSessionRateLimit,\n  requireCapability("voice"),\n  createVoiceRouter()\n);\n\n${healthRoute}`,
    "voice-api-mount"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  integrateVoiceServerSource
};
