from pathlib import Path


def one(path, old, new, label):
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    path.write_text(text.replace(old, new, 1))


server = Path("app/server.js")
index = Path("app/index.html")

# Never record acceptance for draft/unpublished policy documents. Publishing is opt-in
# through environment configuration and final non-draft versions + policy URLs.
one(
    server,
    '''      const documentType = normalizeLegalDocumentType(req.body?.documentType);
      const requestedVersion = String(req.body?.version || "").trim();
      const currentDocument = getLegalDocumentCatalog().find(
        (document) => document.type === documentType
      );

      if (!documentType || !currentDocument) {
''',
    '''      const documentType = normalizeLegalDocumentType(req.body?.documentType);
      const requestedVersion = String(req.body?.version || "").trim();
      const legalStatus = buildLegalConsentStatus();

      if (!legalStatus.acceptanceEnabled) {
        return res.status(503).json({
          error: "Legal acceptance is not enabled until final policy documents are published."
        });
      }

      const currentDocument = legalStatus.documents.find(
        (document) => document.type === documentType
      );

      if (!documentType || !currentDocument) {
''',
    "legal acceptance publication gate"
)

one(
    index,
    '''        <div class="access-section-title">Your data</div>
        <button id="dataExportButton" class="auth-submit secondary" type="button">DOWNLOAD MY DATA</button>
        <p class="auth-note">Downloads a JSON copy of your account data and conversation history. Authentication secrets are excluded.</p>
''',
    '''        <div class="access-section-title">Your data</div>
        <button id="dataExportButton" class="auth-submit secondary" type="button">DOWNLOAD MY DATA</button>
        <p class="auth-note">Downloads a JSON copy of your account data and conversation history. Authentication secrets are excluded.</p>
        <div class="access-section-title">Legal & privacy</div>
        <div id="legalPolicyStatus" class="capability-list">
          <div class="history-empty">Policy status loads when Account Access opens.</div>
        </div>
        <p class="auth-note">Draft policies cannot be accepted. Acceptance becomes available only after final policy versions and their published URLs are configured on the server.</p>
''',
    "legal policy account markup"
)

one(
    index,
    '''    const accessCapabilityList = document.getElementById("accessCapabilityList");
    const dataExportButton = document.getElementById("dataExportButton");
''',
    '''    const accessCapabilityList = document.getElementById("accessCapabilityList");
    const dataExportButton = document.getElementById("dataExportButton");
    const legalPolicyStatus = document.getElementById("legalPolicyStatus");
''',
    "legal policy DOM ref"
)

legal_browser = r'''
    function renderLegalPolicyStatus(status) {
      legalPolicyStatus.innerHTML = "";
      const policies = Array.isArray(status?.documents) ? status.documents : [];

      if (!policies.length) {
        legalPolicyStatus.innerHTML = '<div class="history-empty">Policy status is unavailable.</div>';
        return;
      }

      for (const policy of policies) {
        const item = document.createElement("div");
        item.className = "capability-item";

        const copy = document.createElement("div");
        const name = document.createElement("div");
        name.className = "capability-name";
        name.textContent = policy.label || policy.type || "Policy";

        const description = document.createElement("div");
        description.className = "capability-description";
        const acceptedAt = policy.acceptedAt ? formatHistoryDate(policy.acceptedAt) : "";
        description.textContent = policy.accepted
          ? `Version ${policy.version} • accepted ${acceptedAt || "previously"}`
          : `Version ${policy.version}`;
        copy.append(name, description);

        const actions = document.createElement("div");
        actions.className = "device-actions";

        const policyUrl = safeHttpUrl(policy.url) || (
          typeof policy.url === "string" && policy.url.startsWith("/")
            ? policy.url
            : null
        );
        if (policyUrl) {
          const link = document.createElement("a");
          link.className = "account-button";
          link.href = policyUrl;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "VIEW";
          actions.appendChild(link);
        }

        const badge = document.createElement("span");
        badge.className = "capability-badge";
        if (policy.accepted) {
          badge.classList.add("live");
          badge.textContent = "ACCEPTED";
        } else if (!status.acceptanceEnabled) {
          badge.classList.add("planned");
          badge.textContent = status.documentsPublished ? "NOT ENABLED" : "DRAFT";
        } else {
          const acceptButton = document.createElement("button");
          acceptButton.type = "button";
          acceptButton.className = "account-button primary";
          acceptButton.textContent = "ACCEPT";
          acceptButton.addEventListener("click", async () => {
            acceptButton.disabled = true;
            try {
              const response = await fetch("/api/account/legal/accept", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  documentType: policy.type,
                  version: policy.version
                })
              });
              const data = await readJson(response);
              if (!response.ok) throw new Error(data.error || "Could not record acceptance.");
              renderLegalPolicyStatus(data);
              showToast(`${policy.label || "Policy"} accepted.`);
            } catch (error) {
              accessFeedback.className = "auth-feedback visible error";
              accessFeedback.textContent = error.message || "Could not record acceptance.";
              acceptButton.disabled = false;
            }
          });
          actions.appendChild(acceptButton);
          badge.classList.add("locked");
          badge.textContent = "REVIEW";
        }
        actions.appendChild(badge);
        item.append(copy, actions);
        legalPolicyStatus.appendChild(item);
      }
    }

    async function loadLegalPolicyStatus() {
      legalPolicyStatus.innerHTML = '<div class="history-empty">Loading policy status…</div>';
      try {
        const response = await fetch("/api/account/legal", {
          method: "GET",
          credentials: "same-origin",
          headers: { "Accept": "application/json" }
        });
        const data = await readJson(response);
        if (!response.ok) throw new Error(data.error || "Could not load policy status.");
        renderLegalPolicyStatus(data);
        return data;
      } catch (error) {
        legalPolicyStatus.innerHTML = '<div class="history-empty">Policy status could not be loaded.</div>';
        console.warn("Could not load UNBOUND AI legal policy status:", error);
        return null;
      }
    }

'''

one(
    index,
    '''    async function handleDataExport() {
''',
    legal_browser + '''    async function handleDataExport() {
''',
    "legal policy browser functions"
)

one(
    index,
    '''      accessModal.hidden = false; document.body.classList.add("modal-open");
      await refreshAccountAccess({ silent: false });
''',
    '''      accessModal.hidden = false; document.body.classList.add("modal-open");
      await refreshAccountAccess({ silent: false });
      await loadLegalPolicyStatus();
''',
    "load legal policy when access opens"
)

print("Applied UNBOUND AI v0.27 legal policy UI and publication guard.")
