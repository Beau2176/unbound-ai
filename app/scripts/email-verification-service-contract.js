const assert = require("assert");
const {
  createEmailVerificationService,
  normalizeHttpsOrigin
} = require("../email/service");

const TOKEN = "raw-verification-token-must-not-leak";
const TOKEN_HASH = "b".repeat(64);
const NOW = new Date("2026-09-12T19:10:00.000Z");
const EXPIRES = new Date("2026-09-12T19:40:00.000Z");

function createDependencies({ providerConfigured = true, deliveryAccepted = true, persistCreated = true } = {}) {
  const calls = {
    create: [],
    delivery: [],
    failed: [],
    consume: [],
    status: []
  };

  const verification = {
    createVerificationChallenge() {
      return {
        token: TOKEN,
        tokenHash: TOKEN_HASH,
        createdAt: NOW,
        expiresAt: EXPIRES
      };
    },
    hashVerificationToken(token) {
      assert.strictEqual(token, TOKEN);
      return TOKEN_HASH;
    },
    buildPublicEmailVerificationStatus(record, gatewayStatus) {
      calls.status.push({ record, gatewayStatus });
      return {
        state: record?.status || "unverified",
        verified: record?.status === "verified",
        verificationRequired: record?.status !== "verified",
        canSend: Boolean(gatewayStatus?.configured),
        canResend: Boolean(gatewayStatus?.configured),
        expiresAt: null
      };
    }
  };

  const store = {
    async getEmailVerificationRecord(_pool, userId) {
      assert.strictEqual(userId, 12);
      return { status: "pending" };
    },
    async createEmailVerificationChallenge(_pool, payload) {
      calls.create.push(payload);
      return persistCreated
        ? { created: true, state: "pending", expiresAt: EXPIRES.toISOString() }
        : { created: false, reason: "already-verified" };
    },
    async markEmailVerificationDeliveryFailed(_pool, payload) {
      calls.failed.push(payload);
      return { updated: true, state: "failed" };
    },
    async consumeEmailVerificationChallenge(_pool, payload) {
      calls.consume.push(payload);
      return { verified: true, reason: "verified", userId: 12 };
    }
  };

  const gateway = {
    getEmailGatewayStatus() {
      return {
        provider: "contract",
        configured: providerConfigured,
        canSendVerification: providerConfigured,
        error: providerConfigured ? null : "provider-not-configured"
      };
    },
    async sendAccountVerification(payload) {
      calls.delivery.push(payload);
      return { accepted: deliveryAccepted, provider: "contract" };
    }
  };

  return { verification, store, gateway, calls };
}

async function main() {
  assert.strictEqual(normalizeHttpsOrigin("https://unbound.example/path?x=1"), "https://unbound.example");
  assert.strictEqual(normalizeHttpsOrigin("http://unbound.example"), null);

  const deps = createDependencies();
  const service = createEmailVerificationService(deps);
  const env = {
    PUBLIC_APP_ORIGIN: "https://unbound.example",
    EMAIL_VERIFICATION_TOKEN_SECRET: "test-only"
  };

  const url = service.buildVerificationUrl(TOKEN, env);
  assert.strictEqual(
    url,
    "https://unbound.example/verify-email#token=raw-verification-token-must-not-leak"
  );
  assert.ok(!new URL(url).search, "verification token must never be placed in the server-visible query string");
  assert.ok(new URL(url).hash.includes(TOKEN), "verification token belongs only in the browser fragment");
  assert.throws(
    () => service.buildVerificationUrl(TOKEN, { PUBLIC_APP_ORIGIN: "http://unbound.example" }),
    (error) => error?.code === "EMAIL_VERIFICATION_ORIGIN_INVALID"
  );

  const result = await service.send({
    pool: {},
    user: { id: 12, email: "Person@Example.com", display_name: "Person" },
    env,
    now: NOW
  });
  assert.deepStrictEqual(result, {
    sent: true,
    state: "pending",
    expiresAt: EXPIRES.toISOString()
  });
  assert.deepStrictEqual(deps.calls.create[0], {
    userId: 12,
    tokenHash: TOKEN_HASH,
    expiresAt: EXPIRES,
    now: NOW
  });
  assert.strictEqual(deps.calls.delivery[0].toEmail, "person@example.com");
  assert.ok(deps.calls.delivery[0].verificationUrl.includes(TOKEN));
  assert.ok(!JSON.stringify(deps.calls.create).includes(TOKEN), "persistence must never receive the raw token");
  assert.ok(!("token" in result), "send result must never return the raw token");
  assert.ok(!("verificationUrl" in result), "send result must never return the verification URL");
  assert.ok(!("provider" in result), "public service result does not need provider metadata");

  const consumed = await service.consume({ pool: {}, token: TOKEN, env, now: NOW });
  assert.deepStrictEqual(consumed, { verified: true, reason: "verified", userId: 12 });
  assert.deepStrictEqual(deps.calls.consume[0], { tokenHash: TOKEN_HASH, now: NOW });

  const status = await service.getStatus({ pool: {}, userId: 12, env, now: NOW });
  assert.strictEqual(status.state, "pending");
  assert.ok(!("token" in status));
  assert.ok(!("provider" in status));

  const alreadyVerifiedDeps = createDependencies({ persistCreated: false });
  const alreadyVerifiedService = createEmailVerificationService(alreadyVerifiedDeps);
  const skipped = await alreadyVerifiedService.resend({
    pool: {},
    user: { id: 12, email: "person@example.com" },
    env,
    now: NOW
  });
  assert.deepStrictEqual(skipped, {
    sent: false,
    state: "verified",
    reason: "already-verified"
  });
  assert.strictEqual(alreadyVerifiedDeps.calls.delivery.length, 0);

  const unavailableDeps = createDependencies({ providerConfigured: false });
  const unavailableService = createEmailVerificationService(unavailableDeps);
  await assert.rejects(
    unavailableService.send({
      pool: {},
      user: { id: 12, email: "person@example.com" },
      env,
      now: NOW
    }),
    (error) => error?.code === "EMAIL_PROVIDER_NOT_CONFIGURED"
  );
  assert.strictEqual(unavailableDeps.calls.create.length, 0, "no challenge should be created when email delivery is unavailable");

  const rejectedDeps = createDependencies({ deliveryAccepted: false });
  const rejectedService = createEmailVerificationService(rejectedDeps);
  await assert.rejects(
    rejectedService.send({
      pool: {},
      user: { id: 12, email: "person@example.com" },
      env,
      now: NOW
    }),
    (error) => error?.code === "EMAIL_VERIFICATION_DELIVERY_FAILED"
  );
  assert.strictEqual(rejectedDeps.calls.failed.length, 1);
  assert.strictEqual(rejectedDeps.calls.failed[0].tokenHash, TOKEN_HASH);
  assert.ok(!JSON.stringify(rejectedDeps.calls.failed).includes(TOKEN));

  console.log("Email verification service contract passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
