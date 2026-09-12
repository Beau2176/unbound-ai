from pathlib import Path

server_path = Path("app/server.js")
index_path = Path("app/index.html")
server = server_path.read_text()
index = index_path.read_text()


def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return source.replace(old, new, 1)

# ---------------- Server: enforce Research entitlement ----------------
research_guard_helper = r'''
async function assertRequestCapability(req, capabilityKey) {
  if (!databaseReady || !pool) {
    const error = new Error("Account access is temporarily unavailable.");
    error.statusCode = 503;
    throw error;
  }

  const user = await findSessionUser(req);
  if (!user) {
    const error = new Error("Sign in with an account that includes that capability.");
    error.statusCode = 401;
    throw error;
  }

  const access = await buildAccountAccess(user);
  const capability = access?.capabilities.find(
    (item) => item.key === capabilityKey
  );

  if (!capability || !capability.usable) {
    const error = new Error(
      capability?.entitled && !capability?.available
        ? "That capability is included in your access level but is not live yet."
        : "Your current access level does not include that capability."
    );
    error.statusCode = 403;
    error.capability = capability || null;
    throw error;
  }

  return { user, access, capability };
}

'''
server = replace_once(
    server,
    'async function requireSignedIn(req, res, next) {',
    research_guard_helper + 'async function requireSignedIn(req, res, next) {',
    "research capability helper",
)

research_check = r'''
    if (productMode === "research") {
      await assertRequestCapability(req, "web_research");
    }

'''
server = replace_once(
    server,
    '    if (productMode === "research" && !gatewayStatus.research) {\n      return res.status(503).json({\n        error: "The active AI provider does not support Research Mode yet."\n      });\n    }\n\n',
    '    if (productMode === "research" && !gatewayStatus.research) {\n      return res.status(503).json({\n        error: "The active AI provider does not support Research Mode yet."\n      });\n    }\n\n' + research_check,
    "research entitlement enforcement",
)

# ---------------- Browser CSS ----------------
access_css = r'''

    .product-button.locked {
      opacity: 0.56;
      border-style: dashed;
    }

    .access-card {
      width: min(680px, 100%);
    }

    .access-summary {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 16px;
    }

    .access-stat {
      padding: 12px;
      border: 1px solid rgba(107, 193, 255, 0.18);
      border-radius: 12px;
      background: rgba(8, 16, 29, 0.70);
    }

    .access-label {
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .access-value {
      margin-top: 5px;
      color: #ffffff;
      font-size: 15px;
      font-weight: 900;
      word-break: break-word;
    }

    .access-section-title {
      margin: 16px 0 8px;
      color: #dceeff;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }

    .capability-list {
      display: grid;
      gap: 8px;
    }

    .capability-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      padding: 10px 11px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 11px;
      background: rgba(255, 255, 255, 0.025);
    }

    .capability-name {
      color: #f3f9ff;
      font-size: 12px;
      font-weight: 850;
    }

    .capability-description {
      margin-top: 3px;
      color: var(--muted);
      font-size: 10px;
      line-height: 1.4;
    }

    .capability-badge {
      padding: 5px 7px;
      border-radius: 999px;
      font-size: 9px;
      font-weight: 900;
      letter-spacing: 0.06em;
      white-space: nowrap;
    }

    .capability-badge.live {
      border: 1px solid rgba(101, 232, 164, 0.30);
      background: rgba(19, 91, 59, 0.23);
      color: #b9f7d6;
    }

    .capability-badge.locked {
      border: 1px solid rgba(255, 173, 67, 0.30);
      background: rgba(255, 173, 67, 0.08);
      color: #ffd297;
    }

    .capability-badge.planned {
      border: 1px solid rgba(180, 132, 255, 0.28);
      background: rgba(139, 82, 230, 0.08);
      color: #d9c6ff;
    }

    @media (max-width: 560px) {
      .access-summary {
        grid-template-columns: 1fr;
      }
    }
'''
index = replace_once(
    index,
    '    .history-list {',
    access_css + '\n    .history-list {',
    "access CSS",
)

# ---------------- Browser markup ----------------
index = replace_once(
    index,
    '        <button id="adminButton" class="account-button primary" type="button" hidden>ADMIN</button>',
    '        <button id="accessButton" class="account-button" type="button">ACCESS</button>\n        <button id="adminButton" class="account-button primary" type="button" hidden>ADMIN</button>',
    "access button",
)

access_modal = r'''
  <div id="accessModal" class="auth-modal" hidden>
    <section class="auth-card access-card" role="dialog" aria-modal="true" aria-labelledby="accessTitle">
      <div class="auth-card-head">
        <div>
          <h2 id="accessTitle">Account Access</h2>
          <p>Your effective plan, subscription state, and UNBOUND AI capabilities.</p>
        </div>
        <button id="accessCloseButton" class="auth-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="auth-body">
        <div id="accessFeedback" class="auth-feedback" role="status" aria-live="polite"></div>
        <div class="access-summary">
          <div class="access-stat">
            <div class="access-label">Effective plan</div>
            <div id="accessPlan" class="access-value">—</div>
          </div>
          <div class="access-stat">
            <div class="access-label">Access source</div>
            <div id="accessPlanSource" class="access-value">—</div>
          </div>
          <div class="access-stat">
            <div class="access-label">Subscription</div>
            <div id="accessSubscription" class="access-value">—</div>
          </div>
          <div class="access-stat">
            <div class="access-label">Capabilities</div>
            <div id="accessCapabilitySummary" class="access-value">—</div>
          </div>
        </div>
        <div class="access-section-title">Capabilities</div>
        <div id="accessCapabilityList" class="capability-list"></div>
      </div>
    </section>
  </div>

'''
index = replace_once(
    index,
    '  <div id="historyModal" class="auth-modal" hidden>',
    access_modal + '  <div id="historyModal" class="auth-modal" hidden>',
    "access modal",
)

# ---------------- Browser JS references/state ----------------
index = replace_once(
    index,
    '    const historyFeedback = document.getElementById("historyFeedback");',
    '    const historyFeedback = document.getElementById("historyFeedback");\n    const accessButton = document.getElementById("accessButton");\n    const accessModal = document.getElementById("accessModal");\n    const accessCloseButton = document.getElementById("accessCloseButton");\n    const accessFeedback = document.getElementById("accessFeedback");\n    const accessPlan = document.getElementById("accessPlan");\n    const accessPlanSource = document.getElementById("accessPlanSource");\n    const accessSubscription = document.getElementById("accessSubscription");\n    const accessCapabilitySummary = document.getElementById("accessCapabilitySummary");\n    const accessCapabilityList = document.getElementById("accessCapabilityList");',
    "access DOM references",
)
index = replace_once(
    index,
    '    let currentUser = null;\n    let activeConversationId = null;',
    '    let currentUser = null;\n    let accountAccess = null;\n    let activeConversationId = null;',
    "account access state",
)

access_functions = r'''
    function capabilityAccess(key) {
      return accountAccess?.capabilities?.find((item) => item.key === key) || null;
    }

    function canUseCapability(key) {
      return Boolean(capabilityAccess(key)?.usable);
    }

    function accessSourceLabel(value) {
      const labels = {
        administrator: "Administrator",
        complimentary: "Complimentary TOP",
        subscription: "Subscription",
        manual: "Administrator-assigned",
        default: "Default account"
      };
      return labels[value] || String(value || "Unknown");
    }

    function subscriptionLabel(subscription) {
      if (!subscription?.connected) return "Not connected";
      const provider = String(subscription.provider || "Provider");
      const status = String(subscription.status || "unknown").replaceAll("_", " ");
      return `${provider} • ${status}`;
    }

    function renderAccessPanel() {
      if (!accountAccess) {
        accessPlan.textContent = "Unavailable";
        accessPlanSource.textContent = "—";
        accessSubscription.textContent = "—";
        accessCapabilitySummary.textContent = "—";
        accessCapabilityList.innerHTML = "";
        return;
      }

      accessPlan.textContent = accountAccess.plan?.displayName || "FREE";
      accessPlanSource.textContent = accessSourceLabel(accountAccess.plan?.source);
      accessSubscription.textContent = subscriptionLabel(accountAccess.subscription);
      accessCapabilitySummary.textContent = `${accountAccess.summary?.usable || 0} live / ${accountAccess.summary?.catalogSize || 0} tracked`;
      accessCapabilityList.innerHTML = "";

      for (const capability of accountAccess.capabilities || []) {
        const item = document.createElement("div");
        item.className = "capability-item";

        const copy = document.createElement("div");
        const name = document.createElement("div");
        name.className = "capability-name";
        name.textContent = capability.label || capability.key;
        const description = document.createElement("div");
        description.className = "capability-description";
        description.textContent = capability.description || "";
        copy.append(name, description);

        const badge = document.createElement("span");
        badge.className = "capability-badge";
        if (capability.usable) {
          badge.classList.add("live");
          badge.textContent = "LIVE";
        } else if (capability.available && !capability.entitled) {
          badge.classList.add("locked");
          badge.textContent = `${String(capability.minimumPlan || "top").toUpperCase()} ACCESS`;
        } else if (capability.entitled && !capability.available) {
          badge.classList.add("planned");
          badge.textContent = "INCLUDED • COMING";
        } else {
          badge.classList.add("planned");
          badge.textContent = "PLANNED";
        }

        item.append(copy, badge);
        accessCapabilityList.appendChild(item);
      }
    }

    async function refreshAccountAccess({ silent = false } = {}) {
      if (!currentUser) {
        accountAccess = null;
        renderAccessPanel();
        renderAccountUi();
        return null;
      }

      try {
        const response = await fetch("/api/account/access", {
          method: "GET",
          credentials: "same-origin",
          headers: { "Accept": "application/json" }
        });
        const data = await readJson(response);
        if (!response.ok) {
          throw new Error(data.error || "Could not load account access.");
        }
        accountAccess = data.access || null;
      } catch (error) {
        accountAccess = null;
        if (!silent) {
          accessFeedback.className = "auth-feedback visible error";
          accessFeedback.textContent = error.message || "Could not load account access.";
        }
      }

      renderAccessPanel();
      renderAccountUi();
      return accountAccess;
    }

    async function openAccess() {
      if (!currentUser) {
        showToast("Sign in to view account access.");
        openAuth("login");
        return;
      }
      accessFeedback.className = "auth-feedback";
      accessFeedback.textContent = "";
      accessModal.hidden = false;
      document.body.classList.add("modal-open");
      await refreshAccountAccess({ silent: false });
    }

    function closeAccess() {
      accessModal.hidden = true;
      if (historyModal.hidden && authModal.hidden) {
        document.body.classList.remove("modal-open");
      }
    }

    async function chooseResearchMode() {
      if (!currentUser) {
        showToast("Research Mode requires a signed-in TOP account.");
        openAuth("login");
        return;
      }

      if (!accountAccess) {
        await refreshAccountAccess({ silent: true });
      }

      if (!canUseCapability("web_research")) {
        showToast("Research Mode requires TOP access.");
        await openAccess();
        return;
      }

      setProductMode("research", { announce: true });
    }

'''
index = replace_once(
    index,
    '    function planLabelForUser(user) {',
    access_functions + '    function planLabelForUser(user) {',
    "access functions",
)

# Effective plan label + Research lock state in account rendering.
old_plan = r'''    function planLabelForUser(user) {
      if (!user) {
        return "FREE";
      }

      if (user.complimentaryTopTier) {
        return "COMPLIMENTARY TOP TIER";
      }

      return String(user.planTier || "free").replaceAll("_", " ").toUpperCase();
    }
'''
new_plan = r'''    function planLabelForUser(user) {
      if (!user) return "FREE";
      if (accountAccess?.plan?.displayName) {
        return String(accountAccess.plan.displayName).toUpperCase();
      }
      if (user.complimentaryTopTier) return "COMPLIMENTARY TOP TIER";
      return String(user.planTier || "free").replaceAll("_", " ").toUpperCase();
    }
'''
index = replace_once(index, old_plan, new_plan, "effective plan label")

index = replace_once(
    index,
    '        adminButton.hidden = currentUser.role !== "admin";\n        historyButton.hidden = false;',
    '        adminButton.hidden = currentUser.role !== "admin";\n        accessButton.hidden = false;\n        historyButton.hidden = false;\n        researchModeButton.classList.toggle("locked", !canUseCapability("web_research"));\n        researchModeButton.title = canUseCapability("web_research") ? "Research Mode" : "Research Mode requires TOP access";',
    "signed in access rendering",
)
index = replace_once(
    index,
    '      adminButton.hidden = true;\n      historyButton.hidden = true;',
    '      adminButton.hidden = true;\n      accessButton.hidden = true;\n      historyButton.hidden = true;\n      researchModeButton.classList.add("locked");\n      researchModeButton.title = "Research Mode requires a signed-in TOP account";',
    "signed out access rendering",
)

# Enforce a valid product mode after loading device preference.
index = replace_once(
    index,
    '      productMode = loadProductMode();\n      depthStyle = loadDepthStyle();',
    '      productMode = loadProductMode();\n      depthStyle = loadDepthStyle();\n      if (productMode === "research" && !canUseCapability("web_research")) {\n        productMode = "standard";\n        saveProductMode();\n      }',
    "saved product mode enforcement",
)

# Load access state with session and after login/register.
index = replace_once(
    index,
    '      renderAccountUi();\n    }\n\n    async function handleLogin(event) {',
    '      if (currentUser) {\n        await refreshAccountAccess({ silent: true });\n      } else {\n        accountAccess = null;\n        renderAccountUi();\n      }\n    }\n\n    async function handleLogin(event) {',
    "load current access",
)
index = index.replace(
    '        currentUser = data.user || null;\n        renderAccountUi();\n        closeAuth();',
    '        currentUser = data.user || null;\n        await refreshAccountAccess({ silent: true });\n        closeAuth();',
    2,
)
index = replace_once(
    index,
    '      currentUser = null;\n      renderAccountUi();',
    '      currentUser = null;\n      accountAccess = null;\n      renderAccountUi();',
    "logout access reset",
)

# Event handlers and modal close behavior.
index = replace_once(
    index,
    '    historyButton.addEventListener("click", openHistory);\n    historyCloseButton.addEventListener("click", closeHistory);',
    '    accessButton.addEventListener("click", openAccess);\n    accessCloseButton.addEventListener("click", closeAccess);\n    historyButton.addEventListener("click", openHistory);\n    historyCloseButton.addEventListener("click", closeHistory);',
    "access event listeners",
)
index = replace_once(
    index,
    '    researchModeButton.addEventListener("click", () =>\n      setProductMode("research", { announce: true })\n    );',
    '    researchModeButton.addEventListener("click", chooseResearchMode);',
    "research selection gate",
)
index = replace_once(
    index,
    '    historyModal.addEventListener("click", (event) => {\n      if (event.target === historyModal) {\n        closeHistory();\n      }\n    });',
    '    accessModal.addEventListener("click", (event) => {\n      if (event.target === accessModal) closeAccess();\n    });\n\n    historyModal.addEventListener("click", (event) => {\n      if (event.target === historyModal) {\n        closeHistory();\n      }\n    });',
    "access backdrop",
)
index = replace_once(
    index,
    '      if (!historyModal.hidden) {\n        closeHistory();\n        return;\n      }',
    '      if (!accessModal.hidden) {\n        closeAccess();\n        return;\n      }\n      if (!historyModal.hidden) {\n        closeHistory();\n        return;\n      }',
    "escape access modal",
)

server_path.write_text(server)
index_path.write_text(index)
print("Account Access UI and Research entitlement migration applied.")
