const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  integrateEmailVerificationServerSource
} = require("../email/server-integration");
const {
  integrateBillingServerSource
} = require("../billing/server-integration");
const {
  INTEGRATION_VERSION,
  integrateFileAnalysisServerSource
} = require("../files/server-integration");

function count(text, needle) {
  return String(text).split(needle).length - 1;
}

function buildIntegratedSource() {
  const serverPath = path.join(__dirname, "..", "server.js");
  const source = fs.readFileSync(serverPath, "utf8");
  return integrateFileAnalysisServerSource(
    integrateBillingServerSource(
      integrateEmailVerificationServerSource(source)
    )
  );
}

function expectCode(fn, code) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, `Expected ${code} to be thrown.`);
  assert.strictEqual(thrown.code, code);
}

function main() {
  assert.strictEqual(INTEGRATION_VERSION, "v0.63");
  const integrated = buildIntegratedSource();

  assert.strictEqual(count(integrated, 'require("./files/routes")'), 1);
  assert.strictEqual(count(integrated, 'app.get("/files.html", sendFileAnalysisPage);'), 1);
  assert.strictEqual(count(integrated, 'app.get("/index.html", sendFileAwareIndex);'), 1);
  assert.strictEqual(count(integrated, 'app.get("/", sendFileAwareIndex);'), 1);
  assert.strictEqual(count(integrated, 'app.get("/email-account-ui.js", sendEmailAccountUiScript);'), 1);
  assert.strictEqual(count(integrated, 'policy: RATE_LIMIT_POLICY.fileAnalysis'), 1);
  assert.strictEqual(count(integrated, 'requireCapability("file_analysis")'), 1);
  assert.strictEqual(count(integrated, 'createFileAnalysisRouter({'), 1);
  assert.strictEqual(count(integrated, 'req.path === "/api/file-analysis"'), 1);

  const mount = integrated.indexOf('app.use(\n  "/api/file-analysis"');
  assert.ok(mount >= 0);
  const signedIn = integrated.indexOf("requireSignedIn", mount);
  const rateLimit = integrated.indexOf("fileAnalysisRateLimit", mount);
  const capability = integrated.indexOf('requireCapability("file_analysis")', mount);
  const router = integrated.indexOf("createFileAnalysisRouter({", mount);
  assert.ok(signedIn > mount);
  assert.ok(rateLimit > signedIn);
  assert.ok(capability > rateLimit);
  assert.ok(router > capability);

  assert.ok(
    integrated.indexOf('const fileAnalysisPath =') < integrated.indexOf('app.use("/api", createMaintenanceMiddleware());'),
    "File-analysis JSON parser bypass must be installed before API routes."
  );

  new vm.Script(`(function(require,module,exports,__dirname,__filename){\n${integrated}\n})`);

  const emailThenBilling = integrateBillingServerSource(
    integrateEmailVerificationServerSource(
      fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8")
    )
  );
  expectCode(
    () => integrateFileAnalysisServerSource(
      emailThenBilling.replace(
        'app.get("/index.html", sendAccountIndexPage);',
        'app.get("/index.html", changedAccountIndexPage);'
      )
    ),
    "FILE_ANALYSIS_SERVER_INTEGRATION_MARKER_MISSING"
  );

  const startSource = fs.readFileSync(path.join(__dirname, "..", "start.js"), "utf8");
  const emailIndex = startSource.indexOf("integrateEmailVerificationServerSource(source)");
  const billingIndex = startSource.indexOf("integrateBillingServerSource(emailIntegratedSource)");
  const fileIndex = startSource.indexOf("integrateFileAnalysisServerSource(billingIntegratedSource)");
  assert.ok(emailIndex >= 0 && billingIndex > emailIndex && fileIndex > billingIndex);

  console.log("UNBOUND AI file-analysis server integration checks passed.");
}

main();
