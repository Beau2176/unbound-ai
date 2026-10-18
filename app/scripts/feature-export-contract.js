const assert = require("node:assert/strict");
const { loadFeatureExport } = require("../privacy/feature-export");
const { buildDataExport } = require("../privacy/data-export");
const { getRateLimitPolicy } = require("../security/rate-limit");

async function main() {
  const secret = "synthetic-do-not-export";
  const queries = [];
  const rows = {
    user_memories: [{ id: "9007199254740993", content: "Saved preference", enabled: false, password_hash: secret }],
    agent_steps: [{ id: "1", run_id: "2", output: "Saved result", usage: { input_tokens: 14, provider_response_id: secret, raw: { token: secret } }, sources: [{ number: 1, title: "Evidence", url: "https://example.invalid/", token: secret }], citations: [{ sourceNumber: 1, startIndex: 0, endIndex: 4, secret }] }],
    future_core_jobs: [{ id: "job", objective: "Saved objective", worker_claim_token: secret, snapshot: { token: secret, version: "v2.0", budget: { usedModelCalls: 2, secret }, tasks: [{ id: "analysis", status: "completed", output: "Task result", secret, approval: { status: "approved", approvedBy: secret }, usage: { modelCalls: 1, raw: { token: secret } } }] } }],
    marketplace_skills: [{ id: "skill", manifest: { instructions: "Saved instructions", secret, tools: ["future_core", { secret }] } }],
    agent_teams: [{ roles: ["coordinator", "reviewer", { secret }] }],
    platform_audit_events: [{ action: "project.created", details: { secret } }]
  };
  const pool = { async query(sql, params) {
    queries.push(sql);
    assert.deepEqual(params, ["42"]);
    assert.match(sql, /WHERE (?:user_id|creator_user_id) = \$1 ORDER BY/);
    assert(!/SELECT\s+\*/i.test(sql));
    assert(!/\b(?:access_token_ciphertext|refresh_token_ciphertext|state_hash|pkce_verifier_ciphertext|worker_claim_token|provider_job_id)\b/.test(sql));
    return { rows: rows[sql.match(/FROM (\w+)/)[1]] || [] };
  } };
  const features = await loadFeatureExport(pool, "42");
  assert.equal(features.memories[0].id, "9007199254740993", "Big integer IDs must remain exact");
  assert.equal(features.memories[0].enabled, false, "Disabled data must not be silently skipped");
  assert.equal(features.agentSteps[0].usage.input_tokens, 14);
  assert.equal(features.agentSteps[0].sources[0].number, 1);
  assert.equal(features.agentSteps[0].citations[0].sourceNumber, 1);
  assert.equal(features.futureCoreJobs[0].snapshot.tasks[0].output, "Task result");
  assert.equal(features.futureCoreJobs[0].snapshot.budget.usedModelCalls, 2);
  assert.equal(features.createdSkills[0].manifest.instructions, "Saved instructions");
  assert.deepEqual(features.agentTeams[0].roles, ["coordinator", "reviewer"]);
  assert.deepEqual(features.tasks, []);
  assert(!JSON.stringify(buildDataExport({ features })).includes(secret), "Nested/unknown provider fields must never escape projection");
  assert.equal(buildDataExport({ features }).exportVersion, 2);
  const before = queries.length;
  for (const id of [undefined, "", "0", "-1", "42 OR 1=1"]) await assert.rejects(loadFeatureExport(pool, id));
  assert.equal(queries.length, before, "Invalid account IDs must not reach the database");
  await assert.rejects(loadFeatureExport({ query: async () => { throw new Error("synthetic query failure"); } }, "42"), /synthetic query failure/, "A failed section must fail the entire export");
  assert.deepEqual(getRateLimitPolicy({}).accountExports, { scope: "account_export", limit: 6, windowSeconds: 3600 });
  for (const [value, expected] of [["", 6], ["invalid", 6], ["0", 1], ["9999", 120], ["3", 3]]) {
    assert.equal(getRateLimitPolicy({ RATE_LIMIT_ACCOUNT_EXPORTS_PER_HOUR: value }).accountExports.limit, expected);
  }
  console.log("PASS feature export: account-bound queries, exact IDs, disabled records, saved outputs, nested credential exclusion, whole-export failures and bounded rate policy.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
