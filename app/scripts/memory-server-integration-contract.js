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
const {
  INTEGRATION_VERSION,
  integrateMemoryServerSource
} = require("../memory/server-integration");

function count(text, needle) {
  return String(text).split(needle).length - 1;
}

function buildIntegratedSource() {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  return integrateMemoryServerSource(
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
  );
}

function main() {
  assert.strictEqual(INTEGRATION_VERSION, "v0.77");
  const integrated = buildIntegratedSource();

  assert.strictEqual(count(integrated, 'require("./memory/routes")'), 1);
  assert.strictEqual(count(integrated, 'require("./memory/context")'), 1);
  assert.strictEqual(count(integrated, '"/memory.html"'), 1);
  assert.strictEqual(count(integrated, '"/api/memory"'), 1);
  assert.strictEqual(count(integrated, 'requireCapability("memory")'), 2);
  assert.strictEqual(count(integrated, "CREATE TABLE IF NOT EXISTS user_memories"), 1);
  assert.strictEqual(count(integrated, "await buildMemoryPrompt(pool, persistentChat.user.id)"), 2);
  assert.strictEqual(count(integrated, "memoryInstructions, depthInstructions"), 2);

  const pageRoute = integrated.indexOf('"/memory.html"');
  const pageDatabase = integrated.indexOf("requireDatabase", pageRoute);
  const pageSignedIn = integrated.indexOf("requireSignedIn", pageRoute);
  const pageCapability = integrated.indexOf('requireCapability("memory")', pageRoute);
  const pageHandler = integrated.indexOf("sendMemoryPage", pageRoute);
  assert.ok(pageRoute >= 0);
  assert.ok(pageDatabase > pageRoute);
  assert.ok(pageSignedIn > pageDatabase);
  assert.ok(pageCapability > pageSignedIn);
  assert.ok(pageHandler > pageCapability);

  const apiMount = integrated.indexOf('app.use(\n  "/api/memory"');
  const apiDatabase = integrated.indexOf("requireDatabase", apiMount);
  const apiSignedIn = integrated.indexOf("requireSignedIn", apiMount);
  const apiCapability = integrated.indexOf('requireCapability("memory")', apiMount);
  const apiRouter = integrated.indexOf("createMemoryRouter({", apiMount);
  const apiPool = integrated.indexOf("getPool: () => pool", apiRouter);
  assert.ok(apiMount >= 0);
  assert.ok(apiDatabase > apiMount);
  assert.ok(apiSignedIn > apiDatabase);
  assert.ok(apiCapability > apiSignedIn);
  assert.ok(apiRouter > apiCapability);
  assert.ok(apiPool > apiRouter);

  new vm.Script(`(function(require,module,exports,__dirname,__filename){\n${integrated}\n})`);

  const startSource = fs.readFileSync(path.join(__dirname, "..", "start.js"), "utf8");
  const agentIndex = startSource.indexOf("integrateAgentServerSource(integratedSource)");
  const memoryIndex = startSource.indexOf("integrateMemoryServerSource(integratedSource)");
  assert.ok(agentIndex >= 0 && memoryIndex > agentIndex);
  assert.ok(startSource.includes("runtimeModule._compile(integratedSource, serverPath)"));

  console.log("UNBOUND AI Memory server integration checks passed.");
}

main();
