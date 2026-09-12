from pathlib import Path

path = Path('app/admin.html')
admin = path.read_text()


def one(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    return source.replace(old, new, 1)

section = r'''

    <section class="card section">
      <div class="section-head">
        <div>
          <h2>Abuse Protection</h2>
          <p>PostgreSQL-backed request ceilings for login, registration, chat, research, and sensitive account actions. Raw IP addresses are not stored.</p>
        </div>
        <button class="btn" id="refreshAbuseProtection" type="button">Refresh Limits</button>
      </div>

      <section class="stats">
        <div class="card stat"><div class="label">Blocks 24h</div><div class="value" id="rateBlocks24h">—</div></div>
        <div class="card stat"><div class="label">Active Buckets 24h</div><div class="value" id="rateBuckets24h">—</div></div>
        <div class="card stat"><div class="label">Counter Store</div><div class="value" id="rateStorage">—</div></div>
        <div class="card stat"><div class="label">Raw IP Stored</div><div class="value" id="rateRawIp">—</div></div>
      </section>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Scope</th>
              <th>Subject</th>
              <th>Active Buckets</th>
              <th>Blocks 24h</th>
            </tr>
          </thead>
          <tbody id="rateLimitBody">
            <tr><td colspan="4" class="loading">Loading abuse-protection status…</td></tr>
          </tbody>
        </table>
      </div>
      <div class="feedback" id="rateLimitFeedback"></div>
    </section>
'''
admin = one(
    admin,
    '''    <section class="card section">\n      <div class="section-head">\n        <div>\n          <h2>Security Operations</h2>''',
    section + '''\n\n    <section class="card section">\n      <div class="section-head">\n        <div>\n          <h2>Security Operations</h2>''',
    'abuse protection section'
)

admin = one(
    admin,
    '''    const securityOperationsFeedback = document.getElementById("securityOperationsFeedback");''',
    '''    const securityOperationsFeedback = document.getElementById("securityOperationsFeedback");\n    const refreshAbuseProtection = document.getElementById("refreshAbuseProtection");\n    const rateBlocks24h = document.getElementById("rateBlocks24h");\n    const rateBuckets24h = document.getElementById("rateBuckets24h");\n    const rateStorage = document.getElementById("rateStorage");\n    const rateRawIp = document.getElementById("rateRawIp");\n    const rateLimitBody = document.getElementById("rateLimitBody");\n    const rateLimitFeedback = document.getElementById("rateLimitFeedback");''',
    'abuse protection refs'
)

admin = one(
    admin,
    '''    let securityOperationsSummary = null;''',
    '''    let securityOperationsSummary = null;\n    let rateLimitSummary = null;''',
    'abuse protection state'
)

js = r'''

    function renderAbuseProtection() {
      if (!rateLimitSummary) return;
      const totals = rateLimitSummary.totals || {};
      const status = rateLimitSummary.status || {};
      rateBlocks24h.textContent = formatInteger(totals.blocks24h);
      rateBuckets24h.textContent = formatInteger(totals.activeBuckets24h);
      rateStorage.textContent = status.storage === "postgresql" ? "DB" : String(status.storage || "—").toUpperCase();
      rateRawIp.textContent = status.rawIpStored ? "YES" : "NO";

      const bucketMap = new Map();
      for (const item of rateLimitSummary.activeBuckets || []) {
        bucketMap.set(`${item.scope}|${item.subjectKind}`, Number(item.buckets || 0));
      }
      const blockMap = new Map();
      for (const item of rateLimitSummary.blocks || []) {
        blockMap.set(`${item.scope}|${item.subjectKind}`, Number(item.blocks || 0));
      }
      const keys = [...new Set([...bucketMap.keys(), ...blockMap.keys()])].sort();

      if (!keys.length) {
        rateLimitBody.innerHTML = '<tr><td colspan="4" class="loading">No rate-limit activity in the last 24 hours yet.</td></tr>';
      } else {
        rateLimitBody.innerHTML = keys.map((key) => {
          const [scope, subjectKind] = key.split("|");
          return `
            <tr>
              <td><strong>${escapeHtml(scope)}</strong></td>
              <td>${escapeHtml(subjectKind)}</td>
              <td>${escapeHtml(formatInteger(bucketMap.get(key) || 0))}</td>
              <td>${escapeHtml(formatInteger(blockMap.get(key) || 0))}</td>
            </tr>
          `;
        }).join("");
      }

      const policy = status.policy || {};
      const policyText = Object.values(policy)
        .map((item) => `${item.scope}: ${item.limit}/${Math.round(item.windowSeconds / 60)}m`)
        .join(" · ");
      setFeedback(
        rateLimitFeedback,
        `Safety ceilings are environment-configurable and are not commercial plan quotas.${policyText ? ` ${policyText}` : ""}`,
        "ok"
      );
    }

    async function loadAbuseProtection() {
      try {
        rateLimitSummary = await api("/api/admin/rate-limits/summary");
        renderAbuseProtection();
      } catch (error) {
        rateLimitBody.innerHTML = `<tr><td colspan="4" class="loading">${escapeHtml(error.message)}</td></tr>`;
        setFeedback(rateLimitFeedback, error.message, "error");
      }
    }
'''
admin = one(
    admin,
    '''    function renderSecurityOperations() {''',
    js + '''\n    function renderSecurityOperations() {''',
    'abuse protection JS'
)

admin = one(
    admin,
    '''        await Promise.all([loadUsage(), loadAudit(), loadBilling(), loadAgeVerification(), loadSecurityOperations()]);''',
    '''        await Promise.all([loadUsage(), loadAudit(), loadBilling(), loadAgeVerification(), loadSecurityOperations(), loadAbuseProtection()]);''',
    'abuse initial load'
)

admin = one(
    admin,
    '''    refreshSecurityOperations.addEventListener("click", loadSecurityOperations);''',
    '''    refreshSecurityOperations.addEventListener("click", loadSecurityOperations);\n    refreshAbuseProtection.addEventListener("click", loadAbuseProtection);''',
    'abuse refresh listener'
)

path.write_text(admin)
print('Abuse-protection admin visibility applied.')
