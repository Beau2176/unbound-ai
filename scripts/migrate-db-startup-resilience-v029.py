from pathlib import Path


def one(path, old, new, label):
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    path.write_text(text.replace(old, new, 1))


server = Path("app/server.js")

one(
    server,
    '''const {
  buildLivenessStatus,
  buildReadinessStatus
} = require("./ops/runtime-status");
''',
    '''const {
  buildLivenessStatus,
  buildReadinessStatus
} = require("./ops/runtime-status");
const {
  getDatabaseResilienceConfig,
  databaseRetryDelay
} = require("./ops/database-resilience");
''',
    "database resilience imports"
)

one(
    server,
    '''let pool = null;
let databaseReady = false;
let databaseError = null;

function sendStatusJson(res, statusCode, payload) {
''',
    '''let pool = null;
let databaseReady = false;
let databaseError = null;
let databaseInitializing = false;
let databaseInitAttempt = 0;
let databaseRetryTimer = null;
const DATABASE_RESILIENCE = getDatabaseResilienceConfig();

function sendStatusJson(res, statusCode, payload) {
''',
    "database resilience state"
)

one(
    server,
    '''function createPool() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: IS_PRODUCTION ? { rejectUnauthorized: false } : undefined,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
}
''',
    '''function createPool() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  const nextPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: IS_PRODUCTION ? { rejectUnauthorized: false } : undefined,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: DATABASE_RESILIENCE.connectionTimeoutMillis,
    statement_timeout: DATABASE_RESILIENCE.statementTimeoutMillis,
    query_timeout: DATABASE_RESILIENCE.queryTimeoutMillis,
    lock_timeout: DATABASE_RESILIENCE.lockTimeoutMillis,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    application_name: "unbound-ai"
  });

  nextPool.on("error", (error) => {
    databaseReady = false;
    databaseError = error?.message || "Database pool connection failed.";
    console.error("UNBOUND AI DATABASE POOL ERROR:", error);
    scheduleDatabaseInitialization("pool-error");
  });

  return nextPool;
}

async function closePoolQuietly(targetPool) {
  if (!targetPool) return;
  try {
    await targetPool.end();
  } catch (error) {
    console.warn("UNBOUND AI DATABASE POOL CLOSE WARNING:", error?.message || error);
  }
}

function scheduleDatabaseInitialization(reason = "retry") {
  if (!process.env.DATABASE_URL || databaseRetryTimer || databaseInitializing) {
    return;
  }

  const delay = databaseRetryDelay(databaseInitAttempt || 1, DATABASE_RESILIENCE);
  console.warn(
    `UNBOUND AI database retry scheduled in ${delay}ms (${reason}).`
  );

  databaseRetryTimer = setTimeout(() => {
    databaseRetryTimer = null;
    void initializeDatabaseWithRetry();
  }, delay);
  databaseRetryTimer.unref?.();
}
''',
    "resilient database pool"
)

one(
    server,
    '''async function initializeDatabase() {
  pool = createPool();

  if (!pool) {
    databaseError = "DATABASE_URL is not configured.";
    console.log(
      "UNBOUND AI database not connected: DATABASE_URL is not configured."
    );
    return;
  }

  await pool.query(`
''',
    '''async function initializeDatabase() {
  const previousPool = pool;
  pool = null;
  await closePoolQuietly(previousPool);

  pool = createPool();

  if (!pool) {
    databaseError = "DATABASE_URL is not configured.";
    console.log(
      "UNBOUND AI database not connected: DATABASE_URL is not configured."
    );
    return;
  }

  await pool.query("SELECT 1");
  console.log("UNBOUND AI database connection verified; applying schema checks.");

  await pool.query(`
''',
    "database connection verification"
)

one(
    server,
    '''initializeDatabase().catch((error) => {
  databaseReady = false;
  databaseError = error.message;
  console.error("UNBOUND AI DATABASE ERROR:", error);
});
''',
    '''async function initializeDatabaseWithRetry() {
  if (databaseInitializing) return;

  databaseInitializing = true;
  databaseInitAttempt += 1;
  databaseReady = false;
  console.log(`UNBOUND AI database initialization attempt ${databaseInitAttempt} started.`);

  try {
    await initializeDatabase();
    if (databaseReady) {
      databaseInitAttempt = 0;
    }
  } catch (error) {
    databaseReady = false;
    databaseError = error?.message || "Database initialization failed.";
    console.error(
      `UNBOUND AI DATABASE INITIALIZATION FAILED (attempt ${databaseInitAttempt}):`,
      error
    );
  } finally {
    databaseInitializing = false;
  }

  if (!databaseReady && process.env.DATABASE_URL) {
    scheduleDatabaseInitialization("initialization-failure");
  }
}

void initializeDatabaseWithRetry();
''',
    "database initialization retry loop"
)

print("Applied UNBOUND AI v0.29 database startup resilience.")
