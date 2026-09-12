const assert = require("assert");
const {
  registerBillingAdapter,
  getBillingGatewayStatus,
  startBillingCheckoutSession,
  startBillingCustomerPortalSession,
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
      checkoutUrl: "https://billing.example.invalid/checkout/session-123",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      apiSecret: "DO_NOT_LEAK",
      rawPaymentMethod: "DO_NOT_LEAK"
    };
  },
  async startCustomerPortal(input) {
    portalInput = input;
    return {
      portalUrl: "https://billing.example.invalid/portal/session-456",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      secret: "DO_NOT_LEAK"
    };
  },
  async verifyWebhook({ rawBody, headers }) {
    webhookVerified = true;
    assert.ok(Buffer.isBuffer(rawBody));
    return headers["x-contract-signature"] === "valid";
  },
  async parseWebhook() {
    webhookParsed = true;
    assert.equal(webhookVerified, true, "Webhook must be signature-verified before parsing");
    return {
      eventId: "evt_billing_001",
      eventType: "subscription.updated",
      subject: "subject-opaque-123",
      customerId: "cust_provider_123",
      subscriptionId: "sub_provider_456",
      status: "active",
      planTier: "top",
      currentPeriodStart: "2026-09-12T17:00:00Z",
      currentPeriodEnd: "2026-10-12T17:00:00Z",
      cancelAtPeriodEnd: false,
      occurredAt: "2026-09-12T17:15:00Z",
      cardNumber: "DO_NOT_LEAK",
      secret: "DO_NOT_LEAK"
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

  const checkout = await startBillingCheckoutSession({
    subject: "subject-opaque-123",
    email: "USER@example.com",
    planTier: "top",
    successUrl: "https://unbound.example.invalid/billing/success",
    cancelUrl: "https://unbound.example.invalid/billing/cancel",
    requestId: "request-123",
    env
  });
  assert.equal(checkoutInput.subject, "subject-opaque-123");
  assert.equal(checkoutInput.email, "user@example.com");
  assert.equal(checkoutInput.planTier, "top");
  assert.equal(checkout.provider, provider);
  assert.ok(checkout.checkoutUrl.startsWith("https://"));
  assert.ok(!JSON.stringify(checkout).includes("DO_NOT_LEAK"));

  const portal = await startBillingCustomerPortalSession({
    subject: "subject-opaque-123",
    email: "user@example.com",
    providerCustomerId: "cust_provider_123",
    returnUrl: "https://unbound.example.invalid/account",
    requestId: "request-456",
    env
  });
  assert.equal(portalInput.providerCustomerId, "cust_provider_123");
  assert.equal(portal.provider, provider);
  assert.ok(portal.portalUrl.startsWith("https://"));
  assert.ok(!JSON.stringify(portal).includes("cust_provider_123"));
  assert.ok(!JSON.stringify(portal).includes("DO_NOT_LEAK"));

  const webhook = await processBillingWebhook({
    rawBody: Buffer.from('{"type":"subscription.updated"}'),
    headers: { "x-contract-signature": "valid" },
    requestId: "webhook-request",
    env
  });
  assert.equal(webhookVerified, true);
  assert.equal(webhookParsed, true);
  assert.equal(webhook.providerEventId, "evt_billing_001");
  assert.equal(webhook.subject, "subject-opaque-123");
  assert.equal(webhook.status, "active");
  assert.equal(webhook.planTier, "top");
  assert.equal(webhook.cancelAtPeriodEnd, false);
  assert.ok(!JSON.stringify(webhook).includes("DO_NOT_LEAK"));

  webhookVerified = false;
  webhookParsed = false;
  await assert.rejects(
    () => processBillingWebhook({
      rawBody: Buffer.from("{}"),
      headers: { "x-contract-signature": "invalid" },
      env
    }),
    (error) => error?.code === "BILLING_WEBHOOK_SIGNATURE_INVALID" && error?.statusCode === 401
  );
  assert.equal(webhookVerified, true);
  assert.equal(webhookParsed, false, "Invalid webhook must not be parsed");

  registerBillingAdapter("insecure-billing", {
    capabilities: { checkout: true, customerPortal: true, webhooks: false },
    isConfigured: () => true,
    startCheckout: async () => ({ checkoutUrl: "http://insecure.example.invalid/checkout" }),
    startCustomerPortal: async () => ({ portalUrl: "javascript:alert(1)" })
  });

  await assert.rejects(
    () => startBillingCheckoutSession({
      subject: "opaque",
      email: "user@example.com",
      planTier: "top",
      env: { BILLING_PROVIDER: "insecure-billing" }
    }),
    (error) => error?.code === "BILLING_PROVIDER_RESPONSE_INVALID" && error?.statusCode === 502
  );

  await assert.rejects(
    () => startBillingCustomerPortalSession({
      subject: "opaque",
      email: "user@example.com",
      providerCustomerId: "cust_123",
      env: { BILLING_PROVIDER: "insecure-billing" }
    }),
    (error) => error?.code === "BILLING_PROVIDER_RESPONSE_INVALID" && error?.statusCode === 502
  );

  await assert.rejects(
    () => startBillingCheckoutSession({
      subject: "opaque",
      email: "user@example.com",
      planTier: "free",
      env
    }),
    (error) => error?.code === "BILLING_CHECKOUT_INPUT_INVALID" && error?.statusCode === 400
  );

  console.log("PASS billing contract: HTTPS sessions, secret-free outputs, signature-first normalized webhooks.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
