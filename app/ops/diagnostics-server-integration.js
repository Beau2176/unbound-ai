const INTEGRATION_VERSION = "v1.2";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Diagnostics integration marker is missing: ${label}.`);
    error.code = "DIAGNOSTICS_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Diagnostics integration marker is ambiguous: ${label}.`);
    error.code = "DIAGNOSTICS_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integrateDiagnosticsServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "DIAGNOSTICS_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }
  if (source.includes('app.get("/health/diagnostics"') && source.includes('createDiagnosticsMonitor')) {
    return source;
  }

  const launchImport = `const { buildLaunchReadiness } = require("./ops/launch-readiness");`;
  source = replaceExactlyOnce(
    source,
    launchImport,
    `${launchImport}\nconst { createDiagnosticsMonitor } = require("./ops/system-diagnostics");\nconst { getSelfHealSupervisor } = require("./ops/self-heal");`,
    "diagnostics-imports"
  );

  const resilienceMarker = `const DATABASE_RESILIENCE = getDatabaseResilienceConfig();`;
  source = replaceExactlyOnce(
    source,
    resilienceMarker,
    `${resilienceMarker}\nconst diagnosticsMonitor = createDiagnosticsMonitor({\n  rootDir: __dirname,\n  stateProvider: () => ({\n    databaseConfigured: Boolean(process.env.DATABASE_URL),\n    databaseReady,\n    databaseError,\n    shuttingDown,\n    aiStatus: getGatewayStatus({ includeTelemetry: true }),\n    selfHeal: getSelfHealSupervisor()?.snapshot?.() || null\n  })\n});\ndiagnosticsMonitor.start();`,
    "diagnostics-monitor"
  );

  const systemStatusRoute = `app.get("/api/system/status", (req, res) => {`;
  source = replaceExactlyOnce(
    source,
    systemStatusRoute,
    `app.get("/health/diagnostics", async (req, res) => {\n  try {\n    const payload = await diagnosticsMonitor.getSnapshot();\n    const publicPayload = {\n      version: payload.version,\n      overall: payload.overall,\n      message: payload.message,\n      checkedAt: payload.checkedAt,\n      components: Object.fromEntries(\n        Object.entries(payload.components || {}).map(([name, component]) => [\n          name,\n          {\n            status: component?.status || "yellow",\n            summary: String(component?.summary || "").slice(0, 240) || null\n          }\n        ])\n      )\n    };\n    return sendStatusJson(res, payload.overall === "red" ? 503 : 200, publicPayload);\n  } catch (error) {\n    return sendStatusJson(res, 503, {\n      version: "${INTEGRATION_VERSION}",\n      overall: "red",\n      message: "Diagnostics are unavailable.",\n      checkedAt: new Date().toISOString(),\n      components: {}\n    });\n  }\n});\n\napp.get("/api/admin/ops/diagnostics", requireDatabase, requireAdmin, async (req, res) => {\n  const payload = await diagnosticsMonitor.getSnapshot({ force: true });\n  return sendStatusJson(res, payload.overall === "red" ? 503 : 200, payload);\n});\n\n${systemStatusRoute}`,
    "diagnostics-routes"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  integrateDiagnosticsServerSource
};
