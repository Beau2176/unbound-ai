from pathlib import Path

path = Path('app/server.js')
text = path.read_text()


def one(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)


one(
'''const {
  getPasskeyConfig,
  getPasskeyStatus,
  generateRegistration,
  verifyRegistration,
  generateAuthentication,
  verifyAuthentication
} = require("./security/passkeys");
''',
'''const {
  getPasskeyConfig,
  getPasskeyStatus,
  generateRegistration,
  verifyRegistration,
  generateAuthentication,
  verifyAuthentication
} = require("./security/passkeys");
const {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  hashRecoveryCode,
  isRecoveryCodeShape,
  getRecoveryStatus
} = require("./security/recovery");
''',
'recovery imports'
)

schema_anchor = '''    CREATE INDEX IF NOT EXISTS passkey_challenges_expires_idx
      ON passkey_challenges(expires_at);

    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
'''
schema_insert = '''    CREATE INDEX IF NOT EXISTS passkey_challenges_expires_idx
      ON passkey_challenges(expires_at);

    CREATE TABLE IF NOT EXISTS account_recovery_codes (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      batch_id TEXT NOT NULL,
      code_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      used_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS account_recovery_codes_user_active_idx
      ON account_recovery_codes(user_id, used_at, created_at DESC);

    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
'''
one(schema_anchor, schema_insert, 'recovery database schema')

one(
'''const securityActionRateLimit = rateLimitMiddleware({
  policy: RATE_LIMIT_POLICY.securityActions,
  subjectResolver: accountRateSubject
});
''',
'''const recoveryRateLimit = rateLimitMiddleware({
  policy: RATE_LIMIT_POLICY.recovery,
  subjectResolver: emailRateSubject
});
const securityActionRateLimit = rateLimitMiddleware({
  policy: RATE_LIMIT_POLICY.securityActions,
  subjectResolver: accountRateSubject
});
''',
'recovery rate limit middleware'
)

one(
'''    passkeys: getPasskeyStatus()
''',
'''    passkeys: getPasskeyStatus(),
    recovery: getRecoveryStatus()
''',
'recovery health status'
)

# Make recovery-related counts safe to show in the existing user security-activity feed.
one(
'''    "revokedSessions",
    "otherSessionsRevoked"
''',
'''    "revokedSessions",
    "otherSessionsRevoked",
    "recoveryCodesGenerated",
    "passkeysRemoved",
    "devicesRevoked"
''',
'recovery public security event details'
)

public_route_anchor = '''app.post(
  "/api/auth/passkey/options",
'''
public_route_code = r'''app.post(
  "/api/auth/recovery-code/reset",
  requireDatabase,
  recoveryRateLimit,
  async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const recoveryCode =
      typeof req.body?.recoveryCode === "string" ? req.body.recoveryCode : "";
    const newPassword =
      typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    const newPasswordConfirm =
      typeof req.body?.newPasswordConfirm === "string"
        ? req.body.newPasswordConfirm
        : "";

    if (!isValidEmail(email) || !isRecoveryCodeShape(recoveryCode)) {
      return res.status(401).json({ error: "Recovery code or email is invalid." });
    }
    if (newPassword.length < 12 || newPassword.length > 200) {
      return res.status(400).json({
        error: "New password must be between 12 and 200 characters."
      });
    }
    if (newPassword !== newPasswordConfirm) {
      return res.status(400).json({ error: "The new passwords do not match." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const userResult = await client.query(
        `SELECT id, password_hash
         FROM users
         WHERE email = $1
         LIMIT 1
         FOR UPDATE`,
        [email]
      );
      const user = userResult.rows[0];
      const codeHash = hashRecoveryCode(recoveryCode);
      if (!user) {
        await client.query("ROLLBACK");
        return res.status(401).json({ error: "Recovery code or email is invalid." });
      }

      const codeResult = await client.query(
        `SELECT id
         FROM account_recovery_codes
         WHERE user_id = $1
           AND code_hash = $2
           AND used_at IS NULL
         LIMIT 1
         FOR UPDATE`,
        [user.id, codeHash]
      );
      if (!codeResult.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(401).json({ error: "Recovery code or email is invalid." });
      }

      if (await verifyPassword(newPassword, user.password_hash)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Choose a new password that is different from the current password."
        });
      }

      const nextPasswordHash = await hashPassword(newPassword);
      await client.query(
        `UPDATE users
         SET password_hash = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [nextPasswordHash, user.id]
      );

      const sessions = await client.query(
        `DELETE FROM user_sessions
         WHERE user_id = $1
         RETURNING id`,
        [user.id]
      );
      const devices = await client.query(
        `UPDATE account_devices
         SET revoked_at = COALESCE(revoked_at, NOW()),
             updated_at = NOW()
         WHERE user_id = $1
           AND revoked_at IS NULL
         RETURNING id`,
        [user.id]
      );
      const passkeys = await client.query(
        `DELETE FROM account_passkeys
         WHERE user_id = $1
         RETURNING id`,
        [user.id]
      );
      await client.query(
        `DELETE FROM passkey_challenges WHERE user_id = $1`,
        [user.id]
      );
      await client.query(
        `DELETE FROM account_recovery_codes WHERE user_id = $1`,
        [user.id]
      );

      await writeSecurityEvent(
        client,
        user.id,
        "recovery.code_used",
        null,
        {
          revokedSessions: Number(sessions.rowCount || 0),
          devicesRevoked: Number(devices.rowCount || 0),
          passkeysRemoved: Number(passkeys.rowCount || 0)
        },
        "warning"
      );
      await client.query("COMMIT");

      clearSessionCookie(res);
      clearDeviceCookie(res);
      clearPasskeyFlowCookie(res);
      return res.json({
        recovered: true,
        signInRequired: true,
        revokedSessions: Number(sessions.rowCount || 0),
        devicesRevoked: Number(devices.rowCount || 0),
        passkeysRemoved: Number(passkeys.rowCount || 0),
        recoveryCodesRemaining: 0
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("UNBOUND AI RECOVERY RESET ERROR:", error);
      return res.status(500).json({ error: "Could not recover the account." });
    } finally {
      client.release();
    }
  }
);

'''
one(public_route_anchor, public_route_code + public_route_anchor, 'public recovery route')

account_route_anchor = '''app.get(
  "/api/account/passkeys",
'''
account_route_code = r'''app.get(
  "/api/account/recovery-codes/status",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE used_at IS NULL)::int AS remaining,
           MAX(created_at) AS generated_at
         FROM account_recovery_codes
         WHERE user_id = $1`,
        [req.user.id]
      );
      return res.json({
        recovery: {
          ...getRecoveryStatus(),
          configured: Number(result.rows[0]?.remaining || 0) > 0,
          remaining: Number(result.rows[0]?.remaining || 0),
          generatedAt: result.rows[0]?.generated_at || null
        }
      });
    } catch (error) {
      console.error("UNBOUND AI RECOVERY STATUS ERROR:", error);
      return res.status(500).json({ error: "Could not load recovery-code status." });
    }
  }
);

app.post(
  "/api/account/recovery-codes/regenerate",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";
    if (!password || password.length > 200) {
      return res.status(400).json({ error: "Enter your current password." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const userResult = await client.query(
        `SELECT id, password_hash
         FROM users
         WHERE id = $1
         LIMIT 1
         FOR UPDATE`,
        [req.user.id]
      );
      const user = userResult.rows[0];
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        await client.query("ROLLBACK");
        return res.status(401).json({ error: "Current password is incorrect." });
      }

      const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
      const batchId = crypto.randomUUID();
      await client.query(
        `DELETE FROM account_recovery_codes WHERE user_id = $1`,
        [user.id]
      );
      for (const code of codes) {
        await client.query(
          `INSERT INTO account_recovery_codes (user_id, batch_id, code_hash)
           VALUES ($1, $2, $3)`,
          [user.id, batchId, hashRecoveryCode(code)]
        );
      }
      await writeSecurityEvent(
        client,
        user.id,
        "recovery.codes_generated",
        null,
        { recoveryCodesGenerated: codes.length },
        "warning"
      );
      await client.query("COMMIT");

      return res.json({
        recovery: {
          ...getRecoveryStatus(),
          configured: true,
          remaining: codes.length,
          generatedAt: new Date().toISOString()
        },
        codes,
        warning:
          "Save these recovery codes now. UNBOUND AI stores only hashes and cannot show these same codes again. Generating a new set invalidates the old set."
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("UNBOUND AI RECOVERY CODE GENERATION ERROR:", error);
      return res.status(500).json({ error: "Could not generate recovery codes." });
    } finally {
      client.release();
    }
  }
);

'''
one(account_route_anchor, account_route_code + account_route_anchor, 'account recovery routes')

path.write_text(text)
print('Applied UNBOUND AI recovery-code server migration.')
