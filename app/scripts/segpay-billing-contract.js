const assert = require("assert");
const {
  CONSUMER_PORTAL_URL,
  PLAN_PRICES,
  getSegpayConfig,
  signJwtHs256,
  createCheckoutToken,
  parsePostbackParameters,
  planFromPostback,
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
  SEGPAY_PREMIUM_PAY_PAGE_REF: "premium-5999",
  SEGPAY_ULTRA_PAY_PAGE_REF: "ultra-11499",
  SEGPAY_SIGNING_KEY: "EXAMPLE000000000000000000000000000000000000=",
  SEGPAY_POSTBACK_USERNAME: "unbound-postback",
  SEGPAY_POSTBACK_PASSWORD: "strong-postback-password",
  SEGPAY_MERCHANT_APPROVAL_VERIFIED: "true",
  SEGPAY_SIGNED_CHECKOUT_FIELDS_VERIFIED: "true",
  SEGPAY_POSTBACK_AUTH_VERIFIED: "true"
};

function authorization(env = baseEnv) {
  return `Basic ${Buffer.from(`${env.SEGPAY_POSTBACK_USERNAME}:${env.SEGPAY_POSTBACK_PASSWORD}`, "utf8").toString("base64")}`;
}

function decodeJwtPayload(token) {
  const parts = String(token).split(".");
  assert.strictEqual(parts.length, 3);
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
}

function transactionBody({ amount = "114.99", action = "Auth", stage = "Initial", approved = "Yes", trantype = "Sale" } = {}) {
  return new URLSearchParams({
    action,
    stage,
    approved,
    trantype,
    amount,
    purchaseid: "SP12345678",
    tranid: `T-${amount}-${action}`,
    paymentaccountid: "PAYMENT-ACCOUNT-OPAQUE",
    transtime: "7/28/2024 3:38:43 PM (GMT STANDARD TIME)",
    rint: "30",
    REF1: "a".repeat(32),
    REF2: "b".repeat(32)
  }).toString();
}

async function main() {
  assert.deepStrictEqual(PLAN_PRICES, { premium: "59.99", ultra: "114.99" });
  const config = getSegpayConfig(baseEnv);
  assert.strictEqual(config.configured, true);
  assert.strictEqual(config.plans.premium.amount, "59.99");
  assert.strictEqual(config.plans.ultra.amount, "114.99");
  assert.strictEqual(config.plans.premium.payPageRef, "premium-5999");
  assert.strictEqual(config.plans.ultra.payPageRef, "ultra-11499");

  for (const key of [
    "SEGPAY_MERCHANT_APPROVAL_VERIFIED",
    "SEGPAY_SIGNED_CHECKOUT_FIELDS_VERIFIED",
    "SEGPAY_POSTBACK_AUTH_VERIFIED"
  ]) {
    assert.strictEqual(getSegpayConfig({ ...baseEnv, [key]: "false" }).configured, false);
  }
  assert.strictEqual(getSegpayConfig({ ...baseEnv, SEGPAY_PREMIUM_PAY_PAGE_REF: "" }).configured, false);
  assert.strictEqual(getSegpayConfig({ ...baseEnv, SEGPAY_ULTRA_PAY_PAGE_REF: "" }).configured, false);

  const vectorPayload = {
    iat: 1700000000,
    exp: 1700001800,
    jti: "00000000-0000-4000-8000-000000000001",
    pageref: "acme-checkout-1",
    fields: { amount: "29.99" }
  };
  const vector = signJwtHs256({ payload: vectorPayload, signingKey: baseEnv.SEGPAY_SIGNING_KEY });
  assert.strictEqual(
    vector,
    "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTcwMDAwMTgwMCwianRpIjoiMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwicGFnZXJlZiI6ImFjbWUtY2hlY2tvdXQtMSIsImZpZWxkcyI6eyJhbW91bnQiOiIyOS45OSJ9fQ.ZWQ54K_a4GjpKnAdViZ9V4cJ9adu_Lf7bmCkiJL9blA"
  );

  for (const planTier of ["premium", "ultra"]) {
    const directToken = createCheckoutToken({
      subject,
      planTier,
      env: baseEnv,
      nowMs: 1700000000000,
      jti: `00000000-0000-4000-8000-00000000000${planTier === "premium" ? "2" : "3"}`
    });
    const directPayload = decodeJwtPayload(directToken.token);
    assert.strictEqual(directPayload.pageref, baseEnv[planTier === "premium" ? "SEGPAY_PREMIUM_PAY_PAGE_REF" : "SEGPAY_ULTRA_PAY_PAGE_REF"]);
    assert.strictEqual(directPayload.fields.amount, PLAN_PRICES[planTier]);
    assert.strictEqual(directPayload.fields.REF1, "a".repeat(32));
    assert.strictEqual(directPayload.fields.REF2, "b".repeat(32));

    const checkout = await startBillingCheckoutSession({
      subject,
      email: "owner@example.com",
      planTier,
      env: baseEnv
    });
    const url = new URL(checkout.checkoutUrl);
    assert.strictEqual(url.origin, "https://pay.segpay.com");
    assert.strictEqual(url.pathname, `/${directPayload.pageref}`);
    const payload = decodeJwtPayload(url.searchParams.get("jwt"));
    assert.strictEqual(payload.fields.amount, PLAN_PRICES[planTier]);
    assert.strictEqual(checkout.planTier, planTier);
    assert.ok(!checkout.checkoutUrl.includes(baseEnv.SEGPAY_SIGNING_KEY));
    assert.ok(!JSON.stringify(payload).includes("owner@example.com"));
  }

  const legacy = await startBillingCheckoutSession({ subject, email: "owner@example.com", planTier: "top", env: baseEnv });
  assert.strictEqual(legacy.planTier, "ultra");
  assert.strictEqual(new URL(legacy.checkoutUrl).pathname, `/${baseEnv.SEGPAY_ULTRA_PAY_PAGE_REF}`);

  const gateway = getBillingGatewayStatus(baseEnv);
  assert.strictEqual(gateway.configured, true);
  assert.deepStrictEqual(gateway.paidPlans, ["premium", "ultra"]);

  const portal = await startBillingCustomerPortalSession({
    subject,
    email: "owner@example.com",
    providerCustomerId: "SP12345678",
    env: baseEnv
  });
  assert.strictEqual(portal.portalUrl, CONSUMER_PORTAL_URL);
  assert.ok(!JSON.stringify(portal).includes("SP12345678"));

  assert.strictEqual(await segpayBillingAdapter.verifyWebhook({ headers: { authorization: authorization() }, env: baseEnv }), true);
  assert.strictEqual(await segpayBillingAdapter.verifyWebhook({ headers: { authorization: "Basic invalid" }, env: baseEnv }), false);

  for (const [amount, expectedPlan] of [["59.99", "premium"], ["114.99", "ultra"]]) {
    assert.strictEqual(planFromPostback({ amount }), expectedPlan);
    const webhook = await processBillingWebhook({
      rawBody: Buffer.from(transactionBody({ amount }), "utf8"),
      headers: { authorization: authorization() },
      env: baseEnv
    });
    assert.strictEqual(webhook.status, "active");
    assert.strictEqual(webhook.planTier, expectedPlan);
    assert.strictEqual(webhook.subject, subject);
  }
  assert.strictEqual(planFromPostback({ amount: "99.99" }), null);

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
  assert.strictEqual(cancellation.planTier, null, "planless lifecycle event must preserve existing DB plan");

  assert.deepStrictEqual(mapSubscriptionState({ action: "Auth", trantype: "Sale", stage: "Rebill", approved: "No" }), {
    status: "past_due",
    cancelAtPeriodEnd: false
  });
  assert.deepStrictEqual(mapSubscriptionState({ action: "Auth", trantype: "Charge", stage: "Initial", approved: "Yes" }), {
    status: "canceled",
    cancelAtPeriodEnd: false
  });

  await assert.rejects(
    () => processBillingWebhook({
      rawBody: Buffer.from(transactionBody(), "utf8"),
      headers: { authorization: "Basic invalid" },
      env: baseEnv
    }),
    (error) => error?.code === "BILLING_WEBHOOK_SIGNATURE_INVALID"
  );

  assert.throws(
    () => parsePostbackParameters({ rawBody: Buffer.from("action=Auth", "utf8"), query: { action: "Cancel" } }),
    (error) => error?.code === "SEGPAY_POSTBACK_PARAMETER_CONFLICT"
  );

  assert.strictEqual(parseSegpayTimestamp("7/28/2024 3:38:43 PM (GMT STANDARD TIME)"), "2024-07-28T15:38:43.000Z");
  console.log("Segpay Premium/Ultra billing adapter contract passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
