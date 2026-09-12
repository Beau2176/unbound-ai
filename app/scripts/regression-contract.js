const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  subscriptionBlocksAccountDeletion,
  publicDeletionBlock
} = require("../privacy/account-deletion");
const { legalPublishingState } = require("../privacy/legal-consent");
const {
  buildReadinessStatus
} = require("../ops/runtime-status");
const {
  getDatabaseResilienceConfig,
  databaseRetryDelay
} = require("../ops/database-resilience");
const { buildRecoveryReadiness } = require("../ops/recovery-readiness");
const {
  getMaintenanceStatus,
  maintenanceAllowsRequest
} = require("../ops/maintenance-mode");
const { sanitizedRequestPath } = require("../ops/request-observability");
const { buildLaunchReadiness } = require("../ops/launch-readiness");

const appRoot = path.resolve(__dirname, "..");

function testAccountDeletion() {
  const active = {
    provider: "test",
    provider_subscription_id: "sub_secret_internal_id",
    status: "active",
    cancel_at_period_end: false,
    current_period_end: "2026-10-01T00:00:00Z"
  };
  assert.equal(subscriptionBlocksAccountDeletion(active), true);
  const block = publicDeletionBlock(active);
  assert.equal(block.code, "active_subscription");
  assert.equal(block.status, "active");
  assert.equal(Object.hasOwn(block, "provider_subscription_id"), false);
  assert.equal(
    subscriptionBlocksAccountDeletion({ ...active, status: "canceled" }),
    false
  );
  assert.equal(
    subscriptionBlocksAccountDeletion({ status: "active" }),
    false
  );
}

function testLegalPublishing() {
  const draft = legalPublishingState({});
  assert.equal(draft.documentsPublished, false);
  assert.equal(draft.acceptanceEnabled, false);
  assert.equal(draft.enforcementEnabled, false);
  assert.ok(draft.documents.every((document) => document.version.includes("draft")));

  const published = legalPublishingState({
    UNBOUND_TERMS_VERSION: "2026-09-12",
    UNBOUND_TERMS_URL: "https://example.invalid/terms",
    UNBOUND_PRIVACY_VERSION: "2026-09-12",
    UNBOUND_PRIVACY_URL: "https://example.invalid/privacy",
    UNBOUND_LEGAL_ACCEPTANCE_ENABLED: "true",
    UNBOUND_LEGAL_ENFORCEMENT_ENABLED: "true"
  });
  assert.equal(published.documentsPublished, true);
  assert.equal(published.acceptanceEnabled, true);
  assert.equal(published.enforcementEnabled, true);
}

function testRuntimeStatus() {
  const live = buildReadinessStatus({
    env: { NODE_ENV: "test", UNBOUND_BUILD_SHA: "abcdef1234567890" },
    uptimeSeconds: 50,
    databaseConfigured: true,
    databaseReady: true,
    maintenanceStatus: { mode: "off", active: false },
    aiStatus: { configured: true, provider: "openai", model: "test-model" }
  });
  assert.equal(live.status, "ready");
  assert.equal(live.ready, true);
  assert.equal(live.operational, true);

  const maintenance = buildReadinessStatus({
    databaseConfigured: true,
    databaseReady: true,
    maintenanceStatus: {
      mode: "read_only",
      active: true,
      writeBlocked: true,
      retryAfterSeconds: 30
    }
  });
  assert.equal(maintenance.status, "maintenance");
  assert.equal(maintenance.ready, true);
  assert.equal(maintenance.operational, false);

  const draining = buildReadinessStatus({
    databaseConfigured: true,
    databaseReady: true,
    shuttingDown: true
  });
  assert.equal(draining.status, "draining");
  assert.equal(draining.ready, false);
  assert.equal(draining.operational, false);
}

function testDatabaseResilience() {
  const defaults = getDatabaseResilienceConfig({});
  assert.equal(defaults.connectionTimeoutMillis, 10000);
  assert.equal(databaseRetryDelay(1, defaults), 2000);
  assert.equal(databaseRetryDelay(2, defaults), 4000);
  assert.ok(databaseRetryDelay(100, defaults) <= defaults.retryMaxMillis);

  const bounded = getDatabaseResilienceConfig({
    UNBOUND_DB_CONNECTION_TIMEOUT_MS: "1",
    UNBOUND_DB_RETRY_MAX_MS: "9999999"
  });
  assert.equal(bounded.connectionTimeoutMillis, 1000);
  assert.equal(bounded.retryMaxMillis, 120000);
}

function testRecoveryReadiness() {
  const now = Date.parse("2026-09-12T17:00:00Z");
  const unprotected = buildRecoveryReadiness({ env: {}, nowMs: now });
  assert.equal(unprotected.status, "unprotected");
  assert.equal(unprotected.launchReady, false);

  const protectedState = buildRecoveryReadiness({
    env: {
      DATABASE_BACKUP_MODE: "hybrid",
      DATABASE_BACKUP_LAST_VERIFIED_AT: "2026-09-12T12:00:00Z",
      DATABASE_RESTORE_LAST_TESTED_AT: "2026-09-01T12:00:00Z"
    },
    nowMs: now
  });
  assert.equal(protectedState.status, "ready");
  assert.equal(protectedState.launchReady, true);
  assert.equal(protectedState.backup.managedRecovery, true);
  assert.equal(protectedState.backup.externalBackup, true);
}

function testMaintenancePolicy() {
  const readOnly = getMaintenanceStatus({
    UNBOUND_MAINTENANCE_MODE: "read_only",
    UNBOUND_MAINTENANCE_RETRY_AFTER_SECONDS: "45"
  });
  assert.equal(readOnly.active, true);
  assert.equal(readOnly.retryAfterSeconds, 45);
  assert.equal(
    maintenanceAllowsRequest(readOnly, { method: "GET", path: "/account/access" }),
    true
  );
  assert.equal(
    maintenanceAllowsRequest(readOnly, { method: "POST", path: "/chat" }),
    false
  );

  const offline = getMaintenanceStatus({ UNBOUND_MAINTENANCE_MODE: "offline" });
  assert.equal(
    maintenanceAllowsRequest(offline, { method: "GET", path: "/system/status" }),
    true
  );
  assert.equal(
    maintenanceAllowsRequest(offline, { method: "GET", path: "/account/access" }),
    false
  );
}

function testObservabilityPrivacy() {
  assert.equal(
    sanitizedRequestPath({ path: "/api/admin/users/12345/access" }),
    "/api/admin/users/:id/access"
  );
  assert.equal(
    sanitizedRequestPath({ path: "/api/conversations/550e8400-e29b-41d4-a716-446655440000" }),
    "/api/conversations/:id"
  );
  assert.equal(
    sanitizedRequestPath({ path: "/api/token/abcdefghijklmnopqrstuvwxyz1234567890" }),
    "/api/token/:token"
  );
}

function readyLaunchFixture() {
  return {
    runtime: { ready: true, operational: true, status: "ready" },
    maintenance: { active: false, mode: "off" },
    recovery: { launchReady: true, blockers: [] },
    legal: {
      documentsPublished: true,
      acceptanceEnabled: true,
      enforcementEnabled: true
    },
    billing: {
      configured: true,
      provider: "test-billing",
      checkout: true,
      customerPortal: true,
      webhooks: true,
      secretKey: "REGRESSION_SECRET_MUST_NOT_LEAK"
    },
    ageVerification: {
      configured: true,
      provider: "test-age",
      minimumAge: 18,
      startVerification: true,
      webhooks: true,
      webhookSecret: "REGRESSION_SECRET_MUST_NOT_LEAK"
    },
    ai: {
      configured: true,
      provider: "openai",
      streaming: true,
      research: true,
      apiKey: "REGRESSION_SECRET_MUST_NOT_LEAK"
    },
    nowMs: Date.parse("2026-09-12T17:00:00Z")
  };
}

function testLaunchGate() {
  const ready = buildLaunchReadiness(readyLaunchFixture());
  assert.equal(ready.launchReady, true);
  assert.equal(ready.status, "ready");
  assert.equal(ready.blockerCount, 0);
  assert.ok(!JSON.stringify(ready).includes("REGRESSION_SECRET_MUST_NOT_LEAK"));

  const blocked = buildLaunchReadiness({
    ...readyLaunchFixture(),
    recovery: { launchReady: false, blockers: ["Recovery not verified."] },
    legal: {
      documentsPublished: false,
      acceptanceEnabled: false,
      enforcementEnabled: false
    },
    billing: {
      configured: false,
      checkout: false,
      customerPortal: false,
      webhooks: false,
      state: "provider-not-selected"
    },
    ageVerification: {
      configured: false,
      minimumAge: 18,
      startVerification: false,
      webhooks: false,
      state: "adapter-not-installed"
    }
  });
  assert.equal(blocked.launchReady, false);
  const keys = new Set(blocked.blockers.map((item) => item.key));
  for (const requiredKey of [
    "database_recovery",
    "legal_published",
    "legal_enforcement",
    "billing_gateway",
    "age_verification_gateway"
  ]) {
    assert.ok(keys.has(requiredKey), `Missing expected launch blocker: ${requiredKey}`);
  }
}

function requireText(text, needle, label) {
  assert.ok(text.includes(needle), `Regression contract missing: ${label}`);
}

function forbidText(text, needle, label) {
  assert.ok(!text.includes(needle), `Regression contract violation: ${label}`);
}

function testBrowserContracts() {
  const indexHtml = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const adminHtml = fs.readFileSync(path.join(appRoot, "admin.html"), "utf8");
  const termsHtml = fs.readFileSync(path.join(appRoot, "terms.html"), "utf8");
  const privacyHtml = fs.readFileSync(path.join(appRoot, "privacy.html"), "utf8");

  requireText(indexHtml, 'id="serviceStatus"', "truthful service status element");
  requireText(indexHtml, 'id="serviceBanner"', "service maintenance banner");
  requireText(indexHtml, "serviceWriteBlocked", "composer service-write gate");
  requireText(indexHtml, 'fetch("/api/system/status"', "service status polling");
  requireText(indexHtml, 'class="skip-link"', "keyboard skip navigation");
  requireText(indexHtml, "prefers-reduced-motion", "reduced-motion support");
  requireText(indexHtml, 'id="ageVerificationStartButton"', "hard-age verification action");
  requireText(
    indexHtml,
    'fetch("/api/account/age-verification/start"',
    "hard-age verification start endpoint usage"
  );
  requireText(
    indexHtml,
    "ageGateway.configured &&\n        ageGateway.startVerification",
    "age-verification button requires configured start-capable gateway"
  );
  requireText(
    indexHtml,
    'verificationUrl.startsWith("https://")',
    "age-verification redirect must require HTTPS"
  );
  requireText(
    indexHtml,
    "window.location.assign(verificationUrl)",
    "age-verification provider navigation"
  );
  requireText(indexHtml, 'id="billingUpgradeButton"', "TOP upgrade action");
  requireText(indexHtml, 'id="billingPortalButton"', "billing management action");
  requireText(indexHtml, 'fetch("/api/account/billing/checkout"', "billing checkout endpoint usage");
  requireText(indexHtml, 'fetch("/api/account/billing/portal"', "billing portal endpoint usage");
  requireText(indexHtml, 'checkoutUrl.startsWith("https://")', "checkout redirect HTTPS requirement");
  requireText(indexHtml, 'portalUrl.startsWith("https://")', "billing portal redirect HTTPS requirement");
  requireText(indexHtml, "subscription.customerConnected", "billing portal requires connected customer");
  forbidText(indexHtml, "provider_customer_id", "browser must not reference provider customer identifier");
  forbidText(
    indexHtml,
    '<div class="status" aria-label="Service status live">',
    "static LIVE header must not return"
  );

  requireText(adminHtml, "Commercial Launch Readiness", "admin launch dashboard");
  requireText(adminHtml, 'id="launchReadinessBody"', "admin launch check table");
  requireText(
    adminHtml,
    "/api/admin/ops/launch-readiness",
    "admin launch readiness endpoint usage"
  );
  forbidText(adminHtml.toLowerCase(), "force launch", "admin must not contain force-launch control");
  forbidText(adminHtml.toLowerCase(), "bypass gate", "admin must not contain gate-bypass control");

  requireText(termsHtml, "DRAFT — NOT YET IN FORCE", "Terms draft warning");
  requireText(privacyHtml, "DRAFT — NOT YET IN FORCE", "Privacy draft warning");
  requireText(termsHtml, 'name="robots" content="noindex, nofollow"', "Terms noindex directive");
  requireText(privacyHtml, 'name="robots" content="noindex, nofollow"', "Privacy noindex directive");
  requireText(termsHtml, "Review required before launch", "Terms review warning");
  requireText(privacyHtml, "Review required before launch", "Privacy review warning");
}

const tests = [
  ["account deletion", testAccountDeletion],
  ["legal publishing", testLegalPublishing],
  ["runtime status", testRuntimeStatus],
  ["database resilience", testDatabaseResilience],
  ["recovery readiness", testRecoveryReadiness],
  ["maintenance policy", testMaintenancePolicy],
  ["observability privacy", testObservabilityPrivacy],
  ["launch readiness", testLaunchGate],
  ["browser contracts", testBrowserContracts]
];

for (const [name, test] of tests) {
  test();
  console.log(`PASS regression contract: ${name}`);
}

console.log(`UNBOUND AI regression contracts passed (${tests.length} groups).`);
