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
  getDatabaseResilienceConfig,
  databaseRetryDelay
} = require("./ops/database-resilience");
''',
    '''const {
  getDatabaseResilienceConfig,
  databaseRetryDelay
} = require("./ops/database-resilience");
const { buildRecoveryReadiness } = require("./ops/recovery-readiness");
''',
    "recovery import",
)

server = replace_once(
    server,
    '''let databaseInitAttempt = 0;
let databaseRetryTimer = null;
const DATABASE_RESILIENCE = getDatabaseResilienceConfig();
''',
    '''let databaseInitAttempt = 0;
let databaseRetryTimer = null;
let shuttingDown = false;
const DATABASE_RESILIENCE = getDatabaseResilienceConfig();
''',
    "shutdown state",
)

status_anchor = '''    databaseReady,
    databaseError,
    aiStatus: getGatewayStatus()
'''
status_replacement = '''    databaseReady,
    databaseError,
    shuttingDown,
    aiStatus: getGatewayStatus()
'''
status_count = server.count(status_anchor)
if status_count != 2:
    raise SystemExit(f"readiness status: expected two matches, found {status_count}")
server = server.replace(status_anchor, status_replacement, 2)

server = replace_once(
    server,
    '''function scheduleDatabaseInitialization(reason = "retry") {
  if (!process.env.DATABASE_URL || databaseRetryTimer || databaseInitializing) {
    return;
  }
''',
    '''function scheduleDatabaseInitialization(reason = "retry") {
  if (
    shuttingDown ||
    !process.env.DATABASE_URL ||
    databaseRetryTimer ||
    databaseInitializing
  ) {
    return;
  }
''',
    "database retry shutdown guard",
)

server = replace_once(
    server,
    '''async function initializeDatabaseWithRetry() {
  if (databaseInitializing) return;
''',
    '''async function initializeDatabaseWithRetry() {
  if (shuttingDown || databaseInitializing) return;
''',
    "database initialization shutdown guard",
)

server = replace_once(
    server,
    '''/* ----------------------------- ADMIN API ----------------------------- */


app.get(
  "/api/admin/entitlements/catalog",
''',
    '''/* ----------------------------- ADMIN API ----------------------------- */

app.get(
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
    "admin recovery endpoint",
)

server = replace_once(
    server,
    '''app.listen(PORT, "0.0.0.0", () => {
  console.log(`UNBOUND AI running on port ${PORT}`);
});
''',
    '''const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`UNBOUND AI running on port ${PORT}`);
});

let shutdownTimer = null;

async function shutdownGracefully(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  databaseReady = false;

  if (databaseRetryTimer) {
    clearTimeout(databaseRetryTimer);
    databaseRetryTimer = null;
  }

  console.log(`UNBOUND AI received ${signal}; beginning graceful shutdown.`);

  shutdownTimer = setTimeout(() => {
    console.error("UNBOUND AI graceful shutdown timed out; forcing exit.");
    process.exit(1);
  }, 10000);
  shutdownTimer.unref?.();

  server.close(async (serverError) => {
    if (serverError) {
      console.error("UNBOUND AI HTTP SERVER CLOSE ERROR:", serverError);
    }

    const activePool = pool;
    pool = null;
    await closePoolQuietly(activePool);

    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
    }

    process.exit(serverError ? 1 : 0);
  });
}

process.once("SIGTERM", () => {
  void shutdownGracefully("SIGTERM");
});

process.once("SIGINT", () => {
  void shutdownGracefully("SIGINT");
});
''',
    "graceful shutdown",
)

server_path.write_text(server)

runtime_path = Path("app/ops/runtime-status.js")
runtime = runtime_path.read_text()

runtime = replace_once(
    runtime,
    '''  databaseReady = false,
  databaseConfigured = false,
  databaseError = null,
  aiStatus = null
''',
    '''  databaseReady = false,
  databaseConfigured = false,
  databaseError = null,
  shuttingDown = false,
  aiStatus = null
''',
    "runtime shutdown argument",
)

runtime = replace_once(
    runtime,
    '''    state: databaseReady
      ? "ready"
      : databaseConfigured
        ? databaseError
          ? "error"
          : "starting"
        : "not_configured"
  };

  const ready = database.configured && database.ready;

  return {
    status: ready ? "ready" : "not_ready",
    ready,
''',
    '''    state: shuttingDown
      ? "draining"
      : databaseReady
        ? "ready"
        : databaseConfigured
          ? databaseError
            ? "error"
            : "starting"
          : "not_configured"
  };

  const ready = !shuttingDown && database.configured && database.ready;

  return {
    status: shuttingDown ? "draining" : ready ? "ready" : "not_ready",
    ready,
    shuttingDown: Boolean(shuttingDown),
''',
    "runtime draining state",
)

runtime_path.write_text(runtime)
print("Applied recovery readiness v0.33 migration.")
