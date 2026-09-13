const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildLaunchReadiness } = require("../ops/launch-readiness");

function main() {
  const appRoot = path.resolve(__dirname, "..");
  const page = fs.readFileSync(path.join(appRoot, "launch-readiness.html"), "utf8");

  assert.ok(page.includes("Engineering Launch Readiness"));
  assert.ok(page.includes("ENGINEERING READY"));
  assert.ok(page.includes("/api/admin/ops/launch-readiness"));
  assert.ok(page.includes("Administrator access is required"));
  assert.ok(page.includes('id="progressBar"'));
  assert.ok(page.includes('id="readyCount"'));
  assert.ok(page.includes('id="blockerCount"'));
  assert.ok(page.includes('id="checks"'));
  assert.ok(page.includes("Business banking approval"));
  assert.ok(page.includes("advertiser/network acceptance"));
  assert.ok(page.includes("legal counsel review"));
  assert.ok(page.includes("textContent"));

  for (const forbidden of [
    "DATABASE_URL",
    "OPENAI_API_KEY",
    "GITHUB_APP_CLIENT_SECRET",
    "CONNECTED_APPS_TOKEN_KEY",
    "SEGPAY_PASSWORD",
    "YOTI_PRIVATE_KEY",
    "AWS_SECRET_ACCESS_KEY",
    "webhook_secret",
    "access_token",
    "refresh_token"
  ]) {
    assert.ok(!page.includes(forbidden), `Launch dashboard must not expose ${forbidden}.`);
  }

  const mixed = buildLaunchReadiness({
    runtime: { ready: true, operational: true, status: "ready" },
    maintenance: { active: false },
    infrastructure: { launchReady: true },
    recovery: { launchReady: false, blockers: ["Restore drill required."] },
    legal: { documentsPublished: true, acceptanceEnabled: true, enforcementEnabled: true },
    billing: { configured: true, checkout: true, customerPortal: true, webhooks: true, provider: "test" },
    ageVerification: { configured: true, startVerification: true, webhooks: true, minimumAge: 18 },
    emailDelivery: { launchReady: true, provider: "test" },
    ai: { configured: true, streaming: true, research: true, provider: "test" },
    nowMs: Date.UTC(2026, 8, 13, 4, 0, 0)
  });

  assert.strictEqual(mixed.launchReady, false);
  assert.strictEqual(mixed.blockerCount, 1);
  assert.strictEqual(mixed.checks.length, 11);
  assert.strictEqual(mixed.checks.filter((item) => item.ready).length, 10);
  assert.strictEqual(mixed.blockers[0].key, "database_recovery");
  assert.strictEqual(mixed.blockers[0].detail, "Restore drill required.");

  console.log("PASS launch-readiness UI contract: real admin launch gate, progress rendering, blocker semantics, and browser secret isolation are preserved.");
}

main();
