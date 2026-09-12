function cleanValue(value, maxLength = 160) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function getRuntimeIdentity(env = process.env) {
  const commit = cleanValue(
    env.RENDER_GIT_COMMIT || env.UNBOUND_BUILD_SHA || env.GIT_COMMIT,
    80
  );

  return {
    service: cleanValue(env.RENDER_SERVICE_NAME || env.UNBOUND_SERVICE_NAME, 120) || "unbound-ai",
    environment: cleanValue(env.NODE_ENV, 40) || "development",
    commit,
    commitShort: commit ? commit.slice(0, 12) : null
  };
}

function buildLivenessStatus({ env = process.env, uptimeSeconds = process.uptime() } = {}) {
  return {
    status: "ok",
    live: true,
    runtime: getRuntimeIdentity(env),
    uptimeSeconds: Math.max(0, Math.floor(Number(uptimeSeconds) || 0)),
    timestamp: new Date().toISOString()
  };
}

function buildReadinessStatus({
  env = process.env,
  uptimeSeconds = process.uptime(),
  databaseReady = false,
  databaseConfigured = false,
  databaseError = null,
  shuttingDown = false,
  maintenanceStatus = null,
  aiStatus = null
} = {}) {
  const database = {
    configured: Boolean(databaseConfigured),
    ready: Boolean(databaseReady),
    state: shuttingDown
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
    runtime: getRuntimeIdentity(env),
    uptimeSeconds: Math.max(0, Math.floor(Number(uptimeSeconds) || 0)),
    timestamp: new Date().toISOString(),
    components: {
      database,
      maintenance,
      ai: {
        configured: Boolean(aiStatus?.configured),
        provider: cleanValue(aiStatus?.provider, 80),
        model: cleanValue(aiStatus?.model, 120)
      }
    }
  };
}

module.exports = {
  getRuntimeIdentity,
  buildLivenessStatus,
  buildReadinessStatus
};
