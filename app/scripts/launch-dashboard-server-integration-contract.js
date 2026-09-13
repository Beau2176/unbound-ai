const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  integrateLaunchDashboardServerSource
} = require("../ops/launch-dashboard-server-integration");

function main() {
  const appRoot = path.resolve(__dirname, "..");
  const serverSource = fs.readFileSync(path.join(appRoot, "server.js"), "utf8");
  const integrated = integrateLaunchDashboardServerSource(serverSource);

  assert.ok(integrated.includes('require("./ops/owner-readiness")'));
  assert.ok(integrated.includes('app.get("/admin.html", requireDatabase, requireAdmin'));
  assert.ok(integrated.includes('app.get("/launch-readiness.html", requireDatabase, requireAdmin'));
  assert.ok(integrated.includes('app.get("/api/admin/ops/owner-readiness", requireDatabase, requireAdmin'));
  assert.ok(integrated.includes("buildOwnerReadiness()"));
  assert.ok(integrated.includes('href="/launch-readiness.html">Readiness</a>'));
  assert.ok(integrated.includes('path.join(__dirname, "launch-readiness.html")'));
  assert.ok(integrated.includes("ADMIN READINESS LINK MARKER MISSING"));
  assert.ok(!integrated.includes('app.get("/admin.html", (req, res) =>'));
  new vm.Script(integrated, { filename: "integrated-server-launch-dashboard.js" });

  assert.throws(
    () => integrateLaunchDashboardServerSource(serverSource.replace('app.get("/admin.html"', 'app.get("/owner.html"')),
    (error) => error?.code === "LAUNCH_DASHBOARD_INTEGRATION_MARKER_MISSING"
  );
  assert.throws(
    () => integrateLaunchDashboardServerSource(serverSource.replace('const { buildLaunchReadiness } = require("./ops/launch-readiness");', 'const buildLaunchReadiness = null;')),
    (error) => error?.code === "LAUNCH_DASHBOARD_INTEGRATION_MARKER_MISSING"
  );
  assert.throws(
    () => integrateLaunchDashboardServerSource(""),
    (error) => error?.code === "LAUNCH_DASHBOARD_INTEGRATION_SOURCE_EMPTY"
  );

  const startup = fs.readFileSync(path.join(appRoot, "start.js"), "utf8");
  assert.ok(startup.includes('require("./ops/launch-dashboard-server-integration")'));
  assert.ok(startup.includes("integrateLaunchDashboardServerSource(integratedSource)"));
  assert.ok(
    startup.indexOf("integrateLaunchDashboardServerSource(integratedSource)") >
      startup.indexOf("integrateConnectedAppsServerSource(integratedSource)"),
    "Launch dashboard should integrate after Connected Apps."
  );

  console.log("PASS launch-dashboard server integration: admin guards, protected routes, owner-readiness API, discoverability link, fail-closed markers, and startup composition are preserved.");
}

main();
