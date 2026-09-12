const assert = require("assert");
const {
  registerAgeVerificationAdapter,
  getAgeVerificationGatewayStatus,
  startAgeVerificationSession,
  processAgeVerificationWebhook,
  resolveAgeVerificationTransition
} = require("../age/gateway");

const provider = "contract-age";
let receivedInput = null;
let webhookVerifyCalled = false;
let webhookParseCalled = false;

registerAgeVerificationAdapter(provider, {
  capabilities: {
    startVerification: true,
    webhooks: true
  },
  isConfigured(env) {
    return env.AGE_CONTRACT_KEY === "configured";
  },
  async startVerification(input) {
    receivedInput = input;
    return {
      verificationUrl: "https://verify.example.invalid/session/abc123",
      reference: "provider-reference-secret-123",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      status: "verified",
      rawIdImage: "DO_NOT_RETAIN",
      biometricTemplate: "DO_NOT_RETAIN",
      apiSecret: "DO_NOT_RETAIN"
    };
  },
  async verifyWebhook({ rawBody, headers }) {
    webhookVerifyCalled = true;
    assert.ok(Buffer.isBuffer(rawBody));
    assert.equal(rawBody.toString("utf8"), '{"event":"verified"}');
    return headers["x-contract-signature"] === "valid-signature";
  },
  async parseWebhook() {
    webhookParseCalled = true;
    assert.equal(webhookVerifyCalled, true, "Webhook payload must not be parsed before signature verification");
    return {
      eventId: "evt_contract_001",
      reference: "provider-reference-secret-123",
      eventType: "verification.completed",
      status: "verified",
      meetsMinimumAge: true,
      occurredAt: "2026-09-12T16:58:00Z",
      verifiedAt: "2026-09-12T16:58:00Z",
      expiresAt: "2027-09-12T16:58:00Z",
      resultCode: "adult-confirmed",
      rawIdImage: "DO_NOT_RETAIN",
      biometricTemplate: "DO_NOT_RETAIN",
      secret: "DO_NOT_RETAIN"
    };
  }
});

async function main() {
  const missing = getAgeVerificationGatewayStatus({});
  assert.equal(missing.configured, false);
  assert.equal(missing.state, "provider-not-selected");
  assert.equal(missing.storesRawIdentityEvidence, false);
  assert.equal(missing.storesBiometricTemplates, false);

  const notConfigured = getAgeVerificationGatewayStatus({
    AGE_VERIFICATION_PROVIDER: provider
  });
  assert.equal(notConfigured.adapterInstalled, true);
  assert.equal(notConfigured.configured, false);
  assert.equal(notConfigured.startVerification, false);
  assert.equal(notConfigured.webhooks, false);

  const env = {
    AGE_VERIFICATION_PROVIDER: provider,
    AGE_CONTRACT_KEY: "configured"
  };
  const ready = getAgeVerificationGatewayStatus(env);
  assert.equal(ready.configured, true);
  assert.equal(ready.state, "ready");
  assert.equal(ready.minimumAge, 18);
  assert.equal(ready.startVerification, true);
  assert.equal(ready.webhooks, true);
  assert.equal(ready.storesRawIdentityEvidence, false);
  assert.equal(ready.storesBiometricTemplates, false);

  const subject = "a".repeat(64);
  const result = await startAgeVerificationSession({
    subject,
    returnUrl: "https://unbound.example.invalid/age-complete",
    cancelUrl: "https://unbound.example.invalid/age-cancel",
    requestId: "request-correlation-id",
    env
  });

  assert.equal(receivedInput.subject, subject);
  assert.equal(receivedInput.minimumAge, 18);
  assert.equal(receivedInput.requestId, "request-correlation-id");
  assert.equal(result.provider, provider);
  assert.equal(result.status, "pending");
  assert.equal(result.minimumAge, 18);
  assert.equal(result.providerReference, "provider-reference-secret-123");
  assert.equal(result.verificationUrl, "https://verify.example.invalid/session/abc123");

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "DO_NOT_RETAIN",
    "rawIdImage",
    "biometricTemplate",
    "apiSecret",
    '"verified"'
  ]) {
    assert.ok(!serialized.includes(forbidden), `Provider-only field leaked into normalized session: ${forbidden}`);
  }

  const webhook = await processAgeVerificationWebhook({
    rawBody: Buffer.from('{"event":"verified"}'),
    headers: { "x-contract-signature": "valid-signature" },
    requestId: "webhook-request-id",
    env
  });
  assert.equal(webhookVerifyCalled, true);
  assert.equal(webhookParseCalled, true);
  assert.equal(webhook.provider, provider);
  assert.equal(webhook.providerEventId, "evt_contract_001");
  assert.equal(webhook.providerReference, "provider-reference-secret-123");
  assert.equal(webhook.status, "verified");
  assert.equal(webhook.minimumAge, 18);
  assert.equal(webhook.verifiedAt, "2026-09-12T16:58:00.000Z");
  assert.equal(webhook.expiresAt, "2027-09-12T16:58:00.000Z");
  const webhookSerialized = JSON.stringify(webhook);
  for (const forbidden of ["DO_NOT_RETAIN", "rawIdImage", "biometricTemplate", '"secret"']) {
    assert.ok(!webhookSerialized.includes(forbidden), `Provider-only webhook field leaked: ${forbidden}`);
  }

  webhookVerifyCalled = false;
  webhookParseCalled = false;
  await assert.rejects(
    () => processAgeVerificationWebhook({
      rawBody: Buffer.from('{"event":"verified"}'),
      headers: { "x-contract-signature": "invalid" },
      env
    }),
    (error) => error?.code === "AGE_VERIFICATION_WEBHOOK_SIGNATURE_INVALID" && error?.statusCode === 401
  );
  assert.equal(webhookVerifyCalled, true);
  assert.equal(webhookParseCalled, false, "Invalid webhook must not be parsed after signature failure");

  registerAgeVerificationAdapter("underage-contract", {
    capabilities: { startVerification: false, webhooks: true },
    isConfigured: () => true,
    verifyWebhook: async () => true,
    parseWebhook: async () => ({
      eventId: "evt_underage",
      reference: "provider-reference-underage",
      status: "verified",
      meetsMinimumAge: false,
      occurredAt: "2026-09-12T16:58:00Z"
    })
  });
  await assert.rejects(
    () => processAgeVerificationWebhook({
      rawBody: Buffer.from("{}"),
      env: { AGE_VERIFICATION_PROVIDER: "underage-contract" }
    }),
    (error) => error?.code === "AGE_VERIFICATION_WEBHOOK_AGE_NOT_CONFIRMED"
  );

  assert.deepEqual(
    resolveAgeVerificationTransition("verified", "pending"),
    { apply: false, status: "verified", reason: "preserve-active-verification" }
  );
  assert.deepEqual(
    resolveAgeVerificationTransition("verified", "failed"),
    { apply: false, status: "verified", reason: "preserve-active-verification" }
  );
  assert.equal(resolveAgeVerificationTransition("verified", "revoked").apply, true);
  assert.equal(resolveAgeVerificationTransition("pending", "verified").status, "verified");

  registerAgeVerificationAdapter("bad-url-age", {
    capabilities: { startVerification: true, webhooks: false },
    isConfigured: () => true,
    async startVerification() {
      return {
        verificationUrl: "http://insecure.example.invalid/session",
        reference: "reference"
      };
    }
  });

  await assert.rejects(
    () => startAgeVerificationSession({
      subject,
      env: { AGE_VERIFICATION_PROVIDER: "bad-url-age" }
    }),
    (error) => error?.code === "AGE_VERIFICATION_PROVIDER_RESPONSE_INVALID"
  );

  console.log("PASS hard-age verification adapter contract: privacy-minimized start flow, authenticated webhooks, safe state transitions.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
