from pathlib import Path

path = Path('app/index.html')
text = path.read_text()


def one(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)


one(
'''        <div class="access-section-title">Recent security activity</div>
        <div id="securityEventList" class="security-event-list"><div class="history-empty">Loading security activity…</div></div>
''',
'''        <div class="access-section-title">Security alerts</div>
        <div class="auth-help">Important sign-in and device alerts stay here until you acknowledge them. A number beside the SECURITY button means unread alerts are waiting.</div>
        <div style="display:flex;justify-content:flex-end;margin:8px 0;">
          <button id="acknowledgeAllSecurityAlertsButton" class="account-button" type="button">MARK ALL READ</button>
        </div>
        <div id="securityAlertList" class="security-event-list"><div class="history-empty">Loading security alerts…</div></div>

        <div class="access-section-title">Recent security activity</div>
        <div id="securityEventList" class="security-event-list"><div class="history-empty">Loading security activity…</div></div>
''',
'security alert section'
)

one(
'''    const securityEventList = document.getElementById("securityEventList");
''',
'''    const securityEventList = document.getElementById("securityEventList");
    const securityAlertList = document.getElementById("securityAlertList");
    const acknowledgeAllSecurityAlertsButton = document.getElementById("acknowledgeAllSecurityAlertsButton");
''',
'security alert DOM refs'
)

one(
'''    let securityDevices = [];
    let securityEvents = [];
    let accountPasskeys = [];
''',
'''    let securityDevices = [];
    let securityEvents = [];
    let securityAlerts = [];
    let securityAlertUnread = 0;
    let accountPasskeys = [];
''',
'security alert UI state'
)

alert_functions = r'''    function updateSecurityAlertBadge(unread) {
      securityAlertUnread = Math.max(0, Number(unread || 0));
      securityButton.textContent = securityAlertUnread > 0
        ? `SECURITY (${securityAlertUnread})`
        : "SECURITY";
      securityButton.title = securityAlertUnread > 0
        ? `${securityAlertUnread} unread security alert(s)`
        : "Account Security";
    }

    function renderSecurityAlerts() {
      securityAlertList.innerHTML = "";
      acknowledgeAllSecurityAlertsButton.disabled = securityAlertUnread === 0;

      if (!securityAlerts.length) {
        securityAlertList.innerHTML = '<div class="history-empty">No security alerts have been recorded yet.</div>';
        return;
      }

      for (const alert of securityAlerts) {
        const row = document.createElement("div");
        row.className = "security-event-row";
        if (!alert.acknowledgedAt) {
          row.style.borderColor = alert.severity === "critical"
            ? "rgba(255,118,118,.65)"
            : "rgba(255,173,67,.50)";
          row.style.background = alert.severity === "critical"
            ? "rgba(120,24,32,.18)"
            : "rgba(255,173,67,.06)";
        }

        const head = document.createElement("div");
        head.className = "security-event-head";
        const name = document.createElement("div");
        name.className = "security-event-name";
        name.textContent = alert.title || "Security alert";
        const time = document.createElement("div");
        time.className = "security-event-time";
        const date = new Date(alert.createdAt);
        time.textContent = Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
        head.append(name, time);

        const detail = document.createElement("div");
        detail.className = "security-event-detail";
        detail.textContent = alert.message || "Review your account security.";
        row.append(head, detail);

        if (!alert.acknowledgedAt) {
          const action = document.createElement("button");
          action.type = "button";
          action.className = "account-button";
          action.textContent = "MARK READ";
          action.style.marginTop = "8px";
          action.addEventListener("click", async () => {
            action.disabled = true;
            try {
              const response = await fetch(`/api/account/security/alerts/${encodeURIComponent(alert.id)}/acknowledge`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: "{}"
              });
              const data = await readJson(response);
              if (!response.ok) throw new Error(data.error || "Could not acknowledge that security alert.");
              await loadSecurityAlerts();
            } catch (error) {
              showSecurityFeedback(error.message || "Could not acknowledge that security alert.");
              action.disabled = false;
            }
          });
          row.appendChild(action);
        }

        securityAlertList.appendChild(row);
      }
    }

    async function loadSecurityAlerts({ render = true, limit = 50 } = {}) {
      if (!currentUser) {
        securityAlerts = [];
        updateSecurityAlertBadge(0);
        if (render) renderSecurityAlerts();
        return;
      }
      const response = await fetch(`/api/account/security/alerts?limit=${encodeURIComponent(limit)}`, {
        method: "GET",
        credentials: "same-origin",
        headers: { "Accept": "application/json" }
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Could not load security alerts.");
      securityAlerts = Array.isArray(data.alerts) ? data.alerts : [];
      updateSecurityAlertBadge(data.unread || 0);
      if (render) renderSecurityAlerts();
    }

    async function refreshSecurityAlertBadge() {
      if (!currentUser) {
        updateSecurityAlertBadge(0);
        return;
      }
      await loadSecurityAlerts({ render: false, limit: 1 });
    }

    async function handleAcknowledgeAllSecurityAlerts() {
      if (!currentUser || securityAlertUnread === 0) return;
      acknowledgeAllSecurityAlertsButton.disabled = true;
      try {
        const response = await fetch("/api/account/security/alerts/acknowledge-all", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        });
        const data = await readJson(response);
        if (!response.ok) throw new Error(data.error || "Could not acknowledge security alerts.");
        await loadSecurityAlerts();
        showSecurityFeedback(`${Number(data.acknowledged || 0)} security alert(s) marked read.`, "success");
      } catch (error) {
        showSecurityFeedback(error.message || "Could not acknowledge security alerts.");
      } finally {
        acknowledgeAllSecurityAlertsButton.disabled = securityAlertUnread === 0;
      }
    }

'''
one(
'''    function renderSecurityEvents() {
''',
alert_functions + '''    function renderSecurityEvents() {
''',
'security alert browser functions'
)

one(
'''        loadSecurityEvents(),
        loadPasskeys(),
        loadRecoveryCodeStatus()
''',
'''        loadSecurityEvents(),
        loadSecurityAlerts(),
        loadPasskeys(),
        loadRecoveryCodeStatus()
''',
'load alerts in security panel'
)

one(
'''      securityDevices = [];
      securityEvents = [];
      accountPasskeys = [];
''',
'''      securityDevices = [];
      securityEvents = [];
      securityAlerts = [];
      securityAlertUnread = 0;
      updateSecurityAlertBadge(0);
      accountPasskeys = [];
''',
'clear alert state on security close'
)

one(
'''        securityButton.hidden = false;
        deleteAccountButton.hidden = currentUser.role === "admin";
''',
'''        securityButton.hidden = false;
        refreshSecurityAlertBadge().catch(() => {});
        deleteAccountButton.hidden = currentUser.role === "admin";
''',
'refresh alert badge when signed in'
)

one(
'''      securityButton.hidden = true;
      deleteAccountButton.hidden = true;
''',
'''      securityButton.hidden = true;
      updateSecurityAlertBadge(0);
      deleteAccountButton.hidden = true;
''',
'clear alert badge when signed out'
)

one(
'''    addPasskeyButton.addEventListener("click", handleAddPasskey);
''',
'''    addPasskeyButton.addEventListener("click", handleAddPasskey);
    acknowledgeAllSecurityAlertsButton.addEventListener("click", handleAcknowledgeAllSecurityAlerts);
''',
'alert acknowledge-all listener'
)

path.write_text(text)
print('Applied UNBOUND AI v0.18 security-alert UI migration.')
