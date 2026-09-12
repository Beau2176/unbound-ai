const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  DEFAULT_LEGAL_VERSIONS,
  legalPublishingState
} = require("../privacy/legal-consent");

function read(appRoot, relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), "utf8");
}

function main() {
  const appRoot = path.resolve(__dirname, "..");
  const repoRoot = path.resolve(appRoot, "..");
  const terms = read(appRoot, "terms.html");
  const privacy = read(appRoot, "privacy.html");
  const dataMap = fs.readFileSync(
    path.join(repoRoot, "docs", "LEGAL_DATA_FLOW_REVIEW.md"),
    "utf8"
  );

  for (const [name, source] of [["terms", terms], ["privacy", privacy]]) {
    assert.match(source, /DRAFT — NOT YET IN FORCE/, `${name} must visibly remain draft`);
    assert.match(source, /noindex, nofollow/, `${name} must remain noindex during legal review`);
    assert.match(source, /Draft version: 2026-09-draft/, `${name} must retain the draft version`);
    assert.match(source, /review required before launch/i, `${name} must require review before launch`);
  }

  assert.strictEqual(DEFAULT_LEGAL_VERSIONS.terms, "2026-09-draft");
  assert.strictEqual(DEFAULT_LEGAL_VERSIONS.privacy, "2026-09-draft");

  const publishing = legalPublishingState({});
  assert.strictEqual(publishing.documentsPublished, false);
  assert.strictEqual(publishing.acceptanceEnabled, false);
  assert.strictEqual(publishing.enforcementEnabled, false);

  for (const provider of [
    "Render",
    "OpenAI",
    "Amazon Simple Email Service",
    "Segpay",
    "Yoti"
  ]) {
    assert.ok(
      privacy.includes(provider),
      `privacy draft must describe current production-target provider: ${provider}`
    );
    assert.ok(
      dataMap.includes(provider),
      `legal data-flow map must describe current production-target provider: ${provider}`
    );
  }

  for (const provider of ["OpenAI", "Amazon Simple Email Service", "Segpay", "Yoti", "Render"]) {
    assert.ok(terms.includes(provider), `terms draft must identify ${provider}`);
  }

  assert.match(dataMap, /DRAFT REVIEW MATERIAL/);
  assert.match(dataMap, /not a published privacy notice or legal opinion/i);
  assert.match(dataMap, /UNBOUND_LEGAL_ACCEPTANCE_ENABLED/);
  assert.match(dataMap, /UNBOUND_LEGAL_ENFORCEMENT_ENABLED/);

  const aiGateway = read(appRoot, "ai/gateway.js");
  const emailProvider = read(appRoot, "email/providers/aws-ses.js");
  const billingProvider = read(appRoot, "billing/providers/segpay.js");
  const ageProvider = read(appRoot, "age/providers/yoti.js");

  assert.match(aiGateway, /providers\/openai/);
  assert.match(emailProvider, /aws-ses/);
  assert.match(billingProvider, /PROVIDER_ID = "segpay"/);
  assert.match(ageProvider, /PROVIDER_ID = "yoti"/);

  assert.match(privacy, /not to store full payment-card numbers or CVV/i);
  assert.match(privacy, /not to receive or store that raw evidence/i);
  assert.match(privacy, /cryptographic token hash/i);
  assert.match(terms, /Commercial terms are not final/);
  assert.match(terms, /To be finalized with qualified legal counsel/);

  console.log("Provider-aware legal draft contract passed.");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
