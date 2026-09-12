const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const serverPath = path.join(appRoot, "server.js");
const indexPath = path.join(appRoot, "index.html");
const regressionPath = path.join(appRoot, "scripts", "regression-contract.js");

function replaceOnce(source, needle, replacement, label) {
  const count = source.split(needle).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}`);
  return source.replace(needle, replacement);
}

let server = fs.readFileSync(serverPath, "utf8");
server = replaceOnce(
  server,
  `       provider,\n       status,\n       plan_tier,\n       current_period_start,`,
  `       provider,\n       provider_customer_id IS NOT NULL AS provider_customer_connected,\n       status,\n       plan_tier,\n       current_period_start,`,
  "subscription customer connection flag"
);
server = replaceOnce(
  server,
  `      connected: Boolean(subscription && subscription.provider),\n      provider: subscription?.provider || null,\n      status: normalizeSubscriptionStatus(subscription?.status),`,
  `      connected: Boolean(subscription && subscription.provider),\n      customerConnected: Boolean(subscription?.provider_customer_connected),\n      provider: subscription?.provider || null,\n      status: normalizeSubscriptionStatus(subscription?.status),`,
  "public customer connection flag"
);
server = replaceOnce(
  server,
  `    ageVerification,\n    ageVerificationGateway,\n    summary: {`,
  `    ageVerification,\n    ageVerificationGateway,\n    billingGateway: getBillingGatewayStatus(),\n    summary: {`,
  "public billing gateway"
);
fs.writeFileSync(serverPath, server);

let html = fs.readFileSync(indexPath, "utf8");
html = replaceOnce(
  html,
  `        <div id="ageVerificationActions" class="access-age-actions" hidden>\n          <button id="ageVerificationStartButton" class="auth-submit secondary" type="button">VERIFY 18+</button>\n          <div id="ageVerificationActionNote" class="history-empty" role="status" aria-live="polite"></div>\n        </div>\n        <div class="access-section-title">Capabilities</div>`,
  `        <div id="ageVerificationActions" class="access-age-actions" hidden>\n          <button id="ageVerificationStartButton" class="auth-submit secondary" type="button">VERIFY 18+</button>\n          <div id="ageVerificationActionNote" class="history-empty" role="status" aria-live="polite"></div>\n        </div>\n        <div id="billingActions" class="access-age-actions">\n          <div style="display:flex;gap:8px;flex-wrap:wrap;">\n            <button id="billingUpgradeButton" class="auth-submit" type="button" hidden>UPGRADE TO TOP</button>\n            <button id="billingPortalButton" class="auth-submit secondary" type="button" hidden>MANAGE BILLING</button>\n          </div>\n          <div id="billingActionNote" class="history-empty" role="status" aria-live="polite"></div>\n        </div>\n        <div class="access-section-title">Capabilities</div>`,
  "billing action markup"
);
html = replaceOnce(
  html,
  `    const ageVerificationActionNote = document.getElementById("ageVerificationActionNote");\n    const accessCapabilityList = document.getElementById("accessCapabilityList");`,
  `    const ageVerificationActionNote = document.getElementById("ageVerificationActionNote");\n    const billingActions = document.getElementById("billingActions");\n    const billingUpgradeButton = document.getElementById("billingUpgradeButton");\n    const billingPortalButton = document.getElementById("billingPortalButton");\n    const billingActionNote = document.getElementById("billingActionNote");\n    const accessCapabilityList = document.getElementById("accessCapabilityList");`,
  "billing DOM refs"
);

const billingFunctions = `    async function startTopCheckout() {\n      if (!currentUser || !accountAccess) return;\n      const gateway = accountAccess.billingGateway || {};\n      if (accountAccess.plan?.tier === "top") {\n        showToast("This account already has TOP access.");\n        return;\n      }\n      if (!gateway.configured || !gateway.checkout) {\n        showToast("Paid TOP subscriptions are not available yet.");\n        return;\n      }\n\n      billingUpgradeButton.disabled = true;\n      billingUpgradeButton.textContent = "OPENING CHECKOUT...";\n      billingActionNote.textContent = "Creating a secure checkout session…";\n      try {\n        const response = await fetch("/api/account/billing/checkout", {\n          method: "POST",\n          credentials: "same-origin",\n          headers: { "Content-Type": "application/json" },\n          body: "{}"\n        });\n        const data = await readJson(response);\n        if (!response.ok) throw new Error(data.error || "Could not start TOP checkout.");\n        const checkoutUrl = safeHttpUrl(data.checkout?.checkoutUrl);\n        if (!checkoutUrl || !checkoutUrl.startsWith("https://")) {\n          throw new Error("The billing provider returned an invalid secure checkout URL.");\n        }\n        billingActionNote.textContent = "Opening the secure billing provider…";\n        window.location.assign(checkoutUrl);\n      } catch (error) {\n        billingActionNote.textContent = error.message || "Could not start TOP checkout.";\n        billingUpgradeButton.disabled = false;\n        billingUpgradeButton.textContent = "UPGRADE TO TOP";\n      }\n    }\n\n    async function openBillingPortal() {\n      if (!currentUser || !accountAccess) return;\n      const gateway = accountAccess.billingGateway || {};\n      const subscription = accountAccess.subscription || {};\n      if (!subscription.customerConnected || !gateway.configured || !gateway.customerPortal) {\n        showToast("Subscription management is not available for this account.");\n        return;\n      }\n\n      billingPortalButton.disabled = true;\n      billingPortalButton.textContent = "OPENING...";\n      billingActionNote.textContent = "Creating a secure billing-management session…";\n      try {\n        const response = await fetch("/api/account/billing/portal", {\n          method: "POST",\n          credentials: "same-origin",\n          headers: { "Content-Type": "application/json" },\n          body: "{}"\n        });\n        const data = await readJson(response);\n        if (!response.ok) throw new Error(data.error || "Could not open subscription management.");\n        const portalUrl = safeHttpUrl(data.portal?.portalUrl);\n        if (!portalUrl || !portalUrl.startsWith("https://")) {\n          throw new Error("The billing provider returned an invalid secure management URL.");\n        }\n        billingActionNote.textContent = "Opening the secure billing provider…";\n        window.location.assign(portalUrl);\n      } catch (error) {\n        billingActionNote.textContent = error.message || "Could not open subscription management.";\n        billingPortalButton.disabled = false;\n        billingPortalButton.textContent = "MANAGE BILLING";\n      }\n    }\n\n`;
html = replaceOnce(
  html,
  `    async function startAgeVerification() {`,
  billingFunctions + `    async function startAgeVerification() {`,
  "billing action functions"
);

html = replaceOnce(
  html,
  `        ageVerificationActionNote.textContent = "";\n        accessCapabilityList.innerHTML = "";`,
  `        ageVerificationActionNote.textContent = "";\n        billingActions.hidden = true;\n        billingUpgradeButton.hidden = true;\n        billingUpgradeButton.disabled = true;\n        billingPortalButton.hidden = true;\n        billingPortalButton.disabled = true;\n        billingActionNote.textContent = "";\n        accessCapabilityList.innerHTML = "";`,
  "empty billing state"
);

const renderBilling = `      const billingGateway = accountAccess.billingGateway || {};\n      const subscription = accountAccess.subscription || {};\n      const effectiveTop = accountAccess.plan?.tier === "top";\n      const checkoutAvailable = Boolean(!effectiveTop && billingGateway.configured && billingGateway.checkout);\n      const portalAvailable = Boolean(\n        subscription.customerConnected &&\n        billingGateway.configured &&\n        billingGateway.customerPortal &&\n        subscription.provider &&\n        subscription.provider === billingGateway.provider\n      );\n      billingActions.hidden = false;\n      billingUpgradeButton.hidden = !checkoutAvailable;\n      billingUpgradeButton.disabled = !checkoutAvailable;\n      billingUpgradeButton.textContent = "UPGRADE TO TOP";\n      billingPortalButton.hidden = !portalAvailable;\n      billingPortalButton.disabled = !portalAvailable;\n      billingPortalButton.textContent = "MANAGE BILLING";\n      billingActionNote.textContent = portalAvailable\n        ? "Manage your paid subscription securely with the connected billing provider."\n        : effectiveTop\n          ? accountAccess.plan?.source === "subscription"\n            ? "Your paid TOP access is active, but the connected provider does not currently expose account management."\n            : \`Your TOP access comes from \${accessSourceLabel(accountAccess.plan?.source)}; no paid subscription action is required.\`\n          : checkoutAvailable\n            ? "Upgrade to TOP through the connected secure billing provider."\n            : "Paid TOP subscriptions are not connected yet. No payment action is available.";\n\n`;
html = replaceOnce(
  html,
  `      const ageState = accountAccess.ageVerification || {};`,
  renderBilling + `      const ageState = accountAccess.ageVerification || {};`,
  "billing access render"
);

html = replaceOnce(
  html,
  `    accessButton.addEventListener("click", openAccess);\n    ageVerificationStartButton.addEventListener("click", startAgeVerification);`,
  `    accessButton.addEventListener("click", openAccess);\n    billingUpgradeButton.addEventListener("click", startTopCheckout);\n    billingPortalButton.addEventListener("click", openBillingPortal);\n    ageVerificationStartButton.addEventListener("click", startAgeVerification);`,
  "billing listeners"
);
fs.writeFileSync(indexPath, html);

let regression = fs.readFileSync(regressionPath, "utf8");
regression = replaceOnce(
  regression,
  `  requireText(\n    indexHtml,\n    "window.location.assign(verificationUrl)",\n    "age-verification provider navigation"\n  );`,
  `  requireText(\n    indexHtml,\n    "window.location.assign(verificationUrl)",\n    "age-verification provider navigation"\n  );\n  requireText(indexHtml, 'id="billingUpgradeButton"', "TOP upgrade action");\n  requireText(indexHtml, 'id="billingPortalButton"', "billing management action");\n  requireText(indexHtml, 'fetch("/api/account/billing/checkout"', "billing checkout endpoint usage");\n  requireText(indexHtml, 'fetch("/api/account/billing/portal"', "billing portal endpoint usage");\n  requireText(indexHtml, 'checkoutUrl.startsWith("https://")', "checkout redirect HTTPS requirement");\n  requireText(indexHtml, 'portalUrl.startsWith("https://")', "billing portal redirect HTTPS requirement");\n  requireText(indexHtml, "subscription.customerConnected", "billing portal requires connected customer");\n  forbidText(indexHtml, "provider_customer_id", "browser must not reference provider customer identifier");`,
  "billing browser regression"
);
fs.writeFileSync(regressionPath, regression);

console.log("Applied v0.46 truthful billing UI migration.");
