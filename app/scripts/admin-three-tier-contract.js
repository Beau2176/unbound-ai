"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { integrateLaunchDashboardServerSource } = require("../ops/launch-dashboard-server-integration");
const { integrateAdminThreeTierServerSource } = require("../access/admin-three-tier-server-integration");

function main() {
  const appRoot = path.resolve(__dirname, "..");
  const rawServer = fs.readFileSync(path.join(appRoot, "server.js"), "utf8");
  let integrated = integrateLaunchDashboardServerSource(rawServer);
  integrated = integrateAdminThreeTierServerSource(integrated);

  assert.match(integrated, /requestedPlanTier === "top" \? "ultra" : requestedPlanTier/);
  assert.match(integrated, /\["free", "premium", "ultra"\]\.includes\(planTier\)/);
  assert.match(integrated, /Plan must be FREE, PREMIUM, or ULTRA/);
  assert.match(integrated, /owner account must remain on the ULTRA plan/i);
  assert.match(integrated, /SET plan_tier = 'ultra'/);
  assert.match(integrated, /newPlanTier: "ultra"/);
  assert.match(integrated, /complimentary ULTRA/i);
  assert.match(integrated, /\["ultra", "top"\]\.includes\(user\.planTier\)/);
  assert.match(integrated, /\/admin-three-tier\.js/);
  assert.strictEqual(integrateAdminThreeTierServerSource(integrated), integrated, "admin three-tier integration must be idempotent");
  new vm.Script(integrated, { filename: "integrated-admin-three-tier-server.js" });

  const browser = fs.readFileSync(path.join(appRoot, "admin-three-tier.js"), "utf8");
  assert.doesNotThrow(() => new Function(browser), "admin three-tier browser helper must parse");
  assert.match(browser, /\["free", "premium", "ultra"\]/);
  assert.match(browser, /tier === "top"\) return "ultra"/);
  assert.match(browser, /\["premium", "PREMIUM"\]/);
  assert.match(browser, /\["ultra", "ULTRA"\]/);
  assert.match(browser, /MutationObserver/);

  const dashboardIntegration = fs.readFileSync(path.join(appRoot, "ops", "launch-dashboard-server-integration.js"), "utf8");
  assert.match(dashboardIntegration, /replaceAll\("TOP", "ULTRA"\)/);
  assert.match(dashboardIntegration, /\/launch-rehearsal\.html/);
  assert.match(dashboardIntegration, /admin-three-tier\.js\?v=097/);

  const startup = fs.readFileSync(path.join(appRoot, "start.js"), "utf8");
  assert.match(startup, /integrateAdminThreeTierServerSource/);
  assert.ok(
    startup.indexOf("integrateLaunchDashboardServerSource(integratedSource)") <
      startup.indexOf("integrateAdminThreeTierServerSource(integratedSource)"),
    "admin dashboard must be protected/rendered before three-tier admin patching"
  );

  console.log("Admin three-tier contract passed: Free/Premium/Ultra controls with legacy TOP-to-Ultra compatibility.");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
