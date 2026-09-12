const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { integrateEmailVerificationServerSource } = require("../email/server-integration");
const { integrateBillingServerSource } = require("../billing/server-integration");
const { integrateFileAnalysisServerSource } = require("../files/server-integration");
const {
  INTEGRATION_VERSION,
  integrateImageUnderstandingServerSource
} = require("../images/server-integration");

function count(text, needle) {
  return String(text).split(needle).length - 1;
}

function buildIntegratedSource() {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  return integrateImageUnderstandingServerSource(
    integrateFileAnalysisServerSource(
      integrateBillingServerSource(
        integrateEmailVerificationServerSource(source)
      )
    )
  );
}

function main() {
  assert.strictEqual(INTEGRATION_VERSION, "v0.65");
  const integrated = buildIntegratedSource();

  assert.strictEqual(count(integrated, 'require("./images/tools-routes")'), 1);
  assert.strictEqual(count(integrated, 'app.get("/image-tools.html", sendImageToolsPage);'), 1);
  assert.strictEqual(count(integrated, 'policy: RATE_LIMIT_POLICY.imageTools'), 1);
  assert.strictEqual(count(integrated, 'requireCapability("image_tools")'), 1);
  assert.strictEqual(count(integrated, 'createImageToolsRouter({'), 1);
  assert.strictEqual(count(integrated, 'req.path === "/api/image-tools"'), 1);

  const mount = integrated.indexOf('app.use(\n  "/api/image-tools"');
  assert.ok(mount >= 0);
  const database = integrated.indexOf("requireDatabase", mount);
  const signedIn = integrated.indexOf("requireSignedIn", mount);
  const rateLimit = integrated.indexOf("imageToolsRateLimit", mount);
  const capability = integrated.indexOf('requireCapability("image_tools")', mount);
  const router = integrated.indexOf("createImageToolsRouter({", mount);
  assert.ok(database > mount);
  assert.ok(signedIn > database);
  assert.ok(rateLimit > signedIn);
  assert.ok(capability > rateLimit);
  assert.ok(router > capability);

  assert.ok(
    integrated.indexOf('const imageToolsPath =') < integrated.indexOf('app.use("/api", createMaintenanceMiddleware());'),
    "Image-tools JSON parser bypass must be installed before API routes."
  );

  assert.strictEqual(count(integrated, 'app.use(\n  "/api/image-understanding"'), 1);
  assert.strictEqual(count(integrated, 'app.get("/images.html", sendImageUnderstandingPage);'), 1);
  assert.strictEqual(count(integrated, 'app.get("/files.html", sendFileAnalysisPage);'), 1);
  assert.strictEqual(count(integrated, 'app.get("/", sendFileAwareIndex);'), 1);

  new vm.Script(`(function(require,module,exports,__dirname,__filename){\n${integrated}\n})`);

  const studio = fs.readFileSync(path.join(__dirname, "..", "image-tools.html"), "utf8");
  assert.ok(studio.includes('/api/image-tools/generate'));
  assert.ok(studio.includes('/api/image-tools/edit'));
  assert.ok(studio.includes("SAVE IMAGE"));
  assert.ok(studio.includes("resetSourcePreview"));
  assert.ok(!studio.includes('clearSource(); const file=imageInput.files?.[0]'));

  console.log("UNBOUND AI image-tools server integration checks passed.");
}

main();
