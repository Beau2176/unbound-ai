const assert = require("assert");
const {
  getSegpayAdvertisingConfig,
  createAdvertisingCheckoutToken,
  mapAdvertisingPaymentStatus,
  expectedBasicAuthorization,
  segpayAdvertisingAdapter
} = require("../advertising/providers/segpay");
const {
  getAdvertisingPaymentStatus,
  startAdvertisingCheckout,
  processAdvertisingWebhook
} = require("../advertising/gateway");

const SUBJECT = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const ENV = Object.freeze({
  ADVERTISING_PAYMENT_PROVIDER: "segpay",
  BILLING_PROVIDER: "segpay",
  SEGPAY_ADVERTISING_PAY_PAGE_REF: "unbound-ad-checkout",
  SEGPAY_ADVERTISING_SIGNING_KEY: "EXAMPLE000000000000000000000000000000000000=",
  SEGPAY_ADVERTISING_POSTBACK_USERNAME: "unbound-ad-postback",
  SEGPAY_ADVERTISING_POSTBACK_PASSWORD: "test-secret",
  SEGPAY_ADVERTISING_CURRENCY: "USD",
  SEGPAY_ADVERTISING_MERCHANT_APPROVAL_VERIFIED: "true",
  SEGPAY_ADVERTISING_ONE_TIME_PRICING_VERIFIED: "true",
  SEGPAY_ADVERTISING_SIGNED_FIELDS_VERIFIED: "true",
  SEGPAY_ADVERTISING_POSTBACK_AUTH_VERIFIED: "true"
});

function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  assert.strictEqual(parts.length, 3);
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
}

function postbackBody(overrides = {}) {
  const params = new URLSearchParams({
    ref1: SUBJECT.slice(0, 32),
    ref2: SUBJECT.slice(32),
    purchaseid: "purchase-123",
    tranid: "transaction-456",
    action: "auth",
    trantype: "sale",
    stage: "initial",
    approved: "yes",
    transtime: "9/13/2026 2:00:00 AM (GMT STANDARD TIME)",
    ...overrides
  });
  return Buffer.from(params.toString(), "utf8");
}

async function main() {
  const config = getSegpayAdvertisingConfig(ENV);
  assert.strictEqual(config.configured, true);
  assert.strictEqual(config.currency, "USD");

  const incomplete = getSegpayAdvertisingConfig({
    ...ENV,
    SEGPAY_ADVERTISING_ONE_TIME_PRICING_VERIFIED: "false"
  });
  assert.strictEqual(incomplete.configured, false);

  const token = createAdvertisingCheckoutToken({
    subject: SUBJECT,
    amountCents: 2500,
    currency: "USD",
    env: ENV,
    nowMs: 1700000000000,
    jti: "00000000-0000-4000-8000-000000000001"
  });
  const payload = decodeJwtPayload(token.token);
  assert.strictEqual(payload.pageref, ENV.SEGPAY_ADVERTISING_PAY_PAGE_REF);
  assert.strictEqual(payload.fields.amount, "25.00");
  assert.strictEqual(payload.fields.REF1, SUBJECT.slice(0, 32));
  assert.strictEqual(payload.fields.REF2, SUBJECT.slice(32));
  assert.strictEqual(payload.exp - payload.iat, 30 * 60);

  assert.strictEqual(mapAdvertisingPaymentStatus({ action: "auth", trantype: "sale", approved: "yes" }), "paid");
  assert.strictEqual(mapAdvertisingPaymentStatus({ action: "auth", trantype: "sale", approved: "no" }), "failed");
  assert.strictEqual(mapAdvertisingPaymentStatus({ action: "void", trantype: "sale", approved: "yes" }), "canceled");
  assert.strictEqual(mapAdvertisingPaymentStatus({ action: "auth", trantype: "credit", approved: "yes" }), "refunded");
  assert.strictEqual(mapAdvertisingPaymentStatus({ action: "auth", trantype: "charge", approved: "yes" }), "refunded");
  assert.strictEqual(mapAdvertisingPaymentStatus({ action: "auth", trantype: "revoke", approved: "yes" }), "refunded");
  assert.strictEqual(mapAdvertisingPaymentStatus({ action: "auth", trantype: "rdrreversal", approved: "yes" }), "refunded");
  assert.strictEqual(mapAdvertisingPaymentStatus({ action: "auth", trantype: "cbreversal", approved: "yes" }), "paid");
  assert.strictEqual(mapAdvertisingPaymentStatus({ action: "cancel", trantype: "sale" }), null);

  const explicitOff = getAdvertisingPaymentStatus({
    ...ENV,
    ADVERTISING_PAYMENT_PROVIDER: "",
    BILLING_PROVIDER: "segpay"
  });
  assert.strictEqual(explicitOff.provider, null);
  assert.strictEqual(explicitOff.configured, false);
  assert.strictEqual(explicitOff.state, "provider-not-selected");

  const status = getAdvertisingPaymentStatus(ENV);
  assert.strictEqual(status.provider, "segpay");
  assert.strictEqual(status.adapterInstalled, true);
  assert.strictEqual(status.configured, true);
  assert.strictEqual(status.checkout, true);
  assert.strictEqual(status.webhooks, true);
  assert.strictEqual(segpayAdvertisingAdapter.capabilities.checkout, true);

  const checkout = await startAdvertisingCheckout({
    subject: SUBJECT,
    email: "ads@example.com",
    packageCode: "starter",
    amountCents: 2500,
    currency: "USD",
    successUrl: "https://unbound.example/advertisers.html?payment=success",
    cancelUrl: "https://unbound.example/advertisers.html?payment=canceled",
    env: ENV
  });
  assert.strictEqual(checkout.provider, "segpay");
  const checkoutUrl = new URL(checkout.checkoutUrl);
  assert.strictEqual(checkoutUrl.origin, "https://pay.segpay.com");
  assert.strictEqual(checkoutUrl.pathname, `/${ENV.SEGPAY_ADVERTISING_PAY_PAGE_REF}`);
  const checkoutPayload = decodeJwtPayload(checkoutUrl.searchParams.get("jwt"));
  assert.strictEqual(checkoutPayload.fields.amount, "25.00");
  assert.strictEqual(checkoutPayload.fields.REF1 + checkoutPayload.fields.REF2, SUBJECT);

  await assert.rejects(
    () => startAdvertisingCheckout({
      subject: SUBJECT,
      email: "ads@example.com",
      packageCode: "starter",
      amountCents: 2500,
      currency: "EUR",
      env: ENV
    }),
    (error) => error.code === "SEGPAY_ADVERTISING_AMOUNT_INVALID"
  );

  const authorization = expectedBasicAuthorization(ENV);
  assert.ok(authorization.startsWith("Basic "));

  await assert.rejects(
    () => processAdvertisingWebhook({
      rawBody: postbackBody(),
      headers: { authorization: "Basic invalid" },
      env: ENV
    }),
    (error) => error.code === "ADVERTISING_WEBHOOK_SIGNATURE_INVALID"
  );

  const paid = await processAdvertisingWebhook({
    rawBody: postbackBody(),
    headers: { authorization },
    env: ENV
  });
  assert.strictEqual(paid.provider, "segpay");
  assert.strictEqual(paid.subject, SUBJECT);
  assert.strictEqual(paid.paymentStatus, "paid");
  assert.ok(paid.providerEventId.startsWith("segpay:purchase-123:transaction-456:"));
  assert.ok(paid.eventType.includes("transaction.sale.auth.initial"));

  const refunded = await processAdvertisingWebhook({
    rawBody: postbackBody({
      trantype: "credit",
      tranid: "refund-789",
      approved: "yes"
    }),
    headers: { authorization },
    env: ENV
  });
  assert.strictEqual(refunded.paymentStatus, "refunded");

  const queryPaid = await processAdvertisingWebhook({
    rawBody: Buffer.from(""),
    query: Object.fromEntries(new URLSearchParams(postbackBody().toString("utf8"))),
    headers: { authorization },
    env: ENV
  });
  assert.strictEqual(queryPaid.paymentStatus, "paid");

  console.log("PASS Segpay advertising contract: explicit provider opt-in, signed one-time amounts/references, authenticated postbacks, and one-time payment lifecycle mapping.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
