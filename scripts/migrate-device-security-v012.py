from pathlib import Path

server_path = Path('app/server.js')
index_path = Path('app/index.html')
server = server_path.read_text()
index = index_path.read_text()


def one(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    return source.replace(old, new, 1)

# Device cookie constants. This is a device identifier, not a biometric/passkey credential.
server = one(
    server,
    '''const SESSION_COOKIE = "unbound_session";\nconst SESSION_DAYS = 30;''',
    '''const SESSION_COOKIE = "unbound_session";\nconst SESSION_DAYS = 30;\nconst DEVICE_COOKIE = "unbound_device";\nconst DEVICE_DAYS = 365;''',
    'device constants'
)

# Device registry and security-event table. No IP address is persisted.
device_schema = r'''

    CREATE TABLE IF NOT EXISTS account_devices (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_token_hash TEXT NOT NULL,
      device_label TEXT NOT NULL DEFAULT 'Unknown device',
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, device_token_hash)
    );

    CREATE INDEX IF NOT EXISTS account_devices_user_active_idx
      ON account_devices(user_id, revoked_at, last_seen_at DESC);

    ALTER TABLE user_sessions
      ADD COLUMN IF NOT EXISTS device_id BIGINT REFERENCES account_devices(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS user_sessions_device_id_idx
      ON user_sessions(device_id);

    CREATE TABLE IF NOT EXISTS account_security_events (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id BIGINT REFERENCES account_devices(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS account_security_events_user_created_idx
      ON account_security_events(user_id, created_at DESC);
'''
server = one(
    server,
    '''    CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx\n      ON user_sessions(expires_at);''',
    '''    CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx\n      ON user_sessions(expires_at);''' + device_schema,
    'device schema'
)

# Device helpers and cookies.
device_helpers = r'''

function hashDeviceToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setDeviceCookie(res, token) {
  const maxAge = DEVICE_DAYS * 24 * 60 * 60;
  const secure = IS_PRODUCTION ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${DEVICE_COOKIE}=${encodeURIComponent(
      token
    )}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

function coarseDeviceLabel(req) {
  const ua = String(req?.headers?.["user-agent"] || "").toLowerCase();
  let browser = "Browser";
  let os = "device";

  if (ua.includes("edg/")) browser = "Edge";
  else if (ua.includes("firefox/")) browser = "Firefox";
  else if (ua.includes("chrome/") || ua.includes("crios/")) browser = "Chrome";
  else if (ua.includes("safari/")) browser = "Safari";

  if (ua.includes("android")) os = "Android";
  else if (ua.includes("iphone") || ua.includes("ipad")) os = "iPhone/iPad";
  else if (ua.includes("windows")) os = "Windows";
  else if (ua.includes("mac os") || ua.includes("macintosh")) os = "Mac";
  else if (ua.includes("linux")) os = "Linux";

  return `${browser} on ${os}`.slice(0, 80);
}

async function writeSecurityEvent(
  client,
  userId,
  eventType,
  deviceId = null,
  details = {},
  severity = "info"
) {
  await client.query(
    `INSERT INTO account_security_events (
       user_id,
       device_id,
       event_type,
       severity,
       details
     )
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [userId, deviceId, eventType, severity, JSON.stringify(details || {})]
  );
}

async function ensureDeviceForRequest(userId, req, res, client = pool) {
  let token = parseCookies(req)[DEVICE_COOKIE];
  let issuedCookie = false;
  if (!token) {
    token = crypto.randomBytes(32).toString("base64url");
    issuedCookie = true;
  }

  const tokenHash = hashDeviceToken(token);
  const label = coarseDeviceLabel(req);
  const existingResult = await client.query(
    `SELECT id, device_label, revoked_at
     FROM account_devices
     WHERE user_id = $1 AND device_token_hash = $2
     LIMIT 1`,
    [userId, tokenHash]
  );
  let device = existingResult.rows[0] || null;
  const isNewOrReactivated = !device || Boolean(device.revoked_at);

  if (device) {
    const updated = await client.query(
      `UPDATE account_devices
       SET device_label = $1,
           last_seen_at = NOW(),
           revoked_at = NULL,
           updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id, device_label, first_seen_at, last_seen_at, revoked_at`,
      [label, device.id, userId]
    );
    device = updated.rows[0];
  } else {
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
  }

  if (issuedCookie) {
    setDeviceCookie(res, token);
  }

  if (isNewOrReactivated) {
    await writeSecurityEvent(
      client,
      userId,
      "device.registered",
      device.id,
      { label: device.device_label }
    );
  }

  return { ...device, isNewOrReactivated };
}

async function associateCurrentSessionWithDevice(userId, req, res, client = pool) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return { device: null, tokenHash: null };

  const tokenHash = hashSessionToken(token);
  const device = await ensureDeviceForRequest(userId, req, res, client);
  await client.query(
    `UPDATE user_sessions
     SET device_id = $1
     WHERE user_id = $2 AND token_hash = $3`,
    [device.id, userId, tokenHash]
  );
  return { device, tokenHash };
}
'''
server = one(
    server,
    '''function hashSessionToken(token) {\n  return crypto.createHash("sha256").update(token).digest("hex");\n}\n''',
    '''function hashSessionToken(token) {\n  return crypto.createHash("sha256").update(token).digest("hex");\n}\n''' + device_helpers,
    'device helpers'
)

# Sessions created after authentication are associated with the current registered device.
server = one(
    server,
    '''async function createSession(userId, res) {\n  const token = crypto.randomBytes(32).toString("base64url");\n  const tokenHash = hashSessionToken(token);\n\n  await pool.query(\n    `INSERT INTO user_sessions (user_id, token_hash, expires_at)\n     VALUES ($1, $2, NOW() + INTERVAL '${SESSION_DAYS} days')`,\n    [userId, tokenHash]\n  );\n\n  setSessionCookie(res, token);\n}''',
    '''async function createSession(userId, res, req = null) {\n  const token = crypto.randomBytes(32).toString("base64url");\n  const tokenHash = hashSessionToken(token);\n  const device = req ? await ensureDeviceForRequest(userId, req, res) : null;\n\n  await pool.query(\n    `INSERT INTO user_sessions (user_id, token_hash, expires_at, device_id)\n     VALUES ($1, $2, NOW() + INTERVAL '${SESSION_DAYS} days', $3)`,\n    [userId, tokenHash, device?.id || null]\n  );\n\n  setSessionCookie(res, token);\n}''',
    'session device association'
)
server = server.replace('await createSession(user.id, res);', 'await createSession(user.id, res, req);')
if server.count('await createSession(user.id, res, req);') != 2:
    raise RuntimeError('expected register and login createSession calls to be updated')

# Existing sessions are upgraded to a registered device the first time Security is opened.
old_security = '''      const token = parseCookies(req)[SESSION_COOKIE];\n      const tokenHash = token ? hashSessionToken(token) : null;\n      const result = await pool.query(\n        `SELECT\n           COUNT(*)::int AS active_sessions,\n           MAX(CASE WHEN token_hash = $2 THEN expires_at END) AS current_expires_at\n         FROM user_sessions\n         WHERE user_id = $1\n           AND expires_at > NOW()`,\n        [req.user.id, tokenHash]\n      );\n\n      return res.json({\n        activeSessions: Number(result.rows[0]?.active_sessions || 0),\n        currentSessionExpiresAt: result.rows[0]?.current_expires_at || null\n      });'''
new_security = '''      const association = await associateCurrentSessionWithDevice(\n        req.user.id,\n        req,\n        res\n      );\n      const tokenHash = association.tokenHash;\n      const [sessionResult, deviceCountResult] = await Promise.all([\n        pool.query(\n          `SELECT\n             COUNT(*)::int AS active_sessions,\n             MAX(CASE WHEN token_hash = $2 THEN expires_at END) AS current_expires_at,\n             MAX(CASE WHEN token_hash = $2 THEN device_id END) AS current_device_id\n           FROM user_sessions\n           WHERE user_id = $1\n             AND expires_at > NOW()`,\n          [req.user.id, tokenHash]\n        ),\n        pool.query(\n          `SELECT COUNT(*)::int AS registered_devices\n           FROM account_devices\n           WHERE user_id = $1 AND revoked_at IS NULL`,\n          [req.user.id]\n        )\n      ]);\n\n      return res.json({\n        activeSessions: Number(sessionResult.rows[0]?.active_sessions || 0),\n        registeredDevices: Number(deviceCountResult.rows[0]?.registered_devices || 0),\n        currentDeviceId: sessionResult.rows[0]?.current_device_id\n          ? String(sessionResult.rows[0].current_device_id)\n          : null,\n        currentSessionExpiresAt: sessionResult.rows[0]?.current_expires_at || null\n      });'''
server = one(server, old_security, new_security, 'security status device counts')

# Password-change session stays associated with this device and records a security event.
server = one(
    server,
    '''      const token = crypto.randomBytes(32).toString("base64url");\n      const tokenHash = hashSessionToken(token);\n      await client.query(\n        `INSERT INTO user_sessions (user_id, token_hash, expires_at)\n         VALUES ($1, $2, NOW() + INTERVAL '${SESSION_DAYS} days')`,\n        [user.id, tokenHash]\n      );''',
    '''      const device = await ensureDeviceForRequest(user.id, req, res, client);\n      const token = crypto.randomBytes(32).toString("base64url");\n      const tokenHash = hashSessionToken(token);\n      await client.query(\n        `INSERT INTO user_sessions (user_id, token_hash, expires_at, device_id)\n         VALUES ($1, $2, NOW() + INTERVAL '${SESSION_DAYS} days', $3)`,\n        [user.id, tokenHash, device.id]\n      );\n      await writeSecurityEvent(\n        client,\n        user.id,\n        "password.changed",\n        device.id,\n        { otherSessionsRevoked: Math.max(Number(revoked.rowCount || 0) - 1, 0) }\n      );''',
    'password-change device session'
)

# Record the existing revoke-other-sessions action.
server = one(
    server,
    '''      await client.query("COMMIT");\n      return res.json({\n        ok: true,\n        revokedSessions: Number(revoked.rowCount || 0),\n        activeSessions: 1\n      });''',
    '''      await writeSecurityEvent(\n        client,\n        user.id,\n        "sessions.others_revoked",\n        currentResult.rows[0]?.device_id || null,\n        { revokedSessions: Number(revoked.rowCount || 0) }\n      );\n      await client.query("COMMIT");\n      return res.json({\n        ok: true,\n        revokedSessions: Number(revoked.rowCount || 0),\n        activeSessions: 1\n      });''',
    'session revoke event'
)
# Current-result query needs device id for the audit event.
server = one(
    server,
    '''        `SELECT id\n         FROM user_sessions''',
    '''        `SELECT id, device_id\n         FROM user_sessions''',
    'current session device select'
)

# Device list/revocation and logout-all APIs.
device_api = r'''
app.get(
  "/api/account/devices",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const association = await associateCurrentSessionWithDevice(
        req.user.id,
        req,
        res
      );
      const currentDeviceId = association.device?.id || null;
      const result = await pool.query(
        `SELECT
           d.id,
           d.device_label,
           d.first_seen_at,
           d.last_seen_at,
           COUNT(s.id) FILTER (WHERE s.expires_at > NOW())::int AS active_sessions
         FROM account_devices d
         LEFT JOIN user_sessions s ON s.device_id = d.id AND s.user_id = d.user_id
         WHERE d.user_id = $1
           AND d.revoked_at IS NULL
         GROUP BY d.id
         ORDER BY (d.id = $2) DESC, d.last_seen_at DESC, d.id DESC`,
        [req.user.id, currentDeviceId]
      );

      return res.json({
        devices: result.rows.map((row) => ({
          id: String(row.id),
          label: row.device_label,
          current: currentDeviceId !== null && String(row.id) === String(currentDeviceId),
          firstSeenAt: row.first_seen_at,
          lastSeenAt: row.last_seen_at,
          activeSessions: Number(row.active_sessions || 0)
        }))
      });
    } catch (error) {
      console.error("UNBOUND AI DEVICE LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load registered devices." });
    }
  }
);

app.post(
  "/api/account/devices/:id/revoke",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    const deviceId = String(req.params.id || "").trim();
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!/^\d+$/.test(deviceId)) {
      return res.status(400).json({ error: "Invalid device ID." });
    }
    if (!password || password.length > 200) {
      return res.status(400).json({ error: "Enter your current password." });
    }

    const token = parseCookies(req)[SESSION_COOKIE];
    const tokenHash = token ? hashSessionToken(token) : null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const userResult = await client.query(
        `SELECT id, password_hash FROM users WHERE id = $1 LIMIT 1 FOR UPDATE`,
        [req.user.id]
      );
      const user = userResult.rows[0];
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        await client.query("ROLLBACK");
        return res.status(401).json({ error: "Current password is incorrect." });
      }

      const currentResult = await client.query(
        `SELECT device_id FROM user_sessions
         WHERE user_id = $1 AND token_hash = $2 AND expires_at > NOW()
         LIMIT 1`,
        [user.id, tokenHash]
      );
      const currentDeviceId = currentResult.rows[0]?.device_id;
      if (currentDeviceId && String(currentDeviceId) === deviceId) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "You cannot revoke the device you are currently using. Use Log Out All Devices if you want to end this session too."
        });
      }

      const targetResult = await client.query(
        `SELECT id, device_label FROM account_devices
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
         LIMIT 1 FOR UPDATE`,
        [deviceId, user.id]
      );
      const target = targetResult.rows[0];
      if (!target) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Registered device not found." });
      }

      const revokedSessions = await client.query(
        `DELETE FROM user_sessions
         WHERE user_id = $1 AND device_id = $2
         RETURNING id`,
        [user.id, target.id]
      );
      await client.query(
        `UPDATE account_devices
         SET revoked_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND user_id = $2`,
        [target.id, user.id]
      );
      await writeSecurityEvent(
        client,
        user.id,
        "device.revoked",
        null,
        {
          revokedDeviceId: String(target.id),
          label: target.device_label,
          revokedSessions: Number(revokedSessions.rowCount || 0)
        },
        "warning"
      );
      await client.query("COMMIT");

      return res.json({
        ok: true,
        deviceId,
        revokedSessions: Number(revokedSessions.rowCount || 0)
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("UNBOUND AI DEVICE REVOKE ERROR:", error);
      return res.status(500).json({ error: "Could not revoke that device." });
    } finally {
      client.release();
    }
  }
);

app.post(
  "/api/account/sessions/revoke-all",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!password || password.length > 200) {
      return res.status(400).json({ error: "Enter your current password." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const userResult = await client.query(
        `SELECT id, password_hash FROM users WHERE id = $1 LIMIT 1 FOR UPDATE`,
        [req.user.id]
      );
      const user = userResult.rows[0];
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        await client.query("ROLLBACK");
        return res.status(401).json({ error: "Current password is incorrect." });
      }

      const revoked = await client.query(
        `DELETE FROM user_sessions WHERE user_id = $1 RETURNING id`,
        [user.id]
      );
      await writeSecurityEvent(
        client,
        user.id,
        "sessions.all_revoked",
        null,
        { revokedSessions: Number(revoked.rowCount || 0) },
        "warning"
      );
      await client.query("COMMIT");
      clearSessionCookie(res);
      return res.json({
        ok: true,
        loggedOut: true,
        revokedSessions: Number(revoked.rowCount || 0)
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("UNBOUND AI LOGOUT ALL DEVICES ERROR:", error);
      return res.status(500).json({ error: "Could not log out all devices." });
    } finally {
      client.release();
    }
  }
);

'''
server = one(
    server,
    '''app.delete(\n  "/api/account",''',
    device_api + '''app.delete(\n  "/api/account",''',
    'device APIs'
)

# Security modal device UI styles.
device_styles = r'''

    .device-list { display: grid; gap: 8px; margin-bottom: 15px; }
    .device-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      padding: 10px 11px;
      border: 1px solid rgba(107, 193, 255, 0.18);
      border-radius: 11px;
      background: rgba(255,255,255,0.025);
    }
    .device-name { font-size: 12px; font-weight: 850; color: #f3f9ff; }
    .device-meta { margin-top: 3px; color: var(--muted); font-size: 10px; line-height: 1.4; }
    .device-actions { display: flex; align-items: center; gap: 7px; }
    .device-revoke {
      padding: 7px 9px;
      border: 1px solid rgba(255,118,118,.32);
      border-radius: 9px;
      background: rgba(105,18,27,.24);
      color: #ffd4d4;
      cursor: pointer;
      font-size: 10px;
      font-weight: 850;
    }
'''
index = one(
    index,
    '''    .delete-account-warning {''',
    device_styles + '''\n    .delete-account-warning {''',
    'device styles'
)

# Add device list and full logout control to Account Security.
index = one(
    index,
    '''          Active sessions: <strong id="activeSessionCount">—</strong>\n          <span id="currentSessionExpiry"></span>\n        </div>\n\n        <form id="passwordChangeForm"''',
    '''          Active sessions: <strong id="activeSessionCount">—</strong> · Registered devices: <strong id="registeredDeviceCount">—</strong>\n          <span id="currentSessionExpiry"></span>\n        </div>\n\n        <div class="access-section-title">Registered devices</div>\n        <div class="auth-field" style="margin-bottom:10px;">\n          <label for="deviceRevokePassword">Current password for device revocation</label>\n          <input id="deviceRevokePassword" type="password" autocomplete="current-password" maxlength="200" />\n          <div class="auth-help">Required only when you revoke a registered device. The current device cannot revoke itself.</div>\n        </div>\n        <div id="deviceList" class="device-list"><div class="history-empty">Loading registered devices…</div></div>\n\n        <form id="passwordChangeForm"''',
    'device security markup'
)
index = one(
    index,
    '''        <form id="revokeSessionsForm" class="auth-form" autocomplete="off">\n          <div class="auth-field">\n            <label for="revokeSessionsPassword">Current password</label>\n            <input id="revokeSessionsPassword" type="password" autocomplete="current-password" maxlength="200" required />\n            <div class="auth-help">This keeps this device signed in and logs out every other device.</div>\n          </div>\n          <button id="revokeSessionsSubmit" class="auth-submit secondary" type="submit">LOG OUT OTHER DEVICES</button>\n        </form>''',
    '''        <form id="revokeSessionsForm" class="auth-form" autocomplete="off">\n          <div class="auth-field">\n            <label for="revokeSessionsPassword">Current password</label>\n            <input id="revokeSessionsPassword" type="password" autocomplete="current-password" maxlength="200" required />\n            <div class="auth-help">This keeps this device signed in and logs out every other device.</div>\n          </div>\n          <button id="revokeSessionsSubmit" class="auth-submit secondary" type="submit">LOG OUT OTHER DEVICES</button>\n        </form>\n\n        <div style="height:1px;background:rgba(255,255,255,.08);margin:18px 0;"></div>\n\n        <form id="logoutAllForm" class="auth-form" autocomplete="off">\n          <div class="auth-field">\n            <label for="logoutAllPassword">Current password</label>\n            <input id="logoutAllPassword" type="password" autocomplete="current-password" maxlength="200" required />\n            <div class="auth-help">This immediately logs out every session, including this one. Registered device records remain until revoked.</div>\n          </div>\n          <button id="logoutAllSubmit" class="auth-submit danger" type="submit">LOG OUT ALL DEVICES</button>\n        </form>''',
    'logout all markup'
)

# DOM references/state.
index = one(
    index,
    '''    const activeSessionCount = document.getElementById("activeSessionCount");\n    const currentSessionExpiry = document.getElementById("currentSessionExpiry");''',
    '''    const activeSessionCount = document.getElementById("activeSessionCount");\n    const registeredDeviceCount = document.getElementById("registeredDeviceCount");\n    const currentSessionExpiry = document.getElementById("currentSessionExpiry");\n    const deviceList = document.getElementById("deviceList");\n    const deviceRevokePassword = document.getElementById("deviceRevokePassword");''',
    'device refs'
)
index = one(
    index,
    '''    const revokeSessionsSubmit = document.getElementById("revokeSessionsSubmit");''',
    '''    const revokeSessionsSubmit = document.getElementById("revokeSessionsSubmit");\n    const logoutAllForm = document.getElementById("logoutAllForm");\n    const logoutAllPassword = document.getElementById("logoutAllPassword");\n    const logoutAllSubmit = document.getElementById("logoutAllSubmit");''',
    'logout all refs'
)
index = one(
    index,
    '''    let toastTimer = null;''',
    '''    let toastTimer = null;\n    let securityDevices = [];''',
    'device state'
)

# Device rendering/loading and enhanced security status refresh.
old_refresh = '''    async function refreshSecurityStatus() {\n      const response = await fetch("/api/account/security", {\n        method: "GET",\n        credentials: "same-origin",\n        headers: { "Accept": "application/json" }\n      });\n      const data = await readJson(response);\n      if (!response.ok) {\n        throw new Error(data.error || "Could not load security status.");\n      }\n\n      activeSessionCount.textContent = String(data.activeSessions ?? 0);\n      if (data.currentSessionExpiresAt) {\n        const date = new Date(data.currentSessionExpiresAt);\n        currentSessionExpiry.textContent = Number.isNaN(date.getTime())\n          ? ""\n          : ` • current session expires ${date.toLocaleString()}`;\n      } else {\n        currentSessionExpiry.textContent = "";\n      }\n    }'''
new_refresh = r'''    function renderSecurityDevices() {
      deviceList.innerHTML = "";
      if (!securityDevices.length) {
        deviceList.innerHTML = '<div class="history-empty">No registered devices yet.</div>';
        return;
      }

      for (const device of securityDevices) {
        const row = document.createElement("div");
        row.className = "device-row";
        const copy = document.createElement("div");
        const name = document.createElement("div");
        name.className = "device-name";
        name.textContent = device.label || "Unknown device";
        const meta = document.createElement("div");
        meta.className = "device-meta";
        const lastSeen = device.lastSeenAt ? new Date(device.lastSeenAt) : null;
        const seenText = lastSeen && !Number.isNaN(lastSeen.getTime())
          ? lastSeen.toLocaleString()
          : "unknown";
        meta.textContent = `${Number(device.activeSessions || 0)} active session(s) • last seen ${seenText}`;
        copy.append(name, meta);

        const actions = document.createElement("div");
        actions.className = "device-actions";
        if (device.current) {
          const badge = document.createElement("span");
          badge.className = "capability-badge live";
          badge.textContent = "CURRENT";
          actions.appendChild(badge);
        } else {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "device-revoke";
          button.textContent = "REVOKE";
          button.addEventListener("click", async () => {
            const password = deviceRevokePassword.value;
            if (!password) {
              showSecurityFeedback("Enter your current password above before revoking a device.");
              deviceRevokePassword.focus();
              return;
            }
            if (!window.confirm(`Revoke ${device.label || "this device"} and log out its active sessions?`)) return;
            button.disabled = true;
            try {
              const response = await fetch(`/api/account/devices/${encodeURIComponent(device.id)}/revoke`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password })
              });
              const data = await readJson(response);
              if (!response.ok) throw new Error(data.error || "Could not revoke that device.");
              deviceRevokePassword.value = "";
              showSecurityFeedback(
                `${device.label || "Device"} revoked. ${Number(data.revokedSessions || 0)} session(s) ended.`,
                "success"
              );
              await refreshSecurityStatus();
            } catch (error) {
              showSecurityFeedback(error.message || "Could not revoke that device.");
            } finally {
              button.disabled = false;
            }
          });
          actions.appendChild(button);
        }
        row.append(copy, actions);
        deviceList.appendChild(row);
      }
    }

    async function loadSecurityDevices() {
      const response = await fetch("/api/account/devices", {
        method: "GET",
        credentials: "same-origin",
        headers: { "Accept": "application/json" }
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Could not load registered devices.");
      securityDevices = Array.isArray(data.devices) ? data.devices : [];
      renderSecurityDevices();
    }

    async function refreshSecurityStatus() {
      const response = await fetch("/api/account/security", {
        method: "GET",
        credentials: "same-origin",
        headers: { "Accept": "application/json" }
      });
      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(data.error || "Could not load security status.");
      }

      activeSessionCount.textContent = String(data.activeSessions ?? 0);
      registeredDeviceCount.textContent = String(data.registeredDevices ?? 0);
      if (data.currentSessionExpiresAt) {
        const date = new Date(data.currentSessionExpiresAt);
        currentSessionExpiry.textContent = Number.isNaN(date.getTime())
          ? ""
          : ` • current session expires ${date.toLocaleString()}`;
      } else {
        currentSessionExpiry.textContent = "";
      }
      await loadSecurityDevices();
    }'''
index = one(index, old_refresh, new_refresh, 'security device rendering')

# Security modal lifecycle includes new controls.
index = one(
    index,
    '''      revokeSessionsForm.reset();\n      clearSecurityFeedback();''',
    '''      revokeSessionsForm.reset();\n      logoutAllForm.reset();\n      deviceRevokePassword.value = "";\n      clearSecurityFeedback();''',
    'open security resets'
)
index = one(
    index,
    '''      if (passwordChangeSubmit.disabled || revokeSessionsSubmit.disabled) return;''',
    '''      if (passwordChangeSubmit.disabled || revokeSessionsSubmit.disabled || logoutAllSubmit.disabled) return;''',
    'close security busy guard'
)
index = one(
    index,
    '''      revokeSessionsForm.reset();\n      clearSecurityFeedback();''',
    '''      revokeSessionsForm.reset();\n      logoutAllForm.reset();\n      deviceRevokePassword.value = "";\n      securityDevices = [];\n      clearSecurityFeedback();''',
    'close security resets'
)

logout_all_js = r'''

    async function handleLogoutAllDevices(event) {
      event.preventDefault();
      clearSecurityFeedback();
      const password = logoutAllPassword.value;
      if (!password) {
        showSecurityFeedback("Enter your current password.");
        return;
      }

      logoutAllSubmit.disabled = true;
      logoutAllSubmit.textContent = "LOGGING OUT...";
      try {
        const response = await fetch("/api/account/sessions/revoke-all", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password })
        });
        const data = await readJson(response);
        if (!response.ok || data.loggedOut !== true) {
          throw new Error(data.error || "Could not log out all devices.");
        }

        securityModal.hidden = true;
        currentUser = null;
        accountAccess = null;
        activeConversationId = null;
        securityDevices = [];
        document.body.classList.remove("modal-open");
        renderAccountUi();
        await switchConversationScope();
        showToast(`${Number(data.revokedSessions || 0)} session(s) logged out across all devices.`);
      } catch (error) {
        showSecurityFeedback(error.message || "Could not log out all devices.");
      } finally {
        logoutAllSubmit.disabled = false;
        logoutAllSubmit.textContent = "LOG OUT ALL DEVICES";
      }
    }
'''
index = one(
    index,
    '''    function clearDeleteAccountFeedback() {''',
    logout_all_js + '''\n    function clearDeleteAccountFeedback() {''',
    'logout all JS'
)

index = one(
    index,
    '''    revokeSessionsForm.addEventListener("submit", handleRevokeSessions);''',
    '''    revokeSessionsForm.addEventListener("submit", handleRevokeSessions);\n    logoutAllForm.addEventListener("submit", handleLogoutAllDevices);''',
    'logout all listener'
)

server_path.write_text(server)
index_path.write_text(index)
print('Device/session security foundation applied.')
