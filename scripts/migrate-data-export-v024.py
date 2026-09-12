from pathlib import Path


def one(path, old, new, label):
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    path.write_text(text.replace(old, new, 1))


server = Path('app/server.js')
index = Path('app/index.html')
entitlements = Path('app/access/entitlements.js')

one(
    entitlements,
'''  adult_mode: Object.freeze({
    label: "Adult Mode",
    description: "Verified-18+ mature conversation protected by a server-side hard age-verification gate.",
    implemented: true,
    minimumPlan: "free"
  }),
  file_analysis: Object.freeze({
''',
'''  adult_mode: Object.freeze({
    label: "Adult Mode",
    description: "Verified-18+ mature conversation protected by a server-side hard age-verification gate.",
    implemented: true,
    minimumPlan: "free"
  }),
  data_export: Object.freeze({
    label: "Download My Data",
    description: "Download a privacy-safe JSON copy of account data and conversation history.",
    implemented: true,
    minimumPlan: "free"
  }),
  file_analysis: Object.freeze({
''',
    'data export entitlement'
)

one(
    server,
'''const {
  normalizeAiStyle,
  getAiStylePrompt,
  listAiStyles
} = require("./preferences/ai-style");
''',
'''const {
  normalizeAiStyle,
  getAiStylePrompt,
  listAiStyles
} = require("./preferences/ai-style");
const {
  buildExportFilename,
  buildDataExport
} = require("./privacy/data-export");
''',
    'data export imports'
)

export_block = r'''
app.get(
  "/api/account/export",
  requireDatabase,
  requireSignedIn,
  requireCapability("data_export"),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const [
        accountResult,
        preferences,
        access,
        conversationResult,
        deviceResult,
        securityEventResult,
        securityAlertResult,
        passkeyResult,
        recoveryResult,
        usageResult,
        overrideResult
      ] = await Promise.all([
        pool.query(
          `SELECT id, email, display_name, role, plan_tier,
                  adult_confirmed_at, created_at, updated_at
           FROM users
           WHERE id = $1
           LIMIT 1`,
          [userId]
        ),
        loadAiPreferences(userId),
        buildAccountAccess(req.user),
        pool.query(
          `SELECT
             c.id AS conversation_id,
             c.title,
             c.depth_style,
             c.product_mode,
             c.created_at AS conversation_created_at,
             c.updated_at AS conversation_updated_at,
             m.id AS message_id,
             m.role AS message_role,
             m.content AS message_content,
             m.research_sources,
             m.research_citations,
             m.created_at AS message_created_at
           FROM conversations c
           LEFT JOIN conversation_messages m ON m.conversation_id = c.id
           WHERE c.user_id = $1
           ORDER BY c.created_at, c.id, m.id`,
          [userId]
        ),
        pool.query(
          `SELECT id, device_label, first_seen_at, last_seen_at, revoked_at, updated_at
           FROM account_devices
           WHERE user_id = $1
           ORDER BY first_seen_at, id`,
          [userId]
        ),
        pool.query(
          `SELECT e.id, e.event_type, e.severity, e.details, e.created_at,
                  d.device_label
           FROM account_security_events e
           LEFT JOIN account_devices d ON d.id = e.device_id
           WHERE e.user_id = $1
           ORDER BY e.created_at, e.id`,
          [userId]
        ),
        pool.query(
          `SELECT a.id, a.event_type, a.severity, a.title, a.message,
                  a.acknowledged_at, a.created_at, d.device_label
           FROM account_security_alerts a
           LEFT JOIN account_devices d ON d.id = a.device_id
           WHERE a.user_id = $1
           ORDER BY a.created_at, a.id`,
          [userId]
        ),
        pool.query(
          `SELECT id, label, transports, device_type, backed_up, created_at, last_used_at
           FROM account_passkeys
           WHERE user_id = $1
           ORDER BY created_at, id`,
          [userId]
        ),
        pool.query(
          `SELECT
             COUNT(*)::int AS total_records,
             COUNT(*) FILTER (WHERE used_at IS NULL)::int AS remaining,
             MAX(created_at) AS generated_at,
             MAX(used_at) AS last_used_at
           FROM account_recovery_codes
           WHERE user_id = $1`,
          [userId]
        ),
        pool.query(
          `SELECT provider, model, event_type, input_tokens, output_tokens,
                  total_tokens, web_search_calls, estimated_cost_micros, created_at
           FROM usage_events
           WHERE user_id = $1
           ORDER BY created_at, id`,
          [userId]
        ),
        pool.query(
          `SELECT entitlement_key, enabled, reason, expires_at, created_at, updated_at
           FROM account_entitlement_overrides
           WHERE user_id = $1
           ORDER BY entitlement_key`,
          [userId]
        )
      ]);

      const accountRow = accountResult.rows[0];
      if (!accountRow) {
        return res.status(404).json({ error: "Account not found." });
      }

      const conversationMap = new Map();
      for (const row of conversationResult.rows) {
        const id = String(row.conversation_id);
        if (!conversationMap.has(id)) {
          conversationMap.set(id, {
            id,
            title: row.title || "New chat",
            depthStyle: normalizeDepthStyle(row.depth_style),
            productMode: normalizeProductMode(row.product_mode),
            createdAt: row.conversation_created_at,
            updatedAt: row.conversation_updated_at,
            messages: []
          });
        }
        if (row.message_id) {
          const content = String(row.message_content || "");
          const sources = row.message_role === "assistant"
            ? normalizeResearchSources(row.research_sources)
            : [];
          const citations = row.message_role === "assistant"
            ? normalizeResearchCitations(row.research_citations, sources, content.length)
            : [];
          conversationMap.get(id).messages.push({
            id: String(row.message_id),
            role: row.message_role,
            content,
            sources,
            citations,
            createdAt: row.message_created_at
          });
        }
      }

      const devices = deviceResult.rows.map((row) => ({
        id: String(row.id),
        label: row.device_label || "Unknown device",
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        revokedAt: row.revoked_at || null,
        updatedAt: row.updated_at
      }));

      const recoveryRow = recoveryResult.rows[0] || {};
      const exportPayload = buildDataExport({
        account: {
          id: String(accountRow.id),
          email: accountRow.email,
          displayName: accountRow.display_name,
          role: accountRow.role,
          planTier: accountRow.plan_tier,
          adultSelfConfirmedAt: accountRow.adult_confirmed_at,
          createdAt: accountRow.created_at,
          updatedAt: accountRow.updated_at
        },
        preferences,
        access,
        conversations: Array.from(conversationMap.values()),
        devices,
        securityEvents: securityEventResult.rows.map(publicSecurityEvent),
        securityAlerts: securityAlertResult.rows.map(publicSecurityAlert),
        passkeys: passkeyResult.rows.map(publicPasskey),
        recovery: {
          remaining: Number(recoveryRow.remaining || 0),
          totalRecords: Number(recoveryRow.total_records || 0),
          generatedAt: recoveryRow.generated_at || null,
          lastUsedAt: recoveryRow.last_used_at || null
        },
        usage: usageResult.rows.map((row) => ({
          provider: row.provider,
          model: row.model,
          eventType: row.event_type,
          inputTokens: Number(row.input_tokens || 0),
          outputTokens: Number(row.output_tokens || 0),
          totalTokens: Number(row.total_tokens || 0),
          webSearchCalls: Number(row.web_search_calls || 0),
          estimatedCostMicros: row.estimated_cost_micros === null
            ? null
            : Number(row.estimated_cost_micros),
          createdAt: row.created_at
        })),
        entitlementOverrides: overrideResult.rows.map((row) => ({
          key: row.entitlement_key,
          enabled: Boolean(row.enabled),
          reason: row.reason || null,
          expiresAt: row.expires_at || null,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }))
      });

      await writeSecurityEvent(
        pool,
        userId,
        "account.data_exported",
        null,
        { label: coarseDeviceLabel(req) }
      );

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${buildExportFilename()}"`
      );
      return res.send(JSON.stringify(exportPayload, null, 2));
    } catch (error) {
      console.error("UNBOUND AI DATA EXPORT ERROR:", error);
      return res.status(500).json({ error: "Could not build your UNBOUND AI data export." });
    }
  }
);

'''
one(
    server,
'''/* ------------------------- CONVERSATION HISTORY ------------------------ */
''',
export_block + '''/* ------------------------- CONVERSATION HISTORY ------------------------ */
''',
    'data export API'
)

# Account Access becomes the home for the privacy-safe download action.
one(
    index,
'''        <div class="access-section-title">Capabilities</div>
        <div id="accessCapabilityList" class="capability-list"></div>
''',
'''        <div class="access-section-title">Capabilities</div>
        <div id="accessCapabilityList" class="capability-list"></div>
        <div class="access-section-title">Your data</div>
        <button id="dataExportButton" class="auth-submit secondary" type="button">DOWNLOAD MY DATA</button>
        <p class="auth-note">Downloads a JSON copy of your account data and conversation history. Authentication secrets are excluded.</p>
''',
    'data export button'
)

one(
    index,
'''    const accessCapabilityList = document.getElementById("accessCapabilityList");
''',
'''    const accessCapabilityList = document.getElementById("accessCapabilityList");
    const dataExportButton = document.getElementById("dataExportButton");
''',
    'data export DOM ref'
)

export_handler = r'''
    async function handleDataExport() {
      if (!currentUser || dataExportButton.disabled) return;
      dataExportButton.disabled = true;
      dataExportButton.textContent = "BUILDING EXPORT...";
      try {
        const response = await fetch("/api/account/export", {
          method: "GET",
          credentials: "same-origin",
          headers: { "Accept": "application/json" }
        });
        if (!response.ok) {
          const data = await readJson(response);
          throw new Error(data.error || "Could not download your data.");
        }

        const blob = await response.blob();
        const disposition = response.headers.get("Content-Disposition") || "";
        const match = disposition.match(/filename="?([^";]+)"?/i);
        const filename = match?.[1] || "unbound-ai-data.json";
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast("Your UNBOUND AI data export is ready.");
      } catch (error) {
        accessFeedback.className = "auth-feedback visible error";
        accessFeedback.textContent = error.message || "Could not download your data.";
      } finally {
        dataExportButton.disabled = false;
        dataExportButton.textContent = "DOWNLOAD MY DATA";
      }
    }

'''
one(
    index,
'''    async function openAccess() {
''',
export_handler + '''    async function openAccess() {
''',
    'data export browser handler'
)

one(
    index,
'''    accessButton.addEventListener("click", openAccess);
''',
'''    accessButton.addEventListener("click", openAccess);
    dataExportButton.addEventListener("click", handleDataExport);
''',
    'data export click listener'
)

one(
    index,
'''        "recovery.code_used": "Account recovered with recovery code"
''',
'''        "recovery.code_used": "Account recovered with recovery code",
        "account.data_exported": "Account data exported"
''',
    'data export security label'
)

print('Applied UNBOUND AI v0.24 privacy-safe account data export.')
