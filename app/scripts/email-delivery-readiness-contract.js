const assert = require("assert");
const { buildEmailDeliveryReadiness } = require("../email/readiness");
const { buildLaunchReadiness } = require("../ops/launch-readiness");

const NOW = Date.parse("2026-09-12T20:00:00.000Z");

function otherwiseReadyLaunch(emailDelivery) {
  return buildLaunchReadiness({
    nowMs: NOW,
    runtime: { ready: true, operational: true, status: "ready" },
    maintenance: { active: false },
    infrastructure: { launchReady: true },
    recovery: { launchReady: true },
    legal: {
      documentsPublished: true,
      acceptanceEnabled: true,
      enforcementEnabled: true
    },
    billing: {
      configured: true,
      checkout: true,
      customerPortal: true,
      webhooks: true,
      provider: "contract"
    },
    ageVerification: {
      configured: true,
      startVerification: true,
      webhooks: true,
      minimumAge: 18
    },
    ai: {
      configured: true,
      streaming: true,
      research: true,
      provider: "contract"
    },
    emailDelivery
  });
}

function main() {
  const gatewayStatus = {
    provider: "aws-ses",
    configured: true,
    canSendVerification: true,
    error: null
  };

  const ready = buildEmailDeliveryReadiness({
    nowMs: NOW,
    gatewayStatus,
    env: {
      EMAIL_SENDER_IDENTITY_VERIFIED: "true",
      EMAIL_PROVIDER_PRODUCTION_ACCESS_VERIFIED: "yes",
      EMAIL_DELIVERY_REVIEWED_AT: "2026-09-10T20:00:00.000Z",
      EMAIL_DELIVERY_REVIEW_MAX_AGE_DAYS: "30"
    }
  });
  assert.strictEqual(ready.launchReady, true);
  assert.strictEqual(ready.status, "ready");
  assert.strictEqual(ready.provider, "aws-ses");
  assert.strictEqual(ready.adapterConfigured, true);
  assert.strictEqual(ready.senderIdentityVerified, true);
  assert.strictEqual(ready.productionAccessVerified, true);
  assert.strictEqual(ready.deliveryReview.fresh, true);
  assert.deepStrictEqual(ready.blockers, []);
  assert.ok(!("accessKeyId" in ready));
  assert.ok(!("secretAccessKey" in ready));

  const configuredOnly = buildEmailDeliveryReadiness({
    nowMs: NOW,
    gatewayStatus,
    env: {}
  });
  assert.strictEqual(configuredOnly.launchReady, false);
  assert.ok(configuredOnly.blockers.some((item) => /sender identity/i.test(item)));
  assert.ok(configuredOnly.blockers.some((item) => /production sending access/i.test(item)));
  assert.ok(configuredOnly.blockers.some((item) => /review timestamp/i.test(item)));

  const stale = buildEmailDeliveryReadiness({
    nowMs: NOW,
    gatewayStatus,
    env: {
      EMAIL_SENDER_IDENTITY_VERIFIED: "1",
      EMAIL_PROVIDER_PRODUCTION_ACCESS_VERIFIED: "1",
      EMAIL_DELIVERY_REVIEWED_AT: "2026-06-01T00:00:00.000Z",
      EMAIL_DELIVERY_REVIEW_MAX_AGE_DAYS: "30"
    }
  });
  assert.strictEqual(stale.launchReady, false);
  assert.strictEqual(stale.deliveryReview.fresh, false);
  assert.ok(stale.blockers.some((item) => /older than 30 days/i.test(item)));

  const future = buildEmailDeliveryReadiness({
    nowMs: NOW,
    gatewayStatus,
    env: {
      EMAIL_SENDER_IDENTITY_VERIFIED: "true",
      EMAIL_PROVIDER_PRODUCTION_ACCESS_VERIFIED: "true",
      EMAIL_DELIVERY_REVIEWED_AT: "2026-09-13T20:00:00.000Z"
    }
  });
  assert.strictEqual(future.launchReady, false);
  assert.ok(future.blockers.some((item) => /future/i.test(item)));

  const unavailable = buildEmailDeliveryReadiness({
    nowMs: NOW,
    gatewayStatus: {
      provider: "aws-ses",
      configured: false,
      canSendVerification: false,
      error: "provider-not-configured"
    },
    env: {
      EMAIL_SENDER_IDENTITY_VERIFIED: "true",
      EMAIL_PROVIDER_PRODUCTION_ACCESS_VERIFIED: "true",
      EMAIL_DELIVERY_REVIEWED_AT: "2026-09-12T19:00:00.000Z"
    }
  });
  assert.strictEqual(unavailable.launchReady, false);
  assert.ok(unavailable.blockers.some((item) => /credentials and adapter/i.test(item)));

  const launchReady = otherwiseReadyLaunch(ready);
  assert.strictEqual(launchReady.launchReady, true);
  assert.strictEqual(
    launchReady.checks.find((check) => check.key === "transactional_email")?.ready,
    true
  );

  const blockedLaunch = otherwiseReadyLaunch(configuredOnly);
  assert.strictEqual(blockedLaunch.launchReady, false);
  const emailBlocker = blockedLaunch.blockers.find(
    (blocker) => blocker.key === "transactional_email"
  );
  assert.ok(emailBlocker);
  assert.match(emailBlocker.detail, /sender identity/i);

  console.log("Email delivery readiness contract passed.");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
