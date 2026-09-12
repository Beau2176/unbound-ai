const fs = require("fs");
const path = require("path");
const Module = require("module");
const {
  integrateEmailVerificationServerSource
} = require("./email/server-integration");

function compileIntegratedServer({
  serverPath = path.join(__dirname, "server.js"),
  parentModule = module
} = {}) {
  const source = fs.readFileSync(serverPath, "utf8");
  const integratedSource = integrateEmailVerificationServerSource(source);

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
