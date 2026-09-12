const MAINTENANCE_MODES = Object.freeze(["off", "read_only", "offline"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function normalizeMaintenanceMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return MAINTENANCE_MODES.includes(mode) ? mode : "off";
}

function positiveInteger(value, fallback, max = 86400) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function cleanMessage(value) {
  const message = String(value || "").trim();
  return (
    message ||
    "UNBOUND AI is temporarily in maintenance mode. Please try again shortly."
  ).slice(0, 500);
}

function getMaintenanceStatus(env = process.env) {
  const mode = normalizeMaintenanceMode(env.UNBOUND_MAINTENANCE_MODE);
  const active = mode !== "off";

  return {
    mode,
    active,
    writeBlocked: mode === "read_only" || mode === "offline",
    serviceUnavailable: mode === "offline",
    retryAfterSeconds: positiveInteger(env.UNBOUND_MAINTENANCE_RETRY_AFTER_SECONDS, 300),
    message: cleanMessage(env.UNBOUND_MAINTENANCE_MESSAGE)
  };
}

function maintenanceAllowsRequest(status, req) {
  if (!status.active) return true;

  const path = String(req.path || req.originalUrl || "").split("?")[0];
  if (path === "/system/status" || path === "/api/system/status") {
    return true;
  }

  if (status.mode === "read_only") {
    return SAFE_METHODS.has(String(req.method || "GET").toUpperCase());
  }

  return false;
}

function createMaintenanceMiddleware({ envProvider = () => process.env } = {}) {
  return function unboundMaintenanceMode(req, res, next) {
    const status = getMaintenanceStatus(envProvider());
    if (maintenanceAllowsRequest(status, req)) {
      return next();
    }

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Retry-After", String(status.retryAfterSeconds));
    return res.status(503).json({
      error: status.message,
      maintenance: status
    });
  };
}

module.exports = {
  MAINTENANCE_MODES,
  normalizeMaintenanceMode,
  getMaintenanceStatus,
  maintenanceAllowsRequest,
  createMaintenanceMiddleware
};
