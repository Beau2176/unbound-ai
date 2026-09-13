const assert = require("assert");
const {
  CONSUMER_PORTAL_URL,
  getSegpayConfig,
  signJwtHs256,
  createCheckoutToken,
  parsePostbackParameters,
  parseSegpayTimestamp,
  mapSubscriptionState,
  segpayBillingAdapter
} = require("../billing/providers/segpay");
const {
  getBillingGatewayStatus,
  startBillingCheckoutSession,
  startBillingCustomerPortalSession,
  processBillingWebhook
} = require("../billing/gateway");

const subject = "a".repeat(32) + "b".repeat(32);
const baseEnv = {
  BILLING_PROVIDER: "segpay",
  SEGPAY_PAY_PAGE_REF: "37477-09876",
  SEGPAY_SIGNING_KEY: "EXAMPLE000000000000000000000000000000000000=",
  SEGPAY_TOP_AMOUNT: "29.99",
  SEGPAY_POSTBACK_USERNAME: "unbound-postback",
  SEGPAY_POSTBACK_PASSWORD: "strong-postback-password",
  SEGPAY_MERCHANT_APPROVAL_VERIFIED: "true",
  SEGPAY_SIGNED_CHECKOUT_FIELDS_VERIFIED: "true",
  SEGPAY_POSTBACK_AUTH_VERIFIED: "true"
};

function authorization(env = baseEnv) {
  return `Basic ${Buffer.from(
    `${env.SEGPAY_POSTBACK_USERNAME}:${env.SEGPAY_POSTBACK_PASSWORD}`,
    "utf8"
  ).toString("base64")}`;
}

function decodeJwtPayload(token) {
  const parts = String(token).split(".");
  assert.strictEqual(parts.length, 3);
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
}

async function main() {
  const config = getSegpayConfig(baseEnv);
  assert.strictEqual(config.configured, true);
  assert.strictEqual(config.topAmount, "29.99");

  for (const key of [
    "SEGPAY_MERCHANT_APPROVAL_VERIFIED",
    "SEGPAY_SIGNED_CHECKOUT_FIELDS_VERIFIED",
    "SEGPAY_POSTBACK_AUTH_VERIFIED"
  ]) {
    const env = { ...baseEnv, [key]: "false" };
    assert.strictEqual(
      getSegpayConfig(env).configured,
      false,
      `${key} must fail closed until explicitly verified`
    );
  }

  const vectorPayload = {
    iat: 1700000000,
    exp: 1700001800,
    jti: "00000000-0000-4000-8000-000000000001",
    pageref: "acme-checkout-1",
    fields: { amount: "29.99" }
  };
  const vector = signJwtHs256({
    payload: vectorPayload,
    signingKey: "EXAMPLE000000000000000000000000000000000000="
  });
  assert.strictEqual(
    vector,
    "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTcwMDAwMTgwMCwianRpIjoiMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwicGFnZXJlZiI6ImFjbWUtY2hlY2tvdXQtMSIsImZpZWxkcyI6eyJhbW91bnQiOiIyOS45OSJ9fQ.ZWQ54K_a4GjpKnAdViZ9V4cJ9adu_Lf7bmCkiJL9blA",
    "HS256 implementation must match Segpay's published test vector exactly"
  );

  const directToken = createCheckoutToken({
    subject,
    env: baseEnv,
    nowMs: 1700000000000,
    jti: "00000000-0000-4000-8000-000000000002"
  });
  const directPayload = decodeJwtPayload(directToken.token);
  assert.strictEqual(directPayload.pageref, baseEnv.SEGPAY_PAY_PAGE_REF);
  assert.strictEqual(directPayload.fields.amount, "29.99");
  assert.strictEqual(directPayload.fields.REF1, "a".repeat(32));
  assert.strictEqual(directPayload.fields.REF2, "b".repeat(32));
  assert.ok(!JSON.stringify(directPayload).includes("@"));
  assert.ok(!JSON.stringify(directPayload).includes(baseEnv.SEGPAY_SIGNING_KEY));

  const gateway = getBillingGatewayStatus(baseEnv);
  assert.strictEqual(gateway.provider, "segpay");
  assert.strictEqual(gateway.adapterInstalled, true);
  assert.strictEqual(gateway.configured, true);
  assert.strictEqual(gateway.checkout, true);
  assert.strictEqual(gateway.customerPortal, true);
  assert.strictEqual(gateway.webhooks, true);

  const checkout = await startBillingCheckoutSession({
    subject,
    email: "owner@example.com",
    planTier: "top",
    successUrl: "https://unbound.example.invalid/billing/success",
    cancelUrl: "https://unbound.example.invalid/billing/cancel",
    env: baseEnv
  });
  const checkoutUrl = new URL(checkout.checkoutUrl);
  assert.strictEqual(checkoutUrl.origin, "https://pay.segpay.com");
  assert.strictEqual(checkoutUrl.pathname, `/${baseEnv.SEGPAY_PAY_PAGE_REF}`);
  const checkoutJwt = checkoutUrl.searchParams.get("jwt");
  assert.ok(checkoutJwt);
  const checkoutPayload = decodeJwtPayload(checkoutJwt);
  assert.strictEqual(checkoutPayload.fields.REF1, "a".repeat(32));
  assert.strictEqual(checkoutPayload.fields.REF2, "b".repeat(32));
  assert.ok(!JSON.stringify(checkoutPayload).includes("owner@example.com"));
  assert.ok(!checkout.checkoutUrl.includes(baseEnv.SEGPAY_SIGNING_KEY));

  const portal = await startBillingCustomerPortalSession({
    subject,
    email: "owner@example.com",
    providerCustomerId: "SP12345678",
    returnUrl: "https://unbound.example.invalid/account",
    env: baseEnv
  });
  assert.strictEqual(portal.portalUrl, CONSUMER_PORTAL_URL);
  assert.ok(!JSON.stringify(portal).includes("owner@example.com"));
  assert.ok(!JSON.stringify(portal).includes("SP12345678"));

  assert.strictEqual(
    await segpayBillingAdapter.verifyWebhook({
      headers: { authorization: authorization() },
      env: baseEnv
    }),
    true
  );
  assert.strictEqual(
    await segpayBillingAdapter.verifyWebhook({
      headers: { authorization: "Basic invalid" },
      env: baseEnv
    }),
    false
  );

  const transactionBody = new URLSearchParams({
    action: "Auth",
    stage: "Initial",
    approved: "Yes",
    trantype: "Sale",
    purchaseid: "SP12345678",
    tranid: "T9876543",
    paymentaccountid: "PAYMENT-ACCOUNT-OPAQUE",
    transtime: "7/28/2024 3:38:43 PM (GMT STANDARD TIME)",
    rint: "30",
    REF1: "a".repeat(32),
    REF2: "b".repeat(32)
  }).toString();

  const webhook = await processBillingWebhook({
    rawBody: Buffer.from(transactionBody, "utf8"),
    headers: { authorization: authorization() },
    env: baseEnv
  });
  assert.strictEqual(webhook.provider, "segpay");
  assert.strictEqual(webhook.subject, subject);
  assert.strictEqual(webhook.providerSubscriptionId, "SP12345678");
  assert.strictEqual(webhook.providerCustomerId, "PAYMENT-ACCOUNT-OPAQUE");
  assert.strictEqual(webhook.status, "active");
  assert.strictEqual(webhook.planTier, "top");
  assert.strictEqual(webhook.cancelAtPeriodEnd, false);
  assert.strictEqual(webhook.occurredAt, "2024-07-28T15:38:43.000Z");
  assert.strictEqual(webhook.currentPeriodEnd, "2024-08-27T15:38:43.000Z");
  assert.ok(!JSON.stringify(webhook).includes(baseEnv.SEGPAY_POSTBACK_PASSWORD));

  const cancellation = await processBillingWebhook({
    rawBody: Buffer.alloc(0),
    query: {
      action: "Cancel",
      purchaseid: "SP12345678",
      REF1: "a".repeat(32),
      REF2: "b".repeat(32)
    },
    headers: { authorization: authorization() },
    env: baseEnv
  });
  assert.strictEqual(cancellation.status, "active");
  assert.strictEqual(cancellation.cancelAtPeriodEnd, true);
  assert.strictEqual(cancellation.providerSubscriptionId, "SP12345678");

  const disabled = await processBillingWebhook({
    rawBody: Buffer.alloc(0),
    query: {
      action: "Disable",
      purchaseid: "SP12345678",
      REF1: "a".repeat(32),
      REF2: "b".repeat(32)
    },
    headers: { authorization: authorization() },
    env: baseEnv
  });
  assert.strictEqual(disabled.status, "canceled");
  assert.strictEqual(disabled.cancelAtPeriodEnd, false);

  const rebillDecline = mapSubscriptionState({
    action: "Auth",
    trantype: "Sale",
    stage: "Rebill",
    approved: "No"
  });
  assert.deepStrictEqual(rebillDecline, {
    status: "past_due",
    cancelAtPeriodEnd: false
  });

  const chargeback = mapSubscriptionState({
    action: "Auth",
    trantype: "Charge",
    stage: "Initial",
    approved: "Yes"
  });
  assert.deepStrictEqual(chargeback, {
    status: "canceled",
    cancelAtPeriodEnd: false
  });

  await assert.rejects(
    () => processBillingWebhook({
      rawBody: Buffer.from(transactionBody, "utf8"),
      headers: { authorization: "Basic invalid" },
      env: baseEnv
    }),
    (error) => error?.code === "BILLING_WEBHOOK_SIGNATURE_INVALID"
  );

  assert.throws(
    () => parsePostbackParameters({
      rawBody: Buffer.from("action=Auth", "utf8"),
      query: { action: "Cancel" }
    }),
    (error) => error?.code === "SEGPAY_POSTBACK_PARAMETER_CONFLICT"
  );

  assert.strictEqual(
    parseSegpayTimestamp("7/28/2024 3:38:43 PM (GMT STANDARD TIME)"),
    "2024-07-28T15:38:43.000Z"
  );

  const originalTimezone = process.env.TZ;
  try {
    for (const timezone of ["UTC", "Asia/Tokyo", "America/Denver"]) {
      process.env.TZ = timezone;
      assert.strictEqual(
        parseSegpayTimestamp("7/28/2024 3:38:43 PM (GMT STANDARD TIME)"),
        "2024-07-28T15:38:43.000Z"
      );
      assert.strictEqual(parseSegpayTimestamp("2024-07-28T15:38:43Z"), "2024-07-28T15:38:43.000Z");
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
  console.log("Segpay billing adapter contract passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
