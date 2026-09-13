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
const {
  INTEGRATION_VERSION,
  integrateAgentServerSource
} = require("../agents/server-integration");

function count(text, needle) {
  return String(text).split(needle).length - 1;
}

function buildIntegratedSource() {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  return integrateAgentServerSource(
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
  );
}

function main() {
  assert.strictEqual(INTEGRATION_VERSION, "v0.75");
  const integrated = buildIntegratedSource();

  assert.strictEqual(count(integrated, 'require("./agents/routes")'), 1);
  assert.strictEqual(count(integrated, 'require("./agents/runner")'), 1);
  assert.strictEqual(count(integrated, '"/agents.html"'), 1);
  assert.strictEqual(count(integrated, '"/api/agents"'), 1);
  assert.strictEqual(count(integrated, 'requireCapability("agents")'), 2);
  assert.strictEqual(count(integrated, "policy: RATE_LIMIT_POLICY.agentRuns"), 1);
  assert.strictEqual(count(integrated, "startAgentWorker({"), 1);
  assert.strictEqual(count(integrated, "CREATE TABLE IF NOT EXISTS agent_runs"), 1);
  assert.strictEqual(count(integrated, "CREATE TABLE IF NOT EXISTS agent_steps"), 1);
  assert.strictEqual(count(integrated, "createRunRateLimit: agentRunRateLimit"), 1);

  const pageRoute = integrated.indexOf('"/agents.html"');
  const pageDatabase = integrated.indexOf("requireDatabase", pageRoute);
  const pageSignedIn = integrated.indexOf("requireSignedIn", pageRoute);
  const pageCapability = integrated.indexOf('requireCapability("agents")', pageRoute);
  const pageHandler = integrated.indexOf("sendAgentPage", pageRoute);
  assert.ok(pageRoute >= 0);
  assert.ok(pageDatabase > pageRoute);
  assert.ok(pageSignedIn > pageDatabase);
  assert.ok(pageCapability > pageSignedIn);
  assert.ok(pageHandler > pageCapability);

  const apiMount = integrated.indexOf('app.use(\n  "/api/agents"');
  const apiDatabase = integrated.indexOf("requireDatabase", apiMount);
  const apiSignedIn = integrated.indexOf("requireSignedIn", apiMount);
  const apiCapability = integrated.indexOf('requireCapability("agents")', apiMount);
  const apiRouter = integrated.indexOf("createAgentRouter({", apiMount);
  const apiPool = integrated.indexOf("getPool: () => pool", apiRouter);
  const apiRateLimit = integrated.indexOf("createRunRateLimit: agentRunRateLimit", apiRouter);
  assert.ok(apiMount >= 0);
  assert.ok(apiDatabase > apiMount);
  assert.ok(apiSignedIn > apiDatabase);
  assert.ok(apiCapability > apiSignedIn);
  assert.ok(apiRouter > apiCapability);
  assert.ok(apiPool > apiRouter);
  assert.ok(apiRateLimit > apiPool);

  const taskWorker = integrated.indexOf("startScheduledTaskWorker({");
  const agentWorker = integrated.indexOf("startAgentWorker({", taskWorker);
  const requireDatabaseFunction = integrated.indexOf("function requireDatabase", agentWorker);
  assert.ok(taskWorker >= 0);
  assert.ok(agentWorker > taskWorker);
  assert.ok(requireDatabaseFunction > agentWorker);
  assert.ok(integrated.indexOf("recordUsageEvent", agentWorker) > agentWorker);
  assert.ok(integrated.indexOf("estimateProviderCostMicros", agentWorker) > agentWorker);

  new vm.Script(`(function(require,module,exports,__dirname,__filename){\n${integrated}\n})`);

  const startSource = fs.readFileSync(path.join(__dirname, "..", "start.js"), "utf8");
  const tasksIndex = startSource.indexOf("integrateScheduledTasksServerSource(integratedSource)");
  const agentIndex = startSource.indexOf("integrateAgentServerSource(integratedSource)");
  assert.ok(tasksIndex >= 0 && agentIndex > tasksIndex);
  assert.ok(startSource.includes("runtimeModule._compile(integratedSource, serverPath)"));

  console.log("UNBOUND AI bounded Agent server integration checks passed.");
}

main();
