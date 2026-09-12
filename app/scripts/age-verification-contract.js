const assert = require("assert");
const {
  registerAgeVerificationAdapter,
  getAgeVerificationGatewayStatus,
  startAgeVerificationSession
} = require("../age/gateway");

const provider = "contract-age";
let receivedInput = null;

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
  verifyWebhook() {
    return true;
  },
  parseWebhook() {
    return { status: "pending" };
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

  console.log("PASS hard-age verification adapter contract: provider-neutral, privacy-minimized, HTTPS-only, pending-by-default.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
