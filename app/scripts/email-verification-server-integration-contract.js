const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  INTEGRATION_VERSION,
  integrateEmailVerificationServerSource
} = require("../email/server-integration");

function count(source, needle) {
  return source.split(needle).length - 1;
}

function main() {
  const appRoot = path.resolve(__dirname, "..");
  const serverPath = path.join(appRoot, "server.js");
  const source = fs.readFileSync(serverPath, "utf8");
  const integrated = integrateEmailVerificationServerSource(source);

  assert.strictEqual(INTEGRATION_VERSION, "v0.54");
  assert.strictEqual(
    count(integrated, 'require("./email/store")'),
    1,
    "email verification store import must be injected exactly once"
  );
  assert.strictEqual(
    count(integrated, 'require("./email/routes")'),
    1,
    "email verification route import must be injected exactly once"
  );
  assert.strictEqual(
    count(integrated, 'app.get("/verify-email", sendEmailVerificationPage);'),
    1,
    "verification landing page must be mounted exactly once"
  );
  assert.strictEqual(
    count(integrated, "await initializeEmailVerificationSchema(pool);"),
    1,
    "verification schema initialization must run exactly once"
  );
  assert.strictEqual(
    count(integrated, '"/api/email-verification"'),
    1,
    "email verification API router must be mounted exactly once"
  );
  assert.strictEqual(
    count(integrated, "RATE_LIMIT_POLICY.emailVerificationSend"),
    1,
    "verification sends must use their dedicated policy"
  );
  assert.strictEqual(
    count(integrated, "RATE_LIMIT_POLICY.emailVerificationConsume"),
    1,
    "verification link consumption must use its dedicated policy"
  );
  assert.match(integrated, /getPool: \(\) => \(databaseReady && pool \? pool : null\)/);
  assert.match(integrated, /findSessionUser,/);
  assert.match(integrated, /sendRateLimit: emailVerificationSendRateLimit/);
  assert.match(integrated, /consumeRateLimit: emailVerificationConsumeRateLimit/);

  const schemaPosition = integrated.indexOf("await initializeEmailVerificationSchema(pool);");
  const userSchemaPosition = integrated.indexOf("CREATE TABLE IF NOT EXISTS users");
  const cleanupPosition = integrated.indexOf("DELETE FROM rate_limit_buckets");
  assert.ok(userSchemaPosition >= 0 && schemaPosition > userSchemaPosition);
  assert.ok(cleanupPosition > schemaPosition, "verification schema must be initialized before cleanup and readiness");

  const accountSubjectPosition = integrated.indexOf("async function accountRateSubject");
  const routerPosition = integrated.indexOf('"/api/email-verification"');
  assert.ok(routerPosition > accountSubjectPosition, "router must mount only after account/session rate helpers exist");

  new vm.Script(integrated, { filename: "server.integrated.js" });

  assert.throws(
    () => integrateEmailVerificationServerSource(source.replace(
      'app.get("/api/health", (req, res) => {',
      'app.get("/api/health-renamed", (req, res) => {'
    )),
    (error) => error?.code === "EMAIL_SERVER_INTEGRATION_MARKER_MISSING"
  );

  const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
  assert.strictEqual(packageJson.scripts.start, "node start.js");

  const startSource = fs.readFileSync(path.join(appRoot, "start.js"), "utf8");
  assert.match(startSource, /integrateEmailVerificationServerSource/);
  assert.match(startSource, /runtimeModule\._compile\(integratedSource, serverPath\)/);

  const rateLimitSource = fs.readFileSync(path.join(appRoot, "security", "rate-limit.js"), "utf8");
  assert.match(rateLimitSource, /emailVerificationSend/);
  assert.match(rateLimitSource, /email_verification_send/);
  assert.match(rateLimitSource, /emailVerificationConsume/);
  assert.match(rateLimitSource, /email_verification_consume/);

  console.log("Email verification server integration contract passed.");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
