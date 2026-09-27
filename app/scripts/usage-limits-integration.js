"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool, Client } = require("pg");
const { reserveUsage, refundUsage, readUsage } = require("../access/usage-store");
const { policiesFor } = require("../access/usage-policy");
async function main() {
  const url = new URL(process.env.TEST_POSTGRES_URL);
  assert(["postgres:", "postgresql:"].includes(url.protocol));
  assert(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.equal(url.pathname, "/postgres"); assert.equal(url.search, ""); assert.equal(url.hash, "");
  const name = "usage_test_" + crypto.randomBytes(8).toString("hex");
  const admin = new Client({ connectionString: url.href }); await admin.connect();
  let pool;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    url.pathname = "/" + name; pool = new Pool({ connectionString: url.href, max: 15 });
    await pool.query(`CREATE TABLE rate_limit_buckets (scope TEXT NOT NULL, subject_hash TEXT NOT NULL, subject_kind TEXT NOT NULL,
      window_started_at TIMESTAMPTZ NOT NULL, request_count INTEGER NOT NULL, updated_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (scope, subject_hash))`);
    const subject = { kind: "account", value: "1" }; const secret = "synthetic-test-only";
    const policy = policiesFor("free", { chat: 1 }).map(p => ({ ...p, limit: 5 }));
    const parallel = await Promise.all(Array.from({ length: 40 }, () => reserveUsage(pool, secret, subject, policy)));
    assert.equal(parallel.filter(r => r.allowed).length, 5, "concurrent admission must stop exactly at quota");
    let windows = await readUsage(pool, secret, subject, policy); assert(windows.every(w => w.used === 5));
    const first = parallel.find(r => r.allowed); await refundUsage(pool, first);
    windows = await readUsage(pool, secret, subject, policy); assert(windows.every(w => w.used === 4));
    // Upgrade increases headroom but carries existing usage across plans.
    const upgraded = await reserveUsage(pool, secret, subject, policiesFor("ultra", { chat: 1 }));
    assert(upgraded.allowed); assert(upgraded.windows.every(w => w.used === 5));
    // A blocked research component must not spend any chat credits.
    const mixed = policiesFor("premium", { chat: 3, research: 1 }).map(p => p.feature === "research" ? { ...p, limit: 0 } : p);
    assert.equal((await reserveUsage(pool, secret, subject, mixed)).allowed, false);
    windows = await readUsage(pool, secret, subject, policy); assert(windows.every(w => w.used === 5));
    // Expire only the short window: weekly cap still blocks admission.
    await pool.query("UPDATE rate_limit_buckets SET window_started_at = NOW() - INTERVAL '6 hours' WHERE scope = 'usage:chat:session'");
    assert.equal((await reserveUsage(pool, secret, subject, policy)).allowed, false);
    await pool.query("UPDATE rate_limit_buckets SET window_started_at = NOW() - INTERVAL '8 days'");
    const reset = await reserveUsage(pool, secret, subject, policy); assert(reset.allowed); assert(reset.windows.every(w => w.used === 1));
    await refundUsage(pool, first); // old-window refund cannot reduce fresh counts
    windows = await readUsage(pool, secret, subject, policy); assert(windows.every(w => w.used === 1));
    await pool.end(); pool = new Pool({ connectionString: url.href });
    windows = await readUsage(pool, secret, subject, policy); assert(windows.every(w => w.used === 1), "usage survives reconnect/restart");
    console.log("PASS PostgreSQL usage quotas: concurrent admission, atomic multi-feature block, refunds, upgrades, weekly cap, reset, late refund and persistence.");
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await admin.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
