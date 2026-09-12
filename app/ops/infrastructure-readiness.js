const INFRA_PROFILES = Object.freeze(["development", "staging", "production"]);

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function normalizeProfile(value) {
  const profile = String(value || "").trim().toLowerCase();
  return INFRA_PROFILES.includes(profile) ? profile : "development";
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ageDays(date, nowMs) {
  if (!date) return null;
  return Math.max(0, (nowMs - date.getTime()) / 86_400_000);
}

function buildInfrastructureReadiness({ env = process.env, nowMs = Date.now() } = {}) {
  const profile = normalizeProfile(env.UNBOUND_INFRA_PROFILE);
  const productionReady = truthy(env.UNBOUND_INFRA_PRODUCTION_READY);
  const alwaysOnCompute = truthy(env.UNBOUND_INFRA_ALWAYS_ON_COMPUTE);
  const durableDatabase = truthy(env.UNBOUND_INFRA_DURABLE_DATABASE);
  const healthCheckConfigured = truthy(env.UNBOUND_INFRA_HEALTH_CHECK_CONFIGURED);
  const reviewMaxAgeDays = positiveInteger(env.UNBOUND_INFRA_REVIEW_MAX_AGE_DAYS, 90);
  const reviewedAt = parseTimestamp(env.UNBOUND_INFRA_REVIEWED_AT);
  const reviewAgeDays = ageDays(reviewedAt, nowMs);
  const reviewFresh = Boolean(reviewedAt && reviewAgeDays <= reviewMaxAgeDays);

  const blockers = [];
  if (profile !== "production") {
    blockers.push("Infrastructure profile is not marked production.");
  }
  if (!productionReady) {
    blockers.push("Production infrastructure has not been explicitly approved for launch.");
  }
  if (!alwaysOnCompute) {
    blockers.push("Always-on application compute has not been verified.");
  }
  if (!durableDatabase) {
    blockers.push("A durable, non-expiring production database has not been verified.");
  }
  if (!healthCheckConfigured) {
    blockers.push("The hosting platform health check has not been verified against the application health endpoint.");
  }
  if (!reviewedAt) {
    blockers.push("No production infrastructure review timestamp is recorded.");
  } else if (!reviewFresh) {
    blockers.push(`The most recent infrastructure review is older than ${reviewMaxAgeDays} days.`);
  }

  const launchReady = blockers.length === 0;

  return {
    status: launchReady ? "ready" : "attention_required",
    launchReady,
    profile,
    productionReady,
    alwaysOnCompute,
    durableDatabase,
    healthCheckConfigured,
    review: {
      maxAgeDays: reviewMaxAgeDays,
      reviewedAt: reviewedAt ? reviewedAt.toISOString() : null,
      ageDays: reviewAgeDays === null ? null : Number(reviewAgeDays.toFixed(2)),
      fresh: reviewFresh
    },
    blockers
  };
}

module.exports = {
  INFRA_PROFILES,
  normalizeProfile,
  buildInfrastructureReadiness
};
