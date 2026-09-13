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
const { CAPABILITY_CATALOG, buildCapabilityAccess } = require("../access/entitlements");
const { buildFileAwareIndexHtml, MEMORY_NAV_LINK } = require("../files/routes");

async function main() {
  assert.strictEqual(MAX_MEMORY_ITEMS, 100);
  assert.strictEqual(MAX_MEMORY_CHARS, 800);
  assert.strictEqual(validMemoryId("123"), true);
  assert.strictEqual(validMemoryId("abc"), false);

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
  assert.strictEqual(CAPABILITY_CATALOG.memory.minimumPlan, "top");
  const free = buildCapabilityAccess({ planTier: "free" }).find((item) => item.key === "memory");
  const top = buildCapabilityAccess({ planTier: "top" }).find((item) => item.key === "memory");
  assert.strictEqual(free.usable, false);
  assert.strictEqual(top.usable, true);

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

  console.log("UNBOUND AI user-controlled Memory contract checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
