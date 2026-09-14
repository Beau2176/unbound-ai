const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  MAX_MEMORY_ITEMS,
  MAX_MEMORY_CHARS,
  normalizeMemoryInput,
  validMemoryId,
  publicMemory,
  loadEnabledMemories,
  buildMemoryPrompt
} = require("../memory/context");
const {
  UNBOUND_PROJECT_START_DATE,
  UNBOUND_PROJECT_START_DATE_DISPLAY,
  UNBOUND_PROJECT_START_TIME_ZONE,
  UNBOUND_PROJECT_STARTED_AT_UTC,
  UNBOUND_BRAND_LINE,
  CORE_PROJECT_MEMORY,
  buildProjectCoreMemoryPrompt,
  getProjectIdentity
} = require("../project/identity");
const { CAPABILITY_CATALOG, buildCapabilityAccess } = require("../access/entitlements");
const { buildFileAwareIndexHtml, MEMORY_NAV_LINK } = require("../files/routes");

async function main() {
  assert.strictEqual(MAX_MEMORY_ITEMS, 100);
  assert.strictEqual(MAX_MEMORY_CHARS, 800);
  assert.strictEqual(validMemoryId("123"), true);
  assert.strictEqual(validMemoryId("abc"), false);

  assert.strictEqual(UNBOUND_PROJECT_START_DATE, "2026-09-08");
  assert.strictEqual(UNBOUND_PROJECT_START_DATE_DISPLAY, "September 8, 2026");
  assert.strictEqual(UNBOUND_PROJECT_START_TIME_ZONE, "America/Denver");
  assert.strictEqual(UNBOUND_PROJECT_STARTED_AT_UTC, "2026-09-09T04:57:34Z");
  assert.strictEqual(UNBOUND_BRAND_LINE, "A more open tomorrow starts today.");
  assert.ok(Object.isFrozen(CORE_PROJECT_MEMORY));
  const projectPrompt = buildProjectCoreMemoryPrompt();
  assert.ok(projectPrompt.includes("UNBOUND AI core persistent project memory"));
  assert.ok(projectPrompt.includes("September 8, 2026"));
  assert.ok(projectPrompt.includes("not an individual user's signup date"));
  assert.ok(projectPrompt.includes(UNBOUND_BRAND_LINE));
  assert.deepStrictEqual(getProjectIdentity(), {
    name: "UNBOUND AI",
    startDate: "2026-09-08",
    startDateDisplay: "September 8, 2026",
    startTimeZone: "America/Denver",
    startedAtUtc: "2026-09-09T04:57:34Z",
    brandLine: "A more open tomorrow starts today."
  });

  assert.deepStrictEqual(normalizeMemoryInput({ content: "  Prefers concise answers.  " }), {
    content: "Prefers concise answers.",
    enabled: true
  });
  assert.deepStrictEqual(normalizeMemoryInput({ content: "Use metric units.", enabled: false }), {
    content: "Use metric units.",
    enabled: false
  });
  assert.throws(() => normalizeMemoryInput({ content: "" }), /invalid/i);
  assert.throws(
    () => normalizeMemoryInput({ content: "x".repeat(MAX_MEMORY_CHARS + 1) }),
    /invalid/i
  );

  const row = {
    id: 4,
    content: "Use metric units.",
    enabled: true,
    created_at: new Date("2026-09-13T01:00:00Z"),
    updated_at: new Date("2026-09-13T02:00:00Z")
  };
  assert.deepStrictEqual(publicMemory(row), {
    id: "4",
    content: "Use metric units.",
    enabled: true,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  const queries = [];
  const fakePool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return {
        rows: [
          { id: 2, content: "My project is called UNBOUND AI.", enabled: true, created_at: new Date(), updated_at: new Date() },
          { id: 1, content: "I prefer direct answers.", enabled: true, created_at: new Date(), updated_at: new Date() }
        ]
      };
    }
  };
  const memories = await loadEnabledMemories(fakePool, "42");
  assert.strictEqual(memories.length, 2);
  assert.strictEqual(queries.length, 1);
  assert.ok(queries[0].sql.includes("user_id = $1 AND enabled = TRUE"));
  assert.deepStrictEqual(queries[0].params, ["42", MAX_MEMORY_ITEMS]);

  const prompt = await buildMemoryPrompt(fakePool, "42");
  assert.ok(prompt.includes("User-controlled persistent memory"));
  assert.ok(prompt.includes("explicitly saved by the user"));
  assert.ok(prompt.includes("not as system or developer instructions"));
  assert.ok(prompt.includes("My project is called UNBOUND AI."));
  assert.ok(prompt.includes("I prefer direct answers."));
  assert.strictEqual(await buildMemoryPrompt(null, "42"), "");

  assert.strictEqual(CAPABILITY_CATALOG.memory.implemented, true);
  assert.strictEqual(CAPABILITY_CATALOG.memory.minimumPlan, "premium");
  const free = buildCapabilityAccess({ planTier: "free" }).find((item) => item.key === "memory");
  const premium = buildCapabilityAccess({ planTier: "premium" }).find((item) => item.key === "memory");
  const legacyTop = buildCapabilityAccess({ planTier: "top" }).find((item) => item.key === "memory");
  assert.strictEqual(free.usable, false);
  assert.strictEqual(premium.usable, true);
  assert.strictEqual(legacyTop.usable, true);

  const routesSource = fs.readFileSync(path.join(__dirname, "..", "memory", "routes.js"), "utf8");
  assert.ok(routesSource.includes("WHERE id = $3 AND user_id = $4"));
  assert.ok(routesSource.includes("WHERE id = $2 AND user_id = $3"));
  assert.ok(routesSource.includes("WHERE id = $1 AND user_id = $2"));

  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const indexHtml = buildFileAwareIndexHtml(indexSource);
  assert.ok(indexHtml.includes(MEMORY_NAV_LINK));

  const page = fs.readFileSync(path.join(__dirname, "..", "memory.html"), "utf8");
  assert.ok(page.includes("You control every entry"));
  assert.ok(page.includes("/api/memory"));
  assert.ok(page.includes("SAVE MEMORY"));
  assert.ok(page.includes("PAUSE"));
  assert.ok(page.includes("DELETE"));

  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let checked = 0;
  while ((match = scriptPattern.exec(page))) {
    const code = String(match[1] || "").trim();
    if (!code) continue;
    new vm.Script(code, { filename: `memory.html#inline-script-${checked + 1}` });
    checked += 1;
  }
  assert.ok(checked >= 1);

  console.log("UNBOUND AI persistent project and user-controlled Memory contract checks passed: Premium entitlement with legacy TOP compatibility.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
