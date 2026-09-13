const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  ADVERTISING_POLICY_VERSION,
  AD_REVIEW_CHECKS,
  PROHIBITED_CATEGORIES,
  RESTRICTED_CATEGORIES,
  normalizeAdvertisingReviewDecision,
  publicAdvertisingPolicy
} = require("../advertising/policy");
const {
  integrateAdvertisingAnalyticsServerSource
} = require("../advertising/server-integration");
const {
  integrateAdvertisingPolicyServerSource
} = require("../advertising/policy-server-integration");

const appRoot = path.resolve(__dirname, "..");

function completeChecks() {
  return Object.fromEntries(AD_REVIEW_CHECKS.map((item) => [item.key, true]));
}

function testPolicyDefinition() {
  assert.equal(ADVERTISING_POLICY_VERSION, "2026-09-v1");
  assert.ok(AD_REVIEW_CHECKS.length >= 5);
  assert.ok(PROHIBITED_CATEGORIES.length >= 8);
  assert.ok(RESTRICTED_CATEGORIES.length >= 5);

  const publicPolicy = publicAdvertisingPolicy();
  assert.equal(publicPolicy.version, ADVERTISING_POLICY_VERSION);
  assert.equal(publicPolicy.reviewChecks.length, AD_REVIEW_CHECKS.length);
  assert.ok(publicPolicy.principles.some((item) => item.includes("separate from AI answers")));
  assert.ok(publicPolicy.prohibitedCategories.some((item) => /minors/i.test(item)));
  assert.ok(publicPolicy.prohibitedCategories.some((item) => /malware/i.test(item)));
  assert.ok(publicPolicy.restrictedCategories.some((item) => /adult/i.test(item)));
}

function testDecisionGate() {
  assert.equal(normalizeAdvertisingReviewDecision({ action: "unknown" }), null);

  const incomplete = normalizeAdvertisingReviewDecision({
    action: "approve",
    checks: { destinationVerified: true }
  });
  assert.ok(incomplete);
  assert.equal(incomplete.valid, false);
  assert.match(incomplete.error, /every advertising policy review check/i);

  const approved = normalizeAdvertisingReviewDecision({
    action: "approve",
    checks: completeChecks(),
    notes: "Destination and policy reviewed."
  });
  assert.equal(approved.valid, true);
  assert.equal(approved.allChecksConfirmed, true);
  assert.equal(approved.policyVersion, ADVERTISING_POLICY_VERSION);
  assert.equal(approved.notes, "Destination and policy reviewed.");

  const rejected = normalizeAdvertisingReviewDecision({
    action: "reject",
    checks: { destinationVerified: true },
    notes: "Deceptive destination."
  });
  assert.equal(rejected.valid, true);
  assert.equal(rejected.allChecksConfirmed, false);
  assert.equal(rejected.notes, "Deceptive destination.");

  const longNotes = normalizeAdvertisingReviewDecision({
    action: "reject",
    notes: "x".repeat(1500)
  });
  assert.equal(longNotes.notes.length, 1000);
}

function testServerIntegration() {
  const rawServer = fs.readFileSync(path.join(appRoot, "server.js"), "utf8");
  const analyticsIntegrated = integrateAdvertisingAnalyticsServerSource(rawServer);
  const integrated = integrateAdvertisingPolicyServerSource(analyticsIntegrated);

  for (const needle of [
    'require("./advertising/policy")',
    "ADD COLUMN IF NOT EXISTS review_policy_version TEXT",
    "ADD COLUMN IF NOT EXISTS review_attestation JSONB",
    "ADD COLUMN IF NOT EXISTS review_notes TEXT",
    'app.get("/advertising-policy.html"',
    'app.get("/api/advertising/policy"',
    "normalizeAdvertisingReviewDecision(req.body)",
    "Complete the advertising policy review before approval.",
    "review_policy_version = $2",
    "review_attestation = $3::jsonb",
    "JSON.stringify(decision.checks)",
    "policyVersion: decision.policyVersion"
  ]) {
    assert.ok(integrated.includes(needle), `Advertising policy integration missing: ${needle}`);
  }

  const decisionIndex = integrated.indexOf("normalizeAdvertisingReviewDecision(req.body)");
  const paidApprovalIndex = integrated.indexOf("Only paid advertiser orders can be approved.");
  const approvedUpdateIndex = integrated.indexOf("SET review_status = 'approved'");
  assert.ok(decisionIndex >= 0 && paidApprovalIndex > decisionIndex && approvedUpdateIndex > paidApprovalIndex);

  const start = fs.readFileSync(path.join(appRoot, "start.js"), "utf8");
  assert.ok(start.includes("integrateAdvertisingAnalyticsServerSource(integratedSource)"));
  assert.ok(start.includes("integrateAdvertisingPolicyServerSource(integratedSource)"));
  assert.ok(
    start.indexOf("integrateAdvertisingPolicyServerSource(integratedSource)") >
      start.indexOf("integrateAdvertisingAnalyticsServerSource(integratedSource)"),
    "Advertising policy integration must run after analytics integration."
  );

  assert.throws(
    () => integrateAdvertisingPolicyServerSource("const app = {};"),
    (error) => error.code === "ADVERTISING_POLICY_SERVER_INTEGRATION_MARKER_MISSING"
  );
}

function testPages() {
  const policyPage = fs.readFileSync(path.join(appRoot, "advertising-policy.html"), "utf8");
  const adminPage = fs.readFileSync(path.join(appRoot, "advertising-admin.html"), "utf8");

  assert.ok(policyPage.includes("Paid placement without paid influence."));
  assert.ok(policyPage.includes('fetch("/api/advertising/policy"'));
  assert.ok(policyPage.includes("Payment does not guarantee publication"));
  assert.ok(adminPage.includes("Required policy review"));
  assert.ok(adminPage.includes("data-review-key"));
  assert.ok(adminPage.includes("/api/advertising/policy"));
  assert.ok(adminPage.includes("checks:review.checks"));
  assert.ok(adminPage.includes('href="/advertising-policy.html"'));
}

(function main() {
  testPolicyDefinition();
  testDecisionGate();
  testServerIntegration();
  testPages();
  console.log("PASS advertising policy contract: public rules, restricted/prohibited categories, mandatory approval attestations, persisted policy version, admin checklist, and fail-closed source integration.");
})();
