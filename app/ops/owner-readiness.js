const OWNER_READINESS_PROFILE = "owner_business";
const FUTURE_SKEW_MS = 5 * 60 * 1000;

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function parseReviewedAt(value, nowMs) {
  const text = String(value || "").trim();
  if (!text) return { valid: false, value: null, reason: "review timestamp is missing" };
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return { valid: false, value: null, reason: "review timestamp is invalid" };
  if (parsed > nowMs + FUTURE_SKEW_MS) {
    return { valid: false, value: new Date(parsed).toISOString(), reason: "review timestamp is in the future" };
  }
  return { valid: true, value: new Date(parsed).toISOString(), reason: null };
}

function buildVerifiedCheck({ env, nowMs, key, label, flagName, reviewedAtName, successDetail, pendingDetail }) {
  const approved = truthy(env[flagName]);
  const reviewedAt = parseReviewedAt(env[reviewedAtName], nowMs);
  const ready = approved && reviewedAt.valid;

  let detail = pendingDetail;
  if (ready) detail = `${successDetail} Reviewed ${reviewedAt.value}.`;
  else if (approved && !reviewedAt.valid) detail = `${successDetail} The ${reviewedAt.reason}; record ${reviewedAtName} after verification.`;

  return {
    key,
    label,
    ready,
    category: "owner_business",
    reviewedAt: reviewedAt.value,
    detail
  };
}

function buildOwnerReadiness({ env = process.env, nowMs = Date.now() } = {}) {
  const checks = [
    buildVerifiedCheck({
      env,
      nowMs,
      key: "banking_approved",
      label: "Business banking approved",
      flagName: "UNBOUND_BANKING_APPROVED",
      reviewedAtName: "UNBOUND_BANKING_REVIEWED_AT",
      successDetail: "A bank has approved UNBOUND's actual business model and account use.",
      pendingDetail: "A bank must approve UNBOUND's actual 18+ AI/SaaS business model before this check can pass."
    }),
    buildVerifiedCheck({
      env,
      nowMs,
      key: "banking_rails_verified",
      label: "Banking and settlement rails verified",
      flagName: "UNBOUND_BANKING_RAILS_VERIFIED",
      reviewedAtName: "UNBOUND_BANKING_RAILS_REVIEWED_AT",
      successDetail: "The approved account can receive intended settlements and make required business payments.",
      pendingDetail: "Verify the approved account's settlement, ACH/wire, and normal business-payment paths before enabling this check."
    }),
    buildVerifiedCheck({
      env,
      nowMs,
      key: "segpay_merchant_approved",
      label: "Segpay merchant approval recorded",
      flagName: "UNBOUND_SEGPAY_MERCHANT_APPROVED",
      reviewedAtName: "UNBOUND_SEGPAY_MERCHANT_REVIEWED_AT",
      successDetail: "Segpay has approved UNBOUND for the intended commercial billing model.",
      pendingDetail: "Production billing code does not count as merchant approval; Segpay must approve the real business and intended billing model."
    }),
    buildVerifiedCheck({
      env,
      nowMs,
      key: "advertising_channel_confirmed",
      label: "Advertising revenue channel confirmed",
      flagName: "UNBOUND_ADVERTISING_CHANNEL_CONFIRMED",
      reviewedAtName: "UNBOUND_ADVERTISING_CHANNEL_REVIEWED_AT",
      successDetail: "At least one viable advertiser, direct-sales path, or ad-network relationship has been confirmed for UNBOUND.",
      pendingDetail: "Confirm at least one real advertising sales or network path that accepts UNBOUND's business model."
    }),
    buildVerifiedCheck({
      env,
      nowMs,
      key: "legal_counsel_review",
      label: "Final launch legal review recorded",
      flagName: "UNBOUND_LEGAL_COUNSEL_REVIEW_COMPLETE",
      reviewedAtName: "UNBOUND_LEGAL_COUNSEL_REVIEWED_AT",
      successDetail: "A final launch legal review has been recorded for the actual product, policies, age gate, billing, advertising, and data flows.",
      pendingDetail: "Record final legal review of the actual launch configuration before treating this owner/business layer as ready."
    })
  ];

  const readyCount = checks.filter((check) => check.ready).length;
  const blockerCount = checks.length - readyCount;
  const completionPercent = checks.length ? Math.round((readyCount / checks.length) * 100) : 0;

  return {
    profile: OWNER_READINESS_PROFILE,
    status: blockerCount === 0 ? "ready" : "blocked",
    ready: blockerCount === 0,
    readyCount,
    blockerCount,
    completionPercent,
    checkedAt: new Date(nowMs).toISOString(),
    disclaimer: "Owner/business readiness is an internal verification checklist. It is not bank approval, processor approval, legal advice, or regulatory certification by itself.",
    checks,
    blockers: checks.filter((check) => !check.ready).map((check) => ({ key: check.key, label: check.label, detail: check.detail }))
  };
}

module.exports = {
  OWNER_READINESS_PROFILE,
  FUTURE_SKEW_MS,
  truthy,
  parseReviewedAt,
  buildOwnerReadiness
};
