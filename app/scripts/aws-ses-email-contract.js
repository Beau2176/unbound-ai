const assert = require("assert");
const {
  SES_SEND_PATH,
  DEFAULT_SUBJECT,
  getAwsSesConfig,
  isConfigured,
  formatAmzDate,
  buildVerificationMessage,
  buildSignedRequest,
  createAwsSesProvider
} = require("../email/providers/aws-ses");
const {
  getEmailGatewayStatus
} = require("../email/gateway");

const ENV = {
  EMAIL_PROVIDER: "aws-ses",
  AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
  AWS_SECRET_ACCESS_KEY: "test-secret-must-never-leak",
  AWS_SESSION_TOKEN: "test-session-token-must-never-leak",
  AWS_REGION: "us-east-2",
  EMAIL_FROM_ADDRESS: "verify@unbound.example",
  EMAIL_FROM_NAME: "UNBOUND AI",
  EMAIL_REPLY_TO_ADDRESS: "support@unbound.example"
};
const NOW = new Date("2026-09-12T19:30:45.000Z");
const VERIFICATION_URL = "https://unbound.example/verify-email#token=browser-only-secret";

async function main() {
  const config = getAwsSesConfig(ENV);
  assert.deepStrictEqual(config, {
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "test-secret-must-never-leak",
    sessionToken: "test-session-token-must-never-leak",
    region: "us-east-2",
    fromAddress: "verify@unbound.example",
    fromName: "UNBOUND AI",
    replyToAddress: "support@unbound.example"
  });
  assert.strictEqual(isConfigured(ENV), true);
  assert.strictEqual(isConfigured({ ...ENV, AWS_SECRET_ACCESS_KEY: "" }), false);
  assert.strictEqual(isConfigured({ ...ENV, EMAIL_FROM_ADDRESS: "not-an-email" }), false);
  assert.strictEqual(formatAmzDate(NOW), "20260912T193045Z");

  const message = buildVerificationMessage({
    toEmail: "Person@Example.com",
    displayName: '<Person & "Friend">',
    verificationUrl: VERIFICATION_URL,
    env: ENV
  });
  assert.strictEqual(message.FromEmailAddress, '"UNBOUND AI" <verify@unbound.example>');
  assert.deepStrictEqual(message.Destination.ToAddresses, ["person@example.com"]);
  assert.deepStrictEqual(message.ReplyToAddresses, ["support@unbound.example"]);
  assert.strictEqual(message.Content.Simple.Subject.Data, DEFAULT_SUBJECT);
  assert.ok(message.Content.Simple.Body.Text.Data.includes(VERIFICATION_URL));
  assert.ok(message.Content.Simple.Body.Html.Data.includes("browser-only-secret"));
  assert.ok(message.Content.Simple.Body.Html.Data.includes("&lt;Person &amp; &quot;Friend&quot;&gt;"));
  assert.ok(!JSON.stringify(message).includes(ENV.AWS_ACCESS_KEY_ID));
  assert.ok(!JSON.stringify(message).includes(ENV.AWS_SECRET_ACCESS_KEY));
  assert.ok(!JSON.stringify(message).includes(ENV.AWS_SESSION_TOKEN));

  const signed = buildSignedRequest({ payload: message, env: ENV, now: NOW });
  assert.strictEqual(
    signed.endpoint,
    `https://email.us-east-2.amazonaws.com${SES_SEND_PATH}`
  );
  assert.strictEqual(signed.headers["x-amz-date"], "20260912T193045Z");
  assert.strictEqual(signed.headers["x-amz-security-token"], ENV.AWS_SESSION_TOKEN);
  assert.match(
    signed.headers.authorization,
    /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260912\/us-east-2\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token, Signature=[a-f0-9]{64}$/
  );
  const signedAgain = buildSignedRequest({ payload: message, env: ENV, now: NOW });
  assert.strictEqual(
    signed.headers.authorization,
    signedAgain.headers.authorization,
    "Signature V4 output must be deterministic for the same inputs"
  );
  assert.ok(!signed.body.includes(ENV.AWS_SECRET_ACCESS_KEY));
  assert.ok(!signed.body.includes(ENV.AWS_SESSION_TOKEN));

  const requests = [];
  const provider = createAwsSesProvider({
    now: () => NOW,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return { MessageId: "provider-private-message-id" };
        }
      };
    }
  });

  const result = await provider.sendVerification({
    toEmail: "person@example.com",
    displayName: "Person",
    verificationUrl: VERIFICATION_URL,
    env: ENV
  });
  assert.deepStrictEqual(result, {
    accepted: true,
    providerMessageId: "provider-private-message-id"
  });
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, signed.endpoint);
  assert.strictEqual(requests[0].options.method, "POST");
  assert.strictEqual(requests[0].options.redirect, "error");
  assert.ok(!requests[0].options.body.includes(ENV.AWS_SECRET_ACCESS_KEY));
  assert.ok(!requests[0].options.body.includes(ENV.AWS_SESSION_TOKEN));

  const failedProvider = createAwsSesProvider({
    now: () => NOW,
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      async json() {
        return { message: "do-not-expose-provider-body" };
      }
    })
  });
  await assert.rejects(
    failedProvider.sendVerification({
      toEmail: "person@example.com",
      displayName: "Person",
      verificationUrl: VERIFICATION_URL,
      env: ENV
    }),
    (error) =>
      error?.code === "AWS_SES_SEND_FAILED" &&
      error?.statusCode === 403 &&
      !String(error?.message || "").includes("do-not-expose-provider-body")
  );

  const gatewayStatus = getEmailGatewayStatus(ENV);
  assert.deepStrictEqual(gatewayStatus, {
    provider: "aws-ses",
    configured: true,
    canSendVerification: true,
    error: null
  });
  assert.deepStrictEqual(
    getEmailGatewayStatus({ EMAIL_PROVIDER: "aws-ses" }),
    {
      provider: "aws-ses",
      configured: false,
      canSendVerification: false,
      error: "provider-not-configured"
    }
  );

  console.log("Amazon SES email adapter contract passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
