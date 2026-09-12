const fs = require("fs");
const path = require("path");

const indexPath = path.resolve(__dirname, "..", "index.html");
let html = fs.readFileSync(indexPath, "utf8");

function replaceOnce(source, needle, replacement, label) {
  const count = source.split(needle).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one anchor, found ${count}`);
  }
  return source.replace(needle, replacement);
}

const summaryAnchor = `          <div class="access-stat"><div class="access-label">Hard 18+ verification</div><div id="accessAgeVerification" class="access-value">—</div></div>
        </div>
        <div class="access-section-title">Capabilities</div>`;
const summaryReplacement = `          <div class="access-stat"><div class="access-label">Hard 18+ verification</div><div id="accessAgeVerification" class="access-value">—</div></div>
        </div>
        <div id="ageVerificationActions" class="access-age-actions" hidden>
          <button id="ageVerificationStartButton" class="auth-submit secondary" type="button">VERIFY 18+</button>
          <div id="ageVerificationActionNote" class="history-empty" role="status" aria-live="polite"></div>
        </div>
        <div class="access-section-title">Capabilities</div>`;
html = replaceOnce(html, summaryAnchor, summaryReplacement, "age verification action markup");

const cssAnchor = `    .auth-feedback.visible {
      display: block;
    }`;
const cssReplacement = `    .auth-feedback.visible {
      display: block;
    }

    .access-age-actions {
      display: grid;
      gap: 9px;
      margin: 12px 0 18px;
    }

    .access-age-actions .history-empty {
      margin: 0;
      line-height: 1.45;
    }`;
html = replaceOnce(html, cssAnchor, cssReplacement, "age verification action styling");

const refsAnchor = `    const accessCapabilitySummary = document.getElementById("accessCapabilitySummary");
    const accessAgeVerification = document.getElementById("accessAgeVerification");
    const accessCapabilityList = document.getElementById("accessCapabilityList");`;
const refsReplacement = `    const accessCapabilitySummary = document.getElementById("accessCapabilitySummary");
    const accessAgeVerification = document.getElementById("accessAgeVerification");
    const ageVerificationActions = document.getElementById("ageVerificationActions");
    const ageVerificationStartButton = document.getElementById("ageVerificationStartButton");
    const ageVerificationActionNote = document.getElementById("ageVerificationActionNote");
    const accessCapabilityList = document.getElementById("accessCapabilityList");`;
html = replaceOnce(html, refsAnchor, refsReplacement, "age verification DOM refs");

const renderMissingAnchor = `        accessSubscription.textContent = "—";
        accessCapabilitySummary.textContent = "—";
        accessAgeVerification.textContent = "—";
        accessCapabilityList.innerHTML = "";`;
const renderMissingReplacement = `        accessSubscription.textContent = "—";
        accessCapabilitySummary.textContent = "—";
        accessAgeVerification.textContent = "—";
        ageVerificationActions.hidden = true;
        ageVerificationStartButton.hidden = true;
        ageVerificationStartButton.disabled = true;
        ageVerificationActionNote.textContent = "";
        accessCapabilityList.innerHTML = "";`;
html = replaceOnce(html, renderMissingAnchor, renderMissingReplacement, "empty access panel age state");

const renderStatusAnchor = `      accessAgeVerification.textContent = ageState.verified
        ? "VERIFIED 18+"
        : ageGateway.configured
          ? String(ageState.status || "unverified").replaceAll("_", " ").toUpperCase()
          : "PROVIDER NOT CONNECTED";
      accessCapabilityList.innerHTML = "";`;
const renderStatusReplacement = `      accessAgeVerification.textContent = ageState.verified
        ? "VERIFIED 18+"
        : ageGateway.configured
          ? String(ageState.status || "unverified").replaceAll("_", " ").toUpperCase()
          : "PROVIDER NOT CONNECTED";

      const verificationCanStart = Boolean(
        !ageState.verified &&
        ageGateway.configured &&
        ageGateway.startVerification
      );
      ageVerificationActions.hidden = Boolean(ageState.verified);
      ageVerificationStartButton.hidden = !verificationCanStart;
      ageVerificationStartButton.disabled = !verificationCanStart;
      ageVerificationStartButton.textContent = ageState.status === "pending"
        ? "START NEW 18+ VERIFICATION"
        : "VERIFY 18+";
      ageVerificationActionNote.textContent = ageState.verified
        ? ""
        : verificationCanStart
          ? ageState.status === "pending"
            ? "Verification is pending. If the previous provider session was closed or expired, you can start a new secure verification session."
            : "Verification is completed with the connected provider. UNBOUND stores only minimal verification status and a hashed provider reference, not raw ID images or biometric templates."
          : ageGateway.configured
            ? "The connected age-verification provider cannot start a verification session right now."
            : "Hard 18+ verification is not connected yet, so Adult Mode remains locked.";
      accessCapabilityList.innerHTML = "";`;
html = replaceOnce(html, renderStatusAnchor, renderStatusReplacement, "age verification render state");

const functionAnchor = `    function renderAccessPanel() {`;
const startFunction = `    async function startAgeVerification() {
      if (!currentUser) {
        showToast("Sign in before starting hard 18+ verification.");
        openAuth("login");
        return;
      }

      if (!accountAccess) {
        await refreshAccountAccess({ silent: true });
      }

      const gateway = accountAccess?.ageVerificationGateway || {};
      if (accountAccess?.ageVerification?.verified) {
        showToast("This account is already hard-verified 18+.");
        return;
      }
      if (!gateway.configured || !gateway.startVerification) {
        showToast("Hard 18+ verification is not available yet.");
        await openAccess();
        return;
      }

      ageVerificationStartButton.disabled = true;
      const previousLabel = ageVerificationStartButton.textContent;
      ageVerificationStartButton.textContent = "STARTING...";
      ageVerificationActionNote.textContent = "Creating a secure verification session…";

      try {
        const response = await fetch("/api/account/age-verification/start", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        });
        const data = await readJson(response);
        if (!response.ok) {
          throw new Error(data.error || "Could not start hard 18+ verification.");
        }

        const verificationUrl = safeHttpUrl(data.verification?.verificationUrl);
        if (!verificationUrl || !verificationUrl.startsWith("https://")) {
          throw new Error("The verification provider returned an invalid secure URL.");
        }

        ageVerificationActionNote.textContent = "Opening the secure age-verification provider…";
        window.location.assign(verificationUrl);
      } catch (error) {
        ageVerificationActionNote.textContent = error.message || "Could not start hard 18+ verification.";
        ageVerificationStartButton.disabled = false;
        ageVerificationStartButton.textContent = previousLabel;
      }
    }

`;
html = replaceOnce(html, functionAnchor, startFunction + functionAnchor, "age verification start function");

const listenerAnchor = `    accessButton.addEventListener("click", openAccess);
    dataExportButton.addEventListener("click", handleDataExport);`;
const listenerReplacement = `    accessButton.addEventListener("click", openAccess);
    ageVerificationStartButton.addEventListener("click", startAgeVerification);
    dataExportButton.addEventListener("click", handleDataExport);`;
html = replaceOnce(html, listenerAnchor, listenerReplacement, "age verification action listener");

fs.writeFileSync(indexPath, html);
console.log("Applied v0.43 hard-age verification UI migration.");
