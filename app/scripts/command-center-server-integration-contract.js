const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { integrateEmailVerificationServerSource } = require("../email/server-integration");
const { integrateBillingServerSource } = require("../billing/server-integration");
const { integrateFileAnalysisServerSource } = require("../files/server-integration");
const { integrateImageUnderstandingServerSource } = require("../images/server-integration");
const { integrateVoiceServerSource } = require("../voice/server-integration");
const {
  INTEGRATION_VERSION,
  integrateCommandCenterServerSource
} = require("../command-center/server-integration");

function count(text, needle) {
  return String(text).split(needle).length - 1;
}

function buildIntegratedSource() {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  return integrateCommandCenterServerSource(
    integrateVoiceServerSource(
      integrateImageUnderstandingServerSource(
        integrateFileAnalysisServerSource(
          integrateBillingServerSource(
            integrateEmailVerificationServerSource(source)
          )
        )
      )
    )
  );
}

function main() {
  assert.strictEqual(INTEGRATION_VERSION, "v0.72");
  const integrated = buildIntegratedSource();
  assert.strictEqual(count(integrated, 'require("./command-center/routes")'), 1);
  assert.strictEqual(count(integrated, '"/command-center.html"'), 1);
  assert.strictEqual(count(integrated, '"/api/command-center"'), 1);
  assert.strictEqual(count(integrated, 'requireCapability("command_center")'), 2);
  assert.strictEqual(count(integrated, "createCommandCenterRouter({"), 1);
  assert.strictEqual(count(integrated, "getPool: () => pool"), 2);

  const pageRoute = integrated.indexOf('"/command-center.html"');
  const pageDatabase = integrated.indexOf("requireDatabase", pageRoute);
  const pageSignedIn = integrated.indexOf("requireSignedIn", pageRoute);
  const pageCapability = integrated.indexOf('requireCapability("command_center")', pageRoute);
  const pageHandler = integrated.indexOf("sendCommandCenterPage", pageRoute);
  assert.ok(pageDatabase > pageRoute);
  assert.ok(pageSignedIn > pageDatabase);
  assert.ok(pageCapability > pageSignedIn);
  assert.ok(pageHandler > pageCapability);

  const mount = integrated.indexOf('app.use(\n  "/api/command-center"');
  assert.ok(mount >= 0);
  const database = integrated.indexOf("requireDatabase", mount);
  const signedIn = integrated.indexOf("requireSignedIn", mount);
  const capability = integrated.indexOf('requireCapability("command_center")', mount);
  const router = integrated.indexOf("createCommandCenterRouter({", mount);
  const getPool = integrated.indexOf("getPool: () => pool", router);
  assert.ok(database > mount);
  assert.ok(signedIn > database);
  assert.ok(capability > signedIn);
  assert.ok(router > capability);
  assert.ok(getPool > router);

  new vm.Script(`(function(require,module,exports,__dirname,__filename){\n${integrated}\n})`);

  const startSource = fs.readFileSync(path.join(__dirname, "..", "start.js"), "utf8");
  const voiceIndex = startSource.indexOf("integrateVoiceServerSource(integratedSource)");
  const centerIndex = startSource.indexOf("integrateCommandCenterServerSource(integratedSource)");
  assert.ok(voiceIndex >= 0 && centerIndex > voiceIndex);
  assert.ok(startSource.includes("runtimeModule._compile(integratedSource, serverPath)"));

  console.log("UNBOUND AI Command Center server integration checks passed.");
}

main();
