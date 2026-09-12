const INTEGRATION_VERSION = "v0.54";

function replaceExactlyOnce(source, marker, replacement, label) {
  const firstIndex = source.indexOf(marker);
  const lastIndex = source.lastIndexOf(marker);

  if (firstIndex === -1) {
    const error = new Error(`Email verification integration marker is missing: ${label}.`);
    error.code = "EMAIL_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }

  if (firstIndex !== lastIndex) {
    const error = new Error(`Email verification integration marker is ambiguous: ${label}.`);
    error.code = "EMAIL_SERVER_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }

  return source.slice(0, firstIndex) + replacement + source.slice(firstIndex + marker.length);
}

function integrateEmailVerificationServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "EMAIL_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  const importMarker = 'const { buildLaunchReadiness } = require("./ops/launch-readiness");';
  source = replaceExactlyOnce(
    source,
    importMarker,
    `${importMarker}\nconst { initializeEmailVerificationSchema } = require("./email/store");\nconst {\n  createEmailVerificationRouter,\n  sendEmailVerificationPage\n} = require("./email/routes");`,
    "imports"
  );

  const pageMarker = 'app.get("/unbound-cosmic.png", (req, res) => {';
  source = replaceExactlyOnce(
    source,
    pageMarker,
    `app.get("/verify-email", sendEmailVerificationPage);\n\n${pageMarker}`,
    "verification-page-route"
  );

  const schemaMarker = '  await pool.query(`\n    DELETE FROM rate_limit_buckets';
  source = replaceExactlyOnce(
    source,
    schemaMarker,
    `  await initializeEmailVerificationSchema(pool);\n\n${schemaMarker}`,
    "database-schema"
  );

  const apiMarker = 'app.get("/api/health", (req, res) => {';
  const apiIntegration = `const emailVerificationSendRateLimit = rateLimitMiddleware({\n  policy: RATE_LIMIT_POLICY.emailVerificationSend,\n  subjectResolver: accountRateSubject\n});\nconst emailVerificationConsumeRateLimit = rateLimitMiddleware({\n  policy: RATE_LIMIT_POLICY.emailVerificationConsume,\n  subjectResolver: async (req, res) => ({\n    kind: "guest_browser",\n    value: ensureGuestRateToken(req, res)\n  })\n});\n\napp.use(\n  "/api/email-verification",\n  createEmailVerificationRouter({\n    getPool: () => (databaseReady && pool ? pool : null),\n    findSessionUser,\n    sendRateLimit: emailVerificationSendRateLimit,\n    consumeRateLimit: emailVerificationConsumeRateLimit\n  })\n);\n\n${apiMarker}`;
  source = replaceExactlyOnce(source, apiMarker, apiIntegration, "api-router");

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  integrateEmailVerificationServerSource,
  replaceExactlyOnce
};
