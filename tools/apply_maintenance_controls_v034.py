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
    'const { buildRecoveryReadiness } = require("./ops/recovery-readiness");\n',
    '''const { buildRecoveryReadiness } = require("./ops/recovery-readiness");
const {
  getMaintenanceStatus,
  createMaintenanceMiddleware
} = require("./ops/maintenance-mode");
''',
    "maintenance import",
)

server = replace_once(
    server,
    '''app.use(express.json({ limit: "100kb" }));
app.use("/api", (req, res, next) => {
''',
    '''app.use(express.json({ limit: "100kb" }));
app.use("/api", createMaintenanceMiddleware());
app.use("/api", (req, res, next) => {
''',
    "maintenance middleware",
)

status_anchor = '''    databaseError,
    shuttingDown,
    aiStatus: getGatewayStatus()
'''
status_replacement = '''    databaseError,
    shuttingDown,
    maintenanceStatus: getMaintenanceStatus(),
    aiStatus: getGatewayStatus()
'''
status_count = server.count(status_anchor)
if status_count != 2:
    raise SystemExit(f"maintenance readiness status: expected two matches, found {status_count}")
server = server.replace(status_anchor, status_replacement, 2)

server = replace_once(
    server,
    '''app.get(
  "/api/admin/ops/recovery",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    return res.json({
      recovery: buildRecoveryReadiness()
    });
  }
);

app.get(
  "/api/admin/entitlements/catalog",
''',
    '''app.get(
  "/api/admin/ops/recovery",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    return res.json({
      recovery: buildRecoveryReadiness()
    });
  }
);

app.get(
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
    "admin maintenance endpoint",
)

server_path.write_text(server)

runtime_path = Path("app/ops/runtime-status.js")
runtime = runtime_path.read_text()

runtime = replace_once(
    runtime,
    '''  databaseError = null,
  shuttingDown = false,
  aiStatus = null
''',
    '''  databaseError = null,
  shuttingDown = false,
  maintenanceStatus = null,
  aiStatus = null
''',
    "runtime maintenance argument",
)

runtime = replace_once(
    runtime,
    '''  const ready = !shuttingDown && database.configured && database.ready;

  return {
    status: shuttingDown ? "draining" : ready ? "ready" : "not_ready",
    ready,
    shuttingDown: Boolean(shuttingDown),
''',
    '''  const ready = !shuttingDown && database.configured && database.ready;
  const maintenance = {
    mode: cleanValue(maintenanceStatus?.mode, 40) || "off",
    active: Boolean(maintenanceStatus?.active),
    writeBlocked: Boolean(maintenanceStatus?.writeBlocked),
    serviceUnavailable: Boolean(maintenanceStatus?.serviceUnavailable),
    retryAfterSeconds: Math.max(
      0,
      Math.floor(Number(maintenanceStatus?.retryAfterSeconds) || 0)
    ),
    message: cleanValue(maintenanceStatus?.message, 500)
  };
  const operational = ready && !maintenance.active;

  return {
    status: shuttingDown
      ? "draining"
      : maintenance.active
        ? "maintenance"
        : ready
          ? "ready"
          : "not_ready",
    ready,
    operational,
    shuttingDown: Boolean(shuttingDown),
''',
    "runtime maintenance state",
)

runtime = replace_once(
    runtime,
    '''    components: {
      database,
      ai: {
''',
    '''    components: {
      database,
      maintenance,
      ai: {
''',
    "runtime maintenance component",
)

runtime_path.write_text(runtime)

runbook_path = Path("docs/INCIDENT_RECOVERY.md")
runbook = runbook_path.read_text()
runbook = replace_once(
    runbook,
    '''## Data-loss incident procedure

1. Stop or restrict writes if continued writes could make recovery harder.
2. Record the incident start time and the last known-good time.
''',
    '''## Maintenance controls

UNBOUND AI supports environment-controlled incident modes:

- `UNBOUND_MAINTENANCE_MODE=off` — normal operation.
- `UNBOUND_MAINTENANCE_MODE=read_only` — safe HTTP methods continue, while API writes (including chat requests that persist history/usage) return `503` with `Retry-After`.
- `UNBOUND_MAINTENANCE_MODE=offline` — all API traffic is blocked except `/api/system/status`, which remains available to report maintenance state.
- `UNBOUND_MAINTENANCE_MESSAGE=<message>` — optional user-facing maintenance reason.
- `UNBOUND_MAINTENANCE_RETRY_AFTER_SECONDS=<seconds>` — retry guidance, default `300`.

For a data-integrity incident, switch to `read_only` before backup or recovery work whenever the application must remain reachable. Use `offline` when even reads should stop. Changing these environment variables requires the hosting environment to restart/redeploy the service before the new mode takes effect.

Billing and verification webhook writes are also blocked in maintenance mode. Confirm that the provider will retry delivery and reconcile any missed events after normal operation resumes.

## Data-loss incident procedure

1. Set `UNBOUND_MAINTENANCE_MODE=read_only` (or `offline` when reads are unsafe) if continued writes could make recovery harder.
2. Record the incident start time and the last known-good time.
''',
    "runbook maintenance section",
)

runbook_path.write_text(runbook)
print("Applied maintenance controls v0.34 migration.")
