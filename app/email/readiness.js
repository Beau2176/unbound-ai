const { getEmailGatewayStatus } = require("./gateway");

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function positiveInteger(value, fallback, { min = 1, max = 3650 } = {}) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function parseTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ageDays(date, nowMs) {
  if (!date) return null;
  return (nowMs - date.getTime()) / 86_400_000;
}

function buildEmailDeliveryReadiness({
  env = process.env,
  nowMs = Date.now(),
  gatewayStatus = null
} = {}) {
  const gateway = gatewayStatus || getEmailGatewayStatus(env);
  const senderIdentityVerified = truthy(env.EMAIL_SENDER_IDENTITY_VERIFIED);
  const productionAccessVerified = truthy(env.EMAIL_PROVIDER_PRODUCTION_ACCESS_VERIFIED);
  const deliveryReviewMaxAgeDays = positiveInteger(
    env.EMAIL_DELIVERY_REVIEW_MAX_AGE_DAYS,
    90,
    { min: 1, max: 365 }
  );
  const deliveryReviewedAt = parseTimestamp(env.EMAIL_DELIVERY_REVIEWED_AT);
  const deliveryReviewAgeDays = ageDays(deliveryReviewedAt, nowMs);
  const deliveryReviewNotFuture = Boolean(
    deliveryReviewedAt && deliveryReviewedAt.getTime() <= nowMs + 5 * 60 * 1000
  );
  const deliveryReviewFresh = Boolean(
    deliveryReviewedAt &&
      deliveryReviewNotFuture &&
      deliveryReviewAgeDays >= -5 / 1440 &&
      deliveryReviewAgeDays <= deliveryReviewMaxAgeDays
  );

  const blockers = [];
  if (gateway?.configured !== true || gateway?.canSendVerification !== true) {
    blockers.push("Transactional email provider credentials and adapter are not fully configured.");
  }
  if (!senderIdentityVerified) {
    blockers.push("Transactional email sender identity or domain has not been verified.");
  }
  if (!productionAccessVerified) {
    blockers.push("Transactional email production sending access has not been verified.");
  }
  if (!deliveryReviewedAt) {
    blockers.push("No successful production email-delivery review timestamp is recorded.");
  } else if (!deliveryReviewNotFuture) {
    blockers.push("The email-delivery review timestamp is unexpectedly in the future.");
  } else if (!deliveryReviewFresh) {
    blockers.push(`The most recent email-delivery review is older than ${deliveryReviewMaxAgeDays} days.`);
  }

  const launchReady = blockers.length === 0;
  return {
    status: launchReady ? "ready" : "attention_required",
    launchReady,
    provider: gateway?.provider || "none",
    adapterConfigured: gateway?.configured === true,
    canSendVerification: gateway?.canSendVerification === true,
    senderIdentityVerified,
    productionAccessVerified,
    deliveryReview: {
      maxAgeDays: deliveryReviewMaxAgeDays,
      reviewedAt: deliveryReviewedAt ? deliveryReviewedAt.toISOString() : null,
      ageDays:
        deliveryReviewAgeDays === null
          ? null
          : Number(Math.max(0, deliveryReviewAgeDays).toFixed(2)),
      fresh: deliveryReviewFresh
    },
    blockers
  };
}

module.exports = {
  truthy,
  positiveInteger,
  parseTimestamp,
  buildEmailDeliveryReadiness
};
