const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { integrateEmailVerificationServerSource } = require("../email/server-integration");
const { integrateBillingServerSource } = require("../billing/server-integration");
const { integrateFileAnalysisServerSource } = require("../files/server-integration");
const {
  INTEGRATION_VERSION,
  integrateArtifactServerSource
} = require("../artifacts/server-integration");

function count(text, needle) {
  return String(text).split(needle).length - 1;
}

function buildIntegratedSource() {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  return integrateArtifactServerSource(
    integrateFileAnalysisServerSource(
      integrateBillingServerSource(
        integrateEmailVerificationServerSource(source)
      )
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
  assert.strictEqual(INTEGRATION_VERSION, "wave-14-artifact-studio");
  const integrated = buildIntegratedSource();

  assert.strictEqual(count(integrated, 'require("./artifacts/routes")'), 1);
  assert.strictEqual(count(integrated, 'app.get("/artifact-studio.html", sendArtifactStudioPage);'), 1);
  assert.strictEqual(count(integrated, 'req.path === "/api/artifacts"'), 1);
  assert.strictEqual(count(integrated, 'policy: RATE_LIMIT_POLICY.artifacts'), 1);
  assert.strictEqual(count(integrated, 'requireCapability("artifact_creation")'), 1);
  assert.strictEqual(count(integrated, 'createArtifactRouter({'), 1);
  assert.strictEqual(count(integrated, '"/api/artifacts"'), 2);

  const mount = integrated.indexOf('app.use(\n  "/api/artifacts"');
  assert.ok(mount >= 0);
  const database = integrated.indexOf("requireDatabase", mount);
  const signedIn = integrated.indexOf("requireSignedIn", mount);
  const rateLimit = integrated.indexOf("artifactRateLimit", mount);
  const capability = integrated.indexOf('requireCapability("artifact_creation")', mount);
  const router = integrated.indexOf("createArtifactRouter({", mount);
  assert(database > mount);
  assert(signedIn > database);
  assert(rateLimit > signedIn);
  assert(capability > rateLimit);
  assert(router > capability);

  const parser = integrated.indexOf('const artifactPath =');
  const maintenance = integrated.indexOf('app.use("/api", createMaintenanceMiddleware());');
  assert(parser >= 0 && parser < maintenance);

  new vm.Script(`(function(require,module,exports,__dirname,__filename){\n${integrated}\n})`);

  const fileIntegrated = integrateFileAnalysisServerSource(
    integrateBillingServerSource(
      integrateEmailVerificationServerSource(
        fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8")
      )
    )
  );
  expectCode(
    () => integrateArtifactServerSource(
      fileIntegrated.replace(
        'app.get("/files.html", sendFileAnalysisPage);',
        'app.get("/files.html", changedPage);'
      )
    ),
    "ARTIFACT_SERVER_INTEGRATION_MARKER_MISSING"
  );

  const start = fs.readFileSync(path.join(__dirname, "..", "start.js"), "utf8");
  const fileIndex = start.indexOf("integrateFileAnalysisServerSource(billingIntegratedSource)");
  const artifactIndex = start.indexOf("integrateArtifactServerSource(fileIntegratedSource)");
  const imageIndex = start.indexOf("integrateImageUnderstandingServerSource(artifactIntegratedSource)");
  assert(fileIndex >= 0 && artifactIndex > fileIndex && imageIndex > artifactIndex);

  const fileRoutes = fs.readFileSync(path.join(__dirname, "..", "files", "routes.js"), "utf8");
  assert(fileRoutes.includes("ARTIFACTS_NAV_LINK"));
  assert(fileRoutes.includes('href="/artifact-studio.html"'));

  console.log("PASS Artifact Studio server integration: parser isolation, auth, rate limit, Premium capability gate, page route, navigation, and startup order.");
}

main();
