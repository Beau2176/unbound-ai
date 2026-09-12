from pathlib import Path
import re

path = Path('app/server.js')
text = path.read_text()


def one(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)


def regex_one(pattern, replacement, label):
    global text
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    text = updated


one(
'''const {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  hashRecoveryCode,
  isRecoveryCodeShape,
  getRecoveryStatus
} = require("./security/recovery");
''',
'''const {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  hashRecoveryCode,
  isRecoveryCodeShape,
  getRecoveryStatus
} = require("./security/recovery");
const {
  normalizeAlertSeverity,
  buildNewDeviceAlert,
  getSecurityAlertStatus
} = require("./security/alerts");
''',
'alert imports'
)

one(
'''    CREATE INDEX IF NOT EXISTS account_security_events_user_created_idx
      ON account_security_events(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS account_passkey_user_handles (
''',
'''    CREATE INDEX IF NOT EXISTS account_security_events_user_created_idx
      ON account_security_events(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS account_security_alerts (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id BIGINT REFERENCES account_devices(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      acknowledged_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT account_security_alerts_severity_check
        CHECK (severity IN ('info', 'warning', 'critical'))
    );

    CREATE INDEX IF NOT EXISTS account_security_alerts_user_created_idx
      ON account_security_alerts(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS account_security_alerts_user_unread_idx
      ON account_security_alerts(user_id, acknowledged_at, created_at DESC);

    CREATE TABLE IF NOT EXISTS account_passkey_user_handles (
''',
'alert database schema'
)

write_alert = r'''
async function writeSecurityAlert(
  client,
  userId,
  {
    eventType,
    severity = "info",
    title,
    message,
    deviceId = null
  }
) {
  const normalizedSeverity = normalizeAlertSeverity(severity);
  const result = await client.query(
    `INSERT INTO account_security_alerts (
       user_id,
       device_id,
       event_type,
       severity,
       title,
       message
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, created_at`,
    [
      userId,
      deviceId,
      String(eventType || "security.alert").slice(0, 120),
      normalizedSeverity,
      String(title || "Security alert").slice(0, 160),
      String(message || "Review your account security.").slice(0, 800)
    ]
  );
  return result.rows[0] || null;
}

function publicSecurityAlert(row) {
  return {
    id: String(row.id),
    eventType: row.event_type,
    severity: normalizeAlertSeverity(row.severity),
    title: row.title,
    message: row.message,
    deviceLabel: row.device_label || null,
    acknowledgedAt: row.acknowledged_at || null,
    createdAt: row.created_at
  };
}

'''
one(
'''function publicSecurityEvent(row) {
''',
write_alert + '''function publicSecurityEvent(row) {
''',
'alert helpers'
)

new_ensure = r'''async function ensureDeviceForRequest(userId, req, res, client = pool) {
  let token = parseCookies(req)[DEVICE_COOKIE];
  let issuedCookie = false;

  if (!token) {
    token = crypto.randomBytes(32).toString("base64url");
    issuedCookie = true;
  }

  let tokenHash = hashDeviceToken(token);
  const label = coarseDeviceLabel(req);
  const existingResult = await client.query(
    `SELECT id, device_label, revoked_at
     FROM account_devices
     WHERE user_id = $1 AND device_token_hash = $2
     LIMIT 1`,
    [userId, tokenHash]
  );
  const existing = existingResult.rows[0] || null;
  const replacedRevokedDeviceId = existing?.revoked_at ? String(existing.id) : null;
  let device = null;
  let isNewDevice = false;

  if (existing && !existing.revoked_at) {
    const updated = await client.query(
      `UPDATE account_devices
       SET device_label = $1,
           last_seen_at = NOW(),
           updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id, device_label, first_seen_at, last_seen_at, revoked_at`,
      [label, existing.id, userId]
    );
    device = updated.rows[0];
  } else {
    if (existing?.revoked_at) {
      token = crypto.randomBytes(32).toString("base64url");
      tokenHash = hashDeviceToken(token);
      issuedCookie = true;
    }

    const inserted = await client.query(
      `INSERT INTO account_devices (
         user_id,
         device_token_hash,
         device_label,
         first_seen_at,
         last_seen_at,
         updated_at
       )
       VALUES ($1, $2, $3, NOW(), NOW(), NOW())
       RETURNING id, device_label, first_seen_at, last_seen_at, revoked_at`,
      [userId, tokenHash, label]
    );
    device = inserted.rows[0];
    isNewDevice = true;
  }

  if (issuedCookie) {
    setDeviceCookie(res, token);
  }

  if (isNewDevice) {
    await writeSecurityEvent(
      client,
      userId,
      replacedRevokedDeviceId ? "device.revoked_token_replaced" : "device.registered",
      device.id,
      {
        label: device.device_label,
        replacedRevokedDeviceId
      },
      replacedRevokedDeviceId ? "warning" : "info"
    );
  }

  return {
    ...device,
    isNewDevice,
    replacedRevokedDeviceId
  };
}

async function associateCurrentSessionWithDevice'''
regex_one(
    r'async function ensureDeviceForRequest\(userId, req, res, client = pool\) \{.*?\n\}\n\nasync function associateCurrentSessionWithDevice',
    new_ensure,
    'revoked-device-safe registration'
)

new_create_session = r'''async function createSession(
  userId,
  res,
  req = null,
  { notifyNewDevice = true, authMethod = "password" } = {}
) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const client = await pool.connect();
  let device = null;

  try {
    await client.query("BEGIN");
    device = req ? await ensureDeviceForRequest(userId, req, res, client) : null;

    await client.query(
      `INSERT INTO user_sessions (user_id, token_hash, expires_at, device_id)
       VALUES ($1, $2, NOW() + INTERVAL '${SESSION_DAYS} days', $3)`,
      [userId, tokenHash, device?.id || null]
    );

    if (notifyNewDevice && device?.isNewDevice) {
      const alert = buildNewDeviceAlert({
        label: device.device_label,
        authMethod,
        replacedRevokedDevice: Boolean(device.replacedRevokedDeviceId)
      });
      await writeSecurityAlert(client, userId, {
        ...alert,
        deviceId: device.id
      });
    }

    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }

  setSessionCookie(res, token);
  return { device };
}

async function findSessionUser'''
regex_one(
    r'async function createSession\(userId, res, req = null\) \{.*?\n\}\n\nasync function findSessionUser',
    new_create_session,
    'alert-aware session creation'
)

one(
'''    await createSession(user.id, res, req);

    return res.status(201).json({
''',
'''    await createSession(user.id, res, req, {
      notifyNewDevice: false,
      authMethod: "registration"
    });

    return res.status(201).json({
''',
'registration alert suppression'
)

one(
'''      await createSession(row.user_id, res, req);
''',
'''      await createSession(row.user_id, res, req, {
        notifyNewDevice: true,
        authMethod: "passkey"
      });
''',
'passkey new-device alert'
)

one(
'''    recovery: getRecoveryStatus()
''',
'''    recovery: getRecoveryStatus(),
    securityAlerts: getSecurityAlertStatus()
''',
'alert health status'
)

alert_routes = r'''app.get(
  "/api/account/security/alerts",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const requested = Number(req.query.limit || 50);
      const limit = Math.min(
        Math.max(Number.isFinite(requested) ? Math.trunc(requested) : 50, 1),
        100
      );
      const [alertsResult, unreadResult] = await Promise.all([
        pool.query(
          `SELECT
             a.id,
             a.event_type,
             a.severity,
             a.title,
             a.message,
             a.acknowledged_at,
             a.created_at,
             d.device_label
           FROM account_security_alerts a
           LEFT JOIN account_devices d ON d.id = a.device_id
           WHERE a.user_id = $1
           ORDER BY a.created_at DESC, a.id DESC
           LIMIT $2`,
          [req.user.id, limit]
        ),
        pool.query(
          `SELECT COUNT(*)::int AS unread
           FROM account_security_alerts
           WHERE user_id = $1 AND acknowledged_at IS NULL`,
          [req.user.id]
        )
      ]);

      return res.json({
        alerts: alertsResult.rows.map(publicSecurityAlert),
        unread: Number(unreadResult.rows[0]?.unread || 0)
      });
    } catch (error) {
      console.error("UNBOUND AI SECURITY ALERT LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load security alerts." });
    }
  }
);

app.post(
  "/api/account/security/alerts/:alertId/acknowledge",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    try {
      const alertId = String(req.params.alertId || "");
      if (!/^\d+$/.test(alertId)) {
        return res.status(400).json({ error: "Security alert id is invalid." });
      }
      const result = await pool.query(
        `UPDATE account_security_alerts
         SET acknowledged_at = COALESCE(acknowledged_at, NOW())
         WHERE id = $1 AND user_id = $2
         RETURNING id, acknowledged_at`,
        [alertId, req.user.id]
      );
      if (!result.rows[0]) {
        return res.status(404).json({ error: "Security alert not found." });
      }
      return res.json({
        ok: true,
        alertId,
        acknowledgedAt: result.rows[0].acknowledged_at
      });
    } catch (error) {
      console.error("UNBOUND AI SECURITY ALERT ACK ERROR:", error);
      return res.status(500).json({ error: "Could not acknowledge that security alert." });
    }
  }
);

app.post(
  "/api/account/security/alerts/acknowledge-all",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE account_security_alerts
         SET acknowledged_at = NOW()
         WHERE user_id = $1 AND acknowledged_at IS NULL
         RETURNING id`,
        [req.user.id]
      );
      return res.json({
        ok: true,
        acknowledged: Number(result.rowCount || 0)
      });
    } catch (error) {
      console.error("UNBOUND AI SECURITY ALERT ACK ALL ERROR:", error);
      return res.status(500).json({ error: "Could not acknowledge security alerts." });
    }
  }
);

'''
one(
'''app.get(
  "/api/account/security/events",
''',
alert_routes + '''app.get(
  "/api/account/security/events",
''',
'alert account routes'
)

path.write_text(text)
print('Applied UNBOUND AI v0.18 security-alert server migration.')
