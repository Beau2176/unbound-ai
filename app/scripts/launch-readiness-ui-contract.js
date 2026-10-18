const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { buildLaunchReadiness } = require("../ops/launch-readiness");

async function checkLiveWireFormat(page, launch) {
  const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const start = server.indexOf('app.get(\n  "/api/admin/ops/launch-readiness"');
  const end = server.indexOf('app.get(\n  "/api/admin/ops/status"', start);
  assert.ok(start >= 0 && end > start);
  let handler;
  vm.runInNewContext(server.slice(start, end), {
    app: { get(_route, ...handlers) { handler = handlers.at(-1); } },
    requireDatabase() {}, requireAdmin() {}, buildCurrentOperationalSnapshot: () => ({ launch })
  });
  let wire;
  await handler({}, { json(value) { wire = value; } });
  const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];
  const element = () => ({
    children: [], style: {}, textContent: "", hidden: false, disabled: false,
    get firstChild() { return this.children[0] || null; },
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); },
    removeChild(item) { this.children.splice(this.children.indexOf(item), 1); },
    addEventListener() {}
  });
  async function render(engineeringWire, status = 200) {
    const nodes = new Map();
    const get = (id) => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
    await vm.runInNewContext(script, {
      document: { getElementById: get, createElement: element },
      fetch: async (url) => ({
        ok: status === 200, status,
        json: async () => url.endsWith("/owner-readiness")
          ? { ready: false, completionPercent: 50, checks: [{ ready: true, label: "Verified" }, { ready: false, label: "Pending" }] }
          : engineeringWire
      })
    });
    return get;
  }
  const get = await render(wire);
  assert.strictEqual(get("checks").children.length, launch.checks.length, "Render the checks returned by the actual engineering route.");
  assert.strictEqual(get("readyCount").textContent, "10");
  assert.strictEqual(get("blockerCount").textContent, "1");
  assert.strictEqual(get("score").textContent, "91%");
  assert.strictEqual(get("overallStatus").textContent, "BLOCKED");
  assert.strictEqual(get("ownerScore").textContent, "50%", "The owner gate still uses its direct payload.");
  assert.strictEqual(get("ownerChecks").children.length, 2);
  const ready = await render({ launch: { ...launch, launchReady: true, checks: launch.checks.map((check) => ({ ...check, ready: true })) } });
  assert.strictEqual(ready("score").textContent, "100%");
  assert.strictEqual(ready("overallStatus").textContent, "READY");
  for (const malformed of [{}, { launch: {} }, { launch: { launchReady: true, checks: [] } }]) {
    const failed = await render(malformed);
    assert.strictEqual(failed("errorBox").hidden, false, "Missing checks must show an error rather than a fabricated readiness result.");
  }
  const denied = await render({}, 403);
  assert.strictEqual(denied("errorBox").hidden, false);
  assert.ok(denied("errorBox").textContent.includes("Administrator access is required"));
}

async function main() {
  const appRoot = path.resolve(__dirname, "..");
  const page = fs.readFileSync(path.join(appRoot, "launch-readiness.html"), "utf8");

  assert.ok(page.includes("Engineering Launch Readiness"));
  assert.ok(page.includes("ENGINEERING READY"));
  assert.ok(page.includes("Owner / Business Readiness"));
  assert.ok(page.includes("OWNER / BUSINESS READY"));
  assert.ok(page.includes("/api/admin/ops/launch-readiness"));
  assert.ok(page.includes("/api/admin/ops/owner-readiness"));
  assert.ok(page.includes("Administrator access is required"));
  assert.ok(page.includes('id="progressBar"'));
  assert.ok(page.includes('id="readyCount"'));
  assert.ok(page.includes('id="blockerCount"'));
  assert.ok(page.includes('id="checks"'));
  assert.ok(page.includes('id="ownerProgressBar"'));
  assert.ok(page.includes('id="ownerReadyCount"'));
  assert.ok(page.includes('id="ownerBlockerCount"'));
  assert.ok(page.includes('id="ownerChecks"'));
  assert.ok(page.includes("Business banking approval"));
  assert.ok(page.includes("advertiser/network acceptance"));
  assert.ok(page.includes("legal counsel review"));
  assert.ok(page.includes("explicit verification flag plus a valid review timestamp"));
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
  await checkLiveWireFormat(page, mixed);

  console.log("PASS launch-readiness UI contract: real route/dashboard wire format, separate owner scores, ready/blocked states, malformed responses, admin access errors, and browser secret isolation.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
