const assert = require("assert");
const {
  getEmailVerificationConfig,
  createVerificationChallenge,
  verifyChallengeToken,
  buildPublicEmailVerificationStatus
} = require("../email/verification");
const {
  registerEmailProvider,
  getEmailGatewayStatus,
  sendAccountVerification
} = require("../email/gateway");

async function main() {
  const env = {
    EMAIL_VERIFICATION_TOKEN_SECRET: "contract-secret-that-never-leaves-the-test",
    EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: "30",
    PUBLIC_APP_ORIGIN: "https://unbound.example"
  };

  const config = getEmailVerificationConfig(env);
  assert.strictEqual(config.tokenTtlMinutes, 30);
  assert.strictEqual(config.secretConfigured, true);

  const now = new Date("2026-09-12T18:00:00.000Z");
  const challenge = createVerificationChallenge({ now, env });
  assert.ok(challenge.token.length >= 40, "raw token must contain strong entropy");
  assert.strictEqual(challenge.tokenHash.length, 64, "token hash must be SHA-256 sized");
  assert.notStrictEqual(challenge.token, challenge.tokenHash, "raw token must not be stored as its hash");

  assert.deepStrictEqual(
    verifyChallengeToken({
      token: challenge.token,
      expectedHash: challenge.tokenHash,
      expiresAt: challenge.expiresAt,
      now: new Date("2026-09-12T18:05:00.000Z"),
      env
    }),
    { valid: true, reason: "valid" }
  );

  assert.strictEqual(
    verifyChallengeToken({
      token: challenge.token,
      expectedHash: challenge.tokenHash,
      expiresAt: challenge.expiresAt,
      usedAt: new Date("2026-09-12T18:02:00.000Z"),
      now: new Date("2026-09-12T18:05:00.000Z"),
      env
    }).reason,
    "already-used"
  );

  assert.strictEqual(
    verifyChallengeToken({
      token: challenge.token,
      expectedHash: challenge.tokenHash,
      expiresAt: challenge.expiresAt,
      now: new Date("2026-09-12T18:31:00.000Z"),
      env
    }).reason,
    "expired"
  );

  const publicStatus = buildPublicEmailVerificationStatus(
    { status: "pending", expiresAt: challenge.expiresAt },
    { configured: true },
    new Date("2026-09-12T18:05:00.000Z")
  );
  assert.deepStrictEqual(Object.keys(publicStatus).sort(), [
    "canResend",
    "canSend",
    "expiresAt",
    "state",
    "verificationRequired",
    "verified"
  ]);
  assert.ok(!("token" in publicStatus), "public status must never expose a raw token");
  assert.ok(!("tokenHash" in publicStatus), "public status must never expose a token hash");
  assert.ok(!("providerMessageId" in publicStatus), "public status must never expose provider message IDs");

  assert.deepStrictEqual(getEmailGatewayStatus({}), {
    provider: "none",
    configured: false,
    canSendVerification: false,
    error: "provider-not-selected"
  });

  registerEmailProvider({
    id: "contract",
    isConfigured(providerEnv) {
      return providerEnv.CONTRACT_EMAIL_KEY === "configured";
    },
    async sendVerification({ toEmail, verificationUrl }) {
      assert.strictEqual(toEmail, "person@example.com");
      assert.ok(verificationUrl.startsWith("https://"));
      return {
        accepted: true,
        providerMessageId: "must-not-leak"
      };
    }
  });

  const providerEnv = {
    EMAIL_PROVIDER: "contract",
    CONTRACT_EMAIL_KEY: "configured"
  };
  assert.strictEqual(getEmailGatewayStatus(providerEnv).configured, true);

  const sent = await sendAccountVerification({
    toEmail: "Person@Example.com",
    displayName: "Person",
    verificationUrl: "https://unbound.example/verify-email?token=private",
    env: providerEnv
  });
  assert.deepStrictEqual(sent, { accepted: true, provider: "contract" });
  assert.ok(!("providerMessageId" in sent), "provider message IDs must be stripped from normalized results");

  await assert.rejects(
    sendAccountVerification({
      toEmail: "person@example.com",
      verificationUrl: "http://unbound.example/verify-email?token=private",
      env: providerEnv
    }),
    (error) => error?.code === "EMAIL_VERIFICATION_URL_INVALID"
  );

  console.log("Email verification contract passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
