const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");
const serverPath = path.join(appRoot, "server.js");
const packagePath = path.join(appRoot, "package.json");
const server = fs.readFileSync(serverPath, "utf8");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

function requireText(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`Security contract missing: ${label}`);
}

function forbidText(text, needle, label) {
  if (text.includes(needle)) throw new Error(`Security contract violation: ${label}`);
}

forbidText(server, "express.static(__dirname)", "application source directory must not be publicly exposed");
requireText(server, 'app.get("/index.html"', "explicit index route");
requireText(server, 'app.get("/admin.html"', "explicit admin route");
requireText(server, 'app.get("/unbound-cosmic.png"', "explicit branding route");
forbidText(server, 'app.get("/server.js"', "server source must not be routed publicly");
requireText(server, "createSameOriginApiGuard", "same-origin API guard");
requireText(server, "HttpOnly; Path=/; SameSite=Lax", "HttpOnly SameSite session/device cookies");

const adultGateCount = (server.match(/assertAgeVerifiedAdult\(req\)/g) || []).length;
if (adultGateCount < 2) {
  throw new Error("Security contract violation: Adult Mode must be age-gated on normal and streaming chat routes");
}

const exportStart = server.indexOf('app.get(\n  "/api/account/export"');
const exportEnd = exportStart >= 0
  ? server.indexOf("/* ------------------------- CONVERSATION HISTORY", exportStart)
  : -1;
if (exportStart < 0 || exportEnd <= exportStart) {
  throw new Error("Security contract missing: account data export route");
}
const exportRoute = server.slice(exportStart, exportEnd);
for (const forbidden of [
  "password_hash",
  "token_hash",
  "device_token_hash",
  "code_hash",
  "credential_id",
  "public_key",
  "provider_reference_hash",
  "provider_response_id",
  "user_handle"
]) {
  forbidText(exportRoute, forbidden, `data export must not select ${forbidden}`);
}

const ageWebhookPath = 'const AGE_VERIFICATION_WEBHOOK_PATH = "/api/webhooks/age-verification";';
const billingWebhookPath = 'const BILLING_WEBHOOK_PATH = "/api/webhooks/billing";';
requireText(server, ageWebhookPath, "exact age-verification webhook path constant");
requireText(server, billingWebhookPath, "exact billing webhook path constant");
requireText(
  server,
  "exemptPaths: [AGE_VERIFICATION_WEBHOOK_PATH, BILLING_WEBHOOK_PATH]",
  "exact provider-webhook same-origin exemptions"
);
const rawParserCount = (
  server.match(/express\.raw\(\{ type: "\*\/\*", limit: "100kb" \}\)/g) || []
).length;
if (rawParserCount < 2) {
  throw new Error("Security contract missing: both provider webhooks must preserve raw request bytes");
}
requireText(
  server,
  "req.path === AGE_VERIFICATION_WEBHOOK_PATH ||\n    req.path === BILLING_WEBHOOK_PATH",
  "provider webhooks must bypass JSON body parsing"
);

const ageWebhookStart = server.indexOf("app.post(\n  AGE_VERIFICATION_WEBHOOK_PATH");
const billingWebhookStart = server.indexOf("app.post(\n  BILLING_WEBHOOK_PATH");
const adminStart = server.indexOf("/* ----------------------------- ADMIN API");
const ageWebhookEnd = billingWebhookStart > ageWebhookStart ? billingWebhookStart : adminStart;
if (ageWebhookStart < 0 || ageWebhookEnd <= ageWebhookStart) {
  throw new Error("Security contract missing: authenticated age-verification webhook route");
}
const ageWebhookRoute = server.slice(ageWebhookStart, ageWebhookEnd);
requireText(
  ageWebhookRoute,
  "processAgeVerificationWebhook({",
  "age webhook must verify and normalize provider callback through adapter"
);
requireText(
  ageWebhookRoute,
  'crypto.createHash("sha256").update(rawBody).digest("hex")',
  "age webhook raw payload hash"
);
requireText(
  ageWebhookRoute,
  "ON CONFLICT (provider, provider_event_id) DO NOTHING",
  "age webhook event deduplication"
);
requireText(
  ageWebhookRoute,
  "provider_reference_hash = $2",
  "age webhook hashed provider-reference lookup"
);
requireText(
  ageWebhookRoute,
  "resolveAgeVerificationTransition(account.status, event.status)",
  "age webhook safe state transition policy"
);
requireText(
  ageWebhookRoute,
  "ignored-stale-event",
  "age webhook stale-event protection"
);
forbidText(ageWebhookRoute, "providerReference:", "age webhook response must not expose provider reference");
forbidText(ageWebhookRoute, "userId:", "age webhook response must not expose account user ID");

if (billingWebhookStart < 0 || adminStart <= billingWebhookStart) {
  throw new Error("Security contract missing: authenticated billing webhook route");
}
const billingWebhookRoute = server.slice(billingWebhookStart, adminStart);
requireText(
  billingWebhookRoute,
  "processBillingWebhook({",
  "billing webhook must verify and normalize provider callback through adapter"
);
requireText(
  billingWebhookRoute,
  'crypto.createHash("sha256").update(rawBody).digest("hex")',
  "billing webhook raw payload hash"
);
requireText(
  billingWebhookRoute,
  "ON CONFLICT (provider, provider_event_id) DO NOTHING",
  "billing webhook event deduplication"
);
requireText(
  billingWebhookRoute,
  "provider_subject_hash = $2",
  "billing webhook privacy-safe subject lookup"
);
requireText(
  billingWebhookRoute,
  "provider_subscription_id = $2",
  "billing webhook subscription-reference lookup"
);
requireText(
  billingWebhookRoute,
  "ignored-stale-event",
  "billing webhook stale-event protection"
);
requireText(
  billingWebhookRoute,
  "subscription-reference-not-found",
  "billing webhook unmatched-event retry state"
);
forbidText(billingWebhookRoute, "checkoutUrl:", "billing webhook must not create checkout redirects");
forbidText(billingWebhookRoute, "portalUrl:", "billing webhook must not create portal redirects");

const checkoutStart = server.indexOf('app.post(\n  "/api/account/billing/checkout"');
const portalStart = server.indexOf('app.post(\n  "/api/account/billing/portal"');
if (checkoutStart < 0 || portalStart <= checkoutStart) {
  throw new Error("Security contract missing: signed-in billing checkout route");
}
const checkoutRoute = server.slice(checkoutStart, portalStart);
requireText(checkoutRoute, "requireSignedIn", "billing checkout must require a signed-in account");
requireText(checkoutRoute, "securityActionRateLimit", "billing checkout must be rate-limited");
requireText(checkoutRoute, "billingSubject(req.user.id)", "billing checkout must use an opaque account subject");
requireText(checkoutRoute, "provider_subject_hash", "billing checkout must persist only hashed provider subject linkage");
requireText(checkoutRoute, "status,\n           plan_tier", "billing checkout provisional subscription columns");
requireText(checkoutRoute, "VALUES ($1, $2, $3, 'incomplete', 'top'", "billing checkout must start locally incomplete");
forbidText(checkoutRoute, "status: \"active\"", "browser checkout must never mark subscription active");

if (pkg.overrides?.qs !== "6.16.0") {
  throw new Error("Security contract violation: qs must remain pinned to patched 6.16.0");
}
if (pkg.engines?.node !== "24.x") {
  throw new Error("Runtime contract violation: package engines.node must remain pinned to Node 24.x");
}

for (const envPath of [path.join(repoRoot, ".env"), path.join(appRoot, ".env")]) {
  if (fs.existsSync(envPath)) {
    throw new Error(`Security contract violation: tracked/runtime source tree contains ${path.relative(repoRoot, envPath)}`);
  }
}

console.log("UNBOUND AI security contract checks passed.");
