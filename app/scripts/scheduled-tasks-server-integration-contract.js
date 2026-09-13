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
const {
  INTEGRATION_VERSION,
  integrateScheduledTasksServerSource
} = require("../tasks/server-integration");

function count(text, needle) {
  return String(text).split(needle).length - 1;
}

function buildIntegratedSource() {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  return integrateScheduledTasksServerSource(
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
  );
}

function main() {
  assert.strictEqual(INTEGRATION_VERSION, "v0.73");
  const integrated = buildIntegratedSource();

  assert.strictEqual(count(integrated, 'require("./tasks/routes")'), 1);
  assert.strictEqual(count(integrated, 'require("./tasks/scheduler")'), 1);
  assert.strictEqual(count(integrated, '"/tasks.html"'), 1);
  assert.strictEqual(count(integrated, '"/api/tasks"'), 1);
  assert.strictEqual(count(integrated, 'requireCapability("monitoring")'), 2);
  assert.strictEqual(count(integrated, "startScheduledTaskWorker({"), 1);
  assert.strictEqual(count(integrated, "CREATE TABLE IF NOT EXISTS scheduled_tasks"), 1);
  assert.strictEqual(count(integrated, "CREATE TABLE IF NOT EXISTS scheduled_task_events"), 1);
  assert.strictEqual(count(integrated, "FOR UPDATE SKIP LOCKED"), 0);

  const pageRoute = integrated.indexOf('"/tasks.html"');
  const pageDatabase = integrated.indexOf("requireDatabase", pageRoute);
  const pageSignedIn = integrated.indexOf("requireSignedIn", pageRoute);
  const pageCapability = integrated.indexOf('requireCapability("monitoring")', pageRoute);
  const pageHandler = integrated.indexOf("sendScheduledTasksPage", pageRoute);
  assert.ok(pageRoute >= 0);
  assert.ok(pageDatabase > pageRoute);
  assert.ok(pageSignedIn > pageDatabase);
  assert.ok(pageCapability > pageSignedIn);
  assert.ok(pageHandler > pageCapability);

  const apiMount = integrated.indexOf('app.use(\n  "/api/tasks"');
  const apiDatabase = integrated.indexOf("requireDatabase", apiMount);
  const apiSignedIn = integrated.indexOf("requireSignedIn", apiMount);
  const apiCapability = integrated.indexOf('requireCapability("monitoring")', apiMount);
  const apiRouter = integrated.indexOf("createScheduledTasksRouter({", apiMount);
  const apiPool = integrated.indexOf("getPool: () => pool", apiRouter);
  assert.ok(apiMount >= 0);
  assert.ok(apiDatabase > apiMount);
  assert.ok(apiSignedIn > apiDatabase);
  assert.ok(apiCapability > apiSignedIn);
  assert.ok(apiRouter > apiCapability);
  assert.ok(apiPool > apiRouter);

  const initialization = integrated.indexOf("void initializeDatabaseWithRetry();");
  const worker = integrated.indexOf("startScheduledTaskWorker({", initialization);
  const requireDatabaseFunction = integrated.indexOf("function requireDatabase", worker);
  assert.ok(initialization >= 0);
  assert.ok(worker > initialization);
  assert.ok(requireDatabaseFunction > worker);

  new vm.Script(`(function(require,module,exports,__dirname,__filename){\n${integrated}\n})`);

  const startSource = fs.readFileSync(path.join(__dirname, "..", "start.js"), "utf8");
  const centerIndex = startSource.indexOf("integrateCommandCenterServerSource(integratedSource)");
  const tasksIndex = startSource.indexOf("integrateScheduledTasksServerSource(integratedSource)");
  assert.ok(centerIndex >= 0 && tasksIndex > centerIndex);
  assert.ok(startSource.includes("runtimeModule._compile(integratedSource, serverPath)"));

  console.log("UNBOUND AI scheduled-task server integration checks passed.");
}

main();
