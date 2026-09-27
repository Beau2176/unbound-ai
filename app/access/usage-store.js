"use strict";
const { hashRateLimitSubject } = require("../security/rate-limit");
function subjectHash(secret, subject) { return hashRateLimitSubject(secret, `${subject.kind}:${subject.value}`); }
function evaluate(policy, row, now) {
  const started = row ? new Date(row.window_started_at).getTime() : now;
  const active = Boolean(row && started + policy.windowSeconds * 1000 > now);
  const used = active ? Number(row.request_count) : 0;
  return { ...policy, used, remaining: Math.max(0, policy.limit - used), resetAt: new Date((active ? started : now) + policy.windowSeconds * 1000).toISOString(), startedAt: new Date(active ? started : now).toISOString(), active };
}
async function readUsage(pool, secret, subject, policies) {
  const result = await pool.query("SELECT scope, window_started_at, request_count FROM rate_limit_buckets WHERE subject_hash = $1 AND scope = ANY($2::text[])", [subjectHash(secret, subject), policies.map(p => p.scope)]);
  const now = Date.now();
  return policies.map(p => evaluate(p, result.rows.find(r => r.scope === p.scope), now));
}
// Account-wide transaction: concurrent requests cannot overspend either window.
async function reserveUsageInTransaction(client, secret, subject, policies) {
  const hash = subjectHash(secret, subject);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`usage:${hash}`]);
  const clock = await client.query("SELECT clock_timestamp() AS now");
  const now = new Date(clock.rows[0].now).getTime();
  const result = await client.query("SELECT scope, window_started_at, request_count FROM rate_limit_buckets WHERE subject_hash = $1 AND scope = ANY($2::text[])", [hash, policies.map(p => p.scope)]);
  const windows = policies.map(p => evaluate(p, result.rows.find(r => r.scope === p.scope), now));
  const blocked = windows.filter(w => w.used + w.units > w.limit);
  if (blocked.length) return { allowed: false, windows, blocked, retryAfter: Math.max(...blocked.map(w => Math.max(1, Math.ceil((Date.parse(w.resetAt) - now) / 1000)))) };
  for (const w of windows) {
    await client.query(`INSERT INTO rate_limit_buckets (scope, subject_hash, subject_kind, window_started_at, request_count, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW()) ON CONFLICT (scope, subject_hash) DO UPDATE SET
      window_started_at = EXCLUDED.window_started_at, request_count = EXCLUDED.request_count, updated_at = NOW()`, [w.scope, hash, subject.kind, w.startedAt, w.used + w.units]);
    w.used += w.units; w.remaining = Math.max(0, w.limit - w.used);
  }
  return { allowed: true, windows, hash };
}
async function reserveUsage(pool, secret, subject, policies) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await reserveUsageInTransaction(client, secret, subject, policies);
    await client.query(result.allowed ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}
async function refundUsage(pool, reservation) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`usage:${reservation.hash}`]);
    for (const w of reservation.windows) await client.query(`UPDATE rate_limit_buckets SET request_count = GREATEST(0, request_count - $1)
      WHERE scope = $2 AND subject_hash = $3 AND window_started_at = $4`, [w.units, w.scope, reservation.hash, w.startedAt]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}
module.exports = { evaluate, readUsage, reserveUsage, reserveUsageInTransaction, refundUsage };
