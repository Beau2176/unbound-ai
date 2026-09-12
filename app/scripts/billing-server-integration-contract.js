const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  integrateEmailVerificationServerSource
} = require("../email/server-integration");
const {
  INTEGRATION_VERSION,
  integrateBillingServerSource
} = require("../billing/server-integration");

function count(source, needle) {
  return source.split(needle).length - 1;
}

function main() {
  const appRoot = path.resolve(__dirname, "..");
  const rawServer = fs.readFileSync(path.join(appRoot, "server.js"), "utf8");
  const emailIntegrated = integrateEmailVerificationServerSource(rawServer);
  const integrated = integrateBillingServerSource(emailIntegrated);

  assert.strictEqual(INTEGRATION_VERSION, "v0.59");
  assert.strictEqual(count(integrated, "function sendBillingWebhookSuccess"), 1);
  assert.strictEqual(count(integrated, "function billingWebhookPayloadBuffer"), 1);
  assert.strictEqual(
    count(integrated, `app.all(\n  BILLING_WEBHOOK_PATH,`),
    1,
    "billing webhook must accept both GET and POST"
  );
  assert.strictEqual(count(integrated, `app.post(\n  BILLING_WEBHOOK_PATH,`), 0);
  assert.strictEqual(
    count(integrated, `app.post(\n  AGE_VERIFICATION_WEBHOOK_PATH,`),
    1,
    "billing integration must not alter age-verification webhook method"
  );
  assert.strictEqual(count(integrated, "query: req.query,"), 1);
  assert.strictEqual(count(integrated, 'type("text/plain").send("OK")'), 1);
  assert.strictEqual(
    count(integrated, "return sendBillingWebhookSuccess(res, 200);"),
    3,
    "duplicate, stale, and processed billing successes should acknowledge with OK"
  );
  assert.strictEqual(count(integrated, "return sendBillingWebhookSuccess(res, 202);"), 1);

  const billingStart = integrated.indexOf("function sendBillingWebhookSuccess");
  const ageStart = integrated.indexOf('app.post(\n  AGE_VERIFICATION_WEBHOOK_PATH,');
  assert.ok(billingStart >= 0 && ageStart > billingStart);
  const billingBlock = integrated.slice(billingStart, ageStart);
  assert.match(billingBlock, /billingWebhookPayloadBuffer\(req\)/);
  assert.match(billingBlock, /processBillingWebhook\(\{[\s\S]*query: req\.query/);
  assert.doesNotMatch(billingBlock, /duplicate: true/);
  assert.doesNotMatch(billingBlock, /accepted: true/);
  assert.doesNotMatch(billingBlock, /ignored: true, reason: "stale-event"/);

  new vm.Script(integrated, { filename: "server.billing-integrated.js" });

  assert.throws(
    () => integrateBillingServerSource(emailIntegrated.replace(
      `app.post(\n  BILLING_WEBHOOK_PATH,`,
      `app.post(\n  BILLING_WEBHOOK_PATH_RENAMED,`
    )),
    (error) => error?.code === "BILLING_SERVER_INTEGRATION_BLOCK_MISSING"
  );

  assert.throws(
    () => integrateBillingServerSource(emailIntegrated.replace(
      `      event = await processBillingWebhook({\n        rawBody,\n        headers: req.headers,`,
      `      event = await processBillingWebhook({\n        rawBody,\n        billingHeaders: req.headers,`
    )),
    (error) => error?.code === "BILLING_SERVER_INTEGRATION_MARKER_MISSING"
  );

  const startSource = fs.readFileSync(path.join(appRoot, "start.js"), "utf8");
  assert.match(startSource, /integrateEmailVerificationServerSource/);
  assert.match(startSource, /integrateBillingServerSource/);
  assert.match(startSource, /integrateFileAnalysisServerSource/);
  assert.match(startSource, /integrateImageUnderstandingServerSource/);
  assert.match(
    startSource,
    /emailIntegratedSource = integrateEmailVerificationServerSource\(source\)[\s\S]*billingIntegratedSource = integrateBillingServerSource\(emailIntegratedSource\)[\s\S]*fileIntegratedSource = integrateFileAnalysisServerSource\(billingIntegratedSource\)[\s\S]*integratedSource = integrateImageUnderstandingServerSource\(fileIntegratedSource\)/
  );
  assert.match(startSource, /runtimeModule\._compile\(integratedSource, serverPath\)/);

  console.log("Billing server integration contract passed.");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
