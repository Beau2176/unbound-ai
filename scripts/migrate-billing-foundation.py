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

# Billing gateway import.
server = one(
    server,
    '''const {\n  CAPABILITY_CATALOG,\n  normalizePlanTier,\n  getPlanDefinition,\n  isKnownCapability,\n  buildCapabilityAccess\n} = require("./access/entitlements");''',
    '''const {\n  CAPABILITY_CATALOG,\n  normalizePlanTier,\n  getPlanDefinition,\n  isKnownCapability,\n  buildCapabilityAccess\n} = require("./access/entitlements");\nconst {\n  normalizeSubscriptionStatus,\n  subscriptionStatusAllowsAccess,\n  getBillingGatewayStatus\n} = require("./billing/gateway");''',
    'billing import'
)

# Remove the old local status helper now provided by the billing gateway.
server = one(
    server,
    '''function subscriptionStatusAllowsAccess(status) {\n  return ["active", "trialing"].includes(\n    String(status || "").trim().toLowerCase()\n  );\n}\n\n''',
    '',
    'legacy billing status helper'
)

# Webhook idempotency ledger. Raw webhook payloads are intentionally not stored.
webhook_table = r'''

    CREATE TABLE IF NOT EXISTS billing_webhook_events (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_event_id TEXT NOT NULL,
      event_type TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      payload_sha256 TEXT NOT NULL,
      error_text TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      UNIQUE(provider, provider_event_id)
    );

    CREATE INDEX IF NOT EXISTS billing_webhook_events_received_idx
      ON billing_webhook_events(received_at DESC);

    CREATE INDEX IF NOT EXISTS billing_webhook_events_provider_status_idx
      ON billing_webhook_events(provider, status, received_at DESC);
'''
server = one(
    server,
    '''    CREATE INDEX IF NOT EXISTS account_subscriptions_status_idx\n      ON account_subscriptions(status, plan_tier);''',
    '''    CREATE INDEX IF NOT EXISTS account_subscriptions_status_idx\n      ON account_subscriptions(status, plan_tier);''' + webhook_table,
    'billing webhook ledger'
)

# Normalize subscription status at the API boundary while preserving stored provider data.
server = one(
    server,
    '''      status: subscription?.status || "none",''',
    '''      status: normalizeSubscriptionStatus(subscription?.status),''',
    'account subscription status normalization'
)

# Health should expose the provider-neutral billing gateway without secrets.
server = one(
    server,
    '''    ai: getGatewayStatus(),\n    commercial: databaseReady ? "entitlements-ready" : "not-ready"''',
    '''    ai: getGatewayStatus(),\n    commercial: databaseReady ? "entitlements-ready" : "not-ready",\n    billing: getBillingGatewayStatus()''',
    'billing health status'
)

billing_api = r'''
app.get(
  "/api/admin/billing/summary",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const [totalsResult, subscriptionsResult, webhookResult] = await Promise.all([
        pool.query(`
          SELECT
            COUNT(*)::int AS records,
            COUNT(*) FILTER (WHERE LOWER(status) IN ('active', 'trialing'))::int AS active_or_trialing,
            COUNT(*) FILTER (WHERE cancel_at_period_end IS TRUE)::int AS cancel_at_period_end
          FROM account_subscriptions
        `),
        pool.query(`
          SELECT
            COALESCE(NULLIF(provider, ''), 'unassigned') AS provider,
            status,
            plan_tier,
            COUNT(*)::int AS records
          FROM account_subscriptions
          GROUP BY COALESCE(NULLIF(provider, ''), 'unassigned'), status, plan_tier
          ORDER BY records DESC, provider, status, plan_tier
        `),
        pool.query(`
          SELECT
            COUNT(*)::int AS events_30d,
            COUNT(*) FILTER (WHERE status = 'processed')::int AS processed_30d,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_30d
          FROM billing_webhook_events
          WHERE received_at >= NOW() - INTERVAL '30 days'
        `)
      ]);

      const totals = totalsResult.rows[0] || {};
      const webhookTotals = webhookResult.rows[0] || {};

      return res.json({
        gateway: getBillingGatewayStatus(),
        totals: {
          subscriptionRecords: Number(totals.records || 0),
          activeOrTrialing: Number(totals.active_or_trialing || 0),
          cancelAtPeriodEnd: Number(totals.cancel_at_period_end || 0),
          webhookEvents30d: Number(webhookTotals.events_30d || 0),
          webhookProcessed30d: Number(webhookTotals.processed_30d || 0),
          webhookFailed30d: Number(webhookTotals.failed_30d || 0)
        },
        subscriptions: subscriptionsResult.rows.map((row) => ({
          provider: row.provider,
          status: normalizeSubscriptionStatus(row.status),
          rawStatus: row.status,
          planTier: normalizePlanTier(row.plan_tier),
          records: Number(row.records || 0)
        }))
      });
    } catch (error) {
      console.error("UNBOUND AI ADMIN BILLING SUMMARY ERROR:", error);
      return res.status(500).json({ error: "Could not load billing foundation status." });
    }
  }
);

'''
server = one(
    server,
    'app.get(\n  "/api/admin/overview",',
    billing_api + 'app.get(\n  "/api/admin/overview",',
    'admin billing summary endpoint'
)

# Admin markup: billing foundation visibility before usage metering.
billing_section = r'''

    <section class="card section">
      <div class="section-head">
        <div>
          <h2>Billing Foundation</h2>
          <p>Provider-neutral subscription state and webhook-readiness. No payment processor is selected until compatibility is approved.</p>
        </div>
        <button class="btn" id="refreshBilling" type="button">Refresh Billing</button>
      </div>

      <section class="stats">
        <div class="card stat"><div class="label">Billing Adapter</div><div class="value" id="billingAdapter">—</div></div>
        <div class="card stat"><div class="label">Subscription Records</div><div class="value" id="billingRecords">—</div></div>
        <div class="card stat"><div class="label">Active / Trialing</div><div class="value" id="billingActive">—</div></div>
        <div class="card stat"><div class="label">Webhook Events 30d</div><div class="value" id="billingWebhooks">—</div></div>
      </section>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Status</th>
              <th>Plan</th>
              <th>Records</th>
            </tr>
          </thead>
          <tbody id="billingSubscriptionsBody">
            <tr><td colspan="4" class="loading">Loading billing foundation…</td></tr>
          </tbody>
        </table>
      </div>
      <div class="feedback" id="billingFeedback"></div>
    </section>
'''
admin = one(
    admin,
    '''    <section class="card section">\n      <div class="section-head">\n        <div>\n          <h2>Usage & Cost Metering</h2>''',
    billing_section + '''\n\n    <section class="card section">\n      <div class="section-head">\n        <div>\n          <h2>Usage & Cost Metering</h2>''',
    'billing admin section'
)

# Admin DOM refs and state.
admin = one(
    admin,
    '''    const entitlementFeedback = document.getElementById("entitlementFeedback");''',
    '''    const entitlementFeedback = document.getElementById("entitlementFeedback");\n    const refreshBilling = document.getElementById("refreshBilling");\n    const billingAdapter = document.getElementById("billingAdapter");\n    const billingRecords = document.getElementById("billingRecords");\n    const billingActive = document.getElementById("billingActive");\n    const billingWebhooks = document.getElementById("billingWebhooks");\n    const billingSubscriptionsBody = document.getElementById("billingSubscriptionsBody");\n    const billingFeedback = document.getElementById("billingFeedback");''',
    'billing admin refs'
)
admin = one(
    admin,
    '''    let selectedUserAccess = null;''',
    '''    let selectedUserAccess = null;\n    let billingSummary = null;''',
    'billing admin state'
)

billing_js = r'''

    function renderBilling() {
      if (!billingSummary) return;
      const gateway = billingSummary.gateway || {};
      const totals = billingSummary.totals || {};
      billingAdapter.textContent = gateway.configured
        ? String(gateway.provider || "READY").toUpperCase()
        : gateway.provider
          ? `${String(gateway.provider).toUpperCase()} / SETUP`
          : "NOT SELECTED";
      billingRecords.textContent = formatInteger(totals.subscriptionRecords);
      billingActive.textContent = formatInteger(totals.activeOrTrialing);
      billingWebhooks.textContent = formatInteger(totals.webhookEvents30d);

      const rows = Array.isArray(billingSummary.subscriptions)
        ? billingSummary.subscriptions
        : [];
      if (!rows.length) {
        billingSubscriptionsBody.innerHTML =
          '<tr><td colspan="4" class="loading">No external subscription records yet.</td></tr>';
      } else {
        billingSubscriptionsBody.innerHTML = rows.map((item) => `
          <tr>
            <td>${escapeHtml(item.provider || "unassigned")}</td>
            <td><span class="badge">${escapeHtml(item.status || "none")}</span></td>
            <td><span class="badge ${item.planTier === "top" ? "gold" : ""}">${escapeHtml(item.planTier || "free")}</span></td>
            <td>${escapeHtml(formatInteger(item.records))}</td>
          </tr>
        `).join("");
      }

      const message = gateway.configured
        ? `Billing adapter ${gateway.provider} is configured. Checkout: ${gateway.checkout ? "ready" : "not available"}; webhooks: ${gateway.webhooks ? "ready" : "not available"}.`
        : gateway.state === "adapter-not-installed"
          ? `Billing provider ${gateway.provider} is selected, but its adapter is not installed yet.`
          : "No payment processor is selected yet. The provider-neutral billing foundation is ready for an approved adapter.";
      setFeedback(billingFeedback, message, gateway.configured ? "ok" : "");
    }

    async function loadBilling() {
      try {
        billingSummary = await api("/api/admin/billing/summary");
        renderBilling();
      } catch (error) {
        billingSubscriptionsBody.innerHTML =
          `<tr><td colspan="4" class="loading">${escapeHtml(error.message)}</td></tr>`;
        setFeedback(billingFeedback, error.message, "error");
      }
    }
'''
admin = one(
    admin,
    '''    function formatMicrosUsd(value, priced) {''',
    billing_js + '''\n    function formatMicrosUsd(value, priced) {''',
    'billing admin JS'
)

admin = one(
    admin,
    '''        await Promise.all([loadUsage(), loadAudit()]);''',
    '''        await Promise.all([loadUsage(), loadAudit(), loadBilling()]);''',
    'billing dashboard load'
)
admin = one(
    admin,
    '''    refreshUsage.addEventListener("click", loadUsage);''',
    '''    refreshUsage.addEventListener("click", loadUsage);\n    refreshBilling.addEventListener("click", loadBilling);''',
    'billing refresh listener'
)

server_path.write_text(server)
admin_path.write_text(admin)
print('Provider-neutral billing foundation applied.')
