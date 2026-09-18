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
let webhookPlanTier = "ultra";

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
      checkoutUrl: `https://billing.example.invalid/checkout/${input.planTier}`,
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
      planTier: webhookPlanTier,
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
  assert.deepEqual(missing.paidPlans, ["premium", "ultra"]);
  assert.deepEqual(missing.futurePlans, ["max"]);

  const env = {
    BILLING_PROVIDER: provider,
    BILLING_CONTRACT_KEY: "configured"
  };
  const ready = getBillingGatewayStatus(env);
  assert.equal(ready.configured, true);
  assert.deepEqual(ready.paidPlans, ["premium", "ultra"]);
  assert.deepEqual(ready.futurePlans, ["max"]);

  for (const planTier of ["premium", "ultra"]) {
    const checkout = await startBillingCheckoutSession({
      subject: "subject-opaque-123",
      email: "USER@example.com",
      planTier,
      successUrl: "https://unbound.example.invalid/billing/success",
      cancelUrl: "https://unbound.example.invalid/billing/cancel",
      requestId: `request-${planTier}`,
      env
    });
    assert.equal(checkoutInput.subject, "subject-opaque-123");
    assert.equal(checkoutInput.email, "user@example.com");
    assert.equal(checkoutInput.planTier, planTier);
    assert.equal(checkout.planTier, planTier);
    assert.ok(checkout.checkoutUrl.includes(planTier));
    assert.ok(!JSON.stringify(checkout).includes("DO_NOT_LEAK"));
  }

  await assert.rejects(
    () => startBillingCheckoutSession({
      subject: "subject-opaque-123",
      email: "user@example.com",
      planTier: "max",
      env
    }),
    (error) => error?.code === "BILLING_CHECKOUT_INPUT_INVALID"
  );

  const maxEnv = { ...env, UNBOUND_MAX_LAUNCH_ENABLED: "true" };
  const maxGateway = getBillingGatewayStatus(maxEnv);
  assert.deepEqual(maxGateway.paidPlans, ["premium", "ultra", "max"]);
  assert.deepEqual(maxGateway.futurePlans, []);
  const maxCheckout = await startBillingCheckoutSession({
    subject: "subject-opaque-123",
    email: "user@example.com",
    planTier: "max",
    env: maxEnv
  });
  assert.equal(maxCheckout.planTier, "max");
  assert.equal(checkoutInput.planTier, "max");

  const legacyCheckout = await startBillingCheckoutSession({
    subject: "subject-opaque-123",
    email: "user@example.com",
    planTier: "top",
    env
  });
  assert.equal(checkoutInput.planTier, "ultra");
  assert.equal(legacyCheckout.planTier, "ultra");

  const portal = await startBillingCustomerPortalSession({
    subject: "subject-opaque-123",
    email: "user@example.com",
    providerCustomerId: "cust_provider_123",
    returnUrl: "https://unbound.example.invalid/account",
    requestId: "request-portal",
    env
  });
  assert.equal(portalInput.providerCustomerId, "cust_provider_123");
  assert.ok(portal.portalUrl.startsWith("https://"));
  assert.ok(!JSON.stringify(portal).includes("cust_provider_123"));

  for (const expectedPlan of ["premium", "ultra"]) {
    webhookPlanTier = expectedPlan;
    webhookVerified = false;
    webhookParsed = false;
    const webhook = await processBillingWebhook({
      rawBody: Buffer.from('{"type":"subscription.updated"}'),
      headers: { "x-contract-signature": "valid" },
      env
    });
    assert.equal(webhook.planTier, expectedPlan);
  }

  webhookPlanTier = "max";
  const maxWebhook = await processBillingWebhook({
    rawBody: Buffer.from("{}"),
    headers: { "x-contract-signature": "valid" },
    env: maxEnv
  });
  assert.equal(maxWebhook.planTier, "max");

  webhookPlanTier = "top";
  const legacyWebhook = await processBillingWebhook({
    rawBody: Buffer.from("{}"),
    headers: { "x-contract-signature": "valid" },
    env
  });
  assert.equal(legacyWebhook.planTier, "ultra");

  webhookPlanTier = null;
  const planlessLifecycleWebhook = await processBillingWebhook({
    rawBody: Buffer.from("{}"),
    headers: { "x-contract-signature": "valid" },
    env
  });
  assert.equal(planlessLifecycleWebhook.planTier, null);

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
  assert.equal(webhookParsed, false);

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
      planTier: "premium",
      env: { BILLING_PROVIDER: "insecure-billing" }
    }),
    (error) => error?.code === "BILLING_PROVIDER_RESPONSE_INVALID" && error?.statusCode === 502
  );

  for (const invalidPlan of ["free", "enterprise", ""]) {
    await assert.rejects(
      () => startBillingCheckoutSession({
        subject: "opaque",
        email: "user@example.com",
        planTier: invalidPlan,
        env
      }),
      (error) => error?.code === "BILLING_CHECKOUT_INPUT_INVALID" && error?.statusCode === 400
    );
  }

  console.log("PASS billing contract: revised Premium/Ultra checkout, launch-gated Max, legacy TOP alias, safe lifecycle webhooks.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
