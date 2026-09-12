const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  getAgeVerificationGatewayStatus,
  startAgeVerificationSession,
  processAgeVerificationWebhook
} = require("../age/gateway");
const {
  registerBuiltInAgeVerificationProviders
} = require("../age/providers/register");
const {
  YOTI_SESSIONS_URL,
  getYotiConfig,
  notificationPayloadForSignature,
  verifyNotificationSignature,
  normalizeNotificationStatus
} = require("../age/providers/yoti");

function buildSignedNotification({ privateKey, overrides = {} } = {}) {
  const unsigned = {
    method: "AGE_ESTIMATION",
    result: true,
    age: 27,
    session_key: "69db8ad4-c983-40b3-b95a-a8fa576e70a6",
    reference_id: "a".repeat(64),
    id: "2480375e-ddc0-4832-9b82-b1d14af5cf75",
    timestamp: Math.floor(Date.now() / 1000),
    notification_url: "https://unbound.example.invalid/api/webhooks/age-verification",
    evidence_id: "da4070de-3d34-44d7-86d4-7d6fdf547740",
    state: "COMPLETE",
    check_type: "SESSION",
    ...overrides
  };
  const payload = JSON.stringify(unsigned).replace(/\s/g, "");
  const signature = crypto.sign(
    "sha256",
    Buffer.from(payload, "utf8"),
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 222
    }
  ).toString("base64");
  return {
    ...unsigned,
    sequence_number: 1,
    signature
  };
}

async function main() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048
  });
  const publicPem = publicKey.export({ type: "spki", format: "pem" });

  const env = {
    AGE_VERIFICATION_PROVIDER: "yoti",
    YOTI_API_KEY: "test-api-key-do-not-log",
    YOTI_SDK_ID: "test-sdk-id-123456789",
    YOTI_TEMPLATE_ID: "3344111e-2e22-33ee-a4a4-6d7a89c9ea0a",
    YOTI_NOTIFICATION_PUBLIC_KEY: publicPem,
    YOTI_ADULT_INDUSTRY_ONBOARDING_VERIFIED: "true",
    YOTI_OVER_18_TEMPLATE_VERIFIED: "true",
    YOTI_NOTIFICATION_SIGNATURE_VERIFIED: "true",
    YOTI_VERIFICATION_VALID_DAYS: "365",
    PUBLIC_APP_ORIGIN: "https://unbound.example.invalid"
  };

  registerBuiltInAgeVerificationProviders();
  registerBuiltInAgeVerificationProviders();

  const config = getYotiConfig(env);
  assert.strictEqual(config.configured, true);
  assert.strictEqual(config.ttlSeconds, 900);
  assert.strictEqual(config.verificationValidDays, 365);

  for (const key of [
    "YOTI_ADULT_INDUSTRY_ONBOARDING_VERIFIED",
    "YOTI_OVER_18_TEMPLATE_VERIFIED",
    "YOTI_NOTIFICATION_SIGNATURE_VERIFIED"
  ]) {
    assert.strictEqual(
      getYotiConfig({ ...env, [key]: "false" }).configured,
      false,
      `${key} must fail closed until explicitly verified`
    );
  }

  const gateway = getAgeVerificationGatewayStatus(env);
  assert.strictEqual(gateway.provider, "yoti");
  assert.strictEqual(gateway.adapterInstalled, true);
  assert.strictEqual(gateway.configured, true);
  assert.strictEqual(gateway.minimumAge, 18);
  assert.strictEqual(gateway.startVerification, true);
  assert.strictEqual(gateway.webhooks, true);
  assert.strictEqual(gateway.storesRawIdentityEvidence, false);
  assert.strictEqual(gateway.storesBiometricTemplates, false);

  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 201,
      async text() {
        return JSON.stringify({ id: "def6fd14-dba9-4610-b6c3-9a7e8909aac0" });
      }
    };
  };

  try {
    const session = await startAgeVerificationSession({
      subject: "a".repeat(64),
      returnUrl: "https://unbound.example.invalid/age-complete",
      cancelUrl: "https://unbound.example.invalid/age-cancel",
      requestId: "request-123",
      env
    });

    assert.strictEqual(request.url, YOTI_SESSIONS_URL);
    assert.strictEqual(request.options.method, "POST");
    assert.strictEqual(request.options.headers.Authorization, `Bearer ${env.YOTI_API_KEY}`);
    assert.strictEqual(request.options.headers["Yoti-Sdk-Id"], env.YOTI_SDK_ID);
    const body = JSON.parse(request.options.body);
    assert.strictEqual(body.template_id, env.YOTI_TEMPLATE_ID);
    assert.strictEqual(body.ttl, 900);
    assert.strictEqual(body.reference_id, "a".repeat(64));
    assert.strictEqual(body.callback.url, "https://unbound.example.invalid/age-complete");
    assert.strictEqual(body.cancel_url, "https://unbound.example.invalid/age-cancel");
    assert.strictEqual(
      body.notification_url,
      "https://unbound.example.invalid/api/webhooks/age-verification"
    );
    assert.strictEqual(body.synchronous_checks, true);
    const serializedBody = JSON.stringify(body);
    for (const forbidden of ["email", "name", "address", "document", "biometric", "selfie"]) {
      assert.ok(!serializedBody.toLowerCase().includes(forbidden));
    }

    const verificationUrl = new URL(session.verificationUrl);
    assert.strictEqual(verificationUrl.origin, "https://age.yoti.com");
    assert.strictEqual(
      verificationUrl.searchParams.get("sessionId"),
      "def6fd14-dba9-4610-b6c3-9a7e8909aac0"
    );
    assert.strictEqual(verificationUrl.searchParams.get("sdkId"), env.YOTI_SDK_ID);
    assert.strictEqual(session.providerReference, "def6fd14-dba9-4610-b6c3-9a7e8909aac0");
    assert.strictEqual(session.status, "pending");
    assert.strictEqual(session.minimumAge, 18);
    assert.ok(!JSON.stringify(session).includes(env.YOTI_API_KEY));
  } finally {
    globalThis.fetch = originalFetch;
  }

  const notification = buildSignedNotification({ privateKey });
  const rawBody = Buffer.from(JSON.stringify(notification), "utf8");
  const parsedForSignature = JSON.parse(rawBody.toString("utf8"));
  const { sequence_number, signature, ...expectedSignedPayload } = parsedForSignature;
  assert.ok(sequence_number >= 0);
  assert.ok(signature);
  assert.strictEqual(
    notificationPayloadForSignature(parsedForSignature),
    JSON.stringify(expectedSignedPayload).replace(/\s/g, "")
  );
  assert.strictEqual(verifyNotificationSignature({ rawBody, env }), true);

  const event = await processAgeVerificationWebhook({
    rawBody,
    headers: {},
    env
  });
  assert.strictEqual(event.provider, "yoti");
  assert.strictEqual(event.providerReference, notification.session_key);
  assert.strictEqual(event.status, "verified");
  assert.strictEqual(event.minimumAge, 18);
  assert.ok(event.providerEventId.startsWith(`yoti:${notification.id}:1`));
  assert.ok(event.verifiedAt);
  assert.ok(event.expiresAt);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(event, "age"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(event, "reference_id"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(event, "signature"), false);
  assert.ok(!JSON.stringify(event).includes(notification.reference_id));

  const tampered = Buffer.from(
    JSON.stringify({ ...notification, result: false }),
    "utf8"
  );
  assert.strictEqual(verifyNotificationSignature({ rawBody: tampered, env }), false);
  await assert.rejects(
    () => processAgeVerificationWebhook({ rawBody: tampered, headers: {}, env }),
    (error) => error?.code === "AGE_VERIFICATION_WEBHOOK_SIGNATURE_INVALID"
  );

  assert.strictEqual(normalizeNotificationStatus({ state: "COMPLETE", result: true }), "verified");
  assert.strictEqual(normalizeNotificationStatus({ state: "COMPLETE", result: false }), "failed");
  assert.strictEqual(normalizeNotificationStatus({ state: "EXPIRED", result: false }), "expired");
  assert.strictEqual(normalizeNotificationStatus({ state: "PENDING" }), "pending");

  const startSource = fs.readFileSync(path.join(__dirname, "..", "start.js"), "utf8");
  assert.match(startSource, /registerBuiltInAgeVerificationProviders/);
  assert.match(startSource, /registerBuiltInAgeVerificationProviders\(\);/);
  const providerSource = fs.readFileSync(
    path.join(__dirname, "..", "age", "providers", "yoti.js"),
    "utf8"
  );
  assert.doesNotMatch(providerSource, /console\.(log|warn|error)/);
  assert.doesNotMatch(providerSource, /rawIdImage|biometricTemplate|documentImage/);

  console.log("Yoti hard-age verification contract passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
