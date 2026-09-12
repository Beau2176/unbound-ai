const crypto = require("crypto");

const state = {
  startedAt: new Date().toISOString(),
  activeRequests: 0,
  completedRequests: 0,
  clientErrors: 0,
  serverErrors: 0,
  abortedRequests: 0,
  totalDurationMs: 0,
  maxDurationMs: 0
};

const QUIET_PATHS = new Set(["/healthz", "/readyz"]);

function normalizePathSegment(segment) {
  if (!segment) return "";
  if (/^\d+$/.test(segment)) return ":id";
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ":id";
  if (/^[A-Za-z0-9_-]{24,}$/.test(segment)) return ":token";
  return segment.replace(/[^A-Za-z0-9._~-]/g, "_").slice(0, 80);
}

function sanitizedRequestPath(req) {
  const rawPath = String(req?.path || "/").slice(0, 600);
  const segments = rawPath.split("/").map(normalizePathSegment);
  const normalized = segments.join("/") || "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function requestId() {
  return crypto.randomUUID();
}

function roundMs(value) {
  return Number(Math.max(0, value).toFixed(2));
}

function getRequestObservabilitySnapshot() {
  const averageDurationMs = state.completedRequests
    ? state.totalDurationMs / state.completedRequests
    : 0;

  return {
    processStartedAt: state.startedAt,
    activeRequests: state.activeRequests,
    completedRequests: state.completedRequests,
    clientErrors: state.clientErrors,
    serverErrors: state.serverErrors,
    abortedRequests: state.abortedRequests,
    averageDurationMs: roundMs(averageDurationMs),
    maxDurationMs: roundMs(state.maxDurationMs),
    scope: "current_process"
  };
}

function createRequestObservabilityMiddleware({ logger = console.log } = {}) {
  return function unboundRequestObservability(req, res, next) {
    const id = requestId();
    const method = String(req.method || "GET").toUpperCase();
    const path = sanitizedRequestPath(req);
    const started = process.hrtime.bigint();
    let recorded = false;

    req.requestId = id;
    res.setHeader("X-Request-ID", id);
    state.activeRequests += 1;

    const record = (aborted = false) => {
      if (recorded) return;
      recorded = true;
      state.activeRequests = Math.max(0, state.activeRequests - 1);

      const elapsedNs = process.hrtime.bigint() - started;
      const durationMs = Number(elapsedNs) / 1_000_000;
      const statusCode = aborted ? 499 : Number(res.statusCode || 0);

      state.completedRequests += 1;
      state.totalDurationMs += durationMs;
      state.maxDurationMs = Math.max(state.maxDurationMs, durationMs);
      if (aborted) state.abortedRequests += 1;
      if (statusCode >= 500) state.serverErrors += 1;
      else if (statusCode >= 400) state.clientErrors += 1;

      if (!QUIET_PATHS.has(path)) {
        logger(
          JSON.stringify({
            event: "http_request",
            requestId: id,
            method,
            path,
            statusCode,
            durationMs: roundMs(durationMs),
            aborted: Boolean(aborted),
            timestamp: new Date().toISOString()
          })
        );
      }
    };

    res.once("finish", () => record(false));
    res.once("close", () => {
      if (!res.writableEnded) record(true);
    });

    return next();
  };
}

module.exports = {
  sanitizedRequestPath,
  getRequestObservabilitySnapshot,
  createRequestObservabilityMiddleware
};
