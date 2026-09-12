from pathlib import Path

server_path = Path('app/server.js')
admin_path = Path('app/admin.html')
server = server_path.read_text()
admin = admin_path.read_text()


def one(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    return source.replace(old, new, 1)

# Provider-neutral age-verification gateway import.
server = one(
    server,
    '''const {\n  normalizeSubscriptionStatus,\n  subscriptionStatusAllowsAccess,\n  getBillingGatewayStatus\n} = require("./billing/gateway");''',
    '''const {\n  normalizeSubscriptionStatus,\n  subscriptionStatusAllowsAccess,\n  getBillingGatewayStatus\n} = require("./billing/gateway");\nconst {\n  normalizeAgeVerificationStatus,\n  ageVerificationAllowsAdultAccess,\n  getAgeVerificationGatewayStatus\n} = require("./age/gateway");''',
    'age gateway import'
)

# Minimal-retention verification state + idempotent event ledger.
age_tables = r'''

    CREATE TABLE IF NOT EXISTS account_age_verification (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT,
      status TEXT NOT NULL DEFAULT 'unverified',
      age_threshold SMALLINT NOT NULL DEFAULT 18,
      verified_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      provider_reference_hash TEXT,
      result_code TEXT,
      last_event_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT account_age_verification_status_check
        CHECK (status IN ('unverified', 'pending', 'verified', 'failed', 'expired', 'revoked')),
      CONSTRAINT account_age_verification_threshold_check
        CHECK (age_threshold BETWEEN 18 AND 30)
    );

    CREATE INDEX IF NOT EXISTS account_age_verification_status_idx
      ON account_age_verification(status, expires_at);

    CREATE TABLE IF NOT EXISTS age_verification_events (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_event_id TEXT NOT NULL,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      event_type TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      payload_sha256 TEXT NOT NULL,
      error_text TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      UNIQUE(provider, provider_event_id)
    );

    CREATE INDEX IF NOT EXISTS age_verification_events_received_idx
      ON age_verification_events(received_at DESC);

    CREATE INDEX IF NOT EXISTS age_verification_events_provider_status_idx
      ON age_verification_events(provider, status, received_at DESC);
'''
server = one(
    server,
    '''    CREATE INDEX IF NOT EXISTS billing_webhook_events_provider_status_idx\n      ON billing_webhook_events(provider, status, received_at DESC);''',
    '''    CREATE INDEX IF NOT EXISTS billing_webhook_events_provider_status_idx\n      ON billing_webhook_events(provider, status, received_at DESC);''' + age_tables,
    'age verification tables'
)

# Age state loading and public-safe representation. No raw identity evidence is stored.
age_helpers = r'''

async function loadAgeVerification(userId, client = pool) {
  const result = await client.query(
    `SELECT
       provider,
       status,
       age_threshold,
       verified_at,
       expires_at,
       provider_reference_hash IS NOT NULL AS provider_reference_recorded,
       result_code,
       last_event_at,
       created_at,
       updated_at
     FROM account_age_verification
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] || null;
}

function publicAgeVerification(row) {
  const status = normalizeAgeVerificationStatus(row?.status);
  return {
    provider: row?.provider || null,
    status,
    verified: ageVerificationAllowsAdultAccess(status, row?.expires_at),
    ageThreshold: Number(row?.age_threshold || 18),
    verifiedAt: row?.verified_at || null,
    expiresAt: row?.expires_at || null,
    providerReferenceRecorded: Boolean(row?.provider_reference_recorded),
    resultCode: row?.result_code || null,
    lastEventAt: row?.last_event_at || null,
    updatedAt: row?.updated_at || null
  };
}

async function buildAgeVerificationState(userId) {
  const row = await loadAgeVerification(userId);
  return publicAgeVerification(row);
}

async function assertAgeVerifiedAdult(req) {
  if (!databaseReady || !pool) {
    const error = new Error("Age verification is temporarily unavailable.");
    error.statusCode = 503;
    throw error;
  }

  const user = req.user || (await findSessionUser(req));
  if (!user) {
    const error = new Error("Sign in before using age-restricted UNBOUND AI features.");
    error.statusCode = 401;
    throw error;
  }

  const ageVerification = await buildAgeVerificationState(user.id);
  if (!ageVerification.verified) {
    const error = new Error(
      "Hard 18+ age verification is required for that UNBOUND AI feature."
    );
    error.statusCode = 403;
    error.ageVerification = ageVerification;
    throw error;
  }

  return { user, ageVerification };
}

function requireAgeVerifiedAdult(req, res, next) {
  assertAgeVerifiedAdult(req)
    .then((result) => {
      req.user = result.user;
      req.ageVerification = result.ageVerification;
      next();
    })
    .catch((error) => {
      return res.status(error.statusCode || 500).json({
        error: error.message || "Could not verify adult access.",
        ageVerification: error.ageVerification || null
      });
    });
}
'''
server = one(
    server,
    '''async function loadEntitlementOverrides(userId, client = pool) {''',
    age_helpers + '''\nasync function loadEntitlementOverrides(userId, client = pool) {''',
    'age verification helpers'
)

# Include verification state in central account-access resolution.
server = one(
    server,
    '''  const [subscription, overrides] = await Promise.all([\n    loadAccountSubscription(user.id),\n    loadEntitlementOverrides(user.id)\n  ]);''',
    '''  const [subscription, overrides, ageVerification] = await Promise.all([\n    loadAccountSubscription(user.id),\n    loadEntitlementOverrides(user.id),\n    buildAgeVerificationState(user.id)\n  ]);''',
    'account access age load'
)
server = one(
    server,
    '''    capabilities,\n    summary: {''',
    '''    capabilities,\n    ageVerification,\n    summary: {''',
    'account access age payload'
)

# Health reports whether an adapter is selected without exposing secrets.
server = one(
    server,
    '''    billing: getBillingGatewayStatus()''',
    '''    billing: getBillingGatewayStatus(),\n    ageVerification: getAgeVerificationGatewayStatus()''',
    'age health status'
)

# Signed-in users can inspect their verification state even before a provider is selected.
account_age_api = r'''
app.get(
  "/api/account/age-verification",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      return res.json({
        gateway: getAgeVerificationGatewayStatus(),
        ageVerification: await buildAgeVerificationState(req.user.id)
      });
    } catch (error) {
      console.error("UNBOUND AI ACCOUNT AGE VERIFICATION ERROR:", error);
      return res.status(500).json({ error: "Could not load age-verification status." });
    }
  }
);

'''
server = one(
    server,
    '''app.get(\n  "/api/account/security",''',
    account_age_api + '''app.get(\n  "/api/account/security",''',
    'account age endpoint'
)

# Admin visibility: counts only, no raw identity evidence.
admin_age_api = r'''
app.get(
  "/api/admin/age-verification/summary",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const [totalsResult, groupedResult, eventResult] = await Promise.all([
        pool.query(`
          SELECT
            COUNT(*)::int AS records,
            COUNT(*) FILTER (
              WHERE status = 'verified'
                AND (expires_at IS NULL OR expires_at > NOW())
            )::int AS verified_active,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (
              WHERE status IN ('expired', 'revoked')
                 OR (status = 'verified' AND expires_at IS NOT NULL AND expires_at <= NOW())
            )::int AS unavailable
          FROM account_age_verification
        `),
        pool.query(`
          SELECT
            COALESCE(NULLIF(provider, ''), 'unassigned') AS provider,
            status,
            COUNT(*)::int AS records
          FROM account_age_verification
          GROUP BY COALESCE(NULLIF(provider, ''), 'unassigned'), status
          ORDER BY records DESC, provider, status
        `),
        pool.query(`
          SELECT
            COUNT(*)::int AS events_30d,
            COUNT(*) FILTER (WHERE status = 'processed')::int AS processed_30d,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_30d
          FROM age_verification_events
          WHERE received_at >= NOW() - INTERVAL '30 days'
        `)
      ]);

      const totals = totalsResult.rows[0] || {};
      const events = eventResult.rows[0] || {};
      return res.json({
        gateway: getAgeVerificationGatewayStatus(),
        totals: {
          records: Number(totals.records || 0),
          verifiedActive: Number(totals.verified_active || 0),
          pending: Number(totals.pending || 0),
          unavailable: Number(totals.unavailable || 0),
          events30d: Number(events.events_30d || 0),
          processed30d: Number(events.processed_30d || 0),
          failed30d: Number(events.failed_30d || 0)
        },
        records: groupedResult.rows.map((row) => ({
          provider: row.provider,
          status: normalizeAgeVerificationStatus(row.status),
          count: Number(row.records || 0)
        }))
      });
    } catch (error) {
      console.error("UNBOUND AI ADMIN AGE VERIFICATION SUMMARY ERROR:", error);
      return res.status(500).json({ error: "Could not load age-verification status." });
    }
  }
);

'''
server = one(
    server,
    '''app.get(\n  "/api/admin/billing/summary",''',
    admin_age_api + '''app.get(\n  "/api/admin/billing/summary",''',
    'admin age summary endpoint'
)

# Admin UI section before billing.
age_section = r'''

    <section class="card section">
      <div class="section-head">
        <div>
          <h2>Hard 18+ Age Verification</h2>
          <p>Provider-neutral verification state with minimal retained data. UNBOUND does not store raw ID images, face scans, or biometric templates.</p>
        </div>
        <button class="btn" id="refreshAgeVerification" type="button">Refresh Age Status</button>
      </div>

      <section class="stats">
        <div class="card stat"><div class="label">Age Adapter</div><div class="value" id="ageAdapter">—</div></div>
        <div class="card stat"><div class="label">Verified 18+</div><div class="value" id="ageVerified">—</div></div>
        <div class="card stat"><div class="label">Pending</div><div class="value" id="agePending">—</div></div>
        <div class="card stat"><div class="label">Unavailable</div><div class="value" id="ageUnavailable">—</div></div>
      </section>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Status</th>
              <th>Accounts</th>
            </tr>
          </thead>
          <tbody id="ageVerificationBody">
            <tr><td colspan="3" class="loading">Loading age-verification foundation…</td></tr>
          </tbody>
        </table>
      </div>
      <div class="feedback" id="ageVerificationFeedback"></div>
    </section>
'''
admin = one(
    admin,
    '''    <section class="card section">\n      <div class="section-head">\n        <div>\n          <h2>Billing Foundation</h2>''',
    age_section + '''\n\n    <section class="card section">\n      <div class="section-head">\n        <div>\n          <h2>Billing Foundation</h2>''',
    'age admin section'
)

# Admin DOM refs/state.
admin = one(
    admin,
    '''    const billingFeedback = document.getElementById("billingFeedback");''',
    '''    const billingFeedback = document.getElementById("billingFeedback");\n    const refreshAgeVerification = document.getElementById("refreshAgeVerification");\n    const ageAdapter = document.getElementById("ageAdapter");\n    const ageVerified = document.getElementById("ageVerified");\n    const agePending = document.getElementById("agePending");\n    const ageUnavailable = document.getElementById("ageUnavailable");\n    const ageVerificationBody = document.getElementById("ageVerificationBody");\n    const ageVerificationFeedback = document.getElementById("ageVerificationFeedback");''',
    'age admin refs'
)
admin = one(
    admin,
    '''    let billingSummary = null;''',
    '''    let billingSummary = null;\n    let ageVerificationSummary = null;''',
    'age admin state'
)

age_js = r'''

    function renderAgeVerification() {
      if (!ageVerificationSummary) return;
      const gateway = ageVerificationSummary.gateway || {};
      const totals = ageVerificationSummary.totals || {};
      ageAdapter.textContent = gateway.configured
        ? String(gateway.provider || "READY").toUpperCase()
        : gateway.provider
          ? `${String(gateway.provider).toUpperCase()} / SETUP`
          : "NOT SELECTED";
      ageVerified.textContent = formatInteger(totals.verifiedActive);
      agePending.textContent = formatInteger(totals.pending);
      ageUnavailable.textContent = formatInteger(totals.unavailable);

      const rows = Array.isArray(ageVerificationSummary.records)
        ? ageVerificationSummary.records
        : [];
      if (!rows.length) {
        ageVerificationBody.innerHTML =
          '<tr><td colspan="3" class="loading">No hard age-verification records yet.</td></tr>';
      } else {
        ageVerificationBody.innerHTML = rows.map((item) => `
          <tr>
            <td>${escapeHtml(item.provider || "unassigned")}</td>
            <td><span class="badge ${item.status === "verified" ? "gold" : ""}">${escapeHtml(item.status || "unverified")}</span></td>
            <td>${escapeHtml(formatInteger(item.count))}</td>
          </tr>
        `).join("");
      }

      const message = gateway.configured
        ? `Age-verification adapter ${gateway.provider} is configured.`
        : gateway.state === "adapter-not-installed"
          ? `Age-verification provider ${gateway.provider} is selected, but its adapter is not installed yet.`
          : "No age-verification provider is selected yet. The minimal-retention server foundation is ready for an approved adapter.";
      setFeedback(ageVerificationFeedback, message, gateway.configured ? "ok" : "");
    }

    async function loadAgeVerification() {
      try {
        ageVerificationSummary = await api("/api/admin/age-verification/summary");
        renderAgeVerification();
      } catch (error) {
        ageVerificationBody.innerHTML =
          `<tr><td colspan="3" class="loading">${escapeHtml(error.message)}</td></tr>`;
        setFeedback(ageVerificationFeedback, error.message, "error");
      }
    }
'''
admin = one(
    admin,
    '''    function renderBilling() {''',
    age_js + '''\n    function renderBilling() {''',
    'age admin JS'
)
admin = one(
    admin,
    '''        await Promise.all([loadUsage(), loadAudit(), loadBilling()]);''',
    '''        await Promise.all([loadUsage(), loadAudit(), loadBilling(), loadAgeVerification()]);''',
    'age dashboard load'
)
admin = one(
    admin,
    '''    refreshBilling.addEventListener("click", loadBilling);''',
    '''    refreshBilling.addEventListener("click", loadBilling);\n    refreshAgeVerification.addEventListener("click", loadAgeVerification);''',
    'age refresh listener'
)

server_path.write_text(server)
admin_path.write_text(admin)
print('Provider-neutral hard age-verification foundation applied.')
