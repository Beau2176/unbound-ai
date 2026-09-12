from pathlib import Path

server_path = Path('app/server.js')
index_path = Path('app/index.html')
admin_path = Path('app/admin.html')
server = server_path.read_text()
index = index_path.read_text()
admin = admin_path.read_text()


def one(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    return source.replace(old, new, 1)

# Device cookie privacy cleanup for permanent account deletion.
clear_device_cookie = r'''

function clearDeviceCookie(res) {
  const secure = IS_PRODUCTION ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${DEVICE_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`
  );
}
'''
server = one(
    server,
    '''function coarseDeviceLabel(req) {''',
    clear_device_cookie + '''\nfunction coarseDeviceLabel(req) {''',
    'clear device cookie helper'
)
server = one(
    server,
    '''      await client.query("COMMIT");\n      clearSessionCookie(res);\n\n      return res.json({\n        ok: true,\n        deleted: true''',
    '''      await client.query("COMMIT");\n      clearSessionCookie(res);\n      clearDeviceCookie(res);\n\n      return res.json({\n        ok: true,\n        deleted: true''',
    'account deletion device cookie cleanup'
)

# Public-safe security event serializer. Only known non-secret detail fields leave the server.
security_public = r'''

function publicSecurityEvent(row) {
  const details = row?.details && typeof row.details === "object" ? row.details : {};
  const publicDetails = {};
  for (const key of [
    "label",
    "revokedDeviceId",
    "revokedSessions",
    "otherSessionsRevoked"
  ]) {
    if (details[key] !== undefined && details[key] !== null) {
      publicDetails[key] = details[key];
    }
  }

  return {
    id: String(row.id),
    eventType: row.event_type,
    severity: row.severity || "info",
    deviceLabel: row.device_label || null,
    details: publicDetails,
    createdAt: row.created_at
  };
}
'''
server = one(
    server,
    '''async function ensureDeviceForRequest(userId, req, res, client = pool) {''',
    security_public + '''\nasync function ensureDeviceForRequest(userId, req, res, client = pool) {''',
    'security event serializer'
)

# Signed-in user's recent security activity.
account_events_api = r'''
app.get(
  "/api/account/security/events",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const requested = Number(req.query.limit || 25);
      const limit = Math.min(Math.max(Number.isFinite(requested) ? Math.trunc(requested) : 25, 1), 100);
      const result = await pool.query(
        `SELECT
           e.id,
           e.event_type,
           e.severity,
           e.details,
           e.created_at,
           d.device_label
         FROM account_security_events e
         LEFT JOIN account_devices d ON d.id = e.device_id AND d.user_id = e.user_id
         WHERE e.user_id = $1
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT $2`,
        [req.user.id, limit]
      );

      return res.json({ events: result.rows.map(publicSecurityEvent) });
    } catch (error) {
      console.error("UNBOUND AI SECURITY EVENT HISTORY ERROR:", error);
      return res.status(500).json({ error: "Could not load security activity." });
    }
  }
);

'''
server = one(
    server,
    '''app.get(\n  "/api/account/devices",''',
    account_events_api + '''app.get(\n  "/api/account/devices",''',
    'account security events endpoint'
)

# Admin aggregate security-operations view. No per-user security details are exposed here.
admin_security_api = r'''
app.get(
  "/api/admin/security/summary",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const requested = Number(req.query.days || 30);
      const days = Math.min(Math.max(Number.isFinite(requested) ? Math.trunc(requested) : 30, 1), 90);
      const [eventTotalsResult, eventTypesResult, deviceResult, sessionResult] = await Promise.all([
        pool.query(
          `SELECT
             COUNT(*)::int AS events,
             COUNT(*) FILTER (WHERE severity = 'warning')::int AS warnings
           FROM account_security_events
           WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')`,
          [days]
        ),
        pool.query(
          `SELECT event_type, severity, COUNT(*)::int AS events
           FROM account_security_events
           WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
           GROUP BY event_type, severity
           ORDER BY events DESC, event_type, severity`,
          [days]
        ),
        pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE revoked_at IS NULL)::int AS active_devices,
            COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked_devices
          FROM account_devices
        `),
        pool.query(`
          SELECT COUNT(*)::int AS active_sessions
          FROM user_sessions
          WHERE expires_at > NOW()
        `)
      ]);

      const eventTotals = eventTotalsResult.rows[0] || {};
      const devices = deviceResult.rows[0] || {};
      const sessions = sessionResult.rows[0] || {};
      return res.json({
        days,
        totals: {
          events: Number(eventTotals.events || 0),
          warnings: Number(eventTotals.warnings || 0),
          activeDevices: Number(devices.active_devices || 0),
          revokedDevices: Number(devices.revoked_devices || 0),
          activeSessions: Number(sessions.active_sessions || 0)
        },
        eventTypes: eventTypesResult.rows.map((row) => ({
          eventType: row.event_type,
          severity: row.severity || "info",
          events: Number(row.events || 0)
        }))
      });
    } catch (error) {
      console.error("UNBOUND AI ADMIN SECURITY SUMMARY ERROR:", error);
      return res.status(500).json({ error: "Could not load security operations summary." });
    }
  }
);

'''
server = one(
    server,
    '''app.get(\n  "/api/admin/age-verification/summary",''',
    admin_security_api + '''app.get(\n  "/api/admin/age-verification/summary",''',
    'admin security summary endpoint'
)

# Main-account Security modal activity styles.
activity_styles = r'''

    .security-event-list { display: grid; gap: 8px; max-height: 260px; overflow-y: auto; }
    .security-event-row {
      padding: 10px 11px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 11px;
      background: rgba(255,255,255,0.025);
    }
    .security-event-head { display:flex; justify-content:space-between; gap:10px; align-items:center; }
    .security-event-name { color:#f3f9ff; font-size:12px; font-weight:850; }
    .security-event-time { color:var(--muted); font-size:9px; white-space:nowrap; }
    .security-event-detail { margin-top:4px; color:var(--muted); font-size:10px; line-height:1.4; }
'''
index = one(
    index,
    '''    .delete-account-warning {''',
    activity_styles + '''\n    .delete-account-warning {''',
    'security activity styles'
)

# Security activity section in the account modal.
index = one(
    index,
    '''        <div id="deviceList" class="device-list"><div class="history-empty">Loading registered devices…</div></div>\n\n        <form id="passwordChangeForm"''',
    '''        <div id="deviceList" class="device-list"><div class="history-empty">Loading registered devices…</div></div>\n\n        <div class="access-section-title">Recent security activity</div>\n        <div id="securityEventList" class="security-event-list"><div class="history-empty">Loading security activity…</div></div>\n\n        <form id="passwordChangeForm"''',
    'security event account markup'
)
index = one(
    index,
    '''    const deviceRevokePassword = document.getElementById("deviceRevokePassword");''',
    '''    const deviceRevokePassword = document.getElementById("deviceRevokePassword");\n    const securityEventList = document.getElementById("securityEventList");''',
    'security event DOM ref'
)
index = one(
    index,
    '''    let securityDevices = [];''',
    '''    let securityDevices = [];\n    let securityEvents = [];''',
    'security event state'
)

activity_js = r'''

    function securityEventLabel(eventType) {
      return ({
        "device.registered": "Device registered",
        "device.revoked": "Device revoked",
        "password.changed": "Password changed",
        "sessions.others_revoked": "Other sessions logged out",
        "sessions.all_revoked": "All sessions logged out"
      })[eventType] || String(eventType || "Security event").replaceAll(".", " ");
    }

    function securityEventDetails(event) {
      const details = event?.details || {};
      const parts = [];
      if (event?.deviceLabel) parts.push(event.deviceLabel);
      else if (details.label) parts.push(details.label);
      if (details.revokedSessions !== undefined) parts.push(`${Number(details.revokedSessions || 0)} session(s)`);
      if (details.otherSessionsRevoked !== undefined) parts.push(`${Number(details.otherSessionsRevoked || 0)} other session(s)`);
      return parts.join(" • ") || "Account security activity";
    }

    function renderSecurityEvents() {
      securityEventList.innerHTML = "";
      if (!securityEvents.length) {
        securityEventList.innerHTML = '<div class="history-empty">No security activity has been recorded yet.</div>';
        return;
      }
      for (const event of securityEvents) {
        const row = document.createElement("div");
        row.className = "security-event-row";
        const head = document.createElement("div");
        head.className = "security-event-head";
        const name = document.createElement("div");
        name.className = "security-event-name";
        name.textContent = securityEventLabel(event.eventType);
        const time = document.createElement("div");
        time.className = "security-event-time";
        const date = event.createdAt ? new Date(event.createdAt) : null;
        time.textContent = date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "—";
        head.append(name, time);
        const detail = document.createElement("div");
        detail.className = "security-event-detail";
        detail.textContent = securityEventDetails(event);
        row.append(head, detail);
        securityEventList.appendChild(row);
      }
    }

    async function loadSecurityEvents() {
      const response = await fetch("/api/account/security/events?limit=25", {
        method: "GET",
        credentials: "same-origin",
        headers: { "Accept": "application/json" }
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Could not load security activity.");
      securityEvents = Array.isArray(data.events) ? data.events : [];
      renderSecurityEvents();
    }
'''
index = one(
    index,
    '''    function renderSecurityDevices() {''',
    activity_js + '''\n    function renderSecurityDevices() {''',
    'security event JS'
)
index = one(
    index,
    '''      await loadSecurityDevices();\n    }\n\n    async function openSecurity()''',
    '''      await Promise.all([loadSecurityDevices(), loadSecurityEvents()]);\n    }\n\n    async function openSecurity()''',
    'security refresh activity load'
)
index = one(
    index,
    '''      securityDevices = [];\n      clearSecurityFeedback();''',
    '''      securityDevices = [];\n      securityEvents = [];\n      clearSecurityFeedback();''',
    'security close event reset'
)
index = one(
    index,
    '''        securityDevices = [];\n        document.body.classList.remove("modal-open");''',
    '''        securityDevices = [];\n        securityEvents = [];\n        document.body.classList.remove("modal-open");''',
    'logout all event reset'
)

# Admin security operations panel before age verification.
security_admin_section = r'''

    <section class="card section">
      <div class="section-head">
        <div>
          <h2>Security Operations</h2>
          <p>Aggregate account-security activity, registered devices, and active sessions. No IP addresses are stored by this system.</p>
        </div>
        <button class="btn" id="refreshSecurityOperations" type="button">Refresh Security</button>
      </div>

      <section class="stats">
        <div class="card stat"><div class="label">Active Sessions</div><div class="value" id="securityActiveSessions">—</div></div>
        <div class="card stat"><div class="label">Registered Devices</div><div class="value" id="securityActiveDevices">—</div></div>
        <div class="card stat"><div class="label">Security Events 30d</div><div class="value" id="securityEvents30d">—</div></div>
        <div class="card stat"><div class="label">Warnings 30d</div><div class="value" id="securityWarnings30d">—</div></div>
      </section>

      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Event</th><th>Severity</th><th>Count</th></tr>
          </thead>
          <tbody id="securityOperationsBody">
            <tr><td colspan="3" class="loading">Loading security operations…</td></tr>
          </tbody>
        </table>
      </div>
      <div class="feedback" id="securityOperationsFeedback"></div>
    </section>
'''
admin = one(
    admin,
    '''    <section class="card section">\n      <div class="section-head">\n        <div>\n          <h2>Hard 18+ Age Verification</h2>''',
    security_admin_section + '''\n\n    <section class="card section">\n      <div class="section-head">\n        <div>\n          <h2>Hard 18+ Age Verification</h2>''',
    'security admin section'
)

admin = one(
    admin,
    '''    const ageVerificationFeedback = document.getElementById("ageVerificationFeedback");''',
    '''    const ageVerificationFeedback = document.getElementById("ageVerificationFeedback");\n    const refreshSecurityOperations = document.getElementById("refreshSecurityOperations");\n    const securityActiveSessions = document.getElementById("securityActiveSessions");\n    const securityActiveDevices = document.getElementById("securityActiveDevices");\n    const securityEvents30d = document.getElementById("securityEvents30d");\n    const securityWarnings30d = document.getElementById("securityWarnings30d");\n    const securityOperationsBody = document.getElementById("securityOperationsBody");\n    const securityOperationsFeedback = document.getElementById("securityOperationsFeedback");''',
    'security admin refs'
)
admin = one(
    admin,
    '''    let ageVerificationSummary = null;''',
    '''    let ageVerificationSummary = null;\n    let securityOperationsSummary = null;''',
    'security admin state'
)

security_admin_js = r'''

    function renderSecurityOperations() {
      if (!securityOperationsSummary) return;
      const totals = securityOperationsSummary.totals || {};
      securityActiveSessions.textContent = formatInteger(totals.activeSessions);
      securityActiveDevices.textContent = formatInteger(totals.activeDevices);
      securityEvents30d.textContent = formatInteger(totals.events);
      securityWarnings30d.textContent = formatInteger(totals.warnings);

      const rows = Array.isArray(securityOperationsSummary.eventTypes)
        ? securityOperationsSummary.eventTypes
        : [];
      if (!rows.length) {
        securityOperationsBody.innerHTML = '<tr><td colspan="3" class="loading">No security events in this window yet.</td></tr>';
      } else {
        securityOperationsBody.innerHTML = rows.map((item) => `
          <tr>
            <td>${escapeHtml(String(item.eventType || "security event").replaceAll(".", " "))}</td>
            <td><span class="badge ${item.severity === "warning" ? "gold" : ""}">${escapeHtml(item.severity || "info")}</span></td>
            <td>${escapeHtml(formatInteger(item.events))}</td>
          </tr>
        `).join("");
      }
      setFeedback(
        securityOperationsFeedback,
        `Showing aggregate security activity for the last ${securityOperationsSummary.days || 30} days. Revoked devices retained: ${formatInteger(totals.revokedDevices)}.`,
        "ok"
      );
    }

    async function loadSecurityOperations() {
      try {
        securityOperationsSummary = await api("/api/admin/security/summary?days=30");
        renderSecurityOperations();
      } catch (error) {
        securityOperationsBody.innerHTML = `<tr><td colspan="3" class="loading">${escapeHtml(error.message)}</td></tr>`;
        setFeedback(securityOperationsFeedback, error.message, "error");
      }
    }
'''
admin = one(
    admin,
    '''    function renderAgeVerification() {''',
    security_admin_js + '''\n    function renderAgeVerification() {''',
    'security admin JS'
)
admin = one(
    admin,
    '''        await Promise.all([loadUsage(), loadAudit(), loadBilling(), loadAgeVerification()]);''',
    '''        await Promise.all([loadUsage(), loadAudit(), loadBilling(), loadAgeVerification(), loadSecurityOperations()]);''',
    'security admin initial load'
)
admin = one(
    admin,
    '''    refreshAgeVerification.addEventListener("click", loadAgeVerification);''',
    '''    refreshAgeVerification.addEventListener("click", loadAgeVerification);\n    refreshSecurityOperations.addEventListener("click", loadSecurityOperations);''',
    'security admin refresh listener'
)

server_path.write_text(server)
index_path.write_text(index)
admin_path.write_text(admin)
print('Security activity history, admin summary, and deletion privacy cleanup applied.')
