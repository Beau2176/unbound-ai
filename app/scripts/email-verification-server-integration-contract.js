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

  assert.strictEqual(INTEGRATION_VERSION, "v0.57");
  assert.strictEqual(count(integrated, 'require("./email/store")'), 1);
  assert.strictEqual(count(integrated, 'require("./email/readiness")'), 1);
  assert.strictEqual(count(integrated, 'require("./email/routes")'), 1);
  assert.strictEqual(count(integrated, 'require("./email/account-page")'), 1);
  assert.strictEqual(count(integrated, 'app.get("/verify-email", sendEmailVerificationPage);'), 1);
  assert.strictEqual(count(integrated, 'app.get("/email-account-ui.js", sendEmailAccountUiScript);'), 1);
  assert.strictEqual(count(integrated, 'app.get("/index.html", sendAccountIndexPage);'), 1);
  assert.strictEqual(count(integrated, 'app.get("/", sendAccountIndexPage);'), 1);
  assert.strictEqual(count(integrated, "await initializeEmailVerificationSchema(pool);"), 1);
  assert.strictEqual(count(integrated, '"/api/email-verification"'), 1);
  assert.strictEqual(count(integrated, "RATE_LIMIT_POLICY.emailVerificationSend"), 1);
  assert.strictEqual(count(integrated, "RATE_LIMIT_POLICY.emailVerificationConsume"), 1);
  assert.match(integrated, /getPool: \(\) => \(databaseReady && pool \? pool : null\)/);
  assert.match(integrated, /sendRateLimit: emailVerificationSendRateLimit/);
  assert.match(integrated, /consumeRateLimit: emailVerificationConsumeRateLimit/);

  assert.strictEqual(
    count(integrated, "const emailDelivery = buildEmailDeliveryReadiness();"),
    1,
    "shared operational snapshot must build email-delivery readiness exactly once"
  );
  assert.strictEqual(count(integrated, "    emailDelivery,\n    ai\n  });"), 1);
  assert.strictEqual(count(integrated, "    emailDelivery,\n    ai,\n    launch,"), 1);
  assert.strictEqual(count(integrated, "emailDelivery: buildEmailDeliveryReadiness(),"), 1);

  const schemaPosition = integrated.indexOf("await initializeEmailVerificationSchema(pool);");
  const userSchemaPosition = integrated.indexOf("CREATE TABLE IF NOT EXISTS users");
  const cleanupPosition = integrated.indexOf("DELETE FROM rate_limit_buckets");
  assert.ok(userSchemaPosition >= 0 && schemaPosition > userSchemaPosition);
  assert.ok(cleanupPosition > schemaPosition);

  const accountSubjectPosition = integrated.indexOf("async function accountRateSubject");
  const routerPosition = integrated.indexOf('"/api/email-verification"');
  assert.ok(routerPosition > accountSubjectPosition);

  new vm.Script(integrated, { filename: "server.integrated.js" });

  assert.throws(
    () => integrateEmailVerificationServerSource(source.replace(
      'app.get("/api/health", (req, res) => {',
      'app.get("/api/health-renamed", (req, res) => {'
    )),
    (error) => error?.code === "EMAIL_SERVER_INTEGRATION_MARKER_MISSING"
  );

  assert.throws(
    () => integrateEmailVerificationServerSource(source.replace(
      'app.get("/index.html", (req, res) => {',
      'app.get("/home.html", (req, res) => {'
    )),
    (error) => error?.code === "EMAIL_SERVER_INTEGRATION_MARKER_MISSING"
  );

  assert.throws(
    () => integrateEmailVerificationServerSource(source.replace(
      '  const ageVerification = getAgeVerificationGatewayStatus();\n  const launch = buildLaunchReadiness({',
      '  const ageVerification = getAgeVerificationGatewayStatus();\n  const launchRenamed = buildLaunchReadiness({'
    )),
    (error) => error?.code === "EMAIL_SERVER_INTEGRATION_MARKER_COUNT_CHANGED"
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
