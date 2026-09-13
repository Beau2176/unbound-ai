const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  clampDays,
  publicAiStatus,
  publicGatewayStatus,
  publicMaintenanceStatus
} = require("../command-center/routes");
const {
  CAPABILITY_CATALOG,
  buildCapabilityAccess
} = require("../access/entitlements");
const {
  buildFileAwareIndexHtml,
  COMMAND_CENTER_NAV_LINK
} = require("../files/routes");

function count(text, needle) {
  return String(text).split(needle).length - 1;
}

function main() {
  assert.strictEqual(clampDays("7"), 7);
  assert.strictEqual(clampDays("0"), 1);
  assert.strictEqual(clampDays("9999"), 365);
  assert.strictEqual(clampDays("bad"), 30);

  const ai = publicAiStatus({
    provider: "openai",
    configured: true,
    model: "test-model",
    streaming: true,
    research: true,
    apiKey: "MUST_NOT_LEAK"
  });
  assert.strictEqual(ai.provider, "openai");
  assert.strictEqual(ai.configured, true);
  assert.ok(!JSON.stringify(ai).includes("MUST_NOT_LEAK"));

  const billing = publicGatewayStatus({
    provider: "test-billing",
    configured: true,
    secretKey: "MUST_NOT_LEAK"
  });
  assert.strictEqual(billing.provider, "test-billing");
  assert.ok(!JSON.stringify(billing).includes("MUST_NOT_LEAK"));

  const maintenance = publicMaintenanceStatus({
    mode: "read_only",
    active: true,
    writeBlocked: true,
    retryAfterSeconds: 45,
    internalReason: "MUST_NOT_LEAK"
  });
  assert.deepStrictEqual(maintenance, {
    mode: "read_only",
    active: true,
    writeBlocked: true,
    retryAfterSeconds: 45
  });

  assert.strictEqual(CAPABILITY_CATALOG.command_center.implemented, true);
  assert.strictEqual(CAPABILITY_CATALOG.command_center.minimumPlan, "top");
  const freeAccess = buildCapabilityAccess({ planTier: "free" })
    .find((item) => item.key === "command_center");
  const topAccess = buildCapabilityAccess({ planTier: "top" })
    .find((item) => item.key === "command_center");
  assert.strictEqual(freeAccess.usable, false);
  assert.strictEqual(topAccess.usable, true);

  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const composed = buildFileAwareIndexHtml(indexSource);
  assert.strictEqual(count(composed, COMMAND_CENTER_NAV_LINK), 1);

  const routes = fs.readFileSync(
    path.join(__dirname, "..", "command-center", "routes.js"),
    "utf8"
  );
  assert.ok(routes.includes("scheduled_task_events"));
  assert.ok(routes.includes("active_tasks"));
  assert.ok(routes.includes("unread_events"));
  assert.ok(routes.includes("nextRunAt"));
  assert.ok(routes.includes("FROM agent_runs"));
  assert.ok(routes.includes("queued_runs"));
  assert.ok(routes.includes("running_runs"));
  assert.ok(routes.includes("completed_runs"));
  assert.ok(routes.includes("FROM user_memories"));
  assert.ok(routes.includes("enabled_memories"));

  const page = fs.readFileSync(path.join(__dirname, "..", "command-center.html"), "utf8");
  assert.ok(page.includes("COMMAND CENTER"));
  assert.ok(page.includes("/api/command-center/overview"));
  assert.ok(page.includes("Capability access"));
  assert.ok(page.includes("Usage by feature"));
  assert.ok(page.includes("/voice.html"));
  assert.ok(page.includes("/tasks.html"));
  assert.ok(page.includes("/agents.html"));
  assert.ok(page.includes("/memory.html"));
  assert.ok(page.includes("/modes.html"));
  assert.ok(page.includes("Active tasks"));
  assert.ok(page.includes("Reminder events"));
  assert.ok(page.includes("Agent queue"));
  assert.ok(page.includes("Memory"));
  assert.ok(page.includes('id="agentQueue"'));
  assert.ok(page.includes('id="memoryEnabled"'));
  assert.ok(page.includes("/image-tools.html"));

  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let checked = 0;
  while ((match = scriptPattern.exec(page))) {
    const code = String(match[1] || "").trim();
    if (!code) continue;
    new vm.Script(code, { filename: `command-center.html#inline-script-${checked + 1}` });
    checked += 1;
  }
  assert.ok(checked >= 1);

  console.log("UNBOUND AI Command Center contract checks passed.");
}

main();
