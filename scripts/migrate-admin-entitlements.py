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

# ----- server imports -----
server = one(
    server,
    '''const {\n  normalizePlanTier,\n  getPlanDefinition,\n  buildCapabilityAccess\n} = require("./access/entitlements");''',
    '''const {\n  CAPABILITY_CATALOG,\n  normalizePlanTier,\n  getPlanDefinition,\n  isKnownCapability,\n  buildCapabilityAccess\n} = require("./access/entitlements");''',
    'entitlement imports'
)

# ----- admin entitlement API -----
api_block = r'''
app.get(
  "/api/admin/entitlements/catalog",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    return res.json({
      capabilities: Object.entries(CAPABILITY_CATALOG).map(([key, item]) => ({
        key,
        label: item.label,
        description: item.description,
        implemented: Boolean(item.implemented),
        minimumPlan: normalizePlanTier(item.minimumPlan)
      }))
    });
  }
);

async function loadAdminTargetUser(userId, client = pool) {
  const result = await client.query(
    `SELECT
       u.id,
       u.email,
       u.display_name,
       u.role,
       u.plan_tier,
       u.created_at,
       EXISTS (
         SELECT 1
         FROM complimentary_top_tier_grants g
         WHERE g.user_id = u.id
       ) AS complimentary_top_tier
     FROM users u
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

function publicEntitlementOverride(row) {
  return {
    key: row.entitlement_key,
    enabled: Boolean(row.enabled),
    reason: row.reason || null,
    expiresAt: row.expires_at || null,
    createdByAdminUserId:
      row.created_by_admin_user_id === null
        ? null
        : String(row.created_by_admin_user_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function loadAdminUserAccessPayload(userId) {
  const user = await loadAdminTargetUser(userId);
  if (!user) return null;

  const [access, overrideResult] = await Promise.all([
    buildAccountAccess(user),
    pool.query(
      `SELECT
         entitlement_key,
         enabled,
         reason,
         expires_at,
         created_by_admin_user_id,
         created_at,
         updated_at
       FROM account_entitlement_overrides
       WHERE user_id = $1
       ORDER BY entitlement_key`,
      [user.id]
    )
  ]);

  return {
    user: publicUser(user),
    access,
    overrides: overrideResult.rows.map(publicEntitlementOverride)
  };
}

app.get(
  "/api/admin/users/:id/access",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const userId = String(req.params.id || "").trim();
      if (!/^\d+$/.test(userId)) {
        return res.status(400).json({ error: "Invalid user ID." });
      }

      const payload = await loadAdminUserAccessPayload(userId);
      if (!payload) {
        return res.status(404).json({ error: "User not found." });
      }
      return res.json(payload);
    } catch (error) {
      console.error("UNBOUND AI ADMIN ACCESS DETAIL ERROR:", error);
      return res.status(500).json({ error: "Could not load user access details." });
    }
  }
);

app.put(
  "/api/admin/users/:id/entitlements/:key",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    const userId = String(req.params.id || "").trim();
    const entitlementKey = String(req.params.key || "").trim();
    const enabled = req.body.enabled;
    const reason =
      typeof req.body.reason === "string" ? req.body.reason.trim().slice(0, 300) : "";
    const expiresAtRaw = req.body.expiresAt;

    if (!/^\d+$/.test(userId)) {
      return res.status(400).json({ error: "Invalid user ID." });
    }
    if (!isKnownCapability(entitlementKey)) {
      return res.status(400).json({ error: "Unknown capability." });
    }
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be true or false." });
    }

    let expiresAt = null;
    if (expiresAtRaw !== null && expiresAtRaw !== undefined && String(expiresAtRaw).trim()) {
      const parsed = new Date(expiresAtRaw);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: "Invalid expiration date." });
      }
      if (parsed.getTime() <= Date.now()) {
        return res.status(400).json({ error: "Expiration must be in the future." });
      }
      expiresAt = parsed.toISOString();
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const target = await loadAdminTargetUser(userId, client);
      if (!target) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "User not found." });
      }

      const previousResult = await client.query(
        `SELECT entitlement_key, enabled, reason, expires_at
         FROM account_entitlement_overrides
         WHERE user_id = $1 AND entitlement_key = $2
         LIMIT 1`,
        [userId, entitlementKey]
      );
      const previous = previousResult.rows[0] || null;

      await client.query(
        `INSERT INTO account_entitlement_overrides (
           user_id,
           entitlement_key,
           enabled,
           reason,
           expires_at,
           created_by_admin_user_id,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (user_id, entitlement_key)
         DO UPDATE SET
           enabled = EXCLUDED.enabled,
           reason = EXCLUDED.reason,
           expires_at = EXCLUDED.expires_at,
           created_by_admin_user_id = EXCLUDED.created_by_admin_user_id,
           updated_at = NOW()`,
        [
          userId,
          entitlementKey,
          enabled,
          reason || null,
          expiresAt,
          req.adminUser.id
        ]
      );

      await writeAdminAudit(
        client,
        req.adminUser,
        "user.entitlement_override.set",
        target,
        {
          entitlementKey,
          enabled,
          reason: reason || null,
          expiresAt,
          previous: previous
            ? {
                enabled: Boolean(previous.enabled),
                reason: previous.reason || null,
                expiresAt: previous.expires_at || null
              }
            : null
        }
      );

      await client.query("COMMIT");
      const payload = await loadAdminUserAccessPayload(userId);
      return res.json(payload);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("UNBOUND AI ADMIN ENTITLEMENT SET ERROR:", error);
      return res.status(500).json({ error: "Could not save capability override." });
    } finally {
      client.release();
    }
  }
);

app.delete(
  "/api/admin/users/:id/entitlements/:key",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    const userId = String(req.params.id || "").trim();
    const entitlementKey = String(req.params.key || "").trim();

    if (!/^\d+$/.test(userId)) {
      return res.status(400).json({ error: "Invalid user ID." });
    }
    if (!isKnownCapability(entitlementKey)) {
      return res.status(400).json({ error: "Unknown capability." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const target = await loadAdminTargetUser(userId, client);
      if (!target) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "User not found." });
      }

      const deleted = await client.query(
        `DELETE FROM account_entitlement_overrides
         WHERE user_id = $1 AND entitlement_key = $2
         RETURNING entitlement_key, enabled, reason, expires_at`,
        [userId, entitlementKey]
      );

      if (deleted.rows[0]) {
        await writeAdminAudit(
          client,
          req.adminUser,
          "user.entitlement_override.cleared",
          target,
          {
            entitlementKey,
            previous: {
              enabled: Boolean(deleted.rows[0].enabled),
              reason: deleted.rows[0].reason || null,
              expiresAt: deleted.rows[0].expires_at || null
            }
          }
        );
      }

      await client.query("COMMIT");
      const payload = await loadAdminUserAccessPayload(userId);
      return res.json({
        cleared: Boolean(deleted.rows[0]),
        ...payload
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("UNBOUND AI ADMIN ENTITLEMENT CLEAR ERROR:", error);
      return res.status(500).json({ error: "Could not clear capability override." });
    } finally {
      client.release();
    }
  }
);

'''
server = one(server, '/* ----------------------------- ADMIN API ----------------------------- */', '/* ----------------------------- ADMIN API ----------------------------- */\n\n' + api_block, 'admin entitlement API')

# ----- admin UI styles -----
styles = r'''

    .entitlement-form {
      display: grid;
      grid-template-columns: minmax(170px, 1.2fr) minmax(180px, 1.2fr) 120px minmax(160px, 1fr) minmax(180px, 1fr) auto;
      gap: 8px;
      align-items: end;
      margin-bottom: 14px;
    }

    .entitlement-field label {
      display: block;
      margin-bottom: 5px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .06em;
      text-transform: uppercase;
    }

    .entitlement-note {
      color: var(--muted);
      font-size: 12px;
      margin: -4px 0 12px;
    }

    .source-text {
      color: var(--muted);
      font-size: 11px;
    }

    @media (max-width: 1000px) {
      .entitlement-form { grid-template-columns: 1fr 1fr; }
    }

    @media (max-width: 620px) {
      .entitlement-form { grid-template-columns: 1fr; }
    }
'''
admin = one(admin, '    .feedback {', styles + '\n    .feedback {', 'entitlement styles')

# ----- admin UI markup -----
section = r'''

    <section class="card section">
      <div class="section-head">
        <div>
          <h2>Capability Overrides</h2>
          <p>Grant or block one capability without changing the user’s entire plan. Clear an override to return to normal plan rules.</p>
        </div>
        <button class="btn" id="refreshEntitlements" type="button">Refresh Access</button>
      </div>

      <div class="entitlement-form">
        <div class="entitlement-field">
          <label for="entitlementUser">User</label>
          <select id="entitlementUser"></select>
        </div>
        <div class="entitlement-field">
          <label for="entitlementCapability">Capability</label>
          <select id="entitlementCapability"></select>
        </div>
        <div class="entitlement-field">
          <label for="entitlementEnabled">Override</label>
          <select id="entitlementEnabled">
            <option value="true">ENABLE</option>
            <option value="false">DISABLE</option>
          </select>
        </div>
        <div class="entitlement-field">
          <label for="entitlementExpiry">Expires (optional)</label>
          <input id="entitlementExpiry" type="datetime-local" />
        </div>
        <div class="entitlement-field">
          <label for="entitlementReason">Reason (optional)</label>
          <input id="entitlementReason" maxlength="300" placeholder="Why this override exists" />
        </div>
        <button class="btn gold" id="applyEntitlement" type="button">Apply Override</button>
      </div>

      <div id="entitlementUserSummary" class="entitlement-note">Select a user to inspect effective access.</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Capability</th>
              <th>Minimum Plan</th>
              <th>Available</th>
              <th>Entitled</th>
              <th>Usable</th>
              <th>Source / Override</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="entitlementBody">
            <tr><td colspan="7" class="loading">Loading capabilities…</td></tr>
          </tbody>
        </table>
      </div>
      <div class="feedback" id="entitlementFeedback"></div>
    </section>
'''
admin = one(admin, '    <section class="card section">\n      <div class="section-head">\n        <div>\n          <h2>Usage & Cost Metering</h2>', section + '\n\n    <section class="card section">\n      <div class="section-head">\n        <div>\n          <h2>Usage & Cost Metering</h2>', 'entitlement section')

# ----- DOM refs/state -----
admin = one(
    admin,
    '    const usageFeedback = document.getElementById("usageFeedback");',
    '    const usageFeedback = document.getElementById("usageFeedback");\n    const entitlementUser = document.getElementById("entitlementUser");\n    const entitlementCapability = document.getElementById("entitlementCapability");\n    const entitlementEnabled = document.getElementById("entitlementEnabled");\n    const entitlementExpiry = document.getElementById("entitlementExpiry");\n    const entitlementReason = document.getElementById("entitlementReason");\n    const applyEntitlement = document.getElementById("applyEntitlement");\n    const refreshEntitlements = document.getElementById("refreshEntitlements");\n    const entitlementUserSummary = document.getElementById("entitlementUserSummary");\n    const entitlementBody = document.getElementById("entitlementBody");\n    const entitlementFeedback = document.getElementById("entitlementFeedback");',
    'entitlement DOM refs'
)
admin = one(
    admin,
    '    let usageSummary = null;',
    '    let usageSummary = null;\n    let entitlementCatalog = [];\n    let selectedUserAccess = null;',
    'entitlement state'
)

# ----- audit labels/details -----
admin = one(
    admin,
    '        "complimentary_top_tier.revoked": "Gift TOP revoked"',
    '        "complimentary_top_tier.revoked": "Gift TOP revoked",\n        "user.entitlement_override.set": "Capability override set",\n        "user.entitlement_override.cleared": "Capability override cleared"',
    'audit labels'
)
admin = one(
    admin,
    '      if (details.resultingPlanTier) {\n        parts.push(`result: ${details.resultingPlanTier}`);\n      }',
    '      if (details.resultingPlanTier) {\n        parts.push(`result: ${details.resultingPlanTier}`);\n      }\n      if (details.entitlementKey) parts.push(`capability: ${details.entitlementKey}`);\n      if (typeof details.enabled === "boolean") parts.push(details.enabled ? "enabled" : "disabled");\n      if (details.expiresAt) parts.push(`expires: ${formatDateTime(details.expiresAt)}`);\n      if (details.reason) parts.push(`reason: ${details.reason}`);',
    'audit entitlement details'
)

# ----- entitlement JS -----
js = r'''
    async function loadEntitlementCatalog() {
      if (entitlementCatalog.length) return entitlementCatalog;
      const result = await api("/api/admin/entitlements/catalog");
      entitlementCatalog = Array.isArray(result.capabilities) ? result.capabilities : [];
      entitlementCapability.innerHTML = entitlementCatalog.map((item) =>
        `<option value="${escapeHtml(item.key)}">${escapeHtml(item.label)} (${escapeHtml(String(item.minimumPlan || "free").toUpperCase())})</option>`
      ).join("");
      return entitlementCatalog;
    }

    function renderEntitlementUsers() {
      if (!dashboard) return;
      const previous = entitlementUser.value;
      entitlementUser.innerHTML = dashboard.users.map((user) =>
        `<option value="${escapeHtml(user.id)}">${escapeHtml(user.displayName || "UNBOUND User")} — ${escapeHtml(user.email)}</option>`
      ).join("");
      if (previous && dashboard.users.some((user) => String(user.id) === previous)) {
        entitlementUser.value = previous;
      }
    }

    function overrideMap() {
      return new Map((selectedUserAccess?.overrides || []).map((item) => [item.key, item]));
    }

    function statusBadge(value, yesLabel, noLabel) {
      return `<span class="badge ${value ? "gold" : ""}">${escapeHtml(value ? yesLabel : noLabel)}</span>`;
    }

    function renderEntitlementAccess() {
      if (!selectedUserAccess?.access) {
        entitlementBody.innerHTML = '<tr><td colspan="7" class="loading">Select a user to inspect effective access.</td></tr>';
        entitlementUserSummary.textContent = "Select a user to inspect effective access.";
        return;
      }

      const user = selectedUserAccess.user;
      const access = selectedUserAccess.access;
      const overrides = overrideMap();
      entitlementUserSummary.textContent = `${user.displayName || user.email} · effective ${String(access.plan?.displayName || "FREE").toUpperCase()} · source: ${access.plan?.source || "default"}`;

      entitlementBody.innerHTML = (access.capabilities || []).map((capability) => {
        const override = overrides.get(capability.key);
        const source = override
          ? `${override.enabled ? "OVERRIDE ENABLE" : "OVERRIDE DISABLE"}${override.expiresAt ? ` · until ${formatDateTime(override.expiresAt)}` : ""}${override.reason ? ` · ${override.reason}` : ""}`
          : `PLAN · ${capability.source || "plan"}`;
        return `
          <tr>
            <td><strong>${escapeHtml(capability.label)}</strong><div class="source-text">${escapeHtml(capability.key)}</div></td>
            <td>${escapeHtml(String(capability.minimumPlan || "free").toUpperCase())}</td>
            <td>${statusBadge(capability.available, "LIVE", "COMING")}</td>
            <td>${statusBadge(capability.entitled, "YES", "NO")}</td>
            <td>${statusBadge(capability.usable, "YES", "NO")}</td>
            <td><span class="source-text">${escapeHtml(source)}</span></td>
            <td>${override ? `<button class="btn danger clear-entitlement" type="button" data-key="${escapeHtml(capability.key)}">Clear</button>` : "—"}</td>
          </tr>`;
      }).join("");

      document.querySelectorAll(".clear-entitlement").forEach((button) => {
        button.addEventListener("click", async () => {
          const userId = entitlementUser.value;
          const key = button.dataset.key;
          if (!userId || !key) return;
          button.disabled = true;
          setFeedback(entitlementFeedback, "Clearing override…");
          try {
            selectedUserAccess = await api(`/api/admin/users/${encodeURIComponent(userId)}/entitlements/${encodeURIComponent(key)}`, { method: "DELETE" });
            renderEntitlementAccess();
            setFeedback(entitlementFeedback, "Capability override cleared; plan rules apply again.", "ok");
            await loadAudit();
          } catch (error) {
            setFeedback(entitlementFeedback, error.message, "error");
          } finally {
            button.disabled = false;
          }
        });
      });
    }

    async function loadSelectedUserAccess() {
      const userId = entitlementUser.value;
      if (!userId) {
        selectedUserAccess = null;
        renderEntitlementAccess();
        return;
      }
      entitlementBody.innerHTML = '<tr><td colspan="7" class="loading">Loading effective access…</td></tr>';
      try {
        selectedUserAccess = await api(`/api/admin/users/${encodeURIComponent(userId)}/access`);
        renderEntitlementAccess();
        setFeedback(entitlementFeedback, "Effective access loaded.", "ok");
      } catch (error) {
        selectedUserAccess = null;
        renderEntitlementAccess();
        setFeedback(entitlementFeedback, error.message, "error");
      }
    }

    async function initializeEntitlements() {
      await loadEntitlementCatalog();
      renderEntitlementUsers();
      await loadSelectedUserAccess();
    }

    async function applyEntitlementOverride() {
      const userId = entitlementUser.value;
      const key = entitlementCapability.value;
      if (!userId || !key) return;

      let expiresAt = null;
      if (entitlementExpiry.value) {
        const parsed = new Date(entitlementExpiry.value);
        if (Number.isNaN(parsed.getTime())) {
          setFeedback(entitlementFeedback, "Enter a valid expiration date.", "error");
          return;
        }
        expiresAt = parsed.toISOString();
      }

      applyEntitlement.disabled = true;
      setFeedback(entitlementFeedback, "Saving capability override…");
      try {
        selectedUserAccess = await api(`/api/admin/users/${encodeURIComponent(userId)}/entitlements/${encodeURIComponent(key)}`, {
          method: "PUT",
          body: JSON.stringify({
            enabled: entitlementEnabled.value === "true",
            reason: entitlementReason.value.trim(),
            expiresAt
          })
        });
        entitlementReason.value = "";
        entitlementExpiry.value = "";
        renderEntitlementAccess();
        setFeedback(entitlementFeedback, "Capability override saved and audited.", "ok");
        await loadAudit();
      } catch (error) {
        setFeedback(entitlementFeedback, error.message, "error");
      } finally {
        applyEntitlement.disabled = false;
      }
    }

'''
admin = one(admin, '    function renderStats() {', js + '    function renderStats() {', 'entitlement JS')

# Keep user selector in sync when dashboard loads.
admin = one(
    admin,
    '        renderStats();\n        renderGiftSlots();\n        renderUsers();\n        await Promise.all([loadUsage(), loadAudit()]);',
    '        renderStats();\n        renderGiftSlots();\n        renderUsers();\n        await Promise.all([loadUsage(), loadAudit()]);\n        await initializeEntitlements();',
    'dashboard entitlement init'
)

# events
admin = one(
    admin,
    '    search.addEventListener("input", () => {\n      if (dashboard) renderUsers();\n    });',
    '    search.addEventListener("input", () => {\n      if (dashboard) renderUsers();\n    });\n\n    entitlementUser.addEventListener("change", loadSelectedUserAccess);\n    applyEntitlement.addEventListener("click", applyEntitlementOverride);\n    refreshEntitlements.addEventListener("click", loadSelectedUserAccess);',
    'entitlement events'
)

server_path.write_text(server)
admin_path.write_text(admin)
print('Admin entitlement controls migration applied.')
