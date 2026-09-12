const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const serverPath = path.join(appRoot, "server.js");
const regressionPath = path.join(appRoot, "scripts", "regression-contract.js");

function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) {
    throw new Error(`v0.48 migration anchor missing: ${label}`);
  }
  const next = text.replace(from, to);
  if (next === text) {
    throw new Error(`v0.48 migration replacement failed: ${label}`);
  }
  return next;
}

let server = fs.readFileSync(serverPath, "utf8");
server = replaceOnce(
  server,
  'const { buildLaunchReadiness } = require("./ops/launch-readiness");',
  'const { buildInfrastructureReadiness } = require("./ops/infrastructure-readiness");\nconst { buildLaunchReadiness } = require("./ops/launch-readiness");',
  "server infrastructure import"
);
server = replaceOnce(
  server,
  '  const recovery = buildRecoveryReadiness();\n  const legal = legalPublishingState();',
  '  const infrastructure = buildInfrastructureReadiness();\n  const recovery = buildRecoveryReadiness();\n  const legal = legalPublishingState();',
  "operational infrastructure snapshot"
);
server = replaceOnce(
  server,
  '    runtime,\n    maintenance,\n    recovery,\n    legal,',
  '    runtime,\n    maintenance,\n    infrastructure,\n    recovery,\n    legal,',
  "launch infrastructure input"
);
server = replaceOnce(
  server,
  '    runtime,\n    maintenance,\n    recovery,\n    legal,\n    billing,\n    ageVerification,\n    ai,\n    launch,',
  '    runtime,\n    maintenance,\n    infrastructure,\n    recovery,\n    legal,\n    billing,\n    ageVerification,\n    ai,\n    launch,',
  "admin infrastructure output"
);
fs.writeFileSync(serverPath, server);

let regression = fs.readFileSync(regressionPath, "utf8");
regression = replaceOnce(
  regression,
  'const { buildRecoveryReadiness } = require("../ops/recovery-readiness");',
  'const { buildRecoveryReadiness } = require("../ops/recovery-readiness");\nconst { buildInfrastructureReadiness } = require("../ops/infrastructure-readiness");',
  "regression infrastructure import"
);
regression = replaceOnce(
  regression,
  'function testMaintenancePolicy() {',
  `function testInfrastructureReadiness() {\n  const now = Date.parse("2026-09-12T18:00:00Z");\n  const blocked = buildInfrastructureReadiness({ env: {}, nowMs: now });\n  assert.equal(blocked.launchReady, false);\n  assert.equal(blocked.profile, "development");\n  assert.ok(blocked.blockers.length >= 5);\n\n  const ready = buildInfrastructureReadiness({\n    env: {\n      UNBOUND_INFRA_PROFILE: "production",\n      UNBOUND_INFRA_PRODUCTION_READY: "true",\n      UNBOUND_INFRA_ALWAYS_ON_COMPUTE: "true",\n      UNBOUND_INFRA_DURABLE_DATABASE: "true",\n      UNBOUND_INFRA_HEALTH_CHECK_CONFIGURED: "true",\n      UNBOUND_INFRA_REVIEWED_AT: "2026-09-12T17:00:00Z"\n    },\n    nowMs: now\n  });\n  assert.equal(ready.launchReady, true);\n  assert.equal(ready.status, "ready");\n  assert.equal(ready.review.fresh, true);\n\n  const stale = buildInfrastructureReadiness({\n    env: {\n      UNBOUND_INFRA_PROFILE: "production",\n      UNBOUND_INFRA_PRODUCTION_READY: "true",\n      UNBOUND_INFRA_ALWAYS_ON_COMPUTE: "true",\n      UNBOUND_INFRA_DURABLE_DATABASE: "true",\n      UNBOUND_INFRA_HEALTH_CHECK_CONFIGURED: "true",\n      UNBOUND_INFRA_REVIEWED_AT: "2026-01-01T00:00:00Z",\n      UNBOUND_INFRA_REVIEW_MAX_AGE_DAYS: "30"\n    },\n    nowMs: now\n  });\n  assert.equal(stale.launchReady, false);\n  assert.equal(stale.review.fresh, false);\n}\n\nfunction testMaintenancePolicy() {`,
  "infrastructure regression test"
);
regression = replaceOnce(
  regression,
  '    maintenance: { active: false, mode: "off" },\n    recovery: { launchReady: true, blockers: [] },',
  '    maintenance: { active: false, mode: "off" },\n    infrastructure: { launchReady: true, blockers: [] },\n    recovery: { launchReady: true, blockers: [] },',
  "ready fixture infrastructure"
);
regression = replaceOnce(
  regression,
  '    ...readyLaunchFixture(),\n    recovery: { launchReady: false, blockers: ["Recovery not verified."] },',
  '    ...readyLaunchFixture(),\n    infrastructure: { launchReady: false, blockers: ["Infrastructure not verified."] },\n    recovery: { launchReady: false, blockers: ["Recovery not verified."] },',
  "blocked fixture infrastructure"
);
regression = replaceOnce(
  regression,
  '    "database_recovery",\n    "legal_published",',
  '    "infrastructure_production",\n    "database_recovery",\n    "legal_published",',
  "launch blocker expectation"
);
regression = replaceOnce(
  regression,
  '  ["recovery readiness", testRecoveryReadiness],\n  ["maintenance policy", testMaintenancePolicy],',
  '  ["recovery readiness", testRecoveryReadiness],\n  ["infrastructure readiness", testInfrastructureReadiness],\n  ["maintenance policy", testMaintenancePolicy],',
  "regression test list"
);
fs.writeFileSync(regressionPath, regression);

console.log("Applied v0.48 production infrastructure launch gate integration.");
