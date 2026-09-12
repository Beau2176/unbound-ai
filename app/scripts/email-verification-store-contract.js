const assert = require("assert");
const {
  EMAIL_VERIFICATION_SCHEMA_SQL,
  initializeEmailVerificationSchema,
  createEmailVerificationChallenge,
  markEmailVerificationDeliveryFailed,
  consumeEmailVerificationChallenge,
  normalizeTokenHash
} = require("../email/store");

const TOKEN_HASH = "a".repeat(64);

function createMockPool({ accountStatus = "unverified", challenge = null, deliveryChallenge = true } = {}) {
  const calls = [];
  let released = false;

  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });

      if (/SELECT status\s+FROM account_email_verification/i.test(sql)) {
        return { rows: accountStatus ? [{ status: accountStatus }] : [] };
      }

      if (/UPDATE email_verification_challenges[\s\S]+RETURNING id/i.test(sql)) {
        return { rows: deliveryChallenge ? [{ id: 7 }] : [] };
      }

      if (/SELECT c\.id,[\s\S]+FROM email_verification_challenges c/i.test(sql)) {
        return { rows: challenge ? [challenge] : [] };
      }

      return { rows: [] };
    },
    release() {
      released = true;
    }
  };

  return {
    calls,
    get released() {
      return released;
    },
    async connect() {
      return client;
    },
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      return { rows: [] };
    }
  };
}

async function main() {
  assert.match(EMAIL_VERIFICATION_SCHEMA_SQL, /token_hash CHAR\(64\) NOT NULL UNIQUE/i);
  assert.match(EMAIL_VERIFICATION_SCHEMA_SQL, /ON DELETE CASCADE/i);
  assert.ok(!/raw_token/i.test(EMAIL_VERIFICATION_SCHEMA_SQL), "schema must never persist raw tokens");
  assert.ok(!/provider_message_id/i.test(EMAIL_VERIFICATION_SCHEMA_SQL), "schema must not persist provider message IDs");
  assert.ok(!/verification_url/i.test(EMAIL_VERIFICATION_SCHEMA_SQL), "schema must not persist verification links");

  const schemaPool = createMockPool();
  await initializeEmailVerificationSchema(schemaPool);
  assert.strictEqual(schemaPool.calls.length, 1);

  assert.strictEqual(normalizeTokenHash(TOKEN_HASH.toUpperCase()), TOKEN_HASH);
  assert.throws(() => normalizeTokenHash("not-a-hash"), /SHA-256/);

  const createPool = createMockPool();
  const created = await createEmailVerificationChallenge(createPool, {
    userId: 12,
    tokenHash: TOKEN_HASH,
    now: new Date("2026-09-12T19:00:00.000Z"),
    expiresAt: new Date("2026-09-12T19:30:00.000Z")
  });
  assert.deepStrictEqual(created, {
    created: true,
    state: "pending",
    expiresAt: "2026-09-12T19:30:00.000Z"
  });
  assert.strictEqual(createPool.released, true);
  assert.strictEqual(createPool.calls[0].sql, "BEGIN");
  assert.strictEqual(createPool.calls.at(-1).sql, "COMMIT");
  assert.ok(
    createPool.calls.some((call) => call.params.includes(TOKEN_HASH)),
    "only the token hash should reach persistence"
  );

  const alreadyVerifiedPool = createMockPool({ accountStatus: "verified" });
  const skipped = await createEmailVerificationChallenge(alreadyVerifiedPool, {
    userId: 12,
    tokenHash: TOKEN_HASH,
    now: new Date("2026-09-12T19:00:00.000Z"),
    expiresAt: new Date("2026-09-12T19:30:00.000Z")
  });
  assert.deepStrictEqual(skipped, { created: false, reason: "already-verified" });
  assert.ok(
    !alreadyVerifiedPool.calls.some((call) => /INSERT INTO email_verification_challenges/i.test(call.sql)),
    "verified accounts must not receive a fresh challenge"
  );

  const failedDeliveryPool = createMockPool();
  const failedDelivery = await markEmailVerificationDeliveryFailed(failedDeliveryPool, {
    userId: 12,
    tokenHash: TOKEN_HASH,
    now: new Date("2026-09-12T19:02:00.000Z")
  });
  assert.deepStrictEqual(failedDelivery, { updated: true, state: "failed" });

  const validConsumePool = createMockPool({
    challenge: {
      id: 9,
      user_id: "12",
      expires_at: new Date("2026-09-12T19:30:00.000Z"),
      used_at: null,
      invalidated_at: null,
      status: "pending"
    }
  });
  const consumed = await consumeEmailVerificationChallenge(validConsumePool, {
    tokenHash: TOKEN_HASH,
    now: new Date("2026-09-12T19:05:00.000Z")
  });
  assert.deepStrictEqual(consumed, { verified: true, reason: "verified", userId: 12 });
  assert.ok(
    validConsumePool.calls.some((call) => /SET status = 'verified'/i.test(call.sql)),
    "successful consumption must mark the account verified"
  );
  assert.ok(
    validConsumePool.calls.some((call) => /id <> \$3/i.test(call.sql)),
    "successful consumption must invalidate other outstanding challenges"
  );

  const expiredPool = createMockPool({
    challenge: {
      id: 10,
      user_id: "12",
      expires_at: new Date("2026-09-12T19:04:00.000Z"),
      used_at: null,
      invalidated_at: null,
      status: "pending"
    }
  });
  const expired = await consumeEmailVerificationChallenge(expiredPool, {
    tokenHash: TOKEN_HASH,
    now: new Date("2026-09-12T19:05:00.000Z")
  });
  assert.deepStrictEqual(expired, { verified: false, reason: "expired" });
  assert.ok(
    expiredPool.calls.some((call) => /ELSE 'expired'/i.test(call.sql)),
    "expired challenges must update non-verified account state"
  );

  const invalidPool = createMockPool({ challenge: null });
  const invalid = await consumeEmailVerificationChallenge(invalidPool, {
    tokenHash: TOKEN_HASH,
    now: new Date("2026-09-12T19:05:00.000Z")
  });
  assert.deepStrictEqual(invalid, { verified: false, reason: "invalid-token" });

  console.log("Email verification store contract passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
