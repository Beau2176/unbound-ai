const assert = require("assert");
const crypto = require("crypto");
const { Client, Pool } = require("pg");
const store = require("../email/store");
const { createEmailVerificationService } = require("../email/service");
const { hashVerificationToken } = require("../email/verification");

async function main() {
  const connectionString = process.env.TEST_POSTGRES_URL;
  if (!connectionString) throw new Error("TEST_POSTGRES_URL is required.");
  const parsed = new URL(connectionString);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    throw new Error("Email database contracts require a disposable local PostgreSQL instance.");
  }
  const schema = `unbound_email_ci_${process.pid}_${crypto.randomBytes(8).toString("hex")}`;
  const admin = new Client({ connectionString, connectionTimeoutMillis: 10000 });
  let pool;
  let schemaCreated = false;
  const env = {
    PUBLIC_APP_ORIGIN: "https://email-test.example",
    EMAIL_VERIFICATION_TOKEN_SECRET: crypto.randomBytes(48).toString("base64url"),
    EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: "10"
  };
  let rejectDelivery = false;
  const deliveries = [];
  const service = createEmailVerificationService({
    gateway: {
      getEmailGatewayStatus: () => ({ configured: true, canSendVerification: true }),
      async sendAccountVerification(message) {
        deliveries.push(message);
        if (rejectDelivery) throw new Error("Controlled provider failure");
        return { accepted: true };
      }
    }
  });
  const latestToken = () => new URLSearchParams(
    new URL(deliveries.at(-1).verificationUrl).hash.slice(1)
  ).get("token");
  async function user(email) {
    const result = await pool.query(
      "INSERT INTO users(email) VALUES($1) RETURNING id,email", [email]
    );
    return result.rows[0];
  }
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 4 });
    assert.strictEqual((await pool.query("SELECT current_schema() AS schema")).rows[0].schema, schema);
    await pool.query("CREATE TABLE users(id BIGSERIAL PRIMARY KEY,email TEXT UNIQUE NOT NULL)");
    await store.initializeEmailVerificationSchema(pool);

    const account = await user("signup@example.test");
    const now = new Date();
    const sent = await service.send({ pool, user: account, env, now });
    const originalToken = latestToken();
    assert.strictEqual(sent.sent, true);
    const pending = await service.getStatus({ pool, userId: account.id, env, now });
    assert.strictEqual(pending.state, "pending", "a newly delivered link must not appear expired");
    assert.strictEqual(new Date(pending.expiresAt).toISOString(), sent.expiresAt);
    assert.strictEqual(pending.canResend, true);
    assert.ok(!JSON.stringify(pending).includes(originalToken), "status must not expose the token");

    const resentAt = new Date(now.getTime() + 1000);
    const resent = await service.resend({ pool, user: account, env, now: resentAt });
    const replacementToken = latestToken();
    assert.notStrictEqual(replacementToken, originalToken);
    const resentStatus = await service.getStatus({ pool, userId: account.id, env, now: resentAt });
    assert.strictEqual(resentStatus.state, "pending");
    assert.strictEqual(new Date(resentStatus.expiresAt).toISOString(), resent.expiresAt,
      "status must use the active replacement challenge, not an invalidated challenge");
    assert.strictEqual((await service.consume({ pool, token: originalToken, env, now: resentAt })).reason, "invalidated");

    const rows = await pool.query("SELECT token_hash FROM email_verification_challenges ORDER BY id");
    assert.deepStrictEqual(rows.rows.map(row => row.token_hash), [
      hashVerificationToken(originalToken, env), hashVerificationToken(replacementToken, env)
    ]);
    const consumed = await Promise.all([
      service.consume({ pool, token: replacementToken, env, now: resentAt }),
      service.consume({ pool, token: replacementToken, env, now: resentAt })
    ]);
    assert.strictEqual(consumed.filter(result => result.verified).length, 1,
      "PostgreSQL row locks must allow exactly one successful concurrent consumption");
    assert.strictEqual(consumed.filter(result => result.reason === "already-used").length, 1);
    const verified = await service.getStatus({ pool, userId: account.id, env, now: resentAt });
    assert.strictEqual(verified.state, "verified");
    assert.strictEqual(verified.expiresAt, null);
    assert.strictEqual(verified.canSend, false);
    const beforeVerifiedSend = deliveries.length;
    assert.strictEqual((await service.send({ pool, user: account, env })).sent, false);
    assert.strictEqual(deliveries.length, beforeVerifiedSend);

    const expiring = await user("expiry@example.test");
    const challenge = await service.send({ pool, user: expiring, env, now });
    const expiringToken = latestToken();
    const boundary = new Date(challenge.expiresAt);
    const beforeBoundary = await service.getStatus({ pool, userId: expiring.id, env,
      now: new Date(boundary.getTime() - 1) });
    assert.strictEqual(beforeBoundary.state, "pending");
    assert.strictEqual((await service.getStatus({ pool, userId: expiring.id, env, now: boundary })).state, "expired");
    assert.strictEqual((await service.consume({ pool, token: expiringToken, env, now: boundary })).reason, "expired");
    assert.strictEqual((await service.getStatus({ pool, userId: expiring.id, env, now: boundary })).state, "expired");
    const refresh = await service.resend({ pool, user: expiring, env, now: boundary });
    const refreshedStatus = await service.getStatus({ pool, userId: expiring.id, env, now: boundary });
    assert.strictEqual(refreshedStatus.state, "pending");
    assert.strictEqual(new Date(refreshedStatus.expiresAt).toISOString(), refresh.expiresAt);

    const failedAccount = await user("failure@example.test");
    rejectDelivery = true;
    await assert.rejects(service.send({ pool, user: failedAccount, env }),
      error => error.code === "EMAIL_VERIFICATION_DELIVERY_FAILED");
    const failedToken = latestToken();
    assert.strictEqual((await service.getStatus({ pool, userId: failedAccount.id, env })).state, "failed");
    assert.strictEqual((await service.consume({ pool, token: failedToken, env })).reason, "invalidated");
    const failureRow = await pool.query(
      "SELECT delivery_failed_at,invalidated_at,used_at FROM email_verification_challenges WHERE user_id=$1",
      [failedAccount.id]
    );
    assert.ok(failureRow.rows[0].delivery_failed_at);
    assert.ok(failureRow.rows[0].invalidated_at);
    assert.strictEqual(failureRow.rows[0].used_at, null);
    rejectDelivery = false;
    assert.strictEqual((await service.resend({ pool, user: failedAccount, env })).sent, true);
    assert.strictEqual((await service.getStatus({ pool, userId: failedAccount.id, env })).state, "pending");

    const pausedService = createEmailVerificationService({ gateway: {
      getEmailGatewayStatus: () => ({ configured: false, canSendVerification: false }),
      sendAccountVerification: () => { throw new Error("Paused provider must never send"); }
    } });
    const paused = await user("paused@example.test");
    await assert.rejects(pausedService.send({ pool, user: paused, env }),
      error => error.code === "EMAIL_PROVIDER_NOT_CONFIGURED");
    assert.strictEqual((await pool.query(
      "SELECT COUNT(*)::int AS count FROM email_verification_challenges WHERE user_id=$1", [paused.id]
    )).rows[0].count, 0);
    assert.strictEqual((await pausedService.getStatus({ pool, userId: paused.id, env })).canSend, false);
    console.log("Email verification PostgreSQL lifecycle contract passed.");
  } finally {
    if (pool) await pool.end();
    if (schemaCreated) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

main().catch(error => {
  console.error("Email verification PostgreSQL lifecycle contract failed:", error.message);
  process.exitCode = 1;
});
