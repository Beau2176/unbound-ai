const TELEMETRY_VERSION = "v1.0";

const LATENCY_BUCKETS = Object.freeze([
  Object.freeze({ key: "lt_1s", maxMs: 1000 }),
  Object.freeze({ key: "1s_3s", maxMs: 3000 }),
  Object.freeze({ key: "3s_10s", maxMs: 10000 }),
  Object.freeze({ key: "gte_10s", maxMs: Infinity })
]);

const ALLOWED_ROLES = new Set(["primary", "fallback", "research"]);
const ALLOWED_ROUTING_EVENTS = new Set(["failover", "circuit_bypass"]);
const providers = new Map();
const routes = new Map();

const routing = {
  failovers: 0,
  circuitBypasses: 0
};

let startedAt = new Date().toISOString();

function cleanProviderId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(id) ? id : "unknown";
}

function cleanRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return ALLOWED_ROLES.has(role) ? role : "primary";
}

function cleanErrorCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9_.:-]{1,120}$/.test(code) ? code : null;
}

function providerState(providerId) {
  const id = cleanProviderId(providerId);
  if (!providers.has(id)) {
    providers.set(id, {
      attempts: 0,
      successes: 0,
      failures: 0,
      retryableFailures: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      roles: { primary: 0, fallback: 0, research: 0 },
      latencyBuckets: {
        lt_1s: 0,
        "1s_3s": 0,
        "3s_10s": 0,
        gte_10s: 0
      },
      lastSuccessAt: null,
      lastFailureAt: null,
      lastErrorCode: null
    });
  }
  return { id, state: providers.get(id) };
}

function latencyBucket(durationMs) {
  const value = Math.max(0, Number(durationMs) || 0);
  return LATENCY_BUCKETS.find((bucket) => value < bucket.maxMs)?.key || "gte_10s";
}

function beginProviderAttempt({
  providerId,
  role = "primary",
  startedAtNs = process.hrtime.bigint()
} = {}) {
  const entry = providerState(providerId);
  const normalizedRole = cleanRole(role);
  entry.state.attempts += 1;
  entry.state.roles[normalizedRole] += 1;

  return Object.freeze({
    providerId: entry.id,
    role: normalizedRole,
    startedAtNs
  });
}

function finishProviderAttempt(token, {
  ok,
  retryable = false,
  errorCode = null,
  durationMs = null,
  now = Date.now()
} = {}) {
  const entry = providerState(token?.providerId);
  let elapsedMs = Number(durationMs);
  if (!Number.isFinite(elapsedMs)) {
    try {
      elapsedMs = Number(process.hrtime.bigint() - token.startedAtNs) / 1_000_000;
    } catch (_) {
      elapsedMs = 0;
    }
  }
  elapsedMs = Math.max(0, elapsedMs);

  entry.state.totalDurationMs += elapsedMs;
  entry.state.maxDurationMs = Math.max(entry.state.maxDurationMs, elapsedMs);
  entry.state.latencyBuckets[latencyBucket(elapsedMs)] += 1;

  if (ok) {
    entry.state.successes += 1;
    entry.state.lastSuccessAt = Number(now);
    entry.state.lastErrorCode = null;
  } else {
    entry.state.failures += 1;
    if (retryable) entry.state.retryableFailures += 1;
    entry.state.lastFailureAt = Number(now);
    entry.state.lastErrorCode = cleanErrorCode(errorCode);
  }
}

function routeKey(fromProvider, toProvider) {
  return `${cleanProviderId(fromProvider)}->${cleanProviderId(toProvider)}`;
}

function recordProviderRoutingEvent({
  type,
  fromProvider,
  toProvider
} = {}) {
  const normalizedType = String(type || "").trim().toLowerCase();
  if (!ALLOWED_ROUTING_EVENTS.has(normalizedType)) return false;

  const key = routeKey(fromProvider, toProvider);
  if (!routes.has(key)) {
    routes.set(key, { failovers: 0, circuitBypasses: 0 });
  }
  const state = routes.get(key);

  if (normalizedType === "failover") {
    routing.failovers += 1;
    state.failovers += 1;
  } else {
    routing.circuitBypasses += 1;
    state.circuitBypasses += 1;
  }
  return true;
}

function roundMs(value) {
  return Number(Math.max(0, Number(value) || 0).toFixed(2));
}

function publicProviderState(providerId, state) {
  const averageDurationMs = state.attempts
    ? state.totalDurationMs / state.attempts
    : 0;
  return {
    provider: providerId,
    attempts: state.attempts,
    successes: state.successes,
    failures: state.failures,
    retryableFailures: state.retryableFailures,
    roles: { ...state.roles },
    averageDurationMs: roundMs(averageDurationMs),
    maxDurationMs: roundMs(state.maxDurationMs),
    latencyBuckets: { ...state.latencyBuckets },
    lastSuccessAt: state.lastSuccessAt ? new Date(state.lastSuccessAt).toISOString() : null,
    lastFailureAt: state.lastFailureAt ? new Date(state.lastFailureAt).toISOString() : null,
    lastErrorCode: state.lastErrorCode
  };
}

function getProviderTelemetrySnapshot() {
  const providerSnapshots = {};
  for (const [providerId, state] of providers.entries()) {
    providerSnapshots[providerId] = publicProviderState(providerId, state);
  }

  const routeSnapshots = {};
  for (const [key, state] of routes.entries()) {
    routeSnapshots[key] = { ...state };
  }

  return {
    version: TELEMETRY_VERSION,
    processStartedAt: startedAt,
    scope: "current_process",
    privacy: "aggregate_content_blind",
    routing: {
      failovers: routing.failovers,
      circuitBypasses: routing.circuitBypasses,
      routes: routeSnapshots
    },
    providers: providerSnapshots
  };
}

function resetProviderTelemetry() {
  providers.clear();
  routes.clear();
  routing.failovers = 0;
  routing.circuitBypasses = 0;
  startedAt = new Date().toISOString();
}

module.exports = {
  TELEMETRY_VERSION,
  LATENCY_BUCKETS,
  cleanProviderId,
  cleanErrorCode,
  beginProviderAttempt,
  finishProviderAttempt,
  recordProviderRoutingEvent,
  getProviderTelemetrySnapshot,
  resetProviderTelemetry
};
