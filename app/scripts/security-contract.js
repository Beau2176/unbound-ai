const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");
const serverPath = path.join(appRoot, "server.js");
const packagePath = path.join(appRoot, "package.json");
const customInstructionsPath = path.join(
  appRoot,
  "preferences",
  "custom-instructions.js"
);
const server = fs.readFileSync(serverPath, "utf8");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

function requireText(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`Security contract missing: ${label}`);
}

function forbidText(text, needle, label) {
  if (text.includes(needle)) throw new Error(`Security contract violation: ${label}`);
}

forbidText(server, "express.static(__dirname)", "application source directory must not be publicly exposed");
requireText(server, 'app.get("/index.html"', "explicit index route");
requireText(server, 'app.get("/admin.html"', "explicit admin route");
requireText(server, 'app.get("/unbound-cosmic.png"', "explicit branding route");
forbidText(server, 'app.get("/server.js"', "server source must not be routed publicly");
requireText(server, "createSameOriginApiGuard", "same-origin API guard");
requireText(server, "HttpOnly; Path=/; SameSite=Lax", "HttpOnly SameSite session/device cookies");

const adultGateCount = (server.match(/assertAgeVerifiedAdult\(req\)/g) || []).length;
if (adultGateCount < 2) {
  throw new Error("Security contract violation: Adult Mode must be age-gated on normal and streaming chat routes");
}

const exportStart = server.indexOf('app.get(\n  "/api/account/export"');
const exportEnd = exportStart >= 0
  ? server.indexOf("/* ------------------------- CONVERSATION HISTORY", exportStart)
  : -1;
if (exportStart < 0 || exportEnd <= exportStart) {
  throw new Error("Security contract missing: account data export route");
}
const exportRoute = server.slice(exportStart, exportEnd);
for (const forbidden of [
  "password_hash",
  "token_hash",
  "device_token_hash",
  "code_hash",
  "credential_id",
  "public_key",
  "provider_reference_hash",
  "provider_response_id",
  "user_handle"
]) {
  forbidText(exportRoute, forbidden, `data export must not select ${forbidden}`);
}

if (fs.existsSync(customInstructionsPath)) {
  const customInstructions = fs.readFileSync(customInstructionsPath, "utf8");
  requireText(customInstructions, 'role: "user"', "custom instructions must enter model context as user-level content");
  requireText(customInstructions, "not system or developer authority", "custom instruction authority disclaimer");
  requireText(customInstructions, "MAX_CUSTOM_INSTRUCTIONS = 2000", "custom instruction size limit");

  const contextCount = (
    server.match(/customPreferenceMessage \? \[customPreferenceMessage\] : \[\]/g) || []
  ).length;
  if (contextCount < 2) {
    throw new Error("Security contract violation: custom instructions must be injected into both chat inputs as user-level context");
  }

  if (/instructions\s*:\s*\[[^\]]*(?:customPreferenceMessage|customInstructions)/s.test(server)) {
    throw new Error("Security contract violation: custom instructions must never be promoted into provider system/developer instructions");
  }
}

if (pkg.overrides?.qs !== "6.16.0") {
  throw new Error("Security contract violation: qs must remain pinned to patched 6.16.0");
}
if (pkg.engines?.node !== "24.x") {
  throw new Error("Runtime contract violation: package engines.node must remain pinned to Node 24.x");
}

for (const envPath of [path.join(repoRoot, ".env"), path.join(appRoot, ".env")]) {
  if (fs.existsSync(envPath)) {
    throw new Error(`Security contract violation: tracked/runtime source tree contains ${path.relative(repoRoot, envPath)}`);
  }
}

console.log("UNBOUND AI security contract checks passed.");
