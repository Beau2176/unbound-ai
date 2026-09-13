const assert = require("assert");
const {
  OWNER_READINESS_PROFILE,
  FUTURE_SKEW_MS,
  parseReviewedAt,
  buildOwnerReadiness
} = require("../ops/owner-readiness");

function main() {
  const nowMs = Date.UTC(2026, 8, 13, 4, 0, 0);
  const reviewedAt = new Date(nowMs - 60_000).toISOString();

  const empty = buildOwnerReadiness({ env: {}, nowMs });
  assert.strictEqual(empty.profile, OWNER_READINESS_PROFILE);
  assert.strictEqual(empty.ready, false);
  assert.strictEqual(empty.readyCount, 0);
  assert.strictEqual(empty.blockerCount, 5);
  assert.strictEqual(empty.completionPercent, 0);
  assert.strictEqual(empty.checks.length, 5);

  const flagsOnly = buildOwnerReadiness({
    env: {
      UNBOUND_BANKING_APPROVED: "true",
      UNBOUND_BANKING_RAILS_VERIFIED: "true",
      UNBOUND_SEGPAY_MERCHANT_APPROVED: "true",
      UNBOUND_ADVERTISING_CHANNEL_CONFIRMED: "true",
      UNBOUND_LEGAL_COUNSEL_REVIEW_COMPLETE: "true"
    },
    nowMs
  });
  assert.strictEqual(flagsOnly.ready, false);
  assert.strictEqual(flagsOnly.readyCount, 0, "Approval flags must not pass without review timestamps.");

  const fullyVerifiedEnv = {
    UNBOUND_BANKING_APPROVED: "true",
    UNBOUND_BANKING_REVIEWED_AT: reviewedAt,
    UNBOUND_BANKING_RAILS_VERIFIED: "true",
    UNBOUND_BANKING_RAILS_REVIEWED_AT: reviewedAt,
    UNBOUND_SEGPAY_MERCHANT_APPROVED: "true",
    UNBOUND_SEGPAY_MERCHANT_REVIEWED_AT: reviewedAt,
    UNBOUND_ADVERTISING_CHANNEL_CONFIRMED: "true",
    UNBOUND_ADVERTISING_CHANNEL_REVIEWED_AT: reviewedAt,
    UNBOUND_LEGAL_COUNSEL_REVIEW_COMPLETE: "true",
    UNBOUND_LEGAL_COUNSEL_REVIEWED_AT: reviewedAt
  };
  const ready = buildOwnerReadiness({ env: fullyVerifiedEnv, nowMs });
  assert.strictEqual(ready.ready, true);
  assert.strictEqual(ready.status, "ready");
  assert.strictEqual(ready.readyCount, 5);
  assert.strictEqual(ready.blockerCount, 0);
  assert.strictEqual(ready.completionPercent, 100);
  assert.strictEqual(ready.blockers.length, 0);

  const future = new Date(nowMs + FUTURE_SKEW_MS + 1_000).toISOString();
  const futureResult = buildOwnerReadiness({
    env: { ...fullyVerifiedEnv, UNBOUND_BANKING_REVIEWED_AT: future },
    nowMs
  });
  assert.strictEqual(futureResult.ready, false);
  assert.strictEqual(futureResult.readyCount, 4);
  assert.strictEqual(futureResult.completionPercent, 80);
  assert.ok(futureResult.blockers[0].detail.includes("future"));

  assert.strictEqual(parseReviewedAt("not-a-date", nowMs).valid, false);
  assert.strictEqual(parseReviewedAt(reviewedAt, nowMs).valid, true);

  console.log("PASS owner-readiness contract: approvals fail closed, timestamps are required, future attestations are rejected, and percentages remain truthful.");
}

main();
