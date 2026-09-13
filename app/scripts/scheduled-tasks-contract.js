const assert = require("assert");
const {
  MAX_TASKS_PER_USER,
  normalizeRecurrence,
  normalizeTaskInput,
  nextRunAfter,
  publicScheduledTask,
  publicTaskEvent,
  runDueTasks
} = require("../tasks/scheduler");
const { validNumericId } = require("../tasks/routes");
const { CAPABILITY_CATALOG, buildCapabilityAccess } = require("../access/entitlements");
const { TASKS_NAV_LINK, buildFileAwareIndexHtml } = require("../files/routes");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

async function main() {
  assert.strictEqual(MAX_TASKS_PER_USER, 50);
  assert.strictEqual(normalizeRecurrence("DAILY"), "daily");
  assert.strictEqual(normalizeRecurrence("unknown"), "once");
  assert.strictEqual(validNumericId("123"), true);
  assert.strictEqual(validNumericId("abc"), false);

  const now = new Date("2026-09-13T12:00:00Z");
  const input = normalizeTaskInput({
    title: "Take a break",
    note: "Stand and stretch",
    recurrence: "hourly",
    intervalCount: 2,
    runAt: "2026-09-13T13:00:00Z"
  }, now);
  assert.strictEqual(input.title, "Take a break");
  assert.strictEqual(input.recurrence, "hourly");
  assert.strictEqual(input.intervalCount, 2);
  assert.strictEqual(input.runAt.toISOString(), "2026-09-13T13:00:00.000Z");
  assert.throws(
    () => normalizeTaskInput({ title: "Past", runAt: "2026-09-13T11:00:00Z" }, now),
    /future/
  );

  assert.strictEqual(nextRunAfter({ recurrence: "once", from: now }), null);
  assert.strictEqual(
    nextRunAfter({ recurrence: "hourly", intervalCount: 2, from: now }).toISOString(),
    "2026-09-13T14:00:00.000Z"
  );
  assert.strictEqual(
    nextRunAfter({ recurrence: "daily", intervalCount: 1, from: now }).toISOString(),
    "2026-09-14T12:00:00.000Z"
  );

  const taskPublic = publicScheduledTask({
    id: 8,
    title: "Test",
    note: "Note",
    recurrence: "daily",
    interval_count: 1,
    next_run_at: now,
    enabled: true,
    created_at: now,
    updated_at: now
  });
  assert.strictEqual(taskPublic.id, "8");
  assert.strictEqual(taskPublic.enabled, true);

  const eventPublic = publicTaskEvent({
    id: 9,
    task_id: 8,
    title: "Test",
    note: "Note",
    scheduled_for: now,
    created_at: now
  });
  assert.strictEqual(eventPublic.id, "9");
  assert.strictEqual(eventPublic.taskId, "8");

  const calls = [];
  const client = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes("FROM scheduled_tasks") && sql.includes("FOR UPDATE SKIP LOCKED")) {
        return {
          rows: [{
            id: 11,
            user_id: 22,
            title: "Recurring test",
            note: "",
            recurrence: "daily",
            interval_count: 1,
            next_run_at: "2026-09-13T11:59:00Z"
          }]
        };
      }
      return { rows: [] };
    },
    release: () => calls.push({ sql: "RELEASE", params: [] })
  };
  const result = await runDueTasks({
    getPool: () => ({ connect: async () => client }),
    now
  });
  assert.strictEqual(result.processed, 1);
  assert.ok(calls.some((call) => call.sql.includes("INSERT INTO scheduled_task_events")));
  const update = calls.find((call) => call.sql.includes("UPDATE scheduled_tasks"));
  assert.ok(update);
  assert.strictEqual(update.params[1], "2026-09-14T12:00:00.000Z");
  assert.strictEqual(update.params[2], true);
  assert.ok(calls.some((call) => call.sql === "COMMIT"));

  assert.strictEqual(CAPABILITY_CATALOG.monitoring.implemented, true);
  const free = buildCapabilityAccess({ planTier: "free" }).find((item) => item.key === "monitoring");
  const top = buildCapabilityAccess({ planTier: "top" }).find((item) => item.key === "monitoring");
  assert.strictEqual(free.usable, false);
  assert.strictEqual(top.usable, true);

  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const indexHtml = buildFileAwareIndexHtml(indexSource);
  assert.ok(indexHtml.includes(TASKS_NAV_LINK));

  const page = fs.readFileSync(path.join(__dirname, "..", "tasks.html"), "utf8");
  assert.ok(page.includes("TASK CENTER"));
  assert.ok(page.includes("/api/tasks"));
  assert.ok(page.includes("ENABLE BROWSER ALERTS"));
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let checked = 0;
  while ((match = scriptPattern.exec(page))) {
    const code = String(match[1] || "").trim();
    if (!code) continue;
    new vm.Script(code, { filename: `tasks.html#inline-script-${checked + 1}` });
    checked += 1;
  }
  assert.ok(checked >= 1);

  console.log("UNBOUND AI scheduled-task contract checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
