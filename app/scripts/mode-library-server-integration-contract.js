const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { integrateEmailVerificationServerSource } = require("../email/server-integration");
const { integrateBillingServerSource } = require("../billing/server-integration");
const { integrateFileAnalysisServerSource } = require("../files/server-integration");
const { integrateImageUnderstandingServerSource } = require("../images/server-integration");
const { integrateVoiceServerSource } = require("../voice/server-integration");
const { integrateCommandCenterServerSource } = require("../command-center/server-integration");
const { integrateScheduledTasksServerSource } = require("../tasks/server-integration");
const { integrateAgentServerSource } = require("../agents/server-integration");
const { integrateMemoryServerSource } = require("../memory/server-integration");
const {
  INTEGRATION_VERSION,
  integrateModeLibraryServerSource
} = require("../preferences/mode-server-integration");

function count(text, needle) {
  return String(text).split(needle).length - 1;
}

function buildIntegratedSource() {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  return integrateModeLibraryServerSource(
    integrateMemoryServerSource(
      integrateAgentServerSource(
        integrateScheduledTasksServerSource(
          integrateCommandCenterServerSource(
            integrateVoiceServerSource(
              integrateImageUnderstandingServerSource(
                integrateFileAnalysisServerSource(
                  integrateBillingServerSource(
                    integrateEmailVerificationServerSource(source)
                  )
                )
              )
            )
          )
        )
      )
    )
  );
}

function main() {
  assert.strictEqual(INTEGRATION_VERSION, "v0.78");
  const integrated = buildIntegratedSource();

  assert.strictEqual(count(integrated, 'require("./preferences/mode-routes")'), 1);
  assert.strictEqual(count(integrated, '"/modes.html"'), 1);
  assert.strictEqual(count(integrated, "sendModeLibraryPage"), 2);

  const pageRoute = integrated.indexOf('"/modes.html"');
  const pageDatabase = integrated.indexOf("requireDatabase", pageRoute);
  const pageSignedIn = integrated.indexOf("requireSignedIn", pageRoute);
  const pageHandler = integrated.indexOf("sendModeLibraryPage", pageRoute);
  assert.ok(pageRoute >= 0);
  assert.ok(pageDatabase > pageRoute);
  assert.ok(pageSignedIn > pageDatabase);
  assert.ok(pageHandler > pageSignedIn);
  assert.ok(!integrated.slice(pageRoute, pageHandler).includes("requireCapability("));

  new vm.Script(`(function(require,module,exports,__dirname,__filename){\n${integrated}\n})`);

  const startSource = fs.readFileSync(path.join(__dirname, "..", "start.js"), "utf8");
  const memoryIndex = startSource.indexOf("integrateMemoryServerSource(integratedSource)");
  const modeIndex = startSource.indexOf("integrateModeLibraryServerSource(integratedSource)");
  assert.ok(memoryIndex >= 0 && modeIndex > memoryIndex);
  assert.ok(startSource.includes("runtimeModule._compile(integratedSource, serverPath)"));

  const page = fs.readFileSync(path.join(__dirname, "..", "modes.html"), "utf8");
  assert.ok(page.includes("/api/account/ai-preferences"));
  assert.ok(page.includes("styles = Array.isArray(data.styles)"));

  console.log("UNBOUND AI Mode Library server integration checks passed.");
}

main();
