const DATABASE_RESILIENCE_DEFAULTS = Object.freeze({
  connectionTimeoutMillis: 10000,
  statementTimeoutMillis: 45000,
  queryTimeoutMillis: 50000,
  lockTimeoutMillis: 15000,
  retryBaseMillis: 2000,
  retryMaxMillis: 30000
});

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function getDatabaseResilienceConfig(env = process.env) {
  return {
    connectionTimeoutMillis: boundedInteger(
      env.UNBOUND_DB_CONNECTION_TIMEOUT_MS,
      DATABASE_RESILIENCE_DEFAULTS.connectionTimeoutMillis,
      1000,
      60000
    ),
    statementTimeoutMillis: boundedInteger(
      env.UNBOUND_DB_STATEMENT_TIMEOUT_MS,
      DATABASE_RESILIENCE_DEFAULTS.statementTimeoutMillis,
      5000,
      180000
    ),
    queryTimeoutMillis: boundedInteger(
      env.UNBOUND_DB_QUERY_TIMEOUT_MS,
      DATABASE_RESILIENCE_DEFAULTS.queryTimeoutMillis,
      5000,
      190000
    ),
    lockTimeoutMillis: boundedInteger(
      env.UNBOUND_DB_LOCK_TIMEOUT_MS,
      DATABASE_RESILIENCE_DEFAULTS.lockTimeoutMillis,
      1000,
      120000
    ),
    retryBaseMillis: boundedInteger(
      env.UNBOUND_DB_RETRY_BASE_MS,
      DATABASE_RESILIENCE_DEFAULTS.retryBaseMillis,
      500,
      30000
    ),
    retryMaxMillis: boundedInteger(
      env.UNBOUND_DB_RETRY_MAX_MS,
      DATABASE_RESILIENCE_DEFAULTS.retryMaxMillis,
      1000,
      120000
    )
  };
}

function databaseRetryDelay(attempt, config = getDatabaseResilienceConfig()) {
  const normalizedAttempt = Math.max(1, Math.floor(Number(attempt) || 1));
  const exponent = Math.min(normalizedAttempt - 1, 6);
  const rawDelay = config.retryBaseMillis * (2 ** exponent);
  return Math.min(rawDelay, Math.max(config.retryBaseMillis, config.retryMaxMillis));
}

module.exports = {
  DATABASE_RESILIENCE_DEFAULTS,
  getDatabaseResilienceConfig,
  databaseRetryDelay
};
