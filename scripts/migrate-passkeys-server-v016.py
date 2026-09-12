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
  createHttpSecurityMiddleware,
  createSameOriginApiGuard,
  getHttpSecurityStatus
} = require("./security/http-security");
''',
'''const {
  createHttpSecurityMiddleware,
  createSameOriginApiGuard,
  getHttpSecurityStatus
} = require("./security/http-security");
const {
  getPasskeyConfig,
  getPasskeyStatus,
  generateRegistration,
  verifyRegistration,
  generateAuthentication,
  verifyAuthentication
} = require("./security/passkeys");
''',
'passkey imports'
)

one(
'''const GUEST_RATE_COOKIE = "unbound_guest_rate";
const GUEST_RATE_DAYS = 1;
''',
'''const GUEST_RATE_COOKIE = "unbound_guest_rate";
const GUEST_RATE_DAYS = 1;
const PASSKEY_FLOW_COOKIE = "unbound_passkey_flow";
''',
'passkey cookie constant'
)

schema_anchor = '''    CREATE INDEX IF NOT EXISTS account_security_events_user_created_idx
      ON account_security_events(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
'''
schema_insert = '''    CREATE INDEX IF NOT EXISTS account_security_events_user_created_idx
      ON account_security_events(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS account_passkey_user_handles (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      user_handle BYTEA NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS account_passkeys (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL UNIQUE,
      public_key BYTEA NOT NULL,
      signature_counter BIGINT NOT NULL DEFAULT 0,
      transports JSONB NOT NULL DEFAULT '[]'::jsonb,
      device_type TEXT,
      backed_up BOOLEAN NOT NULL DEFAULT FALSE,
      label TEXT NOT NULL DEFAULT 'Passkey',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS account_passkeys_user_created_idx
      ON account_passkeys(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS passkey_challenges (
      flow_token_hash TEXT PRIMARY KEY,
      ceremony TEXT NOT NULL,
      challenge TEXT NOT NULL,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT passkey_challenges_ceremony_check
        CHECK (ceremony IN ('registration', 'authentication'))
    );

    CREATE INDEX IF NOT EXISTS passkey_challenges_expires_idx
      ON passkey_challenges(expires_at);

    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
'''
one(schema_anchor, schema_insert, 'passkey database schema')

one(
'''    DELETE FROM rate_limit_blocks
    WHERE created_at < NOW() - INTERVAL '30 days';
  `);
''',
'''    DELETE FROM rate_limit_blocks
    WHERE created_at < NOW() - INTERVAL '30 days';

    DELETE FROM passkey_challenges
    WHERE expires_at <= NOW();
  `);
''',
'passkey challenge cleanup'
)

helper_anchor = '''function ensureGuestRateToken(req, res) {
'''
helpers = r'''function hashPasskeyFlowToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function setPasskeyFlowCookie(res, token) {
  const maxAge = getPasskeyConfig().challengeTtlSeconds;
  const secure = IS_PRODUCTION ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${PASSKEY_FLOW_COOKIE}=${encodeURIComponent(
      token
    )}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

function clearPasskeyFlowCookie(res) {
  const secure = IS_PRODUCTION ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${PASSKEY_FLOW_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`
  );
}

async function getOrCreatePasskeyUserHandle(userId, client = pool) {
  const existing = await client.query(
    `SELECT user_handle
     FROM account_passkey_user_handles
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  if (existing.rows[0]?.user_handle) {
    return new Uint8Array(existing.rows[0].user_handle);
  }

  const handle = crypto.randomBytes(32);
  await client.query(
    `INSERT INTO account_passkey_user_handles (user_id, user_handle)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, handle]
  );
  const result = await client.query(
    `SELECT user_handle
     FROM account_passkey_user_handles
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  if (!result.rows[0]?.user_handle) {
    throw new Error("Could not create a passkey user handle.");
  }
  return new Uint8Array(result.rows[0].user_handle);
}

function normalizePasskeyTransports(value) {
  const allowed = new Set([
    "ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"
  ]);
  return Array.isArray(value)
    ? Array.from(new Set(value.map(String).filter((item) => allowed.has(item)))).slice(0, 8)
    : [];
}

function publicPasskey(row) {
  return {
    id: String(row.id),
    label: row.label || "Passkey",
    deviceType: row.device_type || null,
    backedUp: Boolean(row.backed_up),
    transports: normalizePasskeyTransports(row.transports),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null
  };
}

async function storePasskeyChallenge({ ceremony, challenge, userId = null, res }) {
  const config = getPasskeyConfig();
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashPasskeyFlowToken(token);
  await pool.query(
    `INSERT INTO passkey_challenges (
       flow_token_hash, ceremony, challenge, user_id, expires_at
     )
     VALUES ($1, $2, $3, $4, NOW() + ($5::int * INTERVAL '1 second'))`,
    [tokenHash, ceremony, challenge, userId, config.challengeTtlSeconds]
  );
  setPasskeyFlowCookie(res, token);
}

async function consumePasskeyChallenge(req, res, ceremony, userId = null) {
  const token = parseCookies(req)[PASSKEY_FLOW_COOKIE];
  clearPasskeyFlowCookie(res);
  if (!token) {
    const error = new Error("The passkey request expired. Start again.");
    error.statusCode = 400;
    throw error;
  }

  const result = await pool.query(
    `DELETE FROM passkey_challenges
     WHERE flow_token_hash = $1
       AND ceremony = $2
       AND expires_at > NOW()
       AND (($3::bigint IS NULL AND user_id IS NULL) OR user_id = $3::bigint)
     RETURNING challenge`,
    [hashPasskeyFlowToken(token), ceremony, userId]
  );
  if (!result.rows[0]) {
    const error = new Error("The passkey request expired or was already used. Start again.");
    error.statusCode = 400;
    throw error;
  }
  return result.rows[0].challenge;
}

'''
one(helper_anchor, helpers + helper_anchor, 'passkey helpers')

rate_anchor = '''const registerRateLimit = rateLimitMiddleware({
  policy: RATE_LIMIT_POLICY.register,
  subjectResolver: emailRateSubject
});
'''
rate_insert = '''const registerRateLimit = rateLimitMiddleware({
  policy: RATE_LIMIT_POLICY.register,
  subjectResolver: emailRateSubject
});
const passkeyAuthRateLimit = rateLimitMiddleware({
  policy: RATE_LIMIT_POLICY.passkeyAuth,
  subjectResolver: async (req, res) => ({
    kind: "guest_browser",
    value: ensureGuestRateToken(req, res)
  })
});
'''
one(rate_anchor, rate_insert, 'passkey rate limit')

one(
'''    abuseProtection: getRateLimitStatus(),
    httpSecurity: getHttpSecurityStatus({ isProduction: IS_PRODUCTION })
''',
'''    abuseProtection: getRateLimitStatus(),
    httpSecurity: getHttpSecurityStatus({ isProduction: IS_PRODUCTION }),
    passkeys: getPasskeyStatus()
''',
'passkey health status'
)

route_anchor = '''app.get(
  "/api/account/access",
'''
route_code = r'''app.post(
  "/api/auth/passkey/options",
  requireDatabase,
  passkeyAuthRateLimit,
  async (req, res) => {
    try {
      const status = getPasskeyStatus();
      if (!status.enabled) {
        return res.status(503).json({ error: "Passkey authentication is not configured." });
      }
      const options = await generateAuthentication();
      await storePasskeyChallenge({
        ceremony: "authentication",
        challenge: options.challenge,
        userId: null,
        res
      });
      return res.json({ options });
    } catch (error) {
      console.error("UNBOUND AI PASSKEY AUTH OPTIONS ERROR:", error);
      return res.status(500).json({ error: "Could not start passkey sign-in." });
    }
  }
);

app.post(
  "/api/auth/passkey/verify",
  requireDatabase,
  passkeyAuthRateLimit,
  async (req, res) => {
    try {
      const response = req.body?.response;
      if (!response || typeof response.id !== "string" || !response.id) {
        clearPasskeyFlowCookie(res);
        return res.status(400).json({ error: "A passkey response is required." });
      }

      const expectedChallenge = await consumePasskeyChallenge(
        req,
        res,
        "authentication",
        null
      );
      const credentialResult = await pool.query(
        `SELECT
           p.id AS passkey_id,
           p.user_id,
           p.credential_id,
           p.public_key,
           p.signature_counter,
           p.transports,
           p.label,
           u.email,
           u.display_name,
           u.role,
           u.plan_tier,
           u.adult_confirmed_at,
           u.created_at,
           EXISTS (
             SELECT 1 FROM complimentary_top_tier_grants g WHERE g.user_id = u.id
           ) AS complimentary_top_tier
         FROM account_passkeys p
         JOIN users u ON u.id = p.user_id
         WHERE p.credential_id = $1
         LIMIT 1`,
        [response.id]
      );
      const row = credentialResult.rows[0];
      if (!row) {
        return res.status(401).json({ error: "That passkey is not registered with UNBOUND AI." });
      }

      const verification = await verifyAuthentication({
        response,
        expectedChallenge,
        credential: {
          id: row.credential_id,
          publicKey: new Uint8Array(row.public_key),
          counter: Number(row.signature_counter || 0),
          transports: normalizePasskeyTransports(row.transports)
        }
      });
      if (!verification.verified) {
        return res.status(401).json({ error: "Passkey verification failed." });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE account_passkeys
           SET signature_counter = $1,
               last_used_at = NOW()
           WHERE id = $2 AND user_id = $3`,
          [Number(verification.authenticationInfo?.newCounter || 0), row.passkey_id, row.user_id]
        );
        await writeSecurityEvent(
          client,
          row.user_id,
          "passkey.signed_in",
          null,
          { label: row.label || "Passkey" }
        );
        await client.query("COMMIT");
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        throw error;
      } finally {
        client.release();
      }

      await createSession(row.user_id, res, req);
      return res.json({
        user: publicUser({
          id: row.user_id,
          email: row.email,
          display_name: row.display_name,
          role: row.role,
          plan_tier: row.plan_tier,
          adult_confirmed_at: row.adult_confirmed_at,
          created_at: row.created_at,
          complimentary_top_tier: row.complimentary_top_tier
        })
      });
    } catch (error) {
      console.error("UNBOUND AI PASSKEY AUTH VERIFY ERROR:", error);
      return res.status(error.statusCode || 400).json({
        error: error.message || "Passkey sign-in failed."
      });
    }
  }
);

app.get(
  "/api/account/passkeys",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, label, device_type, backed_up, transports, created_at, last_used_at
         FROM account_passkeys
         WHERE user_id = $1
         ORDER BY created_at DESC, id DESC`,
        [req.user.id]
      );
      return res.json({
        passkeys: result.rows.map(publicPasskey),
        status: getPasskeyStatus()
      });
    } catch (error) {
      console.error("UNBOUND AI PASSKEY LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load passkeys." });
    }
  }
);

app.post(
  "/api/account/passkeys/register/options",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    try {
      const config = getPasskeyConfig();
      const existing = await pool.query(
        `SELECT credential_id, transports
         FROM account_passkeys
         WHERE user_id = $1
         ORDER BY id`,
        [req.user.id]
      );
      if (existing.rows.length >= config.maxPasskeysPerAccount) {
        return res.status(409).json({
          error: `This account already has the maximum of ${config.maxPasskeysPerAccount} passkeys.`
        });
      }

      const userID = await getOrCreatePasskeyUserHandle(req.user.id);
      const options = await generateRegistration({
        userName: req.user.email,
        userDisplayName: req.user.display_name || req.user.email,
        userID,
        excludeCredentials: existing.rows.map((row) => ({
          id: row.credential_id,
          transports: normalizePasskeyTransports(row.transports)
        }))
      });
      await storePasskeyChallenge({
        ceremony: "registration",
        challenge: options.challenge,
        userId: req.user.id,
        res
      });
      return res.json({ options });
    } catch (error) {
      console.error("UNBOUND AI PASSKEY REGISTRATION OPTIONS ERROR:", error);
      return res.status(500).json({ error: "Could not start passkey registration." });
    }
  }
);

app.post(
  "/api/account/passkeys/register/verify",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    try {
      const response = req.body?.response;
      const requestedLabel = typeof req.body?.label === "string" ? req.body.label.trim() : "";
      if (!response || typeof response.id !== "string" || !response.id) {
        clearPasskeyFlowCookie(res);
        return res.status(400).json({ error: "A passkey registration response is required." });
      }
      const expectedChallenge = await consumePasskeyChallenge(
        req,
        res,
        "registration",
        req.user.id
      );
      const verification = await verifyRegistration({ response, expectedChallenge });
      if (!verification.verified || !verification.registrationInfo?.credential) {
        return res.status(400).json({ error: "Passkey registration could not be verified." });
      }

      const info = verification.registrationInfo;
      const credential = info.credential;
      const label = (requestedLabel || `${coarseDeviceLabel(req)} passkey`).slice(0, 80);
      const result = await pool.query(
        `INSERT INTO account_passkeys (
           user_id, credential_id, public_key, signature_counter, transports,
           device_type, backed_up, label
         )
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
         RETURNING id, label, device_type, backed_up, transports, created_at, last_used_at`,
        [
          req.user.id,
          credential.id,
          Buffer.from(credential.publicKey),
          Number(credential.counter || 0),
          JSON.stringify(normalizePasskeyTransports(credential.transports)),
          info.credentialDeviceType || null,
          Boolean(info.credentialBackedUp),
          label
        ]
      );
      await writeSecurityEvent(
        pool,
        req.user.id,
        "passkey.registered",
        null,
        {
          label,
          deviceType: info.credentialDeviceType || null,
          backedUp: Boolean(info.credentialBackedUp)
        }
      );
      return res.status(201).json({ passkey: publicPasskey(result.rows[0]) });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "That passkey is already registered." });
      }
      console.error("UNBOUND AI PASSKEY REGISTRATION VERIFY ERROR:", error);
      return res.status(error.statusCode || 400).json({
        error: error.message || "Passkey registration failed."
      });
    }
  }
);

app.delete(
  "/api/account/passkeys/:id",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    try {
      const passkeyId = String(req.params.id || "").trim();
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!/^\d+$/.test(passkeyId)) {
        return res.status(400).json({ error: "Invalid passkey ID." });
      }
      if (!password || password.length > 200) {
        return res.status(400).json({ error: "Enter your current password to remove a passkey." });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const userResult = await client.query(
          `SELECT password_hash FROM users WHERE id = $1 LIMIT 1 FOR UPDATE`,
          [req.user.id]
        );
        if (!userResult.rows[0] || !(await verifyPassword(password, userResult.rows[0].password_hash))) {
          await client.query("ROLLBACK");
          return res.status(401).json({ error: "Current password is incorrect." });
        }
        const deleted = await client.query(
          `DELETE FROM account_passkeys
           WHERE id = $1 AND user_id = $2
           RETURNING id, label`,
          [passkeyId, req.user.id]
        );
        if (!deleted.rows[0]) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Passkey not found." });
        }
        await writeSecurityEvent(
          client,
          req.user.id,
          "passkey.removed",
          null,
          { label: deleted.rows[0].label || "Passkey" },
          "warning"
        );
        await client.query("COMMIT");
        return res.json({ ok: true, passkeyId: String(deleted.rows[0].id) });
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("UNBOUND AI PASSKEY REMOVE ERROR:", error);
      return res.status(500).json({ error: "Could not remove that passkey." });
    }
  }
);

'''
one(route_anchor, route_code + route_anchor, 'passkey routes')

path.write_text(text)
print('passkey server migration applied')
