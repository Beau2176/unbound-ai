const INTEGRATION_VERSION = "v0.97";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Launch dashboard integration marker is missing: ${label}.`);
    error.code = "LAUNCH_DASHBOARD_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Launch dashboard integration marker is ambiguous: ${label}.`);
    error.code = "LAUNCH_DASHBOARD_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integrateLaunchDashboardServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "LAUNCH_DASHBOARD_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  const launchReadinessImport = `const { buildLaunchReadiness } = require("./ops/launch-readiness");`;
  source = replaceExactlyOnce(
    source,
    launchReadinessImport,
    `${launchReadinessImport}\nconst { buildOwnerReadiness } = require("./ops/owner-readiness");`,
    "owner-readiness-import"
  );

  const adminRoute = `app.get("/admin.html", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache");\n  return res.sendFile(path.join(__dirname, "admin.html"));\n});`;
  const replacement = `app.get("/admin.html", requireDatabase, requireAdmin, (req, res) => {\n  const adminPath = path.join(__dirname, "admin.html");\n  const adminSource = require("fs").readFileSync(adminPath, "utf8");\n  const readinessLinkMarker = '<a class="link-btn" href="/advertising-admin">Advertising</a>';\n  if (!adminSource.includes(readinessLinkMarker) || !adminSource.includes("</body>")) {\n    console.error("UNBOUND AI ADMIN READINESS LINK MARKER MISSING");\n    return res.status(500).send("Admin dashboard integration is unavailable.");\n  }\n  const tierNamedAdmin = adminSource.replaceAll("TOP", "ULTRA");\n  const withNavigation = tierNamedAdmin.replace(\n    readinessLinkMarker,\n    readinessLinkMarker + '\\n      <a class="link-btn" href="/launch-readiness.html">Readiness</a>' + '\\n      <a class="link-btn" href="/launch-rehearsal.html">Rehearsal</a>'\n  );\n  const renderedAdmin = withNavigation.replace(\n    "</body>",\n    '  <script src="/admin-three-tier.js?v=097" defer></script>\\n</body>'\n  );\n  res.setHeader("Cache-Control", "no-cache");\n  return res.type("html").send(renderedAdmin);\n});\n\napp.get("/launch-readiness.html", requireDatabase, requireAdmin, (req, res) => {\n  res.setHeader("Cache-Control", "no-cache");\n  return res.sendFile(path.join(__dirname, "launch-readiness.html"));\n});\n\napp.get("/api/admin/ops/owner-readiness", requireDatabase, requireAdmin, (req, res) => {\n  return sendStatusJson(res, 200, buildOwnerReadiness());\n});`;

  source = replaceExactlyOnce(
    source,
    adminRoute,
    replacement,
    "admin-and-readiness-routes"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  integrateLaunchDashboardServerSource
};
