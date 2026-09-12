const BILLING_STATUSES = Object.freeze([
  "none",
  "incomplete",
  "trialing",
  "active",
  "past_due",
  "paused",
  "canceled",
  "unpaid"
]);

const WEBHOOK_STATUSES = new Set(BILLING_STATUSES.filter((status) => status !== "none"));
const adapters = new Map();

function normalizeBillingProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (!provider) return "";
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(provider) ? provider : "";
}

function normalizeSubscriptionStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return BILLING_STATUSES.includes(status) ? status : "none";
}

function subscriptionStatusAllowsAccess(status) {
  return ["active", "trialing"].includes(normalizeSubscriptionStatus(status));
}

function registerBillingAdapter(name, adapter) {
  const provider = normalizeBillingProvider(name);
  if (!provider) throw new Error("Billing adapter name is invalid.");
  if (!adapter || typeof adapter !== "object") {
    throw new Error("Billing adapter must be an object.");
  }
  adapters.set(provider, adapter);
}

function getBillingAdapter(name) {
  const provider = normalizeBillingProvider(name);
  return provider ? adapters.get(provider) || null : null;
}

function adapterConfigured(adapter, env) {
  return typeof adapter?.isConfigured === "function"
    ? Boolean(adapter.isConfigured(env))
    : true;
}

function getBillingGatewayStatus(env = process.env) {
  const provider = normalizeBillingProvider(env.BILLING_PROVIDER);
  if (!provider) {
    return {
      configured: false,
      provider: null,
      adapterInstalled: false,
      checkout: false,
      customerPortal: false,
      webhooks: false,
      state: "provider-not-selected"
    };
  }

  const adapter = getBillingAdapter(provider);
  if (!adapter) {
    return {
      configured: false,
      provider,
      adapterInstalled: false,
      checkout: false,
      customerPortal: false,
      webhooks: false,
      state: "adapter-not-installed"
    };
  }

  const capabilities = adapter.capabilities || {};
  const configured = adapterConfigured(adapter, env);

  return {
    configured,
    provider,
    adapterInstalled: true,
    checkout:
      configured &&
      Boolean(capabilities.checkout) &&
      typeof adapter.startCheckout === "function",
    customerPortal:
      configured &&
      Boolean(capabilities.customerPortal) &&
      typeof adapter.startCustomerPortal === "function",
    webhooks:
      configured &&
      Boolean(capabilities.webhooks) &&
      typeof adapter.verifyWebhook === "function" &&
      typeof adapter.parseWebhook === "function",
    state: configured ? "ready" : "adapter-not-configured"
  };
}

function billingGatewayError(code, publicMessage, statusCode = 503) {
  const error = new Error(publicMessage);
  error.code = code;
  error.publicMessage = publicMessage;
  error.statusCode = statusCode;
  return error;
}

function cleanOpaqueSubject(value) {
  const subject = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(subject)) return null;
  return subject;
}

function cleanHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function cleanProviderReference(value, maxLength = 500) {
  const reference = String(value || "").trim();
  if (!reference || reference.length > maxLength) return null;
  return reference;
}

function cleanIdentifier(value, maxLength = 200) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) return null;
  return text;
}

function cleanTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function requireReadyGateway(capability, env = process.env) {
  const gateway = getBillingGatewayStatus(env);
  if (!gateway.provider) {
    throw billingGatewayError(
      "BILLING_PROVIDER_NOT_SELECTED",
      "Billing is not available yet because no payment provider is selected."
    );
  }
  const adapter = getBillingAdapter(gateway.provider);
  if (!adapter) {
    throw billingGatewayError(
      "BILLING_ADAPTER_NOT_INSTALLED",
      "Billing is not available yet because the selected payment-provider adapter is not installed."
    );
  }
  if (!gateway.configured) {
    throw billingGatewayError(
      "BILLING_ADAPTER_NOT_CONFIGURED",
      "Billing is temporarily unavailable because the payment provider is not fully configured."
    );
  }
  if (!gateway[capability]) {
    throw billingGatewayError(
      `BILLING_${String(capability).toUpperCase()}_UNAVAILABLE`,
      "The selected payment provider does not support that billing action."
    );
  }
  return { gateway, adapter };
}

async function startBillingCheckoutSession({
  subject,
  planTier = "top",
  successUrl = null,
  cancelUrl = null,
  requestId = null,
  env = process.env
} = {}) {
  const { gateway, adapter } = requireReadyGateway("checkout", env);
  const opaqueSubject = cleanOpaqueSubject(subject);
  if (!opaqueSubject) {
    throw billingGatewayError(
      "BILLING_SUBJECT_INVALID",
      "Could not create a privacy-safe billing subject.",
      500
    );
  }
  if (String(planTier || "").trim().toLowerCase() !== "top") {
    throw billingGatewayError(
      "BILLING_PLAN_UNSUPPORTED",
      "That subscription plan is not available for checkout.",
      400
    );
  }

  const result = await adapter.startCheckout({
    subject: opaqueSubject,
    planTier: "top",
    successUrl: successUrl ? cleanHttpsUrl(successUrl) : null,
    cancelUrl: cancelUrl ? cleanHttpsUrl(cancelUrl) : null,
    requestId: String(requestId || "").trim().slice(0, 128) || null,
    env
  });

  const checkoutUrl = cleanHttpsUrl(result?.checkoutUrl);
  if (!checkoutUrl) {
    throw billingGatewayError(
      "BILLING_PROVIDER_RESPONSE_INVALID",
      "The payment provider returned an invalid checkout session.",
      502
    );
  }

  return {
    provider: gateway.provider,
    planTier: "top",
    checkoutUrl,
    customerReference: cleanProviderReference(result?.customerReference),
    subscriptionReference: cleanProviderReference(result?.subscriptionReference)
  };
}

async function startBillingPortalSession({
  customerReference,
  returnUrl = null,
  requestId = null,
  env = process.env
} = {}) {
  const { gateway, adapter } = requireReadyGateway("customerPortal", env);
  const reference = cleanProviderReference(customerReference);
  if (!reference) {
    throw billingGatewayError(
      "BILLING_CUSTOMER_REFERENCE_MISSING",
      "No payment-provider customer is connected to this account yet.",
      409
    );
  }

  const result = await adapter.startCustomerPortal({
    customerReference: reference,
    returnUrl: returnUrl ? cleanHttpsUrl(returnUrl) : null,
    requestId: String(requestId || "").trim().slice(0, 128) || null,
    env
  });
  const portalUrl = cleanHttpsUrl(result?.portalUrl);
  if (!portalUrl) {
    throw billingGatewayError(
      "BILLING_PROVIDER_RESPONSE_INVALID",
      "The payment provider returned an invalid customer-portal session.",
      502
    );
  }

  return {
    provider: gateway.provider,
    portalUrl
  };
}

async function processBillingWebhook({
  rawBody,
  headers = {},
  requestId = null,
  env = process.env
} = {}) {
  const { gateway, adapter } = requireReadyGateway("webhooks", env);
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "");

  const verified = await adapter.verifyWebhook({
    rawBody: body,
    headers,
    requestId: String(requestId || "").trim().slice(0, 128) || null,
    env
  });
  if (verified !== true) {
    throw billingGatewayError(
      "BILLING_WEBHOOK_SIGNATURE_INVALID",
      "Billing webhook signature is invalid.",
      401
    );
  }

  const parsed = await adapter.parseWebhook({ rawBody: body, headers, env });
  const providerEventId = cleanIdentifier(parsed?.eventId);
  const eventType = cleanIdentifier(parsed?.eventType, 120) || "subscription.updated";
  const status = normalizeSubscriptionStatus(parsed?.status);
  const occurredAt = cleanTimestamp(parsed?.occurredAt);
  const subject = parsed?.subject ? cleanOpaqueSubject(parsed.subject) : null;
  const customerReference = cleanProviderReference(parsed?.customerReference);
  const subscriptionReference = cleanProviderReference(parsed?.subscriptionReference);
  const currentPeriodStart = cleanTimestamp(parsed?.currentPeriodStart);
  const currentPeriodEnd = cleanTimestamp(parsed?.currentPeriodEnd);

  if (
    !providerEventId ||
    !WEBHOOK_STATUSES.has(status) ||
    !occurredAt ||
    (!subject && !customerReference && !subscriptionReference)
  ) {
    throw billingGatewayError(
      "BILLING_WEBHOOK_PAYLOAD_INVALID",
      "Billing webhook payload is invalid.",
      400
    );
  }

  return {
    provider: gateway.provider,
    providerEventId,
    eventType,
    status,
    planTier: "top",
    subject,
    customerReference,
    subscriptionReference,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(parsed?.cancelAtPeriodEnd),
    occurredAt
  };
}

module.exports = {
  BILLING_STATUSES,
  normalizeBillingProvider,
  normalizeSubscriptionStatus,
  subscriptionStatusAllowsAccess,
  registerBillingAdapter,
  getBillingAdapter,
  getBillingGatewayStatus,
  startBillingCheckoutSession,
  startBillingPortalSession,
  processBillingWebhook
};
