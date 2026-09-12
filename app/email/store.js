const EMAIL_VERIFICATION_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS account_email_verification (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'unverified',
    verified_at TIMESTAMPTZ,
    last_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT account_email_verification_status_check
      CHECK (status IN ('unverified', 'pending', 'verified', 'expired', 'failed'))
  );

  CREATE INDEX IF NOT EXISTS account_email_verification_status_idx
    ON account_email_verification(status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS email_verification_challenges (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    invalidated_at TIMESTAMPTZ,
    delivery_failed_at TIMESTAMPTZ,
    CONSTRAINT email_verification_challenge_expiry_check
      CHECK (expires_at > created_at)
  );

  CREATE INDEX IF NOT EXISTS email_verification_challenges_user_idx
    ON email_verification_challenges(user_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS email_verification_challenges_active_idx
    ON email_verification_challenges(user_id, expires_at)
    WHERE used_at IS NULL AND invalidated_at IS NULL;
`;

function assertPool(pool) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A PostgreSQL pool is required.");
  }
  return pool;
}

function normalizeUserId(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError("A positive user ID is required.");
  }
  return parsed;
}

function normalizeTokenHash(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError("A SHA-256 verification token hash is required.");
  }
  return normalized;
}

function normalizeDate(value, label) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${label} must be a valid date.`);
  }
  return date;
}

async function initializeEmailVerificationSchema(pool) {
  assertPool(pool);
  await pool.query(EMAIL_VERIFICATION_SCHEMA_SQL);
}

async function getEmailVerificationRecord(pool, userId) {
  assertPool(pool);
  const normalizedUserId = normalizeUserId(userId);
  const result = await pool.query(
    `SELECT user_id, status, verified_at, last_sent_at, created_at, updated_at
       FROM account_email_verification
      WHERE user_id = $1
      LIMIT 1`,
    [normalizedUserId]
  );
  return result.rows?.[0] || null;
}

async function withTransaction(pool, operation) {
  assertPool(pool);
  if (typeof pool.connect !== "function") {
    throw new TypeError("The PostgreSQL pool must support connect() for transactions.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function createEmailVerificationChallenge(
  pool,
  { userId, tokenHash, expiresAt, now = new Date() }
) {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedTokenHash = normalizeTokenHash(tokenHash);
  const createdAt = normalizeDate(now, "now");
  const expiry = normalizeDate(expiresAt, "expiresAt");
  if (expiry.getTime() <= createdAt.getTime()) {
    throw new TypeError("expiresAt must be in the future.");
  }

  return withTransaction(pool, async (client) => {
    const current = await client.query(
      `SELECT status
         FROM account_email_verification
        WHERE user_id = $1
        FOR UPDATE`,
      [normalizedUserId]
    );

    if (current.rows?.[0]?.status === "verified") {
      return { created: false, reason: "already-verified" };
    }

    await client.query(
      `INSERT INTO account_email_verification
         (user_id, status, last_sent_at, created_at, updated_at)
       VALUES ($1, 'pending', $2, $2, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET status = CASE
               WHEN account_email_verification.status = 'verified' THEN 'verified'
               ELSE 'pending'
             END,
             last_sent_at = EXCLUDED.last_sent_at,
             updated_at = EXCLUDED.updated_at`,
      [normalizedUserId, createdAt]
    );

    await client.query(
      `UPDATE email_verification_challenges
          SET invalidated_at = $2
        WHERE user_id = $1
          AND used_at IS NULL
          AND invalidated_at IS NULL`,
      [normalizedUserId, createdAt]
    );

    await client.query(
      `INSERT INTO email_verification_challenges
         (user_id, token_hash, created_at, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [normalizedUserId, normalizedTokenHash, createdAt, expiry]
    );

    return {
      created: true,
      state: "pending",
      expiresAt: expiry.toISOString()
    };
  });
}

async function markEmailVerificationDeliveryFailed(
  pool,
  { userId, tokenHash, now = new Date() }
) {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedTokenHash = normalizeTokenHash(tokenHash);
  const failedAt = normalizeDate(now, "now");

  return withTransaction(pool, async (client) => {
    const challenge = await client.query(
      `UPDATE email_verification_challenges
          SET delivery_failed_at = $3,
              invalidated_at = COALESCE(invalidated_at, $3)
        WHERE user_id = $1
          AND token_hash = $2
          AND used_at IS NULL
      RETURNING id`,
      [normalizedUserId, normalizedTokenHash, failedAt]
    );

    if (!challenge.rows?.length) {
      return { updated: false, reason: "challenge-not-active" };
    }

    await client.query(
      `UPDATE account_email_verification
          SET status = CASE WHEN status = 'verified' THEN 'verified' ELSE 'failed' END,
              updated_at = $2
        WHERE user_id = $1`,
      [normalizedUserId, failedAt]
    );

    return { updated: true, state: "failed" };
  });
}

async function consumeEmailVerificationChallenge(
  pool,
  { tokenHash, now = new Date() }
) {
  const normalizedTokenHash = normalizeTokenHash(tokenHash);
  const consumedAt = normalizeDate(now, "now");

  return withTransaction(pool, async (client) => {
    const result = await client.query(
      `SELECT c.id,
              c.user_id,
              c.expires_at,
              c.used_at,
              c.invalidated_at,
              a.status
         FROM email_verification_challenges c
         JOIN account_email_verification a ON a.user_id = c.user_id
        WHERE c.token_hash = $1
        LIMIT 1
        FOR UPDATE OF c, a`,
      [normalizedTokenHash]
    );

    const challenge = result.rows?.[0];
    if (!challenge) {
      return { verified: false, reason: "invalid-token" };
    }
    if (challenge.used_at) {
      return { verified: false, reason: "already-used" };
    }
    if (challenge.invalidated_at) {
      return { verified: false, reason: "invalidated" };
    }

    const expiry = normalizeDate(challenge.expires_at, "challenge.expires_at");
    if (expiry.getTime() <= consumedAt.getTime()) {
      await client.query(
        `UPDATE email_verification_challenges
            SET invalidated_at = $2
          WHERE id = $1`,
        [challenge.id, consumedAt]
      );
      await client.query(
        `UPDATE account_email_verification
            SET status = CASE WHEN status = 'verified' THEN 'verified' ELSE 'expired' END,
                updated_at = $2
          WHERE user_id = $1`,
        [challenge.user_id, consumedAt]
      );
      return { verified: false, reason: "expired" };
    }

    if (challenge.status === "verified") {
      await client.query(
        `UPDATE email_verification_challenges
            SET invalidated_at = $2
          WHERE id = $1`,
        [challenge.id, consumedAt]
      );
      return { verified: true, reason: "already-verified", userId: Number(challenge.user_id) };
    }

    await client.query(
      `UPDATE email_verification_challenges
          SET used_at = $2
        WHERE id = $1`,
      [challenge.id, consumedAt]
    );

    await client.query(
      `UPDATE account_email_verification
          SET status = 'verified',
              verified_at = COALESCE(verified_at, $2),
              updated_at = $2
        WHERE user_id = $1`,
      [challenge.user_id, consumedAt]
    );

    await client.query(
      `UPDATE email_verification_challenges
          SET invalidated_at = $2
        WHERE user_id = $1
          AND id <> $3
          AND used_at IS NULL
          AND invalidated_at IS NULL`,
      [challenge.user_id, consumedAt, challenge.id]
    );

    return {
      verified: true,
      reason: "verified",
      userId: Number(challenge.user_id)
    };
  });
}

module.exports = {
  EMAIL_VERIFICATION_SCHEMA_SQL,
  initializeEmailVerificationSchema,
  getEmailVerificationRecord,
  createEmailVerificationChallenge,
  markEmailVerificationDeliveryFailed,
  consumeEmailVerificationChallenge,
  normalizeTokenHash
};
