const DEFAULT_CIRCUIT_POLICY = Object.freeze({
  failureThreshold: 3,
  cooldownMs: 60000,
  minFailureThreshold: 1,
  maxFailureThreshold: 10,
  minCooldownMs: 10000,
  maxCooldownMs: 300000
});

const circuits = new Map();

function flagEnabled(value, defaultValue = true) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  return defaultValue;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function getProviderCircuitPolicy(env = process.env) {
  const fallbackConfigured = Boolean(String(env.AI_FALLBACK_PROVIDER || "").trim());
  return Object.freeze({
    enabled:
      fallbackConfigured &&
      flagEnabled(env.AI_PROVIDER_CIRCUIT_BREAKER_ENABLED, true),
    failureThreshold: boundedInteger(
      env.AI_PROVIDER_CIRCUIT_BREAKER_FAILURES,
      DEFAULT_CIRCUIT_POLICY.failureThreshold,
      DEFAULT_CIRCUIT_POLICY.minFailureThreshold,
      DEFAULT_CIRCUIT_POLICY.maxFailureThreshold
    ),
    cooldownMs: boundedInteger(
      env.AI_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS,
      DEFAULT_CIRCUIT_POLICY.cooldownMs,
      DEFAULT_CIRCUIT_POLICY.minCooldownMs,
      DEFAULT_CIRCUIT_POLICY.maxCooldownMs
    )
  });
}

function routeKey(primaryProviderId, fallbackProviderId) {
  const primary = String(primaryProviderId || "").trim().toLowerCase();
  const fallback = String(fallbackProviderId || "").trim().toLowerCase();
  return primary && fallback ? `${primary}->${fallback}` : null;
}

function emptyState() {
  return {
    failures: 0,
    openedAt: null,
    openUntil: null,
    lastFailureAt: null,
    lastSuccessAt: null,
    lastErrorCode: null,
    halfOpenProbeInFlight: false
  };
}

function stateFor(key) {
  if (!circuits.has(key)) circuits.set(key, emptyState());
  return circuits.get(key);
}

function cleanErrorCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9_.:-]{1,120}$/.test(code) ? code : null;
}

function publicState(state, policy, now) {
  if (!policy.enabled) {
    return {
      enabled: false,
      state: "disabled",
      failures: 0,
      failureThreshold: policy.failureThreshold,
      cooldownMs: policy.cooldownMs,
      openedAt: null,
      openUntil: null,
      lastFailureAt: null,
      lastSuccessAt: null,
      lastErrorCode: null,
      halfOpenProbeInFlight: false
    };
  }

  let circuitState = "closed";
  if (state.openUntil && now < state.openUntil) {
    circuitState = "open";
  } else if (state.openUntil && now >= state.openUntil) {
    circuitState = "half-open";
  }

  return {
    enabled: true,
    state: circuitState,
    failures: state.failures,
    failureThreshold: policy.failureThreshold,
    cooldownMs: policy.cooldownMs,
    openedAt: state.openedAt ? new Date(state.openedAt).toISOString() : null,
    openUntil: state.openUntil ? new Date(state.openUntil).toISOString() : null,
    lastFailureAt: state.lastFailureAt ? new Date(state.lastFailureAt).toISOString() : null,
    lastSuccessAt: state.lastSuccessAt ? new Date(state.lastSuccessAt).toISOString() : null,
    lastErrorCode: state.lastErrorCode,
    halfOpenProbeInFlight: Boolean(state.halfOpenProbeInFlight)
  };
}

function getProviderCircuitSnapshot({
  primaryProviderId,
  fallbackProviderId,
  env = process.env,
  now = Date.now()
} = {}) {
  const policy = getProviderCircuitPolicy(env);
  const key = routeKey(primaryProviderId, fallbackProviderId);
  if (!key) return publicState(emptyState(), { ...policy, enabled: false }, Number(now));
  const state = circuits.get(key) || emptyState();
  return publicState(state, policy, Number(now));
}

function beginProviderCircuitAttempt({
  primaryProviderId,
  fallbackProviderId,
  env = process.env,
  now = Date.now()
} = {}) {
  const policy = getProviderCircuitPolicy(env);
  const key = routeKey(primaryProviderId, fallbackProviderId);
  const timestamp = Number(now);

  if (!policy.enabled || !key) {
    return {
      bypassPrimary: false,
      halfOpenProbe: false,
      snapshot: publicState(emptyState(), { ...policy, enabled: false }, timestamp)
    };
  }

  const state = stateFor(key);

  if (state.openUntil && timestamp < state.openUntil) {
    return {
      bypassPrimary: true,
      halfOpenProbe: false,
      snapshot: publicState(state, policy, timestamp)
    };
  }

  if (state.openUntil && timestamp >= state.openUntil) {
    if (state.halfOpenProbeInFlight) {
      return {
        bypassPrimary: true,
        halfOpenProbe: false,
        snapshot: publicState(state, policy, timestamp)
      };
    }
    state.halfOpenProbeInFlight = true;
    return {
      bypassPrimary: false,
      halfOpenProbe: true,
      snapshot: publicState(state, policy, timestamp)
    };
  }

  return {
    bypassPrimary: false,
    halfOpenProbe: false,
    snapshot: publicState(state, policy, timestamp)
  };
}

function cancelProviderCircuitAttempt({
  primaryProviderId,
  fallbackProviderId,
  env = process.env,
  now = Date.now()
} = {}) {
  const policy = getProviderCircuitPolicy(env);
  const key = routeKey(primaryProviderId, fallbackProviderId);
  const timestamp = Number(now);
  if (!policy.enabled || !key) {
    return getProviderCircuitSnapshot({
      primaryProviderId,
      fallbackProviderId,
      env,
      now: timestamp
    });
  }

  const state = stateFor(key);
  state.halfOpenProbeInFlight = false;
  return publicState(state, policy, timestamp);
}

function recordProviderCircuitSuccess({
  primaryProviderId,
  fallbackProviderId,
  env = process.env,
  now = Date.now()
} = {}) {
  const policy = getProviderCircuitPolicy(env);
  const key = routeKey(primaryProviderId, fallbackProviderId);
  const timestamp = Number(now);
  if (!policy.enabled || !key) {
    return getProviderCircuitSnapshot({
      primaryProviderId,
      fallbackProviderId,
      env,
      now: timestamp
    });
  }

  const state = stateFor(key);
  state.failures = 0;
  state.openedAt = null;
  state.openUntil = null;
  state.lastSuccessAt = timestamp;
  state.lastErrorCode = null;
  state.halfOpenProbeInFlight = false;
  return publicState(state, policy, timestamp);
}

function recordProviderCircuitFailure({
  primaryProviderId,
  fallbackProviderId,
  retryable,
  errorCode = null,
  env = process.env,
  now = Date.now()
} = {}) {
  const policy = getProviderCircuitPolicy(env);
  const key = routeKey(primaryProviderId, fallbackProviderId);
  const timestamp = Number(now);
  if (!policy.enabled || !key) {
    return getProviderCircuitSnapshot({
      primaryProviderId,
      fallbackProviderId,
      env,
      now: timestamp
    });
  }

  const state = stateFor(key);

  if (!retryable) {
    // A deterministic client/config/policy response proves the provider is
    // reachable, so it must not count as an availability outage.
    state.failures = 0;
    state.openedAt = null;
    state.openUntil = null;
    state.lastSuccessAt = timestamp;
    state.lastErrorCode = null;
    state.halfOpenProbeInFlight = false;
    return publicState(state, policy, timestamp);
  }

  state.failures += 1;
  state.lastFailureAt = timestamp;
  state.lastErrorCode = cleanErrorCode(errorCode);
  const wasHalfOpen = Boolean(state.openUntil && timestamp >= state.openUntil);

  if (wasHalfOpen || state.failures >= policy.failureThreshold) {
    state.openedAt = timestamp;
    state.openUntil = timestamp + policy.cooldownMs;
  }
  state.halfOpenProbeInFlight = false;

  return publicState(state, policy, timestamp);
}

function resetProviderCircuitBreakers() {
  circuits.clear();
}

module.exports = {
  DEFAULT_CIRCUIT_POLICY,
  getProviderCircuitPolicy,
  getProviderCircuitSnapshot,
  beginProviderCircuitAttempt,
  cancelProviderCircuitAttempt,
  recordProviderCircuitSuccess,
  recordProviderCircuitFailure,
  resetProviderCircuitBreakers
};
