const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { integrateEmailVerificationServerSource } = require("../email/server-integration");
const { integrateBillingServerSource } = require("../billing/server-integration");
const { integrateFileAnalysisServerSource } = require("../files/server-integration");
const { integrateArtifactServerSource } = require("../artifacts/server-integration");
const {
  INTEGRATION_VERSION,
  integrateImageUnderstandingServerSource
} = require("../images/server-integration");

function count(text, needle) {
  return String(text).split(needle).length - 1;
}

function buildFileIntegratedSource() {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  return integrateFileAnalysisServerSource(
    integrateBillingServerSource(
      integrateEmailVerificationServerSource(source)
    )
  );
}

function expectCode(fn, code) {
  let thrown = null;
  try { fn(); } catch (error) { thrown = error; }
  assert.ok(thrown, `Expected ${code} to be thrown.`);
  assert.strictEqual(thrown.code, code);
}

function main() {
  assert.strictEqual(INTEGRATION_VERSION, "v0.65");
  const fileIntegrated = buildFileIntegratedSource();
  const integrated = integrateImageUnderstandingServerSource(fileIntegrated);

  assert.strictEqual(count(integrated, 'require("./images/routes")'), 1);
  assert.strictEqual(count(integrated, 'app.get("/images.html", sendImageUnderstandingPage);'), 1);
  assert.strictEqual(count(integrated, 'policy: RATE_LIMIT_POLICY.imageUnderstanding'), 1);
  assert.strictEqual(count(integrated, 'requireCapability("image_understanding")'), 1);
  assert.strictEqual(count(integrated, 'createImageUnderstandingRouter({'), 1);
  assert.strictEqual(count(integrated, 'req.path === "/api/image-understanding"'), 1);
  assert.strictEqual(count(integrated, 'app.get("/files.html", sendFileAnalysisPage);'), 1);
  assert.strictEqual(count(integrated, 'app.get("/", sendFileAwareIndex);'), 1);

  const mount = integrated.indexOf('app.use(\n  "/api/image-understanding"');
  assert.ok(mount >= 0);
  const signedIn = integrated.indexOf("requireSignedIn", mount);
  const rateLimit = integrated.indexOf("imageUnderstandingRateLimit", mount);
  const capability = integrated.indexOf('requireCapability("image_understanding")', mount);
  const router = integrated.indexOf("createImageUnderstandingRouter({", mount);
  assert.ok(signedIn > mount);
  assert.ok(rateLimit > signedIn);
  assert.ok(capability > rateLimit);
  assert.ok(router > capability);

  assert.ok(
    integrated.indexOf('const imageUnderstandingPath =') < integrated.indexOf('app.use("/api", createMaintenanceMiddleware());'),
    "Image-understanding JSON parser bypass must be installed before API routes."
  );

  new vm.Script(`(function(require,module,exports,__dirname,__filename){\n${integrated}\n})`);

  const artifactIntegrated = integrateArtifactServerSource(fileIntegrated);
  const combinedIntegrated = integrateImageUnderstandingServerSource(artifactIntegrated);
  assert.strictEqual(count(combinedIntegrated, 'req.path === "/api/artifacts"'), 1);
  assert.strictEqual(count(combinedIntegrated, 'req.path === "/api/image-understanding"'), 1);
  assert.strictEqual(count(combinedIntegrated, 'req.path === "/api/image-tools"'), 1);
  assert.ok(combinedIntegrated.includes("artifactPath ||"));
  assert.ok(combinedIntegrated.includes("imageUnderstandingPath ||"));

  expectCode(
    () => integrateImageUnderstandingServerSource(
      fileIntegrated.replace(
        'app.get("/files.html", sendFileAnalysisPage);',
        'app.get("/files-v2.html", sendFileAnalysisPage);'
      )
    ),
    "IMAGE_UNDERSTANDING_SERVER_INTEGRATION_MARKER_MISSING"
  );

  const startSource = fs.readFileSync(path.join(__dirname, "..", "start.js"), "utf8");
  const emailIndex = startSource.indexOf("integrateEmailVerificationServerSource(source)");
  const billingIndex = startSource.indexOf("integrateBillingServerSource(emailIntegratedSource)");
  const fileIndex = startSource.indexOf("integrateFileAnalysisServerSource(billingIntegratedSource)");
  const artifactIndex = startSource.indexOf("integrateArtifactServerSource(fileIntegratedSource)");
  const imageIndex = startSource.indexOf("integrateImageUnderstandingServerSource(artifactIntegratedSource)");
  assert.ok(
    emailIndex >= 0 &&
    billingIndex > emailIndex &&
    fileIndex > billingIndex &&
    artifactIndex > fileIndex &&
    imageIndex > artifactIndex
  );
  assert.ok(startSource.includes("runtimeModule._compile(integratedSource, serverPath)"));

  console.log("UNBOUND AI image-understanding server integration checks passed.");
}

main();
