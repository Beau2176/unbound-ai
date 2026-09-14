const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  DEFAULT_SEARCH_WINDOW_MINUTES,
  normalizeSearchWindowMinutes,
  normalizeApproximateOccurredAt,
  safeExportFilename
} = require("../security/law-enforcement");
const {
  integrateAbuseEvidenceServerSource
} = require("../security/abuse-evidence-server-integration");
const {
  integrateLawEnforcementServerSource
} = require("../security/law-enforcement-server-integration");
const {
  buildCompanyLegalResponseHtml
} = require("../security/law-enforcement-ui");

function main() {
  const appRoot = path.resolve(__dirname, "..");

  assert.strictEqual(DEFAULT_SEARCH_WINDOW_MINUTES, 180);
  assert.strictEqual(normalizeSearchWindowMinutes(undefined), 180);
  assert.strictEqual(normalizeSearchWindowMinutes(1), 15);
  assert.strictEqual(normalizeSearchWindowMinutes(99999), 1440);
  assert.ok(normalizeApproximateOccurredAt("2026-09-14T12:00:00Z"));
  assert.strictEqual(normalizeApproximateOccurredAt("not-a-date"), null);
  assert.strictEqual(safeExportFilename("CASE 12/34"), "unbound-law-enforcement-CASE-12-34.json");

  const serviceSource = fs.readFileSync(path.join(appRoot, "security", "law-enforcement.js"), "utf8");
  assert.match(serviceSource, /law_enforcement_requests/);
  assert.match(serviceSource, /LOWER\(TRIM\(u\.display_name\)\) = LOWER\(TRIM\(\$1\)\)/);
  assert.match(serviceSource, /e\.occurred_at BETWEEN \$2 AND \$3/);
  assert.match(serviceSource, /setLegalHold/);
  assert.match(serviceSource, /law_enforcement_export/);
  assert.match(serviceSource, /exportSha256/);
  assert.doesNotMatch(serviceSource, /\bfetch\s*\(|\baxios\b|https:\/\//, "service must not contain an outbound disclosure client");

  const rawServer = fs.readFileSync(path.join(appRoot, "server.js"), "utf8");
  const withEvidence = integrateAbuseEvidenceServerSource(rawServer);
  const integrated = integrateLawEnforcementServerSource(withEvidence);
  assert.match(integrated, /\/law-enforcement/);
  assert.match(integrated, /\/api\/admin\/law-enforcement\/requests/);
  assert.match(integrated, /requireAdmin/);
  assert.match(integrated, /buildCompanyLegalResponseHtml/);
  assert.match(integrated, /Content-Disposition/);
  assert.match(integrated, /Download|attachment/);
  assert.doesNotMatch(integrated, /\/api\/law-enforcement\/automatic-disclosure/);
  new vm.Script(integrated, { filename: "integrated-law-enforcement-server.js" });

  const integrationSource = fs.readFileSync(path.join(appRoot, "security", "law-enforcement-server-integration.js"), "utf8");
  assert.doesNotMatch(integrationSource, /\bfetch\s*\(|\baxios\b|https:\/\//, "server integration must not transmit evidence externally");

  const rawUi = fs.readFileSync(path.join(appRoot, "law-enforcement.html"), "utf8");
  const ui = buildCompanyLegalResponseHtml(rawUi);
  assert.match(ui, /Company Legal \/ Law Enforcement Response/i);
  assert.match(ui, /Preserved High-Risk Safety Records/i);
  assert.match(ui, /Company-controlled disclosure only/i);
  assert.match(ui, /does not create a blanket surveillance archive/i);
  assert.match(ui, /agencyName/);
  assert.match(ui, /requesterName/);
  assert.match(ui, /requestReference/);
  assert.match(ui, /subjectName/);
  assert.match(ui, /approxDate/);
  assert.match(ui, /approxTime/);
  assert.match(ui, /Download Selected Evidence Package/);
  assert.match(ui, /Nothing was automatically transmitted/i);

  const startup = fs.readFileSync(path.join(appRoot, "start.js"), "utf8");
  assert.match(startup, /integrateLawEnforcementServerSource/);
  assert.ok(
    startup.indexOf("integrateLawEnforcementServerSource(integratedSource)") >
      startup.indexOf("integrateAbuseEvidenceServerSource(integratedSource)"),
    "Law-enforcement workspace must integrate after the evidence vault."
  );

  console.log("Company legal/law-enforcement response contract passed: Preserved High-Risk Safety Records, specific request, exact-name/time-window search, audited manual export, legal hold, and no automatic disclosure.");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}