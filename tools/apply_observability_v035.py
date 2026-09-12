from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


server_path = Path("app/server.js")
server = server_path.read_text()

server = replace_once(
    server,
    '''const {
  getMaintenanceStatus,
  createMaintenanceMiddleware
} = require("./ops/maintenance-mode");
''',
    '''const {
  getMaintenanceStatus,
  createMaintenanceMiddleware
} = require("./ops/maintenance-mode");
const {
  getRequestObservabilitySnapshot,
  createRequestObservabilityMiddleware
} = require("./ops/request-observability");
''',
    "observability import",
)

server = replace_once(
    server,
    '''app.disable("x-powered-by");
app.use(createHttpSecurityMiddleware({ isProduction: IS_PRODUCTION }));
''',
    '''app.disable("x-powered-by");
app.use(createRequestObservabilityMiddleware());
app.use(createHttpSecurityMiddleware({ isProduction: IS_PRODUCTION }));
''',
    "observability middleware",
)

server = replace_once(
    server,
    '''app.get(
  "/api/admin/ops/maintenance",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    return res.json({
      maintenance: getMaintenanceStatus()
    });
  }
);

app.get(
  "/api/admin/entitlements/catalog",
''',
    '''app.get(
  "/api/admin/ops/maintenance",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    return res.json({
      maintenance: getMaintenanceStatus()
    });
  }
);

app.get(
  "/api/admin/ops/status",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    const maintenance = getMaintenanceStatus();
    return res.json({
      runtime: buildReadinessStatus({
        databaseConfigured: Boolean(process.env.DATABASE_URL),
        databaseReady,
        databaseError,
        shuttingDown,
        maintenanceStatus: maintenance,
        aiStatus: getGatewayStatus()
      }),
      maintenance,
      recovery: buildRecoveryReadiness(),
      http: getRequestObservabilitySnapshot()
    });
  }
);

app.get(
  "/api/admin/entitlements/catalog",
''',
    "admin ops status endpoint",
)

server_path.write_text(server)
print("Applied observability v0.35 migration.")
