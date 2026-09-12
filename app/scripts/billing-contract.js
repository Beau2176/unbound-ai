const assert = require("assert");
const {
  registerBillingAdapter,
  getBillingGatewayStatus,
  startBillingCheckoutSession,
  startBillingPortalSession,
  processBillingWebhook
} = require("../billing/gateway");

const provider = "contract-billing";
let checkoutInput = null;
let portalInput = null;
let webhookVerified = false;
let webhookParsed = false;

registerBillingAdapter(provider, {
  capabilities: {
    checkout: true,
    customerPortal: true,
    webhooks: true
  },
  isConfigured(env) {
    return env.BILLING_CONTRACT_KEY === "configured";
  },
  async startCheckout(input) {
    checkoutInput = input;
    return {
      checkoutUrl: "https://pay.example.invalid/checkout/session_123",
      customerReference: "cus_contract_123",
      subscriptionReference: "sub_contract_123",
      status: "active",
      cardNumber: "4111111111111111",
      paymentMethod: { secret: "DO_NOT_RETAIN" },
      apiSecret: "DO_NOT_RETAIN"
    };
  },
  async startCustomerPortal(input) {
    portalInput = input;
    return {
      portalUrl: "https://pay.example.invalid/portal/session_456",
      cardData: "DO_NOT_RETAIN"
    };
  },
  async verifyWebhook({ rawBody, headers }) {
    webhookVerified = true;
    assert.ok(Buffer.isBuffer(rawBody));
    assert.equal(rawBody.toString("utf8"), '{"event":"subscription.updated"}');
    return headers["x-contract-signature"] === "valid-signature";
  },
  async parseWebhook() {
    webhookParsed = true;
    assert.equal(webhookVerified, true, "Billing webhook must verify before parse");
    return {
      eventId: "evt_contract_billing_001",
      eventType: "subscription.updated",
      status: "active",
      subject: "b".repeat(64),
      customerReference: "cus_contract_123",
      subscriptionReference: "sub_contract_123",
      currentPeriodStart: "2026-09-12T17:00:00Z",
      currentPeriodEnd: "2026-10-12T17:00:00Z",
      cancelAtPeriodEnd: false,
      occurredAt: "2026-09-12T17:10:00Z",
      cardNumber: "4111111111111111",
      paymentMethod: { secret: "DO_NOT_RETAIN" },
      apiSecret: "DO_NOT_RETAIN"
    };
  }
});

async function main() {
  const missing = getBillingGatewayStatus({});
  assert.equal(missing.configured, false);
  assert.equal(missing.state, "provider-not-selected");

  const notConfigured = getBillingGatewayStatus({ BILLING_PROVIDER: provider });
  assert.equal(notConfigured.adapterInstalled, true);
  assert.equal(notConfigured.configured, false);
  assert.equal(notConfigured.checkout, false);
  assert.equal(notConfigured.customerPortal, false);
  assert.equal(notConfigured.webhooks, false);

  const env = {
    BILLING_PROVIDER: provider,
    BILLING_CONTRACT_KEY: "configured"
  };
  const ready = getBillingGatewayStatus(env);
  assert.equal(ready.configured, true);
  assert.equal(ready.checkout, true);
  assert.equal(ready.customerPortal, true);
  assert.equal(ready.webhooks, true);

  const subject = "b".repeat(64);
  const checkout = await startBillingCheckoutSession({
    subject,
    planTier: "top",
    successUrl: "https://unbound.example.invalid/billing/success",
    cancelUrl: "https://unbound.example.invalid/billing/cancel",
    requestId: "checkout-request-id",
    env
  });
  assert.equal(checkoutInput.subject, subject);
  assert.equal(checkoutInput.planTier, "top");
  assert.equal(checkoutInput.requestId, "checkout-request-id");
  assert.equal(checkout.provider, provider);
  assert.equal(checkout.planTier, "top");
  assert.equal(checkout.checkoutUrl, "https://pay.example.invalid/checkout/session_123");
  assert.equal(checkout.customerReference, "cus_contract_123");
  assert.equal(checkout.subscriptionReference, "sub_contract_123");
  const checkoutSerialized = JSON.stringify(checkout);
  for (const forbidden of ["4111111111111111", "DO_NOT_RETAIN", "cardNumber", "paymentMethod", "apiSecret", '"status"']) {
    assert.ok(!checkoutSerialized.includes(forbidden), `Checkout provider-only field leaked: ${forbidden}`);
  }

  const portal = await startBillingPortalSession({
    customerReference: "cus_contract_123",
    returnUrl: "https://unbound.example.invalid/account",
    requestId: "portal-request-id",
    env
  });
  assert.equal(portalInput.customerReference, "cus_contract_123");
  assert.equal(portalInput.requestId, "portal-request-id");
  assert.equal(portal.portalUrl, "https://pay.example.invalid/portal/session_456");
  assert.ok(!JSON.stringify(portal).includes("DO_NOT_RETAIN"));

  const webhook = await processBillingWebhook({
    rawBody: Buffer.from('{"event":"subscription.updated"}'),
    headers: { "x-contract-signature": "valid-signature" },
    requestId: "billing-webhook-request-id",
    env
  });
  assert.equal(webhookVerified, true);
  assert.equal(webhookParsed, true);
  assert.equal(webhook.provider, provider);
  assert.equal(webhook.providerEventId, "evt_contract_billing_001");
  assert.equal(webhook.status, "active");
  assert.equal(webhook.planTier, "top");
  assert.equal(webhook.subject, subject);
  assert.equal(webhook.currentPeriodEnd, "2026-10-12T17:00:00.000Z");
  const webhookSerialized = JSON.stringify(webhook);
  for (const forbidden of ["4111111111111111", "DO_NOT_RETAIN", "cardNumber", "paymentMethod", "apiSecret"]) {
    assert.ok(!webhookSerialized.includes(forbidden), `Billing webhook provider-only field leaked: ${forbidden}`);
  }

  webhookVerified = false;
  webhookParsed = false;
  await assert.rejects(
    () => processBillingWebhook({
      rawBody: Buffer.from('{"event":"subscription.updated"}'),
      headers: { "x-contract-signature": "invalid" },
      env
    }),
    (error) => error?.code === "BILLING_WEBHOOK_SIGNATURE_INVALID" && error?.statusCode === 401
  );
  assert.equal(webhookVerified, true);
  assert.equal(webhookParsed, false, "Invalid billing webhook must not be parsed");

  registerBillingAdapter("bad-url-billing", {
    capabilities: { checkout: true, customerPortal: true, webhooks: false },
    isConfigured: () => true,
    startCheckout: async () => ({ checkoutUrl: "http://insecure.example.invalid/checkout" }),
    startCustomerPortal: async () => ({ portalUrl: "http://insecure.example.invalid/portal" })
  });
  await assert.rejects(
    () => startBillingCheckoutSession({
      subject,
      env: { BILLING_PROVIDER: "bad-url-billing" }
    }),
    (error) => error?.code === "BILLING_PROVIDER_RESPONSE_INVALID"
  );
  await assert.rejects(
    () => startBillingPortalSession({
      customerReference: "cus_bad",
      env: { BILLING_PROVIDER: "bad-url-billing" }
    }),
    (error) => error?.code === "BILLING_PROVIDER_RESPONSE_INVALID"
  );

  console.log("PASS billing adapter contract: privacy-minimized checkout/portal and authenticated subscription webhooks.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
