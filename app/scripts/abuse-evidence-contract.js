const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  EVIDENCE_CATEGORIES,
  normalizeEvidenceCategory,
  getEvidenceConfig,
  encryptEvidencePayload,
  decryptEvidencePayload,
  publicEvidenceStatus
} = require("../security/abuse-evidence");
const {
  integrateAbuseEvidenceServerSource
} = require("../security/abuse-evidence-server-integration");

function main() {
  const key = Buffer.alloc(32, 7);
  const env = {
    ABUSE_EVIDENCE_PRESERVATION_ENABLED: "true",
    ABUSE_EVIDENCE_ENCRYPTION_KEY: key.toString("base64"),
    ABUSE_EVIDENCE_RETENTION_DAYS: "90"
  };
  const config = getEvidenceConfig(env);
  assert.strictEqual(config.configured, true);
  assert.strictEqual(config.blanketConversationRecording, false);
  assert.strictEqual(config.automaticDisclosure, false);
  assert.strictEqual(config.retentionDays, 90);

  assert.ok(EVIDENCE_CATEGORIES.includes("minor_sexual_exploitation"));
  assert.strictEqual(normalizeEvidenceCategory("credible_violent_threat"), "credible_violent_threat");
  assert.strictEqual(normalizeEvidenceCategory("illegal"), null, "generic legal conclusions must not become a preservation category");

  const payload = {
    prompt: "high-risk test evidence",
    search: "test query",
    metadata: { mode: "research" }
  };
  const encrypted = encryptEvidencePayload(payload, config.key);
  assert.ok(encrypted.encryptedPayload);
  assert.ok(encrypted.payloadSha256);
  assert.ok(!encrypted.encryptedPayload.includes(payload.prompt));
  const decrypted = decryptEvidencePayload({
    encrypted_payload: encrypted.encryptedPayload,
    encryption_iv: encrypted.encryptionIv,
    encryption_tag: encrypted.encryptionTag,
    payload_sha256: encrypted.payloadSha256
  }, config.key);
  assert.deepStrictEqual(decrypted, payload);

  assert.throws(
    () => decryptEvidencePayload({
      encrypted_payload: encrypted.encryptedPayload,
      encryption_iv: encrypted.encryptionIv,
      encryption_tag: encrypted.encryptionTag,
      payload_sha256: "0".repeat(64)
    }, config.key),
    (error) => error?.code === "ABUSE_EVIDENCE_INTEGRITY_FAILED"
  );

  const status = publicEvidenceStatus(env);
  assert.strictEqual(status.automaticDisclosure, false);
  assert.strictEqual(status.blanketConversationRecording, false);
  assert.strictEqual(status.ingestionBoundary, "explicit-high-risk-safety-enforcement-event");
  assert.ok(!JSON.stringify(status).includes(env.ABUSE_EVIDENCE_ENCRYPTION_KEY));

  const appRoot = path.resolve(__dirname, "..");
  const rawServer = fs.readFileSync(path.join(appRoot, "server.js"), "utf8");
  const integrated = integrateAbuseEvidenceServerSource(rawServer);
  assert.match(integrated, /preserveHighRiskSafetyEvidence/);
  assert.match(integrated, /\/api\/admin\/security\/evidence\/status/);
  assert.match(integrated, /\/api\/admin\/security\/evidence\/:id\/read/);
  assert.match(integrated, /requireAdmin/);
  assert.match(integrated, /Cache-Control", "no-store/);
  assert.doesNotMatch(integrated, /\/api\/security\/evidence\/preserve/);

  const integrationSource = fs.readFileSync(
    path.join(appRoot, "security", "abuse-evidence-server-integration.js"),
    "utf8"
  );
  assert.doesNotMatch(
    integrationSource,
    /\bfetch\s*\(|\baxios\b|https:\/\//,
    "evidence integration itself must not contain an external disclosure client"
  );

  const docs = fs.readFileSync(path.resolve(appRoot, "..", "docs", "ABUSE_EVIDENCE_PRESERVATION.md"), "utf8");
  assert.match(docs, /general surveillance archive/i);
  assert.match(docs, /does not send preserved data/i);
  assert.match(docs, /does not claim that a complete legal-violation classifier has been deployed/i);

  console.log("Abuse evidence preservation privacy/crypto contract passed.");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
