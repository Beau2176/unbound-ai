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
  registerBuiltInAgeVerificationProviders
} = require("./age/providers/register");

function compileIntegratedServer({
  serverPath = path.join(__dirname, "server.js"),
  parentModule = module
} = {}) {
  registerBuiltInAgeVerificationProviders();

  const source = fs.readFileSync(serverPath, "utf8");
  const emailIntegratedSource = integrateEmailVerificationServerSource(source);
  const integratedSource = integrateBillingServerSource(emailIntegratedSource);

  const runtimeModule = new Module(serverPath, parentModule);
  runtimeModule.filename = serverPath;
  runtimeModule.paths = Module._nodeModulePaths(path.dirname(serverPath));
  runtimeModule._compile(integratedSource, serverPath);
  return runtimeModule;
}

if (require.main === module) {
  compileIntegratedServer();
}

module.exports = {
  compileIntegratedServer
};
