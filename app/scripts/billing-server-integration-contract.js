const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { integrateEmailVerificationServerSource } = require("../email/server-integration");
const { INTEGRATION_VERSION, integrateBillingServerSource } = require("../billing/server-integration");

function count(source, needle) {
  return source.split(needle).length - 1;
}

function main() {
  const appRoot = path.resolve(__dirname, "..");
  const rawServer = fs.readFileSync(path.join(appRoot, "server.js"), "utf8");
  const emailIntegrated = integrateEmailVerificationServerSource(rawServer);
  const integrated = integrateBillingServerSource(emailIntegrated);

  assert.strictEqual(INTEGRATION_VERSION, "v0.94");
  assert.match(integrated, /const requestedPlan = normalizePlanTier\(req\.body\?\.planTier\)/);
  assert.match(integrated, /\["premium", "ultra"\]\.includes\(requestedPlan\)/);
  assert.match(integrated, /planTier: requestedPlan/);
  assert.match(integrated, /VALUES \(\$1, \$2, 'incomplete', \$3, \$4, NOW\(\), NOW\(\)\)/);
  assert.match(integrated, /plan_tier = EXCLUDED\.plan_tier/);
  assert.match(integrated, /plan_tier = COALESCE\(\$5, plan_tier\)/);
  assert.match(integrated, /BILLING_ACTIVE_PLAN_CHANGE_REQUIRES_PORTAL/);
  assert.doesNotMatch(integrated, /This account already has TOP access/);

  assert.strictEqual(count(integrated, "function sendBillingWebhookSuccess"), 1);
  assert.strictEqual(count(integrated, "function billingWebhookPayloadBuffer"), 1);
  assert.strictEqual(count(integrated, `app.all(\n  BILLING_WEBHOOK_PATH,`), 1);
  assert.strictEqual(count(integrated, `app.post(\n  BILLING_WEBHOOK_PATH,`), 0);
  assert.strictEqual(count(integrated, `app.post(\n  AGE_VERIFICATION_WEBHOOK_PATH,`), 1);
  assert.strictEqual(count(integrated, "query: req.query,"), 1);
  assert.strictEqual(count(integrated, 'type("text/plain").send("OK")'), 1);
  assert.strictEqual(count(integrated, "return sendBillingWebhookSuccess(res, 200);"), 3);
  assert.strictEqual(count(integrated, "return sendBillingWebhookSuccess(res, 202);"), 1);

  const billingStart = integrated.indexOf("function sendBillingWebhookSuccess");
  const ageStart = integrated.indexOf('app.post(\n  AGE_VERIFICATION_WEBHOOK_PATH,');
  assert.ok(billingStart >= 0 && ageStart > billingStart);
  const billingBlock = integrated.slice(billingStart, ageStart);
  assert.match(billingBlock, /billingWebhookPayloadBuffer\(req\)/);
  assert.match(billingBlock, /processBillingWebhook\(\{[\s\S]*query: req\.query/);

  new vm.Script(integrated, { filename: "server.billing-integrated.js" });

  assert.throws(
    () => integrateBillingServerSource(emailIntegrated.replace(
      `app.post(\n  BILLING_WEBHOOK_PATH,`,
      `app.post(\n  BILLING_WEBHOOK_PATH_RENAMED,`
    )),
    (error) => error?.code === "BILLING_SERVER_INTEGRATION_BLOCK_MISSING"
  );

  const startSource = fs.readFileSync(path.join(appRoot, "start.js"), "utf8");
  assert.match(startSource, /integrateEmailVerificationServerSource/);
  assert.match(startSource, /integrateBillingServerSource/);
  assert.match(startSource, /integrateFileAnalysisServerSource/);
  assert.match(startSource, /integrateImageUnderstandingServerSource/);
  assert.match(startSource, /integrateAbuseEvidenceServerSource/);
  assert.match(startSource, /runtimeModule\._compile\(integratedSource, serverPath\)/);

  console.log("Billing three-tier server integration contract passed.");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
