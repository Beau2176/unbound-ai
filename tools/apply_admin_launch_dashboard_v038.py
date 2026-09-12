from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


path = Path("app/admin.html")
text = path.read_text()

text = replace_once(
    text,
    '''    .badge.gold {
      border-color: rgba(255,173,67,0.40);
      background: rgba(255,173,67,0.10);
      color: #ffd297;
    }

    .row-actions {
''',
    '''    .badge.gold {
      border-color: rgba(255,173,67,0.40);
      background: rgba(255,173,67,0.10);
      color: #ffd297;
    }

    .badge.danger {
      border-color: rgba(255,118,118,0.44);
      background: rgba(255,118,118,0.11);
      color: #ffd4d4;
    }

    .launch-status-value {
      font-size: 24px !important;
      letter-spacing: 0.04em;
    }

    .launch-status-value.ready { color: var(--success); }
    .launch-status-value.blocked { color: var(--danger); }

    .launch-detail {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
      max-width: 560px;
    }

    .row-actions {
''',
    "launch dashboard css",
)

text = replace_once(
    text,
    '''    <section class="stats" id="stats">
      <div class="card stat"><div class="label">Users</div><div class="value" id="statUsers">—</div></div>
      <div class="card stat"><div class="label">Top Tier</div><div class="value" id="statTop">—</div></div>
      <div class="card stat"><div class="label">Gift Slots Used</div><div class="value" id="statUsed">—</div></div>
      <div class="card stat"><div class="label">Gift Slots Open</div><div class="value" id="statOpen">—</div></div>
    </section>

    <section class="card section">
''',
    '''    <section class="stats" id="stats">
      <div class="card stat"><div class="label">Users</div><div class="value" id="statUsers">—</div></div>
      <div class="card stat"><div class="label">Top Tier</div><div class="value" id="statTop">—</div></div>
      <div class="card stat"><div class="label">Gift Slots Used</div><div class="value" id="statUsed">—</div></div>
      <div class="card stat"><div class="label">Gift Slots Open</div><div class="value" id="statOpen">—</div></div>
    </section>

    <section class="card section" id="launchReadinessSection">
      <div class="section-head">
        <div>
          <h2>Commercial Launch Readiness</h2>
          <p>Strict engineering gate for the commercial adults-only launch. A blocker must be fixed at its source; this dashboard cannot override it.</p>
        </div>
        <button class="btn" id="refreshLaunchReadiness" type="button">Refresh Launch Gate</button>
      </div>

      <section class="stats">
        <div class="card stat"><div class="label">Launch Status</div><div class="value launch-status-value" id="launchStatus">—</div></div>
        <div class="card stat"><div class="label">Blockers</div><div class="value" id="launchBlockers">—</div></div>
        <div class="card stat"><div class="label">Checks Passing</div><div class="value" id="launchPassing">—</div></div>
        <div class="card stat"><div class="label">Profile</div><div class="value launch-status-value" id="launchProfile">—</div></div>
      </section>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Launch Check</th>
              <th>State</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody id="launchReadinessBody">
            <tr><td colspan="3" class="loading">Loading commercial launch gate…</td></tr>
          </tbody>
        </table>
      </div>
      <div class="feedback" id="launchReadinessFeedback"></div>
    </section>

    <section class="card section">
''',
    "launch dashboard markup",
)

text = replace_once(
    text,
    '''    const statUsed = document.getElementById("statUsed");
    const statOpen = document.getElementById("statOpen");
    const giftForm = document.getElementById("giftForm");
''',
    '''    const statUsed = document.getElementById("statUsed");
    const statOpen = document.getElementById("statOpen");
    const refreshLaunchReadiness = document.getElementById("refreshLaunchReadiness");
    const launchStatus = document.getElementById("launchStatus");
    const launchBlockers = document.getElementById("launchBlockers");
    const launchPassing = document.getElementById("launchPassing");
    const launchProfile = document.getElementById("launchProfile");
    const launchReadinessBody = document.getElementById("launchReadinessBody");
    const launchReadinessFeedback = document.getElementById("launchReadinessFeedback");
    const giftForm = document.getElementById("giftForm");
''',
    "launch dashboard dom refs",
)

text = replace_once(
    text,
    '''    let dashboard = null;
    let auditEvents = [];
''',
    '''    let dashboard = null;
    let launchReadiness = null;
    let auditEvents = [];
''',
    "launch dashboard state",
)

text = replace_once(
    text,
    '''    function formatMicrosUsd(value, priced) {
''',
    '''    function renderLaunchReadiness() {
      if (!launchReadiness) return;

      const checks = Array.isArray(launchReadiness.checks) ? launchReadiness.checks : [];
      const passing = checks.filter((check) => check.ready).length;
      const ready = launchReadiness.launchReady === true;

      launchStatus.textContent = ready ? "READY" : "BLOCKED";
      launchStatus.classList.toggle("ready", ready);
      launchStatus.classList.toggle("blocked", !ready);
      launchBlockers.textContent = String(Number(launchReadiness.blockerCount || 0));
      launchPassing.textContent = `${passing}/${checks.length}`;
      launchProfile.textContent = String(launchReadiness.profile || "commercial_adult")
        .replaceAll("_", " ")
        .toUpperCase();

      if (!checks.length) {
        launchReadinessBody.innerHTML = '<tr><td colspan="3" class="loading">No launch checks were returned.</td></tr>';
      } else {
        launchReadinessBody.innerHTML = checks.map((check) => `
          <tr>
            <td><strong>${escapeHtml(check.label || check.key)}</strong><div class="source-text">${escapeHtml(check.key)}</div></td>
            <td><span class="badge ${check.ready ? "gold" : "danger"}">${check.ready ? "READY" : "BLOCKER"}</span></td>
            <td><div class="launch-detail">${escapeHtml(check.detail || "No detail returned.")}</div></td>
          </tr>
        `).join("");
      }

      const message = ready
        ? "Every encoded engineering launch check is currently passing. Professional legal, security, accessibility, and compliance review may still be required."
        : `${Number(launchReadiness.blockerCount || 0)} launch blocker(s) remain. Fix the underlying dependency; do not bypass this gate.`;
      setFeedback(launchReadinessFeedback, message, ready ? "ok" : "error");
    }

    async function loadLaunchReadiness() {
      refreshLaunchReadiness.disabled = true;
      try {
        const result = await api("/api/admin/ops/launch-readiness");
        launchReadiness = result.launch || null;
        if (!launchReadiness) throw new Error("Launch-readiness response was empty.");
        renderLaunchReadiness();
      } catch (error) {
        launchReadiness = null;
        launchStatus.textContent = "UNKNOWN";
        launchStatus.classList.remove("ready");
        launchStatus.classList.add("blocked");
        launchBlockers.textContent = "—";
        launchPassing.textContent = "—";
        launchProfile.textContent = "—";
        launchReadinessBody.innerHTML = `<tr><td colspan="3" class="loading">${escapeHtml(error.message)}</td></tr>`;
        setFeedback(launchReadinessFeedback, error.message, "error");
      } finally {
        refreshLaunchReadiness.disabled = false;
      }
    }

    function formatMicrosUsd(value, priced) {
''',
    "launch dashboard functions",
)

text = replace_once(
    text,
    '''        await Promise.all([loadUsage(), loadAudit(), loadBilling(), loadAgeVerification(), loadSecurityOperations(), loadAbuseProtection()]);
''',
    '''        await Promise.all([loadLaunchReadiness(), loadUsage(), loadAudit(), loadBilling(), loadAgeVerification(), loadSecurityOperations(), loadAbuseProtection()]);
''',
    "launch dashboard initial load",
)

text = replace_once(
    text,
    '''    refreshAudit.addEventListener("click", loadAudit);
''',
    '''    refreshLaunchReadiness.addEventListener("click", loadLaunchReadiness);
    refreshAudit.addEventListener("click", loadAudit);
''',
    "launch dashboard refresh listener",
)

path.write_text(text)
print("Applied admin launch dashboard v0.38 migration.")
