const fs = require("fs");
const path = require("path");
const Module = require("module");
const {
  integrateEmailVerificationServerSource
} = require("./email/server-integration");
const {
  integrateBillingServerSource
} = require("./billing/server-integration");
const {
  integrateFileAnalysisServerSource
} = require("./files/server-integration");
const {
  integrateImageUnderstandingServerSource
} = require("./images/server-integration");
const {
  integrateVoiceServerSource
} = require("./voice/server-integration");
const {
  integrateCommandCenterServerSource
} = require("./command-center/server-integration");
const {
  integrateScheduledTasksServerSource
} = require("./tasks/server-integration");
const {
  integrateAgentServerSource
} = require("./agents/server-integration");
const {
  integrateMemoryServerSource
} = require("./memory/server-integration");
const {
  integrateAdaptiveKnowledgeServerSource
} = require("./knowledge/server-integration");
const {
  integrateModeLibraryServerSource
} = require("./preferences/mode-server-integration");
const {
  integrateAdvertisingAnalyticsServerSource
} = require("./advertising/server-integration");
const {
  integrateAdvertisingPolicyServerSource
} = require("./advertising/policy-server-integration");
const {
  integrateModelRoutingServerSource
} = require("./ai/model-routing-server-integration");
const {
  integrateConnectedAppsServerSource
} = require("./connections/server-integration");
const {
  integrateLaunchDashboardServerSource
} = require("./ops/launch-dashboard-server-integration");
const {
  integrateNativeShellServerSource
} = require("./ui/native-shell-server-integration");
const {
  startSelfHealingSupervisor
} = require("./ops/self-heal");
const {
  registerBuiltInAgeVerificationProviders
} = require("./age/providers/register");

function compileIntegratedServer({
  serverPath = path.join(__dirname, "server.js"),
  parentModule = module
} = {}) {
  registerBuiltInAgeVerificationProviders();

  const source = fs.readFileSync(serverPath, "utf8");
  const emailIntegratedSource = integrateEmailVerificationServerSource(source);
  const billingIntegratedSource = integrateBillingServerSource(emailIntegratedSource);
  const fileIntegratedSource = integrateFileAnalysisServerSource(billingIntegratedSource);
  let integratedSource = integrateImageUnderstandingServerSource(fileIntegratedSource);
  integratedSource = integrateVoiceServerSource(integratedSource);
  integratedSource = integrateCommandCenterServerSource(integratedSource);
  integratedSource = integrateScheduledTasksServerSource(integratedSource);
  integratedSource = integrateAgentServerSource(integratedSource);
  integratedSource = integrateMemoryServerSource(integratedSource);
  integratedSource = integrateAdaptiveKnowledgeServerSource(integratedSource);
  integratedSource = integrateModeLibraryServerSource(integratedSource);
  integratedSource = integrateAdvertisingAnalyticsServerSource(integratedSource);
  integratedSource = integrateAdvertisingPolicyServerSource(integratedSource);
  integratedSource = integrateModelRoutingServerSource(integratedSource);
  integratedSource = integrateConnectedAppsServerSource(integratedSource);
  integratedSource = integrateLaunchDashboardServerSource(integratedSource);
  integratedSource = integrateNativeShellServerSource(integratedSource);

  const runtimeModule = new Module(serverPath, parentModule);
  runtimeModule.filename = serverPath;
  runtimeModule.paths = Module._nodeModulePaths(path.dirname(serverPath));
  runtimeModule._compile(integratedSource, serverPath);
  return runtimeModule;
}

if (require.main === module) {
  compileIntegratedServer();
  startSelfHealingSupervisor({
    rootDir: __dirname,
    port: Number(process.env.PORT || 3000)
  });
}

module.exports = {
  compileIntegratedServer,
  startSelfHealingSupervisor
};
